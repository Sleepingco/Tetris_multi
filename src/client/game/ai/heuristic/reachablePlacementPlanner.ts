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
} from "./placementGenerator.ts";
import type { Board } from "../../core/board.ts";
import type { PlaceablePieceState } from "../../core/piece.ts";
import type { PieceType } from "../../state/blocks.ts";
import type { Placement } from "./placementGenerator.ts";

/**
 * 현재 조각에서 실제 키 입력으로 도달할 수 있는 placement만 만든다.
 *
 * 빈 칸에 수학적으로 들어가는 위치를 모두 만드는 것이 아니라, 게임 core의 이동·회전
 * 판정을 그대로 사용해 BFS로 탐색한다. 따라서 여기서 만든 후보와 `plannedActions`는
 * heuristic 평가, dataset 생성, PVE 실행이 공유하는 하나의 후보 계약이다.
 */

export type ReachableAction = "move_left" | "move_right" | "rotate" | "rotate_ccw" | "soft_drop" | "hard_drop";
export type ReachablePlacement = {
    placement: Placement;
    plannedActions: ReachableAction[];
};

export const REACHABLE_ACTION_ORDER: ReadonlyArray<Exclude<ReachableAction, "hard_drop">> = Object.freeze([
    "move_left",
    "move_right",
    "rotate",
    "rotate_ccw",
    "soft_drop",
]);

function isRectangularBoard(board: Board): boolean {
    if (!Array.isArray(board) || board.length === 0) return false;

    const cols = board[0]?.length ?? 0;
    if (cols === 0) return false;

    return board.every(row => Array.isArray(row) && row.length === cols);
}

function isPieceType(value: unknown): value is PieceType {
    return typeof value === "string" && Object.hasOwn(BLOCKS, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeActivePiece(activePiece: unknown): PlaceablePieceState | null {
    if (!isRecord(activePiece) || !isPieceType(activePiece.pieceType)) return null;

    const rotations = BLOCKS[activePiece.pieceType];
    if (!Array.isArray(rotations) || rotations.length === 0) return null;
    if (
        typeof activePiece.rotation !== "number" ||
        !Number.isInteger(activePiece.rotation) ||
        activePiece.rotation < 0 ||
        activePiece.rotation >= rotations.length ||
        typeof activePiece.row !== "number" || !Number.isInteger(activePiece.row) ||
        typeof activePiece.col !== "number" || !Number.isInteger(activePiece.col)
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

function createStateKey(piece: PlaceablePieceState): string {
    return `${piece.pieceType}:${piece.rotation}:${piece.row}:${piece.col}`;
}

function createPlacementKey(placement: Placement): string {
    return `${placement.pieceType}:${placement.rotation}:${placement.row}:${placement.col}`;
}

function createPendingPiece(
    piece: PlaceablePieceState,
    action: Exclude<ReachableAction, "hard_drop">,
): PlaceablePieceState | null {
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
        const direction = inputIntent.direction;
        const rotationCount = BLOCKS[piece.pieceType].length;

        if (direction === "cw") {
            return {
                ...piece,
                rotation: (piece.rotation + 1) % rotationCount,
            };
        } else if (direction === "ccw") {
            return {
                ...piece,
                rotation: (piece.rotation - 1 + rotationCount) % rotationCount,
            };
        }

    }

    return null;
}

function resolveReachableState(
    board: Board,
    piece: PlaceablePieceState,
    action: Exclude<ReachableAction, "hard_drop">,
): PlaceablePieceState | null {
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

    return outcome.status === "ok" && outcome.active.pieceType
        ? { ...outcome.active }
        : null;
}

function createHardDropPlacement(board: Board, piece: PlaceablePieceState): Placement | null {
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
 * - 같은 조각 상태를 다시 탐색하지 않아 순환을 막는다.
 * - 각 상태에서 hard drop한 결과를 최종 후보로 기록한다.
 * - 같은 길이의 경로는 REACHABLE_ACTION_ORDER 순서로 결정한다.
 *
 * @param {Array<Array<string|null>>} board - 현재 보드
 * @param {{pieceType: string, rotation: number, row: number, col: number}} activePiece - 현재 조각
 * @returns {Array<{placement: Object, plannedActions: string[]}>} 도달 가능한 최종 후보
 */
export function generateReachablePlacements(
    board: Board,
    activePiece: unknown,
): ReachablePlacement[] {
    if (!isRectangularBoard(board)) return [];

    const initialState = normalizeActivePiece(activePiece);
    if (!initialState || !canPlacePiece(board, initialState, BLOCKS)) return [];

    const queue: Array<{ piece: PlaceablePieceState; actions: ReachableAction[] }> = [{
        piece: initialState,
        actions: [],
    }];
    const visited = new Set([createStateKey(initialState)]);
    const seenPlacements = new Set();
    const candidates: ReachablePlacement[] = [];

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
