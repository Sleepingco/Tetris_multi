const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createServerShutdown,
    SERVER_HARD_SHUTDOWN_TIMEOUT_MS,
} = require("../dist/server/server/serverShutdown.js");

test("shutdown은 write 차단부터 HTTP close까지 고정 순서를 한 번만 실행한다", async () => {
    const calls = [];
    let resolveDrain;
    let timeoutDelay = null;
    let clearedTimer = null;
    const timer = { unref() { calls.push("unref"); } };
    const shutdown = createServerShutdown({
        rejectNewWrites() {
            calls.push("reject");
        },
        stopEventProducers() {
            calls.push("stop-producers");
        },
        drainWrites() {
            calls.push("drain-start");
            return new Promise(resolve => {
                resolveDrain = () => {
                    calls.push("drain-end");
                    resolve();
                };
            });
        },
        async closePool() {
            calls.push("close-pool");
        },
        async closeSocketAndHttp() {
            calls.push("close-socket-http");
        },
        setTimeoutFn(callback, delay) {
            assert.equal(typeof callback, "function");
            timeoutDelay = delay;
            return timer;
        },
        clearTimeoutFn(value) {
            clearedTimer = value;
        },
        hardExit() {
            calls.push("hard-exit");
        },
    });

    const first = shutdown();
    const second = shutdown();
    assert.strictEqual(first, second);
    assert.equal(timeoutDelay, SERVER_HARD_SHUTDOWN_TIMEOUT_MS);
    assert.deepEqual(calls, [
        "unref",
        "reject",
        "stop-producers",
        "drain-start",
    ]);

    resolveDrain();
    await first;
    assert.deepEqual(calls, [
        "unref",
        "reject",
        "stop-producers",
        "drain-start",
        "drain-end",
        "close-pool",
        "close-socket-http",
    ]);
    assert.strictEqual(clearedTimer, timer);
});

test("drain/pool 실패 뒤에도 Socket.IO와 HTTP close를 시도한다", async () => {
    const calls = [];
    const shutdown = createServerShutdown({
        rejectNewWrites() {
            calls.push("reject");
        },
        stopEventProducers() {
            calls.push("stop");
        },
        async drainWrites() {
            calls.push("drain");
            throw new Error("drain failed");
        },
        async closePool() {
            calls.push("pool");
            throw new Error("pool failed");
        },
        async closeSocketAndHttp() {
            calls.push("socket-http");
        },
        setTimeoutFn() {
            return { unref() {} };
        },
        clearTimeoutFn() {},
        hardExit() {},
    });

    await assert.rejects(shutdown(), { message: "SERVER_SHUTDOWN_FAILED" });
    assert.deepEqual(calls, ["reject", "stop", "drain", "pool", "socket-http"]);
});

test("8초 hard deadline은 종료가 멈춘 경우에만 exit 1을 요청한다", () => {
    let timeoutCallback;
    let exitCode = null;
    const shutdown = createServerShutdown({
        rejectNewWrites() {},
        stopEventProducers() {},
        drainWrites: () => new Promise(() => {}),
        async closePool() {},
        async closeSocketAndHttp() {},
        setTimeoutFn(callback, delay) {
            assert.equal(delay, 8_000);
            timeoutCallback = callback;
            return { unref() {} };
        },
        clearTimeoutFn() {},
        hardExit(code) {
            exitCode = code;
        },
    });

    void shutdown();
    timeoutCallback();
    assert.equal(exitCode, 1);
});
