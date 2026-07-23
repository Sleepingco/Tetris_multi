import {
    connectErrorDataSchema,
    parseServerEvent,
} from "../../shared/socketContracts.mjs"
import type {
    ClientToServerEventName,
    ClientToServerWirePayload,
    ServerToClientEventName,
    ServerToClientParsedPayload,
} from "../../shared/socketContractTypes.d.ts"

/**
 * 브라우저의 Socket.IO 연결과 player session을 한 곳에서 관리하는 네트워크 어댑터다.
 *
 * 페이지 컴포넌트는 socket 객체를 직접 만지지 않고 아래의 request/on 함수만 사용한다.
 * 이 경계를 지키면 화면 코드는 통신 세부 구현을 몰라도 되고, 모든 서버 응답은 같은
 * schema 검증을 거친다.
 *
 * 주요 흐름:
 * 저장된 credential 읽기 → handshake → session:ready → 인증된 event 송수신
 * → disconnect 시 전송 대기열 폐기 → reconnect 또는 terminal 종료
 *
 * 상태 원천:
 * - activeSession: 현재 연결에서 서버가 인증한 session
 * - sessionStorage: 새 연결을 복구하기 위한 credential 캐시
 * - room/match/gameplay state: 이 모듈이 아니라 서버와 각 페이지/runtime가 소유
 */
type Disposer = () => void;
type RequestType = "create" | "join" | "leave" | "start" | "sync" | null;
type PlayerIdentity = { playerId: string | null; nickname: string };
type ActiveSession = ServerToClientParsedPayload<"session:ready">;
type StoredCredential = Pick<ActiveSession, "version" | "playerId" | "token" | "nickname" | "expiresAt">;
type MalformedSession = { malformed: true };
export type PlayerSession = Pick<ActiveSession, "playerId" | "nickname">;
export type SessionError = { code: string; terminal: boolean };
export type SessionDisconnect = { reason: string; terminal: boolean };
type AuthPayload = {
    nickname: string;
    playerId?: string;
    token?: string;
    credentialError?: "MALFORMED";
};
type SocketManager = { reconnection?: (enabled: boolean) => void };
type SocketHandler = (...args: never[]) => void;
type BrowserSocket = {
    connected: boolean;
    id?: string;
    sendBuffer?: unknown[];
    io?: SocketManager;
    on: (eventName: string, handler: SocketHandler) => void;
    off: (eventName: string, handler: SocketHandler) => void;
    emit: <K extends ClientToServerEventName>(
        eventName: K,
        payload: ClientToServerWirePayload<K>,
    ) => void;
    connect: () => void;
    disconnect?: () => void;
};
type SocketFactory = (options: {
    autoConnect: boolean;
    auth: (callback: (payload: AuthPayload) => void) => void;
}) => BrowserSocket;
type ConnectError = { data?: unknown };

declare const io: SocketFactory;

if (typeof io !== "function") {
    throw new Error("Socket.IO client script must be loaded before client/net/roomClient.ts")
}

const SESSION_STORAGE_KEY = "tetris:playerSession"
const SESSION_VERSION = 1
const terminalSessionErrors = new Set([
    "SESSION_CREDENTIALS_INCOMPLETE",
    "SESSION_CREDENTIALS_MALFORMED",
    "SESSION_EXPIRED",
    "SESSION_INVALID",
    "SESSION_NICKNAME_INVALID",
    "SESSION_REPLAYED",
])

// =============================
// 세션 생명주기 상태
// 현재 연결의 인증 상태와 page subscriber만 보관한다.
// room이나 gameplay 상태를 별도로 복제하지 않는다.
// =============================

const sessionReadyHandlers = new Set<(session: PlayerSession) => void>()
const sessionErrorHandlers = new Set<(error: SessionError) => void>()
const sessionDisconnectedHandlers = new Set<(disconnect: SessionDisconnect) => void>()
let activeSession: ActiveSession | null = null
let activeSocketId: string | null = null
let terminalRetryUsed = false
let recoveringWithNewSession = false
let terminalDisconnectPending = false

function readNickname(): string {
    return sessionStorage.getItem("tetris:nickname")?.trim() || "Guest"
}

/**
 * 이전 연결에서 저장한 credential을 handshake에 사용할 수 있는 형태로 읽는다.
 *
 * 저장값은 신뢰할 수 있는 session 원천이 아니라 복구용 캐시다. 따라서 JSON 구조만
 * 확인하고, token의 진위와 만료 여부는 다음 연결에서 서버가 다시 검증한다.
 *
 * @returns 정상 credential, 손상 표시 또는 저장값이 없으면 null
 */
function readStoredSession(): StoredCredential | MalformedSession | null {
    const rawSession = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (!rawSession) return null

    try {
        const session: unknown = JSON.parse(rawSession)
        if (
            !session || typeof session !== "object"
            || !("version" in session) || session.version !== SESSION_VERSION
            || !("playerId" in session)
            || typeof session.playerId !== "string"
            || !("token" in session)
            || typeof session.token !== "string"
            || !("nickname" in session)
            || typeof session.nickname !== "string"
            || !("expiresAt" in session)
            || typeof session.expiresAt !== "number"
            || !Number.isFinite(session.expiresAt)
        ) {
            return { malformed: true }
        }
        return {
            version: SESSION_VERSION,
            playerId: session.playerId,
            token: session.token,
            nickname: session.nickname,
            expiresAt: session.expiresAt,
        }
    } catch {
        return { malformed: true }
    }
}

/**
 * Socket.IO가 연결을 시도할 때마다 최신 sessionStorage로 handshake payload를 만든다.
 *
 * credential이 손상됐다고 조용히 새 사용자로 연결하면 기존 room 소유권을 잃을 수 있다.
 * 그래서 MALFORMED 표시를 서버로 보내 명시적인 terminal 오류로 처리한다.
 *
 * @param callback Socket.IO가 handshake auth를 받을 때 호출하는 함수
 * @returns void
 */
function createHandshakeAuth(callback: (payload: AuthPayload) => void): void {
    const session = readStoredSession()
    if (session && "malformed" in session) {
        callback({ nickname: readNickname(), credentialError: "MALFORMED" })
        return
    }
    callback(session
        ? {
            playerId: session.playerId,
            token: session.token,
            nickname: readNickname(),
        }
        : { nickname: readNickname() })
}

function clearIdentityAndRoom(): void {
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
    sessionStorage.removeItem("tetris:playerId")
    sessionStorage.removeItem("tetris:roomId")
    sessionStorage.removeItem("room")
    activeSession = null
}

// 현재 HTML 문서의 모듈 인스턴스에서는 Socket을 하나만 공유한다.
// 다른 HTML 문서로 이동하면 새 모듈 인스턴스와 새 연결이 만들어진다.
const serverConnection = io({
    autoConnect: false,
    auth: createHandshakeAuth,
})
let lastRoomRequestType: RequestType = null

function toPlayerSession(session: Pick<ActiveSession, "playerId" | "nickname">): PlayerSession {
    return { playerId: session.playerId, nickname: session.nickname }
}

function notifySessionDisconnected(reason: string, terminal: boolean): void {
    sessionDisconnectedHandlers.forEach(handler => handler({
        reason,
        terminal,
    }))
}

/**
 * 서버 payload가 공유 contract를 위반했을 때 자동 재연결을 멈춘다.
 *
 * transport 단절과 달리 protocol 오류는 같은 payload를 다시 받아도 회복되지 않는다.
 * 현재 credential은 임의로 삭제하지 않고 페이지에 terminal 상태를 알려 사용자가
 * 문제를 인지할 수 있게 한다.
 *
 * @returns void
 */
function stopForProtocolError(): void {
    activeSession = null
    const wasConnected = serverConnection.connected
    terminalDisconnectPending = wasConnected
    serverConnection.io?.reconnection?.(false)
    sessionErrorHandlers.forEach(handler => handler({
        code: "SESSION_PROTOCOL_ERROR",
        terminal: true,
    }))
    serverConnection.disconnect?.()
    if (!wasConnected) {
        notifySessionDisconnected("io client disconnect", true)
    }
}

/**
 * 서버 event를 application handler에 전달하기 전에 공유 Zod contract로 검증한다.
 *
 * 반환 disposer는 같은 wrapper를 정확히 제거한다. session:ready가 잘못된 경우에는
 * 인증 상태 자체를 신뢰할 수 없으므로 연결을 terminal protocol 오류로 종료한다.
 *
 * @param eventName 구독할 server-to-client event 이름
 * @param handler 검증이 성공한 payload만 받는 application handler
 * @returns listener를 제거하는 함수
 */
function onValidatedServerEvent<K extends ServerToClientEventName>(
    eventName: K,
    handler: (payload: ServerToClientParsedPayload<K>) => void,
): Disposer {
    const validatedHandler = (payload: unknown) => {
        const validation = parseServerEvent(eventName, payload)
        if (!validation.success) {
            console.warn(`[socket-protocol] ${eventName}: INVALID_SERVER_PAYLOAD`)
            if (eventName === "session:ready") {
                stopForProtocolError()
            }
            return
        }
        handler(validation.data)
    }

    serverConnection.on(eventName, validatedHandler)
    return () => serverConnection.off(eventName, validatedHandler)
}

// =============================
// 소켓 세션 상태 흐름
// connect는 transport 연결, session:ready는 인증 완료를 뜻한다.
// 페이지 mutation은 반드시 session:ready 이후에만 전송한다.
// =============================

serverConnection.on("connect", () => {
    activeSocketId = serverConnection.id ?? null
    activeSession = null
})

onValidatedServerEvent("session:ready", (session) => {
    if (
        !serverConnection.connected
        || serverConnection.id !== activeSocketId
    ) {
        return
    }

    activeSession = { ...session }
    terminalRetryUsed = false
    recoveringWithNewSession = false
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(activeSession))
    sessionStorage.setItem("tetris:nickname", activeSession.nickname)
    sessionStorage.removeItem("tetris:playerId")
    sessionReadyHandlers.forEach(handler => handler(toPlayerSession(session)))
})

serverConnection.on("connect_error", (error: ConnectError) => {
    if (error?.data === undefined) {
        sessionErrorHandlers.forEach(handler => handler({
            code: "SESSION_CONNECTION_FAILED",
            terminal: false,
        }))
        return
    }

    const validation = connectErrorDataSchema.safeParse(error.data)
    if (!validation.success) {
        stopForProtocolError()
        return
    }

    const { code, terminal } = validation.data
    sessionErrorHandlers.forEach(handler => handler({ code, terminal }))

    if (recoveringWithNewSession) {
        recoveringWithNewSession = false
        serverConnection.io?.reconnection?.(false)
        serverConnection.disconnect?.()
        return
    }

    if (!terminalSessionErrors.has(code) || terminalRetryUsed) return

    terminalRetryUsed = true
    recoveringWithNewSession = true
    clearIdentityAndRoom()
    serverConnection.connect()
})

serverConnection.on("disconnect", (reason: string) => {
    activeSession = null
    if (Array.isArray(serverConnection.sendBuffer)) {
        serverConnection.sendBuffer.length = 0
    }
    const terminal = terminalDisconnectPending || reason === "io server disconnect"
    terminalDisconnectPending = false
    notifySessionDisconnected(reason, terminal)
})

serverConnection.connect()

/**
 * 현재 transport와 session이 모두 준비됐을 때만 mutation event를 전송한다.
 *
 * 연결이 끊긴 동안 Socket.IO sendBuffer에 mutation이 남으면 reconnect 뒤 오래된 입력이
 * 실행될 수 있다. 그래서 미인증·미연결 상태에서는 즉시 false를 반환하며 보내지 않는다.
 *
 * @param eventName client-to-server event 이름
 * @param payload 공유 contract가 정의한 wire payload
 * @returns 실제 socket emit을 수행했으면 true
 */
function emitAuthenticated<K extends ClientToServerEventName>(
    eventName: K,
    payload: ClientToServerWirePayload<K>,
): boolean {
    if (!activeSession || !serverConnection.connected) return false

    // connected 확인과 emit은 같은 task에서 실행되므로 Socket.IO의 reconnect
    // sendBuffer에는 들어가지 않는다. disconnect 시 남은 buffer도 즉시 폐기한다.
    serverConnection.emit(eventName, payload)
    return true
}

// =============================
// Socket.IO 방 어댑터
// 아래 함수들은 화면 의도를 event로 바꾸는 얇은 경계다.
// `_playerId` 같은 인자는 기존 page API 호환용이며, 서버 identity는 active session에서 얻는다.
// =============================

/**
 * 화면 표시와 저장된 room 복구에 사용할 공개 player identity를 반환한다.
 *
 * activeSession이 있으면 현재 연결 값을 우선한다. 연결 준비 전에는 저장 credential의
 * 공개 필드만 임시로 읽으며, mutation 권한으로는 사용하지 않는다.
 *
 * @returns 공개 player identity 또는 사용할 수 있는 값이 없으면 null
 */
export function getPlayerSession(): PlayerSession | null {
    if (activeSession) return toPlayerSession(activeSession)

    const storedSession = readStoredSession()
    return !storedSession || "malformed" in storedSession
        ? null
        : toPlayerSession(storedSession)
}

/**
 * session 인증 완료를 구독한다.
 *
 * 이미 session:ready가 끝난 뒤 페이지가 구독할 수도 있으므로 현재 session을 microtask로
 * 한 번 전달한다. disposer가 먼저 호출되거나 session이 교체되면 늦은 전달은 취소된다.
 *
 * @param handler 인증된 공개 player identity를 받을 함수
 * @returns 구독 해제 함수
 */
export function onSessionReady(handler: (session: PlayerSession) => void): Disposer {
    const wrappedHandler = (session: PlayerSession) => handler(session)
    sessionReadyHandlers.add(wrappedHandler)
    const capturedSession = activeSession
    if (capturedSession) {
        queueMicrotask(() => {
            if (
                sessionReadyHandlers.has(wrappedHandler)
                && activeSession === capturedSession
            ) {
                wrappedHandler(toPlayerSession(capturedSession))
            }
        })
    }

    return () => sessionReadyHandlers.delete(wrappedHandler)
}

export function onSessionError(handler: (error: SessionError) => void): Disposer {
    const wrappedHandler = (error: SessionError) => handler(error)
    sessionErrorHandlers.add(wrappedHandler)
    return () => sessionErrorHandlers.delete(wrappedHandler)
}

export function onSessionDisconnected(handler: (disconnect: SessionDisconnect) => void): Disposer {
    const wrappedHandler = (disconnect: SessionDisconnect) => handler(disconnect)
    sessionDisconnectedHandlers.add(wrappedHandler)
    return () => sessionDisconnectedHandlers.delete(wrappedHandler)
}

/**
 * 새 room 생성 의도를 server event로 보낸다.
 *
 * PVE일 때만 난이도와 policy를 payload에 넣는다. 전달받은 player 정보는 호환용이며
 * 실제 요청 identity는 서버가 active session에서 결정한다.
 *
 * @returns void
 */
export function requestCreateRoom(
    _player: PlayerIdentity,
    mode: "pvp" | "pve" = "pvp",
    aiDifficulty: "normal" | "hard" | null = null,
    aiPolicy: "heuristic" | "placement_v4" | null = null,
): void {
    lastRoomRequestType = "create"
    const payload: {
        mode: "pvp" | "pve";
        aiDifficulty?: "normal" | "hard";
        aiPolicy?: "heuristic" | "placement_v4";
    } = { mode }
    if (mode === "pve" && aiDifficulty !== null) {
        payload.aiDifficulty = aiDifficulty
    }
    if (mode === "pve" && aiPolicy !== null) {
        payload.aiPolicy = aiPolicy
    }
    emitAuthenticated("room:create", payload)
}

export function onRoomResult(handler: (
    result: ServerToClientParsedPayload<"room:result">,
    requestType: RequestType,
) => void): Disposer {
    return onValidatedServerEvent("room:result", (result) => {
        handler(result, lastRoomRequestType)
    })
}

export function requestJoinRoom(roomId: string, _player: PlayerIdentity): void {
    lastRoomRequestType = "join"
    emitAuthenticated("room:join", { roomId })
}

export function onRoomUpdated(
    handler: (room: ServerToClientParsedPayload<"room:updated">) => void,
): Disposer {
    return onValidatedServerEvent("room:updated", handler)
}

export function onRoomMessage(
    handler: (message: ServerToClientParsedPayload<"room:message">) => void,
): Disposer {
    return onValidatedServerEvent("room:message", handler)
}

export function sendGlobalChat(_player: PlayerIdentity, text: string): void {
    emitAuthenticated("global:chat", { text })
}

export function sendRoomChat(roomId: string, _playerId: string | null, text: string): void {
    emitAuthenticated("room:chat", { roomId, text })
}

export function onGlobalMessage(
    handler: (message: ServerToClientParsedPayload<"global:message">) => void,
): Disposer {
    return onValidatedServerEvent("global:message", handler)
}

export function onChatResult(
    handler: (result: ServerToClientParsedPayload<"chat:result">) => void,
): Disposer {
    return onValidatedServerEvent("chat:result", handler)
}

export function requestLeaveRoom(roomId: string, _playerId: string | null): void {
    lastRoomRequestType = "leave"
    emitAuthenticated("room:leave", { roomId })
}

/**
 * 게임 페이지가 현재 authoritative match에 참가하거나 재접속하도록 요청한다.
 *
 * 성공 응답에는 최신 room, player별 server bag과 snapshot이 포함된다. 저장된 room은
 * routing 힌트일 뿐이며 이 응답을 받아야 실제 multiplayer runtime을 시작할 수 있다.
 *
 * @returns void
 */
export function requestJoinGameRoom(roomId: string, _playerId: string): void {
    emitAuthenticated("game:join", { roomId })
}

export function onGameJoinResult(
    handler: (result: ServerToClientParsedPayload<"game:join:result">) => void,
): Disposer {
    return onValidatedServerEvent("game:join:result", handler)
}

export function onPveAiPolicy(
    handler: (policy: ServerToClientParsedPayload<"pve:ai-policy">) => void,
): Disposer {
    return onValidatedServerEvent("pve:ai-policy", handler)
}

export function requestStartGame(roomId: string, _playerId: string | null): void {
    lastRoomRequestType = "start"
    emitAuthenticated("room:start", { roomId })
}

// =============================
// 게임 동기화 채널
// local prediction의 입력을 서버에 보내고 authoritative 결과를 다시 받는 채널이다.
// 서버 snapshot이 최종 진실이며 clientSequence가 두 상태의 진행 위치를 연결한다.
// =============================

/**
 * local runtime에서 실제 적용된 입력을 authoritative 서버로 전송한다.
 *
 * clientSequence는 입력 순서와 acknowledgment를 연결한다. expectedTransform은 서버가
 * 같은 조각·회전·열을 보고 있는지 확인하는 divergence 증거이며 권한 정보가 아니다.
 * hold 외 입력은 transform이 없으면 잘못된 prediction을 보낼 수 있으므로 전송하지 않는다.
 *
 * @returns event를 실제 전송했으면 true
 */
export function sendGameInput(
    roomId: ClientToServerWirePayload<"game:input">["roomId"],
    _playerId: string,
    action: Extract<ClientToServerWirePayload<"game:input">, { action: "hold" }>["action"],
    tick: ClientToServerWirePayload<"game:input">["tick"],
    pieceIndex: ClientToServerWirePayload<"game:input">["pieceIndex"],
    clientSequence: ClientToServerWirePayload<"game:input">["clientSequence"],
    expectedTransform?: Extract<ClientToServerWirePayload<"game:input">, { action: "hold" }>["expectedTransform"] | null,
): boolean;
export function sendGameInput(
    roomId: ClientToServerWirePayload<"game:input">["roomId"],
    _playerId: string,
    action: Exclude<ClientToServerWirePayload<"game:input">, { action: "hold" }>["action"],
    tick: ClientToServerWirePayload<"game:input">["tick"],
    pieceIndex: ClientToServerWirePayload<"game:input">["pieceIndex"],
    clientSequence: ClientToServerWirePayload<"game:input">["clientSequence"],
    expectedTransform: Exclude<ClientToServerWirePayload<"game:input">, { action: "hold" }>["expectedTransform"],
): boolean;
export function sendGameInput(
    roomId: ClientToServerWirePayload<"game:input">["roomId"],
    _playerId: string,
    action: ClientToServerWirePayload<"game:input">["action"],
    tick: ClientToServerWirePayload<"game:input">["tick"],
    pieceIndex: ClientToServerWirePayload<"game:input">["pieceIndex"],
    clientSequence: ClientToServerWirePayload<"game:input">["clientSequence"],
    expectedTransform: NonNullable<ClientToServerWirePayload<"game:input">["expectedTransform"]> | null = null,
): boolean {
    if (action === "hold") {
        return emitAuthenticated("game:input", expectedTransform
            ? { roomId, action, tick, pieceIndex, clientSequence, expectedTransform }
            : { roomId, action, tick, pieceIndex, clientSequence })
    }
    if (!expectedTransform) return false
    return emitAuthenticated("game:input", {
        roomId,
        action,
        tick,
        pieceIndex,
        clientSequence,
        expectedTransform,
    })
}

export function onGameInputResult(
    handler: (result: ServerToClientParsedPayload<"game:input:result">) => void,
): Disposer {
    return onValidatedServerEvent("game:input:result", handler)
}

export function requestGameBagChunk(roomId: string, _playerId: string): boolean {
    return emitAuthenticated("game:bag:request", { roomId })
}

export function receiveGameBagAppend(
    handler: (append: ServerToClientParsedPayload<"game:bag:append">) => void,
): Disposer {
    return onValidatedServerEvent("game:bag:append", handler)
}

export function onGameBagResult(
    handler: (result: ServerToClientParsedPayload<"game:bag:result">) => void,
): Disposer {
    return onValidatedServerEvent("game:bag:result", handler)
}

export function sendPlacementDecisionLogEvent(roomId: string, log: unknown): boolean {
    return emitAuthenticated("game:log:placement_decision", {
        roomId,
        log,
    })
}

export function onPlacementDecisionLogResult(
    handler: (result: ServerToClientParsedPayload<"game:log:result">) => void,
): Disposer {
    return onValidatedServerEvent("game:log:result", handler)
}

export function receiveAuthoritativeSnapshot(
    handler: (snapshot: ServerToClientParsedPayload<"game:authoritative:snapshot">) => void,
): Disposer {
    return onValidatedServerEvent("game:authoritative:snapshot", handler)
}

export function leaveGame(roomId: string, _playerId: string | null): void {
    emitAuthenticated("game:leave", { roomId })

}

export function onGameOpponentLeft(
    handler: (result: ServerToClientParsedPayload<"game:opponent-left">) => void,
): Disposer {
    return onValidatedServerEvent("game:opponent-left", handler)
}

export function requestRoomSync(roomId: string, _playerId: string): void {
    lastRoomRequestType = "sync"
    emitAuthenticated("room:sync", { roomId })
}

export function onMatchFinish(
    handler: (result: ServerToClientParsedPayload<"match:finish">) => void,
): Disposer {
    return onValidatedServerEvent("match:finish", handler)
}
