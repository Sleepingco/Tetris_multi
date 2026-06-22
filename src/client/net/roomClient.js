if (typeof io !== "function") {
    throw new Error("Socket.IO client script must be loaded before client/net/roomClient.js")
}

const serverConnection = io()
let lastRoomRequestType = null

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

export function receiveSnapshot(handler) {
    serverConnection.on("game:snapshot", handler)
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