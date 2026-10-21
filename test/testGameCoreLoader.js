/**
 * 서버가 client의 순수 game core를 compiled 경로에서 안전하게 재사용하는지 검증한다.
 *
 * 준비: 배포 산출물의 `loadGameCore`를 불러온다.
 * 실행: core를 한 번 또는 동시에 여러 번 요청한다.
 * 검증: authoritative 계산에 필요한 함수·상수·블록 정의가 모두 노출되고,
 * 중복 dynamic import를 피하도록 같은 Promise와 같은 module 객체를 재사용해야 한다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { loadGameCore } = require("../dist/server/server/services/gameCoreLoader.js");

test("loadGameCore는 server에서 재사용할 client game core를 로딩한다", async () => {
    const gameCore = await loadGameCore();

    assert.equal(typeof gameCore.resolveInputMoveIntent, "function");
    assert.equal(typeof gameCore.resolveMoveAttempt, "function");
    assert.equal(typeof gameCore.resolveMoveIntent, "function");
    assert.equal(typeof gameCore.canPlacePiece, "function");
    assert.equal(typeof gameCore.createEmptyBoard, "function");
    assert.equal(typeof gameCore.lockPieceOnBoard, "function");
    assert.equal(typeof gameCore.clearFilledLines, "function");
    assert.equal(typeof gameCore.classifyTSpin, "function");
    assert.equal(typeof gameCore.resolveAttackState, "function");
    assert.equal(typeof gameCore.calculateGarbageAttack, "function");
    assert.equal(typeof gameCore.resolveGarbageCancel, "function");
    assert.equal(typeof gameCore.applyGarbageLines, "function");
    assert.equal(typeof gameCore.isPieceAboveTop, "function");
    assert.equal(typeof gameCore.createSpawnedPiece, "function");
    assert.equal(typeof gameCore.getHardDropRow, "function");
    assert.equal(gameCore.BOARD_ROWS, 20);
    assert.equal(gameCore.BOARD_COLS, 10);
    assert.deepEqual(gameCore.SPAWN_POSITION, {
        row: -1,
        col: 3,
    });
    assert.equal(Array.isArray(gameCore.BLOCKS.tree), true);
    assert.equal(Array.isArray(gameCore.WALL_KICKS.normal["0->1"]), true);
});

test("loadGameCore는 같은 로딩 Promise를 재사용한다", async () => {
    const firstPromise = loadGameCore();
    const secondPromise = loadGameCore();

    assert.equal(firstPromise, secondPromise);

    const [firstCore, secondCore] = await Promise.all([firstPromise, secondPromise]);
    assert.equal(firstCore, secondCore);
});
