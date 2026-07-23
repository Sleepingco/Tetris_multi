/**
 * Goal 9B raw migration, role boundary, repository와 source-less artifact를
 * loopback의 격리된 실제 PostgreSQL 하나에서 검증한다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { createHash, randomBytes } = require("node:crypto");
const { cp, mkdtemp, readFile, readdir, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { checkServerIdentity } = require("node:tls");
const { Client } = require("pg");

const {
    createCanonicalGameEvent,
    prepareCanonicalGameEvent,
} = require("../dist/server/server/db/canonicalGameEvent.js");
const {
    runJsonlImport,
} = require("../dist/server/server/db/importJsonl.js");
const {
    runPostgresMigrations,
} = require("../dist/server/server/db/migrate.js");
const {
    createPostgresClientConfig,
} = require("../dist/server/server/db/postgresConnection.js");
const {
    createPostgresEventRepository,
} = require("../dist/server/server/repositories/postgresEventRepository.js");
const {
    createRuntimeEventStorage,
    POSTGRES_RUNTIME_IN_FLIGHT_MAX,
    POSTGRES_RUNTIME_POOL_MAX,
} = require("../dist/server/server/services/runtimeEventStorage.js");

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIRECTORY = path.join(
    ROOT,
    "dist",
    "server",
    "server",
    "db",
    "migrations",
);
const SOURCE_MIGRATIONS_DIRECTORY = path.join(
    ROOT,
    "src",
    "server",
    "db",
    "migrations",
);
const MIGRATION_ROLE = "tetris_goal9b_migration";
const RUNTIME_ROLE = "tetris_goal9b_runtime";
const IMPORT_ROLE = "tetris_goal9c_import";
const MAIN_DATABASE = "tetris_goal9b_test";
const CONCURRENT_DATABASE = "tetris_goal9b_concurrent";
const FAILURE_DATABASE = "tetris_goal9b_failure";
const HOSTILE_DATABASE = "tetris_goal9b_hostile";
const RELEASE_DATABASE = "tetris_goal9b_release";
const OLD_SCHEMA_DATABASE = "tetris_goal9b_old_schema";
const LOCAL_IMPORT_DATABASE = "tetris_goal9c_local_import";
const DATABASES = [
    MAIN_DATABASE,
    CONCURRENT_DATABASE,
    FAILURE_DATABASE,
    HOSTILE_DATABASE,
    RELEASE_DATABASE,
    OLD_SCHEMA_DATABASE,
    LOCAL_IMPORT_DATABASE,
];
const ADVISORY_LOCK_KEY = "9026072300090001";

function requireEnvironment(name) {
    const value = process.env[name];
    if (!value) throw new Error(`GOAL9B_TEST_ENV_${name}_REQUIRED`);
    return value;
}

function quoteIdentifier(value) {
    if (!/^[a-z][a-z0-9_]*$/.test(value)) {
        throw new Error("GOAL9B_TEST_IDENTIFIER_INVALID");
    }
    return `"${value}"`;
}

function quoteTestPassword(databaseUrl) {
    const password = decodeURIComponent(new URL(databaseUrl).password);
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(password)) {
        throw new Error("GOAL9B_TEST_PASSWORD_INVALID");
    }
    return `'${password}'`;
}

function databaseUrl(baseUrl, user, database) {
    const url = new URL(baseUrl);
    url.username = user;
    url.pathname = `/${database}`;
    return url.toString();
}

function sha256(value) {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

function clientConfig(url, options = {}) {
    return createPostgresClientConfig(url, {
        applicationName: options.applicationName ?? "goal9b-integration",
        ca: options.ca,
        connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
        queryTimeoutMillis: options.queryTimeoutMillis ?? 10_000,
    });
}

async function withClient(config, callback) {
    const client = new Client(config);
    await client.connect();
    try {
        return await callback(client);
    } finally {
        await client.end();
    }
}

async function createRolesAndDatabases(adminUrl) {
    const rolePassword = quoteTestPassword(adminUrl);
    await withClient(clientConfig(adminUrl), async client => {
        await client.query(
            `CREATE ROLE ${quoteIdentifier(MIGRATION_ROLE)}
                LOGIN PASSWORD ${rolePassword}
                NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`,
        );
        await client.query(
            `CREATE ROLE ${quoteIdentifier(RUNTIME_ROLE)}
                LOGIN PASSWORD ${rolePassword}
                NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`,
        );
        await client.query(
            `CREATE ROLE ${quoteIdentifier(IMPORT_ROLE)}
                LOGIN PASSWORD ${rolePassword}
                NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`,
        );
        for (const database of DATABASES) {
            await client.query(`CREATE DATABASE ${quoteIdentifier(database)}`);
            await client.query(
                `REVOKE ALL ON DATABASE ${quoteIdentifier(database)} FROM PUBLIC`,
            );
            await client.query(
                `GRANT CONNECT, CREATE ON DATABASE ${quoteIdentifier(database)}
                    TO ${quoteIdentifier(MIGRATION_ROLE)}`,
            );
            await client.query(
                `ALTER ROLE ${quoteIdentifier(MIGRATION_ROLE)}
                    IN DATABASE ${quoteIdentifier(database)}
                    SET search_path TO tetris_analytics, pg_catalog`,
            );
        }
        await client.query(
            `GRANT CONNECT ON DATABASE ${quoteIdentifier(MAIN_DATABASE)}
                TO ${quoteIdentifier(RUNTIME_ROLE)}`,
        );
        await client.query(
            `ALTER ROLE ${quoteIdentifier(RUNTIME_ROLE)}
                IN DATABASE ${quoteIdentifier(MAIN_DATABASE)}
                SET search_path TO tetris_analytics, pg_catalog`,
        );
        for (const database of [MAIN_DATABASE, LOCAL_IMPORT_DATABASE]) {
            await client.query(
                `GRANT CONNECT ON DATABASE ${quoteIdentifier(database)}
                    TO ${quoteIdentifier(IMPORT_ROLE)}`,
            );
            await client.query(
                `ALTER ROLE ${quoteIdentifier(IMPORT_ROLE)}
                    IN DATABASE ${quoteIdentifier(database)}
                    SET search_path TO tetris_analytics, pg_catalog`,
            );
        }
    });

    for (const database of DATABASES) {
        const databaseAdminUrl = databaseUrl(adminUrl, "postgres", database);
        await withClient(clientConfig(databaseAdminUrl), client => {
            return client.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
        });
    }
}

function migrationOptions(plainUrl, database, applicationName, extra = {}) {
    return {
        clientConfig: clientConfig(
            databaseUrl(plainUrl, MIGRATION_ROLE, database),
            { applicationName },
        ),
        ...extra,
    };
}

async function grantRuntimePrivileges(plainUrl) {
    return grantEventWriterPrivileges(
        plainUrl,
        MAIN_DATABASE,
        RUNTIME_ROLE,
    );
}

async function grantEventWriterPrivileges(plainUrl, database, role) {
    const migrationUrl = databaseUrl(plainUrl, MIGRATION_ROLE, database);
    await withClient(clientConfig(migrationUrl), async client => {
        await client.query(`
            GRANT USAGE ON SCHEMA tetris_analytics
                TO ${quoteIdentifier(role)};
            GRANT INSERT (
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
            ) ON tetris_analytics.game_events
                TO ${quoteIdentifier(role)};
            GRANT SELECT (
                event_id,
                event_type,
                game_id,
                player_id,
                piece_index,
                event_sha256
            ) ON tetris_analytics.game_events
                TO ${quoteIdentifier(role)};
            GRANT SELECT (version, name, checksum)
                ON tetris_analytics.schema_migrations
                TO ${quoteIdentifier(role)};
        `);
    });
}

function createPlacementEvent(overrides = {}) {
    return {
        identityVersion: "identity-v1",
        eventType: "placement_decision",
        schemaVersion: 2,
        gameId: "integration-game-placement",
        playerId: "integration-player",
        pieceIndex: 1,
        trustLevel: "client_reported",
        occurredAt: "2026-07-23T07:08:09Z",
        payload: {
            placement: { col: 4, pieceType: "tree", rotation: 1, row: 17 },
            metrics: { aggregateHeight: 12, holes: 0 },
        },
        ...overrides,
    };
}

function createLifecycleEvent(eventType, overrides = {}) {
    return {
        identityVersion: "identity-v1",
        eventType,
        schemaVersion: 1,
        gameId: "integration-game-lifecycle",
        playerId: null,
        pieceIndex: null,
        trustLevel: "server_authoritative",
        occurredAt: "2026-07-23T07:08:09.123Z",
        payload: { mode: "pvp" },
        ...overrides,
    };
}

function rawEvent(label, overrides = {}) {
    return {
        identityVersion: "identity-v1",
        eventId: sha256(`event-id:${label}`),
        eventType: "placement_decision",
        schemaVersion: 2,
        gameId: `raw-game-${label}`,
        playerId: `raw-player-${label}`,
        pieceIndex: 1,
        trustLevel: "client_reported",
        occurredAt: "2026-07-23T07:08:09.123Z",
        payload: { label },
        eventSha256: sha256(`event-sha:${label}`),
        ...overrides,
    };
}

const INSERT_RAW_EVENT_SQL = `
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
`;

function insertRawEvent(client, event) {
    return client.query(INSERT_RAW_EVENT_SQL, [
        event.identityVersion,
        event.eventId,
        event.eventType,
        event.schemaVersion,
        event.gameId,
        event.playerId,
        event.pieceIndex,
        event.trustLevel,
        event.occurredAt,
        JSON.stringify(event.payload),
        event.eventSha256,
    ]);
}

async function assertSqlStateError(promise, code) {
    await assert.rejects(promise, error => {
        assert.equal(error.code, code);
        return true;
    });
}

async function verifyTls(tlsUrl, ca) {
    await withClient(clientConfig(tlsUrl, { ca }), async client => {
        const result = await client.query(`
            SELECT current_setting('ssl') AS ssl,
                   current_user AS current_user
        `);
        assert.equal(result.rows[0].ssl, "on");
        assert.equal(result.rows[0].current_user, "postgres");
    });

    await assert.rejects(
        withClient(clientConfig(tlsUrl), () => Promise.resolve()),
        error => {
            assert.match(error.message, /certificate|issuer|self-signed/i);
            assert.doesNotMatch(error.message, /postgresql:\/\//i);
            return true;
        },
    );
    const mismatchConfig = clientConfig(tlsUrl, { ca });
    mismatchConfig.ssl = {
        ...mismatchConfig.ssl,
        checkServerIdentity(_hostname, certificate) {
            return checkServerIdentity(
                "goal9b-hostname-mismatch.invalid",
                certificate,
            );
        },
    };
    await assert.rejects(
        withClient(mismatchConfig, () => Promise.resolve()),
        error => {
            assert.match(error.message, /hostname|IP address|certificate/i);
            assert.doesNotMatch(error.message, /postgresql:\/\//i);
            return true;
        },
    );
}

async function verifyMigrations(plainUrl) {
    const first = await runPostgresMigrations(
        migrationOptions(plainUrl, MAIN_DATABASE, "goal9b-migrate-first"),
    );
    const second = await runPostgresMigrations(
        migrationOptions(plainUrl, MAIN_DATABASE, "goal9b-migrate-second"),
    );
    assert.deepEqual(first, { applied: 2, skipped: 0 });
    assert.deepEqual(second, { applied: 0, skipped: 2 });

    const adminUrl = databaseUrl(plainUrl, "postgres", MAIN_DATABASE);
    await withClient(clientConfig(adminUrl), async client => {
        const history = await client.query(`
            SELECT version, name, checksum, applied_at
              FROM tetris_analytics.schema_migrations
             ORDER BY version
        `);
        assert.equal(history.rowCount, 2);
        assert.equal(history.rows[0].version, 1);
        assert.equal(history.rows[0].name, "game_events");
        assert.match(history.rows[0].checksum, /^[0-9a-f]{64}$/);
        assert.ok(history.rows[0].applied_at instanceof Date);
        assert.equal(history.rows[1].version, 2);
        assert.equal(history.rows[1].name, "lifecycle_event_v2");
        assert.match(history.rows[1].checksum, /^[0-9a-f]{64}$/);

        const invalidHistoryRows = [
            [-1, "negative", sha256("negative")],
            [9_001, "   ", sha256("blank")],
            [9_002, "invalid_checksum", "NOT-A-CHECKSUM"],
        ];
        for (const row of invalidHistoryRows) {
            await assertSqlStateError(
                client.query(
                    `INSERT INTO tetris_analytics.schema_migrations
                        (version, name, checksum)
                     VALUES ($1, $2, $3)`,
                    row,
                ),
                "23514",
            );
        }
    });

    const hostileAdminUrl = databaseUrl(plainUrl, "postgres", HOSTILE_DATABASE);
    await withClient(clientConfig(hostileAdminUrl), async client => {
        await client.query(`
            CREATE SCHEMA tetris_analytics
                AUTHORIZATION ${quoteIdentifier(RUNTIME_ROLE)};
            CREATE TABLE tetris_analytics.schema_migrations (
                version integer PRIMARY KEY,
                name text NOT NULL,
                checksum text NOT NULL,
                applied_at timestamp with time zone NOT NULL
                    DEFAULT pg_catalog.clock_timestamp()
            );
            ALTER TABLE tetris_analytics.schema_migrations
                OWNER TO ${quoteIdentifier(RUNTIME_ROLE)};
            GRANT USAGE, CREATE ON SCHEMA tetris_analytics
                TO ${quoteIdentifier(MIGRATION_ROLE)};
            GRANT ALL ON TABLE tetris_analytics.schema_migrations
                TO ${quoteIdentifier(MIGRATION_ROLE)};
        `);
    });
    await assert.rejects(
        runPostgresMigrations(
            migrationOptions(plainUrl, HOSTILE_DATABASE, "goal9b-hostile-owner"),
        ),
        { code: "MIGRATION_BOOTSTRAP_OWNER_MISMATCH" },
    );
    await withClient(clientConfig(hostileAdminUrl), async client => {
        const state = await client.query(`
            SELECT pg_catalog.pg_get_userbyid(n.nspowner) AS schema_owner,
                   pg_catalog.pg_get_userbyid(c.relowner) AS history_owner,
                   pg_catalog.to_regclass(
                       'tetris_analytics.game_events'
                   ) AS game_events,
                   (
                       SELECT pg_catalog.count(*)
                         FROM pg_catalog.pg_stat_activity
                        WHERE application_name = 'goal9b-hostile-owner'
                   )::integer AS open_runner_count
              FROM pg_catalog.pg_namespace AS n
              JOIN pg_catalog.pg_class AS c
                ON c.relnamespace = n.oid
               AND c.relname = 'schema_migrations'
             WHERE n.nspname = 'tetris_analytics'
        `);
        assert.deepEqual(state.rows[0], {
            schema_owner: RUNTIME_ROLE,
            history_owner: RUNTIME_ROLE,
            game_events: null,
            open_runner_count: 0,
        });
    });

    const concurrentResults = await Promise.all([
        runPostgresMigrations(
            migrationOptions(plainUrl, CONCURRENT_DATABASE, "goal9b-concurrent-a"),
        ),
        runPostgresMigrations(
            migrationOptions(plainUrl, CONCURRENT_DATABASE, "goal9b-concurrent-b"),
        ),
    ]);
    assert.equal(concurrentResults.reduce((sum, value) => sum + value.applied, 0), 2);
    assert.equal(concurrentResults.reduce((sum, value) => sum + value.skipped, 0), 2);

    const concurrentAdminUrl = databaseUrl(
        plainUrl,
        "postgres",
        CONCURRENT_DATABASE,
    );
    await withClient(clientConfig(concurrentAdminUrl), async client => {
        await client.query(
            "SELECT pg_catalog.pg_advisory_lock($1::bigint)",
            [ADVISORY_LOCK_KEY],
        );
        try {
            await assert.rejects(
                runPostgresMigrations(migrationOptions(
                    plainUrl,
                    CONCURRENT_DATABASE,
                    "goal9b-lock-timeout",
                    { lockTimeoutMillis: 50 },
                )),
                { code: "MIGRATION_LOCK_TIMEOUT" },
            );
        } finally {
            await client.query(
                "SELECT pg_catalog.pg_advisory_unlock($1::bigint)",
                [ADVISORY_LOCK_KEY],
            );
        }
    });

    await withClient(clientConfig(adminUrl), async client => {
        const original = await client.query(
            "SELECT checksum FROM tetris_analytics.schema_migrations WHERE version = 1",
        );
        await client.query(
            "UPDATE tetris_analytics.schema_migrations SET checksum = $1 WHERE version = 1",
            ["0".repeat(64)],
        );
        try {
            await assert.rejects(
                runPostgresMigrations(
                    migrationOptions(plainUrl, MAIN_DATABASE, "goal9b-checksum"),
                ),
                { code: "MIGRATION_CHECKSUM_MISMATCH" },
            );
        } finally {
            await client.query(
                "UPDATE tetris_analytics.schema_migrations SET checksum = $1 WHERE version = 1",
                [original.rows[0].checksum],
            );
        }
    });

    await runPostgresMigrations(
        migrationOptions(plainUrl, FAILURE_DATABASE, "goal9b-failure-bootstrap"),
    );
    const failureDirectory = await mkdtemp(
        path.join(os.tmpdir(), "tetris-goal9b-failing-migrations-"),
    );
    try {
        await cp(SOURCE_MIGRATIONS_DIRECTORY, failureDirectory, {
            recursive: true,
        });
        await writeFile(
            path.join(failureDirectory, "003_forced_failure.sql"),
            `CREATE TABLE tetris_analytics.must_rollback (id integer PRIMARY KEY);
SELECT 1 / 0;
`,
            "utf8",
        );
        await assert.rejects(
            runPostgresMigrations(migrationOptions(
                plainUrl,
                FAILURE_DATABASE,
                "goal9b-failure-runner",
                { migrationsDirectory: failureDirectory },
            )),
            { code: "MIGRATION_FAILED" },
        );

        const failureAdminUrl = databaseUrl(plainUrl, "postgres", FAILURE_DATABASE);
        await withClient(clientConfig(failureAdminUrl), async client => {
            const state = await client.query(`
                SELECT pg_catalog.to_regclass(
                           'tetris_analytics.must_rollback'
                       ) AS rolled_back_table,
                       (
                           SELECT pg_catalog.count(*)
                             FROM tetris_analytics.schema_migrations
                       )::integer AS migration_count,
                       (
                           SELECT pg_catalog.count(*)
                             FROM pg_catalog.pg_stat_activity
                            WHERE application_name = 'goal9b-failure-runner'
                       )::integer AS open_runner_count
            `);
            assert.equal(state.rows[0].rolled_back_table, null);
            assert.equal(state.rows[0].migration_count, 2);
            assert.equal(state.rows[0].open_runner_count, 0);
        });
        assert.deepEqual(
            await runPostgresMigrations(
                migrationOptions(plainUrl, FAILURE_DATABASE, "goal9b-after-failure"),
            ),
            { applied: 0, skipped: 2 },
        );
    } finally {
        await rm(failureDirectory, { recursive: true, force: true });
    }

    const oldSchemaDirectory = await mkdtemp(
        path.join(os.tmpdir(), "tetris-goal9b-old-schema-migrations-"),
    );
    try {
        await cp(
            path.join(SOURCE_MIGRATIONS_DIRECTORY, "001_game_events.sql"),
            path.join(oldSchemaDirectory, "001_game_events.sql"),
        );
        assert.deepEqual(
            await runPostgresMigrations(migrationOptions(
                plainUrl,
                OLD_SCHEMA_DATABASE,
                "goal9b-old-schema",
                { migrationsDirectory: oldSchemaDirectory },
            )),
            { applied: 1, skipped: 0 },
        );
    } finally {
        await rm(oldSchemaDirectory, { recursive: true, force: true });
    }
}

async function verifySchemaAndRoles(plainUrl) {
    const adminUrl = databaseUrl(plainUrl, "postgres", MAIN_DATABASE);
    await withClient(clientConfig(adminUrl), async client => {
        const ownership = await client.query(`
            SELECT c.relname, pg_catalog.pg_get_userbyid(c.relowner) AS owner
              FROM pg_catalog.pg_class AS c
              JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
             WHERE n.nspname = 'tetris_analytics'
               AND c.relname IN ('game_events', 'schema_migrations')
             ORDER BY c.relname
        `);
        assert.deepEqual(
            ownership.rows,
            [
                { relname: "game_events", owner: MIGRATION_ROLE },
                { relname: "schema_migrations", owner: MIGRATION_ROLE },
            ],
        );
        const schemaOwner = await client.query(`
            SELECT pg_catalog.pg_get_userbyid(nspowner) AS owner
              FROM pg_catalog.pg_namespace
             WHERE nspname = 'tetris_analytics'
        `);
        assert.equal(schemaOwner.rows[0].owner, MIGRATION_ROLE);

        const indexes = await client.query(`
            SELECT indexname, indexdef
              FROM pg_catalog.pg_indexes
             WHERE schemaname = 'tetris_analytics'
               AND tablename = 'game_events'
             ORDER BY indexname
        `);
        const definitions = new Map(
            indexes.rows.map(row => [row.indexname, row.indexdef]),
        );
        assert.equal(definitions.size, 5);
        assert.match(
            definitions.get("game_events_lifecycle_identity_uq"),
            /UNIQUE.*\(event_type, game_id\).*WHERE.*game_start.*game_over/i,
        );
        assert.match(
            definitions.get("game_events_placement_identity_uq"),
            /UNIQUE.*\(event_type, game_id, player_id, piece_index\).*WHERE/i,
        );
        assert.match(definitions.get("game_events_game_id_idx"), /\(game_id\)/);
        assert.match(
            definitions.get("game_events_event_type_ingested_at_idx"),
            /\(event_type, ingested_at\)/,
        );

        const validRows = [
            rawEvent("valid-game-start", {
                eventType: "game_start",
                schemaVersion: 1,
                gameId: "raw-lifecycle-valid",
                playerId: null,
                pieceIndex: null,
                trustLevel: "server_authoritative",
            }),
            rawEvent("valid-placement-v1", {
                schemaVersion: 1,
                occurredAt: null,
            }),
            rawEvent("valid-placement-v2-server", {
                trustLevel: "server_authoritative",
            }),
            rawEvent("valid-game-over", {
                eventType: "game_over",
                schemaVersion: 1,
                gameId: "raw-lifecycle-valid",
                playerId: null,
                pieceIndex: null,
                trustLevel: "server_authoritative",
            }),
            rawEvent("valid-game-start-v2", {
                eventType: "game_start",
                schemaVersion: 2,
                gameId: "raw-lifecycle-v2",
                playerId: null,
                pieceIndex: null,
                trustLevel: "server_authoritative",
            }),
            rawEvent("valid-game-over-v2", {
                eventType: "game_over",
                schemaVersion: 2,
                gameId: "raw-lifecycle-v2",
                playerId: null,
                pieceIndex: null,
                trustLevel: "server_authoritative",
            }),
            rawEvent("valid-identity-byte-boundary", {
                gameId: "\u00e9".repeat(32),
                playerId: "\u00e9".repeat(32),
            }),
            rawEvent("valid-normal-identities", {
                gameId: "normal-game-01",
                playerId: "player-\ud5c8\uc6a9-01",
            }),
        ];
        for (const row of validRows) {
            await insertRawEvent(client, row);
        }

        const invalidRows = [
            rawEvent("identity-v2", { identityVersion: "identity-v2" }),
            rawEvent("bad-event-id", { eventId: "not-a-digest" }),
            rawEvent("bad-event-type", { eventType: "chat_message" }),
            rawEvent("bad-schema", { schemaVersion: 0 }),
            rawEvent("blank-game", { gameId: "  " }),
            rawEvent("tab-only-game", { gameId: "\t\t" }),
            rawEvent("newline-only-game", { gameId: "\n\n" }),
            rawEvent("unicode-whitespace-only-game", { gameId: "\u00a0\u2003" }),
            rawEvent("blank-player", { playerId: "  " }),
            rawEvent("whitespace-only-player", { playerId: "\t\r\n" }),
            rawEvent("negative-piece", { pieceIndex: -1 }),
            rawEvent("bad-trust", { trustLevel: "untrusted" }),
            rawEvent("bad-payload", { payload: [] }),
            rawEvent("bad-event-sha", { eventSha256: "not-a-digest" }),
            rawEvent("start-client", {
                eventType: "game_start",
                schemaVersion: 1,
                playerId: null,
                pieceIndex: null,
                trustLevel: "client_reported",
            }),
            rawEvent("over-with-player", {
                eventType: "game_over",
                schemaVersion: 1,
                playerId: "not-allowed",
                pieceIndex: null,
                trustLevel: "server_authoritative",
            }),
            rawEvent("lifecycle-without-time", {
                eventType: "game_start",
                schemaVersion: 1,
                playerId: null,
                pieceIndex: null,
                occurredAt: null,
                trustLevel: "server_authoritative",
            }),
            rawEvent("placement-without-piece", { pieceIndex: null }),
            rawEvent("placement-v2-without-time", { occurredAt: null }),
            rawEvent("future-identity-schema", { schemaVersion: 3 }),
            rawEvent("future-lifecycle-schema", {
                eventType: "game_start",
                schemaVersion: 3,
                playerId: null,
                pieceIndex: null,
                trustLevel: "server_authoritative",
            }),
            rawEvent("game-id-byte-overflow", {
                gameId: `${"\u00e9".repeat(32)}x`,
            }),
            rawEvent("player-id-byte-overflow", {
                playerId: `${"\u00e9".repeat(32)}x`,
            }),
            rawEvent("positive-infinity-time", {
                occurredAt: "infinity",
            }),
            rawEvent("negative-infinity-time", {
                occurredAt: "-infinity",
            }),
        ];
        for (const row of invalidRows) {
            await assertSqlStateError(insertRawEvent(client, row), "23514");
        }
        await assertSqlStateError(
            insertRawEvent(client, rawEvent("null-byte-game-id", {
                gameId: "invalid\u0000game",
            })),
            "22021",
        );
        for (const [label, value, code] of [
            ["null-byte-json-value", "\u0000", "22P05"],
            ["unpaired-high-json-value", "\ud800", "22P02"],
            ["unpaired-low-json-value", "\udc00", "22P02"],
        ]) {
            await assertSqlStateError(
                insertRawEvent(client, rawEvent(label, {
                    payload: { value },
                })),
                code,
            );
        }

        const lifecycleUnique = rawEvent("duplicate-lifecycle", {
            eventType: "game_start",
            schemaVersion: 1,
            gameId: "raw-lifecycle-valid",
            playerId: null,
            pieceIndex: null,
            trustLevel: "server_authoritative",
        });
        await assertSqlStateError(insertRawEvent(client, lifecycleUnique), "23505");
        const placementUnique = rawEvent("duplicate-placement", {
            gameId: validRows[1].gameId,
            playerId: validRows[1].playerId,
            pieceIndex: validRows[1].pieceIndex,
        });
        await assertSqlStateError(insertRawEvent(client, placementUnique), "23505");
    });

    await grantRuntimePrivileges(plainUrl);
    const runtimeUrl = databaseUrl(plainUrl, RUNTIME_ROLE, MAIN_DATABASE);
    await withClient(clientConfig(runtimeUrl), async client => {
        const searchPath = await client.query("SHOW search_path");
        assert.equal(
            searchPath.rows[0].search_path,
            "tetris_analytics, pg_catalog",
        );
        const history = await client.query(`
            SELECT version, name, checksum
              FROM tetris_analytics.schema_migrations
        `);
        assert.equal(history.rowCount, 2);
        const allowed = await client.query(`
            SELECT event_id, event_type, game_id, player_id, piece_index, event_sha256
              FROM tetris_analytics.game_events
             LIMIT 1
        `);
        assert.equal(allowed.rowCount, 1);

        const deniedStatements = [
            "SELECT payload FROM tetris_analytics.game_events LIMIT 1",
            "SELECT ingested_at FROM tetris_analytics.game_events LIMIT 1",
            "SELECT applied_at FROM tetris_analytics.schema_migrations LIMIT 1",
            "UPDATE tetris_analytics.game_events SET game_id = game_id",
            "DELETE FROM tetris_analytics.game_events",
            "TRUNCATE TABLE tetris_analytics.game_events",
            "CREATE TABLE tetris_analytics.denied_ddl (id integer)",
            "CREATE TABLE public.denied_public (id integer)",
            `INSERT INTO tetris_analytics.game_events (
                identity_version, event_id, event_type, schema_version,
                game_id, player_id, piece_index, trust_level, occurred_at,
                payload, event_sha256, ingested_at
             ) VALUES (
                'identity-v1', '${sha256("runtime-ingested-at")}',
                'placement_decision', 2, 'runtime-ingested-at',
                'runtime-player', 1, 'client_reported',
                pg_catalog.clock_timestamp(), '{}'::jsonb,
                '${sha256("runtime-ingested-at-sha")}',
                pg_catalog.clock_timestamp()
             )`,
        ];
        for (const statement of deniedStatements) {
            await assertSqlStateError(client.query(statement), "42501");
        }
    });

    await withClient(clientConfig(adminUrl), async client => {
        const role = await client.query(`
            SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication,
                   rolbypassrls, rolinherit,
                   pg_catalog.pg_has_role(
                       $1, $2, 'MEMBER'
                   ) AS migration_member
              FROM pg_catalog.pg_roles
             WHERE rolname = $1
        `, [RUNTIME_ROLE, MIGRATION_ROLE]);
        assert.deepEqual(role.rows[0], {
            rolsuper: false,
            rolcreatedb: false,
            rolcreaterole: false,
            rolreplication: false,
            rolbypassrls: false,
            rolinherit: false,
            migration_member: false,
        });

        const columnPrivileges = await client.query(`
            SELECT privilege_type,
                   pg_catalog.array_agg(
                       column_name::text ORDER BY column_name
                   ) AS columns
              FROM information_schema.column_privileges
             WHERE grantee = $1
               AND table_schema = 'tetris_analytics'
               AND table_name = 'game_events'
             GROUP BY privilege_type
             ORDER BY privilege_type
        `, [RUNTIME_ROLE]);
        assert.deepEqual(columnPrivileges.rows, [
            {
                privilege_type: "INSERT",
                columns: [
                    "event_id",
                    "event_sha256",
                    "event_type",
                    "game_id",
                    "identity_version",
                    "occurred_at",
                    "payload",
                    "piece_index",
                    "player_id",
                    "schema_version",
                    "trust_level",
                ],
            },
            {
                privilege_type: "SELECT",
                columns: [
                    "event_id",
                    "event_sha256",
                    "event_type",
                    "game_id",
                    "piece_index",
                    "player_id",
                ],
            },
        ]);
        const historyPrivileges = await client.query(`
            SELECT pg_catalog.array_agg(
                       column_name::text ORDER BY column_name
                   ) AS columns
              FROM information_schema.column_privileges
             WHERE grantee = $1
               AND table_schema = 'tetris_analytics'
               AND table_name = 'schema_migrations'
               AND privilege_type = 'SELECT'
        `, [RUNTIME_ROLE]);
        assert.deepEqual(historyPrivileges.rows[0].columns, [
            "checksum",
            "name",
            "version",
        ]);

        const privileges = await client.query(`
            SELECT
                pg_catalog.has_schema_privilege($1, 'tetris_analytics', 'USAGE')
                    AS analytics_usage,
                pg_catalog.has_schema_privilege($1, 'tetris_analytics', 'CREATE')
                    AS analytics_create,
                pg_catalog.has_schema_privilege($1, 'public', 'CREATE')
                    AS public_create,
                pg_catalog.has_column_privilege(
                    $1, 'tetris_analytics.game_events', 'event_id', 'SELECT'
                ) AS event_id_select,
                pg_catalog.has_column_privilege(
                    $1, 'tetris_analytics.game_events', 'event_sha256', 'SELECT'
                ) AS event_sha_select,
                pg_catalog.has_column_privilege(
                    $1, 'tetris_analytics.game_events', 'payload', 'SELECT'
                ) AS payload_select,
                pg_catalog.has_column_privilege(
                    $1, 'tetris_analytics.game_events', 'event_sha256', 'INSERT'
                ) AS event_sha_insert,
                pg_catalog.has_column_privilege(
                    $1, 'tetris_analytics.game_events', 'ingested_at', 'INSERT'
                ) AS ingested_at_insert,
                pg_catalog.has_table_privilege(
                    $1, 'tetris_analytics.game_events', 'UPDATE'
                ) AS table_update,
                pg_catalog.has_table_privilege(
                    $1, 'tetris_analytics.game_events', 'DELETE'
                ) AS table_delete,
                pg_catalog.has_table_privilege(
                    $1, 'tetris_analytics.game_events', 'TRUNCATE'
                ) AS table_truncate
        `, [RUNTIME_ROLE]);
        assert.deepEqual(privileges.rows[0], {
            analytics_usage: true,
            analytics_create: false,
            public_create: false,
            event_id_select: true,
            event_sha_select: true,
            payload_select: false,
            event_sha_insert: true,
            ingested_at_insert: false,
            table_update: false,
            table_delete: false,
            table_truncate: false,
        });

        const publicPrivileges = await client.query(`
            SELECT
                pg_catalog.has_schema_privilege(
                    $1, 'tetris_analytics', 'USAGE'
                ) AS analytics_usage,
                pg_catalog.has_table_privilege(
                    $1, 'tetris_analytics.game_events', 'SELECT'
                ) AS events_select,
                pg_catalog.has_table_privilege(
                    $1, 'tetris_analytics.schema_migrations', 'SELECT'
                ) AS history_select
        `, ["pg_monitor"]);
        assert.deepEqual(publicPrivileges.rows[0], {
            analytics_usage: false,
            events_select: false,
            history_select: false,
        });
    });
}

function runtimeGameStart(gameId, mode, players) {
    return {
        eventType: "game_start",
        schemaVersion: 1,
        gameId,
        roomId: mode === "pve" ? "PVERUN01" : "PVPRUN01",
        mode,
        aiDifficulty: mode === "pve" ? "normal" : null,
        aiPolicyRequested: mode === "pve" ? "heuristic" : null,
        startedAt: Date.now(),
        nickname: "private-start-nickname",
        token: "private-start-token",
        players,
    };
}

function runtimePlacement(gameId, playerId, pieceIndex, source) {
    const piece = {
        pieceType: "square",
        rotation: 0,
        row: 0,
        col: 0,
        cells: [
            { row: 0, col: 0 },
            { row: 0, col: 1 },
            { row: 1, col: 0 },
            { row: 1, col: 1 },
        ],
    };
    const metrics = {
        columnHeights: [2, 2],
        aggregateHeight: 4,
        maxHeight: 2,
        holes: 0,
        bumpiness: 0,
        completeLines: 0,
    };
    const log = {
        eventType: "placement_decision",
        schemaVersion: 2,
        gameId,
        roomId: gameId.startsWith("pve") ? "PVERUN01" : "PVPRUN01",
        mode: gameId.startsWith("pve") ? "pve" : "multi",
        playerId,
        source,
        modelType: source === "heuristic_ai" ? "heuristic" : null,
        aiDifficulty: gameId.startsWith("pve") ? "normal" : undefined,
        tick: pieceIndex,
        pieceIndex,
        createdAt: Date.now(),
        boardBefore: [[null, null], [null, null]],
        boardAfter: [["square", "square"], ["square", "square"]],
        activePiece: piece,
        nextQueue: ["bar", "tree"],
        holdPiece: null,
        inputSequence: [],
        selectedPlacement: piece,
        placementResult: {
            linesCleared: 0,
            scoreDelta: 0,
            gameOver: false,
        },
        metricsBefore: {
            ...metrics,
            columnHeights: [0, 0],
            aggregateHeight: 0,
            maxHeight: 0,
        },
        metricsAfter: metrics,
        evaluation: {
            score: 0,
            candidateCount: 1,
            reason: {
                linesCleared: 0,
                holesDelta: 0,
                bumpinessDelta: 0,
                aggregateHeightDelta: 4,
                maxHeightDelta: 2,
            },
        },
        nickname: "private-placement-nickname",
        freeText: "private-placement-free-text",
    };
    if (source === "human") {
        log.authoritativeClientSequence = pieceIndex + 1;
        log.authoritativePieceIndex = pieceIndex;
        log.aiComparison = {
            heuristicPlacement: piece,
            heuristicScore: 0,
            userScore: 0,
            betterBy: 0,
            samePlacement: true,
        };
    }
    return log;
}

function runtimeGameOver(gameId, mode, expectedPlacementEventCounts) {
    return {
        eventType: "game_over",
        schemaVersion: 1,
        gameId,
        roomId: mode === "pve" ? "PVERUN01" : "PVPRUN01",
        mode,
        aiDifficulty: mode === "pve" ? "normal" : null,
        aiPolicyRequested: mode === "pve" ? "heuristic" : null,
        aiPolicyLastUsed: mode === "pve" ? "heuristic" : null,
        aiPolicyFallbackCount: 0,
        aiModelSha256: null,
        endedAt: Date.now(),
        winnerPlayerId: expectedPlacementEventCounts[0].playerId,
        loserPlayerId: expectedPlacementEventCounts[1].playerId,
        reason: "top_out",
        finishType: "normal",
        expectedPlacementEventCounts,
        cookie: "private-game-over-cookie",
    };
}

async function verifyRuntimeStorage(plainUrl) {
    const runtimeUrl = databaseUrl(plainUrl, RUNTIME_ROLE, MAIN_DATABASE);
    const runtimeEnvironment = {
        NODE_ENV: "production",
        GAME_EVENT_STORAGE: "postgres",
        DATABASE_URL: runtimeUrl,
    };
    const storage = await createRuntimeEventStorage({
        env: runtimeEnvironment,
        warn() {},
    });
    try {
        const pvpPlayers = [
            { playerId: "pvp-human-1", role: "host", playerType: "human" },
            { playerId: "pvp-human-2", role: "guest", playerType: "human" },
        ];
        const pvePlayers = [
            { playerId: "pve-human", role: "host", playerType: "human" },
            { playerId: "pve-ai", role: "guest", playerType: "heuristic_ai" },
        ];
        const events = [
            runtimeGameStart("pvp-runtime-game", "multi", pvpPlayers),
            runtimePlacement("pvp-runtime-game", "pvp-human-1", 0, "human"),
            runtimePlacement("pvp-runtime-game", "pvp-human-2", 0, "human"),
            runtimeGameOver("pvp-runtime-game", "multi", [
                {
                    playerId: "pvp-human-1",
                    playerType: "human",
                    expectedPlacementEventCount: 1,
                },
                {
                    playerId: "pvp-human-2",
                    playerType: "human",
                    expectedPlacementEventCount: 1,
                },
            ]),
            runtimeGameStart("pve-runtime-game", "pve", pvePlayers),
            runtimePlacement("pve-runtime-game", "pve-human", 0, "human"),
            runtimePlacement("pve-runtime-game", "pve-ai", 0, "heuristic_ai"),
            runtimeGameOver("pve-runtime-game", "pve", [
                {
                    playerId: "pve-human",
                    playerType: "human",
                    expectedPlacementEventCount: 1,
                },
                {
                    playerId: "pve-ai",
                    playerType: "heuristic_ai",
                    expectedPlacementEventCount: 1,
                },
            ]),
        ];
        for (const event of events) {
            const result = await storage.saveGameEventLog(event);
            assert.equal(result.ok, true);
        }
        assert.equal((await storage.saveGameEventLog(events[0])).ok, true);

        const latencies = [];
        await Promise.all(Array.from({ length: 16 }, async (_value, index) => {
            const startedAt = performance.now();
            const result = await storage.saveGameEventLog(runtimeGameStart(
                `latency-runtime-${index}`,
                "multi",
                pvpPlayers,
            ));
            latencies.push(performance.now() - startedAt);
            assert.equal(result.ok, true);
        }));
        latencies.sort((left, right) => left - right);
        const percentile = percentileValue => {
            const index = Math.ceil((percentileValue / 100) * latencies.length) - 1;
            return latencies[Math.max(0, index)];
        };
        const p50 = percentile(50);
        const p95 = percentile(95);
        assert.equal(storage.getMetrics().poolMax, POSTGRES_RUNTIME_POOL_MAX);
        assert.equal(storage.getMetrics().inFlightMax, POSTGRES_RUNTIME_IN_FLIGHT_MAX);
        assert.ok(p95 < 250);
        console.log(
            `[test:db] runtime_latency_ms p50=${p50.toFixed(2)}`
            + ` p95=${p95.toFixed(2)} pool=${POSTGRES_RUNTIME_POOL_MAX}`
            + ` in_flight=${POSTGRES_RUNTIME_IN_FLIGHT_MAX}`,
        );

        const adminUrl = databaseUrl(plainUrl, "postgres", MAIN_DATABASE);
        await withClient(clientConfig(adminUrl), async client => {
            const persisted = await client.query(`
                SELECT event_type, schema_version, trust_level, payload::text AS payload
                  FROM tetris_analytics.game_events
                 WHERE game_id IN ('pvp-runtime-game', 'pve-runtime-game')
                 ORDER BY game_id, event_type, player_id NULLS FIRST
            `);
            assert.equal(persisted.rowCount, 8);
            assert.equal(
                persisted.rows.filter(row => row.schema_version === 2).length,
                8,
            );
            assert.equal(
                persisted.rows.filter(row => (
                    row.event_type === "placement_decision"
                    && row.trust_level === "client_reported"
                )).length,
                3,
            );
            assert.equal(
                persisted.rows.filter(row => (
                    row.event_type === "placement_decision"
                    && row.trust_level === "server_authoritative"
                )).length,
                1,
            );
            const serialized = persisted.rows.map(row => row.payload).join("\n");
            assert.doesNotMatch(
                serialized,
                /private-|nickname|token|cookie|freeText/i,
            );
        });
    } finally {
        await storage.close();
    }

    await assert.rejects(
        createRuntimeEventStorage({
            env: {
                NODE_ENV: "production",
                GAME_EVENT_STORAGE: "postgres",
                DATABASE_URL: databaseUrl(
                    plainUrl,
                    MIGRATION_ROLE,
                    OLD_SCHEMA_DATABASE,
                ),
            },
            warn() {},
        }),
        { code: "POSTGRES_EVENT_STARTUP_FAILED" },
    );

    const failureStorage = await createRuntimeEventStorage({
        env: runtimeEnvironment,
        warn() {},
    });
    const containerName = requireEnvironment("GOAL9B_TEST_CONTAINER");
    const pause = spawnSync("docker", ["pause", containerName], {
        encoding: "utf8",
    });
    assert.equal(pause.status, 0);
    const failureStartedAt = performance.now();
    let failureResult;
    try {
        failureResult = await failureStorage.saveGameEventLog(runtimeGameStart(
            "database-down-runtime",
            "multi",
            [
                { playerId: "down-1", role: "host", playerType: "human" },
                { playerId: "down-2", role: "guest", playerType: "human" },
            ],
        ));
    } finally {
        const unpause = spawnSync("docker", ["unpause", containerName], {
            encoding: "utf8",
        });
        assert.equal(unpause.status, 0);
    }
    const failureElapsed = performance.now() - failureStartedAt;
    assert.equal(failureResult.ok, false);
    assert.ok(failureElapsed <= 2_700);
    console.log(
        `[test:db] runtime_failure_ms elapsed=${failureElapsed.toFixed(2)} attempts=3`,
    );
    await failureStorage.close();
}

async function verifyRepository(plainUrl) {
    const runtimeUrl = databaseUrl(plainUrl, RUNTIME_ROLE, MAIN_DATABASE);
    const repository = createPostgresEventRepository({
        connectionUrl: runtimeUrl,
    });
    try {
        const lifecycleGame = `repository-lifecycle-${randomBytes(4).toString("hex")}`;
        const events = [
            createLifecycleEvent("game_start", { gameId: lifecycleGame }),
            createPlacementEvent({
                gameId: "repository-placement-v1",
                schemaVersion: 1,
                occurredAt: null,
                pieceIndex: 1,
            }),
            createPlacementEvent({
                gameId: "repository-placement-v2",
                trustLevel: "server_authoritative",
                pieceIndex: 2,
            }),
            createLifecycleEvent("game_over", { gameId: lifecycleGame }),
        ];
        for (const event of events) {
            const result = await repository.append(
                createCanonicalGameEvent(event),
            );
            assert.equal(result.status, "inserted");
        }

        const exact = prepareCanonicalGameEvent(createPlacementEvent({
            gameId: "repository-exact-digest",
            pieceIndex: 3,
        }));
        assert.equal(
            exact.eventId,
            sha256(
                '["identity-v1","placement_decision",'
                    + '"repository-exact-digest","integration-player",3]',
            ),
        );
        const exactResult = await repository.append(exact.snapshot);
        assert.deepEqual(exactResult, {
            status: "inserted",
            eventId: exact.eventId,
        });

        const concurrentEvent = createCanonicalGameEvent(createPlacementEvent({
            gameId: "repository-concurrent",
            pieceIndex: 4,
        }));
        const concurrentResults = await Promise.all(
            Array.from({ length: 12 }, () => repository.append(concurrentEvent)),
        );
        assert.equal(
            concurrentResults.filter(result => result.status === "inserted").length,
            1,
        );
        assert.equal(
            concurrentResults.filter(result => result.status === "duplicate").length,
            11,
        );

        const conflictBase = createPlacementEvent({
            gameId: "repository-conflict",
            pieceIndex: 5,
        });
        const inserted = await repository.append(createCanonicalGameEvent(conflictBase));
        assert.equal(inserted.status, "inserted");
        const payloadConflict = await repository.append(createCanonicalGameEvent({
            ...conflictBase,
            payload: { changed: true },
        }));
        assert.deepEqual(payloadConflict, {
            status: "conflict",
            eventId: inserted.eventId,
            code: "IDEMPOTENCY_CONFLICT",
        });
        const immutableConflict = await repository.append(createCanonicalGameEvent({
            ...conflictBase,
            trustLevel: "server_authoritative",
        }));
        assert.equal(immutableConflict.status, "conflict");
        assert.equal(immutableConflict.code, "IDEMPOTENCY_CONFLICT");

        const adminUrl = databaseUrl(plainUrl, "postgres", MAIN_DATABASE);
        await withClient(clientConfig(adminUrl), async client => {
            const concurrencyCount = await client.query(`
                SELECT pg_catalog.count(*)::integer AS count
                  FROM tetris_analytics.game_events
                 WHERE event_type = 'placement_decision'
                   AND game_id = 'repository-concurrent'
                   AND player_id = 'integration-player'
                   AND piece_index = 4
            `);
            assert.equal(concurrencyCount.rows[0].count, 1);

            const originalHash = await client.query(`
                SELECT event_sha256
                  FROM tetris_analytics.game_events
                 WHERE event_id = $1
            `, [inserted.eventId]);
            assert.equal(
                originalHash.rows[0].event_sha256,
                prepareCanonicalGameEvent(conflictBase).eventSha256,
            );

            const semanticInput = createPlacementEvent({
                gameId: "repository-semantic-path",
                pieceIndex: 6,
            });
            const semanticPrepared = prepareCanonicalGameEvent(semanticInput);
            await insertRawEvent(client, rawEvent("semantic-existing", {
                eventType: semanticInput.eventType,
                schemaVersion: semanticInput.schemaVersion,
                gameId: semanticInput.gameId,
                playerId: semanticInput.playerId,
                pieceIndex: semanticInput.pieceIndex,
                trustLevel: semanticInput.trustLevel,
                occurredAt: semanticInput.occurredAt,
                payload: { existing: true },
            }));
            const semanticResult = await repository.append(semanticPrepared.snapshot);
            assert.equal(semanticResult.status, "conflict");

            const twoPathInput = createPlacementEvent({
                gameId: "repository-two-paths",
                pieceIndex: 7,
            });
            const twoPathPrepared = prepareCanonicalGameEvent(twoPathInput);
            await insertRawEvent(client, rawEvent("event-id-path", {
                eventId: twoPathPrepared.eventId,
                gameId: "repository-other-semantic",
                playerId: "repository-other-player",
                pieceIndex: 70,
            }));
            await insertRawEvent(client, rawEvent("semantic-path", {
                gameId: twoPathInput.gameId,
                playerId: twoPathInput.playerId,
                pieceIndex: twoPathInput.pieceIndex,
            }));
            const twoPathResult = await repository.append(twoPathPrepared.snapshot);
            assert.equal(twoPathResult.status, "conflict");
            assert.equal(twoPathResult.code, "IDEMPOTENCY_CONFLICT");
        });
    } finally {
        await repository.close();
    }

    const lifecycleRepository = createPostgresEventRepository({
        connectionUrl: runtimeUrl,
    });
    const lifecycleBase = createLifecycleEvent("game_start", {
        gameId: "repository-lifecycle-conflict",
    });
    assert.equal(
        (await lifecycleRepository.append(createCanonicalGameEvent(lifecycleBase))).status,
        "inserted",
    );
    const lifecycleConflict = await lifecycleRepository.append(
        createCanonicalGameEvent({
            ...lifecycleBase,
            occurredAt: "2026-07-23T07:08:10.123Z",
        }),
    );
    assert.equal(lifecycleConflict.status, "conflict");
    await lifecycleRepository.close();

    const closedRepository = createPostgresEventRepository({
        connectionUrl: runtimeUrl,
    });
    await assert.rejects(
        closedRepository.append({ rawPayload: "must-not-leak" }),
        error => {
            assert.equal(error.code, "INVALID_CANONICAL_EVENT");
            assert.doesNotMatch(error.message, /rawPayload|must-not-leak/i);
            return true;
        },
    );
    const firstClose = closedRepository.close();
    const secondClose = closedRepository.close();
    assert.strictEqual(firstClose, secondClose);
    await firstClose;
    await assert.rejects(
        closedRepository.append(createCanonicalGameEvent(createPlacementEvent({
            gameId: "repository-after-close",
        }))),
        { code: "POSTGRES_EVENT_REPOSITORY_CLOSED" },
    );

    const secret = "goal9b-sentinel-password";
    const unavailable = new URL(
        "postgresql://127.0.0.1:1/analytics?sslmode=disable",
    );
    unavailable.username = "runtime";
    unavailable.password = secret;
    const unavailableUrl = unavailable.toString();
    const unavailableRepository = createPostgresEventRepository({
        connectionUrl: unavailableUrl,
    });
    await assert.rejects(
        unavailableRepository.append(createCanonicalGameEvent(createPlacementEvent({
            gameId: "repository-unavailable",
        }))),
        error => {
            assert.equal(error.code, "POSTGRES_EVENT_APPEND_FAILED");
            assert.doesNotMatch(error.message, /sentinel|postgresql:|runtime/i);
            return true;
        },
    );
    await unavailableRepository.close();

    await assert.rejects(
        runPostgresMigrations({
            clientConfig: clientConfig(
                unavailableUrl,
                { applicationName: "goal9b-redaction" },
            ),
        }),
        error => {
            assert.equal(error.code, "MIGRATION_CONNECTION_FAILED");
            assert.doesNotMatch(error.message, /sentinel|postgresql:|runtime/i);
            return true;
        },
    );
}

function importFixtureEvents(gameId) {
    const playerRows = [
        { playerId: "goal9c-player-1", role: "host", playerType: "human" },
        { playerId: "goal9c-player-2", role: "guest", playerType: "human" },
    ];
    const expectedCounts = [
        {
            playerId: "goal9c-player-1",
            playerType: "human",
            expectedPlacementEventCount: 1,
        },
        {
            playerId: "goal9c-player-2",
            playerType: "human",
            expectedPlacementEventCount: 1,
        },
    ];
    const start = runtimeGameStart(gameId, "multi", playerRows);
    const over = runtimeGameOver(gameId, "multi", expectedCounts);
    delete start.token;
    delete over.cookie;
    return [
        start,
        runtimePlacement(gameId, "goal9c-player-1", 0, "human"),
        runtimePlacement(gameId, "goal9c-player-2", 0, "human"),
        over,
    ];
}

async function writeImportFixture(directory, name, rows) {
    const filePath = path.join(directory, name);
    await writeFile(
        filePath,
        `${rows.map(row => JSON.stringify(row)).join("\n")}\n`,
        "utf8",
    );
    return filePath;
}

function importRepository(url) {
    return createPostgresEventRepository({
        connectionUrl: url,
        applicationName: "goal9c-integration-import",
        max: 1,
    });
}

async function verifyJsonlImporter(plainUrl) {
    const fixtureDirectory = await mkdtemp(
        path.join(os.tmpdir(), "tetris-goal9c-import-fixtures-"),
    );
    await grantEventWriterPrivileges(plainUrl, MAIN_DATABASE, IMPORT_ROLE);
    const importUrl = databaseUrl(plainUrl, IMPORT_ROLE, MAIN_DATABASE);
    const adminUrl = databaseUrl(plainUrl, "postgres", MAIN_DATABASE);
    try {
        const fixtureGame = `goal9c-fixture-${randomBytes(4).toString("hex")}`;
        const fixturePath = await writeImportFixture(
            fixtureDirectory,
            "valid.jsonl",
            importFixtureEvents(fixtureGame),
        );
        const dryRun = await runJsonlImport({
            inputPath: fixturePath,
            dryRun: true,
        });
        assert.equal(dryRun.ok, true);
        assert.equal(dryRun.writes.attempted, 0);
        assert.equal(dryRun.completeness.completeGameCount, 1);

        const first = await runJsonlImport({
            inputPath: fixturePath,
            repository: importRepository(importUrl),
        });
        const second = await runJsonlImport({
            inputPath: fixturePath,
            repository: importRepository(importUrl),
        });
        assert.equal(first.ok, true);
        assert.equal(first.writes.inserted, 4);
        assert.equal(second.ok, true);
        assert.equal(second.writes.duplicate, 4);
        assert.equal(
            first.canonical.orderedEventSha256,
            second.canonical.orderedEventSha256,
        );
        const cliReportPath = path.join(fixtureDirectory, "cli-report.json");
        const npmExecPath = requireEnvironment("npm_execpath");
        const cli = spawnSync(process.execPath, [
            npmExecPath,
            "run",
            "db:import-jsonl",
            "--silent",
            "--",
            fixturePath,
            "--report",
            cliReportPath,
        ], {
            cwd: ROOT,
            env: {
                ...process.env,
                IMPORT_DATABASE_URL: importUrl,
            },
            encoding: "utf8",
        });
        assert.equal(cli.status, 0, cli.stderr);
        assert.doesNotMatch(
            `${cli.stdout}${cli.stderr}`,
            /postgresql:\/\/|Private Nickname|private-start/i,
        );
        const cliReport = JSON.parse(await readFile(cliReportPath, "utf8"));
        assert.equal(cliReport.writes.duplicate, 4);

        await withClient(clientConfig(adminUrl), async client => {
            const rows = await client.query(`
                SELECT pg_catalog.count(*)::integer AS count,
                       pg_catalog.count(*) FILTER (
                           WHERE payload::text ~* 'nickname|token|socketid|cookie|useragent'
                       )::integer AS private_count
                  FROM tetris_analytics.game_events
                 WHERE game_id = $1
            `, [fixtureGame]);
            assert.deepEqual(rows.rows[0], { count: 4, private_count: 0 });
        });
        await withClient(clientConfig(importUrl), async client => {
            const searchPath = await client.query("SHOW search_path");
            assert.equal(
                searchPath.rows[0].search_path,
                "tetris_analytics, pg_catalog",
            );
            await assertSqlStateError(
                client.query(
                    "UPDATE tetris_analytics.game_events SET game_id = game_id",
                ),
                "42501",
            );
            await assertSqlStateError(
                client.query(
                    "CREATE TABLE tetris_analytics.import_denied (id integer)",
                ),
                "42501",
            );
        });

        const partialGame = `goal9c-partial-${randomBytes(4).toString("hex")}`;
        const partialPath = await writeImportFixture(
            fixtureDirectory,
            "partial.jsonl",
            importFixtureEvents(partialGame),
        );
        const underlying = importRepository(importUrl);
        let appendCount = 0;
        const partial = await runJsonlImport({
            inputPath: partialPath,
            repository: {
                append(event) {
                    appendCount += 1;
                    if (appendCount === 2) {
                        throw new Error("goal9c-synthetic-db-failure");
                    }
                    return underlying.append(event);
                },
                close() {
                    return underlying.close();
                },
            },
        });
        assert.equal(partial.ok, false);
        assert.equal(partial.writes.inserted, 1);
        assert.equal(partial.writes.failed, 1);

        const recovered = await runJsonlImport({
            inputPath: partialPath,
            repository: importRepository(importUrl),
        });
        assert.equal(recovered.ok, true);
        assert.equal(recovered.writes.duplicate, 1);
        assert.equal(recovered.writes.inserted, 3);
        await withClient(clientConfig(adminUrl), async client => {
            const count = await client.query(`
                SELECT pg_catalog.count(*)::integer AS count
                  FROM tetris_analytics.game_events
                 WHERE game_id = $1
            `, [partialGame]);
            assert.equal(count.rows[0].count, 4);
        });

        const conflictGame = `goal9c-conflict-${randomBytes(4).toString("hex")}`;
        const conflictRows = importFixtureEvents(conflictGame);
        const seededConflict = await runJsonlImport({
            inputPath: await writeImportFixture(
                fixtureDirectory,
                "conflict-seed.jsonl",
                [conflictRows[0]],
            ),
            repository: importRepository(importUrl),
        });
        assert.equal(seededConflict.ok, true);
        assert.equal(seededConflict.writes.inserted, 1);
        const changedStart = {
            ...conflictRows[0],
            startedAt: conflictRows[0].startedAt + 1,
        };
        const conflictPath = await writeImportFixture(
            fixtureDirectory,
            "conflict.jsonl",
            [changedStart, ...conflictRows.slice(1)],
        );
        const conflict = await runJsonlImport({
            inputPath: conflictPath,
            repository: importRepository(importUrl),
        });
        assert.equal(conflict.ok, false);
        assert.equal(conflict.writes.inserted, 3);
        assert.equal(conflict.writes.conflict, 1);
        assert.deepEqual(conflict.failures.reasonCodeCounts, {
            IDEMPOTENCY_CONFLICT: 1,
        });
        assert.deepEqual(conflict.completeness.reasonCodeCounts, {
            idempotency_conflict: 1,
        });
        assert.equal(conflict.completeness.completeGameCount, 0);
        assert.equal(conflict.completeness.incompleteGameCount, 1);
        assert.equal(conflict.completeness.games[0].mlExportEligible, false);

        const localCopyPath = process.env.GOAL9C_LOCAL_JSONL_COPY;
        if (!localCopyPath) return;
        const expectedSourceHash = requireEnvironment("GOAL9C_LOCAL_JSONL_SHA256");
        assert.match(expectedSourceHash, /^[0-9a-f]{64}$/);
        await runPostgresMigrations(
            migrationOptions(
                plainUrl,
                LOCAL_IMPORT_DATABASE,
                "goal9c-local-import-migrate",
            ),
        );
        await grantEventWriterPrivileges(
            plainUrl,
            LOCAL_IMPORT_DATABASE,
            IMPORT_ROLE,
        );
        const localImportUrl = databaseUrl(
            plainUrl,
            IMPORT_ROLE,
            LOCAL_IMPORT_DATABASE,
        );
        const localAdminUrl = databaseUrl(
            plainUrl,
            MIGRATION_ROLE,
            LOCAL_IMPORT_DATABASE,
        );
        const localDryRun = await runJsonlImport({
            inputPath: localCopyPath,
            dryRun: true,
        });
        const localFirst = await runJsonlImport({
            inputPath: localCopyPath,
            repository: importRepository(localImportUrl),
        });
        const localSecond = await runJsonlImport({
            inputPath: localCopyPath,
            repository: importRepository(localImportUrl),
        });
        assert.equal(localDryRun.ok, true);
        assert.equal(localFirst.ok, true);
        assert.equal(localSecond.ok, true);
        assert.equal(localDryRun.source.sha256, expectedSourceHash);
        assert.equal(localFirst.source.sha256, expectedSourceHash);
        assert.equal(localSecond.source.sha256, expectedSourceHash);
        assert.equal(localFirst.writes.inserted, localFirst.canonical.eventCount);
        assert.equal(localSecond.writes.duplicate, localSecond.canonical.eventCount);
        assert.equal(
            localDryRun.canonical.orderedEventSha256,
            localSecond.canonical.orderedEventSha256,
        );

        await withClient(clientConfig(localAdminUrl), async client => {
            const state = await client.query(`
                SELECT pg_catalog.count(*)::integer AS row_count,
                       pg_catalog.count(*) FILTER (
                           WHERE payload::text ~* 'nickname|token|socketid|cookie|useragent'
                       )::integer AS private_count,
                       pg_catalog.pg_total_relation_size(
                           'tetris_analytics.game_events'::regclass
                       )::bigint AS relation_bytes
                  FROM tetris_analytics.game_events
            `);
            assert.equal(
                state.rows[0].row_count,
                localFirst.canonical.uniqueIdentityCount,
            );
            assert.equal(state.rows[0].private_count, 0);
            console.log(
                `[test:db] goal9c_local_import rows=${state.rows[0].row_count}`
                + ` relation_bytes=${state.rows[0].relation_bytes}`
                + ` completeness=${JSON.stringify(
                    localFirst.completeness.reasonCodeCounts,
                )}`,
            );
        });
    } finally {
        await rm(fixtureDirectory, { recursive: true, force: true });
    }
}

function safeNpmEnvironment(extra = {}) {
    const names = [
        "HOME",
        "PATH",
        "TMPDIR",
        "NPM_CONFIG_CACHE",
        "NPM_CONFIG_REGISTRY",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "npm_config_cache",
        "npm_config_registry",
    ];
    const environment = {};
    for (const name of names) {
        if (process.env[name] !== undefined) environment[name] = process.env[name];
    }
    return { ...environment, ...extra };
}

function runReleaseNpm(releaseRoot, args, environment) {
    const npmExecPath = process.env.npm_execpath;
    if (!npmExecPath) throw new Error("GOAL9B_NPM_EXEC_PATH_REQUIRED");
    const result = spawnSync(process.execPath, [npmExecPath, ...args], {
        cwd: releaseRoot,
        env: environment,
        encoding: "utf8",
    });
    if (result.status !== 0) {
        throw new Error(`GOAL9B_RELEASE_NPM_FAILED_${args.join("_")}`);
    }
    return result.stdout;
}

async function verifySourceLessArtifact(plainUrl) {
    const releaseRoot = await mkdtemp(
        path.join(os.tmpdir(), "tetris-goal9b-release-"),
    );
    try {
        await cp(path.join(ROOT, "dist"), path.join(releaseRoot, "dist"), {
            recursive: true,
        });
        await cp(
            path.join(ROOT, "package.json"),
            path.join(releaseRoot, "package.json"),
        );
        await cp(
            path.join(ROOT, "package-lock.json"),
            path.join(releaseRoot, "package-lock.json"),
        );
        const releaseUrl = databaseUrl(
            plainUrl,
            MIGRATION_ROLE,
            RELEASE_DATABASE,
        );
        const environment = safeNpmEnvironment({
            MIGRATION_DATABASE_URL: releaseUrl,
            MIGRATION_LOCK_TIMEOUT: "5000",
            NODE_ENV: "production",
        });
        runReleaseNpm(
            releaseRoot,
            ["ci", "--omit=dev", "--ignore-scripts"],
            environment,
        );

        const entries = (await readdir(releaseRoot)).sort();
        assert.deepEqual(entries, [
            "dist",
            "node_modules",
            "package-lock.json",
            "package.json",
        ]);
        for (const filename of [
            "001_game_events.sql",
            "002_lifecycle_event_v2.sql",
        ]) {
            const sourceSql = await readFile(
                path.join(SOURCE_MIGRATIONS_DIRECTORY, filename),
            );
            const releaseSql = await readFile(path.join(
                releaseRoot,
                "dist",
                "server",
                "server",
                "db",
                "migrations",
                filename,
            ));
            assert.deepEqual(releaseSql, sourceSql);
        }

        const first = runReleaseNpm(
            releaseRoot,
            ["run", "db:migrate", "--silent"],
            environment,
        );
        const second = runReleaseNpm(
            releaseRoot,
            ["run", "db:migrate", "--silent"],
            environment,
        );
        assert.equal(first, "PostgreSQL migrations applied=2 skipped=0\n");
        assert.equal(second, "PostgreSQL migrations applied=0 skipped=2\n");

        const importFixturePath = path.join(releaseRoot, "import-fixture.jsonl");
        const releaseStart = runtimeGameStart(
            "source-less-import",
            "multi",
            [
                { playerId: "release-1", role: "host", playerType: "human" },
                { playerId: "release-2", role: "guest", playerType: "human" },
            ],
        );
        delete releaseStart.token;
        await writeFile(
            importFixturePath,
            `${JSON.stringify(releaseStart)}\n`,
            "utf8",
        );
        const importReport = JSON.parse(runReleaseNpm(
            releaseRoot,
            [
                "run",
                "db:import-jsonl",
                "--silent",
                "--",
                "--dry-run",
                importFixturePath,
            ],
            environment,
        ));
        assert.equal(importReport.ok, true);
        assert.equal(importReport.canonical.eventCount, 1);
        assert.equal(importReport.completeness.incompleteGameCount, 1);

        const repositoryProbe = `
const { createPostgresEventRepository } =
    require("./dist/server/server/repositories/postgresEventRepository.js");
const { createRuntimeEventStorage } =
    require("./dist/server/server/services/runtimeEventStorage.js");
const repository = createPostgresEventRepository({
    connectionUrl: process.env.GOAL9B_RELEASE_REPOSITORY_URL,
});
(async () => {
    const repositoryResult = await repository.append({
        identityVersion: "identity-v1",
        eventType: "game_start",
        schemaVersion: 1,
        gameId: "source-less-release",
        playerId: null,
        pieceIndex: null,
        trustLevel: "server_authoritative",
        occurredAt: "2026-07-23T07:08:09.123Z",
        payload: { artifact: true },
    });
    await repository.close();
    const storage = await createRuntimeEventStorage({
        env: {
            NODE_ENV: "production",
            GAME_EVENT_STORAGE: "postgres",
            DATABASE_URL: process.env.GOAL9B_RELEASE_REPOSITORY_URL,
        },
        warn() {},
    });
    const runtimeResult = await storage.saveGameEventLog({
        eventType: "game_start",
        schemaVersion: 1,
        gameId: "source-less-runtime",
        roomId: "RELEASE1",
        mode: "multi",
        aiDifficulty: null,
        aiPolicyRequested: null,
        startedAt: 1784800000000,
        players: [
            { playerId: "release-1", role: "host", playerType: "human" },
            { playerId: "release-2", role: "guest", playerType: "human" }
        ],
    });
    await storage.close();
    process.stdout.write(JSON.stringify({ repositoryResult, runtimeResult }));
})().catch(async () => {
    await repository.close().catch(() => {});
    process.exitCode = 1;
});
`;
        const probe = spawnSync(process.execPath, ["-e", repositoryProbe], {
            cwd: releaseRoot,
            env: {
                ...safeNpmEnvironment(),
                GOAL9B_RELEASE_REPOSITORY_URL: releaseUrl,
            },
            encoding: "utf8",
        });
        assert.equal(probe.status, 0);
        assert.match(probe.stdout, /"status":"inserted"/);
        assert.match(probe.stdout, /"runtimeResult":\{"ok":true/);

        const dependencyProbe = spawnSync(process.execPath, [
            "-e",
            `require("pg");
try {
    require.resolve("@types/pg");
    process.exitCode = 2;
} catch {
    process.exitCode = 0;
}`,
        ], {
            cwd: releaseRoot,
            env: safeNpmEnvironment(),
            encoding: "utf8",
        });
        assert.equal(dependencyProbe.status, 0);
    } finally {
        await rm(releaseRoot, { recursive: true, force: true });
    }
}

test("Goal 9B actual PostgreSQL contract", { timeout: 120_000 }, async t => {
    const plainUrl = requireEnvironment("GOAL9B_TEST_PLAIN_URL");
    if (process.env.GOAL9D_POSTGRES_SERVICE === "1") {
        await t.test("TLS: covered by the isolated local PostgreSQL fixture", {
            skip: "GitHub service uses job-local loopback",
        }, () => {});
    } else {
        const tlsUrl = requireEnvironment("GOAL9B_TEST_TLS_URL");
        const ca = await readFile(requireEnvironment("GOAL9B_TEST_CA_PATH"), "utf8");
        await t.test("TLS: private CA succeeds and trust/hostname failures fail closed", () => {
            return verifyTls(tlsUrl, ca);
        });
    }

    await createRolesAndDatabases(plainUrl);

    await t.test("migration: bootstrap, rerun, checksum, lock and rollback", () => {
        return verifyMigrations(plainUrl);
    });
    await t.test("schema-role: CHECK, indexes, ownership and least privilege", () => {
        return verifySchemaAndRoles(plainUrl);
    });
    await t.test("repository: inserts, duplicates, conflicts and lifecycle", () => {
        return verifyRepository(plainUrl);
    });
    await t.test("import: streaming, rerun, recovery and local copy", () => {
        return verifyJsonlImporter(plainUrl);
    });
    await t.test("runtime: PVP/PVE single sink, startup gate, latency and DB down", () => {
        return verifyRuntimeStorage(plainUrl);
    });
    await t.test("artifact: source-less production migration runs twice", () => {
        return verifySourceLessArtifact(plainUrl);
    });
});
