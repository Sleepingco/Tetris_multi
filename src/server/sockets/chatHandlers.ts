// =============================
// 채팅 이벤트 어댑터
// 인증·속도·schema·room membership을 확인한 뒤 메시지만 broadcast한다.
// =============================
import { syncRoom } from "../services/roomService.js";
import { clientToServerSchemas } from "../../shared/socketContracts.mjs";
import type { ServerToClientParsedPayload } from "../../shared/socketContractTypes.js";
import type { PlayerSessionService } from "../services/playerSessionService.js";
import type { SocketRateLimitService } from "../services/socketRateLimitService.js";
import type { AppSocket, AppSocketServer } from "./index.js";

type ChatResult = ServerToClientParsedPayload<"chat:result">;
export type ChatHandlerDependencies = {
    playerSessionService: PlayerSessionService;
    socketRateLimitService: SocketRateLimitService;
};

function failure(
    reason: string,
    meta: Partial<ChatResult> = {},
): ChatResult {
    return {
        ok: false,
        reason,
        ...meta,
    }
}

/**
 * 한 socket에 global/room chat listener를 등록한다.
 * 인증 정보는 payload가 아니라 연결 시 확정된 `socket.data`에서 읽고,
 * room chat은 roomService membership을 확인한 뒤 같은 Socket.IO room에만 보낸다.
 */
export function registerChatHandlers(
    socketServer: AppSocketServer,
    clientSocket: AppSocket,
    dependencies: ChatHandlerDependencies,
): void {
    const playerSessionService = dependencies.playerSessionService
    const socketRateLimitService = dependencies.socketRateLimitService
    const sessionContext = clientSocket.data?.playerSession
    const playerIdentity = clientSocket.data?.playerIdentity

    // payload를 읽기 전에 active generation과 player별 rate limit부터 확인한다.
    function authorizeChat(): ChatResult | null {
        if (!playerSessionService.isActiveSocket(sessionContext, clientSocket.id)
            || !playerIdentity) {
            return failure("NOT_AUTHORIZED")
        }
        if (!socketRateLimitService.consume("chat", playerIdentity.playerId)) {
            return failure("CHAT_RATE_LIMITED")
        }
        return null
    }

    clientSocket.on("global:chat", (payload: unknown) => {
        const result = authorizeChat()

        if (result) {
            clientSocket.emit("chat:result", result)
            return
        }
        const identity = playerIdentity
        if (!identity) return
        const validation = clientToServerSchemas["global:chat"].safeParse(payload)
        if (!validation.success) {
            clientSocket.emit("chat:result", failure("INVALID_PAYLOAD"))
            return
        }

        socketServer.emit("global:message", {
            type: "chat",
            scope: "global",
            playerId: identity.playerId,
            nickname: identity.nickname,
            text: validation.data.text,
        })
    })

    clientSocket.on("room:chat", (payload: unknown) => {
        const authorization = authorizeChat()
        if (authorization) {
            clientSocket.emit("chat:result", authorization)
            return
        }
        const playerId = playerIdentity?.playerId
        if (!playerId) return
        const validation = clientToServerSchemas["room:chat"].safeParse(payload)
        if (!validation.success) {
            clientSocket.emit("chat:result", failure("INVALID_PAYLOAD"))
            return
        }
        const { roomId, text } = validation.data
        // 채팅 전송 전에 room/player 소속만 검증한다. 게임 판정이나 room 상태 전이는 하지 않는다.
        const roomResult = syncRoom(roomId, playerId)
        if (!roomResult.ok || !roomResult.room) {
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
