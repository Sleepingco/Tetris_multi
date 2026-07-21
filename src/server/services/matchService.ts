// =============================
// In-memory Match Store
// match는 player별 server bag chunk와 authoritativeState를 저장한다.
// =============================
import {
    applyAuthoritativeInput,
    applyAuthoritativeGravityStep,
} from "./playerGameplayStep.js";
import {
    DEFAULT_AI_DIFFICULTY,
    DEFAULT_AI_POLICY,
    isValidAiDifficulty,
    isValidAiPolicy,
} from "./aiDifficulty.js";
import type { GarbageEntry } from "../../client/game/core/garbage.js";
import type { PieceState, PlaceablePieceState } from "../../client/game/core/piece.js";
import type { PieceType } from "../../client/game/state/blocks.js";
import type { GamePhase } from "../../client/game/state/stateFactory.js";
import type { ClientToServerParsedPayload, ServerToClientParsedPayload } from "../../shared/socketContractTypes.js";
import type { AiDifficulty, AiPolicy } from "./aiDifficulty.js";
import type { GameCore } from "./gameCoreLoader.js";
import type {
    GameplayResult,
    GravityStepResult,
    PlacementResult,
    PresentationEffect,
} from "./playerGameplayStep.js";
import type { PveAiPlan } from "./pveAiPlayerService.js";
import type { PlayerType, RoomState, RoomStatus } from "./roomService.js";

type ParsedGameInput = ClientToServerParsedPayload<"game:input">;
export type AuthoritativeInput = {
    action: ParsedGameInput["action"];
    tick: number;
    pieceIndex: number;
    clientSequence?: number;
    expectedTransform?: {
        pieceType: PieceType;
        rotation: number;
        col: number;
    };
};
type AuthoritativeBoard = AuthoritativeSnapshotDto["board"];
export type AuthoritativePlayerState = {
    board: AuthoritativeBoard;
    activePiece: PieceState;
    pendingPiece: PieceState | null;
    pieceQueue: PieceType[];
    holdPieceType: PieceType | null;
    holdUsedThisDrop: boolean;
    score: number;
    lines: number;
    phase: GamePhase;
    gameOver: boolean;
    gameOverReason?: string;
    combo: number;
    backToBack: boolean;
    currentTick: number;
    pieceIndex: number;
    pendingGarbageQueue: GarbageEntry[];
    lastActionWasRotation: boolean;
};
export type AiPolicyRuntime = ServerToClientParsedPayload<"pve:ai-policy">;
export type MatchPlayer = {
    playerId: string;
    playerType: PlayerType;
    lastProcessedClientSequence: number;
    bagChunks: PieceType[][];
    authoritativeState: AuthoritativePlayerState;
    aiPlan: PveAiPlan | null;
};
export type MatchState = {
    roomId: string;
    mode: RoomState["mode"];
    aiDifficulty: AiDifficulty | null;
    aiPolicy: AiPolicy | null;
    aiPolicyRuntime: AiPolicyRuntime | null;
    status: RoomStatus;
    players: MatchPlayer[];
    createdAt: number;
};
export type AuthoritativeSnapshotDto = ServerToClientParsedPayload<
    "game:authoritative:snapshot"
>["snapshot"];
type MatchResultFields = {
    bagChunk?: PieceType[] | null;
    targetPlayerId?: string;
    garbage?: GarbageEntry;
    gameplayResult?: GameplayResult;
    gravityResult?: GravityStepResult["gravityResult"];
    gravityStepResult?: GravityStepResult;
    placementResult?: PlacementResult;
    presentationEffect?: PresentationEffect;
    snapshot?: AuthoritativePlayerState | AuthoritativeSnapshotDto;
};
export type MatchResult = MatchResultFields & ({
    ok: true;
    match: MatchState;
    reason: null;
} | {
    ok: false;
    match: MatchState | null;
    reason: string | null;
});
export type AuthoritativeStateResult = Omit<MatchResultFields, "snapshot"> & ({
    ok: true;
    match: MatchState;
    reason: null;
    snapshot: AuthoritativePlayerState;
} | {
    ok: false;
    match: MatchState | null;
    reason: string | null;
    snapshot?: never;
});
export type AuthoritativeSnapshotDtoResult = Omit<MatchResultFields, "snapshot"> & ({
    ok: true;
    match: MatchState;
    reason: null;
    snapshot: AuthoritativeSnapshotDto;
} | {
    ok: false;
    match: MatchState | null;
    reason: string | null;
    snapshot?: never;
});

const matches = new Map<string, MatchState>();
const BAG_PIECES: PieceType[] = ["bar", "eleft", "eright", "ess", "square", "tree", "zee"];
const INITIAL_BAG_CHUNK_COUNT = 3;
const BOARD_ROWS = 20;
const BOARD_COLS = 10;
const SPAWN_ROW = -1;
const SPAWN_COL = 3;
const POSITION_TRANSFORM_ACTIONS = new Set<AuthoritativeInput["action"]>([
    "move_left", "move_right", "rotate",
]);
const LOCKING_TRANSFORM_ACTIONS = new Set<AuthoritativeInput["action"]>([
    "soft_drop", "hard_drop",
]);

function createSuccess(match: MatchState, extra: MatchResultFields = {}): MatchResult {
    return {
        ok: true,
        match,
        reason: null,
        ...extra,
    };
}

function createFailure(reason: string): MatchResult {
    return {
        ok: false,
        match: null,
        reason,
    };
}

/**
 * room 상태를 기준으로 match를 시작하고 player별 초기 server bag과 authoritative state를 만든다.
 *
 * @param {{roomId: string, status?: string, players: Array<{playerId: string}>}} room - 시작할 room 상태
 * @returns {{ok: boolean, match: Object|null, reason: string|null}} match 생성 결과
 */
export function createMatch(room: RoomState | null | undefined): MatchResult {
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

export function getMatchState(roomId: string): MatchResult {
    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    return createSuccess(match);
}

export function deleteMatch(roomId: string): MatchResult {
    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    matches.delete(roomId);

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
export function appendPlayerBagChunk(roomId: string, playerId: string): MatchResult {
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

export function appendPendingGarbageToOpponent(
    roomId: string,
    fromPlayerId: string,
    garbage: GarbageEntry,
): MatchResult {
    const lines = garbage?.lines;
    const holeCol = garbage?.holeCol;
    if (typeof lines !== "number" || !Number.isInteger(lines) || lines <= 0
        || typeof holeCol !== "number" || !Number.isInteger(holeCol)
        || holeCol < 0 || holeCol >= BOARD_COLS) {
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
        lines,
        holeCol,
    });

    return createSuccess(match, {
        targetPlayerId: targetPlayer.playerId,
        garbage: {
            lines,
            holeCol,
        },
    });
}

export function applyAuthoritativeInputToMatchPlayerState(
    roomId: string,
    playerId: string,
    input: AuthoritativeInput,
    gameCore: GameCore,
): MatchResult {
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

    const clientSequenceValue = input?.clientSequence;
    const clientSequence = typeof clientSequenceValue === "number"
        && Number.isInteger(clientSequenceValue)
        && clientSequenceValue >= 1
        ? clientSequenceValue
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

function doesPieceMatchExpectedTransform(
    piece: PieceState,
    expectedTransform: NonNullable<AuthoritativeInput["expectedTransform"]>,
): boolean {
    return piece?.pieceType === expectedTransform.pieceType
        && piece.rotation === expectedTransform.rotation
        && piece.col === expectedTransform.col;
}

function markClientInputProcessed(
    player: MatchPlayer,
    clientSequence: number | null,
): void {
    if (typeof clientSequence !== "number" || !Number.isInteger(clientSequence)) return;

    player.lastProcessedClientSequence = clientSequence;
}

export function validateClientInputSequence(
    roomId: string,
    playerId: string,
    clientSequence: number,
): MatchResult {
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

export function acknowledgeClientInputSequence(
    roomId: string,
    playerId: string,
    clientSequence: number,
): MatchResult {
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

export function ensurePlayerBagQueue(
    roomId: string,
    playerId: string,
    minimumRemaining = 7,
): MatchResult {
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

export function markAuthoritativePlayerGameOver(
    roomId: string,
    playerId: string,
    reason = "game_over",
): MatchResult {
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

export function applyGravityStepToMatchPlayerState(
    roomId: string,
    playerId: string,
    gameCore: GameCore,
    options: { lockGroundedPiece?: boolean } = {},
): MatchResult {
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

function attachPresentationEffectId(
    gameplayResult: GameplayResult | GravityStepResult,
    playerId: string,
): void {
    const effect = gameplayResult?.presentationEffect;
    if (!effect || !Number.isInteger(effect.pieceIndex)) return;

    gameplayResult.presentationEffect = {
        ...effect,
        id: `${playerId}:${effect.pieceIndex}:line_clear`,
    };
}

export function getAuthoritativePlayerSnapshot(
    roomId: string,
    playerId: string,
): AuthoritativeStateResult {
    const match = matches.get(roomId);

    if (!match) {
        return {
            ok: false,
            match: null,
            reason: "MATCH_NOT_FOUND",
        };
    }

    const player = match.players.find((matchPlayer) => {
        return matchPlayer.playerId === playerId;
    });

    if (!player) {
        return {
            ok: false,
            match: null,
            reason: "PLAYER_NOT_FOUND",
        };
    }

    if (!player.authoritativeState) {
        return {
            ok: false,
            match,
            reason: "AUTHORITATIVE_STATE_NOT_FOUND",
        };
    }

    return {
        ok: true,
        match,
        reason: null,
        snapshot: cloneAuthoritativeState(player.authoritativeState),
    };
}

export function getAuthoritativePlayerSnapshotDto(
    roomId: string,
    playerId: string,
): AuthoritativeSnapshotDtoResult {
    const result = getAuthoritativePlayerSnapshot(roomId, playerId);

    if (!result.ok) {
        return result;
    }

    const player = result.match.players.find(matchPlayer => matchPlayer.playerId === playerId);
    const sequence = player?.lastProcessedClientSequence;
    const lastProcessedClientSequence = typeof sequence === "number" && Number.isInteger(sequence)
        ? sequence
        : 0;

    return {
        ok: true,
        match: result.match,
        reason: null,
        snapshot: {
            ...createClientSnapshotDto(result.snapshot),
            lastProcessedClientSequence,
        },
    };
}

function createBagChunk(): PieceType[] {
    const chunk = [...BAG_PIECES];

    for (let i = chunk.length - 1; i > 0; i--) {
        const randomIndex = Math.floor(Math.random() * (i + 1));
        const currentPiece = chunk[i];
        const randomPiece = chunk[randomIndex];
        if (!currentPiece || !randomPiece) continue;
        chunk[i] = randomPiece;
        chunk[randomIndex] = currentPiece;
    }

    return chunk;
}

function createInitialBagChunks(count = INITIAL_BAG_CHUNK_COUNT): PieceType[][] {
    return Array.from({ length: count }, () => createBagChunk());
}

function createInitialPlayerState(bagChunks: PieceType[][] = []): AuthoritativePlayerState {
    const pieceQueue = flattenBagChunks(bagChunks);
    const firstPieceType = pieceQueue.shift();
    const activePiece: PieceState = firstPieceType
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
        pendingPiece: firstPieceType ? {
            pieceType: firstPieceType,
            rotation: 0,
            row: SPAWN_ROW,
            col: SPAWN_COL,
        } : null,
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

function flattenBagChunks(bagChunks: PieceType[][]): PieceType[] {
    if (!Array.isArray(bagChunks)) return [];
    return bagChunks.flat();
}

function createEmptyBoard(): AuthoritativeBoard {
    return Array.from({ length: BOARD_ROWS }, () => Array(BOARD_COLS).fill(null));
}

function cloneAuthoritativeState(
    authoritativeState: AuthoritativePlayerState,
): AuthoritativePlayerState {
    return {
        board: authoritativeState.board.map((row) => [...row]),
        activePiece: { ...authoritativeState.activePiece },
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

function createClientSnapshotDto(
    authoritativeSnapshot: AuthoritativePlayerState,
): Omit<AuthoritativeSnapshotDto, "lastProcessedClientSequence"> {
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

export function resetMatches(): void {
    matches.clear();
}
