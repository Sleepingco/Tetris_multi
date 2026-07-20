const {
    createRoom,
    findRoomByPlayerId,
    joinRoom,
    startGame,
    leaveGame,
    syncRoom,
    leaveRoom,
    finishGame,
} = require("../services/roomService.js")

const {
    acknowledgeClientInputSequence,
    appendPendingGarbageToOpponent,
    applyAuthoritativeInputToMatchPlayerState,
    createMatch,
    deleteMatch,
    ensurePlayerBagQueue,
    getAuthoritativePlayerSnapshotDto,
    getMatchState,
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
const {
    createPublicRoomResult,
    createRoomPublicDto,
} = require("../services/roomPublicDto.js")
const {
    validatePlacementDecisionLog,
} = require("../validators/gameLogValidator.js")
const { parseClientEvent } = require("../../shared/socketContracts.mjs")

const DISCONNECT_GRACE_MS = 30_000
const MAX_OUTSTANDING_GAME_INPUTS = 120
const PRIVATE_FIELD_NAMES = new Set([
    "token",
    "tokenDigest",
    "reconnectToken",
    "generation",
    "socketId",
    "expiresAt",
])

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

    socketServer.to(roomId).emit("room:updated", createRoomPublicDto(result.room))
    socketServer.to(roomId).emit("room:message", {
        type: "system",
        text: `${nickname}님이 퇴장하였습니다.`,
        roomId: result.room.roomId,
    })
}

function handlePlayerJoinedRoom(socketServer, clientSocket, result, nickname) {
    if (!result.ok || !result.room) {
        clientSocket.emit("room:result", createPublicRoomResult(result))
        return
    }

    clientSocket.join(result.room.roomId)
    clientSocket.emit("room:result", createPublicRoomResult(result))
    socketServer.to(result.room.roomId).emit("room:updated", createRoomPublicDto(result.room))
    socketServer.to(result.room.roomId).emit("room:message", {
        type: "system",
        text: `${nickname}님이 입장하였습니다.`,
        roomId: result.room.roomId,
    })
}

function containsPrivateField(value) {
    if (!value || typeof value !== "object") return false
    if (Array.isArray(value)) return value.some(containsPrivateField)

    return Object.entries(value).some(([key, child]) => {
        return PRIVATE_FIELD_NAMES.has(key) || containsPrivateField(child)
    })
}

/**
 * 멀티플레이 Socket.IO 이벤트를 등록한다.
 * - 서버는 room/match 상태, bag chunk, authoritative snapshot 송신을 담당한다.
 * - garbage/game over는 서버 authoritative lock 결과를 기준으로 처리한다.
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
    const playerSessionService = dependencies.playerSessionService
    const socketRateLimitService = dependencies.socketRateLimitService
    const disconnectGraceContexts = dependencies.disconnectGraceContexts
    const now = dependencies.now || Date.now
    const setTimeoutFn = dependencies.setTimeoutFn || setTimeout
    const disconnectGraceMs = dependencies.disconnectGraceMs || DISCONNECT_GRACE_MS
    const sessionContext = clientSocket.data?.playerSession
    const playerIdentity = clientSocket.data?.playerIdentity
    const getPlayerId = () => playerIdentity?.playerId
    let gameInputProcessingChain = null
    let outstandingGameInputCount = 0
    let hasJoinedGame = false

    function isActiveSession() {
        return playerSessionService?.isActiveSocket(sessionContext, clientSocket.id) === true
    }

    function consumeRateLimit(bucket) {
        return socketRateLimitService?.consume(bucket, getPlayerId()) !== false
    }

    function isAuthorizedRoom(roomId) {
        if (!isActiveSession()) return createNotAuthorizedResult()

        const result = syncRoom(roomId, getPlayerId())
        return result.ok && isHumanPlayer(result.room, getPlayerId())
            ? result
            : createNotAuthorizedResult()
    }

    function emitRoomResult(result) {
        clientSocket.emit("room:result", createPublicRoomResult(result))
    }

    function emitInvalidRoomResult() {
        emitRoomResult({
            ok: false,
            room: null,
            reason: "INVALID_PAYLOAD",
        })
    }

    clientSocket.on("room:create", (payload) => {
        if (!isActiveSession()) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        if (!consumeRateLimit("lifecycle")) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        const validation = parseClientEvent("room:create", payload)
        if (!validation.success) {
            emitInvalidRoomResult()
            return
        }
        const createPayload = validation.data
        const hostPlayer = {
            playerId: getPlayerId(),
            nickname: playerIdentity.nickname,
        }
        const result = createRoom(hostPlayer, {
            mode: createPayload.mode || "pvp",
            aiDifficulty: createPayload.aiDifficulty,
            aiPolicy: createPayload.aiPolicy,
        })

        if (result.ok) {
            clientSocket.join(result.room.roomId);
        }
        emitRoomResult(result)
    })

    clientSocket.on("room:join", (payload) => {
        if (!isActiveSession()) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        if (!consumeRateLimit("lifecycle")) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        const validation = parseClientEvent("room:join", payload)
        if (!validation.success) {
            emitInvalidRoomResult()
            return
        }
        const { roomId } = validation.data
        const guestPlayer = {
            playerId: getPlayerId(),
            nickname: playerIdentity.nickname,
        }
        const result = joinRoom(roomId, guestPlayer)
        handlePlayerJoinedRoom(socketServer, clientSocket, result, guestPlayer.nickname)
    })

    clientSocket.on("room:leave", (payload) => {
        if (!isActiveSession()) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        if (!consumeRateLimit("lifecycle")) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        const validation = parseClientEvent("room:leave", payload)
        if (!validation.success) {
            emitInvalidRoomResult()
            return
        }
        const { roomId } = validation.data
        const roomResult = isAuthorizedRoom(roomId)
        const result = roomResult.ok
            ? leaveRoom(roomId, getPlayerId())
            : roomResult
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

        emitRoomResult(result)
    })

    clientSocket.on("disconnect", () => {
        gameInputProcessingChain = null
        outstandingGameInputCount = 0
        if (!playerSessionService?.markDisconnected(sessionContext, clientSocket.id)) return

        const disconnectedAt = now()
        const graceContext = {
            generation: sessionContext.generation,
            disconnectedAt,
            timer: null,
        }
        graceContext.timer = setTimeoutFn(async () => {
            const current = disconnectGraceContexts.get(getPlayerId())
            if (
                current?.generation !== sessionContext.generation
                || current?.disconnectedAt !== disconnectedAt
                || !playerSessionService.isDisconnectedSession(sessionContext)
            ) {
                return
            }

            disconnectGraceContexts.delete(getPlayerId())
            await handleDisconnectGraceExpired({
                socketServer,
                playerId: getPlayerId(),
                authoritativeTickerService,
                saveEventLog,
            })
        }, disconnectGraceMs)
        graceContext.timer?.unref?.()
        disconnectGraceContexts.set(getPlayerId(), graceContext)
    })

    // room 상태를 playing으로 바꾸고 matchService에 player별 input log/server bag을 만든다.
    clientSocket.on("room:start", async (payload) => {
        if (!isActiveSession()) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        if (!consumeRateLimit("lifecycle")) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        const validation = parseClientEvent("room:start", payload)
        if (!validation.success) {
            emitInvalidRoomResult()
            return
        }
        const { roomId } = validation.data
        const roomResult = isAuthorizedRoom(roomId)
        const result = roomResult.ok
            ? startGame(roomId, getPlayerId())
            : roomResult

        if (result.ok && result.room) {
            const hostPlayer = result.room.players.find(player => player.playerId === getPlayerId())

            emitRoomResult(result)
            socketServer.to(result.room.roomId).emit("room:updated", createRoomPublicDto(result.room));
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
            emitRoomResult(result)
        }
    })

    clientSocket.on("game:join", (payload) => {
        if (!isActiveSession()) {
            clientSocket.emit("game:join:result", {
                ...createPublicRoomResult(createNotAuthorizedResult()),
                match: null,
            })
            return
        }
        if (!consumeRateLimit("lifecycle")) {
            clientSocket.emit("game:join:result", {
                ...createPublicRoomResult(createNotAuthorizedResult()),
                match: null,
            })
            return
        }
        const validation = parseClientEvent("game:join", payload)
        if (!validation.success) {
            clientSocket.emit("game:join:result", {
                ...createPublicRoomResult({
                    ok: false,
                    room: null,
                    reason: "INVALID_PAYLOAD",
                }),
                match: null,
            })
            return
        }
        const { roomId } = validation.data
        const result = isAuthorizedRoom(roomId)
        if (result.ok && !hasJoinedGame) {
            authoritativeTickerService?.resetPlayerGravity?.(roomId, getPlayerId())
            hasJoinedGame = true
        }
        const matchResult = result.ok
            ? getMatchState(roomId)
            : { match: null }

        if (result.ok && result.room) {
            clientSocket.join(result.room.roomId)
        }

        clientSocket.emit("game:join:result", {
            ...createPublicRoomResult(result),
            match: createGameJoinMatchDto(matchResult.match),
        })
    })

    // 같은 socket의 입력은 validation → authoritative apply 순서로 직렬 처리한다.
    async function processGameInput(payload) {
        const {
            roomId,
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
        if (!isActiveSession()) {
            emitInputResult(false, "NOT_AUTHORIZED")
            return
        }
        const result = isAuthorizedRoom(roomId)

        if (!result.ok) {
            emitInputResult(false, result.reason)
            return
        }

        if (result.room.status !== "playing") {
            emitInputResult(false, "GAME_NOT_PLAYING")
            return
        }

        const input = {
            action,
            tick,
            pieceIndex,
            clientSequence,
            ...(expectedTransform ? { expectedTransform: { ...expectedTransform } } : {}),
        }
        const sequenceValidation = validateClientInputSequence(roomId, getPlayerId(), clientSequence)
        if (!sequenceValidation.ok) {
            if (sequenceValidation.reason === "CLIENT_SEQUENCE_OUT_OF_ORDER") {
                emitAuthoritativeSnapshot(socketServer, roomId, getPlayerId())
            }
            emitInputResult(false, sequenceValidation.reason)
            return
        }
        try {
            await authoritativePlayerMutationQueue.enqueueAuthoritativePlayerMutation(
                roomId,
                getPlayerId(),
                async () => {
                    if (!isActiveSession()) {
                        emitInputResult(false, "NOT_AUTHORIZED")
                        return
                    }
                    const gameCore = await loadAuthoritativeGameCore()
                    if (!isActiveSession()) {
                        emitInputResult(false, "NOT_AUTHORIZED")
                        return
                    }
                    const authoritativeResult = applyAuthoritativeInputToMatchPlayerState(
                        roomId,
                        getPlayerId(),
                        input,
                        gameCore,
                    )
                    if (!authoritativeResult.ok) {
                        const snapshot = emitAuthoritativeSnapshot(socketServer, roomId, getPlayerId())
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
                            getPlayerId(),
                            {
                                lineClear: (gameplayResult.placementResult?.linesCleared ?? 0) > 0,
                            },
                        )
                    }
                    const placementSideEffect = handleServerPlacementResult(
                        roomId,
                        getPlayerId(),
                        gameplayResult?.placementResult,
                        createGarbageHoleCol,
                    )

                    const snapshot = emitAuthoritativeSnapshot(
                        socketServer,
                        roomId,
                        getPlayerId(),
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
                        getPlayerId(),
                        gameplayResult?.placementResult || gameplayResult?.holdResult,
                        snapshot,
                        authoritativeTickerService,
                        saveEventLog,
                    )
                },
            )
        } catch {
            if (hasEmittedInputResult) return

            if (isActiveSession()) {
                acknowledgeClientInputSequence(roomId, getPlayerId(), clientSequence)
                emitAuthoritativeSnapshot(socketServer, roomId, getPlayerId())
            }
            emitInputResult(false, "AUTHORITATIVE_INPUT_FAILED")
        }
    }

    clientSocket.on("game:input", (payload) => {
        if (!isActiveSession()) {
            clientSocket.emit("game:input:result", {
                ok: false,
                reason: "NOT_AUTHORIZED",
                placementCommitted: false,
            })
            return null
        }
        if (!consumeRateLimit("input")) {
            clientSocket.emit("game:input:result", {
                ok: false,
                reason: "RATE_LIMITED",
                ...createSafeInputMetadata(payload),
                placementCommitted: false,
            })
            return null
        }
        const validation = parseClientEvent("game:input", payload)
        if (!validation.success) {
            clientSocket.emit("game:input:result", {
                ok: false,
                reason: "INVALID_PAYLOAD",
                ...createSafeInputMetadata(payload),
                placementCommitted: false,
            })
            return null
        }
        if (outstandingGameInputCount >= MAX_OUTSTANDING_GAME_INPUTS) {
            clientSocket.emit("game:input:result", {
                ok: false,
                reason: "TOO_MANY_PENDING_INPUTS",
                clientSequence: validation.data.clientSequence,
                pieceIndex: validation.data.pieceIndex,
                placementCommitted: false,
            })
            return null
        }
        outstandingGameInputCount += 1
        const processingResult = gameInputProcessingChain
            ? gameInputProcessingChain.then(() => processGameInput(validation.data))
            : processGameInput(validation.data)
        const trackedResult = processingResult
            .catch(() => {})
            .finally(() => {
                outstandingGameInputCount = Math.max(0, outstandingGameInputCount - 1)
                if (gameInputProcessingChain === trackedResult) {
                    gameInputProcessingChain = null
                }
            })
        gameInputProcessingChain = trackedResult
        return trackedResult
    })

    clientSocket.on("game:log:placement_decision", async (payload) => {
        if (!isActiveSession()) {
            clientSocket.emit("game:log:result", {
                ok: false,
                log: null,
                reason: "NOT_AUTHORIZED",
            })
            return
        }
        if (!consumeRateLimit("placementLog")) {
            clientSocket.emit("game:log:result", {
                ok: false,
                log: null,
                reason: "RATE_LIMITED",
            })
            return
        }
        const validation = parseClientEvent("game:log:placement_decision", payload)
        if (!validation.success) {
            clientSocket.emit("game:log:result", {
                ok: false,
                log: null,
                reason: "INVALID_PAYLOAD",
            })
            return
        }
        const { roomId, log } = validation.data
        const result = isAuthorizedRoom(roomId)

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

        const isHumanPlacementDecisionLog = log
            && typeof log === "object"
            && !Array.isArray(log)
            && log.eventType === "placement_decision"
            && (
                (log.schemaVersion === 1 && (log.source === undefined || log.source === "human"))
                || (log.schemaVersion === 2 && log.source === "human")
            )

        if (!isHumanPlacementDecisionLog || containsPrivateField(log)) {
            clientSocket.emit("game:log:result", {
                ok: false,
                log: null,
                reason: "INVALID_PLACEMENT_DECISION_LOG",
            })
            return
        }

        const authenticatedLog = {
            ...log,
            roomId,
            playerId: getPlayerId(),
        }
        const logValidation = validatePlacementDecisionLog(authenticatedLog)
        if (!logValidation.ok) {
            clientSocket.emit("game:log:result", {
                ok: false,
                log: null,
                reason: logValidation.reason,
            })
            return
        }
        if (!isActiveSession()) {
            clientSocket.emit("game:log:result", {
                ok: false,
                log: null,
                reason: "NOT_AUTHORIZED",
            })
            return
        }
        const logResult = await saveLog(authenticatedLog)
        if (!isActiveSession()) return
        clientSocket.emit("game:log:result", logResult)
    })

    // server bag chunk를 player별로 추가해 로컬/상대 런타임의 다음 조각 공급을 맞춘다.
    clientSocket.on("game:bag:request", (payload) => {
        if (!isActiveSession()) {
            clientSocket.emit("game:bag:result", {
                ok: false,
                room: null,
                reason: "NOT_AUTHORIZED",
            })
            return
        }
        if (!consumeRateLimit("bag")) {
            clientSocket.emit("game:bag:result", {
                ok: false,
                room: null,
                reason: "RATE_LIMITED",
            })
            return
        }
        const validation = parseClientEvent("game:bag:request", payload)
        if (!validation.success) {
            clientSocket.emit("game:bag:result", {
                ok: false,
                room: null,
                reason: "INVALID_PAYLOAD",
            })
            return
        }
        const { roomId } = validation.data
        const result = isAuthorizedRoom(roomId)

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

        const bagResult = ensurePlayerBagQueue(roomId, getPlayerId())

        if (!bagResult.ok) {
            clientSocket.emit("game:bag:result", bagResult)
            return
        }
        if (!bagResult.bagChunk) {
            clientSocket.emit("game:bag:result", {
                ok: false,
                room: null,
                reason: "BAG_QUEUE_SUFFICIENT",
            })
            return
        }

        socketServer.to(roomId).emit("game:bag:append", {
            roomId,
            playerId: getPlayerId(),
            bagChunk: bagResult.bagChunk,
        })
    })

    clientSocket.on("game:leave", (payload) => {
        if (!isActiveSession()) {
            clientSocket.emit("game:leave:result", createPublicRoomResult(createNotAuthorizedResult()))
            return
        }
        if (!consumeRateLimit("lifecycle")) {
            clientSocket.emit("game:leave:result", createPublicRoomResult(createNotAuthorizedResult()))
            return
        }
        const validation = parseClientEvent("game:leave", payload)
        if (!validation.success) {
            clientSocket.emit("game:leave:result", createPublicRoomResult({
                ok: false,
                room: null,
                reason: "INVALID_PAYLOAD",
            }))
            return
        }
        const { roomId } = validation.data
        const roomResult = isAuthorizedRoom(roomId)
        const result = roomResult.ok
            ? leaveGame(roomId, getPlayerId())
            : createNotAuthorizedResult()
        if (result.ok) {
            authoritativeTickerService.stopRoomTicker(roomId)
            deleteMatch(roomId)
            clientSocket.leave(roomId)
            clientSocket.to(roomId).emit("game:opponent-left", {
                room: createRoomPublicDto(result.room),
                playerId: getPlayerId()
            })
        }

        clientSocket.emit("game:leave:result", createPublicRoomResult(result))

    })

    // 로비 복귀 시 membership과 finished room 복귀 조건을 확인한다.
    clientSocket.on("room:sync", (payload) => {
        if (!isActiveSession()) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        if (!consumeRateLimit("lifecycle")) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        const validation = parseClientEvent("room:sync", payload)
        if (!validation.success) {
            emitInvalidRoomResult()
            return
        }
        const { roomId } = validation.data
        const currentResult = isAuthorizedRoom(roomId)
        const result = currentResult.ok
            ? syncRoom(roomId, getPlayerId(), {
                location: "lobby",
            })
            : createNotAuthorizedResult()

        if (result.ok && result.room) {
            clientSocket.join(result.room.roomId)
            socketServer.to(result.room.roomId).emit("room:updated", createRoomPublicDto(result.room))
        }

        emitRoomResult(result)
    })

}

function createSafeInputMetadata(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {}

    return {
        ...(Number.isSafeInteger(payload.clientSequence) && payload.clientSequence > 0
            ? { clientSequence: payload.clientSequence }
            : {}),
        ...(Number.isSafeInteger(payload.pieceIndex) && payload.pieceIndex >= 0
            ? { pieceIndex: payload.pieceIndex }
            : {}),
    }
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
        aiPolicy: match.aiPolicy ?? null,
        aiPolicyRuntime: match.aiPolicyRuntime
            ? { ...match.aiPolicyRuntime }
            : null,
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
    gameOverResult,
    snapshot,
    authoritativeTickerService,
    saveEventLog,
) {
    if (!gameOverResult?.gameOver && snapshot?.phase !== "gameOver") return

    await finishAuthoritativeMatch({
        roomId,
        loserPlayerId,
        finishReason: gameOverResult?.gameOverReason,
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
        aiDifficulty: match.aiDifficulty,
        aiPolicyRequested: match.aiPolicy,
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

function createNotAuthorizedResult() {
    return {
        ok: false,
        room: null,
        reason: "NOT_AUTHORIZED",
    }
}

async function handleDisconnectGraceExpired({
    socketServer,
    playerId,
    authoritativeTickerService,
    saveEventLog,
}) {
    const context = findRoomByPlayerId(playerId)
    if (!context) return

    const { room, player } = context
    if (room.status === "playing") {
        const finishResult = await finishAuthoritativeMatch({
            roomId: room.roomId,
            loserPlayerId: playerId,
            finishReason: "disconnect_timeout",
            finishGame,
            stopRoomTicker: authoritativeTickerService.stopRoomTicker,
            emitMatchFinish(payload) {
                socketServer.to(room.roomId).emit("match:finish", payload)
            },
            saveGameEventLog: saveEventLog || saveGameEventLog,
            getMatchState,
            deleteMatch,
        })
        if (!finishResult.finished) return

        const leaveResult = leaveRoom(room.roomId, playerId)
        if (leaveResult.room) {
            socketServer.to(room.roomId).emit(
                "room:updated",
                createRoomPublicDto(leaveResult.room),
            )
        }
        return
    }

    const result = leaveRoom(room.roomId, playerId)
    if (result.room) {
        socketServer.to(room.roomId).emit("room:updated", createRoomPublicDto(result.room))
        socketServer.to(room.roomId).emit("room:message", {
            type: "system",
            text: `${player.nickname || "Player"}님의 연결이 종료되었습니다.`,
            roomId: room.roomId,
        })
    }
}

module.exports = {
    handleDisconnectGraceExpired,
    registerMultiplayerHandlers,
}
