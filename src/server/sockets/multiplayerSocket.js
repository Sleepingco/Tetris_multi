// const moment = require("moment")
const {
    createRoom,
    joinRoom,
    removePlayer,
} = require("../services/roomService.js")

function registerMultiplayerSocket(socketServer) {
    socketServer.on("connection", (clientSocket) => {
        console.log("a user connected")

        clientSocket.on("chatting", (data) => {
            console.log("server received data: ", data)
            const { name, msg } = data
            socketServer.emit("chatting", {
                name,
                msg,
                // time: moment(new Date()).format("H:mm A"),
            })
        })

        clientSocket.on("room:create", (player) => {
            const hostPlayer = player
                ? { ...player, socketId: clientSocket.id }
                : null
            const result = createRoom(hostPlayer)
            
            if (result.ok) {
                clientSocket.join(result.room.roomId);
            }
            clientSocket.emit("room:result", result)
        })

        clientSocket.on("room:join", ({ roomId, player }) => {
            const guestPlayer = player
                ? { ...player, socketId: clientSocket.id }
                : null
            const result = joinRoom(roomId, guestPlayer)
            if (result.ok && result.room) {
                clientSocket.join(result.room.roomId);
                clientSocket.emit("room:result", result)
                socketServer.to(result.room.roomId).emit("room:updated", result.room);
                socketServer.to(result.room.roomId).emit("room:message", {
                    type: "system",
                    text: `${guestPlayer.nickname}님이 입장하였습니다.`,
                    roomId: result.room.roomId,
                })
            } else {
                clientSocket.emit("room:result", result)
            }
        })

        clientSocket.on("room:leave", ({ roomId, playerId }) => {
            const result = removePlayer(roomId, playerId)

            clientSocket.emit("room:result", result)
        })
    })
}

module.exports = {
    registerMultiplayerSocket,
}
