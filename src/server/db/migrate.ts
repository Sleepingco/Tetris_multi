import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import type { ClientConfig } from "pg";

const MIGRATION_FILE_PATTERN = /^(\d+)_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
const MIGRATION_LOCK_KEY = "9026072300090001";
const MAX_MIGRATION_VERSION = 2_147_483_647;
export const DEFAULT_MIGRATION_LOCK_TIMEOUT_MILLIS = 5_000;

const HISTORY_BOOTSTRAP_SQL = `
CREATE SCHEMA IF NOT EXISTS tetris_analytics;
REVOKE ALL ON SCHEMA tetris_analytics FROM PUBLIC;

CREATE TABLE IF NOT EXISTS tetris_analytics.schema_migrations (
    version integer PRIMARY KEY,
    name text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamp with time zone NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    CONSTRAINT schema_migrations_version_check CHECK (version > 0),
    CONSTRAINT schema_migrations_name_check CHECK (pg_catalog.btrim(name) <> ''),
    CONSTRAINT schema_migrations_checksum_check CHECK (checksum ~ '^[0-9a-f]{64}$')
);

REVOKE ALL ON TABLE tetris_analytics.schema_migrations FROM PUBLIC;
`;

type Migration = {
    version: number;
    name: string;
    checksum: string;
    sql: string;
};

export type RunPostgresMigrationsOptions = {
    clientConfig: ClientConfig;
    lockTimeoutMillis?: number;
    migrationsDirectory?: string;
};

export type MigrationRunResult = {
    applied: number;
    skipped: number;
};

export class PostgresMigrationError extends Error {
    readonly code: string;

    constructor(code: string) {
        super(code);
        this.name = "PostgresMigrationError";
        this.code = code;
    }
}

function fail(code: string): never {
    throw new PostgresMigrationError(code);
}

function normalizeMigrationError(error: unknown, fallback: string): PostgresMigrationError {
    return error instanceof PostgresMigrationError
        ? error
        : new PostgresMigrationError(fallback);
}

function validateLockTimeout(value: number): number {
    if (!Number.isInteger(value) || value <= 0 || value > 60_000) {
        return fail("MIGRATION_LOCK_TIMEOUT_INVALID");
    }
    return value;
}

async function loadMigrations(directory: string): Promise<Migration[]> {
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch {
        return fail("MIGRATION_ARTIFACT_NOT_FOUND");
    }

    const migrations: Migration[] = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".sql")) continue;
        const match = MIGRATION_FILE_PATTERN.exec(entry.name);
        if (!match) return fail("MIGRATION_ARTIFACT_INVALID");

        const version = Number(match[1]);
        if (!Number.isSafeInteger(version) || version <= 0 || version > MAX_MIGRATION_VERSION) {
            return fail("MIGRATION_ARTIFACT_INVALID");
        }

        let bytes: Buffer;
        try {
            bytes = await readFile(path.join(directory, entry.name));
        } catch {
            return fail("MIGRATION_ARTIFACT_NOT_FOUND");
        }
        if (bytes.length === 0) return fail("MIGRATION_ARTIFACT_INVALID");

        migrations.push({
            version,
            name: match[2],
            checksum: createHash("sha256").update(bytes).digest("hex"),
            sql: bytes.toString("utf8"),
        });
    }

    migrations.sort((left, right) => left.version - right.version);
    if (migrations.length === 0) return fail("MIGRATION_ARTIFACT_NOT_FOUND");
    if (new Set(migrations.map(migration => migration.version)).size !== migrations.length) {
        return fail("MIGRATION_VERSION_DUPLICATE");
    }
    return migrations;
}

async function acquireMigrationLock(client: Client, timeoutMillis: number): Promise<void> {
    const deadline = Date.now() + timeoutMillis;
    while (true) {
        const result = await client.query<{ acquired: boolean }>(
            "SELECT pg_catalog.pg_try_advisory_lock($1::bigint) AS acquired",
            [MIGRATION_LOCK_KEY],
        );
        if (result.rows[0]?.acquired === true) return;
        if (Date.now() >= deadline) return fail("MIGRATION_LOCK_TIMEOUT");
        await new Promise(resolve => setTimeout(resolve, 25));
    }
}

/**
 * 고정 advisory lock 아래 raw SQL migration을 version 순서로 각각 transaction 처리한다.
 * 실패해도 rollback, unlock, connection close를 모두 시도하고 외부 오류 내용은 노출하지 않는다.
 */
export async function runPostgresMigrations(
    options: RunPostgresMigrationsOptions,
): Promise<MigrationRunResult> {
    const migrationsDirectory = options.migrationsDirectory
        ?? path.join(__dirname, "migrations");
    const migrations = await loadMigrations(migrationsDirectory);
    const lockTimeoutMillis = validateLockTimeout(
        options.lockTimeoutMillis ?? DEFAULT_MIGRATION_LOCK_TIMEOUT_MILLIS,
    );
    const client = new Client(options.clientConfig);
    let connected = false;
    let lockAcquired = false;
    let transactionOpen = false;
    let failure: PostgresMigrationError | null = null;
    let result: MigrationRunResult = { applied: 0, skipped: 0 };

    try {
        try {
            await client.connect();
            connected = true;
        } catch {
            return fail("MIGRATION_CONNECTION_FAILED");
        }

        try {
            await acquireMigrationLock(client, lockTimeoutMillis);
            lockAcquired = true;
        } catch (error) {
            throw normalizeMigrationError(error, "MIGRATION_LOCK_FAILED");
        }

        await client.query("BEGIN");
        transactionOpen = true;
        await client.query(HISTORY_BOOTSTRAP_SQL);
        await client.query("COMMIT");
        transactionOpen = false;

        const historyResult = await client.query<{
            version: number;
            name: string;
            checksum: string;
        }>(
            `SELECT version, name, checksum
               FROM tetris_analytics.schema_migrations
              ORDER BY version`,
        );
        const history = new Map(historyResult.rows.map(row => [row.version, row]));

        for (const migration of migrations) {
            const applied = history.get(migration.version);
            if (applied) {
                if (applied.name !== migration.name || applied.checksum !== migration.checksum) {
                    return fail("MIGRATION_CHECKSUM_MISMATCH");
                }
                result = { ...result, skipped: result.skipped + 1 };
                continue;
            }

            await client.query("BEGIN");
            transactionOpen = true;
            await client.query(migration.sql);
            await client.query(
                `INSERT INTO tetris_analytics.schema_migrations (version, name, checksum)
                 VALUES ($1, $2, $3)`,
                [migration.version, migration.name, migration.checksum],
            );
            await client.query("COMMIT");
            transactionOpen = false;
            result = { ...result, applied: result.applied + 1 };
        }
    } catch (error) {
        failure = normalizeMigrationError(error, "MIGRATION_FAILED");
    } finally {
        if (transactionOpen) {
            try {
                await client.query("ROLLBACK");
            } catch {
                failure ??= new PostgresMigrationError("MIGRATION_ROLLBACK_FAILED");
            }
        }
        if (lockAcquired) {
            try {
                await client.query(
                    "SELECT pg_catalog.pg_advisory_unlock($1::bigint)",
                    [MIGRATION_LOCK_KEY],
                );
            } catch {
                failure ??= new PostgresMigrationError("MIGRATION_UNLOCK_FAILED");
            }
        }
        if (connected) {
            try {
                await client.end();
            } catch {
                failure ??= new PostgresMigrationError("MIGRATION_CLOSE_FAILED");
            }
        }
    }

    if (failure) throw failure;
    return result;
}
