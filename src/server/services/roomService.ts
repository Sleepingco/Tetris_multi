import { randomUUID } from "node:crypto";
import {
    AI_DIFFICULTY,
    AI_POLICY,
    DEFAULT_AI_DIFFICULTY,
    DEFAULT_AI_POLICY,
    isValidAiDifficulty,
    isValidAiPolicy,
} from "./aiDifficulty.js";
import type { AiDifficulty, AiPolicy } from "./aiDifficulty.js";

// =============================
// In-memory Room Store
// 현재 MVP에서는 단일 Node 프로세스 메모리에 room lifecycle을 저장한다.
// =============================
const rooms = new Map<string, RoomState>()
const MAX_ROOM_ID_GENERATION_ATTEMPTS = 5
export const ROOM_MODE = Object.freeze({
    PVP: "pvp",
    PVE: "pve",
} as const)
export const PLAYER_TYPE = Object.freeze({
    HUMAN: "human",
    HEURISTIC_AI: "heuristic_ai",
} as const)

export type RoomMode = typeof ROOM_MODE[keyof typeof ROOM_MODE];
export type PlayerType = typeof PLAYER_TYPE[keyof typeof PLAYER_TYPE];
export type RoomStatus = "waiting" | "playing" | "finished";
export type RoomPlayer = {
    playerId: string;
    nickname: string;
    playerType: "human";
} | {
    playerId: string;
    nickname: "Heuristic AI" | "My Imitation AI (Experimental)";
    playerType: "heuristic_ai";
};
export type RoomState = {
    roomId: string;
    mode: RoomMode;
    aiDifficulty: AiDifficulty | null;
    aiPolicy: AiPolicy | null;
    hostPlayerId: string;
    players: RoomPlayer[];
    status: RoomStatus;
    createdAt: number;
    lobbyPlayerIds?: string[];
};
export type RoomResult = {
    ok: boolean;
    room: RoomState | null;
    reason: string | null;
    roomId?: string | null;
    player?: RoomPlayer | null;
    winnerPlayerId?: string | null;
    loserPlayerId?: string | null;
    finishReason?: string;
};
export type FinishGameResult = {
    ok: true;
    room: RoomState;
    reason: null;
    winnerPlayerId: string;
    loserPlayerId: string;
    finishReason: string;
} | {
    ok: false;
    room: null;
    reason: string;
    winnerPlayerId: string | null;
    loserPlayerId: string | null;
    finishReason: string;
};
export type RoomMembership = { room: RoomState; player: RoomPlayer };
type PlayerIdentity = { playerId: string; nickname: string };
type RoomOptions = {
    mode?: unknown;
    aiDifficulty?: unknown;
    aiPolicy?: unknown;
    generateRoomId?: () => string;
};

function success(room: RoomState | null, meta: Partial<RoomResult> = {}): RoomResult {
    return {
        ok: true,
        room,
        reason: null,
        ...meta,
    }
}

function failure(reason: string, meta: Partial<RoomResult> = {}): RoomResult {
    return {
        ok: false,
        room: null,
        reason,
        ...meta,
    }
}

export function getRoomState(roomId: string): RoomState | null {
    return rooms.get(roomId) || null
}

export function clearRoomsForTest(): void {
    rooms.clear()
}

function generateRoomId(): string {
    return randomUUID().slice(0, 8).toUpperCase()
}

function createUniqueRoomId(roomIdGenerator = generateRoomId): string | null {
    for (let attempt = 0; attempt < MAX_ROOM_ID_GENERATION_ATTEMPTS; attempt += 1) {
        const roomId = roomIdGenerator()

        if (!rooms.has(roomId)) {
            return roomId
        }
    }

    return null
}

function normalizeRoomMode(mode: unknown): RoomMode {
    return mode === ROOM_MODE.PVE ? ROOM_MODE.PVE : ROOM_MODE.PVP
}

function createHumanPlayer(player: PlayerIdentity): RoomPlayer {
    return {
        playerId: player.playerId,
        nickname: player.nickname,
        playerType: PLAYER_TYPE.HUMAN,
    }
}

function createHeuristicAiPlayer(roomId: string, aiPolicy: AiPolicy): RoomPlayer {
    return {
        playerId: `heuristic-ai-${roomId}`,
        nickname: aiPolicy === AI_POLICY.PLACEMENT_V4
            ? "My Imitation AI (Experimental)"
            : "Heuristic AI",
        playerType: PLAYER_TYPE.HEURISTIC_AI,
    }
}

function getRoomPlayerContext(roomId: string, playerId: string): {
    ok: true;
    roomState: RoomState;
    player: RoomPlayer;
    reason: null;
} | {
    ok: false;
    roomState: RoomState | null;
    player: null;
    reason: string;
} {
    const roomState = getRoomState(roomId)
    if (!roomId || !roomState) {
        return {
            ok: false,
            roomState: null,
            player: null,
            reason: "ROOM_NOT_FOUND",
        }
    }

    if (!playerId) {
        return {
            ok: false,
            roomState,
            player: null,
            reason: "PLAYER_ID_REQUIRED",
        }
    }

    const player = roomState.players.find(player => player.playerId === playerId)
    if (!player) {
        return {
            ok: false,
            roomState,
            player: null,
            reason: "NOT_AUTHORIZED",
        }
    }

    return {
        ok: true,
        roomState,
        player,
        reason: null,
    }
}

export function createRoom(
    hostPlayer: PlayerIdentity | null | undefined,
    options: RoomOptions = {},
): RoomResult {
    if (!hostPlayer) {
        return failure("HOST_PLAYER_REQUIRED")
    }
    if (!hostPlayer.playerId) {
        return failure("HOST_PLAYER_ID_REQUIRED")
    }
    if (findRoomByPlayerId(hostPlayer.playerId)) {
        return failure("PLAYER_ALREADY_IN_ROOM")
    }

    const mode = normalizeRoomMode(options.mode)
    let aiDifficulty: AiDifficulty | null = null;
    let aiPolicy: AiPolicy | null = null;
    if (mode === ROOM_MODE.PVE) {
        const requestedDifficulty = options.aiDifficulty ?? DEFAULT_AI_DIFFICULTY;
        if (!isValidAiDifficulty(requestedDifficulty)) {
            return failure("INVALID_AI_DIFFICULTY")
        }
        aiDifficulty = requestedDifficulty;

        const requestedPolicy = options.aiPolicy ?? DEFAULT_AI_POLICY;
        if (!isValidAiPolicy(requestedPolicy)) {
            return failure("INVALID_AI_POLICY")
        }
        aiPolicy = requestedPolicy;
    }

    const roomId = createUniqueRoomId(options.generateRoomId)
    if (!roomId) {
        return failure("ROOM_ID_GENERATION_FAILED")
    }

    const humanHost = createHumanPlayer(hostPlayer)
    const players = mode === ROOM_MODE.PVE
        ? [humanHost, createHeuristicAiPlayer(roomId, aiPolicy ?? DEFAULT_AI_POLICY)]
        : [humanHost]
    const room: RoomState = {
        roomId,
        mode,
        aiDifficulty,
        aiPolicy,
        hostPlayerId: humanHost.playerId,
        players,
        status: "waiting",
        createdAt: Date.now(),
    }

    rooms.set(roomId, room)

    return success(room)
}

export function joinRoom(
    roomId: string,
    guestPlayer: PlayerIdentity | null | undefined,
): RoomResult {
    if (!guestPlayer) {
        return failure("GUEST_PLAYER_REQUIRED")
    }

    if (!guestPlayer.playerId) {
        return failure("GUEST_PLAYER_ID_REQUIRED")
    }

    if (!roomId) {
        return failure("ROOM_ID_REQUIRED")
    }

    const existingMembership = findRoomByPlayerId(guestPlayer.playerId)
    if (existingMembership) {
        return failure(existingMembership.room.roomId === roomId
            ? "PLAYER_ALREADY_JOINED"
            : "PLAYER_ALREADY_IN_ROOM")
    }

    const roomState = getRoomState(roomId)
    if (!roomState) {
        return failure("ROOM_NOT_FOUND")
    }
    if (roomState.mode === ROOM_MODE.PVE) {
        return failure("PVE_ROOM_NOT_JOINABLE")
    }
    if (roomState.players.length >= 2) {
        return failure("ROOM_FULL")
    }

    const alreadyJoined = roomState.players.some(player => player.playerId === guestPlayer.playerId)
    if (alreadyJoined) {
        return failure("PLAYER_ALREADY_JOINED")
    }

    roomState.players.push(createHumanPlayer(guestPlayer))
    roomState.status = "waiting"

    return success(roomState)
}

/**
 * room에서 player를 제거하고, 빈 방 삭제/host 위임/waiting 복귀까지 처리한다.
 *
 * @param {string} roomId - 대상 room id
 * @param {string} playerId - 제거할 player id
 * @returns {{ok: boolean, room: Object|null, reason: string|null}} 제거 결과
 */
export function removePlayer(roomId: string, playerId: string): RoomResult {
    const roomState = getRoomState(roomId)

    if (!roomState) {
        return failure("ROOM_NOT_FOUND")
    }

    const playerIndex = roomState.players.findIndex(player => player.playerId === playerId)

    if (playerIndex === -1) {
        return failure("PLAYER_NOT_FOUND")
    }

    const removedPlayer = roomState.players[playerIndex]
    roomState.players.splice(playerIndex, 1)

    if (
        roomState.mode === ROOM_MODE.PVE &&
        removedPlayer.playerType === PLAYER_TYPE.HUMAN
    ) {
        rooms.delete(roomId)
        return success(null)
    }

    if (roomState.players.length === 0) {
        rooms.delete(roomId)
        return success(null)
    }

    if (roomState.hostPlayerId === removedPlayer.playerId) {
        const nextHost = roomState.players[0];
        if (nextHost) roomState.hostPlayerId = nextHost.playerId
    }

    roomState.status = "waiting"

    return success(roomState)
}

export function findRoomByPlayerId(playerId: string): RoomMembership | null {
    for (const room of rooms.values()) {
        const player = room.players.find(player => player.playerId === playerId)

        if (player) {
            return {
                room,
                player,
            }
        }
    }

    return null
}

export function leaveRoom(roomId: string, playerId: string): RoomResult {
    const context = getRoomPlayerContext(roomId, playerId)
    if (!context.ok) {
        return failure(context.reason, {
            roomId: roomId || null,
            player: null,
        })
    }
    if (context.roomState.status === "playing") {
        return failure("GAME_IN_PROGRESS", {
            roomId,
            player: context.player,
        })
    }

    const result = removePlayer(roomId, playerId)
    const meta = {
        roomId,
        player: context.player,
    }

    return result.ok
        ? success(result.room, meta)
        : failure(result.reason ?? "UNKNOWN_ERROR", meta)
}

export function startGame(roomId: string, playerId: string): RoomResult {
    const context = getRoomPlayerContext(roomId, playerId)
    if (!context.ok) {
        return failure(context.reason)
    }

    const { roomState } = context

    if (roomState.status === "finished") {
        return failure("GAME_NOT_READY")
    }

    if (roomState.status !== "waiting") {
        return failure("GAME_ALREADY_STARTED")
    }

    if (roomState.hostPlayerId !== playerId) {
        return failure("NOT_AUTHORIZED")
    }

    const hasValidPvePlayers = roomState.mode === ROOM_MODE.PVE &&
        roomState.players.filter(player => player.playerType === PLAYER_TYPE.HUMAN).length === 1 &&
        roomState.players.filter(player => player.playerType === PLAYER_TYPE.HEURISTIC_AI).length === 1
    if (roomState.players.length !== 2 || (roomState.mode === ROOM_MODE.PVE && !hasValidPvePlayers)) {
        return failure("NOT_ENOUGH_PLAYERS")
    }

    roomState.status = "playing"

    return success(roomState)
}

export function leaveGame(roomId: string, playerId: string): RoomResult {
    const context = getRoomPlayerContext(roomId, playerId)
    if (!context.ok) {
        return failure(context.reason)
    }

    const { roomState } = context

    if (roomState.status !== "playing") {
        return failure("GAME_NOT_PLAYING")
    }

    if (roomState.players.length !== 2) {
        return failure("NOT_ENOUGH_PLAYERS")
    }

    return removePlayer(roomId, playerId)
}

/**
 * 현재 room 상태를 반환하면서 로비 복귀 상태를 동기화한다.
 * - finished room에서 양쪽이 로비에 복귀하면 다시 waiting 상태로 되돌린다.
 *
 * @param {string} roomId - 동기화할 room id
 * @param {string} playerId - 요청 player id
 * @param {{location?: string}} options - 요청 위치 정보
 * @returns {{ok: boolean, room: Object|null, reason: string|null}} 동기화 결과
 */
export function syncRoom(
    roomId: string,
    playerId: string,
    options: { location?: string } = {},
): RoomResult {
    const context = getRoomPlayerContext(roomId, playerId)
    if (!context.ok) {
        return failure(context.reason)
    }

    if (options.location === "lobby" && context.roomState.status === "finished") {
        const lobbyPlayerIds = context.roomState.lobbyPlayerIds ??= []

        if (!lobbyPlayerIds.includes(playerId)) {
            lobbyPlayerIds.push(playerId)
        }

        const lobbyPlayers = context.roomState.mode === ROOM_MODE.PVE
            ? context.roomState.players.filter(player => player.playerType === PLAYER_TYPE.HUMAN)
            : context.roomState.players
        const allPlayersReturnedToLobby = lobbyPlayers.every(player => {
            return lobbyPlayerIds.includes(player.playerId)
        })

        if (allPlayersReturnedToLobby) {
            context.roomState.status = "waiting"
            delete context.roomState.lobbyPlayerIds
        }
    }

    return success(context.roomState)
}

/**
 * 패배자를 기준으로 승자를 계산하고 room을 finished 상태로 전환한다.
 * - player를 제거하지 않고, 두 플레이어가 결과 화면에서 로비로 돌아올 수 있게 유지한다.
 *
 * @param {string} roomId - 종료할 room id
 * @param {string} loserPlayerId - 패배한 player id
 * @param {string} [finishReason="top_out"] - 종료 사유
 * @returns {{ok: boolean, room: Object|null, reason: string|null, winnerPlayerId?: string|null, loserPlayerId?: string|null, finishReason?: string}} 종료 결과
 */
export function finishGame(
    roomId: string,
    loserPlayerId: string,
    finishReason = "top_out",
): FinishGameResult {
    const context = getRoomPlayerContext(roomId, loserPlayerId)
    if (!context.ok) {
        return {
            ok: false,
            room: null,
            reason: context.reason,
            winnerPlayerId: null,
            loserPlayerId: null,
            finishReason,
        }
    }

    const { roomState } = context

    if (roomState.status !== "playing") {
        return {
            ok: false,
            room: null,
            reason: "GAME_NOT_PLAYING",
            winnerPlayerId: null,
            loserPlayerId,
            finishReason,
        }
    }

    if (roomState.players.length !== 2) {
        return {
            ok: false,
            room: null,
            reason: "NOT_ENOUGH_PLAYERS",
            winnerPlayerId: null,
            loserPlayerId,
            finishReason,
        }
    }

    const winnerPlayer = roomState.players.find(player => player.playerId !== loserPlayerId)
    if (!winnerPlayer) {
        return {
            ok: false,
            room: null,
            reason: "NOT_ENOUGH_PLAYERS",
            winnerPlayerId: null,
            loserPlayerId,
            finishReason,
        }
    }

    roomState.status = "finished"
    roomState.lobbyPlayerIds = []

    return {
        ok: true,
        room: roomState,
        reason: null,
        winnerPlayerId: winnerPlayer.playerId,
        loserPlayerId,
        finishReason,
    }
}

export { AI_DIFFICULTY, AI_POLICY };
