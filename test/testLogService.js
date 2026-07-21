const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
    saveGameEventLog,
    savePlacementDecisionLog,
} = require("../dist/server/server/services/logService.js");
const {
    appendJsonLine,
    resolveGameEventsLogPath,
} = require("../dist/server/server/repositories/jsonlLogRepository.js");

function createPlacementDecisionLog(overrides = {}) {
    return {
        eventType: "placement_decision",
        schemaVersion: 1,
        playerId: "player-001",
        gameId: "game-001",
        pieceIndex: 3,
        boardBefore: [[null, null]],
        boardAfter: [["square", "square"]],
        selectedPlacement: {
            pieceType: "square",
            rotation: 0,
            row: 18,
            col: 4,
        },
        ...overrides,
    };
}

function createV2HumanPlacementDecisionLog(overrides = {}) {
    const placement = {
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
    const metricsBefore = {
        columnHeights: [0, 0],
        aggregateHeight: 0,
        maxHeight: 0,
        holes: 0,
        bumpiness: 0,
        completeLines: 0,
    };
    const metricsAfter = {
        columnHeights: [2, 2],
        aggregateHeight: 4,
        maxHeight: 2,
        holes: 0,
        bumpiness: 0,
        completeLines: 2,
    };

    return {
        eventType: "placement_decision",
        schemaVersion: 2,
        gameId: "game-v2",
        roomId: "room-v2",
        playerId: "human-v2",
        source: "human",
        modelType: null,
        tick: 5,
        pieceIndex: 2,
        createdAt: 1780000000000,
        boardBefore: [
            [null, null],
            [null, null],
        ],
        boardAfter: [
            ["square", "square"],
            ["square", "square"],
        ],
        activePiece: placement,
        nextQueue: ["bar"],
        holdPiece: null,
        selectedPlacement: placement,
        placementResult: {
            linesCleared: 0,
            scoreDelta: 0,
            gameOver: false,
        },
        metricsBefore,
        metricsAfter,
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
            heuristicPlacement: placement,
            heuristicScore: 0,
            userScore: 0,
            betterBy: 0,
            samePlacement: true,
        },
        ...overrides,
    };
}

test("appendJsonLine은 디렉터리를 만들고 JSON object 한 줄을 append한다", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tetris-log-"));
    const filePath = path.join(tempDir, "data", "logs", "game-events.jsonl");
    const log = createPlacementDecisionLog();

    await appendJsonLine(log, { filePath });

    const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), log);
});

test("appendJsonLine은 GAME_EVENTS_LOG_PATH 환경 설정을 저장 경로로 사용한다", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tetris-env-log-"));
    const filePath = path.join(tempDir, "isolated", "e2e-game-events.jsonl");
    const log = createPlacementDecisionLog();
    const env = { GAME_EVENTS_LOG_PATH: filePath };

    assert.equal(resolveGameEventsLogPath(env), filePath);

    await appendJsonLine(log, { env });

    const savedLog = JSON.parse(fs.readFileSync(filePath, "utf8").trim());
    assert.deepEqual(savedLog, log);
});

test("savePlacementDecisionLog는 유효한 로그를 repository에 저장한다", async () => {
    const savedLogs = [];
    const result = await savePlacementDecisionLog(createV2HumanPlacementDecisionLog(), {
        repository: {
            append(log) {
                savedLogs.push(log);
            },
        },
    });

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(savedLogs.length, 1);
    assert.equal(savedLogs[0].eventType, "placement_decision");
    assert.equal(savedLogs[0].schemaVersion, 2);
    assert.equal(savedLogs[0].source, "human");
    assert.ok(savedLogs[0].metricsBefore);
    assert.ok(savedLogs[0].evaluation);
});

test("savePlacementDecisionLog는 schemaVersion 2 로그를 JSONL로 유지한다", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tetris-v2-log-"));
    const filePath = path.join(tempDir, "data", "logs", "game-events.jsonl");
    const log = createV2HumanPlacementDecisionLog();

    const result = await savePlacementDecisionLog(log, {
        repository: {
            append(validatedLog) {
                return appendJsonLine(validatedLog, { filePath });
            },
        },
    });

    const savedLog = JSON.parse(fs.readFileSync(filePath, "utf8").trim());
    assert.equal(result.ok, true);
    assert.deepEqual(savedLog, log);
    assert.equal(savedLog.schemaVersion, 2);
    assert.equal(savedLog.source, "human");
});

test("savePlacementDecisionLog는 저장 실패 시 예외를 던지지 않고 warning만 남긴다", async () => {
    const warnings = [];
    const result = await savePlacementDecisionLog(createV2HumanPlacementDecisionLog(), {
        repository: {
            append() {
                throw new Error("disk full");
            },
        },
        warn(message) {
            warnings.push(message);
        },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "LOG_WRITE_FAILED");
    assert.equal(warnings.length, 1);
});

test("saveGameEventLog는 game_start와 game_over 로그를 저장한다", async () => {
    const savedLogs = [];
    const repository = {
        append(log) {
            savedLogs.push(log);
        },
    };

    const startResult = await saveGameEventLog({
        eventType: "game_start",
        schemaVersion: 1,
        gameId: "game-001",
        roomId: "room-001",
        mode: "multi",
        startedAt: 1780000000000,
        players: [
            { playerId: "p1", nickname: "Host", role: "host" },
            { playerId: "p2", nickname: "Guest", role: "guest" },
        ],
    }, { repository });
    const overResult = await saveGameEventLog({
        eventType: "game_over",
        schemaVersion: 1,
        gameId: "game-001",
        roomId: "room-001",
        mode: "multi",
        endedAt: 1780000001000,
        winnerPlayerId: "p1",
        loserPlayerId: "p2",
        reason: "top_out",
        finishType: "normal",
    }, { repository });

    assert.equal(startResult.ok, true);
    assert.equal(overResult.ok, true);
    assert.deepEqual(savedLogs.map(log => log.eventType), ["game_start", "game_over"]);
});

test("saveGameEventLog는 private field 변형을 JSONL과 shadow 경계 전에 거부한다", async () => {
    let writes = 0;
    const repository = {
        async append() {
            writes += 1;
        },
    };

    for (const field of [
        "accessToken",
        "api_key",
        "auth",
        "client_secret",
        "reconnect_token",
        "session_id",
    ]) {
        const result = await saveGameEventLog({
            eventType: "game_start",
            schemaVersion: 1,
            gameId: `private-${field}`,
            roomId: "private-room",
            mode: "pvp",
            startedAt: 1780000000000,
            players: [{ playerId: "private-player" }],
            nested: { [field]: "must-not-be-written" },
        }, { repository });

        assert.equal(result.ok, false);
        assert.equal(result.reason, "PRIVATE_FIELD_NOT_ALLOWED");
    }
    assert.equal(writes, 0);
});

test("PostgreSQL 장애는 JSONL 성공을 막거나 credential을 노출하지 않는다", (t) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tetris-shadow-down-"));
    const filePath = path.join(tempDir, "game-events.jsonl");
    t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
    const script = `
        const { saveGameEventLog, shutdownLogStorage } = require(
            "./dist/server/server/services/logService.js"
        );
        (async () => {
            const startedAt = performance.now();
            const result = await saveGameEventLog({
                eventType: "game_start",
                schemaVersion: 1,
                gameId: "shadow-down-game",
                roomId: "shadow-down-room",
                mode: "pvp",
                startedAt: 1780000000000,
                players: [{ playerId: "shadow-player" }],
            });
            const saveElapsedMs = performance.now() - startedAt;
            const shutdownStartedAt = performance.now();
            await shutdownLogStorage();
            const shutdownElapsedMs = performance.now() - shutdownStartedAt;
            console.log(JSON.stringify({ result, saveElapsedMs, shutdownElapsedMs }));
        })().catch(() => { process.exitCode = 1; });
    `;
    const result = spawnSync(process.execPath, ["-e", script], {
        cwd: path.resolve(__dirname, ".."),
        encoding: "utf8",
        timeout: 2_000,
        env: {
            DATABASE_URL: "postgresql://sentinel-user:sentinel-secret@127.0.0.1:1/test",
            GAME_EVENTS_LOG_PATH: filePath,
            POSTGRES_SHADOW_WRITE_ENABLED: "true",
            POSTGRES_SHADOW_CONNECTION_TIMEOUT_MS: "25",
            POSTGRES_SHADOW_QUERY_TIMEOUT_MS: "25",
            POSTGRES_SHADOW_SHUTDOWN_TIMEOUT_MS: "500",
        },
    });

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.result.ok, true);
    assert.ok(output.saveElapsedMs < 250, `save took ${output.saveElapsedMs}ms`);
    assert.ok(
        output.shutdownElapsedMs < 1_000,
        `shutdown took ${output.shutdownElapsedMs}ms`,
    );
    assert.equal(fs.readFileSync(filePath, "utf8").trim().split("\n").length, 1);
    assert.doesNotMatch(result.stderr, /sentinel-user|sentinel-secret|postgresql:\/\//);
});
