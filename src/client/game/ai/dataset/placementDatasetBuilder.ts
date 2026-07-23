import { evaluatePlacement } from "../heuristic/heuristicEvaluator.ts";
import { generateReachablePlacements } from "../heuristic/reachablePlacementPlanner.ts";
import type { Board } from "../../core/board.ts";
import type { BoardMetrics } from "../../core/boardMetrics.ts";
import type { HeuristicEvaluation, HeuristicReason } from "../heuristic/heuristicEvaluator.ts";
import type { Placement, PlacementCell } from "../heuristic/placementGenerator.ts";
import type { ReachablePlacement } from "../heuristic/reachablePlacementPlanner.ts";

/**
 * 검증된 placement 로그 한 건을 같은 판단 시점의 후보 여러 행으로 확장한다.
 *
 * 흐름:
 * `placement_decision` → 도달 가능한 후보 생성 → 후보별 게임 결과 시뮬레이션
 * → 사람/AI가 실제 고른 후보에 `selectedBySource=true` 표시
 *
 * 이 dataset의 목표는 과거 선택을 모방하는 ranking 학습이다. 승률이나 미래 점수처럼
 * 판단 뒤에 알게 되는 값은 feature를 만들 때 사용하지 않으므로, 이 데이터로 높은
 * gameplay 성능까지 증명할 수는 없다.
 */

export type PlacementSource = "human" | "heuristic_ai";
export type PlacementInputRecord = {
    action: "move_left" | "move_right" | "soft_drop" | "rotate" | "hard_drop" | "hold";
    tick: number;
    pieceIndex: number;
    sequence: number;
    createdAt: number;
};
export type PlacementDecisionLog = {
    eventType: "placement_decision";
    schemaVersion: 2;
    source: PlacementSource;
    modelType: "heuristic" | null;
    gameId: string;
    playerId: string;
    pieceIndex: number;
    aiDifficulty?: "normal" | "hard" | null;
    boardBefore: Board;
    activePiece: Placement;
    selectedPlacement: Placement;
    inputSequence?: PlacementInputRecord[];
};
export type PlacementMetricDelta = BoardMetrics;
export type PlacementDatasetSample = {
    datasetSchemaVersion: 2;
    gameId: string;
    playerId: string;
    pieceIndex: number;
    source: PlacementSource;
    modelType: "heuristic" | null;
    aiDifficulty: "normal" | "hard" | null;
    pieceType: Placement["pieceType"];
    boardBefore: Board;
    candidatePlacement: Placement;
    plannedActions: string[];
    metricsBefore: BoardMetrics;
    candidateMetricsAfter: BoardMetrics;
    metricDelta: PlacementMetricDelta;
    candidateResult: { linesCleared: number; gameOver: boolean };
    selectedBySource: boolean;
    heuristicBaseline: { score: number; reason: HeuristicReason };
    metadata: {
        inputSequence: unknown;
        isWinner?: boolean;
        winnerPlayerId?: string | null;
        finishType?: string | null;
    };
};
export type RejectedPlacementLog = {
    index: number;
    gameId: string | null;
    pieceIndex: number | null;
    reason: string;
};
export type PlacementDatasetSummary = {
    inputLogCount: number;
    acceptedLogCount: number;
    rejectedLogCount: number;
    sampleCount: number;
    sampleCountBySource: Record<PlacementSource, number>;
};

export const PLACEMENT_DATASET_SCHEMA_VERSION = 2;

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

const SUPPORTED_INPUT_ACTIONS = new Set([
    "move_left",
    "move_right",
    "soft_drop",
    "rotate",
    "hard_drop",
    "hold",
]);

function isPlacementSource(value: unknown): value is PlacementSource {
    return value === "human" || value === "heuristic_ai";
}

function isAiDifficulty(value: unknown): value is "normal" | "hard" {
    return value === "normal" || value === "hard";
}

function isPlacementInputAction(value: unknown): value is PlacementInputRecord["action"] {
    return typeof value === "string" && SUPPORTED_INPUT_ACTIONS.has(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim() !== "";
}

function isValidBoard(board: unknown): board is Board {
    if (!Array.isArray(board) || board.length === 0) return false;

    const columnCount = board[0]?.length ?? 0;
    if (columnCount === 0) return false;

    return board.every(row => {
        return Array.isArray(row) &&
            row.length === columnCount &&
            row.every(cell => cell === null || isNonEmptyString(cell));
    });
}

function isValidCells(cells: unknown): cells is PlacementCell[] {
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

function isValidPiece(piece: unknown): piece is Placement {
    return isPlainObject(piece) &&
        isNonEmptyString(piece.pieceType) &&
        typeof piece.rotation === "number" &&
        Number.isInteger(piece.rotation) &&
        piece.rotation >= 0 &&
        Number.isInteger(piece.row) &&
        Number.isInteger(piece.col) &&
        isValidCells(piece.cells);
}

function hasValidSourceModel(log: Record<string, unknown>): boolean {
    if (log.source === "human") return log.modelType === null;
    if (log.source === "heuristic_ai") return log.modelType === "heuristic";
    return false;
}

function isValidAiDifficulty(log: Record<string, unknown>): boolean {
    if (log.aiDifficulty === undefined || log.aiDifficulty === null) return true;
    return isAiDifficulty(log.aiDifficulty);
}

function isValidInputSequence(inputSequence: unknown): inputSequence is PlacementInputRecord[] {
    if (!Array.isArray(inputSequence)) return false;

    return inputSequence.every(input => {
        return isPlainObject(input) &&
            isPlacementInputAction(input.action) &&
            typeof input.tick === "number" &&
            Number.isInteger(input.tick) &&
            input.tick >= 0 &&
            typeof input.pieceIndex === "number" &&
            Number.isInteger(input.pieceIndex) &&
            input.pieceIndex >= 0 &&
            typeof input.sequence === "number" &&
            Number.isInteger(input.sequence) &&
            input.sequence >= 1 &&
            typeof input.createdAt === "number" &&
            Number.isFinite(input.createdAt) &&
            input.createdAt >= 0;
    });
}

function cloneSerializable(value: unknown): unknown {
    if (typeof structuredClone === "function") {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

function clonePlacement(placement: Placement): Placement {
    return {
        pieceType: placement.pieceType,
        rotation: placement.rotation,
        row: placement.row,
        col: placement.col,
        cells: placement.cells.map(cell => ({ ...cell })),
    };
}

function cloneMetrics(metrics: BoardMetrics): BoardMetrics {
    return {
        columnHeights: [...metrics.columnHeights],
        aggregateHeight: metrics.aggregateHeight,
        maxHeight: metrics.maxHeight,
        holes: metrics.holes,
        bumpiness: metrics.bumpiness,
        completeLines: metrics.completeLines,
    };
}

function calculateMetricDelta(
    metricsBefore: BoardMetrics,
    metricsAfter: BoardMetrics,
): PlacementMetricDelta {
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

function isSamePlacement(left: Placement, right: Placement): boolean {
    return left.pieceType === right.pieceType &&
        left.rotation === right.rotation &&
        left.row === right.row &&
        left.col === right.col;
}

function createRejectedLog(
    log: unknown,
    index: number,
    reason: string,
): RejectedPlacementLog {
    const record = isPlainObject(log) ? log : null;
    return {
        index,
        gameId: isNonEmptyString(record?.gameId) ? record.gameId : null,
        pieceIndex: typeof record?.pieceIndex === "number" && Number.isInteger(record.pieceIndex)
            ? record.pieceIndex
            : null,
        reason,
    };
}

type DecisionLogValidation = {
    ok: true;
    log: PlacementDecisionLog;
} | {
    ok: false;
    reason: string;
};

function validateDecisionLog(log: unknown): DecisionLogValidation {
    if (!isPlainObject(log)) return { ok: false, reason: DATASET_REJECTION_REASONS.LOG_REQUIRED };
    if (log.eventType !== "placement_decision") {
        return { ok: false, reason: DATASET_REJECTION_REASONS.INVALID_EVENT_TYPE };
    }
    if (log.schemaVersion !== 2) {
        return { ok: false, reason: DATASET_REJECTION_REASONS.UNSUPPORTED_SCHEMA_VERSION };
    }
    if (!isPlacementSource(log.source)) {
        return { ok: false, reason: DATASET_REJECTION_REASONS.INVALID_SOURCE };
    }
    if (!hasValidSourceModel(log)) {
        return { ok: false, reason: DATASET_REJECTION_REASONS.INVALID_MODEL_TYPE };
    }
    if (!isNonEmptyString(log.gameId)) {
        return { ok: false, reason: DATASET_REJECTION_REASONS.GAME_ID_REQUIRED };
    }
    if (!isNonEmptyString(log.playerId)) {
        return { ok: false, reason: DATASET_REJECTION_REASONS.PLAYER_ID_REQUIRED };
    }
    if (typeof log.pieceIndex !== "number" || !Number.isInteger(log.pieceIndex) || log.pieceIndex < 0) {
        return { ok: false, reason: DATASET_REJECTION_REASONS.PIECE_INDEX_REQUIRED };
    }
    if (!isValidAiDifficulty(log)) {
        return { ok: false, reason: DATASET_REJECTION_REASONS.INVALID_AI_DIFFICULTY };
    }
    if (!isValidBoard(log.boardBefore)) {
        return { ok: false, reason: DATASET_REJECTION_REASONS.INVALID_BOARD };
    }
    if (!isValidPiece(log.activePiece)) {
        return { ok: false, reason: DATASET_REJECTION_REASONS.INVALID_ACTIVE_PIECE };
    }
    if (!isValidPiece(log.selectedPlacement)) {
        return { ok: false, reason: DATASET_REJECTION_REASONS.INVALID_SELECTED_PLACEMENT };
    }
    if (log.inputSequence !== undefined && !isValidInputSequence(log.inputSequence)) {
        return { ok: false, reason: DATASET_REJECTION_REASONS.INVALID_INPUT_SEQUENCE };
    }

    return {
        ok: true,
        log: {
            eventType: "placement_decision",
            schemaVersion: 2,
            source: log.source,
            modelType: log.source === "human" ? null : "heuristic",
            gameId: log.gameId,
            playerId: log.playerId,
            pieceIndex: log.pieceIndex,
            aiDifficulty: isAiDifficulty(log.aiDifficulty) ? log.aiDifficulty : null,
            boardBefore: log.boardBefore,
            activePiece: log.activePiece,
            selectedPlacement: log.selectedPlacement,
            ...(log.inputSequence === undefined ? {} : { inputSequence: log.inputSequence }),
        },
    };
}

function createSample(
    log: PlacementDecisionLog,
    candidate: ReachablePlacement,
    evaluation: HeuristicEvaluation,
    inputSequence: unknown,
): PlacementDatasetSample {
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
        candidateResult: {
            linesCleared: evaluation.linesCleared,
            gameOver: evaluation.gameOver,
        },
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

function createSummary(
    inputLogCount: number,
    acceptedLogCount: number,
    samples: PlacementDatasetSample[],
    rejected: RejectedPlacementLog[],
): PlacementDatasetSummary {
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
 * - 로그에 적힌 결과를 그대로 학습하지 않고 현재 board에서 모든 후보를 다시 만든다.
 * - 실제 선택이 후보 목록에 없으면 label을 신뢰할 수 없으므로 그 결정 전체를 제외한다.
 * - 한 후보라도 평가할 수 없으면 후보 수가 달라지는 부분 dataset을 만들지 않는다.
 * - `rejected`에는 제외 이유를 남겨 같은 입력에서 정제 결과를 재현할 수 있게 한다.
 */
export function buildPlacementDataset(logs: unknown, options: unknown = {}) {
    void options;

    if (!Array.isArray(logs)) {
        const rejected = [createRejectedLog(null, 0, DATASET_REJECTION_REASONS.LOG_REQUIRED)];
        return {
            samples: [],
            rejected,
            summary: createSummary(0, 0, [], rejected),
        };
    }

    const samples: PlacementDatasetSample[] = [];
    const rejected: RejectedPlacementLog[] = [];
    let acceptedLogCount = 0;

    logs.forEach((log, index) => {
        const validation = validateDecisionLog(log);
        if (!validation.ok) {
            rejected.push(createRejectedLog(log, index, validation.reason));
            return;
        }
        const validatedLog = validation.log;

        let inputSequence;
        try {
            inputSequence = cloneSerializable(validatedLog.inputSequence ?? []);
        } catch {
            rejected.push(createRejectedLog(
                log,
                index,
                DATASET_REJECTION_REASONS.INVALID_INPUT_SEQUENCE,
            ));
            return;
        }

        const candidates = generateReachablePlacements(validatedLog.boardBefore, validatedLog.activePiece);
        if (candidates.length === 0) {
            rejected.push(createRejectedLog(
                log,
                index,
                DATASET_REJECTION_REASONS.NO_REACHABLE_CANDIDATES,
            ));
            return;
        }

        if (!candidates.some(candidate => {
            return isSamePlacement(candidate.placement, validatedLog.selectedPlacement);
        })) {
            // 선택 label이 후보 집합에 없으면 selected/unselected 비교 자체를 만들 수 없다.
            rejected.push(createRejectedLog(
                log,
                index,
                DATASET_REJECTION_REASONS.SELECTED_PLACEMENT_NOT_REACHABLE,
            ));
            return;
        }

        const decisionSamples = [];
        for (const candidate of candidates) {
            const evaluation = evaluatePlacement(validatedLog.boardBefore, candidate.placement);
            if (!evaluation) {
                rejected.push(createRejectedLog(
                    log,
                    index,
                    DATASET_REJECTION_REASONS.CANDIDATE_EVALUATION_FAILED,
                ));
                return;
            }
            decisionSamples.push(createSample(validatedLog, candidate, evaluation, inputSequence));
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

function hashString(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function compareSamples(left: PlacementDatasetSample, right: PlacementDatasetSample): number {
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
 * 같은 게임의 연속 board는 서로 매우 비슷하므로 행 단위 split을 하면 validation이
 * 사실상 train 장면을 다시 보게 된다. 따라서 seed로 validation `gameId`를 고른 뒤
 * 그 게임의 모든 후보 행을 한쪽에만 넣고, 출력 순서도 고정한다.
 */
export function splitDatasetByGameId(samples: PlacementDatasetSample[], {
    validationRatio = 0.2,
    seed = "placement-dataset-v1",
}: { validationRatio?: number; seed?: string | number } = {}) {
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

    const train: PlacementDatasetSample[] = [];
    const validation: PlacementDatasetSample[] = [];
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
