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
        players: [hostPlayer],
        status: "waiting",
        createdAt: Date.now(),
    }

    rooms.set(roomId, room)

    return success(room)
}

function joinRoom(roomId, guestPlayer) {
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
    roomState.status = "playing"

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

    roomState.players.splice(playerIndex, 1)

    if (roomState.players.length === 0) {
        rooms.delete(roomId)
        return success(null)
    }

    roomState.status = "waiting"

    return success(roomState)
}
module.exports = {
    createRoom,
    getRoomState,
    joinRoom,
    removePlayer,
}
