// =============================
// 조각 생명주기 보조 함수
// bag 랜덤화, next queue 유지, 스폰, 홀드 교체를 담당한다.
// =============================

/**
 * 셔플된 bag 시스템을 사용해 다음 조각 타입을 반환한다.
 * - bag이 비면 다시 채우고 섞는다.
 *
 * @param {Object} gameState - 변경 가능한 게임 상태 객체
 * @param {string[]} pieceTypes - 사용 가능한 조각 타입 목록
 * @returns {string} 다음 조각 타입
 */
export function pickRandomPiece(gameState, pieceTypes) {
    if (!gameState.bag || gameState.bag.length === 0) {
        gameState.bag = [...pieceTypes]
        for (let i = gameState.bag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            ;[gameState.bag[i], gameState.bag[j]] = [gameState.bag[j], gameState.bag[i]]
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
export function ensureQueueFilled(gameState, nextQueueSize, pieceTypes) {
    while (gameState.pieceQueue.length < nextQueueSize + 1) {
        gameState.pieceQueue.push(pickRandomPiece(gameState, pieceTypes))
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
export function takeNextFromQueue(gameState, nextQueueSize, pieceTypes) {
    ensureQueueFilled(gameState, nextQueueSize, pieceTypes)
    const nextType = gameState.pieceQueue.shift()
    ensureQueueFilled(gameState, nextQueueSize, pieceTypes)
    return nextType
}

/**
 * 큐에서 다음 activePiece를 만들고 새 턴을 시작한다.
 *
 * @param {Object} params - 스폰 처리에 필요한 의존성
 * @returns {void}
 */
export function generateNewBlock({
    gameState,
    phases,
    spawnRow,
    spawnCol,
    nextQueueSize,
    pieceTypes,
    setActivePiece,
    renderNextPieces,
    renderBlocks,
    startGravity,
}) {
    gameState.phase = phases.PLAYING
    startGravity()

    const currentType = takeNextFromQueue(gameState, nextQueueSize, pieceTypes)
    const nextActivePiece = {
        pieceType: currentType,
        row: spawnRow,
        col: spawnCol,
        rotation: 0,
    }

    setActivePiece(nextActivePiece)
    gameState.pendingPiece = { ...nextActivePiece }
    gameState.holdUsedThisDrop = false
    renderNextPieces()
    renderBlocks("spawn")
}

/**
 * 한 드롭당 한 번만 홀드할 수 있는 규칙을 지키며 현재 조각과 홀드 슬롯을 교체한다.
 *
 * @param {Object} params - 홀드 처리에 필요한 의존성
 * @returns {void}
 */
export function holdPiece({
    gameState,
    spawnRow,
    spawnCol,
    nextQueueSize,
    pieceTypes,
    setActivePiece,
    renderHoldPiece,
    renderNextPieces,
    renderBlocks,
    startGravity,
    stopGravity,
}) {
    const { activePiece, holdPieceType, holdUsedThisDrop } = gameState
    const currentType = activePiece.pieceType
    if (!currentType || holdUsedThisDrop) return

    stopGravity()

    let incomingType
    if (holdPieceType) {
        incomingType = holdPieceType
        gameState.holdPieceType = currentType
    } else {
        incomingType = takeNextFromQueue(gameState, nextQueueSize, pieceTypes)
        gameState.holdPieceType = currentType
    }

    const swappedPiece = {
        pieceType: incomingType,
        rotation: 0,
        row: spawnRow,
        col: spawnCol,
    }

    setActivePiece(swappedPiece)
    gameState.pendingPiece = { ...swappedPiece }
    gameState.holdUsedThisDrop = true

    renderHoldPiece()
    renderNextPieces()
    startGravity()
    renderBlocks("spawn")
}
