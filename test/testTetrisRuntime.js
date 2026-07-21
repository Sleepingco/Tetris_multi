const test = require("node:test");
const assert = require("node:assert/strict");
const { validatePlacementDecisionLog } = require(
    "../dist/server/server/validators/gameLogValidator.js"
);

function installBrowserStubs() {
    globalThis.__audioPlayCalls = [];
    globalThis.Audio = class {
        constructor(src) {
            this.src = src;
            this.loop = false;
            this.volume = 1;
            this.currentTime = 0;
        }

        play() {
            globalThis.__audioPlayCalls.push(this.src);
            return Promise.resolve();
        }

        pause() {}
    };

    globalThis.localStorage = {
        getItem() {
            return null;
        },
        setItem() {},
    };
}

async function loadRuntime() {
    installBrowserStubs();
    const [{ createTetrisRuntime }, { INPUT_ACTION }] = await Promise.all([
        import("../src/client/game/runtime/tetris.ts"),
        import("../src/client/game/runtime/input.ts"),
    ]);

    return { createTetrisRuntime, INPUT_ACTION };
}

function waitForTick(game, targetTick) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const timer = setInterval(() => {
            if (game.runtime.currentTick >= targetTick) {
                clearInterval(timer);
                resolve();
                return;
            }

            if (Date.now() - startedAt > 200) {
                clearInterval(timer);
                reject(new Error(`Timed out waiting for tick ${targetTick}`));
            }
        }, 5);
    });
}

function createFakeElement(tagName = "div") {
    const element = {
        tagName,
        children: [],
        textContent: "",
        _className: "",
        append(...nodes) {
            nodes.forEach(node => {
                if (node && typeof node === "object") {
                    node.parentElement = this;
                }
            });
            this.children.push(...nodes);
        },
        get offsetWidth() {
            return 0;
        },
    };

    Object.defineProperty(element, "className", {
        get() {
            return this._className;
        },
        set(value) {
            this._className = value;
        },
    });

    Object.defineProperty(element, "innerHTML", {
        get() {
            return "";
        },
        set() {
            this.children = [];
        },
    });

    element.classList = {
        add(...classNames) {
            const current = new Set(element.className.split(" ").filter(Boolean));
            classNames.forEach(className => current.add(className));
            element.className = [...current].join(" ");
        },
        remove(...classNames) {
            const removed = new Set(classNames);
            const current = element.className.split(" ").filter(Boolean);
            element.className = current.filter(className => !removed.has(className)).join(" ");
        },
        contains(className) {
            return element.className.split(" ").filter(Boolean).includes(className);
        },
    };

    return element;
}

function installDocumentStub() {
    globalThis.document = {
        createElement: createFakeElement,
    };
}

function countPreviewCells(element) {
    let count = 0;

    function visit(node) {
        if (!node || !Array.isArray(node.children)) return;
        if (typeof node.className === "string" && node.className.includes("preview")) {
            count++;
        }
        node.children.forEach(visit);
    }

    visit(element);
    return count;
}

function createEmptyBoard() {
    return Array.from({ length: 20 }, () => Array(10).fill(null));
}

async function advanceAutomaticGravity(game) {
    const targetTick = game.runtime.currentTick + 1;
    game.runtime.gravityAccumulatorMs = 500;
    await waitForTick(game, targetTick);
}

function createFakeCanvas() {
    const canvas = {};
    const context = {
        canvas,
        beginPath() {},
        clearRect() {},
        fill() {},
        fillRect() {},
        lineTo() {},
        moveTo() {},
        restore() {},
        roundRect() {},
        save() {},
        scale() {},
        stroke() {},
        translate() {},
    };
    canvas.getContext = () => context;
    return canvas;
}

test("enqueueInput은 현재 조각과 다른 pieceIndex 입력을 적용하지 않는다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const outcomes = [];
    const game = createTetrisRuntime({
        rng: () => 0,
        inputOutcomeRecorder(outcome) {
            outcomes.push(outcome);
        },
    });
    t.after(() => game.destroy());

    game.init({ autoStart: true });

    const before = game.getSnapshot();
    const targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.MOVE_LEFT, targetTick, before.pieceIndex + 1);

    await waitForTick(game, targetTick);

    const after = game.getSnapshot();
    assert.equal(after.activePiece.col, before.activePiece.col);
    assert.equal(after.pieceIndex, before.pieceIndex);
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].applied, false);
    assert.equal(outcomes[0].reason, "PIECE_INDEX_MISMATCH");
    assert.deepEqual(outcomes[0].activePieceBefore, before.activePiece);
    assert.deepEqual(outcomes[0].activePieceAfter, before.activePiece);
});

test("enqueueInput은 현재 조각과 같은 pieceIndex 입력을 적용한다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const outcomes = [];
    const game = createTetrisRuntime({
        rng: () => 0,
        inputOutcomeRecorder(outcome) {
            outcomes.push(outcome);
        },
    });
    t.after(() => game.destroy());

    game.init({ autoStart: true });

    const before = game.getSnapshot();
    const targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.MOVE_LEFT, targetTick, before.pieceIndex);

    await waitForTick(game, targetTick);

    const after = game.getSnapshot();
    assert.equal(after.activePiece.col, before.activePiece.col - 1);
    assert.equal(after.pieceIndex, before.pieceIndex);
    assert.equal(outcomes.length, 1);
    assert.deepEqual(outcomes[0], {
        input: {
            action: INPUT_ACTION.MOVE_LEFT,
            tick: targetTick,
            pieceIndex: before.pieceIndex,
        },
        applied: true,
        placementCommitted: false,
        reason: null,
        activePieceBefore: before.activePiece,
        activePieceAfter: after.activePiece,
    });
});

test("벽에 막힌 move_left는 applied false outcome을 남긴다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const outcomes = [];
    const game = createTetrisRuntime({
        rng: () => 0,
        inputOutcomeRecorder(outcome) {
            outcomes.push(outcome);
        },
    });
    t.after(() => game.destroy());

    game.init({ autoStart: true });
    const baseSnapshot = game.getSnapshot();
    const activePiece = {
        pieceType: "square",
        rotation: 0,
        row: 0,
        col: 0,
    };
    game.applySnapshot({
        ...baseSnapshot,
        board: createEmptyBoard(),
        activePiece,
        pieceQueue: ["bar", "tree"],
        phase: "playing",
    }, { resumeGravity: true });
    const targetTick = game.runtime.currentTick + 1;

    game.enqueueInput(INPUT_ACTION.MOVE_LEFT, targetTick, game.runtime.pieceIndex);
    await waitForTick(game, targetTick);

    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].applied, false);
    assert.equal(outcomes[0].reason, "MOVE_RETRY");
    assert.deepEqual(outcomes[0].activePieceBefore, activePiece);
    assert.deepEqual(outcomes[0].activePieceAfter, activePiece);
});

test("enqueueInput은 pieceIndex가 없는 로컬 입력을 기존처럼 적용한다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    game.init({ autoStart: true });

    const before = game.getSnapshot();
    const targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.MOVE_LEFT, targetTick);

    await waitForTick(game, targetTick);

    const after = game.getSnapshot();
    assert.equal(after.activePiece.col, before.activePiece.col - 1);
    assert.equal(after.pieceIndex, before.pieceIndex);
});

test("enqueueInput은 soft drop 입력으로 현재 조각을 한 칸 내린다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const outcomes = [];
    const game = createTetrisRuntime({
        rng: () => 0,
        inputOutcomeRecorder(outcome) {
            outcomes.push(outcome);
        },
    });
    t.after(() => game.destroy());

    game.init({ autoStart: true });

    const before = game.getSnapshot();
    const targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.SOFT_DROP, targetTick, before.pieceIndex);

    await waitForTick(game, targetTick);

    const after = game.getSnapshot();
    assert.equal(after.activePiece.row, before.activePiece.row + 1);
    assert.equal(outcomes[0].applied, true);
    assert.equal(outcomes[0].placementCommitted, false);
});

test("automatic gravity는 첫 blocked에서 대기하고 같은 조각의 두 번째 blocked에서 lock한다", async (t) => {
    const { createTetrisRuntime } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    game.init({ autoStart: true });
    const initialSnapshot = game.getSnapshot();
    const groundedPiece = {
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 4,
    };
    game.applySnapshot({
        ...initialSnapshot,
        board: createEmptyBoard(),
        activePiece: groundedPiece,
        pieceQueue: ["bar", "tree"],
        phase: "playing",
    }, { resumeGravity: true });
    const pieceIndex = game.runtime.pieceIndex;

    await advanceAutomaticGravity(game);

    const afterFirstBlocked = game.getSnapshot();
    assert.deepEqual(afterFirstBlocked.activePiece, groundedPiece);
    assert.equal(afterFirstBlocked.pieceIndex, pieceIndex);
    assert.equal(afterFirstBlocked.board.flat().includes("square"), false);
    assert.equal(game.runtime.automaticGroundedPieceIndex, pieceIndex);

    await advanceAutomaticGravity(game);

    const afterSecondBlocked = game.getSnapshot();
    assert.equal(afterSecondBlocked.pieceIndex, pieceIndex + 1);
    assert.equal(afterSecondBlocked.activePiece.pieceType, "bar");
    assert.equal(game.runtime.automaticGroundedPieceIndex, null);
    assert.deepEqual(
        afterSecondBlocked.board.slice(18).map(row => row.slice(4, 6)),
        [["square", "square"], ["square", "square"]],
    );
});

test("automatic gravity move는 grounded marker를 해제해 새 바닥에서 다시 grace를 준다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    game.init({ autoStart: true });
    const ledgeBoard = createEmptyBoard();
    ledgeBoard[19][5] = "stack";
    const ledgePiece = {
        pieceType: "square",
        rotation: 0,
        row: 17,
        col: 4,
    };
    game.applySnapshot({
        ...game.getSnapshot(),
        board: ledgeBoard,
        activePiece: ledgePiece,
        pieceQueue: ["bar", "tree"],
        phase: "playing",
    }, { resumeGravity: true });
    const pieceIndex = game.runtime.pieceIndex;

    await advanceAutomaticGravity(game);
    assert.equal(game.getSnapshot().pieceIndex, pieceIndex);
    assert.equal(game.runtime.automaticGroundedPieceIndex, pieceIndex);

    const moveTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.MOVE_LEFT, moveTick, pieceIndex);
    await waitForTick(game, moveTick);
    assert.equal(game.getSnapshot().activePiece.col, 3);

    await advanceAutomaticGravity(game);
    assert.equal(game.getSnapshot().activePiece.row, 18);
    assert.equal(game.runtime.automaticGroundedPieceIndex, null);

    await advanceAutomaticGravity(game);
    assert.equal(game.getSnapshot().pieceIndex, pieceIndex);
    assert.equal(game.getSnapshot().board.flat().includes("square"), false);
    assert.equal(game.runtime.automaticGroundedPieceIndex, pieceIndex);

    await advanceAutomaticGravity(game);
    assert.equal(game.getSnapshot().pieceIndex, pieceIndex + 1);
    assert.equal(game.getSnapshot().activePiece.pieceType, "bar");
    assert.equal(game.runtime.automaticGroundedPieceIndex, null);
});

test("enqueueInput은 rotate 입력으로 현재 조각을 회전한다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const outcomes = [];
    const game = createTetrisRuntime({
        rng: () => 0,
        inputOutcomeRecorder(outcome) {
            outcomes.push(outcome);
        },
    });
    t.after(() => game.destroy());

    game.init({ autoStart: true });

    const before = game.getSnapshot();
    const targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.ROTATE, targetTick, before.pieceIndex);

    await waitForTick(game, targetTick);

    const after = game.getSnapshot();
    assert.equal(after.activePiece.rotation, (before.activePiece.rotation + 1) % 4);
    assert.equal(outcomes[0].applied, true);
    assert.equal(outcomes[0].reason, null);
});

test("wall kick 회전 성공은 applied true outcome을 남긴다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const outcomes = [];
    const game = createTetrisRuntime({
        rng: () => 0,
        inputOutcomeRecorder(outcome) {
            outcomes.push(outcome);
        },
    });
    t.after(() => game.destroy());

    game.init({ autoStart: true });
    const baseSnapshot = game.getSnapshot();
    game.applySnapshot({
        ...baseSnapshot,
        board: createEmptyBoard(),
        activePiece: {
            pieceType: "tree",
            rotation: 1,
            row: 0,
            col: -1,
        },
        pieceQueue: ["bar", "square"],
        phase: "playing",
    }, { resumeGravity: true });
    const targetTick = game.runtime.currentTick + 1;

    game.enqueueInput(INPUT_ACTION.ROTATE, targetTick, game.runtime.pieceIndex);
    await waitForTick(game, targetTick);

    assert.equal(outcomes[0].applied, true);
    assert.equal(outcomes[0].reason, null);
    assert.equal(outcomes[0].activePieceAfter.rotation, 2);
    assert.equal(outcomes[0].activePieceAfter.col, 0);
});

test("모든 wall kick이 막힌 rotate는 applied false outcome을 남긴다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const outcomes = [];
    const game = createTetrisRuntime({
        rng: () => 0,
        inputOutcomeRecorder(outcome) {
            outcomes.push(outcome);
        },
    });
    t.after(() => game.destroy());

    game.init({ autoStart: true });
    const activePiece = {
        pieceType: "tree",
        rotation: 0,
        row: 4,
        col: 3,
    };
    const blockedBoard = Array.from({ length: 20 }, () => Array(10).fill("garbage"));
    for (const [row, col] of [[4, 4], [5, 3], [5, 4], [5, 5]]) {
        blockedBoard[row][col] = null;
    }
    game.applySnapshot({
        ...game.getSnapshot(),
        board: blockedBoard,
        activePiece,
        pieceQueue: ["bar", "square"],
        phase: "playing",
    }, { resumeGravity: true });
    const targetTick = game.runtime.currentTick + 1;

    game.enqueueInput(INPUT_ACTION.ROTATE, targetTick, game.runtime.pieceIndex);
    await waitForTick(game, targetTick);

    assert.equal(outcomes[0].applied, false);
    assert.equal(outcomes[0].reason, "MOVE_RETRY");
    assert.deepEqual(outcomes[0].activePieceAfter, activePiece);
});

test("soft_drop lock과 hard_drop은 applied true outcome을 남긴다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();

    await t.test("soft_drop lock", async () => {
        const outcomes = [];
        const game = createTetrisRuntime({
            rng: () => 0,
            inputOutcomeRecorder(outcome) {
                outcomes.push(outcome);
            },
        });
        try {
            game.init({ autoStart: true });
            game.applySnapshot({
                ...game.getSnapshot(),
                board: createEmptyBoard(),
                activePiece: {
                    pieceType: "square",
                    rotation: 0,
                    row: 18,
                    col: 4,
                },
                pieceQueue: ["bar", "tree"],
                phase: "playing",
            }, { resumeGravity: true });
            const pieceIndex = game.runtime.pieceIndex;
            const targetTick = game.runtime.currentTick + 1;

            game.enqueueInput(INPUT_ACTION.SOFT_DROP, targetTick, pieceIndex);
            await waitForTick(game, targetTick);

            assert.equal(outcomes[0].applied, true);
            assert.equal(outcomes[0].placementCommitted, true);
            assert.equal(outcomes[0].reason, null);
            assert.equal(outcomes[0].input.pieceIndex, pieceIndex);
        } finally {
            game.destroy();
        }
    });

    await t.test("hard_drop", async () => {
        const outcomes = [];
        const game = createTetrisRuntime({
            rng: () => 0,
            inputOutcomeRecorder(outcome) {
                outcomes.push(outcome);
            },
        });
        try {
            game.init({ autoStart: true });
            const pieceIndex = game.runtime.pieceIndex;
            const targetTick = game.runtime.currentTick + 1;

            game.enqueueInput(INPUT_ACTION.HARD_DROP, targetTick, pieceIndex);
            await waitForTick(game, targetTick);

            assert.equal(outcomes[0].applied, true);
            assert.equal(outcomes[0].placementCommitted, true);
            assert.equal(outcomes[0].reason, null);
            assert.equal(outcomes[0].input.pieceIndex, pieceIndex);
        } finally {
            game.destroy();
        }
    });
});

test("정상 hold는 true이고 같은 drop의 두 번째 hold는 false다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const outcomes = [];
    const game = createTetrisRuntime({
        rng: () => 0,
        inputOutcomeRecorder(outcome) {
            outcomes.push(outcome);
        },
    });
    t.after(() => game.destroy());

    game.init({ autoStart: true });
    const pieceIndex = game.runtime.pieceIndex;
    const targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.HOLD, targetTick, pieceIndex);
    game.enqueueInput(INPUT_ACTION.HOLD, targetTick, pieceIndex);
    game.runtime.automaticGroundedPieceIndex = pieceIndex;

    await waitForTick(game, targetTick);

    assert.deepEqual(outcomes.map(outcome => ({
        applied: outcome.applied,
        placementCommitted: outcome.placementCommitted,
        reason: outcome.reason,
    })), [
        { applied: true, placementCommitted: false, reason: null },
        { applied: false, placementCommitted: false, reason: "HOLD_NOT_AVAILABLE" },
    ]);
    assert.equal(game.runtime.automaticGroundedPieceIndex, null);
});

test("enqueueInput은 같은 tick에 과도하게 입력을 쌓지 않는다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    game.init({ autoStart: true });

    const snapshot = game.getSnapshot();
    const targetTick = game.runtime.currentTick + 1;
    const acceptedInputs = [
        game.enqueueInput(INPUT_ACTION.MOVE_LEFT, targetTick, snapshot.pieceIndex),
        game.enqueueInput(INPUT_ACTION.MOVE_LEFT, targetTick, snapshot.pieceIndex),
        game.enqueueInput(INPUT_ACTION.MOVE_LEFT, targetTick, snapshot.pieceIndex),
        game.enqueueInput(INPUT_ACTION.MOVE_LEFT, targetTick, snapshot.pieceIndex),
    ];
    const rejectedInput = game.enqueueInput(INPUT_ACTION.MOVE_LEFT, targetTick, snapshot.pieceIndex);

    assert.equal(acceptedInputs.every(Boolean), true);
    assert.equal(rejectedInput, null);
});

test("applySnapshot은 snapshot의 pieceIndex를 runtime에 반영한다", async (t) => {
    const { createTetrisRuntime } = await loadRuntime();
    const scoreEl = createFakeElement();
    const linesEl = createFakeElement();
    const game = createTetrisRuntime({
        scoreEl,
        linesEl,
        rng: () => 0,
    });
    t.after(() => game.destroy());

    game.init({ autoStart: false });

    const before = game.getSnapshot();
    game.runtime.automaticGroundedPieceIndex = before.pieceIndex;
    game.applySnapshot({
        ...before,
        score: 40,
        lines: 3,
        tick: before.tick + 10,
        pieceIndex: before.pieceIndex + 3,
    });

    const after = game.getSnapshot();
    assert.equal(after.score, 40);
    assert.equal(after.lines, 3);
    assert.equal(scoreEl.innerText, 40);
    assert.equal(linesEl.innerText, 3);
    assert.equal(after.tick, before.tick + 10);
    assert.equal(after.pieceIndex, before.pieceIndex + 3);
    assert.equal(game.runtime.pieceIndex, before.pieceIndex + 3);
    assert.equal(game.runtime.automaticGroundedPieceIndex, null);
});

test("applySnapshot은 resumeGravity 옵션과 playing phase가 함께 있을 때만 중력을 재개한다", async (t) => {
    const { createTetrisRuntime } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    game.init({ autoStart: true });
    game.applySnapshot({
        ...game.getSnapshot(),
        phase: "playing",
    }, { resumeGravity: true });

    assert.equal(game.runtime.gravityRunning, true);
});

test("line clear presentation은 gameplay state와 중력을 바꾸지 않고 효과음 없이 끝난다", async (t) => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    const originalGetComputedStyle = globalThis.getComputedStyle;
    let animationCallback = null;
    globalThis.requestAnimationFrame = (callback) => {
        animationCallback = callback;
        return 1;
    };
    globalThis.cancelAnimationFrame = () => {};
    globalThis.getComputedStyle = () => ({
        getPropertyValue() {
            return "";
        },
    });
    t.after(() => {
        globalThis.requestAnimationFrame = originalRequestAnimationFrame;
        globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
        globalThis.getComputedStyle = originalGetComputedStyle;
    });

    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({
        boardCanvasEl: createFakeCanvas(),
        rng: () => 0,
    });
    t.after(() => game.destroy());
    game.init({ autoStart: false });
    const pieceIndex = game.getSnapshot().pieceIndex;
    game.enqueueInput(INPUT_ACTION.MOVE_LEFT, 10, pieceIndex);
    const stateBefore = game.getSnapshot();
    const pendingInputCountBefore = game.getPendingInputCount();
    const boardBeforeClear = createEmptyBoard();
    boardBeforeClear[19] = Array(10).fill("bar");
    const audioCallCountBefore = globalThis.__audioPlayCalls.length;

    const didPlay = game.playLineClearPresentation({
        rows: [19],
        board: boardBeforeClear,
    });

    assert.equal(didPlay, true);
    assert.deepEqual(game.getSnapshot(), stateBefore);
    assert.equal(game.getPendingInputCount(), pendingInputCountBefore);
    assert.equal(game.runtime.gravityRunning, false);
    assert.equal(globalThis.__audioPlayCalls.length, audioCallCountBefore);

    animationCallback(performance.now() + 400);

    assert.deepEqual(game.getSnapshot(), stateBefore);
    assert.equal(game.getPendingInputCount(), pendingInputCountBefore);
    assert.equal(game.runtime.gravityRunning, false);
    assert.equal(globalThis.__audioPlayCalls.length, audioCallCountBefore);
});

test("authoritative correction은 local tick을 되감거나 이전 입력으로 새 hard drop을 막지 않는다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    game.init({ autoStart: true });
    const correctionBase = {
        ...game.getSnapshot(),
        board: createEmptyBoard(),
        activePiece: {
            pieceType: "square",
            rotation: 0,
            row: 0,
            col: 4,
        },
        pieceQueue: ["bar", "tree"],
        phase: "playing",
        tick: 100,
        pieceIndex: 5,
    };
    game.applySnapshot(correctionBase, { resumeGravity: true });
    game.enqueueInput(INPUT_ACTION.MOVE_LEFT, null, 5);

    game.applySnapshot({
        ...correctionBase,
        tick: 1,
    }, { resumeGravity: true });
    const hardDropInput = game.enqueueInput(INPUT_ACTION.HARD_DROP, null, 5);

    assert.ok(hardDropInput.tick > 100);
    await waitForTick(game, hardDropInput.tick);
    assert.equal(game.getSnapshot().board[18][3], "square");
});

test("playing authoritative correction은 중단된 local input loop를 복구한다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    game.init({ autoStart: true });
    game.stop();
    game.applySnapshot({
        ...game.getSnapshot(),
        board: createEmptyBoard(),
        activePiece: {
            pieceType: "square",
            rotation: 0,
            row: 0,
            col: 4,
        },
        pieceQueue: ["bar", "tree"],
        phase: "playing",
        tick: 20,
        pieceIndex: 3,
    }, { resumeGravity: true });
    const hardDropInput = game.enqueueInput(INPUT_ACTION.HARD_DROP, null, 3);

    assert.ok(game.runtime.inputTimer);
    await waitForTick(game, hardDropInput.tick);
    assert.equal(game.getSnapshot().board.flat().some(cell => cell === "square"), true);
});

test("applySnapshot은 gameOver snapshot에서 resumeGravity 요청을 무시한다", async (t) => {
    const { createTetrisRuntime } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    game.init({ autoStart: true });
    game.applySnapshot({
        ...game.getSnapshot(),
        phase: "gameOver",
    }, { resumeGravity: true });

    assert.equal(game.runtime.gravityRunning, false);
});

test("forced snapshot은 stale inputQueue와 진행 중 line clear callback을 무효화한다", async (t) => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    const originalGetComputedStyle = globalThis.getComputedStyle;
    const animationCallbacks = new Map();
    let nextAnimationFrameId = 1;
    globalThis.requestAnimationFrame = (callback) => {
        const frameId = nextAnimationFrameId;
        nextAnimationFrameId += 1;
        animationCallbacks.set(frameId, callback);
        return frameId;
    };
    globalThis.cancelAnimationFrame = (frameId) => {
        animationCallbacks.delete(frameId);
    };
    globalThis.getComputedStyle = () => ({
        getPropertyValue() {
            return "";
        },
    });
    t.after(() => {
        globalThis.requestAnimationFrame = originalRequestAnimationFrame;
        globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
        globalThis.getComputedStyle = originalGetComputedStyle;
    });

    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({
        boardCanvasEl: createFakeCanvas(),
        rng: () => 0,
    });
    t.after(() => game.destroy());

    const board = createEmptyBoard();
    board[19] = Array(10).fill("bar");
    board[19][4] = null;
    board[19][5] = null;
    game.init({ autoStart: true });
    game.applySnapshot({
        ...game.getSnapshot(),
        board,
        activePiece: {
            pieceType: "square",
            rotation: 0,
            row: 18,
            col: 4,
        },
        pieceQueue: ["bar", "tree"],
        phase: "playing",
        tick: 40,
        pieceIndex: 8,
    }, { resumeGravity: true });
    const targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.SOFT_DROP, targetTick, 8);
    await waitForTick(game, targetTick);

    assert.equal(game.getSnapshot().phase, "lineClearing");
    const staleAnimationCallback = [...animationCallbacks.values()][0];
    assert.equal(typeof staleAnimationCallback, "function");

    const authoritativeBoard = createEmptyBoard();
    authoritativeBoard[19][9] = "garbage";
    game.applySnapshot({
        ...game.getSnapshot(),
        board: authoritativeBoard,
        activePiece: {
            pieceType: "tree",
            rotation: 0,
            row: 2,
            col: 3,
        },
        inputQueue: [{ action: "move_left", tick: 999, pieceIndex: 8 }],
        phase: "playing",
        score: 7,
        lines: 0,
        tick: 50,
        pieceIndex: 8,
    }, {
        resumeGravity: true,
        clearInputQueue: true,
        cancelPresentation: true,
    });
    const correctedSnapshot = game.getSnapshot();

    staleAnimationCallback(performance.now() + 400);

    assert.deepEqual(game.getSnapshot(), correctedSnapshot);
    assert.deepEqual(game.getSnapshot().board, authoritativeBoard);
    assert.equal(game.getPendingInputCount(), 0);
    assert.equal(game.runtime.gravityRunning, true);
});

test("server bag runtime은 authoritative pieceQueue 적용 시 숨은 대기 queue를 중복 보존하지 않는다", async (t) => {
    const { createTetrisRuntime } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    game.init({
        autoStart: true,
        serverBagChunks: [["tree", "bar", "square", "zee", "eleft", "eright", "ess"]],
    });
    game.applySnapshot({
        ...game.getSnapshot(),
        pieceQueue: ["square", "zee"],
    }, { resumeGravity: true });

    assert.equal(game.getServerBagRemainingCount(), 2);
    assert.equal(game.runtime.gravityRunning, true);
});

test("runtime은 next와 hold preview DOM을 렌더링한다", async (t) => {
    installDocumentStub();
    const { createTetrisRuntime } = await loadRuntime();
    const nextPreviewEl = createFakeElement();
    const holdPreviewEl = createFakeElement();
    const game = createTetrisRuntime({
        nextPreviewEl,
        holdPreviewEl,
        rng: () => 0,
    });
    t.after(() => game.destroy());

    game.init({ autoStart: false });
    const before = game.getSnapshot();
    game.applySnapshot({
        ...before,
        pieceQueue: ["bar", "square"],
        holdPieceType: "tree",
    });

    assert.equal(nextPreviewEl.children.length, 2);
    assert.equal(holdPreviewEl.children.length, 1);
    assert.equal(countPreviewCells(nextPreviewEl) > 0, true);
    assert.equal(countPreviewCells(holdPreviewEl) > 0, true);
});

test("authoritative snapshot 이후 placement_decision은 시작 조각과 최종 배치를 분리한다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const placementLogs = [];
    const game = createTetrisRuntime({
        mode: "multi",
        gameId: "game-001",
        roomId: "room-001",
        playerId: "player-001",
        placementDecisionRecorder(log) {
            placementLogs.push(log);
        },
        rng: () => 0,
    });
    t.after(() => game.destroy());

    game.init({ autoStart: true });
    game.applySnapshot({
        ...game.getSnapshot(),
        board: createEmptyBoard(),
        activePiece: {
            pieceType: "square",
            rotation: 0,
            row: 10,
            col: 4,
        },
        pendingPiece: {
            pieceType: "square",
            rotation: 0,
            row: 10,
            col: 4,
        },
        pieceQueue: ["bar", "tree"],
        holdPieceType: "zee",
        tick: 30,
        pieceIndex: 7,
        score: 100,
        phase: "playing",
    });

    const targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.HARD_DROP, targetTick, 7);

    await waitForTick(game, targetTick);

    const [log] = placementLogs;
    assert.equal(placementLogs.length, 1);
    assert.equal(log.eventType, "placement_decision");
    assert.equal(log.schemaVersion, 2);
    assert.equal(log.mode, "multi");
    assert.equal(log.gameId, "game-001");
    assert.equal(log.roomId, "room-001");
    assert.equal(log.playerId, "player-001");
    assert.equal(log.source, "human");
    assert.equal(log.modelType, null);
    assert.equal(log.tick, targetTick);
    assert.equal(log.pieceIndex, 7);
    assert.equal(log.boardBefore[18][4], null);
    assert.equal(log.boardAfter[18][4], "square");
    assert.equal(log.boardAfter[19][5], "square");
    assert.equal(log.activePiece.pieceType, "square");
    assert.equal(log.activePiece.row, 10);
    assert.equal(log.activePiece.col, 4);
    assert.deepEqual(log.nextQueue, ["bar", "tree"]);
    assert.equal(log.holdPiece, "zee");
    assert.deepEqual(log.inputSequence.map(input => input.action), [INPUT_ACTION.HARD_DROP]);
    assert.equal(log.inputSequence[0].pieceIndex, 7);
    assert.equal(log.selectedPlacement.pieceType, "square");
    assert.equal(log.selectedPlacement.row, 18);
    assert.equal(log.selectedPlacement.col, 4);
    assert.equal(log.placementResult.linesCleared, 0);
    assert.equal(log.placementResult.scoreBefore, 100);
    assert.equal(log.placementResult.scoreAfter, 116);
    assert.equal(log.placementResult.scoreDelta, 16);
    assert.equal(log.placementResult.gameOver, false);
    assert.deepEqual(log.metricsBefore.columnHeights, Array(10).fill(0));
    assert.equal(log.metricsAfter.aggregateHeight, 4);
    assert.equal(Number.isFinite(log.evaluation.score), true);
    assert.equal(log.evaluation.candidateCount > 0, true);
    assert.ok(log.evaluation.reason);
    assert.ok(log.aiComparison.heuristicPlacement);
    assert.equal(Number.isFinite(log.aiComparison.heuristicScore), true);
    assert.equal(log.aiComparison.userScore, log.evaluation.score);
    assert.equal(
        log.aiComparison.betterBy,
        log.aiComparison.heuristicScore - log.aiComparison.userScore,
    );
    assert.equal(typeof log.aiComparison.samePlacement, "boolean");
    assert.equal(validatePlacementDecisionLog(log).ok, true);
});

test("일반 spawn 후 hard drop 로그는 spawn 상태와 최종 locked 위치를 기록한다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({
        mode: "multi",
        gameId: "game-spawn",
        roomId: "room-spawn",
        playerId: "player-spawn",
        rng: () => 0,
    });
    t.after(() => game.destroy());

    game.init({ autoStart: true });
    const spawnedPiece = game.getSnapshot().activePiece;
    const targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.HARD_DROP, targetTick, game.runtime.pieceIndex);

    await waitForTick(game, targetTick);

    const [log] = game.getPlacementDecisionLog();
    assert.equal(log.schemaVersion, 2);
    assert.deepEqual(
        {
            pieceType: log.activePiece.pieceType,
            rotation: log.activePiece.rotation,
            row: log.activePiece.row,
            col: log.activePiece.col,
        },
        spawnedPiece,
    );
    assert.equal(log.activePiece.row, -1);
    assert.equal(log.activePiece.col, 3);
    assert.equal(log.selectedPlacement.pieceType, spawnedPiece.pieceType);
    assert.notEqual(log.selectedPlacement.row, log.activePiece.row);
    assert.equal(validatePlacementDecisionLog(log).ok, true);
});

test("hold 후 로그는 incoming piece의 spawn 상태를 판단 시작 상태로 사용한다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({
        mode: "multi",
        gameId: "game-hold",
        roomId: "room-hold",
        playerId: "player-hold",
    });
    t.after(() => game.destroy());

    game.init({
        autoStart: true,
        serverBagChunks: [["tree", "bar", "square", "zee", "eleft", "eright", "ess"]],
    });
    const pieceIndex = game.runtime.pieceIndex;
    const targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.HOLD, targetTick, pieceIndex);
    game.enqueueInput(INPUT_ACTION.HARD_DROP, targetTick, pieceIndex);

    await waitForTick(game, targetTick);

    const [log] = game.getPlacementDecisionLog();
    assert.equal(log.activePiece.pieceType, "bar");
    assert.equal(log.activePiece.rotation, 0);
    assert.equal(log.activePiece.row, -1);
    assert.equal(log.activePiece.col, 3);
    assert.equal(log.selectedPlacement.pieceType, "bar");
    assert.notEqual(log.selectedPlacement.row, log.activePiece.row);
    assert.deepEqual(
        log.inputSequence.map(input => input.action),
        [INPUT_ACTION.HOLD, INPUT_ACTION.HARD_DROP],
    );
});

test("새 조각 spawn은 이전 조각의 판단 시작 상태를 재사용하지 않는다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({
        mode: "multi",
        gameId: "game-sequence",
        roomId: "room-sequence",
        playerId: "player-sequence",
    });
    t.after(() => game.destroy());

    game.init({
        autoStart: true,
        serverBagChunks: [["tree", "bar", "square", "zee", "eleft", "eright", "ess"]],
    });
    const firstTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.HARD_DROP, firstTick, game.runtime.pieceIndex);
    await waitForTick(game, firstTick);

    const secondStart = game.getSnapshot().activePiece;
    const secondPieceIndex = game.runtime.pieceIndex;
    const secondTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.HARD_DROP, secondTick, secondPieceIndex);
    await waitForTick(game, secondTick);

    const [firstLog, secondLog] = game.getPlacementDecisionLog();
    assert.equal(firstLog.activePiece.pieceType, "tree");
    assert.equal(secondStart.pieceType, "bar");
    assert.deepEqual(
        {
            pieceType: secondLog.activePiece.pieceType,
            rotation: secondLog.activePiece.rotation,
            row: secondLog.activePiece.row,
            col: secondLog.activePiece.col,
        },
        secondStart,
    );
});

test("init reset과 gameOver snapshot은 판단 시작 메타데이터를 정리한다", async (t) => {
    const { createTetrisRuntime } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    game.init({ autoStart: true });
    assert.ok(game.runtime.decisionStartPiece);

    game.init({ autoStart: false });
    assert.equal(game.runtime.decisionStartPiece, null);

    game.applySnapshot({
        ...game.getSnapshot(),
        activePiece: {
            pieceType: "square",
            rotation: 0,
            row: 4,
            col: 3,
        },
        phase: "playing",
    });
    assert.equal(game.runtime.decisionStartPiece.row, 4);

    game.applySnapshot({
        ...game.getSnapshot(),
        phase: "gameOver",
    });
    assert.equal(game.runtime.decisionStartPiece, null);
});

test("판단 시작 상태가 없으면 human 로그는 schemaVersion 1로 fallback한다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({
        mode: "multi",
        gameId: "game-fallback",
        roomId: "room-fallback",
        playerId: "player-fallback",
        rng: () => 0,
    });
    t.after(() => game.destroy());

    game.init({ autoStart: true });
    game.runtime.decisionStartPiece = null;
    const targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.HARD_DROP, targetTick, game.runtime.pieceIndex);

    await waitForTick(game, targetTick);

    const [log] = game.getPlacementDecisionLog();
    assert.equal(log.schemaVersion, 1);
    assert.equal(log.activePiece, undefined);
    assert.ok(log.selectedPlacement);
    assert.equal(log.source, undefined);
    assert.equal(log.evaluation, undefined);
    assert.equal(log.aiComparison, undefined);
    assert.equal(validatePlacementDecisionLog(log).ok, true);
});

test("placement_decision boardAfter는 line clear 반영 후 보드를 저장한다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const scoreEl = createFakeElement();
    const linesEl = createFakeElement();
    const game = createTetrisRuntime({
        scoreEl,
        linesEl,
        rng: () => 0,
    });
    t.after(() => game.destroy());

    const board = createEmptyBoard();
    board[19] = Array(10).fill("bar");
    board[19][4] = null;
    board[19][5] = null;

    game.init({ autoStart: true });
    game.applySnapshot({
        ...game.getSnapshot(),
        board,
        activePiece: {
            pieceType: "square",
            rotation: 0,
            row: 18,
            col: 4,
        },
        pendingPiece: {
            pieceType: "square",
            rotation: 0,
            row: 18,
            col: 4,
        },
        tick: 40,
        pieceIndex: 8,
        score: 0,
        phase: "playing",
    });

    const targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.SOFT_DROP, targetTick, 8);

    await waitForTick(game, targetTick);

    const [log] = game.getPlacementDecisionLog();
    assert.equal(log.boardBefore[19][0], "bar");
    assert.equal(log.boardBefore[19][4], null);
    assert.equal(log.placementResult.linesCleared, 1);
    assert.equal(log.placementResult.scoreBefore, 0);
    assert.equal(log.placementResult.scoreAfter, 10);
    assert.equal(log.placementResult.scoreDelta, 10);
    assert.equal(scoreEl.innerText, 10);
    assert.equal(linesEl.innerText, 1);
    assert.equal(game.getSnapshot().lines, 1);
    assert.equal(log.boardAfter[19][4], "square");
    assert.equal(log.boardAfter[19][5], "square");
});

test("authoritative pending garbage는 incoming 수와 위험 상태를 갱신한다", async (t) => {
    const { createTetrisRuntime } = await loadRuntime();
    const incomingStatEl = createFakeElement();
    const pendingGarbageEl = createFakeElement();
    pendingGarbageEl.parentElement = incomingStatEl;
    const game = createTetrisRuntime({
        rng: () => 0,
        pendingGarbageEl,
    });
    t.after(() => game.destroy());

    game.init({ autoStart: false });
    game.setAuthoritativePendingGarbageLines(3);

    assert.equal(pendingGarbageEl.innerText, 3);
    assert.ok(incomingStatEl.classList.contains("is-danger"));

    game.setAuthoritativePendingGarbageLines(0);

    assert.equal(pendingGarbageEl.innerText, 0);
    assert.equal(incomingStatEl.classList.contains("is-danger"), false);
});

test("placement_decision은 line clear 결과로 garbage attackLines를 기록한다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    const board = createEmptyBoard();
    for (let row = 16; row <= 19; row++) {
        board[row] = Array(10).fill("square");
        board[row][4] = null;
    }

    game.init({ autoStart: true });
    game.applySnapshot({
        ...game.getSnapshot(),
        board,
        activePiece: {
            pieceType: "bar",
            rotation: 1,
            row: 16,
            col: 2,
        },
        pendingPiece: {
            pieceType: "bar",
            rotation: 1,
            row: 16,
            col: 2,
        },
        tick: 50,
        pieceIndex: 9,
        phase: "playing",
    });

    const targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.SOFT_DROP, targetTick, 9);

    await waitForTick(game, targetTick);

    const [log] = game.getPlacementDecisionLog();

    assert.equal(log.placementResult.linesCleared, 4);
    assert.equal(log.placementResult.rawAttackLines, 4);
    assert.equal(log.placementResult.attackLines, 4);
    assert.equal(log.placementResult.canceledGarbageLines, 0);
    assert.equal(log.placementResult.incomingGarbageLines, 0);
    assert.equal(log.placementResult.appliedGarbageLines, 0);
});

test("placement_decision은 T-Spin Single 결과로 garbage attackLines를 기록한다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    const board = createEmptyBoard();
    board[18][4] = "square";
    board[19] = Array(10).fill("square");
    board[19][4] = null;
    board[19][5] = null;
    board[19][6] = null;

    game.init({ autoStart: true });
    game.applySnapshot({
        ...game.getSnapshot(),
        board,
        activePiece: {
            pieceType: "tree",
            rotation: 0,
            row: 18,
            col: 4,
        },
        pendingPiece: {
            pieceType: "tree",
            rotation: 0,
            row: 18,
            col: 4,
        },
        lastActionWasRotation: true,
        tick: 55,
        pieceIndex: 10,
        score: 0,
        phase: "playing",
    });

    const targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.SOFT_DROP, targetTick, 10);

    await waitForTick(game, targetTick);

    const [log] = game.getPlacementDecisionLog();

    assert.equal(log.placementResult.linesCleared, 1);
    assert.equal(log.placementResult.isTSpin, true);
    assert.equal(log.placementResult.rawAttackLines, 2);
    assert.equal(log.placementResult.attackLines, 2);
    assert.equal(log.placementResult.scoreDelta, 50);
});

test("runtime은 back-to-back Tetris bonus를 placementResult에 반영한다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    const firstTetrisBoard = createEmptyBoard();
    for (let row = 16; row <= 19; row++) {
        firstTetrisBoard[row] = Array(10).fill("square");
        firstTetrisBoard[row][4] = null;
    }

    game.init({ autoStart: true });
    game.applySnapshot({
        ...game.getSnapshot(),
        board: firstTetrisBoard,
        activePiece: {
            pieceType: "bar",
            rotation: 1,
            row: 16,
            col: 2,
        },
        pendingPiece: {
            pieceType: "bar",
            rotation: 1,
            row: 16,
            col: 2,
        },
        tick: 75,
        pieceIndex: 12,
        phase: "playing",
    });

    const firstTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.SOFT_DROP, firstTick, 12);

    await waitForTick(game, firstTick);

    game.applySnapshot({
        ...game.getSnapshot(),
        board: createEmptyBoard(),
        activePiece: {
            pieceType: "square",
            rotation: 0,
            row: 18,
            col: 4,
        },
        pendingPiece: {
            pieceType: "square",
            rotation: 0,
            row: 18,
            col: 4,
        },
        tick: game.runtime.currentTick,
        pieceIndex: 13,
        phase: "playing",
    });

    const noClearTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.SOFT_DROP, noClearTick, 13);

    await waitForTick(game, noClearTick);

    const secondTetrisBoard = createEmptyBoard();
    for (let row = 16; row <= 19; row++) {
        secondTetrisBoard[row] = Array(10).fill("square");
        secondTetrisBoard[row][4] = null;
    }

    game.applySnapshot({
        ...game.getSnapshot(),
        board: secondTetrisBoard,
        activePiece: {
            pieceType: "bar",
            rotation: 1,
            row: 16,
            col: 2,
        },
        pendingPiece: {
            pieceType: "bar",
            rotation: 1,
            row: 16,
            col: 2,
        },
        tick: game.runtime.currentTick,
        pieceIndex: 14,
        phase: "playing",
    });

    const secondTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.SOFT_DROP, secondTick, 14);

    await waitForTick(game, secondTick);

    const logs = game.getPlacementDecisionLog();
    const firstLog = logs[0];
    const secondLog = logs[2];

    assert.equal(firstLog.placementResult.rawAttackLines, 4);
    assert.equal(secondLog.placementResult.rawAttackLines, 5);
    assert.equal(secondLog.placementResult.backToBack, true);
});

test("runtime은 일반 line clear로 back-to-back이 끊긴 뒤 다음 Tetris에 bonus를 붙이지 않는다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    function createTetrisBoard() {
        const board = createEmptyBoard();
        for (let row = 16; row <= 19; row++) {
            board[row] = Array(10).fill("square");
            board[row][4] = null;
        }
        return board;
    }

    function createDoubleClearBoard() {
        const board = createEmptyBoard();
        board[18] = Array(10).fill("square");
        board[19] = Array(10).fill("square");
        board[18][4] = null;
        board[18][5] = null;
        board[19][4] = null;
        board[19][5] = null;
        return board;
    }

    async function lockPiece({ board, activePiece, pieceIndex }) {
        game.applySnapshot({
            ...game.getSnapshot(),
            board,
            activePiece,
            pendingPiece: activePiece,
            tick: game.runtime.currentTick,
            pieceIndex,
            phase: "playing",
        });

        const targetTick = game.runtime.currentTick + 1;
        game.enqueueInput(INPUT_ACTION.SOFT_DROP, targetTick, pieceIndex);

        await waitForTick(game, targetTick);
    }

    game.init({ autoStart: true });

    await lockPiece({
        board: createTetrisBoard(),
        activePiece: {
            pieceType: "bar",
            rotation: 1,
            row: 16,
            col: 2,
        },
        pieceIndex: 17,
    });

    await lockPiece({
        board: createDoubleClearBoard(),
        activePiece: {
            pieceType: "square",
            rotation: 0,
            row: 18,
            col: 4,
        },
        pieceIndex: 18,
    });

    await lockPiece({
        board: createEmptyBoard(),
        activePiece: {
            pieceType: "square",
            rotation: 0,
            row: 18,
            col: 4,
        },
        pieceIndex: 19,
    });

    await lockPiece({
        board: createTetrisBoard(),
        activePiece: {
            pieceType: "bar",
            rotation: 1,
            row: 16,
            col: 2,
        },
        pieceIndex: 20,
    });

    const logs = game.getPlacementDecisionLog();
    const firstTetrisLog = logs[0];
    const doubleLog = logs[1];
    const finalTetrisLog = logs[3];

    assert.equal(firstTetrisLog.placementResult.rawAttackLines, 4);
    assert.equal(doubleLog.placementResult.linesCleared, 2);
    assert.equal(doubleLog.placementResult.backToBack, true);
    assert.equal(finalTetrisLog.placementResult.rawAttackLines, 4);
    assert.equal(finalTetrisLog.placementResult.backToBack, false);
});

test("runtime은 combo bonus를 placementResult rawAttackLines에 반영한다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    function createDoubleClearBoard() {
        const board = createEmptyBoard();
        board[18] = Array(10).fill("square");
        board[19] = Array(10).fill("square");
        board[18][4] = null;
        board[18][5] = null;
        board[19][4] = null;
        board[19][5] = null;
        return board;
    }

    game.init({ autoStart: true });
    game.applySnapshot({
        ...game.getSnapshot(),
        board: createDoubleClearBoard(),
        activePiece: {
            pieceType: "square",
            rotation: 0,
            row: 18,
            col: 4,
        },
        pendingPiece: {
            pieceType: "square",
            rotation: 0,
            row: 18,
            col: 4,
        },
        tick: 76,
        pieceIndex: 15,
        phase: "playing",
    });

    const firstTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.SOFT_DROP, firstTick, 15);

    await waitForTick(game, firstTick);

    game.applySnapshot({
        ...game.getSnapshot(),
        board: createDoubleClearBoard(),
        activePiece: {
            pieceType: "square",
            rotation: 0,
            row: 18,
            col: 4,
        },
        pendingPiece: {
            pieceType: "square",
            rotation: 0,
            row: 18,
            col: 4,
        },
        tick: game.runtime.currentTick,
        pieceIndex: 16,
        phase: "playing",
    });

    const secondTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.SOFT_DROP, secondTick, 16);

    await waitForTick(game, secondTick);

    const logs = game.getPlacementDecisionLog();
    const firstLog = logs[0];
    const secondLog = logs[1];

    assert.equal(firstLog.placementResult.linesCleared, 2);
    assert.equal(firstLog.placementResult.rawAttackLines, 1);
    assert.equal(firstLog.placementResult.backToBack, false);
    assert.equal(secondLog.placementResult.linesCleared, 2);
    assert.equal(secondLog.placementResult.rawAttackLines, 2);
    assert.equal(secondLog.placementResult.backToBack, false);
});

test("runtime은 연속 Tetris에 combo와 back-to-back 보너스를 적용한다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    function createTetrisSetupBoard() {
        const board = createEmptyBoard();
        for (let row = 16; row <= 19; row++) {
            board[row] = Array(10).fill("square");
            board[row][4] = null;
        }
        return board;
    }

    game.init({ autoStart: true });
    game.applySnapshot({
        ...game.getSnapshot(),
        board: createTetrisSetupBoard(),
        activePiece: {
            pieceType: "bar",
            rotation: 1,
            row: 16,
            col: 2,
        },
        pendingPiece: {
            pieceType: "bar",
            rotation: 1,
            row: 16,
            col: 2,
        },
        tick: 80,
        pieceIndex: 12,
        phase: "playing",
    });

    const firstTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.SOFT_DROP, firstTick, 12);

    await waitForTick(game, firstTick);

    game.applySnapshot({
        ...game.getSnapshot(),
        board: createTetrisSetupBoard(),
        activePiece: {
            pieceType: "bar",
            rotation: 1,
            row: 16,
            col: 2,
        },
        pendingPiece: {
            pieceType: "bar",
            rotation: 1,
            row: 16,
            col: 2,
        },
        tick: game.runtime.currentTick,
        pieceIndex: 13,
        phase: "playing",
    });

    const secondTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.SOFT_DROP, secondTick, 13);

    await waitForTick(game, secondTick);

    const logs = game.getPlacementDecisionLog();
    const firstLog = logs[0];
    const secondLog = logs[1];

    assert.equal(firstLog.placementResult.rawAttackLines, 4);
    assert.equal(firstLog.placementResult.combo, 0);
    assert.equal(firstLog.placementResult.backToBack, false);
    assert.equal(secondLog.placementResult.rawAttackLines, 6);
    assert.equal(secondLog.placementResult.combo, 1);
    assert.equal(secondLog.placementResult.backToBack, true);
});

test("display bridge는 HUD 불변 이동을 알리지 않고 hold와 hard drop 최종 상태만 알린다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());
    game.init({ autoStart: true });

    const snapshots = [];
    game.subscribeDisplay(() => {
        snapshots.push(game.getDisplaySnapshot());
    });

    let targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.MOVE_LEFT, targetTick, game.runtime.pieceIndex);
    await waitForTick(game, targetTick);
    assert.equal(snapshots.length, 0);

    targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.HOLD, targetTick, game.runtime.pieceIndex);
    await waitForTick(game, targetTick);
    assert.equal(snapshots.length, 1);
    assert.notEqual(snapshots[0].holdPieceType, null);

    snapshots.length = 0;
    targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.HARD_DROP, targetTick, game.runtime.pieceIndex);
    await waitForTick(game, targetTick);
    assert.equal(snapshots.length, 1);
});

test("display bridge는 applySnapshot과 init의 최종 표시 상태만 한 번 알린다", async (t) => {
    const { createTetrisRuntime } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());
    game.init({ autoStart: false });

    let calls = 0;
    game.subscribeDisplay(() => {
        calls += 1;
    });
    game.applySnapshot({
        ...game.getSnapshot(),
        score: 20,
        lines: 2,
        holdPieceType: "tree",
        pieceQueue: ["bar", "square"],
        phase: "gameOver",
    });
    assert.equal(calls, 1);
    assert.deepEqual(game.getDisplaySnapshot(), {
        score: 20,
        lines: 2,
        holdPieceType: "tree",
        nextPieceTypes: ["bar", "square"],
        pendingGarbageLines: 0,
        phase: "gameOver",
    });

    calls = 0;
    game.init({ autoStart: false });
    assert.equal(calls, 1);
    assert.equal(game.getDisplaySnapshot().phase, "playing");
});

test("pending garbage setter와 applySnapshot은 최종 display를 한 번만 알린다", async (t) => {
    const { createTetrisRuntime } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());
    game.init({ autoStart: false });

    const initialSnapshot = game.getDisplaySnapshot();
    let calls = 0;
    game.subscribeDisplay(() => {
        calls += 1;
    });

    game.setAuthoritativePendingGarbageLines(0);
    assert.equal(calls, 0);
    assert.equal(game.getDisplaySnapshot(), initialSnapshot);

    game.setAuthoritativePendingGarbageLines(4);
    assert.equal(calls, 1);
    assert.equal(game.getDisplaySnapshot().pendingGarbageLines, 4);

    calls = 0;
    game.applySnapshot({
        ...game.getSnapshot(),
        score: 40,
        pendingGarbageLines: 2,
    });
    assert.equal(calls, 1);
    assert.equal(game.getDisplaySnapshot().score, 40);
    assert.equal(game.getDisplaySnapshot().pendingGarbageLines, 2);
});

test("비동기 line clear와 server bag 고갈은 lineClearing과 최종 playing을 각각 알린다", async (t) => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    const originalGetComputedStyle = globalThis.getComputedStyle;
    const animationCallbacks = new Map();
    let nextAnimationFrameId = 1;
    globalThis.requestAnimationFrame = (callback) => {
        const frameId = nextAnimationFrameId++;
        animationCallbacks.set(frameId, callback);
        return frameId;
    };
    globalThis.cancelAnimationFrame = frameId => animationCallbacks.delete(frameId);
    globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
    t.after(() => {
        globalThis.requestAnimationFrame = originalRequestAnimationFrame;
        globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
        globalThis.getComputedStyle = originalGetComputedStyle;
    });

    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({
        boardCanvasEl: createFakeCanvas(),
        rng: () => 0,
    });
    t.after(() => game.destroy());

    const board = createEmptyBoard();
    board[19] = Array(10).fill("bar");
    board[19][4] = null;
    board[19][5] = null;
    game.init({ autoStart: true, serverBagChunks: [["square"]] });
    game.applySnapshot({
        ...game.getSnapshot(),
        board,
        activePiece: {
            pieceType: "square",
            rotation: 0,
            row: 18,
            col: 4,
        },
        pendingPiece: {
            pieceType: "square",
            rotation: 0,
            row: 18,
            col: 4,
        },
        pieceQueue: [],
        phase: "playing",
        tick: 90,
        pieceIndex: 20,
    }, { resumeGravity: true });

    const phases = [];
    game.subscribeDisplay(() => {
        phases.push(game.getDisplaySnapshot().phase);
    });
    const targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.SOFT_DROP, targetTick, 20);
    await waitForTick(game, targetTick);

    assert.deepEqual(phases, ["lineClearing"]);
    const animationCallback = [...animationCallbacks.values()][0];
    assert.equal(typeof animationCallback, "function");
    animationCallback(performance.now() + 400);
    assert.deepEqual(phases, ["lineClearing", "playing"]);
    assert.equal(game.getDisplaySnapshot().lines, 1);
});

test("runtime destroy는 중복 호출과 이후 display 변경을 무시한다", async () => {
    const { createTetrisRuntime } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    game.init({ autoStart: false });
    let calls = 0;
    game.subscribeDisplay(() => {
        calls += 1;
    });

    game.destroy();
    game.destroy();
    game.applySnapshot({
        ...game.getSnapshot(),
        score: 100,
        phase: "gameOver",
    });
    assert.equal(calls, 0);
});
