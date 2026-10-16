/**
 * authoritative ticker가 human gravity와 PVE AI action을 서로 다른 cadence로 조율하는 통합 테스트다.
 *
 * 실제 room/match와 가짜 socket emitter를 준비해 tick을 실행하고 snapshot 순서와 종료 결과를 검증한다.
 * AI action 하나마다 확정 state를 emit하되 human gravity 진행과 섞이지 않고, AI game over는 match 승패로
 * 한 번만 연결되어야 한다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { createAuthoritativeTickerService } = require(
    "../dist/server/server/services/authoritativeTickerService.js"
);
const { createPveAiPlayerService } = require(
    "../dist/server/server/services/pveAiPlayerService.js"
);
const {
    createMatch,
    getMatchState,
    resetMatches,
} = require("../dist/server/server/services/matchService.js");
const { loadGameCore } = require("../dist/server/server/services/gameCoreLoader.js");
const {
    clearRoomsForTest,
    createRoom,
    getRoomState,
    startGame,
} = require("../dist/server/server/services/roomService.js");

test.beforeEach(clearRoomsForTest);

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
    assert.deepEqual(emitted, [{
        roomId: "PVE-TICKER-1",
        eventName: "pve:ai-policy",
        payload: {
            roomId: "PVE-TICKER-1",
            playerId: "ai",
            policyRequested: "heuristic",
            policyUsed: "heuristic",
            fallbackReason: null,
            modelSha256: null,
            fallbackCount: 0,
            lastFallbackReason: null,
        },
    }]);
    assert.deepEqual(
        getMatchState("PVE-TICKER-1").match.aiPolicyRuntime,
        emitted[0].payload,
    );

    await ticker.tickRoom("PVE-TICKER-1", socketServer, 100);
    await ticker.tickRoom("PVE-TICKER-1", socketServer, 100);
    await ticker.tickRoom("PVE-TICKER-1", socketServer, 100);

    assert.equal(initialAi.authoritativeState.pieceIndex, 1);
    assert.equal(initialAi.authoritativeState.activePiece.col, 0);
    assert.equal(initialAi.authoritativeState.board.flat().every(cell => cell === null), true);

    await ticker.tickRoom("PVE-TICKER-1", socketServer, 100);
    await ticker.tickRoom("PVE-TICKER-1", socketServer, 100);
    await ticker.tickRoom("PVE-TICKER-1", socketServer, 100);
    await ticker.tickRoom("PVE-TICKER-1", socketServer, 100);
    await ticker.tickRoom("PVE-TICKER-1", socketServer, 100);

    const softDropSnapshots = emitted.filter(event => {
        return event.eventName === "game:authoritative:snapshot" &&
            event.payload.playerId === "ai" &&
            event.payload.snapshot.pieceIndex === 1 &&
            event.payload.snapshot.activePiece.row >= 0;
    });
    assert.deepEqual(
        softDropSnapshots.map(event => event.payload.snapshot.activePiece.row),
        [0, 1, 2, 3, 4],
    );
    assert.equal(initialAi.authoritativeState.board.flat().every(cell => cell === null), true);
    assert.equal(initialAi.authoritativeState.pieceIndex, 1);

    await ticker.tickRoom("PVE-TICKER-1", socketServer, 100);

    const match = getMatchState("PVE-TICKER-1").match;
    const human = match.players.find(player => player.playerId === "human");
    const ai = match.players.find(player => player.playerId === "ai");
    const aiSnapshotEvents = emitted.filter(event => {
        return event.eventName === "game:authoritative:snapshot" &&
            event.payload.playerId === "ai";
    });

    assert.equal(human.authoritativeState.activePiece.row, 1);
    assert.equal(ai.authoritativeState.pieceIndex, 2);
    assert.ok(ai.authoritativeState.board.flat().some(cell => cell !== null));
    assert.equal(aiSnapshotEvents.length, 9);
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
        [
            "move_left",
            "move_left",
            "move_left",
            "soft_drop",
            "soft_drop",
            "soft_drop",
            "soft_drop",
            "soft_drop",
            "hard_drop",
        ],
    );

    ticker.stopRoomTicker("PVE-TICKER-1");
});

test("PVE ticker는 experimental policy의 실제 fallback 상태를 전송한다", async () => {
    resetMatches();
    createMatch({
        roomId: "PVE-TICKER-POLICY",
        mode: "pve",
        aiPolicy: "placement_v4",
        status: "playing",
        players: [
            { playerId: "human", playerType: "human" },
            { playerId: "ai", playerType: "heuristic_ai" },
        ],
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
        loadGameCore: async () => ({}),
        pveAiPlayerService: {
            async processAiStep() {
                return {
                    ok: true,
                    skipped: true,
                    reason: "AI_PLAN_CREATED",
                    decision: {
                        policyRequested: "placement_v4",
                        policyUsed: "heuristic",
                        fallbackReason: "MODEL_NOT_FOUND",
                    },
                };
            },
        },
        setIntervalFn() {
            return { unref() {} };
        },
        clearIntervalFn() {},
    });
    ticker.startRoomTicker("PVE-TICKER-POLICY", socketServer);

    await ticker.tickRoom("PVE-TICKER-POLICY", socketServer, 100);

    assert.deepEqual(emitted, [{
        roomId: "PVE-TICKER-POLICY",
        eventName: "pve:ai-policy",
        payload: {
            roomId: "PVE-TICKER-POLICY",
            playerId: "ai",
            policyRequested: "placement_v4",
            policyUsed: "heuristic",
            fallbackReason: "MODEL_NOT_FOUND",
            modelSha256: null,
            fallbackCount: 1,
            lastFallbackReason: "MODEL_NOT_FOUND",
        },
    }]);
    assert.deepEqual(
        getMatchState("PVE-TICKER-POLICY").match.aiPolicyRuntime,
        emitted[0].payload,
    );
    ticker.stopRoomTicker("PVE-TICKER-POLICY");
});

test("hard PVE ticker는 terminal soft_drop 없이 action별 snapshot 후 hard_drop한다", async () => {
    resetMatches();
    const match = createMatch({
        roomId: "PVE-TICKER-HARD",
        mode: "pve",
        aiDifficulty: "hard",
        status: "playing",
        players: [
            { playerId: "human", playerType: "human" },
            { playerId: "ai", playerType: "heuristic_ai" },
        ],
    }).match;
    const aiPlayer = match.players.find(player => player.playerId === "ai");
    aiPlayer.authoritativeState.activePiece = {
        pieceType: "square",
        rotation: 0,
        row: -1,
        col: 3,
    };
    aiPlayer.authoritativeState.pendingPiece = {
        ...aiPlayer.authoritativeState.activePiece,
    };
    const savedLogs = [];
    const emitted = [];
    const ticker = createAuthoritativeTickerService({
        pveAiPlayerService: createPveAiPlayerService({
            savePlacementDecisionLog(log) {
                savedLogs.push(log);
                return { ok: true, log, reason: null };
            },
        }),
        setIntervalFn() {
            return { unref() {} };
        },
        clearIntervalFn() {},
    });
    const socketServer = {
        to(roomId) {
            return {
                emit(eventName, payload) {
                    emitted.push({ roomId, eventName, payload });
                },
            };
        },
    };
    ticker.startRoomTicker("PVE-TICKER-HARD", socketServer);

    for (let callback = 0; callback < 5; callback += 1) {
        await ticker.tickRoom("PVE-TICKER-HARD", socketServer, 100);
    }

    const aiSnapshots = emitted.filter(event => {
        return event.eventName === "game:authoritative:snapshot" &&
            event.payload.playerId === "ai";
    });
    assert.equal(aiSnapshots.length, 4);
    assert.deepEqual(
        aiSnapshots.slice(0, 3).map(event => event.payload.snapshot.activePiece.col),
        [2, 1, 0],
    );
    assert.equal(aiSnapshots.at(-1).payload.snapshot.pieceIndex, 2);
    assert.equal(aiPlayer.authoritativeState.score, 38);
    assert.equal(savedLogs.length, 1);
    assert.equal(savedLogs[0].aiDifficulty, "hard");
    assert.deepEqual(
        savedLogs[0].inputSequence.map(input => input.action),
        ["move_left", "move_left", "move_left", "hard_drop"],
    );

    ticker.stopRoomTicker("PVE-TICKER-HARD");
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
    assert.deepEqual(actions, [
        "move_left",
        "move_left",
        "move_left",
        "soft_drop",
        "soft_drop",
        "soft_drop",
        "soft_drop",
        "soft_drop",
        "hard_drop",
    ]);
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
    assert.equal(executorPlayer.authoritativeState.score, 28);
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
        [
            "move_left",
            "move_left",
            "move_left",
            "soft_drop",
            "soft_drop",
            "soft_drop",
            "soft_drop",
            "soft_drop",
            "hard_drop",
        ],
    );
});

test("실제 PVE AI의 줄 삭제 없는 garbage 적용은 독립 combatEffect로 전달된다", async () => {
    resetMatches();
    const roomId = "PVE-COMBAT";
    createMatch({ roomId, mode: "pve", status: "playing", players: [
        { playerId: "human", playerType: "human" },
        { playerId: "ai", playerType: "heuristic_ai" },
    ] });
    const match = getMatchState(roomId).match;
    const ai = match.players.find(player => player.playerId === "ai");
    ai.authoritativeState.pendingGarbageQueue = [{ lines: 3, holeCol: 5 }];
    const events = [];
    const socketServer = { to() { return { emit(eventName, payload) { events.push({ eventName, payload }); } }; } };
    const ticker = createAuthoritativeTickerService({
        pveAiPlayerService: createPveAiPlayerService({ savePlacementDecisionLog: log => ({ ok: true, log, reason: null }) }),
        setIntervalFn: () => ({ unref() {} }), clearIntervalFn() {},
    });
    ticker.startRoomTicker(roomId, socketServer);
    try {
        for (let i = 0; i < 80 && ai.authoritativeState.pieceIndex === 1; i++) {
            await ticker.tickRoom(roomId, socketServer, 100);
        }
        const event = events.find(event => event.payload.combatEffect?.appliedLines > 0);
        assert.ok(event);
        assert.equal(event.payload.playerId, "ai");
        assert.equal(event.payload.combatEffect.gameId, match.gameId);
        assert.equal(event.payload.combatEffect.linesCleared, 0);
        assert.equal(event.payload.combatEffect.appliedLines, 3);
        assert.equal(event.payload.combatEffect.sentLines, 0);
        assert.equal(event.payload.presentationEffect, undefined);
        assert.equal(ai.authoritativeState.pendingGarbageQueue.length, 0);
    } finally {
        ticker.stopRoomTicker(roomId);
    }
});
