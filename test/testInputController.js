const test = require("node:test");
const assert = require("node:assert/strict");

async function fixture(t) {
    const listeners = new Map();
    const makeTarget = () => ({
        hidden: false,
        addEventListener(name, fn) {
            const handlers = listeners.get(this) || new Map();
            const group = handlers.get(name) || new Set();
            group.add(fn);
            handlers.set(name, group);
            listeners.set(this, handlers);
        },
        removeEventListener(name, fn) { listeners.get(this)?.get(name)?.delete(fn); },
        fire(name, event = {}) {
            for (const fn of listeners.get(this)?.get(name) || []) fn(event);
        },
    });
    const previous = ["window", "document", "Element"].map(key => [key, Object.hasOwn(globalThis, key), globalThis[key]]);
    globalThis.Element = class { closest() { return {}; } };
    globalThis.window = makeTarget();
    globalThis.document = makeTarget();
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
    t.mock.method(performance, "now", () => Date.now());
    const { createInputController, attachKeyboardInput } = await import("../src/client/game/runtime/input.ts");
    const actions = [];
    let active = true;
    const controller = createInputController({
        enqueueAction: action => actions.push({ action, at: Date.now() }),
        isActive: () => active,
    });
    t.after(() => {
        controller.destroy();
        for (const [key, exists, value] of previous) {
            if (exists) globalThis[key] = value;
            else delete globalThis[key];
        }
    });
    return { controller, attachKeyboardInput, actions, tick: ms => { for (let step = 0; step < ms; step++) t.mock.timers.tick(1); },
        delayedTick: ms => t.mock.timers.tick(ms),
        setActive: value => { active = value; } };
}

test("B02 DAS 180ms 대기 후 ARR 60ms, 회전 중에도 좌우 반복 유지", async t => {
    const f = await fixture(t);
    f.controller.press("left", "move_left");
    assert.deepEqual(f.actions.map(row => row.action), ["move_left"]);
    f.tick(179);
    assert.equal(f.actions.length, 1);
    f.controller.press("rotate", "rotate");
    f.controller.press("rotate", "rotate");
    f.tick(1);
    assert.deepEqual(f.actions.map(row => row.action), ["move_left", "rotate", "move_left"]);
    f.tick(60);
    assert.equal(f.actions.at(-1).action, "move_left");
    f.controller.release("left");
    const count = f.actions.length;
    f.tick(1000);
    assert.equal(f.actions.length, count);
});

test("B02 마지막 좌우 키 우선과 해제 후 반대 방향 복귀", async t => {
    const f = await fixture(t);
    f.controller.press("left", "move_left");
    f.controller.press("right", "move_right");
    f.tick(180);
    assert.equal(f.actions.at(-1).action, "move_right");
    f.controller.release("right");
    f.tick(180);
    assert.equal(f.actions.at(-1).action, "move_left");
    f.controller.reset();
    const count = f.actions.length;
    f.tick(1000);
    assert.equal(f.actions.length, count);
});

test("B02 동시 좌우·내리기 반복은 정상 입력 한도 60/초 아래를 유지한다", async t => {
    const f = await fixture(t);
    f.controller.press("left", "move_left");
    f.controller.press("down", "soft_drop");
    for (let ms = 0; ms < 1200; ms += 10) f.tick(10);
    for (const row of f.actions) {
        assert.ok(f.actions.filter(other => other.at >= row.at && other.at < row.at + 1000).length <= 60);
    }
    const count = f.actions.length;
    f.delayedTick(10000);
    assert.ok(f.actions.length - count <= 2, "늦은 timer가 과거 입력 backlog를 한꺼번에 재생하지 않는다");
});

test("B02 경기 종료·destroy 후 입력과 반복이 중단된다", async t => {
    const f = await fixture(t);
    f.controller.press("left", "move_left");
    f.setActive(false);
    f.tick(180);
    f.controller.press("drop", "hard_drop");
    assert.equal(f.actions.length, 1);
    f.controller.destroy();
    f.setActive(true);
    f.controller.press("right", "move_right");
    f.tick(1000);
    assert.equal(f.actions.length, 1);
});

test("B02 키보드는 OS 반복·입력창을 무시하고 blur·hidden·cleanup으로 해제한다", async t => {
    const f = await fixture(t);
    const detach = f.attachKeyboardInput({ controller: f.controller, enqueueAction: () => assert.fail("controller를 우회했다") });
    const fire = (key, extras = {}) => document.fire("keydown", {
        key, code: key, repeat: false, preventDefault() {}, ...extras,
    });
    fire("ArrowLeft", { target: new Element() });
    assert.equal(f.actions.length, 0);
    fire("ArrowLeft");
    fire("ArrowLeft", { repeat: true });
    assert.equal(f.actions.length, 1);
    window.fire("blur");
    f.tick(1000);
    assert.equal(f.actions.length, 1);
    fire("ArrowRight");
    document.hidden = true;
    document.fire("visibilitychange");
    f.tick(1000);
    assert.equal(f.actions.length, 2);
    document.hidden = false;
    fire("ArrowLeft");
    detach();
    f.tick(1000);
    fire("ArrowRight");
    assert.equal(f.actions.length, 3);
});

test("B02 단발 액션을 섞어도 60/초 budget을 넘기지 않는다", async t => {
    const f = await fixture(t);
    f.controller.press("left", "move_left");
    f.controller.press("down", "soft_drop");
    for (let index = 0; index < 100; index++) {
        f.controller.press(`rotate:${index}`, "rotate");
        f.controller.release(`rotate:${index}`);
        f.tick(10);
    }
    for (const row of f.actions) {
        assert.ok(f.actions.filter(other => other.at >= row.at && other.at < row.at + 1000).length <= 60);
    }
});

test("B02 입력창에 focus가 이동하면 눌린 방향을 해제한다", async t => {
    const f = await fixture(t);
    const detach = f.attachKeyboardInput({ controller: f.controller, enqueueAction() {} });
    document.fire("keydown", { key: "ArrowLeft", code: "ArrowLeft", repeat: false, preventDefault() {} });
    document.fire("focusin", { target: new Element() });
    f.tick(1000);
    assert.equal(f.actions.length, 1);
    detach();
});

test("B02 짧은 누름은 한 번만 이동하고 keyup 뒤에는 새 반복 입력을 만들지 않는다", async t => {
    const f = await fixture(t);
    const detach = f.attachKeyboardInput({ controller: f.controller, enqueueAction() {} });
    const event = { key: "ArrowLeft", code: "ArrowLeft", repeat: false, preventDefault() {} };
    document.fire("keydown", event);
    f.tick(150);
    document.fire("keyup", event);
    f.tick(400);
    assert.deepEqual(f.actions.map(row => row.action), ["move_left"]);
    document.fire("keydown", event);
    f.tick(240);
    assert.equal(f.actions.length, 4);
    document.fire("keyup", event);
    f.tick(1000);
    assert.equal(f.actions.length, 4);
    detach();
});

for (const [key, flag] of [["Meta", "metaKey"], ["Control", "ctrlKey"], ["Alt", "altKey"]]) {
    test(`B02 ${key} 입력은 keyup 누락 시 반복을 해제하고 시스템 단축키를 보존한다`, async t => {
        const f = await fixture(t);
        const detach = f.attachKeyboardInput({ controller: f.controller, enqueueAction() {} });
        document.fire("keydown", { key: "ArrowLeft", code: "ArrowLeft", repeat: false, preventDefault() {} });
        document.fire("keydown", { key, [flag]: true, target: new Element(), preventDefault() { assert.fail("시스템 키를 차단했다"); } });
        f.tick(500);
        assert.deepEqual(f.actions.map(row => row.action), ["move_left"]);
        for (const shortcut of ["c", "z", "ArrowRight"]) {
            document.fire("keydown", { key: shortcut, [flag]: true, preventDefault() { assert.fail("시스템 단축키를 차단했다"); } });
        }
        document.fire("keyup", { key });
        f.tick(500);
        assert.equal(f.actions.length, 1);
        document.fire("keydown", { key: "ArrowRight", code: "ArrowRight", shiftKey: true, repeat: false, preventDefault() {} });
        f.tick(180);
        assert.deepEqual(f.actions.map(row => row.action), ["move_left", "move_right", "move_right"]);
        detach();
    });
}
