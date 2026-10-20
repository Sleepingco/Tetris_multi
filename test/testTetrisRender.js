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

test("줄 삭제 파편과 착지 잔상을 그려도 입력 board를 보존한다", async (t) => {
    const { renderBoardCanvas } = await import("../src/client/game/render/tetrisRender.ts");
    const { default: blocks } = await import("../src/client/game/state/blocks.ts");
    const originalStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
    t.after(() => { globalThis.getComputedStyle = originalStyle; });
    const transforms = [];
    const rectangles = [];
    const ctx = {
        canvas: {}, beginPath() {}, clearRect() {}, moveTo() {}, lineTo() {}, stroke() {},
        save() {}, restore() {},
        translate(...values) { transforms.push(values); },
        scale(...values) { transforms.push(values); },
        fillRect(...values) { rectangles.push(values); },
    };
    const board = Array.from({ length: 20 }, () => Array(10).fill(null));
    board[19].fill("bar");
    const before = structuredClone(board);
    const options = {
        ctx, board, blocks, activePiece: null, rows: 20, cols: 10,
        flashRows: [{ row: 19, progress: 0.8 }],
        hardDropEffect: { piece: { pieceType: "square", row: 18, col: 4, rotation: 0 }, fromRow: 0, progress: 0.2 },
    };
    renderBoardCanvas(options);
    assert.ok(transforms.length > 0);
    assert.ok(rectangles.some(([, , , height]) => height === 120));
    assert.deepEqual(board, before);
});
