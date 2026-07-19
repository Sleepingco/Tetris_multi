const test = require("node:test");
const assert = require("node:assert/strict");
const { link, mkdir, mkdtemp, symlink, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");

const {
    generateBagStream,
    getScreeningStatus,
    parseArgs,
    assertDistinctOutputPaths,
    runBenchmark,
    runRollout,
    summarizePairs,
    summarizeSafety,
} = require("../scripts/run-placement-v4-pve-gameplay-benchmark.js");

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
    const coefficients = Array(16).fill(0);
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

test("결정적 generator는 매 7개가 완전한 bag이고 seed에 따라 재현된다", () => {
    const first = generateBagStream("fixture", 21);
    const second = generateBagStream("fixture", 21);

    assert.deepEqual(second, first);
    for (let index = 0; index < 21; index += 7) {
        assert.deepEqual([...first.slice(index, index + 7)].sort(), [
            "bar", "eleft", "eright", "ess", "square", "tree", "zee",
        ]);
    }
});

test("benchmark CLI는 명시적인 model, report, timing과 양의 rollout 범위를 요구한다", () => {
    assert.deepEqual(parseArgs([
        "--model", "model.json",
        "--output", "report.json",
        "--timing-output", "timing.json",
        "--streams", "3",
        "--max-placements", "50",
        "--seed-prefix", "fixture",
    ]), {
        maxPlacements: 50,
        model: "model.json",
        output: "report.json",
        seedPrefix: "fixture",
        streams: 3,
        timingOutput: "timing.json",
    });
    assert.throws(() => parseArgs(["--streams", "0"]));
});

test("heuristic과 V4는 같은 bag에서 authoritative core로 결정적 paired report를 만든다", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "placement-v4-gameplay-test-"));
    const modelPath = path.join(directory, "model.json");
    const model = createModel();
    await writeFile(modelPath, `${JSON.stringify(model)}\n`, "utf8");
    const options = {
        maxPlacements: 3,
        model: modelPath,
        output: path.join(directory, "report.json"),
        seedPrefix: "paired-fixture",
        streams: 1,
        timingOutput: path.join(directory, "timing.json"),
    };
    const dependencies = {
        allowSyntheticModel: true,
        serviceDependencies: {
            loadPlacementV4Model: () => ({
                ok: true,
                model,
                modelSha256: "synthetic-model",
            }),
        },
    };

    const first = await runBenchmark(options, dependencies);
    const second = await runBenchmark(options, dependencies);

    assert.equal(first.reportBytes, second.reportBytes);
    assert.equal(first.report.pairs.length, 1);
    assert.equal(first.report.pairs[0].heuristic.metrics.placementCount, 3);
    assert.equal(first.report.pairs[0].v4.metrics.placementCount, 3);
    assert.deepEqual(first.report.pairs[0].v4.safety, {
        invalidDecision: 0,
        modelFallback: 0,
        nonFiniteScore: 0,
        planDivergence: 0,
        unexpectedError: 0,
    });
    assert.equal("timing" in first.report, false);
    assert.equal(first.timing.canonical, false);
    assert.deepEqual(first.report.summary.safety, {
        invalidDecision: 0,
        modelFallback: 0,
        nonFiniteScore: 0,
        planDivergence: 0,
        unexpectedError: 0,
    });
});

test("safety summary는 두 policy의 false-green 원인을 모두 합산한다", () => {
    const safety = {
        invalidDecision: 0,
        modelFallback: 0,
        nonFiniteScore: 0,
        planDivergence: 0,
        unexpectedError: 0,
    };
    assert.deepEqual(summarizeSafety([{
        heuristic: { safety: { ...safety, invalidDecision: 1 } },
        v4: { safety: { ...safety, modelFallback: 2 } },
    }]), {
        invalidDecision: 1,
        modelFallback: 2,
        nonFiniteScore: 0,
        planDivergence: 0,
        unexpectedError: 0,
    });
});

test("paired summary는 horizon censoring과 game-over 생존 우열을 구분한다", () => {
    const rollout = (stoppedReason, placementCount) => ({
        metrics: { placementCount },
        stoppedReason,
    });
    assert.deepEqual(summarizePairs([
        { heuristic: rollout("PLACEMENT_CAP", 50), placementDelta: 0, v4: rollout("PLACEMENT_CAP", 50) },
        { heuristic: rollout("GAME_OVER", 20), placementDelta: 30, v4: rollout("PLACEMENT_CAP", 50) },
        { heuristic: rollout("PLACEMENT_CAP", 50), placementDelta: -30, v4: rollout("GAME_OVER", 20) },
        { heuristic: rollout("GAME_OVER", 20), placementDelta: 0, v4: rollout("GAME_OVER", 20) },
    ]), {
        bothSurvivedHorizon: 1,
        exactGameOverTie: 1,
        meanPlacementDelta: 0,
        totalPlacementDelta: 0,
        v4SurvivalLoss: 1,
        v4SurvivalWin: 1,
    });
});

test("30-stream screening은 horizon count 차이 3까지 통과하고 4부터 회귀다", () => {
    assert.equal(getScreeningStatus(30, 27), "gameplay_screening_passed");
    assert.equal(getScreeningStatus(30, 26), "gameplay_regression_detected");
});

test("30x500이라도 고정 full seed가 아니면 policy decision cohort가 아니다", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "placement-v4-cohort-test-"));
    const modelPath = path.join(directory, "model.json");
    await writeFile(modelPath, `${JSON.stringify(createModel())}\n`, "utf8");
    const result = await runBenchmark({
        maxPlacements: 500,
        model: modelPath,
        output: path.join(directory, "report.json"),
        seedPrefix: "different-full-seed",
        streams: 30,
        timingOutput: path.join(directory, "timing.json"),
    }, {
        allowSyntheticModel: true,
        serviceDependencies: {
            createService() {
                return { async processAiStep() { return { gameOver: true, ok: false, reason: "NO_LEGAL_PLACEMENT" }; } };
            },
        },
    });
    assert.equal(result.report.runMode, "smoke");
    assert.equal(result.report.fullCohortCovered, false);
    assert.equal(result.report.policyDecisionEligible, false);
    assert.equal(result.report.canonicalResultEligible, false);
});

test("synthetic failure는 unexpected safety failure로 끝난다", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "placement-v4-synthetic-failure-"));
    const modelPath = path.join(directory, "model.json");
    await writeFile(modelPath, `${JSON.stringify(createModel())}\n`, "utf8");
    const rollout = await runRollout({
        bagStream: generateBagStream("synthetic-failure", 14),
        maxPlacements: 3,
        modelPath: "unused",
        policy: "heuristic",
        roomId: "BENCH-SYNTHETIC-FAILURE",
        serviceDependencies: {
            createService() {
                return {
                    async processAiStep() {
                        return { ok: false, reason: "SYNTHETIC_FAILURE" };
                    },
                };
            },
        },
    });
    assert.equal(rollout.stoppedReason, "SYNTHETIC_FAILURE");
    assert.equal(rollout.safety.unexpectedError, 1);
    const result = await runBenchmark({
        maxPlacements: 3,
        model: modelPath,
        output: path.join(directory, "report.json"),
        seedPrefix: "synthetic-failure",
        streams: 1,
        timingOutput: path.join(directory, "timing.json"),
    }, {
        allowSyntheticModel: true,
        serviceDependencies: {
            createService() {
                return { async processAiStep() { return { ok: false, reason: "SYNTHETIC_FAILURE" }; } };
            },
        },
    });
    assert.equal(result.report.status, "gameplay_benchmark_safety_failed");
});

test("output paths는 exact, alias, symlink, hardlink source collision을 거부한다", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "placement-v4-output-test-"));
    const modelPath = path.join(directory, "model.json");
    await writeFile(modelPath, "model", "utf8");
    const timingPath = path.join(directory, "timing.json");
    const paths = (output, timing = timingPath) => ({
        canonicalOutput: output,
        model: modelPath,
        timingOutput: timing,
    });
    await assert.rejects(assertDistinctOutputPaths(paths(modelPath)), /Output path conflict/);
    await assert.rejects(assertDistinctOutputPaths(paths(path.join(directory, "nested", "..", "model.json"))), /Output path conflict/);
    const symlinkPath = path.join(directory, "model-symlink.json");
    await symlink(modelPath, symlinkPath);
    await assert.rejects(assertDistinctOutputPaths(paths(symlinkPath)), /Output symlink is not allowed/);
    const hardlinkPath = path.join(directory, "model-hardlink.json");
    await link(modelPath, hardlinkPath);
    await assert.rejects(assertDistinctOutputPaths(paths(hardlinkPath)), /Output path conflict/);

    const outputSymlink = path.join(directory, "existing-output-symlink.json");
    await symlink(timingPath, outputSymlink);
    await assert.rejects(assertDistinctOutputPaths(paths(outputSymlink)), /Output symlink is not allowed/);
    const danglingOutputSymlink = path.join(directory, "dangling-output-symlink.json");
    await symlink(path.join(directory, "missing-target.json"), danglingOutputSymlink);
    await assert.rejects(assertDistinctOutputPaths(paths(danglingOutputSymlink)), /Output symlink is not allowed/);

    const realParent = path.join(directory, "real-parent");
    const symlinkParent = path.join(directory, "symlink-parent");
    await mkdir(realParent);
    await symlink(realParent, symlinkParent);
    await assert.rejects(assertDistinctOutputPaths({
        canonicalOutput: path.join(realParent, "new-report.json"),
        model: modelPath,
        timingOutput: path.join(symlinkParent, "new-report.json"),
    }), /Output path conflict/);
});
