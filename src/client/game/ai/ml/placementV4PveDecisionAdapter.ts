import { getCanonicalPlacementKey } from "../dataset/placementDecisionGroups.ts";
import { rankPlacements } from "../heuristic/heuristicEvaluator.ts";
import { rankPlacementV4Candidates } from "./placementV4OfflineScorer.ts";
import type { Board } from "../../core/board.ts";
import type { BoardMetrics } from "../../core/boardMetrics.ts";
import type {
    RankedHeuristicEvaluation,
    HeuristicDecision,
} from "../heuristic/heuristicEvaluator.ts";
import type { Placement } from "../heuristic/placementGenerator.ts";
import type {
    PlacementV4Candidate,
    PlacementV4Model,
    PlacementV4Ranking,
} from "./placementV4OfflineScorer.ts";

export type PlacementV4PveDecision = HeuristicDecision | {
    ok: true;
    source: "heuristic_ai" | "ml_ai";
    modelType: "heuristic" | "pairwise_linear_ranker";
    selectedPlacement: Placement;
    plannedActions: RankedHeuristicEvaluation["plannedActions"];
    score: number;
    candidateCount: number;
    metricsBefore: BoardMetrics;
    metricsAfter: BoardMetrics;
    reason: RankedHeuristicEvaluation["reason"];
    selectedClassKey?: string;
    selectedRepresentativeKey?: string;
    physicalClassCount?: number;
    unavoidableGameOver?: boolean;
    policyRequested: "placement_v4";
    policyUsed: "heuristic" | "placement_v4";
    fallbackReason: string | null;
};
type PlacementV4Dependencies = {
    rankPlacements?: (board: Board, activePiece: unknown) => RankedHeuristicEvaluation[];
    rankPlacementV4Candidates?: (
        model: PlacementV4Model,
        candidates: PlacementV4Candidate[],
    ) => PlacementV4Ranking;
};

function clonePlacement(placement: Placement): Placement {
    return {
        ...placement,
        cells: placement.cells.map(cell => ({ ...cell })),
    };
}

function createNoPlacementFailure(): PlacementV4PveDecision {
    return {
        ok: false,
        source: "heuristic_ai",
        modelType: "heuristic",
        errorCode: "NO_LEGAL_PLACEMENT",
        message: "No legal placement is available for the active piece.",
        candidateCount: 0,
    };
}

function createHeuristicFallback(
    evaluation: RankedHeuristicEvaluation,
    candidateCount: number,
    fallbackReason: string,
): PlacementV4PveDecision {
    return {
        ok: true,
        source: "heuristic_ai",
        modelType: "heuristic",
        selectedPlacement: clonePlacement(evaluation.placement),
        plannedActions: [...evaluation.plannedActions],
        score: evaluation.score,
        candidateCount,
        metricsBefore: evaluation.metricsBefore,
        metricsAfter: evaluation.metricsAfter,
        reason: evaluation.reason,
        policyRequested: "placement_v4",
        policyUsed: "heuristic",
        fallbackReason,
    };
}

function subtractMetrics(before: BoardMetrics, after: BoardMetrics): PlacementV4Candidate["metricDelta"] {
    const columnHeights = after.columnHeights;
    if (!Array.isArray(before.columnHeights) || !Array.isArray(columnHeights) ||
        before.columnHeights.length !== columnHeights.length) {
        throw new TypeError("metrics must contain matching columnHeights arrays");
    }
    const delta = {
        aggregateHeight: after.aggregateHeight - before.aggregateHeight,
        maxHeight: after.maxHeight - before.maxHeight,
        holes: after.holes - before.holes,
        bumpiness: after.bumpiness - before.bumpiness,
        columnHeights: columnHeights.map((height, index) => {
            return height - before.columnHeights[index];
        }),
    };
    if (![delta.aggregateHeight, delta.maxHeight, delta.holes, delta.bumpiness,
        ...delta.columnHeights].every(Number.isFinite)) {
        throw new TypeError("metric delta must contain finite numbers");
    }
    return delta;
}

function toV4Candidate(evaluation: RankedHeuristicEvaluation): PlacementV4Candidate {
    return {
        candidatePlacement: clonePlacement(evaluation.placement),
        candidateResult: {
            linesCleared: evaluation.linesCleared,
            gameOver: evaluation.gameOver,
        },
        metricDelta: subtractMetrics(evaluation.metricsBefore, evaluation.metricsAfter),
    };
}

/** 기존 reachable-placement ranking을 한 번만 생성해 V4 또는 같은 ranking의 fallback을 반환한다. */
export function getPlacementV4PveDecision(
    model: PlacementV4Model,
    gameState: { board: Board; activePiece: unknown },
    dependencies: PlacementV4Dependencies = {},
): PlacementV4PveDecision {
    const rankHeuristicPlacements = dependencies.rankPlacements || rankPlacements;
    const rankV4Candidates = dependencies.rankPlacementV4Candidates || rankPlacementV4Candidates;
    const evaluations = rankHeuristicPlacements(gameState.board, gameState.activePiece);
    if (evaluations.length === 0) return createNoPlacementFailure();
    const firstEvaluation = evaluations[0];
    if (!firstEvaluation) return createNoPlacementFailure();

    let candidates: PlacementV4Candidate[];
    try {
        candidates = evaluations.map(toV4Candidate);
    } catch {
        return createHeuristicFallback(
            firstEvaluation,
            evaluations.length,
            "CANDIDATE_ADAPTER_FAILED",
        );
    }

    let ranking: PlacementV4Ranking;
    try {
        ranking = rankV4Candidates(model, candidates);
    } catch (error) {
        const reason = error instanceof Error && error.message ? error.message : "UNEXPECTED_ERROR";
        return createHeuristicFallback(
            firstEvaluation,
            evaluations.length,
            `V4_SCORER_FAILED:${reason}`,
        );
    }
    if (!ranking?.ok) {
        return createHeuristicFallback(
            firstEvaluation,
            evaluations.length,
            `V4_SCORER_FAILED:${ranking?.reason || "UNKNOWN"}`,
        );
    }

    const selectedIndex = candidates.findIndex(candidate => {
        return getCanonicalPlacementKey(candidate) === ranking.selectedRepresentativeKey;
    });
    const selectedClass = ranking.classes?.find(physicalClass => {
        return physicalClass.classKey === ranking.selectedClassKey;
    });
    if (selectedIndex < 0 || !selectedClass) {
        return createHeuristicFallback(
            firstEvaluation,
            evaluations.length,
            "REPRESENTATIVE_NOT_FOUND",
        );
    }

    const selected = evaluations[selectedIndex];
    if (!selected) {
        return createHeuristicFallback(
            firstEvaluation,
            evaluations.length,
            "REPRESENTATIVE_NOT_FOUND",
        );
    }
    return {
        ok: true,
        source: "ml_ai",
        modelType: "pairwise_linear_ranker",
        selectedPlacement: clonePlacement(selected.placement),
        plannedActions: [...selected.plannedActions],
        score: selectedClass.linearScore,
        candidateCount: evaluations.length,
        metricsBefore: selected.metricsBefore,
        metricsAfter: selected.metricsAfter,
        reason: selected.reason,
        selectedClassKey: ranking.selectedClassKey,
        selectedRepresentativeKey: ranking.selectedRepresentativeKey,
        physicalClassCount: ranking.physicalClassCount,
        unavoidableGameOver: ranking.unavoidableGameOver,
        policyRequested: "placement_v4",
        policyUsed: "placement_v4",
        fallbackReason: null,
    };
}
