/**
 * 조각 queue가 결정론적인 7-bag 규칙과 잘못된 설정의 실패 경계를 지키는지 검증한다.
 *
 * 준비: 모든 piece type과 항상 같은 값을 내는 주입형 rng를 사용한다.
 * 실행: 빈 bag에서 조각 수만큼 꺼내거나 빈 `pieceTypes`로 queue 보충을 요청한다.
 * 검증: 한 bag에는 각 조각이 정확히 한 번씩 있고, 조각 정의가 없으면 조용히 진행하지 않고 거부해야 한다.
 */
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
