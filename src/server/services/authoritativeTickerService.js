const {
    appendPendingGarbageToOpponent: defaultAppendPendingGarbageToOpponent,
    applyGravityStepToMatchPlayerState: defaultApplyGravityStepToMatchPlayerState,
    deleteMatch: defaultDeleteMatch,
    getAuthoritativePlayerSnapshotDto: defaultGetAuthoritativePlayerSnapshotDto,
    getMatchState: defaultGetMatchState,
} = require("./matchService.js");
const { finishGame: defaultFinishGame } = require("./roomService.js");
const { loadGameCore: defaultLoadGameCore } = require("./gameCoreLoader.js");
const { saveGameEventLog: defaultSaveGameEventLog } = require("./logService.js");
const { finishAuthoritativeMatch } = require("./authoritativeMatchFinish.js");
const { createPveAiPlayerService } = require("./pveAiPlayerService.js");
const {
    createAuthoritativePlayerMutationQueue,
} = require("./authoritativePlayerMutationQueue.js");

const AUTHORITATIVE_TICK_MS = 100;
const AUTHORITATIVE_GRAVITY_INTERVAL_MS = 500;
const AI_ACTION_INTERVAL_MS = 100;
const LINE_CLEAR_PRESENTATION_DELAY_MS = 350;

function updateAiPolicyRuntime(match, playerId, decision = {}) {
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
 * - ticker는 100ms마다 실행하며 AI action과 human gravity 누적 주기를 분리한다.
 *
 * @param {Object} dependencies - 테스트/런타임 의존성
 * @returns {Object} ticker 시작/정리 API
 */
function createAuthoritativeTickerService(dependencies = {}) {
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
    const createGarbageHoleCol = dependencies.createGarbageHoleCol
        || (() => Math.floor(Math.random() * 10));
    const pveAiPlayerService = dependencies.pveAiPlayerService
        || createPveAiPlayerService();
    const authoritativePlayerMutationQueue = dependencies.authoritativePlayerMutationQueue
        || createAuthoritativePlayerMutationQueue();
    const tickers = new Map();

    function startRoomTicker(roomId, socketServer) {
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
        });

        return {
            ok: true,
            started: true,
        };
    }

    function stopRoomTicker(roomId) {
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

    function hasRoomTicker(roomId) {
        return tickers.has(roomId);
    }

    function resetPlayerGravity(roomId, playerId, options = {}) {
        const ticker = tickers.get(roomId);
        if (!ticker || !playerId) {
            return {
                ok: false,
                reason: "TICKER_NOT_FOUND",
            };
        }

        const timing = getOrCreatePlayerGravityTiming(ticker, playerId);
        timing.accumulatorMs = options.lineClear === true
            ? -LINE_CLEAR_PRESENTATION_DELAY_MS
            : 0;
        timing.generation += 1;
        timing.groundedPieceIndex = null;

        return {
            ok: true,
            reason: null,
        };
    }

    async function tickRoom(roomId, socketServer, elapsedMs = tickMs) {
        const ticker = tickers.get(roomId);
        if (!ticker) return;

        if (ticker.isProcessing) return;
        ticker.isProcessing = true;

        try {
            ticker.aiAccumulatorMs += elapsedMs;
            const shouldProcessAi = ticker.aiAccumulatorMs >= aiActionIntervalMs;
            if (shouldProcessAi) ticker.aiAccumulatorMs -= aiActionIntervalMs;

            const matchResult = getMatchState(roomId);
            if (!matchResult.ok || !matchResult.match) {
                stopRoomTicker(roomId);
                return;
            }

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

            const duePlayers = [];
            players.forEach(player => {
                if (player.playerType === "heuristic_ai") {
                    if (shouldProcessAi) {
                        duePlayers.push({ player, gravityGeneration: null });
                    }
                    return;
                }

                const timing = getOrCreatePlayerGravityTiming(ticker, player.playerId);
                timing.accumulatorMs += elapsedMs;
                if (timing.accumulatorMs < gravityIntervalMs) return;

                timing.accumulatorMs -= gravityIntervalMs;
                duePlayers.push({
                    player,
                    gravityGeneration: timing.generation,
                });
            });
            if (duePlayers.length === 0) return;

            const gameCore = await loadGameCore();

            const playerTasks = duePlayers.map(({ player, gravityGeneration }) => {
                const processPlayer = () => processDuePlayer({
                    roomId,
                    player,
                    gravityGeneration,
                    gameCore,
                    socketServer,
                    match: matchResult.match,
                });

                if (player.playerType === "heuristic_ai") {
                    return Promise.resolve().then(processPlayer);
                }

                return authoritativePlayerMutationQueue.enqueueAuthoritativePlayerMutation(
                    roomId,
                    player.playerId,
                    processPlayer,
                );
            });

            await Promise.allSettled(playerTasks);
        } finally {
            ticker.isProcessing = false;
        }
    }

    async function processDuePlayer({
        roomId,
        player,
        gravityGeneration,
        gameCore,
        socketServer,
        match,
    }) {
        const playerId = player.playerId;
        const isAiPlayer = player.playerType === "heuristic_ai";
        const ticker = tickers.get(roomId);
        const gravityTiming = !isAiPlayer
            ? ticker?.playerGravityTimings.get(playerId)
            : null;
        if (
            !isAiPlayer &&
            (!gravityTiming || gravityTiming.generation !== gravityGeneration)
        ) {
            return;
        }

        const pieceIndex = player.authoritativeState?.pieceIndex;
        const stepResult = isAiPlayer
            ? await pveAiPlayerService.processAiStep(roomId, playerId, gameCore)
            : applyGravityStepToMatchPlayerState(roomId, playerId, gameCore, {
                lockGroundedPiece: Number.isInteger(pieceIndex)
                    && gravityTiming.groundedPieceIndex === pieceIndex,
            });

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
        if (isAiPlayer && stepResult.reason === "AI_PLAN_CREATED") {
            const policyRuntime = updateAiPolicyRuntime(match, playerId, stepResult.decision);
            socketServer.to(roomId).emit("pve:ai-policy", policyRuntime);
        }
        if (!isAiPlayer && stepResult.gravityResult?.kind === "grounded") {
            gravityTiming.groundedPieceIndex = pieceIndex;
            return;
        }
        if (!isAiPlayer && stepResult.gravityResult?.kind === "move") {
            gravityTiming.groundedPieceIndex = null;
        }
        if (stepResult.skipped) return;

        if (!isAiPlayer && stepResult.gravityResult?.kind === "lock") {
            resetPlayerGravity(roomId, playerId, {
                lineClear: (stepResult.placementResult?.linesCleared ?? 0) > 0,
            });
        }

        const placementSideEffect = handlePlacementResult(roomId, playerId, stepResult.placementResult);
        const snapshot = emitAuthoritativeSnapshot(
            roomId,
            playerId,
            socketServer,
            stepResult.presentationEffect
                || stepResult.gameplayResult?.presentationEffect,
        );
        if (placementSideEffect?.targetPlayerId) {
            emitAuthoritativeSnapshot(roomId, placementSideEffect.targetPlayerId, socketServer);
        }

        if (stepResult.placementResult?.gameOver || snapshot?.phase === "gameOver") {
            await finishAuthoritativeMatch({
                roomId,
                loserPlayerId: playerId,
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

    function emitAuthoritativeSnapshot(
        roomId,
        playerId,
        socketServer,
        presentationEffect = null,
    ) {
        const snapshotResult = getAuthoritativePlayerSnapshotDto(roomId, playerId);
        if (!snapshotResult.ok) return null;

        const payload = {
            roomId,
            playerId,
            snapshot: snapshotResult.snapshot,
        };
        if (presentationEffect) {
            payload.presentationEffect = presentationEffect;
        }

        socketServer.to(roomId).emit("game:authoritative:snapshot", payload);

        return snapshotResult.snapshot;
    }

    function handlePlacementResult(roomId, playerId, placementResult) {
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

    function normalizeAiFinishReason(reason) {
        if (reason === "NO_LEGAL_PLACEMENT") return "ai_no_legal_placement";
        return "ai_decision_failed";
    }

    return {
        startRoomTicker,
        stopRoomTicker,
        hasRoomTicker,
        resetPlayerGravity,
        tickRoom,
    };
}

function getOrCreatePlayerGravityTiming(ticker, playerId) {
    let timing = ticker.playerGravityTimings.get(playerId);
    if (timing) return timing;

    timing = {
        accumulatorMs: 0,
        generation: 0,
        groundedPieceIndex: null,
    };
    ticker.playerGravityTimings.set(playerId, timing);
    return timing;
}

module.exports = {
    AI_ACTION_INTERVAL_MS,
    AUTHORITATIVE_GRAVITY_INTERVAL_MS,
    AUTHORITATIVE_TICK_MS,
    LINE_CLEAR_PRESENTATION_DELAY_MS,
    createAuthoritativeTickerService,
};
