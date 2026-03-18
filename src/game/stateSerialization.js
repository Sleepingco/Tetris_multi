import { createGameState } from "./stateFactory.js"

function cloneBoard(board) {
    if (!Array.isArray(board)) return null
    return board.map(row => [...row])
}

function clonePiece(piece) {
    if (!piece) return null
    return {
        pieceType: piece.pieceType,
        rotation: piece.rotation,
        row: piece.row,
        col: piece.col,
    }
}

export function serializeGameState(gameState) {
    return {
        score: gameState.score,
        fallIntervalMs: gameState.fallIntervalMs,
        board: cloneBoard(gameState.board),
        pieceQueue: [...gameState.pieceQueue],
        bag: [...gameState.bag],
        holdPieceType: gameState.holdPieceType,
        holdUsedThisDrop: gameState.holdUsedThisDrop,
        activePiece: clonePiece(gameState.activePiece),
        pendingPiece: clonePiece(gameState.pendingPiece),
        inputQueue: [...gameState.inputQueue],
        phase: gameState.phase,
        lastActionWasRotation: gameState.lastActionWasRotation,
        isTSpin: gameState.isTSpin,
    }
}

export function deserializeGameState(snapshot, defaults) {
    const gameState = createGameState(defaults)

    gameState.score = snapshot.score ?? gameState.score
    gameState.fallIntervalMs = snapshot.fallIntervalMs ?? gameState.fallIntervalMs
    gameState.board = cloneBoard(snapshot.board)
    gameState.pieceQueue = Array.isArray(snapshot.pieceQueue) ? [...snapshot.pieceQueue] : []
    gameState.bag = Array.isArray(snapshot.bag) ? [...snapshot.bag] : []
    gameState.holdPieceType = snapshot.holdPieceType ?? null
    gameState.holdUsedThisDrop = Boolean(snapshot.holdUsedThisDrop)
    gameState.activePiece = clonePiece(snapshot.activePiece) ?? gameState.activePiece
    gameState.pendingPiece = clonePiece(snapshot.pendingPiece)
    gameState.inputQueue = Array.isArray(snapshot.inputQueue) ? [...snapshot.inputQueue] : []
    gameState.phase = snapshot.phase ?? gameState.phase
    gameState.lastActionWasRotation = Boolean(snapshot.lastActionWasRotation)
    gameState.isTSpin = Boolean(snapshot.isTSpin)

    return gameState
}
