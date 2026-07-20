const test = require("node:test")
const assert = require("node:assert/strict")

const {
    clearRoomsForTest,
    createRoom,
    getRoomState,
    joinRoom,
    removePlayer,
    leaveRoom,
    startGame,
    leaveGame,
    syncRoom,
    finishGame,
} = require("../src/server/services/roomService.js")

test.beforeEach(clearRoomsForTest)

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
    assert.equal(result.room.roomId.length, 8)
    assert.equal(result.room.roomId, result.room.roomId.toUpperCase())
})

test("createRoom은 roomId 충돌이 나면 새 roomId로 재시도한다", () => {
    const firstHost = {
        playerId: "collision-host-1",
        nickname: "Host 1",
        socketId: "collision-socket-1",
    }
    const secondHost = {
        playerId: "collision-host-2",
        nickname: "Host 2",
        socketId: "collision-socket-2",
    }
    const generatedIds = ["DUPLICAT", "DUPLICAT", "UNIQUE01"]

    const firstResult = createRoom(firstHost, {
        generateRoomId: () => generatedIds.shift(),
    })
    const secondResult = createRoom(secondHost, {
        generateRoomId: () => generatedIds.shift(),
    })

    assert.equal(firstResult.ok, true)
    assert.equal(firstResult.room.roomId, "DUPLICAT")
    assert.equal(secondResult.ok, true)
    assert.equal(secondResult.reason, null)
    assert.equal(secondResult.room.roomId, "UNIQUE01")
    assert.equal(getRoomState("DUPLICAT").hostPlayerId, "collision-host-1")
    assert.equal(getRoomState("UNIQUE01").hostPlayerId, "collision-host-2")
})

test("createRoom은 roomId 재시도 한도를 넘으면 실패한다", () => {
    const existingHost = {
        playerId: "generation-existing-host",
        nickname: "Existing Host",
        socketId: "generation-existing-socket",
    }
    const blockedHost = {
        playerId: "generation-blocked-host",
        nickname: "Blocked Host",
        socketId: "generation-blocked-socket",
    }

    createRoom(existingHost, {
        generateRoomId: () => "FULLROOM",
    })
    const result = createRoom(blockedHost, {
        generateRoomId: () => "FULLROOM",
    })

    assert.equal(result.ok, false)
    assert.equal(result.room, null)
    assert.equal(result.reason, "ROOM_ID_GENERATION_FAILED")
    assert.equal(getRoomState("FULLROOM").hostPlayerId, "generation-existing-host")
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

test("leaveRoom은 player context와 함께 room leave 결과를 반환한다", () => {
    const hostPlayer = {
        playerId: "leave-room-host",
        nickname: "Host",
        socketId: "leave-room-host-socket",
    }
    const guestPlayer = {
        playerId: "leave-room-guest",
        nickname: "Guest",
        socketId: "leave-room-guest-socket",
    }

    const createResult = createRoom(hostPlayer)
    joinRoom(createResult.room.roomId, guestPlayer)
    const result = leaveRoom(createResult.room.roomId, guestPlayer.playerId)

    assert.equal(result.ok, true)
    assert.equal(result.reason, null)
    assert.equal(result.roomId, createResult.room.roomId)
    assert.equal(result.player.playerId, guestPlayer.playerId)
    assert.equal(result.room.players.length, 1)
    assert.equal(result.room.players[0].playerId, hostPlayer.playerId)
})

test("leaveRoom은 마지막 player가 나가도 roomId와 player context를 유지한다", () => {
    const hostPlayer = {
        playerId: "leave-room-last-host",
        nickname: "Host",
        socketId: "leave-room-last-host-socket",
    }

    const createResult = createRoom(hostPlayer)
    const result = leaveRoom(createResult.room.roomId, hostPlayer.playerId)

    assert.equal(result.ok, true)
    assert.equal(result.reason, null)
    assert.equal(result.room, null)
    assert.equal(result.roomId, createResult.room.roomId)
    assert.equal(result.player.playerId, hostPlayer.playerId)
    assert.equal(getRoomState(createResult.room.roomId), null)
})

test("leaveRoom은 room에 없는 player면 NOT_AUTHORIZED와 null player를 반환한다", () => {
    const hostPlayer = {
        playerId: "leave-room-auth-host",
        nickname: "Host",
        socketId: "leave-room-auth-host-socket",
    }

    const createResult = createRoom(hostPlayer)
    const result = leaveRoom(createResult.room.roomId, "missing-player")

    assert.equal(result.ok, false)
    assert.equal(result.room, null)
    assert.equal(result.reason, "NOT_AUTHORIZED")
    assert.equal(result.roomId, createResult.room.roomId)
    assert.equal(result.player, null)
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

test("startGame는 room host membership으로 게임을 시작할 수 있다", () => {
    const hostPlayer = {
        playerId: "socket-valid-host",
        nickname: "Host",
        socketId: "valid-host-socket",
    }
    const guestPlayer = {
        playerId: "socket-valid-guest",
        nickname: "Guest",
        socketId: "valid-guest-socket",
    }

    const createResult = createRoom(hostPlayer)
    joinRoom(createResult.room.roomId, guestPlayer)
    const result = startGame(createResult.room.roomId, hostPlayer.playerId)

    assert.equal(result.ok, true)
    assert.equal(result.reason, null)
    assert.equal(result.room.status, "playing")
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

test("leaveGame은 playing room에서 guest도 나갈 수 있고 room을 waiting 상태로 되돌린다", () => {
    const hostPlayer = {
        playerId: "leave-host",
        nickname: "Host",
        socketId: "leave-host-socket",
    }
    const guestPlayer = {
        playerId: "leave-guest",
        nickname: "Guest",
        socketId: "leave-guest-socket",
    }

    const createResult = createRoom(hostPlayer)
    joinRoom(createResult.room.roomId, guestPlayer)
    startGame(createResult.room.roomId, hostPlayer.playerId)

    const result = leaveGame(createResult.room.roomId, guestPlayer.playerId)

    assert.equal(result.ok, true)
    assert.equal(result.reason, null)
    assert.equal(result.room.status, "waiting")
    assert.equal(result.room.players.length, 1)
    assert.equal(result.room.players[0].playerId, hostPlayer.playerId)
})

test("leaveGame은 없는 roomId면 ROOM_NOT_FOUND를 반환하고 예외를 던지지 않는다", () => {
    assert.doesNotThrow(() => {
        const result = leaveGame("UNKNOWN", "missing-player")

        assert.equal(result.ok, false)
        assert.equal(result.room, null)
        assert.equal(result.reason, "ROOM_NOT_FOUND")
    })
})

test("finishGame은 loser를 기준으로 winner를 계산하고 room을 finished 상태로 바꾼다", () => {
    const hostPlayer = {
        playerId: "finish-host",
        nickname: "Host",
        socketId: "finish-host-socket",
    }
    const guestPlayer = {
        playerId: "finish-guest",
        nickname: "Guest",
        socketId: "finish-guest-socket",
    }

    const createResult = createRoom(hostPlayer)
    joinRoom(createResult.room.roomId, guestPlayer)
    startGame(createResult.room.roomId, hostPlayer.playerId)

    const result = finishGame(createResult.room.roomId, guestPlayer.playerId, "top_out")

    assert.equal(result.ok, true)
    assert.equal(result.reason, null)
    assert.equal(result.room.status, "finished")
    assert.equal(result.room.players.length, 2)
    assert.equal(result.winnerPlayerId, hostPlayer.playerId)
    assert.equal(result.loserPlayerId, guestPlayer.playerId)
    assert.equal(result.finishReason, "top_out")
})

test("finishGame은 이미 finished인 room에서 중복 종료를 적용하지 않는다", () => {
    const hostPlayer = {
        playerId: "finish-duplicate-host",
        nickname: "Host",
        socketId: "finish-duplicate-host-socket",
    }
    const guestPlayer = {
        playerId: "finish-duplicate-guest",
        nickname: "Guest",
        socketId: "finish-duplicate-guest-socket",
    }

    const createResult = createRoom(hostPlayer)
    joinRoom(createResult.room.roomId, guestPlayer)
    startGame(createResult.room.roomId, hostPlayer.playerId)

    const firstResult = finishGame(createResult.room.roomId, guestPlayer.playerId, "top_out")
    const secondResult = finishGame(createResult.room.roomId, guestPlayer.playerId, "top_out")

    assert.equal(firstResult.ok, true)
    assert.equal(firstResult.room.status, "finished")
    assert.equal(secondResult.ok, false)
    assert.equal(secondResult.room, null)
    assert.equal(secondResult.reason, "GAME_NOT_PLAYING")
    assert.equal(getRoomState(createResult.room.roomId).status, "finished")
})

test("finishGame 이후 한 명만 로비에 돌아오면 다시 게임을 시작할 수 없다", () => {
    const hostPlayer = {
        playerId: "finish-lobby-host",
        nickname: "Host",
        socketId: "finish-lobby-host-socket",
    }
    const guestPlayer = {
        playerId: "finish-lobby-guest",
        nickname: "Guest",
        socketId: "finish-lobby-guest-socket",
    }

    const createResult = createRoom(hostPlayer)
    joinRoom(createResult.room.roomId, guestPlayer)
    startGame(createResult.room.roomId, hostPlayer.playerId)
    finishGame(createResult.room.roomId, guestPlayer.playerId, "top_out")

    const syncResult = syncRoom(createResult.room.roomId, hostPlayer.playerId, {
        location: "lobby",
    })
    const startResult = startGame(createResult.room.roomId, hostPlayer.playerId, "finish-lobby-new-host-socket")

    assert.equal(syncResult.ok, true)
    assert.equal(syncResult.room.status, "finished")
    assert.equal(startResult.ok, false)
    assert.equal(startResult.reason, "GAME_NOT_READY")
})

test("finishGame 이후 두 명이 모두 로비에 돌아오면 다시 waiting 상태가 된다", () => {
    const hostPlayer = {
        playerId: "finish-ready-host",
        nickname: "Host",
        socketId: "finish-ready-host-socket",
    }
    const guestPlayer = {
        playerId: "finish-ready-guest",
        nickname: "Guest",
        socketId: "finish-ready-guest-socket",
    }

    const createResult = createRoom(hostPlayer)
    joinRoom(createResult.room.roomId, guestPlayer)
    startGame(createResult.room.roomId, hostPlayer.playerId)
    finishGame(createResult.room.roomId, guestPlayer.playerId, "top_out")

    syncRoom(createResult.room.roomId, hostPlayer.playerId, {
        location: "lobby",
    })
    const syncResult = syncRoom(createResult.room.roomId, guestPlayer.playerId, {
        location: "lobby",
    })

    assert.equal(syncResult.ok, true)
    assert.equal(syncResult.room.status, "waiting")
})

test("finishGame은 waiting room이면 GAME_NOT_PLAYING을 반환한다", () => {
    const hostPlayer = {
        playerId: "finish-waiting-host",
        nickname: "Host",
        socketId: "finish-waiting-host-socket",
    }
    const guestPlayer = {
        playerId: "finish-waiting-guest",
        nickname: "Guest",
        socketId: "finish-waiting-guest-socket",
    }

    const createResult = createRoom(hostPlayer)
    joinRoom(createResult.room.roomId, guestPlayer)

    const result = finishGame(createResult.room.roomId, guestPlayer.playerId, "top_out")

    assert.equal(result.ok, false)
    assert.equal(result.room, null)
    assert.equal(result.reason, "GAME_NOT_PLAYING")
    assert.equal(result.winnerPlayerId, null)
    assert.equal(result.loserPlayerId, guestPlayer.playerId)
    assert.equal(result.finishReason, "top_out")
})

test("finishGame은 room에 없는 player면 NOT_AUTHORIZED를 반환한다", () => {
    const hostPlayer = {
        playerId: "finish-auth-host",
        nickname: "Host",
        socketId: "finish-auth-host-socket",
    }
    const guestPlayer = {
        playerId: "finish-auth-guest",
        nickname: "Guest",
        socketId: "finish-auth-guest-socket",
    }

    const createResult = createRoom(hostPlayer)
    joinRoom(createResult.room.roomId, guestPlayer)
    startGame(createResult.room.roomId, hostPlayer.playerId)

    const result = finishGame(createResult.room.roomId, "missing-player", "top_out")

    assert.equal(result.ok, false)
    assert.equal(result.room, null)
    assert.equal(result.reason, "NOT_AUTHORIZED")
    assert.equal(result.winnerPlayerId, null)
    assert.equal(result.loserPlayerId, null)
    assert.equal(result.finishReason, "top_out")
})

test("finishGame은 playing room에 player가 2명이 아니면 NOT_ENOUGH_PLAYERS를 반환한다", () => {
    const hostPlayer = {
        playerId: "finish-count-host",
        nickname: "Host",
        socketId: "finish-count-host-socket",
    }

    const createResult = createRoom(hostPlayer)
    const roomState = getRoomState(createResult.room.roomId)
    roomState.status = "playing"

    const result = finishGame(createResult.room.roomId, hostPlayer.playerId, "top_out")

    assert.equal(result.ok, false)
    assert.equal(result.room, null)
    assert.equal(result.reason, "NOT_ENOUGH_PLAYERS")
    assert.equal(result.winnerPlayerId, null)
    assert.equal(result.loserPlayerId, hostPlayer.playerId)
    assert.equal(result.finishReason, "top_out")
})

test("syncRoom은 room에 속한 player에게 현재 room 상태를 DTO로 반환한다", () => {
    const hostPlayer = {
        playerId: "sync-host",
        nickname: "Host",
        socketId: "sync-host-socket",
    }
    const guestPlayer = {
        playerId: "sync-guest",
        nickname: "Guest",
        socketId: "sync-guest-socket",
    }

    const createResult = createRoom(hostPlayer)
    joinRoom(createResult.room.roomId, guestPlayer)

    const result = syncRoom(createResult.room.roomId, hostPlayer.playerId)

    assert.equal(result.ok, true)
    assert.equal(result.reason, null)
    assert.equal(result.room.roomId, createResult.room.roomId)
    assert.equal(result.room.players.length, 2)
})

test("syncRoom은 room membership만 반환하고 socketId를 저장하지 않는다", () => {
    const hostPlayer = {
        playerId: "sync-refresh-host",
        nickname: "Host",
        socketId: "old-host-socket",
    }
    const guestPlayer = {
        playerId: "sync-refresh-guest",
        nickname: "Guest",
        socketId: "guest-socket",
    }

    const createResult = createRoom(hostPlayer)
    joinRoom(createResult.room.roomId, guestPlayer)
    const syncResult = syncRoom(createResult.room.roomId, hostPlayer.playerId)
    const startResult = startGame(createResult.room.roomId, hostPlayer.playerId)

    assert.equal(syncResult.ok, true)
    assert.equal(syncResult.room.players[0].socketId, undefined)
    assert.equal(startResult.ok, true)
    assert.equal(startResult.reason, null)
    assert.equal(startResult.room.status, "playing")
})

test("syncRoom은 room에 없는 player면 NOT_AUTHORIZED를 반환한다", () => {
    const hostPlayer = {
        playerId: "sync-auth-host",
        nickname: "Host",
        socketId: "sync-auth-host-socket",
    }

    const createResult = createRoom(hostPlayer)
    const result = syncRoom(createResult.room.roomId, "missing-player")

    assert.equal(result.ok, false)
    assert.equal(result.room, null)
    assert.equal(result.reason, "NOT_AUTHORIZED")
})

test("syncRoom은 없는 roomId면 ROOM_NOT_FOUND를 반환한다", () => {
    const result = syncRoom("UNKNOWN", "missing-player")

    assert.equal(result.ok, false)
    assert.equal(result.room, null)
    assert.equal(result.reason, "ROOM_NOT_FOUND")
})

test("같은 player는 room을 연속 생성할 수 없다", () => {
    const player = { playerId: "single-room-create-player", nickname: "Host" }
    const firstResult = createRoom(player)
    const secondResult = createRoom(player)

    assert.equal(firstResult.ok, true)
    assert.equal(secondResult.ok, false)
    assert.equal(secondResult.reason, "PLAYER_ALREADY_IN_ROOM")
    assert.equal(getRoomState(firstResult.room.roomId).players.length, 1)
})

test("이미 room에 속한 player는 다른 room에 join할 수 없다", () => {
    const member = { playerId: "single-room-join-member", nickname: "Member" }
    const targetHost = { playerId: "single-room-join-host", nickname: "Host" }
    const memberRoom = createRoom(member)
    const targetRoom = createRoom(targetHost)

    const result = joinRoom(targetRoom.room.roomId, member)

    assert.equal(result.ok, false)
    assert.equal(result.reason, "PLAYER_ALREADY_IN_ROOM")
    assert.equal(getRoomState(memberRoom.room.roomId).players.length, 1)
    assert.equal(getRoomState(targetRoom.room.roomId).players.length, 1)
})

test("playing room은 room:leave 경계를 거부하고 game leave만 허용한다", () => {
    const host = { playerId: "playing-leave-host", nickname: "Host" }
    const guest = { playerId: "playing-leave-guest", nickname: "Guest" }
    const createResult = createRoom(host)
    joinRoom(createResult.room.roomId, guest)
    startGame(createResult.room.roomId, host.playerId)

    const roomLeaveResult = leaveRoom(createResult.room.roomId, guest.playerId)
    assert.equal(roomLeaveResult.ok, false)
    assert.equal(roomLeaveResult.reason, "GAME_IN_PROGRESS")
    assert.equal(getRoomState(createResult.room.roomId).players.length, 2)

    const gameLeaveResult = leaveGame(createResult.room.roomId, guest.playerId)
    assert.equal(gameLeaveResult.ok, true)
    assert.equal(gameLeaveResult.room.status, "waiting")
    assert.equal(gameLeaveResult.room.players.length, 1)
})
