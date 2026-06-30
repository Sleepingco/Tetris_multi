const BASIC_GARBAGE_ATTACK_BY_LINES = {
    2: 1,
    3: 2,
    4: 4,
};

const T_SPIN_GARBAGE_ATTACK_BY_LINES = {
    1: 2,
    2: 4,
    3: 6,
};

export function calculateGarbageAttack({
    linesCleared,
    isTSpin = false,
    combo = 0,
    backToBack = false,
} = {}) {
    if (!Number.isInteger(linesCleared) || linesCleared <= 0) return 0;

    const baseAttack = isTSpin
        ? T_SPIN_GARBAGE_ATTACK_BY_LINES[linesCleared] ?? 0
        : BASIC_GARBAGE_ATTACK_BY_LINES[linesCleared] ?? 0;
    const b2bBonus = backToBack && isBackToBackEligible({ linesCleared, isTSpin })
        ? 1
        : 0;

    return baseAttack + getComboBonus(combo) + b2bBonus;
}

export function applyGarbageLines(board, { lines, holeCol, cellType = "garbage" } = {}) {
    if (!Array.isArray(board) || board.length === 0) {
        return {
            appliedLines: 0,
            overflow: false,
        };
    }

    const cols = board[0]?.length ?? 0;
    const safeLines = Number.isInteger(lines) && lines > 0 ? lines : 0;
    const safeHoleCol = Number.isInteger(holeCol) && holeCol >= 0 && holeCol < cols
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

function createGarbageLine(cols, holeCol, cellType) {
    return Array.from({ length: cols }, (_, col) => {
        return col === holeCol ? null : cellType;
    });
}

export function isBackToBackEligible({ linesCleared, isTSpin = false } = {}) {
    return linesCleared === 4 || (isTSpin && linesCleared > 0);
}

function getComboBonus(combo) {
    if (!Number.isInteger(combo) || combo <= 0) return 0;
    if (combo <= 2) return 1;
    if (combo <= 4) return 2;
    return 3;
}
