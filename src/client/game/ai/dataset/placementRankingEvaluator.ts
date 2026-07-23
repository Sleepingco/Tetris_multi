import { compareCanonicalStrings, getCanonicalPlacementKey } from "./placementDecisionGroups.ts";
import { compareHeuristicEvaluations } from "../heuristic/heuristicEvaluator.ts";
import type { PlacementDatasetSample } from "./placementDatasetBuilder.ts";
import type { PlacementDecisionGroup } from "./placementDecisionGroups.ts";

/**
 * 모델이 실제 선택 후보를 몇 번째로 두는지 측정한다.
 *
 * Top-1/Top-3/MRR은 "사람의 선택을 얼마나 잘 재현했는가"를 뜻한다. 생존 길이, 공격량,
 * 승률 같은 gameplay 성능은 별도 benchmark로 검증해야 하며 이 지표로 대신할 수 없다.
 */

type RankingEntry = {
    rank: number;
    candidateCount: number;
    gameId: string;
    aiDifficulty: string;
    outcome: "winner" | "loser";
    topScoreTie: boolean;
    tieAwareTop1: boolean;
};
type RankingSummary = {
    decisionCount: number;
    gameCount: number;
    top1Accuracy: number;
    tieAwareTop1Accuracy: number;
    topScoreTieDecisionCount: number;
    top3Accuracy: number;
    mrr: number;
    meanSelectedRank: number;
    candidateCount: { mean: number; min: number; max: number };
};
export type RankingMetrics = RankingSummary & {
    byGameId: Record<string, RankingSummary>;
    byAiDifficulty: Record<string, RankingSummary>;
    byOutcome: Record<string, RankingSummary>;
};
type RankingError = {
    reason: string;
    decisionKey: string;
    placementKey?: string | null;
    message?: string;
};
type CandidateComparator = (
    left: PlacementDatasetSample,
    right: PlacementDatasetSample,
) => number;
type PlacementScoreResult = Map<PlacementDatasetSample, number> | {
    scores: Map<PlacementDatasetSample, number>;
    compareCandidates?: CandidateComparator;
};
export type PlacementScorer = (group: PlacementDecisionGroup) => PlacementScoreResult;

export const RANKING_EVALUATION_SCHEMA_VERSION = 1;

export const RANKING_EVALUATION_ERROR_REASONS = Object.freeze({
    INVALID_SCORER_OUTPUT: "INVALID_SCORER_OUTPUT",
    MISSING_CANDIDATE_SCORE: "MISSING_CANDIDATE_SCORE",
    NON_FINITE_CANDIDATE_SCORE: "NON_FINITE_CANDIDATE_SCORE",
    UNEXPECTED_CANDIDATE_SCORE: "UNEXPECTED_CANDIDATE_SCORE",
    SCORER_ERROR: "SCORER_ERROR",
});

function hashString(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function summarize(entries: RankingEntry[]): RankingSummary {
    const ranks = entries.map(entry => entry.rank);
    const candidateCounts = entries.map(entry => entry.candidateCount);
    const count = ranks.length;
    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
    return {
        decisionCount: count,
        gameCount: new Set(entries.map(entry => entry.gameId)).size,
        top1Accuracy: count ? ranks.filter(rank => rank === 1).length / count : 0,
        tieAwareTop1Accuracy: count ? entries.filter(entry => entry.tieAwareTop1).length / count : 0,
        topScoreTieDecisionCount: entries.filter(entry => entry.topScoreTie).length,
        top3Accuracy: count ? ranks.filter(rank => rank <= 3).length / count : 0,
        mrr: count ? sum(ranks.map(rank => 1 / rank)) / count : 0,
        meanSelectedRank: count ? sum(ranks) / count : 0,
        candidateCount: {
            mean: count ? sum(candidateCounts) / count : 0,
            min: count ? Math.min(...candidateCounts) : 0,
            max: count ? Math.max(...candidateCounts) : 0,
        },
    };
}

function createEvaluationError(
    group: PlacementDecisionGroup,
    reason: string,
    details: { placementKey?: string | null; message?: string } = {},
): { ok: false; error: RankingError } {
    return {
        ok: false,
        error: { reason, decisionKey: group.decisionKey, ...details },
    };
}

function normalizeScorerResult(
    group: PlacementDecisionGroup,
    scorerResult: PlacementScoreResult,
): {
    ok: true;
    scores: Map<PlacementDatasetSample, number>;
    compareCandidates?: CandidateComparator;
} | { ok: false; error: RankingError } {
    const scores = scorerResult instanceof Map ? scorerResult : scorerResult?.scores;
    if (!(scores instanceof Map)) {
        return createEvaluationError(group, RANKING_EVALUATION_ERROR_REASONS.INVALID_SCORER_OUTPUT);
    }
    for (const candidate of group.candidates) {
        if (!scores.has(candidate)) {
            return createEvaluationError(group, RANKING_EVALUATION_ERROR_REASONS.MISSING_CANDIDATE_SCORE, {
                placementKey: getCanonicalPlacementKey(candidate),
            });
        }
        if (!Number.isFinite(scores.get(candidate))) {
            return createEvaluationError(group, RANKING_EVALUATION_ERROR_REASONS.NON_FINITE_CANDIDATE_SCORE, {
                placementKey: getCanonicalPlacementKey(candidate),
            });
        }
    }
    for (const candidate of scores.keys()) {
        if (!group.candidates.includes(candidate)) {
            return createEvaluationError(group, RANKING_EVALUATION_ERROR_REASONS.UNEXPECTED_CANDIDATE_SCORE, {
                placementKey: getCanonicalPlacementKey(candidate),
            });
        }
    }
    const compareCandidates = scorerResult instanceof Map
        ? undefined
        : scorerResult.compareCandidates;
    return { ok: true, scores, compareCandidates };
}

function getCandidateScore(
    scores: Map<PlacementDatasetSample, number>,
    candidate: PlacementDatasetSample,
): number {
    const score = scores.get(candidate);
    if (typeof score !== "number") throw new Error("candidate score missing after validation");
    return score;
}

function rankCandidates(
    group: PlacementDecisionGroup,
    scorerResult: {
        scores: Map<PlacementDatasetSample, number>;
        compareCandidates?: CandidateComparator;
    },
): PlacementDatasetSample[] {
    return group.candidates.slice().sort((left, right) => {
        // score → scorer 전용 동률 규칙 → canonical placement key 순서로 결정성을 보장한다.
        const scoreDelta = getCandidateScore(scorerResult.scores, right) -
            getCandidateScore(scorerResult.scores, left);
        if (scoreDelta) return scoreDelta;
        if (scorerResult.compareCandidates) {
            const comparison = scorerResult.compareCandidates(left, right);
            if (comparison) return comparison;
        }
        return compareCanonicalStrings(getCanonicalPlacementKey(left), getCanonicalPlacementKey(right));
    });
}

function createMetrics(entries: RankingEntry[]): RankingMetrics {
    const byGameId = new Map<string, RankingEntry[]>();
    const byAiDifficulty = new Map<string, RankingEntry[]>();
    const byOutcome = new Map<string, RankingEntry[]>();
    entries.forEach(entry => {
        const add = (map: Map<string, RankingEntry[]>, key: string) => {
            if (!map.has(key)) map.set(key, []);
            map.get(key)?.push(entry);
        };
        add(byGameId, entry.gameId);
        add(byAiDifficulty, entry.aiDifficulty);
        add(byOutcome, entry.outcome);
    });
    const toBreakdown = (map: Map<string, RankingEntry[]>): Record<string, RankingSummary> => Object.fromEntries([...map.entries()].sort(([left], [right]) => compareCanonicalStrings(left, right)).map(([key, values]) => {
        return [key, summarize(values)];
    }));
    return {
        ...summarize(entries),
        byGameId: toBreakdown(byGameId),
        byAiDifficulty: toBreakdown(byAiDifficulty),
        byOutcome: toBreakdown(byOutcome),
    };
}

function evaluateRankingDetails(
    groups: PlacementDecisionGroup[],
    scorer: PlacementScorer,
): { ok: true; entries: RankingEntry[]; metrics: RankingMetrics } |
    { ok: false; error: RankingError } {
    const entries: RankingEntry[] = [];
    for (const group of groups) {
        let rawScorerResult;
        try {
            rawScorerResult = scorer(group);
        } catch (error) {
            return createEvaluationError(group, RANKING_EVALUATION_ERROR_REASONS.SCORER_ERROR, {
                message: error instanceof Error ? error.message : String(error),
            });
        }
        const scorerResult = normalizeScorerResult(group, rawScorerResult);
        if (!scorerResult.ok) return scorerResult;
        const ranked = rankCandidates(group, scorerResult);
        const selected = ranked.find(candidate => candidate.selectedBySource);
        const topCandidate = ranked[0];
        const candidate = group.candidates[0];
        if (!selected || !topCandidate || !candidate) {
            return createEvaluationError(
                group,
                RANKING_EVALUATION_ERROR_REASONS.INVALID_SCORER_OUTPUT,
            );
        }
        const rank = ranked.indexOf(selected) + 1;
        const topScore = getCandidateScore(scorerResult.scores, topCandidate);
        const topScoreTieCount = ranked.filter(rankedCandidate => {
            return getCandidateScore(scorerResult.scores, rankedCandidate) === topScore;
        }).length;
        entries.push({
            rank,
            candidateCount: ranked.length,
            gameId: candidate.gameId,
            aiDifficulty: candidate.aiDifficulty ?? "unknown",
            outcome: candidate.metadata?.isWinner === true ? "winner" : "loser",
            topScoreTie: topScoreTieCount > 1,
            tieAwareTop1: getCandidateScore(scorerResult.scores, selected) === topScore,
        });
    }
    return { ok: true, entries, metrics: createMetrics(entries) };
}

export function createHeuristicScorer() {
    return (group: PlacementDecisionGroup): PlacementScoreResult => ({
        scores: new Map(group.candidates.map(candidate => [candidate, candidate.heuristicBaseline.score])),
        compareCandidates: (left, right) => compareHeuristicEvaluations({
            score: left.heuristicBaseline.score,
            linesCleared: left.candidateResult.linesCleared,
            metricsAfter: left.candidateMetricsAfter,
            placement: left.candidatePlacement,
        }, {
            score: right.heuristicBaseline.score,
            linesCleared: right.candidateResult.linesCleared,
            metricsAfter: right.candidateMetricsAfter,
            placement: right.candidatePlacement,
        }),
    });
}

export function createSeededRandomScorer(seed = "placement-random-v1") {
    return (group: PlacementDecisionGroup): PlacementScoreResult => new Map(group.candidates.map(candidate => [candidate,
        hashString(`${seed}:${group.decisionKey}:${getCanonicalPlacementKey(candidate)}`),
    ]));
}

/** scorer는 group을 받아 모든 candidate object의 finite score Map을 반환한다. */
export function evaluateRanking(groups: PlacementDecisionGroup[], scorer: PlacementScorer) {
    const result = evaluateRankingDetails(groups, scorer);
    return result.ok ? { ok: true, ...result.metrics } : result;
}

export function createLeaveOneGameOutFolds(groups: PlacementDecisionGroup[]) {
    const gameIds = [...new Set(groups.map(group => group.candidates[0].gameId))].sort(compareCanonicalStrings);
    return gameIds.map(validationGameId => ({
        validationGameId,
        trainGroups: groups.filter(group => group.candidates[0].gameId !== validationGameId),
        validationGroups: groups.filter(group => group.candidates[0].gameId === validationGameId),
    }));
}

/**
 * 각 gameId를 한 번씩 통째로 제외하고 나머지 게임으로 scorer를 만든다.
 *
 * fold의 validation 게임은 scaler나 model 학습에 들어가지 않는다. 마지막 aggregate도
 * full-data model의 in-sample 점수가 아니라 각 fold의 held-out 예측만 합친 결과다.
 */
export function evaluateLeaveOneGameOut(
    groups: PlacementDecisionGroup[],
    scorerFactory: (groups: PlacementDecisionGroup[]) => PlacementScorer,
) {
    const heldOutEntries: RankingEntry[] = [];
    const folds: Array<{ validationGameId: string; metrics: RankingMetrics }> = [];
    for (const fold of createLeaveOneGameOutFolds(groups)) {
        const result = evaluateRankingDetails(fold.validationGroups, scorerFactory(fold.trainGroups));
        if (!result.ok) {
            return {
                ok: false,
                error: { ...result.error, validationGameId: fold.validationGameId },
            };
        }
        heldOutEntries.push(...result.entries);
        folds.push({ validationGameId: fold.validationGameId, metrics: result.metrics });
    }
    return { ok: true, folds, aggregate: createMetrics(heldOutEntries) };
}
