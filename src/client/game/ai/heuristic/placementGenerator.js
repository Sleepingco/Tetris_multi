import { canPlacePiece } from "../../core/board.js";
import { getHardDropRow as getHardDropRowForPiece } from "../../core/piece.js";
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

/**
 * 지정한 회전과 열에서 위쪽부터 직선 하드드롭할 수 있는 마지막 행을 계산한다.
 *
 * @param {Array<Array<string|null>>} board - 현재 보드
 * @param {string} pieceType - 조각 타입
 * @param {number} rotation - 회전 인덱스
 * @param {number} col - 조각 기준 열
 * @returns {number|null} 보드 안에 고정 가능한 마지막 행 또는 null
 */
export function getDropRow(board, pieceType, rotation, col) {
    if (!isRectangularBoard(board) || !Number.isInteger(col)) return null;

    const initialPlacement = normalizePlacement({
        pieceType,
        rotation,
        col,
        row: 0,
    });
    if (!initialPlacement) return null;

    const offsets = BLOCKS[initialPlacement.pieceType][initialPlacement.rotation];
    const maxOffsetY = Math.max(...offsets.map(([, offsetY]) => offsetY));
    const startRow = -maxOffsetY - 1;
    const fallingPiece = {
        pieceType: initialPlacement.pieceType,
        rotation: initialPlacement.rotation,
        col,
        row: startRow,
    };
    const dropRow = getHardDropRowForPiece(fallingPiece, targetRow => {
        return canPlacePiece(board, {
            ...fallingPiece,
            row: targetRow,
        }, BLOCKS);
    });

    return canPlacePlacement(
        board,
        fallingPiece.pieceType,
        fallingPiece.rotation,
        col,
        dropRow,
    )
        ? dropRow
        : null;
}

/**
 * 현재 조각의 모든 회전과 열을 검사해 직선 하드드롭 가능한 최종 placement를 만든다.
 *
 * @param {Array<Array<string|null>>} board - 현재 보드
 * @param {{pieceType: string}} activePiece - 현재 활성 조각
 * @returns {Array<{pieceType: string, rotation: number, col: number, row: number, cells: Array<{row: number, col: number}>}>}
 */
export function generatePlacements(board, activePiece) {
    if (!isRectangularBoard(board) || !activePiece?.pieceType) return [];

    const rotations = BLOCKS[activePiece.pieceType];
    if (!Array.isArray(rotations) || rotations.length === 0) return [];

    const cols = board[0].length;
    const placements = [];
    const seen = new Set();

    rotations.forEach((offsets, rotation) => {
        const offsetCols = offsets.map(([offsetX]) => offsetX);
        const minCol = -Math.min(...offsetCols) || 0;
        const maxCol = cols - 1 - Math.max(...offsetCols);

        for (let col = minCol; col <= maxCol; col++) {
            const row = getDropRow(board, activePiece.pieceType, rotation, col);
            if (row === null) continue;

            const placement = normalizePlacement({
                pieceType: activePiece.pieceType,
                rotation,
                col,
                row,
            });
            if (!placement) continue;

            const key = `${placement.pieceType}:${placement.rotation}:${placement.col}:${placement.row}`;
            if (seen.has(key)) continue;

            seen.add(key);
            placements.push(placement);
        }
    });

    return placements;
}
