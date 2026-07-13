const test = require("node:test");
const assert = require("node:assert/strict");

function createBoard() {
    return Array.from({ length: 20 }, () => Array(10).fill(null));
}

test("human placement 분석은 heuristic 선택과 user 선택을 같은 board에서 비교한다", async () => {
    const { createHumanPlacementLogAnalysis } = await import(
        "../src/client/game/ai/heuristic/placementLogAnalysis.js"
    );
    const boardBefore = createBoard();
    const boardAfter = createBoard();
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
    const originalBoard = structuredClone(boardBefore);

    const analysis = createHumanPlacementLogAnalysis({
        boardBefore,
        boardAfter,
        activePiece: selectedPlacement,
        selectedPlacement,
    });

    assert.ok(analysis);
    assert.deepEqual(analysis.metricsBefore.columnHeights, Array(10).fill(0));
    assert.equal(analysis.metricsAfter.aggregateHeight, 4);
    assert.equal(analysis.evaluation.candidateCount > 0, true);
    assert.equal(analysis.aiComparison.userScore, analysis.evaluation.score);
    assert.equal(
        analysis.aiComparison.betterBy,
        analysis.aiComparison.heuristicScore - analysis.aiComparison.userScore,
    );
    assert.equal(typeof analysis.aiComparison.samePlacement, "boolean");
    assert.deepEqual(boardBefore, originalBoard);
});

test("human placement 분석은 평가 불가능한 placement를 안전하게 거부한다", async () => {
    const { createHumanPlacementLogAnalysis } = await import(
        "../src/client/game/ai/heuristic/placementLogAnalysis.js"
    );
    const board = createBoard();

    const analysis = createHumanPlacementLogAnalysis({
        boardBefore: board,
        boardAfter: board,
        activePiece: { pieceType: "square" },
        selectedPlacement: null,
    });

    assert.equal(analysis, null);
});
