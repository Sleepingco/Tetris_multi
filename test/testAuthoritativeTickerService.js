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

test("ticker callback은 server lock attackLines를 상대 pending garbage로 추가하고 append 이벤트를 emit한다", async () => {
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

    assert.deepEqual(garbageEvent, {
        roomId: "room-1",
        eventName: "game:garbage:append",
        payload: {
            roomId: "room-1",
            fromPlayerId: "p1",
            targetPlayerId: "p2",
            lines: 2,
            holeCol: 6,
        },
    });
});

test("ticker callback은 server authoritative gameOver가 되면 match finish를 emit하고 ticker를 정리한다", async () => {
    const scheduler = createFakeScheduler();
    const socketServer = createFakeSocketServer();
    const finishedGames = [];
    const savedLogs = [];
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
    });

    tickerService.startRoomTicker("room-1", socketServer);
    const intervalId = [...scheduler.intervals.keys()][0];
    await runTickerCallbacks(scheduler, 5);

    assert.deepEqual(finishedGames, [
        { roomId: "room-1", loserPlayerId: "p1", reason: "top_out" },
    ]);
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
        match: {
            roomId: "room-1",
            createdAt: 1000,
        },
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
    });
    const secondResult = await finishAuthoritativeMatch({
        roomId: "room-1",
        loserPlayerId: "p1",
        match: {
            roomId: "room-1",
            createdAt: 1000,
        },
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
    assert.equal(savedLogs[0].eventType, "game_over");
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
