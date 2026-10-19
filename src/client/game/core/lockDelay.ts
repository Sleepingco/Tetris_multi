import { LOCK_DELAY_MS, LOCK_RESET_LIMIT } from "../state/config.ts";

export type LockDelayState = {
    hasTouchedGround: boolean;
    remainingMs: number;
    resetCount: number;
    lowestRow: number;
};

export function createLockDelay(row: number): LockDelayState {
    return { hasTouchedGround: false, remainingMs: LOCK_DELAY_MS, resetCount: 0, lowestRow: row };
}

/** 실제 새 깊이만 한도를 복구하며, 같은 깊이의 회전·이동은 남은 갱신 횟수를 소비한다. */
export function updateLockDelay(
    previous: LockDelayState,
    row: number,
    grounded: boolean,
    elapsedMs = 0,
    reset = false,
): LockDelayState {
    const next = { ...previous };
    if (next.hasTouchedGround) {
        next.remainingMs = Math.max(0, next.remainingMs - Math.max(0, elapsedMs));
    }
    if (row > next.lowestRow) {
        next.lowestRow = row;
        next.remainingMs = LOCK_DELAY_MS;
        next.resetCount = 0;
    } else if (reset && next.hasTouchedGround && next.remainingMs > 0 && next.resetCount < LOCK_RESET_LIMIT) {
        next.remainingMs = LOCK_DELAY_MS;
        next.resetCount++;
    }
    if (grounded && !next.hasTouchedGround) {
        next.hasTouchedGround = true;
        next.remainingMs = LOCK_DELAY_MS;
    }
    return next;
}

export function shouldLockPiece(state: LockDelayState, grounded: boolean): boolean {
    return grounded && state.hasTouchedGround && state.remainingMs <= 0;
}
