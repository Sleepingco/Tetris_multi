import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
    char,
    check,
    index,
    integer,
    jsonb,
    pgTable,
    text,
    timestamp,
} from "drizzle-orm/pg-core";
import { Pool } from "pg";
import {
    containsPrivateLogField,
    type ValidatedLog,
} from "../validators/gameLogValidator.js";

const DEFAULT_SCHEMA_NAME = "tetris_analytics";
const DEFAULT_CONNECTION_TIMEOUT_MS = 2_000;
const DEFAULT_QUERY_TIMEOUT_MS = 2_000;
const SCHEMA_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

type GameEventType = "game_start" | "game_over" | "placement_decision";
type CreateRepositoryOptions = {
    connectionString: string;
    schemaName?: string;
    connectionTimeoutMs?: number;
    queryTimeoutMs?: number;
    warn?: (message: string) => void;
};

export const gameEvents = pgTable("game_events", {
    idempotencyKey: char("idempotency_key", { length: 64 }).primaryKey(),
    eventType: text("event_type").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    gameId: text("game_id").notNull(),
    roomId: text("room_id"),
    playerId: text("player_id"),
    pieceIndex: integer("piece_index"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    payload: jsonb("payload").$type<ValidatedLog>().notNull(),
    payloadSha256: char("payload_sha256", { length: 64 }).notNull(),
    storedAt: timestamp("stored_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [
    index("game_events_game_id_idx").on(table.gameId),
    index("game_events_room_id_idx").on(table.roomId),
    index("game_events_player_id_idx").on(table.playerId),
    check("game_events_event_type_check", sql`${table.eventType} IN ('game_start', 'game_over', 'placement_decision')`),
    check("game_events_schema_version_check", sql`${table.schemaVersion} > 0`),
    check("game_events_game_id_check", sql`length(${table.gameId}) > 0`),
    check("game_events_piece_index_check", sql`${table.pieceIndex} IS NULL OR ${table.pieceIndex} >= 0`),
    check("game_events_payload_check", sql`jsonb_typeof(${table.payload}) = 'object'`),
    check("game_events_payload_sha256_check", sql`${table.payloadSha256} ~ '^[0-9a-f]{64}$'`),
    check("game_events_idempotency_key_check", sql`${table.idempotencyKey} ~ '^[0-9a-f]{64}$'`),
]);

function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function requireString(log: ValidatedLog, field: string): string {
    const value = log[field];
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`POSTGRES_EVENT_${field.toUpperCase()}_REQUIRED`);
    }
    return value;
}

function optionalString(log: ValidatedLog, field: string): string | null {
    return log[field] == null ? null : requireString(log, field);
}

function requireEventType(log: ValidatedLog): GameEventType {
    const eventType = log.eventType;
    if (eventType !== "game_start" && eventType !== "game_over" && eventType !== "placement_decision") {
        throw new Error("POSTGRES_EVENT_TYPE_INVALID");
    }
    return eventType;
}

function requireSchemaVersion(log: ValidatedLog): number {
    const value = log.schemaVersion;
    if (!Number.isInteger(value) || Number(value) <= 0) {
        throw new Error("POSTGRES_EVENT_SCHEMA_VERSION_INVALID");
    }
    return Number(value);
}

function requirePieceIndex(log: ValidatedLog): number {
    const value = log.pieceIndex;
    if (!Number.isInteger(value) || Number(value) < 0) {
        throw new Error("POSTGRES_EVENT_PIECE_INDEX_INVALID");
    }
    return Number(value);
}

function getOccurredAt(log: ValidatedLog, eventType: GameEventType): Date | null {
    const field = eventType === "game_start"
        ? "startedAt"
        : eventType === "game_over"
            ? "endedAt"
            : "createdAt";
    const value = log[field];
    if (value == null) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new Error("POSTGRES_EVENT_TIME_INVALID");
    }
    const occurredAt = new Date(value);
    if (Number.isNaN(occurredAt.getTime())) {
        throw new Error("POSTGRES_EVENT_TIME_INVALID");
    }
    return occurredAt;
}

export function createGameEventIdentity(log: ValidatedLog): readonly (string | number)[] {
    const eventType = requireEventType(log);
    const gameId = requireString(log, "gameId");
    return eventType === "placement_decision"
        ? [eventType, gameId, requireString(log, "playerId"), requirePieceIndex(log)]
        : [eventType, gameId];
}

export function createGameEventIdempotencyKey(log: ValidatedLog): string {
    return sha256(JSON.stringify(createGameEventIdentity(log)));
}

function serializePayload(log: ValidatedLog): { payload: ValidatedLog; payloadSha256: string } {
    let payloadJson: string | undefined;
    try {
        payloadJson = JSON.stringify(log);
    } catch {
        throw new Error("POSTGRES_EVENT_SERIALIZATION_FAILED");
    }
    if (payloadJson === undefined) {
        throw new Error("POSTGRES_EVENT_SERIALIZATION_FAILED");
    }
    return {
        payload: JSON.parse(payloadJson) as ValidatedLog,
        payloadSha256: sha256(payloadJson),
    };
}

function validateSchemaName(schemaName: string): string {
    if (!SCHEMA_NAME_PATTERN.test(schemaName)) {
        throw new Error("POSTGRES_EVENT_SCHEMA_NAME_INVALID");
    }
    return schemaName;
}

function positiveTimeout(value: number | undefined, fallback: number): number {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error("POSTGRES_EVENT_TIMEOUT_INVALID");
    }
    return value;
}

function validateConnectionString(connectionString: string): string {
    let parsed: URL;
    try {
        parsed = new URL(connectionString);
    } catch {
        throw new Error("POSTGRES_EVENT_CONNECTION_INVALID");
    }
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
        throw new Error("POSTGRES_EVENT_CONNECTION_PROTOCOL_INVALID");
    }
    const host = parsed.hostname.toLowerCase();
    const isLoopback = host === "localhost" || host === "127.0.0.1"
        || host === "::1" || host === "[::1]";
    const sslModes = parsed.searchParams.getAll("sslmode");
    if (!isLoopback && (sslModes.length !== 1 || sslModes[0] !== "verify-full")) {
        throw new Error("POSTGRES_EVENT_SSL_REQUIRED");
    }
    return connectionString;
}

export function createPostgresEventRepository({
    connectionString,
    schemaName = DEFAULT_SCHEMA_NAME,
    connectionTimeoutMs,
    queryTimeoutMs,
    warn = console.warn,
}: CreateRepositoryOptions) {
    const configuredConnectionString = connectionString?.trim();
    if (!configuredConnectionString) {
        throw new Error("POSTGRES_EVENT_CONNECTION_REQUIRED");
    }
    const safeConnectionString = validateConnectionString(configuredConnectionString);
    const safeSchemaName = validateSchemaName(schemaName);
    const safeConnectionTimeoutMs = positiveTimeout(connectionTimeoutMs, DEFAULT_CONNECTION_TIMEOUT_MS);
    const safeQueryTimeoutMs = positiveTimeout(queryTimeoutMs, DEFAULT_QUERY_TIMEOUT_MS);
    if (typeof warn !== "function") {
        throw new Error("POSTGRES_EVENT_WARN_INVALID");
    }
    const safeWarn = (message: string): void => {
        try {
            warn(message);
        } catch {
            // Observability must not affect gameplay or storage cleanup.
        }
    };
    let pool: Pool;
    try {
        pool = new Pool({
            connectionString: safeConnectionString,
            max: 1,
            connectionTimeoutMillis: safeConnectionTimeoutMs,
            query_timeout: safeQueryTimeoutMs,
            statement_timeout: safeQueryTimeoutMs,
            idleTimeoutMillis: 10_000,
            options: `-c search_path=${safeSchemaName},public`,
        });
    } catch {
        throw new Error("POSTGRES_EVENT_POOL_CONFIGURATION_FAILED");
    }
    const database = drizzle(pool, { schema: { gameEvents } });
    const handleIdlePoolError = () => {
        safeWarn("[postgresEventRepository] idle database connection failed");
    };
    pool.on("error", handleIdlePoolError);
    let closed = false;

    return {
        async append(log: ValidatedLog): Promise<void> {
            if (closed) throw new Error("POSTGRES_EVENT_REPOSITORY_CLOSED");
            if (containsPrivateLogField(log)) {
                throw new Error("POSTGRES_EVENT_PRIVATE_FIELD_REJECTED");
            }
            const eventType = requireEventType(log);
            const schemaVersion = requireSchemaVersion(log);
            const gameId = requireString(log, "gameId");
            const playerId = eventType === "placement_decision"
                ? requireString(log, "playerId")
                : null;
            const pieceIndex = eventType === "placement_decision"
                ? requirePieceIndex(log)
                : null;
            const { payload, payloadSha256 } = serializePayload(log);
            const idempotencyKey = createGameEventIdempotencyKey(log);

            try {
                await database.insert(gameEvents).values({
                    eventType,
                    schemaVersion,
                    gameId,
                    roomId: optionalString(log, "roomId"),
                    playerId,
                    pieceIndex,
                    occurredAt: getOccurredAt(log, eventType),
                    payload,
                    payloadSha256,
                    idempotencyKey,
                }).onConflictDoNothing({ target: gameEvents.idempotencyKey });
            } catch {
                throw new Error("POSTGRES_EVENT_APPEND_FAILED");
            }
        },

        async close(): Promise<void> {
            if (closed) return;
            closed = true;
            pool.off("error", handleIdlePoolError);
            try {
                await pool.end();
            } catch {
                throw new Error("POSTGRES_EVENT_CLOSE_FAILED");
            }
        },
    };
}
