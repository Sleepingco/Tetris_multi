const test = require("node:test");
const assert = require("node:assert/strict");

const {
    AI_DIFFICULTY,
    createRoom,
    finishGame,
    getRoomState,
    joinRoom,
    leaveRoom,
    startGame,
    syncRoom,
} = require("../src/server/services/roomService.js");

function createHuman(playerId, socketId) {
    return {
        playerId,
        nickname: "Human",
        socketId,
    };
}

test("PVP room은 기본 mode와 human player만 생성한다", () => {
    const result = createRoom(createHuman("pvp-human", "pvp-socket"), {
        generateRoomId: () => "PVPROOM1",
    });

    assert.equal(result.ok, true);
    assert.equal(result.room.mode, "pvp");
    assert.equal(result.room.aiDifficulty, null);
    assert.equal(result.room.players.length, 1);
    assert.equal(result.room.players[0].playerType, "human");
});

test("PVE room은 서버가 heuristic AI player를 두 번째 player로 생성한다", () => {
    const result = createRoom(createHuman("pve-human", "pve-socket"), {
        mode: "pve",
        generateRoomId: () => "PVEROOM1",
    });

    assert.equal(result.ok, true);
    assert.equal(result.room.mode, "pve");
    assert.equal(result.room.aiDifficulty, AI_DIFFICULTY.NORMAL);
    assert.equal(result.room.players.length, 2);
    assert.deepEqual(result.room.players.map(player => player.playerType), [
        "human",
        "heuristic_ai",
    ]);
    assert.equal(result.room.players[1].socketId, undefined);
});

test("PVE room은 normal과 hard 난이도를 허용한다", () => {
    const normalResult = createRoom(createHuman("pve-normal", "pve-normal-socket"), {
        mode: "pve",
        aiDifficulty: "normal",
        generateRoomId: () => "PVENORM1",
    });
    const hardResult = createRoom(createHuman("pve-hard", "pve-hard-socket"), {
        mode: "pve",
        aiDifficulty: "hard",
        generateRoomId: () => "PVEHARD1",
    });

    assert.equal(normalResult.ok, true);
    assert.equal(normalResult.room.aiDifficulty, AI_DIFFICULTY.NORMAL);
    assert.equal(hardResult.ok, true);
    assert.equal(hardResult.room.aiDifficulty, AI_DIFFICULTY.HARD);
});

test("PVE room은 잘못된 난이도를 거부하고 room을 만들지 않는다", () => {
    const result = createRoom(createHuman("pve-invalid", "pve-invalid-socket"), {
        mode: "pve",
        aiDifficulty: "expert",
        generateRoomId: () => "PVEINV01",
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "INVALID_AI_DIFFICULTY");
    assert.equal(getRoomState("PVEINV01"), null);
});

test("PVP room은 전달된 AI 난이도를 사용하지 않는다", () => {
    const result = createRoom(createHuman("pvp-ignore", "pvp-ignore-socket"), {
        mode: "pvp",
        aiDifficulty: "hard",
        generateRoomId: () => "PVPIGN01",
    });

    assert.equal(result.ok, true);
    assert.equal(result.room.aiDifficulty, null);
});

test("PVE room은 외부 guest join을 허용하지 않는다", () => {
    const createResult = createRoom(createHuman("pve-join-human", "pve-join-socket"), {
        mode: "pve",
        generateRoomId: () => "PVEROOM2",
    });

    const result = joinRoom(
        createResult.room.roomId,
        createHuman("pve-guest", "pve-guest-socket"),
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "PVE_ROOM_NOT_JOINABLE");
});

test("PVE match 종료 후 human이 로비로 돌아오면 room을 다시 시작할 수 있다", () => {
    const human = createHuman("pve-reset-human", "pve-reset-socket");
    const createResult = createRoom(human, {
        mode: "pve",
        generateRoomId: () => "PVEROOM3",
    });
    const roomId = createResult.room.roomId;
    const aiPlayer = createResult.room.players.find(player => player.playerType === "heuristic_ai");

    assert.equal(startGame(roomId, human.playerId, human.socketId).ok, true);
    assert.equal(finishGame(roomId, aiPlayer.playerId, "ai_no_legal_placement").ok, true);

    const syncResult = syncRoom(roomId, human.playerId, human.socketId, {
        location: "lobby",
    });

    assert.equal(syncResult.ok, true);
    assert.equal(syncResult.room.status, "waiting");
    assert.equal(startGame(roomId, human.playerId, human.socketId).ok, true);
});

test("PVE human이 room을 나가면 synthetic AI와 room도 함께 삭제한다", () => {
    const human = createHuman("pve-leave-human", "pve-leave-socket");
    const createResult = createRoom(human, {
        mode: "pve",
        generateRoomId: () => "PVEROOM4",
    });

    const result = leaveRoom(createResult.room.roomId, human.playerId);

    assert.equal(result.ok, true);
    assert.equal(result.room, null);
    assert.equal(getRoomState(createResult.room.roomId), null);
});
