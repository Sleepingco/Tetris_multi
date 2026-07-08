// =============================
// In-memory Match Store
// match는 player별 input log, server bag chunk, authoritativeState 초안을 저장한다.
// =============================
const {
    applyAuthoritativeInput,
    applyAuthoritativeGravityStep,
} = require("./playerGameplayStep.js");

const matches = new Map();
const BAG_PIECES = ["bar", "eleft", "eright", "ess", "square", "tree", "zee"];
const INITIAL_BAG_CHUNK_COUNT = 3;
const BOARD_ROWS = 20;
const BOARD_COLS = 10;
const SPAWN_ROW = -1;
const SPAWN_COL = 3;

function createSuccess(match, extra = {}) {
    return {
        ok: true,
        match,
        reason: null,
        ...extra,
    };
}

function createFailure(reason) {
    return {
        ok: false,
        match: null,
        reason,
    };
}

/**
 * room 상태를 기준으로 match를 시작하고 player별 input log와 초기 server bag을 만든다.
 *
 * @param {{roomId: string, status?: string, players: Array<{playerId: string}>}} room - 시작할 room 상태
 * @returns {{ok: boolean, match: Object|null, reason: string|null}} match 생성 결과
 */
function createMatch(room) {
    if (!room) {
        return createFailure("ROOM_REQUIRED");
    }

    if (!room.roomId) {
        return createFailure("ROOM_ID_REQUIRED");
    }

    if (!Array.isArray(room.players)) {
        return createFailure("ROOM_PLAYERS_REQUIRED");
    }

    const match = {
        roomId: room.roomId,
        status: room.status || "playing",
        players: room.players.map((player) => {
            const bagChunks = createInitialBagChunks();

            return {
                playerId: player.playerId,
                inputLog: [],
                bagChunks,
                authoritativeState: createInitialPlayerState(bagChunks),
            };
        }),
        createdAt: Date.now(),
    };

    matches.set(room.roomId, match);

    return createSuccess(match);
}

function getMatchState(roomId) {
    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    return createSuccess(match);
}

/**
 * player 입력을 match input log에 append-only로 저장한다.
 * - action/tick/pieceIndex의 강한 검증은 socket handler에서 먼저 수행한다.
 *
 * @param {string} roomId - match room id
 * @param {string} playerId - 입력을 보낸 player id
 * @param {{action: string, tick?: number|null, pieceIndex?: number|null}} input - 저장할 입력 정보
 * @returns {{ok: boolean, match: Object|null, reason: string|null}} 저장 결과
 */
function recordInput(roomId, playerId, input) {
    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    const player = match.players.find((matchPlayer) => {
        return matchPlayer.playerId === playerId;
    });

    if (!player) {
        return createFailure("PLAYER_NOT_FOUND");
    }

    if (!input || typeof input.action !== "string") {
        return createFailure("INVALID_INPUT");
    }

    player.inputLog.push({
        playerId,
        action: input.action,
        tick: input.tick ?? null,
        pieceIndex: input.pieceIndex ?? null,
        sequence: player.inputLog.length + 1,
        receivedAt: Date.now(),
    });

    return createSuccess(match);
}

/**
 * 특정 player에게 추가 server bag chunk를 생성해 붙인다.
 * - 멀티플레이에서는 클라이언트 로컬 RNG 대신 이 chunk를 조각 공급원으로 사용한다.
 *
 * @param {string} roomId - match room id
 * @param {string} playerId - bag chunk를 받을 player id
 * @returns {{ok: boolean, match: Object|null, reason: string|null, bagChunk?: string[]}} 추가 결과
 */
function appendPlayerBagChunk(roomId, playerId) {
    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    const player = match.players.find((matchPlayer) => {
        return matchPlayer.playerId === playerId;
    });

    if (!player) {
        return createFailure("PLAYER_NOT_FOUND");
    }

    const bagChunk = createBagChunk();
    player.bagChunks.push(bagChunk);
    if (Array.isArray(player.authoritativeState?.pieceQueue)) {
        player.authoritativeState.pieceQueue.push(...bagChunk);
    }

    return createSuccess(match, { bagChunk });
}

function applyAuthoritativeInputToMatchPlayerState(roomId, playerId, input, gameCore) {
    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    const player = match.players.find((matchPlayer) => {
        return matchPlayer.playerId === playerId;
    });

    if (!player) {
        return createFailure("PLAYER_NOT_FOUND");
    }

    if (!player.authoritativeState) {
        return {
            ok: false,
            match,
            reason: "AUTHORITATIVE_STATE_NOT_FOUND",
        };
    }

    if (input?.pieceIndex !== player.authoritativeState.pieceIndex) {
        return {
            ok: false,
            match,
            reason: "PIECE_INDEX_MISMATCH",
        };
    }

    const gameplayResult = applyAuthoritativeInput(player.authoritativeState, input, gameCore);
    if (!gameplayResult.ok) {
        return {
            ok: false,
            match,
            reason: gameplayResult.reason,
            gameplayResult,
        };
    }

    return createSuccess(match, { gameplayResult });
}

function applyGravityStepToMatchPlayerState(roomId, playerId, gameCore) {
    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    const player = match.players.find((matchPlayer) => {
        return matchPlayer.playerId === playerId;
    });

    if (!player) {
        return createFailure("PLAYER_NOT_FOUND");
    }

    if (!player.authoritativeState) {
        return {
            ok: false,
            match,
            reason: "AUTHORITATIVE_STATE_NOT_FOUND",
        };
    }

    const gravityStepResult = applyAuthoritativeGravityStep(player.authoritativeState, gameCore);
    if (!gravityStepResult.ok) {
        return {
            ok: false,
            match,
            reason: gravityStepResult.reason,
            gravityResult: gravityStepResult.gravityResult,
            gravityStepResult,
        };
    }

    return createSuccess(match, {
        gravityResult: gravityStepResult.gravityResult,
        gravityStepResult,
        placementResult: gravityStepResult.placementResult,
    });
}

function getAuthoritativePlayerSnapshot(roomId, playerId) {
    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    const player = match.players.find((matchPlayer) => {
        return matchPlayer.playerId === playerId;
    });

    if (!player) {
        return createFailure("PLAYER_NOT_FOUND");
    }

    if (!player.authoritativeState) {
        return {
            ok: false,
            match,
            reason: "AUTHORITATIVE_STATE_NOT_FOUND",
        };
    }

    return createSuccess(match, {
        snapshot: cloneAuthoritativeState(player.authoritativeState),
    });
}

function getAuthoritativePlayerSnapshotDto(roomId, playerId) {
    const result = getAuthoritativePlayerSnapshot(roomId, playerId);

    if (!result.ok) {
        return result;
    }

    return createSuccess(result.match, {
        snapshot: createClientSnapshotDto(result.snapshot),
    });
}

function createBagChunk() {
    const chunk = [...BAG_PIECES];

    for (let i = chunk.length - 1; i > 0; i--) {
        const randomIndex = Math.floor(Math.random() * (i + 1));
        const currentPiece = chunk[i];
        chunk[i] = chunk[randomIndex];
        chunk[randomIndex] = currentPiece;
    }

    return chunk;
}

function createInitialBagChunks(count = INITIAL_BAG_CHUNK_COUNT) {
    return Array.from({ length: count }, () => createBagChunk());
}

function createInitialPlayerState(bagChunks = []) {
    const pieceQueue = flattenBagChunks(bagChunks);
    const firstPieceType = pieceQueue.shift();
    const activePiece = firstPieceType
        ? {
            pieceType: firstPieceType,
            rotation: 0,
            row: SPAWN_ROW,
            col: SPAWN_COL,
        }
        : {
            pieceType: "",
            rotation: 0,
            row: SPAWN_ROW,
            col: SPAWN_COL,
        };

    return {
        board: createEmptyBoard(),
        activePiece,
        pendingPiece: firstPieceType ? { ...activePiece } : null,
        pieceQueue,
        holdPieceType: null,
        holdUsedThisDrop: false,
        score: 0,
        lines: 0,
        phase: "playing",
        combo: -1,
        backToBack: false,
        currentTick: 0,
        pieceIndex: firstPieceType ? 1 : 0,
        pendingGarbageQueue: [],
        lastActionWasRotation: false,
    };
}

function flattenBagChunks(bagChunks) {
    if (!Array.isArray(bagChunks)) return [];
    return bagChunks.flat();
}

function createEmptyBoard() {
    return Array.from({ length: BOARD_ROWS }, () => Array(BOARD_COLS).fill(null));
}

function cloneAuthoritativeState(authoritativeState) {
    return {
        board: authoritativeState.board.map((row) => [...row]),
        activePiece: authoritativeState.activePiece
            ? { ...authoritativeState.activePiece }
            : null,
        pendingPiece: authoritativeState.pendingPiece
            ? { ...authoritativeState.pendingPiece }
            : null,
        pieceQueue: [...authoritativeState.pieceQueue],
        holdPieceType: authoritativeState.holdPieceType,
        holdUsedThisDrop: authoritativeState.holdUsedThisDrop,
        score: authoritativeState.score,
        lines: authoritativeState.lines,
        phase: authoritativeState.phase,
        combo: authoritativeState.combo,
        backToBack: authoritativeState.backToBack,
        currentTick: authoritativeState.currentTick,
        pieceIndex: authoritativeState.pieceIndex,
        pendingGarbageQueue: authoritativeState.pendingGarbageQueue.map((garbage) => {
            return { ...garbage };
        }),
        lastActionWasRotation: authoritativeState.lastActionWasRotation,
    };
}

function createClientSnapshotDto(authoritativeSnapshot) {
    return {
        board: authoritativeSnapshot.board.map((row) => [...row]),
        activePiece: authoritativeSnapshot.activePiece
            ? { ...authoritativeSnapshot.activePiece }
            : null,
        pieceQueue: [...authoritativeSnapshot.pieceQueue],
        holdPieceType: authoritativeSnapshot.holdPieceType,
        holdUsedThisDrop: authoritativeSnapshot.holdUsedThisDrop,
        score: authoritativeSnapshot.score,
        lines: authoritativeSnapshot.lines,
        phase: authoritativeSnapshot.phase,
        combo: authoritativeSnapshot.combo,
        backToBack: authoritativeSnapshot.backToBack,
        tick: authoritativeSnapshot.currentTick,
        pieceIndex: authoritativeSnapshot.pieceIndex,
    };
}

function resetMatches() {
    matches.clear();
}

module.exports = {
    appendPlayerBagChunk,
    applyAuthoritativeInputToMatchPlayerState,
    applyGravityStepToMatchPlayerState,
    createMatch,
    getAuthoritativePlayerSnapshot,
    getAuthoritativePlayerSnapshotDto,
    getMatchState,
    recordInput,
    resetMatches,
};
