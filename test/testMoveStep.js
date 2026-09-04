/**
 * 키보드 action이 순수 이동 판정과 runtime intent로 바뀌는 경계를 검증한다.
 *
 * 준비: board, block 회전 모양, wall kick 설정과 active/pending piece를 준비한다.
 * 실행: `resolveMoveAttempt`로 충돌·회전을 판정하고 `resolveMoveIntent`로 실행 의미를 해석한다.
 * 검증: 성공과 spawn 실패가 올바른 intent가 되며 입력 조각은 직접 변경하지 않아야 한다.
 *
 * runtime 전용 action을 core가 억지로 처리하지 않고 `null`로 남기는 책임 분리도 함께 확인한다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

/**
 * 여러 테스트가 같은 core 모듈 묶음을 사용하므로 병렬 import해 공통 fixture로 반환한다.
 * 각 함수는 실제 source 모듈이며, 이 helper 자체는 게임 규칙을 대신 구현하지 않는다.
 */
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
        direction: "cw",
    });
    assert.deepEqual(resolveInputMoveIntent("rotate_ccw"), {
        kind: "rotate",
        moveType: "rotate",
        direction: "ccw",
    });
});

test("resolveInputMoveIntent는 runtime 전용 action이면 null을 반환한다", async () => {
    const { resolveInputMoveIntent } = await loadMoveStep();

    assert.equal(resolveInputMoveIntent("hard_drop"), null);
    assert.equal(resolveInputMoveIntent("hold"), null);
    assert.equal(resolveInputMoveIntent("unknown"), null);
});
