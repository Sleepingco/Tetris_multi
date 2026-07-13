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
const {
    createRoom,
    getRoomState,
    startGame,
} = require("../src/server/services/roomService.js");

test("PVE ticker는 human gravity와 AI placement를 분리하고 AI snapshot을 전송한다", async () => {
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

    await ticker.tickRoom("PVE-TICKER-1", socketServer, 500);

    const match = getMatchState("PVE-TICKER-1").match;
    const human = match.players.find(player => player.playerId === "human");
    const ai = match.players.find(player => player.playerId === "ai");
    const aiSnapshotEvent = emitted.find(event => {
        return event.eventName === "game:authoritative:snapshot" &&
            event.payload.playerId === "ai";
    });

    assert.equal(human.authoritativeState.activePiece.row, 0);
    assert.equal(ai.authoritativeState.pieceIndex, 2);
    assert.ok(ai.authoritativeState.board.flat().some(cell => cell !== null));
    assert.ok(aiSnapshotEvent);
    assert.equal(aiSnapshotEvent.payload.snapshot.gameOver, false);
    assert.equal(Object.hasOwn(aiSnapshotEvent.payload.snapshot, "evaluation"), false);
    assert.equal(savedLogs.length, 1);

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
