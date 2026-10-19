const test = require("node:test");
const assert = require("node:assert/strict");

test("착지 후 500ms에 만료되며 공중에서는 고정하지 않는다", async () => {
    const { createLockDelay, updateLockDelay, shouldLockPiece } = await import("../src/client/game/core/lockDelay.ts");
    const first = updateLockDelay(createLockDelay(18), 18, true);
    const before = updateLockDelay(first, 18, true, 499);
    assert.equal(shouldLockPiece(before, true), false);
    const expired = updateLockDelay(before, 18, true, 1);
    assert.equal(shouldLockPiece(expired, true), true);
    assert.equal(shouldLockPiece(expired, false), false);
    assert.equal(first.remainingMs, 500);
});

test("15번째까지 갱신하며 상승과 같은 깊이 재낙하는 횟수를 복구하지 않는다", async () => {
    const { createLockDelay, updateLockDelay } = await import("../src/client/game/core/lockDelay.ts");
    let state = updateLockDelay(createLockDelay(18), 18, true);
    for (let index = 0; index < 15; index++) {
        state = updateLockDelay(state, 16, false, 100, true);
        assert.equal(state.resetCount, index + 1);
        assert.equal(state.remainingMs, 500);
        state = updateLockDelay(state, 18, true);
        assert.equal(state.resetCount, index + 1);
    }
    state = updateLockDelay(state, 16, false, 100, true);
    assert.equal(state.resetCount, 15);
    assert.equal(state.remainingMs, 400);
    const lower = updateLockDelay(state, 19, true);
    assert.equal(lower.resetCount, 0);
    assert.equal(lower.remainingMs, 500);
});

test("실패 입력은 갱신하지 않고 공중에서도 착지 후 시간을 소비한다", async () => {
    const { createLockDelay, updateLockDelay, shouldLockPiece } = await import("../src/client/game/core/lockDelay.ts");
    const touched = updateLockDelay(createLockDelay(18), 18, true);
    const airborne = updateLockDelay(touched, 16, false, 500);
    assert.equal(airborne.remainingMs, 0);
    assert.equal(airborne.resetCount, 0);
    assert.equal(updateLockDelay(airborne, 16, false, 0, true).remainingMs, 0);
    assert.equal(shouldLockPiece(updateLockDelay(airborne, 18, true), true), true);
});
