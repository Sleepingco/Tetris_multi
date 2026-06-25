const {
    createRoom,
    joinRoom,
    removePlayerBySocketId,
    startGame,
    leaveGame,
    syncRoom,
    leaveRoom,
    finishGame,
} = require("../services/roomService.js")

const {
    appendPlayerBagChunk,
    createMatch,
    getMatchState,
    recordInput,
} = require("../services/matchService.js")

const VALID_GAME_ACTIONS = new Set([
    "move_left",
    "move_right",
    "soft_drop",
    "rotate",
    "hard_drop",
    "hold",
])

function handlePlayerLeftRoom(socketServer, clientSocket, roomId, result, nickname) {
    if (!result.ok) return

    clientSocket.leave(roomId)

    if (!result.room) return

    socketServer.to(roomId).emit("room:updated", result.room)
    socketServer.to(roomId).emit("room:message", {
        type: "system",
        text: `${nickname}님이 퇴장하였습니다.`,
        roomId: result.room.roomId,
    })
}

function handlePlayerJoinedRoom(socketServer, clientSocket, result, nickname) {
    if (!result.ok || !result.room) {
        clientSocket.emit("room:result", result)
        return
    }

    clientSocket.join(result.room.roomId)
    clientSocket.emit("room:result", result)
    socketServer.to(result.room.roomId).emit("room:updated", result.room)
    socketServer.to(result.room.roomId).emit("room:message", {
        type: "system",
        text: `${nickname}님이 입장하였습니다.`,
        roomId: result.room.roomId,
    })
}

function registerMultiplayerHandlers(socketServer, clientSocket) {
    clientSocket.on("room:create", (player) => {
        const hostPlayer = player
            ? { ...player, socketId: clientSocket.id }
            : null
        const result = createRoom(hostPlayer)

        if (result.ok) {
            clientSocket.join(result.room.roomId);
        }
        clientSocket.emit("room:result", result)
    })

    clientSocket.on("room:join", ({ roomId, player }) => {
        const guestPlayer = player
            ? { ...player, socketId: clientSocket.id }
            : null
        const result = joinRoom(roomId, guestPlayer)
        handlePlayerJoinedRoom(socketServer, clientSocket, result, guestPlayer?.nickname || "Player")
    })

    clientSocket.on("room:leave", ({ roomId, playerId }) => {
        const result = leaveRoom(roomId, playerId)
        handlePlayerLeftRoom(
            socketServer,
            clientSocket,
            result.roomId,
            result,
            result.player?.nickname || "Player",
        )

        clientSocket.emit("room:result", result)
    })

    clientSocket.on("disconnect", () => {
        const result = removePlayerBySocketId(clientSocket.id)

        handlePlayerLeftRoom(
            socketServer,
            clientSocket,
            result.roomId,
            result,
            result.player?.nickname || "Player",
        )
    })

    clientSocket.on("room:start", (payload = {}) => {
        const { roomId, playerId } = payload
        const result = startGame(roomId, playerId, clientSocket.id)

        if (result.ok && result.room) {
            const hostPlayer = result.room.players.find(player => player.playerId === playerId)

            clientSocket.emit("room:result", result)
            socketServer.to(result.room.roomId).emit("room:updated", result.room);
            socketServer.to(result.room.roomId).emit("room:message", {
                type: "system",
                text: `${hostPlayer?.nickname || "Host"}님이 게임을 시작했습니다.`,
                roomId: result.room.roomId,
            })
            createMatch(result.room)
        } else {
            clientSocket.emit("room:result", result)
        }
    })

    clientSocket.on("game:join", (payload = {}) => {
        const { roomId, playerId } = payload
        const result = syncRoom(roomId, playerId)
        const matchResult = result.ok
            ? getMatchState(roomId)
            : { match: null }

        if (result.ok && result.room) {
            clientSocket.join(result.room.roomId)
        }

        clientSocket.emit("game:join:result", {
            ...result,
            match: matchResult.match,
        })
    })

    clientSocket.on("game:snapshot", (payload = {}) => {
        const { roomId, playerId, snapshot } = payload
        const result = syncRoom(roomId, playerId)

        if (!result.ok) {
            clientSocket.emit("game:snapshot:result", result)
            return
        }

        if (!snapshot || !Array.isArray(snapshot.board)) {
            clientSocket.emit("game:snapshot:result", {
                ok: false,
                room: null,
                reason: "INVALID_SNAPSHOT",
            })
            return
        }

        clientSocket.to(roomId).emit("game:snapshot", { playerId, snapshot })
    })

    clientSocket.on("game:input", (payload = {}) => {
        const { roomId, playerId, action, tick } = payload
        const result = syncRoom(roomId, playerId)

        if (!result.ok) {
            clientSocket.emit("game:input:result", result)
            return
        }

        if (!VALID_GAME_ACTIONS.has(action)) {
            clientSocket.emit("game:input:result", {
                ok: false,
                room: null,
                reason: "INVALID_ACTION",
            })
            return
        }
        const inputResult = recordInput(roomId, playerId, {
            action,
            tick,
        })

        if (!inputResult.ok) {
            clientSocket.emit("game:input:result", inputResult)
            return
        }

        clientSocket.to(roomId).emit("game:input", {
            roomId,
            playerId,
            action,
            tick,
        })
    })

    clientSocket.on("game:bag:request", (payload = {}) => {
        const { roomId, playerId } = payload
        const result = syncRoom(roomId, playerId)

        if (!result.ok) {
            clientSocket.emit("game:bag:result", result)
            return
        }

        const bagResult = appendPlayerBagChunk(roomId, playerId)

        if (!bagResult.ok) {
            clientSocket.emit("game:bag:result", bagResult)
            return
        }

        socketServer.to(roomId).emit("game:bag:append", {
            roomId,
            playerId,
            bagChunk: bagResult.bagChunk,
        })
    })

    clientSocket.on("game:leave", (payload = {}) => {
        const { roomId, playerId } = payload
        const result = leaveGame(roomId, playerId)
        if (result.ok) {
            clientSocket.leave(roomId)
            clientSocket.to(roomId).emit("game:opponent-left", {
                room: result.room,
                playerId
            })
        }

        clientSocket.emit("game:leave:result", result)

    })

    clientSocket.on("room:sync", (payload = {}) => {
        const { roomId, playerId } = payload
        const result = syncRoom(roomId, playerId, clientSocket.id)

        if (result.ok && result.room) {
            clientSocket.join(result.room.roomId)
        }

        clientSocket.emit("room:result", result)
    })

    clientSocket.on("game:over", (payload = {}) => {
        const { roomId, playerId, reason = "top_out" } = payload
        const result = finishGame(roomId, playerId, reason)

        if (result.ok) {
            socketServer.to(roomId).emit("match:finish", {
                room: result.room,
                winnerPlayerId: result.winnerPlayerId,
                loserPlayerId: result.loserPlayerId,
                reason: result.finishReason,
            })
            return
        }

        clientSocket.emit("game:over:result", result)
    })
}


module.exports = {
    registerMultiplayerHandlers,
}
