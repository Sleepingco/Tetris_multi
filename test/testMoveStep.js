const test = require("node:test");
const assert = require("node:assert/strict");

async function loadMoveStep() {
    const [
        { resolveInputMoveIntent, resolveMoveAttempt, resolveMoveIntent },
        { createEmptyBoard },
        { default: blocks },
        { WALL_KICKS },
    ] = await Promise.all([
        import("../src/client/game/core/step.ts"),
        import("../src/client/game/core/board.ts"),
        import("../src/client/game/state/blocks.ts"),
        import("../src/client/game/state/config.ts"),
    ]);

    return {
        resolveInputMoveIntent,
        resolveMoveAttempt,
        resolveMoveIntent,
        createEmptyBoard,
        blocks,
        wallKicks: WALL_KICKS,
    };
}

test("resolveMoveAttempt는 이동 결과와 다음 pendingPiece를 반환한다", async () => {
    const {
        resolveMoveAttempt,
        resolveMoveIntent,
        createEmptyBoard,
        blocks,
        wallKicks,
    } = await loadMoveStep();
    const board = createEmptyBoard(20, 10);
    const activePiece = {
        pieceType: "tree",
        rotation: 0,
        row: 4,
        col: 3,
    };
    const pendingPiece = {
        ...activePiece,
        col: 4,
    };

    const outcome = resolveMoveAttempt({
        board,
        activePiece,
        pendingPiece,
        moveCause: "horizontal",
        blocks,
        wallKicks,
    });
    const intent = resolveMoveIntent({
        outcome,
        hasFallTimer: true,
    });

    assert.equal(intent.kind, "ok");
    assert.equal(intent.moveCause, "horizontal");
    assert.deepEqual(outcome.pending, pendingPiece);
});

test("resolveMoveAttempt는 입력 activePiece와 pendingPiece를 직접 변경하지 않는다", async () => {
    const {
        resolveMoveAttempt,
        createEmptyBoard,
        blocks,
        wallKicks,
    } = await loadMoveStep();
    const board = createEmptyBoard(20, 10);
    const activePiece = {
        pieceType: "tree",
        rotation: 0,
        row: 4,
        col: 3,
    };
    const pendingPiece = {
        ...activePiece,
        col: 4,
    };
    const beforeActivePiece = { ...activePiece };
    const beforePendingPiece = { ...pendingPiece };

    resolveMoveAttempt({
        board,
        activePiece,
        pendingPiece,
        moveCause: "horizontal",
        blocks,
        wallKicks,
    });

    assert.deepEqual(activePiece, beforeActivePiece);
    assert.deepEqual(pendingPiece, beforePendingPiece);
});

test("resolveMoveAttempt는 막힌 spawn 조각을 active 상태에 남기지 않는다", async () => {
    const {
        resolveMoveAttempt,
        resolveMoveIntent,
        createEmptyBoard,
        blocks,
        wallKicks,
    } = await loadMoveStep();
    const board = createEmptyBoard(20, 10);
    board[0][3] = "stack";
    const spawnedPiece = {
        pieceType: "bar",
        rotation: 0,
        row: -1,
        col: 3,
    };

    const outcome = resolveMoveAttempt({
        board,
        activePiece: spawnedPiece,
        pendingPiece: spawnedPiece,
        moveCause: "spawn",
        blocks,
        wallKicks,
    });
    const intent = resolveMoveIntent({
        outcome,
        hasFallTimer: true,
    });

    assert.equal(outcome.status, "gameOver");
    assert.equal(outcome.active.pieceType, "");
    assert.equal(outcome.pending.pieceType, "");
    assert.equal(intent.active.pieceType, "");
});

test("resolveInputMoveIntent는 input action을 runtime move intent로 매핑한다", async () => {
    const { resolveInputMoveIntent } = await loadMoveStep();

    assert.deepEqual(resolveInputMoveIntent("move_left"), {
        kind: "shift",
        rowDelta: 0,
        colDelta: -1,
        moveType: "horizontal",
    });
    assert.deepEqual(resolveInputMoveIntent("move_right"), {
        kind: "shift",
        rowDelta: 0,
        colDelta: 1,
        moveType: "horizontal",
    });
    assert.deepEqual(resolveInputMoveIntent("soft_drop"), {
        kind: "shift",
        rowDelta: 1,
        colDelta: 0,
        moveType: "fall",
    });
    assert.deepEqual(resolveInputMoveIntent("rotate"), {
        kind: "rotate",
        moveType: "rotate",
    });
});

test("resolveInputMoveIntent는 runtime 전용 action이면 null을 반환한다", async () => {
    const { resolveInputMoveIntent } = await loadMoveStep();

    assert.equal(resolveInputMoveIntent("hard_drop"), null);
    assert.equal(resolveInputMoveIntent("hold"), null);
    assert.equal(resolveInputMoveIntent("unknown"), null);
});
