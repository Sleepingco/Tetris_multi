const test = require("node:test");
const assert = require("node:assert/strict");

const { loadGameCore } = require("../src/server/services/gameCoreLoader.js");
const {
    applyAuthoritativeInput,
} = require("../src/server/services/playerGameplayStep.js");

function createPlayerState(gameCore, overrides = {}) {
    return {
        board: overrides.board ?? gameCore.createEmptyBoard(
            gameCore.BOARD_ROWS,
            gameCore.BOARD_COLS,
        ),
        activePiece: overrides.activePiece ?? {
            pieceType: "",
            rotation: 0,
            row: gameCore.SPAWN_POSITION.row,
            col: gameCore.SPAWN_POSITION.col,
        },
        pendingPiece: overrides.pendingPiece ?? null,
        pieceQueue: [...(overrides.pieceQueue ?? ["square", "tree"])],
        holdPieceType: overrides.holdPieceType ?? null,
        holdUsedThisDrop: overrides.holdUsedThisDrop ?? false,
        score: overrides.score ?? 0,
        lines: overrides.lines ?? 0,
        phase: "playing",
        combo: -1,
        backToBack: false,
        currentTick: 0,
        pieceIndex: overrides.pieceIndex ?? 0,
        pendingGarbageQueue: [],
    };
}

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
