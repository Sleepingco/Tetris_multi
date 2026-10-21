/**
 * 조각을 고정하기 직전 상태로 T-Spin 여부를 판정하는 core 테스트다.
 *
 * board의 T 중심 네 모서리를 준비해 판정을 실행하고, T 조각·마지막 회전·막힌 코너 3개 조건을 각각 검증한다.
 * 세 조건이 모두 참이고 전면 코너가 채워졌을 때만 `full`를 내는 순수 규칙 테스트다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

function createEmptyBoard(rows = 20, cols = 10) {
    return Array.from({ length: rows }, () => Array(cols).fill(null));
}

test("네 방향의 전면 코너와 5번째 킥 이력으로 Mini·Full을 구분한다", async () => {
    const { classifyTSpin, nextSpinRotation } = await import("../src/client/game/core/tSpin.ts");
    const corners = [[3, 4], [5, 4], [3, 6], [5, 6]];
    const frontByRotation = [[0, 1], [1, 3], [2, 3], [0, 2]];
    for (let rotation = 0; rotation < 4; rotation++) {
        const piece = { pieceType: "tree", rotation, row: 4, col: 3 };
        for (let missing = 0; missing < 4; missing++) {
            const board = createEmptyBoard();
            corners.forEach(([col, row], index) => { if (index !== missing) board[row][col] = "garbage"; });
            const options = { board, piece, spinRotation: nextSpinRotation(null, 0) };
            const expected = frontByRotation[rotation].includes(missing) ? "mini" : "full";
            assert.equal(classifyTSpin(options), expected, `${rotation}/${missing}`);
            options.spinRotation = nextSpinRotation(nextSpinRotation(null, 4), 0);
            assert.deepEqual(options.spinRotation, { lastKickIndex: 0, usedKick5: true });
            assert.equal(classifyTSpin(options), "full");
            assert.equal(classifyTSpin({ ...options, spinRotation: null }), "none");
        }
    }
});

test("벽·바닥은 막힌 코너이며 음수 행은 빈 공간으로 유지한다", async () => {
    const { classifyTSpin } = await import("../src/client/game/core/tSpin.ts");
    const spinRotation = { lastKickIndex: 0, usedKick5: false };
    const board = createEmptyBoard();
    board[17][1] = "garbage";
    assert.equal(classifyTSpin({ board, spinRotation,
        piece: { pieceType: "tree", rotation: 1, row: 17, col: -1 } }), "mini");
    assert.equal(classifyTSpin({ board: createEmptyBoard(), spinRotation,
        piece: { pieceType: "tree", rotation: 0, row: 18, col: 3 } }), "none");
    board[1][3] = board[1][5] = "garbage";
    assert.equal(classifyTSpin({ board, spinRotation,
        piece: { pieceType: "tree", rotation: 0, row: -1, col: 3 } }), "none");
});

test("분류별 점수와 공격은 같은 표를 사용하고 Mini도 줄 삭제 때만 B2B 자격을 갖는다", async () => {
    const { calculatePlacementScore } = await import("../src/client/game/core/tSpin.ts");
    const { calculateGarbageAttack } = await import("../src/client/game/core/garbage.ts");
    const { resolveAttackState } = await import("../src/client/game/core/attackState.ts");
    for (const [tSpinType, scores, attacks] of [
        ["none", [0, 10, 20, 30, 40], [0, 0, 1, 2, 4]],
        ["mini", [0, 10, 20], [0, 1, 2]],
        ["full", [15, 50, 100, 150], [0, 2, 4, 6]],
    ]) {
        for (let linesCleared = 0; linesCleared < scores.length; linesCleared++) {
            assert.equal(calculatePlacementScore(linesCleared, tSpinType), scores[linesCleared]);
            assert.equal(calculateGarbageAttack({ linesCleared, tSpinType }), attacks[linesCleared]);
        }
    }
    const first = resolveAttackState({ linesCleared: 1, tSpinType: "mini" });
    assert.equal(first.nextBackToBack, true);
    assert.equal(calculateGarbageAttack(first), 1);
    const next = resolveAttackState({ combo: first.nextCombo, backToBack: first.nextBackToBack,
        linesCleared: 2, tSpinType: "mini" });
    assert.equal(calculateGarbageAttack(next), 4);
    const noClear = resolveAttackState({ combo: next.nextCombo, backToBack: true,
        linesCleared: 0, tSpinType: "mini" });
    assert.equal(noClear.nextBackToBack, true);
    assert.equal(noClear.nextCombo, -1);
    assert.equal(calculateGarbageAttack(noClear), 0);
});

test("T 조각이 마지막 회전 후 중심 코너 3개 이상 막히면 T-Spin으로 판정한다", async () => {
    const { classifyTSpin } = await import("../src/client/game/core/tSpin.ts");
    const board = createEmptyBoard();
    const piece = {
        pieceType: "tree",
        rotation: 0,
        row: 4,
        col: 3,
    };

    board[4][3] = "garbage";
    board[4][5] = "garbage";
    board[6][3] = "garbage";

    assert.equal(classifyTSpin({
        board,
        piece,
        spinRotation: { lastKickIndex: 0, usedKick5: false },
    }), "full");
});

test("T 조각이 아니면 T-Spin으로 판정하지 않는다", async () => {
    const { classifyTSpin } = await import("../src/client/game/core/tSpin.ts");
    const board = createEmptyBoard();

    board[4][3] = "garbage";
    board[4][5] = "garbage";
    board[6][3] = "garbage";

    assert.equal(classifyTSpin({
        board,
        piece: {
            pieceType: "square",
            rotation: 0,
            row: 4,
            col: 3,
        },
        spinRotation: { lastKickIndex: 0, usedKick5: false },
    }), "none");
});

test("마지막 액션이 회전이 아니면 T-Spin으로 판정하지 않는다", async () => {
    const { classifyTSpin } = await import("../src/client/game/core/tSpin.ts");
    const board = createEmptyBoard();

    board[4][3] = "garbage";
    board[4][5] = "garbage";
    board[6][3] = "garbage";

    assert.equal(classifyTSpin({
        board,
        piece: {
            pieceType: "tree",
            rotation: 0,
            row: 4,
            col: 3,
        },
        spinRotation: null,
    }), "none");
});

test("막힌 중심 코너가 2개 이하이면 T-Spin으로 판정하지 않는다", async () => {
    const { classifyTSpin } = await import("../src/client/game/core/tSpin.ts");
    const board = createEmptyBoard();

    board[4][3] = "garbage";
    board[4][5] = "garbage";

    assert.equal(classifyTSpin({
        board,
        piece: {
            pieceType: "tree",
            rotation: 0,
            row: 4,
            col: 3,
        },
        spinRotation: { lastKickIndex: 0, usedKick5: false },
    }), "none");
});
