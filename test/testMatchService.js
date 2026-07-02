const test = require("node:test");
const assert = require("node:assert/strict");

const {
    advanceShadowMatch,
    appendPlayerBagChunk,
    createMatch,
    deleteMatch,
    getPlayerAuthoritativeSnapshot,
    recordInput,
    getMatchState,
    getPlayerShadowState,
    recordClientPlacementDecision,
    recordClientSnapshot,
    recordGarbageAttack,
    recordShadowSnapshot,
    resetMatches,
    startShadowMatchLoop,
} = require("../src/server/services/matchService.js");
const {
    AUTHORITATIVE_SNAPSHOT_FIELDS,
} = require("../src/server/validators/gameSnapshotValidator.js");
const {
    createInitialShadowState,
    createShadowSnapshot: createEngineShadowSnapshot,
    stepAuthoritativeState,
} = require("../src/server/services/shadowGameEngine.js");

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

function createShadowSnapshot(overrides = {}) {
    return {
        board: [["tree"]],
        activePiece: { pieceType: "tree", rotation: 0, row: 1, col: 4 },
        score: 100,
        linesClearedTotal: 2,
        phase: "playing",
        pendingGarbageQueue: [],
        tick: 30,
        pieceIndex: 8,
        ...overrides,
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

test("createMatch는 player별 shadow authoritative state를 초기화한다", () => {
    resetMatches();

    const result = createMatch(createPlayingRoom("SHADOW001"));
    const hostPlayer = result.match.players.find(player => player.playerId === "host-player");

    assert.equal(result.ok, true);
    assert.equal(hostPlayer.shadowState.activePiece.pieceType, hostPlayer.bagChunks[0][0]);
    assert.equal(hostPlayer.shadowState.pieceIndex, 1);
    assert.equal(hostPlayer.shadowTick, hostPlayer.shadowState.tick);
    assert.equal(hostPlayer.shadowPieceIndex, hostPlayer.shadowState.pieceIndex);
    assert.deepEqual(hostPlayer.shadowInputLog, []);
    assert.equal(hostPlayer.lastClientSnapshot, null);
    assert.equal(hostPlayer.lastShadowSnapshot.activePiece.pieceType, hostPlayer.shadowState.activePiece.pieceType);
    assert.deepEqual(hostPlayer.desyncLog, []);
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

test("recordInput은 shadowInputLog에도 같은 입력 순서를 저장한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW002"));
    const result = recordInput("SHADOW002", "host-player", {
        action: "rotate",
        tick: 20,
        pieceIndex: 5,
    });
    const hostPlayer = result.match.players.find(player => player.playerId === "host-player");

    assert.equal(result.ok, true);
    assert.equal(hostPlayer.shadowInputLog.length, 1);
    assert.equal(hostPlayer.shadowInputLog[0].playerId, "host-player");
    assert.equal(hostPlayer.shadowInputLog[0].action, "rotate");
    assert.equal(hostPlayer.shadowInputLog[0].tick, 20);
    assert.equal(hostPlayer.shadowInputLog[0].pieceIndex, 5);
    assert.equal(hostPlayer.shadowInputLog[0].sequence, 1);
    assert.equal(typeof hostPlayer.shadowInputLog[0].receivedAt, "number");
});

test("recordInput은 shadowState에 입력을 적용하고 lastShadowSnapshot을 갱신한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_STEP001"));
    const before = getPlayerShadowState("SHADOW_STEP001", "host-player").shadow;
    const result = recordInput("SHADOW_STEP001", "host-player", {
        action: "move_left",
        tick: 1,
        pieceIndex: before.shadowPieceIndex,
    });
    const after = getPlayerShadowState("SHADOW_STEP001", "host-player").shadow;

    assert.equal(result.ok, true);
    assert.equal(after.shadowState.activePiece.col, before.shadowState.activePiece.col - 1);
    assert.equal(after.shadowTick, before.shadowTick);
    assert.equal(after.lastShadowSnapshot.tick, before.shadowTick);
    assert.equal(after.lastShadowSnapshot.lastClientInputTick, 1);
    assert.equal(after.lastShadowSnapshot.lastClientInputPieceIndex, before.shadowPieceIndex);
    assert.equal(after.lastShadowSnapshot.pieceIndex, before.shadowPieceIndex);
});

test("advanceShadowMatch는 모든 player의 shadowState에 gravity tick을 적용한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_LOOP001"));
    const beforeHost = getPlayerShadowState("SHADOW_LOOP001", "host-player").shadow;
    const beforeGuest = getPlayerShadowState("SHADOW_LOOP001", "guest-player").shadow;
    const result = advanceShadowMatch("SHADOW_LOOP001");
    const afterHost = getPlayerShadowState("SHADOW_LOOP001", "host-player").shadow;
    const afterGuest = getPlayerShadowState("SHADOW_LOOP001", "guest-player").shadow;

    assert.equal(result.ok, true);
    assert.equal(afterHost.shadowTick, beforeHost.shadowTick + 1);
    assert.equal(afterGuest.shadowTick, beforeGuest.shadowTick + 1);
    assert.equal(afterHost.shadowState.activePiece.row, beforeHost.shadowState.activePiece.row + 1);
    assert.equal(afterGuest.shadowState.activePiece.row, beforeGuest.shadowState.activePiece.row + 1);
    assert.equal(afterHost.lastShadowSnapshot.tick, afterHost.shadowTick);
    assert.equal(afterGuest.lastShadowSnapshot.tick, afterGuest.shadowTick);
});

test("advanceShadowMatch는 없는 match면 실패 결과를 반환한다", () => {
    resetMatches();

    const result = advanceShadowMatch("MISSING_MATCH");

    assert.deepEqual(result, {
        ok: false,
        match: null,
        reason: "MATCH_NOT_FOUND",
    });
});

test("startShadowMatchLoop은 shadow advance 후 callback으로 match 결과를 전달한다", async () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_LOOP_CALLBACK"));
    const callbackResults = [];

    const result = startShadowMatchLoop("SHADOW_LOOP_CALLBACK", 1, (loopResult) => {
        callbackResults.push(loopResult);
    });

    assert.equal(result.ok, true);

    await new Promise(resolve => setTimeout(resolve, 5));
    resetMatches();

    assert.equal(callbackResults.length > 0, true);
    assert.equal(callbackResults[0].ok, true);
    assert.equal(callbackResults[0].match.roomId, "SHADOW_LOOP_CALLBACK");
});

test("recordClientSnapshot은 client snapshot을 저장한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW003"));
    const snapshot = {
        board: [["tree"]],
        activePiece: { pieceType: "tree", rotation: 0, row: 1, col: 4 },
        score: 100,
        linesClearedTotal: 2,
        phase: "playing",
        fallIntervalMs: 800,
        pendingGarbageQueue: [{ lines: 2, holeCol: 4 }],
        tick: 30,
        pieceIndex: 8,
    };
    const result = recordClientSnapshot("SHADOW003", "host-player", snapshot);

    assert.equal(result.ok, true);
    assert.deepEqual(result.match.players[0].lastClientSnapshot, snapshot);
});

test("recordClientSnapshot은 shadow snapshot과 차이가 있으면 desyncLog를 남긴다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW004"));
    recordShadowSnapshot("SHADOW004", "host-player", {
        board: [["tree"]],
        activePiece: { pieceType: "tree", rotation: 0, row: 1, col: 4 },
        score: 100,
        linesClearedTotal: 2,
        phase: "playing",
        fallIntervalMs: 800,
        pendingGarbageQueue: [{ lines: 2, holeCol: 4 }],
        tick: 30,
        pieceIndex: 8,
    });
    const result = recordClientSnapshot("SHADOW004", "host-player", {
        board: [["tree"]],
        activePiece: { pieceType: "tree", rotation: 0, row: 2, col: 4 },
        score: 120,
        linesClearedTotal: 2,
        phase: "playing",
        fallIntervalMs: 800,
        pendingGarbageQueue: [],
        tick: 31,
        pieceIndex: 9,
    });
    const shadowResult = getPlayerShadowState("SHADOW004", "host-player");

    assert.equal(result.ok, true);
    assert.equal(shadowResult.ok, true);
    assert.equal(shadowResult.shadow.desyncLog.length, 1);
    assert.deepEqual(shadowResult.shadow.desyncLog[0].fields, [
        "pieceIndex",
        "score",
        "pendingGarbageLines",
        "activePiece",
    ]);
    assert.equal(shadowResult.shadow.shadowTick, 30);
    assert.equal(shadowResult.shadow.shadowPieceIndex, 8);
});

test("recordClientSnapshot은 activePiece만 다르면 낮은 위험 desync로 분류한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_CLASSIFY_LOW"));
    recordShadowSnapshot("SHADOW_CLASSIFY_LOW", "host-player", {
        board: [["tree"]],
        activePiece: { pieceType: "tree", rotation: 0, row: 1, col: 4 },
        score: 100,
        linesClearedTotal: 2,
        phase: "playing",
        pendingGarbageQueue: [],
        tick: 30,
        pieceIndex: 8,
    });
    recordClientSnapshot("SHADOW_CLASSIFY_LOW", "host-player", {
        board: [["tree"]],
        activePiece: { pieceType: "tree", rotation: 0, row: 2, col: 4 },
        score: 100,
        linesClearedTotal: 2,
        phase: "playing",
        pendingGarbageQueue: [],
        tick: 31,
        pieceIndex: 8,
    });

    const shadowResult = getPlayerShadowState("SHADOW_CLASSIFY_LOW", "host-player");
    const lastDesync = shadowResult.shadow.desyncLog[0];

    assert.equal(lastDesync.severity, "low");
    assert.equal(lastDesync.primaryReason, "ACTIVE_PIECE_OFFSET");
    assert.equal(shadowResult.shadow.summary.lastDesyncSeverity, "low");
    assert.equal(shadowResult.shadow.summary.lastDesyncReason, "ACTIVE_PIECE_OFFSET");
});

test("recordClientSnapshot은 pieceIndex가 다르면 높은 위험 desync로 분류한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_CLASSIFY_HIGH"));
    recordShadowSnapshot("SHADOW_CLASSIFY_HIGH", "host-player", {
        board: [["tree"]],
        activePiece: { pieceType: "tree", rotation: 0, row: 1, col: 4 },
        score: 100,
        linesClearedTotal: 2,
        phase: "playing",
        pendingGarbageQueue: [],
        tick: 30,
        pieceIndex: 8,
    });
    recordClientSnapshot("SHADOW_CLASSIFY_HIGH", "host-player", {
        board: [["tree"]],
        activePiece: { pieceType: "tree", rotation: 0, row: 1, col: 4 },
        score: 100,
        linesClearedTotal: 2,
        phase: "playing",
        pendingGarbageQueue: [],
        tick: 31,
        pieceIndex: 9,
    });

    const shadowResult = getPlayerShadowState("SHADOW_CLASSIFY_HIGH", "host-player");
    const lastDesync = shadowResult.shadow.desyncLog[0];

    assert.equal(lastDesync.severity, "high");
    assert.equal(lastDesync.primaryReason, "PIECE_INDEX_MISMATCH");
    assert.equal(shadowResult.shadow.summary.lastDesyncSeverity, "high");
    assert.equal(shadowResult.shadow.summary.lastDesyncReason, "PIECE_INDEX_MISMATCH");
});

test("recordClientSnapshot은 gameOver snapshot 차이를 종료 후 정보성 desync로 분류한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_CLASSIFY_POST_GAME"));
    recordShadowSnapshot("SHADOW_CLASSIFY_POST_GAME", "host-player", {
        board: [["tree"]],
        activePiece: { pieceType: "tree", rotation: 0, row: 1, col: 4 },
        score: 100,
        linesClearedTotal: 2,
        phase: "playing",
        pendingGarbageQueue: [],
        tick: 30,
        pieceIndex: 8,
    });
    recordClientSnapshot("SHADOW_CLASSIFY_POST_GAME", "host-player", {
        board: [["tree"]],
        activePiece: { pieceType: "tree", rotation: 0, row: 1, col: 4 },
        score: 100,
        linesClearedTotal: 2,
        phase: "gameOver",
        pendingGarbageQueue: [],
        tick: 31,
        pieceIndex: 8,
    });

    const shadowResult = getPlayerShadowState("SHADOW_CLASSIFY_POST_GAME", "host-player");
    const lastDesync = shadowResult.shadow.desyncLog[0];

    assert.equal(lastDesync.severity, "info");
    assert.equal(lastDesync.primaryReason, "POST_GAME_SNAPSHOT");
    assert.equal(shadowResult.shadow.summary.lastDesyncSeverity, "info");
    assert.equal(shadowResult.shadow.summary.lastDesyncReason, "POST_GAME_SNAPSHOT");
});

test("recordClientSnapshot은 lineClearing snapshot 차이를 애니메이션 중 정보성 desync로 분류한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_CLASSIFY_LINE_CLEARING"));
    recordShadowSnapshot("SHADOW_CLASSIFY_LINE_CLEARING", "host-player", createShadowSnapshot({
        phase: "playing",
        score: 140,
        linesClearedTotal: 4,
        tick: 40,
        pieceIndex: 9,
    }));
    recordClientSnapshot("SHADOW_CLASSIFY_LINE_CLEARING", "host-player", createShadowSnapshot({
        phase: "lineClearing",
        score: 100,
        linesClearedTotal: 0,
        tick: 38,
        pieceIndex: 8,
    }));

    const shadowResult = getPlayerShadowState("SHADOW_CLASSIFY_LINE_CLEARING", "host-player");
    const lastDesync = shadowResult.shadow.desyncLog[0];

    assert.equal(lastDesync.severity, "info");
    assert.equal(lastDesync.primaryReason, "LINE_CLEAR_ANIMATION_SNAPSHOT");
    assert.equal(shadowResult.shadow.summary.actionableDesyncCount, 0);
    assert.equal(shadowResult.shadow.summary.lastActionableDesync, null);
    assert.equal(shadowResult.shadow.summary.lastDesyncSeverity, "info");
    assert.equal(shadowResult.shadow.summary.lastDesyncReason, "LINE_CLEAR_ANIMATION_SNAPSHOT");
});

test("recordClientSnapshot은 score와 activePiece가 함께 다르면 별도 desync로 분류한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_CLASSIFY_SCORE_ACTIVE"));
    recordShadowSnapshot("SHADOW_CLASSIFY_SCORE_ACTIVE", "host-player", createShadowSnapshot());
    recordClientSnapshot("SHADOW_CLASSIFY_SCORE_ACTIVE", "host-player", createShadowSnapshot({
        activePiece: { pieceType: "tree", rotation: 0, row: 2, col: 4 },
        score: 120,
        tick: 31,
    }));

    const shadowResult = getPlayerShadowState("SHADOW_CLASSIFY_SCORE_ACTIVE", "host-player");
    const lastDesync = shadowResult.shadow.desyncLog[0];

    assert.deepEqual(lastDesync.fields, ["score", "activePiece"]);
    assert.equal(lastDesync.severity, "medium");
    assert.equal(lastDesync.primaryReason, "SCORE_AND_ACTIVE_PIECE_MISMATCH");
    assert.deepEqual(lastDesync.details.score, {
        client: 120,
        shadow: 100,
        delta: 20,
    });
    assert.deepEqual(lastDesync.details.activePiece, {
        client: { pieceType: "tree", rotation: 0, row: 2, col: 4 },
        shadow: { pieceType: "tree", rotation: 0, row: 1, col: 4 },
    });
    assert.equal(shadowResult.shadow.summary.lastDesyncReason, "SCORE_AND_ACTIVE_PIECE_MISMATCH");
});

test("recordClientSnapshot은 score만 다르면 score desync로 분류한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_CLASSIFY_SCORE"));
    recordShadowSnapshot("SHADOW_CLASSIFY_SCORE", "host-player", createShadowSnapshot());
    recordClientSnapshot("SHADOW_CLASSIFY_SCORE", "host-player", createShadowSnapshot({
        score: 120,
        tick: 31,
    }));

    const shadowResult = getPlayerShadowState("SHADOW_CLASSIFY_SCORE", "host-player");
    const lastDesync = shadowResult.shadow.desyncLog[0];

    assert.deepEqual(lastDesync.fields, ["score"]);
    assert.equal(lastDesync.severity, "medium");
    assert.equal(lastDesync.primaryReason, "SCORE_MISMATCH");
});

test("recordClientSnapshot은 line clear 누적값이 다르면 line clear desync로 분류한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_CLASSIFY_LINES"));
    recordShadowSnapshot("SHADOW_CLASSIFY_LINES", "host-player", createShadowSnapshot());
    recordClientSnapshot("SHADOW_CLASSIFY_LINES", "host-player", createShadowSnapshot({
        linesClearedTotal: 3,
        tick: 31,
    }));

    const shadowResult = getPlayerShadowState("SHADOW_CLASSIFY_LINES", "host-player");
    const lastDesync = shadowResult.shadow.desyncLog[0];

    assert.deepEqual(lastDesync.fields, ["linesClearedTotal"]);
    assert.equal(lastDesync.severity, "medium");
    assert.equal(lastDesync.primaryReason, "LINE_CLEAR_MISMATCH");
    assert.deepEqual(lastDesync.details.linesClearedTotal, {
        client: 3,
        shadow: 2,
        delta: 1,
    });
});

test("recordClientSnapshot은 fall interval이 다르면 fall interval desync로 분류한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_CLASSIFY_FALL_INTERVAL"));
    recordShadowSnapshot("SHADOW_CLASSIFY_FALL_INTERVAL", "host-player", createShadowSnapshot({
        fallIntervalMs: 800,
    }));
    recordClientSnapshot("SHADOW_CLASSIFY_FALL_INTERVAL", "host-player", createShadowSnapshot({
        fallIntervalMs: 700,
        tick: 31,
    }));

    const shadowResult = getPlayerShadowState("SHADOW_CLASSIFY_FALL_INTERVAL", "host-player");
    const lastDesync = shadowResult.shadow.desyncLog[0];

    assert.deepEqual(lastDesync.fields, ["fallIntervalMs"]);
    assert.equal(lastDesync.severity, "medium");
    assert.equal(lastDesync.primaryReason, "FALL_INTERVAL_MISMATCH");
    assert.deepEqual(lastDesync.details.fallIntervalMs, {
        client: 700,
        shadow: 800,
        delta: -100,
    });
});

test("recordClientSnapshot은 combo와 back-to-back이 다르면 attack state desync로 분류한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_CLASSIFY_ATTACK_STATE"));
    recordShadowSnapshot("SHADOW_CLASSIFY_ATTACK_STATE", "host-player", createShadowSnapshot({
        combo: 1,
        backToBack: true,
    }));
    recordClientSnapshot("SHADOW_CLASSIFY_ATTACK_STATE", "host-player", createShadowSnapshot({
        combo: 2,
        backToBack: false,
        tick: 31,
    }));

    const shadowResult = getPlayerShadowState("SHADOW_CLASSIFY_ATTACK_STATE", "host-player");
    const lastDesync = shadowResult.shadow.desyncLog[0];

    assert.deepEqual(lastDesync.fields, ["combo", "backToBack"]);
    assert.equal(lastDesync.severity, "medium");
    assert.equal(lastDesync.primaryReason, "ATTACK_STATE_MISMATCH");
    assert.deepEqual(lastDesync.details.combo, {
        client: 2,
        shadow: 1,
        delta: 1,
    });
    assert.deepEqual(lastDesync.details.backToBack, {
        client: false,
        shadow: true,
    });
    assert.equal(shadowResult.shadow.summary.nextInvestigationHint, "CHECK_ATTACK_STATE_FLOW");
});

test("recordClientSnapshot은 pending garbage 총량이 다르면 garbage desync로 분류한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_CLASSIFY_GARBAGE"));
    recordShadowSnapshot("SHADOW_CLASSIFY_GARBAGE", "host-player", createShadowSnapshot({
        pendingGarbageQueue: [{ lines: 2, holeCol: 4 }],
    }));
    recordClientSnapshot("SHADOW_CLASSIFY_GARBAGE", "host-player", createShadowSnapshot({
        pendingGarbageQueue: [],
        tick: 31,
    }));

    const shadowResult = getPlayerShadowState("SHADOW_CLASSIFY_GARBAGE", "host-player");
    const lastDesync = shadowResult.shadow.desyncLog[0];

    assert.deepEqual(lastDesync.fields, ["pendingGarbageLines"]);
    assert.equal(lastDesync.severity, "medium");
    assert.equal(lastDesync.primaryReason, "GARBAGE_MISMATCH");
    assert.deepEqual(lastDesync.details.pendingGarbageLines, {
        client: 0,
        shadow: 2,
        delta: -2,
    });
});

test("recordClientSnapshot은 pieceQueue가 다르면 next queue desync로 분류한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_CLASSIFY_QUEUE"));
    recordShadowSnapshot("SHADOW_CLASSIFY_QUEUE", "host-player", createShadowSnapshot({
        pieceQueue: ["bar", "tree"],
    }));
    recordClientSnapshot("SHADOW_CLASSIFY_QUEUE", "host-player", createShadowSnapshot({
        pieceQueue: ["square", "tree"],
        tick: 31,
    }));

    const shadowResult = getPlayerShadowState("SHADOW_CLASSIFY_QUEUE", "host-player");
    const lastDesync = shadowResult.shadow.desyncLog[0];

    assert.deepEqual(lastDesync.fields, ["pieceQueue"]);
    assert.equal(lastDesync.severity, "high");
    assert.equal(lastDesync.primaryReason, "PIECE_QUEUE_MISMATCH");
    assert.deepEqual(lastDesync.details.pieceQueue, {
        client: ["square", "tree"],
        shadow: ["bar", "tree"],
    });
});

test("recordClientSnapshot은 hold 상태가 다르면 hold state desync로 분류한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_CLASSIFY_HOLD"));
    recordShadowSnapshot("SHADOW_CLASSIFY_HOLD", "host-player", createShadowSnapshot({
        holdPieceType: "bar",
        holdUsedThisDrop: true,
    }));
    recordClientSnapshot("SHADOW_CLASSIFY_HOLD", "host-player", createShadowSnapshot({
        holdPieceType: "tree",
        holdUsedThisDrop: false,
        tick: 31,
    }));

    const shadowResult = getPlayerShadowState("SHADOW_CLASSIFY_HOLD", "host-player");
    const lastDesync = shadowResult.shadow.desyncLog[0];

    assert.deepEqual(lastDesync.fields, ["holdPieceType", "holdUsedThisDrop"]);
    assert.equal(lastDesync.severity, "high");
    assert.equal(lastDesync.primaryReason, "HOLD_STATE_MISMATCH");
    assert.deepEqual(lastDesync.details.holdPieceType, {
        client: "tree",
        shadow: "bar",
    });
    assert.deepEqual(lastDesync.details.holdUsedThisDrop, {
        client: false,
        shadow: true,
    });
});

test("getPlayerShadowState는 콘솔 확인용 summary를 함께 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_SUMMARY001"));
    recordShadowSnapshot("SHADOW_SUMMARY001", "host-player", {
        board: [["tree"]],
        activePiece: { pieceType: "tree", rotation: 0, row: 1, col: 4 },
        score: 100,
        linesClearedTotal: 2,
        phase: "playing",
        fallIntervalMs: 800,
        lastPlacementResult: {
            linesCleared: 4,
            rawAttackLines: 4,
            attackLines: 2,
            canceledGarbageLines: 2,
            incomingGarbageLines: 2,
            appliedGarbageLines: 0,
            gameOver: false,
        },
        pendingGarbageQueue: [{ lines: 2, holeCol: 4 }],
        tick: 30,
        pieceIndex: 8,
    });
    recordClientSnapshot("SHADOW_SUMMARY001", "host-player", {
        board: [["tree"]],
        activePiece: { pieceType: "tree", rotation: 0, row: 2, col: 4 },
        score: 120,
        linesClearedTotal: 2,
        phase: "playing",
        fallIntervalMs: 700,
        pendingGarbageQueue: [],
        tick: 31,
        pieceIndex: 9,
    });

    const shadowResult = getPlayerShadowState("SHADOW_SUMMARY001", "host-player");

    assert.equal(shadowResult.ok, true);
    assert.deepEqual(shadowResult.shadow.summary, {
        roomId: "SHADOW_SUMMARY001",
        playerId: "host-player",
        shadowTick: 30,
        shadowPieceIndex: 8,
        phase: "playing",
        score: 100,
        linesClearedTotal: 2,
        pendingGarbageLines: 2,
        activePiece: { pieceType: "tree", rotation: 0, row: 1, col: 4 },
        lastShadowPlacementLinesCleared: 4,
        lastShadowPlacementRawAttackLines: 4,
        lastShadowPlacementAttackLines: 2,
        lastShadowPlacementCanceledGarbageLines: 2,
        lastShadowPlacementIncomingGarbageLines: 2,
        lastShadowPlacementAppliedGarbageLines: 0,
        lastShadowPlacementScoreBefore: null,
        lastShadowPlacementScoreAfter: null,
        lastShadowPlacementScoreDelta: null,
        lastShadowPlacementGameOver: false,
        lastPlacementResultMismatch: null,
        lastPlacementResultMismatchFields: null,
        placementResultMismatchCount: 0,
        placementResultHealth: "stable",
        placementResultMismatchFieldCounts: {},
        dominantPlacementResultMismatchField: null,
        dominantPlacementResultMismatchFieldCount: 0,
        recentPlacementResultMismatchCount: 0,
        recentPlacementResultHealth: "stable",
        recentPlacementResultMismatchFieldCounts: {},
        recentDominantPlacementResultMismatchField: null,
        recentDominantPlacementResultMismatchFieldCount: 0,
        lastPlacementComparisonTickDelta: null,
        lastPlacementComparisonPieceIndexDelta: null,
        lastPlacementComparisonPieceAlignment: null,
        recentSamePiecePlacementMismatchCount: 0,
        recentOutOfOrderPlacementMismatchCount: 0,
        recentUnknownPiecePlacementMismatchCount: 0,
        recentPlacementInvestigationHintCounts: {},
        recentDominantPlacementInvestigationHint: null,
        recentDominantPlacementInvestigationHintCount: 0,
        recentMaxAbsolutePlacementTickDelta: 0,
        recentMaxAbsolutePlacementPieceIndexDelta: 0,
        recentPlacementDriftLevel: "none",
        recentPlacementAttentionLevel: "stable",
        lastSkippedShadowLineClearComplete: null,
        lastSkippedShadowLineClearCompleteReason: null,
        lastClientPlacementAttackLines: null,
        lastPlacementAttackLinesDelta: null,
        lastClientPlacementCanceledGarbageLines: null,
        lastPlacementCanceledGarbageLinesDelta: null,
        lastClientPlacementScoreBefore: null,
        lastPlacementScoreBeforeDelta: null,
        lastClientPlacementScoreAfter: null,
        lastPlacementScoreAfterDelta: null,
        lastClientPlacementScoreDelta: null,
        lastPlacementScoreDeltaDelta: null,
        shadowHealth: "needs_attention",
        recentShadowHealth: "needs_attention",
        overallShadowHealth: "needs_attention",
        recentOverallShadowHealth: "needs_attention",
        desyncCount: 1,
        desyncReasonCounts: {
            PIECE_INDEX_MISMATCH: 1,
        },
        dominantDesyncReason: "PIECE_INDEX_MISMATCH",
        dominantDesyncCount: 1,
        recentDesyncCount: 1,
        recentDesyncReasonCounts: {
            PIECE_INDEX_MISMATCH: 1,
        },
        recentDominantDesyncReason: "PIECE_INDEX_MISMATCH",
        recentDominantDesyncCount: 1,
        lastDesyncTickDelta: 1,
        maxAbsoluteDesyncTickDelta: 1,
        lastDesyncPieceIndexDelta: 1,
        maxAbsoluteDesyncPieceIndexDelta: 1,
        actionableDesyncCount: 1,
        actionableDesyncReasonCounts: {
            PIECE_INDEX_MISMATCH: 1,
        },
        actionableDesyncFieldCounts: {
            pieceIndex: 1,
            fallIntervalMs: 1,
            score: 1,
            pendingGarbageLines: 1,
            activePiece: 1,
        },
        dominantActionableDesyncReason: "PIECE_INDEX_MISMATCH",
        dominantActionableDesyncCount: 1,
        dominantActionableDesyncField: "pieceIndex",
        dominantActionableDesyncFieldCount: 1,
        recentActionableDesyncCount: 1,
        recentActionableDesyncReasonCounts: {
            PIECE_INDEX_MISMATCH: 1,
        },
        recentActionableDesyncFieldCounts: {
            pieceIndex: 1,
            fallIntervalMs: 1,
            score: 1,
            pendingGarbageLines: 1,
            activePiece: 1,
        },
        recentDominantActionableDesyncReason: "PIECE_INDEX_MISMATCH",
        recentDominantActionableDesyncCount: 1,
        recentDominantActionableDesyncField: "pieceIndex",
        recentDominantActionableDesyncFieldCount: 1,
        lastShadowInputAction: null,
        lastShadowInputTick: null,
        lastShadowInputPieceIndex: null,
        lastShadowInputSequence: null,
        lastShadowInputToShadowTickDelta: null,
        lastShadowInputToClientSnapshotTickDelta: null,
        lastClientSnapshotTick: 31,
        lastShadowSnapshotTick: 30,
        lastClientSnapshotToShadowTickDelta: 1,
        lastClientSnapshotPieceIndex: 9,
        lastShadowSnapshotPieceIndex: 8,
        lastClientSnapshotToShadowPieceIndexDelta: 1,
        lastClientSnapshotToShadowPieceIndexDirection: "client_ahead",
        lastClientSnapshotPhase: "playing",
        lastShadowSnapshotPhase: "playing",
        lastClientSnapshotPhaseMismatch: false,
        lastClientSnapshotFallIntervalMs: 700,
        lastShadowSnapshotFallIntervalMs: 800,
        lastClientSnapshotToShadowFallIntervalDelta: -100,
        lastClientSnapshotCombo: null,
        lastShadowSnapshotCombo: null,
        lastClientSnapshotToShadowComboDelta: null,
        lastClientSnapshotBackToBack: null,
        lastShadowSnapshotBackToBack: null,
        lastClientSnapshotBackToBackMismatch: null,
        lastClientSnapshotPieceQueue: null,
        lastShadowSnapshotPieceQueue: null,
        lastClientSnapshotHoldPieceType: null,
        lastShadowSnapshotHoldPieceType: null,
        lastClientSnapshotHoldUsedThisDrop: null,
        lastShadowSnapshotHoldUsedThisDrop: null,
        lastClientSnapshotBoardChecksum: shadowResult.shadow.summary.lastClientSnapshotBoardChecksum,
        lastShadowSnapshotBoardChecksum: shadowResult.shadow.summary.lastShadowSnapshotBoardChecksum,
        lastClientSnapshotBoardMismatch: false,
        lastClientSnapshotBoardDiffCellCount: 0,
        lastClientSnapshotFirstBoardDiff: null,
        lastClientSnapshotActivePieceTypeChanged: false,
        lastClientSnapshotActivePieceRotationDelta: 0,
        lastClientSnapshotActivePieceRowDelta: 1,
        lastClientSnapshotActivePieceColDelta: 0,
        lastActionableDesync: shadowResult.shadow.desyncLog[0],
        lastActionableDesyncSeverity: "high",
        lastActionableDesyncReason: "PIECE_INDEX_MISMATCH",
        lastActionableDesyncFields: [
            "pieceIndex",
            "fallIntervalMs",
            "score",
            "pendingGarbageLines",
            "activePiece",
        ],
        nextInvestigationHint: "CHECK_LOCK_SPAWN_TIMING",
        lastActionableDesyncTickDelta: 1,
        lastActionableDesyncPieceIndexDelta: 1,
        lastDesync: shadowResult.shadow.desyncLog[0],
        lastDesyncSeverity: "high",
        lastDesyncReason: "PIECE_INDEX_MISMATCH",
        lastDesyncFields: [
            "pieceIndex",
            "fallIntervalMs",
            "score",
            "pendingGarbageLines",
            "activePiece",
        ],
    });
});

test("getPlayerShadowState는 마지막 shadow snapshot을 authoritative 기준 DTO로 함께 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_AUTHORITATIVE_DTO"));
    recordShadowSnapshot("SHADOW_AUTHORITATIVE_DTO", "host-player", createShadowSnapshot({
        pieceQueue: ["bar", "tree"],
        holdPieceType: "square",
        holdUsedThisDrop: true,
        isTSpin: true,
        lastActionWasRotation: true,
        lastClientInputTick: 29,
        lastClientInputPieceIndex: 7,
    }));

    const shadowResult = getPlayerShadowState("SHADOW_AUTHORITATIVE_DTO", "host-player");
    const { lastAuthoritativeSnapshot, lastShadowSnapshot } = shadowResult.shadow;

    assert.deepEqual(Object.keys(lastAuthoritativeSnapshot), AUTHORITATIVE_SNAPSHOT_FIELDS);
    assert.equal(lastAuthoritativeSnapshot.isTSpin, undefined);
    assert.equal(lastAuthoritativeSnapshot.lastActionWasRotation, undefined);
    assert.equal(lastAuthoritativeSnapshot.lastClientInputTick, undefined);
    assert.equal(lastAuthoritativeSnapshot.lastClientInputPieceIndex, undefined);
    assert.deepEqual(lastAuthoritativeSnapshot.board, lastShadowSnapshot.board);
    assert.deepEqual(lastAuthoritativeSnapshot.activePiece, lastShadowSnapshot.activePiece);
    assert.notEqual(lastAuthoritativeSnapshot.board, lastShadowSnapshot.board);
    assert.notEqual(lastAuthoritativeSnapshot.activePiece, lastShadowSnapshot.activePiece);
});

test("getPlayerAuthoritativeSnapshot은 마지막 shadow snapshot의 authoritative DTO를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("AUTHORITATIVE_SNAPSHOT_SERVICE"));
    recordShadowSnapshot("AUTHORITATIVE_SNAPSHOT_SERVICE", "host-player", createShadowSnapshot({
        pieceQueue: ["bar", "tree"],
        holdPieceType: "square",
        holdUsedThisDrop: true,
        isTSpin: true,
        lastActionWasRotation: true,
        lastClientInputTick: 29,
        lastClientInputPieceIndex: 7,
    }));

    const result = getPlayerAuthoritativeSnapshot("AUTHORITATIVE_SNAPSHOT_SERVICE", "host-player");

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.roomId, "AUTHORITATIVE_SNAPSHOT_SERVICE");
    assert.equal(result.playerId, "host-player");
    assert.equal(result.source, "server_shadow");
    assert.equal(typeof result.createdAt, "number");
    assert.deepEqual(Object.keys(result.snapshot), AUTHORITATIVE_SNAPSHOT_FIELDS);
    assert.equal(result.snapshot.isTSpin, undefined);
    assert.equal(result.snapshot.lastActionWasRotation, undefined);
    assert.equal(result.snapshot.lastClientInputTick, undefined);
    assert.equal(result.snapshot.lastClientInputPieceIndex, undefined);
    assert.deepEqual(result.snapshot.pieceQueue, ["bar", "tree"]);
    assert.equal(result.snapshot.holdPieceType, "square");
    assert.equal(result.snapshot.holdUsedThisDrop, true);
});

test("getPlayerAuthoritativeSnapshot은 match에 없는 player면 실패 결과를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("AUTHORITATIVE_SNAPSHOT_AUTH"));

    const result = getPlayerAuthoritativeSnapshot("AUTHORITATIVE_SNAPSHOT_AUTH", "unknown-player");

    assert.equal(result.ok, false);
    assert.equal(result.snapshot, null);
    assert.equal(result.roomId, "AUTHORITATIVE_SNAPSHOT_AUTH");
    assert.equal(result.playerId, "unknown-player");
    assert.equal(result.source, "server_shadow");
    assert.equal(typeof result.createdAt, "number");
    assert.equal(result.reason, "PLAYER_NOT_FOUND");
});

test("getPlayerShadowState summary는 마지막 client와 shadow의 queue/hold 상태를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_QUEUE_HOLD_SUMMARY"));
    recordShadowSnapshot("SHADOW_QUEUE_HOLD_SUMMARY", "host-player", createShadowSnapshot({
        pieceQueue: ["bar", "tree"],
        holdPieceType: "square",
        holdUsedThisDrop: true,
    }));
    recordClientSnapshot("SHADOW_QUEUE_HOLD_SUMMARY", "host-player", createShadowSnapshot({
        pieceQueue: ["zee", "tree"],
        holdPieceType: "bar",
        holdUsedThisDrop: false,
        tick: 31,
    }));

    const shadowResult = getPlayerShadowState("SHADOW_QUEUE_HOLD_SUMMARY", "host-player");
    const { summary } = shadowResult.shadow;

    assert.deepEqual(summary.lastClientSnapshotPieceQueue, ["zee", "tree"]);
    assert.deepEqual(summary.lastShadowSnapshotPieceQueue, ["bar", "tree"]);
    assert.equal(summary.lastClientSnapshotHoldPieceType, "bar");
    assert.equal(summary.lastShadowSnapshotHoldPieceType, "square");
    assert.equal(summary.lastClientSnapshotHoldUsedThisDrop, false);
    assert.equal(summary.lastShadowSnapshotHoldUsedThisDrop, true);
});

test("getPlayerShadowState summary는 마지막 client와 shadow의 activePiece 차이를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_ACTIVE_PIECE_DIFF"));
    recordShadowSnapshot("SHADOW_ACTIVE_PIECE_DIFF", "host-player", createShadowSnapshot({
        activePiece: { pieceType: "bar", rotation: 1, row: 4, col: 3 },
    }));
    recordClientSnapshot("SHADOW_ACTIVE_PIECE_DIFF", "host-player", createShadowSnapshot({
        activePiece: { pieceType: "tree", rotation: 3, row: 6, col: 1 },
        tick: 31,
    }));

    const shadowResult = getPlayerShadowState("SHADOW_ACTIVE_PIECE_DIFF", "host-player");
    const { summary } = shadowResult.shadow;

    assert.equal(summary.lastClientSnapshotActivePieceTypeChanged, true);
    assert.equal(summary.lastClientSnapshotActivePieceRotationDelta, 2);
    assert.equal(summary.lastClientSnapshotActivePieceRowDelta, 2);
    assert.equal(summary.lastClientSnapshotActivePieceColDelta, -2);
});

test("getPlayerShadowState summary는 desync 원인별 다음 조사 힌트를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_INVESTIGATION_HINT"));
    recordShadowSnapshot("SHADOW_INVESTIGATION_HINT", "host-player", createShadowSnapshot({
        pieceQueue: ["bar", "tree"],
    }));
    recordClientSnapshot("SHADOW_INVESTIGATION_HINT", "host-player", createShadowSnapshot({
        pieceQueue: ["zee", "tree"],
        tick: 31,
    }));

    const queueResult = getPlayerShadowState("SHADOW_INVESTIGATION_HINT", "host-player");
    assert.equal(queueResult.shadow.summary.nextInvestigationHint, "CHECK_QUEUE_FLOW");

    recordShadowSnapshot("SHADOW_INVESTIGATION_HINT", "host-player", createShadowSnapshot({
        holdPieceType: "bar",
        holdUsedThisDrop: false,
        pieceIndex: 2,
    }));
    recordClientSnapshot("SHADOW_INVESTIGATION_HINT", "host-player", createShadowSnapshot({
        holdPieceType: "tree",
        holdUsedThisDrop: true,
        pieceIndex: 2,
        tick: 32,
    }));

    const holdResult = getPlayerShadowState("SHADOW_INVESTIGATION_HINT", "host-player");
    assert.equal(holdResult.shadow.summary.nextInvestigationHint, "CHECK_HOLD_FLOW");

    recordShadowSnapshot("SHADOW_INVESTIGATION_HINT", "host-player", createShadowSnapshot({
        board: [["bar"]],
        pieceQueue: ["bar", "tree"],
        holdPieceType: "bar",
        holdUsedThisDrop: false,
        pieceIndex: 3,
    }));
    recordClientSnapshot("SHADOW_INVESTIGATION_HINT", "host-player", createShadowSnapshot({
        board: [["tree"]],
        pieceQueue: ["bar", "tree"],
        holdPieceType: "bar",
        holdUsedThisDrop: false,
        pieceIndex: 3,
        tick: 33,
    }));

    const boardResult = getPlayerShadowState("SHADOW_INVESTIGATION_HINT", "host-player");
    assert.equal(boardResult.shadow.summary.nextInvestigationHint, "CHECK_BOARD_LINE_CLEAR_GARBAGE_FLOW");
});

test("getPlayerShadowState summary는 activePiece 차이에 따라 다음 조사 힌트를 세분화한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_ACTIVE_PIECE_HINT"));
    recordShadowSnapshot("SHADOW_ACTIVE_PIECE_HINT", "host-player", createShadowSnapshot({
        activePiece: { pieceType: "tree", rotation: 0, row: 4, col: 3 },
    }));
    recordClientSnapshot("SHADOW_ACTIVE_PIECE_HINT", "host-player", createShadowSnapshot({
        activePiece: { pieceType: "tree", rotation: 0, row: 6, col: 3 },
        tick: 31,
    }));

    const positionResult = getPlayerShadowState("SHADOW_ACTIVE_PIECE_HINT", "host-player");
    assert.equal(
        positionResult.shadow.summary.nextInvestigationHint,
        "CHECK_INPUT_GRAVITY_POSITION_ORDER",
    );

    recordShadowSnapshot("SHADOW_ACTIVE_PIECE_HINT", "host-player", createShadowSnapshot({
        activePiece: { pieceType: "tree", rotation: 0, row: 4, col: 3 },
        tick: 32,
    }));
    recordClientSnapshot("SHADOW_ACTIVE_PIECE_HINT", "host-player", createShadowSnapshot({
        activePiece: { pieceType: "tree", rotation: 1, row: 4, col: 3 },
        tick: 32,
    }));

    const rotationResult = getPlayerShadowState("SHADOW_ACTIVE_PIECE_HINT", "host-player");
    assert.equal(
        rotationResult.shadow.summary.nextInvestigationHint,
        "CHECK_ROTATION_WALL_KICK_FLOW",
    );

    recordShadowSnapshot("SHADOW_ACTIVE_PIECE_HINT", "host-player", createShadowSnapshot({
        activePiece: { pieceType: "bar", rotation: 0, row: 4, col: 3 },
        tick: 33,
    }));
    recordClientSnapshot("SHADOW_ACTIVE_PIECE_HINT", "host-player", createShadowSnapshot({
        activePiece: { pieceType: "tree", rotation: 0, row: 4, col: 3 },
        tick: 33,
    }));

    const typeResult = getPlayerShadowState("SHADOW_ACTIVE_PIECE_HINT", "host-player");
    assert.equal(
        typeResult.shadow.summary.nextInvestigationHint,
        "CHECK_QUEUE_HOLD_SPAWN_FLOW",
    );
});

test("getPlayerShadowState summary는 최근 desync window 기준 health를 따로 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_RECENT_WINDOW"));
    recordShadowSnapshot("SHADOW_RECENT_WINDOW", "host-player", createShadowSnapshot());

    for (let i = 0; i < 3; i++) {
        recordClientSnapshot("SHADOW_RECENT_WINDOW", "host-player", createShadowSnapshot({
            score: 120 + i,
            tick: 31 + i,
        }));
    }

    for (let i = 0; i < 10; i++) {
        recordClientSnapshot("SHADOW_RECENT_WINDOW", "host-player", createShadowSnapshot({
            phase: "lineClearing",
            tick: 40 + i,
        }));
    }

    const shadowResult = getPlayerShadowState("SHADOW_RECENT_WINDOW", "host-player");
    const { summary } = shadowResult.shadow;

    assert.equal(summary.shadowHealth, "needs_attention");
    assert.equal(summary.desyncCount, 13);
    assert.equal(summary.actionableDesyncCount, 3);
    assert.equal(summary.recentShadowHealth, "info_only");
    assert.equal(summary.recentDesyncCount, 10);
    assert.equal(summary.recentActionableDesyncCount, 0);
    assert.deepEqual(summary.recentDesyncReasonCounts, {
        LINE_CLEAR_ANIMATION_SNAPSHOT: 10,
    });
    assert.equal(summary.recentDominantDesyncReason, "LINE_CLEAR_ANIMATION_SNAPSHOT");
    assert.equal(summary.recentDominantDesyncCount, 10);
    assert.deepEqual(summary.recentActionableDesyncReasonCounts, {});
    assert.deepEqual(summary.recentActionableDesyncFieldCounts, {});
    assert.equal(summary.recentDominantActionableDesyncReason, null);
    assert.equal(summary.recentDominantActionableDesyncCount, 0);
    assert.equal(summary.recentDominantActionableDesyncField, null);
    assert.equal(summary.recentDominantActionableDesyncFieldCount, 0);
});

test("getPlayerShadowState summary는 desync reason별 횟수를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_REASON_COUNTS"));
    recordShadowSnapshot("SHADOW_REASON_COUNTS", "host-player", {
        board: [["tree"]],
        activePiece: { pieceType: "tree", rotation: 0, row: 1, col: 4 },
        score: 100,
        linesClearedTotal: 2,
        phase: "playing",
        pendingGarbageQueue: [{ lines: 2, holeCol: 4 }],
        tick: 30,
        pieceIndex: 8,
    });

    recordClientSnapshot("SHADOW_REASON_COUNTS", "host-player", {
        board: [["tree"]],
        activePiece: { pieceType: "tree", rotation: 0, row: 1, col: 4 },
        score: 120,
        linesClearedTotal: 2,
        phase: "playing",
        pendingGarbageQueue: [{ lines: 2, holeCol: 4 }],
        tick: 30,
        pieceIndex: 8,
    });
    recordClientSnapshot("SHADOW_REASON_COUNTS", "host-player", {
        board: [["tree"]],
        activePiece: { pieceType: "tree", rotation: 0, row: 1, col: 4 },
        score: 100,
        linesClearedTotal: 2,
        phase: "playing",
        pendingGarbageQueue: [],
        tick: 30,
        pieceIndex: 8,
    });
    recordClientSnapshot("SHADOW_REASON_COUNTS", "host-player", {
        board: [["tree"]],
        activePiece: { pieceType: "tree", rotation: 0, row: 2, col: 4 },
        score: 100,
        linesClearedTotal: 2,
        phase: "playing",
        pendingGarbageQueue: [{ lines: 2, holeCol: 4 }],
        tick: 31,
        pieceIndex: 9,
    });
    recordClientSnapshot("SHADOW_REASON_COUNTS", "host-player", {
        board: [["tree"]],
        activePiece: { pieceType: "tree", rotation: 0, row: 1, col: 4 },
        score: 140,
        linesClearedTotal: 2,
        phase: "playing",
        pendingGarbageQueue: [{ lines: 2, holeCol: 4 }],
        tick: 30,
        pieceIndex: 8,
    });
    recordClientSnapshot("SHADOW_REASON_COUNTS", "host-player", {
        board: [["tree"]],
        activePiece: { pieceType: "tree", rotation: 0, row: 1, col: 4 },
        score: 100,
        linesClearedTotal: 2,
        phase: "gameOver",
        pendingGarbageQueue: [{ lines: 2, holeCol: 4 }],
        tick: 30,
        pieceIndex: 8,
    });

    const shadowResult = getPlayerShadowState("SHADOW_REASON_COUNTS", "host-player");

    assert.deepEqual(shadowResult.shadow.summary.desyncReasonCounts, {
        SCORE_MISMATCH: 2,
        GARBAGE_MISMATCH: 1,
        PIECE_INDEX_MISMATCH: 1,
        POST_GAME_SNAPSHOT: 1,
    });
    assert.equal(shadowResult.shadow.summary.dominantDesyncReason, "SCORE_MISMATCH");
    assert.equal(shadowResult.shadow.summary.dominantDesyncCount, 2);
    assert.equal(shadowResult.shadow.summary.actionableDesyncCount, 4);
    assert.deepEqual(shadowResult.shadow.summary.actionableDesyncReasonCounts, {
        SCORE_MISMATCH: 2,
        GARBAGE_MISMATCH: 1,
        PIECE_INDEX_MISMATCH: 1,
    });
    assert.deepEqual(shadowResult.shadow.summary.actionableDesyncFieldCounts, {
        score: 2,
        pendingGarbageLines: 1,
        pieceIndex: 1,
        activePiece: 1,
    });
    assert.deepEqual(shadowResult.shadow.summary.recentActionableDesyncFieldCounts, {
        score: 2,
        pendingGarbageLines: 1,
        pieceIndex: 1,
        activePiece: 1,
    });
    assert.equal(shadowResult.shadow.summary.dominantActionableDesyncReason, "SCORE_MISMATCH");
    assert.equal(shadowResult.shadow.summary.dominantActionableDesyncCount, 2);
    assert.equal(shadowResult.shadow.summary.dominantActionableDesyncField, "score");
    assert.equal(shadowResult.shadow.summary.dominantActionableDesyncFieldCount, 2);
    assert.equal(shadowResult.shadow.summary.recentDominantActionableDesyncField, "score");
    assert.equal(shadowResult.shadow.summary.recentDominantActionableDesyncFieldCount, 2);
    assert.equal(shadowResult.shadow.summary.lastDesyncReason, "POST_GAME_SNAPSHOT");
    assert.equal(shadowResult.shadow.summary.lastDesyncSeverity, "info");
    assert.equal(shadowResult.shadow.summary.lastActionableDesyncReason, "SCORE_MISMATCH");
    assert.equal(shadowResult.shadow.summary.lastActionableDesyncSeverity, "medium");
    assert.equal(shadowResult.shadow.summary.lastActionableDesyncTickDelta, 0);
    assert.equal(shadowResult.shadow.summary.lastActionableDesyncPieceIndexDelta, 0);
    assert.equal(shadowResult.shadow.summary.lastDesyncTickDelta, 0);
    assert.equal(shadowResult.shadow.summary.maxAbsoluteDesyncTickDelta, 1);
    assert.equal(shadowResult.shadow.summary.lastDesyncPieceIndexDelta, 0);
    assert.equal(shadowResult.shadow.summary.maxAbsoluteDesyncPieceIndexDelta, 1);
});

test("getPlayerShadowState summary는 마지막 shadow input tick과 shadow tick 차이를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_INPUT_TICK"));
    recordInput("SHADOW_INPUT_TICK", "host-player", {
        action: "move_left",
        tick: 10,
        pieceIndex: 1,
    });
    advanceShadowMatch("SHADOW_INPUT_TICK", 2);

    const shadowResult = getPlayerShadowState("SHADOW_INPUT_TICK", "host-player");

    assert.equal(shadowResult.ok, true);
    assert.equal(shadowResult.shadow.summary.lastShadowInputAction, "move_left");
    assert.equal(shadowResult.shadow.summary.lastShadowInputTick, 10);
    assert.equal(shadowResult.shadow.summary.lastShadowInputPieceIndex, 1);
    assert.equal(shadowResult.shadow.summary.lastShadowInputSequence, 1);
    assert.equal(shadowResult.shadow.summary.shadowTick, 2);
    assert.equal(shadowResult.shadow.summary.lastShadowInputToShadowTickDelta, 8);
});

test("getPlayerShadowState summary는 마지막 shadow input tick과 client snapshot tick 차이를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_INPUT_CLIENT_SNAPSHOT_TICK"));
    recordInput("SHADOW_INPUT_CLIENT_SNAPSHOT_TICK", "host-player", {
        action: "move_left",
        tick: 10,
        pieceIndex: 1,
    });
    recordClientSnapshot("SHADOW_INPUT_CLIENT_SNAPSHOT_TICK", "host-player", createShadowSnapshot({
        tick: 14,
        pieceIndex: 1,
    }));

    const shadowResult = getPlayerShadowState("SHADOW_INPUT_CLIENT_SNAPSHOT_TICK", "host-player");

    assert.equal(shadowResult.ok, true);
    assert.equal(shadowResult.shadow.summary.lastShadowInputTick, 10);
    assert.equal(shadowResult.shadow.summary.lastClientSnapshotTick, 14);
    assert.equal(shadowResult.shadow.summary.lastShadowInputToClientSnapshotTickDelta, 4);
});

test("getPlayerShadowState summary는 마지막 client snapshot tick과 shadow snapshot tick 차이를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_SNAPSHOT_TICK"));
    recordShadowSnapshot("SHADOW_SNAPSHOT_TICK", "host-player", createShadowSnapshot({
        tick: 12,
        pieceIndex: 3,
    }));
    recordClientSnapshot("SHADOW_SNAPSHOT_TICK", "host-player", createShadowSnapshot({
        tick: 18,
        pieceIndex: 3,
    }));

    const shadowResult = getPlayerShadowState("SHADOW_SNAPSHOT_TICK", "host-player");

    assert.equal(shadowResult.ok, true);
    assert.equal(shadowResult.shadow.summary.lastClientSnapshotTick, 18);
    assert.equal(shadowResult.shadow.summary.lastShadowSnapshotTick, 12);
    assert.equal(shadowResult.shadow.summary.lastClientSnapshotToShadowTickDelta, 6);
});

test("getPlayerShadowState summary는 마지막 client snapshot과 shadow snapshot의 pieceIndex 차이를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_SNAPSHOT_PIECE"));
    recordShadowSnapshot("SHADOW_SNAPSHOT_PIECE", "host-player", createShadowSnapshot({
        tick: 12,
        pieceIndex: 3,
    }));
    recordClientSnapshot("SHADOW_SNAPSHOT_PIECE", "host-player", createShadowSnapshot({
        tick: 12,
        pieceIndex: 5,
    }));

    const shadowResult = getPlayerShadowState("SHADOW_SNAPSHOT_PIECE", "host-player");

    assert.equal(shadowResult.ok, true);
    assert.equal(shadowResult.shadow.summary.lastClientSnapshotPieceIndex, 5);
    assert.equal(shadowResult.shadow.summary.lastShadowSnapshotPieceIndex, 3);
    assert.equal(shadowResult.shadow.summary.lastClientSnapshotToShadowPieceIndexDelta, 2);
});

test("getPlayerShadowState summary는 마지막 client snapshot과 shadow snapshot의 pieceIndex 방향을 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_SNAPSHOT_PIECE_DIRECTION"));
    recordShadowSnapshot("SHADOW_SNAPSHOT_PIECE_DIRECTION", "host-player", createShadowSnapshot({
        tick: 12,
        pieceIndex: 5,
    }));
    recordClientSnapshot("SHADOW_SNAPSHOT_PIECE_DIRECTION", "host-player", createShadowSnapshot({
        tick: 12,
        pieceIndex: 3,
    }));

    const shadowResult = getPlayerShadowState("SHADOW_SNAPSHOT_PIECE_DIRECTION", "host-player");

    assert.equal(shadowResult.ok, true);
    assert.equal(shadowResult.shadow.summary.lastClientSnapshotToShadowPieceIndexDelta, -2);
    assert.equal(
        shadowResult.shadow.summary.lastClientSnapshotToShadowPieceIndexDirection,
        "shadow_ahead",
    );
});

test("getPlayerShadowState summary는 마지막 client snapshot과 shadow snapshot의 phase 차이를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_SNAPSHOT_PHASE"));
    recordShadowSnapshot("SHADOW_SNAPSHOT_PHASE", "host-player", createShadowSnapshot({
        phase: "playing",
        tick: 12,
        pieceIndex: 3,
    }));
    recordClientSnapshot("SHADOW_SNAPSHOT_PHASE", "host-player", createShadowSnapshot({
        phase: "lineClearing",
        tick: 12,
        pieceIndex: 3,
    }));

    const shadowResult = getPlayerShadowState("SHADOW_SNAPSHOT_PHASE", "host-player");

    assert.equal(shadowResult.ok, true);
    assert.equal(shadowResult.shadow.summary.lastClientSnapshotPhase, "lineClearing");
    assert.equal(shadowResult.shadow.summary.lastShadowSnapshotPhase, "playing");
    assert.equal(shadowResult.shadow.summary.lastClientSnapshotPhaseMismatch, true);
});

test("getPlayerShadowState summary는 마지막 client snapshot과 shadow snapshot의 board checksum 차이를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_SNAPSHOT_BOARD"));
    recordShadowSnapshot("SHADOW_SNAPSHOT_BOARD", "host-player", createShadowSnapshot({
        board: [[null, "tree"]],
        tick: 12,
        pieceIndex: 3,
    }));
    recordClientSnapshot("SHADOW_SNAPSHOT_BOARD", "host-player", createShadowSnapshot({
        board: [["tree", null]],
        tick: 12,
        pieceIndex: 3,
    }));

    const shadowResult = getPlayerShadowState("SHADOW_SNAPSHOT_BOARD", "host-player");

    assert.equal(shadowResult.ok, true);
    assert.equal(typeof shadowResult.shadow.summary.lastClientSnapshotBoardChecksum, "string");
    assert.equal(typeof shadowResult.shadow.summary.lastShadowSnapshotBoardChecksum, "string");
    assert.notEqual(
        shadowResult.shadow.summary.lastClientSnapshotBoardChecksum,
        shadowResult.shadow.summary.lastShadowSnapshotBoardChecksum,
    );
    assert.equal(shadowResult.shadow.summary.lastClientSnapshotBoardMismatch, true);
    assert.equal(shadowResult.shadow.summary.lastClientSnapshotBoardDiffCellCount, 2);
    assert.deepEqual(shadowResult.shadow.summary.lastClientSnapshotFirstBoardDiff, {
        row: 0,
        col: 0,
        client: "tree",
        shadow: null,
    });
});

test("getPlayerShadowState summary는 actionable desync 상태를 health 값으로 요약한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_HEALTH"));
    recordShadowSnapshot("SHADOW_HEALTH", "host-player", createShadowSnapshot({
        phase: "playing",
        score: 100,
        tick: 12,
        pieceIndex: 3,
    }));

    const stableResult = getPlayerShadowState("SHADOW_HEALTH", "host-player");
    assert.equal(stableResult.shadow.summary.shadowHealth, "stable");

    recordClientSnapshot("SHADOW_HEALTH", "host-player", createShadowSnapshot({
        phase: "lineClearing",
        score: 100,
        tick: 12,
        pieceIndex: 3,
    }));

    const infoResult = getPlayerShadowState("SHADOW_HEALTH", "host-player");
    assert.equal(infoResult.shadow.summary.shadowHealth, "info_only");

    recordClientSnapshot("SHADOW_HEALTH", "host-player", createShadowSnapshot({
        phase: "playing",
        score: 140,
        tick: 12,
        pieceIndex: 3,
    }));

    const actionableResult = getPlayerShadowState("SHADOW_HEALTH", "host-player");
    assert.equal(actionableResult.shadow.summary.shadowHealth, "needs_attention");
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

test("appendPlayerBagChunk는 shadowState의 server bag queue에도 새 chunk를 추가한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_BAG001"));
    const before = getPlayerShadowState("SHADOW_BAG001", "host-player").shadow;
    const result = appendPlayerBagChunk("SHADOW_BAG001", "host-player");
    const after = getPlayerShadowState("SHADOW_BAG001", "host-player").shadow;

    assert.equal(result.ok, true);
    assert.equal(
        after.shadowState.serverBagQueue.length,
        before.shadowState.serverBagQueue.length + result.bagChunk.length,
    );
    assert.deepEqual(after.shadowState.serverBagQueue.slice(-7), result.bagChunk);
});

test("recordGarbageAttack은 target player의 shadow pending garbage queue를 갱신한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_GARBAGE001"));
    const result = recordGarbageAttack("SHADOW_GARBAGE001", "host-player", "guest-player", {
        lines: 4,
        holeCol: 6,
    });
    const hostShadow = getPlayerShadowState("SHADOW_GARBAGE001", "host-player").shadow;
    const guestShadow = getPlayerShadowState("SHADOW_GARBAGE001", "guest-player").shadow;

    assert.equal(result.ok, true);
    assert.deepEqual(hostShadow.shadowState.pendingGarbageQueue, []);
    assert.deepEqual(guestShadow.shadowState.pendingGarbageQueue, [
        { lines: 4, holeCol: 6 },
    ]);
    assert.deepEqual(guestShadow.lastShadowSnapshot.pendingGarbageQueue, [
        { lines: 4, holeCol: 6 },
    ]);
});

test("recordClientSnapshot은 desyncLog를 최대 50개로 제한한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("SHADOW_DESYNC_LIMIT"));
    recordShadowSnapshot("SHADOW_DESYNC_LIMIT", "host-player", {
        board: [["tree"]],
        activePiece: { pieceType: "tree", rotation: 0, row: 1, col: 4 },
        score: 100,
        linesClearedTotal: 2,
        phase: "playing",
        pendingGarbageQueue: [],
        tick: 1,
        pieceIndex: 1,
    });

    for (let i = 0; i < 60; i++) {
        recordClientSnapshot("SHADOW_DESYNC_LIMIT", "host-player", {
            board: [["tree"]],
            activePiece: { pieceType: "tree", rotation: 0, row: i + 2, col: 4 },
            score: 100 + i,
            linesClearedTotal: 2,
            phase: "playing",
            pendingGarbageQueue: [],
            tick: i + 2,
            pieceIndex: i + 2,
        });
    }

    const shadowResult = getPlayerShadowState("SHADOW_DESYNC_LIMIT", "host-player");

    assert.equal(shadowResult.shadow.desyncLog.length, 50);
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

test("recordClientPlacementDecision은 client placementResult와 shadow placementResult를 비교해 summary에 남긴다", () => {
    resetMatches();

    createMatch(createPlayingRoom("PLACEMENT_COMPARE"));
    recordShadowSnapshot("PLACEMENT_COMPARE", "host-player", createShadowSnapshot({
        lastPlacementResult: {
            linesCleared: 4,
            rawAttackLines: 4,
            attackLines: 2,
            canceledGarbageLines: 2,
            incomingGarbageLines: 2,
            appliedGarbageLines: 0,
            scoreBefore: 10,
            scoreAfter: 40,
            scoreDelta: 30,
            gameOver: false,
        },
    }));

    const result = recordClientPlacementDecision("PLACEMENT_COMPARE", "host-player", {
        eventType: "placement_decision",
        placementResult: {
            linesCleared: 4,
            rawAttackLines: 4,
            attackLines: 4,
            canceledGarbageLines: 0,
            incomingGarbageLines: 2,
            appliedGarbageLines: 0,
            scoreBefore: 20,
            scoreAfter: 60,
            scoreDelta: 40,
            gameOver: false,
        },
    });
    const shadowResult = getPlayerShadowState("PLACEMENT_COMPARE", "host-player");

    assert.equal(result.ok, true);
    assert.deepEqual(result.placementComparison.fields, [
        "attackLines",
        "canceledGarbageLines",
        "scoreBefore",
        "scoreAfter",
        "scoreDelta",
    ]);
    assert.deepEqual(result.placementComparison.details.attackLines, {
        client: 4,
        shadow: 2,
        delta: 2,
    });
    assert.deepEqual(result.placementComparison.details.canceledGarbageLines, {
        client: 0,
        shadow: 2,
        delta: -2,
    });
    assert.deepEqual(result.placementComparison.details.scoreBefore, {
        client: 20,
        shadow: 10,
        delta: 10,
    });
    assert.deepEqual(result.placementComparison.details.scoreAfter, {
        client: 60,
        shadow: 40,
        delta: 20,
    });
    assert.deepEqual(result.placementComparison.details.scoreDelta, {
        client: 40,
        shadow: 30,
        delta: 10,
    });
    assert.equal(shadowResult.shadow.summary.lastPlacementResultMismatch, true);
    assert.deepEqual(shadowResult.shadow.summary.lastPlacementResultMismatchFields, [
        "attackLines",
        "canceledGarbageLines",
        "scoreBefore",
        "scoreAfter",
        "scoreDelta",
    ]);
    assert.equal(shadowResult.shadow.summary.lastClientPlacementAttackLines, 4);
    assert.equal(shadowResult.shadow.summary.lastShadowPlacementAttackLines, 2);
    assert.equal(shadowResult.shadow.summary.lastPlacementAttackLinesDelta, 2);
    assert.equal(shadowResult.shadow.summary.lastClientPlacementCanceledGarbageLines, 0);
    assert.equal(shadowResult.shadow.summary.lastShadowPlacementCanceledGarbageLines, 2);
    assert.equal(shadowResult.shadow.summary.lastPlacementCanceledGarbageLinesDelta, -2);
    assert.equal(shadowResult.shadow.summary.lastClientPlacementScoreBefore, 20);
    assert.equal(shadowResult.shadow.summary.lastShadowPlacementScoreBefore, 10);
    assert.equal(shadowResult.shadow.summary.lastPlacementScoreBeforeDelta, 10);
    assert.equal(shadowResult.shadow.summary.lastClientPlacementScoreAfter, 60);
    assert.equal(shadowResult.shadow.summary.lastShadowPlacementScoreAfter, 40);
    assert.equal(shadowResult.shadow.summary.lastPlacementScoreAfterDelta, 20);
    assert.equal(shadowResult.shadow.summary.lastClientPlacementScoreDelta, 40);
    assert.equal(shadowResult.shadow.summary.lastShadowPlacementScoreDelta, 30);
    assert.equal(shadowResult.shadow.summary.lastPlacementScoreDeltaDelta, 10);
});

test("recordClientPlacementDecision은 shadow lineClearing 상태를 완료한 뒤 placementResult를 비교한다", () => {
    resetMatches();

    const matchResult = createMatch(createPlayingRoom("PLACEMENT_LINE_CLEAR_COMPLETE"));
    const player = matchResult.match.players[0];
    const state = createInitialShadowState({
        bagChunks: [["square", "bar", "tree", "zee", "ess", "eleft", "eright"]],
    });
    state.board[18] = ["zee", "zee", "zee", null, null, "zee", "zee", "zee", "zee", "zee"];
    state.board[19] = ["zee", "zee", "zee", null, null, "zee", "zee", "zee", "zee", "zee"];
    const lineClearingState = stepAuthoritativeState(state, {
        type: "input",
        action: "hard_drop",
        tick: 1,
        pieceIndex: 1,
    });

    player.shadowState = lineClearingState;
    player.shadowTick = lineClearingState.tick;
    player.shadowPieceIndex = lineClearingState.pieceIndex;
    player.lastShadowSnapshot = createEngineShadowSnapshot(lineClearingState);

    const result = recordClientPlacementDecision("PLACEMENT_LINE_CLEAR_COMPLETE", "host-player", {
        eventType: "placement_decision",
        tick: 100,
        pieceIndex: 1,
        placementResult: {
            linesCleared: 2,
            isTSpin: false,
            combo: 0,
            backToBack: false,
            rawAttackLines: 1,
            attackLines: 1,
            canceledGarbageLines: 0,
            incomingGarbageLines: 0,
            appliedGarbageLines: 0,
            scoreBefore: 0,
            scoreAfter: 58,
            scoreDelta: 58,
            gameOver: false,
        },
    });
    const shadowResult = getPlayerShadowState("PLACEMENT_LINE_CLEAR_COMPLETE", "host-player");

    assert.equal(result.ok, true);
    assert.deepEqual(result.placementComparison.fields, []);
    assert.equal(shadowResult.shadow.summary.phase, "playing");
    assert.equal(shadowResult.shadow.summary.shadowTick, 1);
    assert.equal(shadowResult.shadow.summary.shadowPieceIndex, 2);
    assert.equal(shadowResult.shadow.summary.placementResultMismatchCount, 0);
});

test("recordClientPlacementDecision은 다른 pieceIndex의 placement log로 shadow lineClearing을 완료하지 않는다", () => {
    resetMatches();

    const matchResult = createMatch(createPlayingRoom("PLACEMENT_LINE_CLEAR_OUT_OF_ORDER"));
    const player = matchResult.match.players[0];
    const state = createInitialShadowState({
        bagChunks: [["square", "bar", "tree", "zee", "ess", "eleft", "eright"]],
    });
    state.board[18] = ["zee", "zee", "zee", null, null, "zee", "zee", "zee", "zee", "zee"];
    state.board[19] = ["zee", "zee", "zee", null, null, "zee", "zee", "zee", "zee", "zee"];
    const lineClearingState = stepAuthoritativeState(state, {
        type: "input",
        action: "hard_drop",
        tick: 1,
        pieceIndex: 1,
    });

    player.shadowState = lineClearingState;
    player.shadowTick = lineClearingState.tick;
    player.shadowPieceIndex = lineClearingState.pieceIndex;
    player.lastShadowSnapshot = createEngineShadowSnapshot(lineClearingState);

    const result = recordClientPlacementDecision("PLACEMENT_LINE_CLEAR_OUT_OF_ORDER", "host-player", {
        eventType: "placement_decision",
        tick: 100,
        pieceIndex: 2,
        placementResult: {
            linesCleared: 2,
            isTSpin: false,
            combo: 0,
            backToBack: false,
            rawAttackLines: 1,
            attackLines: 1,
            canceledGarbageLines: 0,
            incomingGarbageLines: 0,
            appliedGarbageLines: 0,
            scoreBefore: 0,
            scoreAfter: 58,
            scoreDelta: 58,
            gameOver: false,
        },
    });
    const shadowResult = getPlayerShadowState("PLACEMENT_LINE_CLEAR_OUT_OF_ORDER", "host-player");

    assert.equal(result.ok, true);
    assert.equal(shadowResult.shadow.summary.phase, "lineClearing");
    assert.equal(shadowResult.shadow.summary.shadowPieceIndex, 1);
    assert.equal(
        shadowResult.shadow.summary.lastSkippedShadowLineClearCompleteReason,
        "PIECE_INDEX_MISMATCH",
    );
    assert.deepEqual(shadowResult.shadow.summary.lastSkippedShadowLineClearComplete, {
        reason: "PIECE_INDEX_MISMATCH",
        clientPieceIndex: 2,
        shadowPieceIndex: 1,
        clientTick: 100,
        shadowTick: 0,
    });
    assert.deepEqual(result.placementComparison.fields, [
        "linesCleared",
        "isTSpin",
        "combo",
        "backToBack",
        "rawAttackLines",
        "attackLines",
        "canceledGarbageLines",
        "incomingGarbageLines",
        "appliedGarbageLines",
        "scoreBefore",
        "scoreAfter",
        "scoreDelta",
        "gameOver",
    ]);
});

test("getPlayerShadowState summary는 placementResult mismatch만 있어도 다음 조사 힌트를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("PLACEMENT_HINT"));
    recordShadowSnapshot("PLACEMENT_HINT", "host-player", createShadowSnapshot({
        lastPlacementResult: {
            linesCleared: 4,
            rawAttackLines: 4,
            attackLines: 2,
            canceledGarbageLines: 2,
            incomingGarbageLines: 2,
            appliedGarbageLines: 0,
            gameOver: false,
        },
    }));
    recordClientPlacementDecision("PLACEMENT_HINT", "host-player", {
        eventType: "placement_decision",
        placementResult: {
            linesCleared: 4,
            rawAttackLines: 4,
            attackLines: 4,
            canceledGarbageLines: 0,
            incomingGarbageLines: 2,
            appliedGarbageLines: 0,
            gameOver: false,
        },
    });

    const shadowResult = getPlayerShadowState("PLACEMENT_HINT", "host-player");

    assert.equal(shadowResult.shadow.summary.lastPlacementResultMismatch, true);
    assert.equal(
        shadowResult.shadow.summary.nextInvestigationHint,
        "CHECK_PLACEMENT_GARBAGE_RESULT_FLOW",
    );
});

test("getPlayerShadowState summary는 score placementResult mismatch에 점수 조사 힌트를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("PLACEMENT_SCORE_HINT"));
    recordShadowSnapshot("PLACEMENT_SCORE_HINT", "host-player", createShadowSnapshot({
        tick: 50,
        pieceIndex: 5,
        lastPlacementResult: {
            linesCleared: 0,
            rawAttackLines: 0,
            attackLines: 0,
            canceledGarbageLines: 0,
            incomingGarbageLines: 0,
            appliedGarbageLines: 0,
            scoreBefore: 10,
            scoreAfter: 20,
            scoreDelta: 10,
            gameOver: false,
        },
    }));
    recordClientPlacementDecision("PLACEMENT_SCORE_HINT", "host-player", {
        eventType: "placement_decision",
        tick: 52,
        pieceIndex: 5,
        placementResult: {
            linesCleared: 0,
            rawAttackLines: 0,
            attackLines: 0,
            canceledGarbageLines: 0,
            incomingGarbageLines: 0,
            appliedGarbageLines: 0,
            scoreBefore: 10,
            scoreAfter: 25,
            scoreDelta: 15,
            gameOver: false,
        },
    });

    const shadowResult = getPlayerShadowState("PLACEMENT_SCORE_HINT", "host-player");

    assert.deepEqual(shadowResult.shadow.summary.lastPlacementResultMismatchFields, [
        "scoreAfter",
        "scoreDelta",
    ]);
    assert.equal(
        shadowResult.shadow.summary.nextInvestigationHint,
        "CHECK_PLACEMENT_SCORE_RESULT_FLOW",
    );
});

test("getPlayerShadowState summary는 placementResult mismatch가 out-of-order면 진행 순서 힌트를 우선한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("PLACEMENT_ORDER_HINT"));
    recordShadowSnapshot("PLACEMENT_ORDER_HINT", "host-player", createShadowSnapshot({
        tick: 50,
        pieceIndex: 5,
        lastPlacementResult: {
            linesCleared: 4,
            rawAttackLines: 4,
            attackLines: 2,
            canceledGarbageLines: 2,
            incomingGarbageLines: 2,
            appliedGarbageLines: 0,
            gameOver: false,
        },
    }));
    recordClientPlacementDecision("PLACEMENT_ORDER_HINT", "host-player", {
        eventType: "placement_decision",
        tick: 60,
        pieceIndex: 7,
        placementResult: {
            linesCleared: 4,
            rawAttackLines: 4,
            attackLines: 4,
            canceledGarbageLines: 0,
            incomingGarbageLines: 2,
            appliedGarbageLines: 0,
            gameOver: false,
        },
    });

    const shadowResult = getPlayerShadowState("PLACEMENT_ORDER_HINT", "host-player");

    assert.equal(shadowResult.shadow.summary.lastPlacementResultMismatch, true);
    assert.equal(shadowResult.shadow.summary.lastPlacementComparisonPieceAlignment, "client_ahead");
    assert.equal(
        shadowResult.shadow.summary.nextInvestigationHint,
        "CHECK_PLACEMENT_LOCK_SPAWN_ORDER",
    );
});

test("getPlayerShadowState summary는 placementResult mismatch field count를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("PLACEMENT_FIELD_COUNT"));
    recordShadowSnapshot("PLACEMENT_FIELD_COUNT", "host-player", createShadowSnapshot({
        lastPlacementResult: {
            linesCleared: 4,
            rawAttackLines: 4,
            attackLines: 2,
            canceledGarbageLines: 2,
            incomingGarbageLines: 2,
            appliedGarbageLines: 0,
            gameOver: false,
        },
    }));
    recordClientPlacementDecision("PLACEMENT_FIELD_COUNT", "host-player", {
        eventType: "placement_decision",
        placementResult: {
            linesCleared: 4,
            rawAttackLines: 4,
            attackLines: 4,
            canceledGarbageLines: 0,
            incomingGarbageLines: 2,
            appliedGarbageLines: 0,
            gameOver: false,
        },
    });

    recordShadowSnapshot("PLACEMENT_FIELD_COUNT", "host-player", createShadowSnapshot({
        lastPlacementResult: {
            linesCleared: 2,
            rawAttackLines: 1,
            attackLines: 1,
            canceledGarbageLines: 0,
            incomingGarbageLines: 0,
            appliedGarbageLines: 0,
            gameOver: false,
        },
    }));
    recordClientPlacementDecision("PLACEMENT_FIELD_COUNT", "host-player", {
        eventType: "placement_decision",
        placementResult: {
            linesCleared: 2,
            rawAttackLines: 1,
            attackLines: 3,
            canceledGarbageLines: 0,
            incomingGarbageLines: 0,
            appliedGarbageLines: 0,
            gameOver: false,
        },
    });

    const shadowResult = getPlayerShadowState("PLACEMENT_FIELD_COUNT", "host-player");

    assert.equal(shadowResult.shadow.summary.placementResultMismatchCount, 2);
    assert.equal(shadowResult.shadow.summary.placementResultHealth, "needs_attention");
    assert.equal(shadowResult.shadow.summary.shadowHealth, "stable");
    assert.equal(shadowResult.shadow.summary.overallShadowHealth, "needs_attention");
    assert.deepEqual(shadowResult.shadow.summary.placementResultMismatchFieldCounts, {
        attackLines: 2,
        canceledGarbageLines: 1,
    });
    assert.equal(shadowResult.shadow.summary.dominantPlacementResultMismatchField, "attackLines");
    assert.equal(shadowResult.shadow.summary.dominantPlacementResultMismatchFieldCount, 2);
});

test("getPlayerShadowState summary는 최근 placementResult mismatch field count를 따로 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("PLACEMENT_RECENT_FIELD_COUNT"));

    recordShadowSnapshot("PLACEMENT_RECENT_FIELD_COUNT", "host-player", createShadowSnapshot({
        lastPlacementResult: {
            linesCleared: 4,
            rawAttackLines: 4,
            attackLines: 2,
            canceledGarbageLines: 2,
            incomingGarbageLines: 2,
            appliedGarbageLines: 0,
            gameOver: false,
        },
    }));
    recordClientPlacementDecision("PLACEMENT_RECENT_FIELD_COUNT", "host-player", {
        eventType: "placement_decision",
        placementResult: {
            linesCleared: 4,
            rawAttackLines: 4,
            attackLines: 2,
            canceledGarbageLines: 0,
            incomingGarbageLines: 2,
            appliedGarbageLines: 0,
            gameOver: false,
        },
    });

    for (let index = 0; index < 10; index += 1) {
        recordShadowSnapshot("PLACEMENT_RECENT_FIELD_COUNT", "host-player", createShadowSnapshot({
            pieceIndex: index + 1,
            lastPlacementResult: {
                linesCleared: 2,
                rawAttackLines: 1,
                attackLines: 1,
                canceledGarbageLines: 0,
                incomingGarbageLines: 0,
                appliedGarbageLines: 0,
                gameOver: false,
            },
        }));
        recordClientPlacementDecision("PLACEMENT_RECENT_FIELD_COUNT", "host-player", {
            eventType: "placement_decision",
            placementResult: {
                linesCleared: 2,
                rawAttackLines: 1,
                attackLines: 3,
                canceledGarbageLines: 0,
                incomingGarbageLines: 0,
                appliedGarbageLines: 0,
                gameOver: false,
            },
        });
    }

    const shadowResult = getPlayerShadowState("PLACEMENT_RECENT_FIELD_COUNT", "host-player");

    assert.equal(shadowResult.shadow.summary.placementResultMismatchCount, 11);
    assert.equal(shadowResult.shadow.summary.placementResultHealth, "needs_attention");
    assert.deepEqual(shadowResult.shadow.summary.placementResultMismatchFieldCounts, {
        attackLines: 10,
        canceledGarbageLines: 1,
    });
    assert.equal(shadowResult.shadow.summary.recentPlacementResultMismatchCount, 10);
    assert.equal(shadowResult.shadow.summary.recentPlacementResultHealth, "needs_attention");
    assert.equal(shadowResult.shadow.summary.recentOverallShadowHealth, "needs_attention");
    assert.deepEqual(shadowResult.shadow.summary.recentPlacementResultMismatchFieldCounts, {
        attackLines: 10,
    });
    assert.equal(shadowResult.shadow.summary.recentDominantPlacementResultMismatchField, "attackLines");
    assert.equal(shadowResult.shadow.summary.recentDominantPlacementResultMismatchFieldCount, 10);
});

test("getPlayerShadowState summary는 placement comparison의 piece alignment를 구분한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("PLACEMENT_ALIGNMENT"));

    recordShadowSnapshot("PLACEMENT_ALIGNMENT", "host-player", createShadowSnapshot({
        tick: 40,
        pieceIndex: 4,
        lastPlacementResult: {
            linesCleared: 2,
            rawAttackLines: 1,
            attackLines: 1,
            canceledGarbageLines: 0,
            incomingGarbageLines: 0,
            appliedGarbageLines: 0,
            gameOver: false,
        },
    }));
    recordClientPlacementDecision("PLACEMENT_ALIGNMENT", "host-player", {
        eventType: "placement_decision",
        tick: 43,
        pieceIndex: 4,
        placementResult: {
            linesCleared: 2,
            rawAttackLines: 1,
            attackLines: 2,
            canceledGarbageLines: 0,
            incomingGarbageLines: 0,
            appliedGarbageLines: 0,
            gameOver: false,
        },
    });

    recordShadowSnapshot("PLACEMENT_ALIGNMENT", "host-player", createShadowSnapshot({
        tick: 50,
        pieceIndex: 5,
        lastPlacementResult: {
            linesCleared: 2,
            rawAttackLines: 1,
            attackLines: 1,
            canceledGarbageLines: 0,
            incomingGarbageLines: 0,
            appliedGarbageLines: 0,
            gameOver: false,
        },
    }));
    recordClientPlacementDecision("PLACEMENT_ALIGNMENT", "host-player", {
        eventType: "placement_decision",
        tick: 60,
        pieceIndex: 7,
        placementResult: {
            linesCleared: 2,
            rawAttackLines: 1,
            attackLines: 3,
            canceledGarbageLines: 0,
            incomingGarbageLines: 0,
            appliedGarbageLines: 0,
            gameOver: false,
        },
    });

    const shadowResult = getPlayerShadowState("PLACEMENT_ALIGNMENT", "host-player");

    assert.equal(shadowResult.shadow.summary.lastPlacementComparisonTickDelta, 10);
    assert.equal(shadowResult.shadow.summary.lastPlacementComparisonPieceIndexDelta, 2);
    assert.equal(shadowResult.shadow.summary.lastPlacementComparisonPieceAlignment, "client_ahead");
    assert.equal(shadowResult.shadow.summary.recentSamePiecePlacementMismatchCount, 1);
    assert.equal(shadowResult.shadow.summary.recentOutOfOrderPlacementMismatchCount, 1);
    assert.equal(shadowResult.shadow.summary.recentUnknownPiecePlacementMismatchCount, 0);
});

test("getPlayerShadowState summary는 최근 placement investigation hint count를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("PLACEMENT_HINT_COUNT"));

    recordShadowSnapshot("PLACEMENT_HINT_COUNT", "host-player", createShadowSnapshot({
        tick: 40,
        pieceIndex: 4,
        lastPlacementResult: {
            linesCleared: 2,
            rawAttackLines: 1,
            attackLines: 1,
            canceledGarbageLines: 0,
            incomingGarbageLines: 0,
            appliedGarbageLines: 0,
            gameOver: false,
        },
    }));
    recordClientPlacementDecision("PLACEMENT_HINT_COUNT", "host-player", {
        eventType: "placement_decision",
        tick: 44,
        pieceIndex: 4,
        placementResult: {
            linesCleared: 2,
            rawAttackLines: 1,
            attackLines: 3,
            canceledGarbageLines: 0,
            incomingGarbageLines: 0,
            appliedGarbageLines: 0,
            gameOver: false,
        },
    });

    for (let index = 0; index < 2; index += 1) {
        recordShadowSnapshot("PLACEMENT_HINT_COUNT", "host-player", createShadowSnapshot({
            tick: 50 + index,
            pieceIndex: 5 + index,
            lastPlacementResult: {
                linesCleared: 2,
                rawAttackLines: 1,
                attackLines: 1,
                canceledGarbageLines: 0,
                incomingGarbageLines: 0,
                appliedGarbageLines: 0,
                gameOver: false,
            },
        }));
        recordClientPlacementDecision("PLACEMENT_HINT_COUNT", "host-player", {
            eventType: "placement_decision",
            tick: 60 + index,
            pieceIndex: 7 + index,
            placementResult: {
                linesCleared: 2,
                rawAttackLines: 1,
                attackLines: 3,
                canceledGarbageLines: 0,
                incomingGarbageLines: 0,
                appliedGarbageLines: 0,
                gameOver: false,
            },
        });
    }

    const shadowResult = getPlayerShadowState("PLACEMENT_HINT_COUNT", "host-player");

    assert.deepEqual(shadowResult.shadow.summary.recentPlacementInvestigationHintCounts, {
        CHECK_PLACEMENT_GARBAGE_RESULT_FLOW: 1,
        CHECK_PLACEMENT_LOCK_SPAWN_ORDER: 2,
    });
    assert.equal(
        shadowResult.shadow.summary.recentDominantPlacementInvestigationHint,
        "CHECK_PLACEMENT_LOCK_SPAWN_ORDER",
    );
    assert.equal(shadowResult.shadow.summary.recentDominantPlacementInvestigationHintCount, 2);
    assert.equal(shadowResult.shadow.summary.recentMaxAbsolutePlacementTickDelta, 10);
    assert.equal(shadowResult.shadow.summary.recentMaxAbsolutePlacementPieceIndexDelta, 2);
    assert.equal(shadowResult.shadow.summary.recentPlacementDriftLevel, "major_order_drift");
    assert.equal(shadowResult.shadow.summary.recentPlacementAttentionLevel, "critical");
});

test("getPlayerShadowState는 최근 placement comparison log를 debug payload에 포함한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("PLACEMENT_RECENT_LOG"));

    for (let index = 0; index < 11; index += 1) {
        recordShadowSnapshot("PLACEMENT_RECENT_LOG", "host-player", createShadowSnapshot({
            tick: 90 + index,
            pieceIndex: index + 1,
            lastPlacementResult: {
                linesCleared: 2,
                rawAttackLines: 1,
                attackLines: 1,
                canceledGarbageLines: 0,
                incomingGarbageLines: 0,
                appliedGarbageLines: 0,
                gameOver: false,
            },
        }));
        recordClientPlacementDecision("PLACEMENT_RECENT_LOG", "host-player", {
            eventType: "placement_decision",
            tick: 100 + index,
            pieceIndex: index + 1,
            placementResult: {
                linesCleared: 2,
                rawAttackLines: 1,
                attackLines: index + 2,
                canceledGarbageLines: 0,
                incomingGarbageLines: 0,
                appliedGarbageLines: 0,
                gameOver: false,
            },
        });
    }

    const shadowResult = getPlayerShadowState("PLACEMENT_RECENT_LOG", "host-player");

    assert.equal(shadowResult.shadow.placementComparisonLog.length, 11);
    assert.equal(shadowResult.shadow.recentPlacementComparisonLog.length, 10);
    assert.deepEqual(shadowResult.shadow.recentPlacementComparisonLog[0].fields, ["attackLines"]);
    assert.equal(typeof shadowResult.shadow.recentPlacementComparisonLog[0].recordedAt, "number");
    assert.equal(shadowResult.shadow.recentPlacementComparisonLog[0].clientTick, 101);
    assert.equal(shadowResult.shadow.recentPlacementComparisonLog[0].shadowTick, 91);
    assert.equal(shadowResult.shadow.recentPlacementComparisonLog[0].tickDelta, 10);
    assert.equal(shadowResult.shadow.recentPlacementComparisonLog[0].clientPieceIndex, 2);
    assert.equal(shadowResult.shadow.recentPlacementComparisonLog[0].shadowPieceIndex, 2);
    assert.equal(shadowResult.shadow.recentPlacementComparisonLog[0].pieceIndexDelta, 0);
    assert.deepEqual(shadowResult.shadow.recentPlacementComparisonLog.at(-1).details.attackLines, {
        client: 12,
        shadow: 1,
        delta: 11,
    });
    assert.equal(shadowResult.shadow.recentPlacementComparisonLog.at(-1).clientTick, 110);
    assert.equal(shadowResult.shadow.recentPlacementComparisonLog.at(-1).shadowTick, 100);
    assert.equal(shadowResult.shadow.recentPlacementComparisonLog.at(-1).tickDelta, 10);
    assert.equal(shadowResult.shadow.recentPlacementComparisonLog.at(-1).clientPieceIndex, 11);
    assert.equal(shadowResult.shadow.recentPlacementComparisonLog.at(-1).shadowPieceIndex, 11);
    assert.equal(shadowResult.shadow.recentPlacementComparisonLog.at(-1).pieceIndexDelta, 0);
});

test("deleteMatch는 match를 제거하고 이후 조회를 MATCH_NOT_FOUND로 만든다", () => {
    resetMatches();

    createMatch(createPlayingRoom("DELETE_MATCH"));

    const deleteResult = deleteMatch("DELETE_MATCH");
    const stateResult = getMatchState("DELETE_MATCH");

    assert.equal(deleteResult.ok, true);
    assert.equal(deleteResult.match.roomId, "DELETE_MATCH");
    assert.deepEqual(stateResult, {
        ok: false,
        match: null,
        reason: "MATCH_NOT_FOUND",
    });
});
