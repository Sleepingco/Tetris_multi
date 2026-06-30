const test = require("node:test");
const assert = require("node:assert/strict");

async function loadMoveStep() {
    const [
        { resolveMoveAttempt, resolveMoveIntent },
        { createEmptyBoard },
        { default: blocks },
        { WALL_KICKS },
    ] = await Promise.all([
        import("../src/client/game/core/step.js"),
        import("../src/client/game/core/board.js"),
        import("../src/client/game/state/blocks.js"),
        import("../src/client/game/state/config.js"),
    ]);

    return {
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
