/**
 * 현재 조각에서 실제 키 입력으로 도달 가능한 lock 위치만 BFS로 찾는 planner 테스트다.
 *
 * board와 active piece를 준비해 후보를 생성한 뒤 `plannedActions`를 서버 authoritative step으로 다시 실행한다.
 * replay 결과가 후보의 `pieceType·rotation·row·col`과 같고, 동일한 placement key에는
 * BFS가 먼저 찾은 최단 경로 하나만 남는지가 핵심이다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { loadGameCore } = require("../dist/server/server/services/gameCoreLoader.js");
const {
    applyAuthoritativeInput,
} = require("../dist/server/server/services/playerGameplayStep.js");

function createBoard(rows = 20, cols = 10) {
    return Array.from({ length: rows }, () => Array(cols).fill(null));
}

function createPlayerState(board, activePiece) {
    return {
        board: board.map(row => [...row]),
        activePiece: { ...activePiece },
        pendingPiece: { ...activePiece },
        pieceQueue: ["tree"],
        holdPieceType: null,
        holdUsedThisDrop: false,
        score: 0,
        lines: 0,
        phase: "playing",
        combo: -1,
        backToBack: false,
        currentTick: 0,
        pieceIndex: 1,
        pendingGarbageQueue: [],
        lastActionWasRotation: false,
    };
}

function placementKey(placement) {
    return `${placement.pieceType}:${placement.rotation}:${placement.row}:${placement.col}`;
}

async function replayPlannedActions(board, activePiece, candidate) {
    const gameCore = await loadGameCore();
    const state = createPlayerState(board, activePiece);
    let result = null;

    candidate.plannedActions.forEach(action => {
        result = applyAuthoritativeInput(state, { action }, gameCore);
        assert.equal(result.ok, true, `${action} replay가 실패했다`);
    });

    const lockedPiece = result?.placementResult?.lockedPiece;
    assert.ok(lockedPiece);
    assert.deepEqual(lockedPiece, {
        pieceType: candidate.placement.pieceType,
        rotation: candidate.placement.rotation,
        row: candidate.placement.row,
        col: candidate.placement.col,
    });
}

test("빈 board에서 기본 reachable placement와 hard_drop 계획을 생성한다", async () => {
    const {
        generateReachablePlacements,
        REACHABLE_ACTION_ORDER,
    } = await import(
        "../src/client/game/ai/heuristic/reachablePlacementPlanner.ts"
    );
    const candidates = generateReachablePlacements(createBoard(), {
        pieceType: "tree",
        rotation: 0,
        row: -1,
        col: 3,
    });

    assert.ok(candidates.length > 0);
    assert.deepEqual(REACHABLE_ACTION_ORDER, [
        "move_left",
        "move_right",
        "rotate",
        "soft_drop",
    ]);
    assert.ok(candidates.every(candidate => {
        return candidate.plannedActions.at(-1) === "hard_drop";
    }));
});

test("좌우 이동과 회전 후보는 최단 plannedActions를 반환한다", async () => {
    const { generateReachablePlacements } = await import(
        "../src/client/game/ai/heuristic/reachablePlacementPlanner.ts"
    );
    const candidates = generateReachablePlacements(createBoard(), {
        pieceType: "tree",
        rotation: 0,
        row: -1,
        col: 3,
    });
    const left = candidates.find(candidate => {
        return candidate.placement.rotation === 0 && candidate.placement.col === 0;
    });
    const right = candidates.find(candidate => {
        return candidate.placement.rotation === 0 && candidate.placement.col === 6;
    });
    const rotated = candidates.find(candidate => {
        return candidate.placement.rotation === 1 && candidate.placement.col === 3;
    });

    assert.deepEqual(left.plannedActions, [
        "move_left",
        "move_left",
        "move_left",
        "hard_drop",
    ]);
    assert.deepEqual(right.plannedActions, [
        "move_right",
        "move_right",
        "move_right",
        "hard_drop",
    ]);
    assert.deepEqual(rotated.plannedActions, ["rotate", "hard_drop"]);
});

test("wall kick 회전은 resolveMoveAttempt와 같은 위치를 사용한다", async () => {
    const { generateReachablePlacements } = await import(
        "../src/client/game/ai/heuristic/reachablePlacementPlanner.ts"
    );
    const gameCore = await loadGameCore();
    const board = createBoard();
    const activePiece = {
        pieceType: "tree",
        rotation: 1,
        row: 0,
        col: -1,
    };
    const outcome = gameCore.resolveMoveAttempt({
        board,
        activePiece,
        pendingPiece: {
            ...activePiece,
            rotation: 2,
        },
        moveCause: "rotate",
        blocks: gameCore.BLOCKS,
        wallKicks: gameCore.WALL_KICKS,
    });
    const kicked = generateReachablePlacements(board, activePiece).find(candidate => {
        return candidate.placement.rotation === 2 && candidate.placement.col === 0;
    });

    assert.equal(outcome.status, "ok");
    assert.equal(outcome.active.col, 0);
    assert.equal(kicked.placement.col, outcome.active.col);
    assert.deepEqual(kicked.plannedActions, ["rotate", "hard_drop"]);
    await replayPlannedActions(board, activePiece, kicked);
});

test("장애물에 고립된 activePiece가 도달할 수 없는 placement를 제외한다", async () => {
    const { generateReachablePlacements } = await import(
        "../src/client/game/ai/heuristic/reachablePlacementPlanner.ts"
    );
    const board = createBoard();
    board[19] = Array(10).fill("stack");
    board[19][0] = null;
    board[19][1] = null;
    [5, 6].forEach(row => {
        board[row][3] = "stack";
        board[row][6] = "stack";
    });
    board[7][4] = "stack";
    board[7][5] = "stack";
    const candidates = generateReachablePlacements(board, {
        pieceType: "square",
        rotation: 0,
        row: 5,
        col: 4,
    });

    assert.ok(candidates.length > 0);
    assert.ok(candidates.every(candidate => {
        return candidate.placement.row === 5 && candidate.placement.col === 4;
    }));
    assert.equal(candidates.some(candidate => {
        return candidate.placement.row === 18 && candidate.placement.col === 0;
    }), false);
});

test("soft_drop 뒤 좌우 이동해야 들어가는 낮은 공간을 탐색한다", async () => {
    const { generateReachablePlacements } = await import(
        "../src/client/game/ai/heuristic/reachablePlacementPlanner.ts"
    );
    const board = createBoard();
    board[17][0] = "stack";
    board[17][1] = "stack";
    const candidate = generateReachablePlacements(board, {
        pieceType: "square",
        rotation: 0,
        row: -1,
        col: 3,
    }).find(item => {
        return item.placement.rotation === 0 &&
            item.placement.row === 18 &&
            item.placement.col === 0;
    });

    assert.ok(candidate);
    const firstSoftDropIndex = candidate.plannedActions.indexOf("soft_drop");
    const lastMoveLeftIndex = candidate.plannedActions.lastIndexOf("move_left");

    assert.ok(firstSoftDropIndex >= 0);
    assert.ok(lastMoveLeftIndex > firstSoftDropIndex);
    assert.equal(candidate.plannedActions.at(-1), "hard_drop");
    await replayPlannedActions(board, {
        pieceType: "square",
        rotation: 0,
        row: -1,
        col: 3,
    }, candidate);
});

test("모든 빈 board 후보는 authoritative input replay 결과와 일치한다", async () => {
    const { generateReachablePlacements } = await import(
        "../src/client/game/ai/heuristic/reachablePlacementPlanner.ts"
    );
    const board = createBoard();
    const activePiece = {
        pieceType: "tree",
        rotation: 0,
        row: -1,
        col: 3,
    };
    const candidates = generateReachablePlacements(board, activePiece);

    for (const candidate of candidates) {
        await replayPlannedActions(board, activePiece, candidate);
    }
});

test("동일 final placement는 최단 경로 하나만 유지한다", async () => {
    const { generateReachablePlacements } = await import(
        "../src/client/game/ai/heuristic/reachablePlacementPlanner.ts"
    );
    const candidates = generateReachablePlacements(createBoard(), {
        pieceType: "square",
        rotation: 0,
        row: -1,
        col: 3,
    });
    const target = candidates.find(candidate => {
        return candidate.placement.rotation === 0 && candidate.placement.col === 2;
    });
    const keys = candidates.map(candidate => placementKey(candidate.placement));

    assert.deepEqual(target.plannedActions, ["move_left", "hard_drop"]);
    assert.equal(new Set(keys).size, candidates.length);
});

test("동일 fixture 결과는 결정적이며 원본 입력을 변경하지 않는다", async () => {
    const { generateReachablePlacements } = await import(
        "../src/client/game/ai/heuristic/reachablePlacementPlanner.ts"
    );
    const board = createBoard();
    board[17][0] = "stack";
    board[17][1] = "stack";
    const activePiece = {
        pieceType: "square",
        rotation: 0,
        row: -1,
        col: 3,
    };
    const boardBefore = structuredClone(board);
    const activePieceBefore = { ...activePiece };

    const first = generateReachablePlacements(board, activePiece);
    const second = generateReachablePlacements(board, activePiece);

    assert.deepEqual(first, second);
    assert.deepEqual(board, boardBefore);
    assert.deepEqual(activePiece, activePieceBefore);
});

test("잘못된 입력이나 도달 가능한 lock이 없으면 빈 후보를 반환한다", async () => {
    const { generateReachablePlacements } = await import(
        "../src/client/game/ai/heuristic/reachablePlacementPlanner.ts"
    );
    const fullBoard = createBoard().map(row => row.map(() => "garbage"));

    assert.deepEqual(generateReachablePlacements(null, null), []);
    assert.deepEqual(generateReachablePlacements([[]], {
        pieceType: "tree",
        rotation: 0,
        row: -1,
        col: 3,
    }), []);
    assert.deepEqual(generateReachablePlacements(fullBoard, {
        pieceType: "tree",
        rotation: 0,
        row: -1,
        col: 3,
    }), []);
});
