import { canPlacePiece } from "../../core/board.js";
import BLOCKS from "../../state/blocks.js";

function isRectangularBoard(board) {
    if (!Array.isArray(board) || board.length === 0) return false;

    const cols = board[0]?.length ?? 0;
    if (cols === 0) return false;

    return board.every(row => Array.isArray(row) && row.length === cols);
}

function normalizeRotation(rotation, rotationCount) {
    if (!Number.isInteger(rotation) || rotationCount <= 0) return null;
    return ((rotation % rotationCount) + rotationCount) % rotationCount;
}

function isPlacementInsideBoard(board, placement) {
    const rows = board.length;
    const cols = board[0].length;

    return placement.cells.every(cell => {
        return cell.row >= 0 &&
            cell.row < rows &&
            cell.col >= 0 &&
            cell.col < cols;
    });
}

/**
 * placement 입력을 실제 조각 정의에서 계산한 절대 cell 좌표 형태로 정규화한다.
 *
 * @param {Object} placement - 정규화할 placement
 * @returns {{pieceType: string, rotation: number, col: number, row: number, cells: Array<{row: number, col: number}>}|null}
 */
export function normalizePlacement(placement) {
    if (!placement || typeof placement.pieceType !== "string") return null;
    if (!Number.isInteger(placement.col) || !Number.isInteger(placement.row)) return null;

    const rotations = BLOCKS[placement.pieceType];
    if (!Array.isArray(rotations) || rotations.length === 0) return null;

    const rotation = normalizeRotation(placement.rotation, rotations.length);
    if (rotation === null) return null;

    const cells = rotations[rotation].map(([offsetX, offsetY]) => ({
        row: placement.row + offsetY,
        col: placement.col + offsetX,
    }));

    return {
        pieceType: placement.pieceType,
        rotation,
        col: placement.col,
        row: placement.row,
        cells,
    };
}

/**
 * 최종 placement의 모든 cell이 보드 안에 있고 기존 블록과 충돌하지 않는지 검사한다.
 *
 * @param {Array<Array<string|null>>} board - 현재 보드
 * @param {string} pieceType - 조각 타입
 * @param {number} rotation - 회전 인덱스
 * @param {number} col - 조각 기준 열
 * @param {number} row - 조각 기준 행
 * @returns {boolean}
 */
export function canPlacePlacement(board, pieceType, rotation, col, row) {
    if (!isRectangularBoard(board)) return false;

    const placement = normalizePlacement({
        pieceType,
        rotation,
        col,
        row,
    });
    if (!placement || !isPlacementInsideBoard(board, placement)) return false;

    return canPlacePiece(board, placement, BLOCKS);
}
