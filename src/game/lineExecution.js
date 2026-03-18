export function checkMatch({
    gameState,
    phases,
    runtime,
    findFullRows,
    clearFilledLines,
    playLineClearSfx,
    addLineClearEffect,
    renderBoard,
    generateNewBlock,
    renderScore,
}) {
    const { fullRows } = findFullRows(gameState.board)
    if (fullRows.length === 0) {
        renderBoard()
        generateNewBlock()
        return
    }

    gameState.phase = phases.LINE_CLEARING
    gameState.inputQueue = []
    clearInterval(runtime.fallTimer)
    playLineClearSfx()

    addLineClearEffect(fullRows, () => {
        const clearedLines = clearFilledLines(gameState.board)
        if (clearedLines > 0) {
            let points = clearedLines * 10
            if (gameState.isTSpin) points *= 5
            gameState.score += points
            renderScore(gameState.score)
        } else if (gameState.isTSpin) {
            gameState.score += 15
            renderScore(gameState.score)
        }

        gameState.isTSpin = false
        renderBoard()
        generateNewBlock()
    })
}
