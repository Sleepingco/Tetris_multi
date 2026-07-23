import type { Board } from "./board.ts";
import type { PieceState } from "./piece.ts";

// =============================
// T-Spin 판정
// 조각을 board에 쓰기 직전 상태를 읽어 T 조각 중심의 네 모서리 점유 수를 검사한다.
// 점수나 공격 상태는 바꾸지 않고 판정 결과만 반환한다.
// =============================

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
 * 이 결과는 lock 뒤 점수와 garbage 공격 계산에 사용되며 board를 직접 변경하지 않는다.
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
