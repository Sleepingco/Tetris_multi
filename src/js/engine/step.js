import { canPlacePiece } from "./board.js"

// =============================
// Movement Resolution (Engine Layer)
// - Determines the outcome of applying a pending move
// =============================

export function resolveMoveAttempt({ board, activePiece, pendingPiece, moveCause, blocks }) {
  if (!pendingPiece.pieceType) {
    return {
      status: "idle",
      active: { ...activePiece },
      pending: { ...pendingPiece },
    }
  }

  const canPlace = canPlacePiece(board, pendingPiece, blocks)
  if (!canPlace) {
    const reverted = { ...activePiece }
    if (moveCause === "retry") {
      return {
        status: "gameOver",
        active: reverted,
        pending: reverted,
      }
    }

    if (moveCause === "top") {
      return {
        status: "lock",
        active: reverted,
        pending: reverted,
      }
    }

    return {
      status: "retry",
      active: reverted,
      pending: reverted,
    }
  }

  const { pieceType, rotation, row, col } = pendingPiece
  const committed = { pieceType, rotation, row, col }

  return {
    status: "ok",
    active: committed,
    pending: committed,
  }
}
