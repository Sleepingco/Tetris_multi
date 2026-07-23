/**
 * Canvas runtime 상태를 React가 읽는 작은 external-store 경계인 display bridge를 검증한다.
 *
 * 준비: getter가 읽을 mutable 값과 구독 callback 횟수를 준비한다.
 * 실행: 같은 값과 변경된 값을 각각 publish하고, 구독 해제·destroy도 반복 호출한다.
 * 검증: 표시 값이 같으면 snapshot 객체를 재사용하고 알리지 않으며, 값이 달라질 때만
 * 새 snapshot을 만들고 각 활성 구독에 한 번씩 알려야 한다.
 *
 * 객체 identity를 보존하는 규칙은 `useSyncExternalStore`의 불필요한 React render를 막는다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

test("display bridge는 변경된 표시 값만 새 snapshot으로 알린다", async () => {
    const { createRuntimeDisplayBridge } = await import(
        "../src/client/game/runtime/displayBridge.ts"
    );
    const values = {
        score: 0,
        lines: 0,
        holdPieceType: null,
        nextPieceTypes: ["tree", "bar", "square"],
        pendingGarbageLines: 0,
        phase: "playing",
    };
    const bridge = createRuntimeDisplayBridge(() => values);
    const first = bridge.getDisplaySnapshot();
    let calls = 0;
    const callback = () => {
        calls += 1;
    };
    const unsubscribeFirst = bridge.subscribeDisplay(callback);
    const unsubscribeSecond = bridge.subscribeDisplay(callback);

    assert.equal(bridge.publishDisplay(), false);
    assert.equal(bridge.getDisplaySnapshot(), first);
    assert.equal(calls, 0);
    assert.deepEqual(first.nextPieceTypes, ["tree", "bar"]);

    values.score = 1;
    assert.equal(bridge.publishDisplay(), true);
    assert.notEqual(bridge.getDisplaySnapshot(), first);
    assert.equal(calls, 2);

    unsubscribeFirst();
    unsubscribeFirst();
    values.lines = 1;
    bridge.publishDisplay();
    assert.equal(calls, 3);

    unsubscribeSecond();
    bridge.destroyDisplay();
    bridge.destroyDisplay();
    values.phase = "gameOver";
    assert.equal(bridge.publishDisplay(), false);
    assert.equal(calls, 3);
});

test("display bridge는 pending garbage가 바뀔 때만 한 번 알린다", async () => {
    const { createRuntimeDisplayBridge } = await import(
        "../src/client/game/runtime/displayBridge.ts"
    );
    const values = {
        score: 0,
        lines: 0,
        holdPieceType: null,
        nextPieceTypes: ["tree", "bar"],
        pendingGarbageLines: 0,
        phase: "playing",
    };
    const bridge = createRuntimeDisplayBridge(() => values);
    const initialSnapshot = bridge.getDisplaySnapshot();
    let calls = 0;
    bridge.subscribeDisplay(() => {
        calls += 1;
    });

    assert.equal(bridge.publishDisplay(), false);
    assert.equal(bridge.getDisplaySnapshot(), initialSnapshot);

    values.pendingGarbageLines = 3;
    assert.equal(bridge.publishDisplay(), true);
    assert.equal(calls, 1);
    assert.equal(bridge.getDisplaySnapshot().pendingGarbageLines, 3);

    assert.equal(bridge.publishDisplay(), false);
    assert.equal(calls, 1);
});
