import type { Board } from "./board.ts";
import type { PieceState } from "./piece.ts";
import { BOARD_ROWS } from "../state/config.ts";

// =============================
// T-Spin 판정과 고정 점수
// 조각을 board에 쓰기 직전 상태와 성공한 회전 이력으로 Mini/일반을 구분한다.
// 보드·이력·점수 상태를 직접 변경하지 않는다.
// =============================

const T_SPIN_PIECE_TYPE = "tree";
const FRONT_CORNERS = [[0, 1], [1, 3], [2, 3], [0, 2]];
const FULL_SCORES = [15, 50, 100, 150];
const MINI_SCORES = [0, 10, 20];

export type TSpinType = "none" | "mini" | "full";

export type SpinRotation = {
    lastKickIndex: number;
    usedKick5: boolean;
};

export type TSpinLockOptions = {
    board?: Board;
    piece?: PieceState | null;
    spinRotation?: SpinRotation | null;
};

/**
 * 이동·하강 없이 이어지는 T 회전에서는 5번째 킥 승격 이력을 유지한다.
 */
export function nextSpinRotation(previous: SpinRotation | null, kickIndex: number): SpinRotation {
    return {
        lastKickIndex: kickIndex,
        usedKick5: previous?.usedKick5 === true || kickIndex === 4,
    };
}

/**
 * 고정 전 T의 3코너를 확인하고 전면 2코너 또는 5번째 킥 이력이 있으면 일반으로 분류한다.
 */
export function classifyTSpin({
    board,
    piece,
    spinRotation,
}: TSpinLockOptions = {}): TSpinType {
    if (!piece || piece.pieceType !== T_SPIN_PIECE_TYPE || !spinRotation) return "none";

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

    const occupied = corners.map(([cx, cy]) => (
        cx < 0 || cx >= cols || cy >= rows || (cy < 0 && rows === BOARD_ROWS) || (cy >= 0 && Boolean(boardRows[cy]?.[cx]))
    ));
    if (occupied.filter(Boolean).length < 3) return "none";

    const [frontA, frontB] = FRONT_CORNERS[piece.rotation];
    return (occupied[frontA] && occupied[frontB]) || spinRotation.usedKick5
        ? "full"
        : "mini";
}

/**
 * 줄 삭제와 T-Spin 분류의 점수를 반환한다. 드롭 거리 점수는 실행 계층에서 별도로 합산한다.
 */
export function calculatePlacementScore(linesCleared: number, tSpinType: TSpinType): number {
    if (tSpinType === "full") return FULL_SCORES[linesCleared] ?? 0;
    if (tSpinType === "mini") return MINI_SCORES[linesCleared] ?? 0;
    return linesCleared * 10;
}
