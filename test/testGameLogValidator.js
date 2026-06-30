const test = require("node:test");
const assert = require("node:assert/strict");

const {
    validateGameEventLog,
    validateGameOverLog,
    validateGameStartLog,
    validatePlacementDecisionLog,
} = require("../src/server/validators/gameLogValidator.js");

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

test("validatePlacementDecisionLog는 최소 placement_decision 로그를 허용한다", () => {
    const result = validatePlacementDecisionLog(createPlacementDecisionLog());

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
});

test("validatePlacementDecisionLog는 필수 필드가 없으면 실패한다", () => {
    const result = validatePlacementDecisionLog(createPlacementDecisionLog({
        selectedPlacement: null,
    }));

    assert.equal(result.ok, false);
    assert.equal(result.reason, "SELECTED_PLACEMENT_REQUIRED");
});

test("validatePlacementDecisionLog는 payload가 너무 크면 실패한다", () => {
    const result = validatePlacementDecisionLog(
        createPlacementDecisionLog({
            boardBefore: [Array(100).fill("square")],
            boardAfter: [Array(100).fill("square")],
        }),
        { maxBytes: 64 },
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "LOG_PAYLOAD_TOO_LARGE");
});

test("validateGameStartLog는 최소 game_start 로그를 허용한다", () => {
    const result = validateGameStartLog({
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
    });

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
});

test("validateGameOverLog는 최소 game_over 로그를 허용한다", () => {
    const result = validateGameOverLog({
        eventType: "game_over",
        schemaVersion: 1,
        gameId: "game-001",
        roomId: "room-001",
        mode: "multi",
        endedAt: 1780000000000,
        winnerPlayerId: "p1",
        loserPlayerId: "p2",
        reason: "top_out",
        finishType: "normal",
    });

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
});

test("validateGameEventLog는 eventType별 검증으로 위임한다", () => {
    const result = validateGameEventLog({
        eventType: "game_over",
        schemaVersion: 1,
        gameId: "game-001",
        roomId: "room-001",
        mode: "multi",
        endedAt: 1780000000000,
        winnerPlayerId: "p1",
        loserPlayerId: "",
        reason: "top_out",
        finishType: "normal",
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "LOSER_PLAYER_ID_REQUIRED");
});
