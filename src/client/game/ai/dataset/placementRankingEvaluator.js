import { compareCanonicalStrings, getCanonicalPlacementKey } from "./placementDecisionGroups.js";
import { compareHeuristicEvaluations } from "../heuristic/heuristicEvaluator.js";

export const RANKING_EVALUATION_SCHEMA_VERSION = 1;

export const RANKING_EVALUATION_ERROR_REASONS = Object.freeze({
    INVALID_SCORER_OUTPUT: "INVALID_SCORER_OUTPUT",
    MISSING_CANDIDATE_SCORE: "MISSING_CANDIDATE_SCORE",
    NON_FINITE_CANDIDATE_SCORE: "NON_FINITE_CANDIDATE_SCORE",
    UNEXPECTED_CANDIDATE_SCORE: "UNEXPECTED_CANDIDATE_SCORE",
    SCORER_ERROR: "SCORER_ERROR",
});

function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function summarize(entries) {
    const ranks = entries.map(entry => entry.rank);
    const candidateCounts = entries.map(entry => entry.candidateCount);
    const count = ranks.length;
    const sum = values => values.reduce((total, value) => total + value, 0);
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

function createEvaluationError(group, reason, details = {}) {
    return {
        ok: false,
        error: { reason, decisionKey: group.decisionKey, ...details },
    };
}

function normalizeScorerResult(group, scorerResult) {
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
    return { ok: true, scores, compareCandidates: scorerResult?.compareCandidates };
}

function rankCandidates(group, scorerResult) {
    return group.candidates.slice().sort((left, right) => {
        const scoreDelta = scorerResult.scores.get(right) - scorerResult.scores.get(left);
        if (scoreDelta) return scoreDelta;
        if (scorerResult.compareCandidates) {
            const comparison = scorerResult.compareCandidates(left, right);
            if (comparison) return comparison;
        }
        return compareCanonicalStrings(getCanonicalPlacementKey(left), getCanonicalPlacementKey(right));
    });
}

function createMetrics(entries) {
    const byGameId = new Map();
    const byAiDifficulty = new Map();
    const byOutcome = new Map();
    entries.forEach(entry => {
        const add = (map, key) => {
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(entry);
        };
        add(byGameId, entry.gameId);
        add(byAiDifficulty, entry.aiDifficulty);
        add(byOutcome, entry.outcome);
    });
    const toBreakdown = map => Object.fromEntries([...map.entries()].sort(([left], [right]) => compareCanonicalStrings(left, right)).map(([key, values]) => {
        return [key, summarize(values)];
    }));
    return {
        ...summarize(entries),
        byGameId: toBreakdown(byGameId),
        byAiDifficulty: toBreakdown(byAiDifficulty),
        byOutcome: toBreakdown(byOutcome),
    };
}

function evaluateRankingDetails(groups, scorer) {
    const entries = [];
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
        const rank = ranked.indexOf(selected) + 1;
        const topScore = scorerResult.scores.get(ranked[0]);
        const topScoreTieCount = ranked.filter(candidate => scorerResult.scores.get(candidate) === topScore).length;
        const candidate = group.candidates[0];
        entries.push({
            rank,
            candidateCount: ranked.length,
            gameId: candidate.gameId,
            aiDifficulty: candidate.aiDifficulty ?? "unknown",
            outcome: candidate.metadata?.isWinner === true ? "winner" : "loser",
            topScoreTie: topScoreTieCount > 1,
            tieAwareTop1: scorerResult.scores.get(selected) === topScore,
        });
    }
    return { ok: true, entries, metrics: createMetrics(entries) };
}

export function createHeuristicScorer() {
    return group => ({
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
    return group => new Map(group.candidates.map(candidate => [candidate,
        hashString(`${seed}:${group.decisionKey}:${getCanonicalPlacementKey(candidate)}`),
    ]));
}

/** scorer는 group을 받아 모든 candidate object의 finite score Map을 반환한다. */
export function evaluateRanking(groups, scorer) {
    const result = evaluateRankingDetails(groups, scorer);
    return result.ok ? { ok: true, ...result.metrics } : result;
}

export function createLeaveOneGameOutFolds(groups) {
    const gameIds = [...new Set(groups.map(group => group.candidates[0].gameId))].sort(compareCanonicalStrings);
    return gameIds.map(validationGameId => ({
        validationGameId,
        trainGroups: groups.filter(group => group.candidates[0].gameId !== validationGameId),
        validationGroups: groups.filter(group => group.candidates[0].gameId === validationGameId),
    }));
}

export function evaluateLeaveOneGameOut(groups, scorerFactory) {
    const heldOutEntries = [];
    const folds = [];
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
