// =============================
// runtime → React 표시 상태 연결
// gameplay의 원천은 runtime에 두고, React HUD가 필요한 작은 값만 안정된 snapshot으로 노출한다.
// 값이 실제로 바뀔 때만 새 객체와 알림을 만들어 불필요한 React 렌더를 막는다.
// =============================

/**
 * runtime 표시 값을 React의 `useSyncExternalStore` 계약으로 감싼다.
 * - `getDisplaySnapshot`은 마지막으로 발행한 같은 객체를 반환해야 React가 변경 여부를 판단할 수 있다.
 * - runtime은 상태 변경이 끝난 뒤 `publishDisplay`를 호출하고, 표시 값이 달라진 경우에만 구독자를 알린다.
 * - `destroyDisplay` 이후에는 알림과 새 구독을 막아 제거된 페이지가 다시 렌더되지 않게 한다.
 *
 * gameplay 상태를 복제하거나 변경하지 않으며 score, queue, phase 같은 표시용 값만 읽는다.
 */
export function createRuntimeDisplayBridge(
    readDisplayValues: () => RuntimeDisplayValues,
): RuntimeDisplayHandle {
    const listeners = new Set<() => void>();
    let destroyed = false;
    let snapshot = createSnapshot(readDisplayValues());

    // 아래 작은 함수들은 하나의 외부 store 계약을 구성하므로 개별 API가 아니라 묶음으로 읽는다.
    function createSnapshot(values: RuntimeDisplayValues): RuntimeDisplaySnapshot {
        return {
            score: values.score,
            lines: values.lines,
            holdPieceType: values.holdPieceType ?? null,
            nextPieceTypes: [
                values.nextPieceTypes?.[0] ?? null,
                values.nextPieceTypes?.[1] ?? null,
                values.nextPieceTypes?.[2] ?? null,
                values.nextPieceTypes?.[3] ?? null,
            ],
            pendingGarbageLines: values.pendingGarbageLines ?? 0,
            phase: values.phase,
        };
    }

    function isSameSnapshot(next: RuntimeDisplaySnapshot): boolean {
        return snapshot.score === next.score
            && snapshot.lines === next.lines
            && snapshot.holdPieceType === next.holdPieceType
            && snapshot.nextPieceTypes[0] === next.nextPieceTypes[0]
            && snapshot.nextPieceTypes[1] === next.nextPieceTypes[1]
            && snapshot.nextPieceTypes[2] === next.nextPieceTypes[2]
            && snapshot.nextPieceTypes[3] === next.nextPieceTypes[3]
            && snapshot.pendingGarbageLines === next.pendingGarbageLines
            && snapshot.phase === next.phase;
    }

    function getDisplaySnapshot() {
        return snapshot;
    }

    function subscribeDisplay(callback: () => void): () => void {
        if (destroyed) return () => {};

        const listener = () => callback();
        listeners.add(listener);
        let subscribed = true;

        return () => {
            if (!subscribed) return;
            subscribed = false;
            listeners.delete(listener);
        };
    }

    function publishDisplay(): boolean {
        if (destroyed) return false;

        const next = createSnapshot(readDisplayValues());
        if (isSameSnapshot(next)) return false;

        snapshot = next;
        for (const listener of [...listeners]) {
            if (listeners.has(listener)) listener();
        }
        return true;
    }

    function destroyDisplay(): void {
        if (destroyed) return;
        destroyed = true;
        listeners.clear();
    }

    return {
        getDisplaySnapshot,
        subscribeDisplay,
        publishDisplay,
        destroyDisplay,
    };
}
import type { GamePhase } from "../state/stateFactory.ts";
import type { PieceType } from "../state/blocks.ts";

export type RuntimeDisplayValues = {
    score: number;
    lines: number;
    holdPieceType?: PieceType | null;
    nextPieceTypes?: readonly (PieceType | null)[];
    pendingGarbageLines?: number;
    phase: GamePhase;
};
export type RuntimeDisplaySnapshot = {
    score: number;
    lines: number;
    holdPieceType: PieceType | null;
    nextPieceTypes: [PieceType | null, PieceType | null, PieceType | null, PieceType | null];
    pendingGarbageLines: number;
    phase: GamePhase;
};
export type RuntimeDisplayHandle = {
    getDisplaySnapshot: () => RuntimeDisplaySnapshot;
    subscribeDisplay: (callback: () => void) => () => void;
    publishDisplay: () => boolean;
    destroyDisplay: () => void;
};
