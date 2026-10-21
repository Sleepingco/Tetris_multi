/**
 * 한 조각이 고정된 뒤 combo와 back-to-back 상태가 어떻게 전이되는지 검증한다.
 *
 * 준비: 직전 combo/B2B와 이번 line clear·T-Spin 결과를 조합한다.
 * 실행: 부작용 없는 `resolveAttackState`에 각 경계값을 전달한다.
 * 검증: 이번 공격량 계산에 쓸 값과 다음 조각에 저장할 `next*` 값이 함께 맞아야 한다.
 *
 * 첫 clear의 combo는 0, clear가 끊기면 다음 combo는 -1이라는 기준을 구분해서 읽으면 된다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

test("line clear가 없으면 combo를 reset한다", async () => {
    const { resolveAttackState } = await import("../src/client/game/core/attackState.ts");

    assert.deepEqual(resolveAttackState({
        combo: 2,
        backToBack: true,
        linesCleared: 0,
        tSpinType: "none",
    }), {
        linesCleared: 0,
        tSpinType: "none",
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
        tSpinType: "none",
    }), {
        linesCleared: 1,
        tSpinType: "none",
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
        tSpinType: "none",
    }), {
        linesCleared: 2,
        tSpinType: "none",
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
        tSpinType: "none",
    }).nextBackToBack, true);
    assert.equal(resolveAttackState({
        combo: 0,
        backToBack: true,
        linesCleared: 4,
        tSpinType: "none",
    }).nextBackToBack, true);
});

test("T-Spin line clear는 back-to-back을 시작하고 유지한다", async () => {
    const { resolveAttackState } = await import("../src/client/game/core/attackState.ts");

    assert.equal(resolveAttackState({
        combo: -1,
        backToBack: false,
        linesCleared: 2,
        tSpinType: "full",
    }).nextBackToBack, true);
    assert.equal(resolveAttackState({
        combo: 0,
        backToBack: true,
        linesCleared: 1,
        tSpinType: "full",
    }).nextBackToBack, true);
});

test("일반 line clear는 back-to-back을 끊는다", async () => {
    const { resolveAttackState } = await import("../src/client/game/core/attackState.ts");

    assert.deepEqual(resolveAttackState({
        combo: 0,
        backToBack: true,
        linesCleared: 2,
        tSpinType: "none",
    }), {
        linesCleared: 2,
        tSpinType: "none",
        combo: 1,
        backToBack: true,
        nextCombo: 1,
        nextBackToBack: false,
    });
});
