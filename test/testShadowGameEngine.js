const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createShadowSnapshot,
    createInitialShadowState,
    stepAuthoritativeState,
} = require("../src/server/services/shadowGameEngine.js");

test("createInitialShadowState는 server bag으로 첫 activePiece와 preview queue를 만든다", () => {
    const state = createInitialShadowState({
        bagChunks: [["bar", "square", "tree", "zee", "ess", "eleft", "eright"]],
    });

    assert.equal(state.activePiece.pieceType, "bar");
    assert.equal(state.activePiece.row, -1);
    assert.equal(state.activePiece.col, 3);
    assert.deepEqual(state.pieceQueue, ["square", "tree", "zee"]);
    assert.equal(state.pieceIndex, 1);
    assert.equal(state.phase, "playing");
    assert.equal(state.fallIntervalMs, 500);
});

test("createInitialShadowState는 client server bag 모드와 같은 queue buffer 크기를 유지한다", () => {
    const state = createInitialShadowState({
        bagChunks: [["bar", "square", "tree", "zee", "ess", "eleft", "eright"]],
    });

    assert.deepEqual(state.pieceQueue, ["square", "tree", "zee"]);
});

test("stepAuthoritativeState는 move_left 입력으로 activePiece를 왼쪽으로 이동한다", () => {
    const state = createInitialShadowState({
        bagChunks: [["bar", "square", "tree", "zee", "ess", "eleft", "eright"]],
    });

    const nextState = stepAuthoritativeState(state, {
        type: "input",
        action: "move_left",
        tick: 1,
        pieceIndex: 1,
    });

    assert.equal(nextState.activePiece.col, 2);
    assert.equal(nextState.tick, 0);
    assert.equal(nextState.lastClientInputTick, 1);
    assert.equal(nextState.lastClientInputPieceIndex, 1);
    assert.equal(state.activePiece.col, 3);
    assert.equal(state.lastClientInputTick, null);
});

test("stepAuthoritativeState는 hard_drop 입력으로 조각을 고정하고 다음 조각을 스폰한다", () => {
    const state = createInitialShadowState({
        bagChunks: [["bar", "square", "tree", "zee", "ess", "eleft", "eright"]],
    });

    const nextState = stepAuthoritativeState(state, {
        type: "input",
        action: "hard_drop",
        tick: 1,
        pieceIndex: 1,
    });

    assert.equal(nextState.pieceIndex, 2);
    assert.equal(nextState.activePiece.pieceType, "square");
    assert.ok(nextState.board[19].some(cell => cell === "bar"));
    assert.ok(nextState.score > state.score);
    assert.equal(nextState.lastPlacementResult.scoreBefore, 0);
    assert.equal(nextState.lastPlacementResult.scoreAfter, nextState.score);
    assert.equal(
        nextState.lastPlacementResult.scoreDelta,
        nextState.lastPlacementResult.scoreAfter - nextState.lastPlacementResult.scoreBefore,
    );
});

test("stepAuthoritativeState는 line clear가 발생하면 즉시 다음 조각을 스폰하지 않고 lineClearing phase로 둔다", () => {
    const state = createInitialShadowState({
        bagChunks: [["square", "bar", "tree", "zee", "ess", "eleft", "eright"]],
    });
    state.board[18] = ["zee", "zee", "zee", null, null, "zee", "zee", "zee", "zee", "zee"];
    state.board[19] = ["zee", "zee", "zee", null, null, "zee", "zee", "zee", "zee", "zee"];

    const nextState = stepAuthoritativeState(state, {
        type: "input",
        action: "hard_drop",
        tick: 1,
        pieceIndex: 1,
    });

    assert.equal(nextState.phase, "lineClearing");
    assert.equal(nextState.pieceIndex, 1);
    assert.equal(nextState.activePiece.pieceType, "");
    assert.ok(nextState.board[18].every(cell => cell !== null));
    assert.ok(nextState.board[19].every(cell => cell !== null));
});

test("stepAuthoritativeState는 lineClearing phase의 다음 gravity tick에서 줄 삭제와 다음 스폰을 완료한다", () => {
    const state = createInitialShadowState({
        bagChunks: [["square", "bar", "tree", "zee", "ess", "eleft", "eright"]],
    });
    state.board[18] = ["zee", "zee", "zee", null, null, "zee", "zee", "zee", "zee", "zee"];
    state.board[19] = ["zee", "zee", "zee", null, null, "zee", "zee", "zee", "zee", "zee"];

    const lineClearingState = stepAuthoritativeState(state, {
        type: "input",
        action: "hard_drop",
        tick: 1,
        pieceIndex: 1,
    });
    const nextState = stepAuthoritativeState(lineClearingState, {
        type: "gravity",
        tick: 2,
    });

    assert.equal(nextState.phase, "playing");
    assert.equal(nextState.pieceIndex, 2);
    assert.equal(nextState.activePiece.pieceType, "bar");
    assert.deepEqual(nextState.board[18], Array(10).fill(null));
    assert.deepEqual(nextState.board[19], Array(10).fill(null));
});

test("stepAuthoritativeState는 line_clear_complete step으로 줄 삭제와 다음 스폰을 완료한다", () => {
    const state = createInitialShadowState({
        bagChunks: [["square", "bar", "tree", "zee", "ess", "eleft", "eright"]],
    });
    state.board[18] = ["zee", "zee", "zee", null, null, "zee", "zee", "zee", "zee", "zee"];
    state.board[19] = ["zee", "zee", "zee", null, null, "zee", "zee", "zee", "zee", "zee"];

    const lineClearingState = stepAuthoritativeState(state, {
        type: "input",
        action: "hard_drop",
        tick: 1,
        pieceIndex: 1,
    });
    const nextState = stepAuthoritativeState(lineClearingState, {
        type: "line_clear_complete",
        tick: 2,
    });

    assert.equal(nextState.phase, "playing");
    assert.equal(nextState.pieceIndex, 2);
    assert.equal(nextState.activePiece.pieceType, "bar");
    assert.deepEqual(nextState.board[18], Array(10).fill(null));
    assert.deepEqual(nextState.board[19], Array(10).fill(null));
});

test("stepAuthoritativeState는 gravity tick으로 조각을 한 칸 내린다", () => {
    const state = createInitialShadowState({
        bagChunks: [["bar", "square", "tree", "zee", "ess", "eleft", "eright"]],
    });

    const nextState = stepAuthoritativeState(state, {
        type: "gravity",
        tick: 1,
    });

    assert.equal(nextState.activePiece.row, 0);
    assert.equal(nextState.tick, 1);
});

test("stepAuthoritativeState는 성공한 회전 입력을 마지막 회전 액션으로 기록한다", () => {
    const state = createInitialShadowState({
        bagChunks: [["tree", "square", "bar", "zee", "ess", "eleft", "eright"]],
    });

    const rotatedState = stepAuthoritativeState(state, {
        type: "input",
        action: "rotate",
        tick: 1,
        pieceIndex: 1,
    });
    const movedState = stepAuthoritativeState(rotatedState, {
        type: "input",
        action: "move_left",
        tick: 2,
        pieceIndex: 1,
    });

    assert.equal(rotatedState.lastActionWasRotation, true);
    assert.equal(movedState.lastActionWasRotation, false);
});

test("stepAuthoritativeState는 hold 입력으로 스폰된 조각을 마지막 회전 상태로 취급하지 않는다", () => {
    const state = createInitialShadowState({
        bagChunks: [["tree", "square", "bar", "zee", "ess", "eleft", "eright"]],
    });

    const rotatedState = stepAuthoritativeState(state, {
        type: "input",
        action: "rotate",
        tick: 1,
        pieceIndex: 1,
    });
    const heldState = stepAuthoritativeState(rotatedState, {
        type: "input",
        action: "hold",
        tick: 2,
        pieceIndex: 1,
    });

    assert.equal(rotatedState.lastActionWasRotation, true);
    assert.equal(heldState.activePiece.pieceType, "square");
    assert.equal(heldState.holdPieceType, "tree");
    assert.equal(heldState.holdUsedThisDrop, true);
    assert.equal(heldState.lastActionWasRotation, false);
});

test("stepAuthoritativeState는 bar 회전 충돌 시 wall kick을 적용한다", () => {
    const state = createInitialShadowState({
        bagChunks: [["bar", "square", "tree", "zee", "ess", "eleft", "eright"]],
    });
    state.activePiece = {
        pieceType: "bar",
        rotation: 1,
        row: 4,
        col: -1,
    };

    const nextState = stepAuthoritativeState(state, {
        type: "input",
        action: "rotate",
        tick: 1,
        pieceIndex: 1,
    });

    assert.equal(nextState.activePiece.rotation, 2);
    assert.equal(nextState.activePiece.col, 1);
    assert.equal(nextState.lastActionWasRotation, true);
});

test("stepAuthoritativeState는 T-Spin no line lock에 15점을 더한다", () => {
    const state = createInitialShadowState({
        bagChunks: [["tree", "square", "bar", "zee", "ess", "eleft", "eright"]],
    });

    state.activePiece = { pieceType: "tree", rotation: 0, row: 17, col: 3 };
    state.lastActionWasRotation = true;
    state.board[17][3] = "square";
    state.board[17][5] = "square";
    state.board[19][3] = "square";

    const nextState = stepAuthoritativeState(state, {
        type: "input",
        action: "hard_drop",
        tick: 1,
        pieceIndex: 1,
    });

    assert.equal(nextState.score, 15);
    assert.equal(nextState.pieceIndex, 2);
    assert.equal(nextState.activePiece.pieceType, "square");
    assert.equal(nextState.lastActionWasRotation, false);
});

test("stepAuthoritativeState는 T-Spin line clear 점수를 5배로 계산한다", () => {
    const state = createInitialShadowState({
        bagChunks: [["tree", "square", "bar", "zee", "ess", "eleft", "eright"]],
    });

    state.activePiece = { pieceType: "tree", rotation: 0, row: 17, col: 3 };
    state.lastActionWasRotation = true;
    state.board[17][3] = "square";
    state.board[17][5] = "square";
    state.board[19][3] = "square";
    state.board[18] = ["bar", "bar", "bar", null, null, null, "bar", "bar", "bar", "bar"];

    const lineClearingState = stepAuthoritativeState(state, {
        type: "input",
        action: "hard_drop",
        tick: 1,
        pieceIndex: 1,
    });
    const nextState = stepAuthoritativeState(lineClearingState, {
        type: "gravity",
        tick: 2,
    });

    assert.equal(nextState.score, 50);
    assert.equal(nextState.linesClearedTotal, 1);
});

test("stepAuthoritativeState는 garbage step을 pending queue에 추가한다", () => {
    const state = createInitialShadowState({
        bagChunks: [["bar", "square", "tree", "zee", "ess", "eleft", "eright"]],
    });

    const nextState = stepAuthoritativeState(state, {
        type: "garbage",
        lines: 3,
        holeCol: 4,
    });

    assert.deepEqual(nextState.pendingGarbageQueue, [
        { lines: 3, holeCol: 4 },
    ]);
    assert.deepEqual(state.pendingGarbageQueue, []);
});

test("stepAuthoritativeState는 lineClearing 중에도 garbage step을 pending queue에 추가한다", () => {
    const state = createInitialShadowState({
        bagChunks: [["square", "bar", "tree", "zee", "ess", "eleft", "eright"]],
    });
    state.board[18] = ["zee", "zee", "zee", null, null, "zee", "zee", "zee", "zee", "zee"];
    state.board[19] = ["zee", "zee", "zee", null, null, "zee", "zee", "zee", "zee", "zee"];

    const lineClearingState = stepAuthoritativeState(state, {
        type: "input",
        action: "hard_drop",
        tick: 1,
        pieceIndex: 1,
    });
    const nextState = stepAuthoritativeState(lineClearingState, {
        type: "garbage",
        lines: 2,
        holeCol: 5,
    });

    assert.equal(lineClearingState.phase, "lineClearing");
    assert.deepEqual(nextState.pendingGarbageQueue, [
        { lines: 2, holeCol: 5 },
    ]);
});

test("stepAuthoritativeState는 lock 후 남은 pending garbage를 board 아래에 적용한다", () => {
    const state = createInitialShadowState({
        bagChunks: [["square", "bar", "tree", "zee", "ess", "eleft", "eright"]],
    });

    state.activePiece = { pieceType: "square", rotation: 0, row: 17, col: 4 };
    state.pendingGarbageQueue = [{ lines: 2, holeCol: 4 }];

    const nextState = stepAuthoritativeState(state, {
        type: "input",
        action: "hard_drop",
        tick: 1,
        pieceIndex: 1,
    });

    assert.deepEqual(nextState.pendingGarbageQueue, []);
    assert.equal(nextState.board[18][4], null);
    assert.equal(nextState.board[19][4], null);
    assert.equal(nextState.board[18][0], "garbage");
    assert.equal(nextState.board[19][9], "garbage");
});

test("stepAuthoritativeState는 line clear 공격으로 pending garbage를 먼저 상쇄한다", () => {
    const state = createInitialShadowState({
        bagChunks: [["bar", "square", "tree", "zee", "ess", "eleft", "eright"]],
    });

    state.activePiece = { pieceType: "bar", rotation: 1, row: 16, col: 2 };
    state.pendingGarbageQueue = [{ lines: 2, holeCol: 4 }];

    for (let row = 16; row <= 19; row++) {
        state.board[row] = ["bar", "bar", "bar", "bar", null, "bar", "bar", "bar", "bar", "bar"];
    }

    const lineClearingState = stepAuthoritativeState(state, {
        type: "input",
        action: "hard_drop",
        tick: 1,
        pieceIndex: 1,
    });
    const nextState = stepAuthoritativeState(lineClearingState, {
        type: "gravity",
        tick: 2,
    });

    assert.equal(nextState.linesClearedTotal, 4);
    assert.deepEqual(nextState.pendingGarbageQueue, []);
    assert.equal(nextState.board[19].every(cell => cell === null), true);
});

test("stepAuthoritativeState는 line clear 후 마지막 placement 공격 결과를 기록한다", () => {
    const state = createInitialShadowState({
        bagChunks: [["bar", "square", "tree", "zee", "ess", "eleft", "eright"]],
    });

    state.activePiece = { pieceType: "bar", rotation: 1, row: 16, col: 2 };
    for (let row = 16; row <= 19; row++) {
        state.board[row] = ["bar", "bar", "bar", "bar", null, "bar", "bar", "bar", "bar", "bar"];
    }

    const lineClearingState = stepAuthoritativeState(state, {
        type: "input",
        action: "hard_drop",
        tick: 1,
        pieceIndex: 1,
    });
    const nextState = stepAuthoritativeState(lineClearingState, {
        type: "gravity",
        tick: 2,
    });

    assert.deepEqual(nextState.lastPlacementResult, {
        linesCleared: 4,
        isTSpin: false,
        combo: 0,
        backToBack: false,
        rawAttackLines: 4,
        attackLines: 4,
        canceledGarbageLines: 0,
        incomingGarbageLines: 0,
        appliedGarbageLines: 0,
        scoreBefore: 0,
        scoreAfter: 40,
        scoreDelta: 40,
        gameOver: false,
    });
});

test("stepAuthoritativeState는 garbage 상쇄와 적용 결과를 마지막 placement 결과에 기록한다", () => {
    const state = createInitialShadowState({
        bagChunks: [["bar", "square", "tree", "zee", "ess", "eleft", "eright"]],
    });

    state.activePiece = { pieceType: "bar", rotation: 1, row: 16, col: 2 };
    state.pendingGarbageQueue = [{ lines: 6, holeCol: 4 }];
    for (let row = 16; row <= 19; row++) {
        state.board[row] = ["bar", "bar", "bar", "bar", null, "bar", "bar", "bar", "bar", "bar"];
    }

    const lineClearingState = stepAuthoritativeState(state, {
        type: "input",
        action: "hard_drop",
        tick: 1,
        pieceIndex: 1,
    });
    const nextState = stepAuthoritativeState(lineClearingState, {
        type: "gravity",
        tick: 2,
    });

    assert.deepEqual(nextState.lastPlacementResult, {
        linesCleared: 4,
        isTSpin: false,
        combo: 0,
        backToBack: false,
        rawAttackLines: 4,
        attackLines: 0,
        canceledGarbageLines: 4,
        incomingGarbageLines: 6,
        appliedGarbageLines: 2,
        scoreBefore: 0,
        scoreAfter: 40,
        scoreDelta: 40,
        gameOver: false,
    });
});

test("createShadowSnapshot은 마지막 placement 결과를 포함한다", () => {
    const state = createInitialShadowState({
        bagChunks: [["bar", "square", "tree", "zee", "ess", "eleft", "eright"]],
    });

    state.activePiece = { pieceType: "bar", rotation: 1, row: 16, col: 2 };
    for (let row = 16; row <= 19; row++) {
        state.board[row] = ["bar", "bar", "bar", "bar", null, "bar", "bar", "bar", "bar", "bar"];
    }

    const lineClearingState = stepAuthoritativeState(state, {
        type: "input",
        action: "hard_drop",
        tick: 1,
        pieceIndex: 1,
    });
    const nextState = stepAuthoritativeState(lineClearingState, {
        type: "gravity",
        tick: 2,
    });
    const snapshot = createShadowSnapshot(nextState);

    assert.deepEqual(snapshot.lastPlacementResult, nextState.lastPlacementResult);
    assert.notEqual(snapshot.lastPlacementResult, nextState.lastPlacementResult);
});
