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

    constructor(code: string) {
        super(code);
        this.name = "PostgresEventRepositoryError";
        this.code = code;
    }
}

function fail(code: string): never {
    throw new PostgresEventRepositoryError(code);
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
    const pool = new Pool(createPostgresClientConfig(options?.connectionUrl ?? "", {
        applicationName: "tetris-goal9a-repository",
        ca: options?.ca,
        connectionTimeoutMillis: 5_000,
        queryTimeoutMillis: 10_000,
    }));
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
            } catch {
                return fail("POSTGRES_EVENT_APPEND_FAILED");
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
            } catch {
                return fail("POSTGRES_EVENT_APPEND_FAILED");
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
