if (typeof io !== "function") {
    throw new Error("Socket.IO client script must be loaded before client/net/roomClient.js")
}

const serverConnection = io()
let lastRoomRequestType = null

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

export function sendGameSnapshot(roomId, playerId, snapshot) {
    serverConnection.emit("game:snapshot", { roomId, playerId, snapshot })
}

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

export function sendGarbageAttack(roomId, playerId, lines) {
    serverConnection.emit("game:garbage:attack", { roomId, playerId, lines })
}

export function receiveGarbageAppend(handler) {
    serverConnection.on("game:garbage:append", handler)

    return () => {
        serverConnection.off("game:garbage:append", handler)
    }
}

export function onGarbageResult(handler) {
    serverConnection.on("game:garbage:result", handler)

    return () => {
        serverConnection.off("game:garbage:result", handler)
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

export function receiveSnapshot(handler) {
    serverConnection.on("game:snapshot", handler)

    return () => {
        serverConnection.off("game:snapshot", handler)
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

export function onGameSnapshotResult(handler) {
    serverConnection.on("game:snapshot:result", handler)

    return () => {
        serverConnection.off("game:snapshot:result", handler)
    }
}

export function requestGameShadowState(roomId, playerId) {
    serverConnection.emit("game:shadow:state", { roomId, playerId })
}

export function onGameShadowStateResult(handler) {
    serverConnection.on("game:shadow:state:result", handler)

    return () => {
        serverConnection.off("game:shadow:state:result", handler)
    }
}

export function requestGameAuthoritativeSnapshot(roomId, playerId) {
    serverConnection.emit("game:authoritative:snapshot", { roomId, playerId })
}

export function onGameAuthoritativeSnapshotResult(handler) {
    serverConnection.on("game:authoritative:snapshot:result", handler)

    return () => {
        serverConnection.off("game:authoritative:snapshot:result", handler)
    }
}

export function receiveGameAuthoritativeSnapshotUpdate(handler) {
    serverConnection.on("game:authoritative:snapshot:update", handler)

    return () => {
        serverConnection.off("game:authoritative:snapshot:update", handler)
    }
}

export function subscribeGameAuthoritativeSnapshotUpdates(roomId, playerId) {
    serverConnection.emit("game:authoritative:snapshot:subscribe", { roomId, playerId })
}

export function unsubscribeGameAuthoritativeSnapshotUpdates(roomId, playerId) {
    serverConnection.emit("game:authoritative:snapshot:unsubscribe", { roomId, playerId })
}

export function onGameAuthoritativeSnapshotSubscribeResult(handler) {
    serverConnection.on("game:authoritative:snapshot:subscribe:result", handler)

    return () => {
        serverConnection.off("game:authoritative:snapshot:subscribe:result", handler)
    }
}

export function onGameAuthoritativeSnapshotUnsubscribeResult(handler) {
    serverConnection.on("game:authoritative:snapshot:unsubscribe:result", handler)

    return () => {
        serverConnection.off("game:authoritative:snapshot:unsubscribe:result", handler)
    }
}

export function sendGameOver(roomId, playerId, reason) {
    serverConnection.emit("game:over", { roomId, playerId, reason })
}

export function onMatchFinish(handler) {
    serverConnection.on("match:finish", handler)

    return () => {
        serverConnection.off("match:finish", handler)
    }
}

export function onGameOverResult(handler) {
    serverConnection.on("game:over:result", handler)

    return () => {
        serverConnection.off("game:over:result", handler)
    }
}
