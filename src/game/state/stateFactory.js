// =============================
// 게임 상태 팩토리
// 싱글 플레이 런타임에서 사용하는 상태 객체를 생성한다.
// =============================

/**
 * 기본 런타임 필드를 포함한 새 gameState 객체를 만든다.
 *
 * @param {Object} params - 초기 상태 설정값
 * @param {number} params.spawnRow - activePiece 기본 스폰 행
 * @param {number} params.spawnCol - activePiece 기본 스폰 열
 * @param {number} params.fallIntervalMs - 초기 중력 간격
 * @param {string} params.initialPhase - 시작 phase
 * @returns {Object} 변경 가능한 게임 상태 객체
 */
export function createGameState({ spawnRow, spawnCol, fallIntervalMs, initialPhase }) {
    return {
        score: 0,
        fallIntervalMs: fallIntervalMs,
        board: null,
        pieceQueue: [],
        bag: [],
        holdPieceType: null,
        holdUsedThisDrop: false,
        activePiece: {
            pieceType: "",
            rotation: 0,
            row: spawnRow,
            col: spawnCol,
        },
        pendingPiece: null,
        inputQueue: [],
        phase: initialPhase,
        lastActionWasRotation: false,
        isTSpin: false,
    }
}
