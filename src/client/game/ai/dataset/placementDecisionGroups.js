import { extractPlacementFeatures } from "./placementFeatureSchema.js";

export const DECISION_GROUP_REJECTION_REASONS = Object.freeze({
    INVALID_DECISION_GROUP: "INVALID_DECISION_GROUP",
    INVALID_SELECTED_FLAG: "INVALID_SELECTED_FLAG",
    MULTIPLE_SELECTED_CANDIDATES: "MULTIPLE_SELECTED_CANDIDATES",
    SELECTED_CANDIDATE_MISSING: "SELECTED_CANDIDATE_MISSING",
    DUPLICATE_CANDIDATE_PLACEMENT: "DUPLICATE_CANDIDATE_PLACEMENT",
    INCONSISTENT_DECISION_CONTEXT: "INCONSISTENT_DECISION_CONTEXT",
    INVALID_FEATURE_VECTOR: "INVALID_FEATURE_VECTOR",
    INSUFFICIENT_CANDIDATES: "INSUFFICIENT_CANDIDATES",
});

export function createDecisionKey(sample) {
    if (!sample || typeof sample.gameId !== "string" || typeof sample.playerId !== "string" ||
        !Number.isInteger(sample.pieceIndex)) return null;
    return `${sample.gameId}:${sample.playerId}:${sample.pieceIndex}`;
}

export function getCanonicalPlacementKey(sample) {
    const placement = sample?.candidatePlacement;
    if (!placement || typeof placement.pieceType !== "string" ||
        !Number.isInteger(placement.rotation) || !Number.isInteger(placement.row) ||
        !Number.isInteger(placement.col)) return null;
    return [placement.pieceType, placement.rotation, placement.row, placement.col].join(":");
}

/** Locale과 실행 환경에 의존하지 않는 Unicode code-point 순서를 사용한다. */
export function compareCanonicalStrings(leftValue, rightValue) {
    const left = Array.from(String(leftValue));
    const right = Array.from(String(rightValue));
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index++) {
        const difference = left[index].codePointAt(0) - right[index].codePointAt(0);
        if (difference !== 0) return difference;
    }
    return left.length - right.length;
}

function stableValue(value) {
    return JSON.stringify(value);
}

function createRejected(key, reason) {
    return { decisionKey: key, reason };
}

function validateGroup(key, samples) {
    if (samples.length < 2) return createRejected(key, DECISION_GROUP_REJECTION_REASONS.INSUFFICIENT_CANDIDATES);
    const first = samples[0];
    const context = [first.gameId, first.playerId, first.pieceIndex, first.source, first.pieceType,
        first.aiDifficulty, stableValue(first.boardBefore), stableValue(first.metricsBefore),
        stableValue(first.metadata?.isWinner), stableValue(first.metadata?.winnerPlayerId),
        stableValue(first.metadata?.finishType)].join("|");
    const placements = new Set();
    let selectedCount = 0;
    for (const sample of samples) {
        const sampleContext = [sample.gameId, sample.playerId, sample.pieceIndex, sample.source, sample.pieceType,
            sample.aiDifficulty, stableValue(sample.boardBefore), stableValue(sample.metricsBefore),
            stableValue(sample.metadata?.isWinner), stableValue(sample.metadata?.winnerPlayerId),
            stableValue(sample.metadata?.finishType)].join("|");
        if (sampleContext !== context) {
            return createRejected(key, DECISION_GROUP_REJECTION_REASONS.INCONSISTENT_DECISION_CONTEXT);
        }
        const placementKey = getCanonicalPlacementKey(sample);
        if (!placementKey || placements.has(placementKey)) {
            return createRejected(key, DECISION_GROUP_REJECTION_REASONS.DUPLICATE_CANDIDATE_PLACEMENT);
        }
        placements.add(placementKey);
        if (typeof sample.selectedBySource !== "boolean") {
            return createRejected(key, DECISION_GROUP_REJECTION_REASONS.INVALID_SELECTED_FLAG);
        }
        if (sample.selectedBySource === true) selectedCount += 1;
        const features = extractPlacementFeatures(sample);
        if (!features.ok || !features.values.every(Number.isFinite)) {
            return createRejected(key, DECISION_GROUP_REJECTION_REASONS.INVALID_FEATURE_VECTOR);
        }
    }
    if (selectedCount === 0) return createRejected(key, DECISION_GROUP_REJECTION_REASONS.SELECTED_CANDIDATE_MISSING);
    if (selectedCount > 1) return createRejected(key, DECISION_GROUP_REJECTION_REASONS.MULTIPLE_SELECTED_CANDIDATES);
    return null;
}

/** Candidate rows를 결정 단위로 검증·정렬해 묶는다. */
export function groupPlacementDecisions(samples) {
    const buckets = new Map();
    const rejected = [];
    (Array.isArray(samples) ? samples : []).forEach(sample => {
        const key = createDecisionKey(sample);
        if (!key) {
            rejected.push(createRejected(null, DECISION_GROUP_REJECTION_REASONS.INVALID_DECISION_GROUP));
            return;
        }
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(sample);
    });
    const groups = [];
    [...buckets.keys()].sort(compareCanonicalStrings).forEach(key => {
        const candidates = buckets.get(key).slice().sort((left, right) => {
            return compareCanonicalStrings(getCanonicalPlacementKey(left), getCanonicalPlacementKey(right));
        });
        const failure = validateGroup(key, candidates);
        if (failure) rejected.push(failure);
        else groups.push({ decisionKey: key, candidates });
    });
    return { groups, rejected };
}
