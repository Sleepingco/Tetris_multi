const test = require("node:test");
const assert = require("node:assert/strict");

/** 실제 runtime을 수동 clock으로 구동한다. 브라우저 키 누름이나 과거 게임을 재현하지는 않는다. */
async function createFixture(t) {
    let now = 1000;
    let inputTick;
    const globals = new Map(["Audio", "localStorage", "document", "window"].map(key => [key, {
        exists: Object.hasOwn(globalThis, key), value: globalThis[key],
    }]));
    const listeners = new Set();
    globalThis.Audio = class {
        play() { return Promise.resolve(); }
        pause() {}
    };
    globalThis.localStorage = { getItem: () => null, setItem() {} };
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    globalThis.document = {
        addEventListener(type, listener) { if (type === "keydown") listeners.add(listener); },
        removeEventListener(type, listener) { if (type === "keydown") listeners.delete(listener); },
    };
    t.mock.method(globalThis, "setInterval", callback => { inputTick = callback; return 1; });
    t.mock.method(globalThis, "clearInterval", () => {});
    t.mock.method(performance, "now", () => now - 1000);
    t.mock.method(Date, "now", () => now);
    const { createTetrisRuntime } = await import("../src/client/game/runtime/tetris.ts");
    const { attachKeyboardInput } = await import("../src/client/game/runtime/input.ts");
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => {
        game.destroy();
        for (const [key, previous] of globals) {
            if (previous.exists) globalThis[key] = previous.value;
            else delete globalThis[key];
        }
    });
    game.init();
    return {
        game, listeners, attachKeyboardInput,
        setTime(value) { now = value; },
        consumeAt(value) { now = value; inputTick(); },
    };
}

test("단일 입력은 enqueue 시각이 아닌 소비 시각에 한 번 기록된다", async t => {
    const f = await createFixture(t);
    f.game.enqueueInput("move_left");
    assert.equal(f.game.runtime.inputLog.length, 0);
    f.consumeAt(1016);
    const records = f.game.runtime.inputLog;
    assert.equal(records.length, 1);
    assert.equal(records[0].createdAt, 1016);
    assert.equal(records[0].tick, 1);
    assert.equal(records[0].sequence, 1);
    t.diagnostic(JSON.stringify({ scenario: "single", enqueuedAt: 1000, recordedAt: records[0].createdAt }));
});

test("다른 시각에 enqueue해도 같은 tick의 4개 소비는 0ms pair 3개를 만든다", async t => {
    const f = await createFixture(t);
    const actions = ["move_left", "move_right", "move_left", "move_right"];
    const queued = actions.map((action, index) => {
        f.setTime(1000 + index);
        return f.game.enqueueInput(action);
    });
    assert.ok(queued.every(Boolean));
    assert.equal(f.game.enqueueInput("move_left"), null);
    assert.equal(f.game.runtime.inputLog.length, 0);
    f.consumeAt(1016);
    const records = f.game.runtime.inputLog;
    assert.deepEqual(records.map(row => row.action), actions);
    assert.deepEqual(records.map(row => row.sequence), [1, 2, 3, 4]);
    assert.deepEqual(records.map(row => row.tick), [1, 1, 1, 1]);
    assert.deepEqual(records.map(row => row.createdAt), [1016, 1016, 1016, 1016]);
    t.diagnostic(JSON.stringify({ scenario: "burst", enqueueTimes: [1000, 1001, 1002, 1003], recordedTimes: records.map(row => row.createdAt), zeroMsPairs: 3 }));
});

test("서로 다른 소비 tick의 4개 입력은 기록 간격 80ms를 보존한다", async t => {
    const f = await createFixture(t);
    for (let index = 0; index < 4; index++) {
        f.setTime(1000 + index * 80);
        f.game.enqueueInput(index % 2 ? "move_right" : "move_left");
        f.consumeAt(1016 + index * 80);
    }
    const records = f.game.runtime.inputLog;
    assert.deepEqual(records.map(row => row.tick), [1, 2, 3, 4]);
    assert.deepEqual(records.map(row => row.createdAt), [1016, 1096, 1176, 1256]);
    t.diagnostic(JSON.stringify({ scenario: "separate_ticks", recordedTimes: records.map(row => row.createdAt), intervals: [80, 80, 80] }));
});

test("키 이벤트 한 번은 정상 listener 경로에서 입력 한 개만 등록한다", async t => {
    const f = await createFixture(t);
    const detach = f.attachKeyboardInput({ enqueueAction: action => f.game.enqueueInput(action) });
    assert.equal(f.listeners.size, 1);
    for (const listener of f.listeners) {
        listener({ key: "ArrowLeft", code: "ArrowLeft", repeat: false, preventDefault() {} });
    }
    assert.equal(f.game.getPendingInputCount(), 1);
    f.consumeAt(1016);
    assert.equal(f.game.runtime.inputLog.length, 1);
    detach();
    assert.equal(f.listeners.size, 0);
    t.diagnostic("One simulated keydown -> one queued record; historical listener duplication is not established.");
});
