import {
    canPlacePiece,
    clearFilledLines,
    isPieceAboveTop,
    lockPieceOnBoard,
} from "../../core/board.js";
import BLOCKS from "../../state/blocks.js";
import { normalizePlacement } from "./placementGenerator.js";

function cloneBoard(board) {
    if (!Array.isArray(board) || board.length === 0) return null;

    const cols = board[0]?.length ?? 0;
    if (cols === 0) return null;
    if (!board.every(row => Array.isArray(row) && row.length === cols)) return null;

    return board.map(row => [...row]);
}

/**
 * placement를 복제된 보드에 고정하고 line clear까지 적용한다.
 * 기존 엔진과 동일하게 상단을 넘은 조각은 game over로 처리하고 line clear를 생략한다.
 *
 * @param {Array<Array<string|null>>} board - placement 적용 전 보드
 * @param {Object} placement - 적용할 placement
 * @returns {{boardAfter: Array<Array<string|null>>, linesCleared: number, gameOver: boolean, placement: Object}|null}
 */
export function simulatePlacement(board, placement) {
    const boardAfter = cloneBoard(board);
    const normalizedPlacement = normalizePlacement(placement);
    if (!boardAfter || !normalizedPlacement) return null;
    if (!canPlacePiece(boardAfter, normalizedPlacement, BLOCKS)) return null;

    const gameOver = isPieceAboveTop(normalizedPlacement, BLOCKS);
    lockPieceOnBoard(boardAfter, normalizedPlacement, BLOCKS);
    const linesCleared = gameOver
        ? 0
        : clearFilledLines(boardAfter);

    return {
        boardAfter,
        linesCleared,
        gameOver,
        placement: normalizedPlacement,
    };
}
