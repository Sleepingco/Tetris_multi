/** 같은 버퍼 fixture를 실제 클라이언트 예측·서버 판정·로그 저장 경계에 연결한다. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fixture = require("./fixtures/top-out-buffer-zone.json");
const { loadGameCore } = require("../dist/server/server/services/gameCoreLoader.js");
const { createMatch, resetMatches } = require("../dist/server/server/services/matchService.js");
const { applyAuthoritativeInput } = require("../dist/server/server/services/playerGameplayStep.js");
const { validatePlacementDecisionLog } = require("../dist/server/server/validators/gameLogValidator.js");
const { projectGameEventLog } = require("../dist/server/server/services/gameEventProjector.js");

function createBoard(scenario = {}) {
    const board = Array.from({ length: 40 }, () => Array(10).fill(null));
    for (const { row, exceptCols } of scenario.filledRows ?? []) {
        board[row] = board[row].map((_, col) => exceptCols.includes(col) ? null : "tree");
    }
    for (const [row, col] of scenario.filledCells ?? []) board[row][col] = "tree";
    return board;
}

async function createRuntimeHarness(t, mode, scenario) {
    let now = 0;
    let interval;
    t.mock.method(globalThis, "setInterval", callback => { interval = callback; return 1; });
    t.mock.method(globalThis, "clearInterval", () => {});
    t.mock.method(performance, "now", () => now);
    const originalAudio = globalThis.Audio;
    const originalStorage = globalThis.localStorage;
    globalThis.Audio = class { play() { return Promise.resolve(); } pause() {} };
    globalThis.localStorage = { getItem() { return null; }, setItem() {} };
    const { createTetrisRuntime } = await import("../src/client/game/runtime/tetris.ts");
    const game = createTetrisRuntime({ mode, gameId: "00000000-0000-4000-8000-000000000001",
        roomId: "ABCDEF12", playerId: "00000000-0000-4000-8000-000000000002" });
    game.init({ autoStart: false });
    if (scenario) game.applySnapshot({ ...game.getSnapshot(), board: createBoard(scenario),
        activePiece: { ...scenario.piece }, pieceQueue: ["tree", "bar"], pieceIndex: 1,
    }, { resumeGravity: true });
    t.after(() => { game.destroy(); globalThis.Audio = originalAudio; globalThis.localStorage = originalStorage; });
    return {
        game,
        act(action) { game.enqueueInput(action); now += 16; interval(); },
        advance(elapsedMs) { now += elapsedMs; interval(); },
    };
}

for (const scenario of fixture.locks) {
    test(`동일 fixture의 싱글·멀티 예측·서버 고정과 v3 로그: ${scenario.id}`, async t => {
        const core = await loadGameCore();
        resetMatches();
        const match = createMatch({ roomId: "ABCDEF12", mode: "pvp", status: "playing",
            players: [{ playerId: "human", playerType: "human" }] }).match;
        const state = match.players[0].authoritativeState;
        Object.assign(state, { board: createBoard(scenario), activePiece: { ...scenario.piece },
            pendingPiece: { ...scenario.piece }, pieceQueue: ["tree", "bar"], pieceIndex: 1,
            lockDelay: core.createLockDelay(scenario.piece.row),
            pendingGarbageQueue: scenario.pendingGarbageLines ? [{ lines: scenario.pendingGarbageLines, holeCol: 4 }] : [],
        });
        const server = applyAuthoritativeInput(state, { action: "hard_drop" }, core);
        assert.equal(server.placementResult.gameOver, scenario.expected.lockOut);
        for (const mode of ["single", "multi"]) await t.test(mode, async subtest => {
            const { game, act } = await createRuntimeHarness(subtest, mode, scenario);
            act("hard_drop");
            assert.deepEqual(game.getSnapshot().board, state.board);
            assert.equal(game.getSnapshot().score, state.score);
            assert.equal(game.getSnapshot().phase, state.phase);
            const logs = game.getPlacementDecisionLog();
            assert.equal(logs.length, 1);
            const log = logs[0];
            assert.equal(log.schemaVersion, 3);
            assert.equal(log.observation.stage, scenario.expected.lockOut ? "lock_commit" : "post_line_clear");
            assert.equal(log.observation.nextSpawnOutcome, "not_evaluated");
            assert.equal(validatePlacementDecisionLog(log).ok, true);
            if (mode === "multi") {
                const projected = projectGameEventLog({ ...log, authoritativeClientSequence: 1, authoritativePieceIndex: 1 });
                assert.equal(projected.schemaVersion, 3);
                assert.equal(projected.payload.geometry.rows, 40);
                assert.equal(projected.trustLevel, "client_reported");
            }
        });
    });
}

test("7종 최초·다음·hold 생성은 공용 생성 함수와 일치하고 최초 충돌을 하강으로 우회하지 않는다", async t => {
    const core = await loadGameCore();
    const { game, act } = await createRuntimeHarness(t, "single");
    for (const spawn of fixture.spawnPieces) {
        game.init({ autoStart: true, serverBagChunks: [[spawn.pieceType, "tree", "bar", "square", "zee", "ess", "eright"]] });
        assert.deepEqual(game.getSnapshot().activePiece, core.getSpawnedPiece(createBoard(), spawn.pieceType));
        game.applySnapshot({ ...game.getSnapshot(), holdPieceType: spawn.pieceType, holdUsedThisDrop: false,
            pieceQueue: [spawn.pieceType, "bar", "tree"] });
        act("hold");
        assert.deepEqual(game.getSnapshot().activePiece, core.getSpawnedPiece(createBoard(), spawn.pieceType));
        act("hard_drop");
        assert.deepEqual(game.getSnapshot().activePiece, core.getSpawnedPiece(game.getSnapshot().board, spawn.pieceType));
        for (const scenario of fixture.spawnCases.filter(item => item.pieceType === spawn.pieceType)) {
            const spawned = core.getSpawnedPiece(createBoard(scenario), spawn.pieceType);
            assert.equal(spawned !== null, scenario.expected.canSpawn);
            if (spawned) assert.equal(spawned.row, scenario.expected.canDescend ? 19 : 18);
        }
    }
});

for (const scenario of fixture.nextSpawnCases) {
    test(`AI와 서버가 실제 다음 생성 충돌을 동일하게 판정한다: ${scenario.id}`, async () => {
        const core = await loadGameCore();
        const { simulatePlacement } = await import("../src/client/game/ai/heuristic/simulatePlacement.ts");
        const board = createBoard({ filledCells: [[21, 3], [21, 4]],
            filledRows: scenario.clearRow ? [{ row: 20, exceptCols: [3, 4] }] : [] });
        const piece = { pieceType: "square", rotation: 0, row: 19, col: 3 };
        const state = { board: structuredClone(board), activePiece: piece, pendingPiece: piece,
            pieceQueue: ["tree"], phase: "playing", score: 0, lines: 0, pieceIndex: 1,
            combo: -1, backToBack: false, pendingGarbageQueue: [], lockDelay: core.createLockDelay(19) };
        const simulation = simulatePlacement(board, piece, { nextPieceType: "tree", pendingGarbageQueue: [] });
        const server = applyAuthoritativeInput(state, { action: "hard_drop" }, core);
        assert.deepEqual(simulation.boardAfter, state.board);
        assert.equal(simulation.gameOver, server.placementResult.gameOver);
        assert.equal(simulation.gameOver, scenario.expected.gameOver);
        assert.equal(simulation.nextSpawnOutcome, scenario.expected.canSpawnNext ? "clear" : "blocked");
        assert.equal(simulatePlacement(board, piece, { nextPieceType: "tree" }).nextSpawnOutcome, "not_evaluated");
        assert.equal(simulatePlacement(board, piece).gameOver, false);
    });
}

test("AI simulation은 서버와 같은 가비지 상쇄·적용 뒤 천장 overflow와 next를 검사한다", async () => {
    const core = await loadGameCore();
    const { simulatePlacement } = await import("../src/client/game/ai/heuristic/simulatePlacement.ts");
    for (const occupiedRow of [0, 16, 20]) {
        const board = createBoard({ filledCells: [[occupiedRow, 0]] });
        const piece = { pieceType: "square", rotation: 0, row: 38, col: 3 };
        const queue = [{ lines: 1, holeCol: 4 }];
        const original = structuredClone(queue);
        const context = { nextPieceType: "bar", pendingGarbageQueue: queue, combo: -1, backToBack: false };
        const simulation = simulatePlacement(board, piece, context);
        const state = { board: structuredClone(board), activePiece: piece, pendingPiece: piece,
            pieceQueue: ["bar"], phase: "playing", score: 0, lines: 0, pieceIndex: 1,
            combo: -1, backToBack: false, pendingGarbageQueue: structuredClone(queue), lockDelay: core.createLockDelay(38) };
        const server = applyAuthoritativeInput(state, { action: "hard_drop" }, core);
        assert.equal(simulation.gameOver, server.placementResult.gameOver);
        assert.deepEqual(simulation.boardAfter, state.board);
        assert.deepEqual(queue, original);
        assert.equal(simulation.gameOver, occupiedRow === 0);
    }
});

test("V4 adapter는 40행에서 후보 변환·모델 추론 전에 명시적으로 폴백한다", async () => {
    const { getPlacementV4PveDecision } = await import("../src/client/game/ai/ml/placementV4PveDecisionAdapter.ts");
    const { rankPlacements } = await import("../src/client/game/ai/heuristic/heuristicEvaluator.ts");
    const core = await loadGameCore();
    const board = createBoard();
    const activePiece = core.getSpawnedPiece(board, "square");
    let scorerCalls = 0;
    const result = getPlacementV4PveDecision(null, { board, activePiece }, {
        rankPlacementV4Candidates() { scorerCalls++; throw new Error("must not score"); },
    });
    assert.equal(result.policyUsed, "heuristic");
    assert.equal(result.fallbackReason, "RULESET_INCOMPATIBLE");
    assert.equal(scorerCalls, 0);
    assert.equal(rankPlacements(board, activePiece).length > 0, true);
});

test("AI의 Tetris·Mini 후보는 실제 입력 재생과 같은 공격 상쇄·가비지·다음 생성 결과를 평가한다", async () => {
    const core = await loadGameCore();
    const { rankPlacements } = await import("../src/client/game/ai/heuristic/heuristicEvaluator.ts");
    const scenarios = [
        { activePiece: { pieceType: "bar", rotation: 1, row: 36, col: 2 },
            board: createBoard({ filledRows: [36, 37, 38, 39].map(row => ({ row, exceptCols: [4] })) }),
            lines: 4, tSpinType: "none", canceled: 4, incoming: 5 },
        { activePiece: { pieceType: "tree", rotation: 3, row: 37, col: 3 },
            board: createBoard({ filledRows: [{ row: 38, exceptCols: [3, 4, 5] }], filledCells: [[37, 3], [39, 3], [39, 5]] }),
            lines: 1, tSpinType: "mini", canceled: 1, incoming: 2 },
    ];
    for (const scenario of scenarios) {
        const pendingGarbageQueue = [{ lines: scenario.incoming, holeCol: 9 }];
        const context = { pendingGarbageQueue, nextPieceType: "bar", combo: -1, backToBack: false };
        const ranked = rankPlacements(scenario.board, scenario.activePiece, context);
        const candidate = ranked.find(item => item.linesCleared === scenario.lines && item.placement.col === scenario.activePiece.col
            && item.placement.rotation === (scenario.tSpinType === "mini" ? 0 : 1));
        assert.ok(candidate);
        const state = { board: structuredClone(scenario.board), activePiece: { ...scenario.activePiece },
            pendingPiece: { ...scenario.activePiece }, pieceQueue: ["bar"], phase: "playing", score: 0, lines: 0, pieceIndex: 1,
            combo: -1, backToBack: false, pendingGarbageQueue: structuredClone(pendingGarbageQueue),
            spinRotation: null, lockDelay: core.createLockDelay(scenario.activePiece.row) };
        let actual;
        for (const action of candidate.plannedActions) actual = applyAuthoritativeInput(state, { action }, core);
        assert.equal(actual.placementResult.tSpinType, scenario.tSpinType);
        assert.equal(actual.placementResult.canceledGarbageLines, scenario.canceled);
        assert.equal(actual.placementResult.appliedGarbageLines, 1);
        assert.equal(candidate.gameOver, actual.placementResult.gameOver);
        assert.equal(candidate.nextSpawnOutcome, "clear");
        assert.deepEqual(candidate.boardAfter, state.board);
    }
});

test("AI는 next 또는 공격 문맥이 불완전하면 다음 생성의 종료를 확정하지 않는다", async () => {
    const { simulatePlacement } = await import("../src/client/game/ai/heuristic/simulatePlacement.ts");
    const { getHeuristicDecision } = await import("../src/client/game/ai/heuristic/heuristicEvaluator.ts");
    const board = createBoard({ filledCells: [[21, 3], [21, 4]] });
    const piece = { pieceType: "square", rotation: 0, row: 19, col: 3 };
    const result = simulatePlacement(board, piece, { nextPieceType: "tree", pendingGarbageQueue: [{ lines: 1, holeCol: 0 }] });
    assert.equal(result.gameOver, false);
    assert.equal(result.nextSpawnOutcome, "not_evaluated");
    const invalid = getHeuristicDecision({ board, activePiece: piece, nextQueue: ["invalid"] });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.errorCode, "INVALID_GAME_STATE");
});

for (const entrypoint of ["next", "hold"]) {
    test(`싱글의 하강 불가 ${entrypoint} spawn은 유예 뒤 종료를 HUD에 발행한다`, async t => {
        const core = await loadGameCore();
        const scenario = { filledCells: [[20, 4]],
            piece: { pieceType: "square", rotation: 0, row: 38, col: 0 } };
        const { game, act, advance } = await createRuntimeHarness(t, "single", scenario);
        if (entrypoint === "hold") {
            game.applySnapshot({ ...game.getSnapshot(), holdPieceType: "tree" });
            act("hold");
        } else {
            act("hard_drop");
        }
        const spawned = game.getSnapshot();
        assert.deepEqual(spawned.activePiece, core.getSpawnedPiece(spawned.board, "tree"));
        assert.equal(spawned.activePiece.row, 18);
        assert.equal(spawned.lockDelay.hasTouchedGround, true);
        assert.equal(spawned.phase, "playing");
        const phases = [];
        game.subscribeDisplay(() => phases.push(game.getDisplaySnapshot().phase));
        advance(499);
        assert.equal(game.getSnapshot().phase, "playing");
        assert.equal(game.getSnapshot().lockDelay.remainingMs, 1);
        advance(1);
        assert.equal(game.getSnapshot().phase, "gameOver");
        assert.equal(game.getDisplaySnapshot().phase, "gameOver");
        assert.deepEqual(phases, ["gameOver"]);
        assert.equal(game.runtime.inputTimer, undefined);
        assert.equal(game.getPlacementDecisionLog().at(-1).observation.terminalOutcome, "lock_out");
        assert.equal(game.enqueueInput("move_left"), null);
        game.init({ autoStart: true });
        assert.equal(game.getDisplaySnapshot().phase, "playing");
        assert.notEqual(game.enqueueInput("move_left"), null);
    });
}

test("싱글의 하강 불가 spawn도 고정 유예 중에는 좌우 이동으로 빠져나올 수 있다", async t => {
    const scenario = { filledCells: [[20, 4]], piece: { pieceType: "square", rotation: 0, row: 38, col: 0 } };
    const { game, act, advance } = await createRuntimeHarness(t, "single", scenario);
    act("hard_drop");
    advance(200);
    act("move_left");
    act("move_left");
    assert.equal(game.getSnapshot().activePiece.col, 1);
    assert.equal(game.getSnapshot().activePiece.row, 18);
    advance(500);
    assert.equal(game.getSnapshot().phase, "playing");
    assert.equal(game.getDisplaySnapshot().phase, "playing");
    assert.equal(game.getSnapshot().activePiece.row, 19);
    assert.equal(game.getPlacementDecisionLog().length, 1);
});
