const { syncRoom } = require("../services/roomService.js")
const { parseClientEvent } = require("../../shared/socketContracts.mjs")

function failure(reason, meta = {}) {
    return {
        ok: false,
        reason,
        ...meta,
    }
}

function registerChatHandlers(socketServer, clientSocket, dependencies = {}) {
    const playerSessionService = dependencies.playerSessionService
    const socketRateLimitService = dependencies.socketRateLimitService
    const sessionContext = clientSocket.data?.playerSession
    const playerIdentity = clientSocket.data?.playerIdentity

    function authorizeChat() {
        if (!playerSessionService?.isActiveSocket(sessionContext, clientSocket.id)) {
            return failure("NOT_AUTHORIZED")
        }
        if (!socketRateLimitService?.consume("chat", playerIdentity?.playerId)) {
            return failure("CHAT_RATE_LIMITED")
        }
        return null
    }

    clientSocket.on("global:chat", (payload) => {
        const result = authorizeChat()

        if (result) {
            clientSocket.emit("chat:result", result)
            return
        }
        const validation = parseClientEvent("global:chat", payload)
        if (!validation.success) {
            clientSocket.emit("chat:result", failure("INVALID_PAYLOAD"))
            return
        }

        socketServer.emit("global:message", {
            type: "chat",
            scope: "global",
            playerId: playerIdentity.playerId,
            nickname: playerIdentity.nickname,
            text: validation.data.text,
        })
    })

    clientSocket.on("room:chat", (payload) => {
        const playerId = playerIdentity?.playerId
        const authorization = authorizeChat()
        if (authorization) {
            clientSocket.emit("chat:result", authorization)
            return
        }
        const validation = parseClientEvent("room:chat", payload)
        if (!validation.success) {
            clientSocket.emit("chat:result", failure("INVALID_PAYLOAD"))
            return
        }
        const { roomId, text } = validation.data
        // 채팅 전송 전에 room/player 소속만 검증한다. 게임 판정이나 room 상태 전이는 하지 않는다.
        const roomResult = syncRoom(roomId, playerId)
        if (!roomResult.ok) {
            clientSocket.emit("chat:result", roomResult)
            return
        }

        const player = roomResult.room.players.find(player => player.playerId === playerId)
        socketServer.to(roomResult.room.roomId).emit("room:message", {
            type: "chat",
            scope: "room",
            roomId: roomResult.room.roomId,
            playerId,
            nickname: player?.nickname || "Guest",
            text,
        })
    })

}

module.exports = {
    registerChatHandlers,
}
