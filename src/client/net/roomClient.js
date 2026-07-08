if (typeof io !== "function") {
    throw new Error("Socket.IO client script must be loaded before client/net/roomClient.js")
}

const serverConnection = io()
let lastRoomRequestType = null

// =============================
// Socket.IO Room Adapter
// 브라우저 전역 socket을 한 번만 만들고, 페이지 코드는 이 얇은 함수들만 사용한다.
// =============================

export function getServerConnection() {
    return serverConnection
}

export function requestCreateRoom(player) {
    lastRoomRequestType = "create"
    serverConnection.emit("room:create", player)
}

export function onRoomResult(handler) {
    serverConnection.on("room:result", (result) => {
        handler(result, lastRoomRequestType)
    })
}

export function requestJoinRoom(roomId, player) {
    lastRoomRequestType = "join"
    serverConnection.emit("room:join", { roomId, player })
}

export function onRoomUpdated(handler) {
    serverConnection.on("room:updated", handler)
}

export function onRoomMessage(handler) {
    serverConnection.on("room:message", handler)
}

export function sendGlobalChat(player, text) {
    serverConnection.emit("global:chat", {
        playerId: player?.playerId,
        nickname: player?.nickname,
        text,
    })
}

export function sendRoomChat(roomId, playerId, text) {
    serverConnection.emit("room:chat", { roomId, playerId, text })
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
    serverConnection.emit("room:leave", { roomId, playerId })
}

// 게임 화면에서 이미 시작된 room/match 상태와 server bag 정보를 다시 받는다.
export function requestJoinGameRoom(roomId, playerId) {
    serverConnection.emit("game:join", { roomId, playerId })
}

export function onGameJoinResult(handler) {
    serverConnection.on("game:join:result", handler)
}

export function requestStartGame(roomId, playerId) {
    lastRoomRequestType = "start"
    serverConnection.emit("room:start", { roomId, playerId })
}

// =============================
// Game Sync Channel
// 서버 입력/상태 동기화 채널이다.
// =============================

export function sendGameInput(roomId, playerId, action, tick = null, pieceIndex = null) {
    serverConnection.emit("game:input", { roomId, playerId, action, tick, pieceIndex })
}

export function receiveGameInput(handler) {
    serverConnection.on("game:input", handler)

    return () => {
        serverConnection.off("game:input", handler)
    }
}

export function onGameInputResult(handler) {
    serverConnection.on("game:input:result", handler)

    return () => {
        serverConnection.off("game:input:result", handler)
    }
}

export function receiveGarbageAppend(handler) {
    serverConnection.on("game:garbage:append", handler)

    return () => {
        serverConnection.off("game:garbage:append", handler)
    }
}

export function requestGameBagChunk(roomId, playerId) {
    serverConnection.emit("game:bag:request", { roomId, playerId })
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

export function receiveAuthoritativeSnapshot(handler) {
    serverConnection.on("game:authoritative:snapshot", handler)

    return () => {
        serverConnection.off("game:authoritative:snapshot", handler)
    }
}

export function leaveGame(roomId, playerId) {
    serverConnection.emit("game:leave", { roomId, playerId })

}

export function onGameOpponentLeft(handler) {
    serverConnection.on("game:opponent-left", handler)
}

export function requestRoomSync(roomId, playerId) {
    lastRoomRequestType = "sync"
    serverConnection.emit("room:sync", { roomId, playerId })
}

export function onMatchFinish(handler) {
    serverConnection.on("match:finish", handler)

    return () => {
        serverConnection.off("match:finish", handler)
    }
}
