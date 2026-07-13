const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createAuthoritativeTickerService,
} = require("../src/server/services/authoritativeTickerService.js");
const {
    finishAuthoritativeMatch,
} = require("../src/server/services/authoritativeMatchFinish.js");

function createFakeScheduler() {
    let nextId = 1;
    const intervals = new Map();
    const clearedIds = [];

    return {
        intervals,
        clearedIds,
        setInterval(callback, delayMs) {
            const id = nextId;
            nextId += 1;
            intervals.set(id, { callback, delayMs });
            return id;
        },
        clearInterval(id) {
            clearedIds.push(id);
            intervals.delete(id);
        },
    };
}

function createFakeSocketServer() {
    return {
        roomEvents: [],
        to(roomId) {
            return {
                emit: (eventName, payload) => {
                    this.roomEvents.push({ roomId, eventName, payload });
                },
            };
        },
    };
}

async function runTickerCallbacks(scheduler, count) {
    for (let index = 0; index < count; index += 1) {
        const interval = [...scheduler.intervals.values()][0];
        await interval.callback();
    }
}

test("startRoomTicker는 room마다 100ms ticker를 하나만 시작한다", () => {
    const scheduler = createFakeScheduler();
    const tickerService = createAuthoritativeTickerService({
        setIntervalFn: scheduler.setInterval,
        clearIntervalFn: scheduler.clearInterval,
    });
    const socketServer = createFakeSocketServer();

    const firstResult = tickerService.startRoomTicker("room-1", socketServer);
    const secondResult = tickerService.startRoomTicker("room-1", socketServer);

    assert.equal(firstResult.ok, true);
    assert.equal(firstResult.started, true);
    assert.equal(secondResult.ok, true);
    assert.equal(secondResult.started, false);
    assert.equal(scheduler.intervals.size, 1);
    assert.equal([...scheduler.intervals.values()][0].delayMs, 100);
    assert.equal(tickerService.hasRoomTicker("room-1"), true);
});

test("ticker callback은 500ms 누적 후 player별 gravity step과 authoritative full snapshot을 처리한다", async () => {
    const scheduler = createFakeScheduler();
    const socketServer = createFakeSocketServer();
    const calls = [];
    const tickerService = createAuthoritativeTickerService({
        setIntervalFn: scheduler.setInterval,
        clearIntervalFn: scheduler.clearInterval,
        loadGameCore: async () => ({ core: true }),
        getMatchState: () => ({
            ok: true,
            match: {
                roomId: "room-1",
                players: [
                    { playerId: "p1" },
                    { playerId: "p2" },
                ],
            },
        }),
        applyGravityStepToMatchPlayerState(roomId, playerId, gameCore) {
            calls.push({ roomId, playerId, gameCore });
            return {
                ok: true,
                gravityResult: { kind: "move" },
                placementResult: null,
            };
        },
        getAuthoritativePlayerSnapshotDto(roomId, playerId) {
            return {
                ok: true,
                snapshot: {
                    board: [[playerId]],
                    activePiece: null,
                    pieceQueue: [],
                    holdPieceType: null,
                    holdUsedThisDrop: false,
                    score: 0,
                    lines: 0,
                    phase: "playing",
                    combo: -1,
                    backToBack: false,
                    tick: 1,
                    pieceIndex: 1,
                },
            };
        },
    });

    tickerService.startRoomTicker("room-1", socketServer);
    await runTickerCallbacks(scheduler, 4);

    assert.deepEqual(calls, []);
    assert.deepEqual(socketServer.roomEvents, []);

    await runTickerCallbacks(scheduler, 1);

    assert.deepEqual(calls.map(call => call.playerId), ["p1", "p2"]);
    assert.deepEqual(socketServer.roomEvents.map(event => ({
        roomId: event.roomId,
        eventName: event.eventName,
        playerId: event.payload.playerId,
        snapshot: event.payload.snapshot,
    })), [
        {
            roomId: "room-1",
            eventName: "game:authoritative:snapshot",
            playerId: "p1",
            snapshot: {
                board: [["p1"]],
                activePiece: null,
                pieceQueue: [],
                holdPieceType: null,
                holdUsedThisDrop: false,
                score: 0,
                lines: 0,
                phase: "playing",
                combo: -1,
                backToBack: false,
                tick: 1,
                pieceIndex: 1,
            },
        },
        {
            roomId: "room-1",
            eventName: "game:authoritative:snapshot",
            playerId: "p2",
            snapshot: {
                board: [["p2"]],
                activePiece: null,
                pieceQueue: [],
                holdPieceType: null,
                holdUsedThisDrop: false,
                score: 0,
                lines: 0,
                phase: "playing",
                combo: -1,
                backToBack: false,
                tick: 1,
                pieceIndex: 1,
            },
        },
    ]);

    await runTickerCallbacks(scheduler, 5);

    assert.deepEqual(calls.map(call => call.playerId), ["p1", "p2", "p1", "p2"]);
    assert.equal(socketServer.roomEvents.length, 4);
});

test("ticker catch-up은 elapsedMs가 커도 callback당 gravity step을 최대 1회만 처리한다", async () => {
    const scheduler = createFakeScheduler();
    const socketServer = createFakeSocketServer();
    const calls = [];
    const tickerService = createAuthoritativeTickerService({
        setIntervalFn: scheduler.setInterval,
        clearIntervalFn: scheduler.clearInterval,
        loadGameCore: async () => ({ core: true }),
        getMatchState: () => ({
            ok: true,
            match: {
                roomId: "room-1",
                players: [
                    { playerId: "p1" },
                    { playerId: "p2" },
                ],
            },
        }),
        applyGravityStepToMatchPlayerState(roomId, playerId) {
            calls.push({ roomId, playerId });
            return {
                ok: true,
                gravityResult: { kind: "move" },
                placementResult: null,
            };
        },
        getAuthoritativePlayerSnapshotDto(roomId, playerId) {
            return {
                ok: true,
                snapshot: {
                    board: [[playerId]],
                    activePiece: null,
                    pieceQueue: [],
                    holdPieceType: null,
                    holdUsedThisDrop: false,
                    score: 0,
                    lines: 0,
                    phase: "playing",
                    combo: -1,
                    backToBack: false,
                    tick: 1,
                    pieceIndex: 1,
                    pendingGarbageLines: 0,
                },
            };
        },
    });

    tickerService.startRoomTicker("room-1", socketServer);
    await tickerService.tickRoom("room-1", socketServer, 1500);

    assert.deepEqual(calls.map(call => call.playerId), ["p1", "p2"]);
    assert.equal(socketServer.roomEvents.length, 2);

    await tickerService.tickRoom("room-1", socketServer, 0);

    assert.deepEqual(calls.map(call => call.playerId), ["p1", "p2", "p1", "p2"]);
    assert.equal(socketServer.roomEvents.length, 4);
});

test("AI action cadence는 human gravity와 분리되고 성공 action마다 snapshot을 보낸다", async () => {
    const scheduler = createFakeScheduler();
    const socketServer = createFakeSocketServer();
    const gravityCalls = [];
    const aiCalls = [];
    let lastAiAction = null;
    const aiResults = [
        { ok: true, skipped: true, reason: "AI_PLAN_CREATED" },
        { ok: true, skipped: false, stateChanged: true, action: "move_left" },
        { ok: true, skipped: false, stateChanged: true, action: "rotate" },
        {
            ok: true,
            skipped: false,
            stateChanged: true,
            action: "hard_drop",
            placementResult: { attackLines: 0, gameOver: false },
        },
        { ok: true, skipped: true, reason: "AI_PLAN_CREATED" },
    ];
    const tickerService = createAuthoritativeTickerService({
        setIntervalFn: scheduler.setInterval,
        clearIntervalFn: scheduler.clearInterval,
        loadGameCore: async () => ({ core: true }),
        getMatchState: () => ({
            ok: true,
            match: {
                roomId: "room-ai-cadence",
                players: [
                    { playerId: "human", playerType: "human" },
                    { playerId: "ai", playerType: "heuristic_ai" },
                ],
            },
        }),
        applyGravityStepToMatchPlayerState(roomId, playerId) {
            gravityCalls.push({ roomId, playerId });
            return { ok: true, gravityResult: { kind: "move" } };
        },
        pveAiPlayerService: {
            async processAiStep(roomId, playerId) {
                const result = aiResults[aiCalls.length];
                aiCalls.push({ roomId, playerId });
                lastAiAction = result.action ?? lastAiAction;
                return result;
            },
        },
        getAuthoritativePlayerSnapshotDto(roomId, playerId) {
            return {
                ok: true,
                snapshot: {
                    board: [[playerId]],
                    activePiece: playerId === "ai" ? { action: lastAiAction } : null,
                    pieceQueue: [],
                    holdPieceType: null,
                    holdUsedThisDrop: false,
                    score: 0,
                    lines: 0,
                    phase: "playing",
                    combo: -1,
                    backToBack: false,
                    tick: aiCalls.length,
                    pieceIndex: 1,
                    pendingGarbageLines: 0,
                },
            };
        },
    });

    tickerService.startRoomTicker("room-ai-cadence", socketServer);
    await runTickerCallbacks(scheduler, 4);

    assert.equal(aiCalls.length, 4);
    assert.equal(gravityCalls.length, 0);
    const aiSnapshots = socketServer.roomEvents.filter(event => {
        return event.payload.playerId === "ai";
    });
    assert.deepEqual(
        aiSnapshots.map(event => event.payload.snapshot.activePiece.action),
        ["move_left", "rotate", "hard_drop"],
    );

    await runTickerCallbacks(scheduler, 1);

    assert.equal(aiCalls.length, 5);
    assert.deepEqual(gravityCalls, [
        { roomId: "room-ai-cadence", playerId: "human" },
    ]);
});

test("AI catch-up은 elapsedMs가 커도 callback당 action을 최대 1개만 실행한다", async () => {
    const scheduler = createFakeScheduler();
    const socketServer = createFakeSocketServer();
    let aiCallCount = 0;
    const tickerService = createAuthoritativeTickerService({
        setIntervalFn: scheduler.setInterval,
        clearIntervalFn: scheduler.clearInterval,
        loadGameCore: async () => ({ core: true }),
        getMatchState: () => ({
            ok: true,
            match: {
                roomId: "room-ai-catch-up",
                players: [{ playerId: "ai", playerType: "heuristic_ai" }],
            },
        }),
        pveAiPlayerService: {
            async processAiStep() {
                aiCallCount += 1;
                return {
                    ok: true,
                    skipped: false,
                    stateChanged: true,
                    action: "move_left",
                };
            },
        },
        getAuthoritativePlayerSnapshotDto: () => ({
            ok: true,
            snapshot: { phase: "playing", pieceIndex: 1 },
        }),
    });

    tickerService.startRoomTicker("room-ai-catch-up", socketServer);
    await tickerService.tickRoom("room-ai-catch-up", socketServer, 1500);

    assert.equal(aiCallCount, 1);
    assert.equal(socketServer.roomEvents.length, 1);

    await tickerService.tickRoom("room-ai-catch-up", socketServer, 0);

    assert.equal(aiCallCount, 2);
    assert.equal(socketServer.roomEvents.length, 2);
});

test("isProcessing 중복 callback은 같은 AI action을 두 번 실행하지 않는다", async () => {
    const scheduler = createFakeScheduler();
    const socketServer = createFakeSocketServer();
    let aiCallCount = 0;
    let resolveStep;
    const stepPromise = new Promise(resolve => {
        resolveStep = resolve;
    });
    const tickerService = createAuthoritativeTickerService({
        setIntervalFn: scheduler.setInterval,
        clearIntervalFn: scheduler.clearInterval,
        loadGameCore: async () => ({ core: true }),
        getMatchState: () => ({
            ok: true,
            match: {
                roomId: "room-ai-processing",
                players: [{ playerId: "ai", playerType: "heuristic_ai" }],
            },
        }),
        pveAiPlayerService: {
            processAiStep() {
                aiCallCount += 1;
                return stepPromise;
            },
        },
        getAuthoritativePlayerSnapshotDto: () => ({
            ok: true,
            snapshot: { phase: "playing", pieceIndex: 1 },
        }),
    });

    tickerService.startRoomTicker("room-ai-processing", socketServer);
    const firstTick = tickerService.tickRoom("room-ai-processing", socketServer, 100);
    const duplicateTick = tickerService.tickRoom("room-ai-processing", socketServer, 100);
    await duplicateTick;

    assert.equal(aiCallCount, 1);

    resolveStep({
        ok: true,
        skipped: false,
        stateChanged: true,
        action: "move_left",
    });
    await firstTick;

    assert.equal(aiCallCount, 1);
    assert.equal(socketServer.roomEvents.length, 1);
});

test("AI hard_drop은 기존 attack과 line clear presentation 경로를 유지한다", async () => {
    const scheduler = createFakeScheduler();
    const socketServer = createFakeSocketServer();
    const appendedGarbage = [];
    const tickerService = createAuthoritativeTickerService({
        setIntervalFn: scheduler.setInterval,
        clearIntervalFn: scheduler.clearInterval,
        loadGameCore: async () => ({ core: true }),
        createGarbageHoleCol: () => 5,
        getMatchState: () => ({
            ok: true,
            match: {
                roomId: "room-ai-lock",
                players: [
                    { playerId: "human", playerType: "human" },
                    { playerId: "ai", playerType: "heuristic_ai" },
                ],
            },
        }),
        pveAiPlayerService: {
            async processAiStep() {
                return {
                    ok: true,
                    skipped: false,
                    stateChanged: true,
                    action: "hard_drop",
                    placementResult: { attackLines: 2, gameOver: false },
                    presentationEffect: {
                        id: "ai:4:line_clear",
                        type: "line_clear",
                        pieceIndex: 4,
                        rows: [19],
                        boardBeforeClear: [["square"]],
                    },
                };
            },
        },
        appendPendingGarbageToOpponent(roomId, fromPlayerId, garbage) {
            appendedGarbage.push({ roomId, fromPlayerId, garbage });
            return { ok: true, targetPlayerId: "human", garbage };
        },
        getAuthoritativePlayerSnapshotDto(roomId, playerId) {
            return {
                ok: true,
                snapshot: {
                    phase: "playing",
                    pieceIndex: playerId === "ai" ? 5 : 1,
                    pendingGarbageLines: playerId === "human" ? 2 : 0,
                },
            };
        },
    });

    tickerService.startRoomTicker("room-ai-lock", socketServer);
    await tickerService.tickRoom("room-ai-lock", socketServer, 100);

    assert.deepEqual(appendedGarbage, [
        {
            roomId: "room-ai-lock",
            fromPlayerId: "ai",
            garbage: { lines: 2, holeCol: 5 },
        },
    ]);
    const aiSnapshot = socketServer.roomEvents.find(event => {
        return event.payload.playerId === "ai";
    });
    const humanSnapshot = socketServer.roomEvents.find(event => {
        return event.payload.playerId === "human";
    });
    assert.equal(aiSnapshot.payload.presentationEffect.id, "ai:4:line_clear");
    assert.deepEqual(aiSnapshot.payload.presentationEffect.rows, [19]);
    assert.equal(humanSnapshot.payload.snapshot.pendingGarbageLines, 2);
    assert.equal(Object.hasOwn(humanSnapshot.payload, "presentationEffect"), false);
});

test("ticker callback은 server lock attackLines를 상대 pending garbage로 추가하고 snapshot scalar를 emit한다", async () => {
    const scheduler = createFakeScheduler();
    const socketServer = createFakeSocketServer();
    const appendedGarbage = [];
    const tickerService = createAuthoritativeTickerService({
        setIntervalFn: scheduler.setInterval,
        clearIntervalFn: scheduler.clearInterval,
        loadGameCore: async () => ({ core: true }),
        createGarbageHoleCol: () => 6,
        getMatchState: () => ({
            ok: true,
            match: {
                roomId: "room-1",
                players: [
                    { playerId: "p1" },
                    { playerId: "p2" },
                ],
            },
        }),
        applyGravityStepToMatchPlayerState(roomId, playerId) {
            return {
                ok: true,
                gravityResult: { kind: "lock" },
                placementResult: {
                    attackLines: playerId === "p1" ? 2 : 0,
                    gameOver: false,
                },
                presentationEffect: playerId === "p1"
                    ? {
                        id: "p1:3:line_clear",
                        type: "line_clear",
                        pieceIndex: 3,
                        rows: [19],
                        boardBeforeClear: [["bar"]],
                    }
                    : undefined,
            };
        },
        appendPendingGarbageToOpponent(roomId, fromPlayerId, garbage) {
            appendedGarbage.push({ roomId, fromPlayerId, garbage });
            return {
                ok: true,
                targetPlayerId: "p2",
                garbage,
            };
        },
        getAuthoritativePlayerSnapshotDto(roomId, playerId) {
            return {
                ok: true,
                snapshot: {
                    board: [[playerId]],
                    activePiece: null,
                    pieceQueue: [],
                    holdPieceType: null,
                    holdUsedThisDrop: false,
                    score: 0,
                    lines: 0,
                    phase: "playing",
                    combo: -1,
                    backToBack: false,
                    tick: 1,
                    pieceIndex: 1,
                    pendingGarbageLines: playerId === "p2" ? 2 : 0,
                },
            };
        },
    });

    tickerService.startRoomTicker("room-1", socketServer);
    await runTickerCallbacks(scheduler, 5);

    assert.deepEqual(appendedGarbage, [
        {
            roomId: "room-1",
            fromPlayerId: "p1",
            garbage: { lines: 2, holeCol: 6 },
        },
    ]);
    const garbageEvent = socketServer.roomEvents.find(event => {
        return event.eventName === "game:garbage:append";
    });
    const p2SnapshotEvent = socketServer.roomEvents.find(event => {
        return event.eventName === "game:authoritative:snapshot"
            && event.payload.playerId === "p2";
    });
    const p1SnapshotEvent = socketServer.roomEvents.find(event => {
        return event.eventName === "game:authoritative:snapshot"
            && event.payload.playerId === "p1";
    });

    assert.equal(garbageEvent, undefined);
    assert.equal(p1SnapshotEvent.payload.presentationEffect.id, "p1:3:line_clear");
    assert.deepEqual(p1SnapshotEvent.payload.presentationEffect.rows, [19]);
    assert.equal(p2SnapshotEvent.payload.snapshot.pendingGarbageLines, 2);
    assert.equal(Object.hasOwn(p2SnapshotEvent.payload.snapshot, "pendingGarbageQueue"), false);
    assert.equal(Object.hasOwn(p2SnapshotEvent.payload, "presentationEffect"), false);
});

test("ticker callback은 마지막 player attack도 target snapshot을 즉시 emit한다", async () => {
    const scheduler = createFakeScheduler();
    const socketServer = createFakeSocketServer();
    let p1PendingGarbageLines = 0;
    const tickerService = createAuthoritativeTickerService({
        setIntervalFn: scheduler.setInterval,
        clearIntervalFn: scheduler.clearInterval,
        loadGameCore: async () => ({ core: true }),
        createGarbageHoleCol: () => 4,
        getMatchState: () => ({
            ok: true,
            match: {
                roomId: "room-1",
                players: [
                    { playerId: "p1" },
                    { playerId: "p2" },
                ],
            },
        }),
        applyGravityStepToMatchPlayerState(roomId, playerId) {
            return {
                ok: true,
                gravityResult: { kind: "lock" },
                placementResult: {
                    attackLines: playerId === "p2" ? 3 : 0,
                    gameOver: false,
                },
            };
        },
        appendPendingGarbageToOpponent(roomId, fromPlayerId, garbage) {
            p1PendingGarbageLines += garbage.lines;
            return {
                ok: true,
                targetPlayerId: "p1",
                garbage,
            };
        },
        getAuthoritativePlayerSnapshotDto(roomId, playerId) {
            return {
                ok: true,
                snapshot: {
                    board: [[playerId]],
                    activePiece: null,
                    pieceQueue: [],
                    holdPieceType: null,
                    holdUsedThisDrop: false,
                    score: 0,
                    lines: 0,
                    phase: "playing",
                    combo: -1,
                    backToBack: false,
                    tick: 1,
                    pieceIndex: 1,
                    pendingGarbageLines: playerId === "p1" ? p1PendingGarbageLines : 0,
                },
            };
        },
    });

    tickerService.startRoomTicker("room-1", socketServer);
    await runTickerCallbacks(scheduler, 5);

    const p1SnapshotEvents = socketServer.roomEvents.filter(event => {
        return event.eventName === "game:authoritative:snapshot"
            && event.payload.playerId === "p1";
    });
    const garbageEvent = socketServer.roomEvents.find(event => {
        return event.eventName === "game:garbage:append";
    });

    assert.equal(garbageEvent, undefined);
    assert.equal(p1SnapshotEvents.length, 2);
    assert.equal(p1SnapshotEvents[0].payload.snapshot.pendingGarbageLines, 0);
    assert.equal(p1SnapshotEvents[1].payload.snapshot.pendingGarbageLines, 3);
    assert.equal(Object.hasOwn(p1SnapshotEvents[1].payload.snapshot, "pendingGarbageQueue"), false);
});

test("ticker callback은 server authoritative gameOver가 되면 match finish를 emit하고 ticker를 정리한다", async () => {
    const scheduler = createFakeScheduler();
    const socketServer = createFakeSocketServer();
    const finishedGames = [];
    const savedLogs = [];
    const deletedRoomIds = [];
    const tickerService = createAuthoritativeTickerService({
        setIntervalFn: scheduler.setInterval,
        clearIntervalFn: scheduler.clearInterval,
        loadGameCore: async () => ({ core: true }),
        getMatchState: () => ({
            ok: true,
            match: {
                roomId: "room-1",
                createdAt: 1000,
                players: [
                    { playerId: "p1" },
                    { playerId: "p2" },
                ],
            },
        }),
        applyGravityStepToMatchPlayerState(roomId, playerId) {
            return {
                ok: true,
                gravityResult: { kind: "lock" },
                placementResult: {
                    attackLines: 0,
                    gameOver: playerId === "p1",
                },
            };
        },
        getAuthoritativePlayerSnapshotDto(roomId, playerId) {
            return {
                ok: true,
                snapshot: {
                    board: [[playerId]],
                    activePiece: null,
                    pieceQueue: [],
                    holdPieceType: null,
                    holdUsedThisDrop: false,
                    score: 0,
                    lines: 0,
                    phase: playerId === "p1" ? "gameOver" : "playing",
                    combo: -1,
                    backToBack: false,
                    tick: 1,
                    pieceIndex: 1,
                },
            };
        },
        finishGame(roomId, loserPlayerId, reason) {
            finishedGames.push({ roomId, loserPlayerId, reason });
            return {
                ok: true,
                room: { roomId, status: "finished" },
                winnerPlayerId: "p2",
                loserPlayerId,
                finishReason: reason,
            };
        },
        saveGameEventLog(log) {
            savedLogs.push(log);
            return Promise.resolve({
                ok: true,
                log,
                reason: null,
            });
        },
        deleteMatch(roomId) {
            deletedRoomIds.push(roomId);
            return {
                ok: true,
                match: null,
                reason: null,
            };
        },
    });

    tickerService.startRoomTicker("room-1", socketServer);
    const intervalId = [...scheduler.intervals.keys()][0];
    await runTickerCallbacks(scheduler, 5);

    assert.deepEqual(finishedGames, [
        { roomId: "room-1", loserPlayerId: "p1", reason: "top_out" },
    ]);
    assert.deepEqual(deletedRoomIds, ["room-1"]);
    assert.deepEqual(scheduler.clearedIds, [intervalId]);
    assert.equal(tickerService.hasRoomTicker("room-1"), false);
    const finishEvent = socketServer.roomEvents.findLast(event => {
        return event.eventName === "match:finish";
    });
    assert.deepEqual(finishEvent.payload, {
        room: { roomId: "room-1", status: "finished" },
        winnerPlayerId: "p2",
        loserPlayerId: "p1",
        reason: "top_out",
    });
    assert.deepEqual(savedLogs.map(log => ({
        eventType: log.eventType,
        gameId: log.gameId,
        roomId: log.roomId,
        mode: log.mode,
        winnerPlayerId: log.winnerPlayerId,
        loserPlayerId: log.loserPlayerId,
        reason: log.reason,
        finishType: log.finishType,
    })), [
        {
            eventType: "game_over",
            gameId: "room-1-1000",
            roomId: "room-1",
            mode: "multi",
            winnerPlayerId: "p2",
            loserPlayerId: "p1",
            reason: "top_out",
            finishType: "normal",
        },
    ]);
    assert.equal(typeof savedLogs[0].endedAt, "number");
});

test("finishAuthoritativeMatch는 이미 처리된 finish의 emit과 log를 중복하지 않는다", async () => {
    let finishCallCount = 0;
    const stoppedRoomIds = [];
    const finishEvents = [];
    const savedLogs = [];
    const deletedRoomIds = [];
    let matchState = {
        roomId: "room-1",
        createdAt: 1000,
    };

    const finishGame = (roomId, loserPlayerId, reason) => {
        finishCallCount += 1;
        if (finishCallCount > 1) {
            return {
                ok: false,
                room: null,
                reason: "GAME_NOT_PLAYING",
                winnerPlayerId: null,
                loserPlayerId,
                finishReason: reason,
            };
        }

        return {
            ok: true,
            room: { roomId, status: "finished" },
            winnerPlayerId: "p2",
            loserPlayerId,
            finishReason: reason,
        };
    };

    const firstResult = await finishAuthoritativeMatch({
        roomId: "room-1",
        loserPlayerId: "p1",
        finishGame,
        stopRoomTicker(roomId) {
            stoppedRoomIds.push(roomId);
        },
        emitMatchFinish(payload) {
            finishEvents.push(payload);
        },
        saveGameEventLog(log) {
            savedLogs.push(log);
            return Promise.resolve({ ok: true, log, reason: null });
        },
        getMatchState(roomId) {
            return matchState
                ? { ok: true, match: matchState, reason: null }
                : { ok: false, match: null, reason: "MATCH_NOT_FOUND" };
        },
        deleteMatch(roomId) {
            deletedRoomIds.push(roomId);
            matchState = null;
            return { ok: true, match: null, reason: null };
        },
    });
    const secondResult = await finishAuthoritativeMatch({
        roomId: "room-1",
        loserPlayerId: "p1",
        finishGame,
        stopRoomTicker(roomId) {
            stoppedRoomIds.push(roomId);
        },
        emitMatchFinish(payload) {
            finishEvents.push(payload);
        },
        saveGameEventLog(log) {
            savedLogs.push(log);
            return Promise.resolve({ ok: true, log, reason: null });
        },
        getMatchState(roomId) {
            return matchState
                ? { ok: true, match: matchState, reason: null }
                : { ok: false, match: null, reason: "MATCH_NOT_FOUND" };
        },
        deleteMatch(roomId) {
            deletedRoomIds.push(roomId);
            matchState = null;
            return { ok: true, match: null, reason: null };
        },
    });

    assert.equal(firstResult.ok, true);
    assert.equal(firstResult.finished, true);
    assert.deepEqual(secondResult, {
        ok: true,
        finished: false,
        reason: "ALREADY_FINISHED",
    });
    assert.deepEqual(stoppedRoomIds, ["room-1"]);
    assert.equal(finishEvents.length, 1);
    assert.equal(savedLogs.length, 1);
    assert.deepEqual(deletedRoomIds, ["room-1"]);
    assert.equal(savedLogs[0].eventType, "game_over");
    assert.equal(savedLogs[0].gameId, "room-1-1000");
});

test("stopRoomTicker 후 다시 start하면 gravity accumulator가 초기화된다", async () => {
    const scheduler = createFakeScheduler();
    const socketServer = createFakeSocketServer();
    const calls = [];
    const tickerService = createAuthoritativeTickerService({
        setIntervalFn: scheduler.setInterval,
        clearIntervalFn: scheduler.clearInterval,
        loadGameCore: async () => ({ core: true }),
        getMatchState: () => ({
            ok: true,
            match: {
                roomId: "room-1",
                players: [
                    { playerId: "p1" },
                ],
            },
        }),
        applyGravityStepToMatchPlayerState(roomId, playerId) {
            calls.push({ roomId, playerId });
            return {
                ok: true,
                gravityResult: { kind: "move" },
                placementResult: null,
            };
        },
        getAuthoritativePlayerSnapshotDto(roomId, playerId) {
            return {
                ok: true,
                snapshot: {
                    board: [[playerId]],
                    activePiece: null,
                    pieceQueue: [],
                    holdPieceType: null,
                    holdUsedThisDrop: false,
                    score: 0,
                    lines: 0,
                    phase: "playing",
                    combo: -1,
                    backToBack: false,
                    tick: 1,
                    pieceIndex: 1,
                },
            };
        },
    });

    tickerService.startRoomTicker("room-1", socketServer);
    await runTickerCallbacks(scheduler, 4);
    tickerService.stopRoomTicker("room-1");
    tickerService.startRoomTicker("room-1", socketServer);
    await runTickerCallbacks(scheduler, 1);

    assert.deepEqual(calls, []);
    assert.deepEqual(socketServer.roomEvents, []);

    await runTickerCallbacks(scheduler, 4);

    assert.deepEqual(calls, [{ roomId: "room-1", playerId: "p1" }]);
    assert.equal(socketServer.roomEvents.length, 1);
});

test("stopRoomTicker는 여러 번 호출해도 안전하게 interval을 정리한다", () => {
    const scheduler = createFakeScheduler();
    const tickerService = createAuthoritativeTickerService({
        setIntervalFn: scheduler.setInterval,
        clearIntervalFn: scheduler.clearInterval,
    });
    const socketServer = createFakeSocketServer();

    tickerService.startRoomTicker("room-1", socketServer);
    const intervalId = [...scheduler.intervals.keys()][0];
    const firstStop = tickerService.stopRoomTicker("room-1");
    const secondStop = tickerService.stopRoomTicker("room-1");

    assert.deepEqual(firstStop, { ok: true, stopped: true });
    assert.deepEqual(secondStop, { ok: true, stopped: false });
    assert.deepEqual(scheduler.clearedIds, [intervalId]);
    assert.equal(tickerService.hasRoomTicker("room-1"), false);
});
