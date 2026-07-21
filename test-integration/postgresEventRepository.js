const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomBytes } = require("node:crypto");
const path = require("node:path");
const { Pool } = require("pg");

const {
    createGameEventIdempotencyKey,
    createPostgresEventRepository,
} = require("../dist/server/server/repositories/postgresEventRepository.js");
const {
    migratePostgresEvents,
} = require("../scripts/migrate-postgres-shadow.js");

const connectionString = process.env.TEST_DATABASE_URL?.trim();

if (!connectionString) {
    throw new Error("TEST_DATABASE_URL is required for npm run test:db");
}

function quoteIdentifier(value) {
    return `"${String(value).replaceAll('"', '""')}"`;
}

test("PostgreSQL shadow migration과 event retry는 append-only idempotency를 보존한다", async t => {
    const schemaName = `goal9_${randomBytes(8).toString("hex")}`;
    const quotedSchema = `"${schemaName}"`;
    const roleName = `goal9_writer_${randomBytes(8).toString("hex")}`;
    const quotedRole = `"${roleName}"`;
    const migrationsFolder = path.resolve(__dirname, "..", "drizzle");
    const adminPool = new Pool({
        connectionString,
        max: 1,
        connectionTimeoutMillis: 2_000,
        query_timeout: 5_000,
        statement_timeout: 5_000,
        idleTimeoutMillis: 10_000,
    });

    let roleCreated = false;
    t.after(async () => {
        try {
            await adminPool.query("RESET ROLE");
            await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
            if (roleCreated) {
                await adminPool.query(`DROP OWNED BY ${quotedRole}`);
                await adminPool.query(`DROP ROLE IF EXISTS ${quotedRole}`);
            }
        } finally {
            await adminPool.end();
        }
    });

    await migratePostgresEvents({ connectionString, schemaName, migrationsFolder });

    const emptyResult = await adminPool.query(
        `SELECT count(*)::integer AS count FROM ${quotedSchema}."game_events"`,
    );
    const firstHistoryResult = await adminPool.query(
        `SELECT count(*)::integer AS count FROM ${quotedSchema}."__drizzle_migrations"`,
    );
    assert.equal(emptyResult.rows[0].count, 0);
    assert.equal(firstHistoryResult.rows[0].count, 1);

    await migratePostgresEvents({ connectionString, schemaName, migrationsFolder });

    const secondHistoryResult = await adminPool.query(
        `SELECT count(*)::integer AS count FROM ${quotedSchema}."__drizzle_migrations"`,
    );
    assert.equal(secondHistoryResult.rows[0].count, 1);

    const event = {
        eventType: "placement_decision",
        schemaVersion: 2,
        gameId: "game-001",
        roomId: "room-001",
        playerId: "player-001",
        pieceIndex: 3,
        createdAt: 1784653200000,
        selectedPlacement: { pieceType: "square", row: 18, col: 4 },
    };
    const repository = createPostgresEventRepository({
        connectionString,
        schemaName,
    });
    try {
        await repository.append(event);
        await repository.append(event);
    } finally {
        await repository.close();
    }

    const eventResult = await adminPool.query(
        `SELECT "payload", "payload_sha256", "idempotency_key", "occurred_at"
           FROM ${quotedSchema}."game_events"`,
    );
    assert.equal(eventResult.rowCount, 1);
    assert.deepEqual(eventResult.rows[0].payload, event);
    assert.equal(
        eventResult.rows[0].payload_sha256,
        createHash("sha256").update(JSON.stringify(event)).digest("hex"),
    );
    assert.equal(
        eventResult.rows[0].idempotency_key,
        createHash("sha256")
            .update(JSON.stringify(["placement_decision", "game-001", "player-001", 3]))
            .digest("hex"),
    );
    assert.equal(
        eventResult.rows[0].idempotency_key,
        createGameEventIdempotencyKey(event),
    );
    assert.equal(eventResult.rows[0].occurred_at.toISOString(), "2026-07-21T17:00:00.000Z");

    await adminPool.query(
        `CREATE ROLE ${quotedRole}
            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    roleCreated = true;
    const databaseResult = await adminPool.query("SELECT current_database() AS name");
    const quotedDatabase = quoteIdentifier(databaseResult.rows[0].name);
    await adminPool.query(`GRANT CONNECT ON DATABASE ${quotedDatabase} TO ${quotedRole}`);
    await adminPool.query(`GRANT USAGE ON SCHEMA ${quotedSchema} TO ${quotedRole}`);
    await adminPool.query(
        `GRANT INSERT (
            "idempotency_key", "event_type", "schema_version", "game_id", "room_id",
            "player_id", "piece_index", "occurred_at", "payload", "payload_sha256"
        ) ON TABLE ${quotedSchema}."game_events" TO ${quotedRole}`,
    );
    await adminPool.query(
        `GRANT SELECT ("idempotency_key")
            ON TABLE ${quotedSchema}."game_events" TO ${quotedRole}`,
    );

    const roleResult = await adminPool.query(
        `SELECT "rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication", "rolbypassrls"
           FROM "pg_roles" WHERE "rolname" = $1`,
        [roleName],
    );
    assert.deepEqual(roleResult.rows[0], {
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
    });

    const runtimeEvent = {
        eventType: "game_start",
        schemaVersion: 1,
        gameId: "least-privilege-game",
        roomId: "least-privilege-room",
    };
    const runtimePayload = JSON.stringify(runtimeEvent);
    const runtimeIdempotencyKey = createGameEventIdempotencyKey(runtimeEvent);
    const runtimePayloadSha256 = createHash("sha256").update(runtimePayload).digest("hex");
    const runtimeClient = await adminPool.connect();
    try {
        await runtimeClient.query(`SET ROLE ${quotedRole}`);
        const insertSql = `INSERT INTO ${quotedSchema}."game_events" (
                "idempotency_key", "event_type", "schema_version", "game_id", "room_id",
                "payload", "payload_sha256"
            ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
            ON CONFLICT ("idempotency_key") DO NOTHING`;
        const insertParameters = [
            runtimeIdempotencyKey,
            runtimeEvent.eventType,
            runtimeEvent.schemaVersion,
            runtimeEvent.gameId,
            runtimeEvent.roomId,
            runtimePayload,
            runtimePayloadSha256,
        ];
        await runtimeClient.query(insertSql, insertParameters);
        await runtimeClient.query(insertSql, insertParameters);
        const visibleKeys = await runtimeClient.query(
            `SELECT "idempotency_key" FROM ${quotedSchema}."game_events"
                WHERE "idempotency_key" = $1`,
            [runtimeIdempotencyKey],
        );
        assert.equal(visibleKeys.rowCount, 1);
        await assert.rejects(
            runtimeClient.query(`SELECT "payload" FROM ${quotedSchema}."game_events"`),
            /permission denied/,
        );
        await assert.rejects(
            runtimeClient.query(`UPDATE ${quotedSchema}."game_events" SET "game_id" = 'blocked'`),
            /permission denied/,
        );
        await assert.rejects(
            runtimeClient.query(`DELETE FROM ${quotedSchema}."game_events"`),
            /permission denied/,
        );
        await assert.rejects(
            runtimeClient.query(`TRUNCATE TABLE ${quotedSchema}."game_events"`),
            /permission denied/,
        );
        await assert.rejects(
            runtimeClient.query(`CREATE TABLE ${quotedSchema}."blocked" ("id" integer)`),
            /permission denied/,
        );
    } finally {
        try {
            await runtimeClient.query("RESET ROLE");
        } finally {
            runtimeClient.release();
        }
    }

    const runtimeCountResult = await adminPool.query(
        `SELECT count(*)::integer AS count FROM ${quotedSchema}."game_events"
            WHERE "idempotency_key" = $1`,
        [runtimeIdempotencyKey],
    );
    assert.equal(runtimeCountResult.rows[0].count, 1);
});
