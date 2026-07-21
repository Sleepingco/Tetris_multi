import { getBoardMetrics } from "../../core/boardMetrics.ts";
import BLOCKS from "../../state/blocks.ts";
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

function isValidDecisionStartPiece(piece) {
    const rotations = BLOCKS[piece?.pieceType];

    return Array.isArray(rotations) &&
        Number.isInteger(piece.rotation) &&
        piece.rotation >= 0 &&
        piece.rotation < rotations.length &&
        Number.isInteger(piece.row) &&
        Number.isInteger(piece.col);
}

/**
 * Human placement를 판단 시작 board/piece의 heuristic 최적 placement와 비교한다.
 * 분석에 실패하면 null을 반환해 게임과 legacy 로그 흐름을 방해하지 않는다.
 *
 * @param {Object} context - placement log 분석 입력
 * @param {Object} context.activePieceAtDecisionStart - spawn 또는 authoritative correction 직후 조각 상태
 * @returns {{metricsBefore: Object, metricsAfter: Object, evaluation: Object, aiComparison: Object}|null}
 */
export function createHumanPlacementLogAnalysis({
    boardBefore,
    boardAfter,
    activePieceAtDecisionStart,
    selectedPlacement,
}) {
    try {
        if (!isValidDecisionStartPiece(activePieceAtDecisionStart)) return null;

        const userEvaluation = evaluatePlacement(boardBefore, selectedPlacement);
        if (!userEvaluation) return null;

        const heuristicDecision = getHeuristicDecision({
            board: boardBefore,
            activePiece: activePieceAtDecisionStart,
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
