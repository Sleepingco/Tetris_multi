import {
    createRoom,
    findRoomByPlayerId,
    joinRoom,
    startGame,
    leaveGame,
    syncRoom,
    leaveRoom,
    finishGame,
} from "../services/roomService.js";

import {
    acknowledgeClientInputSequence,
    appendPendingGarbageToOpponent,
    applyAuthoritativeInputToMatchPlayerState,
    createMatch,
    deleteMatch,
    ensurePlayerBagQueue,
    getAuthoritativePlayerSnapshotDto,
    getMatchState,
    validateClientInputSequence,
} from "../services/matchService.js";
import { loadGameCore } from "../services/gameCoreLoader.js";
import {
    saveGameEventLog,
    savePlacementDecisionLog,
} from "../services/logService.js";
import {
    finishAuthoritativeMatch,
} from "../services/authoritativeMatchFinish.js";
import {
    createPublicRoomResult,
    createRoomPublicDto,
} from "../services/roomPublicDto.js";
import {
    validatePlacementDecisionLog,
} from "../validators/gameLogValidator.js";
import { clientToServerSchemas } from "../../shared/socketContracts.mjs";
import type {
    ClientToServerParsedPayload,
    ServerToClientParsedPayload,
} from "../../shared/socketContractTypes.js";
import type { AuthoritativePlayerMutationQueue } from "../services/authoritativePlayerMutationQueue.js";
import type { AuthoritativeTickerService } from "../services/authoritativeTickerService.js";
import type { GameCore } from "../services/gameCoreLoader.js";
import type { LogSaveResult } from "../services/logService.js";
import type {
    AuthoritativeSnapshotDto,
    MatchResult,
    MatchState,
} from "../services/matchService.js";
import type { PlacementResult, PresentationEffect } from "../services/playerGameplayStep.js";
import type {
    PlayerSessionContext,
    PlayerSessionService,
} from "../services/playerSessionService.js";
import type { RoomResult, RoomState } from "../services/roomService.js";
import type { SocketRateLimitBucket, SocketRateLimitService } from "../services/socketRateLimitService.js";
import type { AppSocket, AppSocketServer } from "./index.js";

export type DisconnectGraceContext = {
    generation: number;
    disconnectedAt: number;
    timer: ReturnType<typeof setTimeout>;
};
export type MultiplayerHandlerDependencies = {
    authoritativeTickerService: AuthoritativeTickerService;
    authoritativePlayerMutationQueue: AuthoritativePlayerMutationQueue;
    playerSessionService: PlayerSessionService;
    socketRateLimitService: SocketRateLimitService;
    disconnectGraceContexts: Map<string, DisconnectGraceContext>;
    savePlacementDecisionLog?: typeof savePlacementDecisionLog;
    saveGameEventLog?: typeof saveGameEventLog;
    createGarbageHoleCol?: () => number;
    loadGameCore?: typeof loadGameCore;
    now?: () => number;
    setTimeoutFn?: typeof setTimeout;
    disconnectGraceMs?: number;
};
type GameInputPayload = ClientToServerParsedPayload<"game:input">;
type InputResultPayload = ServerToClientParsedPayload<"game:input:result">;
type GameJoinMatchDto = NonNullable<ServerToClientParsedPayload<"game:join:result">["match"]>;

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
const PLACEMENT_RESULT_NON_NEGATIVE_INTEGER_FIELDS = [
    "linesCleared",
    "combo",
    "rawAttackLines",
    "attackLines",
    "canceledGarbageLines",
    "incomingGarbageLines",
    "appliedGarbageLines",
]
const PLACEMENT_RESULT_NON_NEGATIVE_NUMBER_FIELDS = ["scoreBefore", "scoreAfter"]
const PLACEMENT_RESULT_BOOLEAN_FIELDS = ["isTSpin", "backToBack", "gameOver"]

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
}

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
function handlePlayerLeftRoom(
    socketServer: AppSocketServer,
    clientSocket: AppSocket,
    roomId: string | null | undefined,
    result: RoomResult,
    nickname: string,
): void {
    if (!result.ok) return

    if (roomId) clientSocket.leave(roomId)

    if (!result.room) return

    socketServer.to(result.room.roomId).emit("room:updated", createRoomPublicDto(result.room))
    socketServer.to(result.room.roomId).emit("room:message", {
        type: "system",
        text: `${nickname}님이 퇴장하였습니다.`,
        roomId: result.room.roomId,
    })
}

function handlePlayerJoinedRoom(
    socketServer: AppSocketServer,
    clientSocket: AppSocket,
    result: RoomResult,
    nickname: string,
): void {
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

function containsPrivateField(value: unknown): boolean {
    const pending: unknown[] = [value]
    const visited = new WeakSet()

    while (pending.length > 0) {
        const current = pending.pop()
        if (!current || typeof current !== "object" || visited.has(current)) continue
        visited.add(current)

        for (const [key, child] of Object.entries(current)) {
            if (PRIVATE_FIELD_NAMES.has(key)) return true
            pending.push(child)
        }
    }

    return false
}

function hasValidPlacementResultScalars(result: unknown): boolean {
    if (!isRecord(result)) return false
    return PLACEMENT_RESULT_NON_NEGATIVE_INTEGER_FIELDS.every(field => (
            typeof result[field] === "number"
            && Number.isInteger(result[field])
            && result[field] >= 0
        ))
        && PLACEMENT_RESULT_NON_NEGATIVE_NUMBER_FIELDS.every(field => (
            typeof result[field] === "number"
            && Number.isFinite(result[field])
            && result[field] >= 0
        ))
        && typeof result.scoreDelta === "number"
        && Number.isFinite(result.scoreDelta)
        && PLACEMENT_RESULT_BOOLEAN_FIELDS.every(field => typeof result[field] === "boolean")
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
export function registerMultiplayerHandlers(
    socketServer: AppSocketServer,
    clientSocket: AppSocket,
    dependencies: MultiplayerHandlerDependencies,
): void {
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
    const getPlayerId = (): string => playerIdentity?.playerId || ""
    let gameInputProcessingChain: Promise<void> | null = null
    let outstandingGameInputCount = 0
    let hasJoinedGame = false

    function isActiveSession(): boolean {
        return playerSessionService.isActiveSocket(sessionContext, clientSocket.id) === true
    }

    function consumeRateLimit(bucket: SocketRateLimitBucket): boolean {
        return socketRateLimitService.consume(bucket, getPlayerId()) !== false
    }

    function isAuthorizedRoom(roomId: string): RoomResult {
        if (!isActiveSession()) return createNotAuthorizedResult()

        const result = syncRoom(roomId, getPlayerId())
        return result.ok && isHumanPlayer(result.room, getPlayerId())
            ? result
            : createNotAuthorizedResult()
    }

    function emitRoomResult(result: RoomResult): void {
        clientSocket.emit("room:result", createPublicRoomResult(result))
    }

    function emitInvalidRoomResult(): void {
        emitRoomResult({
            ok: false,
            room: null,
            reason: "INVALID_PAYLOAD",
        })
    }

    clientSocket.on("room:create", (payload: unknown) => {
        if (!isActiveSession()) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        if (!consumeRateLimit("lifecycle")) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        const validation = clientToServerSchemas["room:create"].safeParse(payload)
        if (!validation.success) {
            emitInvalidRoomResult()
            return
        }
        const createPayload = validation.data
        const hostPlayer = {
            playerId: getPlayerId(),
            nickname: playerIdentity?.nickname || "Guest",
        }
        const result = createRoom(hostPlayer, {
            mode: createPayload.mode || "pvp",
            aiDifficulty: createPayload.aiDifficulty,
            aiPolicy: createPayload.aiPolicy,
        })

        if (result.ok && result.room) {
            clientSocket.join(result.room.roomId);
        }
        emitRoomResult(result)
    })

    clientSocket.on("room:join", (payload: unknown) => {
        if (!isActiveSession()) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        if (!consumeRateLimit("lifecycle")) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        const validation = clientToServerSchemas["room:join"].safeParse(payload)
        if (!validation.success) {
            emitInvalidRoomResult()
            return
        }
        const { roomId } = validation.data
        const guestPlayer = {
            playerId: getPlayerId(),
            nickname: playerIdentity?.nickname || "Guest",
        }
        const result = joinRoom(roomId, guestPlayer)
        handlePlayerJoinedRoom(socketServer, clientSocket, result, guestPlayer.nickname)
    })

    clientSocket.on("room:leave", (payload: unknown) => {
        if (!isActiveSession()) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        if (!consumeRateLimit("lifecycle")) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        const validation = clientToServerSchemas["room:leave"].safeParse(payload)
        if (!validation.success) {
            emitInvalidRoomResult()
            return
        }
        const { roomId } = validation.data
        const roomResult = isAuthorizedRoom(roomId)
        const result = roomResult.ok
            ? leaveRoom(roomId, getPlayerId())
            : roomResult
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

        emitRoomResult(result)
    })

    clientSocket.on("disconnect", () => {
        gameInputProcessingChain = null
        outstandingGameInputCount = 0
        if (!sessionContext
            || !playerSessionService.markDisconnected(sessionContext, clientSocket.id)) return

        const disconnectedAt = now()
        const timer = setTimeoutFn(async () => {
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
        timer.unref?.()
        const graceContext: DisconnectGraceContext = {
            generation: sessionContext.generation,
            disconnectedAt,
            timer,
        }
        disconnectGraceContexts.set(getPlayerId(), graceContext)
    })

    // room 상태를 playing으로 바꾸고 matchService에 player별 input log/server bag을 만든다.
    clientSocket.on("room:start", async (payload: unknown) => {
        if (!isActiveSession()) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        if (!consumeRateLimit("lifecycle")) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        const validation = clientToServerSchemas["room:start"].safeParse(payload)
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

    clientSocket.on("game:join", (payload: unknown) => {
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
        const validation = clientToServerSchemas["game:join"].safeParse(payload)
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
    async function processGameInput(payload: GameInputPayload): Promise<void> {
        const {
            roomId,
            action,
            tick,
            pieceIndex,
            clientSequence,
            expectedTransform,
        } = payload
        let hasEmittedInputResult = false
        const emitInputResult = (
            ok: boolean,
            reason: string | null,
            snapshot: AuthoritativeSnapshotDto | null = null,
            placementCommitted = false,
        ): void => {
            hasEmittedInputResult = true
            const resultPayload: InputResultPayload = {
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

        if (!result.ok || !result.room) {
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

    clientSocket.on("game:input", (payload: unknown) => {
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
        const validation = clientToServerSchemas["game:input"].safeParse(payload)
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

    clientSocket.on("game:log:placement_decision", async (payload: unknown) => {
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
        const validation = clientToServerSchemas["game:log:placement_decision"].safeParse(payload)
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

        if (!result.ok || !result.room) {
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

        const logRecord = isRecord(log) ? log : null
        const isHumanPlacementDecisionLog = logRecord
            && logRecord.eventType === "placement_decision"
            && (
                (logRecord.schemaVersion === 1
                    && (logRecord.source === undefined || logRecord.source === "human"))
                || (logRecord.schemaVersion === 2 && logRecord.source === "human")
            )
            && hasValidPlacementResultScalars(logRecord.placementResult)

        if (!isHumanPlacementDecisionLog || !logRecord || containsPrivateField(logRecord)) {
            clientSocket.emit("game:log:result", {
                ok: false,
                log: null,
                reason: "INVALID_PLACEMENT_DECISION_LOG",
            })
            return
        }

        const authenticatedLog = {
            ...logRecord,
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
    clientSocket.on("game:bag:request", (payload: unknown) => {
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
        const validation = clientToServerSchemas["game:bag:request"].safeParse(payload)
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

        if (!result.ok || !result.room) {
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
            clientSocket.emit("game:bag:result", {
                ok: false,
                room: null,
                reason: bagResult.reason,
            })
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

    clientSocket.on("game:leave", (payload: unknown) => {
        if (!isActiveSession()) {
            clientSocket.emit("game:leave:result", createPublicRoomResult(createNotAuthorizedResult()))
            return
        }
        if (!consumeRateLimit("lifecycle")) {
            clientSocket.emit("game:leave:result", createPublicRoomResult(createNotAuthorizedResult()))
            return
        }
        const validation = clientToServerSchemas["game:leave"].safeParse(payload)
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
        if (result.ok && result.room) {
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
    clientSocket.on("room:sync", (payload: unknown) => {
        if (!isActiveSession()) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        if (!consumeRateLimit("lifecycle")) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        const validation = clientToServerSchemas["room:sync"].safeParse(payload)
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

function createSafeInputMetadata(
    payload: unknown,
): Pick<Partial<InputResultPayload>, "clientSequence" | "pieceIndex"> {
    if (!isRecord(payload)) return {}

    const clientSequence = payload.clientSequence
    const pieceIndex = payload.pieceIndex

    return {
        ...(typeof clientSequence === "number"
            && Number.isSafeInteger(clientSequence) && clientSequence > 0
            ? { clientSequence }
            : {}),
        ...(typeof pieceIndex === "number"
            && Number.isSafeInteger(pieceIndex) && pieceIndex >= 0
            ? { pieceIndex }
            : {}),
    }
}

function handleServerPlacementResult(
    roomId: string,
    playerId: string,
    placementResult: PlacementResult | null | undefined,
    createGarbageHoleCol: () => number,
): MatchResult | null {
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

function emitAuthoritativeSnapshot(
    socketServer: AppSocketServer,
    roomId: string,
    playerId: string,
    presentationEffect: PresentationEffect | null = null,
): AuthoritativeSnapshotDto | null {
    const snapshotResult = getAuthoritativePlayerSnapshotDto(roomId, playerId)
    if (!snapshotResult.ok) return null

    const payload: ServerToClientParsedPayload<"game:authoritative:snapshot"> = {
        roomId,
        playerId,
        snapshot: snapshotResult.snapshot,
    }
    if (presentationEffect?.id) {
        payload.presentationEffect = {
            ...presentationEffect,
            id: presentationEffect.id,
        }
    }

    socketServer.to(roomId).emit("game:authoritative:snapshot", payload)

    return snapshotResult.snapshot
}

function createGameJoinMatchDto(match: MatchState | null): GameJoinMatchDto | null {
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
    socketServer: AppSocketServer,
    roomId: string,
    loserPlayerId: string,
    gameOverResult: { gameOver?: boolean; gameOverReason?: string } | null | undefined,
    snapshot: AuthoritativeSnapshotDto | null,
    authoritativeTickerService: AuthoritativeTickerService,
    saveEventLog: typeof saveGameEventLog,
): Promise<void> {
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

async function persistGameEventLog(
    saveEventLog: typeof saveGameEventLog,
    log: unknown,
): Promise<void> {
    try {
        await saveEventLog(log)
    } catch (error) {
        const message = error instanceof Error ? error.message : "UNKNOWN_ERROR"
        console.warn(`[multiplayerHandlers] game event log failed: ${message}`)
    }
}

function createGameId(roomId: string, match: MatchState | null): string {
    return match?.createdAt
        ? `${roomId}-${match.createdAt}`
        : roomId
}

function createGameStartLog(room: RoomState, match: MatchState) {
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

function isHumanPlayer(room: RoomState | null, playerId: string): boolean {
    return Boolean(room?.players?.some(player => {
        return player.playerId === playerId && player.playerType !== "heuristic_ai"
    }))
}

function createNotAuthorizedResult(): RoomResult {
    return {
        ok: false,
        room: null,
        reason: "NOT_AUTHORIZED",
    }
}

export async function handleDisconnectGraceExpired({
    socketServer,
    playerId,
    authoritativeTickerService,
    saveEventLog,
}: {
    socketServer: AppSocketServer;
    playerId: string;
    authoritativeTickerService: AuthoritativeTickerService;
    saveEventLog?: typeof saveGameEventLog;
}): Promise<void> {
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
            saveGameEventLog: saveEventLog,
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
