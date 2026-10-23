// =============================
// 내 보드 prediction 보정 판단
// 서버 snapshot과 로컬 prediction의 차이가 자연스러운 전송 지연인지 실제 불일치인지 구분한다.
// 상태를 직접 덮어쓰지 않고 결정만 반환하며, multiplayer session이 실제 applySnapshot 시점을 소유한다.
// =============================

const ONE_PIECE_GAP_GRACE_MS = 750
const SERVER_AHEAD_ONE_PIECE = "SERVER_AHEAD_ONE_PIECE"
const LOCAL_AHEAD_ONE_PIECE = "LOCAL_AHEAD_ONE_PIECE"

export type SnapshotDriftState = {
    key: typeof SERVER_AHEAD_ONE_PIECE | typeof LOCAL_AHEAD_ONE_PIECE;
    startedAtMs: number;
};
export type SnapshotCorrectionReason = "PERSISTENT_PIECE_INDEX_GAP" | "GAME_OVER" |
    "LOCAL_FALSE_GAME_OVER" | "GARBAGE_APPLIED" | "PIECE_INDEX_GAP" | "SETTLED_BOARD_MISMATCH";
export type SnapshotCorrectionDecision = {
    shouldCorrect: boolean;
    reason: SnapshotCorrectionReason | null;
    nextPendingDriftState: SnapshotDriftState | null;
};
type CorrectionSnapshot = {
    phase?: string;
    board?: unknown;
    pendingGarbageLines?: number;
    pieceIndex?: number;
};

// 결과 객체 생성과 board 비교는 아래 판정 순서를 읽기 쉽게 만드는 작은 순수 helper다.
function createDecision(
    shouldCorrect: boolean,
    reason: SnapshotCorrectionReason | null = null,
    nextPendingDriftState: SnapshotDriftState | null = null,
): SnapshotCorrectionDecision {
    return {
        shouldCorrect,
        reason,
        nextPendingDriftState,
    }
}

function areBoardsEqual(leftBoard: unknown, rightBoard: unknown): boolean {
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

/**
 * 정확히 한 조각 차이가 잠깐 생긴 경우 같은 방향으로 750ms 지속되는지 확인한다.
 * 첫 관찰 시각과 방향을 `nextPendingDriftState`로 돌려주며, 방향이 바뀌면 대기 시간을 다시 시작한다.
 */
function evaluateOnePieceGap(
    pieceIndexDelta: number,
    previousDriftState: SnapshotDriftState | null,
    nowMs: number,
): SnapshotCorrectionDecision {
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
 * 내 authoritative snapshot을 local prediction에 통째로 적용할지 우선순위대로 판단한다.
 * - game over, 실제 garbage 적용, 두 조각 이상 차이, 같은 pieceIndex의 고정 board 차이는 즉시 보정한다.
 * - 한 조각 차이는 네트워크 왕복 중 흔히 생기므로 같은 방향으로 750ms 지속될 때만 보정한다.
 * - line clear 애니메이션 중에는 완료 전 board와 완료 후 board가 달라 잠시 판단을 보류한다.
 * - activePiece 위치와 tick 차이는 정상적인 local prediction으로 보고 비교 대상에서 제외한다.
 *
 * 반환값은 판단과 다음 drift timer 상태뿐이며 server/local snapshot을 변경하지 않는다.
 */
export function evaluateOwnSnapshotCorrection(
    serverSnapshot: CorrectionSnapshot | null,
    localSnapshot: CorrectionSnapshot | null,
    previousDriftState: SnapshotDriftState | null = null,
    nowMs = 0,
): SnapshotCorrectionDecision {
    if (!serverSnapshot || !localSnapshot) return createDecision(false)
    if (serverSnapshot.phase === "gameOver") {
        return createDecision(true, "GAME_OVER")
    }
    if (localSnapshot.phase === "gameOver" && serverSnapshot.phase === "playing") {
        return createDecision(true, "LOCAL_FALSE_GAME_OVER")
    }
    if (localSnapshot.phase === "lineClearing") {
        return createDecision(false)
    }

    const boardsEqual = areBoardsEqual(serverSnapshot.board, localSnapshot.board)
    const serverPendingGarbageLines = serverSnapshot.pendingGarbageLines
    const localPendingGarbageLines = localSnapshot.pendingGarbageLines
    const didPendingGarbageDecrease = typeof serverPendingGarbageLines === "number"
        && Number.isInteger(serverPendingGarbageLines)
        && typeof localPendingGarbageLines === "number"
        && Number.isInteger(localPendingGarbageLines)
        && serverPendingGarbageLines < localPendingGarbageLines

    if (didPendingGarbageDecrease && !boardsEqual) {
        return createDecision(true, "GARBAGE_APPLIED")
    }

    const serverPieceIndex = serverSnapshot.pieceIndex
    const localPieceIndex = localSnapshot.pieceIndex
    if (typeof serverPieceIndex !== "number" || !Number.isInteger(serverPieceIndex)
        || typeof localPieceIndex !== "number" || !Number.isInteger(localPieceIndex)) {
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
