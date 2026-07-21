#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const { loadGameCore } = require("../dist/server/server/services/gameCoreLoader.js");
const {
    createMatch,
    getMatchState,
    resetMatches,
} = require("../dist/server/server/services/matchService.js");
const {
    createPveAiPlayerService,
} = require("../dist/server/server/services/pveAiPlayerService.js");

const EXPECTED_MODEL_SHA256 = "ff64b0d3e4cd9eb6c6d7920f2cbe961f1d70e4c90ccc69a5d9ab8bcd410cb33d";
const PIECES = ["bar", "eleft", "eright", "ess", "square", "tree", "zee"];

function parseArgs(argv) {
    const options = {
        maxPlacements: 50,
        model: null,
        output: null,
        seedPrefix: "placement-v4-gameplay",
        streams: 3,
        timingOutput: null,
    };
    for (let index = 0; index < argv.length; index += 2) {
        const name = argv[index];
        const value = argv[index + 1];
        if (!value) throw new Error(`Missing value for ${name}`);
        if (name === "--model") options.model = value;
        else if (name === "--output") options.output = value;
        else if (name === "--timing-output") options.timingOutput = value;
        else if (name === "--streams") options.streams = Number(value);
        else if (name === "--max-placements") options.maxPlacements = Number(value);
        else if (name === "--seed-prefix") options.seedPrefix = value;
        else throw new Error(`Unknown option: ${name}`);
    }
    if (!options.model || !options.output || !options.timingOutput) {
        throw new Error("--model, --output and --timing-output are required");
    }
    if (!Number.isInteger(options.streams) || options.streams <= 0 ||
        !Number.isInteger(options.maxPlacements) || options.maxPlacements <= 0) {
        throw new Error("--streams and --max-placements must be positive integers");
    }
    return options;
}

function createRandom(seed) {
    let state = crypto.createHash("sha256").update(seed).digest().readUInt32BE(0) || 1;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 0x100000000;
    };
}

function generateBagStream(seed, minimumPieces) {
    const random = createRandom(seed);
    const pieces = [];
    while (pieces.length < minimumPieces) {
        const bag = [...PIECES];
        for (let index = bag.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(random() * (index + 1));
            [bag[index], bag[swapIndex]] = [bag[swapIndex], bag[index]];
        }
        pieces.push(...bag);
    }
    return pieces;
}

function hashJson(value) {
    return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function resetAiState(player, bagStream) {
    const firstPiece = bagStream[0];
    player.bagChunks = Array.from(
        { length: Math.ceil(bagStream.length / 7) },
        (_, index) => bagStream.slice(index * 7, index * 7 + 7),
    );
    player.aiPlan = null;
    player.authoritativeState = {
        activePiece: { pieceType: firstPiece, rotation: 0, row: -1, col: 3 },
        backToBack: false,
        board: Array.from({ length: 20 }, () => Array(10).fill(null)),
        combo: -1,
        currentTick: 0,
        gameOver: false,
        holdPieceType: null,
        holdUsedThisDrop: false,
        lastActionWasRotation: false,
        lines: 0,
        pendingGarbageQueue: [],
        pendingPiece: { pieceType: firstPiece, rotation: 0, row: -1, col: 3 },
        phase: "playing",
        pieceIndex: 1,
        pieceQueue: bagStream.slice(1),
        score: 0,
    };
}

function percentile(values, percentage) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.ceil((percentage / 100) * sorted.length) - 1];
}

function round(value) {
    return Math.round(value * 1_000_000) / 1_000_000;
}

async function runRollout({
    bagStream,
    maxPlacements,
    modelPath,
    policy,
    roomId,
    serviceDependencies = {},
}) {
    resetMatches();
    const gameCore = await loadGameCore();
    const { getBoardMetrics } = await import("../src/client/game/core/boardMetrics.ts");
    const match = createMatch({
        roomId,
        mode: "pve",
        aiDifficulty: "hard",
        aiPolicy: policy,
        status: "playing",
        players: [
            { playerId: "human", playerType: "human" },
            { playerId: "ai", playerType: "heuristic_ai" },
        ],
    }).match;
    const player = match.players.find(candidate => candidate.playerId === "ai");
    resetAiState(player, bagStream);

    const decisionLatenciesMs = [];
    const safety = {
        invalidDecision: 0,
        modelFallback: 0,
        nonFiniteScore: 0,
        planDivergence: 0,
        unexpectedError: 0,
    };
    const { createService, ...pveDependencies } = serviceDependencies;
    const serviceConfig = {
        env: policy === "placement_v4"
            ? { PVE_PLACEMENT_V4_MODEL_PATH: modelPath }
            : {},
        ensurePlayerBagQueue() {
            return { ok: true, reason: null };
        },
        savePlacementDecisionLog(log) {
            return { ok: true, log, reason: null };
        },
        ...pveDependencies,
    };
    const service = createService
        ? createService(serviceConfig)
        : createPveAiPlayerService(serviceConfig);
    let totalLines = 0;
    let totalAttackLines = 0;
    let holesSum = 0;
    let maxHeightSum = 0;
    let placements = 0;
    let steps = 0;
    let stoppedReason = "PLACEMENT_CAP";

    while (placements < maxPlacements && player.authoritativeState.phase === "playing") {
        const startedAt = performance.now();
        const result = await service.processAiStep(roomId, "ai", gameCore);
        const elapsedMs = performance.now() - startedAt;
        steps += 1;
        if (result.reason === "AI_PLAN_CREATED") {
            decisionLatenciesMs.push(elapsedMs);
            if (result.decision.policyRequested === "placement_v4" &&
                result.decision.policyUsed !== "placement_v4") {
                safety.modelFallback += 1;
            }
            if (!Number.isFinite(result.decision.score)) safety.nonFiniteScore += 1;
        }
        if (result.reason === "AI_INVALID_PLAN") safety.invalidDecision += 1;
        if (result.reason === "AI_PLAN_DIVERGED") safety.planDivergence += 1;

        if (result.placementResult) {
            placements += 1;
            totalLines += result.placementResult.linesCleared;
            totalAttackLines += result.placementResult.attackLines;
            const metrics = getBoardMetrics(player.authoritativeState.board);
            holesSum += metrics.holes;
            maxHeightSum += metrics.maxHeight;
        }
        if (!result.ok) {
            if (result.reason === "NO_LEGAL_PLACEMENT" &&
                (result.gameOver || player.authoritativeState.phase === "gameOver")) {
                stoppedReason = "GAME_OVER";
            } else {
                safety.unexpectedError += 1;
                stoppedReason = result.reason || "UNEXPECTED_ERROR";
            }
            break;
        }
        if (result.gameOver || player.authoritativeState.phase === "gameOver") {
            stoppedReason = "GAME_OVER";
            break;
        }
        if (steps > maxPlacements * 40 + 40) {
            safety.unexpectedError += 1;
            stoppedReason = "STEP_LIMIT";
            break;
        }
    }

    const finalMetrics = getBoardMetrics(player.authoritativeState.board);
    const denominator = placements || 1;
    return {
        metrics: {
            attackLinesPer100Placements: round(totalAttackLines * 100 / denominator),
            averageHoles: round(holesSum / denominator),
            averageMaxHeight: round(maxHeightSum / denominator),
            finalHoles: finalMetrics.holes,
            finalMaxHeight: finalMetrics.maxHeight,
            linesPer100Placements: round(totalLines * 100 / denominator),
            placementCount: placements,
            totalAttackLines,
            totalLines,
        },
        policy,
        safety,
        stoppedReason,
        timing: {
            firstDecisionLatencyMs: policy === "placement_v4" ? decisionLatenciesMs[0] ?? null : null,
            decisionLatencyP50Ms: percentile(decisionLatenciesMs, 50),
            decisionLatencyP95Ms: percentile(decisionLatenciesMs, 95),
        },
    };
}

function withoutTiming(rollout) {
    const { timing, ...deterministic } = rollout;
    return deterministic;
}

function summarizePairs(pairs) {
    const classifications = {
        bothSurvivedHorizon: 0,
        exactGameOverTie: 0,
        v4SurvivalLoss: 0,
        v4SurvivalWin: 0,
    };
    let placementDelta = 0;
    for (const pair of pairs) {
        const delta = pair.placementDelta;
        placementDelta += delta;
        const v4Cap = pair.v4.stoppedReason === "PLACEMENT_CAP";
        const heuristicCap = pair.heuristic.stoppedReason === "PLACEMENT_CAP";
        if (v4Cap && heuristicCap) classifications.bothSurvivedHorizon += 1;
        else if (v4Cap) classifications.v4SurvivalWin += 1;
        else if (heuristicCap) classifications.v4SurvivalLoss += 1;
        else if (pair.v4.stoppedReason === "GAME_OVER" &&
            pair.heuristic.stoppedReason === "GAME_OVER" && delta === 0) {
            classifications.exactGameOverTie += 1;
        } else if (delta > 0) classifications.v4SurvivalWin += 1;
        else if (delta < 0) classifications.v4SurvivalLoss += 1;
        else classifications.exactGameOverTie += 1;
    }
    return {
        ...classifications,
        meanPlacementDelta: round(placementDelta / pairs.length),
        totalPlacementDelta: placementDelta,
    };
}

function summarizeSafety(pairs) {
    const totals = {
        invalidDecision: 0,
        modelFallback: 0,
        nonFiniteScore: 0,
        planDivergence: 0,
        unexpectedError: 0,
    };
    for (const pair of pairs) {
        for (const rollout of [pair.heuristic, pair.v4]) {
            for (const key of Object.keys(totals)) totals[key] += rollout.safety[key];
        }
    }
    return totals;
}

function getScreeningStatus(heuristicHorizonCount, v4HorizonCount) {
    return heuristicHorizonCount - v4HorizonCount >= 4
        ? "gameplay_regression_detected"
        : "gameplay_screening_passed";
}

async function runBenchmark(options, dependencies = {}) {
    const modelPath = path.resolve(options.model);
    await assertDistinctOutputPaths({
        canonicalOutput: options.output,
        model: modelPath,
        timingOutput: options.timingOutput,
    });
    const modelBytes = await fs.readFile(modelPath);
    const modelSha256 = crypto.createHash("sha256").update(modelBytes).digest("hex");
    if (modelSha256 !== EXPECTED_MODEL_SHA256 && !dependencies.allowSyntheticModel) {
        throw new Error(`Model SHA mismatch: ${modelSha256}`);
    }

    const pairs = [];
    const timingRollouts = [];
    for (let index = 0; index < options.streams; index += 1) {
        const streamId = String(index + 1).padStart(3, "0");
        const seed = `${options.seedPrefix}-${streamId}`;
        const bagStream = generateBagStream(seed, options.maxPlacements + 14);
        const rollouts = {};
        for (const policy of ["heuristic", "placement_v4"]) {
            const rollout = await runRollout({
                bagStream,
                maxPlacements: options.maxPlacements,
                modelPath,
                policy,
                roomId: `BENCH-${streamId}-${policy}`,
                serviceDependencies: dependencies.serviceDependencies || {},
            });
            rollouts[policy] = withoutTiming(rollout);
            timingRollouts.push({ policy, streamId, ...rollout.timing });
        }
        pairs.push({
            bagStreamSha256: hashJson(bagStream),
            heuristic: rollouts.heuristic,
            placementDelta: rollouts.placement_v4.metrics.placementCount -
                rollouts.heuristic.metrics.placementCount,
            seed,
            streamId,
            v4: rollouts.placement_v4,
        });
    }

    const safety = summarizeSafety(pairs);
    const safetyPassed = Object.values(safety).every(count => count === 0);
    const pairSummary = summarizePairs(pairs);
    const heuristicHorizonCount = pairs.filter(pair => {
        return pair.heuristic.stoppedReason === "PLACEMENT_CAP";
    }).length;
    const v4HorizonCount = pairs.filter(pair => {
        return pair.v4.stoppedReason === "PLACEMENT_CAP";
    }).length;
    const fullCohortCovered = options.streams === 30 &&
        options.maxPlacements === 500 && options.seedPrefix === "placement-v4-gameplay-full";
    const screening = {
        heuristicHorizonCount,
        heuristicHorizonRate: round(heuristicHorizonCount / pairs.length),
        streamCount: options.streams,
        v4HorizonCount,
        v4HorizonRate: round(v4HorizonCount / pairs.length),
    };
    const status = !safetyPassed
        ? "gameplay_benchmark_safety_failed"
        : fullCohortCovered
            ? getScreeningStatus(heuristicHorizonCount, v4HorizonCount)
            : options.streams === 3 && options.maxPlacements === 50
                ? "gameplay_benchmark_smoke_valid"
                : "gameplay_benchmark_pilot_completed";
    const report = {
        benchmarkSchemaVersion: 2,
        canonicalArtifact: false,
        canonicalResultEligible: false,
        config: {
            executionProfile: "hard",
            incomingGarbage: false,
            maxPlacements: options.maxPlacements,
            policies: ["heuristic", "placement_v4"],
            seedPrefix: options.seedPrefix,
            streamCount: options.streams,
        },
        fullCohortCovered,
        modelSha256,
        pairs,
        policyDecisionEligible: fullCohortCovered && safetyPassed,
        productionIntegration: false,
        runMode: fullCohortCovered ? "full" : "smoke",
        status,
        summary: {
            ...pairSummary,
            screening,
            safety,
        },
    };
    const reportBytes = `${JSON.stringify(report, null, 2)}\n`;
    return {
        report,
        reportBytes,
        timing: {
            canonical: false,
            canonicalReportSha256: crypto.createHash("sha256").update(reportBytes).digest("hex"),
            rollouts: timingRollouts,
        },
    };
}

async function inspectPath(filePath, rejectSymlink) {
    const lexicalPath = path.resolve(filePath);
    try {
        const linkStats = await fs.lstat(lexicalPath);
        if (rejectSymlink && linkStats.isSymbolicLink()) {
            throw new Error(`Output symlink is not allowed: ${lexicalPath}`);
        }
        const [realPath, stats] = await Promise.all([fs.realpath(lexicalPath), fs.stat(lexicalPath)]);
        return { lexicalPath, realPath, stats };
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
        let parentPath = path.dirname(lexicalPath);
        while (true) {
            try {
                const realParentPath = await fs.realpath(parentPath);
                return {
                    lexicalPath,
                    realPath: path.resolve(realParentPath, path.relative(parentPath, lexicalPath)),
                    stats: null,
                };
            } catch (parentError) {
                if (parentError.code !== "ENOENT") throw parentError;
                const nextParentPath = path.dirname(parentPath);
                if (nextParentPath === parentPath) throw parentError;
                parentPath = nextParentPath;
            }
        }
    }
}

async function assertDistinctOutputPaths(paths) {
    const entries = await Promise.all(Object.entries(paths).map(async ([name, filePath]) => {
        return [name, await inspectPath(filePath, name !== "model")];
    }));
    for (let left = 0; left < entries.length; left += 1) {
        for (let right = left + 1; right < entries.length; right += 1) {
            const [leftName, leftPath] = entries[left];
            const [rightName, rightPath] = entries[right];
            const sameLexicalPath = leftPath.lexicalPath === rightPath.lexicalPath;
            const sameRealPath = leftPath.realPath && leftPath.realPath === rightPath.realPath;
            const sameInode = leftPath.stats && rightPath.stats &&
                leftPath.stats.dev === rightPath.stats.dev && leftPath.stats.ino === rightPath.stats.ino;
            if (sameLexicalPath || sameRealPath || sameInode) {
                throw new Error(`Output path conflict: ${leftName} and ${rightName}`);
            }
        }
    }
}

async function writeJson(filePath, value) {
    await fs.mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const result = await runBenchmark(options);
    await fs.mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
    await fs.writeFile(options.output, result.reportBytes, "utf8");
    await writeJson(options.timingOutput, result.timing);
    process.stdout.write(JSON.stringify({
        modelSha256: result.report.modelSha256,
        reportSha256: result.timing.canonicalReportSha256,
        rolloutCount: options.streams * 2,
        status: result.report.status,
    }, null, 2) + "\n");
    if (result.report.status === "gameplay_benchmark_safety_failed") process.exitCode = 1;
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    EXPECTED_MODEL_SHA256,
    generateBagStream,
    getScreeningStatus,
    parseArgs,
    runBenchmark,
    runRollout,
    assertDistinctOutputPaths,
    summarizePairs,
    summarizeSafety,
};
