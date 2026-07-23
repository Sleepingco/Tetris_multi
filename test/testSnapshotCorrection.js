/**
 * 서버 snapshot과 로컬 prediction 차이를 즉시 보정할지 기다릴지 결정하는 순수 함수 테스트다.
 *
 * 두 snapshot과 이전 drift 시간을 준비해 판정을 실행하고 `shouldCorrect`, reason, 다음 대기 상태를 검증한다.
 * game over·garbage·settled board 차이는 즉시 보정하지만 `pieceIndex`가 1만큼 앞서거나
 * 뒤처진 상태는 같은 방향으로 750ms 지속될 때만 보정한다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

async function loadSnapshotCorrection() {
    return import("../src/client/game/runtime/snapshotCorrection.ts");
}

function createBoard() {
    return Array.from({ length: 20 }, () => Array(10).fill(null));
}

function createSnapshot(overrides = {}) {
    return {
        board: createBoard(),
        phase: "playing",
        pieceIndex: 3,
        pendingGarbageLines: 0,
        tick: 10,
        activePiece: {
            pieceType: "tree",
            rotation: 0,
            row: 4,
            col: 3,
        },
        ...overrides,
    };
}

test("gameOver snapshot은 즉시 full correction한다", async () => {
    const { evaluateOwnSnapshotCorrection } = await loadSnapshotCorrection();
    const serverSnapshot = createSnapshot({ phase: "gameOver" });
    const localSnapshot = createSnapshot();

    const decision = evaluateOwnSnapshotCorrection(serverSnapshot, localSnapshot);

    assert.equal(decision.shouldCorrect, true);
    assert.equal(decision.reason, "GAME_OVER");
});

test("lineClearing 중에는 non-gameOver drift를 correction하지 않는다", async () => {
    const { evaluateOwnSnapshotCorrection } = await loadSnapshotCorrection();
    const serverSnapshot = createSnapshot({ pieceIndex: 5 });
    const localSnapshot = createSnapshot({ phase: "lineClearing", pieceIndex: 3 });

    const decision = evaluateOwnSnapshotCorrection(
        serverSnapshot,
        localSnapshot,
        { key: "SERVER_AHEAD_ONE_PIECE", startedAtMs: 0 },
        1000,
    );

    assert.equal(decision.shouldCorrect, false);
    assert.equal(decision.nextPendingDriftState, null);
});

test("pending garbage 감소와 board 변경은 즉시 correction한다", async () => {
    const { evaluateOwnSnapshotCorrection } = await loadSnapshotCorrection();
    const serverBoard = createBoard();
    serverBoard[19][0] = "garbage";
    const serverSnapshot = createSnapshot({ board: serverBoard, pendingGarbageLines: 0 });
    const localSnapshot = createSnapshot({ pendingGarbageLines: 3 });

    const decision = evaluateOwnSnapshotCorrection(serverSnapshot, localSnapshot);

    assert.equal(decision.shouldCorrect, true);
    assert.equal(decision.reason, "GARBAGE_APPLIED");
});

test("같은 pieceIndex의 settled board mismatch는 즉시 correction한다", async () => {
    const { evaluateOwnSnapshotCorrection } = await loadSnapshotCorrection();
    const serverBoard = createBoard();
    serverBoard[19][2] = "square";
    const serverSnapshot = createSnapshot({ board: serverBoard });
    const localSnapshot = createSnapshot();

    const decision = evaluateOwnSnapshotCorrection(serverSnapshot, localSnapshot);

    assert.equal(decision.shouldCorrect, true);
    assert.equal(decision.reason, "SETTLED_BOARD_MISMATCH");
});

test("pieceIndex 차이가 2 이상이면 즉시 correction한다", async () => {
    const { evaluateOwnSnapshotCorrection } = await loadSnapshotCorrection();
    const serverSnapshot = createSnapshot({ pieceIndex: 5 });
    const localSnapshot = createSnapshot({ pieceIndex: 3 });

    const decision = evaluateOwnSnapshotCorrection(serverSnapshot, localSnapshot);

    assert.equal(decision.shouldCorrect, true);
    assert.equal(decision.reason, "PIECE_INDEX_GAP");
});

test("pieceIndex 1 차이는 750ms 미만 반복에는 보정하지 않고 750ms 유지되면 correction한다", async () => {
    const { evaluateOwnSnapshotCorrection } = await loadSnapshotCorrection();
    const serverSnapshot = createSnapshot({ pieceIndex: 4 });
    const localSnapshot = createSnapshot({ pieceIndex: 3 });

    const firstDecision = evaluateOwnSnapshotCorrection(serverSnapshot, localSnapshot, null, 100);
    const secondDecision = evaluateOwnSnapshotCorrection(
        serverSnapshot,
        localSnapshot,
        firstDecision.nextPendingDriftState,
        849,
    );
    const thirdDecision = evaluateOwnSnapshotCorrection(
        serverSnapshot,
        localSnapshot,
        secondDecision.nextPendingDriftState,
        850,
    );

    assert.equal(firstDecision.shouldCorrect, false);
    assert.deepEqual(firstDecision.nextPendingDriftState, {
        key: "SERVER_AHEAD_ONE_PIECE",
        startedAtMs: 100,
    });
    assert.equal(secondDecision.shouldCorrect, false);
    assert.equal(thirdDecision.shouldCorrect, true);
    assert.equal(thirdDecision.reason, "PERSISTENT_PIECE_INDEX_GAP");
});

test("pieceIndex gap 방향이 바뀌면 750ms persistence timer를 다시 시작한다", async () => {
    const { evaluateOwnSnapshotCorrection } = await loadSnapshotCorrection();
    const serverAhead = evaluateOwnSnapshotCorrection(
        createSnapshot({ pieceIndex: 4 }),
        createSnapshot({ pieceIndex: 3 }),
        null,
        100,
    );
    const directionChanged = evaluateOwnSnapshotCorrection(
        createSnapshot({ pieceIndex: 3 }),
        createSnapshot({ pieceIndex: 4 }),
        serverAhead.nextPendingDriftState,
        1000,
    );
    const beforeGracePeriod = evaluateOwnSnapshotCorrection(
        createSnapshot({ pieceIndex: 3 }),
        createSnapshot({ pieceIndex: 4 }),
        directionChanged.nextPendingDriftState,
        1749,
    );
    const afterGracePeriod = evaluateOwnSnapshotCorrection(
        createSnapshot({ pieceIndex: 3 }),
        createSnapshot({ pieceIndex: 4 }),
        beforeGracePeriod.nextPendingDriftState,
        1750,
    );

    assert.deepEqual(directionChanged.nextPendingDriftState, {
        key: "LOCAL_AHEAD_ONE_PIECE",
        startedAtMs: 1000,
    });
    assert.equal(beforeGracePeriod.shouldCorrect, false);
    assert.equal(afterGracePeriod.shouldCorrect, true);
});

test("같은 pieceIndex의 pieceType/rotation/col 차이는 반복되어도 correction하지 않는다", async (t) => {
    const { evaluateOwnSnapshotCorrection } = await loadSnapshotCorrection();
    const mismatchCases = [
        { pieceType: "square" },
        { rotation: 1 },
        { col: 5 },
    ];

    for (const mismatch of mismatchCases) {
        await t.test(Object.keys(mismatch)[0], () => {
            const serverSnapshot = createSnapshot({
                activePiece: {
                    ...createSnapshot().activePiece,
                    ...mismatch,
                },
            });
            const localSnapshot = createSnapshot();
            const firstDecision = evaluateOwnSnapshotCorrection(serverSnapshot, localSnapshot, null, 0);
            const secondDecision = evaluateOwnSnapshotCorrection(
                serverSnapshot,
                localSnapshot,
                firstDecision.nextPendingDriftState,
                1000,
            );

            assert.equal(firstDecision.shouldCorrect, false);
            assert.equal(firstDecision.nextPendingDriftState, null);
            assert.equal(secondDecision.shouldCorrect, false);
        });
    }
});

test("activePiece row와 tick만 다른 snapshot은 correction하지 않는다", async () => {
    const { evaluateOwnSnapshotCorrection } = await loadSnapshotCorrection();
    const localSnapshot = createSnapshot({ tick: 2 });
    const serverSnapshot = createSnapshot({
        tick: 200,
        activePiece: {
            ...localSnapshot.activePiece,
            row: localSnapshot.activePiece.row + 3,
        },
    });

    const firstDecision = evaluateOwnSnapshotCorrection(serverSnapshot, localSnapshot);
    const secondDecision = evaluateOwnSnapshotCorrection(
        serverSnapshot,
        localSnapshot,
        firstDecision.nextPendingDriftState,
        1000,
    );

    assert.equal(firstDecision.shouldCorrect, false);
    assert.equal(firstDecision.nextPendingDriftState, null);
    assert.equal(secondDecision.shouldCorrect, false);
});

test("일치하는 snapshot은 대기 중 drift도 초기화하고 correction하지 않는다", async () => {
    const { evaluateOwnSnapshotCorrection } = await loadSnapshotCorrection();
    const serverSnapshot = createSnapshot();
    const localSnapshot = createSnapshot();

    const decision = evaluateOwnSnapshotCorrection(
        serverSnapshot,
        localSnapshot,
        { key: "SERVER_AHEAD_ONE_PIECE", startedAtMs: 0 },
        1000,
    );

    assert.equal(decision.shouldCorrect, false);
    assert.equal(decision.nextPendingDriftState, null);
});
