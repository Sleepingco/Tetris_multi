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
    appendPendingGarbageToOpponent,
    appendPlayerBagChunk,
    applyAuthoritativeInputToMatchPlayerState,
    createMatch,
    deleteMatch,
    getAuthoritativePlayerSnapshotDto,
    getMatchState,
    recordInput,
} = require("../services/matchService.js")
const { loadGameCore } = require("../services/gameCoreLoader.js")
const {
    saveGameEventLog,
    savePlacementDecisionLog,
} = require("../services/logService.js")
const {
    createAuthoritativeTickerService,
} = require("../services/authoritativeTickerService.js")
const {
    finishAuthoritativeMatch,
} = require("../services/authoritativeMatchFinish.js")

const VALID_GAME_ACTIONS = new Set([
    "move_left",
    "move_right",
    "soft_drop",
    "rotate",
    "hard_drop",
    "hold",
])
const PLACEMENT_RESULT_NON_NEGATIVE_INTEGER_FIELDS = [
    "linesCleared",
    "combo",
    "rawAttackLines",
    "attackLines",
    "canceledGarbageLines",
    "incomingGarbageLines",
    "appliedGarbageLines",
]
const PLACEMENT_RESULT_NON_NEGATIVE_NUMBER_FIELDS = [
    "scoreBefore",
    "scoreAfter",
]
const PLACEMENT_RESULT_FINITE_NUMBER_FIELDS = [
    "scoreDelta",
]
const PLACEMENT_RESULT_BOOLEAN_FIELDS = [
    "isTSpin",
    "backToBack",
    "gameOver",
]
const defaultAuthoritativeTickerService = createAuthoritativeTickerService()

/**
 * room 퇴장 결과를 Socket.IO room leave와 남은 참가자 broadcast로 연결한다.
 * - 마지막 참가자가 나가 room이 삭제된 경우에는 broadcast할 room이 없으므로 조용히 종료한다.
 *
 * @param {import("socket.io").Server} socketServer - Socket.IO 서버 인스턴스
 * @param {import("socket.io").Socket} clientSocket - 요청한 클라이언트 socket
 * @param {string|null} roomId - Socket.IO room id
 * @param {{ok: boolean, room: Object|null}} result - roomService 퇴장 결과
 * @param {string} nickname - 시스템 메시지에 표시할 닉네임
 * @returns {void}
 */
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

/**
 * 멀티플레이 Socket.IO 이벤트를 등록한다.
 * - 서버는 room/match 상태, 입력 로그, bag chunk, authoritative snapshot 송신을 담당한다.
 * - 클라이언트 입력 relay는 유지하되 garbage/game over는 서버 lock 결과를 기준으로 처리한다.
 *
 * @param {import("socket.io").Server} socketServer - Socket.IO 서버 인스턴스
 * @param {import("socket.io").Socket} clientSocket - 연결된 클라이언트 socket
 * @param {Object} dependencies - 테스트에서 주입할 저장소/난수 의존성
 * @returns {void}
 */
function registerMultiplayerHandlers(socketServer, clientSocket, dependencies = {}) {
    const saveLog = dependencies.savePlacementDecisionLog || savePlacementDecisionLog
    const saveEventLog = dependencies.saveGameEventLog || saveGameEventLog
    const createGarbageHoleCol = dependencies.createGarbageHoleCol || (() => Math.floor(Math.random() * 10))
    const authoritativeTickerService = dependencies.authoritativeTickerService
        || defaultAuthoritativeTickerService

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
            authoritativeTickerService.stopRoomTicker(result.roomId)
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
        const result = removePlayerBySocketId(clientSocket.id)
        if (result.ok && result.roomId) {
            authoritativeTickerService.stopRoomTicker(result.roomId)
        }

        handlePlayerLeftRoom(
            socketServer,
            clientSocket,
            result.roomId,
            result,
            result.player?.nickname || "Player",
        )
    })

    // room 상태를 playing으로 바꾸고 matchService에 player별 input log/server bag을 만든다.
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
                authoritativeTickerService.startRoomTicker(result.room.roomId, socketServer)
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

    // 입력은 기존 relay를 유지하면서 match authoritativeState에도 best-effort로 반영한다.
    clientSocket.on("game:input", async (payload = {}) => {
        const { roomId, playerId, action, tick, pieceIndex } = payload
        const result = syncRoom(roomId, playerId)

        if (!result.ok) {
            clientSocket.emit("game:input:result", result)
            return
        }

        if (result.room.status !== "playing") {
            clientSocket.emit("game:input:result", {
                ok: false,
                room: null,
                reason: "GAME_NOT_PLAYING",
            })
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

        const input = {
            action,
            tick,
            pieceIndex,
        }
        const inputResult = recordInput(roomId, playerId, input)

        if (!inputResult.ok) {
            clientSocket.emit("game:input:result", inputResult)
            return
        }

        clientSocket.to(roomId).emit("game:input", {
            roomId,
            playerId,
            ...input,
        })

        try {
            const gameCore = await loadGameCore()
            const authoritativeResult = applyAuthoritativeInputToMatchPlayerState(roomId, playerId, input, gameCore)
            if (!authoritativeResult.ok) return
            const placementSideEffect = handleServerPlacementResult(
                roomId,
                playerId,
                authoritativeResult.gameplayResult?.placementResult,
                createGarbageHoleCol,
            )

            emitAuthoritativeSnapshot(socketServer, roomId, playerId)
            if (placementSideEffect?.targetPlayerId) {
                emitAuthoritativeSnapshot(socketServer, roomId, placementSideEffect.targetPlayerId)
            }
            await handleServerGameOverResult(
                socketServer,
                roomId,
                playerId,
                authoritativeResult.gameplayResult?.placementResult,
                authoritativeTickerService,
                saveEventLog,
            )
        } catch {
            // Authoritative side-effect failure must not block MVP input relay.
        }
    })

    clientSocket.on("game:log:placement_decision", async (payload = {}) => {
        const { roomId, playerId, log } = payload
        const result = syncRoom(roomId, playerId)

        if (!result.ok) {
            clientSocket.emit("game:log:result", result)
            return
        }

        if (result.room.status !== "playing" && result.room.status !== "finished") {
            clientSocket.emit("game:log:result", {
                ok: false,
                log: null,
                reason: "GAME_LOG_NOT_ALLOWED",
            })
            return
        }

        const placementResult = log?.placementResult
        const hasValidPlacementResultScalars = placementResult
            && typeof placementResult === "object"
            && !Array.isArray(placementResult)
            && PLACEMENT_RESULT_NON_NEGATIVE_INTEGER_FIELDS.every(field => (
                Number.isInteger(placementResult[field]) && placementResult[field] >= 0
            ))
            && PLACEMENT_RESULT_NON_NEGATIVE_NUMBER_FIELDS.every(field => (
                Number.isFinite(placementResult[field]) && placementResult[field] >= 0
            ))
            && PLACEMENT_RESULT_FINITE_NUMBER_FIELDS.every(field => (
                Number.isFinite(placementResult[field])
            ))
            && PLACEMENT_RESULT_BOOLEAN_FIELDS.every(field => (
                typeof placementResult[field] === "boolean"
            ))
        const hasValidPlacementDecisionLog = log
            && typeof log === "object"
            && !Array.isArray(log)
            && log.playerId === playerId
            && log.roomId === roomId
            && log.eventType === "placement_decision"
            && hasValidPlacementResultScalars

        if (!hasValidPlacementDecisionLog) {
            clientSocket.emit("game:log:result", {
                ok: false,
                log: null,
                reason: "INVALID_PLACEMENT_DECISION_LOG",
            })
            return
        }

        const logResult = await saveLog(log)
        clientSocket.emit("game:log:result", logResult)
    })

    // server bag chunk를 player별로 추가해 로컬/상대 런타임의 다음 조각 공급을 맞춘다.
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
            authoritativeTickerService.stopRoomTicker(roomId)
            deleteMatch(roomId)
            clientSocket.leave(roomId)
            clientSocket.to(roomId).emit("game:opponent-left", {
                room: result.room,
                playerId
            })
        }

        clientSocket.emit("game:leave:result", result)

    })

    // 로비 복귀 시 최신 socketId를 room player에 다시 연결하고 finished room 복귀 조건을 확인한다.
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

}

function handleServerPlacementResult(roomId, playerId, placementResult, createGarbageHoleCol) {
    const attackLines = placementResult?.attackLines ?? 0
    if (!Number.isInteger(attackLines) || attackLines <= 0) return null

    const garbage = {
        lines: attackLines,
        holeCol: createGarbageHoleCol(),
    }
    const appendResult = appendPendingGarbageToOpponent(roomId, playerId, garbage)
    if (!appendResult.ok) return null

    return appendResult
}

function emitAuthoritativeSnapshot(socketServer, roomId, playerId) {
    const snapshotResult = getAuthoritativePlayerSnapshotDto(roomId, playerId)
    if (!snapshotResult.ok) return null

    socketServer.to(roomId).emit("game:authoritative:snapshot", {
        roomId,
        playerId,
        snapshot: snapshotResult.snapshot,
    })

    return snapshotResult.snapshot
}

async function handleServerGameOverResult(
    socketServer,
    roomId,
    loserPlayerId,
    placementResult,
    authoritativeTickerService,
    saveEventLog,
) {
    if (!placementResult?.gameOver) return

    await finishAuthoritativeMatch({
        roomId,
        loserPlayerId,
        finishGame,
        stopRoomTicker: authoritativeTickerService.stopRoomTicker,
        emitMatchFinish(payload) {
            socketServer.to(roomId).emit("match:finish", payload)
        },
        saveGameEventLog: saveEventLog,
        getMatchState,
        deleteMatch,
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

module.exports = {
    registerMultiplayerHandlers,
}
