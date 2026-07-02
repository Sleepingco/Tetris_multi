const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");

class FakeSocket {
    constructor() {
        this.emits = [];
        this.handlers = new Map();
        this.removedHandlers = [];
    }

    emit(eventName, payload) {
        this.emits.push({ eventName, payload });
    }

    on(eventName, handler) {
        this.handlers.set(eventName, handler);
    }

    off(eventName, handler) {
        this.removedHandlers.push({ eventName, handler });
        if (this.handlers.get(eventName) === handler) {
            this.handlers.delete(eventName);
        }
    }
}

async function loadRoomClient(fakeSocket) {
    globalThis.io = () => fakeSocket;

    const moduleUrl = pathToFileURL(`${process.cwd()}/src/client/net/roomClient.js`);
    moduleUrl.searchParams.set("test", `${Date.now()}-${Math.random()}`);

    return import(moduleUrl.href);
}

test("requestGameShadowState는 game:shadow:state 이벤트를 전송한다", async () => {
    const fakeSocket = new FakeSocket();
    const { requestGameShadowState } = await loadRoomClient(fakeSocket);

    requestGameShadowState("ROOM001", "player-001");

    assert.deepEqual(fakeSocket.emits, [
        {
            eventName: "game:shadow:state",
            payload: {
                roomId: "ROOM001",
                playerId: "player-001",
            },
        },
    ]);
});

test("onGameShadowStateResult는 result handler를 등록하고 해제 함수를 반환한다", async () => {
    const fakeSocket = new FakeSocket();
    const { onGameShadowStateResult } = await loadRoomClient(fakeSocket);
    const handler = () => {};

    const detach = onGameShadowStateResult(handler);

    assert.equal(fakeSocket.handlers.get("game:shadow:state:result"), handler);

    detach();

    assert.deepEqual(fakeSocket.removedHandlers, [
        {
            eventName: "game:shadow:state:result",
            handler,
        },
    ]);
    assert.equal(fakeSocket.handlers.has("game:shadow:state:result"), false);
});

test("requestGameAuthoritativeSnapshot은 game:authoritative:snapshot 이벤트를 전송한다", async () => {
    const fakeSocket = new FakeSocket();
    const { requestGameAuthoritativeSnapshot } = await loadRoomClient(fakeSocket);

    requestGameAuthoritativeSnapshot("ROOM001", "player-001");

    assert.deepEqual(fakeSocket.emits, [
        {
            eventName: "game:authoritative:snapshot",
            payload: {
                roomId: "ROOM001",
                playerId: "player-001",
            },
        },
    ]);
});

test("onGameAuthoritativeSnapshotResult는 result handler를 등록하고 해제 함수를 반환한다", async () => {
    const fakeSocket = new FakeSocket();
    const { onGameAuthoritativeSnapshotResult } = await loadRoomClient(fakeSocket);
    const handler = () => {};

    const detach = onGameAuthoritativeSnapshotResult(handler);

    assert.equal(fakeSocket.handlers.get("game:authoritative:snapshot:result"), handler);

    detach();

    assert.deepEqual(fakeSocket.removedHandlers, [
        {
            eventName: "game:authoritative:snapshot:result",
            handler,
        },
    ]);
    assert.equal(fakeSocket.handlers.has("game:authoritative:snapshot:result"), false);
});

test("receiveGameAuthoritativeSnapshotUpdate는 server push handler를 등록하고 해제 함수를 반환한다", async () => {
    const fakeSocket = new FakeSocket();
    const { receiveGameAuthoritativeSnapshotUpdate } = await loadRoomClient(fakeSocket);
    const handler = () => {};

    const detach = receiveGameAuthoritativeSnapshotUpdate(handler);

    assert.equal(fakeSocket.handlers.get("game:authoritative:snapshot:update"), handler);

    detach();

    assert.deepEqual(fakeSocket.removedHandlers, [
        {
            eventName: "game:authoritative:snapshot:update",
            handler,
        },
    ]);
    assert.equal(fakeSocket.handlers.has("game:authoritative:snapshot:update"), false);
});

test("subscribeGameAuthoritativeSnapshotUpdates는 update 구독 이벤트를 전송한다", async () => {
    const fakeSocket = new FakeSocket();
    const { subscribeGameAuthoritativeSnapshotUpdates } = await loadRoomClient(fakeSocket);

    subscribeGameAuthoritativeSnapshotUpdates("ROOM001", "player-001");

    assert.deepEqual(fakeSocket.emits, [
        {
            eventName: "game:authoritative:snapshot:subscribe",
            payload: {
                roomId: "ROOM001",
                playerId: "player-001",
            },
        },
    ]);
});

test("unsubscribeGameAuthoritativeSnapshotUpdates는 update 구독 해제 이벤트를 전송한다", async () => {
    const fakeSocket = new FakeSocket();
    const { unsubscribeGameAuthoritativeSnapshotUpdates } = await loadRoomClient(fakeSocket);

    unsubscribeGameAuthoritativeSnapshotUpdates("ROOM001", "player-001");

    assert.deepEqual(fakeSocket.emits, [
        {
            eventName: "game:authoritative:snapshot:unsubscribe",
            payload: {
                roomId: "ROOM001",
                playerId: "player-001",
            },
        },
    ]);
});

test("onGameAuthoritativeSnapshotSubscribeResult는 result handler를 등록하고 해제 함수를 반환한다", async () => {
    const fakeSocket = new FakeSocket();
    const { onGameAuthoritativeSnapshotSubscribeResult } = await loadRoomClient(fakeSocket);
    const handler = () => {};

    const detach = onGameAuthoritativeSnapshotSubscribeResult(handler);

    assert.equal(fakeSocket.handlers.get("game:authoritative:snapshot:subscribe:result"), handler);

    detach();

    assert.deepEqual(fakeSocket.removedHandlers, [
        {
            eventName: "game:authoritative:snapshot:subscribe:result",
            handler,
        },
    ]);
    assert.equal(fakeSocket.handlers.has("game:authoritative:snapshot:subscribe:result"), false);
});

test("onGameAuthoritativeSnapshotUnsubscribeResult는 result handler를 등록하고 해제 함수를 반환한다", async () => {
    const fakeSocket = new FakeSocket();
    const { onGameAuthoritativeSnapshotUnsubscribeResult } = await loadRoomClient(fakeSocket);
    const handler = () => {};

    const detach = onGameAuthoritativeSnapshotUnsubscribeResult(handler);

    assert.equal(fakeSocket.handlers.get("game:authoritative:snapshot:unsubscribe:result"), handler);

    detach();

    assert.deepEqual(fakeSocket.removedHandlers, [
        {
            eventName: "game:authoritative:snapshot:unsubscribe:result",
            handler,
        },
    ]);
    assert.equal(fakeSocket.handlers.has("game:authoritative:snapshot:unsubscribe:result"), false);
});
