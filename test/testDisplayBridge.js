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
