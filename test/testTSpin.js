const test = require("node:test");
const assert = require("node:assert/strict");

function createEmptyBoard(rows = 20, cols = 10) {
    return Array.from({ length: rows }, () => Array(cols).fill(null));
}

test("T 조각이 마지막 회전 후 중심 코너 3개 이상 막히면 T-Spin으로 판정한다", async () => {
    const { isTSpinLock } = await import("../src/client/game/core/tSpin.js");
    const board = createEmptyBoard();
    const piece = {
        pieceType: "tree",
        rotation: 0,
        row: 4,
        col: 3,
    };

    board[4][3] = "garbage";
    board[4][5] = "garbage";
    board[6][3] = "garbage";

    assert.equal(isTSpinLock({
        board,
        piece,
        lastActionWasRotation: true,
    }), true);
});

test("T 조각이 아니면 T-Spin으로 판정하지 않는다", async () => {
    const { isTSpinLock } = await import("../src/client/game/core/tSpin.js");
    const board = createEmptyBoard();

    board[4][3] = "garbage";
    board[4][5] = "garbage";
    board[6][3] = "garbage";

    assert.equal(isTSpinLock({
        board,
        piece: {
            pieceType: "square",
            rotation: 0,
            row: 4,
            col: 3,
        },
        lastActionWasRotation: true,
    }), false);
});

test("마지막 액션이 회전이 아니면 T-Spin으로 판정하지 않는다", async () => {
    const { isTSpinLock } = await import("../src/client/game/core/tSpin.js");
    const board = createEmptyBoard();

    board[4][3] = "garbage";
    board[4][5] = "garbage";
    board[6][3] = "garbage";

    assert.equal(isTSpinLock({
        board,
        piece: {
            pieceType: "tree",
            rotation: 0,
            row: 4,
            col: 3,
        },
        lastActionWasRotation: false,
    }), false);
});

test("막힌 중심 코너가 2개 이하이면 T-Spin으로 판정하지 않는다", async () => {
    const { isTSpinLock } = await import("../src/client/game/core/tSpin.js");
    const board = createEmptyBoard();

    board[4][3] = "garbage";
    board[4][5] = "garbage";

    assert.equal(isTSpinLock({
        board,
        piece: {
            pieceType: "tree",
            rotation: 0,
            row: 4,
            col: 3,
        },
        lastActionWasRotation: true,
    }), false);
});
