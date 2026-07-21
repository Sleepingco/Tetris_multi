const test = require("node:test");
const assert = require("node:assert/strict");

const FEATURE_NAMES = [
    "candidateResult.linesCleared",
    "candidateResult.gameOver",
    "metricDelta.aggregateHeight",
    "metricDelta.maxHeight",
    "metricDelta.holes",
    "metricDelta.bumpiness",
    ...Array.from({ length: 10 }, (_, index) => `metricDelta.columnHeights[${index}]`),
];

function createModel() {
    const coefficients = [1, ...Array(15).fill(0)];
    return {
        canonicalArtifact: false,
        coefficients,
        datasetSchemaVersion: 2,
        featureNames: FEATURE_NAMES,
        featureSchemaVersion: 1,
        modelSchemaVersion: 1,
        modelType: "pairwise_linear_ranker",
        productionIntegration: false,
        representation: {
            name: "V4",
            selectedClassAliasesExcluded: true,
            unit: "occupied-cell physical class",
        },
        scaler: { mean: Array(16).fill(0), scale: Array(16).fill(1) },
        weights: coefficients.slice(),
    };
}

function createMetrics(values = {}) {
    return {
        aggregateHeight: values.aggregateHeight ?? 10,
        maxHeight: values.maxHeight ?? 4,
        holes: values.holes ?? 2,
        bumpiness: values.bumpiness ?? 6,
        columnHeights: values.columnHeights ?? [0, 1, 2, 3, 4, 0, 0, 0, 0, 0],
    };
}

function createEvaluation({ col, linesCleared, gameOver = false, score }) {
    const metricsBefore = createMetrics();
    const metricsAfter = createMetrics({
        aggregateHeight: 12 + col,
        maxHeight: 5,
        holes: 1,
        bumpiness: 8,
        columnHeights: [1, 1, 3, 3, 5, 0, 0, 0, 0, col],
    });
    return {
        placement: {
            pieceType: "square",
            rotation: 0,
            row: 18,
            col,
            cells: [
                { row: 18, col },
                { row: 18, col: col + 1 },
                { row: 19, col },
                { row: 19, col: col + 1 },
            ],
        },
        boardAfter: [],
        linesCleared,
        gameOver,
        score,
        metricsBefore,
        metricsAfter,
        reason: { linesCleared, holesDelta: -1 },
        plannedActions: col === 1 ? ["move_left", "hard_drop"] : ["hard_drop"],
    };
}

function createState() {
    return {
        board: Array.from({ length: 20 }, () => Array(10).fill(null)),
        activePiece: { pieceType: "square", rotation: 0, row: -1, col: 3 },
    };
}

test("adapter는 한 번의 heuristic ranking을 정확한 candidate와 metric delta로 변환한다", async () => {
    const { getPlacementV4PveDecision } = await import(
        "../src/client/game/ai/ml/placementV4PveDecisionAdapter.ts"
    );
    const evaluations = [
        createEvaluation({ col: 1, linesCleared: 0, score: 20 }),
        createEvaluation({ col: 3, linesCleared: 1, score: 10 }),
    ];
    let rankCallCount = 0;
    let receivedCandidates;
    const decision = getPlacementV4PveDecision(createModel(), createState(), {
        rankPlacements() {
            rankCallCount += 1;
            return evaluations;
        },
        rankPlacementV4Candidates(model, candidates) {
            receivedCandidates = candidates;
            return {
                ok: true,
                classes: [{ classKey: "selected-class", linearScore: 7.5 }],
                selectedClassKey: "selected-class",
                selectedRepresentativeKey: "square:0:18:3",
                physicalClassCount: 2,
                unavoidableGameOver: false,
            };
        },
    });

    assert.equal(rankCallCount, 1);
    assert.deepEqual(receivedCandidates[1], {
        candidatePlacement: evaluations[1].placement,
        candidateResult: { linesCleared: 1, gameOver: false },
        metricDelta: {
            aggregateHeight: 5,
            maxHeight: 1,
            holes: -1,
            bumpiness: 2,
            columnHeights: [1, 0, 1, 0, 1, 0, 0, 0, 0, 3],
        },
    });
    assert.deepEqual(decision, {
        ok: true,
        source: "ml_ai",
        modelType: "pairwise_linear_ranker",
        selectedPlacement: evaluations[1].placement,
        plannedActions: ["hard_drop"],
        score: 7.5,
        candidateCount: 2,
        metricsBefore: evaluations[1].metricsBefore,
        metricsAfter: evaluations[1].metricsAfter,
        reason: evaluations[1].reason,
        selectedClassKey: "selected-class",
        selectedRepresentativeKey: "square:0:18:3",
        physicalClassCount: 2,
        unavoidableGameOver: false,
        policyRequested: "placement_v4",
        policyUsed: "placement_v4",
        fallbackReason: null,
    });
});

test("adapter는 실제 V4 scorer 결과를 evaluation과 결정적으로 다시 연결한다", async () => {
    const { getPlacementV4PveDecision } = await import(
        "../src/client/game/ai/ml/placementV4PveDecisionAdapter.ts"
    );
    const evaluations = [
        createEvaluation({ col: 1, linesCleared: 0, score: 20 }),
        createEvaluation({ col: 3, linesCleared: 1, score: 10 }),
    ];
    const model = createModel();
    const state = createState();
    const before = structuredClone({ evaluations, model, state });
    const rank = () => structuredClone(evaluations);

    const first = getPlacementV4PveDecision(model, state, { rankPlacements: rank });
    const second = getPlacementV4PveDecision(model, state, { rankPlacements: rank });

    assert.deepEqual(second, first);
    assert.equal(first.selectedRepresentativeKey, "square:0:18:3");
    assert.equal(first.score, 1);
    assert.deepEqual({ evaluations, model, state }, before);
});

test("adapter 실패는 생성된 같은 ranking의 첫 heuristic 후보로 fallback한다", async (t) => {
    const { getPlacementV4PveDecision } = await import(
        "../src/client/game/ai/ml/placementV4PveDecisionAdapter.ts"
    );
    const first = createEvaluation({ col: 1, linesCleared: 0, score: 20 });
    const validSecond = createEvaluation({ col: 3, linesCleared: 1, score: 10 });
    const cases = [
        {
            name: "candidate conversion",
            evaluations: [{ ...first, metricsAfter: {} }, validSecond],
            scorer: () => assert.fail("scorer must not run"),
            reason: "CANDIDATE_ADAPTER_FAILED",
        },
        {
            name: "scorer rejection",
            evaluations: [first, validSecond],
            scorer: () => ({ ok: false, reason: "INVALID_CANDIDATE" }),
            reason: "V4_SCORER_FAILED:INVALID_CANDIDATE",
        },
        {
            name: "representative mapping",
            evaluations: [first, validSecond],
            scorer: () => ({
                ok: true,
                classes: [{ classKey: "missing-class", linearScore: 1 }],
                selectedClassKey: "missing-class",
                selectedRepresentativeKey: "square:0:18:9",
                physicalClassCount: 2,
                unavoidableGameOver: false,
            }),
            reason: "REPRESENTATIVE_NOT_FOUND",
        },
    ];

    for (const fixture of cases) {
        await t.test(fixture.name, () => {
            let rankCallCount = 0;
            const decision = getPlacementV4PveDecision(createModel(), createState(), {
                rankPlacements() {
                    rankCallCount += 1;
                    return fixture.evaluations;
                },
                rankPlacementV4Candidates: fixture.scorer,
            });

            assert.equal(rankCallCount, 1);
            assert.equal(decision.policyUsed, "heuristic");
            assert.equal(decision.fallbackReason, fixture.reason);
            assert.equal(decision.score, first.score);
            assert.deepEqual(decision.selectedPlacement, first.placement);
        });
    }
});

test("reachable 후보가 없으면 기존 NO_LEGAL_PLACEMENT 실패를 반환한다", async () => {
    const { getPlacementV4PveDecision } = await import(
        "../src/client/game/ai/ml/placementV4PveDecisionAdapter.ts"
    );
    let scorerCalled = false;
    const result = getPlacementV4PveDecision(createModel(), createState(), {
        rankPlacements: () => [],
        rankPlacementV4Candidates() {
            scorerCalled = true;
        },
    });

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "NO_LEGAL_PLACEMENT");
    assert.equal(scorerCalled, false);
});
