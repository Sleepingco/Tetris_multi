// =============================
// 소켓 연결 초기화
// transport를 통과한 연결을 인증하고, 인증된 identity를 기능별 event handler에 전달한다.
// =============================
import type { Server, Socket } from "socket.io";
import { registerChatHandlers } from "./chatHandlers.js";
import {
    handleDisconnectGraceExpired,
    registerMultiplayerHandlers,
} from "./multiplayerHandlers.js";
import {
    createAuthoritativeTickerService,
} from "../services/authoritativeTickerService.js";
import {
    createAuthoritativePlayerMutationQueue,
} from "../services/authoritativePlayerMutationQueue.js";
import {
    createPlayerSessionService,
} from "../services/playerSessionService.js";
import {
    createSocketRateLimitService,
    TEST_RATE_LIMITS,
} from "../services/socketRateLimitService.js";
import { handshakeAuthSchema } from "../../shared/socketContracts.mjs";
import type {
    ClientToServerEventName,
    ServerToClientEvents,
} from "../../shared/socketContractTypes.js";
import type { AuthoritativePlayerMutationQueue } from "../services/authoritativePlayerMutationQueue.js";
import type { AuthoritativeTickerService } from "../services/authoritativeTickerService.js";
import type {
    PlayerSessionContext,
    PlayerSessionReady,
    PlayerSessionService,
} from "../services/playerSessionService.js";
import type { SocketRateLimitService } from "../services/socketRateLimitService.js";
import type {
    DisconnectGraceContext,
    MultiplayerHandlerDependencies,
} from "./multiplayerHandlers.js";

export type RawClientToServerEvents = {
    [K in ClientToServerEventName]: (payload: unknown) => void;
};
export type AppSocketData = {
    playerSession?: PlayerSessionContext;
    playerIdentity?: {
        playerId: string;
        nickname: string;
    };
};
export type AppSocket = Socket<
    RawClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    AppSocketData
>;
export type AppSocketServer = Server<
    RawClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    AppSocketData
>;
type RegisterSocketDependencies = Partial<MultiplayerHandlerDependencies> & {
    playerSessionService?: PlayerSessionService;
    socketRateLimitService?: SocketRateLimitService;
    authoritativePlayerMutationQueue?: AuthoritativePlayerMutationQueue;
    authoritativeTickerService?: AuthoritativeTickerService;
    rateLimitProfile?: string;
};

class SessionAuthError extends Error {
    data: { code: string; terminal: true };

    constructor(code: string) {
        super("SESSION_AUTH_FAILED");
        this.data = { code, terminal: true };
    }
}

const SESSION_CLEANUP_INTERVAL_MS = 60_000

function createSessionError(code: string): SessionAuthError {
    return new SessionAuthError(code)
}

function getRemoteAddress(clientSocket: AppSocket): string {
    return clientSocket.handshake?.address
        || clientSocket.request?.socket?.remoteAddress
        || "unknown"
}

/**
 * Socket.IO 연결의 인증, 기능 handler 등록, 장기 실행 자원 정리를 조립한다.
 *
 * 연결 전 순서:
 * 1. 신규/재개 시도에 맞는 IP rate limit을 확인한다.
 * 2. strict handshake schema로 형식과 unknown field를 검사한다.
 * 3. session service가 token을 검증·회전하고 newest socket을 active로 만든다.
 *
 * 성공한 identity만 `socket.data`에 저장하며 event payload의 playerId는 신뢰하지 않는다.
 * 반환한 disposer는 cleanup timer, disconnect grace timer, room ticker를 한 번만 정리한다.
 */
export function registerSocketHandlers(
    socketServer: AppSocketServer,
    dependencies: RegisterSocketDependencies = {},
): () => void {
    let disposed = false
    const playerSessionService = dependencies.playerSessionService
        || createPlayerSessionService()
    const rateLimitProfile = dependencies.rateLimitProfile
        || process.env.SOCKET_RATE_LIMIT_PROFILE
    const socketRateLimitService = dependencies.socketRateLimitService
        || createSocketRateLimitService({
            limits: process.env.NODE_ENV !== "production" && rateLimitProfile === "test"
                ? TEST_RATE_LIMITS
                : undefined,
        })
    const authoritativePlayerMutationQueue = dependencies.authoritativePlayerMutationQueue
        || createAuthoritativePlayerMutationQueue()
    const authoritativeTickerService = dependencies.authoritativeTickerService
        || createAuthoritativeTickerService({
            authoritativePlayerMutationQueue,
            saveGameEventLog: dependencies.saveGameEventLog,
            savePlacementDecisionLog: dependencies.savePlacementDecisionLog,
        })
    const multiplayerDependencies = {
        ...dependencies,
        authoritativePlayerMutationQueue,
        authoritativeTickerService,
        disconnectGraceContexts: dependencies.disconnectGraceContexts || new Map(),
        playerSessionService,
        socketRateLimitService,
        isEventProductionStopped: () => disposed,
    } satisfies MultiplayerHandlerDependencies
    const pendingSessionReady = new WeakMap<AppSocket, PlayerSessionReady>()

    // 이 middleware가 성공해야 아래 connection handler와 app event가 등록된다.
    socketServer.use?.((clientSocket, next) => {
        const auth: unknown = clientSocket.handshake?.auth || {}
        const authRecord = isRecord(auth) ? auth : {}
        const remoteAddress = getRemoteAddress(clientSocket)
        const hasCredential = authRecord.playerId !== undefined
            || authRecord.token !== undefined
            || authRecord.credentialError !== undefined
        if (
            !hasCredential
            && !socketRateLimitService.consume("newSession", remoteAddress)
        ) {
            next(createSessionError("SESSION_RATE_LIMITED"))
            return
        }

        const authValidation = handshakeAuthSchema.safeParse(auth)
        if (!authValidation.success) {
            if (
                hasCredential
                && !socketRateLimitService.consume("invalidResume", remoteAddress)
            ) {
                next(createSessionError("SESSION_RATE_LIMITED"))
                return
            }
            const nickname = authRecord.nickname
            const hasInvalidNickname = typeof nickname !== "string"
                || !nickname.trim()
                || nickname.trim().length > 24
            next(createSessionError(hasInvalidNickname
                ? "SESSION_NICKNAME_INVALID"
                : "SESSION_CREDENTIALS_MALFORMED"))
            return
        }

        const result = playerSessionService.authenticate(authValidation.data, clientSocket.id)
        if (!result.ok) {
            if (
                hasCredential
                && !socketRateLimitService.consume("invalidResume", remoteAddress)
            ) {
                next(createSessionError("SESSION_RATE_LIMITED"))
                return
            }
            next(createSessionError(result.reason))
            return
        }

        clientSocket.data.playerSession = result.context
        clientSocket.data.playerIdentity = {
            playerId: result.ready.playerId,
            nickname: result.ready.nickname,
        }
        pendingSessionReady.set(clientSocket, result.ready)

        // 같은 token 계보로 재연결되면 새 generation만 유효하고 이전 socket은 즉시 끊는다.
        const replacedSocket = result.replacedSocketId
            ? socketServer.sockets?.sockets?.get?.(result.replacedSocketId)
            : null
        replacedSocket?.disconnect?.(true)
        next()
    })

    const cleanupTimer = setInterval(() => {
        const expiredSessions = playerSessionService.cleanupExpired() || []
        socketRateLimitService.cleanupExpired()
        expiredSessions.forEach(({ playerId, activeSocketId }) => {
            const graceContext = multiplayerDependencies.disconnectGraceContexts.get(playerId)
            if (graceContext) clearTimeout(graceContext.timer)
            multiplayerDependencies.disconnectGraceContexts.delete(playerId)
            if (activeSocketId) {
                socketServer.sockets.sockets.get(activeSocketId)?.disconnect(true)
            }
            handleDisconnectGraceExpired({
                socketServer,
                playerId,
                authoritativeTickerService,
                saveEventLog: dependencies.saveGameEventLog,
            }).catch(() => {})
        })
    }, SESSION_CLEANUP_INTERVAL_MS)
    cleanupTimer.unref?.()

    // shutdown과 테스트 teardown이 겹쳐도 timer를 중복 정리하지 않는다.
    function dispose(): void {
        if (disposed) return
        disposed = true

        clearInterval(cleanupTimer)
        for (const context of multiplayerDependencies.disconnectGraceContexts.values()) {
            clearTimeout(context.timer)
        }
        multiplayerDependencies.disconnectGraceContexts.clear()
        authoritativeTickerService.stopAllRoomTickers()
    }

    socketServer.on("connection", (clientSocket) => {
        if (disposed) return
        const sessionContext = clientSocket.data.playerSession
        const graceContext = sessionContext
            ? multiplayerDependencies.disconnectGraceContexts.get(sessionContext.playerId)
            : null
        if (graceContext && sessionContext) {
            clearTimeout(graceContext.timer)
            multiplayerDependencies.disconnectGraceContexts.delete(sessionContext.playerId)
        }

        registerChatHandlers(socketServer, clientSocket, multiplayerDependencies)
        registerMultiplayerHandlers(socketServer, clientSocket, multiplayerDependencies)
        // app event listener를 먼저 준비한 뒤 credential을 전달해 초기 응답 유실을 피한다.
        const sessionReady = pendingSessionReady.get(clientSocket)
        pendingSessionReady.delete(clientSocket)
        if (sessionReady) clientSocket.emit("session:ready", sessionReady)
    })

    return dispose
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
}
