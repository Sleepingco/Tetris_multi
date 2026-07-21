const test = require("node:test");
const assert = require("node:assert/strict");

test("line clear가 없으면 combo를 reset한다", async () => {
    const { resolveAttackState } = await import("../src/client/game/core/attackState.ts");

    assert.deepEqual(resolveAttackState({
        combo: 2,
        backToBack: true,
        linesCleared: 0,
        isTSpin: false,
    }), {
        linesCleared: 0,
        isTSpin: false,
        combo: 0,
        backToBack: true,
        nextCombo: -1,
        nextBackToBack: true,
    });
});

test("첫 line clear는 combo 0으로 시작한다", async () => {
    const { resolveAttackState } = await import("../src/client/game/core/attackState.ts");

    assert.deepEqual(resolveAttackState({
        combo: -1,
        backToBack: false,
        linesCleared: 1,
        isTSpin: false,
    }), {
        linesCleared: 1,
        isTSpin: false,
        combo: 0,
        backToBack: false,
        nextCombo: 0,
        nextBackToBack: false,
    });
});

test("연속 line clear는 combo를 증가시킨다", async () => {
    const { resolveAttackState } = await import("../src/client/game/core/attackState.ts");

    assert.deepEqual(resolveAttackState({
        combo: 0,
        backToBack: false,
        linesCleared: 2,
        isTSpin: false,
    }), {
        linesCleared: 2,
        isTSpin: false,
        combo: 1,
        backToBack: false,
        nextCombo: 1,
        nextBackToBack: false,
    });
});

test("Tetris clear는 back-to-back을 시작하고 유지한다", async () => {
    const { resolveAttackState } = await import("../src/client/game/core/attackState.ts");

    assert.equal(resolveAttackState({
        combo: -1,
        backToBack: false,
        linesCleared: 4,
        isTSpin: false,
    }).nextBackToBack, true);
    assert.equal(resolveAttackState({
        combo: 0,
        backToBack: true,
        linesCleared: 4,
        isTSpin: false,
    }).nextBackToBack, true);
});

test("T-Spin line clear는 back-to-back을 시작하고 유지한다", async () => {
    const { resolveAttackState } = await import("../src/client/game/core/attackState.ts");

    assert.equal(resolveAttackState({
        combo: -1,
        backToBack: false,
        linesCleared: 2,
        isTSpin: true,
    }).nextBackToBack, true);
    assert.equal(resolveAttackState({
        combo: 0,
        backToBack: true,
        linesCleared: 1,
        isTSpin: true,
    }).nextBackToBack, true);
});

test("일반 line clear는 back-to-back을 끊는다", async () => {
    const { resolveAttackState } = await import("../src/client/game/core/attackState.ts");

    assert.deepEqual(resolveAttackState({
        combo: 0,
        backToBack: true,
        linesCleared: 2,
        isTSpin: false,
    }), {
        linesCleared: 2,
        isTSpin: false,
        combo: 1,
        backToBack: true,
        nextCombo: 1,
        nextBackToBack: false,
    });
});
