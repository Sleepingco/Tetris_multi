const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");

async function loadLobbyStateHelpers() {
    const moduleUrl = pathToFileURL(`${process.cwd()}/src/client/pages/multiLobbyState.js`);
    moduleUrl.searchParams.set("test", `${Date.now()}-${Math.random()}`);

    return import(moduleUrl.href);
}

test("resolveFailedRoomResultEffect는 sync 실패 메시지를 숨기고 room session만 정리하게 한다", async () => {
    const { resolveFailedRoomResultEffect } = await loadLobbyStateHelpers();

    const effect = resolveFailedRoomResultEffect(
        { ok: false, reason: "ROOM_NOT_FOUND" },
        "sync",
    );

    assert.deepEqual(effect, {
        shouldClearRoom: true,
        message: null,
    });
});

test("resolveFailedRoomResultEffect는 join ROOM_NOT_FOUND 실패는 메시지를 보여주고 room session을 정리하게 한다", async () => {
    const { resolveFailedRoomResultEffect } = await loadLobbyStateHelpers();

    const effect = resolveFailedRoomResultEffect(
        { ok: false, reason: "ROOM_NOT_FOUND" },
        "join",
    );

    assert.deepEqual(effect, {
        shouldClearRoom: true,
        message: "ROOM_NOT_FOUND",
    });
});

test("resolveFailedRoomResultEffect는 일반 실패 메시지를 유지한다", async () => {
    const { resolveFailedRoomResultEffect } = await loadLobbyStateHelpers();

    const effect = resolveFailedRoomResultEffect(
        { ok: false, reason: "NOT_AUTHORIZED" },
        "start",
    );

    assert.deepEqual(effect, {
        shouldClearRoom: false,
        message: "NOT_AUTHORIZED",
    });
});

test("shouldResetPlayerSession은 resetPlayer=1 query에서만 true를 반환한다", async () => {
    const { shouldResetPlayerSession } = await loadLobbyStateHelpers();

    assert.equal(shouldResetPlayerSession("?resetPlayer=1"), true);
    assert.equal(shouldResetPlayerSession("?resetPlayer=true"), false);
    assert.equal(shouldResetPlayerSession("?debug=1"), false);
    assert.equal(shouldResetPlayerSession(""), false);
});
