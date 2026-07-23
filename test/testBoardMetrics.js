/**
 * board를 ML/휴리스틱용 숫자 특징으로 바꾸는 `getBoardMetrics`의 기준을 검증한다.
 *
 * 준비: 작은 모양을 직접 만든 board를 사용해 기대 높이와 hole 수를 눈으로 계산할 수 있게 한다.
 * 실행: 같은 board에서 column height, 합계/최대 높이, hole, bumpiness, 완성 줄을 계산한다.
 * 검증: 각 특징의 경계값이 맞고, 분석 함수가 입력 board를 변경하지 않아야 한다.
 *
 * hole은 "한 번 블록을 만난 뒤 그 아래에 있는 빈 칸"이며, 단순 빈 칸 전체 개수가 아니다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

function createBoard(rows = 20, cols = 10) {
    return Array.from({ length: rows }, () => Array(cols).fill(null));
}

test("빈 board는 모든 board metric을 0으로 계산한다", async () => {
    const { getBoardMetrics } = await import("../src/client/game/core/boardMetrics.ts");
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
    const { getBoardMetrics } = await import("../src/client/game/core/boardMetrics.ts");
    const board = createBoard();
    board[18] = Array(10).fill("square");
    board[19] = Array(10).fill("bar");
    board[17][0] = "tree";

    assert.equal(getBoardMetrics(board).completeLines, 2);
});

test("블록 아래 빈 칸을 hole로 계산한다", async () => {
    const { getBoardMetrics } = await import("../src/client/game/core/boardMetrics.ts");
    const board = createBoard();
    board[16][0] = "bar";
    board[18][0] = "square";
    board[17][1] = "tree";
    board[19][1] = "tree";

    const metrics = getBoardMetrics(board);

    assert.deepEqual(metrics.columnHeights.slice(0, 2), [4, 3]);
    assert.equal(metrics.holes, 3);
});

test("인접 column height 차이로 bumpiness를 계산한다", async () => {
    const { getBoardMetrics } = await import("../src/client/game/core/boardMetrics.ts");
    const board = createBoard(4, 4);
    board[3][0] = "bar";
    board[2][1] = "bar";
    board[3][1] = "bar";
    board[1][3] = "bar";
    board[2][3] = "bar";
    board[3][3] = "bar";

    const metrics = getBoardMetrics(board);

    assert.deepEqual(metrics.columnHeights, [1, 2, 0, 3]);
    assert.equal(metrics.bumpiness, 6);
});

test("maxHeight와 aggregateHeight를 계산한다", async () => {
    const { getBoardMetrics } = await import("../src/client/game/core/boardMetrics.ts");
    const board = createBoard(5, 3);
    board[4][0] = "square";
    board[2][1] = "tree";
    board[3][1] = "tree";
    board[4][1] = "tree";

    const metrics = getBoardMetrics(board);

    assert.equal(metrics.aggregateHeight, 4);
    assert.equal(metrics.maxHeight, 3);
});

test("boardMetrics 함수는 원본 board를 mutate하지 않는다", async () => {
    const { getBoardMetrics } = await import("../src/client/game/core/boardMetrics.ts");
    const board = createBoard(4, 4);
    board[1][0] = "bar";
    board[3][0] = "bar";
    board[3][1] = "square";
    const before = board.map(row => [...row]);

    getBoardMetrics(board);

    assert.deepEqual(board, before);
});
