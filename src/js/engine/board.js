// =============================
// Board Utilities (Engine Layer)
// - Pure helpers for board allocation, collision, locking, clearing
// =============================


/**
 * 한 줄 요약: 칸이 비었는지 체크한다
 *
 * 상세 설명:
 *   (필요할 경우) 함수의 내부 동작, 알고리즘, 부수효과 등을 구체적으로 설명한다.
 *
 * @param {타입} 이름 - 파라미터의 의미를 설명.
 * @param {타입} 이름 - (필요시) 형식이나 제약사항도 함께 작성.
 * @returns {타입} 보드(게임판)의 위치에 null을 반환하여 비었다는걸 확인함
 * @throws {Error} 예외 조건 (필요할 경우).
 * @example
 * // 예시
 * const moved = moveBlock(board, 'left');
 * if (!moved) console.log('벽에 막힘');
 */
function isCellEmpty(board, row, col) {
    const rows = board.length
    const cols = board[0]?.length ?? 0
    if (col < 0 || col >= cols || row >= rows) return false
    if (row < 0) return true
    return board[row][col] === null
}

export function createEmptyBoard(rows, cols) {
    return Array.from({ length: rows }, () => Array(cols).fill(null))
}

export function canPlacePiece(board, piece, blocks) {
    const { pieceType, rotation, row, col } = piece
    return blocks[pieceType][rotation].every(([offsetX, offsetY]) => {
        const targetRow = row + offsetY
        const targetCol = col + offsetX
        return isCellEmpty(board, targetRow, targetCol)
    })
}

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
