import { resolveAttackState } from "../../core/attackState.ts";
import { calculateGarbageAttack, resolveGarbageCancel, applyGarbageLines } from "../../core/garbage.ts";
import type { GarbageEntry } from "../../core/garbage.ts";
import type { SpinRotation, TSpinType } from "../../core/tSpin.ts";
import { BOARD_ROWS } from "../../state/config.ts";
import { getSpawnedPiece } from "../../core/piece.ts";
import type { PieceType } from "../../state/blocks.ts";
import {
    canPlacePiece,
    clearFilledLines,
    isPieceAboveTop,
    isLockOut,
    lockPieceOnBoard,
} from "../../core/board.ts";
import BLOCKS from "../../state/blocks.ts";
import { normalizePlacement } from "./placementGenerator.ts";
import type { Board } from "../../core/board.ts";
import type { Placement } from "./placementGenerator.ts";

/**
 * 후보 placement를 실제 보드에 놓았을 때의 결과를 원본 변경 없이 계산한다.
 *
 * AI는 선택만 해야 하므로 입력 `board`를 복제하고, lock·line clear·game over는 게임
 * core 함수를 재사용한다. 이 순수 시뮬레이션 덕분에 후보를 여러 개 평가해도 실제
 * gameplay state는 바뀌지 않는다.
 */

function cloneBoard(board: Board): Board | null {
    if (!Array.isArray(board) || board.length === 0) return null;

    const cols = board[0]?.length ?? 0;
    if (cols === 0) return null;
    if (!board.every(row => Array.isArray(row) && row.length === cols)) return null;

    return board.map(row => [...row]);
}

/**
 * placement를 복제된 보드에 고정하고 line clear까지 적용한다.
 * 40행은 전체 상단 고정에서만 종료한다. 완전한 전투 문맥이 있을 때만 garbage/next까지 평가한다.
 * 과거 20행 분석은 기존 partial lock-out 의미를 유지한다.
 *
 * @param {Array<Array<string|null>>} board - placement 적용 전 보드
 * @param {Object} placement - 적용할 placement
 * @returns {{boardAfter: Array<Array<string|null>>, linesCleared: number, gameOver: boolean, placement: Object}|null}
 */
export type PlacementSimulationContext = {
    nextPieceType?: PieceType;
    pendingGarbageQueue?: GarbageEntry[];
    combo?: number;
    backToBack?: boolean;
    tSpinType?: TSpinType;
    spinRotation?: SpinRotation | null;
};

export function simulatePlacement(board: Board, placement: unknown, context: PlacementSimulationContext = {}): {
    boardAfter: Board;
    linesCleared: number;
    gameOver: boolean;
    placement: Placement;
    nextSpawnOutcome: "not_evaluated" | "clear" | "blocked";
} | null {
    const boardAfter = cloneBoard(board);
    const normalizedPlacement = normalizePlacement(placement);
    if (!boardAfter || !normalizedPlacement) return null;
    if (!canPlacePiece(boardAfter, normalizedPlacement, BLOCKS)) return null;

    const bufferRules = board.length === BOARD_ROWS;
    let gameOver = bufferRules ? isLockOut(normalizedPlacement, BLOCKS) : isPieceAboveTop(normalizedPlacement, BLOCKS);
    lockPieceOnBoard(boardAfter, normalizedPlacement, BLOCKS);
    const linesCleared = gameOver
        ? 0
        : clearFilledLines(boardAfter);

    let overflow = false;
    const garbageResolved = Array.isArray(context.pendingGarbageQueue)
        && (context.pendingGarbageQueue.length === 0 || (
            Number.isInteger(context.combo) && typeof context.backToBack === "boolean"
            && (linesCleared === 0 || context.tSpinType !== undefined)
        ));
    if (!gameOver && bufferRules && garbageResolved) {
        const attack = resolveAttackState({ linesCleared, tSpinType: context.tSpinType ?? "none",
            combo: context.combo ?? -1, backToBack: context.backToBack ?? false });
        const canceled = resolveGarbageCancel({ pendingGarbageQueue: context.pendingGarbageQueue,
            rawAttackLines: calculateGarbageAttack(attack) });
        for (const garbage of canceled.pendingGarbageQueue) {
            overflow = applyGarbageLines(boardAfter, garbage).overflow || overflow;
        }
    }
    gameOver = gameOver || overflow;
    const nextSpawnOutcome = !gameOver && bufferRules && garbageResolved && context.nextPieceType
        ? (getSpawnedPiece(boardAfter, context.nextPieceType) ? "clear" : "blocked")
        : "not_evaluated";
    gameOver = gameOver || nextSpawnOutcome === "blocked";
    return {
        nextSpawnOutcome,
        boardAfter,
        linesCleared,
        gameOver,
        placement: normalizedPlacement,
    };
}
