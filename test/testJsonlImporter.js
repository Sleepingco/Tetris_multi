const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const {
    mkdtemp,
    readFile,
    rm,
    writeFile,
} = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
    JsonlImportError,
    runJsonlImport,
} = require("../dist/server/server/db/importJsonl.js");
const {
    prepareCanonicalGameEvent,
} = require("../dist/server/server/db/canonicalGameEvent.js");

function players() {
    return [
        {
            playerId: "player-1",
            nickname: "Private Nickname",
            role: "host",
            playerType: "human",
        },
        {
            playerId: "player-2",
            nickname: "Other Private Nickname",
            role: "guest",
            playerType: "human",
        },
    ];
}

function gameStart(gameId, overrides = {}) {
    return {
        eventType: "game_start",
        schemaVersion: 1,
        gameId,
        roomId: "GOAL9C01",
        mode: "multi",
        startedAt: 1784800000000,
        players: players(),
        ...overrides,
    };
}

function placement(gameId, playerId, pieceIndex, overrides = {}) {
    const piece = {
        pieceType: "square",
        rotation: 0,
        row: 0,
        col: 0,
        cells: [
            { row: 0, col: 0 },
            { row: 0, col: 1 },
            { row: 1, col: 0 },
            { row: 1, col: 1 },
        ],
    };
    const metrics = {
        columnHeights: [0, 0],
        aggregateHeight: 0,
        maxHeight: 0,
        holes: 0,
        bumpiness: 0,
        completeLines: 0,
    };
    return {
        eventType: "placement_decision",
        schemaVersion: 2,
        gameId,
        roomId: "GOAL9C01",
        mode: "multi",
        playerId,
        source: "human",
        modelType: null,
        tick: pieceIndex,
        pieceIndex,
        createdAt: 1784800000100 + pieceIndex,
        boardBefore: [[null, null], [null, null]],
        boardAfter: [["square", "square"], ["square", "square"]],
        activePiece: piece,
        nextQueue: ["bar"],
        holdPiece: null,
        inputSequence: [],
        selectedPlacement: piece,
        placementResult: {
            linesCleared: 0,
            scoreDelta: 0,
            gameOver: false,
        },
        metricsBefore: metrics,
        metricsAfter: {
            ...metrics,
            columnHeights: [2, 2],
            aggregateHeight: 4,
            maxHeight: 2,
        },
        evaluation: {
            score: 0,
            candidateCount: 1,
            reason: {
                linesCleared: 0,
                holesDelta: 0,
                bumpinessDelta: 0,
                aggregateHeightDelta: 4,
                maxHeightDelta: 2,
            },
        },
        aiComparison: {
            heuristicPlacement: piece,
            heuristicScore: 0,
            userScore: 0,
            betterBy: 0,
            samePlacement: true,
        },
        authoritativeClientSequence: pieceIndex + 1,
        authoritativePieceIndex: pieceIndex,
        ...overrides,
    };
}

function gameOver(gameId, expectedCounts, overrides = {}) {
    const log = {
        eventType: "game_over",
        schemaVersion: 1,
        gameId,
        roomId: "GOAL9C01",
        mode: "multi",
        endedAt: 1784800001000,
        winnerPlayerId: "player-1",
        loserPlayerId: "player-2",
        reason: "top_out",
        finishType: "normal",
        ...overrides,
    };
    if (expectedCounts !== undefined) {
        log.expectedPlacementEventCounts = expectedCounts;
    }
    return log;
}

function jsonl(rows) {
    return `${rows.map(row => (
        typeof row === "string" ? row : JSON.stringify(row)
    )).join("\n")}\n`;
}

async function withFixture(rows, callback) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "tetris-goal9c-unit-"));
    const filePath = path.join(directory, "fixture.jsonl");
    try {
        await writeFile(filePath, jsonl(rows), "utf8");
        return await callback(filePath);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

test("dry-run은 source lineage와 canonical completeness를 결정적으로 만든다", async () => {
    const rows = [
        gameStart("complete-game"),
        placement("complete-game", "player-1", 0),
        gameOver("complete-game", [
            {
                playerId: "player-1",
                playerType: "human",
                expectedPlacementEventCount: 1,
            },
            {
                playerId: "player-2",
                playerType: "human",
                expectedPlacementEventCount: 0,
            },
        ]),
    ];
    await withFixture(rows, async filePath => {
        const first = await runJsonlImport({ inputPath: filePath, dryRun: true });
        const second = await runJsonlImport({ inputPath: filePath, dryRun: true });

        assert.equal(first.ok, true);
        assert.equal(first.source.fileName, "fixture.jsonl");
        assert.equal(first.source.lineCount, 3);
        assert.equal(first.canonical.eventCount, 3);
        assert.equal(first.completeness.completeGameCount, 1);
        assert.equal(first.completeness.games[0].mlExportEligible, true);
        assert.equal(
            first.canonical.orderedEventSha256,
            second.canonical.orderedEventSha256,
        );
        assert.equal(first.source.sha256, second.source.sha256);
        assert.doesNotMatch(JSON.stringify(first), /Private Nickname|complete-game/);
    });
});

test("completeness는 lifecycle, duplicate, internal gap, tail과 legacy를 구분한다", async () => {
    const expected = [{
        playerId: "player-1",
        playerType: "human",
        expectedPlacementEventCount: 2,
    }, {
        playerId: "player-2",
        playerType: "human",
        expectedPlacementEventCount: 0,
    }];
    const duplicateStart = gameStart("duplicate-game");
    const duplicatePlacement = placement("duplicate-game", "player-1", 0);
    await withFixture([
        gameStart("legacy-gap"),
        placement("legacy-gap", "player-1", 0),
        placement("legacy-gap", "player-1", 2),
        gameOver("legacy-gap"),
        placement("missing-lifecycle", "player-1", 0),
        duplicateStart,
        duplicateStart,
        duplicatePlacement,
        duplicatePlacement,
        gameOver("duplicate-game", expected),
        gameOver("duplicate-game", expected),
        gameStart("tail-gap"),
        placement("tail-gap", "player-1", 0),
        gameOver("tail-gap", expected),
    ], async filePath => {
        const report = await runJsonlImport({ inputPath: filePath, dryRun: true });

        assert.equal(report.ok, true);
        assert.deepEqual(report.completeness.reasonCodeCounts, {
            legacy_unknown_tail: 1,
            lifecycle_over_duplicate: 1,
            lifecycle_over_missing: 1,
            lifecycle_start_duplicate: 1,
            lifecycle_start_missing: 1,
            placement_duplicate: 1,
            placement_internal_gap: 1,
            placement_tail_count_mismatch: 1,
        });
        assert.equal(report.canonical.duplicateIdentityCount, 3);
        assert.equal(report.completeness.completeGameCount, 0);
        assert.equal(report.completeness.incompleteGameCount, 4);
    });
});

test("malformed, private, conflict와 oversized row는 safe reason으로 실패한다", async () => {
    await withFixture([
        "{not-json",
        {
            eventType: "DATABASE_URL=postgresql://private-credential.invalid/db",
            schemaVersion: 1,
        },
        gameStart("private-game", { token: "must-not-leak" }),
        gameStart("conflict-game"),
        gameStart("conflict-game", { mode: "pve" }),
    ], async filePath => {
        const report = await runJsonlImport({ inputPath: filePath, dryRun: true });
        const serialized = JSON.stringify(report);

        assert.equal(report.ok, false);
        assert.deepEqual(report.failures.reasonCodeCounts, {
            IDEMPOTENCY_CONFLICT: 1,
            INVALID_EVENT_TYPE: 1,
            INVALID_JSON: 1,
            PRIVATE_FIELD_PRESENT: 1,
        });
        assert.deepEqual(report.source.eventTypeCounts, {
            game_start: 3,
            unknown: 1,
        });
        assert.doesNotMatch(
            serialized,
            /must-not-leak|not-json|private-game|private-credential|postgresql:\/\//,
        );
        await assert.rejects(
            runJsonlImport({
                inputPath: filePath,
                dryRun: true,
                maxLineBytes: 16,
            }),
            error => {
                assert.ok(error instanceof JsonlImportError);
                assert.equal(error.code, "SOURCE_LINE_TOO_LARGE");
                return true;
            },
        );
    });
});

test("DB idempotency conflict가 난 game은 ML export 대상이 아니다", async () => {
    const gameId = "db-conflict-game";
    await withFixture([
        gameStart(gameId),
        placement(gameId, "player-1", 0),
        gameOver(gameId, [{
            playerId: "player-1",
            playerType: "human",
            expectedPlacementEventCount: 1,
        }, {
            playerId: "player-2",
            playerType: "human",
            expectedPlacementEventCount: 0,
        }]),
    ], async filePath => {
        const report = await runJsonlImport({
            inputPath: filePath,
            repository: {
                async append(event) {
                    const prepared = prepareCanonicalGameEvent(event);
                    return event.eventType === "game_start"
                        ? {
                            status: "conflict",
                            eventId: prepared.eventId,
                            code: "IDEMPOTENCY_CONFLICT",
                        }
                        : { status: "inserted", eventId: prepared.eventId };
                },
                async close() {},
            },
        });

        assert.equal(report.ok, false);
        assert.equal(report.writes.conflict, 1);
        assert.deepEqual(report.completeness.reasonCodeCounts, {
            idempotency_conflict: 1,
        });
        assert.equal(report.completeness.games[0].status, "incomplete");
        assert.equal(report.completeness.games[0].mlExportEligible, false);
    });
});

test("partial DB failure 뒤 전체 재실행은 row를 덮어쓰지 않는다", async () => {
    const rows = [
        gameStart("partial-game"),
        placement("partial-game", "player-1", 0),
        gameOver("partial-game", [{
            playerId: "player-1",
            playerType: "human",
            expectedPlacementEventCount: 1,
        }, {
            playerId: "player-2",
            playerType: "human",
            expectedPlacementEventCount: 0,
        }]),
    ];
    const stored = new Map();
    function repository(failAt = null) {
        let callCount = 0;
        return {
            async append(event) {
                callCount += 1;
                if (callCount === failAt) throw new Error("sentinel-db-failure");
                const prepared = prepareCanonicalGameEvent(event);
                const previous = stored.get(prepared.eventId);
                if (previous === undefined) {
                    stored.set(prepared.eventId, prepared.eventSha256);
                    return { status: "inserted", eventId: prepared.eventId };
                }
                if (previous === prepared.eventSha256) {
                    return { status: "duplicate", eventId: prepared.eventId };
                }
                return {
                    status: "conflict",
                    eventId: prepared.eventId,
                    code: "IDEMPOTENCY_CONFLICT",
                };
            },
            async close() {},
        };
    }
    await withFixture(rows, async filePath => {
        const partial = await runJsonlImport({
            inputPath: filePath,
            repository: repository(2),
        });
        assert.equal(partial.ok, false);
        assert.equal(partial.writes.inserted, 1);
        assert.equal(partial.writes.failed, 1);
        assert.equal(stored.size, 1);

        const recovered = await runJsonlImport({
            inputPath: filePath,
            repository: repository(),
        });
        assert.equal(recovered.ok, true);
        assert.equal(recovered.writes.duplicate, 1);
        assert.equal(recovered.writes.inserted, 2);
        assert.equal(stored.size, 3);
    });
});

test("CLI는 IMPORT_DATABASE_URL만 읽고 source를 report로 덮어쓰지 않는다", async () => {
    await withFixture([gameStart("cli-game")], async filePath => {
        const before = createHash("sha256")
            .update(await readFile(filePath))
            .digest("hex");
        const cliPath = path.resolve(
            __dirname,
            "../dist/server/server/db/importJsonl.js",
        );
        const missingImportUrl = spawnSync(process.execPath, [cliPath, filePath], {
            env: {
                DATABASE_URL: "postgresql://sentinel-credential.invalid/db",
            },
            encoding: "utf8",
        });
        assert.equal(missingImportUrl.status, 1);
        assert.equal(missingImportUrl.stderr.trim(), "IMPORT_DATABASE_URL_REQUIRED");
        assert.doesNotMatch(
            `${missingImportUrl.stdout}${missingImportUrl.stderr}`,
            /sentinel-credential|postgresql:\/\//,
        );

        const overwrite = spawnSync(process.execPath, [
            cliPath,
            "--dry-run",
            "--report",
            filePath,
            filePath,
        ], { encoding: "utf8" });
        assert.equal(overwrite.status, 1);
        assert.equal(overwrite.stderr.trim(), "REPORT_PATH_IS_SOURCE");
        const after = createHash("sha256")
            .update(await readFile(filePath))
            .digest("hex");
        assert.equal(after, before);
    });
});
