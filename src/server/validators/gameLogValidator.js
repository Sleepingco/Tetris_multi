const DEFAULT_MAX_LOG_BYTES = 256 * 1024;

function createSuccess(log) {
    return {
        ok: true,
        log,
        reason: null,
    };
}

function createFailure(reason) {
    return {
        ok: false,
        log: null,
        reason,
    };
}

function validatePlacementDecisionLog(log, options = {}) {
    const baseResult = validateBaseLog(log, options);
    if (!baseResult.ok) return baseResult;

    if (log.eventType !== "placement_decision") {
        return createFailure("INVALID_EVENT_TYPE");
    }

    if (!isNonEmptyString(log.playerId)) {
        return createFailure("PLAYER_ID_REQUIRED");
    }

    if (!isNonEmptyString(log.gameId)) {
        return createFailure("GAME_ID_REQUIRED");
    }

    if (!Number.isInteger(log.pieceIndex) || log.pieceIndex < 0) {
        return createFailure("PIECE_INDEX_REQUIRED");
    }

    if (!Array.isArray(log.boardBefore)) {
        return createFailure("BOARD_BEFORE_REQUIRED");
    }

    if (!Array.isArray(log.boardAfter)) {
        return createFailure("BOARD_AFTER_REQUIRED");
    }

    if (!log.selectedPlacement || typeof log.selectedPlacement !== "object" || Array.isArray(log.selectedPlacement)) {
        return createFailure("SELECTED_PLACEMENT_REQUIRED");
    }

    return createSuccess(log);
}

function validateGameStartLog(log, options = {}) {
    const baseResult = validateBaseLog(log, options);
    if (!baseResult.ok) return baseResult;

    if (log.eventType !== "game_start") {
        return createFailure("INVALID_EVENT_TYPE");
    }

    if (!isNonEmptyString(log.gameId)) {
        return createFailure("GAME_ID_REQUIRED");
    }

    if (!isNonEmptyString(log.roomId)) {
        return createFailure("ROOM_ID_REQUIRED");
    }

    if (!isNonEmptyString(log.mode)) {
        return createFailure("MODE_REQUIRED");
    }

    if (!Number.isFinite(log.startedAt)) {
        return createFailure("STARTED_AT_REQUIRED");
    }

    if (!Array.isArray(log.players) || log.players.length === 0) {
        return createFailure("PLAYERS_REQUIRED");
    }

    const hasInvalidPlayer = log.players.some(player => {
        return !player || !isNonEmptyString(player.playerId);
    });

    if (hasInvalidPlayer) {
        return createFailure("PLAYER_ID_REQUIRED");
    }

    return createSuccess(log);
}

function validateGameOverLog(log, options = {}) {
    const baseResult = validateBaseLog(log, options);
    if (!baseResult.ok) return baseResult;

    if (log.eventType !== "game_over") {
        return createFailure("INVALID_EVENT_TYPE");
    }

    if (!isNonEmptyString(log.gameId)) {
        return createFailure("GAME_ID_REQUIRED");
    }

    if (!isNonEmptyString(log.roomId)) {
        return createFailure("ROOM_ID_REQUIRED");
    }

    if (!isNonEmptyString(log.mode)) {
        return createFailure("MODE_REQUIRED");
    }

    if (!Number.isFinite(log.endedAt)) {
        return createFailure("ENDED_AT_REQUIRED");
    }

    if (!isNonEmptyString(log.winnerPlayerId)) {
        return createFailure("WINNER_PLAYER_ID_REQUIRED");
    }

    if (!isNonEmptyString(log.loserPlayerId)) {
        return createFailure("LOSER_PLAYER_ID_REQUIRED");
    }

    if (!isNonEmptyString(log.reason)) {
        return createFailure("REASON_REQUIRED");
    }

    if (!isNonEmptyString(log.finishType)) {
        return createFailure("FINISH_TYPE_REQUIRED");
    }

    return createSuccess(log);
}

function validateGameEventLog(log, options = {}) {
    if (!log || typeof log !== "object" || Array.isArray(log)) {
        return createFailure("LOG_REQUIRED");
    }

    if (log.eventType === "placement_decision") {
        return validatePlacementDecisionLog(log, options);
    }

    if (log.eventType === "game_start") {
        return validateGameStartLog(log, options);
    }

    if (log.eventType === "game_over") {
        return validateGameOverLog(log, options);
    }

    return createFailure("INVALID_EVENT_TYPE");
}

function validateBaseLog(log, options = {}) {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_LOG_BYTES;

    if (!log || typeof log !== "object" || Array.isArray(log)) {
        return createFailure("LOG_REQUIRED");
    }

    const payloadBytes = Buffer.byteLength(JSON.stringify(log), "utf8");
    if (payloadBytes > maxBytes) {
        return createFailure("LOG_PAYLOAD_TOO_LARGE");
    }

    if (log.schemaVersion !== 1) {
        return createFailure("INVALID_SCHEMA_VERSION");
    }

    return createSuccess(log);
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

module.exports = {
    DEFAULT_MAX_LOG_BYTES,
    validateGameEventLog,
    validateGameOverLog,
    validateGameStartLog,
    validatePlacementDecisionLog,
};
