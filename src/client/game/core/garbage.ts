import type { Board, BoardCell } from "./board.ts";
import type { TSpinType } from "./tSpin.ts";

// =============================
// 멀티플레이 garbage 규칙
// line clear 결과를 공격 줄 수로 바꾸고, 대기 공격과 상쇄한 뒤, 필요하면 board에 garbage를 적용한다.
// 공격량과 상쇄 계산은 순수하지만 `applyGarbageLines`만 전달받은 board를 직접 변경한다.
// =============================

const BASIC_GARBAGE_ATTACK_BY_LINES: Record<number, number> = {
    2: 1,
    3: 2,
    4: 4,
};

export type GarbageEntry = {
    lines: number;
    holeCol?: number;
    cellType?: string;
    [key: string]: unknown;
};

export type GarbageAttackOptions = {
    linesCleared?: number;
    tSpinType?: TSpinType;
    combo?: number;
    backToBack?: boolean;
};

export type GarbageCancelOptions = {
    pendingGarbageQueue?: GarbageEntry[];
    rawAttackLines?: number;
};

export type GarbageCancelResult = {
    pendingGarbageQueue: GarbageEntry[];
    incomingGarbageLines: number;
    canceledGarbageLines: number;
    attackLines: number;
};

export type ApplyGarbageOptions = {
    lines?: number;
    holeCol?: number;
    cellType?: string;
};

export type ApplyGarbageResult = {
    appliedLines: number;
    overflow: boolean;
};

const T_SPIN_GARBAGE_ATTACK_BY_LINES: Record<number, number> = {
    1: 2,
    2: 4,
    3: 6,
};
const MINI_GARBAGE_ATTACK_BY_LINES: Record<number, number> = {
    1: 1,
    2: 2,
};

/**
 * 이번 lock의 line clear, T-Spin, combo, back-to-back을 최종 공격 줄 수로 바꾼다.
 * board나 연속 상태를 변경하지 않으며, 먼저 `resolveAttackState`로 만든 현재 공격 상태를 받는다.
 */
export function calculateGarbageAttack({
    linesCleared,
    tSpinType = "none",
    combo = 0,
    backToBack = false,
}: GarbageAttackOptions = {}): number {
    if (typeof linesCleared !== "number" || !Number.isInteger(linesCleared) || linesCleared <= 0) {
        return 0;
    }

    const baseAttack = tSpinType === "full"
        ? T_SPIN_GARBAGE_ATTACK_BY_LINES[linesCleared] ?? 0
        : tSpinType === "mini"
            ? MINI_GARBAGE_ATTACK_BY_LINES[linesCleared] ?? 0
            : BASIC_GARBAGE_ATTACK_BY_LINES[linesCleared] ?? 0;
    const b2bBonus = backToBack && isBackToBackEligible({ linesCleared, tSpinType })
        ? 1
        : 0;

    return baseAttack + getComboBonus(combo) + b2bBonus;
}

/**
 * 내가 보낼 공격을 먼저 들어와 있던 garbage와 FIFO 순서로 상쇄한다.
 * - 원본 queue entry를 복제하므로 호출자가 가진 대기열은 변경하지 않는다.
 * - `pendingGarbageQueue`는 상쇄 후 남은 방어 부담, `attackLines`는 상대에게 보낼 나머지다.
 * - `incomingGarbageLines`는 처리 전 총량이라 로그와 UI에서 원래 위협을 설명할 수 있다.
 */
export function resolveGarbageCancel({
    pendingGarbageQueue = [],
    rawAttackLines = 0,
}: GarbageCancelOptions = {}): GarbageCancelResult {
    const nextPendingGarbageQueue = Array.isArray(pendingGarbageQueue)
        ? pendingGarbageQueue.map(garbage => ({ ...garbage }))
        : [];
    const incomingGarbageLines = nextPendingGarbageQueue.reduce((total, garbage) => {
        return total + garbage.lines;
    }, 0);
    let remainingAttackLines = rawAttackLines;
    let canceledGarbageLines = 0;

    while (remainingAttackLines > 0 && nextPendingGarbageQueue.length > 0) {
        const nextGarbage = nextPendingGarbageQueue[0];
        const cancelLines = Math.min(remainingAttackLines, nextGarbage.lines);

        nextGarbage.lines -= cancelLines;
        remainingAttackLines -= cancelLines;
        canceledGarbageLines += cancelLines;

        if (nextGarbage.lines === 0) {
            nextPendingGarbageQueue.shift();
        }
    }

    return {
        pendingGarbageQueue: nextPendingGarbageQueue,
        incomingGarbageLines,
        canceledGarbageLines,
        attackLines: remainingAttackLines,
    };
}

/**
 * garbage 줄을 board 아래에 추가하고 기존 줄을 위로 밀어낸다.
 * - 전달받은 board를 직접 변경한다.
 * - 밀려나간 맨 윗줄에 블록이 있었다면 `overflow`로 top-out 가능성을 알린다.
 * - hole 위치가 유효하지 않으면 가운데 column을 안전한 기본값으로 사용한다.
 */
export function applyGarbageLines(
    board: Board,
    { lines, holeCol, cellType = "garbage" }: ApplyGarbageOptions = {},
): ApplyGarbageResult {
    if (!Array.isArray(board) || board.length === 0) {
        return {
            appliedLines: 0,
            overflow: false,
        };
    }

    const cols = board[0]?.length ?? 0;
    const safeLines = typeof lines === "number" && Number.isInteger(lines) && lines > 0 ? lines : 0;
    const safeHoleCol = typeof holeCol === "number"
        && Number.isInteger(holeCol)
        && holeCol >= 0
        && holeCol < cols
        ? holeCol
        : Math.floor(cols / 2);
    let overflow = false;
    let appliedLines = 0;

    for (let i = 0; i < safeLines; i++) {
        const removedRow = board.shift();
        if (removedRow?.some(cell => cell !== null)) {
            overflow = true;
        }

        board.push(createGarbageLine(cols, safeHoleCol, cellType));
        appliedLines++;
    }

    return {
        appliedLines,
        overflow,
    };
}

function createGarbageLine(cols: number, holeCol: number, cellType: string): BoardCell[] {
    return Array.from({ length: cols }, (_, col) => {
        return col === holeCol ? null : cellType;
    });
}

/**
 * Tetris(4줄) 또는 line clear가 있는 T-Spin인지 확인한다.
 * 공격 보너스 판정과 다음 back-to-back 상태 갱신이 이 한 기준을 공유한다.
 */
export function isBackToBackEligible({
    linesCleared,
    tSpinType = "none",
}: Pick<GarbageAttackOptions, "linesCleared" | "tSpinType"> = {}): boolean {
    return linesCleared === 4
        || (tSpinType !== "none" && linesCleared !== undefined && linesCleared > 0);
}

function getComboBonus(combo: number): number {
    if (!Number.isInteger(combo) || combo <= 0) return 0;
    if (combo <= 2) return 1;
    if (combo <= 4) return 2;
    return 3;
}
