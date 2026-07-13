const test = require("node:test");
const assert = require("node:assert/strict");

test("requestCreateRoom은 PVE 요청에만 AI 난이도를 포함한다", async () => {
    const emitted = [];
    global.io = () => ({
        emit(eventName, payload) {
            emitted.push({ eventName, payload });
        },
        on() {},
    });
    const { requestCreateRoom } = await import(
        "../src/client/net/roomClient.js?test=room-create-difficulty"
    );
    const player = { playerId: "client-player", nickname: "Player" };

    requestCreateRoom(player, "pvp");
    requestCreateRoom(player, "pve");
    requestCreateRoom(player, "pve", "hard");

    assert.deepEqual(emitted, [
        {
            eventName: "room:create",
            payload: { player, mode: "pvp" },
        },
        {
            eventName: "room:create",
            payload: { player, mode: "pve" },
        },
        {
            eventName: "room:create",
            payload: { player, mode: "pve", aiDifficulty: "hard" },
        },
    ]);

    delete global.io;
});
