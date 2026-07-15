#!/usr/bin/env node

const { createHash } = require("node:crypto");
const { mkdir, readFile, rename, rm, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const RANDOM_BASELINE_SEED = "placement-random-v1";

function parseNumber(name, value) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`Invalid ${name}: ${value}`);
    return number;
}

function parseArgs(args) {
    const options = {
        datasetDir: null,
        outputDir: null,
        seed: "placement-pairwise-v1",
        epochs: 500,
        learningRate: 0.05,
        l2: 0.01,
    };
    const names = new Map([
        ["--dataset-dir", "datasetDir"],
        ["--output-dir", "outputDir"],
        ["--seed", "seed"],
        ["--epochs", "epochs"],
        ["--learning-rate", "learningRate"],
        ["--l2", "l2"],
    ]);
    for (let index = 0; index < args.length; index++) {
        const name = args[index];
        const key = names.get(name);
        const value = args[index + 1];
        if (!key || value === undefined) throw new Error(`Invalid option: ${name}`);
        options[key] = ["epochs", "learningRate", "l2"].includes(key)
            ? parseNumber(name, value)
            : value;
        index += 1;
    }
    if (!options.datasetDir || !options.outputDir) throw new Error("--dataset-dir and --output-dir are required");
    return options;
}

function hashBuffers(files) {
    const hash = createHash("sha256");
    files.forEach(({ name, bytes }) => {
        hash.update(name);
        hash.update("\0");
        hash.update(bytes);
        hash.update("\0");
    });
    return hash.digest("hex");
}

function parseJsonl(bytes, name) {
    const text = bytes.toString("utf8");
    if (text.trim() === "") return [];
    return text.trimEnd().split("\n").map((line, index) => {
        try {
            return JSON.parse(line);
        } catch {
            throw new Error(`INVALID_DATASET_JSON:${name}:${index + 1}`);
        }
    });
}

function metricDelta(model, baseline) {
    return {
        top1Accuracy: model.top1Accuracy - baseline.top1Accuracy,
        top3Accuracy: model.top3Accuracy - baseline.top3Accuracy,
        mrr: model.mrr - baseline.mrr,
        meanSelectedRank: model.meanSelectedRank - baseline.meanSelectedRank,
    };
}

function createTrainingConfig(options) {
    return {
        epochs: options.epochs,
        learningRate: options.learningRate,
        l2: options.l2,
        seed: options.seed,
    };
}

function evaluatePairwiseLogo(groups, ranking, ranker, config) {
    const gameIds = [...new Set(groups.map(group => group.candidates[0].gameId))].sort();
    const trainingByValidationGameId = new Map();
    const result = ranking.evaluateLeaveOneGameOut(groups, trainGroups => {
        const trainGameIds = new Set(trainGroups.map(group => group.candidates[0].gameId));
        const validationGameIds = gameIds.filter(gameId => !trainGameIds.has(gameId));
        if (validationGameIds.length !== 1) throw new Error("INVALID_LOGO_FOLD");
        const training = ranker.trainPairwiseLinearRanker(trainGroups, config);
        if (!training.ok) throw new Error(`PAIRWISE_TRAINING_FAILED:${training.reason}`);
        trainingByValidationGameId.set(validationGameIds[0], {
            trainGameCount: trainGameIds.size,
            ...training.trainingSummary,
        });
        return ranker.createPairwiseLinearScorer(training.model);
    });
    if (!result.ok) throw new Error(`PAIRWISE_EVALUATION_FAILED:${result.error.reason}`);
    const folds = result.folds.map(fold => {
        const training = trainingByValidationGameId.get(fold.validationGameId);
        return {
            validationGameId: fold.validationGameId,
            trainGameCount: training.trainGameCount,
            trainDecisionCount: training.decisionCount,
            validationDecisionCount: fold.metrics.decisionCount,
            pairCount: training.pairCount,
            initialLoss: training.initialLoss,
            finalLoss: training.finalLoss,
            top1Accuracy: fold.metrics.top1Accuracy,
            top3Accuracy: fold.metrics.top3Accuracy,
            mrr: fold.metrics.mrr,
            meanSelectedRank: fold.metrics.meanSelectedRank,
        };
    });
    return { aggregate: result.aggregate, folds };
}

async function loadModules() {
    const fromRoot = relativePath => pathToFileURL(path.resolve(__dirname, "..", relativePath)).href;
    const [builder, groups, ranking, ranker, features] = await Promise.all([
        import(fromRoot("src/client/game/ai/dataset/placementDatasetBuilder.js")),
        import(fromRoot("src/client/game/ai/dataset/placementDecisionGroups.js")),
        import(fromRoot("src/client/game/ai/dataset/placementRankingEvaluator.js")),
        import(fromRoot("src/client/game/ai/ml/placementPairwiseRanker.js")),
        import(fromRoot("src/client/game/ai/dataset/placementFeatureSchema.js")),
    ]);
    return { builder, groups, ranking, ranker, features };
}

async function buildArtifacts(options) {
    const datasetDir = path.resolve(options.datasetDir);
    const fileNames = ["manifest.json", "train.jsonl", "validation.jsonl"];
    const files = await Promise.all(fileNames.map(async name => ({
        name,
        bytes: await readFile(path.join(datasetDir, name)),
    })));
    let manifest;
    try {
        manifest = JSON.parse(files[0].bytes.toString("utf8"));
    } catch {
        throw new Error("INVALID_DATASET_MANIFEST");
    }
    const modules = await loadModules();
    if (manifest.datasetSchemaVersion !== modules.builder.PLACEMENT_DATASET_SCHEMA_VERSION) {
        throw new Error("DATASET_SCHEMA_VERSION_MISMATCH");
    }
    if (manifest.sourceFilter !== "human") throw new Error("HUMAN_DATASET_REQUIRED");
    const rows = [...parseJsonl(files[1].bytes, "train.jsonl"), ...parseJsonl(files[2].bytes, "validation.jsonl")];
    const grouped = modules.groups.groupPlacementDecisions(rows);
    if (grouped.rejected.length > 0) {
        throw new Error(`REJECTED_DECISION_GROUPS:${grouped.rejected[0].reason}`);
    }
    if (grouped.groups.length === 0) throw new Error("EMPTY_DECISION_DATASET");
    const config = createTrainingConfig(options);
    const heuristic = modules.ranking.evaluateLeaveOneGameOut(grouped.groups, () => modules.ranking.createHeuristicScorer());
    const random = modules.ranking.evaluateLeaveOneGameOut(grouped.groups, () => modules.ranking.createSeededRandomScorer(RANDOM_BASELINE_SEED));
    if (!heuristic.ok || !random.ok) {
        const failure = !heuristic.ok ? heuristic : random;
        throw new Error(`BASELINE_EVALUATION_FAILED:${failure.error.reason}`);
    }
    const pairwiseLogo = evaluatePairwiseLogo(grouped.groups, modules.ranking, modules.ranker, config);
    const finalTraining = modules.ranker.trainPairwiseLinearRanker(grouped.groups, config);
    if (!finalTraining.ok) throw new Error(`FINAL_TRAINING_FAILED:${finalTraining.reason}`);
    const pipelineSourceNames = [
        "scripts/train-placement-ranker.js",
        "src/client/game/ai/ml/placementPairwiseRanker.js",
        "src/client/game/ai/dataset/placementFeatureSchema.js",
        "src/client/game/ai/dataset/placementDecisionGroups.js",
        "src/client/game/ai/dataset/placementRankingEvaluator.js",
    ];
    const pipelineSourceFiles = await Promise.all(pipelineSourceNames.map(async name => ({
        name,
        bytes: await readFile(path.resolve(__dirname, "..", name)),
    })));
    const trainingPipelineSourceSha256 = hashBuffers(pipelineSourceFiles);
    const sourceDatasetSha256 = hashBuffers(files);
    const gameCount = new Set(grouped.groups.map(group => group.candidates[0].gameId)).size;
    const model = {
        ...finalTraining.model,
        datasetInputSha256: manifest.inputSha256,
        sourceDatasetSha256,
        trainingPipelineSourceSha256,
        trainingSummary: finalTraining.trainingSummary,
    };
    const evaluation = {
        evaluationSchemaVersion: 1,
        datasetInputSha256: manifest.inputSha256,
        sourceDatasetSha256,
        trainingPipelineSourceSha256,
        datasetSchemaVersion: manifest.datasetSchemaVersion,
        featureSchemaVersion: modules.features.PLACEMENT_FEATURE_SCHEMA_VERSION,
        featureNames: [...modules.features.PLACEMENT_FEATURE_NAMES],
        trainingConfig: config,
        randomBaselineSeed: RANDOM_BASELINE_SEED,
        runtimeIntegration: false,
        dataSummary: {
            gameCount,
            decisionCount: grouped.groups.length,
            candidateCount: finalTraining.trainingSummary.candidateCount,
            pairCount: finalTraining.trainingSummary.pairCount,
        },
        baselines: {
            heuristic: heuristic.aggregate,
            random: random.aggregate,
        },
        pairwise: {
            logo: pairwiseLogo,
            comparison: {
                versusHeuristic: metricDelta(pairwiseLogo.aggregate, heuristic.aggregate),
                versusRandom: metricDelta(pairwiseLogo.aggregate, random.aggregate),
            },
        },
        finalModelTraining: finalTraining.trainingSummary,
        limitations: [
            "Winner outcome contains one game and is reference-only.",
            "Final full-data model is an artifact; reported performance uses held-out LOGO predictions only.",
            "The model is not connected to PVE runtime.",
        ],
    };
    return { model, evaluation };
}

async function writeArtifacts(outputDir, artifacts) {
    const resolvedOutputDir = path.resolve(outputDir);
    await mkdir(resolvedOutputDir, { recursive: true });
    const temporaryModel = path.join(resolvedOutputDir, `.model.${process.pid}.tmp`);
    const temporaryEvaluation = path.join(resolvedOutputDir, `.evaluation.${process.pid}.tmp`);
    try {
        await writeFile(temporaryModel, `${JSON.stringify(artifacts.model, null, 2)}\n`, "utf8");
        await writeFile(temporaryEvaluation, `${JSON.stringify(artifacts.evaluation, null, 2)}\n`, "utf8");
        await rename(temporaryEvaluation, path.join(resolvedOutputDir, "evaluation.json"));
        await rename(temporaryModel, path.join(resolvedOutputDir, "model.json"));
    } finally {
        await Promise.all([
            rm(temporaryModel, { force: true }),
            rm(temporaryEvaluation, { force: true }),
        ]);
    }
}

async function trainPlacementRanker(options) {
    const artifacts = await buildArtifacts(options);
    await writeArtifacts(options.outputDir, artifacts);
    return artifacts;
}

async function runCli() {
    const options = parseArgs(process.argv.slice(2));
    const artifacts = await trainPlacementRanker(options);
    console.log(JSON.stringify({
        modelPath: path.resolve(options.outputDir, "model.json"),
        evaluationPath: path.resolve(options.outputDir, "evaluation.json"),
        dataSummary: artifacts.evaluation.dataSummary,
        logo: artifacts.evaluation.pairwise.logo.aggregate,
    }, null, 2));
}

if (require.main === module) runCli().catch(error => {
    console.error(`[model:train-placement-ranker] ${error.message}`);
    process.exitCode = 1;
});

module.exports = { buildArtifacts, parseArgs, trainPlacementRanker, writeArtifacts };
