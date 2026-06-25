const test = require("node:test");
const assert = require("node:assert/strict");

const {
    appendPlayerBagChunk,
    createMatch,
    recordInput,
    getMatchState,
    resetMatches,
} = require("../src/server/services/matchService.js");

function createPlayingRoom(roomId = "ROOM001") {
    return {
        roomId,
        status: "playing",
        players: [
            {
                playerId: "host-player",
                nickname: "Host",
                socketId: "host-socket",
            },
            {
                playerId: "guest-player",
                nickname: "Guest",
                socketId: "guest-socket",
            },
        ],
    };
}

test("createMatch는 room 정보를 기준으로 빈 inputLog를 가진 match를 만든다", () => {
    resetMatches();

    const result = createMatch(createPlayingRoom());

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.match.roomId, "ROOM001");
    assert.equal(result.match.status, "playing");
    assert.equal(result.match.players.length, 2);
    assert.equal(result.match.players[0].playerId, "host-player");
    assert.deepEqual(result.match.players[0].inputLog, []);
    assert.equal(typeof result.match.createdAt, "number");
});

test("createMatch는 player별 server bag chunks를 만든다", () => {
    resetMatches();

    const result = createMatch(createPlayingRoom("BAG001"));
    const expectedPieces = ["bar", "eleft", "eright", "ess", "square", "tree", "zee"];

    assert.equal(result.ok, true);
    assert.equal(result.match.players.length, 2);

    result.match.players.forEach((player) => {
        assert.equal(player.bagChunks.length, 3);

        player.bagChunks.forEach((chunk) => {
            assert.equal(chunk.length, 7);
            assert.deepEqual([...chunk].sort(), expectedPieces);
        });
    });
});

test("getMatchState는 roomId로 생성된 match를 다시 조회한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("ROOM002"));
    const result = getMatchState("ROOM002");

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.match.roomId, "ROOM002");
});

test("recordInput은 player의 inputLog에 action과 tick을 저장한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("ROOM003"));
    const result = recordInput("ROOM003", "host-player", {
        action: "move_left",
        tick: 10,
    });

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.match.players[0].inputLog.length, 1);
    assert.equal(result.match.players[0].inputLog[0].action, "move_left");
    assert.equal(result.match.players[0].inputLog[0].tick, 10);
    assert.equal(typeof result.match.players[0].inputLog[0].receivedAt, "number");
});

test("appendPlayerBagChunk는 player의 bagChunks에 새 server bag chunk를 추가한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("BAG002"));
    const result = appendPlayerBagChunk("BAG002", "host-player");
    const expectedPieces = ["bar", "eleft", "eright", "ess", "square", "tree", "zee"];
    const hostPlayer = result.match.players.find(player => player.playerId === "host-player");

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(hostPlayer.bagChunks.length, 4);
    assert.equal(result.bagChunk.length, 7);
    assert.deepEqual([...result.bagChunk].sort(), expectedPieces);
    assert.deepEqual(hostPlayer.bagChunks[3], result.bagChunk);
});

test("recordInput은 없는 match면 실패 결과를 반환한다", () => {
    resetMatches();

    const result = recordInput("MISSING", "host-player", {
        action: "move_left",
        tick: 10,
    });

    assert.deepEqual(result, {
        ok: false,
        match: null,
        reason: "MATCH_NOT_FOUND",
    });
});

test("recordInput은 match에 없는 player면 실패 결과를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("ROOM004"));
    const result = recordInput("ROOM004", "unknown-player", {
        action: "move_left",
        tick: 10,
    });

    assert.deepEqual(result, {
        ok: false,
        match: null,
        reason: "PLAYER_NOT_FOUND",
    });
});

test("recordInput은 action이 없으면 실패 결과를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("ROOM005"));
    const result = recordInput("ROOM005", "host-player", {
        tick: 10,
    });

    assert.deepEqual(result, {
        ok: false,
        match: null,
        reason: "INVALID_INPUT",
    });
});
