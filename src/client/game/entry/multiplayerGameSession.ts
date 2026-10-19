import { createTetrisRuntime } from "../runtime/tetris.ts"
import { attachKeyboardInput } from "../runtime/input.ts"
import {
    receiveAuthoritativeSnapshot,
    sendGameInput,
    onGameInputResult,
    requestGameBagChunk,
    reconnectPlayerSession,
    receiveGameBagAppend,
    onGameBagResult,
    onSessionDisconnected,
} from "../../net/roomClient.ts"
import { sendPlacementDecisionLog } from "../../net/logClient.ts"
import { evaluateOwnSnapshotCorrection } from "../runtime/snapshotCorrection.ts"
import type { SnapshotDriftState } from "../runtime/snapshotCorrection.ts"
import type {
    InputOutcomeRecord,
    PlacementDecisionLog,
    TetrisRuntime,
    TetrisSnapshotInput,
} from "../runtime/tetris.ts"
import type { PieceType } from "../state/blocks.ts"
import type { ServerToClientParsedPayload } from "../../../shared/socketContractTypes.d.ts"

/**
 * multiplayer page와 공용 Tetris runtime 사이를 연결하는 session 조율자다.
 *
 * 이 모듈은 게임 규칙을 새로 결정하지 않는다. 내 runtime에는 입력 반응성을 위한
 * local prediction을 허용하고, 서버의 acknowledgment와 snapshot으로 최종 상태에
 * 수렴시킨다. 상대 runtime은 입력이나 gravity를 실행하지 않고 authoritative snapshot을
 * 화면에 보여 주는 replica로만 사용한다.
 *
 * 입력 흐름:
 * keyboard → myGame prediction → game:input → server result/snapshot → 필요 시 correction
 *
 * 상태 원천:
 * - 내 조작 중 임시 화면: myGame local state
 * - 승패·garbage·최종 board: server authoritative snapshot
 * - 상대 화면: opponentGame에 복사한 server snapshot
 */
type GameJoinResult = ServerToClientParsedPayload<"game:join:result">;
type Match = NonNullable<GameJoinResult["match"]>;
type MatchSnapshot = ServerToClientParsedPayload<"game:authoritative:snapshot">["snapshot"];
type PresentationEffect = NonNullable<
    ServerToClientParsedPayload<"game:authoritative:snapshot">["presentationEffect"]
>;
type CombatEffect = NonNullable<ServerToClientParsedPayload<"game:authoritative:snapshot">["combatEffect"]>;
export type CombatPresentation = { playerId: string; effect: CombatEffect };
type GameInputResult = ServerToClientParsedPayload<"game:input:result">;
type ExpectedTransform = { pieceType: PieceType; rotation: number; col: number };
type PendingServerInput = InputOutcomeRecord["input"] & { expectedTransform?: ExpectedTransform };
type PlacementAttempt = {
    pieceIndex: number;
    tick: number;
    log: PlacementDecisionLog | null;
    clientSequence: number | null;
    authoritativeCommitted: boolean;
};
export type MultiplayerGameOptions = {
    roomId: string;
    playerId: string;
    opponentPlayerId: string;
    mode?: "multi" | "pve";
    match: Match;
    myCanvas: HTMLCanvasElement;
    opponentCanvas: HTMLCanvasElement;
    myNextPreviewEl?: HTMLElement | null;
    myHoldPreviewEl?: HTMLElement | null;
    myScoreEl?: HTMLElement | null;
    myLinesEl?: HTMLElement | null;
    myPendingGarbageEl?: HTMLElement | null;
    opponentNextPreviewEl?: HTMLElement | null;
    opponentHoldPreviewEl?: HTMLElement | null;
    opponentScoreEl?: HTMLElement | null;
    opponentLinesEl?: HTMLElement | null;
    opponentPendingGarbageEl?: HTMLElement | null;
    onUserInteract?: (() => void) | null;
    onCombatEffect?: ((presentation: CombatPresentation) => void) | null;
    deferStart?: boolean;
};
export type MultiplayerGameSession = {
    myGame: TetrisRuntime;
    opponentGame: TetrisRuntime;
    heartbeatTimer: ReturnType<typeof setInterval>;
    detachAuthoritativeSnapshot: () => void;
    detachGameInputResult: () => void;
    detachGameBagAppend: () => void;
    detachGameBagResult: () => void;
    detachSessionDisconnected: () => void;
    destroy: () => void;
    start: () => void;
};

const AFTER_ACTION_TRANSFORM_INPUTS = new Set([
    "move_left",
    "move_right",
    "rotate",
    "rotate_ccw",
])
const BEFORE_ACTION_TRANSFORM_INPUTS = new Set([
    "soft_drop",
    "hard_drop",
])

const SERVER_SNAPSHOT_TIMEOUT_MS = 5000;

function getPlayerBagChunks(match: Match, targetPlayerId: string): PieceType[][] | null {
    const matchPlayer = match?.players?.find(player => player.playerId === targetPlayerId)
    return Array.isArray(matchPlayer?.bagChunks) ? matchPlayer.bagChunks : null
}

function getPlayerInitialSnapshot(match: Match, targetPlayerId: string): MatchSnapshot | null {
    const matchPlayer = match?.players?.find(player => player.playerId === targetPlayerId)
    return Array.isArray(matchPlayer?.snapshot?.board) ? matchPlayer.snapshot : null
}

/**
 * 멀티 게임 세션을 시작한다.
 *
 * 내 runtime, 상대 runtime, socket listener, server bag heartbeat와 cleanup을 한 생명주기로
 * 묶는다. 페이지는 반환된 destroy만 호출하면 이 세션이 만든 timer와 listener를 모두
 * 정리할 수 있다.
 *
 * 실행 순서:
 * 1. game:join 응답의 bag/snapshot으로 두 runtime을 초기화한다.
 * 2. 내 keyboard 결과에 clientSequence를 붙여 서버로 전송한다.
 * 3. acknowledgment가 오기 전에는 오래된 own snapshot을 보류한다.
 * 4. pending 입력이 사라지면 snapshot drift를 평가하고 필요한 경우에만 보정한다.
 *
 * @returns 두 runtime과 전체 정리 함수를 포함한 multiplayer session
 */
export function startMultiplayerGame({
    roomId,
    playerId,
    opponentPlayerId,
    mode = "multi",
    match,
    myCanvas,
    opponentCanvas,
    myNextPreviewEl,
    myHoldPreviewEl,
    myScoreEl,
    myLinesEl,
    myPendingGarbageEl,
    opponentNextPreviewEl,
    opponentHoldPreviewEl,
    opponentScoreEl,
    opponentLinesEl,
    opponentPendingGarbageEl,
    onUserInteract,
    onCombatEffect,
    deferStart = false,
}: MultiplayerGameOptions): MultiplayerGameSession {
    const myBagChunks = getPlayerBagChunks(match, playerId)
    const opponentBagChunks = getPlayerBagChunks(match, opponentPlayerId)
    const gameId = match?.createdAt
        ? `${roomId}-${match.createdAt}`
        : roomId

    // =============================
    // 서버 확정 배치 로그 게이트
    // local runtime이 만든 log와 서버의 placement commit이 모두 확인된 경우에만 저장한다.
    // =============================

    const pendingPlacementAttempts = new Map<string, PlacementAttempt>()
    const placementAttemptKeyByClientSequence = new Map<number, string>()
    const settledPlacementAttemptKeys = new Set<string>()
    let placementLogBufferClosed = false
    let hasAuthoritativeGameOver = false
    let destroyed = false
    let presentationActive = true;
    let gameplayStarted = !deferStart;
    let lastAuthoritativeSnapshotAt = performance.now();

    const myGame = createTetrisRuntime({
        boardCanvasEl: myCanvas,
        scoreEl: myScoreEl,
        linesEl: myLinesEl,
        pendingGarbageEl: myPendingGarbageEl,
        nextPreviewEl: myNextPreviewEl,
        holdPreviewEl: myHoldPreviewEl,
        mode: mode === "pve" ? "pve" : "multi",
        gameId,
        roomId,
        playerId,
        placementDecisionRecorder(log) {
            if (destroyed) return
            bufferLocalPlacementLog(log)
        },
        inputOutcomeRecorder: handleLocalInputOutcome,
    })
    myGame.init({ autoStart: !deferStart, serverBagChunks: myBagChunks })
    const myInitialSnapshot = getPlayerInitialSnapshot(match, playerId)
    if (myInitialSnapshot) {
        myGame.applySnapshot(myInitialSnapshot, { resumeGravity: !deferStart })
    }
    const initialSequence = myInitialSnapshot?.lastProcessedClientSequence
    const initialClientSequence = typeof initialSequence === "number"
        && Number.isInteger(initialSequence) && initialSequence >= 0
        ? initialSequence
        : 0
    let nextClientSequence = initialClientSequence + 1
    let lastOwnSnapshotTick = -1;
    let lastOwnSnapshotSequence = -1;
    let lastAcknowledgedClientSequence = initialClientSequence
    const pendingServerInputs = new Map<number, PendingServerInput>()
    let deferredOwnSnapshot: MatchSnapshot | null = null
    let pendingOwnDriftState: SnapshotDriftState | null = null
    let lastForcedResyncClientSequence = -1

    function createPlacementAttemptKey(
        pieceIndex: number | null | undefined,
        tick: number | null | undefined,
    ): string | null {
        if (typeof pieceIndex !== "number" || !Number.isInteger(pieceIndex) || pieceIndex < 0) return null
        if (typeof tick !== "number" || !Number.isInteger(tick) || tick < 0) return null
        return `${pieceIndex}:${tick}`
    }

    function getOrCreatePlacementAttempt(
        key: string | null,
        pieceIndex: number | null | undefined,
        tick: number | null | undefined,
    ): PlacementAttempt | null {
        if (!key || placementLogBufferClosed || settledPlacementAttemptKeys.has(key)) return null
        if (typeof pieceIndex !== "number" || typeof tick !== "number") return null
        if (!pendingPlacementAttempts.has(key)) {
            pendingPlacementAttempts.set(key, {
                pieceIndex,
                tick,
                log: null,
                clientSequence: null,
                authoritativeCommitted: false,
            })
        }
        return pendingPlacementAttempts.get(key) ?? null
    }

    function settlePlacementAttempt(key: string | null | undefined): void {
        if (!key) return
        pendingPlacementAttempts.delete(key)
        settledPlacementAttemptKeys.add(key)
    }

    /**
     * local placement log와 authoritative commit을 하나의 저장 event로 합친다.
     *
     * 두 비동기 결과는 도착 순서가 일정하지 않다. `pieceIndex:tick`으로 같은 시도를
     * 찾고, server가 처리한 clientSequence까지 확인된 뒤에만 lineage를 붙여 전송한다.
     * 완료 key를 별도로 기억해 늦게 도착한 중복 결과가 같은 log를 다시 만들지 못하게 한다.
     *
     * @returns log를 실제 전송했으면 true
     */
    function flushPlacementAttempt(key: string | null | undefined): boolean {
        if (!key) return false
        const attempt = pendingPlacementAttempts.get(key)
        if (!attempt?.log || !attempt.authoritativeCommitted) return false
        if (!Number.isInteger(attempt.clientSequence)) return false

        sendPlacementDecisionLog(roomId, playerId, {
            ...attempt.log,
            authoritativeClientSequence: attempt.clientSequence,
            authoritativePieceIndex: attempt.pieceIndex,
        })
        settlePlacementAttempt(key)
        maybeClosePlacementLogBufferAfterGameOver()
        return true
    }

    function bufferLocalPlacementLog(log: PlacementDecisionLog): void {
        const key = createPlacementAttemptKey(log?.pieceIndex, log?.tick)
        const attempt = getOrCreatePlacementAttempt(key, log?.pieceIndex, log?.tick)
        if (!attempt || attempt.log) return

        attempt.log = log
        flushPlacementAttempt(key)
    }

    function registerTerminalPlacementInput(
        outcome: InputOutcomeRecord,
        clientSequence: number,
    ): void {
        if (outcome?.placementCommitted !== true) return

        const pieceIndex = outcome.input?.pieceIndex
        const tick = outcome.input?.tick
        const key = createPlacementAttemptKey(pieceIndex, tick)
        const attempt = getOrCreatePlacementAttempt(key, pieceIndex, tick)
        if (!attempt || !key) return

        attempt.clientSequence = clientSequence
        placementAttemptKeyByClientSequence.set(clientSequence, key)
    }

    function discardPlacementLogBuffer({ close = false }: { close?: boolean } = {}): void {
        for (const key of pendingPlacementAttempts.keys()) {
            settledPlacementAttemptKeys.add(key)
        }
        pendingPlacementAttempts.clear()
        placementAttemptKeyByClientSequence.clear()
        if (close) placementLogBufferClosed = true
    }

    /**
     * game:input:result를 placement log의 authoritative 확인으로 반영한다.
     *
     * 요청이 성공했더라도 해당 입력이 실제 placement를 commit했고 pieceIndex가 같아야 한다.
     * 거부되거나 다른 조각 결과라면 local log를 학습 데이터로 보내지 않고 폐기한다.
     *
     * @returns void
     */
    function handlePlacementInputResult(result: GameInputResult): void {
        const clientSequence = result?.clientSequence
        if (typeof clientSequence !== "number" || !Number.isInteger(clientSequence)) return

        const key = placementAttemptKeyByClientSequence.get(clientSequence)
        if (!key) return
        placementAttemptKeyByClientSequence.delete(clientSequence)

        const attempt = pendingPlacementAttempts.get(key)
        const placementCommitted = result?.ok === true
            && result?.placementCommitted === true
            && result?.pieceIndex === attempt?.pieceIndex
        if (!attempt || !placementCommitted) {
            settlePlacementAttempt(key)
            return
        }

        attempt.authoritativeCommitted = true
        flushPlacementAttempt(key)
    }

    function maybeClosePlacementLogBufferAfterGameOver(): void {
        if (!hasAuthoritativeGameOver || placementLogBufferClosed) return
        if (placementAttemptKeyByClientSequence.size > 0) return
        const awaitsDelayedLocalLog = [...pendingPlacementAttempts.values()].some(attempt => {
            return attempt.authoritativeCommitted && !attempt.log
        })
        if (awaitsDelayedLocalLog) return

        discardPlacementLogBuffer({ close: true })
    }

    /**
     * local action 결과에서 서버 divergence 검사에 사용할 조각 모양을 고른다.
     *
     * 좌우 이동과 회전은 action 이후 transform을 비교한다. soft/hard drop처럼 조각을
     * 고정할 수 있는 action은 runtime 결과가 다음 조각으로 넘어갈 수 있으므로 action
     * 이전 transform을 사용한다.
     *
     * @returns 비교 가능한 piece transform 또는 만들 수 없으면 null
     */
    function createExpectedTransform(outcome: InputOutcomeRecord): ExpectedTransform | null {
        const piece = AFTER_ACTION_TRANSFORM_INPUTS.has(outcome.input.action)
            ? outcome.activePieceAfter
            : BEFORE_ACTION_TRANSFORM_INPUTS.has(outcome.input.action)
                ? outcome.activePieceBefore
                : null
        if (!piece?.pieceType) return null

        return {
            pieceType: piece.pieceType,
            rotation: piece.rotation,
            col: piece.col,
        }
    }

    /**
     * local runtime에 실제 적용된 입력을 순서가 있는 authoritative input으로 전송한다.
     *
     * 화면 prediction에 적용되지 않은 입력은 보내지 않는다. 전송에 성공한 입력만
     * pendingServerInputs에 기록하며, 이 Map이 비어야 보류한 own snapshot을 적용할 수 있다.
     *
     * @returns void
     */
    function handleLocalInputOutcome(outcome: InputOutcomeRecord): void {
        if (destroyed) return
        if (!outcome?.applied || !outcome.input) return
        if (outcome.input.pieceIndex === null) return

        const expectedTransform = createExpectedTransform(outcome)
        const clientSequence = nextClientSequence
        nextClientSequence += 1
        const didSend = outcome.input.action === "hold"
            ? sendGameInput(
                roomId,
                playerId,
                outcome.input.action,
                outcome.input.tick,
                outcome.input.pieceIndex,
                clientSequence,
            )
            : expectedTransform
                ? sendGameInput(
                    roomId,
                    playerId,
                    outcome.input.action,
                    outcome.input.tick,
                    outcome.input.pieceIndex,
                    clientSequence,
                    expectedTransform,
                )
                : false
        if (!didSend) {
            settlePlacementAttempt(createPlacementAttemptKey(
                outcome.input.pieceIndex,
                outcome.input.tick,
            ))
            return
        }

        registerTerminalPlacementInput(outcome, clientSequence)
        pendingServerInputs.set(clientSequence, {
            ...outcome.input,
            ...(expectedTransform ? { expectedTransform } : {}),
        })
    }

    // keyboard는 내 runtime에만 연결한다. 상대 runtime에는 입력 loop와 gravity가 없으며
    // 아래 snapshot listener가 전달한 authoritative 상태만 표시한다.
    myGame.runtime.detachKeyboard = attachKeyboardInput({
        enqueueAction: (action) => {
            if (destroyed || !gameplayStarted) return
            myGame.enqueueInput(action, null, myGame.runtime.pieceIndex)
        },
        onUserInteract: () => {
            if (!destroyed) onUserInteract?.()
        },
    })

    const opponentGame = createTetrisRuntime({
        boardCanvasEl: opponentCanvas,
        scoreEl: opponentScoreEl,
        linesEl: opponentLinesEl,
        pendingGarbageEl: opponentPendingGarbageEl,
        nextPreviewEl: opponentNextPreviewEl,
        holdPreviewEl: opponentHoldPreviewEl,
        mode: mode === "pve" ? "pve" : "multi",
        gameId,
        roomId,
        playerId: opponentPlayerId,
    })
    // 상대 보드는 서버 authoritative snapshot만 반영한다.
    opponentGame.init({ autoStart: false, serverBagChunks: opponentBagChunks })
    const opponentInitialSnapshot = getPlayerInitialSnapshot(match, opponentPlayerId)
    if (opponentInitialSnapshot) {
        opponentGame.applySnapshot(opponentInitialSnapshot)
    }

    let hasPendingBagRequest = false
    let lastOpponentPresentationPieceIndex = -1
    let lastOpponentPresentationEffectId: string | null = null
    const initialPieceIndexes = [
        [playerId, myInitialSnapshot?.pieceIndex ?? 0],
        [opponentPlayerId, opponentInitialSnapshot?.pieceIndex ?? 0],
    ] as const;
    const latestCombatSnapshotIndexes = new Map<string, number>(initialPieceIndexes);
    const lastCombatPieceIndexes = new Map(initialPieceIndexes.map(([id, index]) => [id, index - 1]));
    const bagLowWatermark = 7

    // =============================
    // 내 예측 상태 보정
    // acknowledgment로 처리된 입력을 제거하고, 안전한 시점에 own snapshot을 비교·적용한다.
    // =============================

    /**
     * 서버가 처리했다고 확인한 sequence까지 pending prediction을 제거한다.
     *
     * acknowledgment는 단조 증가해야 한다. 아직 보내지 않은 sequence나 이미 처리한
     * 과거 값은 무시해 오래된 응답이 현재 prediction 상태를 되돌리지 못하게 한다.
     *
     * @returns void
     */
    function acknowledgeServerInputs(clientSequence: number | undefined): void {
        if (typeof clientSequence !== "number" || !Number.isInteger(clientSequence) || clientSequence < 0) return
        if (clientSequence >= nextClientSequence) return
        if (clientSequence <= lastAcknowledgedClientSequence) return

        lastAcknowledgedClientSequence = clientSequence
        for (const sequence of pendingServerInputs.keys()) {
            if (sequence <= clientSequence) {
                pendingServerInputs.delete(sequence)
            }
        }
    }

    function updateOwnPendingGarbage(snapshot: MatchSnapshot): void {
        if (Number.isInteger(snapshot.pendingGarbageLines)) {
            myGame.setAuthoritativePendingGarbageLines(snapshot.pendingGarbageLines)
        }
    }

    /**
     * 입력 처리 중 도착한 own snapshot 중 가장 최신 acknowledgment를 가진 하나만 보관한다.
     *
     * pending input이 남아 있을 때 snapshot을 즉시 적용하면 사용자가 방금 움직인 조각이
     * 과거 위치로 되감긴다. 입력이 정리될 때까지 최신 snapshot 하나만 기다리게 한다.
     *
     * @returns void
     */
    function deferOwnSnapshot(snapshot: MatchSnapshot): void {
        const incomingSequence = Number.isInteger(snapshot.lastProcessedClientSequence)
            ? snapshot.lastProcessedClientSequence
            : 0
        const currentDeferredSnapshot = deferredOwnSnapshot
        const deferredSequence = currentDeferredSnapshot
            && Number.isInteger(currentDeferredSnapshot.lastProcessedClientSequence)
            ? currentDeferredSnapshot.lastProcessedClientSequence
            : -1

        if (!deferredOwnSnapshot || incomingSequence >= deferredSequence) {
            deferredOwnSnapshot = snapshot
        }
        pendingOwnDriftState = null
    }

    /**
     * authoritative snapshot과 local prediction의 차이가 보정할 만큼 중요한지 판정한다.
     *
     * 일시적인 좌우 이동·회전 차이는 입력 반응성을 위해 유지할 수 있다. game over,
     * settled board 불일치 또는 지속되는 drift처럼 의미 있는 차이만 runtime에 적용한다.
     *
     * @returns snapshot을 실제 적용했으면 true
     */
    function evaluateOwnSnapshot(
        snapshot: MatchSnapshot,
        localSnapshot = myGame.getSnapshot(),
    ): boolean {
        const correctionDecision = evaluateOwnSnapshotCorrection(
            snapshot,
            localSnapshot,
            pendingOwnDriftState,
            globalThis.performance.now(),
        )
        pendingOwnDriftState = correctionDecision.nextPendingDriftState

        if (correctionDecision.shouldCorrect) {
            pendingOwnDriftState = null
            myGame.applySnapshot(snapshot, { resumeGravity: gameplayStarted })
            return true
        }
        myGame.syncLockDelay(snapshot);
        return false
    }

    /**
     * local/server 입력 대기열이 모두 비었을 때 보류 중인 최신 snapshot을 다시 평가한다.
     *
     * 이미 더 높은 acknowledgment를 처리했다면 보류 snapshot은 낡은 상태이므로 버리고
     * 다음 server snapshot을 기다린다.
     *
     * @returns void
     */
    function applyDeferredOwnSnapshotIfReady(): void {
        if (!deferredOwnSnapshot) return
        if (pendingServerInputs.size > 0 || myGame.getPendingInputCount() > 0) return

        const snapshot = deferredOwnSnapshot
        deferredOwnSnapshot = null
        const snapshotClientSequence = Number.isInteger(snapshot.lastProcessedClientSequence)
            && snapshot.lastProcessedClientSequence >= 0
            ? snapshot.lastProcessedClientSequence
            : 0
        if (snapshotClientSequence < lastAcknowledgedClientSequence) return

        evaluateOwnSnapshot(snapshot)
    }

    /**
     * 서버가 PREDICTION_DIVERGED를 반환했을 때 local prediction을 즉시 authoritative 상태로 교체한다.
     *
     * 일반 drift 보정과 달리 서버가 입력 전제 자체의 불일치를 확인한 경로다. 그래서
     * pending input, 보류 snapshot, presentation과 미확정 placement log를 함께 폐기한다.
     *
     * @returns 유효한 최신 snapshot을 강제로 적용했으면 true
     */
    function applyForcedOwnSnapshot(result: GameInputResult): boolean {
        const snapshot = result?.snapshot
        const clientSequence = result?.clientSequence
        if (!snapshot || !Array.isArray(snapshot.board)) return false
        if (typeof clientSequence !== "number"
            || !Number.isInteger(clientSequence) || clientSequence < 0) return false
        if (clientSequence >= nextClientSequence) return false
        if (clientSequence <= lastForcedResyncClientSequence) return false

        const processedSequence = snapshot.lastProcessedClientSequence
        const snapshotClientSequence = typeof processedSequence === "number"
            && Number.isInteger(processedSequence)
            ? processedSequence
            : clientSequence
        if (snapshotClientSequence < lastAcknowledgedClientSequence) return false

        lastForcedResyncClientSequence = clientSequence
        discardPlacementLogBuffer()
        pendingServerInputs.clear()
        deferredOwnSnapshot = null
        pendingOwnDriftState = null
        myGame.applySnapshot(snapshot, {
            resumeGravity: gameplayStarted,
            clearInputQueue: true,
            cancelPresentation: true,
        })
        return true
    }

    /**
     * own authoritative snapshot을 prediction 상태에 맞는 방식으로 처리한다.
     *
     * game over는 항상 즉시 적용한다. 그 외에는 오래된 snapshot을 거르고, pending input이
     * 있으면 보류하며, 입력이 없을 때만 drift 판정기로 보정 여부를 결정한다. 보정하지
     * 않더라도 server가 소유하는 pending garbage 표시는 갱신한다.
     *
     * @returns void
     */
    function handleOwnAuthoritativeSnapshot(snapshot: MatchSnapshot): void {
        const localSnapshot = myGame.getSnapshot()
        const snapshotClientSequence = Number.isInteger(snapshot.lastProcessedClientSequence)
            && snapshot.lastProcessedClientSequence >= 0
            ? snapshot.lastProcessedClientSequence
            : 0

        if (snapshot.phase === "gameOver") {
            hasAuthoritativeGameOver = true
            acknowledgeServerInputs(snapshotClientSequence)
            pendingServerInputs.clear()
            deferredOwnSnapshot = null
            pendingOwnDriftState = null
            myGame.applySnapshot(snapshot, { resumeGravity: gameplayStarted })
            maybeClosePlacementLogBufferAfterGameOver()
            return
        }

        if (snapshotClientSequence < lastAcknowledgedClientSequence) return;
        if (snapshotClientSequence < lastOwnSnapshotSequence
            || (snapshotClientSequence === lastOwnSnapshotSequence && snapshot.tick < lastOwnSnapshotTick)) return;
        lastOwnSnapshotSequence = snapshotClientSequence;
        lastOwnSnapshotTick = snapshot.tick;

        acknowledgeServerInputs(snapshotClientSequence)

        if (pendingServerInputs.size > 0 || myGame.getPendingInputCount() > 0) {
            updateOwnPendingGarbage(snapshot)
            deferOwnSnapshot(snapshot)
            return
        }

        deferredOwnSnapshot = null
        if (!evaluateOwnSnapshot(snapshot, localSnapshot)) {
            updateOwnPendingGarbage(snapshot)
        }
    }

    /**
     * server bag 잔량이 낮아지면 한 번만 추가 chunk를 요청한다.
     * - hasPendingBagRequest로 같은 구간의 중복 요청을 막는다.
     *
     * @returns {void}
     */
    function requestBagIfNeeded(): void {
        if (!gameplayStarted) return;
        if (!hasPendingBagRequest && myGame.getServerBagRemainingCount() <= bagLowWatermark) {
            hasPendingBagRequest = requestGameBagChunk(roomId, playerId)
        }
    }

    // bag 보충과 서버 스트림 단절만 확인한다. gravity와 game over는 판정하지 않는다.
    const heartbeatTimer = setInterval(() => {
        if (destroyed) return
        if (gameplayStarted && performance.now() - lastAuthoritativeSnapshotAt >= SERVER_SNAPSHOT_TIMEOUT_MS) {
            destroy();
            reconnectPlayerSession();
            return;
        }
        requestBagIfNeeded()
    }, 500)

    // =============================
    // 서버 확정 스냅샷 스트림
    // 상대 snapshot은 그대로 적용하고, own snapshot은 prediction 보정 규칙을 통과시킨다.
    // presentationEffect는 화면 연출이며 gameplay state를 다시 계산하지 않는다.
    // =============================

    const detachAuthoritativeSnapshot = receiveAuthoritativeSnapshot(({
        roomId: snapshotRoomId,
        playerId: remotePlayerId,
        snapshot,
        presentationEffect,
        combatEffect,
    }) => {
        if (destroyed) return
        if (snapshotRoomId !== roomId) return;
        if (!snapshot || !Array.isArray(snapshot.board)) return
        if (remotePlayerId !== playerId && remotePlayerId !== opponentPlayerId) return;
        lastAuthoritativeSnapshotAt = performance.now();

        if (remotePlayerId === opponentPlayerId) {
            opponentGame.applySnapshot(snapshot)
            if (presentationEffect && shouldPlayOpponentPresentation(presentationEffect)) {
                const didPlay = opponentGame.playLineClearPresentation({
                    rows: presentationEffect.rows,
                    board: presentationEffect.boardBeforeClear,
                })
                if (didPlay) {
                    lastOpponentPresentationPieceIndex = presentationEffect.pieceIndex
                    lastOpponentPresentationEffectId = presentationEffect.id
                }
            }
            playCombatPresentation(remotePlayerId, snapshot, combatEffect);
            return
        }

        if (remotePlayerId === playerId) {
            handleOwnAuthoritativeSnapshot(snapshot)
            playCombatPresentation(remotePlayerId, snapshot, combatEffect);
        }
    })

    /** match UUID와 placement 순서를 확인해 중복·재접속 이전·늦은 다른 match 효과를 버린다. */
    function playCombatPresentation(
        actorId: string,
        snapshot: MatchSnapshot,
        effect: CombatEffect | undefined,
    ): void {
        const latestIndex = Math.max(latestCombatSnapshotIndexes.get(actorId) ?? 0, snapshot.pieceIndex);
        latestCombatSnapshotIndexes.set(actorId, latestIndex);
        if (!presentationActive || !effect || !match.gameId || effect.gameId !== match.gameId) return;
        if (effect.id !== `${match.gameId}:${actorId}:${effect.pieceIndex}:combat`) return;
        if (effect.pieceIndex < latestIndex - 1 || effect.pieceIndex > snapshot.pieceIndex) return;
        if (effect.pieceIndex <= (lastCombatPieceIndexes.get(actorId) ?? -1)) return;
        const targetId = actorId === playerId ? opponentPlayerId : playerId;
        if (effect.sentLines > 0 && effect.targetPlayerId !== targetId) return;
        lastCombatPieceIndexes.set(actorId, effect.pieceIndex);
        onCombatEffect?.({ playerId: actorId, effect });
    }

    /**
     * 상대 line-clear 연출이 유효하고 아직 재생하지 않은 최신 effect인지 확인한다.
     *
     * effect id의 형식·중복과 pieceIndex의 증가 여부를 각각 검사해 reconnect나
     * 중복 snapshot이 같은 연출을 반복하지 못하게 한다.
     * 이 검사는 presentation 전용이며 상대 board의 authoritative 적용 여부와는 무관하다.
     *
     * @returns 한 번 재생해도 되는 새 line-clear effect이면 true
     */
    function shouldPlayOpponentPresentation(effect: PresentationEffect): boolean {
        if (!presentationActive) return false;
        if (!effect || effect.type !== "line_clear") return false
        if (typeof effect.id !== "string" || effect.id.length === 0) return false
        if (!Number.isInteger(effect.pieceIndex) || effect.pieceIndex < 0) return false
        if (effect.id !== `${opponentPlayerId}:${effect.pieceIndex}:line_clear`) return false
        if (effect.id === lastOpponentPresentationEffectId) return false
        if (effect.pieceIndex <= lastOpponentPresentationPieceIndex) return false
        if (!Array.isArray(effect.rows) || !Array.isArray(effect.boardBeforeClear)) return false
        return true
    }
    const detachGameInputResultListener = onGameInputResult((result) => {
        if (destroyed) return
        handlePlacementInputResult(result)
        if (Number.isInteger(result?.clientSequence)) {
            acknowledgeServerInputs(result.clientSequence)
        }
        if (result?.reason === "PREDICTION_DIVERGED" && applyForcedOwnSnapshot(result)) {
            console.warn("game:input failed:", result.reason)
            return
        }
        if (Number.isInteger(result?.clientSequence)) {
            applyDeferredOwnSnapshotIfReady()
        }
        if (!result?.ok) {
            console.warn("game:input failed:", result?.reason)
        }
        maybeClosePlacementLogBufferAfterGameOver()
    })
    const detachGameInputResult = () => {
        detachGameInputResultListener()
        discardPlacementLogBuffer({ close: true })
        pendingServerInputs.clear()
        deferredOwnSnapshot = null
    }
    const detachGameBagAppend = receiveGameBagAppend(({ playerId: bagPlayerId, bagChunk }) => {
        if (destroyed) return
        if (!Array.isArray(bagChunk)) return

        if (bagPlayerId === playerId) {
            myGame.appendServerBag(bagChunk)
            hasPendingBagRequest = false
            return
        }

        if (bagPlayerId === opponentPlayerId) {
            opponentGame.appendServerBag(bagChunk)
        }
    })
    const detachGameBagResult = onGameBagResult((result) => {
        if (destroyed) return
        if (result.ok) return
        hasPendingBagRequest = false
        console.warn("game:bag failed:", result.reason)
    })
    const detachSessionDisconnected = onSessionDisconnected(() => {
        if (destroyed) return
        presentationActive = false;
        pendingServerInputs.clear()
        discardPlacementLogBuffer()
        deferredOwnSnapshot = null
        pendingOwnDriftState = null
        hasPendingBagRequest = false
    })

    /**
     * 이 multiplayer session이 만든 timer, socket listener와 두 runtime을 모두 정리한다.
     *
     * React StrictMode, pagehide와 명시적 화면 이동에서 여러 번 호출될 수 있으므로
     * idempotent하게 동작한다. 종료 뒤 늦게 도착한 input/log 결과는 destroyed 상태와
     * 닫힌 buffer에 의해 무시된다.
     *
     * @returns void
     */
    function destroy(): void {
        if (destroyed) return
        destroyed = true
        clearInterval(heartbeatTimer)
        detachAuthoritativeSnapshot()
        detachGameInputResult()
        detachGameBagAppend()
        detachGameBagResult()
        detachSessionDisconnected()
        pendingServerInputs.clear()
        deferredOwnSnapshot = null
        pendingOwnDriftState = null
        discardPlacementLogBuffer({ close: true })
        settledPlacementAttemptKeys.clear()
        hasPendingBagRequest = false
        myGame.destroy()
        opponentGame.destroy()
    }

    function start(): void {
        if (destroyed || gameplayStarted) return;
        gameplayStarted = true;
        lastAuthoritativeSnapshotAt = performance.now();
        myGame.applySnapshot(myGame.getSnapshot(), { resumeGravity: true });
    }

    return {
        myGame,
        opponentGame,
        heartbeatTimer,
        detachAuthoritativeSnapshot,
        detachGameInputResult,
        detachGameBagAppend,
        detachGameBagResult,
        detachSessionDisconnected,
        destroy,
        start,
    }
}
