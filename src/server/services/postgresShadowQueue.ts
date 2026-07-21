const DEFAULT_CAPACITY = 256;
const DEFAULT_WRITE_TIMEOUT_MS = 1_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;

export type PostgresShadowQueueStats = {
    accepted: number;
    written: number;
    failed: number;
    timedOut: number;
    dropped: number;
    pending: number;
    accepting: boolean;
};

type PostgresShadowQueueOptions<T> = {
    write(log: T): unknown | PromiseLike<unknown>;
    capacity?: number;
    writeTimeoutMs?: number;
    shutdownTimeoutMs?: number;
    warn?: (message: string) => void;
};

export type PostgresShadowQueue<T> = {
    enqueue(log: T): boolean;
    shutdown(): Promise<PostgresShadowQueueStats>;
};

function positiveInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError(`${name} must be a positive integer`);
    }
    return value;
}

/**
 * `write`는 DB 자체 timeout/cancellation을 적용해야 한다.
 * 이 queue의 timeout은 worker 대기만 끝내며 이미 시작된 write를 취소하지 않는다.
 */
export function createPostgresShadowQueue<T>(
    options: PostgresShadowQueueOptions<T>,
): PostgresShadowQueue<T> {
    if (!options || typeof options.write !== "function") {
        throw new TypeError("write must be a function");
    }

    const capacity = positiveInteger(options.capacity ?? DEFAULT_CAPACITY, "capacity");
    const writeTimeoutMs = positiveInteger(
        options.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS,
        "writeTimeoutMs",
    );
    const shutdownTimeoutMs = positiveInteger(
        options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
        "shutdownTimeoutMs",
    );
    const warn = options.warn ?? console.warn;
    if (typeof warn !== "function") {
        throw new TypeError("warn must be a function");
    }

    const pending: T[] = [];
    let accepting = true;
    let processing = false;
    let drainPromise = Promise.resolve();
    let shutdownPromise: Promise<PostgresShadowQueueStats> | null = null;
    let accepted = 0;
    let written = 0;
    let failed = 0;
    let timedOut = 0;
    let dropped = 0;

    function safeWarn(message: string): void {
        try {
            warn(message);
        } catch {
            // Shadow storage warnings must not affect gameplay.
        }
    }

    function getStats(): PostgresShadowQueueStats {
        return {
            accepted,
            written,
            failed,
            timedOut,
            dropped,
            pending: pending.length + (processing ? 1 : 0),
            accepting,
        };
    }

    async function writeOne(log: T): Promise<void> {
        let timeout: NodeJS.Timeout | undefined;
        const writeResult = Promise.resolve()
            .then(() => options.write(log))
            .then(() => "written" as const, () => "failed" as const);
        const timeoutResult = new Promise<"timed_out">((resolve) => {
            timeout = setTimeout(() => resolve("timed_out"), writeTimeoutMs);
        });
        const result = await Promise.race([writeResult, timeoutResult]);
        if (timeout) clearTimeout(timeout);

        if (result === "written") {
            written += 1;
        } else if (result === "failed") {
            failed += 1;
            safeWarn("[postgresShadowQueue] shadow write failed");
        } else {
            timedOut += 1;
            safeWarn("[postgresShadowQueue] shadow write timed out");
            accepting = false;
            const remaining = pending.length;
            if (remaining > 0) {
                pending.length = 0;
                dropped += remaining;
                safeWarn("[postgresShadowQueue] timed-out writer disabled; queued events dropped");
            }
        }
    }

    function startDrain(): void {
        if (processing || pending.length === 0) return;
        processing = true;
        drainPromise = (async () => {
            while (pending.length > 0) {
                const log = pending.shift() as T;
                await writeOne(log);
            }
            processing = false;
        })();
    }

    function enqueue(log: T): boolean {
        if (!accepting) {
            dropped += 1;
            return false;
        }
        if (pending.length + (processing ? 1 : 0) >= capacity) {
            dropped += 1;
            safeWarn("[postgresShadowQueue] queue full; newest shadow event dropped");
            return false;
        }

        let snapshot: T;
        try {
            snapshot = structuredClone(log);
        } catch {
            dropped += 1;
            safeWarn("[postgresShadowQueue] shadow event could not be copied");
            return false;
        }

        pending.push(snapshot);
        accepted += 1;
        startDrain();
        return true;
    }

    function shutdown(): Promise<PostgresShadowQueueStats> {
        if (shutdownPromise) return shutdownPromise;
        accepting = false;
        startDrain();
        shutdownPromise = new Promise((resolve) => {
            const timeout = setTimeout(() => {
                const remaining = pending.length;
                if (remaining > 0) {
                    pending.length = 0;
                    dropped += remaining;
                    safeWarn("[postgresShadowQueue] shutdown deadline reached; queued events dropped");
                }
                resolve(getStats());
            }, shutdownTimeoutMs);

            drainPromise.then(() => {
                clearTimeout(timeout);
                resolve(getStats());
            });
        });
        return shutdownPromise;
    }

    return { enqueue, shutdown };
}
