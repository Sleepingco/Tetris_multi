const test = require("node:test");
const assert = require("node:assert/strict");

function createBoard(rows = 20, cols = 10) {
    return Array.from({ length: rows }, () => Array(cols).fill(null));
}

test("빈 board는 모든 board metric을 0으로 계산한다", async () => {
    const { getBoardMetrics } = await import("../src/client/game/core/boardMetrics.js");
    const board = createBoard();

    assert.deepEqual(getBoardMetrics(board), {
        columnHeights: Array(10).fill(0),
        aggregateHeight: 0,
        maxHeight: 0,
        holes: 0,
        bumpiness: 0,
        completeLines: 0,
    });
});

test("완성된 line 수를 계산한다", async () => {
    const {
        countCompleteLines,
        getBoardMetrics,
    } = await import("../src/client/game/core/boardMetrics.js");
    const board = createBoard();
    board[18] = Array(10).fill("square");
    board[19] = Array(10).fill("bar");
    board[17][0] = "tree";

    assert.equal(countCompleteLines(board), 2);
    assert.equal(getBoardMetrics(board).completeLines, 2);
});

test("블록 아래 빈 칸을 hole로 계산한다", async () => {
    const {
        countHoles,
        getColumnHeights,
    } = await import("../src/client/game/core/boardMetrics.js");
    const board = createBoard();
    board[16][0] = "bar";
    board[18][0] = "square";
    board[17][1] = "tree";
    board[19][1] = "tree";

    assert.deepEqual(getColumnHeights(board).slice(0, 2), [4, 3]);
    assert.equal(countHoles(board), 3);
});

test("인접 column height 차이로 bumpiness를 계산한다", async () => {
    const {
        getBumpiness,
        getColumnHeights,
    } = await import("../src/client/game/core/boardMetrics.js");
    const board = createBoard(4, 4);
    board[3][0] = "bar";
    board[2][1] = "bar";
    board[3][1] = "bar";
    board[1][3] = "bar";
    board[2][3] = "bar";
    board[3][3] = "bar";

    assert.deepEqual(getColumnHeights(board), [1, 2, 0, 3]);
    assert.equal(getBumpiness(board), 6);
});

test("maxHeight와 aggregateHeight를 계산한다", async () => {
    const {
        getAggregateHeight,
        getMaxHeight,
    } = await import("../src/client/game/core/boardMetrics.js");
    const board = createBoard(5, 3);
    board[4][0] = "square";
    board[2][1] = "tree";
    board[3][1] = "tree";
    board[4][1] = "tree";

    assert.equal(getAggregateHeight(board), 4);
    assert.equal(getMaxHeight(board), 3);
});

test("boardMetrics 함수는 원본 board를 mutate하지 않는다", async () => {
    const { getBoardMetrics } = await import("../src/client/game/core/boardMetrics.js");
    const board = createBoard(4, 4);
    board[1][0] = "bar";
    board[3][0] = "bar";
    board[3][1] = "square";
    const before = board.map(row => [...row]);

    getBoardMetrics(board);

    assert.deepEqual(board, before);
});
