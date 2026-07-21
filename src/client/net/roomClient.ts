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
// Socket.IO Room Adapter
// 브라우저 전역 socket을 한 번만 만들고, 페이지 코드는 이 얇은 함수들만 사용한다.
// =============================

export function getPlayerSession(): PlayerSession | null {
    if (activeSession) return toPlayerSession(activeSession)

    const storedSession = readStoredSession()
    return !storedSession || "malformed" in storedSession
        ? null
        : toPlayerSession(storedSession)
}

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
 * @param {{playerId: string|null, nickname: string}} player
 * @param {"pvp"|"pve"} mode
 * @param {"normal"|"hard"|null} aiDifficulty
 * @param {"heuristic"|"placement_v4"|null} aiPolicy
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

// 게임 화면에서 이미 시작된 room/match 상태와 server bag 정보를 다시 받는다.
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
// Game Sync Channel
// 서버 입력/상태 동기화 채널이다.
// =============================

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
