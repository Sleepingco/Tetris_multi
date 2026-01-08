// =============================
// Board Utilities (Engine Layer)
// - Pure helpers for board allocation, collision, locking, clearing
// =============================


/**
 * 보드 좌표가 비어 있는지 확인한다. 상단 밖(row < 0)은 허용, 나머지 경계 밖은 막힌 것으로 본다.
 *
 * @param {Array<Array<string|null>>} board - 현재 보드 배열
 * @param {number} row - 검사할 행(스폰 위 영역은 음수 가능)
 * @param {number} col - 검사할 열
 * @returns {boolean} 비어 있으면 true, 아니면 false
 */
function isCellEmpty(board, row, col) {
    const rows = board.length
    const cols = board[0]?.length ?? 0
    if (col < 0 || col >= cols || row >= rows) return false
    if (row < 0) return true
    return board[row][col] === null
}

/**
 * ROWS x COLS 크기의 비어 있는 2D 보드를 만든다.
 *
 * @param {number} rows - 보드 높이
 * @param {number} cols - 보드 너비
 * @returns {Array<Array<null>>} 빈 보드
 */
export function createEmptyBoard(rows, cols) {
    return Array.from({ length: rows }, () => Array(cols).fill(null))
}

/**
 * 조각의 모든 블록이 현재 보드에 유효하게 놓일 수 있는지 검사한다.
 *
 * @param {Array<Array<string|null>>} board - 현재 보드 배열
 * @param {{pieceType: string, rotation: number, row: number, col: number}} piece - 배치하려는 조각 상태
 * @param {Record<string, Array<Array<[number, number]>>>} blocks - 조각 모양/회전 오프셋
 * @returns {boolean} 전부 유효하면 true
 */
export function canPlacePiece(board, piece, blocks) {
    const { pieceType, rotation, row, col } = piece
    return blocks[pieceType][rotation].every(([offsetX, offsetY]) => {
        const targetRow = row + offsetY
        const targetCol = col + offsetX
        return isCellEmpty(board, targetRow, targetCol)
    })
}

/**
 * 조각 블록을 보드에 고정한다. 경계 밖은 무시하고 보드 안만 채운다.
 *
 * @param {Array<Array<string|null>>} board - 현재 보드 배열
 * @param {{pieceType: string, rotation: number, row: number, col: number}} piece - 고정할 조각 상태
 * @param {Record<string, Array<Array<[number, number]>>>} blocks - 조각 모양/회전 오프셋
 */
export function lockPieceOnBoard(board, piece, blocks) {
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
 * 가득 찬 줄을 모두 삭제하고 맨 위에 빈 줄을 추가한다. 삭제한 줄 수를 반환한다.
 *
 * @param {Array<Array<string|null>>} board - 현재 보드 배열(제자리 수정)
 * @returns {number} 지워진 줄 개수
 */
export function clearFilledLines(board) {
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
