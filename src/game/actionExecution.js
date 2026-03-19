import { INPUT_ACTION } from "./input.js"

// =============================
// 플레이어 액션 실행
// 정규화된 입력 액션을 pending 또는 active 조각 상태에 반영한다.
// =============================

/**
 * pendingPiece에 행/열 이동량을 더한다.
 * - pendingPiece가 없으면 필요한 시점에만 activePiece를 복사해 만든다.
 *
 * @param {Object} gameState - 변경 가능한 게임 상태 객체
 * @param {number} rowDelta - 적용할 행 이동량
 * @param {number} colDelta - 적용할 열 이동량
 * @returns {void}
 */
export function shiftActivePiece(gameState, rowDelta, colDelta) {
    if (!gameState.pendingPiece) {
        gameState.pendingPiece = { ...gameState.activePiece }
    }
    gameState.pendingPiece.row += rowDelta
    gameState.pendingPiece.col += colDelta
}

/**
 * pendingPiece를 시계 방향으로 회전시키고, 렌더 브리지에 판정을 요청한다.
 *
 * @param {Object} gameState - 변경 가능한 게임 상태 객체
 * @param {Function} renderBlocks - 이동 판정 진입 함수
 * @returns {void}
 */
export function changeDirection(gameState, renderBlocks) {
    const { pendingPiece } = gameState
    if (!pendingPiece) return
    const rotation = pendingPiece.rotation
    pendingPiece.rotation = (rotation === 3) ? 0 : rotation + 1
    renderBlocks("rotate")
}

/**
 * activePiece를 도달 가능한 최하단까지 내리고 하드 드롭 점수를 부여한다.
 *
 * @param {Object} params - 하드 드롭 실행에 필요한 의존성
 * @param {Object} params.gameState - 변경 가능한 게임 상태 객체
 * @param {Function} params.stopGravity - 드롭 확정 전 중력 타이머를 멈추는 함수
 * @param {Function} params.canPlace - 가상 위치 배치 가능 여부 검사 함수
 * @param {Function} params.renderBlocks - 이동 판정 진입 함수
 * @param {Function} params.renderScore - 점수 UI 렌더 함수
 * @returns {void}
 */
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

/**
 * 정규화된 입력 액션을 맞는 게임플레이 처리기로 분기한다.
 *
 * @param {string} action - 입력 큐에서 꺼낸 액션
 * @param {Object} deps - 액션 처리에 필요한 의존성
 * @returns {void}
 */
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
