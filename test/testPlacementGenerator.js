/**
 * placement 좌표를 게임 보드 규칙에 맞게 정규화하고 검사하는 테스트다.
 *
 * 빈 20×10 board를 준비한 뒤 충돌 또는 경계 밖 입력을 실행하고, 거부되는지 검증한다.
 * 특히 호출자가 넘긴 `cells`를 믿지 않고 BLOCKS 정의로 절대 좌표를 다시 만드는 것이 핵심 불변식이다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

function createBoard(rows = 20, cols = 10) {
    return Array.from({ length: rows }, () => Array(cols).fill(null));
}

test("canPlacePlacement는 locked block과 겹치는 placement를 거부한다", async () => {
    const { canPlacePlacement } = await import(
        "../src/client/game/ai/heuristic/placementGenerator.ts"
    );
    const board = createBoard();
    board[19][0] = "bar";
    board[19][1] = "bar";

    assert.equal(canPlacePlacement(board, "square", 0, 0, 18), false);
});

test("canPlacePlacement는 board 밖 cell을 가진 placement를 거부한다", async () => {
    const { canPlacePlacement } = await import(
        "../src/client/game/ai/heuristic/placementGenerator.ts"
    );
    const board = createBoard();

    assert.equal(canPlacePlacement(board, "square", 0, -1, 18), false);
    assert.equal(canPlacePlacement(board, "square", 0, 9, 18), false);
    assert.equal(canPlacePlacement(board, "square", 0, 0, 19), false);
});

test("normalizePlacement는 rotation과 절대 cell 좌표를 표준 형태로 만든다", async () => {
    const { normalizePlacement } = await import(
        "../src/client/game/ai/heuristic/placementGenerator.ts"
    );

    assert.deepEqual(normalizePlacement({
        pieceType: "square",
        rotation: 4,
        col: 2,
        row: 5,
        cells: [{ row: 99, col: 99 }],
    }), {
        pieceType: "square",
        rotation: 0,
        col: 2,
        row: 5,
        cells: [
            { row: 5, col: 2 },
            { row: 5, col: 3 },
            { row: 6, col: 2 },
            { row: 6, col: 3 },
        ],
    });
});
