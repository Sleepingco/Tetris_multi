// =============================
// 방 단위 타이머 조율
// room별 timer와 gravity/AI 주기를 소유하며 고정 예산은 authoritative state에서 진행한다.
// board 원본은 matchService가 소유한다.
// human gravity, AI action, snapshot, garbage, match finish의 실행 순서를 연결한다.
// =============================
import type { Server } from "socket.io";
import {
    appendPendingGarbageToOpponent as defaultAppendPendingGarbageToOpponent,
    applyGravityStepToMatchPlayerState as defaultApplyGravityStepToMatchPlayerState,
    deleteMatch as defaultDeleteMatch,
    getAuthoritativePlayerSnapshotDto as defaultGetAuthoritativePlayerSnapshotDto,
    getMatchState as defaultGetMatchState,
} from "./matchService.js";
import { finishGame as defaultFinishGame } from "./roomService.js";
import { loadGameCore as defaultLoadGameCore } from "./gameCoreLoader.js";
import {
    saveGameEventLog as defaultSaveGameEventLog,
    savePlacementDecisionLog as defaultSavePlacementDecisionLog,
} from "./logService.js";
import { finishAuthoritativeMatch } from "./authoritativeMatchFinish.js";
import { createPveAiPlayerService } from "./pveAiPlayerService.js";
import { createAuthoritativePlayerMutationQueue } from "./authoritativePlayerMutationQueue.js";
import { createCombatEffect } from "./playerGameplayStep.js";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    ServerToClientParsedPayload,
} from "../../shared/socketContractTypes.js";
import type { AuthoritativePlayerMutationQueue } from "./authoritativePlayerMutationQueue.js";
import type { GameCore } from "./gameCoreLoader.js";
import type { MatchPlayer, MatchResult, MatchState } from "./matchService.js";
import type { AiDecision, PveAiPlayerService } from "./pveAiPlayerService.js";
import type {
    GameplayResult,
    GravityStepResult,
    PlacementResult,
    PresentationEffect,
    CombatEffect,
} from "./playerGameplayStep.js";

type AuthoritativeSocketServer = Server<ClientToServerEvents, ServerToClientEvents>;
type GravityTiming = {
    accumulatorMs: number;
    generation: number;
};
type TickerState = {
    intervalId: ReturnType<typeof setInterval>;
    socketServer: AuthoritativeSocketServer;
    playerGravityTimings: Map<string, GravityTiming>;
    aiAccumulatorMs: number;
    isProcessing: boolean;
    countdownFinished: boolean;
};
type DuePlayerStepResult = {
    ok: boolean;
    reason: string | null;
    stateChanged?: boolean;
    gameOver?: boolean;
    skipped?: boolean;
    decision?: AiDecision;
    gravityResult?: GravityStepResult["gravityResult"];
    placementResult?: PlacementResult | null;
    gameplayResult?: GameplayResult;
    presentationEffect?: PresentationEffect;
};
type TickerDependencies = {
    now?: () => number;
    setIntervalFn?: typeof setInterval;
    clearIntervalFn?: typeof clearInterval;
    tickMs?: number;
    gravityIntervalMs?: number;
    aiActionIntervalMs?: number;
    loadGameCore?: typeof defaultLoadGameCore;
    getMatchState?: typeof defaultGetMatchState;
    applyGravityStepToMatchPlayerState?: typeof defaultApplyGravityStepToMatchPlayerState;
    getAuthoritativePlayerSnapshotDto?: typeof defaultGetAuthoritativePlayerSnapshotDto;
    appendPendingGarbageToOpponent?: typeof defaultAppendPendingGarbageToOpponent;
    deleteMatch?: typeof defaultDeleteMatch;
    finishGame?: typeof defaultFinishGame;
    saveGameEventLog?: typeof defaultSaveGameEventLog;
    savePlacementDecisionLog?: typeof defaultSavePlacementDecisionLog;
    createGarbageHoleCol?: () => number;
    pveAiPlayerService?: PveAiPlayerService;
    authoritativePlayerMutationQueue?: AuthoritativePlayerMutationQueue;
};
type TickerActionResult = {
    ok: boolean;
    started?: boolean;
    stopped?: boolean;
    reason?: string | null;
};
export type AuthoritativeTickerService = {
    startRoomTicker(roomId: string, socketServer: AuthoritativeSocketServer): TickerActionResult;
    stopRoomTicker(roomId: string): TickerActionResult;
    stopAllRoomTickers(): void;
    hasRoomTicker(roomId: string): boolean;
    resetPlayerGravity(
        roomId: string,
        playerId: string,
        options?: { lineClear?: boolean },
    ): TickerActionResult;
    tickRoom(
        roomId: string,
        socketServer: AuthoritativeSocketServer,
        elapsedMs?: number,
    ): Promise<void>;
};

export const AUTHORITATIVE_TICK_MS = 100;
export const AUTHORITATIVE_GRAVITY_INTERVAL_MS = 500;
export const AI_ACTION_INTERVAL_MS = 100;
export const LINE_CLEAR_PRESENTATION_DELAY_MS = 350;

function updateAiPolicyRuntime(
    match: MatchState,
    playerId: string,
    decision: AiDecision,
): NonNullable<MatchState["aiPolicyRuntime"]> {
    const policyRequested = decision.policyRequested || "heuristic";
    const policyUsed = decision.policyUsed || "heuristic";
    const fallbackReason = decision.fallbackReason ?? null;
    const previous = match.aiPolicyRuntime;
    const didFallback = policyRequested === "placement_v4"
        && policyUsed !== "placement_v4";

    match.aiPolicyRuntime = {
        roomId: match.roomId,
        playerId,
        policyRequested,
        policyUsed,
        fallbackReason,
        modelSha256: decision.modelSha256 ?? previous?.modelSha256 ?? null,
        fallbackCount: (previous?.fallbackCount ?? 0) + (didFallback ? 1 : 0),
        lastFallbackReason: fallbackReason ?? previous?.lastFallbackReason ?? null,
    };

    return match.aiPolicyRuntime;
}

/**
 * room 단위 authoritative ticker를 만든다.
 * - 실제 timer는 roomId별로 하나만 유지한다.
 * - callback 주기는 `tickMs`이고 기본값만 100ms다.
 * - AI action과 human gravity는 서로 다른 accumulator/interval을 사용한다.
 * - human gravity는 socket input과 같은 mutation queue를 거쳐 같은 state를 동시에 바꾸지 않는다.
 */
export function createAuthoritativeTickerService(
    dependencies: TickerDependencies = {},
): AuthoritativeTickerService {
    const setIntervalFn = dependencies.setIntervalFn || setInterval;
    const clearIntervalFn = dependencies.clearIntervalFn || clearInterval;
    const tickMs = dependencies.tickMs || AUTHORITATIVE_TICK_MS;
    const gravityIntervalMs = dependencies.gravityIntervalMs || AUTHORITATIVE_GRAVITY_INTERVAL_MS;
    const aiActionIntervalMs = dependencies.aiActionIntervalMs || AI_ACTION_INTERVAL_MS;
    const loadGameCore = dependencies.loadGameCore || defaultLoadGameCore;
    const getMatchState = dependencies.getMatchState || defaultGetMatchState;
    const applyGravityStepToMatchPlayerState = dependencies.applyGravityStepToMatchPlayerState
        || defaultApplyGravityStepToMatchPlayerState;
    const getAuthoritativePlayerSnapshotDto = dependencies.getAuthoritativePlayerSnapshotDto
        || defaultGetAuthoritativePlayerSnapshotDto;
    const appendPendingGarbageToOpponent = dependencies.appendPendingGarbageToOpponent
        || defaultAppendPendingGarbageToOpponent;
    const deleteMatch = dependencies.deleteMatch || defaultDeleteMatch;
    const finishGame = dependencies.finishGame || defaultFinishGame;
    const saveGameEventLog = dependencies.saveGameEventLog || defaultSaveGameEventLog;
    const savePlacementDecisionLog = dependencies.savePlacementDecisionLog
        || defaultSavePlacementDecisionLog;
    const createGarbageHoleCol = dependencies.createGarbageHoleCol
        || (() => Math.floor(Math.random() * 10));
    const pveAiPlayerService = dependencies.pveAiPlayerService
        || createPveAiPlayerService({ savePlacementDecisionLog });
    const authoritativePlayerMutationQueue = dependencies.authoritativePlayerMutationQueue
        || createAuthoritativePlayerMutationQueue();
    const tickers = new Map<string, TickerState>();
    const now = dependencies.now || Date.now;

    function startRoomTicker(
        roomId: string,
        socketServer: AuthoritativeSocketServer,
    ): TickerActionResult {
        if (!roomId || !socketServer) {
            return {
                ok: false,
                started: false,
                reason: "INVALID_TICKER_CONTEXT",
            };
        }

        if (tickers.has(roomId)) {
            return {
                ok: true,
                started: false,
            };
        }

        const intervalId = setIntervalFn(() => {
            return tickRoom(roomId, socketServer, tickMs).catch(() => {
                stopRoomTicker(roomId);
            });
        }, tickMs);
        intervalId?.unref?.();
        tickers.set(roomId, {
            intervalId,
            socketServer,
            playerGravityTimings: new Map(),
            aiAccumulatorMs: 0,
            isProcessing: false,
            countdownFinished: false,
        });

        return {
            ok: true,
            started: true,
        };
    }

    // 서버 shutdown에서는 room 수와 관계없이 모든 interval을 한 번씩 정리한다.
    function stopAllRoomTickers(): void {
        for (const roomId of [...tickers.keys()]) {
            stopRoomTicker(roomId);
        }
    }

    function stopRoomTicker(roomId: string): TickerActionResult {
        const ticker = tickers.get(roomId);

        if (!ticker) {
            return {
                ok: true,
                stopped: false,
            };
        }

        clearIntervalFn(ticker.intervalId);
        tickers.delete(roomId);

        return {
            ok: true,
            stopped: true,
        };
    }

    function hasRoomTicker(roomId: string): boolean {
        return tickers.has(roomId);
    }

    function resetPlayerGravity(
        roomId: string,
        playerId: string,
        options: { lineClear?: boolean } = {},
    ): TickerActionResult {
        const ticker = tickers.get(roomId);
        if (!ticker || !playerId) {
            return {
                ok: false,
                reason: "TICKER_NOT_FOUND",
            };
        }

        const timing = getOrCreatePlayerGravityTiming(ticker, playerId);
        // 음수 누적값은 line-clear 표시 지연을 먼저 소모한 뒤 새 gravity interval을 세기 시작하게 한다.
        timing.accumulatorMs = options.lineClear === true
            ? -LINE_CLEAR_PRESENTATION_DELAY_MS
            : 0;
        timing.generation += 1;
        if (options.lineClear === true) {
            // 줄 삭제 표시 동안 다음 조각의 고정 예산도 소모하지 않는다.
            const player = getMatchState(roomId).match?.players.find(candidate => candidate.playerId === playerId);
            if (player) player.lockUpdatedAt = performance.now() + LINE_CLEAR_PRESENTATION_DELAY_MS;
        }

        return {
            ok: true,
            reason: null,
        };
    }

    /**
     * 지난 시간을 accumulator에 더하고 이번 callback에서 due인 player를 한 단계씩 처리한다.
     * elapsed가 크게 밀려도 한 callback에 여러 step을 몰아 실행하지 않아 event loop를 오래 점유하지 않는다.
     */
    async function tickRoom(
        roomId: string,
        socketServer: AuthoritativeSocketServer,
        elapsedMs = tickMs,
    ): Promise<void> {
        const ticker = tickers.get(roomId);
        if (!ticker) return;

        // 이전 async callback이 끝나지 않았으면 같은 room의 tick을 겹쳐 실행하지 않는다.
        if (ticker.isProcessing) return;
        ticker.isProcessing = true;

        try {
            const matchResult = getMatchState(roomId);
            if (!matchResult.ok || !matchResult.match) {
                stopRoomTicker(roomId);
                return;
            }

            const startsAt = matchResult.match.startsAt;
            if (startsAt === null || (startsAt !== undefined && now() < startsAt)) return;
            if (startsAt !== undefined && !ticker.countdownFinished) {
                ticker.countdownFinished = true;
                elapsedMs = 0;
            }
            ticker.aiAccumulatorMs += elapsedMs;
            const shouldProcessAi = ticker.aiAccumulatorMs >= aiActionIntervalMs;
            if (shouldProcessAi) ticker.aiAccumulatorMs -= aiActionIntervalMs;

            const players = Array.isArray(matchResult.match.players)
                ? matchResult.match.players
                : [];
            const humanPlayerIds = new Set(players
                .filter(player => player.playerType !== "heuristic_ai")
                .map(player => player.playerId));
            for (const playerId of ticker.playerGravityTimings.keys()) {
                if (!humanPlayerIds.has(playerId)) {
                    ticker.playerGravityTimings.delete(playerId);
                }
            }

            const duePlayers: Array<{
                player: MatchPlayer;
                gravityGeneration: number | null;
                gravityDue: boolean;
            }> = [];
            players.forEach(player => {
                if (player.playerType === "heuristic_ai") {
                    if (shouldProcessAi) {
                        duePlayers.push({ player, gravityGeneration: null, gravityDue: false });
                    }
                    return;
                }

                const timing = getOrCreatePlayerGravityTiming(ticker, player.playerId);
                timing.accumulatorMs += elapsedMs;
                const gravityDue = timing.accumulatorMs >= gravityIntervalMs;
                if (timing.accumulatorMs < 0) return;
                if (!gravityDue && !player.authoritativeState?.lockDelay?.hasTouchedGround) return;
                if (gravityDue) timing.accumulatorMs -= gravityIntervalMs;
                duePlayers.push({
                    player,
                    gravityGeneration: timing.generation,
                    gravityDue,
                });
            });
            if (duePlayers.length === 0) return;

            const gameCore = await loadGameCore();

            const playerTasks = duePlayers.map(({ player, gravityGeneration, gravityDue }) => {
                const processPlayer = () => processDuePlayer({
                    roomId,
                    player,
                    gravityGeneration,
                    gravityDue,
                    gameCore,
                    socketServer,
                    match: matchResult.match,
                    tickerState: ticker,
                });

                if (player.playerType === "heuristic_ai") {
                    return Promise.resolve().then(processPlayer);
                }

                // socket input과 gravity가 같은 player state에 도착한 순서대로 적용된다.
                return authoritativePlayerMutationQueue.enqueueAuthoritativePlayerMutation(
                    roomId,
                    player.playerId,
                    processPlayer,
                );
            });

            // 한 player의 실패가 같은 callback의 다른 player 진행을 취소하지 않는다.
            await Promise.allSettled(playerTasks);
        } finally {
            ticker.isProcessing = false;
        }
    }

    /**
     * due player 한 명의 state 변화와 그 후속 효과를 순서대로 처리한다.
     * 고정 시간·gravity/AI 적용 → garbage → snapshot → game finish 순서다.
     */
    async function processDuePlayer({
        roomId,
        player,
        gravityGeneration,
        gravityDue,
        gameCore,
        socketServer,
        match,
        tickerState,
    }: {
        roomId: string;
        player: MatchPlayer;
        gravityGeneration: number | null;
        gravityDue: boolean;
        gameCore: GameCore;
        socketServer: AuthoritativeSocketServer;
        match: MatchState;
        tickerState: TickerState;
    }): Promise<void> {
        const playerId = player.playerId;
        if (tickers.get(roomId) !== tickerState) return;
        const isAiPlayer = player.playerType === "heuristic_ai";
        const ticker = tickers.get(roomId);
        const gravityTiming = !isAiPlayer
            ? ticker?.playerGravityTimings.get(playerId)
            : null;
        if (
            !isAiPlayer &&
            (!gravityTiming || gravityTiming.generation !== gravityGeneration)
        ) {
            // input/hold/lock이 gravity를 reset했다면 이미 queue에 들어온 오래된 step을 폐기한다.
            return;
        }

        let stepResult: DuePlayerStepResult;
        if (isAiPlayer) {
            stepResult = await pveAiPlayerService.processAiStep(roomId, playerId, gameCore);
        } else {
            if (!gravityTiming) return;
            stepResult = applyGravityStepToMatchPlayerState(roomId, playerId, gameCore, {
                gravityDue,
            });
        }

        if (!stepResult.ok && !stepResult.stateChanged) {
            if (stepResult.gameOver) {
                emitAuthoritativeSnapshot(roomId, playerId, socketServer);
                await finishAuthoritativeMatch({
                    roomId,
                    loserPlayerId: playerId,
                    finishReason: normalizeAiFinishReason(stepResult.reason),
                    match,
                    finishGame,
                    stopRoomTicker,
                    emitMatchFinish(payload) {
                        socketServer.to(roomId).emit("match:finish", payload);
                    },
                    saveGameEventLog,
                    deleteMatch,
                });
            }
            return;
        }
        if (isAiPlayer && stepResult.reason === "AI_PLAN_CREATED" && stepResult.decision) {
            const policyRuntime = updateAiPolicyRuntime(match, playerId, stepResult.decision);
            socketServer.to(roomId).emit("pve:ai-policy", policyRuntime);
        }
        if (stepResult.gravityResult?.kind === "grounded" || stepResult.gravityResult?.kind === "skipped") return;
        if (stepResult.skipped) return;

        if (!isAiPlayer && stepResult.gravityResult?.kind === "lock") {
            resetPlayerGravity(roomId, playerId, {
                lineClear: (stepResult.placementResult?.linesCleared ?? 0) > 0,
            });
        }

        const placementSideEffect = handlePlacementResult(roomId, playerId, stepResult.placementResult);
        // 상대 pending garbage까지 반영한 뒤 snapshot을 보내 client가 한 시점의 결과를 받게 한다.
        const snapshot = emitAuthoritativeSnapshot(
            roomId,
            playerId,
            socketServer,
            stepResult.presentationEffect
                || stepResult.gameplayResult?.presentationEffect,
            createCombatEffect(match.gameId, playerId, stepResult.placementResult, placementSideEffect),
        );
        if (placementSideEffect?.targetPlayerId) {
            emitAuthoritativeSnapshot(roomId, placementSideEffect.targetPlayerId, socketServer);
        }

        if (stepResult.placementResult?.gameOver || snapshot?.phase === "gameOver") {
            await finishAuthoritativeMatch({
                roomId,
                loserPlayerId: playerId,
                finishReason: stepResult.placementResult?.gameOverReason,
                match,
                finishGame,
                stopRoomTicker,
                emitMatchFinish(payload) {
                    socketServer.to(roomId).emit("match:finish", payload);
                },
                saveGameEventLog,
                deleteMatch,
            });
        }
    }

    /**
     * matchService가 만든 public snapshot을 room에 전송한다.
     * ticker는 내부 authoritativeState를 직접 serialize하지 않아 server-only field를 누출하지 않는다.
     */
    function emitAuthoritativeSnapshot(
        roomId: string,
        playerId: string,
        socketServer: AuthoritativeSocketServer,
        presentationEffect: PresentationEffect | null = null,
        combatEffect: CombatEffect | null = null,
    ): ServerToClientParsedPayload<"game:authoritative:snapshot">["snapshot"] | null {
        const snapshotResult = getAuthoritativePlayerSnapshotDto(roomId, playerId);
        if (!snapshotResult.ok) return null;

        const payload: ServerToClientParsedPayload<"game:authoritative:snapshot"> = {
            roomId,
            playerId,
            gameId: snapshotResult.match?.gameId,
            snapshot: snapshotResult.snapshot,
        };
        if (presentationEffect?.id) {
            payload.presentationEffect = {
                ...presentationEffect,
                id: presentationEffect.id,
            };
        }
        if (combatEffect) payload.combatEffect = combatEffect;

        socketServer.to(roomId).emit("game:authoritative:snapshot", payload);

        return snapshotResult.snapshot;
    }

    function handlePlacementResult(
        roomId: string,
        playerId: string,
        placementResult?: PlacementResult | null,
    ): MatchResult | null {
        const attackLines = placementResult?.attackLines ?? 0;
        if (!Number.isInteger(attackLines) || attackLines <= 0) return null;

        const garbage = {
            lines: attackLines,
            holeCol: createGarbageHoleCol(),
        };
        const appendResult = appendPendingGarbageToOpponent(roomId, playerId, garbage);
        if (!appendResult.ok) return null;

        return appendResult;
    }

    function normalizeAiFinishReason(reason: string | null): string {
        if (reason === "NO_LEGAL_PLACEMENT") return "ai_no_legal_placement";
        return "ai_decision_failed";
    }

    return {
        startRoomTicker,
        stopRoomTicker,
        stopAllRoomTickers,
        hasRoomTicker,
        resetPlayerGravity,
        tickRoom,
    };
}

function getOrCreatePlayerGravityTiming(
    ticker: TickerState,
    playerId: string,
): GravityTiming {
    let timing = ticker.playerGravityTimings.get(playerId);
    if (timing) return timing;

    timing = {
        accumulatorMs: 0,
        generation: 0,
    };
    ticker.playerGravityTimings.set(playerId, timing);
    return timing;
}
