const test = require("node:test");
const assert = require("node:assert/strict");

function createBoard() {
    return Array.from({ length: 20 }, () => Array(10).fill(null));
}

test("human placement 분석은 heuristic 선택과 user 선택을 같은 board에서 비교한다", async () => {
    const [
        { createHumanPlacementLogAnalysis },
        { rankPlacements },
    ] = await Promise.all([
        import("../src/client/game/ai/heuristic/placementLogAnalysis.ts"),
        import("../src/client/game/ai/heuristic/heuristicEvaluator.ts"),
    ]);
    const boardBefore = createBoard();
    boardBefore[18][3] = "tree";
    const boardAfter = structuredClone(boardBefore);
    boardAfter[18][4] = "square";
    boardAfter[18][5] = "square";
    boardAfter[19][4] = "square";
    boardAfter[19][5] = "square";
    const selectedPlacement = {
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 4,
        cells: [
            { row: 18, col: 4 },
            { row: 18, col: 5 },
            { row: 19, col: 4 },
            { row: 19, col: 5 },
        ],
    };
    const activePieceAtDecisionStart = {
        pieceType: "square",
        rotation: 0,
        row: -1,
        col: 3,
    };
    const originalBoard = structuredClone(boardBefore);
    const originalActivePiece = structuredClone(activePieceAtDecisionStart);
    const originalSelectedPlacement = structuredClone(selectedPlacement);
    const expectedCandidates = rankPlacements(boardBefore, activePieceAtDecisionStart);
    const lockedPieceCandidates = rankPlacements(boardBefore, selectedPlacement);

    const analysis = createHumanPlacementLogAnalysis({
        boardBefore,
        boardAfter,
        activePieceAtDecisionStart,
        selectedPlacement,
    });

    assert.ok(analysis);
    assert.equal(analysis.metricsBefore.aggregateHeight, 2);
    assert.equal(analysis.metricsAfter.aggregateHeight, 6);
    assert.equal(analysis.evaluation.candidateCount, expectedCandidates.length);
    assert.notEqual(analysis.evaluation.candidateCount, lockedPieceCandidates.length);
    assert.deepEqual(analysis.aiComparison.heuristicPlacement, expectedCandidates[0].placement);
    assert.equal(analysis.aiComparison.userScore, analysis.evaluation.score);
    assert.equal(
        analysis.aiComparison.betterBy,
        analysis.aiComparison.heuristicScore - analysis.aiComparison.userScore,
    );
    assert.equal(typeof analysis.aiComparison.samePlacement, "boolean");
    assert.deepEqual(boardBefore, originalBoard);
    assert.deepEqual(activePieceAtDecisionStart, originalActivePiece);
    assert.deepEqual(selectedPlacement, originalSelectedPlacement);
});

test("human placement 분석은 평가 불가능한 placement를 안전하게 거부한다", async () => {
    const { createHumanPlacementLogAnalysis } = await import(
        "../src/client/game/ai/heuristic/placementLogAnalysis.ts"
    );
    const board = createBoard();

    const analysis = createHumanPlacementLogAnalysis({
        boardBefore: board,
        boardAfter: board,
        activePieceAtDecisionStart: { pieceType: "square" },
        selectedPlacement: null,
    });

    assert.equal(analysis, null);
});

test("human placement 분석은 판단 시작 조각이 없거나 잘못되면 null을 반환한다", async () => {
    const { createHumanPlacementLogAnalysis } = await import(
        "../src/client/game/ai/heuristic/placementLogAnalysis.ts"
    );
    const board = createBoard();
    const selectedPlacement = {
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 4,
    };

    const missingStart = createHumanPlacementLogAnalysis({
        boardBefore: board,
        boardAfter: board,
        activePieceAtDecisionStart: null,
        selectedPlacement,
    });
    const invalidStart = createHumanPlacementLogAnalysis({
        boardBefore: board,
        boardAfter: board,
        activePieceAtDecisionStart: {
            pieceType: "unknown",
            rotation: 0,
            row: -1,
            col: 3,
        },
        selectedPlacement,
    });

    assert.equal(missingStart, null);
    assert.equal(invalidStart, null);
});
