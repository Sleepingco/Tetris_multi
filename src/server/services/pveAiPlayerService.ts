/**
 * PVE AI의 "판단"을 서버 권위 gameplay input으로 실행한다.
 *
 * production 기본 정책은 설명 가능한 heuristic이다. `placement_v4`는 match에서
 * 명시적으로 요청한 경우에만 model을 읽는 experimental opt-in이며, import·파일·SHA·
 * schema·추론 중 하나라도 실패하면 heuristic으로 돌아간다.
 *
 * AI도 board를 직접 고치지 않는다. decision의 `plannedActions`를 사람 입력과 같은
 * authoritative 경로에 한 동작씩 적용하고, 실제 lock 결과가 계획과 일치한 뒤에만
 * placement log를 만든다.
 */

import {
    applyAuthoritativeInputToMatchPlayerState as defaultApplyInput,
    ensurePlayerBagQueue as defaultEnsurePlayerBagQueue,
    getAuthoritativePlayerSnapshot as defaultGetPlayerSnapshot,
    getMatchState as defaultGetMatchState,
    markAuthoritativePlayerGameOver as defaultMarkPlayerGameOver,
    recordAiPlacementEventTarget as defaultRecordAiPlacementEventTarget,
} from "./matchService.js";
import {
    savePlacementDecisionLog as defaultSavePlacementDecisionLog,
} from "./logService.js";
import {
    AI_EXECUTION_PROFILES,
    AI_POLICY,
    DEFAULT_AI_DIFFICULTY,
} from "./aiDifficulty.js";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { BoardMetrics } from "../../client/game/core/boardMetrics.js";
import type { PlaceablePieceState } from "../../client/game/core/piece.js";
import type { HeuristicDecision } from "../../client/game/ai/heuristic/heuristicEvaluator.js";
import type { Placement } from "../../client/game/ai/heuristic/placementGenerator.js";
import type { ReachableAction } from "../../client/game/ai/heuristic/reachablePlacementPlanner.js";
import type { PlacementV4Model } from "../../client/game/ai/ml/placementV4OfflineScorer.js";
import type { PlacementV4PveDecision } from "../../client/game/ai/ml/placementV4PveDecisionAdapter.js";
import type { AiPolicy } from "./aiDifficulty.js";
import type { GameCore } from "./gameCoreLoader.js";
import type {
    AuthoritativeInput,
    AuthoritativePlayerState,
    MatchResult,
    MatchState,
} from "./matchService.js";
import type {
    GameplayResult,
    PlacementResult,
    PresentationEffect,
} from "./playerGameplayStep.js";

type DecisionMetadata = {
    policyRequested?: AiPolicy;
    policyUsed?: AiPolicy;
    fallbackReason?: string | null;
    modelSha256?: string | null;
    selectedClassKey?: string;
    selectedRepresentativeKey?: string;
};
type WithDecisionMetadata<T> = T & DecisionMetadata;
export type AiDecision = WithDecisionMetadata<HeuristicDecision>
    | WithDecisionMetadata<PlacementV4PveDecision>;
type SuccessfulAiDecision = Extract<AiDecision, { ok: true }>;
export type PveAiPlan = {
    pieceIndex: number;
    selectedPlacement: Placement;
    remainingActions: ReachableAction[];
    executedInputs: Array<AuthoritativeInput & { sequence: number; createdAt: number }>;
    terminalSoftDropsExecuted: number;
    decision: SuccessfulAiDecision;
    stateBefore: AuthoritativePlayerState;
};
export type PveAiStepResult = {
    ok: boolean;
    reason: string | null;
    skipped?: boolean;
    gameOver?: boolean;
    stateChanged?: boolean;
    replanRequired?: boolean;
    action?: AuthoritativeInput["action"];
    input?: AuthoritativeInput;
    gameplayResult?: GameplayResult;
    placementResult?: PlacementResult | null;
    presentationEffect?: PresentationEffect;
    decision?: AiDecision;
    log?: unknown;
    logResult?: unknown;
    message?: string;
};
export type PveAiPlayerService = {
    processAiStep(roomId: string, playerId: string, gameCore: GameCore): Promise<PveAiStepResult>;
};

const AI_ACTIONS = new Set<ReachableAction>([
    "move_left",
    "move_right",
    "rotate",
    "rotate_ccw",
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
type HeuristicAi = typeof import("../../client/game/ai/heuristic/heuristicEvaluator.js") & {
    getBoardMetrics: typeof import("../../client/game/core/boardMetrics.js")["getBoardMetrics"];
};
type PlacementV4Ai = {
    getPlacementV4PveDecision: typeof import("../../client/game/ai/ml/placementV4PveDecisionAdapter.js")["getPlacementV4PveDecision"];
    validatePlacementV4Model: typeof import("../../client/game/ai/ml/placementV4OfflineScorer.js")["validatePlacementV4Model"];
};
let heuristicAiPromise: Promise<HeuristicAi> | null = null;
let placementV4AiPromise: Promise<PlacementV4Ai> | null = null;

function loadHeuristicAi(): Promise<HeuristicAi> {
    if (!heuristicAiPromise) {
        heuristicAiPromise = Promise.all([
            import("../../client/game/ai/heuristic/heuristicEvaluator.ts"),
            import("../../client/game/core/boardMetrics.ts"),
        ]).then(([heuristicEvaluator, boardMetrics]) => ({
            ...heuristicEvaluator,
            getBoardMetrics: boardMetrics.getBoardMetrics,
        }));
    }
    return heuristicAiPromise;
}

function loadPlacementV4Ai(): Promise<PlacementV4Ai> {
    if (!placementV4AiPromise) {
        placementV4AiPromise = Promise.all([
            import("../../client/game/ai/ml/placementV4PveDecisionAdapter.ts"),
            import("../../client/game/ai/ml/placementV4OfflineScorer.ts"),
        ]).then(([pveAdapter, offlineScorer]) => ({
            getPlacementV4PveDecision: pveAdapter.getPlacementV4PveDecision,
            validatePlacementV4Model: offlineScorer.validatePlacementV4Model,
        }));
    }
    return placementV4AiPromise;
}

type PlacementV4ModelResult = {
    ok: true;
    model: PlacementV4Model;
    modelSha256: string;
    reason: null;
} | {
    ok: false;
    reason: string;
    modelSha256: string | null;
};

/**
 * V4 model 파일의 byte identity와 내부 schema를 모두 검증한다.
 *
 * SHA-256은 승인한 동결 파일과 같은지 확인하고, schema 검증은 그 파일의 feature 순서와
 * vector 형식이 현재 추론 코드와 맞는지 확인한다. 둘 중 하나라도 실패하면 model을
 * 반환하지 않아 호출자가 heuristic fallback을 선택하게 한다.
 */
async function loadPlacementV4Model(
    modelPath: string,
    validateModel: PlacementV4Ai["validatePlacementV4Model"],
): Promise<PlacementV4ModelResult> {
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
    let model: unknown;
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

    let validation: ReturnType<PlacementV4Ai["validatePlacementV4Model"]>;
    try {
        validation = validateModel(model);
    } catch (error) {
        validation = {
            ok: false,
            reason: error instanceof Error && error.message
                ? error.message
                : "UNEXPECTED_ERROR",
        };
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
        model: model as PlacementV4Model,
        modelSha256,
        reason: null,
    };
}

type Dependencies = {
    loadHeuristicAi?: typeof loadHeuristicAi;
    loadPlacementV4Ai?: typeof loadPlacementV4Ai;
    getMatchState?: typeof defaultGetMatchState;
    getPlayerSnapshot?: typeof defaultGetPlayerSnapshot;
    applyInput?: typeof defaultApplyInput;
    ensurePlayerBagQueue?: typeof defaultEnsurePlayerBagQueue;
    markPlayerGameOver?: typeof defaultMarkPlayerGameOver;
    recordAiPlacementEventTarget?: typeof defaultRecordAiPlacementEventTarget;
    savePlacementDecisionLog?: typeof defaultSavePlacementDecisionLog;
    loadPlacementV4Model?: typeof loadPlacementV4Model;
    recordAiPolicyEvidence?: (evidence: Record<string, unknown>) => unknown;
    now?: () => number;
    env?: NodeJS.ProcessEnv;
};

/**
 * match state와 authoritative input 경계를 주입받아 PVE AI controller를 만든다.
 * model은 V4가 처음 요청될 때 한 번만 읽고 같은 Promise를 재사용한다.
 */
export function createPveAiPlayerService(
    dependencies: Dependencies = {},
): PveAiPlayerService {
    const loadAi = dependencies.loadHeuristicAi || loadHeuristicAi;
    const loadV4Ai = dependencies.loadPlacementV4Ai || loadPlacementV4Ai;
    const getMatchState = dependencies.getMatchState || defaultGetMatchState;
    const getPlayerSnapshot = dependencies.getPlayerSnapshot || defaultGetPlayerSnapshot;
    const applyInput = dependencies.applyInput || defaultApplyInput;
    const ensurePlayerBagQueue = dependencies.ensurePlayerBagQueue || defaultEnsurePlayerBagQueue;
    const markPlayerGameOver = dependencies.markPlayerGameOver || defaultMarkPlayerGameOver;
    const recordAiPlacementEventTarget = dependencies.recordAiPlacementEventTarget
        || defaultRecordAiPlacementEventTarget;
    const savePlacementDecisionLog = dependencies.savePlacementDecisionLog
        || defaultSavePlacementDecisionLog;
    const loadV4Model = dependencies.loadPlacementV4Model || loadPlacementV4Model;
    const recordAiPolicyEvidence = dependencies.recordAiPolicyEvidence || (() => { });
    const now = dependencies.now || Date.now;
    const env = dependencies.env || process.env;
    const configuredModelPath = env.PVE_PLACEMENT_V4_MODEL_PATH;
    const modelPathValue = typeof configuredModelPath === "string"
        ? configuredModelPath.trim()
        : "";
    const modelPath = modelPathValue
        ? path.resolve(process.cwd(), modelPathValue)
        : DEFAULT_PLACEMENT_V4_MODEL_PATH;
    let modelPromise: Promise<PlacementV4ModelResult> | null = null;

    function getPlacementV4Model(
        ai: Awaited<ReturnType<typeof loadPlacementV4Ai>>,
    ): Promise<PlacementV4ModelResult> {
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

    function getHeuristicFallbackDecision(
        ai: Awaited<ReturnType<typeof loadHeuristicAi>>,
        decisionState: ReturnType<typeof createDecisionState>,
        fallbackReason: string,
        modelSha256: string | null,
    ): AiDecision {
        return {
            ...ai.getHeuristicDecision(decisionState),
            policyRequested: "placement_v4",
            policyUsed: "heuristic",
            fallbackReason,
            modelSha256,
        };
    }

    /**
     * match가 요청한 정책으로 placement를 고르되 항상 실행 가능한 decision을 반환한다.
     * heuristic은 기본 경로이고, V4는 명시적 요청에서만 로드한다. V4 실패 이유와 실제
     * 사용 정책을 metadata로 남겨 조용한 fallback도 나중에 관찰할 수 있게 한다.
     */
    async function getPolicyDecision(
        ai: Awaited<ReturnType<typeof loadHeuristicAi>>,
        decisionState: ReturnType<typeof createDecisionState>,
        aiPolicy: AiPolicy | null,
    ): Promise<AiDecision> {
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

    function recordPolicyEvidence(
        roomId: string,
        playerId: string,
        pieceIndex: number,
        decision: AiDecision,
    ): void {
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
            })).catch(() => { });
        } catch {
            // 개발용 관찰 정보 저장 실패는 authoritative gameplay에 영향을 주지 않는다.
        }
    }

    /**
     * ticker cadence 한 번에 plan 생성 또는 authoritative action 하나만 처리한다.
     *
     * 1. plan이 없으면 현재 authoritative snapshot에서 policy decision을 만든다.
     * 2. plan이 있으면 다음 action 하나를 사람과 같은 input 경로로 적용한다.
     * 3. hard drop으로 lock되면 실제 locked placement와 계획을 비교한다.
     * 4. 일치한 heuristic 실행만 학습 가능한 placement log로 저장한다.
     *
     * action을 한 번에 모두 실행하지 않는 이유는 난이도별 cadence와 서버 snapshot
     * lifecycle을 그대로 유지하기 위해서다.
     */
    async function processAiStep(
        roomId: string,
        playerId: string,
        gameCore: GameCore,
    ): Promise<PveAiStepResult> {
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
                    return createFailure(queueResult.reason || "BAG_QUEUE_FAILED");
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
            const difficulty = matchResult.match.aiDifficulty || DEFAULT_AI_DIFFICULTY;
            const executionProfile = AI_EXECUTION_PROFILES[difficulty];
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
            if (!plannedAction) {
                player.aiPlan = null;
                return createFailure("AI_INVALID_PLAN", {
                    decision: plan.decision,
                    replanRequired: true,
                });
            }
            const shouldSoftDropBeforeLock = plannedAction === "hard_drop" &&
                currentState.activePiece?.row < plan.selectedPlacement.row &&
                plan.terminalSoftDropsExecuted < executionProfile.terminalSoftDropSteps;
            const action: AuthoritativeInput["action"] = shouldSoftDropBeforeLock
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
                return createFailure(applyResult.reason || "AI_INPUT_FAILED", {
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
                // imitation model의 출력을 다시 정답으로 학습하는 feedback loop를 막는다.
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
                recordAiPlacementEventTarget(roomId, playerId, placementResult.pieceIndex);
                const pendingLogResult = Promise.resolve(savePlacementDecisionLog(log));
                void pendingLogResult
                    .then(result => {
                        if (!result.ok) {
                            console.warn(
                                `[pveAiPlayerService] placement log failed: ${result.reason}`,
                            );
                        }
                    })
                    .catch(() => {
                        console.warn(
                            "[pveAiPlayerService] placement log failed: LOG_WRITE_FAILED",
                        );
                    });
                logResult = {
                    ok: true,
                    log: null,
                    reason: "LOG_WRITE_SCHEDULED",
                };
            } catch (error) {
                logResult = {
                    ok: false,
                    log: null,
                    reason: "LOG_WRITE_FAILED",
                    message: getErrorMessage(error),
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
                message: getErrorMessage(error),
            });
        }
    }

    return {
        processAiStep,
    };
}

function isValidAiDecision(decision: AiDecision): decision is SuccessfulAiDecision {
    if (!decision.ok) return false;
    const actions = decision.plannedActions;
    if (!decision.selectedPlacement || !Array.isArray(actions) || actions.length === 0) {
        return false;
    }

    return actions.every((action, index) => {
        if (!AI_ACTIONS.has(action)) return false;
        if (action === "hard_drop") return index === actions.length - 1;
        return index < actions.length - 1;
    });
}

/**
 * 현재 authoritative snapshot과 AI decision을 실행 중인 controller plan으로 복사한다.
 * 원본 decision 배열을 그대로 보관하지 않아 action을 하나씩 제거해도 분석 metadata와
 * 선택 placement가 바뀌지 않는다.
 */
function createAiPlan(
    stateBefore: AuthoritativePlayerState,
    decision: SuccessfulAiDecision,
): PveAiPlan {
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

function clonePlacement(placement: Placement): Placement {
    return {
        ...placement,
        cells: Array.isArray(placement?.cells)
            ? placement.cells.map(cell => ({ ...cell }))
            : [],
    };
}

function isSamePlacement(
    left: PlaceablePieceState | null | undefined,
    right: Placement | null | undefined,
): boolean {
    if (!left || !right) return false;
    return left.pieceType === right.pieceType &&
        left.rotation === right.rotation &&
        left.row === right.row &&
        left.col === right.col;
}

function createDecisionState(state: AuthoritativePlayerState) {
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

function createPieceLog(piece: PlaceablePieceState, blocks: GameCore["BLOCKS"]) {
    const offsets = blocks?.[piece?.pieceType]?.[piece?.rotation] || [];
    return {
        ...piece,
        cells: offsets.map(([offsetX, offsetY]) => ({
            row: piece.row + offsetY,
            col: piece.col + offsetX,
        })),
    };
}

/**
 * 계획 시점과 실제 lock 이후 snapshot을 schemaVersion 2 학습 로그로 만든다.
 *
 * `inputSequence`에는 authoritative 경로가 실제로 성공시킨 action만 들어간다. 현재
 * 호출자는 heuristic 실행만 이 함수로 보내며 V4 출력은 위에서 제외하므로, V4가 자기
 * 선택을 정답으로 다시 학습하는 feedback loop가 생기지 않는다.
 */
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
}: {
    match: MatchState;
    playerId: string;
    stateBefore: AuthoritativePlayerState;
    stateAfter: AuthoritativePlayerState;
    decision: SuccessfulAiDecision;
    selectedPlacement: PlaceablePieceState;
    placementResult: PlacementResult;
    executedInputs: PveAiPlan["executedInputs"];
    gameCore: GameCore;
    getBoardMetrics: (board: AuthoritativePlayerState["board"]) => BoardMetrics;
    createdAt: number;
}) {
    if (!stateBefore.activePiece.pieceType) {
        throw new TypeError("active piece must be placeable");
    }
    return {
        eventType: "placement_decision",
        schemaVersion: 2,
        mode: "pve",
        gameId: match.gameId,
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

function getErrorMessage(error: unknown): string {
    return error instanceof Error && error.message
        ? error.message
        : "UNEXPECTED_ERROR";
}

function createFailure(
    reason: string,
    extra: Partial<PveAiStepResult> = {},
): PveAiStepResult {
    return {
        ok: false,
        skipped: false,
        reason,
        gameOver: false,
        ...extra,
    };
}
