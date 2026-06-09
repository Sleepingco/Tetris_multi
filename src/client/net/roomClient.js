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