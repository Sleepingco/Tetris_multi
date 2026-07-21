const test = require("node:test");
const assert = require("node:assert/strict");

const DEFAULTS = {
    spawnRow: -1,
    spawnCol: 3,
    fallIntervalMs: 500,
    initialPhase: "playing",
};

test("serializeGameState는 현재 snapshot 복제 범위를 유지한다", async () => {
    const { createGameState } = await import("../src/client/game/state/stateFactory.ts");
    const { serializeGameState } = await import(
        "../src/client/game/state/stateSerialization.ts"
    );
    const gameState = createGameState(DEFAULTS);
    const queuedInput = { tick: 3, action: "move_left", pieceIndex: 2 };

    gameState.board = [["tree", null], [null, "garbage"]];
    gameState.pieceQueue = ["bar", "square"];
    gameState.bag = ["zee"];
    gameState.activePiece = { pieceType: "tree", rotation: 1, row: 4, col: 3 };
    gameState.pendingPiece = { pieceType: "tree", rotation: 1, row: 5, col: 3 };
    gameState.inputQueue = [queuedInput];

    const snapshot = serializeGameState(gameState);

    assert.notStrictEqual(snapshot.board, gameState.board);
    assert.notStrictEqual(snapshot.board[0], gameState.board[0]);
    assert.notStrictEqual(snapshot.activePiece, gameState.activePiece);
    assert.notStrictEqual(snapshot.pendingPiece, gameState.pendingPiece);
    assert.notStrictEqual(snapshot.pieceQueue, gameState.pieceQueue);
    assert.notStrictEqual(snapshot.bag, gameState.bag);
    assert.notStrictEqual(snapshot.inputQueue, gameState.inputQueue);
    assert.strictEqual(snapshot.inputQueue[0], queuedInput);
});

test("deserializeGameState는 partial snapshot fallback과 현재 복제 범위를 유지한다", async () => {
    const { deserializeGameState } = await import(
        "../src/client/game/state/stateSerialization.ts"
    );
    const queuedInput = { tick: 7, action: "rotate", pieceIndex: 4 };
    const snapshot = {
        score: 120,
        board: [[null, "bar"]],
        pieceQueue: ["square"],
        bag: ["tree"],
        activePiece: { pieceType: "bar", rotation: 0, row: 2, col: 3 },
        pendingPiece: { pieceType: "bar", rotation: 0, row: 3, col: 3 },
        inputQueue: [queuedInput],
    };

    const restored = deserializeGameState(snapshot, DEFAULTS);

    assert.equal(restored.score, 120);
    assert.equal(restored.lines, 0);
    assert.equal(restored.phase, "playing");
    assert.equal(restored.combo, -1);
    assert.notStrictEqual(restored.board, snapshot.board);
    assert.notStrictEqual(restored.board[0], snapshot.board[0]);
    assert.notStrictEqual(restored.activePiece, snapshot.activePiece);
    assert.notStrictEqual(restored.pendingPiece, snapshot.pendingPiece);
    assert.notStrictEqual(restored.pieceQueue, snapshot.pieceQueue);
    assert.notStrictEqual(restored.bag, snapshot.bag);
    assert.notStrictEqual(restored.inputQueue, snapshot.inputQueue);
    assert.strictEqual(restored.inputQueue[0], queuedInput);
});
