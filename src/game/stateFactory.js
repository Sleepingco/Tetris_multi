
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
