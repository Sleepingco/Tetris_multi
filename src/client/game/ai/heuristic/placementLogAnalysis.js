import { getBoardMetrics } from "../../core/boardMetrics.js";
import {
    evaluatePlacement,
    getHeuristicDecision,
} from "./heuristicEvaluator.js";

function isSamePlacement(left, right) {
    if (!left || !right) return false;

    return left.pieceType === right.pieceType &&
        left.rotation === right.rotation &&
        left.col === right.col &&
        left.row === right.row;
}

/**
 * Human placement를 같은 board의 heuristic 최적 placement와 비교한다.
 * 분석에 실패하면 null을 반환해 게임과 legacy 로그 흐름을 방해하지 않는다.
 *
 * @param {Object} context - placement log 분석 입력
 * @returns {{metricsBefore: Object, metricsAfter: Object, evaluation: Object, aiComparison: Object}|null}
 */
export function createHumanPlacementLogAnalysis({
    boardBefore,
    boardAfter,
    activePiece,
    selectedPlacement,
}) {
    try {
        const userEvaluation = evaluatePlacement(boardBefore, selectedPlacement);
        if (!userEvaluation) return null;

        const heuristicDecision = getHeuristicDecision({
            board: boardBefore,
            activePiece,
        });
        if (!heuristicDecision.ok) return null;

        return {
            metricsBefore: getBoardMetrics(boardBefore),
            metricsAfter: getBoardMetrics(boardAfter),
            evaluation: {
                score: userEvaluation.score,
                reason: userEvaluation.reason,
                candidateCount: heuristicDecision.candidateCount,
            },
            aiComparison: {
                heuristicPlacement: heuristicDecision.selectedPlacement,
                heuristicScore: heuristicDecision.score,
                userScore: userEvaluation.score,
                betterBy: heuristicDecision.score - userEvaluation.score,
                samePlacement: isSamePlacement(
                    heuristicDecision.selectedPlacement,
                    userEvaluation.placement,
                ),
            },
        };
    } catch {
        return null;
    }
}
