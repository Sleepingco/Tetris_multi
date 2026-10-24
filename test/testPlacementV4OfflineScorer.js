/**
 * 동결된 V4 모델을 gameplay와 분리해 순수하게 점수화하는 offline scorer 테스트다.
 *
 * Python reference fixture와 같은 후보를 준비해 선형 점수, 물리적으로 같은 placement의 class 묶음,
 * 안전한 class가 있을 때의 game-over class 제외, 모두 위험할 때의 unavoidable 판정과 결정적
 * tie-break를 검증한다. sigmoid 확률이 아니라 표준화 feature의 선형 합으로 순위를 정한다는
 * 점과 실험용 artifact 표식을 강제한다는 점이 핵심이다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const FIXTURE_PATH = path.join(ROOT, "scripts/ml/tests/fixtures/placement_v4_reference_inference_fixture.json");
const MODEL_PATH = path.join(ROOT, "data/models/placement-v4-125g-candidate/model.json");
const REFERENCE_REPORT_PATH = path.join(
    ROOT,
    "data/ml-experiments/placement-v4-reference-inference-safety/reference-report.json",
);
const FEATURE_NAMES = [
    "candidateResult.linesCleared",
    "candidateResult.gameOver",
    "metricDelta.aggregateHeight",
    "metricDelta.maxHeight",
    "metricDelta.holes",
    "metricDelta.bumpiness",
    "metricDelta.columnHeights[0]",
    "metricDelta.columnHeights[1]",
    "metricDelta.columnHeights[2]",
    "metricDelta.columnHeights[3]",
    "metricDelta.columnHeights[4]",
    "metricDelta.columnHeights[5]",
    "metricDelta.columnHeights[6]",
    "metricDelta.columnHeights[7]",
    "metricDelta.columnHeights[8]",
    "metricDelta.columnHeights[9]",
];

function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, "utf8"));
}

function createModel(overrides = {}) {
    const coefficients = Array(16).fill(0);
    return {
        canonicalArtifact: false,
        coefficients,
        datasetSchemaVersion: 2,
        featureNames: FEATURE_NAMES.slice(),
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
        ...overrides,
    };
}

function getScenario(fixture, scenarioId) {
    return fixture.scenarios.find(scenario => scenario.scenarioId === scenarioId);
}

function assertExpectedScenario(result, expected) {
    assert.equal(result.ok, true);
    assert.equal(result.selectedClassKey, expected.selectedClassKey);
    assert.equal(result.selectedRepresentativeKey, expected.selectedRepresentativeKey);
    assert.equal(result.safeClassAvailable, expected.safeClassAvailable);
    assert.equal(result.filteredGameOverClassCount, expected.filteredGameOverClassCount);
    assert.equal(result.unavoidableGameOver, expected.unavoidableGameOver);
    for (const [classKey, rank] of Object.entries(expected.classRanks)) {
        assert.equal(result.classes.find(item => item.classKey === classKey).finalRank, rank);
    }
}

test("V4 scorer는 Python fixture를 복제하지 않고 grouping, safety, tie-break를 재현한다", async () => {
    const { rankPlacementV4Candidates } = await import(
        "../src/client/game/ai/ml/placementV4OfflineScorer.ts"
    );
    const fixture = readJson(FIXTURE_PATH);
    const model = createModel();
    const before = JSON.stringify({ fixture, model });

    for (const scenario of fixture.scenarios) {
        const result = rankPlacementV4Candidates(model, scenario.candidates);
        assertExpectedScenario(result, scenario.expected);
        assert.deepEqual(
            rankPlacementV4Candidates(model, scenario.candidates.slice().reverse()),
            result,
        );
    }

    const aliasResult = rankPlacementV4Candidates(model, getScenario(fixture, "alias-grouping").candidates);
    assert.equal(aliasResult.physicalClassCount, 2);
    assert.equal(aliasResult.classes.find(item => item.classKey === aliasResult.selectedClassKey).aliasCount, 2);
    assert.equal(JSON.stringify({ fixture, model }), before);
});

test("linear score는 sigmoid 없이 coefficient dot standardized feature를 계산한다", async () => {
    const { rankPlacementV4Candidates } = await import(
        "../src/client/game/ai/ml/placementV4OfflineScorer.ts"
    );
    const fixture = readJson(FIXTURE_PATH);
    const candidate = structuredClone(getScenario(fixture, "alias-grouping").candidates[1]);
    const coefficients = Array.from({ length: 16 }, (_, index) => index + 1);
    const mean = Array.from({ length: 16 }, (_, index) => index / 10);
    const scale = Array.from({ length: 16 }, (_, index) => index + 1);
    const model = createModel({
        coefficients,
        scaler: { mean, scale },
        weights: coefficients.slice(),
    });
    const raw = [
        candidate.candidateResult.linesCleared,
        0,
        candidate.metricDelta.aggregateHeight,
        candidate.metricDelta.maxHeight,
        candidate.metricDelta.holes,
        candidate.metricDelta.bumpiness,
        ...candidate.metricDelta.columnHeights,
    ];
    const expected = raw.reduce((score, value, index) => {
        return score + coefficients[index] * ((value - mean[index]) / scale[index]);
    }, 0);

    const result = rankPlacementV4Candidates(model, [candidate]);

    assert.equal(result.ok, true);
    assert.equal(result.classes[0].linearScore, expected);
});

test("artifact validator는 V4 schema, vector, scaler와 frozen 상태를 강제한다", async () => {
    const { validatePlacementV4Model } = await import(
        "../src/client/game/ai/ml/placementV4OfflineScorer.ts"
    );
    const valid = createModel();
    const cases = [
        ["INVALID_MODEL", null],
        ["MODEL_SCHEMA_VERSION_MISMATCH", { ...valid, modelSchemaVersion: 2 }],
        ["DATASET_SCHEMA_VERSION_MISMATCH", { ...valid, datasetSchemaVersion: 1 }],
        ["FEATURE_SCHEMA_VERSION_MISMATCH", { ...valid, featureSchemaVersion: 2 }],
        ["MODEL_TYPE_MISMATCH", { ...valid, modelType: "unknown" }],
        ["FEATURE_NAMES_MISMATCH", { ...valid, featureNames: valid.featureNames.slice().reverse() }],
        ["CANONICAL_ARTIFACT_MUST_BE_FALSE", { ...valid, canonicalArtifact: true }],
        ["PRODUCTION_INTEGRATION_MUST_BE_FALSE", { ...valid, productionIntegration: true }],
        ["V4_REPRESENTATION_CONTRACT_MISMATCH", { ...valid, representation: { ...valid.representation, name: "V3" } }],
        ["INVALID_COEFFICIENTS", { ...valid, coefficients: [0] }],
        ["INVALID_COEFFICIENTS", { ...valid, coefficients: valid.coefficients.map((value, index) => index ? value : Number.NaN) }],
        ["COEFFICIENT_WEIGHT_MISMATCH", { ...valid, weights: valid.weights.map((value, index) => index ? value : 1) }],
        ["MODEL_VECTOR_LENGTH_MISMATCH", { ...valid, scaler: { ...valid.scaler, mean: [0] } }],
        ["NON_FINITE_MODEL_VALUE", { ...valid, scaler: { ...valid.scaler, mean: valid.scaler.mean.map((value, index) => index ? value : Infinity) } }],
        ["INVALID_MODEL_SCALE", { ...valid, scaler: { ...valid.scaler, scale: valid.scaler.scale.map((value, index) => index ? value : 0) } }],
    ];

    assert.deepEqual(validatePlacementV4Model(valid), { ok: true, reason: null });
    for (const [reason, model] of cases) {
        assert.equal(validatePlacementV4Model(model).reason, reason);
    }
});

test("candidate validator는 malformed input과 class 내부 불일치를 명시적으로 거부한다", async () => {
    const { rankPlacementV4Candidates } = await import(
        "../src/client/game/ai/ml/placementV4OfflineScorer.ts"
    );
    const fixture = readJson(FIXTURE_PATH);
    const source = getScenario(fixture, "alias-grouping").candidates;
    const model = createModel();

    assert.equal(rankPlacementV4Candidates(model, []).reason, "EMPTY_CANDIDATES");

    const invalidCases = [
        candidate => { candidate.candidatePlacement.pieceType = 1; },
        candidate => { candidate.candidatePlacement.rotation = 0.5; },
        candidate => { candidate.candidatePlacement.cells[0].row = "10"; },
        candidate => { candidate.candidateResult.linesCleared = 0.5; },
        candidate => { candidate.candidateResult.gameOver = 0; },
        candidate => { candidate.metricDelta.holes = Number.NaN; },
        candidate => { candidate.metricDelta.bumpiness = Infinity; },
    ];
    for (const mutate of invalidCases) {
        const candidate = structuredClone(source[0]);
        mutate(candidate);
        assert.equal(rankPlacementV4Candidates(model, [candidate]).reason, "INVALID_CANDIDATE");
    }

    const duplicateCell = structuredClone(source[0]);
    duplicateCell.candidatePlacement.cells[1] = { ...duplicateCell.candidatePlacement.cells[0] };
    assert.equal(rankPlacementV4Candidates(model, [duplicateCell]).reason, "DUPLICATE_OCCUPIED_CELL");

    const duplicatePlacement = [structuredClone(source[0]), structuredClone(source[0])];
    assert.equal(rankPlacementV4Candidates(model, duplicatePlacement).reason, "DUPLICATE_PLACEMENT_KEY");

    const featureMismatch = [structuredClone(source[0]), structuredClone(source[2])];
    featureMismatch[1].metricDelta.holes = 1;
    assert.equal(rankPlacementV4Candidates(model, featureMismatch).reason, "CLASS_FEATURE_MISMATCH");

    const resultMismatch = [structuredClone(source[0]), structuredClone(source[2])];
    resultMismatch[1].candidateResult.gameOver = true;
    assert.equal(rankPlacementV4Candidates(model, resultMismatch).reason, "CLASS_FEATURE_MISMATCH");
});

const hasFrozenArtifacts = existsSync(MODEL_PATH) && existsSync(REFERENCE_REPORT_PATH);

test("frozen artifact는 Python reference report와 class score 및 ranking이 일치한다", {
    skip: !hasFrozenArtifacts,
}, async () => {
    const { rankPlacementV4Candidates } = await import(
        "../src/client/game/ai/ml/placementV4OfflineScorer.ts"
    );
    const model = readJson(MODEL_PATH);
    const fixture = readJson(FIXTURE_PATH);
    const reference = readJson(REFERENCE_REPORT_PATH);
    const before = JSON.stringify({ fixture, model });
    let maximumScoreError = 0;

    for (const expected of reference.scenarios) {
        const scenario = getScenario(fixture, expected.scenarioId);
        const result = rankPlacementV4Candidates(model, scenario.candidates);
        const reversed = rankPlacementV4Candidates(model, scenario.candidates.slice().reverse());

        assert.equal(result.ok, true);
        assert.deepEqual(reversed, result);
        for (const field of [
            "candidateCount",
            "filteredGameOverClassCount",
            "physicalClassCount",
            "safeClassAvailable",
            "selectedClassKey",
            "selectedRepresentativeKey",
            "unavoidableGameOver",
        ]) {
            assert.deepEqual(result[field], expected[field]);
        }
        assert.equal(result.classes.length, expected.classes.length);
        for (const expectedClass of expected.classes) {
            const actualClass = result.classes.find(item => item.classKey === expectedClass.classKey);
            assert.ok(actualClass);
            for (const field of [
                "aliasCount",
                "classKey",
                "excludedByGameOverSafety",
                "finalRank",
                "gameOver",
                "representativeKey",
            ]) {
                assert.deepEqual(actualClass[field], expectedClass[field]);
            }
            maximumScoreError = Math.max(
                maximumScoreError,
                Math.abs(actualClass.linearScore - expectedClass.linearScore),
            );
        }
    }

    assert.ok(maximumScoreError <= 1e-12, `maximum score error: ${maximumScoreError}`);
    assert.equal(JSON.stringify({ fixture, model }), before);
});
