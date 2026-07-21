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

export function createRoomPublicDto(room: RoomState): RoomPublicDto;
export function createRoomPublicDto(room: null): null;
export function createRoomPublicDto(
    room: RoomState | null,
): Record<string, unknown> | null {
    if (!room) return null

    const dto: Record<string, unknown> = {}
    const scalarFields = [
        "roomId",
        "mode",
        "aiDifficulty",
        "aiPolicy",
        "hostPlayerId",
        "status",
        "createdAt",
    ] as const
    scalarFields.forEach((field) => {
        if (Object.hasOwn(room, field)) dto[field] = room[field]
    })
    if (Object.hasOwn(room, "players")) {
        dto.players = Array.isArray(room.players)
            ? room.players.map(createPublicPlayerDto)
            : []
    }

    return dto
}

export function createPublicRoomResult(result: RoomResult): RoomResultDto {
    return {
        ...result,
        room: result.room ? createRoomPublicDto(result.room) : null,
    }
}
