/**
 * 조각의 실제 BLOCKS 좌표 중 하나라도 board 위(row < 0)에 있는지 확인하는 top-out 보조 규칙 테스트다.
 *
 * 정상, 상단 초과, 잘못된 입력을 각각 준비해 boolean 결과를 검증한다.
 * 잘못된 piece/blocks는 예외 대신 `false`를 반환해 호출자가 별도 입력 검증 책임을 유지한다.
 */
const test = require("node:test")
const assert = require("node:assert/strict")

test("isPieceAboveTop은 모든 cell이 row 0 이상이면 false를 반환한다", async () => {
    const { isPieceAboveTop } = await import("../src/client/game/core/board.ts")
    const { default: BLOCKS } = await import("../src/client/game/state/blocks.ts")

    assert.equal(isPieceAboveTop({
        pieceType: "tree",
        rotation: 1,
        row: 0,
        col: 4,
    }, BLOCKS), false)
})

test("isPieceAboveTop은 cell 하나라도 row 0보다 작으면 true를 반환한다", async () => {
    const { isPieceAboveTop } = await import("../src/client/game/core/board.ts")
    const { default: BLOCKS } = await import("../src/client/game/state/blocks.ts")

    assert.equal(isPieceAboveTop({
        pieceType: "tree",
        rotation: 1,
        row: -1,
        col: 4,
    }, BLOCKS), true)
})

test("isPieceAboveTop은 유효하지 않은 piece 또는 blocks 입력이면 false를 반환한다", async () => {
    const { isPieceAboveTop } = await import("../src/client/game/core/board.ts")
    const { default: BLOCKS } = await import("../src/client/game/state/blocks.ts")

    assert.equal(isPieceAboveTop(null, BLOCKS), false)
    assert.equal(isPieceAboveTop({
        pieceType: "unknown",
        rotation: 0,
        row: -1,
        col: 4,
    }, BLOCKS), false)
    assert.equal(isPieceAboveTop({
        pieceType: "tree",
        rotation: 1,
        row: -1,
        col: 4,
    }, null), false)
})
