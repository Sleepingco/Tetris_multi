const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
    PostgresEventRepositoryError,
    isRetryablePostgresAppendError,
} = require("../dist/server/server/repositories/postgresEventRepository.js");
const {
    createRuntimeEventStorage,
    POSTGRES_RUNTIME_CONNECTION_TIMEOUT_MS,
    POSTGRES_RUNTIME_IN_FLIGHT_MAX,
    POSTGRES_RUNTIME_POOL_MAX,
    POSTGRES_RUNTIME_QUERY_TIMEOUT_MS,
    POSTGRES_RUNTIME_DRAIN_TIMEOUT_MS,
    POSTGRES_RUNTIME_WRITE_ATTEMPTS,
    POSTGRES_RUNTIME_WRITE_BUDGET_MS,
    resolveGameEventStorageMode,
} = require("../dist/server/server/services/runtimeEventStorage.js");

function gameStart(overrides = {}) {
    return {
        eventType: "game_start",
        schemaVersion: 1,
        gameId: "runtime-game",
        roomId: "ROOM0001",
        mode: "multi",
        aiDifficulty: null,
        aiPolicyRequested: null,
        startedAt: 1784800000000,
        players: [{
            playerId: "runtime-player",
            nickname: "must-not-persist",
            role: "host",
            playerType: "human",
        }],
        ...overrides,
    };
}

function repositoryStub(overrides = {}) {
    let closeCount = 0;
    const repository = {
        async verifyReady() {},
        async append() {
            return { status: "inserted", eventId: "event-id" };
        },
        close() {
            closeCount += 1;
            return Promise.resolve();
        },
        getPoolStats() {
            return { totalCount: 0, idleCount: 0, waitingCount: 0, max: 4 };
        },
        ...overrides,
    };
    return {
        repository,
        closeCount: () => closeCount,
    };
}

function postgresEnv(extra = {}) {
    return {
        NODE_ENV: "test",
        GAME_EVENT_STORAGE: "postgres",
        DATABASE_URL: "postgresql://runtime:secret@localhost/runtime?sslmode=disable",
        ...extra,
    };
}

test("storage mode는 local jsonl default와 production explicit 계약을 강제한다", async () => {
    assert.equal(resolveGameEventStorageMode({ NODE_ENV: "test" }), "jsonl");
    assert.equal(resolveGameEventStorageMode({
        NODE_ENV: "production",
        GAME_EVENT_STORAGE: "jsonl",
    }), "jsonl");
    assert.throws(
        () => resolveGameEventStorageMode({ NODE_ENV: "production" }),
        { message: "GAME_EVENT_STORAGE_REQUIRED" },
    );
    assert.throws(
        () => resolveGameEventStorageMode({ GAME_EVENT_STORAGE: "fallback" }),
        { message: "GAME_EVENT_STORAGE_INVALID" },
    );
    await assert.rejects(
        createRuntimeEventStorage({
            env: { NODE_ENV: "test", GAME_EVENT_STORAGE: "postgres" },
        }),
        { message: "DATABASE_URL_REQUIRED" },
    );

    const productionStart = spawnSync(
        process.execPath,
        [path.join(__dirname, "..", "dist", "server", "app.js")],
        {
            cwd: path.join(__dirname, ".."),
            env: {
                ...process.env,
                NODE_ENV: "production",
                PORT: "0",
                SOCKET_ALLOWED_ORIGINS: "http://127.0.0.1:5500",
                GAME_EVENT_STORAGE: "",
                DATABASE_URL: "",
            },
            encoding: "utf8",
            timeout: 2_000,
        },
    );
    assert.equal(productionStart.status, 1);
    assert.equal(productionStart.stdout, "");
    assert.equal(productionStart.stderr.trim(), "GAME_EVENT_STORAGE_REQUIRED");
    assert.equal(productionStart.error, undefined);
});

test("jsonl mode는 기존 raw log와 파일 경계를 보존한다", async t => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "goal9b-jsonl-"));
    const jsonlPath = path.join(tempDirectory, "game-events.jsonl");
    t.after(() => fs.rmSync(tempDirectory, { recursive: true, force: true }));
    const previousPath = process.env.GAME_EVENTS_LOG_PATH;
    process.env.GAME_EVENTS_LOG_PATH = jsonlPath;
    try {
        const storage = await createRuntimeEventStorage({
            env: { NODE_ENV: "test", GAME_EVENT_STORAGE: "jsonl" },
        });
        const raw = gameStart({ nickname: "current-jsonl-nickname" });
        assert.equal((await storage.saveGameEventLog(raw)).ok, true);
        assert.deepEqual(
            JSON.parse(fs.readFileSync(jsonlPath, "utf8").trim()),
            raw,
        );
        await storage.close();
    } finally {
        if (previousPath === undefined) delete process.env.GAME_EVENTS_LOG_PATH;
        else process.env.GAME_EVENTS_LOG_PATH = previousPath;
    }
});

test("postgres startup schema 실패는 repository를 닫고 safe code만 반환한다", async () => {
    const stub = repositoryStub({
        async verifyReady() {
            throw new Error("postgresql://runtime:secret@private.example/db");
        },
    });

    await assert.rejects(
        createRuntimeEventStorage({
            env: postgresEnv(),
            repository: stub.repository,
        }),
        error => {
            assert.equal(error.message, "POSTGRES_EVENT_STARTUP_FAILED");
            assert.doesNotMatch(error.message, /secret|postgresql/i);
            return true;
        },
    );
    assert.equal(stub.closeCount(), 1);
});

test("transient allowlist와 permanent PostgreSQL 오류를 구분한다", () => {
    for (const error of [
        { code: "ECONNREFUSED" },
        { code: "ECONNRESET" },
        { code: "ETIMEDOUT" },
        { code: "08006" },
        { code: "40001" },
        { code: "40P01" },
        { message: "Query read timeout" },
        { message: "timeout exceeded when trying to connect" },
    ]) {
        assert.equal(isRetryablePostgresAppendError(error), true);
    }
    for (const error of [
        { code: "23505" },
        { code: "42501" },
        { message: "arbitrary timeout supplied by attacker" },
        new Error("secret raw error"),
    ]) {
        assert.equal(isRetryablePostgresAppendError(error), false);
    }
});

test("transient append는 같은 canonical event로 최대 3회만 재시도한다", async () => {
    const seen = [];
    const stub = repositoryStub({
        async append(event) {
            seen.push(event);
            if (seen.length < POSTGRES_RUNTIME_WRITE_ATTEMPTS) {
                throw new PostgresEventRepositoryError(
                    "POSTGRES_EVENT_APPEND_FAILED",
                    true,
                );
            }
            return { status: "inserted", eventId: "event-id" };
        },
    });
    const storage = await createRuntimeEventStorage({
        env: postgresEnv(),
        repository: stub.repository,
        sleep: async () => {},
    });

    const result = await storage.saveGameEventLog(gameStart());

    assert.equal(result.ok, true);
    assert.equal(seen.length, POSTGRES_RUNTIME_WRITE_ATTEMPTS);
    assert.strictEqual(seen[0], seen[1]);
    assert.strictEqual(seen[1], seen[2]);
    assert.equal(storage.getMetrics().attempts, 3);
    await storage.close();
});

test("conflict lookup까지 포함한 retry 최악 경로는 2.7초 budget 안에 끝난다", async () => {
    let elapsed = 0;
    let appendCount = 0;
    const stub = repositoryStub({
        async append() {
            appendCount += 1;
            elapsed += 2 * (
                POSTGRES_RUNTIME_CONNECTION_TIMEOUT_MS
                + POSTGRES_RUNTIME_QUERY_TIMEOUT_MS
            );
            throw new PostgresEventRepositoryError(
                "POSTGRES_EVENT_APPEND_FAILED",
                true,
            );
        },
    });
    const storage = await createRuntimeEventStorage({
        env: postgresEnv(),
        repository: stub.repository,
        now: () => elapsed,
        sleep: async milliseconds => {
            elapsed += milliseconds;
        },
        warn() {},
    });

    const result = await storage.saveGameEventLog(gameStart());

    assert.equal(result.ok, false);
    assert.equal(appendCount, POSTGRES_RUNTIME_WRITE_ATTEMPTS);
    assert.ok(elapsed <= POSTGRES_RUNTIME_WRITE_BUDGET_MS);
    await storage.close();
});

test("constraint/conflict는 재시도하지 않고 raw payload와 credential을 기록하지 않는다", async () => {
    const warnings = [];
    let appendCount = 0;
    const stub = repositoryStub({
        async append() {
            appendCount += 1;
            return {
                status: "conflict",
                eventId: "private-event-id",
                code: "IDEMPOTENCY_CONFLICT",
            };
        },
    });
    const storage = await createRuntimeEventStorage({
        env: postgresEnv(),
        repository: stub.repository,
        warn: message => warnings.push(message),
    });

    const result = await storage.saveGameEventLog(gameStart({
        nickname: "payload-sentinel",
    }));

    assert.equal(result.reason, "IDEMPOTENCY_CONFLICT");
    assert.equal(appendCount, 1);
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(warnings[0], /payload-sentinel|secret|private-event-id/);
    await storage.close();
});

test("in-flight 16개를 넘기지 않고 postgres mode에서 JSONL file을 만들지 않는다", async () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "goal9b-no-jsonl-"));
    const jsonlPath = path.join(tempDirectory, "game-events.jsonl");
    const resolvers = [];
    const stub = repositoryStub({
        append() {
            return new Promise(resolve => resolvers.push(resolve));
        },
    });
    const storage = await createRuntimeEventStorage({
        env: postgresEnv({ GAME_EVENTS_LOG_PATH: jsonlPath }),
        repository: stub.repository,
        warn() {},
    });

    const writes = Array.from(
        { length: POSTGRES_RUNTIME_IN_FLIGHT_MAX },
        (_, index) => storage.saveGameEventLog(gameStart({
            gameId: `runtime-game-${index}`,
        })),
    );
    const rejected = await storage.saveGameEventLog(gameStart({
        gameId: "runtime-game-over-limit",
    }));

    assert.equal(rejected.reason, "LOG_WRITE_FAILED");
    assert.equal(storage.getMetrics().inFlight, POSTGRES_RUNTIME_IN_FLIGHT_MAX);
    assert.equal(storage.getMetrics().poolMax, POSTGRES_RUNTIME_POOL_MAX);
    assert.equal(fs.existsSync(jsonlPath), false);
    for (const resolve of resolvers) {
        resolve({ status: "inserted", eventId: "event-id" });
    }
    await Promise.all(writes);
    await storage.close();
});

test("write 차단, drain과 close는 idempotent lifecycle을 유지한다", async () => {
    let resolveAppend;
    const stub = repositoryStub({
        append() {
            return new Promise(resolve => {
                resolveAppend = resolve;
            });
        },
    });
    const storage = await createRuntimeEventStorage({
        env: postgresEnv(),
        repository: stub.repository,
        warn() {},
    });
    const pending = storage.saveGameEventLog(gameStart());

    assert.equal(POSTGRES_RUNTIME_DRAIN_TIMEOUT_MS, 3_000);
    storage.rejectNewWrites();
    const rejected = await storage.saveGameEventLog(gameStart({
        gameId: "rejected-after-shutdown",
    }));
    assert.equal(rejected.reason, "LOG_WRITE_FAILED");
    assert.deepEqual(await storage.drain(0), { drained: false, pending: 1 });

    resolveAppend({ status: "inserted", eventId: "event-id" });
    await pending;
    assert.deepEqual(await storage.drain(), { drained: true, pending: 0 });
    const firstClose = storage.close();
    const secondClose = storage.close();
    assert.strictEqual(firstClose, secondClose);
    await firstClose;
    assert.equal(stub.closeCount(), 1);
});
