const test = require("node:test");
const assert = require("node:assert/strict");

const { loadGameCore } = require("../src/server/services/gameCoreLoader.js");
const {
    createMatch,
    getAuthoritativePlayerSnapshot,
    getMatchState,
    resetMatches,
} = require("../src/server/services/matchService.js");
const { createPveAiPlayerService } = require(
    "../src/server/services/pveAiPlayerService.js"
);
const { validatePlacementDecisionLog } = require(
    "../src/server/validators/gameLogValidator.js"
);

function createPveMatch(roomId) {
    return createMatch({
        roomId,
        mode: "pve",
        status: "playing",
        players: [
            { playerId: "human", playerType: "human" },
            { playerId: "ai", playerType: "heuristic_ai" },
        ],
    }).match;
}

test("AI turn은 piece마다 placement를 적용하고 authoritative log를 저장한다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    const match = createPveMatch("PVE-AI-1");
    const aiPlayer = match.players.find(player => player.playerId === "ai");
    const aiStateBefore = structuredClone(aiPlayer.authoritativeState);
    const humanBefore = structuredClone(
        match.players.find(player => player.playerId === "human").authoritativeState,
    );
    const pieceIndexBefore = aiPlayer.authoritativeState.pieceIndex;
    const savedLogs = [];
    const service = createPveAiPlayerService({
        savePlacementDecisionLog(log) {
            savedLogs.push(log);
            return { ok: true, log, reason: null };
        },
    });

    const result = await service.processAiTurn("PVE-AI-1", "ai", gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    assert.equal(aiPlayer.authoritativeState.pieceIndex, pieceIndexBefore + 1);
    assert.ok(aiPlayer.authoritativeState.board.flat().some(cell => cell !== null));
    assert.deepEqual(
        match.players.find(player => player.playerId === "human").authoritativeState,
        humanBefore,
    );
    assert.equal(savedLogs.length, 1);
    assert.equal(savedLogs[0].schemaVersion, 2);
    assert.equal(savedLogs[0].source, "heuristic_ai");
    assert.equal(savedLogs[0].modelType, "heuristic");
    assert.equal(savedLogs[0].pieceIndex, pieceIndexBefore);
    assert.equal(savedLogs[0].evaluation.candidateCount > 0, true);
    assert.equal(result.decision.plannedActions.at(-1), "hard_drop");
    assert.deepEqual(savedLogs[0].inputSequence, []);
    assert.ok(savedLogs[0].metricsBefore);
    assert.ok(savedLogs[0].metricsAfter);
    assert.equal(savedLogs[0].aiComparison, undefined);
    const { getBoardMetrics } = await import(
        "../src/client/game/core/boardMetrics.js"
    );
    assert.deepEqual(savedLogs[0].metricsBefore, getBoardMetrics(aiStateBefore.board));
    assert.deepEqual(savedLogs[0].metricsAfter, getBoardMetrics(savedLogs[0].boardAfter));
    assert.equal(validatePlacementDecisionLog(savedLogs[0]).ok, true);
});

test("AI 후보가 없으면 AI state만 gameOver로 처리한다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    const match = createPveMatch("PVE-AI-2");
    const aiPlayer = match.players.find(player => player.playerId === "ai");
    const humanPlayer = match.players.find(player => player.playerId === "human");
    aiPlayer.authoritativeState.board = Array.from(
        { length: 20 },
        () => Array(10).fill("garbage"),
    );

    const service = createPveAiPlayerService({
        savePlacementDecisionLog() {
            throw new Error("log should not be written");
        },
    });
    const result = await service.processAiTurn("PVE-AI-2", "ai", gameCore);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "NO_LEGAL_PLACEMENT");
    assert.equal(result.gameOver, true);
    assert.equal(aiPlayer.authoritativeState.phase, "gameOver");
    assert.equal(aiPlayer.authoritativeState.gameOver, true);
    assert.equal(humanPlayer.authoritativeState.phase, "playing");
});

test("AI placement log 저장 실패는 성공한 turn과 match state를 되돌리지 않는다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    createPveMatch("PVE-AI-3");
    const service = createPveAiPlayerService({
        async savePlacementDecisionLog() {
            throw new Error("disk full");
        },
    });

    const result = await service.processAiTurn("PVE-AI-3", "ai", gameCore);
    const aiState = getAuthoritativePlayerSnapshot("PVE-AI-3", "ai").snapshot;

    assert.equal(result.ok, true);
    assert.equal(result.logResult.ok, false);
    assert.equal(result.logResult.reason, "LOG_WRITE_FAILED");
    assert.equal(aiState.phase, "playing");
    assert.equal(aiState.pieceIndex, 2);
});

test("AI direct placement는 기존 authoritative line clear와 score 규칙을 사용한다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    const match = createPveMatch("PVE-AI-5");
    const aiPlayer = match.players.find(player => player.playerId === "ai");
    aiPlayer.authoritativeState.board[19] = Array(10).fill("stack");
    aiPlayer.authoritativeState.board[19][3] = null;
    aiPlayer.authoritativeState.board[19][4] = null;
    aiPlayer.authoritativeState.activePiece = {
        pieceType: "square",
        rotation: 0,
        row: -1,
        col: 3,
    };
    aiPlayer.authoritativeState.pendingPiece = {
        ...aiPlayer.authoritativeState.activePiece,
    };
    const service = createPveAiPlayerService({
        savePlacementDecisionLog(log) {
            return { ok: true, log, reason: null };
        },
    });

    const result = await service.processAiTurn("PVE-AI-5", "ai", gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.placementResult.linesCleared, 1);
    assert.equal(aiPlayer.authoritativeState.lines, 1);
    assert.equal(aiPlayer.authoritativeState.score, 48);
    assert.equal(result.log.placementResult.scoreAfter, 48);
});

test("AI queue가 부족하면 서버가 bag을 보충하고 다음 piece를 spawn한다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    const match = createPveMatch("PVE-AI-6");
    const aiPlayer = match.players.find(player => player.playerId === "ai");
    aiPlayer.authoritativeState.pieceQueue = [];
    const bagCountBefore = aiPlayer.bagChunks.length;
    const service = createPveAiPlayerService({
        savePlacementDecisionLog(log) {
            return { ok: true, log, reason: null };
        },
    });

    const result = await service.processAiTurn("PVE-AI-6", "ai", gameCore);

    assert.equal(result.ok, true);
    assert.equal(aiPlayer.bagChunks.length, bagCountBefore + 1);
    assert.ok(aiPlayer.authoritativeState.activePiece.pieceType);
    assert.ok(aiPlayer.authoritativeState.pieceQueue.length > 0);
});

test("AI player는 human input log를 기록할 수 없다", () => {
    resetMatches();
    createPveMatch("PVE-AI-4");
    const { recordInput } = require("../src/server/services/matchService.js");

    const result = recordInput("PVE-AI-4", "ai", {
        action: "hard_drop",
        tick: 1,
        pieceIndex: 1,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "PLAYER_INPUT_NOT_ALLOWED");
    assert.deepEqual(getMatchState("PVE-AI-4").match.players[1].inputLog, []);
});
