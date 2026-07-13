const test = require("node:test");
const assert = require("node:assert/strict");

const { loadGameCore } = require("../src/server/services/gameCoreLoader.js");
const {
    applyAuthoritativeInputToMatchPlayerState,
    createMatch,
    getAuthoritativePlayerSnapshot,
    getMatchState,
    resetMatches,
} = require("../src/server/services/matchService.js");
const { createPveAiPlayerService } = require(
    "../src/server/services/pveAiPlayerService.js"
);
const { validatePlacementDecisionLog } = require(
    "../src/server/validators/gameLogValidator.js"
);

function createPveMatch(roomId) {
    return createMatch({
        roomId,
        mode: "pve",
        status: "playing",
        players: [
            { playerId: "human", playerType: "human" },
            { playerId: "ai", playerType: "heuristic_ai" },
        ],
    }).match;
}

async function processUntilPlacement(service, roomId, gameCore, maxSteps = 100) {
    const results = [];
    for (let step = 0; step < maxSteps; step += 1) {
        const result = await service.processAiStep(roomId, "ai", gameCore);
        results.push(result);
        if (result.placementResult || result.gameOver) {
            return { result, results };
        }
    }
    throw new Error(`AI did not finish a placement within ${maxSteps} steps`);
}

function createMetrics(board) {
    const columns = board[0]?.length ?? 0;
    return {
        columnHeights: Array(columns).fill(0),
        aggregateHeight: 0,
        maxHeight: 0,
        holes: 0,
        bumpiness: 0,
        completeLines: 0,
    };
}

function createDecision({ selectedPlacement, plannedActions }) {
    return {
        ok: true,
        source: "heuristic_ai",
        modelType: "heuristic",
        selectedPlacement,
        plannedActions,
        score: 10,
        candidateCount: 1,
        metricsBefore: createMetrics(Array.from({ length: 20 }, () => Array(10).fill(null))),
        metricsAfter: createMetrics(Array.from({ length: 20 }, () => Array(10).fill(null))),
        reason: {
            linesCleared: 0,
            holesDelta: 0,
            bumpinessDelta: 0,
            aggregateHeightDelta: 0,
            maxHeightDelta: 0,
        },
    };
}

function createStubAi(decision) {
    return async () => ({
        getHeuristicDecision() {
            return structuredClone(decision);
        },
        getBoardMetrics: createMetrics,
    });
}

function setActivePiece(match, piece) {
    const aiPlayer = match.players.find(player => player.playerId === "ai");
    aiPlayer.authoritativeState.activePiece = { ...piece };
    aiPlayer.authoritativeState.pendingPiece = { ...piece };
    aiPlayer.authoritativeState.pieceQueue = ["tree", "bar"];
    aiPlayer.authoritativeState.pieceIndex = 1;
    return aiPlayer;
}

test("AI step은 plan을 먼저 만들고 action을 하나씩 적용한 뒤 log를 저장한다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    const match = createPveMatch("PVE-AI-1");
    const aiPlayer = match.players.find(player => player.playerId === "ai");
    const aiStateBefore = structuredClone(aiPlayer.authoritativeState);
    const humanBefore = structuredClone(
        match.players.find(player => player.playerId === "human").authoritativeState,
    );
    const pieceIndexBefore = aiPlayer.authoritativeState.pieceIndex;
    const savedLogs = [];
    const service = createPveAiPlayerService({
        savePlacementDecisionLog(log) {
            savedLogs.push(log);
            return { ok: true, log, reason: null };
        },
    });

    const planResult = await service.processAiStep("PVE-AI-1", "ai", gameCore);

    assert.equal(planResult.ok, true);
    assert.equal(planResult.skipped, true);
    assert.equal(planResult.reason, "AI_PLAN_CREATED");
    assert.deepEqual(aiPlayer.authoritativeState, aiStateBefore);
    assert.ok(aiPlayer.aiPlan);
    assert.deepEqual(Object.keys(aiPlayer.aiPlan).sort(), [
        "decision",
        "executedInputs",
        "pieceIndex",
        "remainingActions",
        "selectedPlacement",
        "stateBefore",
    ]);
    assert.equal(aiPlayer.aiPlan.pieceIndex, pieceIndexBefore);
    assert.deepEqual(aiPlayer.aiPlan.executedInputs, []);
    assert.deepEqual(aiPlayer.aiPlan.stateBefore, aiStateBefore);
    const plannedActions = [...aiPlayer.aiPlan.remainingActions];

    const { result, results } = await processUntilPlacement(
        service,
        "PVE-AI-1",
        gameCore,
    );

    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    assert.equal(results.every(step => step.skipped || step.action), true);
    assert.equal(aiPlayer.authoritativeState.pieceIndex, pieceIndexBefore + 1);
    assert.ok(aiPlayer.authoritativeState.board.flat().some(cell => cell !== null));
    assert.deepEqual(
        match.players.find(player => player.playerId === "human").authoritativeState,
        humanBefore,
    );
    assert.equal(savedLogs.length, 1);
    assert.equal(savedLogs[0].schemaVersion, 2);
    assert.equal(savedLogs[0].source, "heuristic_ai");
    assert.equal(savedLogs[0].modelType, "heuristic");
    assert.equal(savedLogs[0].pieceIndex, pieceIndexBefore);
    assert.equal(savedLogs[0].evaluation.candidateCount > 0, true);
    assert.equal(result.decision.plannedActions.at(-1), "hard_drop");
    assert.deepEqual(
        savedLogs[0].inputSequence.map(input => input.action),
        plannedActions,
    );
    assert.deepEqual(
        savedLogs[0].inputSequence.map(input => input.sequence),
        plannedActions.map((_, index) => index + 1),
    );
    assert.equal(savedLogs[0].inputSequence.every(input => input.pieceIndex === pieceIndexBefore), true);
    assert.equal(aiPlayer.aiPlan, null);
    assert.ok(savedLogs[0].metricsBefore);
    assert.ok(savedLogs[0].metricsAfter);
    assert.equal(savedLogs[0].aiComparison, undefined);
    const { getBoardMetrics } = await import(
        "../src/client/game/core/boardMetrics.js"
    );
    assert.deepEqual(savedLogs[0].metricsBefore, getBoardMetrics(aiStateBefore.board));
    assert.deepEqual(savedLogs[0].metricsAfter, getBoardMetrics(savedLogs[0].boardAfter));
    assert.equal(validatePlacementDecisionLog(savedLogs[0]).ok, true);
});

test("AI 후보가 없으면 AI state만 gameOver로 처리한다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    const match = createPveMatch("PVE-AI-2");
    const aiPlayer = match.players.find(player => player.playerId === "ai");
    const humanPlayer = match.players.find(player => player.playerId === "human");
    aiPlayer.authoritativeState.board = Array.from(
        { length: 20 },
        () => Array(10).fill("garbage"),
    );

    const service = createPveAiPlayerService({
        savePlacementDecisionLog() {
            throw new Error("log should not be written");
        },
    });
    const result = await service.processAiStep("PVE-AI-2", "ai", gameCore);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "NO_LEGAL_PLACEMENT");
    assert.equal(result.gameOver, true);
    assert.equal(aiPlayer.authoritativeState.phase, "gameOver");
    assert.equal(aiPlayer.authoritativeState.gameOver, true);
    assert.equal(humanPlayer.authoritativeState.phase, "playing");
});

test("AI plannedActions가 잘못되면 action을 실행하지 않고 gameOver 처리한다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    const match = createPveMatch("PVE-AI-INVALID-PLAN");
    const aiPlayer = match.players.find(player => player.playerId === "ai");
    const decision = createDecision({
        selectedPlacement: { pieceType: "square", rotation: 0, row: 18, col: 3 },
        plannedActions: ["hard_drop", "move_left"],
    });
    let applyCallCount = 0;
    const service = createPveAiPlayerService({
        loadHeuristicAi: createStubAi(decision),
        applyInput() {
            applyCallCount += 1;
            return { ok: true };
        },
    });

    const result = await service.processAiStep(
        "PVE-AI-INVALID-PLAN",
        "ai",
        gameCore,
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "AI_INVALID_PLAN");
    assert.equal(result.gameOver, true);
    assert.equal(applyCallCount, 0);
    assert.equal(aiPlayer.aiPlan, null);
    assert.equal(aiPlayer.authoritativeState.phase, "gameOver");
});

test("AI placement log 저장 실패는 성공한 turn과 match state를 되돌리지 않는다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    createPveMatch("PVE-AI-3");
    const service = createPveAiPlayerService({
        async savePlacementDecisionLog() {
            throw new Error("disk full");
        },
    });

    const { result } = await processUntilPlacement(service, "PVE-AI-3", gameCore);
    const aiState = getAuthoritativePlayerSnapshot("PVE-AI-3", "ai").snapshot;

    assert.equal(result.ok, true);
    assert.equal(result.logResult.ok, false);
    assert.equal(result.logResult.reason, "LOG_WRITE_FAILED");
    assert.equal(aiState.phase, "playing");
    assert.equal(aiState.pieceIndex, 2);
});

test("AI action executor는 기존 authoritative line clear와 score 규칙을 사용한다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    const match = createPveMatch("PVE-AI-5");
    const aiPlayer = match.players.find(player => player.playerId === "ai");
    aiPlayer.authoritativeState.board[19] = Array(10).fill("stack");
    aiPlayer.authoritativeState.board[19][3] = null;
    aiPlayer.authoritativeState.board[19][4] = null;
    aiPlayer.authoritativeState.activePiece = {
        pieceType: "square",
        rotation: 0,
        row: -1,
        col: 3,
    };
    aiPlayer.authoritativeState.pendingPiece = {
        ...aiPlayer.authoritativeState.activePiece,
    };
    const service = createPveAiPlayerService({
        savePlacementDecisionLog(log) {
            return { ok: true, log, reason: null };
        },
    });

    const { result } = await processUntilPlacement(service, "PVE-AI-5", gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.placementResult.linesCleared, 1);
    assert.equal(aiPlayer.authoritativeState.lines, 1);
    assert.equal(aiPlayer.authoritativeState.score, 48);
    assert.equal(result.log.placementResult.scoreAfter, 48);
});

test("AI queue가 부족하면 서버가 bag을 보충하고 다음 piece를 spawn한다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    const match = createPveMatch("PVE-AI-6");
    const aiPlayer = match.players.find(player => player.playerId === "ai");
    aiPlayer.authoritativeState.pieceQueue = [];
    const bagCountBefore = aiPlayer.bagChunks.length;
    const service = createPveAiPlayerService({
        savePlacementDecisionLog(log) {
            return { ok: true, log, reason: null };
        },
    });

    const planResult = await service.processAiStep("PVE-AI-6", "ai", gameCore);
    const { result } = await processUntilPlacement(service, "PVE-AI-6", gameCore);

    assert.equal(planResult.reason, "AI_PLAN_CREATED");
    assert.equal(result.ok, true);
    assert.equal(aiPlayer.bagChunks.length, bagCountBefore + 1);
    assert.ok(aiPlayer.authoritativeState.activePiece.pieceType);
    assert.ok(aiPlayer.authoritativeState.pieceQueue.length > 0);
});

test("AI step은 move/rotate/soft_drop 중 하나만 authoritative state에 적용한다", async (t) => {
    const gameCore = await loadGameCore();
    const fixtures = [
        { action: "move_left", field: "col", expected: 2 },
        { action: "move_right", field: "col", expected: 4 },
        { action: "rotate", field: "rotation", expected: 1 },
        { action: "soft_drop", field: "row", expected: 0 },
    ];

    for (const fixture of fixtures) {
        await t.test(fixture.action, async () => {
            resetMatches();
            const match = createPveMatch(`PVE-ACTION-${fixture.action}`);
            const aiPlayer = setActivePiece(match, {
                pieceType: "tree",
                rotation: 0,
                row: -1,
                col: 3,
            });
            const decision = createDecision({
                selectedPlacement: {
                    pieceType: "tree",
                    rotation: fixture.action === "rotate" ? 1 : 0,
                    row: 18,
                    col: fixture.action === "move_left" ? 2 : 3,
                },
                plannedActions: [fixture.action, "hard_drop"],
            });
            const service = createPveAiPlayerService({
                loadHeuristicAi: createStubAi(decision),
            });

            const planResult = await service.processAiStep(
                `PVE-ACTION-${fixture.action}`,
                "ai",
                gameCore,
            );
            const stepResult = await service.processAiStep(
                `PVE-ACTION-${fixture.action}`,
                "ai",
                gameCore,
            );

            assert.equal(planResult.reason, "AI_PLAN_CREATED");
            assert.equal(stepResult.action, fixture.action);
            assert.equal(aiPlayer.authoritativeState.activePiece[fixture.field], fixture.expected);
            assert.equal(aiPlayer.authoritativeState.pieceIndex, 1);
            assert.equal(aiPlayer.authoritativeState.board.flat().every(cell => cell === null), true);
            assert.deepEqual(
                aiPlayer.aiPlan.executedInputs.map(input => input.action),
                [fixture.action],
            );
            assert.deepEqual(aiPlayer.aiPlan.remainingActions, ["hard_drop"]);
        });
    }
});

test("AI action 실패는 input을 기록하지 않고 plan을 폐기한다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    const match = createPveMatch("PVE-AI-FAIL");
    const aiPlayer = setActivePiece(match, {
        pieceType: "square",
        rotation: 0,
        row: -1,
        col: 3,
    });
    const decision = createDecision({
        selectedPlacement: { pieceType: "square", rotation: 0, row: 18, col: 2 },
        plannedActions: ["move_left", "hard_drop"],
    });
    const service = createPveAiPlayerService({
        loadHeuristicAi: createStubAi(decision),
        applyInput() {
            return { ok: false, reason: "MOVE_RETRY" };
        },
    });

    await service.processAiStep("PVE-AI-FAIL", "ai", gameCore);
    const plan = aiPlayer.aiPlan;
    const stateBefore = structuredClone(aiPlayer.authoritativeState);
    const result = await service.processAiStep("PVE-AI-FAIL", "ai", gameCore);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "MOVE_RETRY");
    assert.equal(result.replanRequired, true);
    assert.deepEqual(plan.executedInputs, []);
    assert.equal(aiPlayer.aiPlan, null);
    assert.deepEqual(aiPlayer.authoritativeState, stateBefore);

    const replanResult = await service.processAiStep("PVE-AI-FAIL", "ai", gameCore);
    assert.equal(replanResult.reason, "AI_PLAN_CREATED");
    assert.ok(aiPlayer.aiPlan);
});

test("stale AI plan은 state를 적용하지 않고 폐기한다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    const match = createPveMatch("PVE-AI-STALE");
    const aiPlayer = setActivePiece(match, {
        pieceType: "square",
        rotation: 0,
        row: -1,
        col: 3,
    });
    const decision = createDecision({
        selectedPlacement: { pieceType: "square", rotation: 0, row: 18, col: 2 },
        plannedActions: ["move_left", "hard_drop"],
    });
    const service = createPveAiPlayerService({
        loadHeuristicAi: createStubAi(decision),
    });

    await service.processAiStep("PVE-AI-STALE", "ai", gameCore);
    aiPlayer.authoritativeState.pieceIndex = 2;
    const stateBefore = structuredClone(aiPlayer.authoritativeState);
    const result = await service.processAiStep("PVE-AI-STALE", "ai", gameCore);

    assert.equal(result.ok, true);
    assert.equal(result.reason, "AI_PLAN_STALE");
    assert.equal(result.replanRequired, true);
    assert.equal(aiPlayer.aiPlan, null);
    assert.deepEqual(aiPlayer.authoritativeState, stateBefore);

    const replanResult = await service.processAiStep("PVE-AI-STALE", "ai", gameCore);
    assert.equal(replanResult.reason, "AI_PLAN_CREATED");
    assert.equal(aiPlayer.aiPlan.pieceIndex, 2);
});

test("hard_drop은 검증된 lockedPiece와 실제 성공 inputSequence로 log를 만든다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    const match = createPveMatch("PVE-AI-LOCK");
    const aiPlayer = setActivePiece(match, {
        pieceType: "square",
        rotation: 0,
        row: -1,
        col: 3,
    });
    const decision = createDecision({
        selectedPlacement: { pieceType: "square", rotation: 0, row: 18, col: 2 },
        plannedActions: ["move_left", "hard_drop"],
    });
    const savedLogs = [];
    const executedActions = [];
    let timestamp = 1000;
    const service = createPveAiPlayerService({
        loadHeuristicAi: createStubAi(decision),
        applyInput(roomId, playerId, input, core) {
            executedActions.push(input.action);
            return applyAuthoritativeInputToMatchPlayerState(
                roomId,
                playerId,
                input,
                core,
            );
        },
        now() {
            timestamp += 1;
            return timestamp;
        },
        savePlacementDecisionLog(log) {
            savedLogs.push(log);
            return { ok: true, log, reason: null };
        },
    });

    await service.processAiStep("PVE-AI-LOCK", "ai", gameCore);
    const stateBefore = structuredClone(aiPlayer.aiPlan.stateBefore);
    const moveResult = await service.processAiStep("PVE-AI-LOCK", "ai", gameCore);
    const lockResult = await service.processAiStep("PVE-AI-LOCK", "ai", gameCore);

    assert.equal(moveResult.action, "move_left");
    assert.equal(moveResult.placementResult, null);
    assert.equal(lockResult.action, "hard_drop");
    assert.deepEqual(lockResult.placementResult.lockedPiece, {
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 2,
    });
    assert.equal(aiPlayer.authoritativeState.pieceIndex, 2);
    assert.equal(aiPlayer.aiPlan, null);
    assert.deepEqual(executedActions, ["move_left", "hard_drop"]);
    assert.equal(savedLogs.length, 1);
    assert.deepEqual(savedLogs[0].selectedPlacement, {
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 2,
        cells: [
            { row: 18, col: 2 },
            { row: 18, col: 3 },
            { row: 19, col: 2 },
            { row: 19, col: 3 },
        ],
    });
    assert.deepEqual(
        savedLogs[0].inputSequence.map(input => input.action),
        ["move_left", "hard_drop"],
    );
    assert.deepEqual(
        savedLogs[0].inputSequence.map(input => input.sequence),
        [1, 2],
    );
    assert.deepEqual(savedLogs[0].boardBefore, stateBefore.board);
    assert.deepEqual(savedLogs[0].activePiece, {
        ...stateBefore.activePiece,
        cells: [
            { row: -1, col: 3 },
            { row: -1, col: 4 },
            { row: 0, col: 3 },
            { row: 0, col: 4 },
        ],
    });
    assert.deepEqual(aiPlayer.authoritativeState.board, savedLogs[0].boardAfter);
    assert.notDeepEqual(savedLogs[0].boardAfter, savedLogs[0].boardBefore);
    assert.equal(validatePlacementDecisionLog(savedLogs[0]).ok, true);
});

test("hard_drop 결과가 plan과 다르면 state를 되돌리지 않고 log를 저장하지 않는다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    const match = createPveMatch("PVE-AI-DIVERGED");
    const aiPlayer = setActivePiece(match, {
        pieceType: "square",
        rotation: 0,
        row: -1,
        col: 3,
    });
    const decision = createDecision({
        selectedPlacement: { pieceType: "square", rotation: 0, row: 18, col: 3 },
        plannedActions: ["hard_drop"],
    });
    let logCount = 0;
    const service = createPveAiPlayerService({
        loadHeuristicAi: createStubAi(decision),
        applyInput() {
            aiPlayer.authoritativeState.board[19][0] = "square";
            aiPlayer.authoritativeState.pieceIndex = 2;
            return {
                ok: true,
                gameplayResult: {
                    ok: true,
                    placementResult: {
                        lockedPiece: {
                            pieceType: "square",
                            rotation: 0,
                            row: 18,
                            col: 0,
                        },
                        attackLines: 0,
                        gameOver: false,
                    },
                },
            };
        },
        savePlacementDecisionLog() {
            logCount += 1;
        },
    });

    await service.processAiStep("PVE-AI-DIVERGED", "ai", gameCore);
    const result = await service.processAiStep("PVE-AI-DIVERGED", "ai", gameCore);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "AI_PLAN_DIVERGED");
    assert.equal(result.stateChanged, true);
    assert.equal(aiPlayer.authoritativeState.board[19][0], "square");
    assert.equal(aiPlayer.authoritativeState.pieceIndex, 2);
    assert.equal(aiPlayer.aiPlan, null);
    assert.equal(logCount, 0);
});

test("AI player는 human input log를 기록할 수 없다", () => {
    resetMatches();
    createPveMatch("PVE-AI-4");
    const { recordInput } = require("../src/server/services/matchService.js");

    const result = recordInput("PVE-AI-4", "ai", {
        action: "hard_drop",
        tick: 1,
        pieceIndex: 1,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "PLAYER_INPUT_NOT_ALLOWED");
    assert.deepEqual(getMatchState("PVE-AI-4").match.players[1].inputLog, []);
});
