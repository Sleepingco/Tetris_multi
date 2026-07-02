const test = require("node:test");
const assert = require("node:assert/strict");

const {
    AUTHORITATIVE_SNAPSHOT_FIELDS,
    createAuthoritativeSnapshot,
    validateGameSnapshot,
} = require("../src/server/validators/gameSnapshotValidator.js");

function createSnapshot(overrides = {}) {
    return {
        board: [[null]],
        activePiece: {
            pieceType: "tree",
            rotation: 0,
            row: 1,
            col: 4,
        },
        pieceQueue: ["bar", "square"],
        holdPieceType: null,
        holdUsedThisDrop: false,
        score: 100,
        linesClearedTotal: 2,
        phase: "playing",
        fallIntervalMs: 800,
        combo: 0,
        backToBack: false,
        pendingGarbageQueue: [{ lines: 2, holeCol: 4 }],
        tick: 30,
        pieceIndex: 8,
        ...overrides,
    };
}

test("AUTHORITATIVE_SNAPSHOT_FIELDS는 서버 authoritative 전환 기준 필드를 고정한다", () => {
    assert.deepEqual(AUTHORITATIVE_SNAPSHOT_FIELDS, [
        "board",
        "activePiece",
        "pieceQueue",
        "holdPieceType",
        "holdUsedThisDrop",
        "score",
        "linesClearedTotal",
        "phase",
        "fallIntervalMs",
        "combo",
        "backToBack",
        "pendingGarbageQueue",
        "tick",
        "pieceIndex",
    ]);
});

test("validateGameSnapshot은 최소 board snapshot을 허용한다", () => {
    const result = validateGameSnapshot({
        board: [[null]],
    });

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
});

test("validateGameSnapshot은 authoritative 기준 필드 타입이 맞으면 허용한다", () => {
    const result = validateGameSnapshot(createSnapshot());

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
});

test("validateGameSnapshot은 잘못된 optional field 타입을 거부한다", () => {
    const result = validateGameSnapshot(createSnapshot({
        score: "100",
    }));

    assert.equal(result.ok, false);
    assert.equal(result.reason, "INVALID_SCORE");
});

test("validateGameSnapshot은 fallIntervalMs가 숫자가 아니면 거부한다", () => {
    const result = validateGameSnapshot(createSnapshot({
        fallIntervalMs: "800",
    }));

    assert.equal(result.ok, false);
    assert.equal(result.reason, "INVALID_FALL_INTERVAL");
});

test("validateGameSnapshot은 pending garbage queue entry 타입을 검증한다", () => {
    const result = validateGameSnapshot(createSnapshot({
        pendingGarbageQueue: [{ lines: 0, holeCol: 4 }],
    }));

    assert.equal(result.ok, false);
    assert.equal(result.reason, "INVALID_PENDING_GARBAGE_QUEUE");
});

test("createAuthoritativeSnapshot은 authoritative 기준 필드만 복사한다", () => {
    const source = createSnapshot({
        lastClientInputTick: 30,
        lastClientInputPieceIndex: 8,
        isTSpin: true,
    });

    const snapshot = createAuthoritativeSnapshot(source);

    assert.deepEqual(Object.keys(snapshot), AUTHORITATIVE_SNAPSHOT_FIELDS);
    assert.equal(snapshot.lastClientInputTick, undefined);
    assert.equal(snapshot.lastClientInputPieceIndex, undefined);
    assert.equal(snapshot.isTSpin, undefined);
    assert.deepEqual(snapshot.board, source.board);
    assert.deepEqual(snapshot.activePiece, source.activePiece);
});

test("createAuthoritativeSnapshot은 source 변경이 결과에 영향을 주지 않도록 복사한다", () => {
    const source = createSnapshot();
    const snapshot = createAuthoritativeSnapshot(source);

    source.board[0][0] = "bar";
    source.activePiece.row = 10;
    source.pieceQueue.push("tree");
    source.pendingGarbageQueue[0].lines = 5;

    assert.deepEqual(snapshot.board, [[null]]);
    assert.equal(snapshot.activePiece.row, 1);
    assert.deepEqual(snapshot.pieceQueue, ["bar", "square"]);
    assert.deepEqual(snapshot.pendingGarbageQueue, [{ lines: 2, holeCol: 4 }]);
});
