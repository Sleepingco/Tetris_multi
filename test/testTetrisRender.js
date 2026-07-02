const test = require("node:test");
const assert = require("node:assert/strict");

test("createLineClearFragments는 line clear 후반부에 블록 파편 좌표를 반환한다", async () => {
    const { createLineClearFragments } = await import("../src/client/game/render/tetrisRender.js");

    assert.deepEqual(createLineClearFragments({
        row: 10,
        col: 5,
        progress: 0.35,
    }), []);

    const fragments = createLineClearFragments({
        row: 10,
        col: 5,
        progress: 0.8,
    });

    assert.equal(fragments.length, 4);
    assert.ok(fragments.every(fragment => fragment.width < 30));
    assert.ok(fragments.every(fragment => fragment.height < 30));
    assert.ok(fragments.every(fragment => fragment.alpha > 0 && fragment.alpha < 1));
    assert.ok(fragments.some(fragment => fragment.x < 5 * 30 + 15));
    assert.ok(fragments.some(fragment => fragment.x > 5 * 30 + 15));
    assert.ok(fragments.some(fragment => fragment.y < 10 * 30 + 15));
    assert.ok(fragments.some(fragment => fragment.y > 10 * 30 + 15));
});
