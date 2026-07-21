import type {
    ServerToClientParsedPayload,
} from "../../shared/socketContractTypes.js";
import type { RoomPlayer, RoomResult, RoomState } from "./roomService.js";

export type RoomPublicDto = ServerToClientParsedPayload<"room:updated">;
export type RoomResultDto = ServerToClientParsedPayload<"room:result">;

function createPublicPlayerDto(player: RoomPlayer): RoomPublicDto["players"][number] {
    if (player.playerType === "human") return {
        playerId: player.playerId,
        nickname: player.nickname,
        playerType: player.playerType,
    }
    return {
        playerId: player.playerId,
        nickname: player.nickname,
        playerType: player.playerType,
    }
}

export function createRoomPublicDto(room: RoomState | null): RoomPublicDto | null {
    if (!room) return null

    return {
        roomId: room.roomId,
        mode: room.mode,
        aiDifficulty: room.aiDifficulty,
        aiPolicy: room.aiPolicy,
        hostPlayerId: room.hostPlayerId,
        status: room.status,
        createdAt: room.createdAt,
        players: room.players.map(createPublicPlayerDto),
    }
}

export function createPublicRoomResult(result: RoomResult): RoomResultDto {
    return {
        ...result,
        room: createRoomPublicDto(result?.room),
    }
}
