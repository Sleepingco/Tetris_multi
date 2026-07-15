#!/usr/bin/env node

const { mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function parseArgs(args) {
    const options = { datasetDir: null, output: null, seed: "placement-random-v1" };
    for (let index = 0; index < args.length; index++) {
        const name = args[index];
        const value = args[index + 1];
        if ((name === "--dataset-dir" || name === "--output" || name === "--seed") && value) {
            if (name === "--dataset-dir") options.datasetDir = value;
            if (name === "--output") options.output = value;
            if (name === "--seed") options.seed = value;
            index += 1;
            continue;
        }
        throw new Error(`Invalid option: ${name}`);
    }
    if (!options.datasetDir || !options.output) throw new Error("--dataset-dir and --output are required");
    return options;
}

async function readJsonl(filePath) {
    const text = await readFile(filePath, "utf8");
    return text.trim() === "" ? [] : text.trimEnd().split("\n").map(JSON.parse);
}

async function evaluateDataset(options) {
    const datasetDir = path.resolve(options.datasetDir);
    const manifest = JSON.parse(await readFile(path.join(datasetDir, "manifest.json"), "utf8"));
    const builder = await import(pathToFileURL(path.resolve(__dirname, "../src/client/game/ai/dataset/placementDatasetBuilder.js")).href);
    if (manifest.datasetSchemaVersion !== builder.PLACEMENT_DATASET_SCHEMA_VERSION) {
        throw new Error("DATASET_SCHEMA_VERSION_MISMATCH");
    }
    const [{ groupPlacementDecisions }, ranking, features] = await Promise.all([
        import(pathToFileURL(path.resolve(__dirname, "../src/client/game/ai/dataset/placementDecisionGroups.js")).href),
        import(pathToFileURL(path.resolve(__dirname, "../src/client/game/ai/dataset/placementRankingEvaluator.js")).href),
        import(pathToFileURL(path.resolve(__dirname, "../src/client/game/ai/dataset/placementFeatureSchema.js")).href),
    ]);
    const rows = [...await readJsonl(path.join(datasetDir, "train.jsonl")), ...await readJsonl(path.join(datasetDir, "validation.jsonl"))];
    const grouped = groupPlacementDecisions(rows);
    const heuristic = ranking.evaluateLeaveOneGameOut(grouped.groups, () => ranking.createHeuristicScorer());
    const random = ranking.evaluateLeaveOneGameOut(grouped.groups, () => ranking.createSeededRandomScorer(options.seed));
    if (!heuristic.ok || !random.ok) {
        const failure = !heuristic.ok ? heuristic : random;
        throw new Error(`EVALUATION_FAILED:${failure.error.reason}`);
    }
    return {
        reportSchemaVersion: 1,
        datasetSchemaVersion: manifest.datasetSchemaVersion,
        featureSchemaVersion: features.PLACEMENT_FEATURE_SCHEMA_VERSION,
        inputSha256: manifest.inputSha256,
        seed: options.seed,
        acceptedDecisionCount: grouped.groups.length,
        rejectedDecisionCount: grouped.rejected.length,
        rejectedDecisions: grouped.rejected,
        candidateCount: heuristic.aggregate.candidateCount,
        heuristic,
        random,
        policy: {
            selectionPolicy: manifest.selectionPolicy,
            sourceFilter: manifest.sourceFilter,
            requiredFinishType: manifest.requiredFinishType,
        },
    };
}

async function runCli() {
    const options = parseArgs(process.argv.slice(2));
    const report = await evaluateDataset(options);
    await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
    await writeFile(path.resolve(options.output), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) runCli().catch(error => { console.error(`[dataset:evaluate] ${error.message}`); process.exitCode = 1; });

module.exports = { evaluateDataset, parseArgs };
