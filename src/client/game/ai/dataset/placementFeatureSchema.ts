/**
 * placement ranker가 읽는 16개 숫자의 이름과 순서를 고정한다.
 *
 * 1~2: line clear와 game over 결과
 * 3~6: 전체 높이·최대 높이·hole·bumpiness 변화량
 * 7~16: 각 열 높이 변화량
 *
 * `candidateResult`는 후보를 지금 놓았을 때의 즉시 시뮬레이션 결과다.
 * `selectedBySource`는 label이고 승패는 미래 분석 metadata이므로 feature에서 제외한다.
 * 난이도·ID·입력 횟수·heuristic 점수도 보드 상태 기반의 고정 feature 계약과
 * 정책 독립성을 유지하기 위해 포함하지 않는다. 학습과 runtime 추론은 반드시
 * 이 함수와 같은 이름·순서를 사용해야 한다.
 */

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

export type PlacementFeatureResult = {
    ok: true;
    reason: null;
    values: number[];
} | {
    ok: false;
    reason: string;
    values: null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function createFailure(reason: string): PlacementFeatureResult {
    return { ok: false, reason, values: null };
}

/**
 * v2 candidate sample에서 학습용 고정 feature vector를 순수하게 추출한다.
 * 숫자가 아니거나 `NaN`/`Infinity`인 값은 조용히 학습시키지 않고 reason과 함께
 * 거부한다. 게임 결과 metadata, heuristic score, AI 난이도는 포함하지 않는다.
 */
export function extractPlacementFeatures(sample: unknown): PlacementFeatureResult {
    if (!isRecord(sample)) {
        return createFailure(FEATURE_REJECTION_REASONS.INVALID_SAMPLE);
    }
    if (sample.datasetSchemaVersion !== 2) {
        return createFailure(FEATURE_REJECTION_REASONS.UNSUPPORTED_DATASET_SCHEMA_VERSION);
    }
    const result = sample.candidateResult;
    if (!isRecord(result) || typeof result.linesCleared !== "number" ||
        !Number.isInteger(result.linesCleared) || result.linesCleared < 0 ||
        typeof result.gameOver !== "boolean") {
        return createFailure(FEATURE_REJECTION_REASONS.INVALID_CANDIDATE_RESULT);
    }
    const delta = sample.metricDelta;
    if (!isRecord(delta)) {
        return createFailure(FEATURE_REJECTION_REASONS.INVALID_METRIC_DELTA);
    }
    const scalarNames = ["aggregateHeight", "maxHeight", "holes", "bumpiness"];
    if (!scalarNames.every(name => isFiniteNumber(delta[name]))) {
        return createFailure(FEATURE_REJECTION_REASONS.INVALID_METRIC_DELTA);
    }
    if (!Array.isArray(delta.columnHeights) || delta.columnHeights.length !== 10) {
        return createFailure(FEATURE_REJECTION_REASONS.INVALID_COLUMN_HEIGHT_DELTA);
    }
    if (!delta.columnHeights.every(isFiniteNumber)) {
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
    return values.every(isFiniteNumber)
        ? { ok: true, reason: null, values }
        : createFailure(FEATURE_REJECTION_REASONS.NON_FINITE_FEATURE);
}
