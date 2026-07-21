import type { PieceState, PlaceablePieceState } from "./piece.ts";
import type { BlockDefinitions } from "../state/blocks.ts";

export type BoardCell = string | null;
export type Board = BoardCell[][];

// =============================
// 보드 유틸리티 (엔진 계층)
// 보드 생성, 충돌 검사, 고정, 줄 삭제를 담당하는 순수 함수 모음이다.
// =============================


/**
  * 특정 보드 칸이 배치 가능한 상태인지 확인한다.
  * - 화면 위쪽 바깥(`row < 0`)은 스폰 처리를 위해 비어 있다고 본다.
  * - 좌우 경계 밖이나 바닥 아래는 막힌 칸으로 본다.
  *
  * @param {Array<Array<string|null>>} board - 현재 보드 배열
  * @param {number} row - 검사할 행 인덱스
  * @param {number} col - 검사할 열 인덱스
  * @returns {boolean} 해당 칸을 사용할 수 있으면 true
  */
function isCellEmpty(board: Board, row: number, col: number): boolean {
        const rows = board.length
        const cols = board[0]?.length ?? 0
        if (col < 0 || col >= cols || row >= rows) return false
        if (row < 0) return true
        return board[row][col] === null
}

/**
  * 지정한 크기의 빈 2차원 보드 배열을 만든다.
  *
  * @param {number} rows - 보드 높이
  * @param {number} cols - 보드 너비
  * @returns {Array<Array<null>>} 빈 보드 배열
  */
export function createEmptyBoard(rows: number, cols: number): Board {
        return Array.from({ length: rows }, () => Array(cols).fill(null))
}

/**
  * 조각이 차지하는 모든 칸이 현재 보드에 유효하게 놓일 수 있는지 검사한다.
  *
  * @param {Array<Array<string|null>>} board - 현재 보드 배열
  * @param {{pieceType: string, rotation: number, row: number, col: number}} piece - 검사할 조각 상태
  * @param {Record<string, Array<Array<[number, number]>>>} blocks - 블록 타입과 회전별 오프셋 정의
  * @returns {boolean} 조각 전체를 배치할 수 있으면 true
  */
export function canPlacePiece(
        board: Board,
        piece: PlaceablePieceState,
        blocks: BlockDefinitions,
): boolean {
        const { pieceType, rotation, row, col } = piece
        return blocks[pieceType][rotation].every(([offsetX, offsetY]) => {
                const targetRow = row + offsetY
                const targetCol = col + offsetX
                return isCellEmpty(board, targetRow, targetCol)
        })
}

/**
  * 현재 조각을 보드 배열에 고정한다.
  * - 화면 바깥 칸은 무시하고, 보드 내부 칸만 실제로 채운다.
  *
  * @param {Array<Array<string|null>>} board - 현재 보드 배열
  * @param {{pieceType: string, rotation: number, row: number, col: number}} piece - 고정할 조각 상태
  * @param {Record<string, Array<Array<[number, number]>>>} blocks - 블록 타입과 회전별 오프셋 정의
  * @returns {void}
  */
export function lockPieceOnBoard(
        board: Board,
        piece: PlaceablePieceState,
        blocks: BlockDefinitions,
): void {
        const { pieceType, rotation, row, col } = piece
        const rows = board.length
        const cols = board[0]?.length ?? 0

        blocks[pieceType][rotation].forEach(([offsetX, offsetY]) => {
                const targetRow = row + offsetY
                const targetCol = col + offsetX
                if (
                        targetRow < 0 ||
                        targetRow >= rows ||
                        targetCol < 0 ||
                        targetCol >= cols
                ) return
                board[targetRow][targetCol] = pieceType
        })
}

/**
  * 조각 cell 중 보드 상단 위에 걸친 칸이 있는지 검사한다.
  *
  * @param {{pieceType: string, rotation: number, row: number, col: number}} piece - 검사할 조각 상태
  * @param {Record<string, Array<Array<[number, number]>>>} blocks - 블록 타입과 회전별 오프셋 정의
  * @returns {boolean} 조각 cell 하나라도 row 0보다 위에 있으면 true
  */
export function isPieceAboveTop(
        piece: PieceState | null | undefined,
        blocks: BlockDefinitions | null | undefined,
): boolean {
        if (!piece?.pieceType || !blocks) return false

        const rotations = blocks[piece.pieceType]
        const cells = rotations?.[piece.rotation]
        if (!Array.isArray(cells)) return false

        return cells.some(([, offsetY]) => piece.row + offsetY < 0)
}

/**
  * 가득 찬 줄을 모두 제거하고, 위쪽에 빈 줄을 추가한다.
  *
  * @param {Array<Array<string|null>>} board - 제자리에서 수정되는 보드 배열
  * @returns {number} 삭제된 줄 개수
  */
export function clearFilledLines(board: Board): number {
        const cols = board[0]?.length ?? 0
        let cleared = 0

        for (let row = board.length - 1; row >= 0; row--) {
                const isFull = board[row].every(cell => cell !== null)
                if (!isFull) continue
                board.splice(row, 1)
                board.unshift(Array(cols).fill(null))
                cleared++
                row++
        }

        return cleared
}
