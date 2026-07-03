const test = require("node:test");
const assert = require("node:assert/strict");

test("createSpawnedPiece는 rotation 0의 spawn piece를 만든다", async () => {
    const { createSpawnedPiece } = await import("../src/client/game/core/piece.js");

    assert.deepEqual(createSpawnedPiece("tree", -1, 4), {
        pieceType: "tree",
        row: -1,
        col: 4,
        rotation: 0,
    });
});

test("createSpawnedPiece는 호출할 때마다 새 객체를 반환한다", async () => {
    const { createSpawnedPiece } = await import("../src/client/game/core/piece.js");

    const firstPiece = createSpawnedPiece("bar", -1, 3);
    const secondPiece = createSpawnedPiece("bar", -1, 3);

    assert.deepEqual(firstPiece, secondPiece);
    assert.notEqual(firstPiece, secondPiece);
});

test("getHardDropRow는 아래로 내려갈 수 있는 마지막 row를 반환한다", async () => {
    const { getHardDropRow } = await import("../src/client/game/core/piece.js");
    const piece = {
        pieceType: "tree",
        rotation: 0,
        row: 3,
        col: 4,
    };

    assert.equal(getHardDropRow(piece, row => row <= 7), 7);
});

test("getHardDropRow는 바로 아래가 막혀 있으면 현재 row를 반환한다", async () => {
    const { getHardDropRow } = await import("../src/client/game/core/piece.js");
    const piece = {
        pieceType: "tree",
        rotation: 0,
        row: 3,
        col: 4,
    };

    assert.equal(getHardDropRow(piece, () => false), 3);
});

test("getHardDropRow는 실제 board와 BLOCKS 조합으로 마지막 가능한 row를 계산한다", async () => {
    const { getHardDropRow } = await import("../src/client/game/core/piece.js");
    const { createEmptyBoard, canPlacePiece } = await import("../src/client/game/core/board.js");
    const { default: BLOCKS } = await import("../src/client/game/state/blocks.js");
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
