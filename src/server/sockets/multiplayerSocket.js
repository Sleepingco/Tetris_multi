// const moment = require("moment")
const {
    createRoom,
    getRoomState,
    joinRoom,
    removePlayer,
    findRoomBySocketId,
    startGame,
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
            const roomBeforeLeave = getRoomState(roomId)
            const leavingPlayer = roomBeforeLeave?.players.find(player => player.playerId === playerId)
            const result = removePlayer(roomId, playerId)

            handlePlayerLeftRoom(
                socketServer,
                clientSocket,
                roomId,
                result,
                leavingPlayer?.nickname || "Player",
            )

            clientSocket.emit("room:result", result)
        })

        clientSocket.on("disconnect", () => {
            const found = findRoomBySocketId(clientSocket.id);
            if (found) {
                const { room, player } = found
                const result = removePlayer(room.roomId, player.playerId)

                handlePlayerLeftRoom(
                    socketServer,
                    clientSocket,
                    room.roomId,
                    result,
                    player?.nickname || "Player",
                )
            }
        })

        clientSocket.on("room:start", ({ roomId, playerId }) => {
            const found = findRoomBySocketId(clientSocket.id);
            if (!found) return;

            if (found.room.hostPlayerId !== playerId) {
                clientSocket.emit("room:result", {
                    ok: false,
                    error: "방장만 게임을 시작할 수 있습니다."
                })
                return;
            }

            const result = startGame(roomId, playerId);
            const hostPlayer = found.player
            if (result.ok && result.room) {
                socketServer.to(result.room.roomId).emit("room:updated", result.room);
                socketServer.to(result.room.roomId).emit("room:message", {
                    type: "system",
                    text: `${hostPlayer?.nickname || "Host"}님이 게임을 시작했습니다.`,
                    roomId: result.room.roomId,
                })

                clientSocket.emit("room:result", result);
            } else {
                clientSocket.emit("room:result", result);
            }
        })

    })
}

module.exports = {
    registerMultiplayerSocket,
}
