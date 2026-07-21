import type { PieceState, PlaceablePieceState } from "../../client/game/core/piece.js";
import type { GameCore } from "./gameCoreLoader.js";
import type { AuthoritativeInput, AuthoritativePlayerState } from "./matchService.js";

type MoveIntent = ReturnType<GameCore["resolveMoveIntent"]>;
export type PlayerStateInputResult = {
    ok: boolean;
    reason: string | null;
    moveIntent: MoveIntent | null;
};

export function applyServerInputToPlayerState(
    authoritativeState: AuthoritativePlayerState,
    input: AuthoritativeInput,
    gameCore: GameCore,
): PlayerStateInputResult {
    const inputIntent = gameCore?.resolveInputMoveIntent?.(input?.action);
    if (!inputIntent) {
        return {
            ok: false,
            reason: "UNSUPPORTED_ACTION",
            moveIntent: null,
        };
    }

    if (!isPlaceablePiece(authoritativeState?.activePiece)) {
        return {
            ok: false,
            reason: "INVALID_PLAYER_STATE",
            moveIntent: null,
        };
    }

    const nextPendingPiece = createPendingPiece(authoritativeState, inputIntent);
    if (!nextPendingPiece) {
        return {
            ok: false,
            reason: "NO_PENDING_PIECE",
            moveIntent: null,
        };
    }

    const outcome = gameCore.resolveMoveAttempt({
        board: authoritativeState.board,
        activePiece: authoritativeState.activePiece,
        pendingPiece: nextPendingPiece,
        moveCause: inputIntent.moveType,
        blocks: gameCore.BLOCKS,
        wallKicks: gameCore.WALL_KICKS,
    });
    const moveIntent = gameCore.resolveMoveIntent({
        outcome,
        hasFallTimer: true,
    });

    if (moveIntent.kind === "lock" || moveIntent.kind === "gameOver") {
        return {
            ok: false,
            reason: "MOVE_NOT_HANDLED",
            moveIntent,
        };
    }

    authoritativeState.pendingPiece = { ...outcome.pending };

    if (moveIntent.kind === "ok") {
        authoritativeState.activePiece = { ...moveIntent.active };
        authoritativeState.lastActionWasRotation = moveIntent.moveCause === "rotate";
        return {
            ok: true,
            reason: null,
            moveIntent,
        };
    }

    if (moveIntent.kind === "retry") {
        authoritativeState.activePiece = { ...moveIntent.active };
        return {
            ok: false,
            reason: "MOVE_RETRY",
            moveIntent,
        };
    }

    return {
        ok: false,
        reason: "MOVE_NOT_HANDLED",
        moveIntent,
    };
}

function createPendingPiece(
    authoritativeState: AuthoritativePlayerState,
    inputIntent: NonNullable<ReturnType<GameCore["resolveInputMoveIntent"]>>,
): PieceState | null {
    if (inputIntent.kind === "shift") {
        const activePiece = authoritativeState.activePiece;
        if (!isPlaceablePiece(activePiece)) return null;
        const pendingPiece = authoritativeState.pendingPiece
            ? { ...authoritativeState.pendingPiece }
            : { ...activePiece };

        pendingPiece.row += inputIntent.rowDelta;
        pendingPiece.col += inputIntent.colDelta;

        return pendingPiece;
    }

    if (inputIntent.kind === "rotate") {
        if (!authoritativeState.pendingPiece) return null;

        const pendingPiece = { ...authoritativeState.pendingPiece };
        pendingPiece.rotation = pendingPiece.rotation === 3
            ? 0
            : pendingPiece.rotation + 1;

        return pendingPiece;
    }

    return null;
}

function isPlaceablePiece(
    piece: PieceState | null | undefined,
): piece is PlaceablePieceState {
    return Boolean(piece?.pieceType);
}
