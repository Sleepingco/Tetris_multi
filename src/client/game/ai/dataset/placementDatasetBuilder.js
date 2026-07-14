import { evaluatePlacement } from "../heuristic/heuristicEvaluator.js";
import { generateReachablePlacements } from "../heuristic/reachablePlacementPlanner.js";

export const PLACEMENT_DATASET_SCHEMA_VERSION = 1;

export const DATASET_REJECTION_REASONS = Object.freeze({
    LOG_REQUIRED: "LOG_REQUIRED",
    INVALID_EVENT_TYPE: "INVALID_EVENT_TYPE",
    UNSUPPORTED_SCHEMA_VERSION: "UNSUPPORTED_SCHEMA_VERSION",
    INVALID_SOURCE: "INVALID_SOURCE",
    INVALID_MODEL_TYPE: "INVALID_MODEL_TYPE",
    GAME_ID_REQUIRED: "GAME_ID_REQUIRED",
    PLAYER_ID_REQUIRED: "PLAYER_ID_REQUIRED",
    PIECE_INDEX_REQUIRED: "PIECE_INDEX_REQUIRED",
    INVALID_AI_DIFFICULTY: "INVALID_AI_DIFFICULTY",
    INVALID_BOARD: "INVALID_BOARD",
    INVALID_ACTIVE_PIECE: "INVALID_ACTIVE_PIECE",
    INVALID_SELECTED_PLACEMENT: "INVALID_SELECTED_PLACEMENT",
    INVALID_INPUT_SEQUENCE: "INVALID_INPUT_SEQUENCE",
    NO_REACHABLE_CANDIDATES: "NO_REACHABLE_CANDIDATES",
    SELECTED_PLACEMENT_NOT_REACHABLE: "SELECTED_PLACEMENT_NOT_REACHABLE",
    CANDIDATE_EVALUATION_FAILED: "CANDIDATE_EVALUATION_FAILED",
});

const SUPPORTED_SOURCES = new Set(["human", "heuristic_ai"]);
const SUPPORTED_AI_DIFFICULTIES = new Set(["normal", "hard"]);
const SUPPORTED_INPUT_ACTIONS = new Set([
    "move_left",
    "move_right",
    "soft_drop",
    "rotate",
    "hard_drop",
    "hold",
]);

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim() !== "";
}

function isValidBoard(board) {
    if (!Array.isArray(board) || board.length === 0) return false;

    const columnCount = board[0]?.length ?? 0;
    if (columnCount === 0) return false;

    return board.every(row => {
        return Array.isArray(row) &&
            row.length === columnCount &&
            row.every(cell => cell === null || isNonEmptyString(cell));
    });
}

function isValidCells(cells) {
    if (!Array.isArray(cells) || cells.length !== 4) return false;

    const cellKeys = new Set();
    for (const cell of cells) {
        if (
            !isPlainObject(cell) ||
            !Number.isInteger(cell.row) ||
            !Number.isInteger(cell.col)
        ) {
            return false;
        }
        cellKeys.add(`${cell.row}:${cell.col}`);
    }

    return cellKeys.size === cells.length;
}

function isValidPiece(piece) {
    return isPlainObject(piece) &&
        isNonEmptyString(piece.pieceType) &&
        Number.isInteger(piece.rotation) &&
        piece.rotation >= 0 &&
        Number.isInteger(piece.row) &&
        Number.isInteger(piece.col) &&
        isValidCells(piece.cells);
}

function hasValidSourceModel(log) {
    if (log.source === "human") return log.modelType === null;
    if (log.source === "heuristic_ai") return log.modelType === "heuristic";
    return false;
}

function isValidAiDifficulty(log) {
    if (log.aiDifficulty === undefined || log.aiDifficulty === null) return true;
    return SUPPORTED_AI_DIFFICULTIES.has(log.aiDifficulty);
}

function isValidInputSequence(inputSequence) {
    if (!Array.isArray(inputSequence)) return false;

    return inputSequence.every(input => {
        return isPlainObject(input) &&
            SUPPORTED_INPUT_ACTIONS.has(input.action) &&
            Number.isInteger(input.tick) &&
            input.tick >= 0 &&
            Number.isInteger(input.pieceIndex) &&
            input.pieceIndex >= 0 &&
            Number.isInteger(input.sequence) &&
            input.sequence >= 1 &&
            Number.isFinite(input.createdAt) &&
            input.createdAt >= 0;
    });
}

function cloneSerializable(value) {
    if (typeof structuredClone === "function") {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

function clonePlacement(placement) {
    return {
        pieceType: placement.pieceType,
        rotation: placement.rotation,
        row: placement.row,
        col: placement.col,
        cells: placement.cells.map(cell => ({ ...cell })),
    };
}

function cloneMetrics(metrics) {
    return {
        columnHeights: [...metrics.columnHeights],
        aggregateHeight: metrics.aggregateHeight,
        maxHeight: metrics.maxHeight,
        holes: metrics.holes,
        bumpiness: metrics.bumpiness,
        completeLines: metrics.completeLines,
    };
}

function calculateMetricDelta(metricsBefore, metricsAfter) {
    return {
        columnHeights: metricsAfter.columnHeights.map((height, index) => {
            return height - metricsBefore.columnHeights[index];
        }),
        aggregateHeight: metricsAfter.aggregateHeight - metricsBefore.aggregateHeight,
        maxHeight: metricsAfter.maxHeight - metricsBefore.maxHeight,
        holes: metricsAfter.holes - metricsBefore.holes,
        bumpiness: metricsAfter.bumpiness - metricsBefore.bumpiness,
        completeLines: metricsAfter.completeLines - metricsBefore.completeLines,
    };
}

function isSamePlacement(left, right) {
    return left.pieceType === right.pieceType &&
        left.rotation === right.rotation &&
        left.row === right.row &&
        left.col === right.col;
}

function createRejectedLog(log, index, reason) {
    return {
        index,
        gameId: isNonEmptyString(log?.gameId) ? log.gameId : null,
        pieceIndex: Number.isInteger(log?.pieceIndex) ? log.pieceIndex : null,
        reason,
    };
}

function validateDecisionLog(log) {
    if (!isPlainObject(log)) return DATASET_REJECTION_REASONS.LOG_REQUIRED;
    if (log.eventType !== "placement_decision") {
        return DATASET_REJECTION_REASONS.INVALID_EVENT_TYPE;
    }
    if (log.schemaVersion !== 2) {
        return DATASET_REJECTION_REASONS.UNSUPPORTED_SCHEMA_VERSION;
    }
    if (!SUPPORTED_SOURCES.has(log.source)) {
        return DATASET_REJECTION_REASONS.INVALID_SOURCE;
    }
    if (!hasValidSourceModel(log)) {
        return DATASET_REJECTION_REASONS.INVALID_MODEL_TYPE;
    }
    if (!isNonEmptyString(log.gameId)) {
        return DATASET_REJECTION_REASONS.GAME_ID_REQUIRED;
    }
    if (!isNonEmptyString(log.playerId)) {
        return DATASET_REJECTION_REASONS.PLAYER_ID_REQUIRED;
    }
    if (!Number.isInteger(log.pieceIndex) || log.pieceIndex < 0) {
        return DATASET_REJECTION_REASONS.PIECE_INDEX_REQUIRED;
    }
    if (!isValidAiDifficulty(log)) {
        return DATASET_REJECTION_REASONS.INVALID_AI_DIFFICULTY;
    }
    if (!isValidBoard(log.boardBefore)) {
        return DATASET_REJECTION_REASONS.INVALID_BOARD;
    }
    if (!isValidPiece(log.activePiece)) {
        return DATASET_REJECTION_REASONS.INVALID_ACTIVE_PIECE;
    }
    if (!isValidPiece(log.selectedPlacement)) {
        return DATASET_REJECTION_REASONS.INVALID_SELECTED_PLACEMENT;
    }
    if (log.inputSequence !== undefined && !isValidInputSequence(log.inputSequence)) {
        return DATASET_REJECTION_REASONS.INVALID_INPUT_SEQUENCE;
    }

    return null;
}

function createSample(log, candidate, evaluation, inputSequence) {
    const metricsBefore = cloneMetrics(evaluation.metricsBefore);
    const candidateMetricsAfter = cloneMetrics(evaluation.metricsAfter);

    return {
        datasetSchemaVersion: PLACEMENT_DATASET_SCHEMA_VERSION,
        gameId: log.gameId,
        playerId: log.playerId,
        pieceIndex: log.pieceIndex,
        source: log.source,
        modelType: log.modelType,
        aiDifficulty: log.aiDifficulty ?? null,
        pieceType: candidate.placement.pieceType,
        boardBefore: log.boardBefore.map(row => [...row]),
        candidatePlacement: clonePlacement(candidate.placement),
        plannedActions: [...candidate.plannedActions],
        metricsBefore,
        candidateMetricsAfter,
        metricDelta: calculateMetricDelta(metricsBefore, candidateMetricsAfter),
        selectedBySource: isSamePlacement(candidate.placement, log.selectedPlacement),
        heuristicBaseline: {
            score: evaluation.score,
            reason: { ...evaluation.reason },
        },
        metadata: {
            inputSequence: cloneSerializable(inputSequence),
        },
    };
}

function createSummary(inputLogCount, acceptedLogCount, samples, rejected) {
    const sourceCounts = {
        human: 0,
        heuristic_ai: 0,
    };
    samples.forEach(sample => {
        sourceCounts[sample.source] += 1;
    });

    return {
        inputLogCount,
        acceptedLogCount,
        rejectedLogCount: rejected.length,
        sampleCount: samples.length,
        sampleCountBySource: sourceCounts,
    };
}

/**
 * schemaVersion 2 placement_decision 로그를 후보 placement 비교용 sample로 변환한다.
 * 원본의 미래 결과 대신 현재 board에서 재생성한 후보와 휴리스틱 baseline만 사용한다.
 *
 * @param {Object[]} logs - placement_decision 로그 목록
 * @param {Object} options - 향후 builder 옵션을 위한 예약 인자
 * @returns {{samples: Object[], rejected: Object[], summary: Object}} dataset 생성 결과
 */
export function buildPlacementDataset(logs, options = {}) {
    void options;

    if (!Array.isArray(logs)) {
        const rejected = [createRejectedLog(null, 0, DATASET_REJECTION_REASONS.LOG_REQUIRED)];
        return {
            samples: [],
            rejected,
            summary: createSummary(0, 0, [], rejected),
        };
    }

    const samples = [];
    const rejected = [];
    let acceptedLogCount = 0;

    logs.forEach((log, index) => {
        const validationReason = validateDecisionLog(log);
        if (validationReason) {
            rejected.push(createRejectedLog(log, index, validationReason));
            return;
        }

        let inputSequence;
        try {
            inputSequence = cloneSerializable(log.inputSequence ?? []);
        } catch {
            rejected.push(createRejectedLog(
                log,
                index,
                DATASET_REJECTION_REASONS.INVALID_INPUT_SEQUENCE,
            ));
            return;
        }

        const candidates = generateReachablePlacements(log.boardBefore, log.activePiece);
        if (candidates.length === 0) {
            rejected.push(createRejectedLog(
                log,
                index,
                DATASET_REJECTION_REASONS.NO_REACHABLE_CANDIDATES,
            ));
            return;
        }

        if (!candidates.some(candidate => {
            return isSamePlacement(candidate.placement, log.selectedPlacement);
        })) {
            rejected.push(createRejectedLog(
                log,
                index,
                DATASET_REJECTION_REASONS.SELECTED_PLACEMENT_NOT_REACHABLE,
            ));
            return;
        }

        const decisionSamples = [];
        for (const candidate of candidates) {
            const evaluation = evaluatePlacement(log.boardBefore, candidate.placement);
            if (!evaluation) {
                rejected.push(createRejectedLog(
                    log,
                    index,
                    DATASET_REJECTION_REASONS.CANDIDATE_EVALUATION_FAILED,
                ));
                return;
            }
            decisionSamples.push(createSample(log, candidate, evaluation, inputSequence));
        }

        acceptedLogCount += 1;
        samples.push(...decisionSamples);
    });

    return {
        samples,
        rejected,
        summary: createSummary(logs.length, acceptedLogCount, samples, rejected),
    };
}

function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function compareSamples(left, right) {
    const leftPlacement = left.candidatePlacement ?? {};
    const rightPlacement = right.candidatePlacement ?? {};
    const leftKey = [
        left.gameId,
        left.playerId,
        left.pieceIndex,
        leftPlacement.pieceType,
        leftPlacement.rotation,
        leftPlacement.row,
        leftPlacement.col,
    ].join(":");
    const rightKey = [
        right.gameId,
        right.playerId,
        right.pieceIndex,
        rightPlacement.pieceType,
        rightPlacement.rotation,
        rightPlacement.row,
        rightPlacement.col,
    ].join(":");
    return leftKey.localeCompare(rightKey);
}

/**
 * sample을 gameId 단위로 결정적으로 나눠 같은 게임의 leakage를 막는다.
 *
 * @param {Object[]} samples - placement dataset sample 목록
 * @param {{validationRatio?: number, seed?: string|number}} options - split 옵션
 * @returns {{train: Object[], validation: Object[], summary: Object}} split 결과
 */
export function splitDatasetByGameId(samples, {
    validationRatio = 0.2,
    seed = "placement-dataset-v1",
} = {}) {
    const safeSamples = Array.isArray(samples) ? samples : [];
    const safeRatio = Number.isFinite(validationRatio)
        ? Math.min(1, Math.max(0, validationRatio))
        : 0.2;
    const seedValue = String(seed);
    const validationGameIds = new Set();

    const gameIds = [...new Set(
        safeSamples
            .map(sample => sample?.gameId)
            .filter(isNonEmptyString),
    )].sort();

    const validationGameCount = Math.floor(gameIds.length * safeRatio);
    const gameIdsBySeed = [...gameIds].sort((left, right) => {
        const hashDelta = hashString(`${seedValue}:${left}`) -
            hashString(`${seedValue}:${right}`);
        return hashDelta !== 0 ? hashDelta : left.localeCompare(right);
    });
    gameIdsBySeed.slice(0, validationGameCount).forEach(gameId => {
        validationGameIds.add(gameId);
    });

    const train = [];
    const validation = [];
    safeSamples.forEach(sample => {
        if (validationGameIds.has(sample?.gameId)) {
            validation.push(sample);
            return;
        }
        train.push(sample);
    });

    train.sort(compareSamples);
    validation.sort(compareSamples);

    const trainGameIds = gameIds.filter(gameId => !validationGameIds.has(gameId));
    const sortedValidationGameIds = gameIds.filter(gameId => validationGameIds.has(gameId));

    return {
        train,
        validation,
        summary: {
            validationRatio: safeRatio,
            seed: seedValue,
            trainSampleCount: train.length,
            validationSampleCount: validation.length,
            trainGameIds,
            validationGameIds: sortedValidationGameIds,
        },
    };
}
