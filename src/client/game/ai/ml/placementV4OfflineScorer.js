import { compareCanonicalStrings, getCanonicalPlacementKey } from "../dataset/placementDecisionGroups.js";
import { extractPlacementFeatures, PLACEMENT_FEATURE_NAMES } from "../dataset/placementFeatureSchema.js";
import { validatePairwiseLinearModel } from "./placementPairwiseRanker.js";

export const PLACEMENT_V4_INFERENCE_REASONS = Object.freeze({
    CANONICAL_ARTIFACT_MUST_BE_FALSE: "CANONICAL_ARTIFACT_MUST_BE_FALSE",
    PRODUCTION_INTEGRATION_MUST_BE_FALSE: "PRODUCTION_INTEGRATION_MUST_BE_FALSE",
    V4_REPRESENTATION_CONTRACT_MISMATCH: "V4_REPRESENTATION_CONTRACT_MISMATCH",
    INVALID_COEFFICIENTS: "INVALID_COEFFICIENTS",
    COEFFICIENT_WEIGHT_MISMATCH: "COEFFICIENT_WEIGHT_MISMATCH",
    EMPTY_CANDIDATES: "EMPTY_CANDIDATES",
    INVALID_CANDIDATE: "INVALID_CANDIDATE",
    DUPLICATE_OCCUPIED_CELL: "DUPLICATE_OCCUPIED_CELL",
    DUPLICATE_PLACEMENT_KEY: "DUPLICATE_PLACEMENT_KEY",
    CLASS_FEATURE_MISMATCH: "CLASS_FEATURE_MISMATCH",
    CLASS_RESULT_MISMATCH: "CLASS_RESULT_MISMATCH",
    NON_FINITE_SCORE: "NON_FINITE_SCORE",
});

function createFailure(reason) {
    return { ok: false, reason };
}

export function validatePlacementV4Model(model) {
    const base = validatePairwiseLinearModel(model);
    if (!base.ok) return base;
    if (model.canonicalArtifact !== false) {
        return createFailure(PLACEMENT_V4_INFERENCE_REASONS.CANONICAL_ARTIFACT_MUST_BE_FALSE);
    }
    if (model.productionIntegration !== false) {
        return createFailure(PLACEMENT_V4_INFERENCE_REASONS.PRODUCTION_INTEGRATION_MUST_BE_FALSE);
    }
    if (model.representation?.name !== "V4" ||
        model.representation?.unit !== "occupied-cell physical class" ||
        model.representation?.selectedClassAliasesExcluded !== true) {
        return createFailure(PLACEMENT_V4_INFERENCE_REASONS.V4_REPRESENTATION_CONTRACT_MISMATCH);
    }
    if (!Array.isArray(model.coefficients) ||
        model.coefficients.length !== PLACEMENT_FEATURE_NAMES.length ||
        !model.coefficients.every(Number.isFinite)) {
        return createFailure(PLACEMENT_V4_INFERENCE_REASONS.INVALID_COEFFICIENTS);
    }
    if (model.coefficients.some((value, index) => value !== model.weights[index])) {
        return createFailure(PLACEMENT_V4_INFERENCE_REASONS.COEFFICIENT_WEIGHT_MISMATCH);
    }
    return { ok: true, reason: null };
}

function getPhysicalClassKey(candidate) {
    const placement = candidate?.candidatePlacement;
    if (!placement || typeof placement.pieceType !== "string" || placement.pieceType.length === 0 ||
        !Number.isInteger(placement.rotation) || !Number.isInteger(placement.row) ||
        !Number.isInteger(placement.col) || !Array.isArray(placement.cells) || placement.cells.length === 0) {
        return createFailure(PLACEMENT_V4_INFERENCE_REASONS.INVALID_CANDIDATE);
    }
    const cells = [];
    const occupied = new Set();
    for (const cell of placement.cells) {
        if (!Number.isInteger(cell?.row) || !Number.isInteger(cell?.col)) {
            return createFailure(PLACEMENT_V4_INFERENCE_REASONS.INVALID_CANDIDATE);
        }
        const key = `${cell.row},${cell.col}`;
        if (occupied.has(key)) return createFailure(PLACEMENT_V4_INFERENCE_REASONS.DUPLICATE_OCCUPIED_CELL);
        occupied.add(key);
        cells.push({ row: cell.row, col: cell.col });
    }
    cells.sort((left, right) => left.row - right.row || left.col - right.col);
    return {
        ok: true,
        value: `${placement.pieceType}|${cells.map(cell => `${cell.row},${cell.col}`).join(";")}`,
    };
}

function validateCandidate(candidate) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) ||
        !Number.isInteger(candidate.candidateResult?.linesCleared) ||
        typeof candidate.candidateResult?.gameOver !== "boolean") {
        return createFailure(PLACEMENT_V4_INFERENCE_REASONS.INVALID_CANDIDATE);
    }
    const placementKey = getCanonicalPlacementKey(candidate);
    const classKey = getPhysicalClassKey(candidate);
    if (!placementKey || !classKey.ok) return classKey.ok ? createFailure(PLACEMENT_V4_INFERENCE_REASONS.INVALID_CANDIDATE) : classKey;
    const features = extractPlacementFeatures({ ...candidate, datasetSchemaVersion: 2 });
    if (!features.ok || !features.values.every(Number.isFinite)) {
        return createFailure(PLACEMENT_V4_INFERENCE_REASONS.INVALID_CANDIDATE);
    }
    return {
        ok: true,
        value: {
            candidate,
            classKey: classKey.value,
            features: features.values,
            gameOver: candidate.candidateResult.gameOver,
            linesCleared: candidate.candidateResult.linesCleared,
            placementKey,
        },
    };
}

function sameValues(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function scoreFeatures(features, model) {
    let score = 0;
    for (let index = 0; index < features.length; index++) {
        score += model.coefficients[index] *
            ((features[index] - model.scaler.mean[index]) / model.scaler.scale[index]);
    }
    return score;
}

/** Parse된 V4 model과 candidate만 읽어 physical-class ranking을 반환한다. */
export function rankPlacementV4Candidates(model, candidates) {
    const modelValidation = validatePlacementV4Model(model);
    if (!modelValidation.ok) return modelValidation;
    if (!Array.isArray(candidates) || candidates.length === 0) {
        return createFailure(PLACEMENT_V4_INFERENCE_REASONS.EMPTY_CANDIDATES);
    }
    const validated = [];
    const placementKeys = new Set();
    for (const candidate of candidates) {
        const validation = validateCandidate(candidate);
        if (!validation.ok) return validation;
        if (placementKeys.has(validation.value.placementKey)) {
            return createFailure(PLACEMENT_V4_INFERENCE_REASONS.DUPLICATE_PLACEMENT_KEY);
        }
        placementKeys.add(validation.value.placementKey);
        validated.push(validation.value);
    }

    const groups = new Map();
    for (const candidate of validated) {
        if (!groups.has(candidate.classKey)) groups.set(candidate.classKey, []);
        groups.get(candidate.classKey).push(candidate);
    }
    const classes = [];
    for (const classKey of [...groups.keys()].sort(compareCanonicalStrings)) {
        const members = groups.get(classKey).slice().sort((left, right) => {
            return compareCanonicalStrings(left.placementKey, right.placementKey);
        });
        const representative = members[0];
        if (members.some(member => !sameValues(member.features, representative.features))) {
            return createFailure(PLACEMENT_V4_INFERENCE_REASONS.CLASS_FEATURE_MISMATCH);
        }
        if (members.some(member => member.linesCleared !== representative.linesCleared ||
            member.gameOver !== representative.gameOver)) {
            return createFailure(PLACEMENT_V4_INFERENCE_REASONS.CLASS_RESULT_MISMATCH);
        }
        const linearScore = scoreFeatures(representative.features, model);
        if (!Number.isFinite(linearScore)) return createFailure(PLACEMENT_V4_INFERENCE_REASONS.NON_FINITE_SCORE);
        classes.push({
            aliasCount: members.length,
            classKey,
            gameOver: representative.gameOver,
            linearScore,
            representativeKey: representative.placementKey,
        });
    }

    const safeClassAvailable = classes.some(physicalClass => !physicalClass.gameOver);
    const eligible = safeClassAvailable
        ? classes.filter(physicalClass => !physicalClass.gameOver)
        : classes;
    const ranked = eligible.slice().sort((left, right) => {
        const scoreDifference = right.linearScore - left.linearScore;
        return scoreDifference || compareCanonicalStrings(left.classKey, right.classKey);
    });
    const ranks = new Map(ranked.map((physicalClass, index) => [physicalClass.classKey, index + 1]));
    const classResults = classes.map(physicalClass => ({
        ...physicalClass,
        excludedByGameOverSafety: !ranks.has(physicalClass.classKey),
        finalRank: ranks.get(physicalClass.classKey) ?? null,
    }));
    return {
        ok: true,
        reason: null,
        candidateCount: validated.length,
        classes: classResults,
        filteredGameOverClassCount: classes.length - eligible.length,
        physicalClassCount: classes.length,
        safeClassAvailable,
        selectedClassKey: ranked[0].classKey,
        selectedRepresentativeKey: ranked[0].representativeKey,
        unavoidableGameOver: !safeClassAvailable,
    };
}
