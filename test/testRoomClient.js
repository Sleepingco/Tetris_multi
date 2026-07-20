const test = require("node:test");
const assert = require("node:assert/strict");

test("requestCreateRoom은 PVE 요청에만 AI 난이도와 정책을 포함한다", async () => {
    const emitted = [];
    const handlers = new Map();
    global.io = () => ({
        connected: true,
        id: "client-socket",
        emit(eventName, payload) {
            emitted.push({ eventName, payload });
        },
        on(eventName, handler) {
            handlers.set(eventName, handler);
        },
        connect() {
            handlers.get("connect")?.();
            handlers.get("session:ready")?.({
                version: 1,
                playerId: "00000000-0000-4000-8000-000000000001",
                token: "a".repeat(43),
                nickname: "Player",
                expiresAt: Date.now() + 60_000,
            });
        },
    });
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
    const { requestCreateRoom } = await import(
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

    delete global.io;
    delete global.sessionStorage;
});
