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
const {
    AI_EXECUTION_PROFILES,
    AI_POLICY,
    DEFAULT_AI_DIFFICULTY,
} = require("./aiDifficulty.js");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const AI_ACTIONS = new Set([
    "move_left",
    "move_right",
    "rotate",
    "soft_drop",
    "hard_drop",
]);
const PLACEMENT_V4_MODEL_SHA256 = "ff64b0d3e4cd9eb6c6d7920f2cbe961f1d70e4c90ccc69a5d9ab8bcd410cb33d";
const DEFAULT_PLACEMENT_V4_MODEL_PATH = path.join(
    __dirname,
    "..",
    "assets",
    "placement-v4-125g-experimental-model.json",
);
let heuristicAiPromise = null;
let placementV4AiPromise = null;

function loadHeuristicAi() {
    if (!heuristicAiPromise) {
        heuristicAiPromise = Promise.all([
            import("../../client/game/ai/heuristic/heuristicEvaluator.js"),
            import("../../client/game/core/boardMetrics.ts"),
        ]).then(([heuristicEvaluator, boardMetrics]) => ({
            ...heuristicEvaluator,
            getBoardMetrics: boardMetrics.getBoardMetrics,
        }));
    }
    return heuristicAiPromise;
}

function loadPlacementV4Ai() {
    if (!placementV4AiPromise) {
        placementV4AiPromise = Promise.all([
            import("../../client/game/ai/ml/placementV4PveDecisionAdapter.js"),
            import("../../client/game/ai/ml/placementV4OfflineScorer.js"),
        ]).then(([pveAdapter, offlineScorer]) => ({
            getPlacementV4PveDecision: pveAdapter.getPlacementV4PveDecision,
            validatePlacementV4Model: offlineScorer.validatePlacementV4Model,
        }));
    }
    return placementV4AiPromise;
}

async function loadPlacementV4Model(modelPath, validateModel) {
    let bytes;
    try {
        bytes = await fs.readFile(modelPath);
    } catch {
        return {
            ok: false,
            reason: "MODEL_NOT_FOUND",
            modelSha256: null,
        };
    }

    const modelSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    let model;
    try {
        model = JSON.parse(bytes.toString("utf8"));
    } catch {
        return {
            ok: false,
            reason: "MODEL_JSON_INVALID",
            modelSha256,
        };
    }
    if (modelSha256 !== PLACEMENT_V4_MODEL_SHA256) {
        return {
            ok: false,
            reason: "MODEL_SHA_MISMATCH",
            modelSha256,
        };
    }

    let validation;
    try {
        validation = validateModel(model);
    } catch (error) {
        validation = { ok: false, reason: error.message || "UNEXPECTED_ERROR" };
    }
    if (!validation?.ok) {
        return {
            ok: false,
            reason: `MODEL_VALIDATION_FAILED:${validation?.reason || "UNKNOWN"}`,
            modelSha256,
        };
    }
    return {
        ok: true,
        model,
        modelSha256,
        reason: null,
    };
}

function createPveAiPlayerService(dependencies = {}) {
    const loadAi = dependencies.loadHeuristicAi || loadHeuristicAi;
    const loadV4Ai = dependencies.loadPlacementV4Ai || loadPlacementV4Ai;
    const getMatchState = dependencies.getMatchState || defaultGetMatchState;
    const getPlayerSnapshot = dependencies.getPlayerSnapshot || defaultGetPlayerSnapshot;
    const applyInput = dependencies.applyInput || defaultApplyInput;
    const ensurePlayerBagQueue = dependencies.ensurePlayerBagQueue || defaultEnsurePlayerBagQueue;
    const markPlayerGameOver = dependencies.markPlayerGameOver || defaultMarkPlayerGameOver;
    const savePlacementDecisionLog = dependencies.savePlacementDecisionLog
        || defaultSavePlacementDecisionLog;
    const loadV4Model = dependencies.loadPlacementV4Model || loadPlacementV4Model;
    const recordAiPolicyEvidence = dependencies.recordAiPolicyEvidence || (() => {});
    const now = dependencies.now || Date.now;
    const modelPathValue = typeof (dependencies.env || process.env).PVE_PLACEMENT_V4_MODEL_PATH === "string"
        ? (dependencies.env || process.env).PVE_PLACEMENT_V4_MODEL_PATH.trim()
        : "";
    const modelPath = modelPathValue
        ? path.resolve(process.cwd(), modelPathValue)
        : DEFAULT_PLACEMENT_V4_MODEL_PATH;
    let modelPromise = null;

    function getPlacementV4Model(ai) {
        if (!modelPromise) {
            modelPromise = Promise.resolve()
                .then(() => loadV4Model(modelPath, ai.validatePlacementV4Model))
                .catch(() => ({
                    ok: false,
                    reason: "MODEL_VALIDATION_FAILED:LOAD_ERROR",
                    modelSha256: null,
                }));
        }
        return modelPromise;
    }

    function getHeuristicFallbackDecision(ai, decisionState, fallbackReason, modelSha256) {
        return {
            ...ai.getHeuristicDecision(decisionState),
            policyRequested: "placement_v4",
            policyUsed: "heuristic",
            fallbackReason,
            modelSha256,
        };
    }

    async function getPolicyDecision(ai, decisionState, aiPolicy) {
        if (aiPolicy !== AI_POLICY.PLACEMENT_V4) {
            return ai.getHeuristicDecision(decisionState);
        }

        let v4Ai;
        try {
            v4Ai = await loadV4Ai();
        } catch {
            return getHeuristicFallbackDecision(
                ai,
                decisionState,
                "V4_SCORER_FAILED:IMPORT_FAILED",
                null,
            );
        }
        const modelResult = await getPlacementV4Model(v4Ai);
        if (!modelResult.ok) {
            return getHeuristicFallbackDecision(
                ai,
                decisionState,
                modelResult.reason,
                modelResult.modelSha256,
            );
        }

        try {
            return {
                ...v4Ai.getPlacementV4PveDecision(modelResult.model, decisionState),
                modelSha256: modelResult.modelSha256,
            };
        } catch {
            return getHeuristicFallbackDecision(
                ai,
                decisionState,
                "V4_SCORER_FAILED:UNEXPECTED_ERROR",
                modelResult.modelSha256,
            );
        }
    }

    function recordPolicyEvidence(roomId, playerId, pieceIndex, decision) {
        if (decision.policyRequested !== AI_POLICY.PLACEMENT_V4) return;
        try {
            void Promise.resolve(recordAiPolicyEvidence({
                roomId,
                playerId,
                pieceIndex,
                policyRequested: decision.policyRequested,
                policyUsed: decision.policyUsed,
                fallbackReason: decision.fallbackReason ?? null,
                modelSha256: decision.modelSha256 ?? null,
                selectedClassKey: decision.selectedClassKey ?? null,
                selectedRepresentativeKey: decision.selectedRepresentativeKey ?? null,
            })).catch(() => {});
        } catch {
            // Dev evidence must never affect authoritative gameplay.
        }
    }

    /**
     * AI plan 생성 또는 authoritative action 하나만 처리한다.
     * - plan이 없으면 현재 state에서 decision을 만들고 실행은 다음 cadence로 미룬다.
     * - plan이 있으면 planned action 또는 terminal soft drop 하나를 authoritative input 경로에 적용한다.
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
                const decision = await getPolicyDecision(
                    ai,
                    createDecisionState(stateBefore),
                    matchResult.match.aiPolicy,
                );
                recordPolicyEvidence(roomId, playerId, stateBefore.pieceIndex, decision);
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
            const executionProfile = AI_EXECUTION_PROFILES[matchResult.match.aiDifficulty]
                || AI_EXECUTION_PROFILES[DEFAULT_AI_DIFFICULTY];
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

            const plannedAction = plan.remainingActions[0];
            const shouldSoftDropBeforeLock = plannedAction === "hard_drop" &&
                currentState.activePiece?.row < plan.selectedPlacement.row &&
                plan.terminalSoftDropsExecuted < executionProfile.terminalSoftDropSteps;
            const action = shouldSoftDropBeforeLock
                ? "soft_drop"
                : plannedAction;
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

            if (shouldSoftDropBeforeLock) {
                plan.terminalSoftDropsExecuted += 1;
            } else {
                plan.remainingActions.shift();
            }
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
            if (plan.decision.policyUsed === "placement_v4") {
                logResult = {
                    ok: true,
                    log: null,
                    reason: "V4_TRAINING_LOG_EXCLUDED",
                    skipped: true,
                };
            } else try {
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
        terminalSoftDropsExecuted: 0,
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
        aiDifficulty: match.aiDifficulty || DEFAULT_AI_DIFFICULTY,
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
