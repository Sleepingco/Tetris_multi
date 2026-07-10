const ONE_PIECE_GAP_GRACE_MS = 750
const SERVER_AHEAD_ONE_PIECE = "SERVER_AHEAD_ONE_PIECE"
const LOCAL_AHEAD_ONE_PIECE = "LOCAL_AHEAD_ONE_PIECE"

function createDecision(shouldCorrect, reason = null, nextPendingDriftState = null) {
    return {
        shouldCorrect,
        reason,
        nextPendingDriftState,
    }
}

function areBoardsEqual(leftBoard, rightBoard) {
    if (!Array.isArray(leftBoard) || !Array.isArray(rightBoard)) return false
    if (leftBoard.length !== rightBoard.length) return false

    for (let row = 0; row < leftBoard.length; row += 1) {
        const leftRow = leftBoard[row]
        const rightRow = rightBoard[row]
        if (!Array.isArray(leftRow) || !Array.isArray(rightRow)) return false
        if (leftRow.length !== rightRow.length) return false

        for (let col = 0; col < leftRow.length; col += 1) {
            if (leftRow[col] !== rightRow[col]) return false
        }
    }

    return true
}

function evaluateOnePieceGap(pieceIndexDelta, previousDriftState, nowMs) {
    const key = pieceIndexDelta > 0
        ? SERVER_AHEAD_ONE_PIECE
        : LOCAL_AHEAD_ONE_PIECE
    const normalizedNowMs = Number.isFinite(nowMs) ? nowMs : 0
    const canContinueWaiting = previousDriftState?.key === key
        && Number.isFinite(previousDriftState.startedAtMs)
        && normalizedNowMs >= previousDriftState.startedAtMs

    if (!canContinueWaiting) {
        return createDecision(false, null, {
            key,
            startedAtMs: normalizedNowMs,
        })
    }

    if (normalizedNowMs - previousDriftState.startedAtMs >= ONE_PIECE_GAP_GRACE_MS) {
        return createDecision(true, "PERSISTENT_PIECE_INDEX_GAP")
    }

    return createDecision(false, null, previousDriftState)
}

/**
 * own authoritative snapshot을 local prediction에 full apply할지 판단한다.
 * - settled board와 큰 pieceIndex 차이는 즉시 보정한다.
 * - 한 조각 차이는 같은 방향으로 일정 시간 유지될 때만 보정한다.
 * - activePiece와 tick 차이는 local prediction 차이로 보고 판단에 사용하지 않는다.
 *
 * @param {Object|null} serverSnapshot - 서버 authoritative snapshot
 * @param {Object|null} localSnapshot - 현재 local prediction snapshot
 * @param {{key: string, startedAtMs: number}|null} previousDriftState - 보류 중인 1-piece gap 상태
 * @param {number} nowMs - monotonic clock 기준 현재 시각
 * @returns {{shouldCorrect: boolean, reason: string|null, nextPendingDriftState: Object|null}}
 */
export function evaluateOwnSnapshotCorrection(
    serverSnapshot,
    localSnapshot,
    previousDriftState = null,
    nowMs = 0,
) {
    if (!serverSnapshot || !localSnapshot) return createDecision(false)
    if (serverSnapshot.phase === "gameOver") {
        return createDecision(true, "GAME_OVER")
    }
    if (localSnapshot.phase === "lineClearing") {
        return createDecision(false)
    }

    const boardsEqual = areBoardsEqual(serverSnapshot.board, localSnapshot.board)
    const didPendingGarbageDecrease = Number.isInteger(serverSnapshot.pendingGarbageLines)
        && Number.isInteger(localSnapshot.pendingGarbageLines)
        && serverSnapshot.pendingGarbageLines < localSnapshot.pendingGarbageLines

    if (didPendingGarbageDecrease && !boardsEqual) {
        return createDecision(true, "GARBAGE_APPLIED")
    }

    const serverPieceIndex = serverSnapshot.pieceIndex
    const localPieceIndex = localSnapshot.pieceIndex
    if (!Number.isInteger(serverPieceIndex) || !Number.isInteger(localPieceIndex)) {
        return createDecision(false)
    }

    const pieceIndexDelta = serverPieceIndex - localPieceIndex
    const pieceIndexGap = Math.abs(pieceIndexDelta)
    if (pieceIndexGap >= 2) {
        return createDecision(true, "PIECE_INDEX_GAP")
    }
    if (pieceIndexGap === 1) {
        return evaluateOnePieceGap(pieceIndexDelta, previousDriftState, nowMs)
    }

    if (!boardsEqual) {
        return createDecision(true, "SETTLED_BOARD_MISMATCH")
    }

    return createDecision(false)
}
