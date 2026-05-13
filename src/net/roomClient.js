if (typeof io !== "function") {
    throw new Error("Socket.IO client script must be loaded before roomClient.js")
}

const socket = io()

export function createRoom(player) {
    socket.emit("room:create", player)
}

export function onRoomResult(handler) {
    socket.on("room:result", handler)
}