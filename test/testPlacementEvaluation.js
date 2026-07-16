const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const os = require("node:os");
const path = require("node:path");

const execFileAsync = promisify(execFile);

function createSample(overrides = {}) {
    const placement = overrides.candidatePlacement || {
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 3,
    };
    return {
        datasetSchemaVersion: 2,
        gameId: "game-a",
        playerId: "player-a",
        pieceIndex: 5,
        source: "human",
        pieceType: "square",
        aiDifficulty: "normal",
        boardBefore: [[null]],
        metricsBefore: { aggregateHeight: 0 },
        candidatePlacement: placement,
        candidateResult: { linesCleared: 0, gameOver: false },
        metricDelta: {
            aggregateHeight: 1,
            maxHeight: 1,
            holes: 0,
            bumpiness: 0,
            columnHeights: Array(10).fill(0),
        },
        candidateMetricsAfter: {},
        selectedBySource: false,
        heuristicBaseline: { score: 0, reason: { linesCleared: 0 } },
        metadata: { isWinner: true, winnerPlayerId: "player-a", finishType: "normal" },
        ...overrides,
    };
}

function createGroupSamples(gameId = "game-a") {
    return [
        createSample({ gameId, candidatePlacement: { pieceType: "square", rotation: 0, row: 18, col: 2 }, heuristicBaseline: { score: 3, reason: {} } }),
        createSample({ gameId, candidatePlacement: { pieceType: "square", rotation: 0, row: 18, col: 3 }, selectedBySource: true, heuristicBaseline: { score: 2, reason: {} } }),
        createSample({ gameId, candidatePlacement: { pieceType: "square", rotation: 0, row: 18, col: 4 }, heuristicBaseline: { score: 1, reason: {} } }),
    ];
}

test("feature schema는 고정 순서, boolean 변환, mutation 방지를 제공한다", async () => {
    const { extractPlacementFeatures, PLACEMENT_FEATURE_NAMES } = await import(
        "../src/client/game/ai/dataset/placementFeatureSchema.js"
    );
    const sample = createSample({ candidateResult: { linesCleared: 2, gameOver: true } });
    const original = structuredClone(sample);
    const result = extractPlacementFeatures(sample);

    assert.equal(PLACEMENT_FEATURE_NAMES.length, 16);
    assert.deepEqual(result.values.slice(0, 6), [2, 1, 1, 1, 0, 0]);
    assert.deepEqual(sample, original);
});

test("feature schema는 malformed result와 10열이 아닌 delta를 거부한다", async () => {
    const { extractPlacementFeatures } = await import(
        "../src/client/game/ai/dataset/placementFeatureSchema.js"
    );
    assert.equal(extractPlacementFeatures(createSample({ datasetSchemaVersion: 1 })).reason, "UNSUPPORTED_DATASET_SCHEMA_VERSION");
    assert.equal(extractPlacementFeatures(createSample({ candidateResult: { linesCleared: -1, gameOver: false } })).ok, false);
    assert.equal(extractPlacementFeatures(createSample({ metricDelta: { columnHeights: [] } })).reason, "INVALID_METRIC_DELTA");
    assert.equal(extractPlacementFeatures(createSample({ metricDelta: { aggregateHeight: 0, maxHeight: 0, holes: 0, bumpiness: 0, columnHeights: Array(9).fill(0) } })).reason, "INVALID_COLUMN_HEIGHT_DELTA");
});

test("decision group은 exactly-one selected와 duplicate placement를 검증하고 순서를 고정한다", async () => {
    const { groupPlacementDecisions } = await import(
        "../src/client/game/ai/dataset/placementDecisionGroups.js"
    );
    const samples = createGroupSamples();
    const forward = groupPlacementDecisions(samples);
    const reversed = groupPlacementDecisions([...samples].reverse());
    const duplicate = groupPlacementDecisions([...samples, structuredClone(samples[0])]);
    const missing = groupPlacementDecisions(samples.map(sample => ({ ...sample, selectedBySource: false })));

    assert.deepEqual(forward, reversed);
    assert.equal(forward.groups.length, 1);
    assert.equal(duplicate.rejected[0].reason, "DUPLICATE_CANDIDATE_PLACEMENT");
    assert.equal(missing.rejected[0].reason, "SELECTED_CANDIDATE_MISSING");
});

test("decision group은 AI 난이도와 결과 metadata 불일치를 거부한다", async () => {
    const { groupPlacementDecisions } = await import(
        "../src/client/game/ai/dataset/placementDecisionGroups.js"
    );
    const samples = createGroupSamples();
    const difficultyConflict = groupPlacementDecisions(samples.map((sample, index) => {
        return index === 1 ? { ...sample, aiDifficulty: "hard" } : sample;
    }));
    const outcomeConflict = groupPlacementDecisions(samples.map((sample, index) => {
        return index === 1 ? { ...sample, metadata: { ...sample.metadata, isWinner: false } } : sample;
    }));
    const finishConflict = groupPlacementDecisions(samples.map((sample, index) => {
        return index === 1 ? { ...sample, metadata: { ...sample.metadata, finishType: "abandoned" } } : sample;
    }));

    assert.equal(difficultyConflict.rejected[0].reason, "INCONSISTENT_DECISION_CONTEXT");
    assert.equal(outcomeConflict.rejected[0].reason, "INCONSISTENT_DECISION_CONTEXT");
    assert.equal(finishConflict.rejected[0].reason, "INCONSISTENT_DECISION_CONTEXT");
});

test("ranking evaluator는 fixture Top-1/Top-3/MRR와 seeded random 결정성을 계산한다", async () => {
    const { groupPlacementDecisions } = await import(
        "../src/client/game/ai/dataset/placementDecisionGroups.js"
    );
    const { createHeuristicScorer, createSeededRandomScorer, evaluateRanking } = await import(
        "../src/client/game/ai/dataset/placementRankingEvaluator.js"
    );
    const groups = groupPlacementDecisions(createGroupSamples()).groups;
    const heuristic = evaluateRanking(groups, createHeuristicScorer());
    const randomOne = evaluateRanking(groups, createSeededRandomScorer("fixed"));
    const randomTwo = evaluateRanking(groups, createSeededRandomScorer("fixed"));

    assert.equal(heuristic.top1Accuracy, 0);
    assert.equal(heuristic.top3Accuracy, 1);
    assert.equal(heuristic.mrr, 0.5);
    assert.equal(heuristic.byOutcome.winner.decisionCount, 1);
    assert.deepEqual(randomOne, randomTwo);
    assert.equal(randomOne.ok, true);
});

test("ranking evaluator는 canonical Top-1을 유지하며 top-score tie와 tie-aware Top-1을 함께 기록한다", async () => {
    const { groupPlacementDecisions } = await import(
        "../src/client/game/ai/dataset/placementDecisionGroups.js"
    );
    const { evaluateRanking } = await import(
        "../src/client/game/ai/dataset/placementRankingEvaluator.js"
    );
    const samples = createGroupSamples();
    const groups = groupPlacementDecisions(samples).groups;
    const selected = groups[0].candidates.find(candidate => candidate.selectedBySource);
    const canonicalFirst = groups[0].candidates[0];
    const result = evaluateRanking(groups, group => new Map(group.candidates.map(candidate => {
        return [candidate, candidate === selected || candidate === canonicalFirst ? 1 : 0];
    })));

    assert.equal(result.top1Accuracy, 0);
    assert.equal(result.tieAwareTop1Accuracy, 1);
    assert.equal(result.topScoreTieDecisionCount, 1);
});

test("seeded random은 각 candidate를 독립 점수로 결정론적으로 순위화한다", async () => {
    const { groupPlacementDecisions } = await import(
        "../src/client/game/ai/dataset/placementDecisionGroups.js"
    );
    const { createSeededRandomScorer } = await import(
        "../src/client/game/ai/dataset/placementRankingEvaluator.js"
    );
    const group = groupPlacementDecisions(createGroupSamples()).groups[0];
    const firstScores = createSeededRandomScorer("fixed")(group);
    const secondScores = createSeededRandomScorer("fixed")(group);

    assert.equal(new Set(firstScores.values()).size, group.candidates.length);
    assert.deepEqual([...firstScores.entries()], [...secondScores.entries()]);
});

test("ranking evaluator는 누락, NaN, 불필요한 candidate score를 명시적으로 실패시킨다", async () => {
    const { groupPlacementDecisions } = await import(
        "../src/client/game/ai/dataset/placementDecisionGroups.js"
    );
    const { evaluateRanking } = await import(
        "../src/client/game/ai/dataset/placementRankingEvaluator.js"
    );
    const group = groupPlacementDecisions(createGroupSamples()).groups[0];
    const missing = evaluateRanking([group], () => new Map());
    const nan = evaluateRanking([group], () => new Map(group.candidates.map(candidate => [candidate, Number.NaN])));
    const extra = evaluateRanking([group], () => new Map([
        ...group.candidates.map(candidate => [candidate, 0]),
        [structuredClone(group.candidates[0]), 0],
    ]));

    assert.deepEqual(missing, {
        ok: false,
        error: {
            reason: "MISSING_CANDIDATE_SCORE",
            decisionKey: group.decisionKey,
            placementKey: "square:0:18:2",
        },
    });
    assert.equal(nan.error.reason, "NON_FINITE_CANDIDATE_SCORE");
    assert.equal(extra.error.reason, "UNEXPECTED_CANDIDATE_SCORE");
});

test("Leave-One-Game-Out는 모든 game을 한 번 validation으로 사용하고 leakage가 없다", async () => {
    const { groupPlacementDecisions } = await import(
        "../src/client/game/ai/dataset/placementDecisionGroups.js"
    );
    const { createHeuristicScorer, createLeaveOneGameOutFolds, evaluateLeaveOneGameOut } = await import(
        "../src/client/game/ai/dataset/placementRankingEvaluator.js"
    );
    const groups = groupPlacementDecisions([...createGroupSamples("game-a"), ...createGroupSamples("game-b")]).groups;
    const folds = createLeaveOneGameOutFolds(groups);
    const result = evaluateLeaveOneGameOut(groups, () => createHeuristicScorer());

    assert.deepEqual(folds.map(fold => fold.validationGameId), ["game-a", "game-b"]);
    assert.ok(folds.every(fold => fold.trainGroups.every(group => group.candidates[0].gameId !== fold.validationGameId)));
    assert.equal(result.folds.length, 2);
    assert.equal(result.ok, true);
});

test("LOGO aggregate는 fold별 held-out prediction만 합산한다", async () => {
    const { groupPlacementDecisions } = await import(
        "../src/client/game/ai/dataset/placementDecisionGroups.js"
    );
    const { evaluateLeaveOneGameOut } = await import(
        "../src/client/game/ai/dataset/placementRankingEvaluator.js"
    );
    const groups = groupPlacementDecisions([
        ...createGroupSamples("game-a"),
        ...createGroupSamples("game-b"),
    ]).groups;
    const result = evaluateLeaveOneGameOut(groups, trainGroups => {
        const trainingDecisionKeys = new Set(trainGroups.map(group => group.decisionKey));
        return group => new Map(group.candidates.map((candidate, index) => {
            const isTrainingGroup = trainingDecisionKeys.has(group.decisionKey);
            const score = isTrainingGroup
                ? (candidate.selectedBySource ? 1 : 0)
                : (candidate.selectedBySource ? 0 : (index === 0 ? 1 : 0));
            return [candidate, score];
        }));
    });

    assert.equal(result.ok, true);
    assert.equal(result.aggregate.decisionCount, 2);
    assert.equal(result.aggregate.top1Accuracy, 0);
    assert.equal(result.aggregate.meanSelectedRank, 2);
});

test("dataset:evaluate CLI는 report를 만들고 input dataset을 변경하지 않는다", async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), "placement-evaluate-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const datasetDir = path.join(root, "dataset");
    const reportPath = path.join(root, "report.json");
    await writeFile(path.join(root, "placeholder"), "", "utf8");
    await require("node:fs/promises").mkdir(datasetDir);
    const rows = createGroupSamples();
    await writeFile(path.join(datasetDir, "manifest.json"), JSON.stringify({ datasetSchemaVersion: 2, inputSha256: "fixture", selectionPolicy: "all-completed", sourceFilter: "human", requiredFinishType: "normal" }));
    await writeFile(path.join(datasetDir, "train.jsonl"), `${rows.map(JSON.stringify).join("\n")}\n`);
    await writeFile(path.join(datasetDir, "validation.jsonl"), "");
    const before = await readFile(path.join(datasetDir, "train.jsonl"));

    await execFileAsync(process.execPath, ["scripts/evaluate-placement-dataset.js", "--dataset-dir", datasetDir, "--output", reportPath, "--seed", "fixture"], { cwd: path.resolve(__dirname, "..") });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    const after = await readFile(path.join(datasetDir, "train.jsonl"));

    assert.equal(report.datasetSchemaVersion, 2);
    assert.equal(report.acceptedDecisionCount, 1);
    assert.deepEqual(after, before);
});
