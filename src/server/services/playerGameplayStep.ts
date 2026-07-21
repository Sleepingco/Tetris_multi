import {
    applyServerInputToPlayerState,
} from "./playerStateInput.js";
import type { Board } from "../../client/game/core/board.js";
import type { PieceState, PlaceablePieceState } from "../../client/game/core/piece.js";
import type { PieceType } from "../../client/game/state/blocks.js";
import type { GameCore } from "./gameCoreLoader.js";
import type { AuthoritativeInput, AuthoritativePlayerState } from "./matchService.js";

type MoveIntent = ReturnType<GameCore["resolveMoveIntent"]>;
export type PresentationEffect = {
    type: "line_clear";
    id?: string;
    pieceIndex: number;
    rows: number[];
    boardBeforeClear: AuthoritativePlayerState["board"];
};
export type PlacementResult = {
    pieceIndex: number;
    lockedPiece: PlaceablePieceState;
    droppedRows: number;
    linesCleared: number;
    isTSpin: boolean;
    combo: number;
    backToBack: boolean;
    rawAttackLines: number;
    attackLines: number;
    canceledGarbageLines: number;
    incomingGarbageLines: number;
    appliedGarbageLines: number;
    scoreBefore: number;
    scoreAfter: number;
    scoreDelta: number;
    gameOver: boolean;
    gameOverReason?: string;
    nextPiece: PlaceablePieceState | null;
};
export type GameplayResult = {
    ok: boolean;
    reason: string | null;
    moveIntent?: MoveIntent | null;
    holdResult?: {
        holdPieceType: PieceType;
        activePiece: AuthoritativePlayerState["activePiece"];
        gameOver?: boolean;
        gameOverReason?: string;
    };
    placementResult?: PlacementResult;
    presentationEffect?: PresentationEffect;
};
export type GravityStepResult = GameplayResult & {
    gravityResult?: {
        kind: "skipped" | "move" | "grounded" | "lock" | MoveIntent["kind"];
        moveIntent?: MoveIntent;
    };
};

export function applyAuthoritativeInput(
    authoritativeState: AuthoritativePlayerState,
    input: AuthoritativeInput,
    gameCore: GameCore,
): GameplayResult {
    if (!authoritativeState) {
        return createFailure("INVALID_AUTHORITATIVE_STATE");
    }

    if (!gameCore) {
        return createFailure("INVALID_GAME_CORE");
    }

    const action = input?.action;
    if (
        action === "move_left" ||
        action === "move_right" ||
        action === "rotate"
    ) {
        return applyServerInputToPlayerState(authoritativeState, input, gameCore);
    }

    if (action === "soft_drop") {
        return applySoftDrop(authoritativeState, input, gameCore);
    }

    if (action === "hard_drop") {
        return applyHardDropInput(authoritativeState, input, gameCore);
    }

    if (action === "hold") {
        return applyHold(authoritativeState, gameCore);
    }

    return createFailure("UNSUPPORTED_ACTION");
}

export function applyAuthoritativeGravityStep(
    authoritativeState: AuthoritativePlayerState,
    gameCore: GameCore,
    options: { lockGroundedPiece?: boolean } = {},
): GravityStepResult {
    if (!authoritativeState) {
        return createFailure("INVALID_AUTHORITATIVE_STATE");
    }

    if (!gameCore) {
        return createFailure("INVALID_GAME_CORE");
    }

    if (authoritativeState.phase !== "playing") {
        return {
            ok: false,
            reason: "GAME_NOT_PLAYING",
            gravityResult: {
                kind: "skipped",
            },
        };
    }

    const activePiece = authoritativeState.activePiece;
    if (!activePiece?.pieceType) {
        return createFailure("INVALID_PLAYER_STATE");
    }

    const pendingPiece = {
        ...activePiece,
        row: activePiece.row + 1,
    };
    const outcome = gameCore.resolveMoveAttempt({
        board: authoritativeState.board,
        activePiece,
        pendingPiece,
        moveCause: "fall",
        blocks: gameCore.BLOCKS,
        wallKicks: gameCore.WALL_KICKS,
    });
    const moveIntent = gameCore.resolveMoveIntent({
        outcome,
        hasFallTimer: true,
    });

    if (moveIntent.kind === "ok" && isPlaceablePiece(moveIntent.active)) {
        authoritativeState.activePiece = { ...moveIntent.active };
        authoritativeState.pendingPiece = { ...moveIntent.active };
        authoritativeState.lastActionWasRotation = false;
        incrementCurrentTick(authoritativeState);

        return {
            ok: true,
            reason: null,
            gravityResult: {
                kind: "move",
                moveIntent,
            },
        };
    }

    if (moveIntent.kind === "lock" && isPlaceablePiece(moveIntent.active)) {
        if (options.lockGroundedPiece !== true) {
            return {
                ok: true,
                reason: null,
                gravityResult: {
                    kind: "grounded",
                    moveIntent,
                },
            };
        }

        const lockResult = lockPieceAndSpawnNext(authoritativeState, gameCore, {
            lockedPiece: { ...moveIntent.active },
            droppedRows: 0,
            useHardDropScore: false,
        });
        if (!lockResult.ok) return lockResult;

        incrementCurrentTick(authoritativeState);

        return {
            ...lockResult,
            gravityResult: {
                kind: "lock",
            },
        };
    }

    return {
        ok: false,
        reason: "GRAVITY_NOT_APPLIED",
        gravityResult: {
            kind: moveIntent.kind,
            moveIntent,
        },
    };
}

function applyHardDropInput(
    authoritativeState: AuthoritativePlayerState,
    input: AuthoritativeInput,
    gameCore: GameCore,
): GameplayResult {
    if (!authoritativeState) {
        return createFailure("INVALID_PLAYER_STATE");
    }

    if (!gameCore) {
        return createFailure("INVALID_GAME_CORE");
    }

    if (input?.action !== "hard_drop") {
        return createFailure("UNSUPPORTED_ACTION");
    }

    const activePiece = authoritativeState.activePiece;
    if (!isPlaceablePiece(activePiece)) {
        return createFailure("INVALID_PLAYER_STATE");
    }

    const droppedRow = gameCore.getHardDropRow(activePiece, (targetRow) => {
        return gameCore.canPlacePiece(authoritativeState.board, {
            ...activePiece,
            row: targetRow,
        }, gameCore.BLOCKS);
    });
    const droppedRows = Math.max(0, droppedRow - activePiece.row);
    const lockedPiece = {
        ...activePiece,
        row: droppedRow,
    };

    return lockPieceAndSpawnNext(authoritativeState, gameCore, {
        lockedPiece,
        droppedRows,
        useHardDropScore: true,
    });
}

function applySoftDrop(
    authoritativeState: AuthoritativePlayerState,
    input: AuthoritativeInput,
    gameCore: GameCore,
): GameplayResult {
    const moveResult = applyServerInputToPlayerState(authoritativeState, input, gameCore);
    if (moveResult.ok) {
        return moveResult;
    }

    if (moveResult.moveIntent?.kind !== "lock" || !isPlaceablePiece(moveResult.moveIntent.active)) {
        return moveResult;
    }

    return lockPieceAndSpawnNext(authoritativeState, gameCore, {
        lockedPiece: { ...moveResult.moveIntent.active },
        droppedRows: 0,
        useHardDropScore: false,
    });
}

function applyHold(
    authoritativeState: AuthoritativePlayerState,
    gameCore: GameCore,
): GameplayResult {
    const activePieceType = authoritativeState.activePiece?.pieceType;
    if (!activePieceType || authoritativeState.holdUsedThisDrop) {
        return createFailure("HOLD_NOT_AVAILABLE");
    }

    let incomingType = authoritativeState.holdPieceType;
    if (!incomingType) {
        if (!Array.isArray(authoritativeState.pieceQueue) || authoritativeState.pieceQueue.length === 0) {
            return createFailure("NO_PIECE_AVAILABLE");
        }
        const queuedPieceType = authoritativeState.pieceQueue.shift();
        if (!queuedPieceType) return createFailure("NO_PIECE_AVAILABLE");
        incomingType = queuedPieceType;
    }

    authoritativeState.holdPieceType = activePieceType;
    const spawnedPiece = spawnPiece(authoritativeState, incomingType, gameCore);
    authoritativeState.holdUsedThisDrop = true;
    authoritativeState.lastActionWasRotation = false;

    return {
        ok: true,
        reason: null,
        holdResult: {
            holdPieceType: authoritativeState.holdPieceType,
            activePiece: { ...authoritativeState.activePiece },
            ...(!spawnedPiece ? {
                gameOver: true,
                gameOverReason: "block_out",
            } : {}),
        },
    };
}

function lockPieceAndSpawnNext(authoritativeState: AuthoritativePlayerState, gameCore: GameCore, {
    lockedPiece,
    droppedRows,
    useHardDropScore,
}: {
    lockedPiece: PlaceablePieceState;
    droppedRows: number;
    useHardDropScore: boolean;
}): GameplayResult {
    if (!lockedPiece?.pieceType) {
        return createFailure("INVALID_AUTHORITATIVE_STATE");
    }

    const scoreBefore = normalizeNumber(authoritativeState.score);
    const linesBefore = normalizeInteger(authoritativeState.lines);
    authoritativeState.score = scoreBefore;
    authoritativeState.lines = linesBefore;

    const lockedPieceIndex = normalizeInteger(authoritativeState.pieceIndex);
    const isTSpin = gameCore.isTSpinLock({
        board: authoritativeState.board,
        piece: lockedPiece,
        lastActionWasRotation: authoritativeState.lastActionWasRotation,
    });
    const topOut = gameCore.isPieceAboveTop(lockedPiece, gameCore.BLOCKS);
    if (useHardDropScore) {
        authoritativeState.score += droppedRows * 2;
    }
    gameCore.lockPieceOnBoard(authoritativeState.board, lockedPiece, gameCore.BLOCKS);

    const clearedRows = topOut
        ? []
        : findFilledRows(authoritativeState.board);
    const presentationEffect: PresentationEffect | null = clearedRows.length > 0
        ? {
            type: "line_clear",
            pieceIndex: lockedPieceIndex,
            rows: clearedRows,
            boardBeforeClear: cloneBoard(authoritativeState.board),
        }
        : null;
    const linesCleared = topOut
        ? 0
        : gameCore.clearFilledLines(authoritativeState.board);
    if (!topOut && linesCleared > 0) {
        const lineClearScore = isTSpin
            ? linesCleared * 10 * 5
            : linesCleared * 10;
        authoritativeState.score += lineClearScore;
        authoritativeState.lines += linesCleared;
    } else if (!topOut && isTSpin) {
        authoritativeState.score += 15;
    }

    const scoreAfter = authoritativeState.score;
    const attackState = gameCore.resolveAttackState({
        combo: authoritativeState.combo,
        backToBack: authoritativeState.backToBack,
        linesCleared,
        isTSpin,
    });
    authoritativeState.combo = attackState.nextCombo;
    authoritativeState.backToBack = attackState.nextBackToBack;

    const rawAttackLines = gameCore.calculateGarbageAttack(attackState);
    const garbageResolution = gameCore.resolveGarbageCancel({
        pendingGarbageQueue: authoritativeState.pendingGarbageQueue,
        rawAttackLines,
    });
    authoritativeState.pendingGarbageQueue = garbageResolution.pendingGarbageQueue;
    const appliedGarbage = applyPendingGarbageQueue(authoritativeState, gameCore);
    const gameOver = topOut || appliedGarbage.overflow;
    authoritativeState.gameOver = gameOver;

    authoritativeState.activePiece = {
        pieceType: "",
        rotation: lockedPiece.rotation,
        row: lockedPiece.row,
        col: lockedPiece.col,
    };
    authoritativeState.pendingPiece = null;

    if (gameOver) {
        authoritativeState.phase = "gameOver";
    }
    const nextPiece = gameOver
        ? null
        : spawnNextPiece(authoritativeState, gameCore);
    const finalGameOver = Boolean(authoritativeState.gameOver);

    return {
        ok: true,
        reason: null,
        ...(presentationEffect ? { presentationEffect } : {}),
        placementResult: {
            pieceIndex: lockedPieceIndex,
            lockedPiece,
            droppedRows,
            linesCleared,
            isTSpin: attackState.isTSpin,
            combo: attackState.combo,
            backToBack: attackState.backToBack,
            rawAttackLines,
            attackLines: garbageResolution.attackLines,
            canceledGarbageLines: garbageResolution.canceledGarbageLines,
            incomingGarbageLines: garbageResolution.incomingGarbageLines,
            appliedGarbageLines: appliedGarbage.appliedLines,
            scoreBefore,
            scoreAfter,
            scoreDelta: scoreAfter - scoreBefore,
            gameOver: finalGameOver,
            ...(authoritativeState.gameOverReason ? {
                gameOverReason: authoritativeState.gameOverReason,
            } : {}),
            nextPiece,
        },
    };
}

function findFilledRows(board: Board): number[] {
    if (!Array.isArray(board)) return [];

    return board.reduce<number[]>((filledRows, row, rowIndex) => {
        if (Array.isArray(row) && row.length > 0 && row.every(cell => cell !== null)) {
            filledRows.push(rowIndex);
        }
        return filledRows;
    }, []);
}

function cloneBoard(
    board: AuthoritativePlayerState["board"],
): AuthoritativePlayerState["board"] {
    return board.map(row => [...row]);
}

function applyPendingGarbageQueue(
    authoritativeState: AuthoritativePlayerState,
    gameCore: GameCore,
): { appliedLines: number; overflow: boolean } {
    let appliedLines = 0;
    let overflow = false;

    while (authoritativeState.pendingGarbageQueue.length > 0) {
        const garbage = authoritativeState.pendingGarbageQueue.shift();
        const result = gameCore.applyGarbageLines(authoritativeState.board, garbage);
        appliedLines += result.appliedLines;
        overflow = overflow || result.overflow;
    }

    return {
        appliedLines,
        overflow,
    };
}

function spawnNextPiece(
    authoritativeState: AuthoritativePlayerState,
    gameCore: GameCore,
): PlaceablePieceState | null {
    if (!Array.isArray(authoritativeState.pieceQueue) || authoritativeState.pieceQueue.length === 0) {
        return null;
    }

    const pieceType = authoritativeState.pieceQueue.shift();
    if (!pieceType) return null;

    authoritativeState.pieceIndex = normalizeInteger(authoritativeState.pieceIndex) + 1;
    authoritativeState.holdUsedThisDrop = false;
    authoritativeState.lastActionWasRotation = false;

    return spawnPiece(authoritativeState, pieceType, gameCore);
}

function spawnPiece(
    authoritativeState: AuthoritativePlayerState,
    pieceType: PieceType,
    gameCore: GameCore,
): PlaceablePieceState | null {
    const spawnedPiece = createSpawnedPiece(pieceType, gameCore);
    const canSpawn = gameCore.canPlacePiece(
        authoritativeState.board,
        spawnedPiece,
        gameCore.BLOCKS,
    );

    if (!canSpawn) {
        authoritativeState.activePiece = {
            ...spawnedPiece,
            pieceType: "",
        };
        authoritativeState.pendingPiece = null;
        authoritativeState.phase = "gameOver";
        authoritativeState.gameOver = true;
        authoritativeState.gameOverReason = "block_out";
        return null;
    }

    authoritativeState.activePiece = { ...spawnedPiece };
    authoritativeState.pendingPiece = { ...spawnedPiece };
    authoritativeState.phase = "playing";
    authoritativeState.gameOver = false;
    return spawnedPiece;
}

function createSpawnedPiece(pieceType: PieceType, gameCore: GameCore): PlaceablePieceState {
    const spawnPosition = gameCore.SPAWN_POSITION ?? {
        row: -1,
        col: 3,
    };
    return gameCore.createSpawnedPiece(
        pieceType,
        spawnPosition.row,
        spawnPosition.col,
    );
}

function createFailure(reason: string): GameplayResult {
    return {
        ok: false,
        reason,
    };
}

function isPlaceablePiece(piece: PieceState): piece is PlaceablePieceState {
    return piece.pieceType !== "";
}

function normalizeInteger(value: unknown): number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0
        ? value
        : 0;
}

function normalizeNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : 0;
}

function incrementCurrentTick(authoritativeState: AuthoritativePlayerState): void {
    authoritativeState.currentTick = normalizeInteger(authoritativeState.currentTick) + 1;
}
