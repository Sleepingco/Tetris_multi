const test = require("node:test");
const assert = require("node:assert/strict");

test("single line clear는 garbage를 보내지 않는다", async () => {
    const { calculateGarbageAttack } = await import("../src/client/game/core/garbage.ts");

    assert.equal(calculateGarbageAttack({ linesCleared: 1 }), 0);
});

test("double line clear는 garbage 1줄을 보낸다", async () => {
    const { calculateGarbageAttack } = await import("../src/client/game/core/garbage.ts");

    assert.equal(calculateGarbageAttack({ linesCleared: 2 }), 1);
});

test("triple line clear는 garbage 2줄을 보낸다", async () => {
    const { calculateGarbageAttack } = await import("../src/client/game/core/garbage.ts");

    assert.equal(calculateGarbageAttack({ linesCleared: 3 }), 2);
});

test("tetris line clear는 garbage 4줄을 보낸다", async () => {
    const { calculateGarbageAttack } = await import("../src/client/game/core/garbage.ts");

    assert.equal(calculateGarbageAttack({ linesCleared: 4 }), 4);
});

test("T-Spin line clear는 일반 line clear보다 강한 garbage를 보낸다", async () => {
    const { calculateGarbageAttack } = await import("../src/client/game/core/garbage.ts");

    assert.equal(calculateGarbageAttack({ linesCleared: 1, isTSpin: true }), 2);
    assert.equal(calculateGarbageAttack({ linesCleared: 2, isTSpin: true }), 4);
    assert.equal(calculateGarbageAttack({ linesCleared: 3, isTSpin: true }), 6);
});

test("combo는 연속 line clear 수에 따라 garbage 보너스를 더한다", async () => {
    const { calculateGarbageAttack } = await import("../src/client/game/core/garbage.ts");

    assert.equal(calculateGarbageAttack({ linesCleared: 2, combo: 1 }), 2);
    assert.equal(calculateGarbageAttack({ linesCleared: 2, combo: 3 }), 3);
    assert.equal(calculateGarbageAttack({ linesCleared: 2, combo: 5 }), 4);
});

test("back-to-back은 Tetris나 T-Spin clear에 garbage 1줄을 더한다", async () => {
    const { calculateGarbageAttack } = await import("../src/client/game/core/garbage.ts");

    assert.equal(calculateGarbageAttack({ linesCleared: 4, backToBack: true }), 5);
    assert.equal(calculateGarbageAttack({ linesCleared: 2, isTSpin: true, backToBack: true }), 5);
    assert.equal(calculateGarbageAttack({ linesCleared: 2, backToBack: true }), 1);
});

test("pending garbage가 없으면 raw attack을 그대로 보낸다", async () => {
    const { resolveGarbageCancel } = await import("../src/client/game/core/garbage.ts");

    assert.deepEqual(resolveGarbageCancel({
        pendingGarbageQueue: [],
        rawAttackLines: 4,
    }), {
        pendingGarbageQueue: [],
        incomingGarbageLines: 0,
        canceledGarbageLines: 0,
        attackLines: 4,
    });
});

test("pending 2와 attack 4는 2줄을 상쇄하고 2줄을 보낸다", async () => {
    const { resolveGarbageCancel } = await import("../src/client/game/core/garbage.ts");

    assert.deepEqual(resolveGarbageCancel({
        pendingGarbageQueue: [{ lines: 2, holeCol: 4 }],
        rawAttackLines: 4,
    }), {
        pendingGarbageQueue: [],
        incomingGarbageLines: 2,
        canceledGarbageLines: 2,
        attackLines: 2,
    });
});

test("pending 4와 attack 2는 2줄을 상쇄하고 pending 2줄을 남긴다", async () => {
    const { resolveGarbageCancel } = await import("../src/client/game/core/garbage.ts");

    assert.deepEqual(resolveGarbageCancel({
        pendingGarbageQueue: [{ lines: 4, holeCol: 4 }],
        rawAttackLines: 2,
    }), {
        pendingGarbageQueue: [{ lines: 2, holeCol: 4 }],
        incomingGarbageLines: 4,
        canceledGarbageLines: 2,
        attackLines: 0,
    });
});

test("여러 pending garbage entry는 FIFO 순서로 상쇄된다", async () => {
    const { resolveGarbageCancel } = await import("../src/client/game/core/garbage.ts");

    assert.deepEqual(resolveGarbageCancel({
        pendingGarbageQueue: [
            { lines: 1, holeCol: 2 },
            { lines: 3, holeCol: 7 },
        ],
        rawAttackLines: 2,
    }), {
        pendingGarbageQueue: [{ lines: 2, holeCol: 7 }],
        incomingGarbageLines: 4,
        canceledGarbageLines: 2,
        attackLines: 0,
    });
});

test("attack 0이면 pending garbage를 유지하고 attackLines 0을 반환한다", async () => {
    const { resolveGarbageCancel } = await import("../src/client/game/core/garbage.ts");
    const pendingGarbageQueue = [{ lines: 2, holeCol: 4 }];

    assert.deepEqual(resolveGarbageCancel({
        pendingGarbageQueue,
        rawAttackLines: 0,
    }), {
        pendingGarbageQueue: [{ lines: 2, holeCol: 4 }],
        incomingGarbageLines: 2,
        canceledGarbageLines: 0,
        attackLines: 0,
    });
    assert.deepEqual(pendingGarbageQueue, [{ lines: 2, holeCol: 4 }]);
});

test("line clear가 없거나 유효하지 않으면 garbage를 보내지 않는다", async () => {
    const { calculateGarbageAttack } = await import("../src/client/game/core/garbage.ts");

    assert.equal(calculateGarbageAttack({ linesCleared: 0 }), 0);
    assert.equal(calculateGarbageAttack({ linesCleared: -1 }), 0);
    assert.equal(calculateGarbageAttack({ linesCleared: null }), 0);
    assert.equal(calculateGarbageAttack({}), 0);
});

test("applyGarbageLines는 아래에서 garbage line을 올린다", async () => {
    const { applyGarbageLines } = await import("../src/client/game/core/garbage.ts");
    const board = [
        [null, null, null, null],
        ["bar", null, null, null],
        [null, "square", null, null],
        [null, null, "tree", null],
    ];

    const result = applyGarbageLines(board, {
        lines: 1,
        holeCol: 2,
    });

    assert.equal(result.appliedLines, 1);
    assert.equal(result.overflow, false);
    assert.deepEqual(board, [
        ["bar", null, null, null],
        [null, "square", null, null],
        [null, null, "tree", null],
        ["garbage", "garbage", null, "garbage"],
    ]);
});

test("applyGarbageLines는 밀려나간 윗줄에 블록이 있으면 overflow를 반환한다", async () => {
    const { applyGarbageLines } = await import("../src/client/game/core/garbage.ts");
    const board = [
        ["bar", null, null, null],
        [null, null, null, null],
        [null, null, null, null],
        [null, null, null, null],
    ];

    const result = applyGarbageLines(board, {
        lines: 1,
        holeCol: 1,
    });

    assert.equal(result.appliedLines, 1);
    assert.equal(result.overflow, true);
});
