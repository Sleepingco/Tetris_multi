import type { Board, BoardCell } from "./board.ts";

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
    isTSpin?: boolean;
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

export function calculateGarbageAttack({
    linesCleared,
    isTSpin = false,
    combo = 0,
    backToBack = false,
}: GarbageAttackOptions = {}): number {
    if (typeof linesCleared !== "number" || !Number.isInteger(linesCleared) || linesCleared <= 0) {
        return 0;
    }

    const baseAttack = isTSpin
        ? T_SPIN_GARBAGE_ATTACK_BY_LINES[linesCleared] ?? 0
        : BASIC_GARBAGE_ATTACK_BY_LINES[linesCleared] ?? 0;
    const b2bBonus = backToBack && isBackToBackEligible({ linesCleared, isTSpin })
        ? 1
        : 0;

    return baseAttack + getComboBonus(combo) + b2bBonus;
}

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

export function isBackToBackEligible({
    linesCleared,
    isTSpin = false,
}: Pick<GarbageAttackOptions, "linesCleared" | "isTSpin"> = {}): boolean {
    return linesCleared === 4
        || (isTSpin && typeof linesCleared === "number" && linesCleared > 0);
}

function getComboBonus(combo: number): number {
    if (!Number.isInteger(combo) || combo <= 0) return 0;
    if (combo <= 2) return 1;
    if (combo <= 4) return 2;
    return 3;
}
