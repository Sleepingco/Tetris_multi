import { isIP } from "node:net";
import type { ClientConfig } from "pg";

const MAX_TIMEOUT_MILLIS = 60_000;
const DEFAULT_CONNECTION_TIMEOUT_MILLIS = 10_000;
const DEFAULT_APPLICATION_NAME = "tetris-multi-postgres";
const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const ALLOWED_QUERY_OPTIONS = new Set(["sslmode"]);
const APPLICATION_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,62}$/;
const AMBIENT_POSTGRES_ENV_NAMES = [
    "PGAPPNAME",
    "PGBINARY",
    "PGCHANNELBINDING",
    "PGCLIENTENCODING",
    "PGCLIENT_ENCODING",
    "PGCONNECT_TIMEOUT",
    "PGDATABASE",
    "PGGSSLIB",
    "PGHOST",
    "PGHOSTADDR",
    "PGKRBSRVNAME",
    "PGOPTIONS",
    "PGPASSWORD",
    "PGPASSFILE",
    "PGPASS_NO_DEESCAPE",
    "PGPORT",
    "PGREPLICATION",
    "PGREQUIREPEER",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGSSLCERT",
    "PGSSLCRL",
    "PGSSLCRLDIR",
    "PGSSLKEY",
    "PGSSLMAXPROTOCOLVERSION",
    "PGSSLMINPROTOCOLVERSION",
    "PGSSLMODE",
    "PGSSLNEGOTIATION",
    "PGSSLROOTCERT",
    "PGTARGETSESSIONATTRS",
    "PGUSER",
] as const;

export type PostgresConnectionOptions = {
    applicationName?: string;
    ca?: string;
    connectionTimeoutMillis?: number;
    queryTimeoutMillis?: number;
};

export class PostgresConnectionConfigError extends Error {
    readonly code: string;

    constructor(code: string) {
        super(code);
        this.name = "PostgresConnectionConfigError";
        this.code = code;
    }
}

function fail(code: string): never {
    throw new PostgresConnectionConfigError(code);
}

function decodeUrlPart(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return fail("POSTGRES_CONNECTION_INVALID");
    }
}

function normalizeHost(hostname: string): string {
    return hostname.startsWith("[") && hostname.endsWith("]")
        ? hostname.slice(1, -1).toLowerCase()
        : hostname.toLowerCase();
}

function isLoopbackHost(hostname: string): boolean {
    if (hostname === "localhost" || hostname === "::1") return true;
    return isIP(hostname) === 4 && hostname.split(".")[0] === "127";
}

function rejectAmbientPostgresEnvironment(): void {
    if (AMBIENT_POSTGRES_ENV_NAMES.some(name => process.env[name] !== undefined)) {
        return fail("POSTGRES_CONNECTION_AMBIENT_ENV_NOT_ALLOWED");
    }
}

function validateTimeout(value: number | undefined): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isInteger(value) || value <= 0 || value > MAX_TIMEOUT_MILLIS) {
        return fail("POSTGRES_CONNECTION_TIMEOUT_INVALID");
    }
    return value;
}

/**
 * PostgreSQL URL을 한 번만 parse하고 검증된 개별 필드로 pg ClientConfig를 만든다.
 * 원래 URL은 반환하거나 오류에 포함하지 않으며 connectionString도 pg에 전달하지 않는다.
 */
export function createPostgresClientConfig(
    databaseUrl: string,
    options: PostgresConnectionOptions = {},
): ClientConfig {
    if (typeof databaseUrl !== "string" || databaseUrl.trim().length === 0) {
        return fail("POSTGRES_CONNECTION_URL_REQUIRED");
    }
    rejectAmbientPostgresEnvironment();

    let parsed: URL;
    try {
        parsed = new URL(databaseUrl.trim());
    } catch {
        return fail("POSTGRES_CONNECTION_INVALID");
    }

    if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
        return fail("POSTGRES_CONNECTION_PROTOCOL_INVALID");
    }
    if (parsed.hash) {
        return fail("POSTGRES_CONNECTION_FRAGMENT_NOT_ALLOWED");
    }

    for (const key of parsed.searchParams.keys()) {
        if (!ALLOWED_QUERY_OPTIONS.has(key)) {
            return fail("POSTGRES_CONNECTION_QUERY_OPTION_NOT_ALLOWED");
        }
    }

    const sslModes = parsed.searchParams.getAll("sslmode");
    if (sslModes.length > 1) {
        return fail("POSTGRES_CONNECTION_QUERY_OPTION_DUPLICATE");
    }

    const host = normalizeHost(parsed.hostname);
    const loopback = isLoopbackHost(host);
    const sslMode = sslModes[0] ?? (loopback ? "disable" : "");
    if (sslMode !== "disable" && sslMode !== "verify-full") {
        return fail("POSTGRES_CONNECTION_SSL_MODE_INVALID");
    }
    if (!loopback && sslMode !== "verify-full") {
        return fail("POSTGRES_CONNECTION_TLS_REQUIRED");
    }
    if (!loopback && isIP(host) !== 0) {
        return fail("POSTGRES_CONNECTION_DNS_HOST_REQUIRED");
    }

    const user = decodeUrlPart(parsed.username);
    const password = decodeUrlPart(parsed.password);
    const database = decodeUrlPart(parsed.pathname.slice(1));
    if (!host || !user || !database || database.includes("/")) {
        return fail("POSTGRES_CONNECTION_FIELDS_REQUIRED");
    }
    if (!password) {
        return fail("POSTGRES_CONNECTION_PASSWORD_REQUIRED");
    }

    const port = parsed.port ? Number(parsed.port) : 5432;
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
        return fail("POSTGRES_CONNECTION_PORT_INVALID");
    }

    const connectionTimeoutMillis = validateTimeout(options.connectionTimeoutMillis);
    const queryTimeoutMillis = validateTimeout(options.queryTimeoutMillis);
    if (
        options.applicationName !== undefined
        && !APPLICATION_NAME_PATTERN.test(options.applicationName)
    ) {
        return fail("POSTGRES_CONNECTION_APPLICATION_NAME_INVALID");
    }
    if (
        options.ca !== undefined
        && (typeof options.ca !== "string" || options.ca.trim().length === 0)
    ) {
        return fail("POSTGRES_CONNECTION_CA_INVALID");
    }
    if (sslMode === "disable" && options.ca !== undefined) {
        return fail("POSTGRES_CONNECTION_CA_WITHOUT_TLS");
    }

    const config: ClientConfig & {
        replication: "false";
        sslnegotiation: "postgres";
    } = {
        host,
        port,
        database,
        user,
        password,
        application_name: options.applicationName ?? DEFAULT_APPLICATION_NAME,
        client_encoding: "UTF8",
        connectionTimeoutMillis:
            connectionTimeoutMillis ?? DEFAULT_CONNECTION_TIMEOUT_MILLIS,
        options: "-c standard_conforming_strings=on",
        replication: "false",
        ssl: sslMode === "verify-full"
            ? {
                rejectUnauthorized: true,
                servername: host,
                ...(options.ca === undefined ? {} : { ca: options.ca }),
            }
            : false,
        sslnegotiation: "postgres",
    };

    if (queryTimeoutMillis !== undefined) {
        config.query_timeout = queryTimeoutMillis;
        config.statement_timeout = queryTimeoutMillis;
    }

    return config;
}
