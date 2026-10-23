/**
 * 브라우저와 AI가 만든 game log를 영속화하기 전 검사하는 신뢰 경계다.
 *
 * 공통 검사에서 JSON 직렬화 가능성, 최대 256 KiB, schema version을 확인한 뒤 event별
 * 필드를 검사한다. 기존 lifecycle v1과 placement v1/v2를 보존하고 v3는 40행
 * 규칙·좌표·관찰 문맥을 추가 검증한다. v2/v3는 board·piece·metrics·source/model도 검사한다.
 */

import {
    isValidAiDifficulty,
    isValidAiPolicy,
} from "../services/aiDifficulty.js";
import { isValidGameplayLogV3 } from "./gameplayLogV3.js";

export const DEFAULT_MAX_LOG_BYTES = 256 * 1024;

export type ValidatedLog = Record<string, unknown>;
export type LogValidationResult = {
    ok: true;
    log: ValidatedLog;
    reason: null;
} | {
    ok: false;
    log: null;
    reason: string;
};
type ValidationOptions = {
    maxBytes?: number;
    allowedSchemaVersions?: number[];
};

function createSuccess(log: ValidatedLog): LogValidationResult {
    return {
        ok: true,
        log,
        reason: null,
    };
}

function createFailure(reason: string): LogValidationResult {
    return {
        ok: false,
        log: null,
        reason,
    };
}

/**
 * placement_decision 공통 필드와 schema별 세부 계약을 검증한다.
 * optional authoritative lineage가 있으면 client sequence와 pieceIndex가 쌍으로 존재하고
 * 실제 placement의 `pieceIndex`와 일치해야 한다.
 */
export function validatePlacementDecisionLog(
    log: unknown,
    options: ValidationOptions = {},
): LogValidationResult {
    const baseResult = validateBaseLog(log, {
        ...options,
        allowedSchemaVersions: [1, 2, 3],
    });
    if (!baseResult.ok || !isPlainObject(log)) return baseResult;

    if (log.eventType !== "placement_decision") {
        return createFailure("INVALID_EVENT_TYPE");
    }

    if (!isNonEmptyString(log.playerId)) {
        return createFailure("PLAYER_ID_REQUIRED");
    }

    if (!isNonEmptyString(log.gameId)) {
        return createFailure("GAME_ID_REQUIRED");
    }

    if (!isNonNegativeInteger(log.pieceIndex)) {
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
    if (isPlainObject(log.placementResult) && log.placementResult.tSpinType !== undefined
        && !isValidPlacementResult(log.placementResult)) {
        return createFailure("INVALID_PLACEMENT_RESULT");
    }

    if (log.schemaVersion === 1) {
        return validateLegacyPlacementDecisionLog(log);
    }

    if (log.schemaVersion === 3 && !isValidGameplayLogV3(log, "placement_decision")) {
        return createFailure("INVALID_V3_GAMEPLAY_CONTEXT");
    }

    return validatePlacementDecisionLogV2(log);
}

function validateLegacyPlacementDecisionLog(log: ValidatedLog): LogValidationResult {
    if (log.source !== undefined && log.source !== "human"
        && log.source !== "heuristic_ai" && log.source !== "ml_ai") {
        return createFailure("INVALID_SOURCE");
    }

    if (log.source === "heuristic_ai") {
        if (log.modelType !== "heuristic") {
            return createFailure("INVALID_MODEL_TYPE");
        }
        const evaluation = log.evaluation;
        if (!isPlainObject(evaluation)
            || !isFiniteNumber(evaluation.score)
            || !isNonNegativeInteger(evaluation.candidateCount)
            || !isPlainObject(evaluation.reason)) {
            return createFailure("INVALID_AI_EVALUATION");
        }
    }

    return createSuccess(log);
}

function validatePlacementDecisionLogV2(log: ValidatedLog): LogValidationResult {
    if (!isNonEmptyString(log.roomId)) {
        return createFailure("ROOM_ID_REQUIRED");
    }
    if (!isNonNegativeInteger(log.tick)) {
        return createFailure("TICK_REQUIRED");
    }
    if (!isNonNegativeNumber(log.createdAt)) {
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

export function validateGameStartLog(
    log: unknown,
    options: ValidationOptions = {},
): LogValidationResult {
    const baseResult = validateBaseLog(log, { ...options, allowedSchemaVersions: options.allowedSchemaVersions ?? [1, 3] });
    if (!baseResult.ok || !isPlainObject(log)) return baseResult;

    if (log.eventType !== "game_start") {
        return createFailure("INVALID_EVENT_TYPE");
    }
    if (log.schemaVersion === 3 && !isValidGameplayLogV3(log, "game_start")) {
        return createFailure("INVALID_V3_GAMEPLAY_CONTEXT");
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

    if (!isFiniteNumber(log.startedAt)) {
        return createFailure("STARTED_AT_REQUIRED");
    }

    if (!Array.isArray(log.players) || log.players.length === 0) {
        return createFailure("PLAYERS_REQUIRED");
    }

    if (log.aiPolicyRequested != null && !isValidAiPolicy(log.aiPolicyRequested)) {
        return createFailure("INVALID_AI_POLICY_REQUESTED");
    }

    const hasInvalidPlayer = log.players.some(player => {
        return !isPlainObject(player) || !isNonEmptyString(player.playerId);
    });

    if (hasInvalidPlayer) {
        return createFailure("PLAYER_ID_REQUIRED");
    }

    return createSuccess(log);
}

export function validateGameOverLog(
    log: unknown,
    options: ValidationOptions = {},
): LogValidationResult {
    const baseResult = validateBaseLog(log, { ...options, allowedSchemaVersions: options.allowedSchemaVersions ?? [1, 3] });
    if (!baseResult.ok || !isPlainObject(log)) return baseResult;

    if (log.eventType !== "game_over") {
        return createFailure("INVALID_EVENT_TYPE");
    }
    if (log.schemaVersion === 3 && !isValidGameplayLogV3(log, "game_over")) {
        return createFailure("INVALID_V3_GAMEPLAY_CONTEXT");
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

    if (!isFiniteNumber(log.endedAt)) {
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
        && !isNonNegativeInteger(log.aiPolicyFallbackCount)
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
        && (!isNonEmptyString(log.aiModelSha256) || !/^[0-9a-f]{64}$/.test(log.aiModelSha256))
    ) {
        return createFailure("INVALID_AI_MODEL_SHA256");
    }

    return createSuccess(log);
}

/**
 * eventType에 따라 game_start, placement_decision, game_over validator로 분기한다.
 * 알 수 없는 event는 append-only 원본에 섞지 않고 즉시 거부한다.
 */
export function validateGameEventLog(
    log: unknown,
    options: ValidationOptions = {},
): LogValidationResult {
    if (!isPlainObject(log)) {
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

function validateBaseLog(
    log: unknown,
    options: ValidationOptions = {},
): LogValidationResult {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_LOG_BYTES;
    const allowedSchemaVersions = options.allowedSchemaVersions || [1];

    if (!isPlainObject(log)) {
        return createFailure("LOG_REQUIRED");
    }

    let payloadBytes;
    try {
        // JSON.stringify 실패는 순환 참조처럼 JSONL로 저장할 수 없는 payload를 뜻한다.
        payloadBytes = Buffer.byteLength(JSON.stringify(log), "utf8");
    } catch {
        return createFailure("INVALID_LOG_PAYLOAD");
    }
    if (payloadBytes > maxBytes) {
        return createFailure("LOG_PAYLOAD_TOO_LARGE");
    }

    if (typeof log.schemaVersion !== "number"
        || !allowedSchemaVersions.includes(log.schemaVersion)) {
        return createFailure("INVALID_SCHEMA_VERSION");
    }

    return createSuccess(log);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
    return isFiniteNumber(value) && value >= 0;
}

function isInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
    return isInteger(value) && value >= 0;
}

function isPlainObject(value: unknown): value is ValidatedLog {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidAuthoritativeLineage(log: ValidatedLog): boolean {
    const hasClientSequence = Object.hasOwn(log, "authoritativeClientSequence");
    const hasPieceIndex = Object.hasOwn(log, "authoritativePieceIndex");
    if (!hasClientSequence && !hasPieceIndex) return true;

    return hasClientSequence &&
        hasPieceIndex &&
        isInteger(log.authoritativeClientSequence) &&
        log.authoritativeClientSequence >= 1 &&
        isInteger(log.authoritativePieceIndex) &&
        log.authoritativePieceIndex >= 0 &&
        log.authoritativePieceIndex === log.pieceIndex;
}

function isValidBoard(board: unknown): board is unknown[][] {
    if (!Array.isArray(board) || board.length === 0) return false;

    const columnCount = board[0]?.length ?? 0;
    if (columnCount === 0) return false;

    return board.every(row => {
        return Array.isArray(row) &&
            row.length === columnCount &&
            row.every(cell => cell === null || isNonEmptyString(cell));
    });
}

function hasSameBoardDimensions(left: unknown[][], right: unknown[][]): boolean {
    return left.length === right.length && left[0].length === right[0].length;
}

function isValidPlacement(placement: unknown): boolean {
    if (!isPlainObject(placement)) return false;
    if (!isNonEmptyString(placement.pieceType)) return false;
    if (!isNonNegativeInteger(placement.rotation)) return false;
    if (!isInteger(placement.row) || !isInteger(placement.col)) return false;
    if (!Array.isArray(placement.cells) || placement.cells.length !== 4) return false;

    const cellKeys = new Set();
    const hasValidCells = placement.cells.every(cell => {
        if (
            !isPlainObject(cell) ||
            !isInteger(cell.row) ||
            !isInteger(cell.col)
        ) {
            return false;
        }
        cellKeys.add(`${cell.row}:${cell.col}`);
        return true;
    });

    return hasValidCells && cellKeys.size === 4;
}

function isValidPlacementResult(result: unknown): boolean {
    if (!(isPlainObject(result) &&
        isNonNegativeInteger(result.linesCleared) &&
        isFiniteNumber(result.scoreDelta) &&
        typeof result.gameOver === "boolean")) return false;
    if (result.tSpinType === undefined) return true;
    return (result.tSpinType === "none" || result.tSpinType === "mini" || result.tSpinType === "full")
        && result.isTSpin === (result.tSpinType !== "none")
        && (result.tSpinType !== "mini" || result.linesCleared <= 2)
        && (result.tSpinType !== "full" || result.linesCleared <= 3);
}

function isValidMetrics(metrics: unknown, columnCount: number): boolean {
    if (!isPlainObject(metrics)) return false;
    if (!Array.isArray(metrics.columnHeights) || metrics.columnHeights.length !== columnCount) {
        return false;
    }
    if (!metrics.columnHeights.every(isNonNegativeInteger)) {
        return false;
    }

    return [
        "aggregateHeight",
        "maxHeight",
        "holes",
        "bumpiness",
        "completeLines",
    ].every(field => isNonNegativeInteger(metrics[field]));
}

function isValidEvaluation(evaluation: unknown): boolean {
    if (!isPlainObject(evaluation)) return false;
    if (!isFiniteNumber(evaluation.score)) return false;
    if (!isInteger(evaluation.candidateCount) || evaluation.candidateCount <= 0) {
        return false;
    }

    const reason = evaluation.reason;
    return isPlainObject(reason) &&
        isNonNegativeInteger(reason.linesCleared) &&
        [
            "holesDelta",
            "bumpinessDelta",
            "aggregateHeightDelta",
            "maxHeightDelta",
        ].every(field => isFiniteNumber(reason[field]));
}

function isValidSourceModelPair(source: unknown, modelType: unknown): boolean {
    if (source === "human") return modelType === null;
    if (source === "heuristic_ai") return modelType === "heuristic";
    return false;
}

function isValidAiComparison(comparison: unknown): boolean {
    if (!isPlainObject(comparison)) return false;
    if (!isValidPlacement(comparison.heuristicPlacement)) return false;
    if (!isFiniteNumber(comparison.heuristicScore)) return false;
    if (!isFiniteNumber(comparison.userScore)) return false;
    if (!isFiniteNumber(comparison.betterBy)) return false;
    if (typeof comparison.samePlacement !== "boolean") return false;

    const expectedBetterBy = comparison.heuristicScore - comparison.userScore;
    return Math.abs(comparison.betterBy - expectedBetterBy) <= Number.EPSILON * 10;
}
