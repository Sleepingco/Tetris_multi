import { isBackToBackEligible } from "./garbage.ts";
import type { TSpinType } from "./tSpin.ts";

// =============================
// 공격 연속 상태 계산
// 한 조각을 고정한 결과로 현재 공격 계산에 쓸 값과 다음 턴에 저장할 값을 함께 만든다.
// 보드나 gameState를 직접 바꾸지 않으므로 싱글 런타임과 authoritative 서버가 같은 규칙을 재사용한다.
// =============================

export type AttackStateOptions = {
    combo?: number;
    backToBack?: boolean;
    linesCleared?: number;
    tSpinType?: TSpinType;
};

export type AttackStateResult = {
    linesCleared: number;
    tSpinType: TSpinType;
    combo: number;
    backToBack: boolean;
    nextCombo: number;
    nextBackToBack: boolean;
};

/**
 * 직전 연속 상태와 이번 lock 결과를 받아 공격 계산용 상태를 만든다.
 * - `combo`와 `backToBack`은 호출자가 보관하던 이전 상태다.
 * - 반환값의 `combo`/`backToBack`은 이번 공격량 계산에 사용한다.
 * - `nextCombo`/`nextBackToBack`은 다음 조각을 위해 gameState에 다시 저장할 값이다.
 * - 첫 line clear의 combo는 0이고, line clear가 없으면 다음 combo를 -1로 초기화한다.
 *
 * 입력 객체를 변경하지 않으며, 호출자는 다음으로 `calculateGarbageAttack`에 결과를 전달한다.
 */
export function resolveAttackState({
    combo = -1,
    backToBack = false,
    linesCleared = 0,
    tSpinType = "none",
}: AttackStateOptions = {}): AttackStateResult {
    const nextCombo = linesCleared > 0
        ? combo + 1
        : -1;
    const attackCombo = linesCleared > 0
        ? nextCombo
        : 0;
    const nextBackToBack = linesCleared > 0
        ? isBackToBackEligible({ linesCleared, tSpinType })
        : backToBack;

    return {
        linesCleared,
        tSpinType,
        combo: attackCombo,
        backToBack,
        nextCombo,
        nextBackToBack,
    };
}
