const BOARD_ROWS = 20;
const BOARD_COLS = 10;
const SPAWN_ROW = -1;
const SPAWN_COL = 3;
const NEXT_QUEUE_SIZE = 2;
const SERVER_QUEUE_BUFFER_SIZE = NEXT_QUEUE_SIZE + 1;
const DEFAULT_FALL_INTERVAL_MS = 500;
const BASIC_GARBAGE_ATTACK_BY_LINES = {
    2: 1,
    3: 2,
    4: 4,
};
const T_SPIN_GARBAGE_ATTACK_BY_LINES = {
    1: 2,
    2: 4,
    3: 6,
};

const GAME_PHASE = {
    PLAYING: "playing",
    LINE_CLEARING: "lineClearing",
    GAME_OVER: "gameOver",
};

const INPUT_ACTION = {
    MOVE_LEFT: "move_left",
    MOVE_RIGHT: "move_right",
    SOFT_DROP: "soft_drop",
    ROTATE: "rotate",
    HARD_DROP: "hard_drop",
    HOLD: "hold",
};

const WALL_KICKS = {
    normal: {
        "0->1": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
        "1->0": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
        "1->2": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
        "2->1": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
        "2->3": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
        "3->2": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
        "3->0": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
        "0->3": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    },
    bar: {
        "0->1": [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
        "1->0": [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
        "1->2": [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
        "2->1": [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
        "2->3": [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
        "3->2": [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
        "3->0": [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
        "0->3": [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
    },
};

const BLOCKS = {
    tree: [
        [[1, 0], [0, 1], [1, 1], [2, 1]],
        [[1, 0], [1, 1], [2, 1], [1, 2]],
        [[0, 1], [1, 1], [2, 1], [1, 2]],
        [[1, 0], [0, 1], [1, 1], [1, 2]],
    ],
    square: [
        [[0, 0], [1, 0], [0, 1], [1, 1]],
        [[0, 0], [1, 0], [0, 1], [1, 1]],
        [[0, 0], [1, 0], [0, 1], [1, 1]],
        [[0, 0], [1, 0], [0, 1], [1, 1]],
    ],
    bar: [
        [[0, 1], [1, 1], [2, 1], [3, 1]],
        [[2, 0], [2, 1], [2, 2], [2, 3]],
        [[0, 2], [1, 2], [2, 2], [3, 2]],
        [[1, 0], [1, 1], [1, 2], [1, 3]],
    ],
    zee: [
        [[0, 0], [1, 0], [1, 1], [2, 1]],
        [[2, 0], [1, 1], [2, 1], [1, 2]],
        [[0, 1], [1, 1], [1, 2], [2, 2]],
        [[1, 0], [0, 1], [1, 1], [0, 2]],
    ],
    eleft: [
        [[0, 0], [0, 1], [1, 1], [2, 1]],
        [[1, 0], [2, 0], [1, 1], [1, 2]],
        [[0, 1], [1, 1], [2, 1], [2, 2]],
        [[1, 0], [1, 1], [0, 2], [1, 2]],
    ],
    eright: [
        [[2, 0], [0, 1], [1, 1], [2, 1]],
        [[1, 0], [1, 1], [1, 2], [2, 2]],
        [[0, 1], [1, 1], [2, 1], [0, 2]],
        [[0, 0], [1, 0], [1, 1], [1, 2]],
    ],
    ess: [
        [[1, 0], [2, 0], [0, 1], [1, 1]],
        [[1, 0], [1, 1], [2, 1], [2, 2]],
        [[1, 1], [2, 1], [0, 2], [1, 2]],
        [[0, 0], [0, 1], [1, 1], [1, 2]],
    ],
};

function createInitialShadowState({ bagChunks = [] } = {}) {
    const state = {
        board: createEmptyBoard(),
        serverBagQueue: flattenBagChunks(bagChunks),
        pieceQueue: [],
        activePiece: createEmptyPiece(),
        holdPieceType: null,
        holdUsedThisDrop: false,
        score: 0,
        linesClearedTotal: 0,
        phase: GAME_PHASE.PLAYING,
        fallIntervalMs: DEFAULT_FALL_INTERVAL_MS,
        lastActionWasRotation: false,
        isTSpin: false,
        combo: -1,
        backToBack: false,
        pendingGarbageQueue: [],
        lastPlacementResult: null,
        pendingLockScoreBefore: null,
        tick: 0,
        lastClientInputTick: null,
        lastClientInputPieceIndex: null,
        pieceIndex: 0,
    };

    refillPieceQueue(state);
    startNextTurn(state);

    return cloneState(state);
}

function stepAuthoritativeState(state, step) {
    const nextState = cloneState(state);
    if (!step) return nextState;

    if (step.type === "garbage") {
        if (nextState.phase === GAME_PHASE.GAME_OVER) return nextState;
        queueGarbageLines(nextState, step);
        return nextState;
    }

    if (step.type === "line_clear_complete") {
        if (nextState.phase !== GAME_PHASE.LINE_CLEARING) return nextState;
        if (Number.isInteger(step.tick)) {
            nextState.tick = Math.max(nextState.tick, step.tick);
        }
        completeLineClear(nextState);
        return nextState;
    }

    if (step.type === "gravity") {
        if (nextState.phase === GAME_PHASE.LINE_CLEARING) {
            if (Number.isInteger(step.tick)) {
                nextState.tick = Math.max(nextState.tick, step.tick);
            }
            completeLineClear(nextState);
            return nextState;
        }

        if (nextState.phase !== GAME_PHASE.PLAYING) return nextState;

        if (Number.isInteger(step.tick)) {
            nextState.tick = Math.max(nextState.tick, step.tick);
        }
        moveOrLock(nextState, {
            ...nextState.activePiece,
            row: nextState.activePiece.row + 1,
        }, "fall");
        return nextState;
    }

    if (nextState.phase !== GAME_PHASE.PLAYING) return nextState;

    if (step.type !== "input") return nextState;
    if (Number.isInteger(step.pieceIndex) && step.pieceIndex !== nextState.pieceIndex) {
        return nextState;
    }

    nextState.lastClientInputTick = Number.isInteger(step.tick) ? step.tick : null;
    nextState.lastClientInputPieceIndex = Number.isInteger(step.pieceIndex) ? step.pieceIndex : null;
    applyInput(nextState, step.action);
    return nextState;
}

function applyInput(state, action) {
    if (action === INPUT_ACTION.MOVE_LEFT) {
        const moved = commitIfPlaceable(state, {
            ...state.activePiece,
            col: state.activePiece.col - 1,
        });
        if (moved) state.lastActionWasRotation = false;
        return;
    }

    if (action === INPUT_ACTION.MOVE_RIGHT) {
        const moved = commitIfPlaceable(state, {
            ...state.activePiece,
            col: state.activePiece.col + 1,
        });
        if (moved) state.lastActionWasRotation = false;
        return;
    }

    if (action === INPUT_ACTION.SOFT_DROP) {
        moveOrLock(state, {
            ...state.activePiece,
            row: state.activePiece.row + 1,
        }, "fall");
        return;
    }

    if (action === INPUT_ACTION.ROTATE) {
        const rotated = rotateWithWallKick(state);
        if (rotated) state.lastActionWasRotation = true;
        return;
    }

    if (action === INPUT_ACTION.HARD_DROP) {
        hardDrop(state);
        return;
    }

    if (action === INPUT_ACTION.HOLD) {
        holdPiece(state);
    }
}

function rotateWithWallKick(state) {
    const activePiece = state.activePiece;
    const nextRotation = (activePiece.rotation + 1) % 4;
    const pendingPiece = {
        ...activePiece,
        rotation: nextRotation,
    };

    if (activePiece.pieceType === "square") {
        return commitIfPlaceable(state, pendingPiece);
    }

    const kickType = activePiece.pieceType === "bar" ? "bar" : "normal";
    const key = `${activePiece.rotation}->${nextRotation}`;
    const tests = WALL_KICKS[kickType]?.[key] ?? [[0, 0]];

    for (const [offsetX, offsetY] of tests) {
        const testPiece = {
            ...pendingPiece,
            col: pendingPiece.col + offsetX,
            row: pendingPiece.row + offsetY,
        };

        if (commitIfPlaceable(state, testPiece)) {
            return true;
        }
    }

    return false;
}

function commitIfPlaceable(state, piece) {
    if (!canPlacePiece(state.board, piece)) return false;
    state.activePiece = clonePiece(piece);
    return true;
}

function moveOrLock(state, piece, moveCause = "") {
    if (commitIfPlaceable(state, piece)) {
        if (moveCause) state.lastActionWasRotation = moveCause === "rotate";
        return;
    }
    lockCurrentPiece(state);
}

function hardDrop(state) {
    const droppedPiece = clonePiece(state.activePiece);
    const startRow = droppedPiece.row;
    const scoreBefore = state.score;

    while (canPlacePiece(state.board, { ...droppedPiece, row: droppedPiece.row + 1 })) {
        droppedPiece.row++;
    }

    state.score += Math.max(0, droppedPiece.row - startRow) * 2;
    state.activePiece = droppedPiece;
    lockCurrentPiece(state, scoreBefore);
}

function queueGarbageLines(state, garbage) {
    const lines = Number.isInteger(garbage?.lines) && garbage.lines > 0
        ? garbage.lines
        : 0;
    if (lines === 0) return;

    state.pendingGarbageQueue.push({
        lines,
        holeCol: Number.isInteger(garbage.holeCol) ? garbage.holeCol : null,
    });
}

function holdPiece(state) {
    if (!state.activePiece?.pieceType || state.holdUsedThisDrop) return;

    const currentType = state.activePiece.pieceType;
    const nextType = state.holdPieceType || takeNextPieceType(state);
    if (!nextType) return;

    state.holdPieceType = currentType;
    state.holdUsedThisDrop = true;
    state.activePiece = createSpawnedPiece(nextType);
    state.lastActionWasRotation = false;

    if (!canPlacePiece(state.board, state.activePiece)) {
        state.phase = GAME_PHASE.GAME_OVER;
    }
}

function lockCurrentPiece(state, scoreBefore = state.score) {
    const piece = state.activePiece;
    if (!piece?.pieceType) return;

    const touchesAboveTop = getPieceCells(piece).some(([row]) => row < 0);
    const isTSpin = isTSpinLock(state.board, piece, state.lastActionWasRotation);
    state.isTSpin = isTSpin;
    lockPieceOnBoard(state.board, piece);
    state.activePiece = createEmptyPiece();

    if (touchesAboveTop) {
        state.phase = GAME_PHASE.GAME_OVER;
        return;
    }

    if (hasFilledLines(state.board)) {
        state.pendingLockScoreBefore = scoreBefore;
        state.phase = GAME_PHASE.LINE_CLEARING;
        return;
    }

    if (isTSpin) {
        state.score += 15;
    }

    const attackState = updateAttackState(state, { linesCleared: 0, isTSpin });
    const rawAttackLines = calculateGarbageAttack(attackState);
    const garbageResolution = resolveGarbageCancel(state, rawAttackLines);
    state.isTSpin = false;
    const pendingGarbageResult = applyPendingGarbageQueue(state);
    state.lastPlacementResult = createPlacementResult({
        linesCleared: 0,
        scoreBefore,
        scoreAfter: state.score,
        attackState,
        rawAttackLines,
        garbageResolution,
        pendingGarbageResult,
    });
    state.pendingLockScoreBefore = null;
    if (pendingGarbageResult.overflow) {
        state.lastPlacementResult.gameOver = true;
        state.phase = GAME_PHASE.GAME_OVER;
        return;
    }

    startNextTurn(state);
}

function completeLineClear(state) {
    const scoreBefore = Number.isFinite(state.pendingLockScoreBefore)
        ? state.pendingLockScoreBefore
        : state.score;
    const clearedLines = clearFilledLines(state.board);
    const isTSpin = state.isTSpin;

    if (clearedLines > 0) {
        let points = clearedLines * 10;
        if (isTSpin) points *= 5;
        state.score += points;
        state.linesClearedTotal += clearedLines;
    } else if (isTSpin) {
        state.score += 15;
    }

    const attackState = updateAttackState(state, { linesCleared: clearedLines, isTSpin });
    const rawAttackLines = calculateGarbageAttack(attackState);
    const garbageResolution = resolveGarbageCancel(state, rawAttackLines);
    state.isTSpin = false;
    const pendingGarbageResult = applyPendingGarbageQueue(state);
    state.lastPlacementResult = createPlacementResult({
        linesCleared: clearedLines,
        scoreBefore,
        scoreAfter: state.score,
        attackState,
        rawAttackLines,
        garbageResolution,
        pendingGarbageResult,
    });
    state.pendingLockScoreBefore = null;
    if (pendingGarbageResult.overflow) {
        state.lastPlacementResult.gameOver = true;
        state.phase = GAME_PHASE.GAME_OVER;
        return;
    }

    state.phase = GAME_PHASE.PLAYING;
    startNextTurn(state);
}

function hasFilledLines(board) {
    return board.some(row => row.every(cell => cell !== null));
}

function startNextTurn(state) {
    const pieceType = takeNextPieceType(state);
    if (!pieceType) {
        state.phase = GAME_PHASE.GAME_OVER;
        state.activePiece = createEmptyPiece();
        return;
    }

    state.pieceIndex++;
    state.activePiece = createSpawnedPiece(pieceType);
    state.holdUsedThisDrop = false;
    state.lastActionWasRotation = false;

    if (!canPlacePiece(state.board, state.activePiece)) {
        state.phase = GAME_PHASE.GAME_OVER;
    }
}

function takeNextPieceType(state) {
    refillPieceQueue(state);
    const nextType = state.pieceQueue.shift();
    refillPieceQueue(state);
    return nextType;
}

function refillPieceQueue(state) {
    while (state.pieceQueue.length < SERVER_QUEUE_BUFFER_SIZE && state.serverBagQueue.length > 0) {
        state.pieceQueue.push(state.serverBagQueue.shift());
    }
}

function canPlacePiece(board, piece) {
    if (!piece?.pieceType || !BLOCKS[piece.pieceType]) return false;

    return getPieceCells(piece).every(([row, col]) => {
        if (col < 0 || col >= BOARD_COLS || row >= BOARD_ROWS) return false;
        if (row < 0) return true;
        return board[row][col] === null;
    });
}

function lockPieceOnBoard(board, piece) {
    getPieceCells(piece).forEach(([row, col]) => {
        if (row < 0 || row >= BOARD_ROWS || col < 0 || col >= BOARD_COLS) return;
        board[row][col] = piece.pieceType;
    });
}

function clearFilledLines(board) {
    let cleared = 0;

    for (let row = board.length - 1; row >= 0; row--) {
        if (!board[row].every(cell => cell !== null)) continue;
        board.splice(row, 1);
        board.unshift(Array(BOARD_COLS).fill(null));
        cleared++;
        row++;
    }

    return cleared;
}

function applyPendingGarbageQueue(state) {
    let appliedLines = 0;
    let overflow = false;

    while (state.pendingGarbageQueue.length > 0) {
        const garbage = state.pendingGarbageQueue.shift();
        const result = applyGarbageLines(state.board, garbage);

        appliedLines += result.appliedLines;
        overflow = overflow || result.overflow;
    }

    return {
        appliedLines,
        overflow,
    };
}

function applyGarbageLines(board, garbage = {}) {
    const lines = Number.isInteger(garbage.lines) && garbage.lines > 0
        ? garbage.lines
        : 0;
    const holeCol = Number.isInteger(garbage.holeCol) && garbage.holeCol >= 0 && garbage.holeCol < BOARD_COLS
        ? garbage.holeCol
        : Math.floor(BOARD_COLS / 2);
    let appliedLines = 0;
    let overflow = false;

    for (let i = 0; i < lines; i++) {
        const removedRow = board.shift();
        if (removedRow?.some(cell => cell !== null)) {
            overflow = true;
        }

        board.push(createGarbageLine(holeCol));
        appliedLines++;
    }

    return {
        appliedLines,
        overflow,
    };
}

function createGarbageLine(holeCol) {
    return Array.from({ length: BOARD_COLS }, (_, col) => {
        return col === holeCol ? null : "garbage";
    });
}

function resolveGarbageCancel(state, rawAttackLines) {
    let remainingAttackLines = Number.isInteger(rawAttackLines) && rawAttackLines > 0
        ? rawAttackLines
        : 0;
    const incomingGarbageLines = getPendingGarbageLines(state.pendingGarbageQueue);
    let canceledGarbageLines = 0;

    while (remainingAttackLines > 0 && state.pendingGarbageQueue.length > 0) {
        const nextGarbage = state.pendingGarbageQueue[0];
        const cancelLines = Math.min(remainingAttackLines, nextGarbage.lines);

        nextGarbage.lines -= cancelLines;
        remainingAttackLines -= cancelLines;
        canceledGarbageLines += cancelLines;

        if (nextGarbage.lines === 0) {
            state.pendingGarbageQueue.shift();
        }
    }

    return {
        incomingGarbageLines,
        canceledGarbageLines,
        attackLines: remainingAttackLines,
    };
}

function createPlacementResult({
    linesCleared,
    scoreBefore,
    scoreAfter,
    attackState,
    rawAttackLines,
    garbageResolution,
    pendingGarbageResult,
}) {
    return {
        linesCleared,
        isTSpin: Boolean(attackState?.isTSpin),
        combo: Number.isInteger(attackState?.combo) ? attackState.combo : 0,
        backToBack: Boolean(attackState?.backToBack),
        rawAttackLines,
        attackLines: garbageResolution.attackLines,
        canceledGarbageLines: garbageResolution.canceledGarbageLines,
        incomingGarbageLines: garbageResolution.incomingGarbageLines,
        appliedGarbageLines: pendingGarbageResult.appliedLines,
        scoreBefore,
        scoreAfter,
        scoreDelta: scoreAfter - scoreBefore,
        gameOver: Boolean(pendingGarbageResult.overflow),
    };
}

function getPendingGarbageLines(pendingGarbageQueue) {
    if (!Array.isArray(pendingGarbageQueue)) return 0;

    return pendingGarbageQueue.reduce((total, garbage) => {
        return total + (Number.isInteger(garbage?.lines) && garbage.lines > 0 ? garbage.lines : 0);
    }, 0);
}

function updateAttackState(state, { linesCleared, isTSpin }) {
    const combo = updateCombo(state, linesCleared);
    const backToBack = state.backToBack;
    const eligibleForNextBackToBack = isBackToBackEligible({ linesCleared, isTSpin });

    if (linesCleared > 0) {
        state.backToBack = eligibleForNextBackToBack;
    }

    return {
        linesCleared,
        isTSpin,
        combo,
        backToBack,
    };
}

function updateCombo(state, linesCleared) {
    if (linesCleared > 0) {
        state.combo++;
        return state.combo;
    }

    state.combo = -1;
    return 0;
}

function calculateGarbageAttack({ linesCleared, isTSpin = false, combo = 0, backToBack = false } = {}) {
    if (!Number.isInteger(linesCleared) || linesCleared <= 0) return 0;

    const baseAttack = isTSpin
        ? T_SPIN_GARBAGE_ATTACK_BY_LINES[linesCleared] ?? 0
        : BASIC_GARBAGE_ATTACK_BY_LINES[linesCleared] ?? 0;
    const backToBackBonus = backToBack && isBackToBackEligible({ linesCleared, isTSpin })
        ? 1
        : 0;

    return baseAttack + getComboBonus(combo) + backToBackBonus;
}

function isBackToBackEligible({ linesCleared, isTSpin = false } = {}) {
    return linesCleared === 4 || (isTSpin && linesCleared > 0);
}

function getComboBonus(combo) {
    if (!Number.isInteger(combo) || combo <= 0) return 0;
    if (combo <= 2) return 1;
    if (combo <= 4) return 2;
    return 3;
}

function getPieceCells(piece) {
    return BLOCKS[piece.pieceType][piece.rotation].map(([offsetX, offsetY]) => {
        return [piece.row + offsetY, piece.col + offsetX];
    });
}

function isTSpinLock(board, piece, lastActionWasRotation) {
    if (!piece || piece.pieceType !== "tree") return false;
    if (!lastActionWasRotation) return false;

    const centerCol = piece.col + 1;
    const centerRow = piece.row + 1;
    const corners = [
        [centerCol - 1, centerRow - 1],
        [centerCol + 1, centerRow - 1],
        [centerCol - 1, centerRow + 1],
        [centerCol + 1, centerRow + 1],
    ];

    let filledCorners = 0;
    for (const [col, row] of corners) {
        if (col < 0 || col >= BOARD_COLS || row >= BOARD_ROWS || (row >= 0 && board[row][col])) {
            filledCorners++;
        }
    }

    return filledCorners >= 3;
}

function createEmptyBoard() {
    return Array.from({ length: BOARD_ROWS }, () => Array(BOARD_COLS).fill(null));
}

function createSpawnedPiece(pieceType) {
    return {
        pieceType,
        rotation: 0,
        row: SPAWN_ROW,
        col: SPAWN_COL,
    };
}

function createEmptyPiece() {
    return {
        pieceType: "",
        rotation: 0,
        row: SPAWN_ROW,
        col: SPAWN_COL,
    };
}

function flattenBagChunks(bagChunks) {
    if (!Array.isArray(bagChunks)) return [];
    return bagChunks.flatMap(chunk => Array.isArray(chunk) ? [...chunk] : []);
}

function clonePiece(piece) {
    return {
        pieceType: piece.pieceType,
        rotation: piece.rotation,
        row: piece.row,
        col: piece.col,
    };
}

function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
}

function createShadowSnapshot(state) {
    return {
        board: cloneState(state.board),
        activePiece: clonePiece(state.activePiece),
        pieceQueue: [...state.pieceQueue],
        holdPieceType: state.holdPieceType,
        holdUsedThisDrop: state.holdUsedThisDrop,
        score: state.score,
        linesClearedTotal: state.linesClearedTotal,
        phase: state.phase,
        fallIntervalMs: state.fallIntervalMs,
        lastActionWasRotation: state.lastActionWasRotation,
        isTSpin: state.isTSpin,
        combo: state.combo,
        backToBack: state.backToBack,
        pendingGarbageQueue: cloneState(state.pendingGarbageQueue),
        lastPlacementResult: cloneState(state.lastPlacementResult),
        pendingLockScoreBefore: state.pendingLockScoreBefore,
        tick: state.tick,
        lastClientInputTick: state.lastClientInputTick,
        lastClientInputPieceIndex: state.lastClientInputPieceIndex,
        pieceIndex: state.pieceIndex,
    };
}

module.exports = {
    createInitialShadowState,
    createShadowSnapshot,
    stepAuthoritativeState,
};
