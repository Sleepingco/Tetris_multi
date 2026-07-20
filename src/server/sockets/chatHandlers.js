const { syncRoom } = require("../services/roomService.js")

const CHAT_MAX_LENGTH = 200

function success(meta = {}) {
    return {
        ok: true,
        reason: null,
        ...meta,
    }
}

function failure(reason, meta = {}) {
    return {
        ok: false,
        reason,
        ...meta,
    }
}

function normalizeChatText(text) {
    if (typeof text !== "string") {
        return failure("EMPTY_CHAT_MESSAGE", { text: "" })
    }

    const normalizedText = text.trim()
    if (!normalizedText) {
        return failure("EMPTY_CHAT_MESSAGE", { text: "" })
    }

    if (normalizedText.length > CHAT_MAX_LENGTH) {
        return failure("CHAT_MESSAGE_TOO_LONG", { text: normalizedText })
    }

    return success({ text: normalizedText })
}

function validateChat(text) {
    const textResult = normalizeChatText(text)
    if (!textResult.ok) return textResult
    return success({ text: textResult.text })
}

function registerChatHandlers(socketServer, clientSocket, dependencies = {}) {
    const playerSessionService = dependencies.playerSessionService
    const socketRateLimitService = dependencies.socketRateLimitService
    const sessionContext = clientSocket.data?.playerSession
    const playerIdentity = clientSocket.data?.playerIdentity

    function authorizeChat(text) {
        if (!playerSessionService?.isActiveSocket(sessionContext, clientSocket.id)) {
            return failure("NOT_AUTHORIZED")
        }
        if (!socketRateLimitService?.consume("chat", playerIdentity?.playerId)) {
            return failure("CHAT_RATE_LIMITED")
        }
        return validateChat(text)
    }

    clientSocket.on("global:chat", (payload = {}) => {
        const { text } = payload
        const result = authorizeChat(text)

        if (!result.ok) {
            clientSocket.emit("chat:result", result)
            return
        }

        socketServer.emit("global:message", {
            type: "chat",
            scope: "global",
            playerId: playerIdentity.playerId,
            nickname: playerIdentity.nickname,
            text: result.text,
        })
    })

    clientSocket.on("room:chat", (payload = {}) => {
        const { roomId, text } = payload
        const playerId = playerIdentity?.playerId
        if (!playerSessionService?.isActiveSocket(sessionContext, clientSocket.id)) {
            clientSocket.emit("chat:result", failure("NOT_AUTHORIZED"))
            return
        }
        // 채팅 전송 전에 room/player 소속만 검증한다. 게임 판정이나 room 상태 전이는 하지 않는다.
        const roomResult = syncRoom(roomId, playerId)
        if (!roomResult.ok) {
            clientSocket.emit("chat:result", roomResult)
            return
        }

        const chatResult = authorizeChat(text)
        if (!chatResult.ok) {
            clientSocket.emit("chat:result", chatResult)
            return
        }

        const player = roomResult.room.players.find(player => player.playerId === playerId)
        socketServer.to(roomResult.room.roomId).emit("room:message", {
            type: "chat",
            scope: "room",
            roomId: roomResult.room.roomId,
            playerId,
            nickname: player?.nickname || "Guest",
            text: chatResult.text,
        })
    })

}

module.exports = {
    registerChatHandlers,
}
