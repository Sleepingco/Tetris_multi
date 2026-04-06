export function createGameUi({
    scoreEl,
    gameOverEl,
    nextPreviewEl,
    holdPreviewEl,
    nextQueueSize,
    previewSize,
    buildNextPreview,
    buildHoldPreview,
    renderNextPieces,
    renderHoldPiece,
}) {
    let nextPreviewCells = []
    let holdPreviewCells = null

    return {
        renderScore(score) {
            if (!scoreEl) return
            scoreEl.innerText = score
        },
        showGameOver() {
            if (!gameOverEl) return
            gameOverEl.style.display = "flex"
        },
        hideGameOver() {
            if (!gameOverEl) return
            gameOverEl.style.display = "none"
        },
        buildNextPreview() {
            nextPreviewCells = buildNextPreview({
                nextPreviewEl,
                nextQueueSize,
                previewSize,
            })
        },
        buildHoldPreview() {
            holdPreviewCells = buildHoldPreview({
                holdPreviewEl,
                previewSize,
            })
        },
        renderNextPieces(pieceQueue, blocks) {
            renderNextPieces({
                nextPreviewCells,
                pieceQueue,
                blocks,
            })
        },
        renderHoldPiece(holdPieceType, blocks) {
            renderHoldPiece({
                holdPreviewCells,
                holdPieceType,
                blocks,
            })
        },
    }
}
