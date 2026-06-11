const { randomUUID } = require("crypto")

const rooms = new Map()

function success(room) {
    return {
        ok: true,
        room,
        reason: null,
    }
}

function failure(reason) {
    return {
        ok: false,
        room: null,
        reason,
    }
}

function getRoomState(roomId) {
    return rooms.get(roomId) || null
}

function createRoom(hostPlayer) {
    if (!hostPlayer) {
        return failure("HOST_PLAYER_REQUIRED")
    }

    const roomId = randomUUID().slice(0, 8).toUpperCase()

    const room = {
        roomId,
        hostPlayerId: hostPlayer.playerId,
        players: [hostPlayer],
        status: "waiting",
        createdAt: Date.now(),
    }

    rooms.set(roomId, room)

    return success(room)
}

function joinRoom(roomId, guestPlayer) {
    if (!guestPlayer) {
        return failure("GUEST_PLAYER_REQUIRED")
    }

    if (!guestPlayer.playerId) {
        return failure("GUEST_PLAYER_ID_REQUIRED")
    }

    if (!roomId) {
        return failure("ROOM_ID_REQUIRED")
    }

    const roomState = getRoomState(roomId)
    if (!roomState) {
        return failure("ROOM_NOT_FOUND")
    }
    if (roomState.players.length >= 2) {
        return failure("ROOM_FULL")
    }

    const alreadyJoined = roomState.players.some(player => player.playerId === guestPlayer.playerId)
    if (alreadyJoined) {
        return failure("PLAYER_ALREADY_JOINED")
    }

    roomState.players.push(guestPlayer)
    roomState.status = "waiting"

    return success(roomState)
}

function removePlayer(roomId, playerId) {
    const roomState = getRoomState(roomId)

    if (!roomState) {
        return failure("ROOM_NOT_FOUND")
    }

    const playerIndex = roomState.players.findIndex(player => player.playerId === playerId)

    if (playerIndex === -1) {
        return failure("PLAYER_NOT_FOUND")
    }

    const removedPlayer = roomState.players[playerIndex]
    roomState.players.splice(playerIndex, 1)

    if (roomState.players.length === 0) {
        rooms.delete(roomId)
        return success(null)
    }

    if (roomState.hostPlayerId === removedPlayer.playerId) {
        roomState.hostPlayerId = roomState.players[0].playerId
    }

    roomState.status = "waiting"

    return success(roomState)
}

function findRoomBySocketId(socketId) {
    for (const room of rooms.values()) {
        const player = room.players.find(player => player.socketId === socketId);

        if (player) {
            return {
                room,
                player,
            }
        }
    }

    return null
}

function startGame(roomId, playerId) {
    const roomState = getRoomState(roomId)
    if (!roomId || !roomState) {
        return failure("ROOM_NOT_FOUND")
    }

    if (!playerId) {
        return failure("PLAYER_ID_REQUIRED")
    }

    const player = roomState.players.find(player => player.playerId === playerId)

    if (!player) {
        return failure("NOT_AUTHORIZED")
    }

    if (roomState.status !== "waiting") {
        return failure("GAME_ALREADY_STARTED")
    }

    if (roomState.hostPlayerId !== playerId) {
        return failure("NOT_AUTHORIZED")
    }

    if (roomState.players.length !== 2) {
        return failure("NOT_ENOUGH_PLAYERS")
    }

    roomState.status = "playing"

    return success(roomState)
}

module.exports = {
    createRoom,
    getRoomState,
    joinRoom,
    removePlayer,
    findRoomBySocketId,
    startGame,
}
