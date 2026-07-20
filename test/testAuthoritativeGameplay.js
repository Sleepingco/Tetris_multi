const test = require("node:test");
const assert = require("node:assert/strict");

const {
    applyAuthoritativeInputToMatchPlayerState,
    applyGravityStepToMatchPlayerState,
    createMatch,
    getAuthoritativePlayerSnapshot,
    getAuthoritativePlayerSnapshotDto,
    getMatchState,
    resetMatches,
} = require("../src/server/services/matchService.js");
const { loadGameCore } = require("../src/server/services/gameCoreLoader.js");

function createPlayingRoom(roomId = "AUTH_GAMEPLAY_001") {
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

test("authoritative gameplay은 연속 input으로 state를 갱신하고 stale pieceIndex를 막는다", async () => {
    resetMatches();

    const gameCore = await loadGameCore();
    const roomId = "AUTH_GAMEPLAY_SEQUENCE";
    const createResult = createMatch(createPlayingRoom(roomId));
    const hostPlayer = createResult.match.players.find((player) => {
        return player.playerId === "host-player";
    });
    const initialPieceIndex = hostPlayer.authoritativeState.pieceIndex;
    const initialCol = hostPlayer.authoritativeState.activePiece.col;

    const moveResult = applyAuthoritativeInputToMatchPlayerState(roomId, "host-player", {
        action: "move_left",
        pieceIndex: initialPieceIndex,
    }, gameCore);

    assert.equal(moveResult.ok, true);
    assert.equal(moveResult.gameplayResult.moveIntent.kind, "ok");
    assert.equal(hostPlayer.authoritativeState.pieceIndex, initialPieceIndex);
    assert.equal(hostPlayer.authoritativeState.activePiece.col, initialCol - 1);

    const hardDropResult = applyAuthoritativeInputToMatchPlayerState(roomId, "host-player", {
        action: "hard_drop",
        pieceIndex: initialPieceIndex,
    }, gameCore);
    const placementResult = hardDropResult.gameplayResult.placementResult;

    assert.equal(hardDropResult.ok, true);
    assert.equal(hostPlayer.authoritativeState.pieceIndex, initialPieceIndex + 1);
    assert.equal(typeof placementResult.scoreBefore, "number");
    assert.equal(typeof placementResult.scoreAfter, "number");
    assert.equal(typeof placementResult.scoreDelta, "number");
    assert.equal(Number.isInteger(placementResult.linesCleared), true);
    assert.equal(Number.isInteger(placementResult.combo), true);
    assert.equal(typeof placementResult.backToBack, "boolean");
    assert.equal(Number.isInteger(placementResult.rawAttackLines), true);
    assert.equal(Number.isInteger(placementResult.attackLines), true);
    assert.equal(Number.isInteger(placementResult.canceledGarbageLines), true);
    assert.equal(Number.isInteger(placementResult.incomingGarbageLines), true);
    assert.equal(Number.isInteger(placementResult.appliedGarbageLines), true);
    assert.equal(Object.hasOwn(hardDropResult.gameplayResult, "presentationEffect"), false);

    const beforeStaleInputState = structuredClone(hostPlayer.authoritativeState);
    const staleResult = applyAuthoritativeInputToMatchPlayerState(roomId, "host-player", {
        action: "move_left",
        pieceIndex: initialPieceIndex,
    }, gameCore);

    assert.equal(staleResult.ok, false);
    assert.equal(staleResult.reason, "PIECE_INDEX_MISMATCH");
    assert.deepEqual(hostPlayer.authoritativeState, beforeStaleInputState);

    const matchResult = getMatchState(roomId);
    assert.equal(matchResult.ok, true);
});

test("authoritative line clear는 정확한 row와 player별 presentation effect id를 만든다", async () => {
    resetMatches();

    const gameCore = await loadGameCore();
    const roomId = "AUTH_LINE_CLEAR_PRESENTATION";
    const createResult = createMatch(createPlayingRoom(roomId));
    const hostPlayer = createResult.match.players.find((player) => {
        return player.playerId === "host-player";
    });
    hostPlayer.authoritativeState.activePiece = {
        pieceType: "square",
        rotation: 0,
        row: 0,
        col: 3,
    };
    hostPlayer.authoritativeState.pendingPiece = { ...hostPlayer.authoritativeState.activePiece };
    hostPlayer.authoritativeState.board[19] = Array(gameCore.BOARD_COLS).fill("stack");
    hostPlayer.authoritativeState.board[19][3] = null;
    hostPlayer.authoritativeState.board[19][4] = null;
    hostPlayer.authoritativeState.pieceQueue = ["tree"];
    hostPlayer.authoritativeState.pieceIndex = 7;

    const result = applyAuthoritativeInputToMatchPlayerState(roomId, "host-player", {
        action: "hard_drop",
        pieceIndex: 7,
    }, gameCore);

    assert.equal(result.ok, true);
    assert.deepEqual(result.gameplayResult.presentationEffect, {
        id: "host-player:7:line_clear",
        type: "line_clear",
        pieceIndex: 7,
        rows: [19],
        boardBeforeClear: result.gameplayResult.presentationEffect.boardBeforeClear,
    });
    assert.equal(
        result.gameplayResult.presentationEffect.boardBeforeClear[19].every(Boolean),
        true,
    );
    assert.equal(result.gameplayResult.placementResult.linesCleared, 1);
    assert.equal(
        Object.hasOwn(result.gameplayResult.placementResult, "boardBeforeClear"),
        false,
    );
    assert.equal(Object.hasOwn(hostPlayer.authoritativeState, "presentationEffect"), false);
});

test("gravity lock line clear도 match 경계에서 presentation effect id를 붙인다", async () => {
    resetMatches();

    const gameCore = await loadGameCore();
    const roomId = "AUTH_GRAVITY_LINE_CLEAR_PRESENTATION";
    const createResult = createMatch(createPlayingRoom(roomId));
    const hostPlayer = createResult.match.players.find((player) => {
        return player.playerId === "host-player";
    });
    hostPlayer.authoritativeState.activePiece = {
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 3,
    };
    hostPlayer.authoritativeState.pendingPiece = { ...hostPlayer.authoritativeState.activePiece };
    hostPlayer.authoritativeState.board[19] = Array(gameCore.BOARD_COLS).fill("stack");
    hostPlayer.authoritativeState.board[19][3] = null;
    hostPlayer.authoritativeState.board[19][4] = null;
    hostPlayer.authoritativeState.pieceQueue = ["tree"];
    hostPlayer.authoritativeState.pieceIndex = 11;

    const groundedResult = applyGravityStepToMatchPlayerState(
        roomId,
        "host-player",
        gameCore,
    );
    const result = applyGravityStepToMatchPlayerState(
        roomId,
        "host-player",
        gameCore,
        { lockGroundedPiece: true },
    );

    assert.equal(groundedResult.ok, true);
    assert.equal(groundedResult.gravityResult.kind, "grounded");
    assert.equal(groundedResult.presentationEffect, undefined);
    assert.equal(result.ok, true);
    assert.equal(result.gravityResult.kind, "lock");
    assert.equal(result.presentationEffect.id, "host-player:11:line_clear");
    assert.deepEqual(result.presentationEffect.rows, [19]);
    assert.equal(result.gravityStepResult.presentationEffect, result.presentationEffect);
});

test("getAuthoritativePlayerSnapshot은 authoritativeState 복사본을 반환한다", async () => {
    resetMatches();

    const gameCore = await loadGameCore();
    const roomId = "AUTH_SNAPSHOT_COPY";
    const createResult = createMatch(createPlayingRoom(roomId));
    const hostPlayer = createResult.match.players.find((player) => {
        return player.playerId === "host-player";
    });
    const initialPieceType = hostPlayer.authoritativeState.activePiece.pieceType;
    const initialPieceIndex = hostPlayer.authoritativeState.pieceIndex;

    const applyResult = applyAuthoritativeInputToMatchPlayerState(roomId, "host-player", {
        action: "hard_drop",
        pieceIndex: initialPieceIndex,
    }, gameCore);
    assert.equal(applyResult.ok, true);

    const snapshotResult = getAuthoritativePlayerSnapshot(roomId, "host-player");
    const snapshot = snapshotResult.snapshot;

    assert.equal(snapshotResult.ok, true);
    assert.equal(snapshotResult.reason, null);
    assert.equal(snapshot.pieceIndex, hostPlayer.authoritativeState.pieceIndex);
    assert.equal(snapshot.score, hostPlayer.authoritativeState.score);
    assert.deepEqual(snapshot.activePiece, hostPlayer.authoritativeState.activePiece);
    assert.deepEqual(snapshot.board, hostPlayer.authoritativeState.board);

    snapshot.board[19][3] = "mutated";
    snapshot.activePiece.pieceType = "mutated";
    snapshot.pendingPiece.pieceType = "mutated";
    snapshot.pieceQueue.push("mutated");
    snapshot.pendingGarbageQueue.push({ lines: 9, holeCol: 9 });

    assert.notEqual(hostPlayer.authoritativeState.board[19][3], "mutated");
    assert.notEqual(hostPlayer.authoritativeState.activePiece.pieceType, "mutated");
    assert.notEqual(hostPlayer.authoritativeState.pendingPiece.pieceType, "mutated");
    assert.equal(hostPlayer.authoritativeState.pieceQueue.includes("mutated"), false);
    assert.equal(hostPlayer.authoritativeState.pendingGarbageQueue.length, 0);
    assert.equal(hostPlayer.authoritativeState.pieceIndex, initialPieceIndex + 1);
    assert.equal(applyResult.gameplayResult.placementResult.lockedPiece.pieceType, initialPieceType);
});

test("getAuthoritativePlayerSnapshot은 match/player/state 실패 경로를 반환한다", () => {
    resetMatches();

    const missingMatchResult = getAuthoritativePlayerSnapshot("MISSING", "host-player");
    assert.deepEqual(missingMatchResult, {
        ok: false,
        match: null,
        reason: "MATCH_NOT_FOUND",
    });

    const roomId = "AUTH_SNAPSHOT_FAILURE";
    const createResult = createMatch(createPlayingRoom(roomId));
    const missingPlayerResult = getAuthoritativePlayerSnapshot(roomId, "missing-player");
    assert.deepEqual(missingPlayerResult, {
        ok: false,
        match: null,
        reason: "PLAYER_NOT_FOUND",
    });

    const hostPlayer = createResult.match.players.find((player) => {
        return player.playerId === "host-player";
    });
    hostPlayer.authoritativeState = null;

    const missingStateResult = getAuthoritativePlayerSnapshot(roomId, "host-player");
    assert.equal(missingStateResult.ok, false);
    assert.equal(missingStateResult.match.roomId, roomId);
    assert.equal(missingStateResult.reason, "AUTHORITATIVE_STATE_NOT_FOUND");
});

test("getAuthoritativePlayerSnapshotDto는 client snapshot 후보 필드와 tick을 반환한다", async () => {
    resetMatches();

    const gameCore = await loadGameCore();
    const roomId = "AUTH_SNAPSHOT_DTO";
    const createResult = createMatch(createPlayingRoom(roomId));
    const hostPlayer = createResult.match.players.find((player) => {
        return player.playerId === "host-player";
    });
    const initialPieceIndex = hostPlayer.authoritativeState.pieceIndex;

    const applyResult = applyAuthoritativeInputToMatchPlayerState(roomId, "host-player", {
        action: "hard_drop",
        pieceIndex: initialPieceIndex,
    }, gameCore);
    assert.equal(applyResult.ok, true);

    const internalSnapshotResult = getAuthoritativePlayerSnapshot(roomId, "host-player");
    const dtoResult = getAuthoritativePlayerSnapshotDto(roomId, "host-player");
    const dto = dtoResult.snapshot;

    assert.equal(dtoResult.ok, true);
    assert.equal(dtoResult.reason, null);
    assert.equal(dto.tick, hostPlayer.authoritativeState.currentTick);
    assert.equal(Object.hasOwn(dto, "currentTick"), false);
    assert.equal(Object.hasOwn(dto, "pendingPiece"), false);
    assert.equal(Object.hasOwn(dto, "pendingGarbageQueue"), false);
    assert.equal(Object.hasOwn(dto, "pendingGarbageLines"), true);
    assert.equal(Object.hasOwn(dto, "lastActionWasRotation"), false);
    assert.deepEqual(Object.keys(dto), [
        "board",
        "activePiece",
        "pieceQueue",
        "holdPieceType",
        "holdUsedThisDrop",
        "score",
        "lines",
        "phase",
        "gameOver",
        "combo",
        "backToBack",
        "tick",
        "pieceIndex",
        "pendingGarbageLines",
        "lastProcessedClientSequence",
    ]);
    assert.equal(dto.pieceIndex, hostPlayer.authoritativeState.pieceIndex);
    assert.equal(dto.lastProcessedClientSequence, 0);
    assert.equal(dto.gameOver, false);
    assert.equal(dto.score, hostPlayer.authoritativeState.score);
    assert.deepEqual(dto.activePiece, hostPlayer.authoritativeState.activePiece);
    assert.equal(internalSnapshotResult.snapshot.currentTick, hostPlayer.authoritativeState.currentTick);

    dto.board[19][3] = "mutated";
    dto.activePiece.pieceType = "mutated";
    dto.pieceQueue.push("mutated");

    assert.notEqual(hostPlayer.authoritativeState.board[19][3], "mutated");
    assert.notEqual(hostPlayer.authoritativeState.activePiece.pieceType, "mutated");
    assert.equal(hostPlayer.authoritativeState.pieceQueue.includes("mutated"), false);
});

test("getAuthoritativePlayerSnapshotDto는 snapshot 조회와 같은 실패 경로를 반환한다", () => {
    resetMatches();

    assert.deepEqual(getAuthoritativePlayerSnapshotDto("MISSING", "host-player"), {
        ok: false,
        match: null,
        reason: "MATCH_NOT_FOUND",
    });

    const roomId = "AUTH_SNAPSHOT_DTO_FAILURE";
    const createResult = createMatch(createPlayingRoom(roomId));
    assert.deepEqual(getAuthoritativePlayerSnapshotDto(roomId, "missing-player"), {
        ok: false,
        match: null,
        reason: "PLAYER_NOT_FOUND",
    });

    const hostPlayer = createResult.match.players.find((player) => {
        return player.playerId === "host-player";
    });
    hostPlayer.authoritativeState = null;

    const missingStateResult = getAuthoritativePlayerSnapshotDto(roomId, "host-player");
    assert.equal(missingStateResult.ok, false);
    assert.equal(missingStateResult.match.roomId, roomId);
    assert.equal(missingStateResult.reason, "AUTHORITATIVE_STATE_NOT_FOUND");
});
