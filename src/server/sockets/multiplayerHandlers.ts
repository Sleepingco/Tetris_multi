// =============================
// 멀티플레이 소켓 어댑터
// 외부 event를 인증·속도 제한·schema 검증한 뒤 room/match service 호출과 DTO emit으로 연결한다.
// player identity는 handshake에서 확정된 socket.data만 사용하고 payload의 identity는 신뢰하지 않는다.
// authoritative란 client 결과를 승인하는 대신 서버 state와 공용 규칙으로 결과를 다시 계산한다는 뜻이다.
// =============================
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
    authenticateHumanPlacementReceipt,
    appendPendingGarbageToOpponent,
    applyAuthoritativeInputToMatchPlayerState,
    clearHumanPlacementReceiptsForPlayer,
    clearHumanPlacementReceiptsForRoom,
    createMatch,
    deleteMatch,
    ensurePlayerBagQueue,
    getAuthoritativePlayerSnapshotDto,
    getMatchState,
    markMatchPlayerReady,
    markMatchPlayerDisconnected,
    recordHumanPlacementReceipt,
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
import { BUFFER_GAMEPLAY_RULES_VERSION, LEGACY_GAMEPLAY_RULES_VERSION, getGameplayLogContext } from "../../shared/gameplayLogContext.js";
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
import { createCombatEffect } from "../services/playerGameplayStep.js";
import type { CombatEffect, PlacementResult, PresentationEffect } from "../services/playerGameplayStep.js";
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
    gameStartCountdownMs?: number;
    isEventProductionStopped?: () => boolean;
};
type GameInputPayload = ClientToServerParsedPayload<"game:input">;
type InputResultPayload = ServerToClientParsedPayload<"game:input:result">;
type GameJoinMatchDto = NonNullable<ServerToClientParsedPayload<"game:join:result">["match"]>;

const DISCONNECT_GRACE_MS = 30_000
const GAME_START_COUNTDOWN_MS = 3_000
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

/**
 * 중첩 payload를 순환 참조에 안전하게 훑어 session 관련 private field를 찾는다.
 * client가 보낸 분석 로그를 그대로 저장하기 전에 server credential 흔적을 차단한다.
 */
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
 *
 * mutation event의 공통 신뢰 순서는 다음과 같다.
 * 1. socket이 최신 active session인지 확인한다.
 * 2. player별 rate limit을 소비한다.
 * 3. strict Zod schema로 payload를 검증한다.
 * 4. room membership과 lifecycle 상태를 확인한다.
 * 5. gameplay는 mutation queue에서 service/core에 적용한다.
 *
 * handler는 판정 결과를 직접 만들지 않고 room/match 상태 변화와 Socket.IO 전송을 조율한다.
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
    const countdownMs = dependencies.gameStartCountdownMs ?? GAME_START_COUNTDOWN_MS
    const isEventProductionStopped = dependencies.isEventProductionStopped || (() => false)
    const sessionContext = clientSocket.data?.playerSession
    const playerIdentity = clientSocket.data?.playerIdentity
    const getPlayerId = (): string => playerIdentity?.playerId || ""
    // 앞의 async input이 끝날 때까지 같은 socket의 다음 input을 기다리게 하는 Promise tail이다.
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

    function emitCountdown(match: MatchState): void {
        if (match.startsAt === undefined) return;
        socketServer.to(match.roomId).emit("game:countdown", {
            roomId: match.roomId,
            gameId: match.gameId,
            startsAt: match.startsAt,
            serverNow: now(),
        });
    }

    function hasGameStarted(roomId: string): boolean {
        const match = getMatchState(roomId).match;
        return Boolean(match && (match.startsAt === undefined
            || (match.startsAt !== null && now() >= match.startsAt)));
    }

    // =============================
    // 방 생명주기 이벤트
    // =============================
    clientSocket.on("room:create", (payload: unknown) => {
        if (!isActiveSession()) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        if (!consumeRateLimit("lifecycle")) {
            emitRoomResult({ ok: false, room: null, reason: "RATE_LIMITED" })
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
            emitRoomResult({ ok: false, room: null, reason: "RATE_LIMITED" })
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
            emitRoomResult({ ok: false, room: null, reason: "RATE_LIMITED" })
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
            clearHumanPlacementReceiptsForPlayer(getPlayerId())
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
        if (isEventProductionStopped()) return
        if (!sessionContext
            || !playerSessionService.markDisconnected(sessionContext, clientSocket.id)) return

        const membership = findRoomByPlayerId(getPlayerId());
        if (membership) {
            const paused = markMatchPlayerDisconnected(membership.room.roomId, getPlayerId(), now());
            if (paused.match?.startsAt === null) emitCountdown(paused.match);
        }

        // 잠깐의 네트워크 단절에는 room/match를 유지하고, 같은 session 재연결이 없을 때만 정리한다.
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

    // room:start는 lifecycle을 playing으로 바꾼 뒤 별도 match, server bag, ticker를 만든다.
    // startGame 자체는 board를 만들지 않으므로 두 상태 저장소의 책임을 구분해 읽어야 한다.
    clientSocket.on("room:start", async (payload: unknown) => {
        if (isEventProductionStopped()) return
        if (!isActiveSession()) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        if (!consumeRateLimit("lifecycle")) {
            emitRoomResult({ ok: false, room: null, reason: "RATE_LIMITED" })
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
            clearHumanPlacementReceiptsForRoom(result.room.roomId)
            const matchResult = createMatch(result.room, { waitForPlayers: countdownMs > 0 })
            if (matchResult.ok) {
                authoritativeTickerService.startRoomTicker(result.room.roomId, socketServer)
                persistGameEventLog(saveEventLog, createGameStartLog(result.room, matchResult.match))
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
                ok: false, room: null, reason: "RATE_LIMITED",
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
        if (result.ok && result.room?.status !== "playing") {
            clientSocket.emit("game:join:result", {
                ok: false, room: createRoomPublicDto(result.room!),
                reason: "GAME_NOT_PLAYING", match: null,
            });
            return;
        }
        if (result.ok && !hasJoinedGame) {
            // 새 game page socket의 첫 join만 이 player의 gravity 기준 시점을 다시 잡는다.
            authoritativeTickerService?.resetPlayerGravity?.(roomId, getPlayerId())
            hasJoinedGame = true
        }
        const matchResult = result.ok
            ? markMatchPlayerReady(roomId, getPlayerId(), now(), countdownMs)
            : { match: null }

        if (result.ok && result.room) {
            clientSocket.join(result.room.roomId)
        }

        clientSocket.emit("game:join:result", {
            ...createPublicRoomResult(result),
            match: createGameJoinMatchDto(matchResult.match),
            serverNow: now(),
        })
        if (result.ok && matchResult.match) emitCountdown(matchResult.match);
    })

    /**
     * schema를 통과한 input 하나를 authoritative state에 적용한다.
     *
     * per-socket Promise chain은 client 입력 순서를 지키고, shared mutation queue는 같은 player의
     * gravity와 input 순서를 함께 지킨다. queue를 기다리는 동안 session generation이 바뀔 수 있어
     * state 변경 직전에도 active session을 다시 검사한다.
     */
    async function processGameInput(payload: GameInputPayload): Promise<void> {
        if (isEventProductionStopped()) return
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
                gameId: getMatchState(roomId).match?.gameId,
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
        if (!hasGameStarted(roomId)) {
            emitInputResult(false, "GAME_NOT_STARTED");
            return;
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
                    if (!hasGameStarted(roomId)) {
                        emitInputResult(false, "GAME_NOT_STARTED");
                        return;
                    }
                    const authoritativeResult = applyAuthoritativeInputToMatchPlayerState(
                        roomId,
                        getPlayerId(),
                        input,
                        gameCore,
                    )
                    if (!authoritativeResult.ok) {
                        // server와 prediction이 다르면 authoritative snapshot을 같은 응답에 붙여 즉시 보정한다.
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
                    if (gameplayResult?.placementResult) {
                        recordHumanPlacementReceipt(
                            roomId,
                            getPlayerId(),
                            clientSequence,
                            gameplayResult.placementResult.pieceIndex,
                            now(),
                        )
                    }

                    const snapshot = emitAuthoritativeSnapshot(
                        socketServer,
                        roomId,
                        getPlayerId(),
                        gameplayResult?.presentationEffect,
                        createCombatEffect(authoritativeResult.match.gameId, getPlayerId(),
                            gameplayResult?.placementResult, placementSideEffect),
                    )
                    if (placementSideEffect?.targetPlayerId) {
                        // garbage를 받은 상대도 변경됐으므로 같은 input 처리 흐름에서 상대 snapshot도 이어서 알린다.
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
                // 실패한 envelope를 다시 적용하지 않도록 sequence를 진행시키고 현재 원본을 재전송한다.
                acknowledgeClientInputSequence(roomId, getPlayerId(), clientSequence)
                emitAuthoritativeSnapshot(socketServer, roomId, getPlayerId())
            }
            emitInputResult(false, "AUTHORITATIVE_INPUT_FAILED")
        }
    }

    // 신뢰 경계 순서는 session → rate limit → schema → bounded queue → domain 처리다.
    clientSocket.on("game:input", (payload: unknown) => {
        if (isEventProductionStopped()) return null
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
        // 120개 상한은 느린 async core load 동안 한 socket이 무제한 Promise를 쌓지 못하게 한다.
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

    // =============================
    // 분석 로그 신뢰 경계
    // =============================
    clientSocket.on("game:log:placement_decision", async (payload: unknown) => {
        if (isEventProductionStopped()) return
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
                || ((logRecord.schemaVersion === 2 || logRecord.schemaVersion === 3) && logRecord.source === "human")
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

        const rawValidation = validatePlacementDecisionLog({
            ...logRecord,
            roomId,
            playerId: getPlayerId(),
        })
        if (!rawValidation.ok) {
            clientSocket.emit("game:log:result", {
                ok: false,
                log: null,
                reason: rawValidation.reason,
            })
            return
        }
        const receiptResult = authenticateHumanPlacementReceipt(
            roomId,
            getPlayerId(),
            Number(logRecord.authoritativeClientSequence),
            Number(logRecord.authoritativePieceIndex),
            now(),
            logRecord.schemaVersion === 3 ? BUFFER_GAMEPLAY_RULES_VERSION : LEGACY_GAMEPLAY_RULES_VERSION,
        )
        if (!receiptResult.ok) {
            clientSocket.emit("game:log:result", {
                ok: false,
                log: null,
                reason: receiptResult.reason,
            })
            return
        }
        const authenticatedLog = {
            ...logRecord,
            ...(logRecord.schemaVersion === 3 ? getGameplayLogContext(receiptResult.receipt.gameplayRulesVersion) : {}),
            gameId: receiptResult.receipt.gameId,
            roomId: receiptResult.receipt.roomId,
            playerId: receiptResult.receipt.playerId,
            pieceIndex: receiptResult.receipt.pieceIndex,
            authoritativeClientSequence: receiptResult.receipt.clientSequence,
            authoritativePieceIndex: receiptResult.receipt.pieceIndex,
        }
        // 인증·인가된 roomId와 playerId로 저장 주체를 덮어쓴 뒤 전체 log schema를 다시 검증한다.
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

    // server queue가 부족할 때만 7-bag을 추가해 로컬/상대 런타임의 다음 조각 공급을 맞춘다.
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
            clientSocket.emit("game:leave:result", { ok: false, room: null, reason: "RATE_LIMITED" })
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
        if (result.ok) {
            authoritativeTickerService.stopRoomTicker(roomId)
            deleteMatch(roomId)
            clearHumanPlacementReceiptsForRoom(roomId)
            clientSocket.leave(roomId)
            clientSocket.to(roomId).emit("game:opponent-left", {
                room: result.room ? createRoomPublicDto(result.room) : null,
                playerId: getPlayerId()
            })
        }

        clientSocket.emit("game:leave:result", createPublicRoomResult(result))

    })

    // 로비 복귀 시 membership과 finished room의 waiting 복귀 조건을 확인한다.
    clientSocket.on("room:sync", (payload: unknown) => {
        if (!isActiveSession()) {
            emitRoomResult(createNotAuthorizedResult())
            return
        }
        if (!consumeRateLimit("lifecycle")) {
            emitRoomResult({ ok: false, room: null, reason: "RATE_LIMITED" })
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

/**
 * malformed payload 전체를 되돌려 보내지 않고, 안전한 정수 acknowledgment field만 골라낸다.
 * client는 어느 요청이 실패했는지 알 수 있고 server는 공격자가 넣은 임의 객체를 반사하지 않는다.
 */
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

/**
 * matchService의 public snapshot DTO를 room 전체에 broadcast한다.
 * state 변경이 끝난 뒤 호출하며, line-clear presentation은 해당 placement의 snapshot에만 붙인다.
 */
function emitAuthoritativeSnapshot(
    socketServer: AppSocketServer,
    roomId: string,
    playerId: string,
    presentationEffect: PresentationEffect | null = null,
    combatEffect: CombatEffect | null = null,
): AuthoritativeSnapshotDto | null {
    const snapshotResult = getAuthoritativePlayerSnapshotDto(roomId, playerId)
    if (!snapshotResult.ok) return null

    const payload: ServerToClientParsedPayload<"game:authoritative:snapshot"> = {
        roomId,
        playerId,
        gameId: snapshotResult.match.gameId,
        snapshot: snapshotResult.snapshot,
    }
    if (presentationEffect?.id) {
        payload.presentationEffect = {
            ...presentationEffect,
            id: presentationEffect.id,
        }
    }
    if (combatEffect) payload.combatEffect = combatEffect;

    socketServer.to(roomId).emit("game:authoritative:snapshot", payload)

    return snapshotResult.snapshot
}

/**
 * game page의 초기 동기화 payload를 새 public 객체로 만든다.
 * bag 배열과 snapshot을 복사해 Socket.IO payload가 match 저장소의 원본 참조를 노출하지 않게 한다.
 */
function createGameJoinMatchDto(match: MatchState | null): GameJoinMatchDto | null {
    if (!match) return null

    return {
        gameId: match.gameId,
        ...(match.startsAt !== undefined ? { startsAt: match.startsAt } : {}),
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

function persistGameEventLog(
    saveEventLog: typeof saveGameEventLog,
    log: unknown,
): void {
    try {
        void Promise.resolve(saveEventLog(log))
            .then(result => {
                if (!result.ok) {
                    console.warn(`[multiplayerHandlers] game event log failed: ${result.reason}`)
                }
            })
            .catch(() => {
                console.warn("[multiplayerHandlers] game event log failed: LOG_WRITE_FAILED")
            })
    } catch {
        console.warn("[multiplayerHandlers] game event log failed: LOG_WRITE_FAILED")
    }
}

function createGameStartLog(room: RoomState, match: MatchState) {
    return {
        eventType: "game_start",
        schemaVersion: match.gameplayRulesVersion === "buffer20-v1" ? 3 : 1,
        ...(match.gameplayRulesVersion === "buffer20-v1" ? getGameplayLogContext(match.gameplayRulesVersion) : {}),
        gameId: match.gameId,
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

/**
 * 재연결 grace가 끝난 player를 room lifecycle에 맞게 정리한다.
 * playing이면 먼저 정상 match finish 순서를 실행한 뒤 loser membership을 제거하고,
 * waiting/finished이면 room에서 바로 나가게 한다.
 */
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
            saveGameEventLog: saveEventLog || saveGameEventLog,
            getMatchState,
            deleteMatch,
        })
        if (!finishResult.finished) return

        const leaveResult = leaveRoom(room.roomId, playerId)
        clearHumanPlacementReceiptsForPlayer(playerId)
        if (leaveResult.room) {
            socketServer.to(room.roomId).emit(
                "room:updated",
                createRoomPublicDto(leaveResult.room),
            )
        }
        return
    }

    const result = leaveRoom(room.roomId, playerId)
    clearHumanPlacementReceiptsForPlayer(playerId)
    if (result.room) {
        socketServer.to(room.roomId).emit("room:updated", createRoomPublicDto(result.room))
        socketServer.to(room.roomId).emit("room:message", {
            type: "system",
            text: `${player.nickname || "Player"}님의 연결이 종료되었습니다.`,
            roomId: room.roomId,
        })
    }
}
