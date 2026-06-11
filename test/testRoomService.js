const test = require("node:test")
const assert = require("node:assert/strict")

const {
    createRoom,
    getRoomState,
    joinRoom,
    removePlayer,
    findRoomBySocketId,
    startGame,
} = require("../src/server/services/roomService.js")

test("createRoom은 host player가 들어간 waiting room을 만든다", () => {
    const hostPlayer = {
        playerId: "p1",
        nickname: "Player 1",
        socketId: "socket-1",
    }

    const result = createRoom(hostPlayer)

    assert.equal(result.ok, true)
    assert.equal(result.reason, null)
    assert.equal(result.room.players.length, 1)
    assert.equal(result.room.players[0].playerId, "p1")
    assert.equal(result.room.hostPlayerId, "p1")
    assert.equal(result.room.status, "waiting")
    assert.equal(typeof result.room.roomId, "string")
})

test("getRoomState는 roomId로 생성된 room을 다시 조회한다", () => {
    const hostPlayer = {
        playerId: "p1",
        nickname: "Player 1",
        socketId: "socket-1",
    }

    const result = createRoom(hostPlayer)
    const room = getRoomState(result.room.roomId)

    assert.equal(room.roomId, result.room.roomId)
    assert.equal(room.players.length, 1)
})

test("joinRoom은 두 번째 player를 추가하고 status를 waiting으로 유지한다", () => {
    const hostPlayer = {
        playerId: "p1",
        nickname: "Player 1",
        socketId: "socket-1",
    }

    const guestPlayer = {
        playerId: "p2",
        nickname: "Player 2",
        socketId: "socket-2",
    }

    const createResult = createRoom(hostPlayer)
    const joinResult = joinRoom(createResult.room.roomId, guestPlayer)

    assert.equal(joinResult.ok, true)
    assert.equal(joinResult.reason, null)
    assert.equal(joinResult.room.players.length, 2)
    assert.equal(joinResult.room.players[1].playerId, "p2")
    assert.equal(joinResult.room.status, "waiting")
})

test("joinRoom은 없는 roomId면 ROOM_NOT_FOUND를 반환한다", () => {
    const guestPlayer = {
        playerId: "p2",
        nickname: "Player 2",
        socketId: "socket-2",
    }

    const result = joinRoom("UNKNOWN", guestPlayer)

    assert.equal(result.ok, false)
    assert.equal(result.room, null)
    assert.equal(result.reason, "ROOM_NOT_FOUND")
})

test("joinRoom은 방이 가득 차면 ROOM_FULL을 반환한다", () => {
    const hostPlayer = {
        playerId: "p1",
        nickname: "Player 1",
        socketId: "socket-1",
    }
    const guestPlayer = {
        playerId: "p2",
        nickname: "Player 2",
        socketId: "socket-2",
    }
    const thirdPlayer = {
        playerId: "p3",
        nickname: "Player 3",
        socketId: "socket-3",
    }

    const createResult = createRoom(hostPlayer)
    joinRoom(createResult.room.roomId, guestPlayer)
    const result = joinRoom(createResult.room.roomId, thirdPlayer)

    assert.equal(result.ok, false)
    assert.equal(result.room, null)
    assert.equal(result.reason, "ROOM_FULL")
    assert.equal(getRoomState(createResult.room.roomId).players.length, 2)
})

test("joinRoom은 같은 playerId가 다시 들어오면 PLAYER_ALREADY_JOINED를 반환한다", () => {
    const hostPlayer = {
        playerId: "p1",
        nickname: "Player 1",
        socketId: "socket-1",
    }
    const samePlayer = {
        playerId: "p1",
        nickname: "Player 1",
        socketId: "socket-1",
    }

    const createResult = createRoom(hostPlayer)
    const result = joinRoom(createResult.room.roomId, samePlayer)

    assert.equal(result.ok, false)
    assert.equal(result.room, null)
    assert.equal(result.reason, "PLAYER_ALREADY_JOINED")
    assert.equal(getRoomState(createResult.room.roomId).players.length, 1)
})

test("joinRoom은 guestPlayer가 없으면 GUEST_PLAYER_REQUIRED를 반환한다", () => {
    const hostPlayer = {
        playerId: "p1",
        nickname: "Player 1",
        socketId: "socket-1",
    }

    const createResult = createRoom(hostPlayer)
    const result = joinRoom(createResult.room.roomId, null)

    assert.equal(result.ok, false)
    assert.equal(result.room, null)
    assert.equal(result.reason, "GUEST_PLAYER_REQUIRED")
    assert.equal(getRoomState(createResult.room.roomId).players.length, 1)
})

test("joinRoom은 roomId가 없으면 ROOM_ID_REQUIRED를 반환한다", () => {
    const guestPlayer = {
        playerId: "p2",
        nickname: "Player 2",
        socketId: "socket-2",
    }

    const result = joinRoom("", guestPlayer)

    assert.equal(result.ok, false)
    assert.equal(result.room, null)
    assert.equal(result.reason, "ROOM_ID_REQUIRED")
})

test("joinRoom은 guestPlayer의 playerId가 없으면 GUEST_PLAYER_ID_REQUIRED를 반환한다", () => {
    const hostPlayer = {
        playerId: "p1",
        nickname: "Player 1",
        socketId: "socket-1",
    }

    const createResult = createRoom(hostPlayer)
    const result = joinRoom(createResult.room.roomId, {
        nickname: "Player 2",
        socketId: "socket-2",
    })

    assert.equal(result.ok, false)
    assert.equal(result.room, null)
    assert.equal(result.reason, "GUEST_PLAYER_ID_REQUIRED")
    assert.equal(getRoomState(createResult.room.roomId).players.length, 1)
})

test("removePlayer는 한 명이 나가면 room을 유지하고 status를 waiting으로 바꾼다", () => {
    const hostPlayer = {
        playerId: "p1",
        nickname: "Player 1",
        socketId: "socket-1",
    }
    const guestPlayer = {
        playerId: "p2",
        nickname: "Player 2",
        socketId: "socket-2",
    }

    const createResult = createRoom(hostPlayer)
    joinRoom(createResult.room.roomId, guestPlayer)
    const result = removePlayer(createResult.room.roomId, "p2")

    assert.equal(result.ok, true)
    assert.equal(result.reason, null)
    assert.equal(result.room.players.length, 1)
    assert.equal(result.room.players[0].playerId, "p1")
    assert.equal(result.room.hostPlayerId, "p1")
    assert.equal(result.room.status, "waiting")
})

test("removePlayer는 host가 나가면 남은 player를 새 host로 지정한다", () => {
    const hostPlayer = {
        playerId: "p1",
        nickname: "Player 1",
        socketId: "socket-1",
    }
    const guestPlayer = {
        playerId: "p2",
        nickname: "Player 2",
        socketId: "socket-2",
    }

    const createResult = createRoom(hostPlayer)
    joinRoom(createResult.room.roomId, guestPlayer)
    const result = removePlayer(createResult.room.roomId, "p1")

    assert.equal(result.ok, true)
    assert.equal(result.reason, null)
    assert.equal(result.room.players.length, 1)
    assert.equal(result.room.players[0].playerId, "p2")
    assert.equal(result.room.hostPlayerId, "p2")
    assert.equal(result.room.status, "waiting")
})

test("removePlayer는 마지막 player가 나가면 room을 삭제한다", () => {
    const hostPlayer = {
        playerId: "p1",
        nickname: "Player 1",
        socketId: "socket-1",
    }

    const createResult = createRoom(hostPlayer)
    const result = removePlayer(createResult.room.roomId, "p1")

    assert.equal(result.ok, true)
    assert.equal(result.reason, null)
    assert.equal(result.room, null)
    assert.equal(getRoomState(createResult.room.roomId), null)
})

test("removePlayer는 없는 roomId면 ROOM_NOT_FOUND를 반환한다", () => {
    const result = removePlayer("UNKNOWN", "p1")

    assert.equal(result.ok, false)
    assert.equal(result.room, null)
    assert.equal(result.reason, "ROOM_NOT_FOUND")
})

test("removePlayer는 없는 playerId면 PLAYER_NOT_FOUND를 반환한다", () => {
    const hostPlayer = {
        playerId: "p1",
        nickname: "Player 1",
        socketId: "socket-1",
    }

    const createResult = createRoom(hostPlayer)
    const result = removePlayer(createResult.room.roomId, "missing-player")

    assert.equal(result.ok, false)
    assert.equal(result.room, null)
    assert.equal(result.reason, "PLAYER_NOT_FOUND")
    assert.equal(getRoomState(createResult.room.roomId).players.length, 1)
})

test("findRoomBySocketId는 소켓이 속한 room과 player를 찾는다", () => {
    const hostPlayer = {
        playerId: "p1",
        nickname: "Player 1",
        socketId: "find-room-socket-1",
    }
    const guestPlayer = {
        playerId: "p2",
        nickname: "Player 2",
        socketId: "find-room-socket-2",
    }

    const createResult = createRoom(hostPlayer)
    joinRoom(createResult.room.roomId, guestPlayer)
    const result = findRoomBySocketId("find-room-socket-2")

    assert.equal(result.room.roomId, createResult.room.roomId)
    assert.equal(result.player.playerId, "p2")
})

test("findRoomBySocketId는 없는 socketId면 null을 반환한다", () => {
    const found = findRoomBySocketId("missing-socket")

    assert.equal(found, null)
})

test("startGame는 status를 playing으로 바꾸고 game 데이터를 반환한다", () => {
    const hostPlayer = {
        playerId: "p1",
        nickname: "Player 1",
        socketId: "socket-1",
    }
    const guestPlayer = {
        playerId: "p2",
        nickname: "Player 2",
        socketId: "socket-2",
    }

    const createResult = createRoom(hostPlayer)
    joinRoom(createResult.room.roomId, guestPlayer)
    const result = startGame(createResult.room.roomId, hostPlayer.playerId)

    assert.equal(result.ok, true)
    assert.equal(result.reason, null)
    assert.equal(result.room.status, "playing")
    assert.equal(result.room.players.length, 2)
})

test("startGame는 없는 roomId면 ROOM_NOT_FOUND를 반환한다", () => {
    const result = startGame("UNKNOWN", "p1")

    assert.equal(result.ok, false)
    assert.equal(result.room, null)
    assert.equal(result.reason, "ROOM_NOT_FOUND")
})

test("startGame는 방장이 아닌 player가 요청하면 NOT_AUTHORIZED를 반환한다", () => {
    const hostPlayer = {
        playerId: "p1",
        nickname: "Player 1",
        socketId: "socket-1",
    }
    const guestPlayer = {
        playerId: "p2",
        nickname: "Player 2",
        socketId: "socket-2",
    }

    const createResult = createRoom(hostPlayer)
    joinRoom(createResult.room.roomId, guestPlayer)
    const result = startGame(createResult.room.roomId, guestPlayer.playerId)

    assert.equal(result.ok, false)
    assert.equal(result.room, null)
    assert.equal(result.reason, "NOT_AUTHORIZED")
})

test("startGame는 player가 한 명뿐이면 NOT_ENOUGH_PLAYERS를 반환한다", () => {
    const hostPlayer = {
        playerId: "p1",
        nickname: "Player 1",
        socketId: "socket-1",
    }

    const createResult = createRoom(hostPlayer)
    const result = startGame(createResult.room.roomId, hostPlayer.playerId)

    assert.equal(result.ok, false)
    assert.equal(result.room, null)
    assert.equal(result.reason, "NOT_ENOUGH_PLAYERS")
})

test("startGame는 이미 시작된 room이면 GAME_ALREADY_STARTED를 반환한다", () => {
    const hostPlayer = {
        playerId: "p1",
        nickname: "Player 1",
        socketId: "socket-1",
    }
    const guestPlayer = {
        playerId: "p2",
        nickname: "Player 2",
        socketId: "socket-2",
    }

    const createResult = createRoom(hostPlayer)
    joinRoom(createResult.room.roomId, guestPlayer)
    startGame(createResult.room.roomId, hostPlayer.playerId)
    const result = startGame(createResult.room.roomId, hostPlayer.playerId)

    assert.equal(result.ok, false)
    assert.equal(result.room, null)
    assert.equal(result.reason, "GAME_ALREADY_STARTED")
})
