import { canPlacePiece } from "./board.js"

// =============================
// Movement Resolution (Engine Layer)
// - Determines the outcome of applying a pending move
// =============================

/**
 * pendingPiece 배치를 시도한 결과를 계산하고 active/pending과 상태 코드를 반환한다.
 * - 배치 가능 + moveCause=='hardDrop' → lock (즉시 고정)
 * - 배치 불가 + moveCause=='fall'   → lock (고정)
 * - 배치 불가 + moveCause=='spawn'  → gameOver
 * - 배치 불가(기타)                → retry (롤백)
 * - 배치 가능                      → ok (committed 상태)
 *
 * @param {Object} params - 이동 시도 입력값
 * @param {Array<Array<string|null>>} params.board - 현재 보드 배열
 * @param {{pieceType: string, rotation: number, row: number, col: number}} params.activePiece - 현재 확정 상태
 * @param {{pieceType: string, rotation: number, row: number, col: number}} params.pendingPiece - 이번에 적용하려는 상태
 * @param {string} params.moveCause - 호출 원인('fall' 하강, 'hardDrop', 'horizontal', 'rotate', 'spawn' 등)
 * @param {Record<string, Array<Array<[number, number]>>>} params.blocks - 조각 모양/회전 오프셋
 * @returns {{status: string, active: Object, pending: Object}} 결과 상태 코드와 확정/대기 조각
 */
export function resolveMoveAttempt({ board, activePiece, pendingPiece, moveCause, blocks, wallKicks }) {
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
        // Wall Kick 적용 시도
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
            return {
                status: "gameOver",
                moveCause,
                active: { ...activePiece },
                pending: { ...pendingPiece },
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
 * 이동 결과(outcome)를 실행 의도(intent)로 변환한다.
 * - 이 함수는 상태 판단만 수행하며 DOM/타이머 같은 부수효과는 처리하지 않는다.
 *
 * @param {Object} params - 의도 계산 입력값
 * @param {{status: string, active: Object, pending: Object}} params.outcome - resolveMoveAttempt 결과
 * @param {boolean} params.hasFallTimer - 현재 중력 타이머 동작 여부
 * @returns {{kind: string, active: Object, shouldStartGravity?: boolean}} 실행 의도
 */
export function resolveMoveIntent({ outcome, hasFallTimer }) {
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
