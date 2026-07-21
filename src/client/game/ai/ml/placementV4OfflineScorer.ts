import { compareCanonicalStrings, getCanonicalPlacementKey } from "../dataset/placementDecisionGroups.ts";
import { extractPlacementFeatures, PLACEMENT_FEATURE_NAMES } from "../dataset/placementFeatureSchema.ts";
import { validatePairwiseLinearModel } from "./placementPairwiseRanker.ts";
import type { PlacementMetricDelta } from "../dataset/placementDatasetBuilder.ts";
import type { Placement, PlacementCell } from "../heuristic/placementGenerator.ts";
import type { PairwiseLinearModel } from "./placementPairwiseRanker.ts";

export type PlacementV4Model = PairwiseLinearModel & {
    canonicalArtifact: false;
    productionIntegration: false;
    representation: {
        name: "V4";
        unit: "occupied-cell physical class";
        selectedClassAliasesExcluded: true;
    };
    coefficients: number[];
};
export type PlacementV4Candidate = {
    candidatePlacement: Placement;
    candidateResult: { linesCleared: number; gameOver: boolean };
    metricDelta: Omit<PlacementMetricDelta, "completeLines">;
};
export type PlacementV4ClassResult = {
    aliasCount: number;
    classKey: string;
    gameOver: boolean;
    linearScore: number;
    representativeKey: string;
    excludedByGameOverSafety: boolean;
    finalRank: number | null;
};
export type PlacementV4Ranking = {
    ok: true;
    reason: null;
    candidateCount: number;
    classes: PlacementV4ClassResult[];
    filteredGameOverClassCount: number;
    physicalClassCount: number;
    safeClassAvailable: boolean;
    selectedClassKey: string;
    selectedRepresentativeKey: string;
    unavoidableGameOver: boolean;
} | { ok: false; reason: string };

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

function createFailure(reason: string): { ok: false; reason: string } {
    return { ok: false, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

export function validatePlacementV4Model(model: unknown): { ok: true; reason: null } |
    { ok: false; reason: string } {
    const base = validatePairwiseLinearModel(model);
    if (!base.ok) return base;
    if (!isRecord(model)) return createFailure(PLACEMENT_V4_INFERENCE_REASONS.V4_REPRESENTATION_CONTRACT_MISMATCH);
    if (model.canonicalArtifact !== false) {
        return createFailure(PLACEMENT_V4_INFERENCE_REASONS.CANONICAL_ARTIFACT_MUST_BE_FALSE);
    }
    if (model.productionIntegration !== false) {
        return createFailure(PLACEMENT_V4_INFERENCE_REASONS.PRODUCTION_INTEGRATION_MUST_BE_FALSE);
    }
    if (!isRecord(model.representation) || model.representation.name !== "V4" ||
        model.representation.unit !== "occupied-cell physical class" ||
        model.representation.selectedClassAliasesExcluded !== true) {
        return createFailure(PLACEMENT_V4_INFERENCE_REASONS.V4_REPRESENTATION_CONTRACT_MISMATCH);
    }
    if (!Array.isArray(model.coefficients) ||
        model.coefficients.length !== PLACEMENT_FEATURE_NAMES.length ||
        !model.coefficients.every(isFiniteNumber)) {
        return createFailure(PLACEMENT_V4_INFERENCE_REASONS.INVALID_COEFFICIENTS);
    }
    const weights = model.weights;
    if (!Array.isArray(weights) ||
        model.coefficients.some((value, index) => value !== weights[index])) {
        return createFailure(PLACEMENT_V4_INFERENCE_REASONS.COEFFICIENT_WEIGHT_MISMATCH);
    }
    return { ok: true, reason: null };
}

function getPhysicalClassKey(candidate: PlacementV4Candidate): { ok: true; value: string } |
    { ok: false; reason: string } {
    const placement = candidate.candidatePlacement;
    if (!placement || typeof placement.pieceType !== "string" || placement.pieceType.length === 0 ||
        !Number.isInteger(placement.rotation) || !Number.isInteger(placement.row) ||
        !Number.isInteger(placement.col) || !Array.isArray(placement.cells) || placement.cells.length === 0) {
        return createFailure(PLACEMENT_V4_INFERENCE_REASONS.INVALID_CANDIDATE);
    }
    const cells: PlacementCell[] = [];
    const occupied = new Set<string>();
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

type ValidatedV4Candidate = {
    candidate: PlacementV4Candidate;
    classKey: string;
    features: number[];
    gameOver: boolean;
    linesCleared: number;
    placementKey: string;
};

function validateCandidate(candidate: PlacementV4Candidate): { ok: true; value: ValidatedV4Candidate } |
    { ok: false; reason: string } {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) ||
        !candidate.candidateResult || typeof candidate.candidateResult.linesCleared !== "number" ||
        !Number.isInteger(candidate.candidateResult.linesCleared) ||
        typeof candidate.candidateResult.gameOver !== "boolean") {
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

function sameValues(left: number[], right: number[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function scoreFeatures(features: number[], model: PlacementV4Model): number {
    let score = 0;
    for (let index = 0; index < features.length; index++) {
        score += model.coefficients[index] *
            ((features[index] - model.scaler.mean[index]) / model.scaler.scale[index]);
    }
    return score;
}

/** Parse된 V4 model과 candidate만 읽어 physical-class ranking을 반환한다. */
export function rankPlacementV4Candidates(
    model: PlacementV4Model,
    candidates: PlacementV4Candidate[],
): PlacementV4Ranking {
    const modelValidation = validatePlacementV4Model(model);
    if (!modelValidation.ok) return modelValidation;
    if (!Array.isArray(candidates) || candidates.length === 0) {
        return createFailure(PLACEMENT_V4_INFERENCE_REASONS.EMPTY_CANDIDATES);
    }
    const validated: ValidatedV4Candidate[] = [];
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

    const groups = new Map<string, ValidatedV4Candidate[]>();
    for (const candidate of validated) {
        const group = groups.get(candidate.classKey);
        if (group) group.push(candidate);
        else groups.set(candidate.classKey, [candidate]);
    }
    const classes: Array<Omit<PlacementV4ClassResult, "excludedByGameOverSafety" | "finalRank">> = [];
    for (const classKey of [...groups.keys()].sort(compareCanonicalStrings)) {
        const group = groups.get(classKey);
        if (!group) continue;
        const members = group.slice().sort((left, right) => {
            return compareCanonicalStrings(left.placementKey, right.placementKey);
        });
        const representative = members[0];
        if (!representative) continue;
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
