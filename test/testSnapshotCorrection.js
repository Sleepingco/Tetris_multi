const test = require("node:test");
const assert = require("node:assert/strict");

async function loadSnapshotCorrection() {
    return import("../src/client/game/runtime/snapshotCorrection.js");
}

function createSnapshot(overrides = {}) {
    return {
        phase: "playing",
        pieceIndex: 3,
        activePiece: {
            pieceType: "tree",
            rotation: 0,
            row: 4,
            col: 3,
        },
        ...overrides,
    };
}

test("shouldCorrectSnapshot은 과거 pieceIndex snapshot을 보정하지 않는다", async () => {
    const { shouldCorrectSnapshot } = await loadSnapshotCorrection();
    const localSnapshot = createSnapshot({ pieceIndex: 4 });
    const remoteSnapshot = createSnapshot({ pieceIndex: 3 });

    assert.equal(shouldCorrectSnapshot(localSnapshot, remoteSnapshot), false);
});

test("shouldCorrectSnapshot은 미래 pieceIndex snapshot으로 뒤처진 보드를 따라잡는다", async () => {
    const { shouldCorrectSnapshot } = await loadSnapshotCorrection();
    const localSnapshot = createSnapshot({ pieceIndex: 3 });
    const remoteSnapshot = createSnapshot({ pieceIndex: 4 });

    assert.equal(shouldCorrectSnapshot(localSnapshot, remoteSnapshot), true);
});

test("shouldCorrectSnapshot은 같은 pieceIndex와 같은 activePiece면 보정하지 않는다", async () => {
    const { shouldCorrectSnapshot } = await loadSnapshotCorrection();
    const localSnapshot = createSnapshot();
    const remoteSnapshot = createSnapshot();

    assert.equal(shouldCorrectSnapshot(localSnapshot, remoteSnapshot), false);
});

test("shouldCorrectSnapshot은 같은 pieceIndex에서 activePiece 위치가 다르면 보정한다", async () => {
    const { shouldCorrectSnapshot } = await loadSnapshotCorrection();
    const localSnapshot = createSnapshot();
    const remoteSnapshot = createSnapshot({
        activePiece: {
            pieceType: "tree",
            rotation: 0,
            row: 4,
            col: 4,
        },
    });

    assert.equal(shouldCorrectSnapshot(localSnapshot, remoteSnapshot), true);
});

test("shouldCorrectSnapshot은 gameOver snapshot을 예외적으로 보정한다", async () => {
    const { shouldCorrectSnapshot } = await loadSnapshotCorrection();
    const localSnapshot = createSnapshot({ pieceIndex: 4 });
    const remoteSnapshot = createSnapshot({
        phase: "gameOver",
        pieceIndex: 3,
    });

    assert.equal(shouldCorrectSnapshot(localSnapshot, remoteSnapshot), true);
});
