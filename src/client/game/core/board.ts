import type { PieceState, PlaceablePieceState } from "./piece.ts";
import type { BlockDefinitions } from "../state/blocks.ts";

export type BoardCell = string | null;
export type Board = BoardCell[][];

// =============================
// 보드 규칙
// `board[row][col]`이 고정된 블록의 단일 진실 원천이다.
// 배치 검사는 읽기만 하지만, lock과 line clear는 전달받은 board를 제자리에서 변경한다.
// Canvas나 DOM을 모르기 때문에 런타임, 서버, AI 시뮬레이션이 같은 규칙을 재사용할 수 있다.
// =============================


/**
  * 조각의 한 cell이 사용할 수 있는 좌표인지 확인한다.
  * - 화면 위쪽 바깥(`row < 0`)은 스폰 처리를 위해 비어 있다고 본다.
  * - 좌우 경계 밖이나 바닥 아래는 막힌 칸으로 본다.
  * - 보드 안에서는 값이 `null`인 칸만 비어 있다.
  */
function isCellEmpty(board: Board, row: number, col: number): boolean {
        const rows = board.length
        const cols = board[0]?.length ?? 0
        if (col < 0 || col >= cols || row >= rows) return false
        if (row < 0) return true
        return board[row][col] === null
}

/**
  * 지정한 크기의 빈 보드를 만든다.
  * 각 행은 서로 다른 배열이므로 한 행을 수정해도 다른 행이 함께 바뀌지 않는다.
  */
export function createEmptyBoard(rows: number, cols: number): Board {
        return Array.from({ length: rows }, () => Array(cols).fill(null))
}

/**
  * 조각의 기준 좌표에 회전별 cell offset을 더해 모든 칸을 배치할 수 있는지 검사한다.
  * board와 piece를 바꾸지 않는 순수 판정이며, 이동·회전·스폰·AI 후보 검사가 이 함수를 공유한다.
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
  * 움직이던 조각의 cell을 고정 블록인 board에 기록한다.
  * - 전달받은 board를 직접 변경하는 함수다.
  * - 화면 위쪽 cell은 top-out 판정에만 쓰이므로 board에는 기록하지 않는다.
  * - 줄 삭제는 여기서 결정하지 않고 `clearFilledLines`가 별도로 처리한다.
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
  * 고정하려는 조각의 cell 하나라도 보드 위쪽에 남아 있는지 검사한다.
  * 런타임과 서버는 lock 전에 이 결과를 저장하고, board 반영 뒤 top-out으로 종료할지 결정한다.
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
  * 가득 찬 줄을 아래에서 위로 찾아 제거하고 같은 수의 빈 줄을 위에 넣는다.
  * - 전달받은 board의 크기를 유지하면서 제자리에서 변경한다.
  * - 한 줄을 지우면 위 행이 현재 index로 내려오므로 `row++`로 같은 위치를 다시 검사한다.
  * - 반환한 줄 수는 점수, 공격량, 로그 계산의 입력이 된다.
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
