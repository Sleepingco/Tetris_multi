/**
 * runtime의 표시 상태만 cached snapshot으로 노출한다.
 *
 * @param {Function} readDisplayValues - 현재 runtime 표시 값을 읽는 함수
 * @returns {Object} React 외부 store 계약과 runtime publish/destroy 경계
 */
export function createRuntimeDisplayBridge(readDisplayValues) {
    const listeners = new Set();
    let destroyed = false;
    let snapshot = createSnapshot(readDisplayValues());

    function createSnapshot(values) {
        return {
            score: values.score,
            lines: values.lines,
            holdPieceType: values.holdPieceType ?? null,
            nextPieceTypes: [
                values.nextPieceTypes?.[0] ?? null,
                values.nextPieceTypes?.[1] ?? null,
            ],
            phase: values.phase,
        };
    }

    function isSameSnapshot(next) {
        return snapshot.score === next.score
            && snapshot.lines === next.lines
            && snapshot.holdPieceType === next.holdPieceType
            && snapshot.nextPieceTypes[0] === next.nextPieceTypes[0]
            && snapshot.nextPieceTypes[1] === next.nextPieceTypes[1]
            && snapshot.phase === next.phase;
    }

    function getDisplaySnapshot() {
        return snapshot;
    }

    function subscribeDisplay(callback) {
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

    function publishDisplay() {
        if (destroyed) return false;

        const next = createSnapshot(readDisplayValues());
        if (isSameSnapshot(next)) return false;

        snapshot = next;
        for (const listener of [...listeners]) {
            if (listeners.has(listener)) listener();
        }
        return true;
    }

    function destroyDisplay() {
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
