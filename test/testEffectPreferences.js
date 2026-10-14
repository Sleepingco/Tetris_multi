const test = require("node:test");
const assert = require("node:assert/strict");

test("효과 설정은 OS 기본값·사용자 선택을 구분하고 버튼과 media listener를 정리한다", async (t) => {
    const originalStorage = globalThis.localStorage;
    const originalMedia = globalThis.matchMedia;
    const values = new Map();
    const mediaListeners = new Set();
    const media = {
        matches: true,
        addEventListener(type, callback) { mediaListeners.add(callback); },
        removeEventListener(type, callback) { mediaListeners.delete(callback); },
    };
    globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    globalThis.matchMedia = () => media;
    t.after(() => {
        globalThis.localStorage = originalStorage;
        globalThis.matchMedia = originalMedia;
    });
    const { loadReducedEffects, initEffectToggle } = await import("../src/client/game/runtime/effectPreferences.ts");
    const listeners = new Map();
    const attributes = new Map();
    const button = {
        setAttribute: (key, value) => attributes.set(key, value),
        addEventListener: (type, callback) => listeners.set(type, callback),
        removeEventListener: type => listeners.delete(type),
    };
    const changes = [];
    const cleanup = initEffectToggle(button, value => changes.push(value));
    assert.equal(loadReducedEffects(), true);
    assert.equal(attributes.get("aria-pressed"), "true");
    listeners.get("click")();
    assert.equal(loadReducedEffects(), false);
    assert.equal(attributes.get("aria-pressed"), "false");
    mediaListeners.forEach(callback => callback());
    assert.deepEqual(changes, [true, false, false]);
    cleanup();
    cleanup();
    assert.equal(listeners.size, 0);
    assert.equal(mediaListeners.size, 0);
});
