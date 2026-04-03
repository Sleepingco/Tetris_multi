// =============================
// 라인 클리어 처리
// 고정 이후 애니메이션, 점수 반영, 다음 스폰 흐름을 담당한다.
// =============================

/**
 * 조각이 고정된 뒤 완성된 줄을 처리한다.
 * - 가득 찬 줄이 없으면 바로 다음 조각을 스폰한다.
 * - 가득 찬 줄이 있으면 애니메이션이 끝날 때까지 입력을 멈춘다.
 * - T-Spin 보너스 점수는 보드가 실제로 변경된 뒤에 반영한다.
 *
 * @param {Object} deps - 라인 처리에 필요한 의존성
 * @returns {void}
 */
export function checkMatch({
    gameState,
    phases,
    findFullRows,
    clearFilledLines,
    playLineClearSfx,
    addLineClearEffect,
    renderBoard,
    generateNewBlock,
    renderScore,
    stopGravity,
}) {
    const { fullRows } = findFullRows(gameState.board)
    if (fullRows.length === 0) {
        if (gameState.isTSpin) {
            gameState.score += 15
            renderScore(gameState.score)
        }
        gameState.isTSpin = false
        renderBoard()
        generateNewBlock()
        return
    }

    gameState.phase = phases.LINE_CLEARING
    gameState.inputQueue = []
    stopGravity()
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
