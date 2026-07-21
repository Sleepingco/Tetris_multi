const test = require("node:test");
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { mkdir, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function createSample({ gameId = "game-a", pieceIndex = 5, col = 0, selected = false, features = [] } = {}) {
    const values = [...features, ...Array(16).fill(0)].slice(0, 16);
    return {
        datasetSchemaVersion: 2,
        gameId,
        playerId: "human-a",
        pieceIndex,
        source: "human",
        pieceType: "square",
        aiDifficulty: "normal",
        candidatePlacement: { pieceType: "square", rotation: 0, row: 18, col },
        candidateResult: { linesCleared: values[0], gameOver: values[1] === 1 },
        metricDelta: {
            aggregateHeight: values[2],
            maxHeight: values[3],
            holes: values[4],
            bumpiness: values[5],
            columnHeights: values.slice(6, 16),
        },
        candidateMetricsAfter: {
            holes: Math.max(0, values[4]),
            aggregateHeight: Math.max(0, values[2]),
            bumpiness: Math.max(0, values[5]),
            maxHeight: Math.max(0, values[3]),
        },
        heuristicBaseline: {
            score: values[0],
            reason: { linesCleared: values[0] },
        },
        selectedBySource: selected,
        metadata: { isWinner: false, winnerPlayerId: "ai-a", finishType: "normal" },
    };
}

function createGroup({ gameId = "game-a", pieceIndex = 5, selectedFeatures = [1], unselectedFeatures = [[0]] } = {}) {
    return {
        decisionKey: `${gameId}:human-a:${pieceIndex}`,
        candidates: [
            createSample({ gameId, pieceIndex, col: 0, selected: true, features: selectedFeatures }),
            ...unselectedFeatures.map((features, index) => createSample({
                gameId,
                pieceIndex,
                col: index + 1,
                features,
            })),
        ],
    };
}

test("pair 생성은 selected 대 모든 unselected pair와 decision별 동일 총 weight를 만든다", async () => {
    const ranker = await import("../src/client/game/ai/ml/placementPairwiseRanker.ts");
    const groups = [
        createGroup({ gameId: "game-a", unselectedFeatures: [[0]] }),
        createGroup({ gameId: "game-b", unselectedFeatures: [[0], [0], [0]] }),
    ];
    const scaler = ranker.fitPlacementFeatureScaler(groups);
    const result = ranker.createPairwiseTrainingPairs(groups, scaler.scaler);
    const weightsByDecision = new Map();
    result.pairs.forEach(pair => {
        weightsByDecision.set(pair.decisionKey, (weightsByDecision.get(pair.decisionKey) || 0) + pair.weight);
    });

    assert.equal(result.ok, true);
    assert.equal(result.pairCount, 4);
    assert.equal(result.candidateCount, 6);
    assert.deepEqual([...weightsByDecision.values()], [1, 1]);
});

test("pair 생성은 selected feature duplicate와 zero-difference pair를 집계한다", async () => {
    const ranker = await import("../src/client/game/ai/ml/placementPairwiseRanker.ts");
    const groups = [createGroup({ selectedFeatures: [1], unselectedFeatures: [[1], [0]] })];
    const scaler = ranker.fitPlacementFeatureScaler(groups);
    const pairs = ranker.createPairwiseTrainingPairs(groups, scaler.scaler);
    const training = ranker.trainPairwiseLinearRanker(groups, { epochs: 5 });

    assert.equal(pairs.zeroDifferencePairCount, 1);
    assert.equal(pairs.zeroDifferenceDecisionCount, 1);
    assert.equal(pairs.selectedFeatureDuplicateDecisionCount, 1);
    assert.equal(training.trainingSummary.zeroDifferencePairCount, 1);
    assert.equal(training.trainingSummary.selectedFeatureDuplicateDecisionCount, 1);
});

test("pair 생성은 selected 누락을 거부하고 group과 sample을 변경하지 않는다", async () => {
    const ranker = await import("../src/client/game/ai/ml/placementPairwiseRanker.ts");
    const validGroup = createGroup();
    const scaler = ranker.fitPlacementFeatureScaler([validGroup]).scaler;
    const missing = structuredClone(validGroup);
    missing.candidates.forEach(candidate => { candidate.selectedBySource = false; });
    const original = structuredClone(validGroup);

    assert.equal(ranker.createPairwiseTrainingPairs([missing], scaler).reason, "SELECTED_CANDIDATE_MISSING");
    ranker.createPairwiseTrainingPairs([validGroup], scaler);
    assert.deepEqual(validGroup, original);
});

test("scaler는 train candidate만 사용하고 zero variance scale을 1로 유지한다", async () => {
    const ranker = await import("../src/client/game/ai/ml/placementPairwiseRanker.ts");
    const trainGroups = [createGroup({ selectedFeatures: [2], unselectedFeatures: [[0]] })];
    const validationGroup = createGroup({ gameId: "validation", selectedFeatures: [100], unselectedFeatures: [[0]] });
    const trainScaler = ranker.fitPlacementFeatureScaler(trainGroups);
    const training = ranker.trainPairwiseLinearRanker(trainGroups, { epochs: 5 });
    const before = structuredClone(training.model.scaler);
    ranker.createPairwiseLinearScorer(training.model)(validationGroup);

    assert.equal(trainScaler.scaler.mean[0], 1);
    assert.equal(trainScaler.scaler.scale[0], 1);
    assert.ok(trainScaler.scaler.scale.slice(1).every(value => value === 1));
    assert.deepEqual(training.model.scaler, before);
});

test("scaler는 non-finite feature를 명시적으로 거부한다", async () => {
    const ranker = await import("../src/client/game/ai/ml/placementPairwiseRanker.ts");
    const group = createGroup();
    group.candidates[0].metricDelta.aggregateHeight = Number.NaN;

    assert.equal(ranker.fitPlacementFeatureScaler([group]).reason, "INVALID_FEATURE_VECTOR");
});

test("optimizer는 synthetic loss를 낮추고 selected candidate에 더 높은 score를 준다", async () => {
    const ranker = await import("../src/client/game/ai/ml/placementPairwiseRanker.ts");
    const groups = [
        createGroup({ gameId: "game-a", pieceIndex: 5, selectedFeatures: [1], unselectedFeatures: [[0], [0]] }),
        createGroup({ gameId: "game-b", pieceIndex: 6, selectedFeatures: [2], unselectedFeatures: [[0], [1]] }),
    ];
    const result = ranker.trainPairwiseLinearRanker(groups, { epochs: 100, learningRate: 0.05, l2: 0.01, seed: "fixed" });
    const scores = ranker.createPairwiseLinearScorer(result.model)(groups[0]);
    const selected = groups[0].candidates[0];

    assert.equal(result.ok, true);
    assert.ok(result.trainingSummary.finalLoss < result.trainingSummary.initialLoss);
    assert.ok(result.model.weights.every(Number.isFinite));
    assert.ok(groups[0].candidates.slice(1).every(candidate => scores.get(selected) > scores.get(candidate)));
});

test("같은 config와 canonical content는 입력 순서와 무관하게 동일 model을 만든다", async () => {
    const ranker = await import("../src/client/game/ai/ml/placementPairwiseRanker.ts");
    const groups = [createGroup({ gameId: "game-a" }), createGroup({ gameId: "game-b", pieceIndex: 6 })];
    const reversed = structuredClone(groups).reverse().map(group => ({ ...group, candidates: group.candidates.reverse() }));
    const config = { epochs: 30, learningRate: 0.03, l2: 0.02, seed: "fixed" };
    const first = ranker.trainPairwiseLinearRanker(groups, config);
    const second = ranker.trainPairwiseLinearRanker(reversed, config);

    assert.deepEqual(first, second);
});

test("invalid training config는 학습 artifact 없이 실패한다", async () => {
    const ranker = await import("../src/client/game/ai/ml/placementPairwiseRanker.ts");
    const groups = [createGroup()];

    for (const config of [{ epochs: 0 }, { learningRate: 0 }, { l2: -1 }, { seed: "" }]) {
        const result = ranker.trainPairwiseLinearRanker(groups, config);
        assert.equal(result.reason, "INVALID_TRAINING_CONFIG");
        assert.equal(result.model, null);
    }
});

test("model validator는 schema, feature 순서, vector 길이와 scale을 검증한다", async () => {
    const ranker = await import("../src/client/game/ai/ml/placementPairwiseRanker.ts");
    const trained = ranker.trainPairwiseLinearRanker([createGroup()], { epochs: 5 });
    const cases = [
        ["MODEL_SCHEMA_VERSION_MISMATCH", { modelSchemaVersion: 2 }],
        ["MODEL_TYPE_MISMATCH", { modelType: "unknown" }],
        ["DATASET_SCHEMA_VERSION_MISMATCH", { datasetSchemaVersion: 1 }],
        ["FEATURE_SCHEMA_VERSION_MISMATCH", { featureSchemaVersion: 2 }],
        ["FEATURE_NAMES_MISMATCH", { featureNames: [...trained.model.featureNames].reverse() }],
        ["MODEL_VECTOR_LENGTH_MISMATCH", { weights: [0] }],
        ["MODEL_VECTOR_LENGTH_MISMATCH", { scaler: { ...trained.model.scaler, mean: [0] } }],
        ["NON_FINITE_MODEL_VALUE", { weights: trained.model.weights.map((value, index) => index === 0 ? Number.NaN : value) }],
        ["INVALID_MODEL_SCALE", { scaler: { ...trained.model.scaler, scale: trained.model.scaler.scale.map((value, index) => index === 0 ? 0 : value) } }],
    ];

    assert.equal(ranker.validatePairwiseLinearModel(trained.model).ok, true);
    cases.forEach(([reason, overrides]) => {
        const model = { ...trained.model, ...overrides };
        assert.equal(ranker.validatePairwiseLinearModel(model).reason, reason);
    });
});

test("pairwise scorer는 evaluator 계약을 통과하고 candidate group을 변경하지 않는다", async () => {
    const ranker = await import("../src/client/game/ai/ml/placementPairwiseRanker.ts");
    const { evaluateRanking } = await import("../src/client/game/ai/dataset/placementRankingEvaluator.ts");
    const group = createGroup();
    const original = structuredClone(group);
    const trained = ranker.trainPairwiseLinearRanker([group], { epochs: 20 });
    const result = evaluateRanking([group], ranker.createPairwiseLinearScorer(trained.model));

    assert.equal(result.ok, true);
    assert.equal(result.top1Accuracy, 1);
    assert.deepEqual(group, original);
    assert.throws(() => ranker.createPairwiseLinearScorer({}), /INVALID_MODEL/);
});

test("LOGO는 validation game을 scorerFactory와 fold scaler에 포함하지 않고 결정적이다", async () => {
    const ranker = await import("../src/client/game/ai/ml/placementPairwiseRanker.ts");
    const { evaluateLeaveOneGameOut } = await import("../src/client/game/ai/dataset/placementRankingEvaluator.ts");
    const groups = [
        createGroup({ gameId: "game-a", selectedFeatures: [1], unselectedFeatures: [[0]] }),
        createGroup({ gameId: "game-b", selectedFeatures: [2], unselectedFeatures: [[0]] }),
        createGroup({ gameId: "game-c", selectedFeatures: [100], unselectedFeatures: [[0]] }),
    ];
    const seenTrainGames = [];
    const scorers = trainGroups => {
        seenTrainGames.push(new Set(trainGroups.map(group => group.candidates[0].gameId)));
        const trained = ranker.trainPairwiseLinearRanker(trainGroups, { epochs: 20, seed: "fixed" });
        return ranker.createPairwiseLinearScorer(trained.model);
    };
    const first = evaluateLeaveOneGameOut(groups, scorers);
    const second = evaluateLeaveOneGameOut(groups, trainGroups => {
        const trained = ranker.trainPairwiseLinearRanker(trainGroups, { epochs: 20, seed: "fixed" });
        return ranker.createPairwiseLinearScorer(trained.model);
    });

    assert.equal(first.ok, true);
    assert.deepEqual(first, second);
    assert.deepEqual(first.folds.map(fold => fold.validationGameId), ["game-a", "game-b", "game-c"]);
    first.folds.forEach((fold, index) => assert.equal(seenTrainGames[index].has(fold.validationGameId), false));
    assert.equal(first.aggregate.gameCount, 3);
});

async function writeDataset(datasetDir, groups, manifestOverrides = {}) {
    await mkdir(datasetDir, { recursive: true });
    const rows = groups.flatMap(group => group.candidates);
    const manifest = {
        datasetSchemaVersion: 2,
        inputSha256: "fixture-input",
        sourceFilter: "human",
        selectionPolicy: "all-completed",
        requiredFinishType: "normal",
        ...manifestOverrides,
    };
    await writeFile(path.join(datasetDir, "manifest.json"), `${JSON.stringify(manifest)}\n`);
    await writeFile(path.join(datasetDir, "train.jsonl"), `${rows.map(JSON.stringify).join("\n")}\n`);
    await writeFile(path.join(datasetDir, "validation.jsonl"), "");
}

test("training CLI는 결정적인 model/evaluation artifact를 만들고 source dataset bytes를 보존한다", async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), "placement-ranker-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const datasetDir = path.join(root, "dataset");
    const outputOne = path.join(root, "output-one");
    const outputTwo = path.join(root, "output-two");
    await writeDataset(datasetDir, [
        createGroup({ gameId: "game-a", selectedFeatures: [1], unselectedFeatures: [[0], [0]] }),
        createGroup({ gameId: "game-b", selectedFeatures: [2], unselectedFeatures: [[0], [1]] }),
    ]);
    const sourcePaths = ["manifest.json", "train.jsonl", "validation.jsonl"].map(name => path.join(datasetDir, name));
    const before = await Promise.all(sourcePaths.map(filePath => readFile(filePath)));
    const args = outputDir => [
        "scripts/train-placement-ranker.js",
        "--dataset-dir", datasetDir,
        "--output-dir", outputDir,
        "--seed", "fixture",
        "--epochs", "20",
        "--learning-rate", "0.05",
        "--l2", "0.01",
    ];

    await execFileAsync(process.execPath, args(outputOne), { cwd: path.resolve(__dirname, "..") });
    await execFileAsync(process.execPath, args(outputTwo), { cwd: path.resolve(__dirname, "..") });
    const modelOne = await readFile(path.join(outputOne, "model.json"));
    const modelTwo = await readFile(path.join(outputTwo, "model.json"));
    const evaluationOne = await readFile(path.join(outputOne, "evaluation.json"));
    const evaluationTwo = await readFile(path.join(outputTwo, "evaluation.json"));
    const after = await Promise.all(sourcePaths.map(filePath => readFile(filePath)));
    const model = JSON.parse(modelOne);
    const evaluation = JSON.parse(evaluationOne);

    assert.deepEqual(modelOne, modelTwo);
    assert.deepEqual(evaluationOne, evaluationTwo);
    assert.deepEqual(after, before);
    assert.equal(model.modelType, "pairwise_linear_ranker");
    assert.equal(model.trainingSummary.decisionCount, 2);
    assert.equal(evaluation.runtimeIntegration, false);
    assert.equal(evaluation.pairwise.logo.folds.length, 2);
    assert.equal(evaluation.pairwise.logo.aggregate.gameCount, 2);
});

test("training CLI는 malformed schema와 rejected group에서 완성 artifact를 남기지 않는다", async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), "placement-ranker-failure-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const invalidSchemaDir = path.join(root, "invalid-schema");
    const rejectedDir = path.join(root, "rejected");
    const invalidOutput = path.join(root, "invalid-output");
    const rejectedOutput = path.join(root, "rejected-output");
    const groups = [createGroup({ gameId: "game-a" }), createGroup({ gameId: "game-b" })];
    await writeDataset(invalidSchemaDir, groups, { datasetSchemaVersion: 1 });
    const rejectedGroups = structuredClone(groups);
    rejectedGroups[0].candidates.forEach(candidate => { candidate.selectedBySource = false; });
    await writeDataset(rejectedDir, rejectedGroups);
    const run = (datasetDir, outputDir) => execFileAsync(process.execPath, [
        "scripts/train-placement-ranker.js",
        "--dataset-dir", datasetDir,
        "--output-dir", outputDir,
        "--epochs", "5",
    ], { cwd: path.resolve(__dirname, "..") });

    await assert.rejects(run(invalidSchemaDir, invalidOutput), /DATASET_SCHEMA_VERSION_MISMATCH/);
    await assert.rejects(run(rejectedDir, rejectedOutput), /REJECTED_DECISION_GROUPS/);
    await assert.rejects(readFile(path.join(invalidOutput, "model.json")));
    await assert.rejects(readFile(path.join(rejectedOutput, "model.json")));
});
