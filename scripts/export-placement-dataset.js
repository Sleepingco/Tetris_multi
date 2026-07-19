#!/usr/bin/env node

const { createHash } = require("node:crypto");
const { mkdir, open, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DEFAULT_INPUT = "data/logs/game-events.jsonl";
const DEFAULT_OUTPUT_DIR = "data/datasets/placement-v1";
const DEFAULT_VALIDATION_RATIO = 0.2;
const DEFAULT_SEED = "placement-dataset-v1";
const EXPORT_POLICY_VERSION = 2;
const DEFAULT_SELECTION_POLICY = "winner-only";
const DEFAULT_SOURCE_FILTER = "all";
const MINIMUM_PIECE_INDEX = 5;
const REQUIRED_FINISH_TYPE = "normal";
const SUPPORTED_SELECTION_POLICIES = new Set(["winner-only", "all-completed"]);
const SUPPORTED_SOURCE_FILTERS = new Set(["all", "human", "heuristic_ai"]);
const SUPPORTED_AI_DIFFICULTIES = new Set(["normal", "hard"]);
const SUPPORTED_EVENT_TYPES = new Set([
    "game_start",
    "placement_decision",
    "game_over",
]);
const OUTPUT_FILE_NAMES = [
    "train.jsonl",
    "validation.jsonl",
    "rejected.jsonl",
    "manifest.json",
];

function requireOptionValue(args, index, optionName) {
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
        throw new Error(`${optionName} requires a value`);
    }
    return value;
}

function parseCliArgs(args) {
    const options = {
        input: DEFAULT_INPUT,
        outputDir: DEFAULT_OUTPUT_DIR,
        validationRatio: DEFAULT_VALIDATION_RATIO,
        seed: DEFAULT_SEED,
        excludePlayerPrefixes: [],
        selectionPolicy: DEFAULT_SELECTION_POLICY,
        sourceFilter: DEFAULT_SOURCE_FILTER,
    };

    for (let index = 0; index < args.length; index++) {
        const optionName = args[index];
        if (optionName === "--input") {
            options.input = requireOptionValue(args, index, optionName);
            index += 1;
            continue;
        }
        if (optionName === "--output-dir") {
            options.outputDir = requireOptionValue(args, index, optionName);
            index += 1;
            continue;
        }
        if (optionName === "--validation-ratio") {
            const value = Number(requireOptionValue(args, index, optionName));
            if (!Number.isFinite(value) || value < 0 || value > 1) {
                throw new Error("--validation-ratio must be between 0 and 1");
            }
            options.validationRatio = value;
            index += 1;
            continue;
        }
        if (optionName === "--seed") {
            options.seed = requireOptionValue(args, index, optionName);
            index += 1;
            continue;
        }
        if (optionName === "--exclude-player-prefix") {
            options.excludePlayerPrefixes.push(
                requireOptionValue(args, index, optionName),
            );
            index += 1;
            continue;
        }
        if (optionName === "--selection-policy") {
            const value = requireOptionValue(args, index, optionName);
            if (!SUPPORTED_SELECTION_POLICIES.has(value)) {
                throw new Error(
                    "--selection-policy must be winner-only or all-completed",
                );
            }
            options.selectionPolicy = value;
            index += 1;
            continue;
        }
        if (optionName === "--source") {
            const value = requireOptionValue(args, index, optionName);
            if (!SUPPORTED_SOURCE_FILTERS.has(value)) {
                throw new Error("--source must be all, human, or heuristic_ai");
            }
            options.sourceFilter = value;
            index += 1;
            continue;
        }
        throw new Error(`Unknown option: ${optionName}`);
    }

    return options;
}

function splitInputLines(inputText) {
    if (inputText.length === 0) return [];

    const lines = inputText.split(/\r\n|\n|\r/);
    if (/\r\n$|\n$|\r$/.test(inputText)) {
        lines.pop();
    }
    return lines;
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim() !== "";
}

function normalizeExcludePlayerPrefixes(prefixes) {
    if (!Array.isArray(prefixes)) {
        throw new Error("excludePlayerPrefixes must be an array");
    }
    if (!prefixes.every(prefix => typeof prefix === "string")) {
        throw new Error("excludePlayerPrefixes must contain only strings");
    }

    return [...new Set(prefixes.filter(prefix => prefix.trim() !== ""))].sort();
}

function createEventRejection(entry, reason) {
    const log = entry.log;
    return {
        lineNumber: entry.lineNumber,
        eventType: typeof log?.eventType === "string" ? log.eventType : null,
        gameId: isNonEmptyString(log?.gameId) ? log.gameId : null,
        playerId: isNonEmptyString(log?.playerId) ? log.playerId : null,
        pieceIndex: Number.isInteger(log?.pieceIndex) ? log.pieceIndex : null,
        reason,
    };
}

function parseInput(inputText) {
    const lines = splitInputLines(inputText);
    const entries = [];
    const rejected = [];
    const eventTypeCounts = new Map();
    let jsonParseSuccessCount = 0;
    let jsonParseFailureCount = 0;

    lines.forEach((rawLine, index) => {
        if (rawLine.trim() === "") return;

        const lineNumber = index + 1;
        let log;
        try {
            log = JSON.parse(rawLine);
            jsonParseSuccessCount += 1;
        } catch {
            jsonParseFailureCount += 1;
            rejected.push({
                lineNumber,
                eventType: null,
                gameId: null,
                playerId: null,
                pieceIndex: null,
                reason: "INVALID_JSON_LINE",
                rawLine,
            });
            return;
        }

        const eventType = typeof log?.eventType === "string"
            ? log.eventType
            : "UNKNOWN";
        eventTypeCounts.set(eventType, (eventTypeCounts.get(eventType) || 0) + 1);

        if (!SUPPORTED_EVENT_TYPES.has(eventType)) return;

        const entry = { lineNumber, log };
        if (!isNonEmptyString(log?.gameId)) {
            rejected.push(createEventRejection(entry, "GAME_ID_REQUIRED"));
            return;
        }
        entries.push(entry);
    });

    return {
        entries,
        rejected,
        inputLineCount: lines.length,
        jsonParseSuccessCount,
        jsonParseFailureCount,
        eventTypeCounts: Object.fromEntries(
            [...eventTypeCounts.entries()].sort(([left], [right]) => {
                return left.localeCompare(right);
            }),
        ),
    };
}

function groupEventsByGameId(entries) {
    const games = new Map();

    entries.forEach(entry => {
        const { gameId, eventType } = entry.log;
        if (!games.has(gameId)) {
            games.set(gameId, {
                gameStart: [],
                placementDecision: [],
                gameOver: [],
            });
        }

        const game = games.get(gameId);
        if (eventType === "game_start") game.gameStart.push(entry);
        if (eventType === "placement_decision") game.placementDecision.push(entry);
        if (eventType === "game_over") game.gameOver.push(entry);
    });

    return games;
}

function getGameExclusionReason(game) {
    if (game.gameStart.length > 1 || game.gameOver.length > 1) {
        return "AMBIGUOUS_GAME_LIFECYCLE";
    }
    if (game.gameStart.length === 0 || game.gameOver.length === 0) {
        return "INCOMPLETE_GAME";
    }
    if (game.gameOver[0].log.finishType !== REQUIRED_FINISH_TYPE) {
        return "NON_NORMAL_FINISH";
    }
    return null;
}

function comparePlacementEntries(left, right) {
    const leftLog = left.log;
    const rightLog = right.log;
    return leftLog.gameId.localeCompare(rightLog.gameId) ||
        String(leftLog.playerId ?? "").localeCompare(String(rightLog.playerId ?? "")) ||
        (Number.isInteger(leftLog.pieceIndex) ? leftLog.pieceIndex : -1) -
            (Number.isInteger(rightLog.pieceIndex) ? rightLog.pieceIndex : -1) ||
        left.lineNumber - right.lineNumber;
}

function hasExcludedPlayerPrefix(playerId, prefixes) {
    return isNonEmptyString(playerId) && prefixes.some(prefix => {
        return prefix !== "" && playerId.startsWith(prefix);
    });
}

function getGameAiDifficulty(game) {
    const difficulties = new Set();
    game.placementDecision.forEach(entry => {
        const log = entry.log;
        if (
            log.source === "heuristic_ai" &&
            SUPPORTED_AI_DIFFICULTIES.has(log.aiDifficulty)
        ) {
            difficulties.add(log.aiDifficulty);
        }
    });

    return {
        aiDifficulty: difficulties.size === 1 ? [...difficulties][0] : null,
        hasConflict: difficulties.size > 1,
    };
}

function matchesSourceFilter(source, sourceFilter) {
    return sourceFilter === DEFAULT_SOURCE_FILTER || source === sourceFilter;
}

function enrichHumanDifficulty(entry, gameDifficulty) {
    if (entry.log.source !== "human" || gameDifficulty.aiDifficulty === null) {
        return { entry, enriched: false };
    }

    return {
        entry: {
            ...entry,
            log: {
                ...entry.log,
                aiDifficulty: gameDifficulty.aiDifficulty,
            },
        },
        enriched: entry.log.aiDifficulty !== gameDifficulty.aiDifficulty,
    };
}

function hasHumanDifficultyConflict(log, gameDifficulty) {
    return log.source === "human" &&
        SUPPORTED_AI_DIFFICULTIES.has(log.aiDifficulty) &&
        gameDifficulty.aiDifficulty !== null &&
        log.aiDifficulty !== gameDifficulty.aiDifficulty;
}

function selectPlacementLogs(games, {
    excludePlayerPrefixes,
    selectionPolicy,
    sourceFilter,
}) {
    const eligibleEntries = [];
    const rejected = [];
    let eligibleGameCount = 0;
    let excludedGameCount = 0;
    let difficultyEnrichmentCount = 0;

    [...games.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .forEach(([, game]) => {
            const gameExclusionReason = getGameExclusionReason(game);
            if (gameExclusionReason) {
                excludedGameCount += 1;
                game.placementDecision.forEach(entry => {
                    rejected.push(createEventRejection(entry, gameExclusionReason));
                });
                return;
            }

            eligibleGameCount += 1;
            const winnerPlayerId = game.gameOver[0].log.winnerPlayerId;
            const gameDifficulty = getGameAiDifficulty(game);
            game.placementDecision.forEach(entry => {
                const log = entry.log;
                if (
                    selectionPolicy === "winner-only" &&
                    log.playerId !== winnerPlayerId
                ) {
                    rejected.push(createEventRejection(entry, "LOSER_PLACEMENT"));
                    return;
                }
                if (
                    Number.isInteger(log.pieceIndex) &&
                    log.pieceIndex < MINIMUM_PIECE_INDEX
                ) {
                    rejected.push(createEventRejection(entry, "EARLY_PIECE_INDEX"));
                    return;
                }
                if (hasExcludedPlayerPrefix(log.playerId, excludePlayerPrefixes)) {
                    rejected.push(createEventRejection(entry, "TEST_PLAYER_EXCLUDED"));
                    return;
                }
                if (!matchesSourceFilter(log.source, sourceFilter)) {
                    rejected.push(createEventRejection(entry, "SOURCE_FILTERED"));
                    return;
                }
                if (
                    log.source === "human" &&
                    (
                        gameDifficulty.hasConflict ||
                        hasHumanDifficultyConflict(log, gameDifficulty)
                    )
                ) {
                    rejected.push(createEventRejection(
                        entry,
                        "AMBIGUOUS_AI_DIFFICULTY",
                    ));
                    return;
                }

                const enriched = enrichHumanDifficulty(entry, gameDifficulty);
                if (enriched.enriched) difficultyEnrichmentCount += 1;
                eligibleEntries.push(enriched.entry);
            });
        });

    eligibleEntries.sort(comparePlacementEntries);
    return {
        eligibleEntries,
        rejected,
        eligibleGameCount,
        excludedGameCount,
        difficultyEnrichmentCount,
    };
}

function addGameResultMetadata(samples, games) {
    return samples.map(sample => {
        const game = games.get(sample.gameId);
        const gameOver = game?.gameOver?.[0]?.log;
        return {
            ...sample,
            metadata: {
                ...sample.metadata,
                isWinner: sample.playerId === gameOver?.winnerPlayerId,
                winnerPlayerId: gameOver?.winnerPlayerId ?? null,
                finishType: gameOver?.finishType ?? null,
            },
        };
    });
}

async function writeJsonLines(filePath, rows) {
    const handle = await open(filePath, "w");
    try {
        const batchSize = 1000;
        for (let index = 0; index < rows.length; index += batchSize) {
            const batch = rows.slice(index, index + batchSize);
            await handle.write(batch.map(row => `${JSON.stringify(row)}\n`).join(""));
        }
    } finally {
        await handle.close();
    }
}

function countBy(rows, valueSelector, initialKeys) {
    const counts = Object.fromEntries(initialKeys.map(key => [key, 0]));
    rows.forEach(row => {
        const value = valueSelector(row);
        if (Object.hasOwn(counts, value)) counts[value] += 1;
    });
    return counts;
}

function countRejectionReasons(rejected) {
    const counts = new Map();
    rejected.forEach(item => {
        counts.set(item.reason, (counts.get(item.reason) || 0) + 1);
    });
    return Object.fromEntries(
        [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
    );
}

function compareRejections(left, right) {
    return left.lineNumber - right.lineNumber || left.reason.localeCompare(right.reason);
}

async function loadDatasetBuilder() {
    const builderPath = path.resolve(
        __dirname,
        "../src/client/game/ai/dataset/placementDatasetBuilder.js",
    );
    return import(pathToFileURL(builderPath).href);
}

function assertInputIsNotAnOutput(inputPath, outputDir) {
    const outputPaths = OUTPUT_FILE_NAMES.map(fileName => {
        return path.resolve(outputDir, fileName);
    });
    if (outputPaths.includes(path.resolve(inputPath))) {
        throw new Error("Input file must not be one of the exporter output files");
    }
}

/**
 * JSONL game event 로그를 placement train/validation dataset으로 내보낸다.
 * 입력 파일은 읽기만 하며, 같은 입력과 옵션에는 같은 결과 순서를 만든다.
 *
 * @param {Object} options - exporter 입력과 결정성 옵션
 * @returns {Promise<{manifest: Object, outputPaths: Object}>} 생성 결과
 */
async function exportPlacementDataset({
    input = DEFAULT_INPUT,
    outputDir = DEFAULT_OUTPUT_DIR,
    validationRatio = DEFAULT_VALIDATION_RATIO,
    seed = DEFAULT_SEED,
    excludePlayerPrefixes = [],
    selectionPolicy = DEFAULT_SELECTION_POLICY,
    sourceFilter = DEFAULT_SOURCE_FILTER,
} = {}) {
    if (!Number.isFinite(validationRatio) || validationRatio < 0 || validationRatio > 1) {
        throw new Error("validationRatio must be between 0 and 1");
    }
    const normalizedExcludePlayerPrefixes = normalizeExcludePlayerPrefixes(
        excludePlayerPrefixes,
    );
    if (!SUPPORTED_SELECTION_POLICIES.has(selectionPolicy)) {
        throw new Error("selectionPolicy must be winner-only or all-completed");
    }
    if (!SUPPORTED_SOURCE_FILTERS.has(sourceFilter)) {
        throw new Error("sourceFilter must be all, human, or heuristic_ai");
    }

    const inputPath = path.resolve(input);
    const resolvedOutputDir = path.resolve(outputDir);
    assertInputIsNotAnOutput(inputPath, resolvedOutputDir);

    const inputBuffer = await readFile(inputPath);
    const inputSha256 = createHash("sha256").update(inputBuffer).digest("hex");
    const parsed = parseInput(inputBuffer.toString("utf8"));
    const games = groupEventsByGameId(parsed.entries);
    const selected = selectPlacementLogs(games, {
        excludePlayerPrefixes: normalizedExcludePlayerPrefixes,
        selectionPolicy,
        sourceFilter,
    });
    const {
        buildPlacementDataset,
        splitDatasetByGameId,
        PLACEMENT_DATASET_SCHEMA_VERSION,
    } = await loadDatasetBuilder();

    const builderResult = buildPlacementDataset(
        selected.eligibleEntries.map(entry => entry.log),
    );
    const builderRejected = builderResult.rejected.map(item => {
        const entry = selected.eligibleEntries[item.index];
        return createEventRejection(entry, item.reason);
    });
    const rejectedBuilderIndexes = new Set(
        builderResult.rejected.map(item => item.index),
    );
    const acceptedPlacementEntries = selected.eligibleEntries.filter((_, index) => {
        return !rejectedBuilderIndexes.has(index);
    });
    const samplesWithGameMetadata = addGameResultMetadata(
        builderResult.samples,
        games,
    );
    const split = splitDatasetByGameId(samplesWithGameMetadata, {
        validationRatio,
        seed,
    });

    const rejected = [
        ...parsed.rejected,
        ...selected.rejected,
        ...builderRejected,
    ].sort(compareRejections);
    const rejectedPlacementLogCount = rejected.filter(item => {
        return item.eventType === "placement_decision";
    }).length;
    const sampleCountBySource = countBy(
        samplesWithGameMetadata,
        sample => sample.source,
        ["human", "heuristic_ai"],
    );
    const sampleCountByAiDifficulty = countBy(
        samplesWithGameMetadata,
        sample => sample.aiDifficulty ?? "unknown",
        ["normal", "hard", "unknown"],
    );
    const acceptedPlacementLogCountBySource = countBy(
        acceptedPlacementEntries,
        entry => entry.log.source,
        ["human", "heuristic_ai"],
    );
    const acceptedPlacementLogCountByAiDifficulty = countBy(
        acceptedPlacementEntries,
        entry => entry.log.aiDifficulty ?? "unknown",
        ["normal", "hard", "unknown"],
    );

    const manifest = {
        datasetSchemaVersion: PLACEMENT_DATASET_SCHEMA_VERSION,
        exportPolicyVersion: EXPORT_POLICY_VERSION,
        excludePlayerPrefixes: normalizedExcludePlayerPrefixes,
        selectionPolicy,
        sourceFilter,
        winnerOnly: selectionPolicy === "winner-only",
        minimumPieceIndex: MINIMUM_PIECE_INDEX,
        requiredFinishType: REQUIRED_FINISH_TYPE,
        inputSha256,
        validationRatio: split.summary.validationRatio,
        seed: split.summary.seed,
        inputLineCount: parsed.inputLineCount,
        jsonParseSuccessCount: parsed.jsonParseSuccessCount,
        jsonParseFailureCount: parsed.jsonParseFailureCount,
        eventTypeCounts: parsed.eventTypeCounts,
        totalGameCount: games.size,
        eligibleGameCount: selected.eligibleGameCount,
        excludedGameCount: selected.excludedGameCount,
        acceptedPlacementLogCount: builderResult.summary.acceptedLogCount,
        rejectedPlacementLogCount,
        difficultyEnrichmentCount: selected.difficultyEnrichmentCount,
        rejectionReasonCounts: countRejectionReasons(rejected),
        acceptedPlacementLogCountBySource,
        acceptedPlacementLogCountByAiDifficulty,
        sampleCountBySource,
        sampleCountByAiDifficulty,
        trainSampleCount: split.train.length,
        validationSampleCount: split.validation.length,
        trainGameCount: split.summary.trainGameIds.length,
        validationGameCount: split.summary.validationGameIds.length,
        selectedBySourceSampleCount: samplesWithGameMetadata.filter(sample => {
            return sample.selectedBySource === true;
        }).length,
    };

    const outputPaths = Object.fromEntries(OUTPUT_FILE_NAMES.map(fileName => {
        return [fileName, path.join(resolvedOutputDir, fileName)];
    }));
    await mkdir(resolvedOutputDir, { recursive: true });
    await Promise.all([
        writeJsonLines(outputPaths["train.jsonl"], split.train),
        writeJsonLines(outputPaths["validation.jsonl"], split.validation),
        writeJsonLines(outputPaths["rejected.jsonl"], rejected),
    ]);
    await writeFile(
        outputPaths["manifest.json"],
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
    );

    return { manifest, outputPaths };
}

async function runCli(args = process.argv.slice(2)) {
    const options = parseCliArgs(args);
    const result = await exportPlacementDataset(options);
    console.log(JSON.stringify(result.manifest, null, 2));
}

if (require.main === module) {
    runCli().catch(error => {
        console.error(`[dataset:export] ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    DEFAULT_INPUT,
    DEFAULT_OUTPUT_DIR,
    DEFAULT_SEED,
    DEFAULT_VALIDATION_RATIO,
    DEFAULT_SELECTION_POLICY,
    DEFAULT_SOURCE_FILTER,
    exportPlacementDataset,
    parseCliArgs,
};
