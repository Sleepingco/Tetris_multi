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

serverConnection.on("connect", () => {
    activeSocketId = serverConnection.id
    activeSession = null
})

serverConnection.on("session:ready", (session) => {
    if (
        !serverConnection.connected
        || serverConnection.id !== activeSocketId
        || session?.version !== SESSION_VERSION
        || typeof session.playerId !== "string"
        || typeof session.token !== "string"
        || typeof session.nickname !== "string"
        || !Number.isFinite(session.expiresAt)
    ) {
        return
    }

    activeSession = { ...session }
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

serverConnection.on("disconnect", () => {
    activeSession = null
    sessionDisconnectedHandlers.forEach(handler => handler())
})

serverConnection.connect()

function emitAuthenticated(eventName, payload) {
    if (!activeSession || !serverConnection.connected) return false

    serverConnection.emit(eventName, payload)
    return true
}

// =============================
// Socket.IO Room Adapter
// 브라우저 전역 socket을 한 번만 만들고, 페이지 코드는 이 얇은 함수들만 사용한다.
// =============================

export function getServerConnection() {
    return serverConnection
}

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
    serverConnection.on("room:result", (result) => {
        handler(result, lastRoomRequestType)
    })
}

export function requestJoinRoom(roomId, player) {
    lastRoomRequestType = "join"
    emitAuthenticated("room:join", { roomId })
}

export function onRoomUpdated(handler) {
    serverConnection.on("room:updated", handler)
}

export function onRoomMessage(handler) {
    serverConnection.on("room:message", handler)
}

export function sendGlobalChat(player, text) {
    emitAuthenticated("global:chat", { text })
}

export function sendRoomChat(roomId, playerId, text) {
    emitAuthenticated("room:chat", { roomId, text })
}

export function onGlobalMessage(handler) {
    serverConnection.on("global:message", handler)

    return () => {
        serverConnection.off("global:message", handler)
    }
}

export function onChatResult(handler) {
    serverConnection.on("chat:result", handler)

    return () => {
        serverConnection.off("chat:result", handler)
    }
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
    serverConnection.on("game:join:result", handler)
}

export function onPveAiPolicy(handler) {
    serverConnection.on("pve:ai-policy", handler)

    return () => {
        serverConnection.off("pve:ai-policy", handler)
    }
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
    serverConnection.on("game:input:result", handler)

    return () => {
        serverConnection.off("game:input:result", handler)
    }
}

export function requestGameBagChunk(roomId, playerId) {
    emitAuthenticated("game:bag:request", { roomId })
}

export function receiveGameBagAppend(handler) {
    serverConnection.on("game:bag:append", handler)

    return () => {
        serverConnection.off("game:bag:append", handler)
    }
}

export function onGameBagResult(handler) {
    serverConnection.on("game:bag:result", handler)

    return () => {
        serverConnection.off("game:bag:result", handler)
    }
}

export function sendPlacementDecisionLogEvent(roomId, log) {
    return emitAuthenticated("game:log:placement_decision", {
        roomId,
        log,
    })
}

export function receiveAuthoritativeSnapshot(handler) {
    serverConnection.on("game:authoritative:snapshot", handler)

    return () => {
        serverConnection.off("game:authoritative:snapshot", handler)
    }
}

export function leaveGame(roomId, playerId) {
    emitAuthenticated("game:leave", { roomId })

}

export function onGameOpponentLeft(handler) {
    serverConnection.on("game:opponent-left", handler)
}

export function requestRoomSync(roomId, playerId) {
    lastRoomRequestType = "sync"
    emitAuthenticated("room:sync", { roomId })
}

export function onMatchFinish(handler) {
    serverConnection.on("match:finish", handler)

    return () => {
        serverConnection.off("match:finish", handler)
    }
}
