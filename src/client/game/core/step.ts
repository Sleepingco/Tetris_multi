import { canPlacePiece } from "./board.ts"
import type { Board } from "./board.ts";
import type { PieceState } from "./piece.ts";
import type { BlockDefinitions } from "../state/blocks.ts";
import type { WallKickTable } from "../state/config.ts";

export type InputMoveIntent = {
    kind: "shift";
    rowDelta: number;
    colDelta: number;
    moveType: "horizontal" | "fall";
} | {
    kind: "rotate";
    moveType: "rotate";
    direction: "cw" | "ccw";
};

export type MoveStatus = "idle" | "lock" | "ok" | "gameOver" | "retry";

export type MoveOutcome = {
    status: MoveStatus;
    moveCause: string;
    active: PieceState;
    pending: PieceState;
};

export type MoveIntent = {
    kind: MoveStatus;
    moveCause: string;
    active: PieceState;
    shouldStartGravity?: boolean;
};

export type ResolveMoveAttemptOptions = {
    board: Board;
    activePiece: PieceState;
    pendingPiece: PieceState;
    moveCause: string;
    blocks: BlockDefinitions;
    wallKicks?: WallKickTable | null;
};

// =============================
// 한 번의 이동 판정
// action → 이동 후보(pendingPiece) → 충돌/SRS 판정 → runtime intent 순서로 변환한다.
// 이 파일은 board와 piece를 직접 변경하지 않으므로 브라우저 런타임, 서버, AI 탐색이 함께 사용한다.
// `activePiece`는 마지막 확정 위치이고 `pendingPiece`는 이번에 시험할 후보 위치다.
// =============================

/**
  * 입력 계층의 action을 core가 이해하는 최소 이동 의도로 바꾼다.
  * hold와 hard drop은 별도 실행 순서가 필요하므로 여기서 처리하지 않고 null을 반환한다.
  */
export function resolveInputMoveIntent(action: string): InputMoveIntent | null {
    if (action === "move_left") {
        return {
            kind: "shift",
            rowDelta: 0,
            colDelta: -1,
            moveType: "horizontal",
        };
    }

    if (action === "move_right") {
        return {
            kind: "shift",
            rowDelta: 0,
            colDelta: 1,
            moveType: "horizontal",
        };
    }

    if (action === "soft_drop") {
        return {
            kind: "shift",
            rowDelta: 1,
            colDelta: 0,
            moveType: "fall",
        };
    }

    if (action === "rotate") {
        return {
            kind: "rotate",
            moveType: "rotate",
            direction: "cw",
        };
    }
    if (action === "rotate_ccw") {
        return {
            kind: "rotate",
            moveType: "rotate",
            direction: "ccw",
        };
    }

    return null;
}

/**
  * `pendingPiece`를 board에 적용할 수 있는지 검사해 다음 확정 상태를 계산한다.
  * - 유효한 하드 드롭이면 즉시 고정한다.
  * - 자동/소프트 하강 실패면 마지막으로 유효했던 active 위치에서 고정한다.
  * - 스폰 실패면 게임오버로 처리한다.
  * - 회전만 실패했다면 SRS kick offset을 순서대로 시험한 뒤, 모두 실패하면 active로 되돌린다.
  *
  * 입력 객체를 직접 바꾸지 않고 새 객체를 반환한다. 다음 호출은 `resolveMoveIntent`다.
  */
export function resolveMoveAttempt({
    board,
    activePiece,
    pendingPiece,
    moveCause,
    blocks,
    wallKicks,
}: ResolveMoveAttemptOptions): MoveOutcome {
    if (!pendingPiece.pieceType) {
        return {
            status: "idle",
            moveCause,
            active: { ...activePiece },
            pending: { ...pendingPiece },
        }
    }

    const canPlace = canPlacePiece(board, pendingPiece, blocks)
    if (moveCause === "hardDrop" && canPlace) {
        return {
            status: "lock",
            moveCause,
            active: { ...pendingPiece },
            pending: { ...pendingPiece },
        }
    }
    if (!canPlace) {
        // 회전 충돌 시 SRS kick 오프셋을 먼저 시도한다.
        if (moveCause === "rotate" && wallKicks && activePiece.pieceType !== "square") {
            const pieceType = activePiece.pieceType;
            const kickType = pieceType === "bar" ? "bar" : "normal";
            const key = `${activePiece.rotation}->${pendingPiece.rotation}`;
            const tests = wallKicks[kickType] && wallKicks[kickType][key];

            if (tests) {
                for (let i = 0; i < tests.length; i++) {
                    const [offsetX, offsetY] = tests[i];
                    const testPiece = {
                        ...pendingPiece,
                        col: pendingPiece.col + offsetX,
                        row: pendingPiece.row + offsetY
                    };
                    if (canPlacePiece(board, testPiece, blocks)) {
                        return {
                            status: "ok",
                            moveCause,
                            active: testPiece,
                            pending: testPiece,
                        };
                    }
                }
            }
        }

        if (moveCause === "spawn") {
            const clearedPiece: PieceState = {
                ...pendingPiece,
                pieceType: "",
            };
            return {
                status: "gameOver",
                moveCause,
                active: { ...clearedPiece },
                pending: { ...clearedPiece },
            }
        }
        const reverted = { ...activePiece }
        if (moveCause === "fall") {
            return {
                status: "lock",
                moveCause,
                active: reverted,
                pending: reverted,
            }
        }

        return {
            status: "retry",
            moveCause,
            active: reverted,
            pending: reverted,
        }
    }

    const { pieceType, rotation, row, col } = pendingPiece
    const committed = { pieceType, rotation, row, col }

    return {
        status: "ok",
        moveCause,
        active: committed,
        pending: committed,
    }
}

/**
  * core 판정 결과를 runtime이 실행할 명령 모양으로 정리한다.
  * 여전히 상태를 바꾸지 않으며, runtime은 반환된 `kind`에 따라 lock, game over, 복구, 렌더를 수행한다.
  * 성공한 이동에서만 중력이 꺼져 있었는지 확인해 `shouldStartGravity`를 함께 전달한다.
  */
export function resolveMoveIntent({
    outcome,
    hasFallTimer,
}: {
    outcome: MoveOutcome;
    hasFallTimer: boolean;
}): MoveIntent {
    if (outcome.status === "lock") {
        return { kind: "lock", moveCause: outcome.moveCause, active: { ...outcome.active } }
    }
    if (outcome.status === "gameOver") {
        return { kind: "gameOver", moveCause: outcome.moveCause, active: { ...outcome.active } }
    }
    if (outcome.status === "retry") {
        return { kind: "retry", moveCause: outcome.moveCause, active: { ...outcome.active } }
    }
    if (outcome.status === "ok") {
        return {
            kind: "ok",
            moveCause: outcome.moveCause,
            active: { ...outcome.active },
            shouldStartGravity: !hasFallTimer,
        }
    }
    return { kind: "idle", moveCause: outcome.moveCause, active: { ...outcome.active } }
}
