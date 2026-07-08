const test = require("node:test");
const assert = require("node:assert/strict");

const {
    appendPlayerBagChunk,
    applyGameplayInputToMatchPlayerState,
    applyInputToMatchPlayerState,
    createMatch,
    recordInput,
    getMatchState,
    resetMatches,
} = require("../src/server/services/matchService.js");
const { loadGameCore } = require("../src/server/services/gameCoreLoader.js");

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
        assert.deepEqual(player.authoritativeState.pieceQueue, player.bagChunks.flat());
    });
});

test("createMatch는 player별 최소 authoritative state를 만든다", () => {
    resetMatches();

    const result = createMatch(createPlayingRoom("STATE001"));
    const [hostPlayer, guestPlayer] = result.match.players;
    const expectedPieceQueue = hostPlayer.bagChunks.flat();

    assert.equal(result.ok, true);
    assert.deepEqual(hostPlayer.authoritativeState, {
        board: Array.from({ length: 20 }, () => Array(10).fill(null)),
        activePiece: {
            pieceType: "",
            rotation: 0,
            row: -1,
            col: 3,
        },
        pendingPiece: null,
        pieceQueue: expectedPieceQueue,
        holdPieceType: null,
        holdUsedThisDrop: false,
        score: 0,
        lines: 0,
        phase: "playing",
        combo: -1,
        backToBack: false,
        currentTick: 0,
        pieceIndex: 0,
        pendingGarbageQueue: [],
    });
    assert.notEqual(hostPlayer.authoritativeState, guestPlayer.authoritativeState);
    assert.notEqual(hostPlayer.authoritativeState.board, guestPlayer.authoritativeState.board);
    assert.notEqual(hostPlayer.authoritativeState.activePiece, guestPlayer.authoritativeState.activePiece);
    assert.notEqual(hostPlayer.authoritativeState.pieceQueue, guestPlayer.authoritativeState.pieceQueue);
    assert.notEqual(hostPlayer.authoritativeState.pendingGarbageQueue, guestPlayer.authoritativeState.pendingGarbageQueue);
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
        pieceIndex: 3,
    });

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.match.players[0].inputLog.length, 1);
    assert.equal(result.match.players[0].inputLog[0].action, "move_left");
    assert.equal(result.match.players[0].inputLog[0].tick, 10);
    assert.equal(result.match.players[0].inputLog[0].pieceIndex, 3);
    assert.equal(typeof result.match.players[0].inputLog[0].receivedAt, "number");
});

test("recordInput은 replay를 위해 playerId와 sequence를 함께 저장한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("REPLAY001"));
    const result = recordInput("REPLAY001", "host-player", {
        action: "rotate",
        tick: 12,
        pieceIndex: 4,
    });
    const replayInput = result.match.players[0].inputLog[0];

    assert.equal(result.ok, true);
    assert.equal(replayInput.playerId, "host-player");
    assert.equal(replayInput.action, "rotate");
    assert.equal(replayInput.tick, 12);
    assert.equal(replayInput.pieceIndex, 4);
    assert.equal(replayInput.sequence, 1);
    assert.equal(typeof replayInput.receivedAt, "number");
});

test("recordInput은 player별 inputLog sequence를 독립적으로 증가시킨다", () => {
    resetMatches();

    createMatch(createPlayingRoom("REPLAY002"));
    recordInput("REPLAY002", "host-player", {
        action: "move_left",
        tick: 20,
        pieceIndex: 5,
    });
    recordInput("REPLAY002", "host-player", {
        action: "move_right",
        tick: 20,
        pieceIndex: 5,
    });
    const result = recordInput("REPLAY002", "guest-player", {
        action: "soft_drop",
        tick: 20,
        pieceIndex: 5,
    });

    const hostPlayer = result.match.players.find(player => player.playerId === "host-player");
    const guestPlayer = result.match.players.find(player => player.playerId === "guest-player");

    assert.deepEqual(hostPlayer.inputLog.map(input => input.sequence), [1, 2]);
    assert.deepEqual(hostPlayer.inputLog.map(input => input.playerId), ["host-player", "host-player"]);
    assert.deepEqual(guestPlayer.inputLog.map(input => input.sequence), [1]);
    assert.deepEqual(guestPlayer.inputLog.map(input => input.playerId), ["guest-player"]);
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
    assert.equal(hostPlayer.authoritativeState.pieceQueue.length, 28);
    assert.equal(result.bagChunk.length, 7);
    assert.deepEqual([...result.bagChunk].sort(), expectedPieces);
    assert.deepEqual(hostPlayer.bagChunks[3], result.bagChunk);
    assert.deepEqual(hostPlayer.authoritativeState.pieceQueue.slice(-7), result.bagChunk);
});

test("applyInputToMatchPlayerState는 특정 player authoritativeState에 input 1개를 적용한다", async () => {
    resetMatches();

    const gameCore = await loadGameCore();
    createMatch(createPlayingRoom("INPUT001"));
    const matchBefore = getMatchState("INPUT001").match;
    const hostPlayer = matchBefore.players.find(player => player.playerId === "host-player");
    hostPlayer.authoritativeState.activePiece = {
        pieceType: "tree",
        rotation: 0,
        row: 0,
        col: 4,
    };

    const result = applyInputToMatchPlayerState("INPUT001", "host-player", {
        action: "move_left",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.inputResult.ok, true);
    assert.equal(result.inputResult.moveIntent.kind, "ok");
    assert.deepEqual(hostPlayer.authoritativeState.activePiece, {
        pieceType: "tree",
        rotation: 0,
        row: 0,
        col: 3,
    });
});

test("applyInputToMatchPlayerState는 없는 match면 실패 결과를 반환한다", () => {
    resetMatches();

    const result = applyInputToMatchPlayerState("MISSING", "host-player", {
        action: "move_left",
    }, null);

    assert.deepEqual(result, {
        ok: false,
        match: null,
        reason: "MATCH_NOT_FOUND",
    });
});

test("applyInputToMatchPlayerState는 match에 없는 player면 실패 결과를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("INPUT002"));
    const result = applyInputToMatchPlayerState("INPUT002", "unknown-player", {
        action: "move_left",
    }, null);

    assert.deepEqual(result, {
        ok: false,
        match: null,
        reason: "PLAYER_NOT_FOUND",
    });
});

test("applyInputToMatchPlayerState는 player authoritativeState가 없으면 실패 결과를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("INPUT003"));
    const matchBefore = getMatchState("INPUT003").match;
    const hostPlayer = matchBefore.players.find(player => player.playerId === "host-player");
    hostPlayer.authoritativeState = null;

    const result = applyInputToMatchPlayerState("INPUT003", "host-player", {
        action: "move_left",
    }, null);

    assert.equal(result.ok, false);
    assert.equal(result.match.roomId, "INPUT003");
    assert.equal(result.reason, "AUTHORITATIVE_STATE_NOT_FOUND");
});

test("applyGameplayInputToMatchPlayerState는 hard_drop을 player authoritativeState에 적용한다", async () => {
    resetMatches();

    const gameCore = await loadGameCore();
    createMatch(createPlayingRoom("GAMEPLAY001"));
    const matchBefore = getMatchState("GAMEPLAY001").match;
    const hostPlayer = matchBefore.players.find(player => player.playerId === "host-player");
    hostPlayer.authoritativeState.activePiece = {
        pieceType: "",
        rotation: 0,
        row: -1,
        col: 3,
    };
    hostPlayer.authoritativeState.pendingPiece = null;
    hostPlayer.authoritativeState.pieceQueue = ["square", "tree"];

    const result = applyGameplayInputToMatchPlayerState("GAMEPLAY001", "host-player", {
        action: "hard_drop",
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.gameplayResult.ok, true);
    assert.equal(result.gameplayResult.placementResult.lockedPiece.pieceType, "square");
    assert.deepEqual(hostPlayer.authoritativeState.activePiece, {
        pieceType: "tree",
        rotation: 0,
        row: -1,
        col: 3,
    });
    assert.deepEqual(hostPlayer.inputLog, []);
});

test("applyGameplayInputToMatchPlayerState는 없는 match면 실패 결과를 반환한다", () => {
    resetMatches();

    const result = applyGameplayInputToMatchPlayerState("MISSING", "host-player", {
        action: "hard_drop",
    }, null);

    assert.deepEqual(result, {
        ok: false,
        match: null,
        reason: "MATCH_NOT_FOUND",
    });
});

test("applyGameplayInputToMatchPlayerState는 match에 없는 player면 실패 결과를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("GAMEPLAY002"));
    const result = applyGameplayInputToMatchPlayerState("GAMEPLAY002", "unknown-player", {
        action: "hard_drop",
    }, null);

    assert.deepEqual(result, {
        ok: false,
        match: null,
        reason: "PLAYER_NOT_FOUND",
    });
});

test("applyGameplayInputToMatchPlayerState는 player authoritativeState가 없으면 실패 결과를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("GAMEPLAY003"));
    const matchBefore = getMatchState("GAMEPLAY003").match;
    const hostPlayer = matchBefore.players.find(player => player.playerId === "host-player");
    hostPlayer.authoritativeState = null;

    const result = applyGameplayInputToMatchPlayerState("GAMEPLAY003", "host-player", {
        action: "hard_drop",
    }, null);

    assert.equal(result.ok, false);
    assert.equal(result.match.roomId, "GAMEPLAY003");
    assert.equal(result.reason, "AUTHORITATIVE_STATE_NOT_FOUND");
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
