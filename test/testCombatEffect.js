const test = require("node:test");
const assert = require("node:assert/strict");
const { createCombatEffect } = require("../dist/server/server/services/playerGameplayStep.js");

const gameId = "00000000-0000-4000-8000-000000000003";
const result = {
    pieceIndex: 4, linesCleared: 4, isTSpin: false, tSpinType: "none", combo: 0, backToBack: false,
    rawAttackLines: 4, attackLines: 4, canceledGarbageLines: 0, appliedGarbageLines: 0,
};

test("전송 표시는 실제 queue 성공량만 사용하고 gameplay 원본을 변경하지 않는다", () => {
    const placement = structuredClone(result);
    const transfer = { ok: true, targetPlayerId: "opponent", garbage: { lines: 2 } };
    const effect = createCombatEffect(gameId, "actor", placement, transfer);
    assert.equal(effect.sentLines, 2);
    assert.equal(effect.targetPlayerId, "opponent");
    assert.deepEqual(placement, result);
    assert.equal(createCombatEffect(gameId, "actor", result, { ...transfer, ok: false }).sentLines, 0);
    assert.equal(createCombatEffect(gameId, "actor", result, null).sentLines, 0);
    assert.notEqual(effect.id, createCombatEffect("other-match", "actor", result, transfer).id);
});

test("완전 상쇄와 줄 삭제 없는 피격도 0줄 전송과 독립적인 확정 결과를 표시한다", () => {
    const canceled = createCombatEffect(gameId, "actor", {
        ...result, attackLines: 0, canceledGarbageLines: 4,
    }, null);
    assert.equal(canceled.sentLines, 0);
    assert.equal(canceled.targetPlayerId, null);
    assert.equal(canceled.canceledLines, 4);
    const applied = createCombatEffect(gameId, "actor", {
        ...result, linesCleared: 0, attackLines: 0, appliedGarbageLines: 3,
    }, null);
    assert.equal(applied.linesCleared, 0);
    assert.equal(applied.appliedLines, 3);
});

test("B2B는 대상 clear에서만 표시하고 의미 없는 placement는 생략한다", () => {
    assert.equal(createCombatEffect(gameId, "actor", { ...result, backToBack: true }, null).backToBackBonus, true);
    assert.equal(createCombatEffect(gameId, "actor", {
        ...result, linesCleared: 1, backToBack: true,
    }, null), null);
    assert.equal(createCombatEffect(gameId, "actor", {
        ...result, linesCleared: 1, isTSpin: true, tSpinType: "full", backToBack: true,
    }, null).backToBackBonus, true);
    assert.equal(createCombatEffect(gameId, "actor", { ...result, pieceIndex: -1 }, null), null);
});


test("전송량이 없어도 TETRIS·줄 삭제 없는 T-SPIN·콤보 성과를 전달한다", () => {
    const tetris = createCombatEffect(gameId, "actor", { ...result, attackLines: 0 }, null);
    assert.equal(tetris.linesCleared, 4);
    assert.equal(tetris.targetPlayerId, null);
    const spin = createCombatEffect(gameId, "actor", {
        ...result, attackLines: 0, linesCleared: 0, isTSpin: true, tSpinType: "full",
    }, null);
    assert.equal(spin.isTSpin, true);
    assert.equal(spin.linesCleared, 0);
    assert.equal(spin.sentLines, 0);
    assert.equal(spin.backToBackBonus, false);
    assert.equal(createCombatEffect(gameId, "actor", {
        ...result, linesCleared: 1, attackLines: 0, combo: 2,
    }, null).combo, 2);
    assert.equal(createCombatEffect(gameId, "actor", {
        ...result, linesCleared: 1, attackLines: 0, combo: 0,
    }, null), null);
});
