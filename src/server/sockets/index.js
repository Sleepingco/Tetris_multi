const { registerChatHandlers } = require("./chatHandlers.js")
const {
    handleDisconnectGraceExpired,
    registerMultiplayerHandlers,
} = require("./multiplayerHandlers.js")
const {
    createAuthoritativeTickerService,
} = require("../services/authoritativeTickerService.js")
const {
    createAuthoritativePlayerMutationQueue,
} = require("../services/authoritativePlayerMutationQueue.js")
const {
    createPlayerSessionService,
} = require("../services/playerSessionService.js")
const {
    createSocketRateLimitService,
    TEST_RATE_LIMITS,
} = require("../services/socketRateLimitService.js")

const SESSION_CLEANUP_INTERVAL_MS = 60_000

function createSessionError(code) {
    const error = new Error("SESSION_AUTH_FAILED")
    error.data = {
        code,
        terminal: true,
    }
    return error
}

function getRemoteAddress(clientSocket) {
    return clientSocket.handshake?.address
        || clientSocket.request?.socket?.remoteAddress
        || "unknown"
}

/**
 * Socket.IO connection 진입점을 한 곳에 둔다.
 * - 같은 clientSocket에 채팅과 멀티플레이 핸들러를 기능별로 조합한다.
 *
 * @param {import("socket.io").Server} socketServer - Socket.IO 서버 인스턴스
 * @param {Object} dependencies - 테스트에서 주입할 서비스 의존성
 * @returns {void}
 */
function registerSocketHandlers(socketServer, dependencies = {}) {
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
        || createAuthoritativeTickerService({ authoritativePlayerMutationQueue })
    const multiplayerDependencies = {
        ...dependencies,
        authoritativePlayerMutationQueue,
        authoritativeTickerService,
        disconnectGraceContexts: dependencies.disconnectGraceContexts || new Map(),
        playerSessionService,
        socketRateLimitService,
    }

    socketServer.use?.((clientSocket, next) => {
        const auth = clientSocket.handshake?.auth || {}
        const remoteAddress = getRemoteAddress(clientSocket)
        const hasCredential = auth.playerId !== undefined
            || auth.token !== undefined
            || auth.credentialError !== undefined
        if (
            !hasCredential
            && !socketRateLimitService.consume("newSession", remoteAddress)
        ) {
            next(createSessionError("SESSION_RATE_LIMITED"))
            return
        }

        const result = playerSessionService.authenticate(auth, clientSocket.id)
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

        clientSocket.data ||= {}
        clientSocket.data.playerSession = result.context
        clientSocket.data.playerIdentity = {
            playerId: result.ready.playerId,
            nickname: result.ready.nickname,
        }
        clientSocket.data.sessionReady = result.ready

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
            socketServer.sockets?.sockets?.get?.(activeSocketId)?.disconnect?.(true)
            handleDisconnectGraceExpired({
                socketServer,
                playerId,
                authoritativeTickerService,
                saveEventLog: dependencies.saveGameEventLog,
            }).catch(() => {})
        })
    }, SESSION_CLEANUP_INTERVAL_MS)
    cleanupTimer.unref?.()

    socketServer.on("connection", (clientSocket) => {
        const sessionContext = clientSocket.data?.playerSession
        const graceContext = sessionContext
            ? multiplayerDependencies.disconnectGraceContexts.get(sessionContext.playerId)
            : null
        if (graceContext) {
            clearTimeout(graceContext.timer)
            multiplayerDependencies.disconnectGraceContexts.delete(sessionContext.playerId)
        }

        registerChatHandlers(socketServer, clientSocket, multiplayerDependencies)
        registerMultiplayerHandlers(socketServer, clientSocket, multiplayerDependencies)
        clientSocket.emit("session:ready", clientSocket.data.sessionReady)
    })
}

module.exports = {
    registerSocketHandlers,
}
