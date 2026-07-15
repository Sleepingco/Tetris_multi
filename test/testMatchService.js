const test = require("node:test");
const assert = require("node:assert/strict");

const matchService = require("../src/server/services/matchService.js");
const {
    appendPlayerBagChunk,
    appendPendingGarbageToOpponent,
    applyAuthoritativeInputToMatchPlayerState,
    applyGravityStepToMatchPlayerState,
    createMatch,
    deleteMatch,
    getAuthoritativePlayerSnapshotDto,
    recordInput,
    getMatchState,
    MAX_INPUT_LOG_ENTRIES_PER_PLAYER,
    resetMatches,
} = matchService;
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
    assert.equal(result.match.aiDifficulty, null);
    assert.equal(result.match.status, "playing");
    assert.equal(result.match.players.length, 2);
    assert.equal(result.match.players[0].playerId, "host-player");
    assert.deepEqual(result.match.players[0].inputLog, []);
    assert.equal(result.match.players[0].nextInputSequence, 1);
    assert.equal(result.match.players[0].lastProcessedClientSequence, 0);
    assert.equal(
        Object.hasOwn(result.match.players[0].authoritativeState, "lastProcessedClientSequence"),
        false,
    );
    assert.equal(result.match.players[0].aiPlan, null);
    assert.equal(typeof result.match.createdAt, "number");
});

test("createMatch는 PVE room 난이도를 match 단일 실행 설정으로 복사한다", () => {
    resetMatches();

    const hardResult = createMatch({
        ...createPlayingRoom("PVE_MATCH_HARD"),
        mode: "pve",
        aiDifficulty: "hard",
    });
    const defaultResult = createMatch({
        ...createPlayingRoom("PVE_MATCH_DEFAULT"),
        mode: "pve",
    });

    assert.equal(hardResult.match.aiDifficulty, "hard");
    assert.equal(defaultResult.match.aiDifficulty, "normal");
    hardResult.match.players.forEach((player) => {
        assert.equal(Object.hasOwn(player, "aiDifficulty"), false);
        assert.equal(Object.hasOwn(player.authoritativeState, "aiDifficulty"), false);
        assert.equal(Object.hasOwn(player.aiPlan || {}, "aiDifficulty"), false);
    });
});

test("createMatch는 invalid PVE 난이도를 거부하고 match를 저장하지 않는다", () => {
    resetMatches();

    const result = createMatch({
        ...createPlayingRoom("PVE_MATCH_INVALID"),
        mode: "pve",
        aiDifficulty: "expert",
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "INVALID_AI_DIFFICULTY");
    assert.equal(getMatchState("PVE_MATCH_INVALID").reason, "MATCH_NOT_FOUND");
});

test("createMatch는 player별 server bag chunks를 만든다", () => {
    resetMatches();

    const result = createMatch(createPlayingRoom("BAG001"));
    const expectedPieces = ["bar", "eleft", "eright", "ess", "square", "tree", "zee"];

    assert.equal(result.ok, true);
    assert.equal(result.match.players.length, 2);

    result.match.players.forEach((player) => {
        const flattenedBag = player.bagChunks.flat();

        assert.equal(player.bagChunks.length, 3);

        player.bagChunks.forEach((chunk) => {
            assert.equal(chunk.length, 7);
            assert.deepEqual([...chunk].sort(), expectedPieces);
        });
        assert.equal(player.authoritativeState.activePiece.pieceType, flattenedBag[0]);
        assert.deepEqual(player.authoritativeState.pieceQueue, flattenedBag.slice(1));
        assert.equal(player.authoritativeState.pieceIndex, 1);
    });
});

test("createMatch는 player별 최소 authoritative state를 만든다", () => {
    resetMatches();

    const result = createMatch(createPlayingRoom("STATE001"));
    const [hostPlayer, guestPlayer] = result.match.players;
    const flattenedBag = hostPlayer.bagChunks.flat();
    const firstPieceType = flattenedBag[0];
    const expectedSpawnedPiece = {
        pieceType: firstPieceType,
        rotation: 0,
        row: -1,
        col: 3,
    };

    assert.equal(result.ok, true);
    assert.deepEqual(hostPlayer.authoritativeState, {
        board: Array.from({ length: 20 }, () => Array(10).fill(null)),
        activePiece: expectedSpawnedPiece,
        pendingPiece: expectedSpawnedPiece,
        pieceQueue: flattenedBag.slice(1),
        holdPieceType: null,
        holdUsedThisDrop: false,
        score: 0,
        lines: 0,
        phase: "playing",
        gameOver: false,
        combo: -1,
        backToBack: false,
        currentTick: 0,
        pieceIndex: 1,
        pendingGarbageQueue: [],
        lastActionWasRotation: false,
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

test("deleteMatch는 roomId에 해당하는 match를 개별 삭제한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("DELETE001"));
    const result = deleteMatch("DELETE001");
    const lookupResult = getMatchState("DELETE001");

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.match.roomId, "DELETE001");
    assert.deepEqual(lookupResult, {
        ok: false,
        match: null,
        reason: "MATCH_NOT_FOUND",
    });
});

test("deleteMatch는 없는 match면 MATCH_NOT_FOUND를 반환한다", () => {
    resetMatches();

    const result = deleteMatch("MISSING_DELETE");

    assert.deepEqual(result, {
        ok: false,
        match: null,
        reason: "MATCH_NOT_FOUND",
    });
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

test("recordInput은 player별 inputLog를 상한 안에서 유지하고 sequence는 전체 순서를 유지한다", () => {
    resetMatches();

    assert.equal(MAX_INPUT_LOG_ENTRIES_PER_PLAYER, 1000);

    createMatch(createPlayingRoom("REPLAY_BOUNDED"));
    for (let index = 1; index <= MAX_INPUT_LOG_ENTRIES_PER_PLAYER + 2; index += 1) {
        recordInput("REPLAY_BOUNDED", "host-player", {
            action: "move_left",
            tick: index,
            pieceIndex: 1,
        });
    }
    recordInput("REPLAY_BOUNDED", "guest-player", {
        action: "move_right",
        tick: 1,
        pieceIndex: 1,
    });
    const result = recordInput("REPLAY_BOUNDED", "host-player", {
        action: "soft_drop",
        tick: MAX_INPUT_LOG_ENTRIES_PER_PLAYER + 3,
        pieceIndex: 1,
    });

    const hostPlayer = result.match.players.find(player => player.playerId === "host-player");
    const guestPlayer = result.match.players.find(player => player.playerId === "guest-player");

    assert.equal(hostPlayer.inputLog.length, MAX_INPUT_LOG_ENTRIES_PER_PLAYER);
    assert.equal(hostPlayer.inputLog[0].sequence, 4);
    assert.equal(hostPlayer.inputLog[0].tick, 4);
    assert.equal(hostPlayer.inputLog.at(-1).sequence, MAX_INPUT_LOG_ENTRIES_PER_PLAYER + 3);
    assert.equal(hostPlayer.inputLog.at(-1).action, "soft_drop");
    assert.equal(hostPlayer.nextInputSequence, MAX_INPUT_LOG_ENTRIES_PER_PLAYER + 4);
    assert.deepEqual(guestPlayer.inputLog.map(input => input.sequence), [1]);
    assert.equal(guestPlayer.nextInputSequence, 2);
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
    assert.equal(hostPlayer.authoritativeState.pieceQueue.length, 27);
    assert.equal(result.bagChunk.length, 7);
    assert.deepEqual([...result.bagChunk].sort(), expectedPieces);
    assert.deepEqual(hostPlayer.bagChunks[3], result.bagChunk);
    assert.deepEqual(hostPlayer.authoritativeState.pieceQueue.slice(-7), result.bagChunk);
});

test("appendPendingGarbageToOpponent는 server attackLines를 상대 pendingGarbageQueue에 추가한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("GARBAGE_AUTH_001"));
    const result = appendPendingGarbageToOpponent("GARBAGE_AUTH_001", "host-player", {
        lines: 3,
        holeCol: 4,
    });
    const guestPlayer = result.match.players.find(player => player.playerId === "guest-player");

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.targetPlayerId, "guest-player");
    assert.deepEqual(guestPlayer.authoritativeState.pendingGarbageQueue, [
        { lines: 3, holeCol: 4 },
    ]);
});

test("appendPendingGarbageToOpponent는 invalid garbage면 상대 state를 변경하지 않는다", () => {
    resetMatches();

    createMatch(createPlayingRoom("GARBAGE_AUTH_INVALID"));
    const beforeMatch = getMatchState("GARBAGE_AUTH_INVALID").match;
    const guestPlayer = beforeMatch.players.find(player => player.playerId === "guest-player");
    const result = appendPendingGarbageToOpponent("GARBAGE_AUTH_INVALID", "host-player", {
        lines: 0,
        holeCol: 4,
    });

    assert.deepEqual(result, {
        ok: false,
        match: null,
        reason: "INVALID_GARBAGE",
    });
    assert.deepEqual(guestPlayer.authoritativeState.pendingGarbageQueue, []);
});

test("matchService public entry는 authoritative input acknowledgment와 gravity 경계를 노출한다", () => {
    const legacyExport = ["apply", "Authoritative", "Placement", "ToMatchPlayerState"].join("");

    assert.equal(matchService.applyInputToMatchPlayerState, undefined);
    assert.equal(Object.hasOwn(matchService, legacyExport), false);
    assert.equal(typeof matchService.acknowledgeClientInputSequence, "function");
    assert.equal(typeof matchService.applyAuthoritativeInputToMatchPlayerState, "function");
    assert.equal(typeof matchService.applyGravityStepToMatchPlayerState, "function");
    assert.equal(typeof matchService.validateClientInputSequence, "function");
});

test("applyAuthoritativeInputToMatchPlayerState는 move_left를 player authoritativeState에 적용한다", async () => {
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
    hostPlayer.authoritativeState.pendingPiece = { ...hostPlayer.authoritativeState.activePiece };

    const result = applyAuthoritativeInputToMatchPlayerState("INPUT001", "host-player", {
        action: "move_left",
        pieceIndex: hostPlayer.authoritativeState.pieceIndex,
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.gameplayResult.ok, true);
    assert.equal(result.gameplayResult.moveIntent.kind, "ok");
    assert.deepEqual(hostPlayer.authoritativeState.activePiece, {
        pieceType: "tree",
        rotation: 0,
        row: 0,
        col: 3,
    });
});

test("applyAuthoritativeInputToMatchPlayerState는 pieceIndex가 다르면 state를 변경하지 않는다", async () => {
    resetMatches();

    const gameCore = await loadGameCore();
    createMatch(createPlayingRoom("INPUT_MISMATCH"));
    const matchBefore = getMatchState("INPUT_MISMATCH").match;
    const hostPlayer = matchBefore.players.find(player => player.playerId === "host-player");
    const beforeState = structuredClone(hostPlayer.authoritativeState);

    const result = applyAuthoritativeInputToMatchPlayerState("INPUT_MISMATCH", "host-player", {
        action: "move_left",
        pieceIndex: hostPlayer.authoritativeState.pieceIndex + 1,
        clientSequence: 1,
    }, gameCore);

    assert.equal(result.ok, false);
    assert.equal(result.match.roomId, "INPUT_MISMATCH");
    assert.equal(result.reason, "PIECE_INDEX_MISMATCH");
    assert.deepEqual(hostPlayer.authoritativeState.activePiece, beforeState.activePiece);
    assert.deepEqual(hostPlayer.authoritativeState.pendingPiece, beforeState.pendingPiece);
    assert.deepEqual(hostPlayer.authoritativeState.pieceQueue, beforeState.pieceQueue);
    assert.equal(hostPlayer.lastProcessedClientSequence, 1);
});

test("client input acknowledgment는 player metadata와 snapshot DTO에서 단조 증가한다", async () => {
    resetMatches();

    const gameCore = await loadGameCore();
    createMatch(createPlayingRoom("INPUT_ACK"));
    const match = getMatchState("INPUT_ACK").match;
    const hostPlayer = match.players.find(player => player.playerId === "host-player");
    const pieceIndex = hostPlayer.authoritativeState.pieceIndex;

    const firstResult = applyAuthoritativeInputToMatchPlayerState("INPUT_ACK", "host-player", {
        action: "move_left",
        pieceIndex,
        clientSequence: 1,
    }, gameCore);
    const secondResult = applyAuthoritativeInputToMatchPlayerState("INPUT_ACK", "host-player", {
        action: "move_right",
        pieceIndex,
        clientSequence: 2,
    }, gameCore);
    const snapshotResult = getAuthoritativePlayerSnapshotDto("INPUT_ACK", "host-player");

    assert.equal(firstResult.ok, true);
    assert.equal(secondResult.ok, true);
    assert.equal(hostPlayer.lastProcessedClientSequence, 2);
    assert.equal(snapshotResult.snapshot.lastProcessedClientSequence, 2);
    assert.equal(
        Object.hasOwn(hostPlayer.authoritativeState, "lastProcessedClientSequence"),
        false,
    );
});

test("처리된 clientSequence 이하 입력은 authoritative state에 다시 적용하지 않는다", async () => {
    resetMatches();

    const gameCore = await loadGameCore();
    createMatch(createPlayingRoom("INPUT_ACK_ORDER"));
    const match = getMatchState("INPUT_ACK_ORDER").match;
    const hostPlayer = match.players.find(player => player.playerId === "host-player");
    const pieceIndex = hostPlayer.authoritativeState.pieceIndex;

    const latestResult = applyAuthoritativeInputToMatchPlayerState("INPUT_ACK_ORDER", "host-player", {
        action: "move_left",
        pieceIndex,
        clientSequence: 2,
    }, gameCore);
    const stateAfterLatest = structuredClone(hostPlayer.authoritativeState);
    const staleResult = applyAuthoritativeInputToMatchPlayerState("INPUT_ACK_ORDER", "host-player", {
        action: "move_left",
        pieceIndex,
        clientSequence: 1,
    }, gameCore);

    assert.equal(latestResult.ok, true);
    assert.equal(staleResult.ok, false);
    assert.equal(staleResult.reason, "CLIENT_SEQUENCE_OUT_OF_ORDER");
    assert.equal(hostPlayer.lastProcessedClientSequence, 2);
    assert.deepEqual(hostPlayer.authoritativeState, stateAfterLatest);
});

test("applyAuthoritativeInputToMatchPlayerState는 hard_drop을 player authoritativeState에 적용한다", async () => {
    resetMatches();

    const gameCore = await loadGameCore();
    createMatch(createPlayingRoom("GAMEPLAY001"));
    const matchBefore = getMatchState("GAMEPLAY001").match;
    const hostPlayer = matchBefore.players.find(player => player.playerId === "host-player");
    hostPlayer.authoritativeState.activePiece = {
        pieceType: "square",
        rotation: 0,
        row: -1,
        col: 3,
    };
    hostPlayer.authoritativeState.pendingPiece = { ...hostPlayer.authoritativeState.activePiece };
    hostPlayer.authoritativeState.pieceQueue = ["tree"];
    hostPlayer.authoritativeState.pieceIndex = 1;

    const result = applyAuthoritativeInputToMatchPlayerState("GAMEPLAY001", "host-player", {
        action: "hard_drop",
        pieceIndex: hostPlayer.authoritativeState.pieceIndex,
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.gameplayResult.ok, true);
    assert.equal(result.gameplayResult.placementResult.lockedPiece.pieceType, "square");
    assert.equal(hostPlayer.authoritativeState.pieceIndex, 2);
    assert.deepEqual(hostPlayer.authoritativeState.activePiece, {
        pieceType: "tree",
        rotation: 0,
        row: -1,
        col: 3,
    });
    assert.deepEqual(hostPlayer.inputLog, []);
});

test("internal soft_drop은 expectedTransform 없이 기존 authoritative 규칙을 사용한다", async () => {
    resetMatches();

    const gameCore = await loadGameCore();
    createMatch(createPlayingRoom("INTERNAL_SOFT_DROP"));
    const match = getMatchState("INTERNAL_SOFT_DROP").match;
    const hostPlayer = match.players.find(player => player.playerId === "host-player");
    hostPlayer.authoritativeState.activePiece = {
        pieceType: "square",
        rotation: 0,
        row: 0,
        col: 4,
    };
    hostPlayer.authoritativeState.pendingPiece = { ...hostPlayer.authoritativeState.activePiece };

    const result = applyAuthoritativeInputToMatchPlayerState("INTERNAL_SOFT_DROP", "host-player", {
        action: "soft_drop",
        pieceIndex: hostPlayer.authoritativeState.pieceIndex,
    }, gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(hostPlayer.authoritativeState.activePiece.row, 1);
});

test("applyAuthoritativeInputToMatchPlayerState는 없는 match면 실패 결과를 반환한다", () => {
    resetMatches();

    const result = applyAuthoritativeInputToMatchPlayerState("MISSING", "host-player", {
        action: "hard_drop",
    }, null);

    assert.deepEqual(result, {
        ok: false,
        match: null,
        reason: "MATCH_NOT_FOUND",
    });
});

test("applyAuthoritativeInputToMatchPlayerState는 match에 없는 player면 실패 결과를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("GAMEPLAY002"));
    const result = applyAuthoritativeInputToMatchPlayerState("GAMEPLAY002", "unknown-player", {
        action: "hard_drop",
    }, null);

    assert.deepEqual(result, {
        ok: false,
        match: null,
        reason: "PLAYER_NOT_FOUND",
    });
});

test("applyAuthoritativeInputToMatchPlayerState는 player authoritativeState가 없으면 실패 결과를 반환한다", () => {
    resetMatches();

    createMatch(createPlayingRoom("GAMEPLAY003"));
    const matchBefore = getMatchState("GAMEPLAY003").match;
    const hostPlayer = matchBefore.players.find(player => player.playerId === "host-player");
    hostPlayer.authoritativeState = null;

    const result = applyAuthoritativeInputToMatchPlayerState("GAMEPLAY003", "host-player", {
        action: "hard_drop",
    }, null);

    assert.equal(result.ok, false);
    assert.equal(result.match.roomId, "GAMEPLAY003");
    assert.equal(result.reason, "AUTHORITATIVE_STATE_NOT_FOUND");
});

test("applyGravityStepToMatchPlayerState는 player authoritativeState에 gravity 1회를 적용한다", async () => {
    resetMatches();

    const gameCore = await loadGameCore();
    createMatch(createPlayingRoom("GRAVITY001"));
    const matchBefore = getMatchState("GRAVITY001").match;
    const hostPlayer = matchBefore.players.find(player => player.playerId === "host-player");
    hostPlayer.authoritativeState.activePiece = {
        pieceType: "square",
        rotation: 0,
        row: 0,
        col: 3,
    };
    hostPlayer.authoritativeState.pendingPiece = { ...hostPlayer.authoritativeState.activePiece };

    const result = applyGravityStepToMatchPlayerState("GRAVITY001", "host-player", gameCore);
    const snapshotResult = getAuthoritativePlayerSnapshotDto("GRAVITY001", "host-player");

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.gravityResult.kind, "move");
    assert.deepEqual(hostPlayer.authoritativeState.activePiece, {
        pieceType: "square",
        rotation: 0,
        row: 1,
        col: 3,
    });
    assert.equal(hostPlayer.authoritativeState.currentTick, 1);
    assert.deepEqual(hostPlayer.inputLog, []);
    assert.equal(snapshotResult.ok, true);
    assert.equal(snapshotResult.snapshot.tick, 1);
    assert.deepEqual(snapshotResult.snapshot.activePiece, hostPlayer.authoritativeState.activePiece);
});

test("getAuthoritativePlayerSnapshotDto는 pendingGarbageLines만 client snapshot에 포함한다", () => {
    resetMatches();
    createMatch(createPlayingRoom("SNAPSHOT_GARBAGE_001"));
    const match = getMatchState("SNAPSHOT_GARBAGE_001").match;
    const guestPlayer = match.players.find(player => player.playerId === "guest-player");
    guestPlayer.authoritativeState.pendingGarbageQueue.push({ lines: 2, holeCol: 3 });
    guestPlayer.authoritativeState.pendingGarbageQueue.push({ lines: 1, holeCol: 5 });

    const snapshotResult = getAuthoritativePlayerSnapshotDto("SNAPSHOT_GARBAGE_001", "guest-player");

    assert.equal(snapshotResult.ok, true);
    assert.equal(snapshotResult.snapshot.pendingGarbageLines, 3);
    assert.equal(Object.hasOwn(snapshotResult.snapshot, "pendingGarbageQueue"), false);
    assert.equal(Object.hasOwn(snapshotResult.snapshot, "aiPlan"), false);
    assert.equal(Object.hasOwn(snapshotResult.snapshot, "aiDifficulty"), false);
    assert.deepEqual(guestPlayer.authoritativeState.pendingGarbageQueue, [
        { lines: 2, holeCol: 3 },
        { lines: 1, holeCol: 5 },
    ]);
});

test("applyGravityStepToMatchPlayerState는 없는 match면 실패 결과를 반환한다", async () => {
    resetMatches();

    const gameCore = await loadGameCore();
    const result = applyGravityStepToMatchPlayerState("MISSING", "host-player", gameCore);

    assert.deepEqual(result, {
        ok: false,
        match: null,
        reason: "MATCH_NOT_FOUND",
    });
});

test("applyGravityStepToMatchPlayerState는 match에 없는 player면 실패 결과를 반환한다", async () => {
    resetMatches();

    const gameCore = await loadGameCore();
    createMatch(createPlayingRoom("GRAVITY002"));
    const result = applyGravityStepToMatchPlayerState("GRAVITY002", "unknown-player", gameCore);

    assert.deepEqual(result, {
        ok: false,
        match: null,
        reason: "PLAYER_NOT_FOUND",
    });
});

test("applyGravityStepToMatchPlayerState는 player authoritativeState가 없으면 실패 결과를 반환한다", async () => {
    resetMatches();

    const gameCore = await loadGameCore();
    createMatch(createPlayingRoom("GRAVITY003"));
    const matchBefore = getMatchState("GRAVITY003").match;
    const hostPlayer = matchBefore.players.find(player => player.playerId === "host-player");
    hostPlayer.authoritativeState = null;

    const result = applyGravityStepToMatchPlayerState("GRAVITY003", "host-player", gameCore);

    assert.equal(result.ok, false);
    assert.equal(result.match.roomId, "GRAVITY003");
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
