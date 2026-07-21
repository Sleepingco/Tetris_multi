import { canPlacePiece } from "../../core/board.ts";
import BLOCKS from "../../state/blocks.ts";
import type { Board } from "../../core/board.ts";
import type { PieceType } from "../../state/blocks.ts";

export type PlacementCell = { row: number; col: number };
export type Placement = {
    pieceType: PieceType;
    rotation: number;
    col: number;
    row: number;
    cells: PlacementCell[];
};

function isPieceType(value: unknown): value is PieceType {
    return typeof value === "string" && Object.hasOwn(BLOCKS, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRectangularBoard(board: Board) {
    if (!Array.isArray(board) || board.length === 0) return false;

    const cols = board[0]?.length ?? 0;
    if (cols === 0) return false;

    return board.every(row => Array.isArray(row) && row.length === cols);
}

function normalizeRotation(rotation: unknown, rotationCount: number): number | null {
    if (typeof rotation !== "number" || !Number.isInteger(rotation) || rotationCount <= 0) return null;
    return ((rotation % rotationCount) + rotationCount) % rotationCount;
}

function isPlacementInsideBoard(board: Board, placement: Placement): boolean {
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
export function normalizePlacement(placement: unknown): Placement | null {
    if (!isRecord(placement)) return null;
    const { pieceType, rotation, col, row } = placement;
    if (!isPieceType(pieceType)) return null;
    if (typeof col !== "number" || !Number.isInteger(col) ||
        typeof row !== "number" || !Number.isInteger(row)) return null;

    const rotations = BLOCKS[pieceType];
    if (!Array.isArray(rotations) || rotations.length === 0) return null;

    const normalizedRotation = normalizeRotation(rotation, rotations.length);
    if (normalizedRotation === null) return null;

    const cells = rotations[normalizedRotation].map(([offsetX, offsetY]) => ({
        row: row + offsetY,
        col: col + offsetX,
    }));

    return {
        pieceType,
        rotation: normalizedRotation,
        col,
        row,
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
export function canPlacePlacement(
    board: Board,
    pieceType: unknown,
    rotation: unknown,
    col: unknown,
    row: unknown,
): boolean {
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
