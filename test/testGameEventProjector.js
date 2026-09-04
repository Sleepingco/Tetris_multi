const test = require("node:test");
const assert = require("node:assert/strict");

const {
    projectGameEventLog,
} = require("../dist/server/server/services/gameEventProjector.js");

function piece() {
    return {
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
}

function metrics(columnHeights = [0, 0]) {
    return {
        columnHeights,
        aggregateHeight: columnHeights.reduce((sum, value) => sum + value, 0),
        maxHeight: Math.max(...columnHeights),
        holes: 0,
        bumpiness: 0,
        completeLines: 0,
    };
}

function placement(overrides = {}) {
    return {
        eventType: "placement_decision",
        schemaVersion: 2,
        gameId: "server-game",
        roomId: "ROOM0001",
        mode: "multi",
        playerId: "server-player",
        source: "human",
        modelType: null,
        tick: 10,
        pieceIndex: 3,
        createdAt: 1784800000123,
        boardBefore: [[null, null], [null, null]],
        boardAfter: [["square", "square"], ["square", "square"]],
        activePiece: piece(),
        nextQueue: ["bar", "tree"],
        holdPiece: null,
        inputSequence: [{
            action: "hard_drop",
            tick: 10,
            pieceIndex: 3,
            playerId: "must-not-persist",
            sequence: 1,
            createdAt: 1784800000100,
        }],
        selectedPlacement: piece(),
        placementResult: {
            linesCleared: 0,
            isTSpin: false,
            combo: 0,
            backToBack: false,
            rawAttackLines: 0,
            attackLines: 0,
            canceledGarbageLines: 0,
            incomingGarbageLines: 0,
            appliedGarbageLines: 0,
            scoreBefore: 0,
            scoreAfter: 0,
            scoreDelta: 0,
            gameOver: false,
        },
        metricsBefore: metrics(),
        metricsAfter: metrics([2, 2]),
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
            heuristicPlacement: piece(),
            heuristicScore: 0,
            userScore: 0,
            betterBy: 0,
            samePlacement: true,
        },
        authoritativeClientSequence: 7,
        authoritativePieceIndex: 3,
        ...overrides,
    };
}

test("human placement projector는 server identity와 nested allowlist만 보존한다", () => {
    const raw = placement({
        nickname: "private nickname",
        token: "private token",
        socketId: "private socket",
        ip: "127.0.0.1",
        cookie: "private cookie",
        userAgent: "private agent",
        freeText: "private free text",
    });
    raw.evaluation.freeText = "nested private";
    raw.selectedPlacement.nickname = "nested nickname";

    const event = projectGameEventLog(raw);

    assert.equal(event.gameId, "server-game");
    assert.equal(event.playerId, "server-player");
    assert.equal(event.pieceIndex, 3);
    assert.equal(event.trustLevel, "client_reported");
    assert.equal(event.occurredAt, "2026-07-23T09:46:40.123Z");
    assert.deepEqual(Object.keys(event.payload).sort(), [
        "activePiece",
        "aiComparison",
        "aiDifficulty",
        "authoritativeClientSequence",
        "boardAfter",
        "boardBefore",
        "evaluation",
        "holdPiece",
        "inputSequence",
        "metricsAfter",
        "metricsBefore",
        "mode",
        "modelType",
        "nextQueue",
        "placementResult",
        "roomId",
        "selectedPlacement",
        "source",
        "tick",
    ]);
    assert.equal(event.payload.inputSequence[0].playerId, undefined);
    assert.equal(event.payload.selectedPlacement.nickname, undefined);
    assert.doesNotMatch(JSON.stringify(event), /private|nickname|socketId|userAgent/);
});

test("placement projector는 rotate_ccw inputSequence를 canonical event로 보존한다", () => {
    const event = projectGameEventLog(placement({
        inputSequence: [{
            action: "rotate_ccw",
            tick: 10,
            pieceIndex: 3,
            sequence: 1,
            createdAt: 1780000000000,
        }],
    }));

    assert.deepEqual(event.payload.inputSequence, [{
        action: "rotate_ccw",
        tick: 10,
        pieceIndex: 3,
        sequence: 1,
        createdAt: 1780000000000,
    }]);
});

test("legacy human placement는 missing createdAt을 canonical null로 보존한다", () => {
    const event = projectGameEventLog(placement({
        schemaVersion: 1,
        source: undefined,
        modelType: undefined,
        createdAt: undefined,
        metricsBefore: undefined,
        metricsAfter: undefined,
        evaluation: undefined,
        aiComparison: undefined,
    }));

    assert.equal(event.schemaVersion, 1);
    assert.equal(event.occurredAt, null);
    assert.equal(event.trustLevel, "client_reported");
});

test("heuristic placement만 server_authoritative로 투영한다", () => {
    const raw = placement({
        source: "heuristic_ai",
        modelType: "heuristic",
        aiDifficulty: "hard",
        aiComparison: undefined,
    });
    delete raw.authoritativeClientSequence;
    delete raw.authoritativePieceIndex;
    const event = projectGameEventLog(raw);

    assert.equal(event.trustLevel, "server_authoritative");
    assert.equal(event.payload.source, "heuristic_ai");
    assert.equal(event.payload.authoritativeClientSequence, null);
});

test("lifecycle v2 projection은 nickname을 빼고 expected count를 보존한다", () => {
    const start = projectGameEventLog({
        eventType: "game_start",
        schemaVersion: 1,
        gameId: "server-game",
        roomId: "ROOM0001",
        mode: "multi",
        aiDifficulty: null,
        aiPolicyRequested: null,
        startedAt: 1784800000000,
        players: [{
            playerId: "player-1",
            nickname: "Private Nickname",
            role: "host",
            playerType: "human",
        }],
    });
    const over = projectGameEventLog({
        eventType: "game_over",
        schemaVersion: 1,
        gameId: "server-game",
        roomId: "ROOM0001",
        mode: "multi",
        aiDifficulty: null,
        aiPolicyRequested: null,
        aiPolicyLastUsed: null,
        aiPolicyFallbackCount: 0,
        aiModelSha256: null,
        endedAt: 1784800001000,
        winnerPlayerId: "player-1",
        loserPlayerId: "player-2",
        reason: "top_out",
        finishType: "normal",
        expectedPlacementEventCounts: [{
            playerId: "player-1",
            playerType: "human",
            expectedPlacementEventCount: 4,
        }],
    });

    assert.equal(start.schemaVersion, 2);
    assert.equal(start.payload.players[0].nickname, undefined);
    assert.equal(over.schemaVersion, 2);
    assert.equal(
        over.payload.expectedPlacementEventCounts[0].expectedPlacementEventCount,
        4,
    );
    assert.deepEqual(over.payload.receiptPolicy, {
        ttlMilliseconds: 30_000,
        maxPerPlayer: 128,
    });
});

test("legacy lifecycle game_over는 v1 의미와 privacy projection을 보존한다", () => {
    const over = projectGameEventLog({
        eventType: "game_over",
        schemaVersion: 1,
        gameId: "legacy-game",
        roomId: "LEGACY01",
        mode: "multi",
        endedAt: 1784800001000,
        winnerPlayerId: "player-1",
        loserPlayerId: "player-2",
        reason: "top_out",
        finishType: "normal",
        nickname: "Private Nickname",
    });

    assert.equal(over.schemaVersion, 1);
    assert.equal(over.payload.expectedPlacementEventCounts, undefined);
    assert.equal(over.payload.receiptPolicy, undefined);
    assert.doesNotMatch(JSON.stringify(over), /Private Nickname|nickname/);
});

test("허용 field 안의 자유형 gameplay 문자열도 거부한다", () => {
    assert.throws(
        () => projectGameEventLog(placement({
            boardAfter: [["nickname", "nickname"], ["nickname", "nickname"]],
        })),
        { message: "GAME_EVENT_PROJECTION_INVALID" },
    );
    assert.throws(
        () => projectGameEventLog(placement({ mode: "user supplied text" })),
        { message: "GAME_EVENT_PROJECTION_INVALID" },
    );
});
