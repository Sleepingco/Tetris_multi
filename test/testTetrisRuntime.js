const test = require("node:test");
const assert = require("node:assert/strict");

function installBrowserStubs() {
    globalThis.Audio = class {
        constructor(src) {
            this.src = src;
            this.loop = false;
            this.volume = 1;
            this.currentTime = 0;
        }

        play() {
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
        import("../src/client/game/runtime/tetris.js"),
        import("../src/client/game/runtime/input.js"),
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

test("enqueueInput은 현재 조각과 다른 pieceIndex 입력을 적용하지 않는다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    game.init({ autoStart: true });

    const before = game.getSnapshot();
    const targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.MOVE_LEFT, targetTick, before.pieceIndex + 1);

    await waitForTick(game, targetTick);

    const after = game.getSnapshot();
    assert.equal(after.activePiece.col, before.activePiece.col);
    assert.equal(after.pieceIndex, before.pieceIndex);
});

test("enqueueInput은 현재 조각과 같은 pieceIndex 입력을 적용한다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    game.init({ autoStart: true });

    const before = game.getSnapshot();
    const targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.MOVE_LEFT, targetTick, before.pieceIndex);

    await waitForTick(game, targetTick);

    const after = game.getSnapshot();
    assert.equal(after.activePiece.col, before.activePiece.col - 1);
    assert.equal(after.pieceIndex, before.pieceIndex);
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
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    game.init({ autoStart: true });

    const before = game.getSnapshot();
    const targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.SOFT_DROP, targetTick, before.pieceIndex);

    await waitForTick(game, targetTick);

    const after = game.getSnapshot();
    assert.equal(after.activePiece.row, before.activePiece.row + 1);
});

test("enqueueInput은 rotate 입력으로 현재 조각을 회전한다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    game.init({ autoStart: true });

    const before = game.getSnapshot();
    const targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.ROTATE, targetTick, before.pieceIndex);

    await waitForTick(game, targetTick);

    const after = game.getSnapshot();
    assert.equal(after.activePiece.rotation, (before.activePiece.rotation + 1) % 4);
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

test("piece lock 시점에 최소 placement_decision 로그를 생성한다", async (t) => {
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
            row: 18,
            col: 4,
        },
        pendingPiece: {
            pieceType: "square",
            rotation: 0,
            row: 18,
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
    game.enqueueInput(INPUT_ACTION.SOFT_DROP, targetTick, 7);

    await waitForTick(game, targetTick);

    const [log] = placementLogs;
    assert.equal(placementLogs.length, 1);
    assert.equal(log.eventType, "placement_decision");
    assert.equal(log.schemaVersion, 1);
    assert.equal(log.mode, "multi");
    assert.equal(log.gameId, "game-001");
    assert.equal(log.roomId, "room-001");
    assert.equal(log.playerId, "player-001");
    assert.equal(log.tick, targetTick);
    assert.equal(log.pieceIndex, 7);
    assert.equal(log.boardBefore[18][4], null);
    assert.equal(log.boardAfter[18][4], "square");
    assert.equal(log.boardAfter[19][5], "square");
    assert.equal(log.activePiece.pieceType, "square");
    assert.equal(log.activePiece.row, 18);
    assert.equal(log.activePiece.col, 4);
    assert.deepEqual(log.nextQueue, ["bar", "tree"]);
    assert.equal(log.holdPiece, "zee");
    assert.deepEqual(log.inputSequence.map(input => input.action), [INPUT_ACTION.SOFT_DROP]);
    assert.equal(log.inputSequence[0].pieceIndex, 7);
    assert.equal(log.selectedPlacement.pieceType, "square");
    assert.equal(log.selectedPlacement.row, 18);
    assert.equal(log.selectedPlacement.col, 4);
    assert.equal(log.placementResult.linesCleared, 0);
    assert.equal(log.placementResult.scoreBefore, 100);
    assert.equal(log.placementResult.scoreAfter, 100);
    assert.equal(log.placementResult.scoreDelta, 0);
    assert.equal(log.placementResult.gameOver, false);
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

test("runtime applyGarbageLines는 board 아래에서 garbage를 올린다", async (t) => {
    const { createTetrisRuntime } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    const board = createEmptyBoard();
    board[18][0] = "bar";

    game.init({ autoStart: false });
    game.applySnapshot({
        ...game.getSnapshot(),
        board,
    });

    const result = game.applyGarbageLines({
        lines: 1,
        holeCol: 4,
    });
    const snapshot = game.getSnapshot();

    assert.equal(result.appliedLines, 1);
    assert.equal(result.overflow, false);
    assert.equal(snapshot.board[17][0], "bar");
    assert.equal(snapshot.board[19][4], null);
    assert.equal(snapshot.board[19][0], "garbage");
    assert.equal(snapshot.board[19][9], "garbage");
});

test("queueGarbageLines는 incoming을 위험 상태로 강조하고 수신 pulse를 남긴다", async (t) => {
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
    game.queueGarbageLines({
        lines: 3,
        holeCol: 4,
    });

    assert.equal(game.getPendingGarbageLines(), 3);
    assert.equal(pendingGarbageEl.innerText, 3);
    assert.ok(incomingStatEl.classList.contains("is-danger"));
    assert.ok(incomingStatEl.classList.contains("is-receiving"));
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
    assert.equal(log.placementResult.attackLines, 4);
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

test("runtime은 pending garbage를 line clear 공격으로 먼저 상쇄한다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const game = createTetrisRuntime({ rng: () => 0 });
    t.after(() => game.destroy());

    const board = createEmptyBoard();
    board[19] = Array(10).fill("square");
    board[19][4] = null;
    board[19][5] = null;

    game.init({ autoStart: true });
    game.queueGarbageLines({
        lines: 2,
        holeCol: 4,
    });
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
        tick: 60,
        pieceIndex: 10,
        phase: "playing",
    });

    const targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.SOFT_DROP, targetTick, 10);

    await waitForTick(game, targetTick);

    const [log] = game.getPlacementDecisionLog();
    const snapshot = game.getSnapshot();

    assert.equal(log.placementResult.linesCleared, 1);
    assert.equal(log.placementResult.rawAttackLines, 0);
    assert.equal(log.placementResult.canceledGarbageLines, 0);
    assert.equal(log.placementResult.appliedGarbageLines, 2);
    assert.equal(log.placementResult.attackLines, 0);
    assert.equal(snapshot.board[19][4], null);
    assert.equal(snapshot.board[19][0], "garbage");
});

test("runtime은 pending garbage보다 공격량이 크면 남은 공격만 전송 대상으로 기록한다", async (t) => {
    const { createTetrisRuntime, INPUT_ACTION } = await loadRuntime();
    const garbageLogEl = createFakeElement();
    const game = createTetrisRuntime({
        rng: () => 0,
        garbageLogEl,
    });
    t.after(() => game.destroy());

    const board = createEmptyBoard();
    for (let row = 16; row <= 19; row++) {
        board[row] = Array(10).fill("square");
        board[row][4] = null;
    }

    game.init({ autoStart: true });
    game.queueGarbageLines({
        lines: 2,
        holeCol: 4,
    });
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
        tick: 70,
        pieceIndex: 11,
        phase: "playing",
    });

    const targetTick = game.runtime.currentTick + 1;
    game.enqueueInput(INPUT_ACTION.SOFT_DROP, targetTick, 11);

    await waitForTick(game, targetTick);

    const [log] = game.getPlacementDecisionLog();

    assert.equal(log.placementResult.rawAttackLines, 4);
    assert.equal(log.placementResult.canceledGarbageLines, 2);
    assert.equal(log.placementResult.appliedGarbageLines, 0);
    assert.equal(log.placementResult.attackLines, 2);
    assert.equal(garbageLogEl.textContent, "Canceled 2");
    assert.ok(garbageLogEl.classList.contains("is-cancel"));
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
