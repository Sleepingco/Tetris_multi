/**
 * Goal 9A raw migration, role boundary, repository와 source-less artifact를
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
    runPostgresMigrations,
} = require("../dist/server/server/db/migrate.js");
const {
    createPostgresClientConfig,
} = require("../dist/server/server/db/postgresConnection.js");
const {
    createPostgresEventRepository,
} = require("../dist/server/server/repositories/postgresEventRepository.js");

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
const MIGRATION_ROLE = "tetris_goal9a_migration";
const RUNTIME_ROLE = "tetris_goal9a_runtime";
const MAIN_DATABASE = "tetris_goal9a_test";
const CONCURRENT_DATABASE = "tetris_goal9a_concurrent";
const FAILURE_DATABASE = "tetris_goal9a_failure";
const RELEASE_DATABASE = "tetris_goal9a_release";
const DATABASES = [
    MAIN_DATABASE,
    CONCURRENT_DATABASE,
    FAILURE_DATABASE,
    RELEASE_DATABASE,
];
const ADVISORY_LOCK_KEY = "9026072300090001";

function requireEnvironment(name) {
    const value = process.env[name];
    if (!value) throw new Error(`GOAL9A_TEST_ENV_${name}_REQUIRED`);
    return value;
}

function quoteIdentifier(value) {
    if (!/^[a-z][a-z0-9_]*$/.test(value)) {
        throw new Error("GOAL9A_TEST_IDENTIFIER_INVALID");
    }
    return `"${value}"`;
}

function databaseUrl(baseUrl, user, database) {
    const url = new URL(baseUrl);
    url.username = user;
    url.password = "";
    url.pathname = `/${database}`;
    return url.toString();
}

function sha256(value) {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

function clientConfig(url, options = {}) {
    return createPostgresClientConfig(url, {
        applicationName: options.applicationName ?? "goal9a-integration",
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
    await withClient(clientConfig(adminUrl), async client => {
        await client.query(
            `CREATE ROLE ${quoteIdentifier(MIGRATION_ROLE)}
                LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`,
        );
        await client.query(
            `CREATE ROLE ${quoteIdentifier(RUNTIME_ROLE)}
                LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`,
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
    const migrationUrl = databaseUrl(plainUrl, MIGRATION_ROLE, MAIN_DATABASE);
    await withClient(clientConfig(migrationUrl), async client => {
        await client.query(`
            GRANT USAGE ON SCHEMA tetris_analytics
                TO ${quoteIdentifier(RUNTIME_ROLE)};
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
                TO ${quoteIdentifier(RUNTIME_ROLE)};
            GRANT SELECT (
                event_id,
                event_type,
                game_id,
                player_id,
                piece_index,
                event_sha256
            ) ON tetris_analytics.game_events
                TO ${quoteIdentifier(RUNTIME_ROLE)};
            GRANT SELECT (version, name, checksum)
                ON tetris_analytics.schema_migrations
                TO ${quoteIdentifier(RUNTIME_ROLE)};
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
                "goal9a-hostname-mismatch.invalid",
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
        migrationOptions(plainUrl, MAIN_DATABASE, "goal9a-migrate-first"),
    );
    const second = await runPostgresMigrations(
        migrationOptions(plainUrl, MAIN_DATABASE, "goal9a-migrate-second"),
    );
    assert.deepEqual(first, { applied: 1, skipped: 0 });
    assert.deepEqual(second, { applied: 0, skipped: 1 });

    const adminUrl = databaseUrl(plainUrl, "postgres", MAIN_DATABASE);
    await withClient(clientConfig(adminUrl), async client => {
        const history = await client.query(`
            SELECT version, name, checksum, applied_at
              FROM tetris_analytics.schema_migrations
        `);
        assert.equal(history.rowCount, 1);
        assert.equal(history.rows[0].version, 1);
        assert.equal(history.rows[0].name, "game_events");
        assert.match(history.rows[0].checksum, /^[0-9a-f]{64}$/);
        assert.ok(history.rows[0].applied_at instanceof Date);

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

    const concurrentResults = await Promise.all([
        runPostgresMigrations(
            migrationOptions(plainUrl, CONCURRENT_DATABASE, "goal9a-concurrent-a"),
        ),
        runPostgresMigrations(
            migrationOptions(plainUrl, CONCURRENT_DATABASE, "goal9a-concurrent-b"),
        ),
    ]);
    assert.equal(concurrentResults.reduce((sum, value) => sum + value.applied, 0), 1);
    assert.equal(concurrentResults.reduce((sum, value) => sum + value.skipped, 0), 1);

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
                    "goal9a-lock-timeout",
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
                    migrationOptions(plainUrl, MAIN_DATABASE, "goal9a-checksum"),
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
        migrationOptions(plainUrl, FAILURE_DATABASE, "goal9a-failure-bootstrap"),
    );
    const failureDirectory = await mkdtemp(
        path.join(os.tmpdir(), "tetris-goal9a-failing-migrations-"),
    );
    try {
        await cp(SOURCE_MIGRATIONS_DIRECTORY, failureDirectory, {
            recursive: true,
        });
        await writeFile(
            path.join(failureDirectory, "002_forced_failure.sql"),
            `CREATE TABLE tetris_analytics.must_rollback (id integer PRIMARY KEY);
SELECT 1 / 0;
`,
            "utf8",
        );
        await assert.rejects(
            runPostgresMigrations(migrationOptions(
                plainUrl,
                FAILURE_DATABASE,
                "goal9a-failure-runner",
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
                            WHERE application_name = 'goal9a-failure-runner'
                       )::integer AS open_runner_count
            `);
            assert.equal(state.rows[0].rolled_back_table, null);
            assert.equal(state.rows[0].migration_count, 1);
            assert.equal(state.rows[0].open_runner_count, 0);
        });
        assert.deepEqual(
            await runPostgresMigrations(
                migrationOptions(plainUrl, FAILURE_DATABASE, "goal9a-after-failure"),
            ),
            { applied: 0, skipped: 1 },
        );
    } finally {
        await rm(failureDirectory, { recursive: true, force: true });
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
            rawEvent("blank-player", { playerId: "  " }),
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
        ];
        for (const row of invalidRows) {
            await assertSqlStateError(insertRawEvent(client, row), "23514");
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
        assert.equal(history.rowCount, 1);
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

    const secret = "goal9a-sentinel-password";
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
                { applicationName: "goal9a-redaction" },
            ),
        }),
        error => {
            assert.equal(error.code, "MIGRATION_CONNECTION_FAILED");
            assert.doesNotMatch(error.message, /sentinel|postgresql:|runtime/i);
            return true;
        },
    );
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
    if (!npmExecPath) throw new Error("GOAL9A_NPM_EXEC_PATH_REQUIRED");
    const result = spawnSync(process.execPath, [npmExecPath, ...args], {
        cwd: releaseRoot,
        env: environment,
        encoding: "utf8",
    });
    if (result.status !== 0) {
        throw new Error(`GOAL9A_RELEASE_NPM_FAILED_${args.join("_")}`);
    }
    return result.stdout;
}

async function verifySourceLessArtifact(plainUrl) {
    const releaseRoot = await mkdtemp(
        path.join(os.tmpdir(), "tetris-goal9a-release-"),
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
        const sourceSql = await readFile(
            path.join(SOURCE_MIGRATIONS_DIRECTORY, "001_game_events.sql"),
        );
        const releaseSql = await readFile(path.join(
            releaseRoot,
            "dist",
            "server",
            "server",
            "db",
            "migrations",
            "001_game_events.sql",
        ));
        assert.deepEqual(releaseSql, sourceSql);

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
        assert.equal(first, "PostgreSQL migrations applied=1 skipped=0\n");
        assert.equal(second, "PostgreSQL migrations applied=0 skipped=1\n");

        const repositoryProbe = `
const { createPostgresEventRepository } =
    require("./dist/server/server/repositories/postgresEventRepository.js");
const repository = createPostgresEventRepository({
    connectionUrl: process.env.GOAL9A_RELEASE_REPOSITORY_URL,
});
repository.append({
    identityVersion: "identity-v1",
    eventType: "game_start",
    schemaVersion: 1,
    gameId: "source-less-release",
    playerId: null,
    pieceIndex: null,
    trustLevel: "server_authoritative",
    occurredAt: "2026-07-23T07:08:09.123Z",
    payload: { artifact: true },
}).then(async result => {
    await repository.close();
    process.stdout.write(JSON.stringify(result));
}).catch(async () => {
    await repository.close().catch(() => {});
    process.exitCode = 1;
});
`;
        const probe = spawnSync(process.execPath, ["-e", repositoryProbe], {
            cwd: releaseRoot,
            env: {
                ...safeNpmEnvironment(),
                GOAL9A_RELEASE_REPOSITORY_URL: releaseUrl,
            },
            encoding: "utf8",
        });
        assert.equal(probe.status, 0);
        assert.match(probe.stdout, /"status":"inserted"/);

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

test("Goal 9A actual PostgreSQL contract", { timeout: 120_000 }, async t => {
    const plainUrl = requireEnvironment("GOAL9A_TEST_PLAIN_URL");
    const tlsUrl = requireEnvironment("GOAL9A_TEST_TLS_URL");
    const ca = await readFile(requireEnvironment("GOAL9A_TEST_CA_PATH"), "utf8");

    await t.test("TLS: private CA succeeds and trust/hostname failures fail closed", () => {
        return verifyTls(tlsUrl, ca);
    });

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
    await t.test("artifact: source-less production migration runs twice", () => {
        return verifySourceLessArtifact(plainUrl);
    });
});
