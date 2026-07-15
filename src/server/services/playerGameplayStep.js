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

function applyAuthoritativeGravityStep(authoritativeState, gameCore, options = {}) {
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

    if (moveIntent.kind === "ok") {
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

    if (moveIntent.kind === "lock") {
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

function applyHardDropInput(authoritativeState, input, gameCore) {
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
    authoritativeState.lastActionWasRotation = false;
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
    const presentationEffect = clearedRows.length > 0
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
            gameOver,
            nextPiece,
        },
    };
}

function findFilledRows(board) {
    if (!Array.isArray(board)) return [];

    return board.reduce((filledRows, row, rowIndex) => {
        if (Array.isArray(row) && row.length > 0 && row.every(cell => cell !== null)) {
            filledRows.push(rowIndex);
        }
        return filledRows;
    }, []);
}

function cloneBoard(board) {
    return board.map(row => [...row]);
}

function applyPendingGarbageQueue(authoritativeState, gameCore) {
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
    authoritativeState.lastActionWasRotation = false;
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

function incrementCurrentTick(authoritativeState) {
    authoritativeState.currentTick = normalizeInteger(authoritativeState.currentTick) + 1;
}

module.exports = {
    applyAuthoritativeInput,
    applyAuthoritativeGravityStep,
};
