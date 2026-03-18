export function applyMoveIntent(intent, { gameState, phases, setActivePiece, stopGameLoops, renderBoard, showGameOver, seizeBlock, startGravity }) {
    if (intent.kind === "gameOver") {
        gameState.phase = phases.GAME_OVER
        gameState.inputQueue = []
        stopGameLoops()
        setActivePiece(intent.active)
        renderBoard()
        showGameOver()
        return
    }

    if (intent.kind === "lock") {
        setActivePiece(intent.active)
        seizeBlock()
        return
    }

    if (intent.kind === "retry") {
        setActivePiece(intent.active)
        renderBoard()
        return
    }

    if (intent.kind === "ok") {
        gameState.phase = phases.PLAYING
        if (intent.shouldStartGravity) startGravity()
        setActivePiece(intent.active)
        if (intent.moveCause) {
            gameState.lastActionWasRotation = (intent.moveCause === "rotate")
        }
        renderBoard()
    }
}
