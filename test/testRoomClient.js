const test = require("node:test");
const assert = require("node:assert/strict");

test("requestCreateRoom은 PVE 요청에만 AI 난이도와 정책을 포함한다", async () => {
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

    requestCreateRoom(player, "pvp", "hard", "placement_v4");
    requestCreateRoom(player, "pve");
    requestCreateRoom(player, "pve", "hard", "placement_v4");

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
            payload: {
                player,
                mode: "pve",
                aiDifficulty: "hard",
                aiPolicy: "placement_v4",
            },
        },
    ]);

    delete global.io;
});
