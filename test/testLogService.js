const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
    saveGameEventLog,
    savePlacementDecisionLog,
} = require("../src/server/services/logService.js");
const {
    appendJsonLine,
} = require("../src/server/repositories/jsonlLogRepository.js");

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

test("appendJsonLine은 디렉터리를 만들고 JSON object 한 줄을 append한다", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tetris-log-"));
    const filePath = path.join(tempDir, "data", "logs", "game-events.jsonl");
    const log = createPlacementDecisionLog();

    await appendJsonLine(log, { filePath });

    const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), log);
});

test("savePlacementDecisionLog는 유효한 로그를 repository에 저장한다", async () => {
    const savedLogs = [];
    const result = await savePlacementDecisionLog(createPlacementDecisionLog(), {
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
});

test("savePlacementDecisionLog는 저장 실패 시 예외를 던지지 않고 warning만 남긴다", async () => {
    const warnings = [];
    const result = await savePlacementDecisionLog(createPlacementDecisionLog(), {
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
