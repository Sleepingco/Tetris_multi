const DEFAULT_MAX_LOG_BYTES = 256 * 1024;
const {
    isValidAiDifficulty,
    isValidAiPolicy,
} = require("../services/aiDifficulty.js");

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
    const baseResult = validateBaseLog(log, {
        ...options,
        allowedSchemaVersions: [1, 2],
    });
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
    if (!isValidAuthoritativeLineage(log)) {
        return createFailure("INVALID_AUTHORITATIVE_LINEAGE");
    }

    if (log.schemaVersion === 1) {
        return validateLegacyPlacementDecisionLog(log);
    }

    return validatePlacementDecisionLogV2(log);
}

function validateLegacyPlacementDecisionLog(log) {
    if (log.source !== undefined && !["human", "heuristic_ai", "ml_ai"].includes(log.source)) {
        return createFailure("INVALID_SOURCE");
    }

    if (log.source === "heuristic_ai") {
        if (log.modelType !== "heuristic") {
            return createFailure("INVALID_MODEL_TYPE");
        }
        if (
            !log.evaluation ||
            !Number.isFinite(log.evaluation.score) ||
            !Number.isInteger(log.evaluation.candidateCount) ||
            log.evaluation.candidateCount < 0 ||
            !log.evaluation.reason ||
            typeof log.evaluation.reason !== "object" ||
            Array.isArray(log.evaluation.reason)
        ) {
            return createFailure("INVALID_AI_EVALUATION");
        }
    }

    return createSuccess(log);
}

function validatePlacementDecisionLogV2(log) {
    if (!isNonEmptyString(log.roomId)) {
        return createFailure("ROOM_ID_REQUIRED");
    }
    if (!Number.isInteger(log.tick) || log.tick < 0) {
        return createFailure("TICK_REQUIRED");
    }
    if (!Number.isFinite(log.createdAt) || log.createdAt < 0) {
        return createFailure("CREATED_AT_REQUIRED");
    }
    if (!isValidBoard(log.boardBefore) || !isValidBoard(log.boardAfter)) {
        return createFailure("INVALID_BOARD");
    }
    if (!hasSameBoardDimensions(log.boardBefore, log.boardAfter)) {
        return createFailure("BOARD_DIMENSIONS_MISMATCH");
    }
    if (!isValidPlacement(log.activePiece)) {
        return createFailure("ACTIVE_PIECE_REQUIRED");
    }
    if (!isValidPlacement(log.selectedPlacement)) {
        return createFailure("INVALID_SELECTED_PLACEMENT");
    }
    if (!Array.isArray(log.nextQueue) || !log.nextQueue.every(isNonEmptyString)) {
        return createFailure("INVALID_NEXT_QUEUE");
    }
    if (log.holdPiece !== null && !isNonEmptyString(log.holdPiece)) {
        return createFailure("INVALID_HOLD_PIECE");
    }
    if (!isValidPlacementResult(log.placementResult)) {
        return createFailure("INVALID_PLACEMENT_RESULT");
    }
    if (!isValidMetrics(log.metricsBefore, log.boardBefore[0].length)) {
        return createFailure("INVALID_METRICS_BEFORE");
    }
    if (!isValidMetrics(log.metricsAfter, log.boardAfter[0].length)) {
        return createFailure("INVALID_METRICS_AFTER");
    }
    if (!isValidEvaluation(log.evaluation)) {
        return createFailure("INVALID_EVALUATION");
    }
    if (!isNonEmptyString(log.source)) {
        return createFailure("SOURCE_REQUIRED");
    }
    if (!isValidSourceModelPair(log.source, log.modelType)) {
        return createFailure("INVALID_SOURCE_MODEL");
    }
    if (log.aiDifficulty !== undefined && !isValidAiDifficulty(log.aiDifficulty)) {
        return createFailure("INVALID_AI_DIFFICULTY");
    }
    if (log.source === "human" && !isValidAiComparison(log.aiComparison)) {
        return createFailure("INVALID_AI_COMPARISON");
    }
    if (log.source === "heuristic_ai" && log.aiComparison != null) {
        return createFailure("AI_COMPARISON_NOT_ALLOWED");
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

    if (log.aiPolicyRequested != null && !isValidAiPolicy(log.aiPolicyRequested)) {
        return createFailure("INVALID_AI_POLICY_REQUESTED");
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

    if (log.aiPolicyRequested != null && !isValidAiPolicy(log.aiPolicyRequested)) {
        return createFailure("INVALID_AI_POLICY_REQUESTED");
    }
    if (log.aiPolicyLastUsed != null && !isValidAiPolicy(log.aiPolicyLastUsed)) {
        return createFailure("INVALID_AI_POLICY_USED");
    }
    if (
        log.aiPolicyFallbackCount !== undefined
        && (!Number.isInteger(log.aiPolicyFallbackCount) || log.aiPolicyFallbackCount < 0)
    ) {
        return createFailure("INVALID_AI_POLICY_FALLBACK_COUNT");
    }
    if (
        log.aiPolicyLastFallbackReason != null
        && !isNonEmptyString(log.aiPolicyLastFallbackReason)
    ) {
        return createFailure("INVALID_AI_POLICY_FALLBACK_REASON");
    }
    if (
        log.aiModelSha256 != null
        && !/^[0-9a-f]{64}$/.test(log.aiModelSha256)
    ) {
        return createFailure("INVALID_AI_MODEL_SHA256");
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
    const allowedSchemaVersions = options.allowedSchemaVersions || [1];

    if (!log || typeof log !== "object" || Array.isArray(log)) {
        return createFailure("LOG_REQUIRED");
    }

    let payloadBytes;
    try {
        payloadBytes = Buffer.byteLength(JSON.stringify(log), "utf8");
    } catch {
        return createFailure("INVALID_LOG_PAYLOAD");
    }
    if (payloadBytes > maxBytes) {
        return createFailure("LOG_PAYLOAD_TOO_LARGE");
    }

    if (!allowedSchemaVersions.includes(log.schemaVersion)) {
        return createFailure("INVALID_SCHEMA_VERSION");
    }

    return createSuccess(log);
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidAuthoritativeLineage(log) {
    const hasClientSequence = Object.hasOwn(log, "authoritativeClientSequence");
    const hasPieceIndex = Object.hasOwn(log, "authoritativePieceIndex");
    if (!hasClientSequence && !hasPieceIndex) return true;

    return hasClientSequence &&
        hasPieceIndex &&
        Number.isInteger(log.authoritativeClientSequence) &&
        log.authoritativeClientSequence >= 1 &&
        Number.isInteger(log.authoritativePieceIndex) &&
        log.authoritativePieceIndex >= 0 &&
        log.authoritativePieceIndex === log.pieceIndex;
}

function isValidBoard(board) {
    if (!Array.isArray(board) || board.length === 0) return false;

    const columnCount = board[0]?.length ?? 0;
    if (columnCount === 0) return false;

    return board.every(row => {
        return Array.isArray(row) &&
            row.length === columnCount &&
            row.every(cell => cell === null || isNonEmptyString(cell));
    });
}

function hasSameBoardDimensions(left, right) {
    return left.length === right.length && left[0].length === right[0].length;
}

function isValidPlacement(placement) {
    if (!isPlainObject(placement)) return false;
    if (!isNonEmptyString(placement.pieceType)) return false;
    if (!Number.isInteger(placement.rotation) || placement.rotation < 0) return false;
    if (!Number.isInteger(placement.row) || !Number.isInteger(placement.col)) return false;
    if (!Array.isArray(placement.cells) || placement.cells.length !== 4) return false;

    const cellKeys = new Set();
    const hasValidCells = placement.cells.every(cell => {
        if (
            !isPlainObject(cell) ||
            !Number.isInteger(cell.row) ||
            !Number.isInteger(cell.col)
        ) {
            return false;
        }
        cellKeys.add(`${cell.row}:${cell.col}`);
        return true;
    });

    return hasValidCells && cellKeys.size === 4;
}

function isValidPlacementResult(result) {
    return isPlainObject(result) &&
        Number.isInteger(result.linesCleared) &&
        result.linesCleared >= 0 &&
        Number.isFinite(result.scoreDelta) &&
        typeof result.gameOver === "boolean";
}

function isValidMetrics(metrics, columnCount) {
    if (!isPlainObject(metrics)) return false;
    if (!Array.isArray(metrics.columnHeights) || metrics.columnHeights.length !== columnCount) {
        return false;
    }
    if (!metrics.columnHeights.every(value => Number.isInteger(value) && value >= 0)) {
        return false;
    }

    return [
        "aggregateHeight",
        "maxHeight",
        "holes",
        "bumpiness",
        "completeLines",
    ].every(field => Number.isInteger(metrics[field]) && metrics[field] >= 0);
}

function isValidEvaluation(evaluation) {
    if (!isPlainObject(evaluation)) return false;
    if (!Number.isFinite(evaluation.score)) return false;
    if (!Number.isInteger(evaluation.candidateCount) || evaluation.candidateCount <= 0) {
        return false;
    }

    const reason = evaluation.reason;
    return isPlainObject(reason) &&
        Number.isInteger(reason.linesCleared) &&
        reason.linesCleared >= 0 &&
        [
            "holesDelta",
            "bumpinessDelta",
            "aggregateHeightDelta",
            "maxHeightDelta",
        ].every(field => Number.isFinite(reason[field]));
}

function isValidSourceModelPair(source, modelType) {
    if (source === "human") return modelType === null;
    if (source === "heuristic_ai") return modelType === "heuristic";
    return false;
}

function isValidAiComparison(comparison) {
    if (!isPlainObject(comparison)) return false;
    if (!isValidPlacement(comparison.heuristicPlacement)) return false;
    if (!Number.isFinite(comparison.heuristicScore)) return false;
    if (!Number.isFinite(comparison.userScore)) return false;
    if (!Number.isFinite(comparison.betterBy)) return false;
    if (typeof comparison.samePlacement !== "boolean") return false;

    const expectedBetterBy = comparison.heuristicScore - comparison.userScore;
    return Math.abs(comparison.betterBy - expectedBetterBy) <= Number.EPSILON * 10;
}

module.exports = {
    DEFAULT_MAX_LOG_BYTES,
    validateGameEventLog,
    validateGameOverLog,
    validateGameStartLog,
    validatePlacementDecisionLog,
};
