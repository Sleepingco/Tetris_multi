import { isBackToBackEligible } from "./garbage.ts";

export type AttackStateOptions = {
    combo?: number;
    backToBack?: boolean;
    linesCleared?: number;
    isTSpin?: boolean;
};

export type AttackStateResult = {
    linesCleared: number;
    isTSpin: boolean;
    combo: number;
    backToBack: boolean;
    nextCombo: number;
    nextBackToBack: boolean;
};

/**
 * combo/back-to-back의 공격 계산용 상태와 다음 저장 상태를 계산한다.
 *
 * @param {Object} params - 공격 상태 갱신 입력값
 * @param {number} params.combo - 현재 combo 상태
 * @param {boolean} params.backToBack - 현재 back-to-back 상태
 * @param {number} params.linesCleared - 이번 lock에서 지운 line 수
 * @param {boolean} params.isTSpin - 이번 lock이 T-Spin인지 여부
 * @returns {{
 *   linesCleared: number,
 *   isTSpin: boolean,
 *   combo: number,
 *   backToBack: boolean,
 *   nextCombo: number,
 *   nextBackToBack: boolean
 * }}
 */
export function resolveAttackState({
    combo = -1,
    backToBack = false,
    linesCleared = 0,
    isTSpin = false,
}: AttackStateOptions = {}): AttackStateResult {
    const nextCombo = linesCleared > 0
        ? combo + 1
        : -1;
    const attackCombo = linesCleared > 0
        ? nextCombo
        : 0;
    const nextBackToBack = linesCleared > 0
        ? isBackToBackEligible({ linesCleared, isTSpin })
        : backToBack;

    return {
        linesCleared,
        isTSpin,
        combo: attackCombo,
        backToBack,
        nextCombo,
        nextBackToBack,
    };
}
