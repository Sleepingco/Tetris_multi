// =============================
// Board Utilities (Engine Layer)
// - Pure helpers for board allocation, collision, locking, clearing
// =============================

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
