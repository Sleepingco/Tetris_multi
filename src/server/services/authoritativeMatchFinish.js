function createGameId(roomId, match) {
    return match?.createdAt
        ? `${roomId}-${match.createdAt}`
        : roomId;
}

function createGameOverLog(result, match) {
    return {
        eventType: "game_over",
        schemaVersion: 1,
        gameId: createGameId(result.room.roomId, match),
        roomId: result.room.roomId,
        mode: match?.mode === "pve" ? "pve" : "multi",
        aiDifficulty: match?.aiDifficulty ?? null,
        aiPolicyRequested: match?.aiPolicy ?? null,
        aiPolicyLastUsed: match?.aiPolicyRuntime?.policyUsed ?? null,
        aiPolicyFallbackCount: match?.aiPolicyRuntime?.fallbackCount ?? 0,
        aiPolicyLastFallbackReason: match?.aiPolicyRuntime?.lastFallbackReason ?? null,
        aiModelSha256: match?.aiPolicyRuntime?.modelSha256 ?? null,
        endedAt: Date.now(),
        winnerPlayerId: result.winnerPlayerId,
        loserPlayerId: result.loserPlayerId,
        reason: result.finishReason,
        finishType: "normal",
    };
}

async function persistGameEventLog(saveGameEventLog, log) {
    try {
        await saveGameEventLog(log);
    } catch (error) {
        console.warn(`[authoritativeMatchFinish] game event log failed: ${error.message}`);
    }
}

async function finishAuthoritativeMatch({
    roomId,
    loserPlayerId,
    finishReason = "top_out",
    match = null,
    finishGame,
    stopRoomTicker,
    emitMatchFinish,
    saveGameEventLog,
    getMatchState = null,
    deleteMatch = null,
}) {
    if (!roomId || !loserPlayerId || typeof finishGame !== "function") {
        return {
            ok: false,
            finished: false,
            reason: "INVALID_FINISH_CONTEXT",
        };
    }

    const finishResult = finishGame(roomId, loserPlayerId, finishReason);
    if (!finishResult.ok) {
        if (finishResult.reason === "GAME_NOT_PLAYING") {
            return {
                ok: true,
                finished: false,
                reason: "ALREADY_FINISHED",
            };
        }

        return {
            ok: false,
            finished: false,
            reason: finishResult.reason,
        };
    }

    const matchForLog = match || getMatchState?.(roomId)?.match || null;
    const gameOverLog = createGameOverLog(finishResult, matchForLog);

    stopRoomTicker?.(roomId);
    emitMatchFinish?.({
        room: createRoomPublicDto(finishResult.room),
        winnerPlayerId: finishResult.winnerPlayerId,
        loserPlayerId: finishResult.loserPlayerId,
        reason: finishResult.finishReason,
    });
    deleteMatch?.(roomId);

    if (typeof saveGameEventLog === "function") {
        await persistGameEventLog(saveGameEventLog, gameOverLog);
    }

    return {
        ok: true,
        finished: true,
        reason: null,
        finishResult,
    };
}

module.exports = {
    finishAuthoritativeMatch,
};
const { createRoomPublicDto } = require("./roomPublicDto.js");
