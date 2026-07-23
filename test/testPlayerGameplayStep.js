/**
 * 서버가 input 또는 gravity 한 단계를 authoritative player state에 적용하는 테스트다.
 *
 * `createPlayerState`로 필요한 상태를 준비하고 action을 실행한 뒤 board·score·attack·다음 조각을 함께 검증한다.
 * 이 함수는 원본 state를 제자리에서 바꾸므로 반환값뿐 아니라 변경된 state가 기존 core 규칙과 일치해야 한다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { loadGameCore } = require("../dist/server/server/services/gameCoreLoader.js");
const playerGameplayStep = require(
    "../dist/server/server/services/playerGameplayStep.js"
);
const {
    applyAuthoritativeInput,
    applyAuthoritativeGravityStep,
} = playerGameplayStep;

function createPlayerState(gameCore, overrides = {}) {
    const activePiece = overrides.activePiece ?? {
        pieceType: "square",
        rotation: 0,
        row: gameCore.SPAWN_POSITION.row,
        col: gameCore.SPAWN_POSITION.col,
    };
    const hasPendingPieceOverride = Object.hasOwn(overrides, "pendingPiece");
    const pendingPiece = hasPendingPieceOverride
        ? overrides.pendingPiece
        : { ...activePiece };

    return {
        board: overrides.board ?? gameCore.createEmptyBoard(
            gameCore.BOARD_ROWS,
            gameCore.BOARD_COLS,
        ),
        activePiece,
        pendingPiece,
        pieceQueue: [...(overrides.pieceQueue ?? ["tree"])],
        holdPieceType: overrides.holdPieceType ?? null,
        holdUsedThisDrop: overrides.holdUsedThisDrop ?? false,
        score: overrides.score ?? 0,
        lines: overrides.lines ?? 0,
        phase: overrides.phase ?? "playing",
        combo: overrides.combo ?? -1,
        backToBack: overrides.backToBack ?? false,
        currentTick: 0,
        pieceIndex: overrides.pieceIndex ?? 1,
        pendingGarbageQueue: [...(overrides.pendingGarbageQueue ?? [])],
        lastActionWasRotation: overrides.lastActionWasRotation ?? false,
    };
}

function createLineClearBoard(gameCore, piece, rowsToClear, extraFilledCells = []) {
    const board = gameCore.createEmptyBoard(gameCore.BOARD_ROWS, gameCore.BOARD_COLS);
    const pieceCells = new Set(gameCore.BLOCKS[piece.pieceType][piece.rotation].map(([offsetX, offsetY]) => {
        return `${piece.row + offsetY}:${piece.col + offsetX}`;
    }));

    rowsToClear.forEach((row) => {
        board[row] = Array(gameCore.BOARD_COLS).fill("stack");
    });
    pieceCells.forEach((cellKey) => {
        const [row, col] = cellKey.split(":").map(Number);
        if (rowsToClear.includes(row)) {
            board[row][col] = null;
        }
    });
    extraFilledCells.forEach(([row, col]) => {
        board[row][col] = "stack";
    });

    return board;
}

test("playerGameplayStep는 legacy placement public API를 노출하지 않는다", () => {
    const legacyExport = ["apply", "Authoritative", "Placement"].join("");

    assert.equal(Object.hasOwn(playerGameplayStep, legacyExport), false);
});

test("applyAuthoritativeGravityStep은 조각을 아래로 1칸 내리고 currentTick을 증가시킨다", async () => {
    const gameCore = await loadGameCore();
    const activePiece = {
        pieceType: "square",
        rotation: 0,
        row: 0,
        col: 3,
    };
    const playerState = createPlayerState(gameCore, {
        activePiece,
        pendingPiece: { ...activePiece },
    });

    const result = applyAuthoritativeGravityStep(playerState, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.gravityResult.kind, "move");
    assert.deepEqual(playerState.activePiece, {
        pieceType: "square",
        rotation: 0,
        row: 1,
        col: 3,
    });
    assert.deepEqual(playerState.pendingPiece, playerState.activePiece);
    assert.equal(playerState.currentTick, 1);
    assert.equal(playerState.pieceIndex, 1);
});

test("applyAuthoritativeGravityStep은 첫 blocked gravity에서 state를 변경하지 않고 grounded를 반환한다", async () => {
    const gameCore = await loadGameCore();
    const activePiece = {
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 3,
    };
    const playerState = createPlayerState(gameCore, {
        activePiece,
        pendingPiece: { ...activePiece },
        pieceQueue: ["tree"],
        pieceIndex: 1,
    });
    const beforeState = structuredClone(playerState);

    const result = applyAuthoritativeGravityStep(playerState, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.gravityResult.kind, "grounded");
    assert.deepEqual(playerState, beforeState);
    assert.equal(result.placementResult, undefined);
});

test("applyAuthoritativeGravityStep은 같은 piece의 다음 blocked gravity에서 lock한다", async () => {
    const gameCore = await loadGameCore();
    const activePiece = {
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 3,
    };
    const playerState = createPlayerState(gameCore, {
        activePiece,
        pendingPiece: { ...activePiece },
        pieceQueue: ["tree"],
        pieceIndex: 1,
    });

    const result = applyAuthoritativeGravityStep(playerState, gameCore, {
        lockGroundedPiece: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.gravityResult.kind, "lock");
    assert.equal(result.placementResult.lockedPiece.pieceType, "square");
    assert.equal(result.placementResult.droppedRows, 0);
    assert.equal(playerState.currentTick, 1);
    assert.equal(playerState.board[18][3], "square");
    assert.equal(playerState.board[18][4], "square");
    assert.equal(playerState.board[19][3], "square");
    assert.equal(playerState.board[19][4], "square");
    assert.deepEqual(playerState.activePiece, {
        pieceType: "tree",
        rotation: 0,
        row: -1,
        col: 3,
    });
    assert.equal(playerState.pieceIndex, 2);
});

test("applyAuthoritativeGravityStep은 gravity lock의 line clear와 score를 기존 lock 흐름으로 처리한다", async () => {
    const gameCore = await loadGameCore();
    const activePiece = {
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 3,
    };
    const board = gameCore.createEmptyBoard(gameCore.BOARD_ROWS, gameCore.BOARD_COLS);
    board[19] = Array(gameCore.BOARD_COLS).fill("stack");
    board[19][3] = null;
    board[19][4] = null;
    const playerState = createPlayerState(gameCore, {
        board,
        activePiece,
        pendingPiece: { ...activePiece },
        pieceQueue: ["tree"],
        pieceIndex: 1,
    });

    const result = applyAuthoritativeGravityStep(playerState, gameCore, {
        lockGroundedPiece: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.gravityResult.kind, "lock");
    assert.equal(result.placementResult.linesCleared, 1);
    assert.equal(result.placementResult.rawAttackLines, 0);
    assert.equal(result.placementResult.attackLines, 0);
    assert.equal(result.placementResult.scoreBefore, 0);
    assert.equal(result.placementResult.scoreAfter, 10);
    assert.equal(result.placementResult.scoreDelta, 10);
    assert.equal(playerState.lines, 1);
    assert.equal(playerState.score, 10);
    assert.equal(playerState.currentTick, 1);
});

test("applyAuthoritativeGravityStep은 phase가 playing이 아니면 state를 변경하지 않는다", async () => {
    const gameCore = await loadGameCore();
    const playerState = createPlayerState(gameCore, {
        phase: "gameOver",
    });
    const beforeState = structuredClone(playerState);

    const result = applyAuthoritativeGravityStep(playerState, gameCore);

    assert.deepEqual(result, {
        ok: false,
        reason: "GAME_NOT_PLAYING",
        gravityResult: {
            kind: "skipped",
        },
    });
    assert.deepEqual(playerState, beforeState);
});

test("applyAuthoritativeGravityStep은 activePiece가 없으면 state를 변경하지 않는다", async () => {
    const gameCore = await loadGameCore();
    const playerState = createPlayerState(gameCore, {
        activePiece: {
            pieceType: "",
            rotation: 0,
            row: -1,
            col: 3,
        },
        pendingPiece: null,
    });
    const beforeState = structuredClone(playerState);

    const result = applyAuthoritativeGravityStep(playerState, gameCore);

    assert.deepEqual(result, {
        ok: false,
        reason: "INVALID_PLAYER_STATE",
    });
    assert.deepEqual(playerState, beforeState);
});

test("applyAuthoritativeInput은 hard_drop line clear 후 board, lines, score를 갱신한다", async () => {
    const gameCore = await loadGameCore();
    const board = gameCore.createEmptyBoard(gameCore.BOARD_ROWS, gameCore.BOARD_COLS);
    board[19] = Array(gameCore.BOARD_COLS).fill("bar");
    board[19][3] = null;
    board[19][4] = null;
    const playerState = createPlayerState(gameCore, { board });

    const result = applyAuthoritativeInput(playerState, {
        action: "hard_drop",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.placementResult.linesCleared, 1);
    assert.equal(result.placementResult.rawAttackLines, 0);
    assert.equal(result.placementResult.attackLines, 0);
    assert.equal(result.placementResult.gameOver, false);
    assert.equal(playerState.lines, 1);
    assert.equal(playerState.score, 48);
    assert.deepEqual(playerState.board[19], [
        null,
        null,
        null,
        "square",
        "square",
        null,
        null,
        null,
        null,
        null,
    ]);
});

test("applyAuthoritativeInput은 hard_drop Tetris의 attack scalar와 backToBack 상태를 갱신한다", async () => {
    const gameCore = await loadGameCore();
    const activePiece = {
        pieceType: "bar",
        rotation: 1,
        row: 0,
        col: 3,
    };
    const lockedPiece = {
        ...activePiece,
        row: 16,
    };
    const playerState = createPlayerState(gameCore, {
        board: createLineClearBoard(gameCore, lockedPiece, [16, 17, 18, 19]),
        activePiece,
        pendingPiece: { ...activePiece },
        pieceQueue: ["square"],
    });

    const result = applyAuthoritativeInput(playerState, {
        action: "hard_drop",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.placementResult.linesCleared, 4);
    assert.equal(result.placementResult.combo, 0);
    assert.equal(result.placementResult.backToBack, false);
    assert.equal(result.placementResult.rawAttackLines, 4);
    assert.equal(result.placementResult.attackLines, 4);
    assert.equal(result.placementResult.canceledGarbageLines, 0);
    assert.equal(result.placementResult.incomingGarbageLines, 0);
    assert.equal(result.placementResult.appliedGarbageLines, 0);
    assert.equal(result.placementResult.gameOver, false);
    assert.equal(playerState.combo, 0);
    assert.equal(playerState.backToBack, true);
});

test("applyAuthoritativeInput은 back-to-back Tetris bonus를 rawAttackLines에 반영한다", async () => {
    const gameCore = await loadGameCore();
    const activePiece = {
        pieceType: "bar",
        rotation: 1,
        row: 0,
        col: 3,
    };
    const lockedPiece = {
        ...activePiece,
        row: 16,
    };
    const playerState = createPlayerState(gameCore, {
        board: createLineClearBoard(gameCore, lockedPiece, [16, 17, 18, 19]),
        activePiece,
        pendingPiece: { ...activePiece },
        pieceQueue: ["square"],
        backToBack: true,
    });

    const result = applyAuthoritativeInput(playerState, {
        action: "hard_drop",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.placementResult.backToBack, true);
    assert.equal(result.placementResult.rawAttackLines, 5);
    assert.equal(result.placementResult.attackLines, 5);
    assert.equal(playerState.backToBack, true);
});

test("applyAuthoritativeInput은 일반 line clear 후 backToBack을 reset한다", async () => {
    const gameCore = await loadGameCore();
    const activePiece = {
        pieceType: "square",
        rotation: 0,
        row: -1,
        col: 3,
    };
    const lockedPiece = {
        ...activePiece,
        row: 18,
    };
    const playerState = createPlayerState(gameCore, {
        board: createLineClearBoard(gameCore, lockedPiece, [18, 19]),
        activePiece,
        pendingPiece: { ...activePiece },
        pieceQueue: ["tree"],
        backToBack: true,
    });

    const result = applyAuthoritativeInput(playerState, {
        action: "hard_drop",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.placementResult.linesCleared, 2);
    assert.equal(result.placementResult.backToBack, true);
    assert.equal(result.placementResult.rawAttackLines, 1);
    assert.equal(playerState.backToBack, false);
});

test("applyAuthoritativeInput은 combo 2번째 clear bonus를 rawAttackLines에 반영한다", async () => {
    const gameCore = await loadGameCore();
    const activePiece = {
        pieceType: "square",
        rotation: 0,
        row: -1,
        col: 3,
    };
    const lockedPiece = {
        ...activePiece,
        row: 18,
    };
    const playerState = createPlayerState(gameCore, {
        board: createLineClearBoard(gameCore, lockedPiece, [18, 19]),
        activePiece,
        pendingPiece: { ...activePiece },
        pieceQueue: ["tree"],
        combo: 0,
    });

    const result = applyAuthoritativeInput(playerState, {
        action: "hard_drop",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.placementResult.combo, 1);
    assert.equal(result.placementResult.rawAttackLines, 2);
    assert.equal(result.placementResult.attackLines, 2);
    assert.equal(playerState.combo, 1);
});

test("applyAuthoritativeInput은 pendingGarbageQueue를 attackLines로 먼저 cancel한다", async () => {
    const gameCore = await loadGameCore();
    const activePiece = {
        pieceType: "bar",
        rotation: 1,
        row: 0,
        col: 3,
    };
    const lockedPiece = {
        ...activePiece,
        row: 16,
    };
    const playerState = createPlayerState(gameCore, {
        board: createLineClearBoard(gameCore, lockedPiece, [16, 17, 18, 19]),
        activePiece,
        pendingPiece: { ...activePiece },
        pieceQueue: ["square"],
        pendingGarbageQueue: [{ lines: 2, holeCol: 0 }],
    });

    const result = applyAuthoritativeInput(playerState, {
        action: "hard_drop",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.placementResult.rawAttackLines, 4);
    assert.equal(result.placementResult.canceledGarbageLines, 2);
    assert.equal(result.placementResult.attackLines, 2);
    assert.equal(result.placementResult.incomingGarbageLines, 2);
    assert.equal(result.placementResult.appliedGarbageLines, 0);
    assert.deepEqual(playerState.pendingGarbageQueue, []);
});

test("applyAuthoritativeInput은 attack이 없으면 pendingGarbageQueue를 board에 적용한다", async () => {
    const gameCore = await loadGameCore();
    const activePiece = {
        pieceType: "square",
        rotation: 0,
        row: -1,
        col: 3,
    };
    const lockedPiece = {
        ...activePiece,
        row: 18,
    };
    const playerState = createPlayerState(gameCore, {
        board: createLineClearBoard(gameCore, lockedPiece, [19]),
        activePiece,
        pendingPiece: { ...activePiece },
        pieceQueue: ["tree"],
        pendingGarbageQueue: [{ lines: 2, holeCol: 0 }],
    });

    const result = applyAuthoritativeInput(playerState, {
        action: "hard_drop",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.placementResult.linesCleared, 1);
    assert.equal(result.placementResult.rawAttackLines, 0);
    assert.equal(result.placementResult.attackLines, 0);
    assert.equal(result.placementResult.canceledGarbageLines, 0);
    assert.equal(result.placementResult.incomingGarbageLines, 2);
    assert.equal(result.placementResult.appliedGarbageLines, 2);
    assert.deepEqual(playerState.pendingGarbageQueue, []);
    assert.equal(playerState.board[18][0], null);
    assert.equal(playerState.board[18][1], "garbage");
    assert.equal(playerState.board[19][0], null);
    assert.equal(playerState.board[19][1], "garbage");
});

test("applyAuthoritativeInput은 garbage 적용 후 막힌 spawn도 block-out 처리한다", async () => {
    const gameCore = await loadGameCore();
    const board = gameCore.createEmptyBoard(gameCore.BOARD_ROWS, gameCore.BOARD_COLS);
    board[1][3] = "stack";
    const activePiece = {
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 3,
    };
    const playerState = createPlayerState(gameCore, {
        board,
        activePiece,
        pendingPiece: { ...activePiece },
        pieceQueue: ["bar"],
        pendingGarbageQueue: [{ lines: 1, holeCol: 0 }],
    });

    const result = applyAuthoritativeInput(playerState, {
        action: "hard_drop",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.placementResult.appliedGarbageLines, 1);
    assert.equal(result.placementResult.gameOver, true);
    assert.equal(result.placementResult.gameOverReason, "block_out");
    assert.equal(playerState.board[0][3], "stack");
    assert.equal(playerState.activePiece.pieceType, "");
});

test("applyAuthoritativeInput은 T-Spin Single placementResult scalar를 반영한다", async () => {
    const gameCore = await loadGameCore();
    const activePiece = {
        pieceType: "tree",
        rotation: 0,
        row: 17,
        col: 3,
    };
    const playerState = createPlayerState(gameCore, {
        board: createLineClearBoard(gameCore, activePiece, [18], [
            [17, 3],
            [17, 5],
            [19, 3],
        ]),
        activePiece,
        pendingPiece: { ...activePiece },
        pieceQueue: ["square"],
        lastActionWasRotation: true,
    });

    const result = applyAuthoritativeInput(playerState, {
        action: "soft_drop",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.placementResult.linesCleared, 1);
    assert.equal(result.placementResult.isTSpin, true);
    assert.equal(result.placementResult.rawAttackLines, 2);
    assert.equal(result.placementResult.attackLines, 2);
    assert.equal(result.placementResult.scoreDelta, 50);
    assert.equal(playerState.backToBack, true);
});

test("applyAuthoritativeInput은 top-out lock에서 line clear와 attack을 만들지 않는다", async () => {
    const gameCore = await loadGameCore();
    const activePiece = {
        pieceType: "square",
        rotation: 0,
        row: -2,
        col: 3,
    };
    const playerState = createPlayerState(gameCore, {
        board: createLineClearBoard(gameCore, activePiece, [0]),
        activePiece,
        pendingPiece: { ...activePiece },
        pieceQueue: ["tree"],
        score: 100,
        combo: 2,
        backToBack: true,
    });

    const result = applyAuthoritativeInput(playerState, {
        action: "soft_drop",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.placementResult.linesCleared, 0);
    assert.equal(result.placementResult.rawAttackLines, 0);
    assert.equal(result.placementResult.attackLines, 0);
    assert.equal(result.placementResult.scoreBefore, 100);
    assert.equal(result.placementResult.scoreAfter, 100);
    assert.equal(result.placementResult.scoreDelta, 0);
    assert.equal(result.placementResult.combo, 0);
    assert.equal(result.placementResult.backToBack, true);
    assert.equal(result.placementResult.gameOver, true);
    assert.equal(result.placementResult.nextPiece, null);
    assert.equal(playerState.lines, 0);
    assert.equal(playerState.score, 100);
    assert.equal(playerState.combo, -1);
    assert.equal(playerState.backToBack, true);
    assert.equal(playerState.phase, "gameOver");
});

test("applyAuthoritativeInput은 move_left를 처리한다", async () => {
    const gameCore = await loadGameCore();
    const playerState = createPlayerState(gameCore, {
        activePiece: {
            pieceType: "tree",
            rotation: 0,
            row: 0,
            col: 4,
        },
    });

    const result = applyAuthoritativeInput(playerState, {
        action: "move_left",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.moveIntent.kind, "ok");
    assert.deepEqual(playerState.activePiece, {
        pieceType: "tree",
        rotation: 0,
        row: 0,
        col: 3,
    });
});

test("applyAuthoritativeInput은 move_right를 처리한다", async () => {
    const gameCore = await loadGameCore();
    const playerState = createPlayerState(gameCore, {
        activePiece: {
            pieceType: "tree",
            rotation: 0,
            row: 0,
            col: 4,
        },
    });

    const result = applyAuthoritativeInput(playerState, {
        action: "move_right",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.moveIntent.kind, "ok");
    assert.deepEqual(playerState.activePiece, {
        pieceType: "tree",
        rotation: 0,
        row: 0,
        col: 5,
    });
});

test("applyAuthoritativeInput은 rotate를 처리한다", async () => {
    const gameCore = await loadGameCore();
    const activePiece = {
        pieceType: "tree",
        rotation: 0,
        row: 0,
        col: 4,
    };
    const playerState = createPlayerState(gameCore, {
        activePiece,
        pendingPiece: { ...activePiece },
    });

    const result = applyAuthoritativeInput(playerState, {
        action: "rotate",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.moveIntent.kind, "ok");
    assert.deepEqual(playerState.activePiece, {
        pieceType: "tree",
        rotation: 1,
        row: 0,
        col: 4,
    });
});

test("applyAuthoritativeInput은 hard_drop으로 lock, score, next spawn을 처리한다", async () => {
    const gameCore = await loadGameCore();
    const playerState = createPlayerState(gameCore);

    const result = applyAuthoritativeInput(playerState, {
        action: "hard_drop",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.placementResult.lockedPiece.pieceType, "square");
    assert.equal(result.placementResult.droppedRows, 19);
    assert.equal(playerState.score, 38);
    assert.equal(playerState.board[18][3], "square");
    assert.equal(playerState.board[18][4], "square");
    assert.equal(playerState.board[19][3], "square");
    assert.equal(playerState.board[19][4], "square");
    assert.deepEqual(playerState.activePiece, {
        pieceType: "tree",
        rotation: 0,
        row: -1,
        col: 3,
    });
    assert.deepEqual(playerState.pendingPiece, playerState.activePiece);
    assert.deepEqual(playerState.pieceQueue, []);
    assert.equal(playerState.pieceIndex, 2);
});

test("applyAuthoritativeInput은 막힌 next spawn에서 즉시 block-out 처리한다", async () => {
    const gameCore = await loadGameCore();
    const board = gameCore.createEmptyBoard(gameCore.BOARD_ROWS, gameCore.BOARD_COLS);
    board[0][3] = "stack";
    const activePiece = {
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 3,
    };
    const playerState = createPlayerState(gameCore, {
        board,
        activePiece,
        pendingPiece: { ...activePiece },
        pieceQueue: ["bar"],
        pieceIndex: 1,
    });

    const result = applyAuthoritativeInput(playerState, {
        action: "hard_drop",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.placementResult.gameOver, true);
    assert.equal(result.placementResult.gameOverReason, "block_out");
    assert.equal(result.placementResult.nextPiece, null);
    assert.equal(playerState.phase, "gameOver");
    assert.equal(playerState.gameOver, true);
    assert.equal(playerState.activePiece.pieceType, "");
    assert.equal(playerState.pendingPiece, null);
    assert.equal(playerState.pieceIndex, 2);
    assert.deepEqual(playerState.pieceQueue, []);
});

test("applyAuthoritativeInput은 hard_drop 후 next spawn에서 lastActionWasRotation을 reset한다", async () => {
    const gameCore = await loadGameCore();
    const playerState = createPlayerState(gameCore, {
        pieceQueue: ["tree"],
        lastActionWasRotation: true,
    });

    const result = applyAuthoritativeInput(playerState, {
        action: "hard_drop",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.placementResult.nextPiece.pieceType, "tree");
    assert.equal(playerState.lastActionWasRotation, false);
});

test("applyAuthoritativeInput은 activePiece가 비어 있는 hard_drop에서 pieceQueue를 소비하지 않는다", async () => {
    const gameCore = await loadGameCore();
    const playerState = createPlayerState(gameCore, {
        activePiece: {
            pieceType: "",
            rotation: 0,
            row: -1,
            col: 3,
        },
        pendingPiece: null,
        pieceQueue: ["square", "tree"],
        pieceIndex: 0,
    });
    const beforeState = structuredClone(playerState);

    const result = applyAuthoritativeInput(playerState, {
        action: "hard_drop",
    }, gameCore);

    assert.deepEqual(result, {
        ok: false,
        reason: "INVALID_PLAYER_STATE",
    });
    assert.deepEqual(playerState, beforeState);
});

test("applyAuthoritativeInput은 soft_drop 이동 성공을 처리한다", async () => {
    const gameCore = await loadGameCore();
    const activePiece = {
        pieceType: "square",
        rotation: 0,
        row: 0,
        col: 3,
    };
    const playerState = createPlayerState(gameCore, {
        activePiece,
        pendingPiece: { ...activePiece },
    });

    const result = applyAuthoritativeInput(playerState, {
        action: "soft_drop",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.moveIntent.kind, "ok");
    assert.deepEqual(playerState.activePiece, {
        pieceType: "square",
        rotation: 0,
        row: 1,
        col: 3,
    });
    assert.deepEqual(playerState.pendingPiece, playerState.activePiece);
});

test("applyAuthoritativeInput은 soft_drop이 바닥에서 막히면 lock과 next spawn을 처리한다", async () => {
    const gameCore = await loadGameCore();
    const activePiece = {
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 3,
    };
    const playerState = createPlayerState(gameCore, {
        activePiece,
        pendingPiece: { ...activePiece },
        pieceQueue: ["tree"],
        pieceIndex: 1,
    });

    const result = applyAuthoritativeInput(playerState, {
        action: "soft_drop",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.placementResult.lockedPiece.pieceType, "square");
    assert.equal(result.placementResult.droppedRows, 0);
    assert.equal(playerState.score, 0);
    assert.equal(playerState.board[18][3], "square");
    assert.equal(playerState.board[18][4], "square");
    assert.equal(playerState.board[19][3], "square");
    assert.equal(playerState.board[19][4], "square");
    assert.deepEqual(playerState.activePiece, {
        pieceType: "tree",
        rotation: 0,
        row: -1,
        col: 3,
    });
    assert.equal(playerState.pieceIndex, 2);
});

test("applyAuthoritativeInput은 첫 hold에서 현재 piece를 hold하고 다음 queue piece를 spawn한다", async () => {
    const gameCore = await loadGameCore();
    const activePiece = {
        pieceType: "square",
        rotation: 0,
        row: 0,
        col: 3,
    };
    const playerState = createPlayerState(gameCore, {
        activePiece,
        pendingPiece: { ...activePiece },
        pieceQueue: ["tree"],
        pieceIndex: 1,
    });

    const result = applyAuthoritativeInput(playerState, {
        action: "hold",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.holdResult.holdPieceType, "square");
    assert.equal(playerState.holdPieceType, "square");
    assert.equal(playerState.holdUsedThisDrop, true);
    assert.deepEqual(playerState.activePiece, {
        pieceType: "tree",
        rotation: 0,
        row: -1,
        col: 3,
    });
    assert.deepEqual(playerState.pieceQueue, []);
    assert.equal(playerState.pieceIndex, 1);
});

test("applyAuthoritativeInput은 hold spawn이 막히면 즉시 block-out 처리한다", async () => {
    const gameCore = await loadGameCore();
    const board = gameCore.createEmptyBoard(gameCore.BOARD_ROWS, gameCore.BOARD_COLS);
    board[0][3] = "stack";
    const activePiece = {
        pieceType: "square",
        rotation: 0,
        row: 5,
        col: 0,
    };
    const playerState = createPlayerState(gameCore, {
        board,
        activePiece,
        pendingPiece: { ...activePiece },
        pieceQueue: ["bar"],
        pieceIndex: 1,
    });

    const result = applyAuthoritativeInput(playerState, {
        action: "hold",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.holdResult.gameOver, true);
    assert.equal(result.holdResult.gameOverReason, "block_out");
    assert.equal(playerState.phase, "gameOver");
    assert.equal(playerState.gameOver, true);
    assert.equal(playerState.holdPieceType, "square");
    assert.equal(playerState.holdUsedThisDrop, true);
    assert.equal(playerState.activePiece.pieceType, "");
    assert.equal(playerState.pendingPiece, null);
    assert.equal(playerState.pieceIndex, 1);
    assert.deepEqual(playerState.pieceQueue, []);
});

test("applyAuthoritativeInput은 hold 후 lastActionWasRotation을 reset한다", async () => {
    const gameCore = await loadGameCore();
    const activePiece = {
        pieceType: "square",
        rotation: 0,
        row: 0,
        col: 3,
    };
    const playerState = createPlayerState(gameCore, {
        activePiece,
        pendingPiece: { ...activePiece },
        pieceQueue: ["tree"],
        pieceIndex: 1,
        lastActionWasRotation: true,
    });

    const result = applyAuthoritativeInput(playerState, {
        action: "hold",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(playerState.lastActionWasRotation, false);
});

test("applyAuthoritativeInput은 hold piece가 있을 때 swap한다", async () => {
    const gameCore = await loadGameCore();
    const activePiece = {
        pieceType: "tree",
        rotation: 0,
        row: 0,
        col: 3,
    };
    const playerState = createPlayerState(gameCore, {
        activePiece,
        pendingPiece: { ...activePiece },
        holdPieceType: "square",
        pieceQueue: ["bar"],
        pieceIndex: 1,
    });

    const result = applyAuthoritativeInput(playerState, {
        action: "hold",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(playerState.holdPieceType, "tree");
    assert.equal(playerState.holdUsedThisDrop, true);
    assert.deepEqual(playerState.activePiece, {
        pieceType: "square",
        rotation: 0,
        row: -1,
        col: 3,
    });
    assert.deepEqual(playerState.pieceQueue, ["bar"]);
    assert.equal(playerState.pieceIndex, 1);
});

test("applyAuthoritativeInput은 같은 drop에서 두 번째 hold를 실패시킨다", async () => {
    const gameCore = await loadGameCore();
    const activePiece = {
        pieceType: "tree",
        rotation: 0,
        row: 0,
        col: 3,
    };
    const playerState = createPlayerState(gameCore, {
        activePiece,
        pendingPiece: { ...activePiece },
        holdUsedThisDrop: true,
        holdPieceType: "square",
    });
    const beforeState = structuredClone(playerState);

    const result = applyAuthoritativeInput(playerState, {
        action: "hold",
    }, gameCore);

    assert.deepEqual(result, {
        ok: false,
        reason: "HOLD_NOT_AVAILABLE",
    });
    assert.deepEqual(playerState, beforeState);
});

test("applyAuthoritativeInput은 다음 T 조각이 회전하지 않았으면 막힌 코너에서도 T-Spin으로 보지 않는다", async () => {
    const gameCore = await loadGameCore();
    const playerState = createPlayerState(gameCore, {
        pieceQueue: ["tree"],
        lastActionWasRotation: true,
    });

    const spawnResult = applyAuthoritativeInput(playerState, {
        action: "hard_drop",
    }, gameCore);
    assert.equal(spawnResult.ok, true);

    const activePiece = {
        pieceType: "tree",
        rotation: 0,
        row: 17,
        col: 3,
    };
    playerState.board = createLineClearBoard(gameCore, activePiece, [18], [
        [17, 3],
        [17, 5],
        [19, 3],
    ]);
    playerState.activePiece = { ...activePiece };
    playerState.pendingPiece = { ...activePiece };

    const result = applyAuthoritativeInput(playerState, {
        action: "soft_drop",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.placementResult.linesCleared, 1);
    assert.equal(result.placementResult.isTSpin, false);
    assert.equal(result.placementResult.rawAttackLines, 0);
});

test("applyAuthoritativeInput은 unsupported action을 실패시킨다", async () => {
    const gameCore = await loadGameCore();
    const playerState = createPlayerState(gameCore);

    const result = applyAuthoritativeInput(playerState, {
        action: "unknown",
    }, gameCore);

    assert.deepEqual(result, {
        ok: false,
        reason: "UNSUPPORTED_ACTION",
    });
});
