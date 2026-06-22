// const moment = require("moment")
const {
    createRoom,
    joinRoom,
    removePlayerBySocketId,
    startGame,
    leaveGame,
    syncRoom,
    leaveRoom,

} = require("../services/roomService.js")

function handlePlayerLeftRoom(socketServer, clientSocket, roomId, result, nickname) {
    if (!result.ok) return

    clientSocket.leave(roomId)

    if (!result.room) return

    socketServer.to(roomId).emit("room:updated", result.room)
    socketServer.to(roomId).emit("room:message", {
        type: "system",
        text: `${nickname}님이 퇴장하였습니다.`,
        roomId: result.room.roomId,
    })
}

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
            const result = leaveRoom(roomId, playerId)
            handlePlayerLeftRoom(
                socketServer,
                clientSocket,
                result.roomId,
                result,
                result.player?.nickname || "Player",
            )

            clientSocket.emit("room:result", result)
        })

        clientSocket.on("disconnect", () => {
            const result = removePlayerBySocketId(clientSocket.id)

            handlePlayerLeftRoom(
                socketServer,
                clientSocket,
                result.roomId,
                result,
                result.player?.nickname || "Player",
            )
        })

        clientSocket.on("room:start", (payload = {}) => {
            const { roomId, playerId } = payload
            const result = startGame(roomId, playerId, clientSocket.id)

            if (result.ok && result.room) {
                const hostPlayer = result.room.players.find(player => player.playerId === playerId)

                clientSocket.emit("room:result", result)
                socketServer.to(result.room.roomId).emit("room:updated", result.room);
                socketServer.to(result.room.roomId).emit("room:message", {
                    type: "system",
                    text: `${hostPlayer?.nickname || "Host"}님이 게임을 시작했습니다.`,
                    roomId: result.room.roomId,
                })
            } else {
                clientSocket.emit("room:result", result)
            }
        })

        clientSocket.on("game:join", (payload = {}) => {
            const { roomId, playerId } = payload
            const result = syncRoom(roomId, playerId)

            if (result.ok && result.room) {
                clientSocket.join(result.room.roomId)
            }

            clientSocket.emit("game:join:result", result)
        })

        clientSocket.on("game:snapshot", (payload = {}) => {
            const { roomId, playerId, snapshot } = payload
            clientSocket.to(roomId).emit("game:snapshot", { playerId, snapshot })
        })

        clientSocket.on("game:leave", (payload = {}) => {
            const { roomId, playerId } = payload
            const result = leaveGame(roomId, playerId)
            if (result.ok) {
                clientSocket.leave(roomId)
                clientSocket.to(roomId).emit("game:opponent-left", {
                    room: result.room,
                    playerId
                })
            }

            clientSocket.emit("game:leave:result", result)

        })

        clientSocket.on("room:sync", (payload = {}) => {
            const { roomId, playerId } = payload
            const result = syncRoom(roomId, playerId)

            if (result.ok && result.room) {
                clientSocket.join(result.room.roomId)
            }

            clientSocket.emit("room:result", result)
        })

    })
}


module.exports = {
    registerMultiplayerSocket,
}
