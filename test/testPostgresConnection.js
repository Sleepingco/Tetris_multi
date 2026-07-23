/**
 * PostgreSQL URL parsing, TLS fail-closed와 error redaction 경계를 DB 연결 없이 검증한다.
 *
 * 실행: `npm run build:server && node --test test/testPostgresConnection.js`
 * 기대: connectionString과 unsafe query option이 pg config로 전달되지 않는다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { Client } = require("pg");

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
        client_encoding: "UTF8",
        connectionTimeoutMillis: 1_000,
        options: "-c standard_conforming_strings=on",
        replication: "false",
        sslnegotiation: "postgres",
        query_timeout: 2_000,
        statement_timeout: 2_000,
    });
    assert.equal(Object.hasOwn(config, "connectionString"), false);
});

test("non-loopback은 verify-full DNS hostname과 certificate 검증을 요구한다", () => {
    const config = createPostgresClientConfig(
        "postgresql://runtime:test-password@db.example.test/analytics?sslmode=verify-full",
        { ca: "test-private-ca" },
    );
    assert.equal(config.host, "db.example.test");
    assert.deepEqual(config.ssl, {
        rejectUnauthorized: true,
        servername: "db.example.test",
        ca: "test-private-ca",
    });

    const rejectedUrls = [
        "postgresql://runtime:test-password@db.example.test/analytics",
        "postgresql://runtime:test-password@db.example.test/analytics?sslmode=disable",
        "postgresql://runtime:test-password@192.0.2.1/analytics?sslmode=verify-full",
        "postgresql://runtime:test-password@db.example.test/analytics?sslmode=require",
        "postgresql://runtime:test-password@db.example.test/analytics?sslmode=no-verify",
    ];
    for (const url of rejectedUrls) {
        assert.throws(() => createPostgresClientConfig(url), /POSTGRES_CONNECTION_/);
    }
});

test("unknown, duplicate와 unsafe query option은 fail closed한다", () => {
    const rejectedUrls = [
        "postgresql://runtime:test-password@localhost/analytics?application_name=unsafe",
        "postgresql://runtime:test-password@localhost/analytics?host=attacker.example",
        "postgresql://runtime:test-password@localhost/analytics?ssl=true",
        "postgresql://runtime:test-password@localhost/analytics?sslcert=client.crt",
        "postgresql://runtime:test-password@localhost/analytics?sslkey=client.key",
        "postgresql://runtime:test-password@localhost/analytics?sslrootcert=root.crt",
        "postgresql://runtime:test-password@localhost/analytics?sslmode=disable&sslmode=verify-full",
    ];
    for (const url of rejectedUrls) {
        assert.throws(() => createPostgresClientConfig(url), /POSTGRES_CONNECTION_/);
    }
});

test("loopback은 localhost, ::1과 유효한 127/8 IPv4만 허용한다", () => {
    const allowedUrls = [
        "postgresql://runtime:test-password@localhost/analytics?sslmode=disable",
        "postgresql://runtime:test-password@[::1]/analytics?sslmode=disable",
        "postgresql://runtime:test-password@127.255.255.254/analytics?sslmode=disable",
    ];
    for (const url of allowedUrls) {
        assert.equal(createPostgresClientConfig(url).ssl, false);
    }

    const invalidHosts = [
        "127.999.999.999",
        "127.256.0.1",
    ];
    for (const host of invalidHosts) {
        assert.throws(
            () => createPostgresClientConfig(
                `postgresql://runtime:test-password@${host}/analytics?sslmode=disable`,
            ),
            /POSTGRES_CONNECTION_/,
        );
    }
});

test("명시적 URL password가 없으면 ambient credential로 보완하지 않는다", () => {
    for (const url of [
        "postgresql://runtime@localhost/analytics?sslmode=disable",
        "postgresql://runtime:@localhost/analytics?sslmode=disable",
    ]) {
        assert.throws(
            () => createPostgresClientConfig(url),
            { message: "POSTGRES_CONNECTION_PASSWORD_REQUIRED" },
        );
    }
});

test("검증 뒤 생긴 ambient PG 값도 pg 최종 connection parameter를 바꾸지 않는다", () => {
    const config = createPostgresClientConfig(
        "postgresql://runtime:url-password@db.example.test/analytics?sslmode=verify-full",
        {
            applicationName: "goal9a-env-test",
            connectionTimeoutMillis: 3_000,
        },
    );
    const namesAndValues = {
        PGAPPNAME: "ambient-app",
        PGCLIENTENCODING: "SQL_ASCII",
        PGCLIENT_ENCODING: "SQL_ASCII",
        PGCONNECT_TIMEOUT: "59",
        PGOPTIONS: "-c statement_timeout=1",
        PGPASSWORD: "ambient-password-must-not-leak",
        PGREPLICATION: "database",
        PGSSLNEGOTIATION: "direct",
    };
    const previous = new Map();
    try {
        for (const [name, value] of Object.entries(namesAndValues)) {
            previous.set(name, process.env[name]);
            process.env[name] = value;
        }
        const parameters = new Client(config).connectionParameters;
        assert.equal(parameters.application_name, "goal9a-env-test");
        assert.equal(parameters.client_encoding, "UTF8");
        assert.equal(parameters.connect_timeout, 3);
        assert.equal(parameters.options, "-c standard_conforming_strings=on");
        assert.equal(parameters.replication, "false");
        assert.equal(parameters.sslnegotiation, "postgres");
        assert.equal(parameters.password === namesAndValues.PGPASSWORD, false);
    } finally {
        for (const [name, value] of previous) {
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
    }
});

test("ambient PG connection 환경변수는 URL 검증 경계에서 fail closed한다", () => {
    const environmentNames = [
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
    ];
    for (const name of environmentNames) {
        const previous = process.env[name];
        try {
            process.env[name] = "ambient-value-must-not-leak";
            assert.throws(
                () => createPostgresClientConfig(
                    "postgresql://runtime:url-password@localhost/analytics?sslmode=disable",
                ),
                { message: "POSTGRES_CONNECTION_AMBIENT_ENV_NOT_ALLOWED" },
            );
        } finally {
            if (previous === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = previous;
            }
        }
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
        connectionUrl:
            "postgresql://runtime:test-password@127.0.0.1:1/analytics?sslmode=disable",
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
            "postgresql://runtime:test-password@localhost/analytics?sslmode=disable",
            { ca: "unused-ca" },
        ),
        { message: "POSTGRES_CONNECTION_CA_WITHOUT_TLS" },
    );
    for (const timeout of [0, -1, 60_001, 1.5]) {
        assert.throws(
            () => createPostgresClientConfig(
                "postgresql://runtime:test-password@localhost/analytics",
                { connectionTimeoutMillis: timeout },
            ),
            { message: "POSTGRES_CONNECTION_TIMEOUT_INVALID" },
        );
    }
});
