import { createPostgresClientConfig } from "./postgresConnection.js";
import {
    DEFAULT_MIGRATION_LOCK_TIMEOUT_MILLIS,
    PostgresMigrationError,
    runPostgresMigrations,
} from "./migrate.js";

function parseLockTimeout(value: string | undefined): number {
    if (value === undefined || value.trim() === "") {
        return DEFAULT_MIGRATION_LOCK_TIMEOUT_MILLIS;
    }
    const timeout = Number(value);
    if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 60_000) {
        throw new PostgresMigrationError("MIGRATION_LOCK_TIMEOUT_INVALID");
    }
    return timeout;
}

export async function runMigrationCli(
    env: NodeJS.ProcessEnv = process.env,
): Promise<{ applied: number; skipped: number }> {
    const migrationDatabaseUrl = env.MIGRATION_DATABASE_URL?.trim();
    if (!migrationDatabaseUrl) {
        throw new PostgresMigrationError("MIGRATION_DATABASE_URL_REQUIRED");
    }

    const clientConfig = createPostgresClientConfig(migrationDatabaseUrl, {
        applicationName: "tetris-goal9a-migration",
        connectionTimeoutMillis: 5_000,
        queryTimeoutMillis: 30_000,
    });
    return runPostgresMigrations({
        clientConfig,
        lockTimeoutMillis: parseLockTimeout(env.MIGRATION_LOCK_TIMEOUT),
    });
}

if (require.main === module) {
    runMigrationCli()
        .then(result => {
            console.log(`PostgreSQL migrations applied=${result.applied} skipped=${result.skipped}`);
        })
        .catch(error => {
            const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
                ? error.message
                : "MIGRATION_FAILED";
            console.error(code);
            process.exitCode = 1;
        });
}
