import {
    createCanonicalGameEvent,
} from "../db/canonicalGameEvent.js";
import type {
    CanonicalGameEvent,
    CanonicalJsonValue,
} from "../db/canonicalGameEvent.js";
import {
    validateGameEventLog,
} from "../validators/gameLogValidator.js";
import {
    HUMAN_PLACEMENT_RECEIPT_MAX_PER_PLAYER,
    HUMAN_PLACEMENT_RECEIPT_TTL_MS,
} from "./matchService.js";

const PIECE_TYPES = new Set([
    "bar",
    "eleft",
    "eright",
    "ess",
    "square",
    "tree",
    "zee",
]);
const BOARD_CELL_TYPES = new Set([...PIECE_TYPES, "garbage"]);
const INPUT_ACTIONS = new Set([
    "move_left",
    "move_right",
    "rotate",
    "soft_drop",
    "hard_drop",
    "hold",
]);
const MODES = new Set(["multi", "multiplayer", "pvp", "pve"]);
const AI_DIFFICULTIES = new Set(["normal", "hard"]);
const AI_POLICIES = new Set(["heuristic", "placement_v4"]);
const FINISH_REASONS = new Set([
    "top_out",
    "block_out",
    "disconnect_timeout",
    "ai_no_legal_placement",
    "ai_decision_failed",
]);
const PLAYER_ROLES = new Set(["host", "guest"]);
const PLAYER_TYPES = new Set(["human", "heuristic_ai"]);

type RecordValue = Record<string, unknown>;

export class GameEventProjectionError extends Error {
    readonly code: string;

    constructor(code: string) {
        super(code);
        this.name = "GameEventProjectionError";
        this.code = code;
    }
}

function fail(code = "GAME_EVENT_PROJECTION_INVALID"): never {
    throw new GameEventProjectionError(code);
}

function record(value: unknown): RecordValue {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as RecordValue
        : fail();
}

function finiteNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : fail();
}

function integer(value: unknown, minimum = Number.MIN_SAFE_INTEGER): number {
    return typeof value === "number"
        && Number.isSafeInteger(value)
        && value >= minimum
        ? value
        : fail();
}

function enumString(value: unknown, allowed: Set<string>): string {
    return typeof value === "string" && allowed.has(value)
        ? value
        : fail();
}

function optionalEnum(value: unknown, allowed: Set<string>): string | null {
    return value === null || value === undefined
        ? null
        : enumString(value, allowed);
}

function timestamp(value: unknown): string {
    const milliseconds = finiteNumber(value);
    try {
        return new Date(milliseconds).toISOString();
    } catch {
        return fail();
    }
}

function projectBoard(value: unknown): CanonicalJsonValue {
    if (!Array.isArray(value) || value.length === 0) return fail();
    const width = Array.isArray(value[0]) ? value[0].length : 0;
    if (width === 0) return fail();
    return value.map(row => {
        if (!Array.isArray(row) || row.length !== width) return fail();
        return row.map(cell => (
            cell === null ? null : enumString(cell, BOARD_CELL_TYPES)
        ));
    });
}

function projectCells(value: unknown): CanonicalJsonValue {
    if (!Array.isArray(value) || value.length !== 4) return fail();
    return value.map(cell => {
        const item = record(cell);
        return {
            row: integer(item.row),
            col: integer(item.col),
        };
    });
}

function projectPiece(value: unknown): CanonicalJsonValue {
    const piece = record(value);
    const projected: Record<string, CanonicalJsonValue> = {
        pieceType: enumString(piece.pieceType, PIECE_TYPES),
        rotation: integer(piece.rotation, 0),
        row: integer(piece.row),
        col: integer(piece.col),
    };
    if (piece.cells !== undefined) {
        projected.cells = projectCells(piece.cells);
    }
    return projected;
}

function projectPlacementResult(value: unknown): CanonicalJsonValue {
    const result = record(value);
    const projected: Record<string, CanonicalJsonValue> = {
        linesCleared: integer(result.linesCleared, 0),
        scoreDelta: finiteNumber(result.scoreDelta),
        gameOver: typeof result.gameOver === "boolean" ? result.gameOver : fail(),
    };
    for (const name of [
        "combo",
        "rawAttackLines",
        "attackLines",
        "canceledGarbageLines",
        "incomingGarbageLines",
        "appliedGarbageLines",
    ]) {
        if (result[name] !== undefined) projected[name] = integer(result[name], 0);
    }
    for (const name of ["scoreBefore", "scoreAfter"]) {
        if (result[name] !== undefined) projected[name] = finiteNumber(result[name]);
    }
    for (const name of ["isTSpin", "backToBack"]) {
        if (result[name] !== undefined) {
            projected[name] = typeof result[name] === "boolean" ? result[name] : fail();
        }
    }
    return projected;
}

function projectMetrics(value: unknown): CanonicalJsonValue {
    const metrics = record(value);
    if (!Array.isArray(metrics.columnHeights)) return fail();
    return {
        columnHeights: metrics.columnHeights.map(height => integer(height, 0)),
        aggregateHeight: integer(metrics.aggregateHeight, 0),
        maxHeight: integer(metrics.maxHeight, 0),
        holes: integer(metrics.holes, 0),
        bumpiness: integer(metrics.bumpiness, 0),
        completeLines: integer(metrics.completeLines, 0),
    };
}

function projectEvaluation(value: unknown): CanonicalJsonValue {
    const evaluation = record(value);
    const reason = record(evaluation.reason);
    return {
        score: finiteNumber(evaluation.score),
        candidateCount: integer(evaluation.candidateCount, 0),
        reason: {
            linesCleared: integer(reason.linesCleared, 0),
            holesDelta: finiteNumber(reason.holesDelta),
            bumpinessDelta: finiteNumber(reason.bumpinessDelta),
            aggregateHeightDelta: finiteNumber(reason.aggregateHeightDelta),
            maxHeightDelta: finiteNumber(reason.maxHeightDelta),
        },
    };
}

function projectAiComparison(value: unknown): CanonicalJsonValue {
    const comparison = record(value);
    return {
        heuristicPlacement: projectPiece(comparison.heuristicPlacement),
        heuristicScore: finiteNumber(comparison.heuristicScore),
        userScore: finiteNumber(comparison.userScore),
        betterBy: finiteNumber(comparison.betterBy),
        samePlacement: typeof comparison.samePlacement === "boolean"
            ? comparison.samePlacement
            : fail(),
    };
}

function projectInputSequence(value: unknown): CanonicalJsonValue {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return fail();
    return value.map(rawInput => {
        const input = record(rawInput);
        const projected: Record<string, CanonicalJsonValue> = {
            action: enumString(input.action, INPUT_ACTIONS),
            tick: integer(input.tick, 0),
            pieceIndex: integer(input.pieceIndex, 0),
        };
        if (input.sequence !== undefined) projected.sequence = integer(input.sequence, 0);
        if (input.createdAt !== undefined) projected.createdAt = finiteNumber(input.createdAt);
        return projected;
    });
}

function projectPlacementPayload(log: RecordValue): Record<string, CanonicalJsonValue> {
    const payload: Record<string, CanonicalJsonValue> = {
        roomId: typeof log.roomId === "string" && log.roomId.trim() ? log.roomId : fail(),
        mode: enumString(log.mode, MODES),
        source: log.source === "heuristic_ai" ? "heuristic_ai" : "human",
        authoritativeClientSequence: log.source === "heuristic_ai"
            ? null
            : integer(log.authoritativeClientSequence, 1),
        tick: integer(log.tick, 0),
        boardBefore: projectBoard(log.boardBefore),
        boardAfter: projectBoard(log.boardAfter),
        nextQueue: Array.isArray(log.nextQueue)
            ? log.nextQueue.map(piece => enumString(piece, PIECE_TYPES))
            : [],
        holdPiece: log.holdPiece === null || log.holdPiece === undefined
            ? null
            : enumString(log.holdPiece, PIECE_TYPES),
        inputSequence: projectInputSequence(log.inputSequence),
        selectedPlacement: projectPiece(log.selectedPlacement),
        placementResult: projectPlacementResult(log.placementResult),
    };
    if (log.activePiece !== undefined) payload.activePiece = projectPiece(log.activePiece);
    if (log.schemaVersion === 2) {
        payload.metricsBefore = projectMetrics(log.metricsBefore);
        payload.metricsAfter = projectMetrics(log.metricsAfter);
        payload.evaluation = projectEvaluation(log.evaluation);
        payload.aiDifficulty = optionalEnum(log.aiDifficulty, AI_DIFFICULTIES);
        payload.modelType = log.source === "heuristic_ai" ? "heuristic" : null;
        if (log.source === "human") {
            payload.aiComparison = projectAiComparison(log.aiComparison);
        }
    }
    return payload;
}

function projectPlayers(value: unknown): CanonicalJsonValue {
    if (!Array.isArray(value) || value.length === 0) return fail();
    return value.map(rawPlayer => {
        const player = record(rawPlayer);
        return {
            playerId: typeof player.playerId === "string" && player.playerId.trim()
                ? player.playerId
                : fail(),
            role: enumString(player.role, PLAYER_ROLES),
            playerType: enumString(player.playerType, PLAYER_TYPES),
        };
    });
}

function projectExpectedCounts(value: unknown): CanonicalJsonValue {
    if (!Array.isArray(value) || value.length === 0) return fail();
    return value.map(rawCount => {
        const count = record(rawCount);
        return {
            playerId: typeof count.playerId === "string" && count.playerId.trim()
                ? count.playerId
                : fail(),
            playerType: enumString(count.playerType, PLAYER_TYPES),
            expectedPlacementEventCount: integer(count.expectedPlacementEventCount, 0),
        };
    });
}

function projectGameStart(log: RecordValue): CanonicalGameEvent {
    return createCanonicalGameEvent({
        identityVersion: "identity-v1",
        eventType: "game_start",
        schemaVersion: 2,
        gameId: log.gameId,
        playerId: null,
        pieceIndex: null,
        trustLevel: "server_authoritative",
        occurredAt: timestamp(log.startedAt),
        payload: {
            roomId: log.roomId,
            mode: enumString(log.mode, MODES),
            aiDifficulty: optionalEnum(log.aiDifficulty, AI_DIFFICULTIES),
            aiPolicyRequested: optionalEnum(log.aiPolicyRequested, AI_POLICIES),
            players: projectPlayers(log.players),
        },
    });
}

function projectGameOver(log: RecordValue): CanonicalGameEvent {
    return createCanonicalGameEvent({
        identityVersion: "identity-v1",
        eventType: "game_over",
        schemaVersion: 2,
        gameId: log.gameId,
        playerId: null,
        pieceIndex: null,
        trustLevel: "server_authoritative",
        occurredAt: timestamp(log.endedAt),
        payload: {
            roomId: log.roomId,
            mode: enumString(log.mode, MODES),
            aiDifficulty: optionalEnum(log.aiDifficulty, AI_DIFFICULTIES),
            aiPolicyRequested: optionalEnum(log.aiPolicyRequested, AI_POLICIES),
            aiPolicyLastUsed: optionalEnum(log.aiPolicyLastUsed, AI_POLICIES),
            aiPolicyFallbackCount: integer(log.aiPolicyFallbackCount, 0),
            aiModelSha256: log.aiModelSha256 === null || log.aiModelSha256 === undefined
                ? null
                : typeof log.aiModelSha256 === "string"
                    && /^[0-9a-f]{64}$/.test(log.aiModelSha256)
                    ? log.aiModelSha256
                    : fail(),
            winnerPlayerId: log.winnerPlayerId,
            loserPlayerId: log.loserPlayerId,
            reason: enumString(log.reason, FINISH_REASONS),
            finishType: log.finishType === "normal" ? "normal" : fail(),
            expectedPlacementEventCounts: projectExpectedCounts(
                log.expectedPlacementEventCounts,
            ),
            receiptPolicy: {
                ttlMilliseconds: HUMAN_PLACEMENT_RECEIPT_TTL_MS,
                maxPerPlayer: HUMAN_PLACEMENT_RECEIPT_MAX_PER_PLAYER,
            },
        },
    });
}

function projectPlacement(log: RecordValue): CanonicalGameEvent {
    const isHuman = log.source !== "heuristic_ai";
    if (isHuman && log.source !== undefined && log.source !== "human") return fail();
    if (!isHuman && (log.schemaVersion !== 2 || log.modelType !== "heuristic")) return fail();
    const occurredAt = log.createdAt === undefined
        ? null
        : timestamp(log.createdAt);
    return createCanonicalGameEvent({
        identityVersion: "identity-v1",
        eventType: "placement_decision",
        schemaVersion: log.schemaVersion,
        gameId: log.gameId,
        playerId: log.playerId,
        pieceIndex: log.pieceIndex,
        trustLevel: isHuman ? "client_reported" : "server_authoritative",
        occurredAt,
        payload: projectPlacementPayload(log),
    });
}

/**
 * 검증된 raw log에서 event별 allowlist만 새 canonical object로 투영한다.
 * unknown/private field와 client identity는 호출 전에 제거되며 이 경계에서도 복사되지 않는다.
 */
export function projectGameEventLog(log: unknown): CanonicalGameEvent {
    const validation = validateGameEventLog(log);
    if (!validation.ok) return fail("GAME_EVENT_LOG_INVALID");
    const value = validation.log;
    try {
        if (value.eventType === "game_start") return projectGameStart(value);
        if (value.eventType === "game_over") return projectGameOver(value);
        if (value.eventType === "placement_decision") return projectPlacement(value);
        return fail();
    } catch (error) {
        if (error instanceof GameEventProjectionError) throw error;
        return fail();
    }
}
