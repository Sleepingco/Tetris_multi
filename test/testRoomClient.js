const test = require("node:test");
const assert = require("node:assert/strict");

test("mutation buffer를 비우고 disconnect reason과 terminal 여부를 전달한다", async () => {
    const emitted = [];
    const handlers = new Map();
    let connectCount = 0;
    const fakeSocket = {
        connected: true,
        id: "client-socket",
        sendBuffer: [],
        emit(eventName, payload) {
            emitted.push({ eventName, payload });
        },
        on(eventName, handler) {
            handlers.set(eventName, handler);
        },
        off(eventName, handler) {
            if (handlers.get(eventName) === handler) handlers.delete(eventName);
        },
        connect() {
            connectCount += 1;
            this.connected = true;
            handlers.get("connect")?.();
            handlers.get("session:ready")?.({
                version: 1,
                playerId: "00000000-0000-4000-8000-000000000001",
                token: "a".repeat(43),
                nickname: "Player",
                expiresAt: Date.now() + 60_000,
                resumed: false,
            });
        },
        disconnect(reason = "io client disconnect") {
            const wasConnected = this.connected;
            this.connected = false;
            if (wasConnected) handlers.get("disconnect")?.(reason);
        },
    };
    global.io = () => fakeSocket;
    global.sessionStorage = {
        values: new Map([["tetris:nickname", "Player"]]),
        getItem(key) {
            return this.values.get(key) ?? null;
        },
        setItem(key, value) {
            this.values.set(key, value);
        },
        removeItem(key) {
            this.values.delete(key);
        },
    };
    const {
        requestCreateRoom,
        onGameBagResult,
        onSessionReady,
        onSessionError,
        onSessionDisconnected,
        sendGameInput,
        sendPlacementDecisionLogEvent,
    } = await import(
        "../src/client/net/roomClient.ts?test=room-create-difficulty"
    );
    const player = { playerId: "client-player", nickname: "Player" };
    const disconnects = [];
    const sessionErrors = [];
    onSessionDisconnected((disconnect) => disconnects.push(disconnect));
    onSessionError((error) => sessionErrors.push(error));

    let disposedReplayCount = 0;
    const detachDisposedReplay = onSessionReady(() => {
        disposedReplayCount += 1;
    });
    detachDisposedReplay();
    detachDisposedReplay();
    await Promise.resolve();
    assert.equal(disposedReplayCount, 0);

    const rotatedReadySessions = [];
    const detachRotatedReady = onSessionReady((session) => {
        rotatedReadySessions.push(session.nickname);
    });
    handlers.get("connect")?.();
    handlers.get("session:ready")?.({
        version: 1,
        playerId: "00000000-0000-4000-8000-000000000001",
        token: "b".repeat(43),
        nickname: "Rotated",
        expiresAt: Date.now() + 60_000,
        resumed: true,
    });
    await Promise.resolve();
    assert.deepEqual(rotatedReadySessions, ["Rotated"]);
    detachRotatedReady();

    let disconnectedReplayCount = 0;
    const detachDisconnectedReplay = onSessionReady(() => {
        disconnectedReplayCount += 1;
    });
    fakeSocket.disconnect("transport close");
    await Promise.resolve();
    assert.equal(disconnectedReplayCount, 0);
    detachDisconnectedReplay();

    let duplicateErrorCount = 0;
    const duplicateErrorHandler = () => {
        duplicateErrorCount += 1;
    };
    const detachFirstError = onSessionError(duplicateErrorHandler);
    const detachSecondError = onSessionError(duplicateErrorHandler);
    handlers.get("connect_error")?.({});
    assert.equal(duplicateErrorCount, 2);
    detachFirstError();
    detachFirstError();
    handlers.get("connect_error")?.({});
    assert.equal(duplicateErrorCount, 3);
    detachSecondError();
    handlers.get("connect_error")?.({});
    assert.equal(duplicateErrorCount, 3);

    let duplicateDisconnectCount = 0;
    const duplicateDisconnectHandler = () => {
        duplicateDisconnectCount += 1;
    };
    const detachFirstDisconnect = onSessionDisconnected(duplicateDisconnectHandler);
    const detachSecondDisconnect = onSessionDisconnected(duplicateDisconnectHandler);
    handlers.get("disconnect")?.("transport close");
    assert.equal(duplicateDisconnectCount, 2);
    detachFirstDisconnect();
    detachFirstDisconnect();
    handlers.get("disconnect")?.("transport close");
    assert.equal(duplicateDisconnectCount, 3);
    detachSecondDisconnect();
    handlers.get("disconnect")?.("transport close");
    assert.equal(duplicateDisconnectCount, 3);
    fakeSocket.connected = true;
    handlers.get("connect")?.();
    handlers.get("session:ready")?.({
        version: 1,
        playerId: "00000000-0000-4000-8000-000000000001",
        token: "c".repeat(43),
        nickname: "Player",
        expiresAt: Date.now() + 60_000,
        resumed: true,
    });

    requestCreateRoom(player, "pvp", "hard", "placement_v4");
    requestCreateRoom(player, "pve");
    requestCreateRoom(player, "pve", "hard", "placement_v4");

    assert.deepEqual(emitted, [
        {
            eventName: "room:create",
            payload: { mode: "pvp" },
        },
        {
            eventName: "room:create",
            payload: { mode: "pve" },
        },
        {
            eventName: "room:create",
            payload: {
                mode: "pve",
                aiDifficulty: "hard",
                aiPolicy: "placement_v4",
            },
        },
    ]);

    const emittedBeforeDisconnect = emitted.length;
    fakeSocket.sendBuffer.push({ eventName: "game:input" });
    fakeSocket.disconnect("transport close");
    assert.deepEqual(fakeSocket.sendBuffer, []);
    assert.deepEqual(disconnects.at(-1), {
        reason: "transport close",
        terminal: false,
    });
    assert.equal(sendGameInput("room", "player", "hold", 1, 1, 1), false);
    assert.equal(sendPlacementDecisionLogEvent("room", { eventType: "placement_decision" }), false);
    requestCreateRoom(player, "pvp");
    fakeSocket.connect();
    assert.equal(emitted.length, emittedBeforeDisconnect);

    const storedSession = sessionStorage.getItem("tetris:playerSession");
    fakeSocket.disconnect("io server disconnect");
    assert.deepEqual(disconnects.at(-1), {
        reason: "io server disconnect",
        terminal: true,
    });
    assert.equal(sessionStorage.getItem("tetris:playerSession"), storedSession);

    fakeSocket.connected = false;
    handlers.get("connect_error")?.({});
    assert.deepEqual(sessionErrors.at(-1), {
        code: "SESSION_CONNECTION_FAILED",
        terminal: false,
    });
    assert.equal(connectCount, 2);

    handlers.get("connect_error")?.({
        data: { code: "SESSION_INVALID", terminal: true },
    });
    fakeSocket.connected = false;
    handlers.get("connect_error")?.({
        data: { code: "SESSION_INVALID", terminal: true },
    });
    assert.equal(connectCount, 4);

    let bagResultCount = 0;
    const detachBagResult = onGameBagResult(() => {
        bagResultCount += 1;
    });
    handlers.get("game:bag:result")?.({
        ok: false,
        room: null,
        reason: "BAG_QUEUE_SUFFICIENT",
        unknown: true,
    });
    assert.equal(bagResultCount, 0);
    handlers.get("game:bag:result")?.({
        ok: false,
        room: null,
        reason: "BAG_QUEUE_SUFFICIENT",
    });
    assert.equal(bagResultCount, 1);
    detachBagResult();

    const credentialBeforeProtocolError = sessionStorage.getItem("tetris:playerSession");
    const disconnectCountBeforeInvalidSessionReady = disconnects.length;
    handlers.get("session:ready")?.({ version: 1 });
    assert.deepEqual(sessionErrors.at(-1), {
        code: "SESSION_PROTOCOL_ERROR",
        terminal: true,
    });
    assert.equal(disconnects.length, disconnectCountBeforeInvalidSessionReady + 1);
    assert.deepEqual(disconnects.at(-1), {
        reason: "io client disconnect",
        terminal: true,
    });
    assert.equal(sessionStorage.getItem("tetris:playerSession"), credentialBeforeProtocolError);

    const disconnectCountBeforeMalformedConnectError = disconnects.length;
    handlers.get("connect_error")?.({
        data: { code: "SESSION_INVALID", terminal: true, unknown: true },
    });
    assert.deepEqual(sessionErrors.at(-1), {
        code: "SESSION_PROTOCOL_ERROR",
        terminal: true,
    });
    assert.equal(disconnects.length, disconnectCountBeforeMalformedConnectError + 1);
    assert.deepEqual(disconnects.at(-1), {
        reason: "io client disconnect",
        terminal: true,
    });
    assert.equal(sessionStorage.getItem("tetris:playerSession"), credentialBeforeProtocolError);

    delete global.io;
    delete global.sessionStorage;
});
