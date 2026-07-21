import { getBoardMetrics } from "../../core/boardMetrics.ts";
import BLOCKS from "../../state/blocks.ts";
import {
    evaluatePlacement,
    getHeuristicDecision,
} from "./heuristicEvaluator.ts";
import type { Board } from "../../core/board.ts";
import type { BoardMetrics } from "../../core/boardMetrics.ts";
import type { PlaceablePieceState } from "../../core/piece.ts";
import type { PieceType } from "../../state/blocks.ts";
import type { HeuristicReason } from "./heuristicEvaluator.ts";
import type { Placement } from "./placementGenerator.ts";

export type HumanPlacementLogAnalysis = {
    metricsBefore: BoardMetrics;
    metricsAfter: BoardMetrics;
    evaluation: { score: number; reason: HeuristicReason; candidateCount: number };
    aiComparison: {
        heuristicPlacement: Placement;
        heuristicScore: number;
        userScore: number;
        betterBy: number;
        samePlacement: boolean;
    };
};

function isSamePlacement(left: Placement | null, right: Placement | null): boolean {
    if (!left || !right) return false;

    return left.pieceType === right.pieceType &&
        left.rotation === right.rotation &&
        left.col === right.col &&
        left.row === right.row;
}

function isPieceType(value: unknown): value is PieceType {
    return typeof value === "string" && Object.hasOwn(BLOCKS, value);
}

function isValidDecisionStartPiece(piece: unknown): piece is PlaceablePieceState {
    if (!piece || typeof piece !== "object" || Array.isArray(piece) ||
        !("pieceType" in piece) || !isPieceType(piece.pieceType)) return false;
    const rotations = BLOCKS[piece.pieceType];

    return Array.isArray(rotations) &&
        "rotation" in piece &&
        Number.isInteger(piece.rotation) &&
        typeof piece.rotation === "number" &&
        piece.rotation >= 0 &&
        piece.rotation < rotations.length &&
        "row" in piece &&
        Number.isInteger(piece.row) &&
        typeof piece.row === "number" &&
        "col" in piece &&
        Number.isInteger(piece.col) &&
        typeof piece.col === "number";
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
}: {
    boardBefore: Board;
    boardAfter: Board;
    activePieceAtDecisionStart: unknown;
    selectedPlacement: unknown;
}): HumanPlacementLogAnalysis | null {
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
