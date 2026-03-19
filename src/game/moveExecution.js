// =============================
// 런타임 Intent 실행
// 판정이 끝난 intent를 상태, 타이머, UI에 실제로 반영한다.
// =============================

/**
 * 엔진 브리지에서 넘어온 runtime intent를 실행한다.
 * - `gameOver`는 모든 루프를 멈추고 게임오버 UI를 띄운다.
 * - `lock`은 조각을 확정하고 고정 후 처리 흐름으로 넘긴다.
 * - `retry`는 마지막 유효 상태로 되돌린다.
 * - `ok`는 activePiece를 갱신하고 보드를 다시 그린다.
 *
 * @param {{kind: string, moveCause?: string, active: Object, shouldStartGravity?: boolean}} intent - 적용할 런타임 intent
 * @param {Object} deps - 변경 가능한 상태와 부수효과 처리 함수들
 * @returns {void}
 */
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
