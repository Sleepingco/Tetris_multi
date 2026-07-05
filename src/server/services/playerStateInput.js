function applyServerInputToPlayerState(playerState, input, gameCore) {
    const inputIntent = gameCore?.resolveInputMoveIntent?.(input?.action);
    if (!inputIntent) {
        return {
            ok: false,
            reason: "UNSUPPORTED_ACTION",
            moveIntent: null,
        };
    }

    if (!playerState?.activePiece?.pieceType) {
        return {
            ok: false,
            reason: "INVALID_PLAYER_STATE",
            moveIntent: null,
        };
    }

    const nextPendingPiece = createPendingPiece(playerState, inputIntent);
    if (!nextPendingPiece) {
        return {
            ok: false,
            reason: "NO_PENDING_PIECE",
            moveIntent: null,
        };
    }

    const outcome = gameCore.resolveMoveAttempt({
        board: playerState.board,
        activePiece: playerState.activePiece,
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

    playerState.pendingPiece = { ...outcome.pending };

    if (moveIntent.kind === "ok") {
        playerState.activePiece = { ...moveIntent.active };
        playerState.lastActionWasRotation = moveIntent.moveCause === "rotate";
        return {
            ok: true,
            reason: null,
            moveIntent,
        };
    }

    if (moveIntent.kind === "retry") {
        playerState.activePiece = { ...moveIntent.active };
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

function createPendingPiece(playerState, inputIntent) {
    if (inputIntent.kind === "shift") {
        const pendingPiece = playerState.pendingPiece
            ? { ...playerState.pendingPiece }
            : { ...playerState.activePiece };

        pendingPiece.row += inputIntent.rowDelta;
        pendingPiece.col += inputIntent.colDelta;

        return pendingPiece;
    }

    if (inputIntent.kind === "rotate") {
        if (!playerState.pendingPiece) return null;

        const pendingPiece = { ...playerState.pendingPiece };
        pendingPiece.rotation = pendingPiece.rotation === 3
            ? 0
            : pendingPiece.rotation + 1;

        return pendingPiece;
    }

    return null;
}

module.exports = {
    applyServerInputToPlayerState,
};
