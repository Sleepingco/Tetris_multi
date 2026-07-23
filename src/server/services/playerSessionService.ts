// =============================
// 플레이어 세션 상태 소유권
// session token 계보와 active socket generation을 소유한다. room membership은 roomService의 책임이다.
// 서버에는 token 원문이 아니라 digest만 남기고, 원문은 session:ready 응답으로만 전달한다.
// =============================
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

/**
 * token을 같은 길이의 digest로 바꾼 뒤 timing-safe 비교한다.
 * 문자열을 직접 비교해 일치 지점에 따른 시간 차이가 드러나는 일을 피한다.
 */
function matchesToken(token: unknown, digest: unknown): boolean {
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token) || !Buffer.isBuffer(digest)) {
        return false;
    }

    const candidateDigest = hashToken(token)
    return candidateDigest.length === digest.length
        && timingSafeEqual(candidateDigest, digest)
}

/**
 * 신규 발급과 재연결을 관리하는 in-memory session service를 만든다.
 *
 * 핵심 규칙:
 * - `expiresAt`은 최초 발급 시 정한 절대 만료이며 재연결해도 늘어나지 않는다.
 * - token을 재사용해 인증하면 새 token과 generation으로 회전한다.
 * - 같은 player에서는 최신 generation/socket만 active다.
 * - 직전 token은 active socket이 끊긴 경우에만 짧은 recovery window에서 한 번 사용할 수 있다.
 */
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

        // 정상 회전의 직전 token만 일시 보관한다. 복구에 사용한 token은 즉시 폐기한다.
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

    /**
     * handshake credential을 신규 발급 또는 session 재개로 해석한다.
     * 일부 credential을 신규 사용자로 바꾸지 않아 잘못된 재개 요청이 새 identity를 만들지 못하게 한다.
     */
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

    /**
     * event를 보낸 socket이 현재 session의 최신 generation인지 확인한다.
     * 연결 때 인증했더라도 token 회전이나 만료 뒤에는 모든 mutation event가 다시 실패한다.
     */
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

    /**
     * 최신 socket의 연결만 inactive로 표시한다.
     * 오래된 socket의 늦은 disconnect가 새 연결을 끊긴 상태로 덮어쓰지 못하게 한다.
     */
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

    /**
     * 절대 만료된 session과 recovery token을 제거한다.
     * 반환한 active socket 정보는 bootstrap이 연결 종료와 room 정리를 이어서 처리할 때 사용한다.
     */
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
