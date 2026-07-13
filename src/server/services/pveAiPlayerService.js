const {
    applyAuthoritativeInputToMatchPlayerState: defaultApplyInput,
    ensurePlayerBagQueue: defaultEnsurePlayerBagQueue,
    getAuthoritativePlayerSnapshot: defaultGetPlayerSnapshot,
    getMatchState: defaultGetMatchState,
    markAuthoritativePlayerGameOver: defaultMarkPlayerGameOver,
} = require("./matchService.js");
const {
    savePlacementDecisionLog: defaultSavePlacementDecisionLog,
} = require("./logService.js");

const AI_ACTIONS = new Set([
    "move_left",
    "move_right",
    "rotate",
    "soft_drop",
    "hard_drop",
]);

let heuristicAiPromise = null;

function loadHeuristicAi() {
    if (!heuristicAiPromise) {
        heuristicAiPromise = Promise.all([
            import("../../client/game/ai/heuristic/heuristicEvaluator.js"),
            import("../../client/game/core/boardMetrics.js"),
        ]).then(([heuristicEvaluator, boardMetrics]) => ({
            ...heuristicEvaluator,
            getBoardMetrics: boardMetrics.getBoardMetrics,
        }));
    }
    return heuristicAiPromise;
}

function createPveAiPlayerService(dependencies = {}) {
    const loadAi = dependencies.loadHeuristicAi || loadHeuristicAi;
    const getMatchState = dependencies.getMatchState || defaultGetMatchState;
    const getPlayerSnapshot = dependencies.getPlayerSnapshot || defaultGetPlayerSnapshot;
    const applyInput = dependencies.applyInput || defaultApplyInput;
    const ensurePlayerBagQueue = dependencies.ensurePlayerBagQueue || defaultEnsurePlayerBagQueue;
    const markPlayerGameOver = dependencies.markPlayerGameOver || defaultMarkPlayerGameOver;
    const savePlacementDecisionLog = dependencies.savePlacementDecisionLog
        || defaultSavePlacementDecisionLog;
    const now = dependencies.now || Date.now;

    /**
     * AI plan 생성 또는 authoritative action 하나만 처리한다.
     * - plan이 없으면 현재 state에서 decision을 만들고 실행은 다음 cadence로 미룬다.
     * - plan이 있으면 remainingActions의 첫 action만 기존 authoritative input 경로에 적용한다.
     *
     * @param {string} roomId - match room id
     * @param {string} playerId - heuristic AI player id
     * @param {Object} gameCore - server에서 재사용하는 game core
     * @returns {Promise<Object>} plan 생성, action 적용 또는 실패 결과
     */
    async function processAiStep(roomId, playerId, gameCore) {
        try {
            const matchResult = getMatchState(roomId);
            if (!matchResult.ok || !matchResult.match) {
                return createFailure(matchResult.reason || "MATCH_NOT_FOUND");
            }
            const player = matchResult.match.players.find(matchPlayer => {
                return matchPlayer.playerId === playerId;
            });
            if (!player || player.playerType !== "heuristic_ai") {
                return createFailure("AI_PLAYER_NOT_FOUND");
            }
            if (player.authoritativeState?.phase !== "playing") {
                player.aiPlan = null;
                return {
                    ok: true,
                    skipped: true,
                    reason: "AI_NOT_PLAYING",
                };
            }

            if (!player.aiPlan) {
                const ai = await loadAi();
                const queueResult = ensurePlayerBagQueue(roomId, playerId);
                if (!queueResult.ok) {
                    return createFailure(queueResult.reason);
                }

                const snapshotResult = getPlayerSnapshot(roomId, playerId);
                if (!snapshotResult.ok || !snapshotResult.snapshot) {
                    return createFailure(snapshotResult.reason || "AUTHORITATIVE_STATE_NOT_FOUND");
                }
                const stateBefore = snapshotResult.snapshot;
                const decision = ai.getHeuristicDecision(createDecisionState(stateBefore));
                if (!decision.ok) {
                    markPlayerGameOver(roomId, playerId, decision.errorCode || "AI_DECISION_FAILED");
                    return {
                        ok: false,
                        skipped: false,
                        reason: decision.errorCode || "AI_DECISION_FAILED",
                        gameOver: true,
                        decision,
                    };
                }
                if (!isValidAiDecision(decision)) {
                    markPlayerGameOver(roomId, playerId, "AI_INVALID_PLAN");
                    return createFailure("AI_INVALID_PLAN", {
                        gameOver: true,
                        decision,
                    });
                }

                player.aiPlan = createAiPlan(stateBefore, decision);
                return {
                    ok: true,
                    skipped: true,
                    reason: "AI_PLAN_CREATED",
                    gameOver: false,
                    decision: player.aiPlan.decision,
                };
            }

            const snapshotResult = getPlayerSnapshot(roomId, playerId);
            if (!snapshotResult.ok || !snapshotResult.snapshot) {
                return createFailure(snapshotResult.reason || "AUTHORITATIVE_STATE_NOT_FOUND");
            }
            const currentState = snapshotResult.snapshot;
            const plan = player.aiPlan;
            if (plan.pieceIndex !== currentState.pieceIndex) {
                player.aiPlan = null;
                return {
                    ok: true,
                    skipped: true,
                    reason: "AI_PLAN_STALE",
                    gameOver: false,
                    replanRequired: true,
                };
            }

            const action = plan.remainingActions[0];
            const input = {
                action,
                pieceIndex: plan.pieceIndex,
                tick: currentState.currentTick,
            };
            const applyResult = applyInput(roomId, playerId, input, gameCore);
            if (!applyResult.ok) {
                player.aiPlan = null;
                return createFailure(applyResult.reason, {
                    decision: plan.decision,
                    replanRequired: true,
                });
            }

            plan.remainingActions.shift();
            plan.executedInputs.push({
                ...input,
                sequence: plan.executedInputs.length + 1,
                createdAt: now(),
            });

            const gameplayResult = applyResult.gameplayResult;
            const placementResult = gameplayResult?.placementResult;
            if (!placementResult) {
                return {
                    ok: true,
                    skipped: false,
                    reason: null,
                    gameOver: false,
                    stateChanged: true,
                    action,
                    input,
                    gameplayResult,
                    placementResult: null,
                    decision: plan.decision,
                };
            }

            player.aiPlan = null;
            const didFollowPlan = action === "hard_drop" &&
                plan.remainingActions.length === 0 &&
                isSamePlacement(placementResult.lockedPiece, plan.selectedPlacement);
            if (!didFollowPlan) {
                return createFailure("AI_PLAN_DIVERGED", {
                    gameOver: Boolean(placementResult.gameOver),
                    stateChanged: true,
                    gameplayResult,
                    placementResult,
                    presentationEffect: gameplayResult.presentationEffect,
                    decision: plan.decision,
                });
            }

            const stateAfterResult = getPlayerSnapshot(roomId, playerId);
            if (!stateAfterResult.ok || !stateAfterResult.snapshot) {
                return createFailure(stateAfterResult.reason || "AUTHORITATIVE_STATE_NOT_FOUND", {
                    gameOver: Boolean(placementResult.gameOver),
                    stateChanged: true,
                    gameplayResult,
                    placementResult,
                    presentationEffect: gameplayResult.presentationEffect,
                    decision: plan.decision,
                });
            }

            let log = null;
            let logResult;
            try {
                const ai = await loadAi();
                log = createPlacementDecisionLog({
                    match: matchResult.match,
                    playerId,
                    stateBefore: plan.stateBefore,
                    stateAfter: stateAfterResult.snapshot,
                    decision: plan.decision,
                    selectedPlacement: placementResult.lockedPiece,
                    placementResult,
                    executedInputs: plan.executedInputs,
                    gameCore,
                    getBoardMetrics: ai.getBoardMetrics,
                    createdAt: now(),
                });
                logResult = await savePlacementDecisionLog(log);
            } catch (error) {
                logResult = {
                    ok: false,
                    log: null,
                    reason: "LOG_WRITE_FAILED",
                    message: error.message,
                };
            }

            return {
                ok: true,
                skipped: false,
                reason: null,
                gameOver: Boolean(placementResult.gameOver),
                stateChanged: true,
                action,
                input,
                gameplayResult,
                placementResult,
                presentationEffect: gameplayResult.presentationEffect,
                decision: plan.decision,
                log,
                logResult,
            };
        } catch (error) {
            markPlayerGameOver(roomId, playerId, "AI_DECISION_FAILED");
            return createFailure("AI_DECISION_FAILED", {
                gameOver: true,
                message: error.message,
            });
        }
    }

    return {
        processAiStep,
    };
}

function isValidAiDecision(decision) {
    const actions = decision?.plannedActions;
    if (!decision?.selectedPlacement || !Array.isArray(actions) || actions.length === 0) {
        return false;
    }

    return actions.every((action, index) => {
        if (!AI_ACTIONS.has(action)) return false;
        if (action === "hard_drop") return index === actions.length - 1;
        return index < actions.length - 1;
    });
}

/**
 * 현재 authoritative snapshot과 heuristic decision을 controller metadata로 복사한다.
 *
 * @param {Object} stateBefore - plan 생성 시점 authoritative snapshot
 * @param {Object} decision - heuristic decision
 * @returns {Object} match player에 저장할 AI plan
 */
function createAiPlan(stateBefore, decision) {
    return {
        pieceIndex: stateBefore.pieceIndex,
        selectedPlacement: clonePlacement(decision.selectedPlacement),
        remainingActions: [...decision.plannedActions],
        executedInputs: [],
        decision: {
            ...decision,
            selectedPlacement: clonePlacement(decision.selectedPlacement),
            plannedActions: [...decision.plannedActions],
            reason: { ...decision.reason },
        },
        stateBefore,
    };
}

function clonePlacement(placement) {
    return {
        ...placement,
        cells: Array.isArray(placement?.cells)
            ? placement.cells.map(cell => ({ ...cell }))
            : [],
    };
}

function isSamePlacement(left, right) {
    return Boolean(left && right) &&
        left.pieceType === right.pieceType &&
        left.rotation === right.rotation &&
        left.row === right.row &&
        left.col === right.col;
}

function createDecisionState(state) {
    return {
        board: state.board,
        activePiece: state.activePiece,
        nextQueue: [...state.pieceQueue],
        holdPiece: state.holdPieceType,
        score: state.score,
        lines: state.lines,
        phase: state.phase,
        tick: state.currentTick,
        pieceIndex: state.pieceIndex,
        gameOver: Boolean(state.gameOver),
    };
}

function createPieceLog(piece, blocks) {
    const offsets = blocks?.[piece?.pieceType]?.[piece?.rotation] || [];
    return {
        ...piece,
        cells: offsets.map(([offsetX, offsetY]) => ({
            row: piece.row + offsetY,
            col: piece.col + offsetX,
        })),
    };
}

function createPlacementDecisionLog({
    match,
    playerId,
    stateBefore,
    stateAfter,
    decision,
    selectedPlacement,
    placementResult,
    executedInputs,
    gameCore,
    getBoardMetrics,
    createdAt,
}) {
    return {
        eventType: "placement_decision",
        schemaVersion: 2,
        mode: "pve",
        gameId: `${match.roomId}-${match.createdAt}`,
        roomId: match.roomId,
        playerId,
        source: "heuristic_ai",
        modelType: "heuristic",
        tick: stateBefore.currentTick,
        pieceIndex: stateBefore.pieceIndex,
        createdAt,
        boardBefore: stateBefore.board,
        boardAfter: stateAfter.board,
        activePiece: createPieceLog(stateBefore.activePiece, gameCore.BLOCKS),
        nextQueue: [...stateBefore.pieceQueue],
        holdPiece: stateBefore.holdPieceType,
        inputSequence: executedInputs.map(input => ({ ...input })),
        selectedPlacement: createPieceLog(selectedPlacement, gameCore.BLOCKS),
        placementResult,
        metricsBefore: getBoardMetrics(stateBefore.board),
        metricsAfter: getBoardMetrics(stateAfter.board),
        evaluation: {
            score: decision.score,
            reason: decision.reason,
            candidateCount: decision.candidateCount,
        },
    };
}

function createFailure(reason, extra = {}) {
    return {
        ok: false,
        skipped: false,
        reason,
        gameOver: false,
        ...extra,
    };
}

module.exports = {
    createPveAiPlayerService,
};
