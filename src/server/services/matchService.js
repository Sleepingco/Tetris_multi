// =============================
// In-memory Match Store
// match는 player별 input log, server bag chunk, authoritativeState 초안을 저장한다.
// =============================
const {
    applyAuthoritativeInput,
    applyAuthoritativeGravityStep,
} = require("./playerGameplayStep.js");
const {
    DEFAULT_AI_DIFFICULTY,
    DEFAULT_AI_POLICY,
    isValidAiDifficulty,
    isValidAiPolicy,
} = require("./aiDifficulty.js");

const matches = new Map();
const BAG_PIECES = ["bar", "eleft", "eright", "ess", "square", "tree", "zee"];
const INITIAL_BAG_CHUNK_COUNT = 3;
const MAX_INPUT_LOG_ENTRIES_PER_PLAYER = 1000;
const BOARD_ROWS = 20;
const BOARD_COLS = 10;
const SPAWN_ROW = -1;
const SPAWN_COL = 3;
const POSITION_TRANSFORM_ACTIONS = new Set(["move_left", "move_right", "rotate"]);
const LOCKING_TRANSFORM_ACTIONS = new Set(["soft_drop", "hard_drop"]);

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

    const mode = room.mode || "pvp";
    let aiDifficulty = null;
    let aiPolicy = null;
    if (mode === "pve") {
        if (room.aiDifficulty === undefined || room.aiDifficulty === null) {
            aiDifficulty = DEFAULT_AI_DIFFICULTY;
        } else if (isValidAiDifficulty(room.aiDifficulty)) {
            aiDifficulty = room.aiDifficulty;
        } else {
            return createFailure("INVALID_AI_DIFFICULTY");
        }
        if (room.aiPolicy === undefined || room.aiPolicy === null) {
            aiPolicy = DEFAULT_AI_POLICY;
        } else if (isValidAiPolicy(room.aiPolicy)) {
            aiPolicy = room.aiPolicy;
        } else {
            return createFailure("INVALID_AI_POLICY");
        }
    }
    const match = {
        roomId: room.roomId,
        mode,
        aiDifficulty,
        aiPolicy,
        aiPolicyRuntime: null,
        status: room.status || "playing",
        players: room.players.map((player) => {
            const bagChunks = createInitialBagChunks();

            return {
                playerId: player.playerId,
                playerType: player.playerType || "human",
                inputLog: [],
                nextInputSequence: 1,
                lastProcessedClientSequence: 0,
                bagChunks,
                authoritativeState: createInitialPlayerState(bagChunks),
                aiPlan: null,
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

function deleteMatch(roomId) {
    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    matches.delete(roomId);

    return createSuccess(match);
}

/**
 * player 입력을 match input log에 append-only로 저장한다.
 * - action/tick/pieceIndex의 강한 검증은 socket handler에서 먼저 수행한다.
 *
 * @param {string} roomId - match room id
 * @param {string} playerId - 입력을 보낸 player id
 * @param {{action: string, tick?: number|null, pieceIndex?: number|null, clientSequence?: number}} input - 저장할 입력 정보
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

    if (player.playerType !== "human") {
        return createFailure("PLAYER_INPUT_NOT_ALLOWED");
    }

    if (!input || typeof input.action !== "string") {
        return createFailure("INVALID_INPUT");
    }

    if (!Number.isInteger(player.nextInputSequence)) {
        player.nextInputSequence = player.inputLog.length + 1;
    }

    player.inputLog.push({
        playerId,
        action: input.action,
        tick: input.tick ?? null,
        pieceIndex: input.pieceIndex ?? null,
        ...(Number.isInteger(input.clientSequence)
            ? { clientSequence: input.clientSequence }
            : {}),
        sequence: player.nextInputSequence,
        receivedAt: Date.now(),
    });
    player.nextInputSequence += 1;

    if (player.inputLog.length > MAX_INPUT_LOG_ENTRIES_PER_PLAYER) {
        player.inputLog.splice(0, player.inputLog.length - MAX_INPUT_LOG_ENTRIES_PER_PLAYER);
    }

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

function appendPendingGarbageToOpponent(roomId, fromPlayerId, garbage) {
    if (!Number.isInteger(garbage?.lines) || garbage.lines <= 0
        || !Number.isInteger(garbage?.holeCol) || garbage.holeCol < 0 || garbage.holeCol >= BOARD_COLS) {
        return createFailure("INVALID_GARBAGE");
    }

    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    const fromPlayer = match.players.find((matchPlayer) => {
        return matchPlayer.playerId === fromPlayerId;
    });

    if (!fromPlayer) {
        return createFailure("PLAYER_NOT_FOUND");
    }

    const targetPlayer = match.players.find((matchPlayer) => {
        return matchPlayer.playerId !== fromPlayerId;
    });

    if (!targetPlayer) {
        return createFailure("TARGET_PLAYER_NOT_FOUND");
    }

    if (!targetPlayer.authoritativeState) {
        return {
            ok: false,
            match,
            reason: "AUTHORITATIVE_STATE_NOT_FOUND",
        };
    }

    targetPlayer.authoritativeState.pendingGarbageQueue.push({
        lines: garbage.lines,
        holeCol: garbage.holeCol,
    });

    return createSuccess(match, {
        targetPlayerId: targetPlayer.playerId,
        garbage: {
            lines: garbage.lines,
            holeCol: garbage.holeCol,
        },
    });
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

    const clientSequence = Number.isInteger(input?.clientSequence)
        && input.clientSequence >= 1
        ? input.clientSequence
        : null;
    if (clientSequence !== null) {
        const sequenceValidation = validateClientInputSequence(roomId, playerId, clientSequence);
        if (!sequenceValidation.ok) return sequenceValidation;
    }

    if (input?.pieceIndex !== player.authoritativeState.pieceIndex) {
        markClientInputProcessed(player, clientSequence);
        return {
            ok: false,
            match,
            reason: "PIECE_INDEX_MISMATCH",
        };
    }

    const expectedTransform = input?.expectedTransform;
    if (
        LOCKING_TRANSFORM_ACTIONS.has(input?.action) &&
        expectedTransform &&
        !doesPieceMatchExpectedTransform(player.authoritativeState.activePiece, expectedTransform)
    ) {
        markClientInputProcessed(player, clientSequence);
        return {
            ok: false,
            match,
            reason: "PREDICTION_DIVERGED",
        };
    }

    const gameplayResult = applyAuthoritativeInput(player.authoritativeState, input, gameCore);
    if (!gameplayResult.ok) {
        markClientInputProcessed(player, clientSequence);
        return {
            ok: false,
            match,
            reason: expectedTransform
                && POSITION_TRANSFORM_ACTIONS.has(input?.action)
                && gameplayResult.reason === "MOVE_RETRY"
                ? "PREDICTION_DIVERGED"
                : gameplayResult.reason,
            gameplayResult,
        };
    }

    markClientInputProcessed(player, clientSequence);
    if (
        expectedTransform &&
        POSITION_TRANSFORM_ACTIONS.has(input?.action) &&
        !doesPieceMatchExpectedTransform(player.authoritativeState.activePiece, expectedTransform)
    ) {
        return {
            ok: false,
            match,
            reason: "PREDICTION_DIVERGED",
            gameplayResult,
        };
    }
    attachPresentationEffectId(gameplayResult, playerId);
    return createSuccess(match, { gameplayResult });
}

function doesPieceMatchExpectedTransform(piece, expectedTransform) {
    return piece?.pieceType === expectedTransform.pieceType
        && piece.rotation === expectedTransform.rotation
        && piece.col === expectedTransform.col;
}

function markClientInputProcessed(player, clientSequence) {
    if (!Number.isInteger(clientSequence)) return;

    player.lastProcessedClientSequence = clientSequence;
}

function validateClientInputSequence(roomId, playerId, clientSequence) {
    const match = matches.get(roomId);
    if (!match) return createFailure("MATCH_NOT_FOUND");

    const player = match.players.find(matchPlayer => matchPlayer.playerId === playerId);
    if (!player) return createFailure("PLAYER_NOT_FOUND");
    if (!Number.isInteger(clientSequence) || clientSequence < 1) {
        return createFailure("INVALID_CLIENT_SEQUENCE");
    }

    const lastProcessedClientSequence = Number.isInteger(player.lastProcessedClientSequence)
        ? player.lastProcessedClientSequence
        : 0;
    if (clientSequence <= lastProcessedClientSequence) {
        return createFailure("CLIENT_SEQUENCE_OUT_OF_ORDER");
    }

    return createSuccess(match);
}

function acknowledgeClientInputSequence(roomId, playerId, clientSequence) {
    const match = matches.get(roomId);
    if (!match) return createFailure("MATCH_NOT_FOUND");

    const player = match.players.find(matchPlayer => matchPlayer.playerId === playerId);
    if (!player) return createFailure("PLAYER_NOT_FOUND");
    if (!Number.isInteger(clientSequence) || clientSequence < 1) {
        return createFailure("INVALID_CLIENT_SEQUENCE");
    }

    const lastProcessedClientSequence = Number.isInteger(player.lastProcessedClientSequence)
        ? player.lastProcessedClientSequence
        : 0;
    if (clientSequence < lastProcessedClientSequence) {
        return createFailure("CLIENT_SEQUENCE_OUT_OF_ORDER");
    }

    if (clientSequence > lastProcessedClientSequence) {
        player.lastProcessedClientSequence = clientSequence;
    }
    return createSuccess(match);
}

function ensurePlayerBagQueue(roomId, playerId, minimumRemaining = 7) {
    const match = matches.get(roomId);
    if (!match) return createFailure("MATCH_NOT_FOUND");

    const player = match.players.find(matchPlayer => matchPlayer.playerId === playerId);
    if (!player) return createFailure("PLAYER_NOT_FOUND");

    const remaining = player.authoritativeState?.pieceQueue?.length ?? 0;
    if (remaining > minimumRemaining) {
        return createSuccess(match, { bagChunk: null });
    }

    return appendPlayerBagChunk(roomId, playerId);
}

function markAuthoritativePlayerGameOver(roomId, playerId, reason = "game_over") {
    const match = matches.get(roomId);
    if (!match) return createFailure("MATCH_NOT_FOUND");

    const player = match.players.find(matchPlayer => matchPlayer.playerId === playerId);
    if (!player?.authoritativeState) {
        return createFailure(player ? "AUTHORITATIVE_STATE_NOT_FOUND" : "PLAYER_NOT_FOUND");
    }

    player.authoritativeState.phase = "gameOver";
    player.authoritativeState.gameOver = true;
    player.authoritativeState.gameOverReason = reason;
    return createSuccess(match);
}

function applyGravityStepToMatchPlayerState(roomId, playerId, gameCore, options = {}) {
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

    const gravityStepResult = applyAuthoritativeGravityStep(
        player.authoritativeState,
        gameCore,
        options,
    );
    if (!gravityStepResult.ok) {
        return {
            ok: false,
            match,
            reason: gravityStepResult.reason,
            gravityResult: gravityStepResult.gravityResult,
            gravityStepResult,
        };
    }

    attachPresentationEffectId(gravityStepResult, playerId);
    return createSuccess(match, {
        gravityResult: gravityStepResult.gravityResult,
        gravityStepResult,
        placementResult: gravityStepResult.placementResult,
        presentationEffect: gravityStepResult.presentationEffect,
    });
}

function attachPresentationEffectId(gameplayResult, playerId) {
    const effect = gameplayResult?.presentationEffect;
    if (!effect || !Number.isInteger(effect.pieceIndex)) return;

    gameplayResult.presentationEffect = {
        ...effect,
        id: `${playerId}:${effect.pieceIndex}:line_clear`,
    };
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

    const player = result.match.players.find(matchPlayer => matchPlayer.playerId === playerId);
    const lastProcessedClientSequence = Number.isInteger(player?.lastProcessedClientSequence)
        ? player.lastProcessedClientSequence
        : 0;

    return createSuccess(result.match, {
        snapshot: {
            ...createClientSnapshotDto(result.snapshot),
            lastProcessedClientSequence,
        },
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
        gameOver: false,
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
        gameOver: Boolean(authoritativeState.gameOver),
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
    const pendingGarbageLines = authoritativeSnapshot.pendingGarbageQueue.reduce((total, garbage) => {
        return total + garbage.lines;
    }, 0);

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
        gameOver: Boolean(authoritativeSnapshot.gameOver),
        combo: authoritativeSnapshot.combo,
        backToBack: authoritativeSnapshot.backToBack,
        tick: authoritativeSnapshot.currentTick,
        pieceIndex: authoritativeSnapshot.pieceIndex,
        pendingGarbageLines,
    };
}

function resetMatches() {
    matches.clear();
}

module.exports = {
    acknowledgeClientInputSequence,
    appendPlayerBagChunk,
    appendPendingGarbageToOpponent,
    applyAuthoritativeInputToMatchPlayerState,
    applyGravityStepToMatchPlayerState,
    createMatch,
    deleteMatch,
    getAuthoritativePlayerSnapshot,
    getAuthoritativePlayerSnapshotDto,
    getMatchState,
    ensurePlayerBagQueue,
    markAuthoritativePlayerGameOver,
    MAX_INPUT_LOG_ENTRIES_PER_PLAYER,
    recordInput,
    resetMatches,
    validateClientInputSequence,
};
