const {
    appendPendingGarbageToOpponent: defaultAppendPendingGarbageToOpponent,
    applyGravityStepToMatchPlayerState: defaultApplyGravityStepToMatchPlayerState,
    getAuthoritativePlayerSnapshotDto: defaultGetAuthoritativePlayerSnapshotDto,
    getMatchState: defaultGetMatchState,
} = require("./matchService.js");
const { finishGame: defaultFinishGame } = require("./roomService.js");
const { loadGameCore: defaultLoadGameCore } = require("./gameCoreLoader.js");
const { saveGameEventLog: defaultSaveGameEventLog } = require("./logService.js");
const { finishAuthoritativeMatch } = require("./authoritativeMatchFinish.js");

const AUTHORITATIVE_TICK_MS = 100;
const AUTHORITATIVE_GRAVITY_INTERVAL_MS = 500;

/**
 * room 단위 authoritative ticker를 만든다.
 * - 실제 timer는 roomId별로 하나만 유지한다.
 * - ticker는 100ms마다 실행하되 gravity/snapshot은 500ms 누적 기준으로 처리한다.
 *
 * @param {Object} dependencies - 테스트/런타임 의존성
 * @returns {Object} ticker 시작/정리 API
 */
function createAuthoritativeTickerService(dependencies = {}) {
    const setIntervalFn = dependencies.setIntervalFn || setInterval;
    const clearIntervalFn = dependencies.clearIntervalFn || clearInterval;
    const tickMs = dependencies.tickMs || AUTHORITATIVE_TICK_MS;
    const gravityIntervalMs = dependencies.gravityIntervalMs || AUTHORITATIVE_GRAVITY_INTERVAL_MS;
    const loadGameCore = dependencies.loadGameCore || defaultLoadGameCore;
    const getMatchState = dependencies.getMatchState || defaultGetMatchState;
    const applyGravityStepToMatchPlayerState = dependencies.applyGravityStepToMatchPlayerState
        || defaultApplyGravityStepToMatchPlayerState;
    const getAuthoritativePlayerSnapshotDto = dependencies.getAuthoritativePlayerSnapshotDto
        || defaultGetAuthoritativePlayerSnapshotDto;
    const appendPendingGarbageToOpponent = dependencies.appendPendingGarbageToOpponent
        || defaultAppendPendingGarbageToOpponent;
    const finishGame = dependencies.finishGame || defaultFinishGame;
    const saveGameEventLog = dependencies.saveGameEventLog || defaultSaveGameEventLog;
    const createGarbageHoleCol = dependencies.createGarbageHoleCol
        || (() => Math.floor(Math.random() * 10));
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

        ticker.accumulatorMs += elapsedMs;
        if (ticker.accumulatorMs < gravityIntervalMs) return;

        ticker.accumulatorMs -= gravityIntervalMs;

        const matchResult = getMatchState(roomId);
        if (!matchResult.ok || !matchResult.match) {
            stopRoomTicker(roomId);
            return;
        }

        const gameCore = await loadGameCore();
        const players = Array.isArray(matchResult.match.players)
            ? matchResult.match.players
            : [];

        for (const player of players) {
            const playerId = player.playerId;
            const stepResult = applyGravityStepToMatchPlayerState(roomId, playerId, gameCore);
            if (!stepResult.ok) continue;

            handlePlacementResult(roomId, playerId, stepResult.placementResult);
            const snapshot = emitAuthoritativeSnapshot(roomId, playerId, socketServer);

            if (stepResult.placementResult?.gameOver || snapshot?.phase === "gameOver") {
                await finishAuthoritativeMatch({
                    roomId,
                    loserPlayerId: playerId,
                    match: matchResult.match,
                    finishGame,
                    stopRoomTicker,
                    emitMatchFinish(payload) {
                        socketServer.to(roomId).emit("match:finish", payload);
                    },
                    saveGameEventLog,
                });
                break;
            }
        }
    }

    function emitAuthoritativeSnapshot(roomId, playerId, socketServer) {
        const snapshotResult = getAuthoritativePlayerSnapshotDto(roomId, playerId);
        if (!snapshotResult.ok) return null;

        socketServer.to(roomId).emit("game:authoritative:snapshot", {
            roomId,
            playerId,
            snapshot: snapshotResult.snapshot,
        });

        return snapshotResult.snapshot;
    }

    function handlePlacementResult(roomId, playerId, placementResult) {
        const attackLines = placementResult?.attackLines ?? 0;
        if (!Number.isInteger(attackLines) || attackLines <= 0) return;

        const garbage = {
            lines: attackLines,
            holeCol: createGarbageHoleCol(),
        };
        const appendResult = appendPendingGarbageToOpponent(roomId, playerId, garbage);
        if (!appendResult.ok) return;
    }

    return {
        startRoomTicker,
        stopRoomTicker,
        hasRoomTicker,
        tickRoom,
    };
}

module.exports = {
    AUTHORITATIVE_GRAVITY_INTERVAL_MS,
    AUTHORITATIVE_TICK_MS,
    createAuthoritativeTickerService,
};
