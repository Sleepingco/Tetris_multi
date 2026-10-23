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

test("40행의 고정·활성·고스트·착지 잔상·줄 효과는 같은 Canvas 행 변환을 쓴다", async t => {
    const { renderBoardCanvas, internalRowToCanvasRow } = await import("../src/client/game/render/tetrisRender.ts");
    const { default: blocks } = await import("../src/client/game/state/blocks.ts");
    const previousStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
    t.after(() => { globalThis.getComputedStyle = previousStyle; });
    const rectangles = [];
    const stack = [];
    let x = 0;
    let y = 0;
    const ctx = {
        canvas: { height: 600 }, beginPath() {}, clearRect() {}, moveTo() {}, lineTo() {}, stroke() {}, scale() {},
        save() { stack.push([x, y]); }, restore() { [x, y] = stack.pop(); },
        translate(dx, dy) { x += dx; y += dy; },
        fillRect(left, top, width, height) { rectangles.push({ x: left + x, y: top + y, width, height }); },
    };
    const board = Array.from({ length: 40 }, () => Array(10).fill(null));
    board[20][0] = "square";
    board[16][1] = "tree";
    board[15][9] = "tree";
    const before = structuredClone(board);
    const options = { ctx, board, rows: 40, cols: 10, blocks, flashRows: [{ row: 20, progress: 0 }],
        activePiece: { pieceType: "bar", row: 18, col: 3, rotation: 0, ghostRow: 37 },
        hardDropEffect: { piece: { pieceType: "square", row: 38, col: 4, rotation: 0 }, fromRow: 18, progress: 0.2 } };
    renderBoardCanvas(options);
    assert.equal(ctx.canvas.height, 720);
    assert.equal(internalRowToCanvasRow(20) * 30, 120);
    assert.ok(rectangles.some(rect => rect.x === 1 && rect.y === 121 && rect.height === 28));
    assert.ok(rectangles.some(rect => rect.x === 31 && rect.y === 1 && rect.height === 28));
    assert.equal(rectangles.some(rect => rect.x === 271), false, "여백 밖 고정 cell은 그리지 않는다");
    assert.ok(rectangles.some(rect => rect.x === 91 && rect.y === 91 && rect.height === 28));
    assert.ok(rectangles.some(rect => rect.x === 91 && rect.y === 661 && rect.height === 28));
    assert.ok(rectangles.some(rect => rect.x === 122 && rect.y === 540 && rect.height === 120));
    assert.ok(rectangles.some(rect => rect.x === 0 && rect.y === 120 && rect.width === 300 && rect.height === 30));
    assert.deepEqual(board, before, "여백 밖 cell도 원본 board에 보존한다");
    assert.equal(stack.length, 0);
    rectangles.length = 0;
    renderBoardCanvas({ ...options, flashRows: [], hardDropEffect: null,
        activePiece: { pieceType: "tree", row: 14, col: 3, rotation: 0, ghostRow: 14 } });
    assert.ok(rectangles.some(rect => rect.y === 1 && rect.height === 4), "위쪽 표시 범위 밖에도 열 위치를 표시한다");
});
