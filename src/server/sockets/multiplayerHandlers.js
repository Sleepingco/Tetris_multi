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
const {
    saveGameEventLog,
    savePlacementDecisionLog,
} = require("../services/logService.js")

const VALID_GAME_ACTIONS = new Set([
    "move_left",
    "move_right",
    "soft_drop",
    "rotate",
    "hard_drop",
    "hold",
])
const VALID_GAME_OVER_REASONS = new Set([
    "top_out",
    "garbage_overflow",
    "leave",
])
const VALID_SNAPSHOT_PHASES = new Set([
    "playing",
    "lineClearing",
    "gameOver",
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

function registerMultiplayerHandlers(socketServer, clientSocket, dependencies = {}) {
    const saveLog = dependencies.savePlacementDecisionLog || savePlacementDecisionLog
    const saveEventLog = dependencies.saveGameEventLog || saveGameEventLog
    const createGarbageHoleCol = dependencies.createGarbageHoleCol || (() => Math.floor(Math.random() * 10))

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

    clientSocket.on("room:start", async (payload = {}) => {
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
            const matchResult = createMatch(result.room)
            if (matchResult.ok) {
                await persistGameEventLog(saveEventLog, createGameStartLog(result.room, matchResult.match))
            }
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

        const hasValidSnapshotScalars = snapshot
            && VALID_SNAPSHOT_PHASES.has(snapshot.phase)
            && Number.isInteger(snapshot.pieceIndex)
            && snapshot.pieceIndex >= 0
            && Number.isInteger(snapshot.tick)
            && snapshot.tick >= 0
            && Number.isFinite(snapshot.score)
            && snapshot.score >= 0
            && Number.isInteger(snapshot.lines)
            && snapshot.lines >= 0

        if (!snapshot || !Array.isArray(snapshot.board) || !hasValidSnapshotScalars) {
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
        const { roomId, playerId, action, tick, pieceIndex } = payload
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

        if (!Number.isInteger(tick) || tick < 0
            || !Number.isInteger(pieceIndex) || pieceIndex < 0) {
            clientSocket.emit("game:input:result", {
                ok: false,
                room: null,
                reason: "INVALID_INPUT",
            })
            return
        }

        const inputResult = recordInput(roomId, playerId, {
            action,
            tick,
            pieceIndex,
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
            pieceIndex,
        })
    })

    clientSocket.on("game:log:placement_decision", async (payload = {}) => {
        const { roomId, playerId, log } = payload
        const result = syncRoom(roomId, playerId)

        if (!result.ok) {
            clientSocket.emit("game:log:result", result)
            return
        }

        if (!log || log.playerId !== playerId) {
            clientSocket.emit("game:log:result", {
                ok: false,
                log: null,
                reason: "NOT_AUTHORIZED",
            })
            return
        }

        const logResult = await saveLog(log)
        clientSocket.emit("game:log:result", logResult)
    })

    clientSocket.on("game:garbage:attack", (payload = {}) => {
        const { roomId, playerId, lines } = payload
        const result = syncRoom(roomId, playerId)

        if (!result.ok) {
            clientSocket.emit("game:garbage:result", result)
            return
        }

        if (result.room.status !== "playing") {
            clientSocket.emit("game:garbage:result", {
                ok: false,
                room: null,
                reason: "GAME_NOT_PLAYING",
            })
            return
        }

        if (!Number.isInteger(lines) || lines <= 0 || lines > 12) {
            clientSocket.emit("game:garbage:result", {
                ok: false,
                room: null,
                reason: "INVALID_GARBAGE_LINES",
            })
            return
        }

        const targetPlayer = result.room.players.find(player => player.playerId !== playerId)
        if (!targetPlayer) {
            clientSocket.emit("game:garbage:result", {
                ok: false,
                room: null,
                reason: "TARGET_PLAYER_NOT_FOUND",
            })
            return
        }

        const eventPayload = {
            roomId,
            fromPlayerId: playerId,
            targetPlayerId: targetPlayer.playerId,
            lines,
            holeCol: createGarbageHoleCol(),
        }

        clientSocket.emit("game:garbage:append", eventPayload)
        clientSocket.to(roomId).emit("game:garbage:append", eventPayload)
    })

    clientSocket.on("game:bag:request", (payload = {}) => {
        const { roomId, playerId } = payload
        const result = syncRoom(roomId, playerId)

        if (!result.ok) {
            clientSocket.emit("game:bag:result", result)
            return
        }

        if (result.room.status !== "playing") {
            clientSocket.emit("game:bag:result", {
                ok: false,
                room: null,
                reason: "GAME_NOT_PLAYING",
            })
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
        const result = syncRoom(roomId, playerId, clientSocket.id, {
            location: "lobby",
        })

        if (result.ok && result.room) {
            clientSocket.join(result.room.roomId)
            socketServer.to(result.room.roomId).emit("room:updated", result.room)
        }

        clientSocket.emit("room:result", result)
    })

    clientSocket.on("game:over", async (payload = {}) => {
        const { roomId, playerId, reason = "top_out" } = payload
        if (!VALID_GAME_OVER_REASONS.has(reason)) {
            clientSocket.emit("game:over:result", {
                ok: false,
                room: null,
                reason: "INVALID_GAME_OVER_REASON",
            })
            return
        }

        const result = finishGame(roomId, playerId, reason)

        if (result.ok) {
            const matchResult = getMatchState(roomId)
            socketServer.to(roomId).emit("match:finish", {
                room: result.room,
                winnerPlayerId: result.winnerPlayerId,
                loserPlayerId: result.loserPlayerId,
                reason: result.finishReason,
            })
            await persistGameEventLog(saveEventLog, createGameOverLog(result, matchResult.match))
            return
        }

        clientSocket.emit("game:over:result", result)
    })
}

async function persistGameEventLog(saveEventLog, log) {
    try {
        await saveEventLog(log)
    } catch (error) {
        console.warn(`[multiplayerHandlers] game event log failed: ${error.message}`)
    }
}

function createGameId(roomId, match) {
    return match?.createdAt
        ? `${roomId}-${match.createdAt}`
        : roomId
}

function createGameStartLog(room, match) {
    return {
        eventType: "game_start",
        schemaVersion: 1,
        gameId: createGameId(room.roomId, match),
        roomId: room.roomId,
        mode: "multi",
        startedAt: match.createdAt || Date.now(),
        players: room.players.map(player => ({
            playerId: player.playerId,
            nickname: player.nickname,
            role: player.playerId === room.hostPlayerId ? "host" : "guest",
        })),
    }
}

function createGameOverLog(result, match) {
    return {
        eventType: "game_over",
        schemaVersion: 1,
        gameId: createGameId(result.room.roomId, match),
        roomId: result.room.roomId,
        mode: "multi",
        endedAt: Date.now(),
        winnerPlayerId: result.winnerPlayerId,
        loserPlayerId: result.loserPlayerId,
        reason: result.finishReason,
        finishType: "normal",
    }
}

module.exports = {
    registerMultiplayerHandlers,
}
