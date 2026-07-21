const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");

const { loadGameCore } = require("../dist/server/server/services/gameCoreLoader.js");
const {
    applyAuthoritativeInputToMatchPlayerState,
    createMatch,
    getAuthoritativePlayerSnapshot,
    getMatchState,
    resetMatches,
} = require("../dist/server/server/services/matchService.js");
const { createPveAiPlayerService: createService } = require(
    "../dist/server/server/services/pveAiPlayerService.js"
);
const { validatePlacementDecisionLog } = require(
    "../dist/server/server/validators/gameLogValidator.js"
);

function createPveAiPlayerService(dependencies = {}) {
    return createService({ env: {}, ...dependencies });
}

function createPveMatch(roomId, aiDifficulty = "normal", aiPolicy = "heuristic") {
    return createMatch({
        roomId,
        mode: "pve",
        aiDifficulty,
        aiPolicy,
        status: "playing",
        players: [
            { playerId: "human", playerType: "human" },
            { playerId: "ai", playerType: "heuristic_ai" },
        ],
    }).match;
}

function createV4Match(roomId) {
    return createPveMatch(roomId, "normal", "placement_v4");
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

function createV4Decision(options) {
    return {
        ...createDecision(options),
        source: "ml_ai",
        modelType: "pairwise_linear_ranker",
        selectedClassKey: "square|18,3;18,4;19,3;19,4",
        selectedRepresentativeKey: "square:0:18:3",
        physicalClassCount: 4,
        unavoidableGameOver: false,
        policyRequested: "placement_v4",
        policyUsed: "placement_v4",
        fallbackReason: null,
    };
}

function createV4StubAi(v4Decision, heuristicDecision = v4Decision) {
    return async () => ({
        getHeuristicDecision() {
            return structuredClone(heuristicDecision);
        },
        getPlacementV4PveDecision() {
            return structuredClone(v4Decision);
        },
        validatePlacementV4Model() {
            return { ok: true, reason: null };
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
    assert.equal(planResult.decision.policyRequested, undefined);
    assert.equal(planResult.decision.policyUsed, undefined);
    assert.deepEqual(aiPlayer.authoritativeState, aiStateBefore);
    assert.ok(aiPlayer.aiPlan);
    assert.deepEqual(Object.keys(aiPlayer.aiPlan).sort(), [
        "decision",
        "executedInputs",
        "pieceIndex",
        "remainingActions",
        "selectedPlacement",
        "stateBefore",
        "terminalSoftDropsExecuted",
    ]);
    assert.equal(aiPlayer.aiPlan.pieceIndex, pieceIndexBefore);
    assert.deepEqual(aiPlayer.aiPlan.executedInputs, []);
    assert.equal(aiPlayer.aiPlan.terminalSoftDropsExecuted, 0);
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
    assert.equal(savedLogs[0].aiDifficulty, "normal");
    assert.equal(savedLogs[0].pieceIndex, pieceIndexBefore);
    assert.equal(savedLogs[0].evaluation.candidateCount > 0, true);
    assert.equal(result.decision.plannedActions.at(-1), "hard_drop");
    const expectedInputActions = [
        ...plannedActions.slice(0, -1),
        ...Array(5).fill("soft_drop"),
        "hard_drop",
    ];
    assert.deepEqual(
        savedLogs[0].inputSequence.map(input => input.action),
        expectedInputActions,
    );
    assert.deepEqual(
        savedLogs[0].inputSequence.map(input => input.sequence),
        expectedInputActions.map((_, index) => index + 1),
    );
    assert.equal(savedLogs[0].inputSequence.every(input => input.pieceIndex === pieceIndexBefore), true);
    assert.equal(aiPlayer.aiPlan, null);
    assert.ok(savedLogs[0].metricsBefore);
    assert.ok(savedLogs[0].metricsAfter);
    assert.equal(savedLogs[0].aiComparison, undefined);
    const { getBoardMetrics } = await import(
        "../src/client/game/core/boardMetrics.ts"
    );
    assert.deepEqual(savedLogs[0].metricsBefore, getBoardMetrics(aiStateBefore.board));
    assert.deepEqual(savedLogs[0].metricsAfter, getBoardMetrics(savedLogs[0].boardAfter));
    assert.equal(validatePlacementDecisionLog(savedLogs[0]).ok, true);
});

test("hard 난이도는 move와 rotate 후 terminal soft_drop 없이 hard_drop한다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    const match = createPveMatch("PVE-AI-HARD", "hard");
    const aiPlayer = setActivePiece(match, {
        pieceType: "tree",
        rotation: 0,
        row: -1,
        col: 3,
    });
    const decision = createDecision({
        selectedPlacement: { pieceType: "tree", rotation: 1, row: 17, col: 2 },
        plannedActions: ["move_left", "rotate", "hard_drop"],
    });
    const savedLogs = [];
    const service = createPveAiPlayerService({
        loadHeuristicAi: createStubAi(decision),
        savePlacementDecisionLog(log) {
            savedLogs.push(log);
            return { ok: true, log, reason: null };
        },
    });

    const planResult = await service.processAiStep("PVE-AI-HARD", "ai", gameCore);
    const { result, results } = await processUntilPlacement(
        service,
        "PVE-AI-HARD",
        gameCore,
    );

    assert.equal(planResult.reason, "AI_PLAN_CREATED");
    assert.deepEqual(results.map(step => step.action), [
        "move_left",
        "rotate",
        "hard_drop",
    ]);
    assert.deepEqual(result.placementResult.lockedPiece, {
        pieceType: "tree",
        rotation: 1,
        row: 17,
        col: 2,
    });
    assert.equal(result.placementResult.droppedRows, 18);
    assert.equal(aiPlayer.authoritativeState.score, 36);
    assert.equal(savedLogs.length, 1);
    assert.equal(savedLogs[0].aiDifficulty, "hard");
    assert.deepEqual(
        savedLogs[0].inputSequence.map(input => input.action),
        ["move_left", "rotate", "hard_drop"],
    );
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
    assert.equal(aiPlayer.authoritativeState.score, 38);
    assert.equal(result.log.placementResult.scoreAfter, 38);
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

test("terminal hard_drop 전 soft_drop 5회와 남은 거리 점수를 실제 inputSequence로 기록한다", async () => {
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
    const softDropResults = [];
    const softDropRows = [];
    for (let index = 0; index < 5; index += 1) {
        softDropResults.push(
            await service.processAiStep("PVE-AI-LOCK", "ai", gameCore),
        );
        softDropRows.push(aiPlayer.authoritativeState.activePiece.row);
    }

    assert.equal(moveResult.action, "move_left");
    assert.equal(moveResult.placementResult, null);
    assert.deepEqual(softDropResults.map(result => result.action), Array(5).fill("soft_drop"));
    assert.deepEqual(softDropRows, [0, 1, 2, 3, 4]);
    assert.deepEqual(aiPlayer.aiPlan.remainingActions, ["hard_drop"]);
    assert.equal(aiPlayer.aiPlan.terminalSoftDropsExecuted, 5);
    assert.equal(aiPlayer.authoritativeState.pieceIndex, 1);
    assert.equal(aiPlayer.authoritativeState.board.flat().every(cell => cell === null), true);

    const lockResult = await service.processAiStep("PVE-AI-LOCK", "ai", gameCore);

    assert.equal(lockResult.action, "hard_drop");
    assert.deepEqual(lockResult.decision.plannedActions, ["move_left", "hard_drop"]);
    assert.deepEqual(lockResult.placementResult.lockedPiece, {
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 2,
    });
    assert.equal(aiPlayer.authoritativeState.pieceIndex, 2);
    assert.equal(aiPlayer.authoritativeState.score, 28);
    assert.equal(lockResult.placementResult.scoreDelta, 28);
    assert.equal(aiPlayer.aiPlan, null);
    assert.deepEqual(executedActions, [
        "move_left",
        "soft_drop",
        "soft_drop",
        "soft_drop",
        "soft_drop",
        "soft_drop",
        "hard_drop",
    ]);
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
        [
            "move_left",
            "soft_drop",
            "soft_drop",
            "soft_drop",
            "soft_drop",
            "soft_drop",
            "hard_drop",
        ],
    );
    assert.deepEqual(
        savedLogs[0].inputSequence.map(input => input.sequence),
        [1, 2, 3, 4, 5, 6, 7],
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

test("terminal soft_drop이 예상보다 일찍 lock되면 divergence로 처리하고 log를 저장하지 않는다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    const match = createPveMatch("PVE-AI-DIVERGED");
    const aiPlayer = setActivePiece(match, {
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 3,
    });
    const decision = createDecision({
        selectedPlacement: { pieceType: "square", rotation: 0, row: 19, col: 3 },
        plannedActions: ["hard_drop"],
    });
    let logCount = 0;
    const appliedActions = [];
    const service = createPveAiPlayerService({
        loadHeuristicAi: createStubAi(decision),
        applyInput(roomId, playerId, input, core) {
            appliedActions.push(input.action);
            return applyAuthoritativeInputToMatchPlayerState(
                roomId,
                playerId,
                input,
                core,
            );
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
    assert.deepEqual(appliedActions, ["soft_drop"]);
    assert.deepEqual(result.placementResult.lockedPiece, {
        pieceType: "square",
        rotation: 0,
        row: 18,
        col: 3,
    });
    assert.equal(aiPlayer.authoritativeState.board[18][3], "square");
    assert.equal(aiPlayer.authoritativeState.board[19][4], "square");
    assert.equal(aiPlayer.authoritativeState.pieceIndex, 2);
    assert.equal(aiPlayer.aiPlan, null);
    assert.equal(logCount, 0);
});

test("실패한 terminal soft_drop은 inputSequence에 기록하지 않는다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    const match = createPveMatch("PVE-AI-SOFT-DROP-FAIL");
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
    const appliedActions = [];
    let logCount = 0;
    const service = createPveAiPlayerService({
        loadHeuristicAi: createStubAi(decision),
        applyInput(roomId, playerId, input) {
            appliedActions.push(input.action);
            return { ok: false, reason: "SOFT_DROP_RETRY" };
        },
        savePlacementDecisionLog() {
            logCount += 1;
        },
    });

    await service.processAiStep("PVE-AI-SOFT-DROP-FAIL", "ai", gameCore);
    const plan = aiPlayer.aiPlan;
    const result = await service.processAiStep(
        "PVE-AI-SOFT-DROP-FAIL",
        "ai",
        gameCore,
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "SOFT_DROP_RETRY");
    assert.deepEqual(appliedActions, ["soft_drop"]);
    assert.deepEqual(plan.executedInputs, []);
    assert.equal(plan.terminalSoftDropsExecuted, 0);
    assert.equal(aiPlayer.aiPlan, null);
    assert.equal(logCount, 0);
});

test("selectedPlacement까지 거리가 5보다 짧으면 필요한 soft_drop만 실행한다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    const match = createPveMatch("PVE-AI-SHORT-DROP");
    const aiPlayer = setActivePiece(match, {
        pieceType: "square",
        rotation: 0,
        row: -1,
        col: 3,
    });
    aiPlayer.authoritativeState.board[4][3] = "stack";
    aiPlayer.authoritativeState.board[4][4] = "stack";
    const decision = createDecision({
        selectedPlacement: { pieceType: "square", rotation: 0, row: 2, col: 3 },
        plannedActions: ["hard_drop"],
    });
    const service = createPveAiPlayerService({
        loadHeuristicAi: createStubAi(decision),
        savePlacementDecisionLog(log) {
            return { ok: true, log, reason: null };
        },
    });

    await service.processAiStep("PVE-AI-SHORT-DROP", "ai", gameCore);
    const stepResults = [];
    const softDropRows = [];
    for (let index = 0; index < 4; index += 1) {
        const result = await service.processAiStep("PVE-AI-SHORT-DROP", "ai", gameCore);
        stepResults.push(result);
        if (result.action === "soft_drop") {
            softDropRows.push(aiPlayer.authoritativeState.activePiece.row);
        }
    }

    assert.deepEqual(stepResults.map(result => result.action), [
        "soft_drop",
        "soft_drop",
        "soft_drop",
        "hard_drop",
    ]);
    assert.deepEqual(softDropRows, [0, 1, 2]);
    assert.deepEqual(stepResults.at(-1).placementResult.lockedPiece, {
        pieceType: "square",
        rotation: 0,
        row: 2,
        col: 3,
    });
    assert.equal(aiPlayer.authoritativeState.score, 0);
    assert.equal(aiPlayer.aiPlan, null);
});
test("heuristic policy는 model 설정과 무관하게 V4 loader를 호출하지 않는다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    createPveMatch("PVE-V4-DEFAULT");
    const heuristicDecision = createDecision({
        selectedPlacement: { pieceType: "square", rotation: 0, row: 18, col: 3 },
        plannedActions: ["hard_drop"],
    });
    let modelLoadCount = 0;
    let v4ModuleLoadCount = 0;
    const service = createPveAiPlayerService({
        env: {},
        loadHeuristicAi: createStubAi(heuristicDecision),
        loadPlacementV4Ai() {
            v4ModuleLoadCount += 1;
            throw new Error("V4 modules must not load");
        },
        loadPlacementV4Model() {
            modelLoadCount += 1;
            return { ok: true, model: {} };
        },
    });

    const result = await service.processAiStep("PVE-V4-DEFAULT", "ai", gameCore);

    assert.equal(result.reason, "AI_PLAN_CREATED");
    assert.equal(result.decision.source, "heuristic_ai");
    assert.equal(result.decision.policyRequested, undefined);
    assert.equal(result.decision.policyUsed, undefined);
    assert.equal(modelLoadCount, 0);
    assert.equal(v4ModuleLoadCount, 0);

    resetMatches();
    createPveMatch("PVE-V4-EMPTY-PATH");
    const emptyPathService = createPveAiPlayerService({
        env: { PVE_PLACEMENT_V4_MODEL_PATH: "   " },
        loadHeuristicAi: createStubAi(heuristicDecision),
        loadPlacementV4Ai() {
            v4ModuleLoadCount += 1;
            throw new Error("V4 modules must not load");
        },
        loadPlacementV4Model() {
            modelLoadCount += 1;
            return { ok: true, model: {} };
        },
    });
    const emptyPathResult = await emptyPathService.processAiStep(
        "PVE-V4-EMPTY-PATH",
        "ai",
        gameCore,
    );

    assert.equal(emptyPathResult.decision.policyUsed, undefined);
    assert.equal(modelLoadCount, 0);
    assert.equal(v4ModuleLoadCount, 0);

    const previousModelPath = process.env.PVE_PLACEMENT_V4_MODEL_PATH;
    process.env.PVE_PLACEMENT_V4_MODEL_PATH = "ambient-model.json";
    try {
        resetMatches();
        createPveMatch("PVE-V4-AMBIENT-ISOLATED");
        const ambientIsolatedService = createPveAiPlayerService({
            loadHeuristicAi: createStubAi(heuristicDecision),
            loadPlacementV4Ai() {
                v4ModuleLoadCount += 1;
                throw new Error("ambient model path must be isolated");
            },
        });
        const ambientResult = await ambientIsolatedService.processAiStep(
            "PVE-V4-AMBIENT-ISOLATED",
            "ai",
            gameCore,
        );

        assert.equal(ambientResult.decision.policyUsed, undefined);
        assert.equal(v4ModuleLoadCount, 0);
    } finally {
        if (previousModelPath === undefined) {
            delete process.env.PVE_PLACEMENT_V4_MODEL_PATH;
        } else {
            process.env.PVE_PLACEMENT_V4_MODEL_PATH = previousModelPath;
        }
    }
});

test("placement_v4 policy는 bundled experimental model을 별도 설정 없이 사용한다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    createV4Match("PVE-V4-BUNDLED");
    const service = createPveAiPlayerService();

    const result = await service.processAiStep("PVE-V4-BUNDLED", "ai", gameCore);

    assert.equal(result.reason, "AI_PLAN_CREATED");
    assert.equal(result.decision.policyRequested, "placement_v4");
    assert.equal(result.decision.policyUsed, "placement_v4");
    assert.equal(
        result.decision.modelSha256,
        "ff64b0d3e4cd9eb6c6d7920f2cbe961f1d70e4c90ccc69a5d9ab8bcd410cb33d",
    );
});

test("V4 성공은 authoritative plan을 만들고 training log 대신 provenance만 남긴다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    const match = createV4Match("PVE-V4-SUCCESS");
    setActivePiece(match, { pieceType: "square", rotation: 0, row: -1, col: 3 });
    const heuristicDecision = createDecision({
        selectedPlacement: { pieceType: "square", rotation: 0, row: 18, col: 3 },
        plannedActions: ["hard_drop"],
    });
    const v4Decision = createV4Decision({
        selectedPlacement: { pieceType: "square", rotation: 0, row: 18, col: 3 },
        plannedActions: ["hard_drop"],
    });
    const evidence = [];
    let logSaveCount = 0;
    const service = createPveAiPlayerService({
        env: { PVE_PLACEMENT_V4_MODEL_PATH: "synthetic-model.json" },
        loadHeuristicAi: createStubAi(heuristicDecision),
        loadPlacementV4Ai: createV4StubAi(v4Decision, heuristicDecision),
        loadPlacementV4Model() {
            return { ok: true, model: { id: "synthetic" }, modelSha256: "model-sha" };
        },
        recordAiPolicyEvidence(value) {
            evidence.push(value);
        },
        savePlacementDecisionLog() {
            logSaveCount += 1;
            return { ok: true };
        },
    });

    const planResult = await service.processAiStep("PVE-V4-SUCCESS", "ai", gameCore);
    const { result } = await processUntilPlacement(service, "PVE-V4-SUCCESS", gameCore);

    assert.equal(planResult.decision.policyUsed, "placement_v4");
    assert.equal(result.ok, true);
    assert.equal(result.log, null);
    assert.deepEqual(result.logResult, {
        ok: true,
        log: null,
        reason: "V4_TRAINING_LOG_EXCLUDED",
        skipped: true,
    });
    assert.equal(logSaveCount, 0);
    assert.deepEqual(evidence, [{
        roomId: "PVE-V4-SUCCESS",
        playerId: "ai",
        pieceIndex: 1,
        policyRequested: "placement_v4",
        policyUsed: "placement_v4",
        fallbackReason: null,
        modelSha256: "model-sha",
        selectedClassKey: v4Decision.selectedClassKey,
        selectedRepresentativeKey: v4Decision.selectedRepresentativeKey,
    }]);
});

test("V4 model loading 실패는 reason을 보존하고 heuristic log 경로로 fallback한다", async (t) => {
    const gameCore = await loadGameCore();
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "pve-v4-model-"));
    const invalidJsonPath = path.join(temporaryDirectory, "invalid.json");
    const shaMismatchPath = path.join(temporaryDirectory, "mismatch.json");
    await writeFile(invalidJsonPath, "{invalid", "utf8");
    await writeFile(shaMismatchPath, "{}\n", "utf8");
    const fixtures = [
        ["missing", path.join(temporaryDirectory, "missing.json"), null, "MODEL_NOT_FOUND"],
        ["invalid JSON", invalidJsonPath, null, "MODEL_JSON_INVALID"],
        ["SHA mismatch", shaMismatchPath, null, "MODEL_SHA_MISMATCH"],
        ["schema rejection", "synthetic.json", {
            ok: false,
            reason: "MODEL_VALIDATION_FAILED:FEATURE_NAMES_MISMATCH",
            modelSha256: "model-sha",
        }, "MODEL_VALIDATION_FAILED:FEATURE_NAMES_MISMATCH"],
    ];

    for (const [name, modelPath, injectedResult, expectedReason] of fixtures) {
        await t.test(name, async () => {
            resetMatches();
            const roomId = `PVE-V4-LOAD-${name}`;
            const match = createV4Match(roomId);
            setActivePiece(match, { pieceType: "square", rotation: 0, row: -1, col: 3 });
            const heuristicDecision = createDecision({
                selectedPlacement: { pieceType: "square", rotation: 0, row: 18, col: 3 },
                plannedActions: ["hard_drop"],
            });
            const v4Decision = createV4Decision({
                selectedPlacement: { pieceType: "square", rotation: 0, row: 18, col: 3 },
                plannedActions: ["hard_drop"],
            });
            const savedLogs = [];
            const dependencies = {
                env: { PVE_PLACEMENT_V4_MODEL_PATH: modelPath },
                loadHeuristicAi: createStubAi(heuristicDecision),
                loadPlacementV4Ai: createV4StubAi(v4Decision, heuristicDecision),
                savePlacementDecisionLog(log) {
                    savedLogs.push(log);
                    return { ok: true, log, reason: null };
                },
            };
            if (injectedResult) {
                dependencies.loadPlacementV4Model = () => injectedResult;
            }
            const service = createPveAiPlayerService(dependencies);

            const planResult = await service.processAiStep(roomId, "ai", gameCore);
            const { result } = await processUntilPlacement(service, roomId, gameCore);

            assert.equal(planResult.decision.policyRequested, "placement_v4");
            assert.equal(planResult.decision.policyUsed, "heuristic");
            assert.equal(planResult.decision.fallbackReason, expectedReason);
            assert.equal(result.ok, true);
            assert.equal(savedLogs.length, 1);
            assert.equal(savedLogs[0].source, "heuristic_ai");
            assert.equal(savedLogs[0].modelType, "heuristic");
        });
    }
});

test("V4 model 성공과 실패는 service별 최초 요청 Promise를 재사용한다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    createV4Match("PVE-V4-CACHE-1");
    createV4Match("PVE-V4-CACHE-2");
    const heuristicDecision = createDecision({
        selectedPlacement: { pieceType: "square", rotation: 0, row: 18, col: 3 },
        plannedActions: ["hard_drop"],
    });
    const v4Decision = createV4Decision({
        selectedPlacement: { pieceType: "square", rotation: 0, row: 18, col: 3 },
        plannedActions: ["hard_drop"],
    });
    let loadCount = 0;
    let loadedPath;
    const service = createPveAiPlayerService({
        env: { PVE_PLACEMENT_V4_MODEL_PATH: "cached-model.json" },
        loadHeuristicAi: createStubAi(heuristicDecision),
        loadPlacementV4Ai: createV4StubAi(v4Decision, heuristicDecision),
        loadPlacementV4Model(modelPath) {
            loadCount += 1;
            loadedPath = modelPath;
            return { ok: true, model: {}, modelSha256: "model-sha" };
        },
    });

    await service.processAiStep("PVE-V4-CACHE-1", "ai", gameCore);
    await service.processAiStep("PVE-V4-CACHE-2", "ai", gameCore);

    assert.equal(loadCount, 1);
    assert.equal(loadedPath, path.resolve(process.cwd(), "cached-model.json"));

    resetMatches();
    createV4Match("PVE-V4-FAILED-CACHE-1");
    createV4Match("PVE-V4-FAILED-CACHE-2");
    let failedLoadCount = 0;
    const failedService = createPveAiPlayerService({
        env: { PVE_PLACEMENT_V4_MODEL_PATH: "missing-model.json" },
        loadHeuristicAi: createStubAi(heuristicDecision),
        loadPlacementV4Ai: createV4StubAi(v4Decision, heuristicDecision),
        loadPlacementV4Model() {
            failedLoadCount += 1;
            return { ok: false, reason: "MODEL_NOT_FOUND", modelSha256: null };
        },
    });

    await failedService.processAiStep("PVE-V4-FAILED-CACHE-1", "ai", gameCore);
    await failedService.processAiStep("PVE-V4-FAILED-CACHE-2", "ai", gameCore);

    assert.equal(failedLoadCount, 1);
});

test("V4 adapter와 evidence callback 예외는 gameplay를 중단하지 않고 heuristic으로 복구한다", async () => {
    resetMatches();
    const gameCore = await loadGameCore();
    const match = createV4Match("PVE-V4-EXCEPTION");
    setActivePiece(match, { pieceType: "square", rotation: 0, row: -1, col: 3 });
    const heuristicDecision = createDecision({
        selectedPlacement: { pieceType: "square", rotation: 0, row: 18, col: 3 },
        plannedActions: ["hard_drop"],
    });
    const service = createPveAiPlayerService({
        env: { PVE_PLACEMENT_V4_MODEL_PATH: "synthetic-model.json" },
        loadHeuristicAi: createStubAi(heuristicDecision),
        loadPlacementV4Ai: async () => ({
            getPlacementV4PveDecision() {
                throw new Error("synthetic scorer failure");
            },
            validatePlacementV4Model: () => ({ ok: true, reason: null }),
        }),
        loadPlacementV4Model: () => ({ ok: true, model: {}, modelSha256: "model-sha" }),
        recordAiPolicyEvidence() {
            throw new Error("evidence unavailable");
        },
        savePlacementDecisionLog(log) {
            return { ok: true, log, reason: null };
        },
    });

    const planResult = await service.processAiStep("PVE-V4-EXCEPTION", "ai", gameCore);
    const { result } = await processUntilPlacement(service, "PVE-V4-EXCEPTION", gameCore);

    assert.equal(planResult.decision.policyUsed, "heuristic");
    assert.equal(planResult.decision.fallbackReason, "V4_SCORER_FAILED:UNEXPECTED_ERROR");
    assert.equal(result.ok, true);
    assert.equal(result.log.source, "heuristic_ai");
});

test("pending 또는 rejected evidence Promise는 authoritative gameplay를 기다리게 하지 않는다", async (t) => {
    const gameCore = await loadGameCore();
    const heuristicDecision = createDecision({
        selectedPlacement: { pieceType: "square", rotation: 0, row: 18, col: 3 },
        plannedActions: ["hard_drop"],
    });
    const v4Decision = createV4Decision({
        selectedPlacement: { pieceType: "square", rotation: 0, row: 18, col: 3 },
        plannedActions: ["hard_drop"],
    });

    await t.test("never resolving", async () => {
        resetMatches();
        createV4Match("PVE-V4-EVIDENCE-PENDING");
        let evidenceCalled = false;
        const service = createPveAiPlayerService({
            env: { PVE_PLACEMENT_V4_MODEL_PATH: "synthetic-model.json" },
            loadHeuristicAi: createStubAi(heuristicDecision),
            loadPlacementV4Ai: createV4StubAi(v4Decision, heuristicDecision),
            loadPlacementV4Model: () => ({
                ok: true,
                model: {},
                modelSha256: "model-sha",
            }),
            recordAiPolicyEvidence() {
                evidenceCalled = true;
                return new Promise(() => {});
            },
        });
        let timeoutId;
        const timeout = new Promise((resolve, reject) => {
            timeoutId = setTimeout(() => reject(new Error("processAiStep blocked")), 100);
        });

        try {
            const result = await Promise.race([
                service.processAiStep("PVE-V4-EVIDENCE-PENDING", "ai", gameCore),
                timeout,
            ]);
            assert.equal(result.reason, "AI_PLAN_CREATED");
            assert.equal(evidenceCalled, true);
        } finally {
            clearTimeout(timeoutId);
        }
    });

    await t.test("rejected Promise", async () => {
        resetMatches();
        const match = createV4Match("PVE-V4-EVIDENCE-REJECTED");
        setActivePiece(match, { pieceType: "square", rotation: 0, row: -1, col: 3 });
        const service = createPveAiPlayerService({
            env: { PVE_PLACEMENT_V4_MODEL_PATH: "synthetic-model.json" },
            loadHeuristicAi: createStubAi(heuristicDecision),
            loadPlacementV4Ai: createV4StubAi(v4Decision, heuristicDecision),
            loadPlacementV4Model: () => ({
                ok: true,
                model: {},
                modelSha256: "model-sha",
            }),
            recordAiPolicyEvidence() {
                return Promise.reject(new Error("evidence unavailable"));
            },
        });

        const planResult = await service.processAiStep(
            "PVE-V4-EVIDENCE-REJECTED",
            "ai",
            gameCore,
        );
        const { result } = await processUntilPlacement(
            service,
            "PVE-V4-EVIDENCE-REJECTED",
            gameCore,
        );

        assert.equal(planResult.reason, "AI_PLAN_CREATED");
        assert.equal(result.ok, true);
        assert.equal(result.log, null);
        assert.equal(result.logResult.reason, "V4_TRAINING_LOG_EXCLUDED");
    });
});
