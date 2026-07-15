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
            accumulatorMs: 0,
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

    async function tickRoom(roomId, socketServer, elapsedMs = tickMs) {
        const ticker = tickers.get(roomId);
        if (!ticker) return;

        if (ticker.isProcessing) return;
        ticker.isProcessing = true;

        try {
            ticker.accumulatorMs += elapsedMs;
            ticker.aiAccumulatorMs += elapsedMs;
            const shouldApplyGravity = ticker.accumulatorMs >= gravityIntervalMs;
            const shouldProcessAi = ticker.aiAccumulatorMs >= aiActionIntervalMs;
            if (!shouldApplyGravity && !shouldProcessAi) return;

            if (shouldApplyGravity) ticker.accumulatorMs -= gravityIntervalMs;
            if (shouldProcessAi) ticker.aiAccumulatorMs -= aiActionIntervalMs;

            const matchResult = getMatchState(roomId);
            if (!matchResult.ok || !matchResult.match) {
                stopRoomTicker(roomId);
                return;
            }

            const players = Array.isArray(matchResult.match.players)
                ? matchResult.match.players
                : [];
            const hasDuePlayer = players.some(player => {
                return player.playerType === "heuristic_ai"
                    ? shouldProcessAi
                    : shouldApplyGravity;
            });
            if (!hasDuePlayer) return;

            const gameCore = await loadGameCore();

            const duePlayers = players.filter(player => {
                return player.playerType === "heuristic_ai"
                    ? shouldProcessAi
                    : shouldApplyGravity;
            });
            const playerTasks = duePlayers.map(player => {
                const processPlayer = () => processDuePlayer({
                    roomId,
                    player,
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

    async function processDuePlayer({ roomId, player, gameCore, socketServer, match }) {
        const playerId = player.playerId;
        const isAiPlayer = player.playerType === "heuristic_ai";
        const stepResult = isAiPlayer
            ? await pveAiPlayerService.processAiStep(roomId, playerId, gameCore)
            : applyGravityStepToMatchPlayerState(roomId, playerId, gameCore);

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
        if (stepResult.skipped) return;

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
        tickRoom,
    };
}

module.exports = {
    AI_ACTION_INTERVAL_MS,
    AUTHORITATIVE_GRAVITY_INTERVAL_MS,
    AUTHORITATIVE_TICK_MS,
    createAuthoritativeTickerService,
};
