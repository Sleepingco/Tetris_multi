import { appendJsonLine } from "../repositories/jsonlLogRepository.js";
import { createPostgresEventRepository } from "../repositories/postgresEventRepository.js";
import { createPostgresShadowQueue } from "./postgresShadowQueue.js";
import {
    validateGameEventLog,
    validatePlacementDecisionLog,
} from "../validators/gameLogValidator.js";
import type {
    LogValidationResult,
    ValidatedLog,
} from "../validators/gameLogValidator.js";

export type LogSaveResult = {
    ok: true;
    log: ValidatedLog;
    reason: null;
} | {
    ok: false;
    log: null;
    reason: string;
};
type LogRepository = { append(log: ValidatedLog): Promise<void> };
type SaveOptions = {
    repository?: LogRepository;
    validate?: (log: unknown) => LogValidationResult;
    warn?: (message: string) => void;
    warningLabel?: string;
};

const DEFAULT_QUEUE_CAPACITY = 256;
const DEFAULT_CONNECTION_TIMEOUT_MS = 1_000;
const DEFAULT_QUERY_TIMEOUT_MS = 1_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const DEFAULT_POSTGRES_SCHEMA = "tetris_analytics";
const QUEUE_TIMEOUT_MARGIN_MS = 250;

type ShadowStorage = {
    enqueue(log: ValidatedLog): boolean;
    shutdown(): Promise<void>;
};

let shadowStorage: ShadowStorage | null | undefined;
let shadowStorageClosed = false;

function readIntegerEnvironment(
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
): number {
    const rawValue = process.env[name]?.trim();
    if (!rawValue) return fallback;

    const value = Number(rawValue);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        console.warn(`[logService] ${name} is invalid; using the default`);
        return fallback;
    }
    return value;
}

function getShadowStorage(): ShadowStorage | null {
    if (shadowStorageClosed) return null;
    if (shadowStorage !== undefined) return shadowStorage;
    if (process.env.POSTGRES_SHADOW_WRITE_ENABLED !== "true") {
        shadowStorage = null;
        return null;
    }

    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) {
        console.warn("[logService] postgres shadow disabled: DATABASE_URL is required");
        shadowStorage = null;
        return null;
    }

    try {
        const queryTimeoutMs = readIntegerEnvironment(
            "POSTGRES_SHADOW_QUERY_TIMEOUT_MS",
            DEFAULT_QUERY_TIMEOUT_MS,
            10,
            60_000,
        );
        const shutdownTimeoutMs = readIntegerEnvironment(
            "POSTGRES_SHADOW_SHUTDOWN_TIMEOUT_MS",
            DEFAULT_SHUTDOWN_TIMEOUT_MS,
            10,
            60_000,
        );
        const connectionTimeoutMs = readIntegerEnvironment(
            "POSTGRES_SHADOW_CONNECTION_TIMEOUT_MS",
            DEFAULT_CONNECTION_TIMEOUT_MS,
            10,
            60_000,
        );
        if (connectionTimeoutMs + queryTimeoutMs + QUEUE_TIMEOUT_MARGIN_MS
            > shutdownTimeoutMs) {
            throw new Error("POSTGRES_SHADOW_TIMEOUT_ORDER_INVALID");
        }
        const repository = createPostgresEventRepository({
            connectionString,
            schemaName: process.env.POSTGRES_SHADOW_SCHEMA?.trim() || DEFAULT_POSTGRES_SCHEMA,
            connectionTimeoutMs,
            queryTimeoutMs,
        });
        const queue = createPostgresShadowQueue<ValidatedLog>({
            capacity: readIntegerEnvironment(
                "POSTGRES_SHADOW_QUEUE_CAPACITY",
                DEFAULT_QUEUE_CAPACITY,
                1,
                10_000,
            ),
            writeTimeoutMs: connectionTimeoutMs + queryTimeoutMs + QUEUE_TIMEOUT_MARGIN_MS,
            shutdownTimeoutMs,
            write: repository.append,
        });
        shadowStorage = {
            enqueue: queue.enqueue,
            async shutdown() {
                const stats = await queue.shutdown();
                if (stats.failed > 0 || stats.timedOut > 0 || stats.dropped > 0
                    || stats.pending > 0) {
                    console.warn(
                        `[logService] postgres shadow shutdown summary: failed=${stats.failed}`
                        + ` timedOut=${stats.timedOut} dropped=${stats.dropped}`
                        + ` pending=${stats.pending}`,
                    );
                }
                await repository.close();
            },
        };
    } catch {
        console.warn("[logService] postgres shadow disabled: invalid configuration");
        shadowStorage = null;
    }
    return shadowStorage;
}

const defaultRepository = {
    async append(log: ValidatedLog): Promise<void> {
        await appendJsonLine(log);
        getShadowStorage()?.enqueue(log);
    },
};

export async function shutdownLogStorage(): Promise<void> {
    if (shadowStorageClosed) return;
    shadowStorageClosed = true;
    const storage = shadowStorage;
    shadowStorage = null;
    if (!storage) return;
    await storage.shutdown();
}

function createSuccess(log: ValidatedLog): LogSaveResult {
    return {
        ok: true,
        log,
        reason: null,
    };
}

function createFailure(reason: string): LogSaveResult {
    return {
        ok: false,
        log: null,
        reason,
    };
}

export async function savePlacementDecisionLog(
    log: unknown,
    options: SaveOptions = {},
): Promise<LogSaveResult> {
    return saveLog(log, {
        ...options,
        validate: options.validate || validatePlacementDecisionLog,
        warningLabel: "placement_decision",
    });
}

export async function saveGameEventLog(
    log: unknown,
    options: SaveOptions = {},
): Promise<LogSaveResult> {
    return saveLog(log, {
        ...options,
        validate: options.validate || validateGameEventLog,
        warningLabel: typeof log === "object" && log !== null && "eventType" in log
            && typeof log.eventType === "string"
            ? log.eventType
            : "game_event",
    });
}

async function saveLog(log: unknown, options: SaveOptions): Promise<LogSaveResult> {
    const validate = options.validate;
    const repository = options.repository || defaultRepository;
    const warn = options.warn || console.warn;
    if (!validate) return createFailure("LOG_VALIDATOR_REQUIRED");
    const validationResult = validate(log);

    if (!validationResult.ok) {
        return createFailure(validationResult.reason);
    }

    try {
        await repository.append(validationResult.log);
        return createSuccess(validationResult.log);
    } catch (error) {
        const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
        warn(`[logService] ${options.warningLabel} 저장 실패: ${message}`);
        return createFailure("LOG_WRITE_FAILED");
    }
}
