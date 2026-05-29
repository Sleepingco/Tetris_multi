import { canPlacePiece } from "./board.js"

// =============================
// 이동 판정 (엔진 계층)
// 부수효과 없이 pending move의 결과만 계산한다.
// =============================

/**
  * `pendingPiece`를 적용하려는 시도의 결과를 계산한다.
  * - 유효한 하드 드롭이면 즉시 고정한다.
  * - 하강 실패면 이전 active 위치에서 고정한다.
  * - 스폰 실패면 게임오버로 처리한다.
  * - 그 외 실패는 이전 확정 상태로 되돌린다.
  *
  * @param {Object} params - 이동 판정 입력값
  * @param {Array<Array<string|null>>} params.board - 현재 보드 배열
  * @param {{pieceType: string, rotation: number, row: number, col: number}} params.activePiece - 마지막으로 확정된 조각 상태
  * @param {{pieceType: string, rotation: number, row: number, col: number}} params.pendingPiece - 이번에 시도할 후보 조각 상태
  * @param {string} params.moveCause - 시도 원인 (`fall`, `hardDrop`, `horizontal`, `rotate`, `spawn` 등)
  * @param {Record<string, Array<Array<[number, number]>>>} params.blocks - 블록 타입과 회전별 오프셋 정의
  * @param {Object} params.wallKicks - 회전 충돌 시 사용할 wall kick 테이블
  * @returns {{status: string, moveCause: string, active: Object, pending: Object}} 런타임 계층으로 넘길 엔진 판정 결과
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
  * 순수 엔진 판정 결과를 런타임 intent로 바꾼다.
  * - 이 함수도 여전히 부수효과 없이 다음 행동의 종류만 정한다.
  *
  * @param {Object} params - intent 계산 입력값
  * @param {{status: string, active: Object, pending: Object}} params.outcome - `resolveMoveAttempt` 결과
  * @param {boolean} params.hasFallTimer - 현재 중력 타이머가 이미 동작 중인지 여부
  * @returns {{kind: string, moveCause: string, active: Object, shouldStartGravity?: boolean}} 런타임 실행 의도
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
