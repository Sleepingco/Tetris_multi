import { createGameState } from "./stateFactory.js"

// =============================
// 상태 스냅샷 보조 함수
// 저장, 복원, 멀티플레이 동기화를 위해 런타임 상태를 복제한다.
// =============================

/**
  * 스냅샷에 사용할 보드 배열의 충분한 깊이 복사본을 만든다.
  *
  * @param {Array<Array<string|null>>|null} board - 복제할 보드 배열
  * @returns {Array<Array<string|null>>|null} 복제된 보드 또는 null
  */
function cloneBoard(board) {
        if (!Array.isArray(board)) return null
        return board.map(row => [...row])
}

/**
  * 조각 객체를 스냅샷에 안전한 평범한 객체로 복사한다.
  *
  * @param {{pieceType: string, rotation: number, row: number, col: number}|null} piece - 복제할 조각 상태
  * @returns {{pieceType: string, rotation: number, row: number, col: number}|null} 복제된 조각 또는 null
  */
function clonePiece(piece) {
        if (!piece) return null
        return {
                pieceType: piece.pieceType,
                rotation: piece.rotation,
                row: piece.row,
                col: piece.col,
        }
}

/**
  * 변경 가능한 런타임 상태를 분리된 스냅샷 객체로 직렬화한다.
  *
  * @param {Object} gameState - 변경 가능한 게임 상태 객체
  * @returns {Object} 직렬화 가능한 스냅샷
  */
export function serializeGameState(gameState) {
        return {
                score: gameState.score,
                lines: gameState.lines,
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
                combo: gameState.combo,
                backToBack: gameState.backToBack,
        }
}

/**
  * 분리된 스냅샷으로부터 다시 변경 가능한 런타임 상태를 복원한다.
  *
  * @param {Object} snapshot - 직렬화된 상태 스냅샷
  * @param {Object} defaults - 상태 팩토리 기본 입력값
  * @returns {Object} 복원된 게임 상태 객체
  */
export function deserializeGameState(snapshot, defaults) {
        const gameState = createGameState(defaults)

        gameState.score = snapshot.score ?? gameState.score
        gameState.lines = snapshot.lines ?? gameState.lines
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
        gameState.combo = Number.isInteger(snapshot.combo) ? snapshot.combo : gameState.combo
        gameState.backToBack = Boolean(snapshot.backToBack)

        return gameState
}
