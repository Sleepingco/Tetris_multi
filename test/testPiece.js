/**
 * 움직이는 조각의 생성과 hard drop 도착 row 계산을 검증한다.
 *
 * 준비: spawn 좌표 또는 `row`별 배치 가능 여부를 알려 주는 작은 predicate를 만든다.
 * 실행: 새 조각을 여러 번 만들고, 빈 공간·즉시 충돌·실제 board에서 `getHardDropRow`를 호출한다.
 * 검증: 새 조각은 rotation 0의 독립 객체이며, hard drop은 충돌 직전 마지막 유효 row에서 멈춰야 한다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

test("createSpawnedPiece는 rotation 0의 spawn piece를 만든다", async () => {
    const { createSpawnedPiece } = await import("../src/client/game/core/piece.ts");

    assert.deepEqual(createSpawnedPiece("tree", -1, 4), {
        pieceType: "tree",
        row: -1,
        col: 4,
        rotation: 0,
    });
});

test("createSpawnedPiece는 호출할 때마다 새 객체를 반환한다", async () => {
    const { createSpawnedPiece } = await import("../src/client/game/core/piece.ts");

    const firstPiece = createSpawnedPiece("bar", -1, 3);
    const secondPiece = createSpawnedPiece("bar", -1, 3);

    assert.deepEqual(firstPiece, secondPiece);
    assert.notEqual(firstPiece, secondPiece);
});

test("getHardDropRow는 아래로 내려갈 수 있는 마지막 row를 반환한다", async () => {
    const { getHardDropRow } = await import("../src/client/game/core/piece.ts");
    const piece = {
        pieceType: "tree",
        rotation: 0,
        row: 3,
        col: 4,
    };

    assert.equal(getHardDropRow(piece, row => row <= 7), 7);
});

test("getHardDropRow는 바로 아래가 막혀 있으면 현재 row를 반환한다", async () => {
    const { getHardDropRow } = await import("../src/client/game/core/piece.ts");
    const piece = {
        pieceType: "tree",
        rotation: 0,
        row: 3,
        col: 4,
    };

    assert.equal(getHardDropRow(piece, () => false), 3);
});

test("getHardDropRow는 실제 board와 BLOCKS 조합으로 마지막 가능한 row를 계산한다", async () => {
    const { getHardDropRow } = await import("../src/client/game/core/piece.ts");
    const { createEmptyBoard, canPlacePiece } = await import("../src/client/game/core/board.ts");
    const { default: BLOCKS } = await import("../src/client/game/state/blocks.ts");
    const board = createEmptyBoard(20, 10);
    board[19][4] = "square";
    const piece = {
        pieceType: "bar",
        rotation: 1,
        row: 0,
        col: 2,
    };

    assert.equal(getHardDropRow(piece, row => canPlacePiece(board, {
        ...piece,
        row,
    }, BLOCKS)), 15);
});
