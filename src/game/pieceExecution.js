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

export function ensureQueueFilled(gameState, nextQueueSize, pieceTypes) {
    while (gameState.pieceQueue.length < nextQueueSize + 1) {
        gameState.pieceQueue.push(pickRandomPiece(gameState, pieceTypes))
    }
}

export function takeNextFromQueue(gameState, nextQueueSize, pieceTypes) {
    ensureQueueFilled(gameState, nextQueueSize, pieceTypes)
    const nextType = gameState.pieceQueue.shift()
    ensureQueueFilled(gameState, nextQueueSize, pieceTypes)
    return nextType
}

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
