const test = require("node:test");
const assert = require("node:assert/strict");

const { loadGameCore } = require("../src/server/services/gameCoreLoader.js");
const {
    applyServerGameplayInput,
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
        holdPieceType: null,
        holdUsedThisDrop: false,
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

test("applyServerGameplayInput은 빈 activePiece에 첫 queue piece를 spawn한 뒤 hard_drop으로 lock한다", async () => {
    const gameCore = await loadGameCore();
    const playerState = createPlayerState(gameCore);

    const result = applyServerGameplayInput(playerState, {
        action: "hard_drop",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.placementResult.lockedPiece.pieceType, "square");
    assert.equal(result.placementResult.droppedRows, 19);
    assert.equal(playerState.board[18][3], "square");
    assert.equal(playerState.board[18][4], "square");
    assert.equal(playerState.board[19][3], "square");
    assert.equal(playerState.board[19][4], "square");
    assert.equal(playerState.score, 38);
});

test("applyServerGameplayInput은 line clear 후 board, lines, score를 갱신한다", async () => {
    const gameCore = await loadGameCore();
    const board = gameCore.createEmptyBoard(gameCore.BOARD_ROWS, gameCore.BOARD_COLS);
    board[19] = Array(gameCore.BOARD_COLS).fill("bar");
    board[19][3] = null;
    board[19][4] = null;
    const playerState = createPlayerState(gameCore, { board });

    const result = applyServerGameplayInput(playerState, {
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

test("applyServerGameplayInput은 hard_drop 후 다음 piece를 spawn하고 pieceIndex를 증가시킨다", async () => {
    const gameCore = await loadGameCore();
    const playerState = createPlayerState(gameCore);

    const result = applyServerGameplayInput(playerState, {
        action: "hard_drop",
    }, gameCore);

    assert.equal(result.ok, true);
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
