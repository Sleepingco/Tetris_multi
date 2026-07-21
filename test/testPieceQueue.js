const test = require("node:test");
const assert = require("node:assert/strict");

test("7-bag은 각 조각을 한 번씩 반환한다", async () => {
    const { pickRandomPiece } = await import("../src/client/game/state/pieceQueue.ts");
    const { default: BLOCKS } = await import("../src/client/game/state/blocks.ts");
    const pieceTypes = Object.keys(BLOCKS);
    const gameState = { bag: [], pieceQueue: [] };

    const bag = pieceTypes.map(() => pickRandomPiece(gameState, pieceTypes, () => 0));

    assert.deepEqual([...bag].sort(), [...pieceTypes].sort());
});

test("빈 pieceTypes는 명시적으로 거부한다", async () => {
    const { takeNextFromQueue } = await import("../src/client/game/state/pieceQueue.ts");
    const gameState = { bag: [], pieceQueue: [] };

    assert.throws(
        () => takeNextFromQueue(gameState, 2, [], () => 0),
        { name: "TypeError", message: "pieceTypes must not be empty" },
    );
});
