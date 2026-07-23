import {
    canPlacePiece,
    clearFilledLines,
    isPieceAboveTop,
    lockPieceOnBoard,
} from "../../core/board.ts";
import BLOCKS from "../../state/blocks.ts";
import { normalizePlacement } from "./placementGenerator.ts";
import type { Board } from "../../core/board.ts";
import type { Placement } from "./placementGenerator.ts";

/**
 * 후보 placement를 실제 보드에 놓았을 때의 결과를 원본 변경 없이 계산한다.
 *
 * AI는 선택만 해야 하므로 입력 `board`를 복제하고, lock·line clear·game over는 게임
 * core 함수를 재사용한다. 이 순수 시뮬레이션 덕분에 후보를 여러 개 평가해도 실제
 * gameplay state는 바뀌지 않는다.
 */

function cloneBoard(board: Board): Board | null {
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
export function simulatePlacement(board: Board, placement: unknown): {
    boardAfter: Board;
    linesCleared: number;
    gameOver: boolean;
    placement: Placement;
} | null {
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
