const test = require("node:test");
const assert = require("node:assert/strict");

test("mutation은 active 연결에서만 전송되고 reconnect buffer에 남지 않는다", async () => {
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
            });
        },
        disconnect() {
            this.connected = false;
            handlers.get("disconnect")?.();
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
        sendGameInput,
        sendPlacementDecisionLogEvent,
    } = await import(
        "../src/client/net/roomClient.js?test=room-create-difficulty"
    );
    const player = { playerId: "client-player", nickname: "Player" };

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
    fakeSocket.disconnect();
    assert.deepEqual(fakeSocket.sendBuffer, []);
    assert.equal(sendGameInput("room", "player", "hold", 1, 1, 1), false);
    assert.equal(sendPlacementDecisionLogEvent("room", { eventType: "placement_decision" }), false);
    requestCreateRoom(player, "pvp");
    fakeSocket.connect();
    assert.equal(emitted.length, emittedBeforeDisconnect);

    fakeSocket.connected = false;
    handlers.get("connect_error")?.({
        data: { code: "SESSION_INVALID", terminal: true },
    });
    fakeSocket.connected = false;
    handlers.get("connect_error")?.({
        data: { code: "SESSION_INVALID", terminal: true },
    });
    assert.equal(connectCount, 4);

    delete global.io;
    delete global.sessionStorage;
});
