const { registerChatHandlers } = require("./chatHandlers.js")
const { registerMultiplayerHandlers } = require("./multiplayerHandlers.js")

function registerSocketHandlers(socketServer, dependencies = {}) {
    socketServer.on("connection", (clientSocket) => {
        console.log("a user connected")

        registerChatHandlers(socketServer, clientSocket)
        registerMultiplayerHandlers(socketServer, clientSocket, dependencies)
    })
}

module.exports = {
    registerSocketHandlers,
}
