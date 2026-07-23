import {
    prepareCanonicalGameEvent,
} from "../db/canonicalGameEvent.js";
import type {
    CanonicalGameEvent,
} from "../db/canonicalGameEvent.js";
import {
    createPostgresEventRepository,
    PostgresEventRepositoryError,
} from "../repositories/postgresEventRepository.js";
import {
    saveGameEventLog as saveJsonlGameEventLog,
    savePlacementDecisionLog as saveJsonlPlacementDecisionLog,
} from "./logService.js";
import type {
    LogSaveResult,
} from "./logService.js";
import {
    GameEventProjectionError,
    projectGameEventLog,
} from "./gameEventProjector.js";
import type {
    ValidatedLog,
} from "../validators/gameLogValidator.js";

export const POSTGRES_RUNTIME_POOL_MAX = 4;
export const POSTGRES_RUNTIME_IN_FLIGHT_MAX = 16;
export const POSTGRES_RUNTIME_CONNECTION_TIMEOUT_MS = 250;
export const POSTGRES_RUNTIME_QUERY_TIMEOUT_MS = 250;
export const POSTGRES_RUNTIME_WRITE_ATTEMPTS = 3;
export const POSTGRES_RUNTIME_WRITE_BUDGET_MS = 2_700;
export const POSTGRES_RUNTIME_DRAIN_TIMEOUT_MS = 3_000;
export const EXPECTED_POSTGRES_MIGRATION_VERSION = 2;
const RETRY_BACKOFF_MS = [50, 100];

type StorageMode = "jsonl" | "postgres";
type Repository = ReturnType<typeof createPostgresEventRepository>;
type StorageMetrics = {
    accepted: number;
    attempts: number;
    inserted: number;
    duplicate: number;
    conflict: number;
    failed: number;
    rejected: number;
};
type RuntimeEventStorageOptions = {
    env?: NodeJS.ProcessEnv;
    repository?: Repository;
    warn?: (message: string) => void;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
};

export type RuntimeEventStorage = {
    mode: StorageMode;
    saveGameEventLog(log: unknown): Promise<LogSaveResult>;
    savePlacementDecisionLog(log: unknown): Promise<LogSaveResult>;
    rejectNewWrites(): void;
    drain(timeoutMillis?: number): Promise<{ drained: boolean; pending: number }>;
    close(): Promise<void>;
    getMetrics(): Readonly<StorageMetrics & {
        inFlight: number;
        inFlightMax: number;
        poolMax: number;
    }>;
};

export class RuntimeEventStorageError extends Error {
    readonly code: string;

    constructor(code: string) {
        super(code);
        this.name = "RuntimeEventStorageError";
        this.code = code;
    }
}

function fail(code: string): never {
    throw new RuntimeEventStorageError(code);
}

function failure(reason: string): LogSaveResult {
    return { ok: false, log: null, reason };
}

function success(log: unknown): LogSaveResult {
    return {
        ok: true,
        log: log as ValidatedLog,
        reason: null,
    };
}

function eventType(log: unknown): string {
    if (!log || typeof log !== "object" || !(("eventType") in log)) return "unknown";
    const value = log.eventType;
    return value === "game_start"
        || value === "placement_decision"
        || value === "game_over"
        ? value
        : "unknown";
}

export function resolveGameEventStorageMode(
    env: NodeJS.ProcessEnv = process.env,
): StorageMode {
    const value = env.GAME_EVENT_STORAGE?.trim();
    if (!value) {
        return env.NODE_ENV === "production"
            ? fail("GAME_EVENT_STORAGE_REQUIRED")
            : "jsonl";
    }
    return value === "jsonl" || value === "postgres"
        ? value
        : fail("GAME_EVENT_STORAGE_INVALID");
}

function createJsonlStorage(): RuntimeEventStorage {
    return {
        mode: "jsonl",
        saveGameEventLog: saveJsonlGameEventLog,
        savePlacementDecisionLog: saveJsonlPlacementDecisionLog,
        rejectNewWrites() {},
        async drain() {
            return { drained: true, pending: 0 };
        },
        async close() {},
        getMetrics() {
            return Object.freeze({
                accepted: 0,
                attempts: 0,
                inserted: 0,
                duplicate: 0,
                conflict: 0,
                failed: 0,
                rejected: 0,
                inFlight: 0,
                inFlightMax: 0,
                poolMax: 0,
            });
        },
    };
}

/**
 * 한 process의 단일 sink와 bounded PostgreSQL write를 조립한다.
 * in-flight Set은 이미 시작한 Promise의 shutdown 추적만 하며 대기 queue로 사용하지 않는다.
 */
export async function createRuntimeEventStorage(
    options: RuntimeEventStorageOptions = {},
): Promise<RuntimeEventStorage> {
    const env = options.env || process.env;
    const mode = resolveGameEventStorageMode(env);
    if (mode === "jsonl") return createJsonlStorage();

    const connectionUrl = env.DATABASE_URL?.trim();
    if (!connectionUrl) return fail("DATABASE_URL_REQUIRED");
    const repository = options.repository || createPostgresEventRepository({
        connectionUrl,
        ca: env.DATABASE_CA?.trim() || undefined,
        applicationName: "tetris-goal9b-runtime",
        max: POSTGRES_RUNTIME_POOL_MAX,
        connectionTimeoutMillis: POSTGRES_RUNTIME_CONNECTION_TIMEOUT_MS,
        queryTimeoutMillis: POSTGRES_RUNTIME_QUERY_TIMEOUT_MS,
    });
    try {
        await repository.verifyReady(EXPECTED_POSTGRES_MIGRATION_VERSION);
    } catch {
        await repository.close().catch(() => {});
        return fail("POSTGRES_EVENT_STARTUP_FAILED");
    }

    const warn = options.warn || console.warn;
    const now = options.now || Date.now;
    const sleep = options.sleep || (milliseconds => (
        new Promise(resolve => setTimeout(resolve, milliseconds))
    ));
    const inFlight = new Set<Promise<LogSaveResult>>();
    const metrics: StorageMetrics = {
        accepted: 0,
        attempts: 0,
        inserted: 0,
        duplicate: 0,
        conflict: 0,
        failed: 0,
        rejected: 0,
    };
    let accepting = true;
    let closePromise: Promise<void> | null = null;

    async function appendWithRetry(
        event: CanonicalGameEvent,
        type: string,
    ): Promise<LogSaveResult> {
        const startedAt = now();
        for (let attempt = 1; attempt <= POSTGRES_RUNTIME_WRITE_ATTEMPTS; attempt += 1) {
            metrics.attempts += 1;
            try {
                const result = await repository.append(event);
                if (result.status === "inserted") metrics.inserted += 1;
                if (result.status === "duplicate") metrics.duplicate += 1;
                if (result.status === "conflict") {
                    metrics.conflict += 1;
                    metrics.failed += 1;
                    warn(
                        `[gameEventStorage] write_failed code=IDEMPOTENCY_CONFLICT`
                        + ` event_type=${type} attempts=${attempt}`,
                    );
                    return failure("IDEMPOTENCY_CONFLICT");
                }
                return success(event);
            } catch (error) {
                const retryable = error instanceof PostgresEventRepositoryError
                    && error.retryable;
                const elapsed = now() - startedAt;
                const backoff = RETRY_BACKOFF_MS[attempt - 1] ?? 0;
                if (
                    !retryable
                    || attempt >= POSTGRES_RUNTIME_WRITE_ATTEMPTS
                    || elapsed + backoff >= POSTGRES_RUNTIME_WRITE_BUDGET_MS
                ) {
                    metrics.failed += 1;
                    warn(
                        `[gameEventStorage] write_failed code=POSTGRES_EVENT_APPEND_FAILED`
                        + ` event_type=${type} attempts=${attempt}`,
                    );
                    return failure("LOG_WRITE_FAILED");
                }
                await sleep(backoff);
            }
        }
        metrics.failed += 1;
        return failure("LOG_WRITE_FAILED");
    }

    function save(log: unknown): Promise<LogSaveResult> {
        const type = eventType(log);
        if (!accepting) {
            metrics.rejected += 1;
            warn(`[gameEventStorage] write_rejected code=EVENT_STORAGE_CLOSED event_type=${type}`);
            return Promise.resolve(failure("LOG_WRITE_FAILED"));
        }
        if (inFlight.size >= POSTGRES_RUNTIME_IN_FLIGHT_MAX) {
            metrics.rejected += 1;
            metrics.failed += 1;
            warn(`[gameEventStorage] write_rejected code=IN_FLIGHT_LIMIT event_type=${type}`);
            return Promise.resolve(failure("LOG_WRITE_FAILED"));
        }

        let event;
        try {
            event = prepareCanonicalGameEvent(projectGameEventLog(log)).snapshot;
        } catch (error) {
            metrics.failed += 1;
            const code = error instanceof GameEventProjectionError
                ? error.code
                : "GAME_EVENT_PROJECTION_INVALID";
            warn(`[gameEventStorage] write_failed code=${code} event_type=${type} attempts=0`);
            return Promise.resolve(failure("INVALID_GAME_EVENT"));
        }

        metrics.accepted += 1;
        const task = appendWithRetry(event, type);
        inFlight.add(task);
        void task.finally(() => inFlight.delete(task));
        return task;
    }

    return {
        mode,
        saveGameEventLog: save,
        savePlacementDecisionLog: save,
        rejectNewWrites() {
            accepting = false;
        },
        async drain(timeoutMillis = POSTGRES_RUNTIME_DRAIN_TIMEOUT_MS) {
            if (!Number.isInteger(timeoutMillis) || timeoutMillis < 0) {
                return fail("POSTGRES_EVENT_DRAIN_TIMEOUT_INVALID");
            }
            if (inFlight.size === 0) return { drained: true, pending: 0 };
            let timedOut = false;
            let timeout: ReturnType<typeof setTimeout> | null = null;
            await Promise.race([
                Promise.allSettled([...inFlight]),
                new Promise<void>(resolve => {
                    timeout = setTimeout(() => {
                        timedOut = true;
                        resolve();
                    }, timeoutMillis);
                }),
            ]);
            if (timeout) clearTimeout(timeout);
            return { drained: !timedOut && inFlight.size === 0, pending: inFlight.size };
        },
        close() {
            if (closePromise) return closePromise;
            accepting = false;
            closePromise = repository.close();
            return closePromise;
        },
        getMetrics() {
            return Object.freeze({
                ...metrics,
                inFlight: inFlight.size,
                inFlightMax: POSTGRES_RUNTIME_IN_FLIGHT_MAX,
                poolMax: POSTGRES_RUNTIME_POOL_MAX,
            });
        },
    };
}
