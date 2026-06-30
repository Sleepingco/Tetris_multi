const { randomUUID } = require("crypto")

const rooms = new Map()

function success(room, meta = {}) {
    return {
        ok: true,
        room,
        reason: null,
        ...meta,
    }
}

function failure(reason, meta = {}) {
    return {
        ok: false,
        room: null,
        reason,
        ...meta,
    }
}

function getRoomState(roomId) {
    return rooms.get(roomId) || null
}

function getRoomPlayerContext(roomId, playerId) {
    const roomState = getRoomState(roomId)
    if (!roomId || !roomState) {
        return {
            ok: false,
            roomState: null,
            player: null,
            reason: "ROOM_NOT_FOUND",
        }
    }

    if (!playerId) {
        return {
            ok: false,
            roomState,
            player: null,
            reason: "PLAYER_ID_REQUIRED",
        }
    }

    const player = roomState.players.find(player => player.playerId === playerId)
    if (!player) {
        return {
            ok: false,
            roomState,
            player: null,
            reason: "NOT_AUTHORIZED",
        }
    }

    return {
        ok: true,
        roomState,
        player,
        reason: null,
    }
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

function getRoomSocketContext(socketId) {
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

function removePlayerBySocketId(socketId) {
    const found = getRoomSocketContext(socketId)

    if (!found) {
        return failure("SOCKET_NOT_FOUND", {
            roomId: null,
            player: null,
        })
    }

    const { room, player } = found

    if (room.status === "playing") {
        return failure("GAME_PLAYING", {
            roomId: room.roomId,
            player,
        })
    }

    const result = removePlayer(room.roomId, player.playerId)
    const meta = {
        roomId: room.roomId,
        player,
    }

    return result.ok
        ? success(result.room, meta)
        : failure(result.reason, meta)
}

function leaveRoom(roomId, playerId) {
    const context = getRoomPlayerContext(roomId, playerId)
    if (!context.ok) {
        return failure(context.reason, {
            roomId: roomId || null,
            player: null,
        })
    }

    const result = removePlayer(roomId, playerId)
    const meta = {
        roomId,
        player: context.player,
    }

    return result.ok
        ? success(result.room, meta)
        : failure(result.reason, meta)
}

function startGame(roomId, playerId, socketId = null) {
    const context = getRoomPlayerContext(roomId, playerId)
    if (!context.ok) {
        return failure(context.reason)
    }

    const { roomState, player } = context

    if (socketId && player.socketId !== socketId) {
        return failure("NOT_AUTHORIZED")
    }

    if (roomState.status === "finished") {
        return failure("GAME_NOT_READY")
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

function leaveGame(roomId, playerId) {
    const context = getRoomPlayerContext(roomId, playerId)
    if (!context.ok) {
        return failure(context.reason)
    }

    const { roomState } = context

    if (roomState.status !== "playing") {
        return failure("GAME_NOT_PLAYING")
    }

    if (roomState.players.length !== 2) {
        return failure("NOT_ENOUGH_PLAYERS")
    }

    return removePlayer(roomId, playerId)
}

function syncRoom(roomId, playerId, socketId = null, options = {}) {
    const context = getRoomPlayerContext(roomId, playerId)
    if (!context.ok) {
        return failure(context.reason)
    }

    if (socketId) {
        context.player.socketId = socketId
    }

    if (options.location === "lobby" && context.roomState.status === "finished") {
        if (!Array.isArray(context.roomState.lobbyPlayerIds)) {
            context.roomState.lobbyPlayerIds = []
        }

        if (!context.roomState.lobbyPlayerIds.includes(playerId)) {
            context.roomState.lobbyPlayerIds.push(playerId)
        }

        const allPlayersReturnedToLobby = context.roomState.players.every(player => {
            return context.roomState.lobbyPlayerIds.includes(player.playerId)
        })

        if (allPlayersReturnedToLobby) {
            context.roomState.status = "waiting"
            delete context.roomState.lobbyPlayerIds
        }
    }

    return success(context.roomState)
}

function finishGame(roomId, loserPlayerId, finishReason = "top_out") {
    const context = getRoomPlayerContext(roomId, loserPlayerId)
    if (!context.ok) {
        return failure(context.reason, {
            winnerPlayerId: null,
            loserPlayerId: null,
            finishReason,
        })
    }

    const { roomState } = context

    if (roomState.status !== "playing") {
        return failure("GAME_NOT_PLAYING", {
            winnerPlayerId: null,
            loserPlayerId,
            finishReason,
        })
    }

    if (roomState.players.length !== 2) {
        return failure("NOT_ENOUGH_PLAYERS", {
            winnerPlayerId: null,
            loserPlayerId,
            finishReason,
        })
    }

    const winnerPlayer = roomState.players.find(player => player.playerId !== loserPlayerId)

    roomState.status = "finished"
    roomState.lobbyPlayerIds = []

    return success(roomState, {
        winnerPlayerId: winnerPlayer.playerId,
        loserPlayerId,
        finishReason,
    })
}

module.exports = {
    createRoom,
    getRoomState,
    joinRoom,
    removePlayer,
    removePlayerBySocketId,
    startGame,
    leaveGame,
    syncRoom,
    leaveRoom,
    finishGame,
}
