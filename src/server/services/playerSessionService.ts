import {
    createHash,
    randomBytes,
    randomUUID,
    timingSafeEqual,
} from "node:crypto";

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000
export const RECOVERY_TTL_MS = 60 * 1000
const TOKEN_BYTES = 32
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const PLAYER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type PlayerSessionContext = { playerId: string; generation: number };
export type PlayerSessionReady = {
    version: 1;
    playerId: string;
    token: string;
    nickname: string;
    expiresAt: number;
    resumed: boolean;
};
export type PlayerSessionAuthentication = {
    ok: true;
    context: PlayerSessionContext;
    ready: PlayerSessionReady;
    replacedSocketId: string | null;
} | { ok: false; reason: string };
export type PlayerSessionService = {
    authenticate(auth: unknown, socketId: string): PlayerSessionAuthentication;
    cleanupExpired(): Array<{
        playerId: string;
        generation: number;
        activeSocketId: string | null;
    }>;
    isActiveSocket(context: PlayerSessionContext | null | undefined, socketId: string): boolean;
    isDisconnectedSession(context: PlayerSessionContext | null | undefined): boolean;
    markDisconnected(context: PlayerSessionContext | null | undefined, socketId: string): boolean;
};
type Session = PlayerSessionContext & {
    tokenDigest: Buffer;
    activeSocketId: string | null;
    nickname: string;
    expiresAt: number;
};
type Dependencies = {
    now?: () => number;
    createPlayerId?: () => string;
    createTokenBytes?: () => Buffer;
    sessionTtlMs?: number;
    recoveryTtlMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeNickname(nickname: unknown): string | null {
    if (typeof nickname !== "string") return null

    const normalized = nickname.trim()
    if (!normalized || normalized.length > 24) return null

    return normalized
}

function hashToken(token: string): Buffer {
    return createHash("sha256").update(token).digest()
}

function matchesToken(token: unknown, digest: unknown): boolean {
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token) || !Buffer.isBuffer(digest)) {
        return false;
    }

    const candidateDigest = hashToken(token)
    return candidateDigest.length === digest.length
        && timingSafeEqual(candidateDigest, digest)
}

export function createPlayerSessionService(
    dependencies: Dependencies = {},
): PlayerSessionService {
    const now = dependencies.now || Date.now
    const createPlayerId = dependencies.createPlayerId || randomUUID
    const createTokenBytes = dependencies.createTokenBytes || (() => randomBytes(TOKEN_BYTES))
    const sessionTtlMs = dependencies.sessionTtlMs || SESSION_TTL_MS
    const recoveryTtlMs = dependencies.recoveryTtlMs || RECOVERY_TTL_MS
    const sessions = new Map<string, Session>()
    const recoveryTokens = new Map<string, { tokenDigest: Buffer; expiresAt: number }>()

    function createToken(): string {
        const tokenBytes = createTokenBytes()
        if (!Buffer.isBuffer(tokenBytes) || tokenBytes.length !== TOKEN_BYTES) {
            throw new Error("SESSION_TOKEN_GENERATOR_INVALID")
        }

        return tokenBytes.toString("base64url")
    }

    function createReadyPayload(
        session: Session,
        token: string,
        resumed: boolean,
    ): PlayerSessionReady {
        return {
            version: 1,
            playerId: session.playerId,
            token,
            nickname: session.nickname,
            expiresAt: session.expiresAt,
            resumed,
        }
    }

    function issueSession(nickname: string, socketId: string): PlayerSessionAuthentication {
        const issuedAt = now()
        const token = createToken()
        const session: Session = {
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

    function rotateSession(
        session: Session,
        socketId: string,
        nickname: string,
        usedRecoveryToken = false,
    ): PlayerSessionAuthentication {
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

    function authenticate(auth: unknown, socketId: string): PlayerSessionAuthentication {
        const credentials = isRecord(auth) ? auth : {};
        if (credentials.credentialError) {
            return { ok: false, reason: "SESSION_CREDENTIALS_MALFORMED" }
        }
        const nickname = normalizeNickname(credentials.nickname)
        if (!nickname) {
            return { ok: false, reason: "SESSION_NICKNAME_INVALID" }
        }

        const hasPlayerId = credentials.playerId !== undefined && credentials.playerId !== null
        const hasToken = credentials.token !== undefined && credentials.token !== null
        if (!hasPlayerId && !hasToken) {
            return issueSession(nickname, socketId)
        }
        if (hasPlayerId !== hasToken) {
            return { ok: false, reason: "SESSION_CREDENTIALS_INCOMPLETE" }
        }
        if (
            typeof credentials.playerId !== "string"
            || !PLAYER_ID_PATTERN.test(credentials.playerId)
            || typeof credentials.token !== "string"
            || !TOKEN_PATTERN.test(credentials.token)
        ) {
            return { ok: false, reason: "SESSION_CREDENTIALS_MALFORMED" }
        }

        const session = sessions.get(credentials.playerId)
        if (!session) {
            return { ok: false, reason: "SESSION_INVALID" }
        }
        if (session.expiresAt <= now()) {
            sessions.delete(credentials.playerId)
            recoveryTokens.delete(credentials.playerId)
            return { ok: false, reason: "SESSION_EXPIRED" }
        }
        if (matchesToken(credentials.token, session.tokenDigest)) {
            return rotateSession(session, socketId, nickname)
        }

        const recovery = recoveryTokens.get(credentials.playerId)
        if (
            session.activeSocketId === null
            && recovery
            && recovery.expiresAt > now()
            && matchesToken(credentials.token, recovery.tokenDigest)
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

    function isActiveSocket(
        context: PlayerSessionContext | null | undefined,
        socketId: string,
    ): boolean {
        const session = context?.playerId
            ? sessions.get(context.playerId)
            : null

        return Boolean(
            session
            && session.expiresAt > now()
            && context
            && session.generation === context.generation
            && session.activeSocketId === socketId
        )
    }

    function markDisconnected(
        context: PlayerSessionContext | null | undefined,
        socketId: string,
    ): boolean {
        if (!isActiveSocket(context, socketId)) return false

        const session = context ? sessions.get(context.playerId) : null;
        if (!session) return false;
        session.activeSocketId = null
        return true
    }

    function isDisconnectedSession(
        context: PlayerSessionContext | null | undefined,
    ): boolean {
        const session = context?.playerId
            ? sessions.get(context.playerId)
            : null

        return Boolean(
            session
            && session.expiresAt > now()
            && context
            && session.generation === context.generation
            && session.activeSocketId === null
        )
    }

    function cleanupExpired(): ReturnType<PlayerSessionService["cleanupExpired"]> {
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
