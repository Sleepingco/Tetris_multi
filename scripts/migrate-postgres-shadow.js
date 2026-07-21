const path = require("node:path");
const { drizzle } = require("drizzle-orm/node-postgres");
const { migrate } = require("drizzle-orm/node-postgres/migrator");
const { Pool } = require("pg");

const DEFAULT_SCHEMA_NAME = "tetris_analytics";
const SCHEMA_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

function validateConnectionString(connectionString) {
    let parsed;
    try {
        parsed = new URL(connectionString);
    } catch {
        throw new Error("POSTGRES_MIGRATION_CONNECTION_INVALID");
    }
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
        throw new Error("POSTGRES_MIGRATION_CONNECTION_PROTOCOL_INVALID");
    }
    const host = parsed.hostname.toLowerCase();
    const isLoopback = host === "localhost" || host === "127.0.0.1"
        || host === "::1" || host === "[::1]";
    const sslModes = parsed.searchParams.getAll("sslmode");
    if (!isLoopback && (sslModes.length !== 1 || sslModes[0] !== "verify-full")) {
        throw new Error("POSTGRES_MIGRATION_SSL_REQUIRED");
    }
    return connectionString;
}

async function migratePostgresEvents({
    connectionString,
    schemaName = DEFAULT_SCHEMA_NAME,
    migrationsFolder = path.resolve(__dirname, "..", "drizzle"),
}) {
    const configuredConnectionString = connectionString?.trim();
    if (!configuredConnectionString) throw new Error("POSTGRES_MIGRATION_CONNECTION_REQUIRED");
    const safeConnectionString = validateConnectionString(configuredConnectionString);
    if (!SCHEMA_NAME_PATTERN.test(schemaName)) {
        throw new Error("POSTGRES_MIGRATION_SCHEMA_NAME_INVALID");
    }

    let pool;
    try {
        pool = new Pool({
            connectionString: safeConnectionString,
            max: 1,
            connectionTimeoutMillis: 2_000,
            query_timeout: 5_000,
            statement_timeout: 5_000,
            idleTimeoutMillis: 10_000,
            options: `-c search_path=${schemaName},public`,
        });
    } catch {
        throw new Error("POSTGRES_MIGRATION_POOL_CONFIGURATION_FAILED");
    }
    const handleIdlePoolError = () => {
        console.warn("[postgresMigration] idle database connection failed");
    };
    pool.on("error", handleIdlePoolError);

    let failure = null;
    try {
        await migrate(drizzle(pool), {
            migrationsFolder,
            migrationsSchema: schemaName,
        });
    } catch {
        failure = new Error("POSTGRES_MIGRATION_FAILED");
    }
    pool.off("error", handleIdlePoolError);
    try {
        await pool.end();
    } catch {
        failure ||= new Error("POSTGRES_MIGRATION_CLOSE_FAILED");
    }
    if (failure) throw failure;
}

async function main() {
    const connectionString = process.env.MIGRATION_DATABASE_URL?.trim();
    if (!connectionString) {
        console.error("MIGRATION_DATABASE_URL is required.");
        process.exitCode = 1;
        return;
    }

    try {
        await migratePostgresEvents({
            connectionString,
            schemaName: process.env.POSTGRES_SHADOW_SCHEMA?.trim() || DEFAULT_SCHEMA_NAME,
        });
        console.log("PostgreSQL shadow migration complete.");
    } catch {
        console.error("PostgreSQL shadow migration failed.");
        process.exitCode = 1;
    }
}

module.exports = {
    migratePostgresEvents,
};

if (require.main === module) {
    void main();
}
