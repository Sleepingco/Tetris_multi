/**
 * 서버 player state에 이동·회전·soft drop처럼 조각을 고정하지 않는 입력을 적용하는 테스트다.
 *
 * board와 active/pending piece를 준비해 입력을 실행하고 실제로 허용된 이동만 state에 반영되는지 검증한다.
 * lock 흐름이 필요한 hard drop과 hold는 상위 gameplay step의 책임이므로 이 계층에서는 처리하지 않는다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { loadGameCore } = require("../dist/server/server/services/gameCoreLoader.js");
const {
    applyServerInputToPlayerState,
} = require("../dist/server/server/services/playerStateInput.js");

function createPlayerState(gameCore, overrides = {}) {
    const activePiece = overrides.activePiece ?? {
        pieceType: "tree",
        rotation: 0,
        row: 0,
        col: 4,
    };

    return {
        board: overrides.board ?? gameCore.createEmptyBoard(20, 10),
        activePiece: { ...activePiece },
        pendingPiece: overrides.pendingPiece ?? null,
        spinRotation: null,
    };
}

test("applyServerInputToPlayerState는 move_left가 가능하면 activePiece col을 줄인다", async () => {
    const gameCore = await loadGameCore();
    const playerState = createPlayerState(gameCore);

    const result = applyServerInputToPlayerState(playerState, {
        action: "move_left",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.moveIntent.kind, "ok");
    assert.deepEqual(playerState.activePiece, {
        pieceType: "tree",
        rotation: 0,
        row: 0,
        col: 3,
    });
    assert.deepEqual(playerState.pendingPiece, playerState.activePiece);
    assert.equal(playerState.spinRotation, null);
});

test("applyServerInputToPlayerState는 벽에 막힌 move_left면 activePiece를 유지한다", async () => {
    const gameCore = await loadGameCore();
    const playerState = createPlayerState(gameCore, {
        activePiece: {
            pieceType: "tree",
            rotation: 0,
            row: 0,
            col: 0,
        },
    });

    const result = applyServerInputToPlayerState(playerState, {
        action: "move_left",
    }, gameCore);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "MOVE_RETRY");
    assert.equal(result.moveIntent.kind, "retry");
    assert.deepEqual(playerState.activePiece, {
        pieceType: "tree",
        rotation: 0,
        row: 0,
        col: 0,
    });
});

test("applyServerInputToPlayerState는 soft_drop이 가능하면 activePiece row를 늘린다", async () => {
    const gameCore = await loadGameCore();
    const playerState = createPlayerState(gameCore);

    const result = applyServerInputToPlayerState(playerState, {
        action: "soft_drop",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.moveIntent.kind, "ok");
    assert.deepEqual(playerState.activePiece, {
        pieceType: "tree",
        rotation: 0,
        row: 1,
        col: 4,
    });
    assert.equal(playerState.spinRotation, null);
});

test("applyServerInputToPlayerState는 pendingPiece가 있을 때 가능한 rotate를 적용한다", async () => {
    const gameCore = await loadGameCore();
    const activePiece = {
        pieceType: "tree",
        rotation: 0,
        row: 0,
        col: 4,
    };
    const playerState = createPlayerState(gameCore, {
        activePiece,
        pendingPiece: { ...activePiece },
    });

    const result = applyServerInputToPlayerState(playerState, {
        action: "rotate",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.moveIntent.kind, "ok");
    assert.deepEqual(playerState.activePiece, {
        pieceType: "tree",
        rotation: 1,
        row: 0,
        col: 4,
    });
    assert.deepEqual(playerState.spinRotation, { lastKickIndex: 0, usedKick5: false });
});

test("applyServerInputToPlayerState는 hard_drop과 hold를 처리하지 않는다", async () => {
    const gameCore = await loadGameCore();
    const playerState = createPlayerState(gameCore);
    const beforeState = structuredClone(playerState);

    const hardDropResult = applyServerInputToPlayerState(playerState, {
        action: "hard_drop",
    }, gameCore);
    const holdResult = applyServerInputToPlayerState(playerState, {
        action: "hold",
    }, gameCore);

    assert.deepEqual(hardDropResult, {
        ok: false,
        reason: "UNSUPPORTED_ACTION",
        moveIntent: null,
    });
    assert.deepEqual(holdResult, {
        ok: false,
        reason: "UNSUPPORTED_ACTION",
        moveIntent: null,
    });
    assert.deepEqual(playerState, beforeState);
});
