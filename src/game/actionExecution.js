import { INPUT_ACTION } from "./input.js"

export function shiftActivePiece(gameState, rowDelta, colDelta) {
    if (!gameState.pendingPiece) {
        gameState.pendingPiece = { ...gameState.activePiece }
    }
    gameState.pendingPiece.row += rowDelta
    gameState.pendingPiece.col += colDelta
}

export function changeDirection(gameState, renderBlocks) {
    const { pendingPiece } = gameState
    if (!pendingPiece) return
    const rotation = pendingPiece.rotation
    pendingPiece.rotation = (rotation === 3) ? 0 : rotation + 1
    renderBlocks("rotate")
}

export function hardDrop({ gameState, stopGravity, canPlace, renderBlocks, renderScore }) {
    const { activePiece } = gameState
    if (!activePiece.pieceType) return
    stopGravity()

    const { pieceType, rotation, col, row } = activePiece
    let nextRow = row

    while (canPlace({ pieceType, rotation, col, row: nextRow + 1 })) {
        nextRow++
    }

    gameState.pendingPiece = { ...activePiece, row: nextRow }
    renderBlocks("hardDrop")

    const dropped = nextRow - row
    if (dropped > 0) {
        gameState.score += dropped * 2
        renderScore(gameState.score)
    }
}

export function executeAction(action, { gameState, renderBlocks, canPlace, renderScore, stopGravity, holdPiece }) {
    if (action === INPUT_ACTION.MOVE_RIGHT) {
        shiftActivePiece(gameState, 0, 1)
        renderBlocks("horizontal")
        return
    }

    if (action === INPUT_ACTION.MOVE_LEFT) {
        shiftActivePiece(gameState, 0, -1)
        renderBlocks("horizontal")
        return
    }

    if (action === INPUT_ACTION.SOFT_DROP) {
        shiftActivePiece(gameState, 1, 0)
        renderBlocks("fall")
        return
    }

    if (action === INPUT_ACTION.HARD_DROP) {
        hardDrop({ gameState, stopGravity, canPlace, renderBlocks, renderScore })
        return
    }

    if (action === INPUT_ACTION.ROTATE) {
        changeDirection(gameState, renderBlocks)
        return
    }

    if (action === INPUT_ACTION.HOLD) {
        holdPiece()
    }
}
