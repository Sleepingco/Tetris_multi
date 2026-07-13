const test = require("node:test");
const assert = require("node:assert/strict");

const { createAuthoritativeTickerService } = require(
    "../src/server/services/authoritativeTickerService.js"
);
const { createPveAiPlayerService } = require(
    "../src/server/services/pveAiPlayerService.js"
);
const {
    createMatch,
    getMatchState,
    resetMatches,
} = require("../src/server/services/matchService.js");
const { loadGameCore } = require("../src/server/services/gameCoreLoader.js");
const {
    createRoom,
    getRoomState,
    startGame,
} = require("../src/server/services/roomService.js");

test("PVE ticker는 human gravity와 AI action cadence를 분리해 순서대로 snapshot을 전송한다", async () => {
    resetMatches();
    createMatch({
        roomId: "PVE-TICKER-1",
        mode: "pve",
        status: "playing",
        players: [
            { playerId: "human", playerType: "human" },
            { playerId: "ai", playerType: "heuristic_ai" },
        ],
    });
    const createdMatch = getMatchState("PVE-TICKER-1").match;
    const initialAi = createdMatch.players.find(player => player.playerId === "ai");
    initialAi.authoritativeState.activePiece = {
        pieceType: "square",
        rotation: 0,
        row: -1,
        col: 3,
    };
    initialAi.authoritativeState.pendingPiece = {
        ...initialAi.authoritativeState.activePiece,
    };
    const savedLogs = [];
    const aiService = createPveAiPlayerService({
        savePlacementDecisionLog(log) {
            savedLogs.push(log);
            return { ok: true, log, reason: null };
        },
    });
    const emitted = [];
    const socketServer = {
        to(roomId) {
            return {
                emit(eventName, payload) {
                    emitted.push({ roomId, eventName, payload });
                },
            };
        },
    };
    const ticker = createAuthoritativeTickerService({
        pveAiPlayerService: aiService,
        setIntervalFn() {
            return { unref() {} };
        },
        clearIntervalFn() {},
    });
    ticker.startRoomTicker("PVE-TICKER-1", socketServer);

    await ticker.tickRoom("PVE-TICKER-1", socketServer, 100);

    assert.equal(initialAi.aiPlan.remainingActions.length, 4);
    assert.equal(initialAi.authoritativeState.pieceIndex, 1);
    assert.equal(emitted.length, 0);

    await ticker.tickRoom("PVE-TICKER-1", socketServer, 100);
    await ticker.tickRoom("PVE-TICKER-1", socketServer, 100);
    await ticker.tickRoom("PVE-TICKER-1", socketServer, 100);

    assert.equal(initialAi.authoritativeState.pieceIndex, 1);
    assert.equal(initialAi.authoritativeState.activePiece.col, 0);
    assert.equal(initialAi.authoritativeState.board.flat().every(cell => cell === null), true);

    await ticker.tickRoom("PVE-TICKER-1", socketServer, 100);

    const match = getMatchState("PVE-TICKER-1").match;
    const human = match.players.find(player => player.playerId === "human");
    const ai = match.players.find(player => player.playerId === "ai");
    const aiSnapshotEvents = emitted.filter(event => {
        return event.eventName === "game:authoritative:snapshot" &&
            event.payload.playerId === "ai";
    });

    assert.equal(human.authoritativeState.activePiece.row, 0);
    assert.equal(ai.authoritativeState.pieceIndex, 2);
    assert.ok(ai.authoritativeState.board.flat().some(cell => cell !== null));
    assert.equal(aiSnapshotEvents.length, 4);
    assert.deepEqual(
        aiSnapshotEvents.slice(0, 3).map(event => event.payload.snapshot.activePiece.col),
        [2, 1, 0],
    );
    assert.equal(aiSnapshotEvents.at(-1).payload.snapshot.pieceIndex, 2);
    assert.equal(aiSnapshotEvents.at(-1).payload.snapshot.gameOver, false);
    assert.equal(Object.hasOwn(aiSnapshotEvents.at(-1).payload.snapshot, "evaluation"), false);
    assert.equal(savedLogs.length, 1);
    assert.deepEqual(
        savedLogs[0].inputSequence.map(input => input.action),
        ["move_left", "move_left", "move_left", "hard_drop"],
    );

    ticker.stopRoomTicker("PVE-TICKER-1");
});

test("PVE ticker는 AI 후보가 없으면 human 승리로 match를 종료한다", async () => {
    resetMatches();
    const human = {
        playerId: "pve-finish-human",
        nickname: "Human",
        socketId: "pve-finish-socket",
    };
    const roomResult = createRoom(human, {
        mode: "pve",
        generateRoomId: () => "PVETICK2",
    });
    const roomId = roomResult.room.roomId;
    const aiRoomPlayer = roomResult.room.players.find(player => {
        return player.playerType === "heuristic_ai";
    });
    startGame(roomId, human.playerId, human.socketId);
    const match = createMatch(getRoomState(roomId)).match;
    const aiPlayer = match.players.find(player => player.playerId === aiRoomPlayer.playerId);
    aiPlayer.authoritativeState.board = Array.from(
        { length: 20 },
        () => Array(10).fill("garbage"),
    );

    const emitted = [];
    const socketServer = {
        to(targetRoomId) {
            return {
                emit(eventName, payload) {
                    emitted.push({ roomId: targetRoomId, eventName, payload });
                },
            };
        },
    };
    const ticker = createAuthoritativeTickerService({
        setIntervalFn() {
            return { unref() {} };
        },
        clearIntervalFn() {},
        saveGameEventLog() {
            return { ok: true };
        },
    });
    ticker.startRoomTicker(roomId, socketServer);

    await ticker.tickRoom(roomId, socketServer, 500);

    const finishEvent = emitted.find(event => event.eventName === "match:finish");
    assert.ok(finishEvent);
    assert.equal(finishEvent.payload.winnerPlayerId, human.playerId);
    assert.equal(finishEvent.payload.loserPlayerId, aiRoomPlayer.playerId);
    assert.equal(finishEvent.payload.reason, "ai_no_legal_placement");
    assert.equal(getRoomState(roomId).status, "finished");
    assert.equal(getMatchState(roomId).ok, false);
});

test("AI executor는 고정 fixture의 authoritative input 결과를 유지한다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    const match = createMatch({
        roomId: "PVE-EXECUTOR",
        mode: "pve",
        status: "playing",
        players: [
            { playerId: "human", playerType: "human" },
            { playerId: "ai", playerType: "heuristic_ai" },
        ],
    }).match;
    const executorPlayer = match.players.find(player => player.playerId === "ai");
    const fixtureState = {
        ...structuredClone(executorPlayer.authoritativeState),
        board: Array.from({ length: 20 }, () => Array(10).fill(null)),
        activePiece: { pieceType: "square", rotation: 0, row: -1, col: 3 },
        pendingPiece: { pieceType: "square", rotation: 0, row: -1, col: 3 },
        pieceQueue: ["tree", "bar", "zee", "ess", "eleft", "eright", "square", "tree"],
        pieceIndex: 1,
    };
    executorPlayer.authoritativeState = structuredClone(fixtureState);
    const savedLogs = [];
    const service = createPveAiPlayerService({
        savePlacementDecisionLog(log) {
            savedLogs.push(log);
            return { ok: true, log, reason: null };
        },
    });

    const planResult = await service.processAiStep("PVE-EXECUTOR", "ai", gameCore);
    let executorResult;
    const actions = [];
    for (let step = 0; step < 20; step += 1) {
        executorResult = await service.processAiStep("PVE-EXECUTOR", "ai", gameCore);
        actions.push(executorResult.action);
        if (executorResult.placementResult) break;
    }

    assert.equal(planResult.reason, "AI_PLAN_CREATED");
    assert.equal(executorResult.ok, true);
    assert.deepEqual(actions, ["move_left", "move_left", "move_left", "hard_drop"]);
    assert.deepEqual(executorResult.placementResult.lockedPiece, {
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 0,
    });
    assert.equal(executorPlayer.authoritativeState.board[18][0], "square");
    assert.equal(executorPlayer.authoritativeState.board[18][1], "square");
    assert.equal(executorPlayer.authoritativeState.board[19][0], "square");
    assert.equal(executorPlayer.authoritativeState.board[19][1], "square");
    assert.equal(executorPlayer.authoritativeState.score, 38);
    assert.equal(executorPlayer.authoritativeState.lines, 0);
    assert.equal(executorPlayer.authoritativeState.pieceIndex, 2);
    assert.deepEqual(executorPlayer.authoritativeState.activePiece, {
        pieceType: "tree",
        rotation: 0,
        row: -1,
        col: 3,
    });
    assert.equal(executorPlayer.aiPlan, null);
    assert.equal(savedLogs.length, 1);
    assert.deepEqual(
        savedLogs[0].inputSequence.map(input => input.action),
        ["move_left", "move_left", "move_left", "hard_drop"],
    );
});
