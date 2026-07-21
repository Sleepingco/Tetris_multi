import { canPlacePiece } from "../../core/board.ts";
import { getHardDropRow } from "../../core/piece.ts";
import {
    resolveInputMoveIntent,
    resolveMoveAttempt,
} from "../../core/step.ts";
import BLOCKS from "../../state/blocks.ts";
import { WALL_KICKS } from "../../state/config.ts";
import {
    canPlacePlacement,
    normalizePlacement,
} from "./placementGenerator.js";

export const REACHABLE_ACTION_ORDER = Object.freeze([
    "move_left",
    "move_right",
    "rotate",
    "soft_drop",
]);

function isRectangularBoard(board) {
    if (!Array.isArray(board) || board.length === 0) return false;

    const cols = board[0]?.length ?? 0;
    if (cols === 0) return false;

    return board.every(row => Array.isArray(row) && row.length === cols);
}

function normalizeActivePiece(activePiece) {
    if (!activePiece || typeof activePiece.pieceType !== "string") return null;

    const rotations = BLOCKS[activePiece.pieceType];
    if (!Array.isArray(rotations) || rotations.length === 0) return null;
    if (
        !Number.isInteger(activePiece.rotation) ||
        activePiece.rotation < 0 ||
        activePiece.rotation >= rotations.length ||
        !Number.isInteger(activePiece.row) ||
        !Number.isInteger(activePiece.col)
    ) {
        return null;
    }

    return {
        pieceType: activePiece.pieceType,
        rotation: activePiece.rotation,
        row: activePiece.row,
        col: activePiece.col,
    };
}

function createStateKey(piece) {
    return `${piece.pieceType}:${piece.rotation}:${piece.row}:${piece.col}`;
}

function createPlacementKey(placement) {
    return `${placement.pieceType}:${placement.rotation}:${placement.row}:${placement.col}`;
}

function createPendingPiece(piece, action) {
    const inputIntent = resolveInputMoveIntent(action);
    if (!inputIntent) return null;

    if (inputIntent.kind === "shift") {
        return {
            ...piece,
            row: piece.row + inputIntent.rowDelta,
            col: piece.col + inputIntent.colDelta,
        };
    }

    if (inputIntent.kind === "rotate") {
        const rotationCount = BLOCKS[piece.pieceType].length;
        return {
            ...piece,
            rotation: (piece.rotation + 1) % rotationCount,
        };
    }

    return null;
}

function resolveReachableState(board, piece, action) {
    const inputIntent = resolveInputMoveIntent(action);
    const pendingPiece = createPendingPiece(piece, action);
    if (!inputIntent || !pendingPiece) return null;

    const outcome = resolveMoveAttempt({
        board,
        activePiece: piece,
        pendingPiece,
        moveCause: inputIntent.moveType,
        blocks: BLOCKS,
        wallKicks: WALL_KICKS,
    });

    return outcome.status === "ok"
        ? { ...outcome.active }
        : null;
}

function createHardDropPlacement(board, piece) {
    const row = getHardDropRow(piece, targetRow => {
        return canPlacePiece(board, {
            ...piece,
            row: targetRow,
        }, BLOCKS);
    });
    if (!canPlacePlacement(board, piece.pieceType, piece.rotation, piece.col, row)) {
        return null;
    }

    return normalizePlacement({
        ...piece,
        row,
    });
}

/**
 * 현재 activePiece에서 실제 입력으로 도달 가능한 최종 placement와 최단 action 계획을 만든다.
 * 같은 길이의 경로는 REACHABLE_ACTION_ORDER 순서로 결정한다.
 *
 * @param {Array<Array<string|null>>} board - 현재 보드
 * @param {{pieceType: string, rotation: number, row: number, col: number}} activePiece - 현재 조각
 * @returns {Array<{placement: Object, plannedActions: string[]}>} 도달 가능한 최종 후보
 */
export function generateReachablePlacements(board, activePiece) {
    if (!isRectangularBoard(board)) return [];

    const initialState = normalizeActivePiece(activePiece);
    if (!initialState || !canPlacePiece(board, initialState, BLOCKS)) return [];

    const queue = [{
        piece: initialState,
        actions: [],
    }];
    const visited = new Set([createStateKey(initialState)]);
    const seenPlacements = new Set();
    const candidates = [];

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
        const current = queue[queueIndex];
        const placement = createHardDropPlacement(board, current.piece);
        if (placement) {
            const placementKey = createPlacementKey(placement);
            if (!seenPlacements.has(placementKey)) {
                seenPlacements.add(placementKey);
                candidates.push({
                    placement,
                    plannedActions: [...current.actions, "hard_drop"],
                });
            }
        }

        REACHABLE_ACTION_ORDER.forEach(action => {
            const nextPiece = resolveReachableState(board, current.piece, action);
            if (!nextPiece) return;

            const stateKey = createStateKey(nextPiece);
            if (visited.has(stateKey)) return;

            visited.add(stateKey);
            queue.push({
                piece: nextPiece,
                actions: [...current.actions, action],
            });
        });
    }

    return candidates;
}
