const { registerChatHandlers } = require("./chatHandlers.js")
const { registerMultiplayerHandlers } = require("./multiplayerHandlers.js")

/**
 * Socket.IO connection 진입점을 한 곳에 둔다.
 * - 같은 clientSocket에 채팅과 멀티플레이 핸들러를 기능별로 조합한다.
 *
 * @param {import("socket.io").Server} socketServer - Socket.IO 서버 인스턴스
 * @param {Object} dependencies - 테스트에서 주입할 서비스 의존성
 * @returns {void}
 */
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
