function applyServerGameplayInput(playerState, input, gameCore) {
    if (!playerState) {
        return createFailure("INVALID_PLAYER_STATE");
    }

    if (!gameCore) {
        return createFailure("INVALID_GAME_CORE");
    }

    if (!playerState.activePiece?.pieceType) {
        const spawnedPiece = spawnNextPiece(playerState, gameCore);
        if (!spawnedPiece) {
            return createFailure("NO_PIECE_AVAILABLE");
        }
    }

    if (input?.action !== "hard_drop") {
        return createFailure("UNSUPPORTED_ACTION");
    }

    const activePiece = playerState.activePiece;
    if (!activePiece?.pieceType) {
        return createFailure("INVALID_PLAYER_STATE");
    }

    const scoreBefore = normalizeNumber(playerState.score);
    const linesBefore = normalizeInteger(playerState.lines);
    playerState.score = scoreBefore;
    playerState.lines = linesBefore;

    const lockedPieceIndex = normalizeInteger(playerState.pieceIndex);
    const droppedRow = gameCore.getHardDropRow(activePiece, (targetRow) => {
        return gameCore.canPlacePiece(playerState.board, {
            ...activePiece,
            row: targetRow,
        }, gameCore.BLOCKS);
    });
    const droppedRows = Math.max(0, droppedRow - activePiece.row);
    const lockedPiece = {
        ...activePiece,
        row: droppedRow,
    };

    playerState.score += droppedRows * 2;
    gameCore.lockPieceOnBoard(playerState.board, lockedPiece, gameCore.BLOCKS);

    const linesCleared = gameCore.clearFilledLines(playerState.board);
    if (linesCleared > 0) {
        playerState.score += linesCleared * 10;
        playerState.lines += linesCleared;
    }

    const scoreAfter = playerState.score;
    playerState.activePiece = {
        pieceType: "",
        rotation: lockedPiece.rotation,
        row: lockedPiece.row,
        col: lockedPiece.col,
    };
    playerState.pendingPiece = null;

    const nextPiece = spawnNextPiece(playerState, gameCore);

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

function spawnNextPiece(playerState, gameCore) {
    if (!Array.isArray(playerState.pieceQueue) || playerState.pieceQueue.length === 0) {
        return null;
    }

    const pieceType = playerState.pieceQueue.shift();
    const spawnPosition = gameCore.SPAWN_POSITION ?? {
        row: -1,
        col: 3,
    };
    const spawnedPiece = gameCore.createSpawnedPiece(
        pieceType,
        spawnPosition.row,
        spawnPosition.col,
    );

    playerState.pieceIndex = normalizeInteger(playerState.pieceIndex) + 1;
    playerState.activePiece = { ...spawnedPiece };
    playerState.pendingPiece = { ...spawnedPiece };
    playerState.holdUsedThisDrop = false;
    playerState.phase = "playing";

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
