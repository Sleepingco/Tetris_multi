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
    deleteMatch,
    getPlayerAuthoritativeSnapshot,
    getPlayerShadowState,
    getMatchState,
    recordClientSnapshot,
    recordClientPlacementDecision,
    recordGarbageAttack,
    recordInput,
    startShadowMatchLoop,
} = require("../services/matchService.js")
const {
    saveGameEventLog,
    savePlacementDecisionLog,
} = require("../services/logService.js")
const {
    validateGameSnapshot,
} = require("../validators/gameSnapshotValidator.js")

const VALID_GAME_ACTIONS = new Set([
    "move_left",
    "move_right",
    "soft_drop",
    "rotate",
    "hard_drop",
    "hold",
])

const authoritativeSnapshotSubscribers = new Map()
const authoritativeSnapshotUpdateSequences = new Map()

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

function addAuthoritativeSnapshotSubscriber(roomId, clientSocket) {
    if (!authoritativeSnapshotSubscribers.has(roomId)) {
        authoritativeSnapshotSubscribers.set(roomId, new Set())
    }

    authoritativeSnapshotSubscribers.get(roomId).add(clientSocket)
}

function removeAuthoritativeSnapshotSubscriber(roomId, clientSocket) {
    const subscribers = authoritativeSnapshotSubscribers.get(roomId)
    if (!subscribers) return

    subscribers.delete(clientSocket)

    if (subscribers.size === 0) {
        authoritativeSnapshotSubscribers.delete(roomId)
    }
}

function removeAuthoritativeSnapshotSubscribersForRoom(roomId) {
    authoritativeSnapshotSubscribers.delete(roomId)
    clearAuthoritativeSnapshotUpdateSequence(roomId)
}

function removeAuthoritativeSnapshotSubscriberFromAllRooms(clientSocket) {
    authoritativeSnapshotSubscribers.forEach((subscribers, roomId) => {
        subscribers.delete(clientSocket)

        if (subscribers.size === 0) {
            authoritativeSnapshotSubscribers.delete(roomId)
        }
    })
}

function getNextAuthoritativeSnapshotUpdateSequence(roomId) {
    const nextSequence = (authoritativeSnapshotUpdateSequences.get(roomId) ?? 0) + 1
    authoritativeSnapshotUpdateSequences.set(roomId, nextSequence)

    return nextSequence
}

function clearAuthoritativeSnapshotUpdateSequence(roomId) {
    authoritativeSnapshotUpdateSequences.delete(roomId)
}

function broadcastAuthoritativeSnapshotUpdates(roomId, loopResult, updateReason = null) {
    if (!loopResult?.ok || !loopResult.match) return

    const subscribers = authoritativeSnapshotSubscribers.get(roomId)
    if (!subscribers || subscribers.size === 0) return

    const updateSequence = getNextAuthoritativeSnapshotUpdateSequence(roomId)
    subscribers.forEach((subscriberSocket) => {
        emitAuthoritativeSnapshotUpdatesToSocket(
            roomId,
            loopResult.match,
            subscriberSocket,
            updateReason,
            updateSequence,
        )
    })
}

function emitAuthoritativeSnapshotUpdatesToSocket(
    roomId,
    match,
    clientSocket,
    updateReason = null,
    updateSequence = null,
) {
    if (!match || !Array.isArray(match.players)) return

    match.players.forEach((player) => {
        const snapshotResult = {
            ...getPlayerAuthoritativeSnapshot(roomId, player.playerId),
            updateReason,
            updateSequence,
        }
        clientSocket.emit("game:authoritative:snapshot:update", snapshotResult)
    })
}

function registerMultiplayerHandlers(socketServer, clientSocket, dependencies = {}) {
    const saveLog = dependencies.savePlacementDecisionLog || savePlacementDecisionLog
    const saveEventLog = dependencies.saveGameEventLog || saveGameEventLog
    const startShadowLoop = dependencies.startShadowMatchLoop || startShadowMatchLoop
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
        if (result.ok) {
            removeAuthoritativeSnapshotSubscriber(result.roomId, clientSocket)
        }
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
        removeAuthoritativeSnapshotSubscriberFromAllRooms(clientSocket)

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
                clearAuthoritativeSnapshotUpdateSequence(result.room.roomId)
                startShadowLoop(result.room.roomId, undefined, (loopResult) => {
                    broadcastAuthoritativeSnapshotUpdates(result.room.roomId, loopResult, "shadow_tick")
                })
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

        const snapshotValidation = validateGameSnapshot(snapshot)
        if (!snapshotValidation.ok) {
            clientSocket.emit("game:snapshot:result", {
                ok: false,
                room: null,
                reason: "INVALID_SNAPSHOT",
            })
            return
        }

        const snapshotRecordResult = recordClientSnapshot(roomId, playerId, snapshot)
        if (!snapshotRecordResult.ok) {
            clientSocket.emit("game:snapshot:result", snapshotRecordResult)
            return
        }

        clientSocket.to(roomId).emit("game:snapshot", { playerId, snapshot })
    })

    clientSocket.on("game:shadow:state", (payload = {}) => {
        const { roomId, playerId } = payload
        const result = syncRoom(roomId, playerId)

        if (!result.ok) {
            clientSocket.emit("game:shadow:state:result", {
                ok: false,
                shadow: null,
                reason: result.reason,
            })
            return
        }

        const shadowResult = getPlayerShadowState(roomId, playerId)
        clientSocket.emit("game:shadow:state:result", shadowResult)
    })

    clientSocket.on("game:authoritative:snapshot", (payload = {}) => {
        const { roomId, playerId } = payload
        const result = syncRoom(roomId, playerId)

        if (!result.ok) {
            clientSocket.emit("game:authoritative:snapshot:result", {
                ok: false,
                roomId,
                playerId,
                source: "server_shadow",
                snapshot: null,
                createdAt: Date.now(),
                reason: result.reason,
            })
            return
        }

        const snapshotResult = getPlayerAuthoritativeSnapshot(roomId, playerId)
        clientSocket.emit("game:authoritative:snapshot:result", snapshotResult)
    })

    clientSocket.on("game:authoritative:snapshot:subscribe", (payload = {}) => {
        const { roomId, playerId } = payload
        const result = syncRoom(roomId, playerId)

        if (!result.ok) {
            clientSocket.emit("game:authoritative:snapshot:subscribe:result", result)
            return
        }

        const matchResult = getMatchState(roomId)
        if (!matchResult.ok) {
            clientSocket.emit("game:authoritative:snapshot:subscribe:result", matchResult)
            return
        }

        addAuthoritativeSnapshotSubscriber(roomId, clientSocket)
        clientSocket.emit("game:authoritative:snapshot:subscribe:result", {
            ok: true,
            room: result.room,
            reason: null,
        })
        emitAuthoritativeSnapshotUpdatesToSocket(
            roomId,
            matchResult.match,
            clientSocket,
            "subscribe_initial",
            getNextAuthoritativeSnapshotUpdateSequence(roomId),
        )
    })

    clientSocket.on("game:authoritative:snapshot:unsubscribe", (payload = {}) => {
        const { roomId, playerId } = payload
        const result = syncRoom(roomId, playerId)

        if (!result.ok) {
            clientSocket.emit("game:authoritative:snapshot:unsubscribe:result", result)
            return
        }

        removeAuthoritativeSnapshotSubscriber(roomId, clientSocket)
        clientSocket.emit("game:authoritative:snapshot:unsubscribe:result", {
            ok: true,
            room: result.room,
            reason: null,
        })
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
        const inputResult = recordInput(roomId, playerId, {
            action,
            tick,
            pieceIndex,
        })

        if (!inputResult.ok) {
            clientSocket.emit("game:input:result", inputResult)
            return
        }

        broadcastAuthoritativeSnapshotUpdates(roomId, inputResult, "input")

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
        if (logResult.ok && log.placementResult) {
            const placementResult = recordClientPlacementDecision(roomId, playerId, log)
            if (placementResult.ok) {
                broadcastAuthoritativeSnapshotUpdates(roomId, placementResult, "placement")
            }
        }
        clientSocket.emit("game:log:result", logResult)
    })

    clientSocket.on("game:garbage:attack", (payload = {}) => {
        const { roomId, playerId, lines } = payload
        const result = syncRoom(roomId, playerId)

        if (!result.ok) {
            clientSocket.emit("game:garbage:result", result)
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
        const garbageResult = recordGarbageAttack(
            roomId,
            playerId,
            targetPlayer.playerId,
            eventPayload,
        )

        if (!garbageResult.ok) {
            clientSocket.emit("game:garbage:result", garbageResult)
            return
        }

        broadcastAuthoritativeSnapshotUpdates(roomId, garbageResult, "garbage")

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

        const bagResult = appendPlayerBagChunk(roomId, playerId)

        if (!bagResult.ok) {
            clientSocket.emit("game:bag:result", bagResult)
            return
        }

        broadcastAuthoritativeSnapshotUpdates(roomId, bagResult, "bag")

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
            removeAuthoritativeSnapshotSubscriber(roomId, clientSocket)
            deleteMatch(roomId)
            clearAuthoritativeSnapshotUpdateSequence(roomId)
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
        const result = finishGame(roomId, playerId, reason)

        if (result.ok) {
            removeAuthoritativeSnapshotSubscribersForRoom(roomId)
            const matchResult = getMatchState(roomId)
            deleteMatch(roomId)
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
