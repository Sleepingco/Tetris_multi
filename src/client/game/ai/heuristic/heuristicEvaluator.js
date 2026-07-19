import { getBoardMetrics } from "../../core/boardMetrics.js";
import { generateReachablePlacements } from "./reachablePlacementPlanner.js";
import { simulatePlacement } from "./simulatePlacement.js";

export const HEURISTIC_WEIGHTS = Object.freeze({
    linesCleared: 10,
    holes: -6,
    aggregateHeight: -0.5,
    bumpiness: -0.8,
    maxHeight: -1,
});

const DECISION_SOURCE = "heuristic_ai";
const MODEL_TYPE = "heuristic";

function calculateScore(linesCleared, metricsAfter) {
    return linesCleared * HEURISTIC_WEIGHTS.linesCleared +
        metricsAfter.holes * HEURISTIC_WEIGHTS.holes +
        metricsAfter.aggregateHeight * HEURISTIC_WEIGHTS.aggregateHeight +
        metricsAfter.bumpiness * HEURISTIC_WEIGHTS.bumpiness +
        metricsAfter.maxHeight * HEURISTIC_WEIGHTS.maxHeight;
}

function createReason(linesCleared, metricsBefore, metricsAfter) {
    return {
        linesCleared,
        holesDelta: metricsAfter.holes - metricsBefore.holes,
        bumpinessDelta: metricsAfter.bumpiness - metricsBefore.bumpiness,
        aggregateHeightDelta: metricsAfter.aggregateHeight - metricsBefore.aggregateHeight,
        maxHeightDelta: metricsAfter.maxHeight - metricsBefore.maxHeight,
    };
}

export function compareHeuristicEvaluations(left, right) {
    if (left.score !== right.score) return right.score - left.score;
    if (left.linesCleared !== right.linesCleared) {
        return right.linesCleared - left.linesCleared;
    }
    if (left.metricsAfter.holes !== right.metricsAfter.holes) {
        return left.metricsAfter.holes - right.metricsAfter.holes;
    }
    if (left.metricsAfter.aggregateHeight !== right.metricsAfter.aggregateHeight) {
        return left.metricsAfter.aggregateHeight - right.metricsAfter.aggregateHeight;
    }
    if (left.metricsAfter.bumpiness !== right.metricsAfter.bumpiness) {
        return left.metricsAfter.bumpiness - right.metricsAfter.bumpiness;
    }
    if (left.metricsAfter.maxHeight !== right.metricsAfter.maxHeight) {
        return left.metricsAfter.maxHeight - right.metricsAfter.maxHeight;
    }
    if (left.placement.rotation !== right.placement.rotation) {
        return left.placement.rotation - right.placement.rotation;
    }
    if (left.placement.col !== right.placement.col) {
        return left.placement.col - right.placement.col;
    }
    return left.placement.row - right.placement.row;
}

function isRectangularBoard(board) {
    if (!Array.isArray(board) || board.length === 0) return false;

    const cols = board[0]?.length ?? 0;
    if (cols === 0) return false;

    return board.every(row => Array.isArray(row) && row.length === cols);
}

function createFailure(errorCode, message, candidateCount = 0) {
    return {
        ok: false,
        source: DECISION_SOURCE,
        modelType: MODEL_TYPE,
        errorCode,
        message,
        candidateCount,
    };
}

/**
 * 하나의 placement를 가상 적용하고 보드 지표와 휴리스틱 점수를 계산한다.
 *
 * @param {Array<Array<string|null>>} board - placement 적용 전 보드
 * @param {Object} placement - 평가할 표준 placement
 * @returns {{
 *   placement: Object,
 *   boardAfter: Array<Array<string|null>>,
 *   linesCleared: number,
 *   gameOver: boolean,
 *   score: number,
 *   metricsBefore: Object,
 *   metricsAfter: Object,
 *   reason: Object
 * }|null}
 */
export function evaluatePlacement(board, placement) {
    const simulation = simulatePlacement(board, placement);
    if (!simulation) return null;

    const metricsBefore = getBoardMetrics(board);
    const metricsAfter = getBoardMetrics(simulation.boardAfter);
    const score = calculateScore(simulation.linesCleared, metricsAfter);

    return {
        placement: simulation.placement,
        boardAfter: simulation.boardAfter,
        linesCleared: simulation.linesCleared,
        gameOver: simulation.gameOver,
        score,
        metricsBefore,
        metricsAfter,
        reason: createReason(simulation.linesCleared, metricsBefore, metricsAfter),
    };
}

/**
 * 현재 조각의 모든 후보를 평가해 높은 점수부터 결정적인 순서로 정렬한다.
 *
 * @param {Array<Array<string|null>>} board - 현재 보드
 * @param {{pieceType: string, rotation: number, row: number, col: number}} activePiece - 현재 활성 조각
 * @returns {Array<Object>} 점수 내림차순 평가 결과
 */
export function rankPlacements(board, activePiece) {
    return generateReachablePlacements(board, activePiece)
        .map(candidate => {
            const evaluation = evaluatePlacement(board, candidate.placement);
            if (!evaluation) return null;

            return {
                ...evaluation,
                plannedActions: [...candidate.plannedActions],
            };
        })
        .filter(Boolean)
        .sort(compareHeuristicEvaluations);
}

/**
 * 직렬화 가능한 gameState를 휴리스틱 AI decision schema로 변환한다.
 *
 * @param {{
 *   board: Array<Array<string|null>>,
 *   activePiece: Object,
 *   nextQueue?: string[],
 *   holdPiece?: string|null,
 *   score?: number,
 *   lines?: number,
 *   tick?: number,
 *   pieceIndex?: number
 * }} gameState - AI가 읽을 현재 게임 상태
 * @returns {Object} 성공 또는 실패 decision
 */
export function getHeuristicDecision(gameState) {
    if (!gameState || !isRectangularBoard(gameState.board) || !gameState.activePiece?.pieceType) {
        return createFailure(
            "INVALID_GAME_STATE",
            "gameState must include a rectangular board and activePiece.",
        );
    }

    const rankedPlacements = rankPlacements(gameState.board, gameState.activePiece);
    if (rankedPlacements.length === 0) {
        return createFailure(
            "NO_LEGAL_PLACEMENT",
            "No legal placement is available for the active piece.",
        );
    }

    const best = rankedPlacements[0];
    return {
        ok: true,
        source: DECISION_SOURCE,
        modelType: MODEL_TYPE,
        selectedPlacement: best.placement,
        plannedActions: [...best.plannedActions],
        score: best.score,
        candidateCount: rankedPlacements.length,
        metricsBefore: best.metricsBefore,
        metricsAfter: best.metricsAfter,
        reason: best.reason,
    };
}
