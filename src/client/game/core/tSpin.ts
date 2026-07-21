import type { Board } from "./board.ts";
import type { PieceState } from "./piece.ts";

const T_SPIN_PIECE_TYPE = "tree";

export type TSpinLockOptions = {
    board?: Board;
    piece?: PieceState | null;
    lastActionWasRotation?: boolean;
};

/**
 * 현재 고정이 T-Spin 조건을 만족하는지 검사한다.
 * - T 조각(`tree`)이 아니면 false다.
 * - 마지막 액션이 회전이 아니면 false다.
 * - 중심 4코너 중 3개 이상이 막혀 있으면 T-Spin으로 본다.
 *
 * @param {Object} params - T-Spin 판정 입력값
 * @param {Array<Array<string|null>>} params.board - 현재 보드 배열
 * @param {{pieceType: string, rotation: number, row: number, col: number}} params.piece - 현재 고정 중인 조각
 * @param {boolean} params.lastActionWasRotation - 마지막 성공 액션이 회전인지 여부
 * @returns {boolean} T-Spin 조건을 만족하면 true
 */
export function isTSpinLock({
    board,
    piece,
    lastActionWasRotation,
}: TSpinLockOptions = {}): boolean {
    if (!piece || piece.pieceType !== T_SPIN_PIECE_TYPE) return false;
    if (!lastActionWasRotation) return false;

    const boardRows = Array.isArray(board) ? board : [];
    const rows = boardRows.length;
    const cols = Array.isArray(boardRows[0]) ? boardRows[0].length : 0;
    const centerCol = piece.col + 1;
    const centerRow = piece.row + 1;
    const corners = [
        [centerCol - 1, centerRow - 1],
        [centerCol + 1, centerRow - 1],
        [centerCol - 1, centerRow + 1],
        [centerCol + 1, centerRow + 1],
    ];

    let filledCorners = 0;
    for (const [cx, cy] of corners) {
        if (cx < 0 || cx >= cols || cy >= rows || (cy >= 0 && boardRows[cy]?.[cx])) {
            filledCorners++;
        }
    }

    return filledCorners >= 3;
}
