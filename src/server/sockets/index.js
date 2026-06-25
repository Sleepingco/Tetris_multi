const { registerChatHandlers } = require("./chatHandlers.js")
const { registerMultiplayerHandlers } = require("./multiplayerHandlers.js")

function registerSocketHandlers(socketServer) {
    socketServer.on("connection", (clientSocket) => {
        console.log("a user connected")

        registerChatHandlers(socketServer, clientSocket)
        registerMultiplayerHandlers(socketServer, clientSocket)
    })
}

module.exports = {
    registerSocketHandlers,
}
