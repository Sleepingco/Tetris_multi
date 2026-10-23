const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const rawFixture = require("./fixtures/gameplay-log-v3.json");
const { validateGameEventLog } = require("../dist/server/server/validators/gameLogValidator.js");
const { projectGameEventLog } = require("../dist/server/server/services/gameEventProjector.js");
const { prepareCanonicalGameEvent } = require("../dist/server/server/db/canonicalGameEvent.js");
const { createRuntimeEventStorage } = require("../dist/server/server/services/runtimeEventStorage.js");
const { runJsonlImport } = require("../dist/server/server/db/importJsonl.js");
const { exportPlacementDataset } = require("../scripts/export-placement-dataset.js");
const { BUFFER_GAMEPLAY_LOG_CONTEXT } = require("../dist/server/shared/gameplayLogContext.js");

function lifecycle() {
    return [{
        ...BUFFER_GAMEPLAY_LOG_CONTEXT,
        eventType: "game_start", schemaVersion: 3, gameId: rawFixture.gameId, roomId: rawFixture.roomId,
        mode: "multi", startedAt: rawFixture.createdAt - 1,
        players: [{ playerId: "v3-human", role: "host", playerType: "human" },
            { playerId: "v3-opponent", role: "guest", playerType: "human" }],
    }, {
        ...BUFFER_GAMEPLAY_LOG_CONTEXT,
        eventType: "game_over", schemaVersion: 3, gameId: rawFixture.gameId, roomId: rawFixture.roomId,
        mode: "multi", endedAt: rawFixture.createdAt + 1, winnerPlayerId: "v3-human", loserPlayerId: "v3-opponent",
        reason: "lock_out", finishType: "normal",
        expectedPlacementEventCounts: [
            { playerId: "v3-human", playerType: "human", expectedPlacementEventCount: 1 },
            { playerId: "v3-opponent", playerType: "human", expectedPlacementEventCount: 0 },
        ],
    }];
}

function placement() {
    return structuredClone({ ...rawFixture, authoritativeClientSequence: 7, authoritativePieceIndex: 5 });
}

test("v3 human·heuristic·lifecycle는 geometry·관찰 단계·종료 사유를 보존한다", () => {
    const human = placement();
    const ai = { ...placement(), source: "heuristic_ai", modelType: "heuristic", aiComparison: null,
        observation: { stage: "post_garbage_spawn", nextSpawnOutcome: "clear", terminalOutcome: null } };
    for (const log of [human, ai, ...lifecycle()]) {
        assert.equal(validateGameEventLog(log).ok, true);
        const event = projectGameEventLog(log);
        assert.equal(event.schemaVersion, 3);
        assert.deepEqual(event.payload.geometry, BUFFER_GAMEPLAY_LOG_CONTEXT.geometry);
        assert.equal(prepareCanonicalGameEvent(event).snapshot.schemaVersion, 3);
    }
    assert.equal(projectGameEventLog(human).trustLevel, "client_reported");
    assert.equal(projectGameEventLog(ai).trustLevel, "server_authoritative");
    assert.equal(projectGameEventLog(lifecycle()[1]).payload.reason, "lock_out");
    human.observation.privateText = "not-persisted";
    human.geometry.privateText = "not-persisted";
    assert.equal(validateGameEventLog(human).ok, false);
    delete human.geometry.privateText;
    assert.equal(projectGameEventLog(human).payload.observation.privateText, undefined);
});

const invalidChanges = [
    log => { log.gameplayRulesVersion = "legacy20-v1"; },
    log => { log.geometry.hiddenRows = 0; },
    log => { log.coordinateSystem = "screen"; },
    log => { log.boardBefore.pop(); },
    log => { log.boardAfter[0].pop(); },
    log => { log.boardAfter[0][0] = "invalid-cell"; },
    log => { log.selectedPlacement.cells[0].row = 0; },
    log => { log.activePiece.rotation = 4; },
    log => { log.nextQueue = ["bad-piece"]; },
    log => { log.observation.nextSpawnOutcome = "clear"; },
    log => { log.observation.terminalOutcome = "block_out"; },
    log => { log.observation.stage = "post_garbage_spawn"; },
    log => { log.placementResult.gameOver = true; },
];
test("v3의 잘못된 규칙·좌표·cell·미확정 종료는 raw/canonical 경계에서 거부한다", () => {
    for (const change of invalidChanges) {
        const raw = placement();
        change(raw);
        assert.equal(validateGameEventLog(raw).ok, false, change.toString());
        const canonical = structuredClone(projectGameEventLog(placement()));
        change(canonical.payload);
        assert.throws(() => prepareCanonicalGameEvent(canonical), { code: "CANONICAL_EVENT_INVALID" });
    }
    const forgedTrust = structuredClone(projectGameEventLog(placement()));
    forgedTrust.trustLevel = "server_authoritative";
    assert.throws(() => prepareCanonicalGameEvent(forgedTrust), { code: "CANONICAL_EVENT_INVALID" });
});

test("v3 lock_out은 고정된 마지막 cell·종료 사유를 남기고 후처리 결과를 거부한다", () => {
    const raw = placement();
    raw.selectedPlacement.row = 18;
    raw.selectedPlacement.cells = raw.selectedPlacement.cells.map(cell => ({ ...cell, row: cell.row - 20 }));
    raw.placementResult.gameOver = true;
    raw.placementResult.gameOverReason = "lock_out";
    raw.observation = { stage: "lock_commit", nextSpawnOutcome: "not_evaluated", terminalOutcome: "lock_out" };
    assert.equal(validateGameEventLog(raw).ok, true);
    assert.equal(projectGameEventLog(raw).payload.placementResult.gameOverReason, "lock_out");
    raw.placementResult.appliedGarbageLines = 1;
    assert.equal(validateGameEventLog(raw).ok, false);
});

test("legacy payload/hash는 새 metadata·종료 필드를 덧붙여도 기존 투영을 유지한다", () => {
    const legacy = { ...placement(), schemaVersion: 2 };
    delete legacy.gameplayRulesVersion;
    delete legacy.geometry;
    delete legacy.coordinateSystem;
    delete legacy.observation;
    const before = prepareCanonicalGameEvent(projectGameEventLog(legacy));
    const after = prepareCanonicalGameEvent(projectGameEventLog({ ...legacy, ...BUFFER_GAMEPLAY_LOG_CONTEXT,
        observation: placement().observation,
        placementResult: { ...legacy.placementResult, gameOverReason: "block_out" } }));
    assert.equal(before.canonicalEnvelope, after.canonicalEnvelope);
    assert.equal(before.eventSha256, after.eventSha256);
    const v3 = prepareCanonicalGameEvent(projectGameEventLog(placement()));
    assert.equal(before.eventId, v3.eventId);
    assert.notEqual(before.eventSha256, v3.eventSha256);
});

test("v3 runtime 저장은 migration 3을 확인하고 기존 bounded append를 사용한다", async () => {
    const events = [];
    const storage = await createRuntimeEventStorage({
        env: { GAME_EVENT_STORAGE: "postgres", DATABASE_URL: "postgresql://unused.invalid/test" },
        repository: {
            async verifyReady(version) { assert.equal(version, 3); },
            async append(event) { events.push(event); return { status: "inserted", eventId: "v3" }; },
            async close() {}, getPoolStats() { return { totalCount: 0, idleCount: 0, waitingCount: 0, max: 4 }; },
        },
    });
    assert.equal((await storage.savePlacementDecisionLog(placement())).ok, true);
    assert.equal(events[0].schemaVersion, 3);
    await storage.close();
});

test("v3 import는 원본을 보존하고 완결성을 읽되 legacy ML export에는 섞지 않는다", async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "tetris-v3-import-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const inputPath = path.join(directory, "events.jsonl");
    const [start, over] = lifecycle();
    const bytes = [start, placement(), over].map(log => JSON.stringify(log)).join("\n") + "\n";
    await writeFile(inputPath, bytes);
    const report = await runJsonlImport({ inputPath, dryRun: true });
    assert.equal(report.ok, true);
    assert.equal(report.completeness.completeGameCount, 1);
    assert.equal(report.completeness.games[0].mlExportEligible, false);
    assert.equal(await readFile(inputPath, "utf8"), bytes);
    const outputDir = path.join(directory, "dataset");
    await exportPlacementDataset({ input: inputPath, outputDir });
    assert.equal(await readFile(path.join(outputDir, "train.jsonl"), "utf8"), "");
    const rejected = (await readFile(path.join(outputDir, "rejected.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(rejected[0].reason, "UNSUPPORTED_GAMEPLAY_RULESET");
    const mixedStart = { ...start, schemaVersion: 1 };
    await writeFile(inputPath, [mixedStart, placement(), over].map(log => JSON.stringify(log)).join("\n"));
    const mixed = await runJsonlImport({ inputPath, dryRun: true });
    assert.ok(mixed.completeness.games[0].reasonCodes.includes("gameplay_rules_version_mismatch"));
    assert.equal(mixed.completeness.games[0].mlExportEligible, false);
});
