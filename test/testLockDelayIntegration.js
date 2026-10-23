const test = require("node:test");
const assert = require("node:assert/strict");
const { loadGameCore } = require("../dist/server/server/services/gameCoreLoader.js");
const { applyAuthoritativeInput, applyAuthoritativeGravityStep } = require("../dist/server/server/services/playerGameplayStep.js");
const { createAuthoritativeTickerService } = require("../dist/server/server/services/authoritativeTickerService.js");
const { createMatch, getAuthoritativePlayerSnapshotDto, resetMatches,
    applyAuthoritativeInputToMatchPlayerState } = require("../dist/server/server/services/matchService.js");

/** 같은 가상 시계로 브라우저 tick과 실제 서버 ticker를 구동한다. */
test("싱글·멀티 예측·서버는 벽차기 순환을 고정하고 최대 15회만 연장한다", async () => {
    const core = await loadGameCore();
    globalThis.localStorage = { getItem() { return null; }, setItem() {} };
    globalThis.Audio = class { play() { return Promise.resolve(); } pause() {} };
    const { createTetrisRuntime } = await import("../src/client/game/runtime/tetris.ts");
    const oldSetInterval = globalThis.setInterval;
    const oldClearInterval = globalThis.clearInterval;
    const oldNow = Object.getOwnPropertyDescriptor(performance, "now");
    let time = 0;
    let callback;
    globalThis.setInterval = fn => { callback = fn; return 1; };
    globalThis.clearInterval = () => {};
    Object.defineProperty(performance, "now", { configurable: true, value: () => time });
    try {
        for (const layer of ["single", "multi", "server"]) {
            for (const pieceType of ["bar", "square"]) {
                time = 0;
                const piece = { pieceType, rotation: 0, row: 38, col: 3 };
                let game;
                let ticker;
                let state;
                let act;
                let advance;
                let snapshot;
                if (layer === "server") {
                    resetMatches();
                    const match = createMatch({ roomId: "LOCKTEST", mode: "pvp", status: "playing",
                        players: [{ playerId: "human", nickname: "test", role: "host" }] }).match;
                    const player = match.players[0];
                    state = player.authoritativeState;
                    Object.assign(state, { activePiece: piece, pendingPiece: { ...piece },
                        lockDelay: core.updateLockDelay(core.createLockDelay(38), 38, true),
                        pieceQueue: ["tree", "square"] });
                    player.lockUpdatedAt = time;
                    ticker = createAuthoritativeTickerService({
                        setIntervalFn() { return { unref() {} }; }, clearIntervalFn() {},
                        loadGameCore: async () => core,
                        saveGameEventLog: async () => ({ ok: true }),
                    });
                    const server = { to() { return { emit() {} }; } };
                    ticker.startRoomTicker("LOCKTEST", server);
                    act = action => applyAuthoritativeInputToMatchPlayerState("LOCKTEST", "human",
                        { action, pieceIndex: 1, tick: 0 }, core);
                    advance = async ms => { time += ms; await ticker.tickRoom("LOCKTEST", server, ms); };
                    snapshot = () => ({ ...state });
                } else {
                    game = createTetrisRuntime({ mode: layer, rng: () => 0 });
                    game.init({ autoStart: false });
                    game.applySnapshot({ ...game.getSnapshot(), activePiece: piece, pendingPiece: { ...piece },
                        pieceIndex: 1, pieceQueue: ["tree", "square"], phase: "playing" }, { resumeGravity: true });
                    act = action => game.enqueueInput(action);
                    advance = async ms => { time += ms; callback(); };
                    snapshot = () => game.getSnapshot();
                }
                try {
                    let maxResets = 0;
                    let rotations = 0;
                    for (let tick = 0; tick < 40 && snapshot().pieceIndex === 1; tick++) {
                        if (pieceType === "square") {
                            act("rotate");
                            rotations++;
                        } else if (snapshot().activePiece.row === 38) {
                            act("rotate");
                            act("rotate_ccw");
                            rotations += 2;
                        }
                        await advance(100);
                        if (snapshot().pieceIndex === 1) maxResets = Math.max(maxResets, snapshot().lockDelay.resetCount);
                    }
                    assert.equal(snapshot().pieceIndex, 2, `${layer}/${pieceType} still alive`);
                    assert.equal(snapshot().board.flat().filter(Boolean).length, 4);
                    assert.ok(time < 4000);
                    if (pieceType === "square") {
                        assert.equal(maxResets, 15);
                        assert.ok(rotations > 15, "input remains allowed after the reset cap");
                    }
                } finally {
                    game?.destroy();
                    ticker?.stopAllRoomTickers();
                }
            }
        }
        const game = createTetrisRuntime({ rng: () => 0 });
        try {
            time = 0;
            game.init({ autoStart: false });
            const piece = { pieceType: "square", rotation: 0, row: 38, col: 3 };
            game.applySnapshot({ ...game.getSnapshot(), activePiece: piece, pendingPiece: { ...piece },
                pieceIndex: 1, pieceQueue: ["tree"],
                lockDelay: { hasTouchedGround: true, remainingMs: 120, resetCount: 15, lowestRow: 38 } },
            { resumeGravity: true });
            time += 119;
            callback();
            assert.equal(game.getSnapshot().lockDelay.remainingMs, 1);
            game.syncActivePieceState({ ...game.getSnapshot(), lockDelay: {
                hasTouchedGround: true, remainingMs: 500, resetCount: 15, lowestRow: 38 } });
            assert.equal(game.getSnapshot().lockDelay.remainingMs, 1);
            game.applySnapshot(game.getSnapshot(), { resumeGravity: true });
            time++;
            callback();
            assert.equal(game.getSnapshot().pieceIndex, 2);
        } finally { game.destroy(); }
    } finally {
        globalThis.setInterval = oldSetInterval;
        globalThis.clearInterval = oldClearInterval;
        if (oldNow) Object.defineProperty(performance, "now", oldNow);
        else delete performance.now;
        resetMatches();
    }
});

test("막힌 soft drop은 즉시 고정하지 않으며 만료 후 입력은 다음 조각에 적용하지 않는다", async () => {
    const core = await loadGameCore();
    const piece = { pieceType: "square", rotation: 0, row: 38, col: 3 };
    const state = { board: core.createEmptyBoard(40, 10), activePiece: piece, pendingPiece: { ...piece },
        pieceQueue: ["tree"], holdPieceType: null, holdUsedThisDrop: false, score: 0, lines: 0,
        phase: "playing", gameOver: false, combo: -1, backToBack: false,
        currentTick: 0, pieceIndex: 1, pendingGarbageQueue: [], spinRotation: null,
        lockDelay: core.createLockDelay(18) };
    assert.equal(applyAuthoritativeInput(state, { action: "soft_drop" }, core).placementResult, undefined);
    assert.equal(state.lockDelay.remainingMs, 500);
    applyAuthoritativeGravityStep(state, core, { gravityDue: false, elapsedMs: 499 });
    assert.equal(state.pieceIndex, 1);
    state.lockDelay.remainingMs = 0;
    const result = applyAuthoritativeInput(state, { action: "rotate" }, core);
    assert.ok(result.placementResult);
    assert.equal(state.activePiece.rotation, 0);
    assert.equal(state.pieceIndex, 2);
});

test("snapshot은 서버 유예의 복사본이며 reconnect 조회로 예산을 복구하지 않는다", async () => {
    const core = await loadGameCore();
    resetMatches();
    try {
        const match = createMatch({ roomId: "LOCKJOIN", mode: "pvp", status: "playing",
            players: [{ playerId: "human", nickname: "test", role: "host" }] }).match;
        const state = match.players[0].authoritativeState;
        state.lockDelay = { hasTouchedGround: true, remainingMs: 42, resetCount: 15, lowestRow: 38 };
        state.spinRotation = { lastKickIndex: 0, usedKick5: true };
        const first = getAuthoritativePlayerSnapshotDto("LOCKJOIN", "human").snapshot;
        assert.deepEqual(first.lockDelay, state.lockDelay);
        first.lockDelay.resetCount = 0;
        first.spinRotation.usedKick5 = false;
        assert.deepEqual(state.spinRotation, { lastKickIndex: 0, usedKick5: true });
        assert.deepEqual(getAuthoritativePlayerSnapshotDto("LOCKJOIN", "human").snapshot.spinRotation,
            { lastKickIndex: 0, usedKick5: true });
        assert.equal(state.lockDelay.resetCount, 15);
        assert.equal(getAuthoritativePlayerSnapshotDto("LOCKJOIN", "human").snapshot.lockDelay.remainingMs, 42);
        assert.equal(core.shouldLockPiece(state.lockDelay, true), false);
    } finally { resetMatches(); }
});
