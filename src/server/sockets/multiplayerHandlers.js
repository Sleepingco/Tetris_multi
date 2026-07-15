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
    acknowledgeClientInputSequence,
    appendPendingGarbageToOpponent,
    appendPlayerBagChunk,
    applyAuthoritativeInputToMatchPlayerState,
    createMatch,
    deleteMatch,
    getAuthoritativePlayerSnapshotDto,
    getMatchState,
    recordInput,
    validateClientInputSequence,
} = require("../services/matchService.js")
const { loadGameCore } = require("../services/gameCoreLoader.js")
const {
    saveGameEventLog,
    savePlacementDecisionLog,
} = require("../services/logService.js")
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
const EXPECTED_TRANSFORM_ACTIONS = new Set([
    "move_left",
    "move_right",
    "soft_drop",
    "rotate",
    "hard_drop",
])
const VALID_PIECE_TYPES = new Set([
    "bar",
    "eleft",
    "eright",
    "ess",
    "square",
    "tree",
    "zee",
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
    const authoritativePlayerMutationQueue = dependencies.authoritativePlayerMutationQueue
    const loadAuthoritativeGameCore = dependencies.loadGameCore || loadGameCore
    let gameInputProcessingChain = null

    clientSocket.on("room:create", (payload) => {
        const createPayload = payload?.player
            ? payload
            : { player: payload, mode: "pvp" }
        const hostPlayer = createPayload.player
            ? { ...createPayload.player, socketId: clientSocket.id }
            : null
        const result = createRoom(hostPlayer, {
            mode: createPayload.mode,
            aiDifficulty: createPayload.aiDifficulty,
        })

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
        let result = syncRoom(roomId, playerId)
        let shouldResetPlayerGravity = false
        if (result.ok && !isHumanPlayer(result.room, playerId)) {
            result = createNotAuthorizedResult()
        } else if (result.ok) {
            const roomPlayer = result.room.players.find(player => {
                return player.playerId === playerId
            })
            shouldResetPlayerGravity = roomPlayer?.socketId !== clientSocket.id
            result = syncRoom(roomId, playerId, clientSocket.id)
            if (result.ok && shouldResetPlayerGravity) {
                authoritativeTickerService?.resetPlayerGravity?.(roomId, playerId)
            }
        }
        const matchResult = result.ok
            ? getMatchState(roomId)
            : { match: null }

        if (result.ok && result.room) {
            clientSocket.join(result.room.roomId)
        }

        clientSocket.emit("game:join:result", {
            ...result,
            match: createGameJoinMatchDto(matchResult.match),
        })
    })

    // 같은 socket의 입력은 record → relay → authoritative apply 순서로 직렬 처리한다.
    async function processGameInput(payload = {}) {
        const {
            roomId,
            playerId,
            action,
            tick,
            pieceIndex,
            clientSequence,
            expectedTransform,
        } = payload
        let hasEmittedInputResult = false
        const emitInputResult = (ok, reason, snapshot = null, placementCommitted = false) => {
            hasEmittedInputResult = true
            const resultPayload = {
                ok,
                reason,
                clientSequence,
                pieceIndex,
                placementCommitted: ok && placementCommitted === true,
            }
            if (snapshot) resultPayload.snapshot = snapshot
            clientSocket.emit("game:input:result", resultPayload)
        }
        const result = syncRoom(roomId, playerId)

        if (!result.ok) {
            emitInputResult(false, result.reason)
            return
        }

        if (!isAuthorizedHumanSocket(result.room, playerId, clientSocket.id)) {
            emitInputResult(false, "NOT_AUTHORIZED")
            return
        }

        if (result.room.status !== "playing") {
            emitInputResult(false, "GAME_NOT_PLAYING")
            return
        }

        if (!VALID_GAME_ACTIONS.has(action)) {
            emitInputResult(false, "INVALID_ACTION")
            return
        }

        if (!Number.isInteger(tick) || tick < 0
            || !Number.isInteger(pieceIndex) || pieceIndex < 0
            || !Number.isInteger(clientSequence) || clientSequence < 1) {
            emitInputResult(false, "INVALID_INPUT")
            return
        }

        if (
            EXPECTED_TRANSFORM_ACTIONS.has(action) &&
            !isValidExpectedTransform(expectedTransform)
        ) {
            emitInputResult(false, "INVALID_EXPECTED_TRANSFORM")
            return
        }

        const input = {
            action,
            tick,
            pieceIndex,
            clientSequence,
            ...(expectedTransform ? { expectedTransform: { ...expectedTransform } } : {}),
        }
        const sequenceValidation = validateClientInputSequence(roomId, playerId, clientSequence)
        if (!sequenceValidation.ok) {
            if (sequenceValidation.reason === "CLIENT_SEQUENCE_OUT_OF_ORDER") {
                emitAuthoritativeSnapshot(socketServer, roomId, playerId)
            }
            emitInputResult(false, sequenceValidation.reason)
            return
        }
        const inputResult = recordInput(roomId, playerId, input)

        if (!inputResult.ok) {
            emitInputResult(false, inputResult.reason)
            return
        }

        clientSocket.to(roomId).emit("game:input", {
            roomId,
            playerId,
            ...input,
        })

        try {
            await authoritativePlayerMutationQueue.enqueueAuthoritativePlayerMutation(
                roomId,
                playerId,
                async () => {
                    const gameCore = await loadAuthoritativeGameCore()
                    const authoritativeResult = applyAuthoritativeInputToMatchPlayerState(
                        roomId,
                        playerId,
                        input,
                        gameCore,
                    )
                    if (!authoritativeResult.ok) {
                        const snapshot = emitAuthoritativeSnapshot(socketServer, roomId, playerId)
                        emitInputResult(
                            false,
                            authoritativeResult.reason,
                            authoritativeResult.reason === "PREDICTION_DIVERGED"
                                ? snapshot
                                : null,
                        )
                        return
                    }
                    const gameplayResult = authoritativeResult.gameplayResult
                    if (gameplayResult?.holdResult || gameplayResult?.placementResult) {
                        authoritativeTickerService?.resetPlayerGravity?.(
                            roomId,
                            playerId,
                            {
                                lineClear: (gameplayResult.placementResult?.linesCleared ?? 0) > 0,
                            },
                        )
                    }
                    const placementSideEffect = handleServerPlacementResult(
                        roomId,
                        playerId,
                        gameplayResult?.placementResult,
                        createGarbageHoleCol,
                    )

                    emitAuthoritativeSnapshot(
                        socketServer,
                        roomId,
                        playerId,
                        gameplayResult?.presentationEffect,
                    )
                    if (placementSideEffect?.targetPlayerId) {
                        emitAuthoritativeSnapshot(socketServer, roomId, placementSideEffect.targetPlayerId)
                    }
                    emitInputResult(
                        true,
                        null,
                        null,
                        Boolean(gameplayResult?.placementResult),
                    )
                    await handleServerGameOverResult(
                        socketServer,
                        roomId,
                        playerId,
                        gameplayResult?.placementResult,
                        authoritativeTickerService,
                        saveEventLog,
                    )
                },
            )
        } catch {
            if (hasEmittedInputResult) return

            acknowledgeClientInputSequence(roomId, playerId, clientSequence)
            emitAuthoritativeSnapshot(socketServer, roomId, playerId)
            emitInputResult(false, "AUTHORITATIVE_INPUT_FAILED")
        }
    }

    clientSocket.on("game:input", (payload = {}) => {
        const processingResult = gameInputProcessingChain
            ? gameInputProcessingChain.then(() => processGameInput(payload))
            : processGameInput(payload)
        const trackedResult = processingResult
            .catch(() => {})
            .finally(() => {
                if (gameInputProcessingChain === trackedResult) {
                    gameInputProcessingChain = null
                }
            })
        gameInputProcessingChain = trackedResult
        return processingResult
    })

    clientSocket.on("game:log:placement_decision", async (payload = {}) => {
        const { roomId, playerId, log } = payload
        const result = syncRoom(roomId, playerId)

        if (!result.ok) {
            clientSocket.emit("game:log:result", result)
            return
        }

        if (!isAuthorizedHumanSocket(result.room, playerId, clientSocket.id)) {
            clientSocket.emit("game:log:result", {
                ok: false,
                log: null,
                reason: "NOT_AUTHORIZED",
            })
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
            && (
                (log.schemaVersion === 1 && (log.source === undefined || log.source === "human"))
                || (log.schemaVersion === 2 && log.source === "human")
            )
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

        if (!isAuthorizedHumanSocket(result.room, playerId, clientSocket.id)) {
            clientSocket.emit("game:bag:result", createNotAuthorizedResult())
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
        const roomResult = syncRoom(roomId, playerId)
        const result = roomResult.ok && isAuthorizedHumanSocket(
            roomResult.room,
            playerId,
            clientSocket.id,
        )
            ? leaveGame(roomId, playerId)
            : createNotAuthorizedResult()
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
        const currentResult = syncRoom(roomId, playerId)
        const result = currentResult.ok && isHumanPlayer(currentResult.room, playerId)
            ? syncRoom(roomId, playerId, clientSocket.id, {
                location: "lobby",
            })
            : createNotAuthorizedResult()

        if (result.ok && result.room) {
            clientSocket.join(result.room.roomId)
            socketServer.to(result.room.roomId).emit("room:updated", result.room)
        }

        clientSocket.emit("room:result", result)
    })

}

function isValidExpectedTransform(expectedTransform) {
    return expectedTransform !== null
        && typeof expectedTransform === "object"
        && !Array.isArray(expectedTransform)
        && VALID_PIECE_TYPES.has(expectedTransform.pieceType)
        && Number.isInteger(expectedTransform.rotation)
        && expectedTransform.rotation >= 0
        && expectedTransform.rotation < 4
        && Number.isInteger(expectedTransform.col)
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

function emitAuthoritativeSnapshot(socketServer, roomId, playerId, presentationEffect = null) {
    const snapshotResult = getAuthoritativePlayerSnapshotDto(roomId, playerId)
    if (!snapshotResult.ok) return null

    const payload = {
        roomId,
        playerId,
        snapshot: snapshotResult.snapshot,
    }
    if (presentationEffect) {
        payload.presentationEffect = presentationEffect
    }

    socketServer.to(roomId).emit("game:authoritative:snapshot", payload)

    return snapshotResult.snapshot
}

function createGameJoinMatchDto(match) {
    if (!match) return null

    return {
        roomId: match.roomId,
        mode: match.mode || "pvp",
        status: match.status,
        createdAt: match.createdAt,
        players: match.players.map(player => {
            const snapshotResult = getAuthoritativePlayerSnapshotDto(match.roomId, player.playerId)

            return {
                playerId: player.playerId,
                playerType: player.playerType || "human",
                bagChunks: Array.isArray(player.bagChunks)
                    ? player.bagChunks.map(chunk => [...chunk])
                    : [],
                snapshot: snapshotResult.ok ? snapshotResult.snapshot : null,
            }
        }),
    }
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
        mode: room.mode === "pve" ? "pve" : "multi",
        startedAt: match.createdAt || Date.now(),
        players: room.players.map(player => ({
            playerId: player.playerId,
            nickname: player.nickname,
            role: player.playerId === room.hostPlayerId ? "host" : "guest",
            playerType: player.playerType || "human",
        })),
    }
}

function isHumanPlayer(room, playerId) {
    return room?.players?.some(player => {
        return player.playerId === playerId && player.playerType !== "heuristic_ai"
    })
}

function isAuthorizedHumanSocket(room, playerId, socketId) {
    return room?.players?.some(player => {
        return player.playerId === playerId &&
            player.playerType !== "heuristic_ai" &&
            player.socketId === socketId
    })
}

function createNotAuthorizedResult() {
    return {
        ok: false,
        room: null,
        reason: "NOT_AUTHORIZED",
    }
}

module.exports = {
    registerMultiplayerHandlers,
}
