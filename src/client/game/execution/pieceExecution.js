// =============================
// 조각 생명주기 보조 함수
// bag 랜덤화와 next queue 유지를 담당한다.
// =============================

/**
 * 셔플된 bag 시스템을 사용해 다음 조각 타입을 반환한다.
 * - bag이 비면 다시 채우고 섞는다.
 *
 * @param {Object} gameState - 변경 가능한 게임 상태 객체
 * @param {string[]} pieceTypes - 사용 가능한 조각 타입 목록
 * @returns {string} 다음 조각 타입
 */
export function pickRandomPiece(gameState, pieceTypes, rng) {
    if (!gameState.bag || gameState.bag.length === 0) {
        gameState.bag = [...pieceTypes]
        for (let i = gameState.bag.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [gameState.bag[i], gameState.bag[j]] = [gameState.bag[j], gameState.bag[i]]
        }
    }
    return gameState.bag.pop()
}

/**
 * 현재 스폰과 미리보기에 필요한 만큼 큐 길이를 유지한다.
 *
 * @param {Object} gameState - 변경 가능한 게임 상태 객체
 * @param {number} nextQueueSize - 화면에 보여줄 다음 조각 개수
 * @param {string[]} pieceTypes - 사용 가능한 조각 타입 목록
 * @returns {void}
 */
export function ensureQueueFilled(gameState, nextQueueSize, pieceTypes, rng) {
    while (gameState.pieceQueue.length < nextQueueSize + 1) {
        gameState.pieceQueue.push(pickRandomPiece(gameState, pieceTypes, rng))
    }
}

/**
 * 큐에서 다음 스폰 조각을 꺼내고, 미리보기 버퍼가 유지되도록 다시 채운다.
 *
 * @param {Object} gameState - 변경 가능한 게임 상태 객체
 * @param {number} nextQueueSize - 화면에 보여줄 다음 조각 개수
 * @param {string[]} pieceTypes - 사용 가능한 조각 타입 목록
 * @returns {string} 지금 스폰할 조각 타입
 */
export function takeNextFromQueue(gameState, nextQueueSize, pieceTypes, rng) {
    ensureQueueFilled(gameState, nextQueueSize, pieceTypes, rng)
    const nextType = gameState.pieceQueue.shift()
    ensureQueueFilled(gameState, nextQueueSize, pieceTypes, rng)
    return nextType
}
