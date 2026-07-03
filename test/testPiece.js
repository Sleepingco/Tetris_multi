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
