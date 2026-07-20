const {
    createHash,
    randomBytes,
    randomUUID,
    timingSafeEqual,
} = require("node:crypto")

const SESSION_TTL_MS = 8 * 60 * 60 * 1000
const RECOVERY_TTL_MS = 60 * 1000
const TOKEN_BYTES = 32
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const PLAYER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeNickname(nickname) {
    if (typeof nickname !== "string") return null

    const normalized = nickname.trim()
    if (!normalized || normalized.length > 24) return null

    return normalized
}

function hashToken(token) {
    return createHash("sha256").update(token).digest()
}

function matchesToken(token, digest) {
    if (!TOKEN_PATTERN.test(token) || !Buffer.isBuffer(digest)) return false

    const candidateDigest = hashToken(token)
    return candidateDigest.length === digest.length
        && timingSafeEqual(candidateDigest, digest)
}

function createPlayerSessionService(dependencies = {}) {
    const now = dependencies.now || Date.now
    const createPlayerId = dependencies.createPlayerId || randomUUID
    const createTokenBytes = dependencies.createTokenBytes || (() => randomBytes(TOKEN_BYTES))
    const sessionTtlMs = dependencies.sessionTtlMs || SESSION_TTL_MS
    const recoveryTtlMs = dependencies.recoveryTtlMs || RECOVERY_TTL_MS
    const sessions = new Map()
    const recoveryTokens = new Map()

    function createToken() {
        const tokenBytes = createTokenBytes()
        if (!Buffer.isBuffer(tokenBytes) || tokenBytes.length !== TOKEN_BYTES) {
            throw new Error("SESSION_TOKEN_GENERATOR_INVALID")
        }

        return tokenBytes.toString("base64url")
    }

    function createReadyPayload(session, token, resumed) {
        return {
            version: 1,
            playerId: session.playerId,
            token,
            nickname: session.nickname,
            expiresAt: session.expiresAt,
            resumed,
        }
    }

    function issueSession(nickname, socketId) {
        const issuedAt = now()
        const token = createToken()
        const session = {
            playerId: createPlayerId(),
            tokenDigest: hashToken(token),
            generation: 1,
            activeSocketId: socketId,
            nickname,
            expiresAt: issuedAt + sessionTtlMs,
        }
        sessions.set(session.playerId, session)

        return {
            ok: true,
            context: {
                playerId: session.playerId,
                generation: session.generation,
            },
            ready: createReadyPayload(session, token, false),
            replacedSocketId: null,
        }
    }

    function rotateSession(session, socketId, nickname, usedRecoveryToken = false) {
        const rotatedAt = now()
        const token = createToken()
        const replacedSocketId = session.activeSocketId

        if (!usedRecoveryToken) {
            recoveryTokens.set(session.playerId, {
                tokenDigest: session.tokenDigest,
                expiresAt: Math.min(session.expiresAt, rotatedAt + recoveryTtlMs),
            })
        } else {
            recoveryTokens.delete(session.playerId)
        }

        session.tokenDigest = hashToken(token)
        session.generation += 1
        session.activeSocketId = socketId
        session.nickname = nickname

        return {
            ok: true,
            context: {
                playerId: session.playerId,
                generation: session.generation,
            },
            ready: createReadyPayload(session, token, true),
            replacedSocketId,
        }
    }

    function authenticate(auth, socketId) {
        if (auth?.credentialError) {
            return { ok: false, reason: "SESSION_CREDENTIALS_MALFORMED" }
        }
        const nickname = normalizeNickname(auth?.nickname)
        if (!nickname) {
            return { ok: false, reason: "SESSION_NICKNAME_INVALID" }
        }

        const hasPlayerId = auth?.playerId !== undefined && auth?.playerId !== null
        const hasToken = auth?.token !== undefined && auth?.token !== null
        if (!hasPlayerId && !hasToken) {
            return issueSession(nickname, socketId)
        }
        if (hasPlayerId !== hasToken) {
            return { ok: false, reason: "SESSION_CREDENTIALS_INCOMPLETE" }
        }
        if (
            typeof auth.playerId !== "string"
            || !PLAYER_ID_PATTERN.test(auth.playerId)
            || typeof auth.token !== "string"
            || !TOKEN_PATTERN.test(auth.token)
        ) {
            return { ok: false, reason: "SESSION_CREDENTIALS_MALFORMED" }
        }

        const session = sessions.get(auth.playerId)
        if (!session) {
            return { ok: false, reason: "SESSION_INVALID" }
        }
        if (session.expiresAt <= now()) {
            sessions.delete(auth.playerId)
            recoveryTokens.delete(auth.playerId)
            return { ok: false, reason: "SESSION_EXPIRED" }
        }
        if (matchesToken(auth.token, session.tokenDigest)) {
            return rotateSession(session, socketId, nickname)
        }

        const recovery = recoveryTokens.get(auth.playerId)
        if (
            session.activeSocketId === null
            && recovery
            && recovery.expiresAt > now()
            && matchesToken(auth.token, recovery.tokenDigest)
        ) {
            return rotateSession(session, socketId, nickname, true)
        }

        return {
            ok: false,
            reason: session.activeSocketId === null
                ? "SESSION_INVALID"
                : "SESSION_REPLAYED",
        }
    }

    function isActiveSocket(context, socketId) {
        const session = context?.playerId
            ? sessions.get(context.playerId)
            : null

        return Boolean(
            session
            && session.expiresAt > now()
            && session.generation === context.generation
            && session.activeSocketId === socketId
        )
    }

    function markDisconnected(context, socketId) {
        if (!isActiveSocket(context, socketId)) return false

        sessions.get(context.playerId).activeSocketId = null
        return true
    }

    function isDisconnectedSession(context) {
        const session = context?.playerId
            ? sessions.get(context.playerId)
            : null

        return Boolean(
            session
            && session.expiresAt > now()
            && session.generation === context.generation
            && session.activeSocketId === null
        )
    }

    function cleanupExpired() {
        const currentTime = now()
        const expiredSessions = []
        for (const [playerId, session] of sessions) {
            if (session.expiresAt <= currentTime) {
                expiredSessions.push({
                    playerId,
                    generation: session.generation,
                    activeSocketId: session.activeSocketId,
                })
                sessions.delete(playerId)
                recoveryTokens.delete(playerId)
            }
        }
        for (const [playerId, recovery] of recoveryTokens) {
            if (recovery.expiresAt <= currentTime || !sessions.has(playerId)) {
                recoveryTokens.delete(playerId)
            }
        }
        return expiredSessions
    }

    return {
        authenticate,
        cleanupExpired,
        isActiveSocket,
        isDisconnectedSession,
        markDisconnected,
    }
}

module.exports = {
    RECOVERY_TTL_MS,
    SESSION_TTL_MS,
    createPlayerSessionService,
    normalizeNickname,
}
