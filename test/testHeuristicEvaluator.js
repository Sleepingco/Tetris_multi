const test = require("node:test");
const assert = require("node:assert/strict");

function createBoard(rows = 20, cols = 10) {
    return Array.from({ length: rows }, () => Array(cols).fill(null));
}

function createGameState(board, pieceType = "bar") {
    return {
        board,
        activePiece: {
            pieceType,
            rotation: 0,
            row: -1,
            col: 3,
        },
        nextQueue: ["tree", "square"],
        holdPiece: null,
        score: 0,
        lines: 0,
        tick: 12,
        pieceIndex: 3,
    };
}

test("HEURISTIC_WEIGHTS는 기본 scoring 계수를 공개한다", async () => {
    const { HEURISTIC_WEIGHTS } = await import(
        "../src/client/game/ai/heuristic/heuristicEvaluator.js"
    );

    assert.deepEqual(HEURISTIC_WEIGHTS, {
        linesCleared: 10,
        holes: -6,
        aggregateHeight: -0.5,
        bumpiness: -0.8,
        maxHeight: -1,
    });
});

test("line clear 후보는 같은 board의 non-clear 후보보다 높은 점수를 받는다", async () => {
    const { evaluatePlacement } = await import(
        "../src/client/game/ai/heuristic/heuristicEvaluator.js"
    );
    const board = createBoard();
    board[19] = [null, null, null, null, ...Array(6).fill("tree")];

    const lineClear = evaluatePlacement(board, {
        pieceType: "bar",
        rotation: 0,
        col: 0,
        row: 18,
    });
    const nonClear = evaluatePlacement(board, {
        pieceType: "bar",
        rotation: 1,
        col: -2,
        row: 16,
    });

    assert.ok(lineClear);
    assert.ok(nonClear);
    assert.equal(lineClear.linesCleared, 1);
    assert.equal(lineClear.score, 10);
    assert.equal(nonClear.linesCleared, 0);
    assert.ok(lineClear.score > nonClear.score);
});

test("holes가 늘어나는 후보를 더 크게 감점한다", async () => {
    const { evaluatePlacement } = await import(
        "../src/client/game/ai/heuristic/heuristicEvaluator.js"
    );
    const board = createBoard();
    board[19][0] = "tree";
    board[19][3] = "tree";

    const withHoles = evaluatePlacement(board, {
        pieceType: "bar",
        rotation: 0,
        col: 0,
        row: 17,
    });
    const withoutHoles = evaluatePlacement(board, {
        pieceType: "bar",
        rotation: 0,
        col: 4,
        row: 18,
    });

    assert.ok(withHoles);
    assert.ok(withoutHoles);
    assert.equal(withHoles.reason.holesDelta, 2);
    assert.equal(withoutHoles.reason.holesDelta, 0);
    assert.ok(withHoles.score < withoutHoles.score);
});

test("aggregateHeight는 0.5씩 점수에서 차감된다", async () => {
    const {
        evaluatePlacement,
        HEURISTIC_WEIGHTS,
    } = await import("../src/client/game/ai/heuristic/heuristicEvaluator.js");
    const evaluation = evaluatePlacement(createBoard(), {
        pieceType: "bar",
        rotation: 0,
        col: 0,
        row: 18,
    });

    assert.ok(evaluation);
    const scoreWithoutAggregateHeight =
        evaluation.linesCleared * HEURISTIC_WEIGHTS.linesCleared +
        evaluation.metricsAfter.holes * HEURISTIC_WEIGHTS.holes +
        evaluation.metricsAfter.bumpiness * HEURISTIC_WEIGHTS.bumpiness +
        evaluation.metricsAfter.maxHeight * HEURISTIC_WEIGHTS.maxHeight;

    assert.ok(
        Math.abs(
            evaluation.score - scoreWithoutAggregateHeight -
            evaluation.metricsAfter.aggregateHeight * HEURISTIC_WEIGHTS.aggregateHeight
        ) < 1e-10,
    );
    assert.ok(evaluation.score < scoreWithoutAggregateHeight);
});

test("bumpiness가 높은 후보는 다른 metrics가 같을 때 더 낮은 점수를 받는다", async () => {
    const { evaluatePlacement } = await import(
        "../src/client/game/ai/heuristic/heuristicEvaluator.js"
    );
    const board = createBoard();
    const edge = evaluatePlacement(board, {
        pieceType: "bar",
        rotation: 0,
        col: 0,
        row: 18,
    });
    const center = evaluatePlacement(board, {
        pieceType: "bar",
        rotation: 0,
        col: 3,
        row: 18,
    });

    assert.ok(edge);
    assert.ok(center);
    assert.equal(edge.metricsAfter.aggregateHeight, center.metricsAfter.aggregateHeight);
    assert.equal(edge.metricsAfter.holes, center.metricsAfter.holes);
    assert.equal(edge.metricsAfter.maxHeight, center.metricsAfter.maxHeight);
    assert.ok(center.metricsAfter.bumpiness > edge.metricsAfter.bumpiness);
    assert.ok(center.score < edge.score);
});

test("maxHeight는 높이마다 1점씩 차감된다", async () => {
    const {
        evaluatePlacement,
        HEURISTIC_WEIGHTS,
    } = await import("../src/client/game/ai/heuristic/heuristicEvaluator.js");
    const evaluation = evaluatePlacement(createBoard(), {
        pieceType: "bar",
        rotation: 1,
        col: -2,
        row: 16,
    });

    assert.ok(evaluation);
    const scoreWithoutMaxHeight =
        evaluation.linesCleared * HEURISTIC_WEIGHTS.linesCleared +
        evaluation.metricsAfter.holes * HEURISTIC_WEIGHTS.holes +
        evaluation.metricsAfter.aggregateHeight * HEURISTIC_WEIGHTS.aggregateHeight +
        evaluation.metricsAfter.bumpiness * HEURISTIC_WEIGHTS.bumpiness;

    assert.ok(
        Math.abs(
            evaluation.score - scoreWithoutMaxHeight -
            evaluation.metricsAfter.maxHeight * HEURISTIC_WEIGHTS.maxHeight
        ) < 1e-10,
    );
    assert.ok(evaluation.score < scoreWithoutMaxHeight);
});

test("rankPlacements는 최고 점수 후보를 결정적으로 선택한다", async () => {
    const { rankPlacements } = await import(
        "../src/client/game/ai/heuristic/heuristicEvaluator.js"
    );
    const board = createBoard();
    board[19] = [null, null, null, null, ...Array(6).fill("tree")];
    const activePiece = createGameState(board).activePiece;

    const firstRanking = rankPlacements(board, activePiece);
    const secondRanking = rankPlacements(board, activePiece);

    assert.ok(firstRanking.length > 0);
    assert.ok(firstRanking.every((evaluation, index) => {
        return index === 0 || firstRanking[index - 1].score >= evaluation.score;
    }));
    assert.deepEqual(firstRanking, secondRanking);
    assert.deepEqual(firstRanking[0].plannedActions, [
        "move_left",
        "move_left",
        "move_left",
        "hard_drop",
    ]);
    assert.deepEqual(firstRanking[0].placement, {
        pieceType: "bar",
        rotation: 0,
        col: 0,
        row: 18,
        cells: [
            { row: 19, col: 0 },
            { row: 19, col: 1 },
            { row: 19, col: 2 },
            { row: 19, col: 3 },
        ],
    });
});

test("getHeuristicDecision은 안정적인 성공 schema와 reason을 반환한다", async () => {
    const { getHeuristicDecision } = await import(
        "../src/client/game/ai/heuristic/heuristicEvaluator.js"
    );
    const board = createBoard();
    board[19] = [null, null, null, null, ...Array(6).fill("tree")];

    const decision = getHeuristicDecision(createGameState(board));

    assert.deepEqual(Object.keys(decision), [
        "ok",
        "source",
        "modelType",
        "selectedPlacement",
        "plannedActions",
        "score",
        "candidateCount",
        "metricsBefore",
        "metricsAfter",
        "reason",
    ]);
    assert.equal(decision.ok, true);
    assert.equal(decision.source, "heuristic_ai");
    assert.equal(decision.modelType, "heuristic");
    assert.equal(decision.plannedActions.at(-1), "hard_drop");
    assert.equal(decision.score, 10);
    assert.ok(decision.candidateCount > 0);
    assert.deepEqual(Object.keys(decision.reason), [
        "linesCleared",
        "holesDelta",
        "bumpinessDelta",
        "aggregateHeightDelta",
        "maxHeightDelta",
    ]);
    assert.equal(decision.reason.linesCleared, 1);
});

test("decision의 selectedPlacement와 plannedActions는 같은 reachable 후보에서 나온다", async () => {
    const {
        getHeuristicDecision,
        rankPlacements,
    } = await import("../src/client/game/ai/heuristic/heuristicEvaluator.js");
    const gameState = createGameState(createBoard(), "tree");
    const ranked = rankPlacements(gameState.board, gameState.activePiece);
    const decision = getHeuristicDecision(gameState);

    assert.equal(decision.ok, true);
    assert.deepEqual(decision.selectedPlacement, ranked[0].placement);
    assert.deepEqual(decision.plannedActions, ranked[0].plannedActions);
});

test("heuristicEvaluator는 도달 불가능한 고득점 placement를 선택하지 않는다", async () => {
    const {
        evaluatePlacement,
        getHeuristicDecision,
    } = await import("../src/client/game/ai/heuristic/heuristicEvaluator.js");
    const { normalizePlacement } = await import(
        "../src/client/game/ai/heuristic/placementGenerator.js"
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
    const gameState = {
        ...createGameState(board, "square"),
        activePiece: {
            pieceType: "square",
            rotation: 0,
            row: 5,
            col: 4,
        },
    };
    const unreachablePlacement = normalizePlacement({
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 0,
    });
    const unreachableEvaluation = evaluatePlacement(board, unreachablePlacement);
    const decision = getHeuristicDecision(gameState);

    assert.ok(unreachableEvaluation.score > decision.score);
    assert.notDeepEqual(decision.selectedPlacement, unreachablePlacement);
    assert.equal(decision.selectedPlacement.row, 5);
    assert.equal(decision.selectedPlacement.col, 4);
});

test("후보가 없으면 안정적인 실패 decision을 반환한다", async () => {
    const { getHeuristicDecision } = await import(
        "../src/client/game/ai/heuristic/heuristicEvaluator.js"
    );
    const board = createBoard().map(row => row.map(() => "garbage"));

    const decision = getHeuristicDecision(createGameState(board, "tree"));

    assert.deepEqual(decision, {
        ok: false,
        source: "heuristic_ai",
        modelType: "heuristic",
        errorCode: "NO_LEGAL_PLACEMENT",
        message: "No legal placement is available for the active piece.",
        candidateCount: 0,
    });
});

test("평가와 decision 생성은 원본 board와 gameState를 mutate하지 않는다", async () => {
    const {
        evaluatePlacement,
        getHeuristicDecision,
    } = await import("../src/client/game/ai/heuristic/heuristicEvaluator.js");
    const board = createBoard();
    board[19][5] = "tree";
    const gameState = createGameState(board, "square");
    const before = structuredClone(gameState);

    evaluatePlacement(board, {
        pieceType: "square",
        rotation: 0,
        col: 0,
        row: 18,
    });
    getHeuristicDecision(gameState);

    assert.deepEqual(gameState, before);
    assert.deepEqual(board, before.board);
});
