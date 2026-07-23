export const SERVER_HARD_SHUTDOWN_TIMEOUT_MS = 8_000;

type ShutdownOptions = {
    rejectNewWrites: () => void;
    stopEventProducers: () => void;
    drainWrites: () => Promise<unknown>;
    closePool: () => Promise<unknown>;
    closeSocketAndHttp: () => Promise<unknown>;
    hardExit?: (code: number) => void;
    setTimeoutFn?: typeof setTimeout;
    clearTimeoutFn?: typeof clearTimeout;
};

/**
 * 종료 순서를 한 번만 실행한다.
 * write 차단 → producer 정지 → drain → pool → Socket.IO/HTTP 순서를 오류 뒤에도 보존한다.
 */
export function createServerShutdown(options: ShutdownOptions): () => Promise<void> {
    let shutdownPromise: Promise<void> | null = null;

    return function shutdown(): Promise<void> {
        if (shutdownPromise) return shutdownPromise;
        const setTimeoutFn = options.setTimeoutFn || setTimeout;
        const clearTimeoutFn = options.clearTimeoutFn || clearTimeout;
        const hardExit = options.hardExit || (code => process.exit(code));
        const forceExitTimer = setTimeoutFn(
            () => hardExit(1),
            SERVER_HARD_SHUTDOWN_TIMEOUT_MS,
        );
        forceExitTimer.unref?.();

        shutdownPromise = (async () => {
            let failed = false;
            try {
                options.rejectNewWrites();
            } catch {
                failed = true;
            }
            try {
                options.stopEventProducers();
            } catch {
                failed = true;
            }
            try {
                await options.drainWrites();
            } catch {
                failed = true;
            }
            try {
                await options.closePool();
            } catch {
                failed = true;
            }
            try {
                await options.closeSocketAndHttp();
            } catch {
                failed = true;
            }
            if (failed) throw new Error("SERVER_SHUTDOWN_FAILED");
        })().finally(() => {
            clearTimeoutFn(forceExitTimer);
        });

        return shutdownPromise;
    };
}
