import { Pool } from "pg";
import { createPostgresClientConfig } from "../db/postgresConnection.js";
import {
    canonicalJson,
    CanonicalGameEventError,
    prepareCanonicalGameEvent,
} from "../db/canonicalGameEvent.js";
import type { CanonicalGameEvent } from "../db/canonicalGameEvent.js";

const INSERT_EVENT_SQL = `
INSERT INTO tetris_analytics.game_events (
    identity_version,
    event_id,
    event_type,
    schema_version,
    game_id,
    player_id,
    piece_index,
    trust_level,
    occurred_at,
    payload,
    event_sha256
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
ON CONFLICT DO NOTHING
RETURNING event_id
`;

const FIND_CONFLICT_SQL = `
SELECT event_id, event_type, game_id, player_id, piece_index, event_sha256
  FROM tetris_analytics.game_events
 WHERE event_id = $1
    OR (
        event_type = $2
        AND game_id = $3
        AND player_id IS NOT DISTINCT FROM $4
        AND piece_index IS NOT DISTINCT FROM $5
    )
 LIMIT 2
`;

export type AppendPostgresEventResult =
    | {
        status: "inserted";
        eventId: string;
    }
    | {
        status: "duplicate";
        eventId: string;
    }
    | {
        status: "conflict";
        eventId: string;
        code: "IDEMPOTENCY_CONFLICT";
    };

export type CreatePostgresEventRepositoryOptions = {
    connectionUrl: string;
    ca?: string;
    applicationName?: string;
    max?: number;
    connectionTimeoutMillis?: number;
    queryTimeoutMillis?: number;
};

type ExistingIdentityRow = {
    event_id: string;
    event_type: string;
    game_id: string;
    player_id: string | null;
    piece_index: number | null;
    event_sha256: string;
};

export class PostgresEventRepositoryError extends Error {
    readonly code: string;
    readonly retryable: boolean;

    constructor(code: string, retryable = false) {
        super(code);
        this.name = "PostgresEventRepositoryError";
        this.code = code;
        this.retryable = retryable;
    }
}

function fail(code: string, retryable = false): never {
    throw new PostgresEventRepositoryError(code, retryable);
}

const TRANSIENT_NETWORK_CODES = new Set([
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
]);
const PG_TIMEOUT_MESSAGES = new Set([
    "Connection terminated due to connection timeout",
    "Query read timeout",
    "timeout exceeded when trying to connect",
]);

export function isRetryablePostgresAppendError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const code = "code" in error && typeof error.code === "string"
        ? error.code
        : "";
    if (
        TRANSIENT_NETWORK_CODES.has(code)
        || code.startsWith("08")
        || code === "40001"
        || code === "40P01"
    ) {
        return true;
    }
    const message = "message" in error && typeof error.message === "string"
        ? error.message
        : "";
    return PG_TIMEOUT_MESSAGES.has(message);
}

function isExactDuplicate(
    row: ExistingIdentityRow,
    event: ReturnType<typeof prepareCanonicalGameEvent>,
): boolean {
    const snapshot = event.snapshot;
    return row.event_id === event.eventId
        && row.event_type === snapshot.eventType
        && row.game_id === snapshot.gameId
        && row.player_id === snapshot.playerId
        && row.piece_index === snapshot.pieceIndex
        && row.event_sha256 === event.eventSha256;
}

/**
 * CanonicalGameEvent만 parameterized, schema-qualified append 경계로 저장한다.
 * conflict 확인은 INSERT와 분리된 두 번째 DB command이며 기존 row는 갱신하지 않는다.
 */
export function createPostgresEventRepository(
    options: CreatePostgresEventRepositoryOptions,
) {
    const clientConfig = createPostgresClientConfig(options?.connectionUrl ?? "", {
        applicationName: options?.applicationName ?? "tetris-goal9a-repository",
        ca: options?.ca,
        connectionTimeoutMillis: options?.connectionTimeoutMillis ?? 5_000,
        queryTimeoutMillis: options?.queryTimeoutMillis ?? 10_000,
    });
    const pool = new Pool({
        ...clientConfig,
        max: options?.max,
    });
    const handlePoolError = () => {
        // Runtime observability와 retry 정책은 Goal 9B에서 연결한다.
    };
    pool.on("error", handlePoolError);
    let closed = false;
    let closePromise: Promise<void> | null = null;

    return {
        async append(event: CanonicalGameEvent): Promise<AppendPostgresEventResult> {
            if (closed) return fail("POSTGRES_EVENT_REPOSITORY_CLOSED");

            let prepared;
            try {
                prepared = prepareCanonicalGameEvent(event);
            } catch (error) {
                if (
                    error instanceof CanonicalGameEventError
                    && error.code === "CANONICAL_EVENT_TOO_LARGE"
                ) {
                    return fail(error.code);
                }
                return fail("INVALID_CANONICAL_EVENT");
            }

            const snapshot = prepared.snapshot;
            let insertResult;
            try {
                insertResult = await pool.query<{ event_id: string }>(INSERT_EVENT_SQL, [
                    snapshot.identityVersion,
                    prepared.eventId,
                    snapshot.eventType,
                    snapshot.schemaVersion,
                    snapshot.gameId,
                    snapshot.playerId,
                    snapshot.pieceIndex,
                    snapshot.trustLevel,
                    snapshot.occurredAt,
                    canonicalJson(snapshot.payload),
                    prepared.eventSha256,
                ]);
            } catch (error) {
                return fail(
                    "POSTGRES_EVENT_APPEND_FAILED",
                    isRetryablePostgresAppendError(error),
                );
            }

            if (insertResult.rows.length === 1) {
                return {
                    status: "inserted",
                    eventId: prepared.eventId,
                };
            }

            let conflictResult;
            try {
                conflictResult = await pool.query<ExistingIdentityRow>(FIND_CONFLICT_SQL, [
                    prepared.eventId,
                    snapshot.eventType,
                    snapshot.gameId,
                    snapshot.playerId,
                    snapshot.pieceIndex,
                ]);
            } catch (error) {
                return fail(
                    "POSTGRES_EVENT_APPEND_FAILED",
                    isRetryablePostgresAppendError(error),
                );
            }

            if (
                conflictResult.rows.length === 1
                && isExactDuplicate(conflictResult.rows[0], prepared)
            ) {
                return {
                    status: "duplicate",
                    eventId: prepared.eventId,
                };
            }

            return {
                status: "conflict",
                eventId: prepared.eventId,
                code: "IDEMPOTENCY_CONFLICT",
            };
        },

        async verifyReady(expectedMigrationVersion: number): Promise<void> {
            if (closed) return fail("POSTGRES_EVENT_REPOSITORY_CLOSED");
            if (!Number.isInteger(expectedMigrationVersion) || expectedMigrationVersion <= 0) {
                return fail("POSTGRES_SCHEMA_VERSION_INVALID");
            }
            try {
                const result = await pool.query<{ version: number | null }>(
                    `SELECT pg_catalog.max(version)::integer AS version
                       FROM tetris_analytics.schema_migrations`,
                );
                if (
                    result.rows.length !== 1
                    || result.rows[0]?.version !== expectedMigrationVersion
                ) {
                    return fail("POSTGRES_SCHEMA_VERSION_MISMATCH");
                }
            } catch (error) {
                if (error instanceof PostgresEventRepositoryError) throw error;
                return fail("POSTGRES_EVENT_STARTUP_FAILED");
            }
        },

        getPoolStats(): {
            totalCount: number;
            idleCount: number;
            waitingCount: number;
            max: number;
        } {
            return {
                totalCount: pool.totalCount,
                idleCount: pool.idleCount,
                waitingCount: pool.waitingCount,
                max: pool.options.max,
            };
        },

        close(): Promise<void> {
            if (closePromise) return closePromise;
            closed = true;
            closePromise = pool.end()
                .catch(() => fail("POSTGRES_EVENT_REPOSITORY_CLOSE_FAILED"))
                .finally(() => {
                    pool.off("error", handlePoolError);
                });
            return closePromise;
        },
    };
}
