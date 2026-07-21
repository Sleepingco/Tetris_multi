const test = require("node:test");
const assert = require("node:assert/strict");

const {
    validateGameEventLog,
    validateGameOverLog,
    validateGameStartLog,
    validatePlacementDecisionLog,
} = require("../dist/server/server/validators/gameLogValidator.js");

function createPlacementDecisionLog(overrides = {}) {
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
        playerId: "player-001",
        gameId: "game-001",
        roomId: "room-001",
        source: "human",
        modelType: null,
        tick: 10,
        pieceIndex: 3,
        createdAt: 1780000000000,
        boardBefore: [
            [null, null],
            [null, null],
        ],
        boardAfter: [
            ["square", "square"],
            ["square", "square"],
        ],
        activePiece: { ...placement, cells: placement.cells.map(cell => ({ ...cell })) },
        nextQueue: ["bar", "tree"],
        holdPiece: null,
        selectedPlacement: placement,
        placementResult: {
            linesCleared: 2,
            scoreDelta: 300,
            gameOver: false,
        },
        metricsBefore,
        metricsAfter,
        evaluation: {
            score: 20,
            candidateCount: 1,
            reason: {
                linesCleared: 2,
                holesDelta: 0,
                bumpinessDelta: 0,
                aggregateHeightDelta: 4,
                maxHeightDelta: 2,
            },
        },
        aiComparison: {
            heuristicPlacement: { ...placement, cells: placement.cells.map(cell => ({ ...cell })) },
            heuristicScore: 20,
            userScore: 20,
            betterBy: 0,
            samePlacement: true,
        },
        ...overrides,
    };
}

function createLegacyPlacementDecisionLog(overrides = {}) {
    return {
        eventType: "placement_decision",
        schemaVersion: 1,
        playerId: "legacy-player",
        gameId: "legacy-game",
        pieceIndex: 1,
        boardBefore: [[null]],
        boardAfter: [["square"]],
        selectedPlacement: {
            pieceType: "square",
            rotation: 0,
            row: 18,
            col: 4,
        },
        ...overrides,
    };
}

test("validatePlacementDecisionLog는 schemaVersion 1 legacy 로그를 허용한다", () => {
    const result = validatePlacementDecisionLog(createLegacyPlacementDecisionLog());

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
});

test("validatePlacementDecisionLog는 human schemaVersion 2 로그를 허용한다", () => {
    const result = validatePlacementDecisionLog(createPlacementDecisionLog());

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
});

test("validatePlacementDecisionLog는 optional authoritative lineage를 검증한다", () => {
    const validResult = validatePlacementDecisionLog(createPlacementDecisionLog({
        authoritativeClientSequence: 7,
        authoritativePieceIndex: 3,
    }));
    const missingPairResult = validatePlacementDecisionLog(createPlacementDecisionLog({
        authoritativeClientSequence: 7,
    }));
    const mismatchedPieceResult = validatePlacementDecisionLog(createPlacementDecisionLog({
        authoritativeClientSequence: 7,
        authoritativePieceIndex: 4,
    }));

    assert.equal(validResult.ok, true);
    assert.equal(missingPairResult.reason, "INVALID_AUTHORITATIVE_LINEAGE");
    assert.equal(mismatchedPieceResult.reason, "INVALID_AUTHORITATIVE_LINEAGE");
});

test("validatePlacementDecisionLog는 heuristic_ai schemaVersion 2 로그를 허용한다", () => {
    const result = validatePlacementDecisionLog(createPlacementDecisionLog({
        source: "heuristic_ai",
        modelType: "heuristic",
        aiDifficulty: "hard",
        aiComparison: undefined,
    }));

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
});

test("validatePlacementDecisionLog는 optional AI 난이도 enum을 검증한다", () => {
    const result = validatePlacementDecisionLog(createPlacementDecisionLog({
        source: "heuristic_ai",
        modelType: "heuristic",
        aiDifficulty: "expert",
        aiComparison: undefined,
    }));

    assert.equal(result.ok, false);
    assert.equal(result.reason, "INVALID_AI_DIFFICULTY");
});

test("validatePlacementDecisionLog는 selectedPlacement가 없으면 실패한다", () => {
    const result = validatePlacementDecisionLog(createPlacementDecisionLog({
        selectedPlacement: null,
    }));

    assert.equal(result.ok, false);
    assert.equal(result.reason, "SELECTED_PLACEMENT_REQUIRED");
});

test("validatePlacementDecisionLog는 payload가 너무 크면 실패한다", () => {
    const result = validatePlacementDecisionLog(
        createLegacyPlacementDecisionLog({
            boardBefore: [Array(100).fill("square")],
            boardAfter: [Array(100).fill("square")],
        }),
        { maxBytes: 64 },
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "LOG_PAYLOAD_TOO_LARGE");
});

test("validatePlacementDecisionLog는 metricsBefore와 metricsAfter를 검증한다", () => {
    const invalidBefore = validatePlacementDecisionLog(createPlacementDecisionLog({
        metricsBefore: {
            columnHeights: [0],
            aggregateHeight: 0,
            maxHeight: 0,
            holes: 0,
            bumpiness: 0,
            completeLines: 0,
        },
    }));
    const invalidAfter = validatePlacementDecisionLog(createPlacementDecisionLog({
        metricsAfter: null,
    }));

    assert.equal(invalidBefore.reason, "INVALID_METRICS_BEFORE");
    assert.equal(invalidAfter.reason, "INVALID_METRICS_AFTER");
});

test("validatePlacementDecisionLog는 evaluation schema를 검증한다", () => {
    const result = validatePlacementDecisionLog(createPlacementDecisionLog({
        evaluation: {
            score: Number.NaN,
            candidateCount: 0,
            reason: {},
        },
    }));

    assert.equal(result.ok, false);
    assert.equal(result.reason, "INVALID_EVALUATION");
});

test("validatePlacementDecisionLog는 schemaVersion 2 source 누락을 거부한다", () => {
    const result = validatePlacementDecisionLog(createPlacementDecisionLog({
        source: undefined,
    }));

    assert.equal(result.ok, false);
    assert.equal(result.reason, "SOURCE_REQUIRED");
});

test("validatePlacementDecisionLog는 source/modelType 조합과 aiComparison을 검증한다", () => {
    const invalidSource = validatePlacementDecisionLog(createPlacementDecisionLog({
        source: "ml_ai",
        modelType: "heuristic",
    }));
    const invalidComparison = validatePlacementDecisionLog(createPlacementDecisionLog({
        aiComparison: {
            heuristicPlacement: null,
            heuristicScore: 10,
            userScore: 5,
            betterBy: 5,
            samePlacement: false,
        },
    }));

    assert.equal(invalidSource.reason, "INVALID_SOURCE_MODEL");
    assert.equal(invalidComparison.reason, "INVALID_AI_COMPARISON");
});

test("validatePlacementDecisionLog는 malformed board와 순환 payload를 안전하게 거부한다", () => {
    const malformedResult = validatePlacementDecisionLog(createPlacementDecisionLog({
        boardAfter: [["square"], ["square", "square"]],
    }));
    const malformedPlacement = createPlacementDecisionLog();
    malformedPlacement.selectedPlacement.cells[3] = { row: 0, col: 0 };
    const placementResult = validatePlacementDecisionLog(malformedPlacement);
    const cyclicLog = createPlacementDecisionLog();
    cyclicLog.self = cyclicLog;
    const cyclicResult = validatePlacementDecisionLog(cyclicLog);

    assert.equal(malformedResult.ok, false);
    assert.equal(malformedResult.reason, "INVALID_BOARD");
    assert.equal(placementResult.reason, "INVALID_SELECTED_PLACEMENT");
    assert.equal(cyclicResult.ok, false);
    assert.equal(cyclicResult.reason, "INVALID_LOG_PAYLOAD");
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

test("game lifecycle log는 experimental AI 요청과 실제 fallback provenance를 검증한다", () => {
    const startResult = validateGameStartLog({
        eventType: "game_start",
        schemaVersion: 1,
        gameId: "game-pve-001",
        roomId: "room-pve-001",
        mode: "pve",
        aiPolicyRequested: "placement_v4",
        startedAt: 1780000000000,
        players: [{ playerId: "p1" }, { playerId: "ai" }],
    });
    const overLog = {
        eventType: "game_over",
        schemaVersion: 1,
        gameId: "game-pve-001",
        roomId: "room-pve-001",
        mode: "pve",
        aiPolicyRequested: "placement_v4",
        aiPolicyLastUsed: "heuristic",
        aiPolicyFallbackCount: 1,
        aiPolicyLastFallbackReason: "MODEL_NOT_FOUND",
        aiModelSha256: null,
        endedAt: 1780000000100,
        winnerPlayerId: "p1",
        loserPlayerId: "ai",
        reason: "top_out",
        finishType: "normal",
    };

    assert.equal(startResult.ok, true);
    assert.equal(validateGameOverLog(overLog).ok, true);
    assert.equal(
        validateGameOverLog({ ...overLog, aiPolicyLastUsed: "strong_ai" }).reason,
        "INVALID_AI_POLICY_USED",
    );
    assert.equal(
        validateGameOverLog({ ...overLog, aiPolicyFallbackCount: -1 }).reason,
        "INVALID_AI_POLICY_FALLBACK_COUNT",
    );
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
