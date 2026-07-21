const test = require("node:test");
const assert = require("node:assert/strict");
const {
    createGameEventIdempotencyKey,
    createPostgresEventRepository,
} = require("../dist/server/server/repositories/postgresEventRepository.js");
const {
    migratePostgresEvents,
} = require("../scripts/migrate-postgres-shadow.js");

test("PostgreSQL event boundary는 원격 plain-text 연결과 private payload를 거부한다", async () => {
    const identityEvent = {
        eventType: "placement_decision",
        schemaVersion: 1,
        gameId: "identity-game",
        playerId: "identity-player",
        pieceIndex: 4,
    };
    assert.equal(
        createGameEventIdempotencyKey(identityEvent),
        createGameEventIdempotencyKey({
            ...identityEvent,
            schemaVersion: 2,
            extraPayloadField: true,
        }),
    );
    assert.throws(
        () => createPostgresEventRepository({
            connectionString: "https://db.example.invalid/tetris",
        }),
        { message: "POSTGRES_EVENT_CONNECTION_PROTOCOL_INVALID" },
    );
    assert.throws(
        () => createPostgresEventRepository({
            connectionString: "postgresql://localhost/tetris",
            schemaName: "public;drop_schema",
        }),
        { message: "POSTGRES_EVENT_SCHEMA_NAME_INVALID" },
    );
    assert.throws(
        () => createPostgresEventRepository({
            connectionString: "postgresql://db.example.invalid/tetris",
        }),
        { message: "POSTGRES_EVENT_SSL_REQUIRED" },
    );
    await assert.rejects(
        migratePostgresEvents({
            connectionString: "postgresql://db.example.invalid/tetris",
        }),
        { message: "POSTGRES_MIGRATION_SSL_REQUIRED" },
    );

    const repository = createPostgresEventRepository({
        connectionString: "postgresql://localhost/tetris",
    });
    try {
        for (const field of [
            "Authorization",
            "accessToken",
            "api_key",
            "auth",
            "client_secret",
            "cookie",
            "credential",
            "expiresAt",
            "generation",
            "password",
            "privateKey",
            "reconnectToken",
            "secret",
            "session_id",
            "socketId",
            "token",
            "tokenDigest",
        ]) {
            await assert.rejects(repository.append({
                eventType: "game_start",
                schemaVersion: 1,
                gameId: "private-event",
                nested: { [field]: "not-persisted" },
            }), { message: "POSTGRES_EVENT_PRIVATE_FIELD_REJECTED" });
        }
    } finally {
        await repository.close();
    }
});
