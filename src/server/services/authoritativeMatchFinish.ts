import { createRoomPublicDto } from "./roomPublicDto.js";
import type { ServerToClientParsedPayload } from "../../shared/socketContractTypes.js";
import type { LogSaveResult } from "./logService.js";
import type { MatchResult, MatchState } from "./matchService.js";
import type { FinishGameResult } from "./roomService.js";

type MatchFinishPayload = ServerToClientParsedPayload<"match:finish">;
type FinishAuthoritativeMatchOptions = {
    roomId: string;
    loserPlayerId: string;
    finishReason?: string;
    match?: MatchState | null;
    finishGame: (
        roomId: string,
        loserPlayerId: string,
        finishReason?: string,
    ) => FinishGameResult;
    stopRoomTicker?: (roomId: string) => unknown;
    emitMatchFinish?: (payload: MatchFinishPayload) => unknown;
    saveGameEventLog?: (log: unknown) => Promise<LogSaveResult> | LogSaveResult;
    getMatchState?: ((roomId: string) => MatchResult) | null;
    deleteMatch?: ((roomId: string) => MatchResult) | null;
};
export type FinishAuthoritativeMatchResult = {
    ok: boolean;
    finished: boolean;
    reason: string | null;
    finishResult?: FinishGameResult;
};

function createGameId(roomId: string, match: MatchState | null): string {
    return match?.createdAt
        ? `${roomId}-${match.createdAt}`
        : roomId;
}

function createGameOverLog(result: Extract<FinishGameResult, { ok: true }>, match: MatchState | null) {
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

async function persistGameEventLog(
    saveGameEventLog: NonNullable<FinishAuthoritativeMatchOptions["saveGameEventLog"]>,
    log: unknown,
): Promise<void> {
    try {
        await saveGameEventLog(log);
    } catch (error) {
        const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
        console.warn(`[authoritativeMatchFinish] game event log failed: ${message}`);
    }
}

export async function finishAuthoritativeMatch({
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
}: FinishAuthoritativeMatchOptions): Promise<FinishAuthoritativeMatchResult> {
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

    if (saveGameEventLog) {
        await persistGameEventLog(saveGameEventLog, gameOverLog);
    }

    return {
        ok: true,
        finished: true,
        reason: null,
        finishResult,
    };
}
