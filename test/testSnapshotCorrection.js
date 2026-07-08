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

test("shouldCorrectMyPrediction은 과거 server pieceIndex면 내 보드를 보정하지 않는다", async () => {
    const { shouldCorrectMyPrediction } = await loadSnapshotCorrection();
    const serverSnapshot = createSnapshot({ pieceIndex: 3 });
    const localSnapshot = createSnapshot({ pieceIndex: 4 });

    assert.equal(shouldCorrectMyPrediction(serverSnapshot, localSnapshot), false);
});

test("shouldCorrectMyPrediction은 미래 server pieceIndex면 내 보드 보정 후보로 본다", async () => {
    const { shouldCorrectMyPrediction } = await loadSnapshotCorrection();
    const serverSnapshot = createSnapshot({ pieceIndex: 5 });
    const localSnapshot = createSnapshot({ pieceIndex: 4 });

    assert.equal(shouldCorrectMyPrediction(serverSnapshot, localSnapshot), true);
});

test("shouldCorrectMyPrediction은 같은 pieceIndex에서 score가 다르면 보정 후보로 본다", async () => {
    const { shouldCorrectMyPrediction } = await loadSnapshotCorrection();
    const serverSnapshot = createSnapshot({ pieceIndex: 4, score: 30 });
    const localSnapshot = createSnapshot({ pieceIndex: 4, score: 10 });

    assert.equal(shouldCorrectMyPrediction(serverSnapshot, localSnapshot), true);
});

test("shouldCorrectMyPrediction은 같은 pieceIndex에서 lines가 다르면 보정 후보로 본다", async () => {
    const { shouldCorrectMyPrediction } = await loadSnapshotCorrection();
    const serverSnapshot = createSnapshot({ pieceIndex: 4, lines: 2 });
    const localSnapshot = createSnapshot({ pieceIndex: 4, lines: 1 });

    assert.equal(shouldCorrectMyPrediction(serverSnapshot, localSnapshot), true);
});

test("shouldCorrectMyPrediction은 같은 pieceIndex에서 phase가 다르면 보정 후보로 본다", async () => {
    const { shouldCorrectMyPrediction } = await loadSnapshotCorrection();
    const serverSnapshot = createSnapshot({ pieceIndex: 4, phase: "gameOver" });
    const localSnapshot = createSnapshot({ pieceIndex: 4, phase: "playing" });

    assert.equal(shouldCorrectMyPrediction(serverSnapshot, localSnapshot), true);
});

test("shouldCorrectMyPrediction은 activePiece만 다르면 즉시 보정하지 않는다", async () => {
    const { shouldCorrectMyPrediction } = await loadSnapshotCorrection();
    const serverSnapshot = createSnapshot({
        pieceIndex: 4,
        score: 10,
        lines: 1,
        phase: "playing",
        activePiece: {
            pieceType: "tree",
            rotation: 0,
            row: 4,
            col: 5,
        },
    });
    const localSnapshot = createSnapshot({
        pieceIndex: 4,
        score: 10,
        lines: 1,
        phase: "playing",
        activePiece: {
            pieceType: "tree",
            rotation: 0,
            row: 4,
            col: 3,
        },
    });

    assert.equal(shouldCorrectMyPrediction(serverSnapshot, localSnapshot), false);
});
