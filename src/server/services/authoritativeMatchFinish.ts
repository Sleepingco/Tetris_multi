// =============================
// 서버 확정 경기 종료
// socket input, gravity, AI, disconnect가 같은 종료 순서를 공유하도록 한 곳에서 조율한다.
// =============================
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

function createGameOverLog(result: Extract<FinishGameResult, { ok: true }>, match: MatchState | null) {
    if (!match?.gameId) return null;
    return {
        eventType: "game_over",
        schemaVersion: 1,
        gameId: match.gameId,
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
        expectedPlacementEventCounts: match.players.map(player => ({
            playerId: player.playerId,
            playerType: player.playerType,
            expectedPlacementEventCount: player.expectedPlacementEventCount,
        })),
    };
}

function persistGameEventLog(
    saveGameEventLog: NonNullable<FinishAuthoritativeMatchOptions["saveGameEventLog"]>,
    log: unknown,
): void {
    try {
        void Promise.resolve(saveGameEventLog(log))
            .then(result => {
                if (!result.ok) {
                    console.warn(
                        `[authoritativeMatchFinish] game event log failed: ${result.reason}`,
                    );
                }
            })
            .catch(() => {
                console.warn(
                    "[authoritativeMatchFinish] game event log failed: LOG_WRITE_FAILED",
                );
            });
    } catch {
        console.warn("[authoritativeMatchFinish] game event log failed: LOG_WRITE_FAILED");
    }
}

/**
 * 패배가 확정된 한 판을 한 번만 종료한다.
 *
 * `finishGame`이 room을 `playing → finished`로 바꾸는 첫 gate다. 이미 처리된 종료는
 * `ALREADY_FINISHED`로 끝내 emit과 log를 반복하지 않는다. 성공하면 다음 순서를 지킨다.
 *
 * 1. 삭제 전에 match metadata로 game-over log를 만든다.
 * 2. ticker를 멈추고 public finish payload를 room에 보낸다.
 * 3. 실행 중 board를 가진 match는 삭제하되 결과 화면용 room은 유지한다.
 * 4. 로그는 gameplay 종료를 되돌리지 않는 best-effort 부작용으로 저장한다.
 */
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

    // room lifecycle 전환이 중복 종료의 단일 판정 지점이다.
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

    if (saveGameEventLog && gameOverLog) {
        persistGameEventLog(saveGameEventLog, gameOverLog);
    }

    return {
        ok: true,
        finished: true,
        reason: null,
        finishResult,
    };
}
