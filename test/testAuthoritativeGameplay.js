const test = require("node:test");
const assert = require("node:assert/strict");

const {
    applyAuthoritativeInputToMatchPlayerState,
    createMatch,
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

    const beforeStaleInputState = structuredClone(hostPlayer.authoritativeState);
    const staleResult = applyAuthoritativeInputToMatchPlayerState(roomId, "host-player", {
        action: "move_left",
        pieceIndex: initialPieceIndex,
    }, gameCore);

    assert.equal(staleResult.ok, false);
    assert.equal(staleResult.reason, "PIECE_INDEX_MISMATCH");
    assert.deepEqual(hostPlayer.authoritativeState, beforeStaleInputState);
    assert.deepEqual(hostPlayer.inputLog, []);

    const matchResult = getMatchState(roomId);
    assert.equal(matchResult.ok, true);
    assert.deepEqual(matchResult.match.players[0].inputLog, []);
});
