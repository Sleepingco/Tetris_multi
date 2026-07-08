/**
 * 서버 authoritative snapshot으로 내 로컬 prediction을 보정해야 하는지 판단한다.
 * - 내 보드는 조작감 때문에 activePiece 차이만으로 즉시 덮어쓰지 않는다.
 * - 추후 jitter/sequence/ack 기반 보정이 생기면 activePiece 차이는 이 함수 안에서 확장한다.
 *
 * @param {{phase?: string, pieceIndex?: number, score?: number, lines?: number}|null} serverSnapshot - 서버 authoritative snapshot
 * @param {{phase?: string, pieceIndex?: number, score?: number, lines?: number}|null} localSnapshot - 현재 내 로컬 prediction snapshot
 * @returns {boolean} myGame.applySnapshot 후보면 true
 */
export function shouldCorrectMyPrediction(serverSnapshot, localSnapshot) {
    if (!serverSnapshot || !localSnapshot) return false

    if (serverSnapshot.pieceIndex < localSnapshot.pieceIndex) {
        return false
    }

    if (serverSnapshot.pieceIndex > localSnapshot.pieceIndex) {
        return true
    }

    if (localSnapshot.phase !== serverSnapshot.phase) {
        return true
    }

    if (Number.isFinite(localSnapshot.score) && Number.isFinite(serverSnapshot.score)
        && localSnapshot.score !== serverSnapshot.score) {
        return true
    }

    if (Number.isFinite(localSnapshot.lines) && Number.isFinite(serverSnapshot.lines)
        && localSnapshot.lines !== serverSnapshot.lines) {
        return true
    }

    return false
}
