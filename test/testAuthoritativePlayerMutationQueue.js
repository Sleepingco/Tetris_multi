/**
 * 같은 player의 비동기 authoritative 변경은 직렬화하고, 다른 player는 독립 실행하는지 검증한다.
 *
 * 준비: 수동으로 완료 시점을 제어할 Promise와 실행 순서를 기록할 배열을 만든다.
 * 실행: mutation 여러 개를 queue에 넣고 원하는 지점에서 첫 작업을 해제한다.
 * 검증: 같은 `(roomId, playerId)`는 FIFO이고, 앞 작업 실패가 다음 작업을 막지 않으며,
 * 서로 다른 player는 서로의 완료를 기다리지 않아야 한다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createAuthoritativePlayerMutationQueue,
} = require("../dist/server/server/services/authoritativePlayerMutationQueue.js");

/**
 * 실제 시간 지연 없이 비동기 작업을 특정 지점에서 멈추고 다시 진행시키는 test helper다.
 * `resolve`를 테스트가 직접 호출하므로 경쟁 조건의 실행 순서를 결정적으로 재현할 수 있다.
 */
function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, resolve, reject };
}

test("같은 player의 async mutation은 enqueue 순서대로 실행된다", async () => {
    const queue = createAuthoritativePlayerMutationQueue();
    const firstStarted = createDeferred();
    const releaseFirst = createDeferred();
    const events = [];

    const firstResult = queue.enqueueAuthoritativePlayerMutation("room-1", "p1", async () => {
        events.push("first:start");
        firstStarted.resolve();
        await releaseFirst.promise;
        events.push("first:end");
        return "first";
    });
    await firstStarted.promise;

    const secondResult = queue.enqueueAuthoritativePlayerMutation("room-1", "p1", async () => {
        events.push("second");
        return "second";
    });
    await Promise.resolve();

    assert.deepEqual(events, ["first:start"]);

    releaseFirst.resolve();

    assert.equal(await firstResult, "first");
    assert.equal(await secondResult, "second");
    assert.deepEqual(events, ["first:start", "first:end", "second"]);
});

test("첫 mutation reject 이후에도 같은 player의 다음 mutation이 실행된다", async () => {
    const queue = createAuthoritativePlayerMutationQueue();
    const events = [];
    const firstResult = queue.enqueueAuthoritativePlayerMutation("room-1", "p1", async () => {
        events.push("first");
        throw new Error("expected failure");
    });
    const firstAssertion = assert.rejects(firstResult, /expected failure/);
    const secondResult = queue.enqueueAuthoritativePlayerMutation("room-1", "p1", async () => {
        events.push("second");
        return "recovered";
    });

    await firstAssertion;
    assert.equal(await secondResult, "recovered");
    assert.deepEqual(events, ["first", "second"]);
});

test("서로 다른 player의 mutation은 독립적으로 실행된다", async () => {
    const queue = createAuthoritativePlayerMutationQueue();
    const firstPlayerStarted = createDeferred();
    const releaseFirstPlayer = createDeferred();
    const events = [];

    const firstPlayerResult = queue.enqueueAuthoritativePlayerMutation("room-1", "p1", async () => {
        events.push("p1:start");
        firstPlayerStarted.resolve();
        await releaseFirstPlayer.promise;
        events.push("p1:end");
    });
    await firstPlayerStarted.promise;

    const secondPlayerResult = queue.enqueueAuthoritativePlayerMutation("room-1", "p2", async () => {
        events.push("p2");
    });
    await secondPlayerResult;

    assert.deepEqual(events, ["p1:start", "p2"]);

    releaseFirstPlayer.resolve();
    await firstPlayerResult;
    assert.deepEqual(events, ["p1:start", "p2", "p1:end"]);
});

test("완료된 entry는 이후 같은 player mutation을 막지 않는다", async () => {
    const queue = createAuthoritativePlayerMutationQueue();
    const events = [];

    await queue.enqueueAuthoritativePlayerMutation("room-1", "p1", () => {
        events.push("first");
    });
    await Promise.resolve();
    await queue.enqueueAuthoritativePlayerMutation("room-1", "p1", () => {
        events.push("second");
    });

    assert.deepEqual(events, ["first", "second"]);
});
