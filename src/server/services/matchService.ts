// =============================
// 메모리 기반 경기 상태 저장소
// match는 player별 server bag, input acknowledgment, authoritative gameplay state를 저장한다.
// roomService는 membership/lifecycle을 소유하고, 이 저장소는 한 판이 시작될 때 room 설정을 복사한다.
// mutation 함수는 내부 원본을 제자리에서 바꾼다. 조회 경계에서는 복제본을,
// client 전송 경계에서는 server-only 필드를 뺀 축소 DTO를 반환한다.
// =============================
import { randomUUID } from "node:crypto";
import {
    applyAuthoritativeInput,
    applyAuthoritativeGravityStep,
} from "./playerGameplayStep.js";
import {
    DEFAULT_AI_DIFFICULTY,
    DEFAULT_AI_POLICY,
    isValidAiDifficulty,
    isValidAiPolicy,
} from "./aiDifficulty.js";
import type { GarbageEntry } from "../../client/game/core/garbage.js";
import type { PieceState, PlaceablePieceState } from "../../client/game/core/piece.js";
import type { PieceType } from "../../client/game/state/blocks.js";
import type { GamePhase } from "../../client/game/state/stateFactory.js";
import type { ClientToServerParsedPayload, ServerToClientParsedPayload } from "../../shared/socketContractTypes.js";
import type { AiDifficulty, AiPolicy } from "./aiDifficulty.js";
import type { GameCore } from "./gameCoreLoader.js";
import type {
    GameplayResult,
    GravityStepResult,
    PlacementResult,
    PresentationEffect,
} from "./playerGameplayStep.js";
import type { PveAiPlan } from "./pveAiPlayerService.js";
import type { PlayerType, RoomState, RoomStatus } from "./roomService.js";

type ParsedGameInput = ClientToServerParsedPayload<"game:input">;
export type AuthoritativeInput = {
    action: ParsedGameInput["action"];
    tick: number;
    pieceIndex: number;
    clientSequence?: number;
    expectedTransform?: {
        pieceType: PieceType;
        rotation: number;
        col: number;
    };
};
type AuthoritativeBoard = AuthoritativeSnapshotDto["board"];
export type AuthoritativePlayerState = {
    board: AuthoritativeBoard;
    activePiece: PieceState;
    pendingPiece: PieceState | null;
    pieceQueue: PieceType[];
    holdPieceType: PieceType | null;
    holdUsedThisDrop: boolean;
    score: number;
    lines: number;
    phase: GamePhase;
    gameOver: boolean;
    gameOverReason?: string;
    combo: number;
    backToBack: boolean;
    currentTick: number;
    pieceIndex: number;
    pendingGarbageQueue: GarbageEntry[];
    lastActionWasRotation: boolean;
};
export type AiPolicyRuntime = ServerToClientParsedPayload<"pve:ai-policy">;
export type MatchPlayer = {
    playerId: string;
    playerType: PlayerType;
    lastProcessedClientSequence: number;
    expectedPlacementEventCount: number;
    countedPlacementPieceIndexes: Set<number>;
    bagChunks: PieceType[][];
    authoritativeState: AuthoritativePlayerState;
    aiPlan: PveAiPlan | null;
};
export type MatchState = {
    gameId: string;
    roomId: string;
    mode: RoomState["mode"];
    aiDifficulty: AiDifficulty | null;
    aiPolicy: AiPolicy | null;
    aiPolicyRuntime: AiPolicyRuntime | null;
    status: RoomStatus;
    players: MatchPlayer[];
    createdAt: number;
};
export type HumanPlacementReceipt = Readonly<{
    gameId: string;
    roomId: string;
    playerId: string;
    clientSequence: number;
    pieceIndex: number;
    expiresAt: number;
}>;
export type HumanPlacementReceiptResult = {
    ok: true;
    receipt: HumanPlacementReceipt;
    reason: null;
} | {
    ok: false;
    receipt: null;
    reason: string;
};
export type AuthoritativeSnapshotDto = ServerToClientParsedPayload<
    "game:authoritative:snapshot"
>["snapshot"];
type MatchResultFields = {
    bagChunk?: PieceType[] | null;
    targetPlayerId?: string;
    garbage?: GarbageEntry;
    gameplayResult?: GameplayResult;
    gravityResult?: GravityStepResult["gravityResult"];
    gravityStepResult?: GravityStepResult;
    placementResult?: PlacementResult;
    presentationEffect?: PresentationEffect;
    snapshot?: AuthoritativePlayerState | AuthoritativeSnapshotDto;
};
export type MatchResult = MatchResultFields & ({
    ok: true;
    match: MatchState;
    reason: null;
} | {
    ok: false;
    match: MatchState | null;
    reason: string | null;
});
export type AuthoritativeStateResult = Omit<MatchResultFields, "snapshot"> & ({
    ok: true;
    match: MatchState;
    reason: null;
    snapshot: AuthoritativePlayerState;
} | {
    ok: false;
    match: MatchState | null;
    reason: string | null;
    snapshot?: never;
});
export type AuthoritativeSnapshotDtoResult = Omit<MatchResultFields, "snapshot"> & ({
    ok: true;
    match: MatchState;
    reason: null;
    snapshot: AuthoritativeSnapshotDto;
} | {
    ok: false;
    match: MatchState | null;
    reason: string | null;
    snapshot?: never;
});

const matches = new Map<string, MatchState>();
const recentHumanPlacementReceipts = new Map<string, HumanPlacementReceipt[]>();
const BAG_PIECES: PieceType[] = ["bar", "eleft", "eright", "ess", "square", "tree", "zee"];
const INITIAL_BAG_CHUNK_COUNT = 3;
const BOARD_ROWS = 20;
const BOARD_COLS = 10;
const SPAWN_ROW = -1;
const SPAWN_COL = 3;
const POSITION_TRANSFORM_ACTIONS = new Set<AuthoritativeInput["action"]>([
    "move_left", "move_right", "rotate", "rotate_ccw"
]);
const LOCKING_TRANSFORM_ACTIONS = new Set<AuthoritativeInput["action"]>([
    "soft_drop", "hard_drop",
]);
export const HUMAN_PLACEMENT_RECEIPT_TTL_MS = 30_000;
export const HUMAN_PLACEMENT_RECEIPT_MAX_PER_PLAYER = 128;

function createSuccess(match: MatchState, extra: MatchResultFields = {}): MatchResult {
    return {
        ok: true,
        match,
        reason: null,
        ...extra,
    };
}

function createFailure(reason: string): MatchResult {
    return {
        ok: false,
        match: null,
        reason,
    };
}

/**
 * room 상태를 기준으로 match를 시작하고 player별 초기 server bag과 authoritative state를 만든다.
 * 각 player는 독립된 board, queue, hold, score, garbage, sequence를 가지며 같은 match에 묶인다.
 */
export function createMatch(room: RoomState | null | undefined): MatchResult {
    if (!room) {
        return createFailure("ROOM_REQUIRED");
    }

    if (!room.roomId) {
        return createFailure("ROOM_ID_REQUIRED");
    }

    if (!Array.isArray(room.players)) {
        return createFailure("ROOM_PLAYERS_REQUIRED");
    }

    const mode = room.mode || "pvp";
    let aiDifficulty = null;
    let aiPolicy = null;
    if (mode === "pve") {
        if (room.aiDifficulty === undefined || room.aiDifficulty === null) {
            aiDifficulty = DEFAULT_AI_DIFFICULTY;
        } else if (isValidAiDifficulty(room.aiDifficulty)) {
            aiDifficulty = room.aiDifficulty;
        } else {
            return createFailure("INVALID_AI_DIFFICULTY");
        }
        if (room.aiPolicy === undefined || room.aiPolicy === null) {
            aiPolicy = DEFAULT_AI_POLICY;
        } else if (isValidAiPolicy(room.aiPolicy)) {
            aiPolicy = room.aiPolicy;
        } else {
            return createFailure("INVALID_AI_POLICY");
        }
    }
    const match = {
        gameId: randomUUID(),
        roomId: room.roomId,
        mode,
        aiDifficulty,
        aiPolicy,
        aiPolicyRuntime: null,
        status: room.status || "playing",
        players: room.players.map((player) => {
            const bagChunks = createInitialBagChunks();

            return {
                playerId: player.playerId,
                playerType: player.playerType || "human",
                lastProcessedClientSequence: 0,
                expectedPlacementEventCount: 0,
                countedPlacementPieceIndexes: new Set<number>(),
                bagChunks,
                authoritativeState: createInitialPlayerState(bagChunks),
                aiPlan: null,
            };
        }),
        createdAt: Date.now(),
    };

    matches.set(room.roomId, match);

    return createSuccess(match);
}

/**
 * service/ticker가 사용할 MatchState 원본 참조를 조회한다.
 * 같은 human authoritative state에 접근하는 socket input과 gravity는 공용 mutation queue를
 * 거쳐야 한다. client에는 이 원본이 아니라 별도로 만든 snapshot DTO만 전송한다.
 */
export function getMatchState(roomId: string): MatchResult {
    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    return createSuccess(match);
}

export function deleteMatch(roomId: string): MatchResult {
    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    matches.delete(roomId);

    return createSuccess(match);
}

function receiptKey(roomId: string, playerId: string): string {
    return JSON.stringify([roomId, playerId]);
}

function purgeExpiredReceipts(key: string, now: number): HumanPlacementReceipt[] {
    const receipts = recentHumanPlacementReceipts.get(key) || [];
    const current = receipts.filter(receipt => receipt.expiresAt > now);
    if (current.length > 0) {
        recentHumanPlacementReceipts.set(key, current);
    } else {
        recentHumanPlacementReceipts.delete(key);
    }
    return current;
}

function countPlacementTarget(player: MatchPlayer, pieceIndex: number): void {
    if (player.countedPlacementPieceIndexes.has(pieceIndex)) return;
    player.countedPlacementPieceIndexes.add(pieceIndex);
    player.expectedPlacementEventCount += 1;
}

/**
 * 성공한 human authoritative placement를 짧은 receipt로 보존한다.
 * match 삭제 뒤의 정상 late log도 exact sequence/piece tuple로만 인증한다.
 */
export function recordHumanPlacementReceipt(
    roomId: string,
    playerId: string,
    clientSequence: number,
    pieceIndex: number,
    now = Date.now(),
): HumanPlacementReceiptResult {
    const match = matches.get(roomId);
    const player = match?.players.find(candidate => candidate.playerId === playerId);
    if (!match || !player || player.playerType === "heuristic_ai") {
        return {
            ok: false,
            receipt: null,
            reason: "PLACEMENT_RECEIPT_CONTEXT_NOT_FOUND",
        };
    }
    if (
        !Number.isInteger(clientSequence)
        || clientSequence < 1
        || !Number.isInteger(pieceIndex)
        || pieceIndex < 0
    ) {
        return {
            ok: false,
            receipt: null,
            reason: "PLACEMENT_RECEIPT_INVALID",
        };
    }

    const key = receiptKey(roomId, playerId);
    const receipts = purgeExpiredReceipts(key, now);
    const existing = receipts.find(receipt => (
        receipt.gameId === match.gameId
        && receipt.clientSequence === clientSequence
        && receipt.pieceIndex === pieceIndex
    ));
    if (existing) {
        return { ok: true, receipt: existing, reason: null };
    }

    const receipt = Object.freeze({
        gameId: match.gameId,
        roomId,
        playerId,
        clientSequence,
        pieceIndex,
        expiresAt: now + HUMAN_PLACEMENT_RECEIPT_TTL_MS,
    });
    receipts.push(receipt);
    if (receipts.length > HUMAN_PLACEMENT_RECEIPT_MAX_PER_PLAYER) {
        receipts.splice(0, receipts.length - HUMAN_PLACEMENT_RECEIPT_MAX_PER_PLAYER);
    }
    recentHumanPlacementReceipts.set(key, receipts);
    countPlacementTarget(player, pieceIndex);
    return { ok: true, receipt, reason: null };
}

export function authenticateHumanPlacementReceipt(
    roomId: string,
    playerId: string,
    clientSequence: number,
    pieceIndex: number,
    now = Date.now(),
): HumanPlacementReceiptResult {
    const key = receiptKey(roomId, playerId);
    const receipts = purgeExpiredReceipts(key, now);
    const receiptIndex = receipts.findIndex(candidate => (
        candidate.clientSequence === clientSequence
        && candidate.pieceIndex === pieceIndex
    ));
    if (receiptIndex < 0) {
        return {
            ok: false,
            receipt: null,
            reason: "PLACEMENT_RECEIPT_NOT_FOUND",
        };
    }

    const receipt = receipts.splice(receiptIndex, 1)[0];
    if (receipts.length === 0) recentHumanPlacementReceipts.delete(key);
    return receipt
        ? { ok: true, receipt, reason: null }
        : {
            ok: false,
            receipt: null,
            reason: "PLACEMENT_RECEIPT_NOT_FOUND",
        };
}

export function recordAiPlacementEventTarget(
    roomId: string,
    playerId: string,
    pieceIndex: number,
): MatchResult {
    const match = matches.get(roomId);
    if (!match) return createFailure("MATCH_NOT_FOUND");
    const player = match.players.find(candidate => candidate.playerId === playerId);
    if (!player || player.playerType !== "heuristic_ai") {
        return createFailure("PLAYER_NOT_FOUND");
    }
    if (!Number.isInteger(pieceIndex) || pieceIndex < 0) {
        return createFailure("PIECE_INDEX_REQUIRED");
    }
    countPlacementTarget(player, pieceIndex);
    return createSuccess(match);
}

export function clearHumanPlacementReceiptsForPlayer(playerId: string): void {
    for (const [key, receipts] of recentHumanPlacementReceipts) {
        if (receipts.some(receipt => receipt.playerId === playerId)) {
            recentHumanPlacementReceipts.delete(key);
        }
    }
}

export function clearHumanPlacementReceiptsForRoom(roomId: string): void {
    for (const [key, receipts] of recentHumanPlacementReceipts) {
        if (receipts.some(receipt => receipt.roomId === roomId)) {
            recentHumanPlacementReceipts.delete(key);
        }
    }
}

/**
 * 특정 player에게 추가 server bag chunk를 생성해 붙인다.
 * - 멀티플레이에서는 클라이언트 로컬 RNG 대신 이 chunk를 조각 공급원으로 사용한다.
 * - 기록용 `bagChunks`와 실제 소비용 `pieceQueue`를 같은 chunk로 함께 연장한다.
 */
export function appendPlayerBagChunk(roomId: string, playerId: string): MatchResult {
    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    const player = match.players.find((matchPlayer) => {
        return matchPlayer.playerId === playerId;
    });

    if (!player) {
        return createFailure("PLAYER_NOT_FOUND");
    }

    const bagChunk = createBagChunk();
    player.bagChunks.push(bagChunk);
    if (Array.isArray(player.authoritativeState?.pieceQueue)) {
        player.authoritativeState.pieceQueue.push(...bagChunk);
    }

    return createSuccess(match, { bagChunk });
}

/**
 * 공격자가 확정한 garbage를 상대의 대기 queue에 추가한다.
 * board에는 즉시 넣지 않고 상대 조각이 lock될 때 playerGameplayStep이 적용한다.
 */
export function appendPendingGarbageToOpponent(
    roomId: string,
    fromPlayerId: string,
    garbage: GarbageEntry,
): MatchResult {
    const lines = garbage?.lines;
    const holeCol = garbage?.holeCol;
    if (typeof lines !== "number" || !Number.isInteger(lines) || lines <= 0
        || typeof holeCol !== "number" || !Number.isInteger(holeCol)
        || holeCol < 0 || holeCol >= BOARD_COLS) {
        return createFailure("INVALID_GARBAGE");
    }

    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    const fromPlayer = match.players.find((matchPlayer) => {
        return matchPlayer.playerId === fromPlayerId;
    });

    if (!fromPlayer) {
        return createFailure("PLAYER_NOT_FOUND");
    }

    const targetPlayer = match.players.find((matchPlayer) => {
        return matchPlayer.playerId !== fromPlayerId;
    });

    if (!targetPlayer) {
        return createFailure("TARGET_PLAYER_NOT_FOUND");
    }

    if (!targetPlayer.authoritativeState) {
        return {
            ok: false,
            match,
            reason: "AUTHORITATIVE_STATE_NOT_FOUND",
        };
    }

    targetPlayer.authoritativeState.pendingGarbageQueue.push({
        lines,
        holeCol,
    });

    return createSuccess(match, {
        targetPlayerId: targetPlayer.playerId,
        garbage: {
            lines,
            holeCol,
        },
    });
}

/**
 * 검증된 input 하나를 player의 authoritative 원본 state에 적용한다.
 *
 * 순서:
 * 1. `clientSequence` 재전송/역전을 막는다.
 * 2. `pieceIndex`와 lock 계열의 predicted transform을 mutation 전에 비교한다.
 * 3. 공용 game core를 통해 state를 제자리에서 변경한다.
 * 4. sequence 검증을 통과해 시도한 입력은 결과와 무관하게 기록해 다시 적용되지 않게 한다.
 *
 * move/rotate가 서버에서 유효하면 서버 결과는 유지한다. 예상 위치와 다르면
 * `PREDICTION_DIVERGED`를 반환하고 socket 계층이 현재 snapshot으로 client를 보정한다.
 */
export function applyAuthoritativeInputToMatchPlayerState(
    roomId: string,
    playerId: string,
    input: AuthoritativeInput,
    gameCore: GameCore,
): MatchResult {
    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    const player = match.players.find((matchPlayer) => {
        return matchPlayer.playerId === playerId;
    });

    if (!player) {
        return createFailure("PLAYER_NOT_FOUND");
    }

    if (!player.authoritativeState) {
        return {
            ok: false,
            match,
            reason: "AUTHORITATIVE_STATE_NOT_FOUND",
        };
    }

    const clientSequenceValue = input?.clientSequence;
    const clientSequence = typeof clientSequenceValue === "number"
        && Number.isInteger(clientSequenceValue)
        && clientSequenceValue >= 1
        ? clientSequenceValue
        : null;
    if (clientSequence !== null) {
        // handler 밖의 AI/테스트 호출도 같은 단조 증가 규칙을 지키도록 service에서 다시 확인한다.
        const sequenceValidation = validateClientInputSequence(roomId, playerId, clientSequence);
        if (!sequenceValidation.ok) return sequenceValidation;
    }

    if (input?.pieceIndex !== player.authoritativeState.pieceIndex) {
        markClientInputProcessed(player, clientSequence);
        return {
            ok: false,
            match,
            reason: "PIECE_INDEX_MISMATCH",
        };
    }

    const expectedTransform = input?.expectedTransform;
    if (
        LOCKING_TRANSFORM_ACTIONS.has(input?.action) &&
        expectedTransform &&
        !doesPieceMatchExpectedTransform(player.authoritativeState.activePiece, expectedTransform)
    ) {
        markClientInputProcessed(player, clientSequence);
        return {
            ok: false,
            match,
            reason: "PREDICTION_DIVERGED",
        };
    }

    const gameplayResult = applyAuthoritativeInput(player.authoritativeState, input, gameCore);
    if (!gameplayResult.ok) {
        markClientInputProcessed(player, clientSequence);
        return {
            ok: false,
            match,
            reason: expectedTransform
                && POSITION_TRANSFORM_ACTIONS.has(input?.action)
                && gameplayResult.reason === "MOVE_RETRY"
                ? "PREDICTION_DIVERGED"
                : gameplayResult.reason,
            gameplayResult,
        };
    }

    markClientInputProcessed(player, clientSequence);
    if (
        expectedTransform &&
        POSITION_TRANSFORM_ACTIONS.has(input?.action) &&
        !doesPieceMatchExpectedTransform(player.authoritativeState.activePiece, expectedTransform)
    ) {
        return {
            ok: false,
            match,
            reason: "PREDICTION_DIVERGED",
            gameplayResult,
        };
    }
    attachPresentationEffectId(gameplayResult, playerId);
    return createSuccess(match, { gameplayResult });
}

function doesPieceMatchExpectedTransform(
    piece: PieceState,
    expectedTransform: NonNullable<AuthoritativeInput["expectedTransform"]>,
): boolean {
    return piece?.pieceType === expectedTransform.pieceType
        && piece.rotation === expectedTransform.rotation
        && piece.col === expectedTransform.col;
}

function markClientInputProcessed(
    player: MatchPlayer,
    clientSequence: number | null,
): void {
    if (typeof clientSequence !== "number" || !Number.isInteger(clientSequence)) return;

    player.lastProcessedClientSequence = clientSequence;
}

/**
 * client sequence가 player별 마지막 처리 값보다 큰지 확인한다.
 * 이 값은 client prediction의 pending input을 안전하게 제거하기 위한 단조 증가 acknowledgment다.
 */
export function validateClientInputSequence(
    roomId: string,
    playerId: string,
    clientSequence: number,
): MatchResult {
    const match = matches.get(roomId);
    if (!match) return createFailure("MATCH_NOT_FOUND");

    const player = match.players.find(matchPlayer => matchPlayer.playerId === playerId);
    if (!player) return createFailure("PLAYER_NOT_FOUND");
    if (!Number.isInteger(clientSequence) || clientSequence < 1) {
        return createFailure("INVALID_CLIENT_SEQUENCE");
    }

    const lastProcessedClientSequence = Number.isInteger(player.lastProcessedClientSequence)
        ? player.lastProcessedClientSequence
        : 0;
    if (clientSequence <= lastProcessedClientSequence) {
        return createFailure("CLIENT_SEQUENCE_OUT_OF_ORDER");
    }

    return createSuccess(match);
}

/**
 * core 실행 전에 예외가 난 input도 처리 완료로 표시한다.
 * 다음 sequence가 진행될 수 있게 하되 이미 더 큰 acknowledgment를 뒤로 되돌리지는 않는다.
 */
export function acknowledgeClientInputSequence(
    roomId: string,
    playerId: string,
    clientSequence: number,
): MatchResult {
    const match = matches.get(roomId);
    if (!match) return createFailure("MATCH_NOT_FOUND");

    const player = match.players.find(matchPlayer => matchPlayer.playerId === playerId);
    if (!player) return createFailure("PLAYER_NOT_FOUND");
    if (!Number.isInteger(clientSequence) || clientSequence < 1) {
        return createFailure("INVALID_CLIENT_SEQUENCE");
    }

    const lastProcessedClientSequence = Number.isInteger(player.lastProcessedClientSequence)
        ? player.lastProcessedClientSequence
        : 0;
    if (clientSequence < lastProcessedClientSequence) {
        return createFailure("CLIENT_SEQUENCE_OUT_OF_ORDER");
    }

    if (clientSequence > lastProcessedClientSequence) {
        player.lastProcessedClientSequence = clientSequence;
    }
    return createSuccess(match);
}

/**
 * 실제 조각 queue가 임계값 이하일 때만 새 7-bag을 추가한다.
 * client의 중복 요청이 무한히 queue를 늘리지 않게 service에서 다시 확인한다.
 */
export function ensurePlayerBagQueue(
    roomId: string,
    playerId: string,
    minimumRemaining = 7,
): MatchResult {
    const match = matches.get(roomId);
    if (!match) return createFailure("MATCH_NOT_FOUND");

    const player = match.players.find(matchPlayer => matchPlayer.playerId === playerId);
    if (!player) return createFailure("PLAYER_NOT_FOUND");

    const remaining = player.authoritativeState?.pieceQueue?.length ?? 0;
    if (remaining > minimumRemaining) {
        return createSuccess(match, { bagChunk: null });
    }

    return appendPlayerBagChunk(roomId, playerId);
}

export function markAuthoritativePlayerGameOver(
    roomId: string,
    playerId: string,
    reason = "game_over",
): MatchResult {
    const match = matches.get(roomId);
    if (!match) return createFailure("MATCH_NOT_FOUND");

    const player = match.players.find(matchPlayer => matchPlayer.playerId === playerId);
    if (!player?.authoritativeState) {
        return createFailure(player ? "AUTHORITATIVE_STATE_NOT_FOUND" : "PLAYER_NOT_FOUND");
    }

    player.authoritativeState.phase = "gameOver";
    player.authoritativeState.gameOver = true;
    player.authoritativeState.gameOverReason = reason;
    return createSuccess(match);
}

/**
 * timer가 요청한 gravity 한 단계를 authoritative 원본 state에 적용한다.
 * 실제 이동/grounded/lock 판정은 playerGameplayStep에 두고 match 탐색과 결과 포장만 담당한다.
 */
export function applyGravityStepToMatchPlayerState(
    roomId: string,
    playerId: string,
    gameCore: GameCore,
    options: { lockGroundedPiece?: boolean } = {},
): MatchResult {
    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    const player = match.players.find((matchPlayer) => {
        return matchPlayer.playerId === playerId;
    });

    if (!player) {
        return createFailure("PLAYER_NOT_FOUND");
    }

    if (!player.authoritativeState) {
        return {
            ok: false,
            match,
            reason: "AUTHORITATIVE_STATE_NOT_FOUND",
        };
    }

    const gravityStepResult = applyAuthoritativeGravityStep(
        player.authoritativeState,
        gameCore,
        options,
    );
    if (!gravityStepResult.ok) {
        return {
            ok: false,
            match,
            reason: gravityStepResult.reason,
            gravityResult: gravityStepResult.gravityResult,
            gravityStepResult,
        };
    }

    attachPresentationEffectId(gravityStepResult, playerId);
    return createSuccess(match, {
        gravityResult: gravityStepResult.gravityResult,
        gravityStepResult,
        placementResult: gravityStepResult.placementResult,
        presentationEffect: gravityStepResult.presentationEffect,
    });
}

function attachPresentationEffectId(
    gameplayResult: GameplayResult | GravityStepResult,
    playerId: string,
): void {
    const effect = gameplayResult?.presentationEffect;
    if (!effect || !Number.isInteger(effect.pieceIndex)) return;

    gameplayResult.presentationEffect = {
        ...effect,
        id: `${playerId}:${effect.pieceIndex}:line_clear`,
    };
}

/**
 * 내부 authoritative state의 독립 복사본을 반환한다.
 * service 밖에서 조회 결과를 바꿔도 실제 match board와 queue가 변경되지 않는다.
 */
export function getAuthoritativePlayerSnapshot(
    roomId: string,
    playerId: string,
): AuthoritativeStateResult {
    const match = matches.get(roomId);

    if (!match) {
        return {
            ok: false,
            match: null,
            reason: "MATCH_NOT_FOUND",
        };
    }

    const player = match.players.find((matchPlayer) => {
        return matchPlayer.playerId === playerId;
    });

    if (!player) {
        return {
            ok: false,
            match: null,
            reason: "PLAYER_NOT_FOUND",
        };
    }

    if (!player.authoritativeState) {
        return {
            ok: false,
            match,
            reason: "AUTHORITATIVE_STATE_NOT_FOUND",
        };
    }

    return {
        ok: true,
        match,
        reason: null,
        snapshot: cloneAuthoritativeState(player.authoritativeState),
    };
}

/**
 * 내부 state 복사본을 wire contract에 허용된 client snapshot으로 변환한다.
 * pending garbage 상세 queue는 숨기고 총 line 수만 노출하며, 마지막 처리 sequence를 붙인다.
 */
export function getAuthoritativePlayerSnapshotDto(
    roomId: string,
    playerId: string,
): AuthoritativeSnapshotDtoResult {
    const result = getAuthoritativePlayerSnapshot(roomId, playerId);

    if (!result.ok) {
        return result;
    }

    const player = result.match.players.find(matchPlayer => matchPlayer.playerId === playerId);
    const sequence = player?.lastProcessedClientSequence;
    const lastProcessedClientSequence = typeof sequence === "number" && Number.isInteger(sequence)
        ? sequence
        : 0;

    return {
        ok: true,
        match: result.match,
        reason: null,
        snapshot: {
            ...createClientSnapshotDto(result.snapshot),
            lastProcessedClientSequence,
        },
    };
}

function createBagChunk(): PieceType[] {
    const chunk = [...BAG_PIECES];

    for (let i = chunk.length - 1; i > 0; i--) {
        const randomIndex = Math.floor(Math.random() * (i + 1));
        const currentPiece = chunk[i];
        const randomPiece = chunk[randomIndex];
        if (!currentPiece || !randomPiece) continue;
        chunk[i] = randomPiece;
        chunk[randomIndex] = currentPiece;
    }

    return chunk;
}

function createInitialBagChunks(count = INITIAL_BAG_CHUNK_COUNT): PieceType[][] {
    return Array.from({ length: count }, () => createBagChunk());
}

function createInitialPlayerState(bagChunks: PieceType[][] = []): AuthoritativePlayerState {
    const pieceQueue = flattenBagChunks(bagChunks);
    const firstPieceType = pieceQueue.shift();
    const activePiece: PieceState = firstPieceType
        ? {
            pieceType: firstPieceType,
            rotation: 0,
            row: SPAWN_ROW,
            col: SPAWN_COL,
        }
        : {
            pieceType: "",
            rotation: 0,
            row: SPAWN_ROW,
            col: SPAWN_COL,
        };

    return {
        board: createEmptyBoard(),
        activePiece,
        pendingPiece: firstPieceType ? {
            pieceType: firstPieceType,
            rotation: 0,
            row: SPAWN_ROW,
            col: SPAWN_COL,
        } : null,
        pieceQueue,
        holdPieceType: null,
        holdUsedThisDrop: false,
        score: 0,
        lines: 0,
        phase: "playing",
        gameOver: false,
        combo: -1,
        backToBack: false,
        currentTick: 0,
        pieceIndex: firstPieceType ? 1 : 0,
        pendingGarbageQueue: [],
        lastActionWasRotation: false,
    };
}

function flattenBagChunks(bagChunks: PieceType[][]): PieceType[] {
    if (!Array.isArray(bagChunks)) return [];
    return bagChunks.flat();
}

function createEmptyBoard(): AuthoritativeBoard {
    return Array.from({ length: BOARD_ROWS }, () => Array(BOARD_COLS).fill(null));
}

function cloneAuthoritativeState(
    authoritativeState: AuthoritativePlayerState,
): AuthoritativePlayerState {
    // caller가 board/queue/piece를 수정해도 Map 안의 authoritative 원본이 바뀌지 않게 깊이만큼 복사한다.
    return {
        board: authoritativeState.board.map((row) => [...row]),
        activePiece: { ...authoritativeState.activePiece },
        pendingPiece: authoritativeState.pendingPiece
            ? { ...authoritativeState.pendingPiece }
            : null,
        pieceQueue: [...authoritativeState.pieceQueue],
        holdPieceType: authoritativeState.holdPieceType,
        holdUsedThisDrop: authoritativeState.holdUsedThisDrop,
        score: authoritativeState.score,
        lines: authoritativeState.lines,
        phase: authoritativeState.phase,
        gameOver: Boolean(authoritativeState.gameOver),
        combo: authoritativeState.combo,
        backToBack: authoritativeState.backToBack,
        currentTick: authoritativeState.currentTick,
        pieceIndex: authoritativeState.pieceIndex,
        pendingGarbageQueue: authoritativeState.pendingGarbageQueue.map((garbage) => {
            return { ...garbage };
        }),
        lastActionWasRotation: authoritativeState.lastActionWasRotation,
    };
}

function createClientSnapshotDto(
    authoritativeSnapshot: AuthoritativePlayerState,
): Omit<AuthoritativeSnapshotDto, "lastProcessedClientSequence"> {
    const pendingGarbageLines = authoritativeSnapshot.pendingGarbageQueue.reduce((total, garbage) => {
        return total + garbage.lines;
    }, 0);

    // 명시적 whitelist를 만들어 server-only pendingPiece, garbage hole, gameOverReason을 전송하지 않는다.
    return {
        board: authoritativeSnapshot.board.map((row) => [...row]),
        activePiece: authoritativeSnapshot.activePiece
            ? { ...authoritativeSnapshot.activePiece }
            : null,
        pieceQueue: [...authoritativeSnapshot.pieceQueue],
        holdPieceType: authoritativeSnapshot.holdPieceType,
        holdUsedThisDrop: authoritativeSnapshot.holdUsedThisDrop,
        score: authoritativeSnapshot.score,
        lines: authoritativeSnapshot.lines,
        phase: authoritativeSnapshot.phase,
        gameOver: Boolean(authoritativeSnapshot.gameOver),
        combo: authoritativeSnapshot.combo,
        backToBack: authoritativeSnapshot.backToBack,
        tick: authoritativeSnapshot.currentTick,
        pieceIndex: authoritativeSnapshot.pieceIndex,
        pendingGarbageLines,
    };
}

export function resetMatches(): void {
    matches.clear();
    recentHumanPlacementReceipts.clear();
}
