const { randomUUID } = require("crypto")
const {
    AI_DIFFICULTY,
    AI_POLICY,
    DEFAULT_AI_DIFFICULTY,
    DEFAULT_AI_POLICY,
    isValidAiDifficulty,
    isValidAiPolicy,
} = require("./aiDifficulty.js")

// =============================
// In-memory Room Store
// 현재 MVP에서는 단일 Node 프로세스 메모리에 room lifecycle을 저장한다.
// =============================
const rooms = new Map()
const MAX_ROOM_ID_GENERATION_ATTEMPTS = 5
const ROOM_MODE = Object.freeze({
    PVP: "pvp",
    PVE: "pve",
})
const PLAYER_TYPE = Object.freeze({
    HUMAN: "human",
    HEURISTIC_AI: "heuristic_ai",
})

function success(room, meta = {}) {
    return {
        ok: true,
        room,
        reason: null,
        ...meta,
    }
}

function failure(reason, meta = {}) {
    return {
        ok: false,
        room: null,
        reason,
        ...meta,
    }
}

function getRoomState(roomId) {
    return rooms.get(roomId) || null
}

function generateRoomId() {
    return randomUUID().slice(0, 8).toUpperCase()
}

function createUniqueRoomId(roomIdGenerator = generateRoomId) {
    for (let attempt = 0; attempt < MAX_ROOM_ID_GENERATION_ATTEMPTS; attempt += 1) {
        const roomId = roomIdGenerator()

        if (!rooms.has(roomId)) {
            return roomId
        }
    }

    return null
}

function normalizeRoomMode(mode) {
    return mode === ROOM_MODE.PVE ? ROOM_MODE.PVE : ROOM_MODE.PVP
}

function createHumanPlayer(player) {
    return {
        playerId: player.playerId,
        nickname: player.nickname,
        playerType: PLAYER_TYPE.HUMAN,
    }
}

function createHeuristicAiPlayer(roomId, aiPolicy) {
    return {
        playerId: `heuristic-ai-${roomId}`,
        nickname: aiPolicy === AI_POLICY.PLACEMENT_V4
            ? "My Imitation AI (Experimental)"
            : "Heuristic AI",
        playerType: PLAYER_TYPE.HEURISTIC_AI,
    }
}

function getRoomPlayerContext(roomId, playerId) {
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

function createRoom(hostPlayer, options = {}) {
    if (!hostPlayer) {
        return failure("HOST_PLAYER_REQUIRED")
    }
    if (!hostPlayer.playerId) {
        return failure("HOST_PLAYER_ID_REQUIRED")
    }

    const mode = normalizeRoomMode(options.mode)
    const aiDifficulty = mode === ROOM_MODE.PVE
        ? options.aiDifficulty ?? DEFAULT_AI_DIFFICULTY
        : null
    const aiPolicy = mode === ROOM_MODE.PVE
        ? options.aiPolicy ?? DEFAULT_AI_POLICY
        : null
    if (mode === ROOM_MODE.PVE && !isValidAiDifficulty(aiDifficulty)) {
        return failure("INVALID_AI_DIFFICULTY")
    }
    if (mode === ROOM_MODE.PVE && !isValidAiPolicy(aiPolicy)) {
        return failure("INVALID_AI_POLICY")
    }

    const roomId = createUniqueRoomId(options.generateRoomId)
    if (!roomId) {
        return failure("ROOM_ID_GENERATION_FAILED")
    }

    const humanHost = createHumanPlayer(hostPlayer)
    const players = mode === ROOM_MODE.PVE
        ? [humanHost, createHeuristicAiPlayer(roomId, aiPolicy)]
        : [humanHost]
    const room = {
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

function joinRoom(roomId, guestPlayer) {
    if (!guestPlayer) {
        return failure("GUEST_PLAYER_REQUIRED")
    }

    if (!guestPlayer.playerId) {
        return failure("GUEST_PLAYER_ID_REQUIRED")
    }

    if (!roomId) {
        return failure("ROOM_ID_REQUIRED")
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
function removePlayer(roomId, playerId) {
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
        roomState.hostPlayerId = roomState.players[0].playerId
    }

    roomState.status = "waiting"

    return success(roomState)
}

function findRoomByPlayerId(playerId) {
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

function leaveRoom(roomId, playerId) {
    const context = getRoomPlayerContext(roomId, playerId)
    if (!context.ok) {
        return failure(context.reason, {
            roomId: roomId || null,
            player: null,
        })
    }

    const result = removePlayer(roomId, playerId)
    const meta = {
        roomId,
        player: context.player,
    }

    return result.ok
        ? success(result.room, meta)
        : failure(result.reason, meta)
}

function startGame(roomId, playerId) {
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

function leaveGame(roomId, playerId) {
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
function syncRoom(roomId, playerId, options = {}) {
    const context = getRoomPlayerContext(roomId, playerId)
    if (!context.ok) {
        return failure(context.reason)
    }

    if (options.location === "lobby" && context.roomState.status === "finished") {
        if (!Array.isArray(context.roomState.lobbyPlayerIds)) {
            context.roomState.lobbyPlayerIds = []
        }

        if (!context.roomState.lobbyPlayerIds.includes(playerId)) {
            context.roomState.lobbyPlayerIds.push(playerId)
        }

        const lobbyPlayers = context.roomState.mode === ROOM_MODE.PVE
            ? context.roomState.players.filter(player => player.playerType === PLAYER_TYPE.HUMAN)
            : context.roomState.players
        const allPlayersReturnedToLobby = lobbyPlayers.every(player => {
            return context.roomState.lobbyPlayerIds.includes(player.playerId)
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
function finishGame(roomId, loserPlayerId, finishReason = "top_out") {
    const context = getRoomPlayerContext(roomId, loserPlayerId)
    if (!context.ok) {
        return failure(context.reason, {
            winnerPlayerId: null,
            loserPlayerId: null,
            finishReason,
        })
    }

    const { roomState } = context

    if (roomState.status !== "playing") {
        return failure("GAME_NOT_PLAYING", {
            winnerPlayerId: null,
            loserPlayerId,
            finishReason,
        })
    }

    if (roomState.players.length !== 2) {
        return failure("NOT_ENOUGH_PLAYERS", {
            winnerPlayerId: null,
            loserPlayerId,
            finishReason,
        })
    }

    const winnerPlayer = roomState.players.find(player => player.playerId !== loserPlayerId)

    roomState.status = "finished"
    roomState.lobbyPlayerIds = []

    return success(roomState, {
        winnerPlayerId: winnerPlayer.playerId,
        loserPlayerId,
        finishReason,
    })
}

module.exports = {
    AI_DIFFICULTY,
    AI_POLICY,
    PLAYER_TYPE,
    ROOM_MODE,
    createRoom,
    findRoomByPlayerId,
    getRoomState,
    joinRoom,
    removePlayer,
    startGame,
    leaveGame,
    syncRoom,
    leaveRoom,
    finishGame,
}
