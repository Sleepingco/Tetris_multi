import { PLACEMENT_DATASET_SCHEMA_VERSION } from "../dataset/placementDatasetBuilder.ts";
import { compareCanonicalStrings, getCanonicalPlacementKey } from "../dataset/placementDecisionGroups.ts";
import {
    extractPlacementFeatures,
    PLACEMENT_FEATURE_NAMES,
    PLACEMENT_FEATURE_SCHEMA_VERSION,
} from "../dataset/placementFeatureSchema.ts";
import type { PlacementDatasetSample } from "../dataset/placementDatasetBuilder.ts";
import type { PlacementDecisionGroup } from "../dataset/placementDecisionGroups.ts";
import type { PlacementScorer } from "../dataset/placementRankingEvaluator.ts";

export type FeatureScaler = { mean: number[]; scale: number[] };
export type PairwiseTrainingConfig = {
    epochs: number;
    learningRate: number;
    l2: number;
    seed: string;
};
export type PairwiseLinearModel = {
    modelSchemaVersion: 1;
    modelType: "pairwise_linear_ranker";
    datasetSchemaVersion: 2;
    featureSchemaVersion: 1;
    featureNames: string[];
    weights: number[];
    scaler: FeatureScaler;
    trainingConfig: Omit<PairwiseTrainingConfig, "seed">;
    trainingSeed: string;
};
type PairwiseTrainingPair = {
    decisionKey: string;
    featureDifference: number[];
    weight: number;
};
type FailureResult = { ok: false; reason: string };
type ValidationResult = { ok: true; reason: null } | FailureResult;

export const PAIRWISE_LINEAR_MODEL_SCHEMA_VERSION = 1;
export const PAIRWISE_LINEAR_MODEL_TYPE = "pairwise_linear_ranker";

export const DEFAULT_PAIRWISE_TRAINING_CONFIG = Object.freeze({
    epochs: 500,
    learningRate: 0.05,
    l2: 0.01,
    seed: "placement-pairwise-v1",
});

export const PAIRWISE_RANKER_REASONS = Object.freeze({
    INVALID_TRAINING_GROUPS: "INVALID_TRAINING_GROUPS",
    INVALID_TRAINING_CONFIG: "INVALID_TRAINING_CONFIG",
    INVALID_DECISION_GROUP: "INVALID_DECISION_GROUP",
    SELECTED_CANDIDATE_MISSING: "SELECTED_CANDIDATE_MISSING",
    MULTIPLE_SELECTED_CANDIDATES: "MULTIPLE_SELECTED_CANDIDATES",
    INVALID_FEATURE_VECTOR: "INVALID_FEATURE_VECTOR",
    INVALID_SCALER: "INVALID_SCALER",
    NON_FINITE_TRAINING_STATE: "NON_FINITE_TRAINING_STATE",
    INVALID_MODEL: "INVALID_MODEL",
    MODEL_SCHEMA_VERSION_MISMATCH: "MODEL_SCHEMA_VERSION_MISMATCH",
    MODEL_TYPE_MISMATCH: "MODEL_TYPE_MISMATCH",
    DATASET_SCHEMA_VERSION_MISMATCH: "DATASET_SCHEMA_VERSION_MISMATCH",
    FEATURE_SCHEMA_VERSION_MISMATCH: "FEATURE_SCHEMA_VERSION_MISMATCH",
    FEATURE_NAMES_MISMATCH: "FEATURE_NAMES_MISMATCH",
    MODEL_VECTOR_LENGTH_MISMATCH: "MODEL_VECTOR_LENGTH_MISMATCH",
    NON_FINITE_MODEL_VALUE: "NON_FINITE_MODEL_VALUE",
    INVALID_MODEL_SCALE: "INVALID_MODEL_SCALE",
});

function createFailure(reason: string): FailureResult {
    return { ok: false, reason };
}

function canonicalizeGroups(groups: PlacementDecisionGroup[]): PlacementDecisionGroup[] | null {
    if (!Array.isArray(groups) || groups.length === 0) return null;
    return groups.map(group => ({
        decisionKey: group.decisionKey,
        candidates: group.candidates.slice().sort((left, right) => {
            return compareCanonicalStrings(getCanonicalPlacementKey(left), getCanonicalPlacementKey(right));
        }),
    })).sort((left, right) => compareCanonicalStrings(left.decisionKey, right.decisionKey));
}

function validateGroup(group: PlacementDecisionGroup): string | null {
    if (typeof group.decisionKey !== "string" || !Array.isArray(group.candidates) || group.candidates.length < 2) {
        return PAIRWISE_RANKER_REASONS.INVALID_DECISION_GROUP;
    }
    const selectedCount = group.candidates.filter(candidate => candidate?.selectedBySource === true).length;
    if (selectedCount === 0) return PAIRWISE_RANKER_REASONS.SELECTED_CANDIDATE_MISSING;
    if (selectedCount > 1) return PAIRWISE_RANKER_REASONS.MULTIPLE_SELECTED_CANDIDATES;
    return null;
}

function extractCandidateFeatures(candidate: PlacementDatasetSample): number[] | null {
    const result = extractPlacementFeatures(candidate);
    if (!result.ok || result.values.length !== PLACEMENT_FEATURE_NAMES.length ||
        !result.values.every(Number.isFinite)) return null;
    return result.values;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function validateScaler(scaler: unknown): scaler is FeatureScaler {
    const size = PLACEMENT_FEATURE_NAMES.length;
    return isRecord(scaler) && Array.isArray(scaler.mean) && Array.isArray(scaler.scale) &&
        scaler.mean.length === size && scaler.scale.length === size &&
        scaler.mean.every(isFiniteNumber) &&
        scaler.scale.every(value => isFiniteNumber(value) && value > 0);
}

function standardize(values: number[], scaler: FeatureScaler): number[] | null {
    const result = values.map((value, index) => (value - scaler.mean[index]) / scaler.scale[index]);
    return result.every(Number.isFinite) ? result : null;
}

function normalizeTrainingConfig(
    config: Partial<PairwiseTrainingConfig> = {},
): PairwiseTrainingConfig | null {
    const normalized = { ...DEFAULT_PAIRWISE_TRAINING_CONFIG, ...config };
    if (!Number.isInteger(normalized.epochs) || normalized.epochs <= 0 ||
        !Number.isFinite(normalized.learningRate) || normalized.learningRate <= 0 ||
        !Number.isFinite(normalized.l2) || normalized.l2 < 0 ||
        typeof normalized.seed !== "string" || normalized.seed.length === 0) return null;
    return {
        epochs: normalized.epochs,
        learningRate: normalized.learningRate,
        l2: normalized.l2,
        seed: normalized.seed,
    };
}

/** Train candidate만 사용해 feature별 population mean/scale을 계산한다. */
export function fitPlacementFeatureScaler(groups: PlacementDecisionGroup[]):
    { ok: true; reason: null; scaler: FeatureScaler; candidateCount: number } | FailureResult {
    const canonicalGroups = canonicalizeGroups(groups);
    if (!canonicalGroups) return createFailure(PAIRWISE_RANKER_REASONS.INVALID_TRAINING_GROUPS);
    const vectors: number[][] = [];
    for (const group of canonicalGroups) {
        const groupFailure = validateGroup(group);
        if (groupFailure) return createFailure(groupFailure);
        for (const candidate of group.candidates) {
            const values = extractCandidateFeatures(candidate);
            if (!values) return createFailure(PAIRWISE_RANKER_REASONS.INVALID_FEATURE_VECTOR);
            vectors.push(values);
        }
    }
    const mean = Array(PLACEMENT_FEATURE_NAMES.length).fill(0);
    for (const values of vectors) {
        for (let index = 0; index < mean.length; index++) mean[index] += values[index];
    }
    for (let index = 0; index < mean.length; index++) mean[index] /= vectors.length;
    const variance = Array(mean.length).fill(0);
    for (const values of vectors) {
        for (let index = 0; index < variance.length; index++) {
            const delta = values[index] - mean[index];
            variance[index] += delta * delta;
        }
    }
    const scale = variance.map(value => {
        const normalizedVariance = value / vectors.length;
        return normalizedVariance === 0 ? 1 : Math.sqrt(normalizedVariance);
    });
    if (!mean.every(Number.isFinite) || !scale.every(value => Number.isFinite(value) && value > 0)) {
        return createFailure(PAIRWISE_RANKER_REASONS.NON_FINITE_TRAINING_STATE);
    }
    return { ok: true, reason: null, scaler: { mean, scale }, candidateCount: vectors.length };
}

/** 각 decision에서 selected-unselected pair를 만들고 decision별 pair weight 합을 1로 맞춘다. */
export function createPairwiseTrainingPairs(
    groups: PlacementDecisionGroup[],
    scaler: unknown,
): {
    ok: true;
    reason: null;
    pairs: PairwiseTrainingPair[];
    decisionCount: number;
    candidateCount: number;
    pairCount: number;
    zeroDifferencePairCount: number;
    zeroDifferenceDecisionCount: number;
    selectedFeatureDuplicateDecisionCount: number;
} | FailureResult {
    const canonicalGroups = canonicalizeGroups(groups);
    if (!canonicalGroups) return createFailure(PAIRWISE_RANKER_REASONS.INVALID_TRAINING_GROUPS);
    if (!validateScaler(scaler)) return createFailure(PAIRWISE_RANKER_REASONS.INVALID_SCALER);
    const pairs: PairwiseTrainingPair[] = [];
    let candidateCount = 0;
    let selectedFeatureDuplicateDecisionCount = 0;
    let zeroDifferencePairCount = 0;
    for (const group of canonicalGroups) {
        const groupFailure = validateGroup(group);
        if (groupFailure) return createFailure(groupFailure);
        const selected = group.candidates.find(candidate => candidate.selectedBySource === true);
        if (!selected) return createFailure(PAIRWISE_RANKER_REASONS.SELECTED_CANDIDATE_MISSING);
        const selectedValues = extractCandidateFeatures(selected);
        const selectedFeatures = selectedValues && standardize(selectedValues, scaler);
        if (!selectedFeatures) return createFailure(PAIRWISE_RANKER_REASONS.INVALID_FEATURE_VECTOR);
        const unselected = group.candidates.filter(candidate => candidate !== selected);
        const pairWeight = 1 / unselected.length;
        let hasSelectedFeatureDuplicate = false;
        candidateCount += group.candidates.length;
        for (const candidate of unselected) {
            const candidateValues = extractCandidateFeatures(candidate);
            const candidateFeatures = candidateValues && standardize(candidateValues, scaler);
            if (!candidateFeatures) return createFailure(PAIRWISE_RANKER_REASONS.INVALID_FEATURE_VECTOR);
            const featureDifference = selectedFeatures.map((value, index) => value - candidateFeatures[index]);
            if (!featureDifference.every(Number.isFinite) || !Number.isFinite(pairWeight)) {
                return createFailure(PAIRWISE_RANKER_REASONS.NON_FINITE_TRAINING_STATE);
            }
            if (featureDifference.every(value => value === 0)) {
                zeroDifferencePairCount += 1;
                hasSelectedFeatureDuplicate = true;
            }
            pairs.push({ decisionKey: group.decisionKey, featureDifference, weight: pairWeight });
        }
        if (hasSelectedFeatureDuplicate) selectedFeatureDuplicateDecisionCount += 1;
    }
    return {
        ok: true,
        reason: null,
        pairs,
        decisionCount: canonicalGroups.length,
        candidateCount,
        pairCount: pairs.length,
        zeroDifferencePairCount,
        zeroDifferenceDecisionCount: selectedFeatureDuplicateDecisionCount,
        selectedFeatureDuplicateDecisionCount,
    };
}

function softplus(value: number): number {
    return value > 0
        ? value + Math.log1p(Math.exp(-value))
        : Math.log1p(Math.exp(value));
}

function sigmoidNegativeMargin(margin: number): number {
    if (margin >= 0) {
        const value = Math.exp(-margin);
        return value / (1 + value);
    }
    return 1 / (1 + Math.exp(margin));
}

function calculateTrainingState(
    pairs: PairwiseTrainingPair[],
    weights: number[],
    decisionCount: number,
    l2: number,
): { loss: number; gradient: number[] } | null {
    const gradient = Array(weights.length).fill(0);
    let loss = 0;
    for (const pair of pairs) {
        let margin = 0;
        for (let index = 0; index < weights.length; index++) {
            margin += weights[index] * pair.featureDifference[index];
        }
        loss += pair.weight * softplus(-margin);
        const factor = -pair.weight * sigmoidNegativeMargin(margin);
        for (let index = 0; index < gradient.length; index++) {
            gradient[index] += factor * pair.featureDifference[index];
        }
    }
    loss /= decisionCount;
    for (let index = 0; index < weights.length; index++) {
        loss += 0.5 * l2 * weights[index] * weights[index];
        gradient[index] = gradient[index] / decisionCount + l2 * weights[index];
    }
    if (!Number.isFinite(loss) || !gradient.every(Number.isFinite)) return null;
    return { loss, gradient };
}

/** 결정론적 full-batch gradient descent로 pairwise logistic linear ranker를 학습한다. */
export function trainPairwiseLinearRanker(
    groups: PlacementDecisionGroup[],
    config: Partial<PairwiseTrainingConfig> = {},
) {
    const trainingConfig = normalizeTrainingConfig(config);
    if (!trainingConfig) return { ...createFailure(PAIRWISE_RANKER_REASONS.INVALID_TRAINING_CONFIG), model: null, trainingSummary: null };
    const scalerResult = fitPlacementFeatureScaler(groups);
    if (!scalerResult.ok) return { ...scalerResult, model: null, trainingSummary: null };
    const pairResult = createPairwiseTrainingPairs(groups, scalerResult.scaler);
    if (!pairResult.ok) return { ...pairResult, model: null, trainingSummary: null };
    const weights: number[] = Array(PLACEMENT_FEATURE_NAMES.length).fill(0);
    const initialState = calculateTrainingState(pairResult.pairs, weights, pairResult.decisionCount, trainingConfig.l2);
    if (!initialState) return { ...createFailure(PAIRWISE_RANKER_REASONS.NON_FINITE_TRAINING_STATE), model: null, trainingSummary: null };
    for (let epoch = 0; epoch < trainingConfig.epochs; epoch++) {
        const state = calculateTrainingState(pairResult.pairs, weights, pairResult.decisionCount, trainingConfig.l2);
        if (!state) return { ...createFailure(PAIRWISE_RANKER_REASONS.NON_FINITE_TRAINING_STATE), model: null, trainingSummary: null };
        for (let index = 0; index < weights.length; index++) {
            weights[index] -= trainingConfig.learningRate * state.gradient[index];
        }
        if (!weights.every(Number.isFinite)) {
            return { ...createFailure(PAIRWISE_RANKER_REASONS.NON_FINITE_TRAINING_STATE), model: null, trainingSummary: null };
        }
    }
    const finalState = calculateTrainingState(pairResult.pairs, weights, pairResult.decisionCount, trainingConfig.l2);
    if (!finalState) return { ...createFailure(PAIRWISE_RANKER_REASONS.NON_FINITE_TRAINING_STATE), model: null, trainingSummary: null };
    const model: PairwiseLinearModel = {
        modelSchemaVersion: PAIRWISE_LINEAR_MODEL_SCHEMA_VERSION,
        modelType: PAIRWISE_LINEAR_MODEL_TYPE,
        datasetSchemaVersion: PLACEMENT_DATASET_SCHEMA_VERSION,
        featureSchemaVersion: PLACEMENT_FEATURE_SCHEMA_VERSION,
        featureNames: [...PLACEMENT_FEATURE_NAMES],
        weights: [...weights],
        scaler: {
            mean: [...scalerResult.scaler.mean],
            scale: [...scalerResult.scaler.scale],
        },
        trainingConfig: {
            epochs: trainingConfig.epochs,
            learningRate: trainingConfig.learningRate,
            l2: trainingConfig.l2,
        },
        trainingSeed: trainingConfig.seed,
    };
    return {
        ok: true,
        reason: null,
        model,
        trainingSummary: {
            decisionCount: pairResult.decisionCount,
            candidateCount: pairResult.candidateCount,
            pairCount: pairResult.pairCount,
            zeroDifferencePairCount: pairResult.zeroDifferencePairCount,
            zeroDifferenceDecisionCount: pairResult.zeroDifferenceDecisionCount,
            selectedFeatureDuplicateDecisionCount: pairResult.selectedFeatureDuplicateDecisionCount,
            initialLoss: initialState.loss,
            finalLoss: finalState.loss,
            epochCount: trainingConfig.epochs,
            status: "completed",
        },
    };
}

export function validatePairwiseLinearModel(model: unknown): ValidationResult {
    if (!isRecord(model)) return createFailure(PAIRWISE_RANKER_REASONS.INVALID_MODEL);
    if (model.modelSchemaVersion !== PAIRWISE_LINEAR_MODEL_SCHEMA_VERSION) return createFailure(PAIRWISE_RANKER_REASONS.MODEL_SCHEMA_VERSION_MISMATCH);
    if (model.modelType !== PAIRWISE_LINEAR_MODEL_TYPE) return createFailure(PAIRWISE_RANKER_REASONS.MODEL_TYPE_MISMATCH);
    if (model.datasetSchemaVersion !== PLACEMENT_DATASET_SCHEMA_VERSION) return createFailure(PAIRWISE_RANKER_REASONS.DATASET_SCHEMA_VERSION_MISMATCH);
    if (model.featureSchemaVersion !== PLACEMENT_FEATURE_SCHEMA_VERSION) return createFailure(PAIRWISE_RANKER_REASONS.FEATURE_SCHEMA_VERSION_MISMATCH);
    if (!Array.isArray(model.featureNames) || model.featureNames.length !== PLACEMENT_FEATURE_NAMES.length ||
        model.featureNames.some((name, index) => name !== PLACEMENT_FEATURE_NAMES[index])) {
        return createFailure(PAIRWISE_RANKER_REASONS.FEATURE_NAMES_MISMATCH);
    }
    if (!isRecord(model.scaler) || !Array.isArray(model.weights) ||
        !Array.isArray(model.scaler.mean) || !Array.isArray(model.scaler.scale) ||
        model.weights.length !== PLACEMENT_FEATURE_NAMES.length ||
        model.scaler.mean.length !== PLACEMENT_FEATURE_NAMES.length ||
        model.scaler.scale.length !== PLACEMENT_FEATURE_NAMES.length) {
        return createFailure(PAIRWISE_RANKER_REASONS.MODEL_VECTOR_LENGTH_MISMATCH);
    }
    if (!model.weights.every(isFiniteNumber) || !model.scaler.mean.every(isFiniteNumber) ||
        !model.scaler.scale.every(isFiniteNumber)) return createFailure(PAIRWISE_RANKER_REASONS.NON_FINITE_MODEL_VALUE);
    if (!model.scaler.scale.every(value => isFiniteNumber(value) && value > 0)) return createFailure(PAIRWISE_RANKER_REASONS.INVALID_MODEL_SCALE);
    return { ok: true, reason: null };
}

/** 검증된 model로 기존 ranking evaluator와 호환되는 candidate score Map scorer를 만든다. */
export function createPairwiseLinearScorer(model: PairwiseLinearModel): PlacementScorer {
    const validation = validatePairwiseLinearModel(model);
    if (!validation.ok) throw new Error(`${PAIRWISE_RANKER_REASONS.INVALID_MODEL}:${validation.reason}`);
    return group => {
        const scores = new Map<PlacementDatasetSample, number>();
        for (const candidate of group.candidates) {
            const values = extractCandidateFeatures(candidate);
            const features = values && standardize(values, model.scaler);
            if (!features) throw new Error(PAIRWISE_RANKER_REASONS.INVALID_FEATURE_VECTOR);
            let score = 0;
            for (let index = 0; index < features.length; index++) score += model.weights[index] * features[index];
            if (!Number.isFinite(score)) throw new Error(PAIRWISE_RANKER_REASONS.NON_FINITE_MODEL_VALUE);
            scores.set(candidate, score);
        }
        return scores;
    };
}
