/**
 * Canvas를 직접 그리기 전에 line-clear 파편 좌표를 계산하는 순수 렌더 helper 테스트다.
 *
 * row·col·animation progress를 준비해 계산을 실행하고, 분해 시작 전에는 빈 배열이며 이후에는 중심에서
 * 네 방향으로 작아지고 투명해지는 네 조각을 반환하는지 검증한다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

test("createLineClearFragments는 line clear 후반부에 블록 파편 좌표를 반환한다", async () => {
    const { createLineClearFragments } = await import("../src/client/game/render/tetrisRender.ts");

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
