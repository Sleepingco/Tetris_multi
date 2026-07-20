import { parseServerEvent } from "../../shared/socketContracts.mjs"

if (typeof io !== "function") {
    throw new Error("Socket.IO client script must be loaded before client/net/roomClient.js")
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
const sessionReadyHandlers = new Set()
const sessionErrorHandlers = new Set()
const sessionDisconnectedHandlers = new Set()
let activeSession = null
let activeSocketId = null
let terminalRetryUsed = false
let recoveringWithNewSession = false

function readNickname() {
    return sessionStorage.getItem("tetris:nickname")?.trim() || "Guest"
}

function readStoredSession() {
    const rawSession = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (!rawSession) return null

    try {
        const session = JSON.parse(rawSession)
        if (
            session?.version !== SESSION_VERSION
            || typeof session.playerId !== "string"
            || typeof session.token !== "string"
            || typeof session.nickname !== "string"
            || !Number.isFinite(session.expiresAt)
        ) {
            return { malformed: true }
        }
        return session
    } catch {
        return { malformed: true }
    }
}

function createHandshakeAuth(callback) {
    const session = readStoredSession()
    if (session?.malformed) {
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

function clearIdentityAndRoom() {
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
let lastRoomRequestType = null

function onValidatedServerEvent(eventName, handler) {
    const validatedHandler = (payload) => {
        const validation = parseServerEvent(eventName, payload)
        if (!validation.success) {
            console.warn(`[socket-protocol] ${eventName}: INVALID_SERVER_PAYLOAD`)
            if (eventName === "session:ready") {
                activeSession = null
                serverConnection.io?.reconnection?.(false)
                sessionErrorHandlers.forEach(sessionHandler => sessionHandler({
                    code: "SESSION_PROTOCOL_ERROR",
                    terminal: true,
                }))
                serverConnection.disconnect?.()
            }
            return
        }
        handler(validation.data)
    }

    serverConnection.on(eventName, validatedHandler)
    return () => serverConnection.off(eventName, validatedHandler)
}

serverConnection.on("connect", () => {
    activeSocketId = serverConnection.id
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
    sessionReadyHandlers.forEach(handler => handler({ ...activeSession }))
})

serverConnection.on("connect_error", (error) => {
    const code = error?.data?.code || "SESSION_CONNECTION_FAILED"
    sessionErrorHandlers.forEach(handler => handler({ code, terminal: error?.data?.terminal === true }))

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

serverConnection.on("disconnect", (reason) => {
    activeSession = null
    if (Array.isArray(serverConnection.sendBuffer)) {
        serverConnection.sendBuffer.length = 0
    }
    sessionDisconnectedHandlers.forEach(handler => handler({
        reason,
        terminal: reason === "io server disconnect",
    }))
})

serverConnection.connect()

function emitAuthenticated(eventName, payload) {
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

export function getPlayerSession() {
    if (activeSession) return { ...activeSession }

    const storedSession = readStoredSession()
    return storedSession?.malformed ? null : storedSession
}

export function onSessionReady(handler) {
    sessionReadyHandlers.add(handler)
    if (activeSession) queueMicrotask(() => handler({ ...activeSession }))

    return () => sessionReadyHandlers.delete(handler)
}

export function onSessionError(handler) {
    sessionErrorHandlers.add(handler)
    return () => sessionErrorHandlers.delete(handler)
}

export function onSessionDisconnected(handler) {
    sessionDisconnectedHandlers.add(handler)
    return () => sessionDisconnectedHandlers.delete(handler)
}

export function requestCreateRoom(player, mode = "pvp", aiDifficulty = null, aiPolicy = null) {
    lastRoomRequestType = "create"
    const payload = { mode }
    if (mode === "pve" && aiDifficulty !== null) {
        payload.aiDifficulty = aiDifficulty
    }
    if (mode === "pve" && aiPolicy !== null) {
        payload.aiPolicy = aiPolicy
    }
    emitAuthenticated("room:create", payload)
}

export function onRoomResult(handler) {
    return onValidatedServerEvent("room:result", (result) => {
        handler(result, lastRoomRequestType)
    })
}

export function requestJoinRoom(roomId, player) {
    lastRoomRequestType = "join"
    emitAuthenticated("room:join", { roomId })
}

export function onRoomUpdated(handler) {
    return onValidatedServerEvent("room:updated", handler)
}

export function onRoomMessage(handler) {
    return onValidatedServerEvent("room:message", handler)
}

export function sendGlobalChat(player, text) {
    emitAuthenticated("global:chat", { text })
}

export function sendRoomChat(roomId, playerId, text) {
    emitAuthenticated("room:chat", { roomId, text })
}

export function onGlobalMessage(handler) {
    return onValidatedServerEvent("global:message", handler)
}

export function onChatResult(handler) {
    return onValidatedServerEvent("chat:result", handler)
}

export function requestLeaveRoom(roomId, playerId) {
    lastRoomRequestType = "leave"
    emitAuthenticated("room:leave", { roomId })
}

// 게임 화면에서 이미 시작된 room/match 상태와 server bag 정보를 다시 받는다.
export function requestJoinGameRoom(roomId, playerId) {
    emitAuthenticated("game:join", { roomId })
}

export function onGameJoinResult(handler) {
    return onValidatedServerEvent("game:join:result", handler)
}

export function onPveAiPolicy(handler) {
    return onValidatedServerEvent("pve:ai-policy", handler)
}

export function requestStartGame(roomId, playerId) {
    lastRoomRequestType = "start"
    emitAuthenticated("room:start", { roomId })
}

// =============================
// Game Sync Channel
// 서버 입력/상태 동기화 채널이다.
// =============================

export function sendGameInput(
    roomId,
    playerId,
    action,
    tick = null,
    pieceIndex = null,
    clientSequence = null,
    expectedTransform = null,
) {
    const payload = {
        roomId,
        action,
        tick,
        pieceIndex,
        clientSequence,
    }
    if (expectedTransform) {
        payload.expectedTransform = expectedTransform
    }
    return emitAuthenticated("game:input", payload)
}

export function onGameInputResult(handler) {
    return onValidatedServerEvent("game:input:result", handler)
}

export function requestGameBagChunk(roomId, playerId) {
    return emitAuthenticated("game:bag:request", { roomId })
}

export function receiveGameBagAppend(handler) {
    return onValidatedServerEvent("game:bag:append", handler)
}

export function onGameBagResult(handler) {
    return onValidatedServerEvent("game:bag:result", handler)
}

export function sendPlacementDecisionLogEvent(roomId, log) {
    return emitAuthenticated("game:log:placement_decision", {
        roomId,
        log,
    })
}

export function onPlacementDecisionLogResult(handler) {
    return onValidatedServerEvent("game:log:result", handler)
}

export function receiveAuthoritativeSnapshot(handler) {
    return onValidatedServerEvent("game:authoritative:snapshot", handler)
}

export function leaveGame(roomId, playerId) {
    emitAuthenticated("game:leave", { roomId })

}

export function onGameOpponentLeft(handler) {
    return onValidatedServerEvent("game:opponent-left", handler)
}

export function requestRoomSync(roomId, playerId) {
    lastRoomRequestType = "sync"
    emitAuthenticated("room:sync", { roomId })
}

export function onMatchFinish(handler) {
    return onValidatedServerEvent("match:finish", handler)
}
