const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createAuthoritativePlayerMutationQueue,
} = require("../src/server/services/authoritativePlayerMutationQueue.js");

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
