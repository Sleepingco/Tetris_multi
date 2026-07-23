/**
 * PostgreSQL URL parsing, TLS fail-closed와 error redaction 경계를 DB 연결 없이 검증한다.
 *
 * 실행: `npm run build:server && node --test test/testPostgresConnection.js`
 * 기대: connectionString과 unsafe query option이 pg config로 전달되지 않는다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createPostgresClientConfig,
} = require("../dist/server/server/db/postgresConnection.js");
const {
    runMigrationCli,
} = require("../dist/server/server/db/migrateCli.js");
const {
    createPostgresEventRepository,
} = require("../dist/server/server/repositories/postgresEventRepository.js");

test("loopback URL은 허용 field만 가진 non-TLS ClientConfig가 된다", () => {
    const url = new URL(
        "postgresql://127.0.0.1:55432/goal9a?sslmode=disable",
    );
    url.username = "goal@user";
    url.password = "test/password";
    const config = createPostgresClientConfig(url.toString(), {
        applicationName: "goal9a-test",
        connectionTimeoutMillis: 1_000,
        queryTimeoutMillis: 2_000,
    });

    assert.deepEqual(config, {
        host: "127.0.0.1",
        port: 55432,
        database: "goal9a",
        user: "goal@user",
        password: "test/password",
        ssl: false,
        application_name: "goal9a-test",
        connectionTimeoutMillis: 1_000,
        query_timeout: 2_000,
        statement_timeout: 2_000,
    });
    assert.equal(Object.hasOwn(config, "connectionString"), false);
});

test("non-loopback은 verify-full DNS hostname과 certificate 검증을 요구한다", () => {
    const config = createPostgresClientConfig(
        "postgresql://runtime@db.example.test/analytics?sslmode=verify-full",
        { ca: "test-private-ca" },
    );
    assert.equal(config.host, "db.example.test");
    assert.deepEqual(config.ssl, {
        rejectUnauthorized: true,
        servername: "db.example.test",
        ca: "test-private-ca",
    });

    const rejectedUrls = [
        "postgresql://runtime@db.example.test/analytics",
        "postgresql://runtime@db.example.test/analytics?sslmode=disable",
        "postgresql://runtime@192.0.2.1/analytics?sslmode=verify-full",
        "postgresql://runtime@db.example.test/analytics?sslmode=require",
        "postgresql://runtime@db.example.test/analytics?sslmode=no-verify",
    ];
    for (const url of rejectedUrls) {
        assert.throws(() => createPostgresClientConfig(url), /POSTGRES_CONNECTION_/);
    }
});

test("unknown, duplicate와 unsafe query option은 fail closed한다", () => {
    const rejectedUrls = [
        "postgresql://runtime@localhost/analytics?application_name=unsafe",
        "postgresql://runtime@localhost/analytics?host=attacker.example",
        "postgresql://runtime@localhost/analytics?ssl=true",
        "postgresql://runtime@localhost/analytics?sslcert=client.crt",
        "postgresql://runtime@localhost/analytics?sslkey=client.key",
        "postgresql://runtime@localhost/analytics?sslrootcert=root.crt",
        "postgresql://runtime@localhost/analytics?sslmode=disable&sslmode=verify-full",
    ];
    for (const url of rejectedUrls) {
        assert.throws(() => createPostgresClientConfig(url), /POSTGRES_CONNECTION_/);
    }
});

test("URL, password와 raw payload는 외부 오류 code에 노출되지 않는다", async () => {
    const password = "sentinel-password-never-log";
    const unsafeUrl = new URL(
        "postgresql://db.example.test/analytics?sslmode=no-verify",
    );
    unsafeUrl.username = "runtime";
    unsafeUrl.password = password;
    let connectionError;
    try {
        createPostgresClientConfig(unsafeUrl.toString());
    } catch (error) {
        connectionError = error;
    }
    assert.equal(connectionError.message, "POSTGRES_CONNECTION_SSL_MODE_INVALID");
    assert.doesNotMatch(connectionError.message, /sentinel|postgresql:|runtime/i);

    const repository = createPostgresEventRepository({
        connectionUrl: "postgresql://runtime@127.0.0.1:1/analytics?sslmode=disable",
    });
    await assert.rejects(
        repository.append({
            rawPayload: "sentinel-raw-payload-never-log",
        }),
        error => {
            assert.equal(error.message, "INVALID_CANONICAL_EVENT");
            assert.doesNotMatch(error.message, /sentinel|raw-payload/i);
            return true;
        },
    );
    await repository.close();
});

test("migration CLI는 DATABASE_URL fallback 없이 MIGRATION_DATABASE_URL만 요구한다", async () => {
    await assert.rejects(
        runMigrationCli({
            DATABASE_URL: "postgresql://must-not-be-read@localhost/ignored",
        }),
        { message: "MIGRATION_DATABASE_URL_REQUIRED" },
    );
});

test("provider CA와 timeout도 허용된 TLS 계약 안에서만 사용한다", () => {
    assert.throws(
        () => createPostgresClientConfig(
            "postgresql://runtime@localhost/analytics?sslmode=disable",
            { ca: "unused-ca" },
        ),
        { message: "POSTGRES_CONNECTION_CA_WITHOUT_TLS" },
    );
    for (const timeout of [0, -1, 60_001, 1.5]) {
        assert.throws(
            () => createPostgresClientConfig(
                "postgresql://runtime@localhost/analytics",
                { connectionTimeoutMillis: timeout },
            ),
            { message: "POSTGRES_CONNECTION_TIMEOUT_INVALID" },
        );
    }
});
