/**
 * 두 active piece가 같은 상태인지 비교한다.
 *
 * @param {{pieceType: string, rotation: number, row: number, col: number}|null} left - 로컬 snapshot의 activePiece
 * @param {{pieceType: string, rotation: number, row: number, col: number}|null} right - 원격 snapshot의 activePiece
 * @returns {boolean} 같은 조각 상태면 true
 */
export function isSamePiece(left, right) {
    if (!left && !right) return true
    if (!left || !right) return false

    return (
        left.pieceType === right.pieceType
        && left.rotation === right.rotation
        && left.row === right.row
        && left.col === right.col
    )
}

/**
 * 원격 snapshot을 로컬 표시용 runtime에 적용해야 하는지 판단한다.
 * - 과거 pieceIndex snapshot은 무시한다.
 * - 미래 pieceIndex snapshot은 뒤처진 보드를 따라잡기 위해 적용한다.
 * - 같은 pieceIndex에서는 phase 또는 activePiece 차이가 있을 때만 보정한다.
 *
 * @param {{phase?: string, pieceIndex?: number, activePiece?: Object}|null} localSnapshot - 현재 표시 중인 snapshot
 * @param {{phase?: string, pieceIndex?: number, activePiece?: Object}|null} remoteSnapshot - 새로 받은 snapshot
 * @returns {boolean} applySnapshot이 필요하면 true
 */
export function shouldCorrectSnapshot(localSnapshot, remoteSnapshot) {
    if (!localSnapshot || !remoteSnapshot) return false

    if (remoteSnapshot.phase === "gameOver") {
        return true
    }

    if (remoteSnapshot.pieceIndex < localSnapshot.pieceIndex) {
        return false
    }

    if (remoteSnapshot.pieceIndex > localSnapshot.pieceIndex) {
        return true
    }

    if (localSnapshot.phase !== remoteSnapshot.phase) {
        return true
    }

    if (!isSamePiece(localSnapshot.activePiece, remoteSnapshot.activePiece)) {
        return true
    }

    return false
}
