function applyServerGameplayInput(authoritativeState, input, gameCore) {
    if (!authoritativeState) {
        return createFailure("INVALID_PLAYER_STATE");
    }

    if (!gameCore) {
        return createFailure("INVALID_GAME_CORE");
    }

    if (!authoritativeState.activePiece?.pieceType) {
        const spawnedPiece = spawnNextPiece(authoritativeState, gameCore);
        if (!spawnedPiece) {
            return createFailure("NO_PIECE_AVAILABLE");
        }
    }

    if (input?.action !== "hard_drop") {
        return createFailure("UNSUPPORTED_ACTION");
    }

    const activePiece = authoritativeState.activePiece;
    if (!activePiece?.pieceType) {
        return createFailure("INVALID_PLAYER_STATE");
    }

    const scoreBefore = normalizeNumber(authoritativeState.score);
    const linesBefore = normalizeInteger(authoritativeState.lines);
    authoritativeState.score = scoreBefore;
    authoritativeState.lines = linesBefore;

    const lockedPieceIndex = normalizeInteger(authoritativeState.pieceIndex);
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

    authoritativeState.score += droppedRows * 2;
    gameCore.lockPieceOnBoard(authoritativeState.board, lockedPiece, gameCore.BLOCKS);

    const linesCleared = gameCore.clearFilledLines(authoritativeState.board);
    if (linesCleared > 0) {
        authoritativeState.score += linesCleared * 10;
        authoritativeState.lines += linesCleared;
    }

    const scoreAfter = authoritativeState.score;
    authoritativeState.activePiece = {
        pieceType: "",
        rotation: lockedPiece.rotation,
        row: lockedPiece.row,
        col: lockedPiece.col,
    };
    authoritativeState.pendingPiece = null;

    const nextPiece = spawnNextPiece(authoritativeState, gameCore);

    return {
        ok: true,
        reason: null,
        placementResult: {
            pieceIndex: lockedPieceIndex,
            lockedPiece,
            droppedRows,
            linesCleared,
            scoreBefore,
            scoreAfter,
            scoreDelta: scoreAfter - scoreBefore,
            nextPiece,
        },
    };
}

function spawnNextPiece(authoritativeState, gameCore) {
    if (!Array.isArray(authoritativeState.pieceQueue) || authoritativeState.pieceQueue.length === 0) {
        return null;
    }

    const pieceType = authoritativeState.pieceQueue.shift();
    const spawnPosition = gameCore.SPAWN_POSITION ?? {
        row: -1,
        col: 3,
    };
    const spawnedPiece = gameCore.createSpawnedPiece(
        pieceType,
        spawnPosition.row,
        spawnPosition.col,
    );

    authoritativeState.pieceIndex = normalizeInteger(authoritativeState.pieceIndex) + 1;
    authoritativeState.activePiece = { ...spawnedPiece };
    authoritativeState.pendingPiece = { ...spawnedPiece };
    authoritativeState.holdUsedThisDrop = false;
    authoritativeState.phase = "playing";

    return spawnedPiece;
}

function createFailure(reason) {
    return {
        ok: false,
        reason,
    };
}

function normalizeInteger(value) {
    return Number.isInteger(value) && value >= 0
        ? value
        : 0;
}

function normalizeNumber(value) {
    return Number.isFinite(value) && value >= 0
        ? value
        : 0;
}

module.exports = {
    applyServerGameplayInput,
};
