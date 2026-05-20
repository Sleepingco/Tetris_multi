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

      clientSocket.emit("room:result", result)
    })

    clientSocket.on("room:join", ({ roomId, player }) => {
      const guestPlayer = player
        ? { ...player, socketId: clientSocket.id }
        : null
      const result = joinRoom(roomId, guestPlayer)

      clientSocket.emit("room:result", result)
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
