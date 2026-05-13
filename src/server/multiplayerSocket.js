// const moment = require("moment")
const {
  createRoom,
  joinRoom,
  removePlayer,
} = require("./roomService.js")

function registerMultiplayerSocket(io) {
  io.on("connection", (socket) => {
    console.log("a user connected")

    socket.on("chatting", (data) => {
      console.log("server received data: ", data)
      const { name, msg } = data
      io.emit("chatting", {
        name,
        msg,
        // time: moment(new Date()).format("H:mm A"),
      })
    })

    socket.on("room:create", (player) => {
      const hostPlayer = player
        ? { ...player, socketId: socket.id }
        : null
      const result = createRoom(hostPlayer)

      socket.emit("room:result", result)
    })

    socket.on("room:join", ({ roomId, player }) => {
      const guestPlayer = player
        ? { ...player, socketId: socket.id }
        : null
      const result = joinRoom(roomId, guestPlayer)

      socket.emit("room:result", result)
    })

    socket.on("room:leave", ({ roomId, playerId }) => {
      const result = removePlayer(roomId, playerId)

      socket.emit("room:result", result)
    })
  })
}

module.exports = {
  registerMultiplayerSocket,
}
