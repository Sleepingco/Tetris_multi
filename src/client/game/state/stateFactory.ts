import type { Board } from "../core/board.ts";
import type { PieceState } from "../core/piece.ts";
import type { PieceType } from "./blocks.ts";
import { createLockDelay } from "../core/lockDelay.ts";
import type { LockDelayState } from "../core/lockDelay.ts";

export type GamePhase = "playing" | "lineClearing" | "gameOver";

export type InputAction =
    | "move_left"
    | "move_right"
    | "soft_drop"
    | "rotate"
    | "rotate_ccw"
    | "hard_drop"
    | "hold";

export type QueuedInput = {
    tick: number;
    action: InputAction;
    pieceIndex: number | null;
};

export type CreateGameStateOptions = {
    spawnRow: number;
    spawnCol: number;
    fallIntervalMs: number;
    initialPhase: GamePhase;
};

export type GameState = {
    lockDelay: LockDelayState;
    score: number;
    lines: number;
    fallIntervalMs: number;
    board: Board | null;
    pieceQueue: PieceType[];
    bag: PieceType[];
    holdPieceType: PieceType | null;
    holdUsedThisDrop: boolean;
    activePiece: PieceState;
    pendingPiece: PieceState | null;
    inputQueue: QueuedInput[];
    phase: GamePhase;
    lastActionWasRotation: boolean;
    isTSpin: boolean;
    combo: number;
    backToBack: boolean;
};

// =============================
// 게임 상태 팩토리
// 싱글, 멀티 prediction, 서버 snapshot 복원이 공유하는 변경 가능한 gameplay 상태를 만든다.
// board는 `init` 또는 snapshot 적용 시 채워지고, timer·tick·network 상태는 이 객체에 두지 않는다.
// =============================

/**
  * 새 게임 또는 snapshot 복원의 출발점이 되는 독립적인 gameState를 만든다.
  * `activePiece` 객체 참조는 runtime이 유지하므로 이후 값은 `setActivePiece`가 제자리에서 갱신한다.
  */
export function createGameState({
    spawnRow,
    spawnCol,
    fallIntervalMs,
    initialPhase,
}: CreateGameStateOptions): GameState {
    return {
        lockDelay: createLockDelay(spawnRow),
        score: 0,
        lines: 0,
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
        combo: -1,
        backToBack: false,
    }
}
