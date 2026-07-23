/**
 * AI 후보 placement를 실제 gameplay state와 분리해 미리 시뮬레이션하는 테스트다.
 *
 * board와 placement를 준비해 lock·line clear를 실행하고 `boardAfter`와 game-over 결과를 검증한다.
 * 여러 후보 평가가 서로 영향을 주지 않도록 입력 board와 placement를 절대 변경하지 않는 것이 핵심 불변식이다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

function createBoard(rows = 20, cols = 10) {
    return Array.from({ length: rows }, () => Array(cols).fill(null));
}

test("simulatePlacement는 조각 고정과 line clear를 boardAfter에 반영한다", async () => {
    const { simulatePlacement } = await import(
        "../src/client/game/ai/heuristic/simulatePlacement.ts"
    );
    const board = createBoard();
    board[19] = [null, null, ...Array(8).fill("tree")];

    const result = simulatePlacement(board, {
        pieceType: "square",
        rotation: 0,
        col: 0,
        row: 18,
    });

    assert.ok(result);
    assert.equal(result.linesCleared, 1);
    assert.equal(result.gameOver, false);
    assert.deepEqual(result.boardAfter[19], [
        "square",
        "square",
        ...Array(8).fill(null),
    ]);
    assert.deepEqual(result.placement.cells, [
        { row: 18, col: 0 },
        { row: 18, col: 1 },
        { row: 19, col: 0 },
        { row: 19, col: 1 },
    ]);
});

test("simulatePlacement는 원본 board와 placement를 mutate하지 않는다", async () => {
    const { simulatePlacement } = await import(
        "../src/client/game/ai/heuristic/simulatePlacement.ts"
    );
    const board = createBoard();
    board[19][5] = "bar";
    const placement = {
        pieceType: "square",
        rotation: 0,
        col: 0,
        row: 18,
        cells: [],
    };
    const boardBefore = board.map(row => [...row]);
    const placementBefore = structuredClone(placement);

    const result = simulatePlacement(board, placement);

    assert.ok(result);
    assert.deepEqual(board, boardBefore);
    assert.deepEqual(placement, placementBefore);
    assert.notEqual(result.boardAfter, board);
    result.boardAfter.forEach((row, index) => assert.notEqual(row, board[index]));
});

test("simulatePlacement는 상단을 넘은 lock을 game over로 반환한다", async () => {
    const { simulatePlacement } = await import(
        "../src/client/game/ai/heuristic/simulatePlacement.ts"
    );
    const board = createBoard();
    board[1][0] = "tree";
    board[1][1] = "tree";

    const result = simulatePlacement(board, {
        pieceType: "square",
        rotation: 0,
        col: 0,
        row: -1,
    });

    assert.ok(result);
    assert.equal(result.gameOver, true);
    assert.equal(result.linesCleared, 0);
    assert.equal(result.boardAfter[0][0], "square");
    assert.equal(result.boardAfter[0][1], "square");
});

test("simulatePlacement는 잘못됐거나 충돌하는 placement를 안전하게 거부한다", async () => {
    const { simulatePlacement } = await import(
        "../src/client/game/ai/heuristic/simulatePlacement.ts"
    );
    const board = createBoard();
    board[19][0] = "tree";

    assert.equal(simulatePlacement(board, {
        pieceType: "square",
        rotation: 0,
        col: 0,
        row: 18,
    }), null);
    assert.equal(simulatePlacement(board, {
        pieceType: "unknown",
        rotation: 0,
        col: 0,
        row: 0,
    }), null);
    assert.equal(simulatePlacement([], {
        pieceType: "square",
        rotation: 0,
        col: 0,
        row: 0,
    }), null);
});
