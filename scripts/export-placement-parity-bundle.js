#!/usr/bin/env node

const { createHash, randomBytes } = require("node:crypto");
const { lstat, mkdir, open, readFile, realpath, rename, stat, unlink } = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const PARITY_BUNDLE_SCHEMA_VERSION = 2;
const SOURCE_DATASET_FILE_NAMES = Object.freeze([
    "manifest.json",
    "train.jsonl",
    "validation.jsonl",
    "rejected.jsonl",
]);
const STAGING_ALLOCATION_ATTEMPTS = 32;

function parseArgs(args) {
    const options = { datasetDir: null, output: null, validationGameId: null };
    const names = new Map([
        ["--dataset-dir", "datasetDir"],
        ["--output", "output"],
        ["--validation-game-id", "validationGameId"],
    ]);
    for (let index = 0; index < args.length; index++) {
        const name = args[index];
        const key = names.get(name);
        const value = args[index + 1];
        if (!key || value === undefined) throw new Error(`Invalid option: ${name}`);
        options[key] = value;
        index += 1;
    }
    if (!options.datasetDir || !options.output) {
        throw new Error("--dataset-dir and --output are required");
    }
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

async function resolvePathIdentity(filePath) {
    let current = path.resolve(filePath);
    const missingSegments = [];
    while (true) {
        try {
            const resolved = await realpath(current);
            return path.join(resolved, ...missingSegments.reverse());
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
            const parent = path.dirname(current);
            if (parent === current) throw error;
            missingSegments.push(path.basename(current));
            current = parent;
        }
    }
}

async function haveSameFileIdentity(leftPath, rightPath) {
    try {
        const [left, right] = await Promise.all([stat(leftPath), stat(rightPath)]);
        return left.dev === right.dev && left.ino === right.ino;
    } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
    }
}

async function assertSafeParityOutput(datasetDir, output) {
    const sourcePaths = SOURCE_DATASET_FILE_NAMES
        .map(name => path.resolve(datasetDir, name));
    const outputIdentity = await resolvePathIdentity(output);
    for (const sourcePath of sourcePaths) {
        const sourceIdentity = await resolvePathIdentity(sourcePath);
        if (outputIdentity === sourceIdentity || await haveSameFileIdentity(output, sourcePath)) {
            throw new Error(`OUTPUT_CONFLICTS_WITH_SOURCE_DATASET:${path.basename(sourcePath)}`);
        }
    }
}

function createRandomStagingPath(resolvedOutput) {
    const token = randomBytes(16).toString("hex");
    return path.join(
        path.dirname(resolvedOutput),
        `.${path.basename(resolvedOutput)}.${token}.tmp`,
    );
}

async function assertOwnedStagingFile(stagingPath, identity) {
    let current;
    try {
        current = await lstat(stagingPath);
    } catch (error) {
        if (error.code === "ENOENT") throw new Error("STAGING_FILE_REPLACED");
        throw error;
    }
    if (!current.isFile() || current.isSymbolicLink() ||
        current.dev !== identity.dev || current.ino !== identity.ino) {
        throw new Error("STAGING_FILE_REPLACED");
    }
}

async function removeOwnedStagingFile(stagingPath, identity) {
    if (!stagingPath || !identity) return;
    try {
        const current = await lstat(stagingPath);
        if (current.isFile() && !current.isSymbolicLink() &&
            current.dev === identity.dev && current.ino === identity.ino) {
            await unlink(stagingPath);
        }
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
}

async function createExclusiveStagingFile({
    datasetDir,
    resolvedOutput,
    stagingPathFactory,
}) {
    const outputDirectory = path.dirname(resolvedOutput);
    for (let attempt = 0; attempt < STAGING_ALLOCATION_ATTEMPTS; attempt++) {
        const stagingPath = path.resolve(stagingPathFactory(resolvedOutput, attempt));
        if (path.dirname(stagingPath) !== outputDirectory) {
            throw new Error("STAGING_PATH_MUST_SHARE_OUTPUT_DIRECTORY");
        }
        await assertSafeParityOutput(datasetDir, stagingPath);
        try {
            const handle = await open(stagingPath, "wx", 0o600);
            return { handle, identity: await handle.stat(), stagingPath };
        } catch (error) {
            if (error.code !== "EEXIST") throw error;
        }
    }
    throw new Error("STAGING_PATH_ALLOCATION_FAILED");
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

function createValidationReference(validationGroups, scorer, modules) {
    const decisions = validationGroups.map(group => {
        const scores = scorer(group);
        const ranked = group.candidates.slice().sort((left, right) => {
            const scoreDelta = scores.get(right) - scores.get(left);
            if (scoreDelta) return scoreDelta;
            return modules.groups.compareCanonicalStrings(
                modules.groups.getCanonicalPlacementKey(left),
                modules.groups.getCanonicalPlacementKey(right),
            );
        });
        const ranks = new Map(ranked.map((candidate, index) => [candidate, index + 1]));
        const selected = group.candidates.find(candidate => candidate.selectedBySource === true);
        return {
            decisionKey: group.decisionKey,
            selectedPlacementKey: modules.groups.getCanonicalPlacementKey(selected),
            selectedRank: ranks.get(selected),
            candidates: group.candidates.map(candidate => ({
                placementKey: modules.groups.getCanonicalPlacementKey(candidate),
                selected: candidate.selectedBySource === true,
                score: scores.get(candidate),
                rank: ranks.get(candidate),
            })),
        };
    });
    const metrics = modules.ranking.evaluateRanking(validationGroups, scorer);
    if (!metrics.ok) throw new Error(`VALIDATION_EVALUATION_FAILED:${metrics.error.reason}`);
    return {
        decisions,
        metrics: {
            decisionCount: metrics.decisionCount,
            top1Accuracy: metrics.top1Accuracy,
            tieAwareTop1Accuracy: metrics.tieAwareTop1Accuracy,
            topScoreTieDecisionCount: metrics.topScoreTieDecisionCount,
            top3Accuracy: metrics.top3Accuracy,
            mrr: metrics.mrr,
            meanSelectedRank: metrics.meanSelectedRank,
        },
    };
}

function countSelectedFeatureDuplicateDecisions(decisions) {
    return decisions.filter(decision => {
        const selected = decision.candidates.find(candidate => candidate.selected === true);
        return decision.candidates.some(candidate => {
            return candidate !== selected && candidate.rawFeatures.every((value, index) => {
                return value === selected.rawFeatures[index];
            });
        });
    }).length;
}

function countBy(items, selectKey, keys = []) {
    const counts = Object.fromEntries(keys.map(key => [key, 0]));
    items.forEach(item => {
        const key = selectKey(item);
        counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
}

function assertManifestCount(manifest, name, expected) {
    if (!Number.isInteger(manifest[name]) || manifest[name] !== expected) {
        throw new Error(`MANIFEST_COUNT_MISMATCH:${name}`);
    }
}

function assertManifestCountRecord(manifest, name, expected) {
    const actual = manifest[name];
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = actual && typeof actual === "object" ? Object.keys(actual).sort() : [];
    if (!actual || typeof actual !== "object" ||
        JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys) ||
        expectedKeys.some(key => !Number.isInteger(actual[key]) || actual[key] !== expected[key])) {
        throw new Error(`MANIFEST_COUNT_MISMATCH:${name}`);
    }
}

function validateSourceDatasetContract({
    manifest,
    trainRows,
    validationRows,
    rejectedRows,
    groups,
}) {
    const rows = [...trainRows, ...validationRows];
    if (rows.some(row => row?.source !== "human")) throw new Error("HUMAN_SOURCE_ROW_REQUIRED");

    const trainGameIds = new Set(trainRows.map(row => row.gameId));
    const validationGameIds = new Set(validationRows.map(row => row.gameId));
    if ([...trainGameIds].some(gameId => validationGameIds.has(gameId))) {
        throw new Error("SOURCE_DATASET_GAME_ID_LEAKAGE");
    }

    const selectedCount = rows.filter(row => row.selectedBySource === true).length;
    const rejectedPlacementCount = rejectedRows.filter(row => {
        return row?.eventType === "placement_decision";
    }).length;
    assertManifestCount(manifest, "acceptedPlacementLogCount", groups.length);
    assertManifestCount(manifest, "rejectedPlacementLogCount", rejectedPlacementCount);
    assertManifestCount(manifest, "trainSampleCount", trainRows.length);
    assertManifestCount(manifest, "validationSampleCount", validationRows.length);
    assertManifestCount(manifest, "trainGameCount", trainGameIds.size);
    assertManifestCount(manifest, "validationGameCount", validationGameIds.size);
    assertManifestCount(manifest, "selectedBySourceSampleCount", selectedCount);

    assertManifestCountRecord(manifest, "sampleCountBySource", countBy(
        rows,
        row => row.source,
        ["human", "heuristic_ai"],
    ));
    assertManifestCountRecord(manifest, "sampleCountByAiDifficulty", countBy(
        rows,
        row => row.aiDifficulty ?? "unknown",
        ["normal", "hard", "unknown"],
    ));
    assertManifestCountRecord(manifest, "acceptedPlacementLogCountBySource", countBy(
        groups,
        group => group.candidates[0].source,
        ["human", "heuristic_ai"],
    ));
    assertManifestCountRecord(manifest, "acceptedPlacementLogCountByAiDifficulty", countBy(
        groups,
        group => group.candidates[0].aiDifficulty ?? "unknown",
        ["normal", "hard", "unknown"],
    ));
    assertManifestCountRecord(manifest, "rejectionReasonCounts", countBy(
        rejectedRows,
        row => row.reason,
    ));

    const placementEventCount = manifest.eventTypeCounts?.placement_decision;
    if (!Number.isInteger(placementEventCount) ||
        placementEventCount !== groups.length + rejectedPlacementCount) {
        throw new Error("MANIFEST_COUNT_MISMATCH:eventTypeCounts.placement_decision");
    }
}

function serializeGroups(groups, modules) {
    return groups.map(group => ({
        decisionKey: group.decisionKey,
        gameId: group.candidates[0].gameId,
        candidates: group.candidates.map(candidate => {
            const features = modules.features.extractPlacementFeatures(candidate);
            if (!features.ok) throw new Error(`INVALID_FEATURE_VECTOR:${group.decisionKey}`);
            return {
                placementKey: modules.groups.getCanonicalPlacementKey(candidate),
                selected: candidate.selectedBySource === true,
                rawFeatures: [...features.values],
            };
        }),
    }));
}

async function buildParityBundle(options) {
    const datasetDir = path.resolve(options.datasetDir);
    const files = await Promise.all(SOURCE_DATASET_FILE_NAMES.map(async name => ({
        name,
        bytes: await readFile(path.join(datasetDir, name)),
    })));
    const fileByName = new Map(files.map(file => [file.name, file]));
    let manifest;
    try {
        manifest = JSON.parse(fileByName.get("manifest.json").bytes.toString("utf8"));
    } catch {
        throw new Error("INVALID_DATASET_MANIFEST");
    }
    const modules = await loadModules();
    if (manifest.datasetSchemaVersion !== modules.builder.PLACEMENT_DATASET_SCHEMA_VERSION) {
        throw new Error("DATASET_SCHEMA_VERSION_MISMATCH");
    }
    if (manifest.sourceFilter !== "human") throw new Error("HUMAN_DATASET_REQUIRED");
    const trainRows = parseJsonl(fileByName.get("train.jsonl").bytes, "train.jsonl");
    const validationRows = parseJsonl(
        fileByName.get("validation.jsonl").bytes,
        "validation.jsonl",
    );
    const rejectedRows = parseJsonl(fileByName.get("rejected.jsonl").bytes, "rejected.jsonl");
    const rows = [...trainRows, ...validationRows];
    if (rows.some(row => row?.source !== "human")) throw new Error("HUMAN_SOURCE_ROW_REQUIRED");
    const grouped = modules.groups.groupPlacementDecisions(rows);
    if (grouped.rejected.length > 0) {
        throw new Error(`REJECTED_DECISION_GROUPS:${grouped.rejected[0].reason}`);
    }
    validateSourceDatasetContract({
        manifest,
        trainRows,
        validationRows,
        rejectedRows,
        groups: grouped.groups,
    });
    const gameIds = [...new Set(grouped.groups.map(group => group.candidates[0].gameId))]
        .sort(modules.groups.compareCanonicalStrings);
    if (gameIds.length < 2) throw new Error("INSUFFICIENT_GAMES_FOR_LOGO");
    const validationGameId = options.validationGameId || gameIds[0];
    if (!gameIds.includes(validationGameId)) throw new Error("UNKNOWN_VALIDATION_GAME_ID");
    const trainGameIds = gameIds.filter(gameId => gameId !== validationGameId);
    const trainGroups = grouped.groups.filter(group => group.candidates[0].gameId !== validationGameId);
    const validationGroups = grouped.groups.filter(group => group.candidates[0].gameId === validationGameId);
    const training = modules.ranker.trainPairwiseLinearRanker(
        trainGroups,
        modules.ranker.DEFAULT_PAIRWISE_TRAINING_CONFIG,
    );
    if (!training.ok) throw new Error(`PAIRWISE_TRAINING_FAILED:${training.reason}`);
    const pairResult = modules.ranker.createPairwiseTrainingPairs(trainGroups, training.model.scaler);
    if (!pairResult.ok) throw new Error(`PAIR_CREATION_FAILED:${pairResult.reason}`);
    const validation = createValidationReference(
        validationGroups,
        modules.ranker.createPairwiseLinearScorer(training.model),
        modules,
    );
    const selectedPlacementByDecision = new Map(trainGroups.map(group => {
        const selected = group.candidates.find(candidate => candidate.selectedBySource === true);
        return [group.decisionKey, modules.groups.getCanonicalPlacementKey(selected)];
    }));
    const unselectedIndexByDecision = new Map();
    const trainingPairs = pairResult.pairs.map(pair => {
        const group = trainGroups.find(candidateGroup => candidateGroup.decisionKey === pair.decisionKey);
        const currentIndex = unselectedIndexByDecision.get(pair.decisionKey) || 0;
        const unselected = group.candidates.filter(candidate => candidate.selectedBySource !== true);
        const candidate = unselected[currentIndex];
        unselectedIndexByDecision.set(pair.decisionKey, currentIndex + 1);
        return {
            decisionKey: pair.decisionKey,
            selectedPlacementKey: selectedPlacementByDecision.get(pair.decisionKey),
            unselectedPlacementKey: modules.groups.getCanonicalPlacementKey(candidate),
            featureDifference: [...pair.featureDifference],
            weight: pair.weight,
        };
    });
    const trainDecisions = serializeGroups(trainGroups, modules);
    const validationDecisions = serializeGroups(validationGroups, modules);
    return {
        parityBundleSchemaVersion: PARITY_BUNDLE_SCHEMA_VERSION,
        datasetSchemaVersion: modules.builder.PLACEMENT_DATASET_SCHEMA_VERSION,
        featureSchemaVersion: modules.features.PLACEMENT_FEATURE_SCHEMA_VERSION,
        modelSchemaVersion: modules.ranker.PAIRWISE_LINEAR_MODEL_SCHEMA_VERSION,
        modelType: modules.ranker.PAIRWISE_LINEAR_MODEL_TYPE,
        featureNames: [...modules.features.PLACEMENT_FEATURE_NAMES],
        sourceDatasetSha256: hashBuffers(files),
        datasetInputSha256: manifest.inputSha256,
        validationGameId,
        trainGameIds,
        validationGameIds: [validationGameId],
        trainingConfig: { ...modules.ranker.DEFAULT_PAIRWISE_TRAINING_CONFIG },
        pairWeightContract: {
            difference: "standardized(selected)-standardized(unselected)",
            pairWeight: "1/unselectedCandidateCount",
            decisionPairWeightTotal: 1,
            lossReduction: "weightedPairLossSum/trainDecisionCount",
        },
        counts: {
            trainGameCount: trainGameIds.length,
            validationGameCount: 1,
            trainDecisionCount: trainGroups.length,
            validationDecisionCount: validationGroups.length,
            trainCandidateCount: pairResult.candidateCount,
            validationCandidateCount: validationGroups.reduce((total, group) => total + group.candidates.length, 0),
            trainPairCount: pairResult.pairCount,
            trainZeroDifferencePairCount: pairResult.zeroDifferencePairCount,
            trainZeroDifferenceDecisionCount: pairResult.zeroDifferenceDecisionCount,
            trainSelectedFeatureDuplicateDecisionCount: pairResult.selectedFeatureDuplicateDecisionCount,
            validationSelectedFeatureDuplicateDecisionCount: countSelectedFeatureDuplicateDecisions(
                validationDecisions,
            ),
        },
        trainDecisions,
        validationDecisions,
        trainingPairs,
        jsReference: {
            featureNames: [...training.model.featureNames],
            scaler: {
                mean: [...training.model.scaler.mean],
                scale: [...training.model.scaler.scale],
            },
            initialLoss: training.trainingSummary.initialLoss,
            finalLoss: training.trainingSummary.finalLoss,
            weights: [...training.model.weights],
            validation,
        },
        runtimeIntegration: false,
    };
}

async function writeBundle(options) {
    if (!options || typeof options !== "object" || !options.datasetDir || !options.output ||
        !options.bundle) {
        throw new Error("datasetDir, output, and bundle are required");
    }
    const datasetDir = path.resolve(options.datasetDir);
    const resolvedOutput = path.resolve(options.output);
    const stagingPathFactory = options.stagingPathFactory || createRandomStagingPath;
    const serialized = `${JSON.stringify(options.bundle, null, 2)}\n`;
    await assertSafeParityOutput(datasetDir, resolvedOutput);
    await mkdir(path.dirname(resolvedOutput), { recursive: true });

    let stagingPath = null;
    let stagingIdentity = null;
    let handle = null;
    let handleClosed = false;
    let replaced = false;
    try {
        const staging = await createExclusiveStagingFile({
            datasetDir,
            resolvedOutput,
            stagingPathFactory,
        });
        ({ handle, identity: stagingIdentity, stagingPath } = staging);
        try {
            await handle.writeFile(serialized, "utf8");
            await handle.sync();
        } finally {
            await handle.close();
            handleClosed = true;
        }
        await assertOwnedStagingFile(stagingPath, stagingIdentity);
        await assertSafeParityOutput(datasetDir, stagingPath);
        await assertSafeParityOutput(datasetDir, resolvedOutput);
        await rename(stagingPath, resolvedOutput);
        replaced = true;
    } finally {
        if (handle && !handleClosed) await handle.close().catch(() => {});
        if (!replaced) await removeOwnedStagingFile(stagingPath, stagingIdentity);
    }
}

async function runCli() {
    const options = parseArgs(process.argv.slice(2));
    const bundle = await buildParityBundle(options);
    await writeBundle({
        datasetDir: options.datasetDir,
        output: options.output,
        bundle,
    });
    console.log(JSON.stringify({
        output: path.resolve(options.output),
        validationGameId: bundle.validationGameId,
        counts: bundle.counts,
    }, null, 2));
}

if (require.main === module) runCli().catch(error => {
    console.error(`[model:export-placement-parity] ${error.message}`);
    process.exitCode = 1;
});

module.exports = { assertSafeParityOutput, buildParityBundle, parseArgs, writeBundle };
