const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createPostgresShadowQueue,
} = require("../dist/server/server/services/postgresShadowQueue.js");

function createDeferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

test("shadow queue는 enqueue snapshot을 FIFO로 한 번씩 저장한다", async () => {
    const releaseFirst = createDeferred();
    const saved = [];
    const queue = createPostgresShadowQueue({
        capacity: 3,
        write: async (log) => {
            if (log.id === 1) await releaseFirst.promise;
            saved.push(log);
        },
    });
    const first = { id: 1, nested: { value: "before" } };
    const second = { id: 2, nested: { value: "second" } };

    assert.equal(queue.enqueue(first), true);
    assert.equal(queue.enqueue(second), true);
    first.nested.value = "mutated";
    second.nested.value = "mutated";
    releaseFirst.resolve();

    const stats = await queue.shutdown();
    assert.deepEqual(saved, [
        { id: 1, nested: { value: "before" } },
        { id: 2, nested: { value: "second" } },
    ]);
    assert.deepEqual(stats, {
        accepted: 2,
        written: 2,
        failed: 0,
        timedOut: 0,
        dropped: 0,
        pending: 0,
        accepting: false,
    });
});

test("capacity는 in-flight를 포함하며 overflow에서 newest를 버린다", async () => {
    const firstStarted = createDeferred();
    const releaseFirst = createDeferred();
    const saved = [];
    const warnings = [];
    const queue = createPostgresShadowQueue({
        capacity: 2,
        warn: message => warnings.push(message),
        write: async (log) => {
            saved.push(log.id);
            if (log.id === 1) {
                firstStarted.resolve();
                await releaseFirst.promise;
            }
        },
    });

    assert.equal(queue.enqueue({ id: 1 }), true);
    await firstStarted.promise;
    assert.equal(queue.enqueue({ id: 2 }), true);
    assert.equal(queue.enqueue({ id: 3, token: "must-not-leak" }), false);
    releaseFirst.resolve();
    const stats = await queue.shutdown();

    assert.deepEqual(saved, [1, 2]);
    assert.equal(stats.dropped, 1);
    assert.deepEqual(warnings, [
        "[postgresShadowQueue] queue full; newest shadow event dropped",
    ]);
});

test("failure 뒤에도 다음 shadow write를 계속한다", async () => {
    const called = [];
    const warnings = [];
    const queue = createPostgresShadowQueue({
        capacity: 4,
        shutdownTimeoutMs: 200,
        warn: message => warnings.push(message),
        write(log) {
            called.push(log.id);
            if (log.id === 1) throw new Error("postgres://user:secret@db/private");
            return undefined;
        },
    });

    queue.enqueue({ id: 1 });
    queue.enqueue({ id: 2 });
    const stats = await queue.shutdown();

    assert.deepEqual(called, [1, 2]);
    assert.equal(stats.timedOut, 0);
    assert.equal(stats.failed, 1);
    assert.equal(stats.written, 1);
    assert.deepEqual(warnings, [
        "[postgresShadowQueue] shadow write failed",
    ]);
});

test("queue timeout은 writer를 비활성화하고 대기 event를 버린다", async () => {
    const warnings = [];
    const called = [];
    const queue = createPostgresShadowQueue({
        capacity: 3,
        writeTimeoutMs: 10,
        shutdownTimeoutMs: 100,
        warn: message => warnings.push(message),
        write(log) {
            called.push(log.id);
            return new Promise(() => {});
        },
    });

    queue.enqueue({ id: 1 });
    queue.enqueue({ id: 2 });
    const stats = await queue.shutdown();

    assert.deepEqual(called, [1]);
    assert.equal(stats.timedOut, 1);
    assert.equal(stats.dropped, 1);
    assert.equal(stats.accepting, false);
    assert.deepEqual(warnings, [
        "[postgresShadowQueue] shadow write timed out",
        "[postgresShadowQueue] timed-out writer disabled; queued events dropped",
    ]);
});

test("shutdown은 bounded flush 뒤 대기 event를 버리고 같은 Promise를 반환한다", async () => {
    const firstStarted = createDeferred();
    const releaseFirst = createDeferred();
    const called = [];
    const warnings = [];
    const queue = createPostgresShadowQueue({
        capacity: 3,
        writeTimeoutMs: 100,
        shutdownTimeoutMs: 10,
        warn: message => warnings.push(message),
        async write(log) {
            called.push(log.id);
            if (log.id === 1) {
                firstStarted.resolve();
                await releaseFirst.promise;
            }
        },
    });

    queue.enqueue({ id: 1 });
    await firstStarted.promise;
    queue.enqueue({ id: 2 });
    const firstShutdown = queue.shutdown();
    const secondShutdown = queue.shutdown();

    assert.strictEqual(firstShutdown, secondShutdown);
    const stats = await firstShutdown;
    assert.equal(stats.dropped, 1);
    assert.deepEqual(called, [1]);
    assert.equal(queue.enqueue({ id: 3 }), false);
    assert.deepEqual(warnings, [
        "[postgresShadowQueue] shutdown deadline reached; queued events dropped",
    ]);
    releaseFirst.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(called, [1]);
});

test("clone할 수 없는 event는 예외나 payload 노출 없이 버린다", async () => {
    const warnings = [];
    let writes = 0;
    const queue = createPostgresShadowQueue({
        warn: message => warnings.push(message),
        write() {
            writes += 1;
        },
    });

    assert.equal(queue.enqueue({ token: "must-not-leak", unsupported() {} }), false);
    const stats = await queue.shutdown();

    assert.equal(writes, 0);
    assert.equal(stats.dropped, 1);
    assert.deepEqual(warnings, [
        "[postgresShadowQueue] shadow event could not be copied",
    ]);
});

test("필수 option과 양의 queue 설정을 검증한다", () => {
    assert.throws(() => createPostgresShadowQueue({}), /write must be a function/);
    assert.throws(
        () => createPostgresShadowQueue({ write() {}, capacity: 0 }),
        /capacity must be a positive integer/,
    );
    assert.throws(
        () => createPostgresShadowQueue({ write() {}, writeTimeoutMs: -1 }),
        /writeTimeoutMs must be a positive integer/,
    );
    assert.throws(
        () => createPostgresShadowQueue({ write() {}, shutdownTimeoutMs: 1.5 }),
        /shutdownTimeoutMs must be a positive integer/,
    );
});
