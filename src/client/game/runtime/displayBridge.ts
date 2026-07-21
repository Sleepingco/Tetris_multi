/**
 * runtime의 표시 상태만 cached snapshot으로 노출한다.
 *
 * @param {Function} readDisplayValues - 현재 runtime 표시 값을 읽는 함수
 * @returns {Object} React 외부 store 계약과 runtime publish/destroy 경계
 */
export function createRuntimeDisplayBridge(
    readDisplayValues: () => RuntimeDisplayValues,
): RuntimeDisplayHandle {
    const listeners = new Set<() => void>();
    let destroyed = false;
    let snapshot = createSnapshot(readDisplayValues());

    function createSnapshot(values: RuntimeDisplayValues): RuntimeDisplaySnapshot {
        return {
            score: values.score,
            lines: values.lines,
            holdPieceType: values.holdPieceType ?? null,
            nextPieceTypes: [
                values.nextPieceTypes?.[0] ?? null,
                values.nextPieceTypes?.[1] ?? null,
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
    nextPieceTypes: [PieceType | null, PieceType | null];
    pendingGarbageLines: number;
    phase: GamePhase;
};
export type RuntimeDisplayHandle = {
    getDisplaySnapshot: () => RuntimeDisplaySnapshot;
    subscribeDisplay: (callback: () => void) => () => void;
    publishDisplay: () => boolean;
    destroyDisplay: () => void;
};
