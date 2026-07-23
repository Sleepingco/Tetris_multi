// =============================
// 공개 방 DTO 경계
// 내부 RoomState에서 wire contract가 허용한 필드만 새 객체로 복사한다.
// =============================
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

/**
 * 내부 room 원본에서 공개가 승인된 scalar와 player identity만 새 객체로 복사한다.
 * 입력이 null이면 조회 실패/삭제 상태를 보존하기 위해 null을 그대로 반환한다.
 */
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

/**
 * service 결과의 성공/실패 metadata는 유지하되 내부 room 참조를 public DTO로 교체한다.
 * socketId, token 같은 private 필드가 RoomState에 추가돼도 자동으로 밖에 노출되지 않는다.
 */
export function createPublicRoomResult(result: RoomResult): RoomResultDto {
    return {
        ...result,
        room: result.room ? createRoomPublicDto(result.room) : null,
    }
}
