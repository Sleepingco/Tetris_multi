const { syncRoom } = require("../services/roomService.js")

const CHAT_MAX_LENGTH = 200
const CHAT_COOLDOWN_MS = 1000
const lastChatAtBySocketId = new Map()

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

/**
 * socketId 기준 채팅 쿨다운을 검사하고, 통과한 시점에는 마지막 전송 시간을 갱신한다.
 *
 * @param {string} socketId - 채팅을 보낸 socket id
 * @returns {{ok: boolean, reason: string|null}} 전송 가능 여부
 */
function checkChatRateLimit(socketId) {
    const now = Date.now()
    const lastSentAt = lastChatAtBySocketId.get(socketId) || 0

    if (now - lastSentAt < CHAT_COOLDOWN_MS) {
        return failure("CHAT_RATE_LIMITED")
    }

    lastChatAtBySocketId.set(socketId, now)
    return success()
}

function validateChat(socketId, text) {
    const textResult = normalizeChatText(text)
    if (!textResult.ok) return textResult

    const rateLimitResult = checkChatRateLimit(socketId)
    if (!rateLimitResult.ok) return rateLimitResult

    return success({ text: textResult.text })
}

function registerChatHandlers(socketServer, clientSocket) {
    clientSocket.on("global:chat", (payload = {}) => {
        const { playerId, nickname, text } = payload
        const result = validateChat(clientSocket.id, text)

        if (!result.ok) {
            clientSocket.emit("chat:result", result)
            return
        }

        socketServer.emit("global:message", {
            type: "chat",
            scope: "global",
            playerId: playerId || null,
            nickname: nickname || "Guest",
            text: result.text,
        })
    })

    clientSocket.on("room:chat", (payload = {}) => {
        const { roomId, playerId, text } = payload
        // 채팅 전송 전에 room/player 소속만 검증한다. 게임 판정이나 room 상태 전이는 하지 않는다.
        const roomResult = syncRoom(roomId, playerId)
        if (!roomResult.ok) {
            clientSocket.emit("chat:result", roomResult)
            return
        }

        const chatResult = validateChat(clientSocket.id, text)
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

    clientSocket.on("disconnect", () => {
        lastChatAtBySocketId.delete(clientSocket.id)
    })
}

module.exports = {
    registerChatHandlers,
}
