const {
    applyServerInputToPlayerState,
} = require("./playerStateInput.js");

function applyAuthoritativeInput(authoritativeState, input, gameCore) {
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

function applyHardDropInput(authoritativeState, input, gameCore) {
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

function applySoftDrop(authoritativeState, input, gameCore) {
    const moveResult = applyServerInputToPlayerState(authoritativeState, input, gameCore);
    if (moveResult.ok) {
        return moveResult;
    }

    if (moveResult.moveIntent?.kind !== "lock") {
        return moveResult;
    }

    authoritativeState.lastActionWasRotation = false;
    return lockPieceAndSpawnNext(authoritativeState, gameCore, {
        lockedPiece: { ...moveResult.moveIntent.active },
        droppedRows: 0,
        useHardDropScore: false,
    });
}

function applyHold(authoritativeState, gameCore) {
    const activePieceType = authoritativeState.activePiece?.pieceType;
    if (!activePieceType || authoritativeState.holdUsedThisDrop) {
        return createFailure("HOLD_NOT_AVAILABLE");
    }

    let incomingType = authoritativeState.holdPieceType;
    if (!incomingType) {
        if (!Array.isArray(authoritativeState.pieceQueue) || authoritativeState.pieceQueue.length === 0) {
            return createFailure("NO_PIECE_AVAILABLE");
        }
        incomingType = authoritativeState.pieceQueue.shift();
    }

    authoritativeState.holdPieceType = activePieceType;
    const spawnedPiece = createSpawnedPiece(incomingType, gameCore);
    authoritativeState.activePiece = { ...spawnedPiece };
    authoritativeState.pendingPiece = { ...spawnedPiece };
    authoritativeState.holdUsedThisDrop = true;
    authoritativeState.phase = "playing";

    return {
        ok: true,
        reason: null,
        holdResult: {
            holdPieceType: authoritativeState.holdPieceType,
            activePiece: { ...authoritativeState.activePiece },
        },
    };
}

function lockPieceAndSpawnNext(authoritativeState, gameCore, {
    lockedPiece,
    droppedRows,
    useHardDropScore,
}) {
    if (!lockedPiece?.pieceType) {
        return createFailure("INVALID_AUTHORITATIVE_STATE");
    }

    const scoreBefore = normalizeNumber(authoritativeState.score);
    const linesBefore = normalizeInteger(authoritativeState.lines);
    authoritativeState.score = scoreBefore;
    authoritativeState.lines = linesBefore;

    const lockedPieceIndex = normalizeInteger(authoritativeState.pieceIndex);
    if (useHardDropScore) {
        authoritativeState.score += droppedRows * 2;
    }
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
    const spawnedPiece = createSpawnedPiece(pieceType, gameCore);

    authoritativeState.pieceIndex = normalizeInteger(authoritativeState.pieceIndex) + 1;
    authoritativeState.activePiece = { ...spawnedPiece };
    authoritativeState.pendingPiece = { ...spawnedPiece };
    authoritativeState.holdUsedThisDrop = false;
    authoritativeState.phase = "playing";

    return spawnedPiece;
}

function createSpawnedPiece(pieceType, gameCore) {
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
    applyAuthoritativeInput,
};
