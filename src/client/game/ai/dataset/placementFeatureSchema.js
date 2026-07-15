export const PLACEMENT_FEATURE_SCHEMA_VERSION = 1;

export const PLACEMENT_FEATURE_NAMES = Object.freeze([
    "candidateResult.linesCleared",
    "candidateResult.gameOver",
    "metricDelta.aggregateHeight",
    "metricDelta.maxHeight",
    "metricDelta.holes",
    "metricDelta.bumpiness",
    "metricDelta.columnHeights[0]",
    "metricDelta.columnHeights[1]",
    "metricDelta.columnHeights[2]",
    "metricDelta.columnHeights[3]",
    "metricDelta.columnHeights[4]",
    "metricDelta.columnHeights[5]",
    "metricDelta.columnHeights[6]",
    "metricDelta.columnHeights[7]",
    "metricDelta.columnHeights[8]",
    "metricDelta.columnHeights[9]",
]);

export const FEATURE_REJECTION_REASONS = Object.freeze({
    INVALID_SAMPLE: "INVALID_SAMPLE",
    UNSUPPORTED_DATASET_SCHEMA_VERSION: "UNSUPPORTED_DATASET_SCHEMA_VERSION",
    INVALID_CANDIDATE_RESULT: "INVALID_CANDIDATE_RESULT",
    INVALID_METRIC_DELTA: "INVALID_METRIC_DELTA",
    INVALID_COLUMN_HEIGHT_DELTA: "INVALID_COLUMN_HEIGHT_DELTA",
    NON_FINITE_FEATURE: "NON_FINITE_FEATURE",
});

function createFailure(reason) {
    return { ok: false, reason, values: null };
}

/**
 * v2 candidate sample에서 학습용 고정 feature vector를 순수하게 추출한다.
 * 게임 결과 metadata, heuristic score, AI 난이도는 포함하지 않는다.
 */
export function extractPlacementFeatures(sample) {
    if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
        return createFailure(FEATURE_REJECTION_REASONS.INVALID_SAMPLE);
    }
    if (sample.datasetSchemaVersion !== 2) {
        return createFailure(FEATURE_REJECTION_REASONS.UNSUPPORTED_DATASET_SCHEMA_VERSION);
    }
    const result = sample.candidateResult;
    if (!Number.isInteger(result?.linesCleared) || result.linesCleared < 0 ||
        typeof result.gameOver !== "boolean") {
        return createFailure(FEATURE_REJECTION_REASONS.INVALID_CANDIDATE_RESULT);
    }
    const delta = sample.metricDelta;
    if (!delta || typeof delta !== "object") {
        return createFailure(FEATURE_REJECTION_REASONS.INVALID_METRIC_DELTA);
    }
    const scalarNames = ["aggregateHeight", "maxHeight", "holes", "bumpiness"];
    if (!scalarNames.every(name => Number.isFinite(delta[name]))) {
        return createFailure(FEATURE_REJECTION_REASONS.INVALID_METRIC_DELTA);
    }
    if (!Array.isArray(delta.columnHeights) || delta.columnHeights.length !== 10) {
        return createFailure(FEATURE_REJECTION_REASONS.INVALID_COLUMN_HEIGHT_DELTA);
    }
    if (!delta.columnHeights.every(Number.isFinite)) {
        return createFailure(FEATURE_REJECTION_REASONS.NON_FINITE_FEATURE);
    }
    const values = [
        result.linesCleared,
        result.gameOver ? 1 : 0,
        delta.aggregateHeight,
        delta.maxHeight,
        delta.holes,
        delta.bumpiness,
        ...delta.columnHeights,
    ];
    return values.every(Number.isFinite)
        ? { ok: true, reason: null, values }
        : createFailure(FEATURE_REJECTION_REASONS.NON_FINITE_FEATURE);
}
