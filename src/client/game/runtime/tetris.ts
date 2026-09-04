import BLOCKS from "../state/blocks.ts"
import type { BlockDefinitions, PieceType } from "../state/blocks.ts"
import {
    createEmptyBoard as createEngineBoard,
    canPlacePiece,
    lockPieceOnBoard,
    clearFilledLines,
    isPieceAboveTop,
} from "../core/board.ts"
import { calculateGarbageAttack } from "../core/garbage.ts"
import { resolveAttackState } from "../core/attackState.ts"
import {
    resolveInputMoveIntent,
    resolveMoveAttempt,
    resolveMoveIntent,
} from "../core/step.ts"
import type { MoveIntent } from "../core/step.ts"
import { createSpawnedPiece, getHardDropRow } from "../core/piece.ts"
import type { PieceState, PlaceablePieceState } from "../core/piece.ts"
import type { Board } from "../core/board.ts"
import { isTSpinLock } from "../core/tSpin.ts"
import { playLineClearSfx } from "./sound.ts"
import { createRuntimeDisplayBridge } from "./displayBridge.ts"
import type { RuntimeDisplayHandle } from "./displayBridge.ts"
import { INPUT_ACTION } from "./input.ts"
import type { InputAction } from "./input.ts"
import {
    BOARD_ROWS,
    BOARD_COLS,
    SPAWN_POSITION,
    INITIAL_FALL_INTERVAL_MS,
    NEXT_PREVIEW_DIMENSION,
    INPUT_TICK_MS,
    WALL_KICKS,
} from "../state/config.ts"
import {
    getBoardContext,
    renderBoardCanvas,
    renderNextPieces as renderNextPiecesDom,
    renderHoldPiece as renderHoldPieceDom,
    buildHoldPreview as buildHoldPreviewDom,
    buildNextPreview as buildNextPreviewDom,
} from "../render/tetrisRender.ts"
import { createGameState } from "../state/stateFactory.ts"
import type { GamePhase, QueuedInput } from "../state/stateFactory.ts"
import {
    ensureQueueFilled as fillPieceQueue,
    takeNextFromQueue,
} from "../state/pieceQueue.ts"
import { createGameUi } from "../ui/ui.ts"
import {
    serializeGameState,
    deserializeGameState,
} from "../state/stateSerialization.ts"
import type { SerializedGameState } from "../state/stateSerialization.ts"
import { createHumanPlacementLogAnalysis } from "../ai/heuristic/placementLogAnalysis.ts"
import type { HumanPlacementLogAnalysis } from "../ai/heuristic/placementLogAnalysis.ts"
import type { AttackStateResult } from "../core/attackState.ts"
const NEXT_QUEUE_SIZE = 2

type RuntimeMode = "single" | "multiplayer" | "pvp" | "pve" | string;
type ActionResult = {
    applied: boolean;
    placementCommitted?: boolean;
    reason: string | null;
};
type PendingMove = { intent: MoveIntent; pendingPiece: PieceState };
type MoveOptions = { automaticGravity?: boolean };
export type InputOutcomeRecord = {
    input: QueuedInput;
    applied: boolean;
    placementCommitted: boolean;
    reason: string | null;
    activePieceBefore: PieceState | null;
    activePieceAfter: PieceState | null;
};
type AppliedInputLog = QueuedInput & {
    playerId: string | null;
    sequence: number;
    createdAt: number;
};
type PieceLog = {
    type: PieceType;
    pieceType: PieceType;
    rotation: number;
    row: number;
    col: number;
    x: number;
    y: number;
    cells: Array<{ row: number; col: number; x: number; y: number }>;
};
type PlacementResult = {
    linesCleared: number;
    isTSpin: boolean;
    combo: number;
    backToBack: boolean;
    rawAttackLines: number;
    attackLines: number;
    canceledGarbageLines: number;
    incomingGarbageLines: number;
    appliedGarbageLines: number;
    scoreBefore: number;
    scoreAfter: number;
    scoreDelta: number;
    gameOver: boolean;
};
type PlacementContext = {
    eventType: "placement_decision";
    schemaVersion: 1;
    mode: RuntimeMode;
    gameId: string | null;
    roomId: string | null;
    playerId: string | null;
    tick: number;
    pieceIndex: number;
    createdAt: number;
    scoreBefore: number;
    boardBefore: Board;
    activePiece?: PieceLog;
    nextQueue: PieceType[];
    holdPiece: PieceType | null;
    inputSequence: AppliedInputLog[];
    selectedPlacement: PieceLog;
};
export type PlacementDecisionLog = Omit<PlacementContext, "scoreBefore" | "schemaVersion"> & {
    schemaVersion: 1 | 2;
    boardAfter: Board;
    placementResult: PlacementResult;
    source?: "human";
    modelType?: null;
    metricsBefore?: HumanPlacementLogAnalysis["metricsBefore"];
    metricsAfter?: HumanPlacementLogAnalysis["metricsAfter"];
    evaluation?: HumanPlacementLogAnalysis["evaluation"];
    aiComparison?: HumanPlacementLogAnalysis["aiComparison"];
};
type TetrisSnapshot = {
    score: number;
    lines: number;
    fallIntervalMs: number;
    board: Board | null;
    pieceQueue: PieceType[];
    holdPieceType: PieceType | null;
    holdUsedThisDrop: boolean;
    activePiece: PieceState;
    phase: GamePhase;
    combo: number;
    backToBack: boolean;
    tick: number;
    pieceIndex: number;
    pendingGarbageLines: number;
};
export type TetrisSnapshotInput = Partial<SerializedGameState> & {
    tick?: number;
    pieceIndex?: number;
    pendingGarbageLines?: number;
};
type RuntimeState = {
    boardCtx: CanvasRenderingContext2D | null;
    inputTimer: ReturnType<typeof setInterval> | undefined;
    animationFrameId: number | null;
    animationVersion: number;
    detachKeyboard: (() => void) | null;
    bagMode: "local" | "server";
    serverBagQueue: PieceType[];
    gravityRunning: boolean;
    gravityAccumulatorMs: number;
    automaticGroundedPieceIndex: number | null;
    lastTickAt: number;
    currentTick: number;
    pieceIndex: number;
    inputLog: AppliedInputLog[];
    placementDecisionLog: PlacementDecisionLog[];
    decisionStartPiece: PlaceablePieceState | null;
    pendingLockScoreBefore: number | null;
    authoritativePendingGarbageLines: number;
    mode: RuntimeMode;
    gameId: string | null;
    roomId: string | null;
    playerId: string | null;
};
export type TetrisRuntimeOptions = {
    boardCanvasEl?: HTMLCanvasElement | null;
    gameOverEl?: HTMLElement | null;
    scoreEl?: HTMLElement | null;
    linesEl?: HTMLElement | null;
    pendingGarbageEl?: HTMLElement | null;
    nextPreviewEl?: HTMLElement | null;
    holdPreviewEl?: HTMLElement | null;
    rng?: () => number;
    mode?: RuntimeMode;
    gameId?: string | null;
    roomId?: string | null;
    playerId?: string | null;
    placementDecisionRecorder?: ((log: PlacementDecisionLog) => void) | null;
    inputOutcomeRecorder?: ((record: InputOutcomeRecord) => void) | null;
};
export type TetrisRuntime = Pick<RuntimeDisplayHandle, "getDisplaySnapshot" | "subscribeDisplay"> & {
    init: (options?: { autoStart?: boolean; serverBagChunks?: PieceType[][] | null }) => void;
    enqueueInput: (action: InputAction | null, scheduledTick?: number | null, inputPieceIndex?: number | null) => QueuedInput | null;
    render: () => void;
    stop: () => void;
    destroy: () => void;
    getSnapshot: () => TetrisSnapshot;
    applySnapshot: (snapshot: TetrisSnapshotInput | null, options?: {
        resumeGravity?: boolean;
        clearInputQueue?: boolean;
        cancelPresentation?: boolean;
    }) => void;
    playLineClearPresentation: (effect?: { rows?: number[]; board?: Board }) => boolean;
    getPendingInputCount: () => number;
    setAuthoritativePendingGarbageLines: (lines: number | undefined, options?: { publish?: boolean }) => number;
    appendServerBag: (chunk: PieceType[]) => void;
    getServerBagRemainingCount: () => number;
    hideGameOver: () => void;
    showGameOver: () => void;
    getPlacementDecisionLog: () => PlacementDecisionLog[];
    runtime: RuntimeState;
};

// =============================
// 싱글·멀티 공용 Tetris 런타임
// 입력 queue → pendingPiece 생성 → core 판정 → gameState 반영 → Canvas/HUD 발행 순서를 조율한다.
// 규칙 계산은 core에 맡기고, 이 파일은 timer·상태 전이·렌더·placement log 같은 부수효과의 순서를 소유한다.
// =============================

function isPieceType(value: string): value is PieceType {
    return Object.hasOwn(BLOCKS, value)
}

const PIECE_TYPES = Object.keys(BLOCKS).filter(isPieceType)
const ROWS = BOARD_ROWS
const COLS = BOARD_COLS
const SPAWN_ROW = SPAWN_POSITION.row
const SPAWN_COL = SPAWN_POSITION.col
const NEXT_PREVIEW_SIZE = NEXT_PREVIEW_DIMENSION
const MAX_QUEUED_INPUTS_PER_TICK = 4

const GAME_PHASE = {
    PLAYING: "playing",
    LINE_CLEARING: "lineClearing",
    GAME_OVER: "gameOver",
} satisfies Record<string, GamePhase>

/**
  * 독립적인 Tetris 실행 인스턴스 하나를 만든다.
  * - `gameState`는 board, 점수, 조각처럼 게임 결과를 설명하는 원천 상태다.
  * - `runtime`은 timer, tick, 서버 bag, 입력·배치 로그처럼 실행 과정에만 필요한 상태다.
  * - core 함수가 반환한 순수 판정을 실제 상태 변경, Canvas 렌더, HUD 알림 순서로 실행한다.
  * - 반환 API는 React 페이지와 멀티플레이 session이 사용하는 외부 경계다.
  *
  * 생성만으로 loop가 시작되지는 않으며 호출자는 `init`으로 새 게임을 시작하고 `destroy`로 자원을 정리한다.
  */
export function createTetrisRuntime({
    boardCanvasEl = null,
    gameOverEl = null,
    scoreEl = null,
    linesEl = null,
    pendingGarbageEl = null,
    nextPreviewEl = null,
    holdPreviewEl = null,
    rng = Math.random,
    mode = "single",
    gameId = null,
    roomId = null,
    playerId = null,
    placementDecisionRecorder = null,
    inputOutcomeRecorder = null,
}: TetrisRuntimeOptions = {}): TetrisRuntime {
    const gameState = createGameState({
        spawnRow: SPAWN_ROW,
        spawnCol: SPAWN_COL,
        fallIntervalMs: INITIAL_FALL_INTERVAL_MS,
        initialPhase: GAME_PHASE.PLAYING,
    })

    // gameState.activePiece는 마지막으로 충돌 검사를 통과한 위치다.
    // gameState.pendingPiece는 이번 입력으로 시험할 후보이며 core 판정 뒤에만 activePiece로 확정된다.
    // runtime은 gameplay 결과가 아니라 timer, 입력 로그, 서버 bag, 동기화 같은 실행 문맥을 보관한다.
    const runtime: RuntimeState = {
        boardCtx: null,
        inputTimer: undefined,
        animationFrameId: null,
        animationVersion: 0,
        detachKeyboard: null,
        bagMode: "local",
        serverBagQueue: [],
        gravityRunning: false,
        gravityAccumulatorMs: 0,
        automaticGroundedPieceIndex: null,
        lastTickAt: 0,
        currentTick: 0,
        pieceIndex: 0,
        inputLog: [],
        placementDecisionLog: [],
        decisionStartPiece: null,
        pendingLockScoreBefore: null,
        authoritativePendingGarbageLines: 0,
        mode,
        gameId,
        roomId,
        playerId,

    }

    const ui = createGameUi({
        scoreEl,
        linesEl,
        pendingGarbageEl,
        gameOverEl,
        nextPreviewEl,
        holdPreviewEl,
        nextQueueSize: NEXT_QUEUE_SIZE,
        previewSize: NEXT_PREVIEW_SIZE,
        buildNextPreview: buildNextPreviewDom,
        buildHoldPreview: buildHoldPreviewDom,
        renderNextPieces: renderNextPiecesDom,
        renderHoldPiece: renderHoldPieceDom,
    })

    const displayBridge = createRuntimeDisplayBridge(() => ({
        score: gameState.score,
        lines: gameState.lines,
        holdPieceType: gameState.holdPieceType,
        nextPieceTypes: [gameState.pieceQueue[0], gameState.pieceQueue[1]],
        pendingGarbageLines: runtime.authoritativePendingGarbageLines,
        phase: gameState.phase,
    }))

    // =============================
    // 게임 초기화
    // 공용 런타임 상태, 미리보기, 첫 스폰까지 새 세션 기준으로 다시 구성한다.
    // =============================
    /**
      * 새 게임 시작 기준으로 gameplay와 실행 상태를 초기화한다.
      * - 실행 중인 타이머를 멈추고 기본 하강 속도로 되돌린다.
      * - 점수, 홀드, 조각 queue, 입력 대기열, board를 새 세션 값으로 되돌린다.
      * - server bag이 전달되면 authoritative 조각 순서를, 아니면 local 7-bag을 사용한다.
      * - 렌더러 컨텍스트와 미리보기 DOM을 다시 준비한다.
      * - `autoStart`가 true일 때만 input loop와 첫 턴을 시작한다.
      */
    function init({ autoStart = true, serverBagChunks = null }: {
        autoStart?: boolean;
        serverBagChunks?: PieceType[][] | null;
    } = {}): void {
        resetSessionState()
        if (Array.isArray(serverBagChunks)) {
            setServerBagQueue(serverBagChunks)
        } else {
            runtime.bagMode = "local"
            runtime.serverBagQueue = []
        }
        setActivePiece({
            pieceType: "",
            rotation: 0,
            row: SPAWN_ROW,
            col: SPAWN_COL,
        })
        gameState.pendingPiece = { ...gameState.activePiece }
        preparePreviewUi()
        renderBoard()
        if (autoStart) {
            startInputLoop()
            startNextTurn()
        }
        displayBridge.publishDisplay()
    }

    /**
      * 이전 세션의 loop를 먼저 끊고 gameState와 runtime의 세션별 값을 기본값으로 되돌린다.
      * board는 여기서 처음 실제 20x10 배열이 되며 UI 표시도 같은 값으로 맞춘다.
      */
    function resetSessionState(): void {
        stopGameLoops()
        gameState.score = 0
        gameState.lines = 0
        ui.renderScore(gameState.score)
        ui.renderLines(gameState.lines)
        gameState.fallIntervalMs = INITIAL_FALL_INTERVAL_MS
        gameState.pieceQueue = []
        gameState.holdPieceType = null
        gameState.holdUsedThisDrop = false
        gameState.inputQueue = []
        gameState.phase = GAME_PHASE.PLAYING
        gameState.board = createEngineBoard(ROWS, COLS)
        runtime.currentTick = 0
        runtime.inputLog = []
        runtime.placementDecisionLog = []
        runtime.decisionStartPiece = null
        runtime.pendingLockScoreBefore = null
        runtime.automaticGroundedPieceIndex = null
        runtime.authoritativePendingGarbageLines = 0
        ui.renderPendingGarbage(0)
    }

    /**
      * Canvas context와 preview cell을 준비하고 최초 조각 queue를 화면에 반영한다.
      * gameplay를 진행하지 않고 표시 구조와 스폰 준비만 끝낸다.
      */
    function preparePreviewUi(): void {
        initBoardContext()
        ui.buildHoldPreview()
        ui.buildNextPreview()
        refillSpawnQueue()
        ui.renderNextPieces(gameState.pieceQueue, BLOCKS)
        ui.renderHoldPiece(gameState.holdPieceType, BLOCKS)
    }

    /**
      * 새 스폰 조각을 확정 위치와 이동 후보의 같은 출발점으로 설정한다.
      * placement log가 "판단을 시작한 조각"과 최종 배치를 비교할 수 있도록 시작 상태도 함께 복사한다.
      */
    function activateSpawnedPiece(piece: PlaceablePieceState): void {
        runtime.automaticGroundedPieceIndex = null
        setActivePiece(piece)
        gameState.pendingPiece = { ...piece }
        captureDecisionStartPiece(piece)
    }

    /**
      * queue에서 다음 조각을 꺼내 pieceIndex를 증가시키고 스폰 판정을 실행한다.
      * 조각 공급이 없으면 중력을 멈추며, 정상 스폰이면 hold 사용 제한을 새 턴 기준으로 해제한다.
      * 마지막 `renderBlocks("spawn")`에서 core가 스폰 충돌과 game over를 결정한다.
      */
    function startNextTurn(): void {
        gameState.phase = GAME_PHASE.PLAYING
        startGravity()

        const currentType = takeNextPieceType()
        if (!currentType) {
            stopGravity()
            console.error("No piece available for the next turn.")
            displayBridge.publishDisplay()
            return
        }
        const nextActivePiece = createSpawnedPiece(currentType, SPAWN_ROW, SPAWN_COL)

        runtime.pieceIndex++
        activateSpawnedPiece(nextActivePiece)
        gameState.holdUsedThisDrop = false
        ui.renderNextPieces(gameState.pieceQueue, BLOCKS)
        renderBlocks("spawn")
    }

    /**
      * 현재 조각을 hold slot과 교체하고 들어온 조각을 새 스폰 상태로 시작한다.
      * 한 조각이 고정되기 전에는 한 번만 사용할 수 있으며, 빈 hold라면 queue에서 다음 조각을 소비한다.
      * 중력과 preview를 함께 갱신하고 스폰 충돌 여부는 core 판정으로 넘긴다.
      */
    function holdPiece(): ActionResult {
        const { activePiece, holdPieceType, holdUsedThisDrop } = gameState
        const currentType = activePiece.pieceType
        if (!currentType || holdUsedThisDrop) {
            return { applied: false, reason: "HOLD_NOT_AVAILABLE" }
        }

        stopGravity()

        let incomingType: PieceType | undefined
        if (holdPieceType) {
            incomingType = holdPieceType
            gameState.holdPieceType = currentType
        } else {
            incomingType = takeNextPieceType()
            gameState.holdPieceType = currentType
        }

        if (!incomingType) {
            startGravity()
            console.error("No piece available while resolving hold.")
            return { applied: false, reason: "NO_PIECE_AVAILABLE" }
        }

        const swappedPiece = createSpawnedPiece(incomingType, SPAWN_ROW, SPAWN_COL)

        activateSpawnedPiece(swappedPiece)
        gameState.holdUsedThisDrop = true
        ui.renderHoldPiece(gameState.holdPieceType, BLOCKS)
        ui.renderNextPieces(gameState.pieceQueue, BLOCKS)
        startGravity()
        renderBlocks("spawn")
        return { applied: true, reason: null }
    }

    // =============================
    // 입력 큐
    // 키보드와 네트워크 입력을 바로 실행하지 않고 고정 tick 순서로 소비하기 위해 쌓아 둔다.
    // 같은 tick과 pieceIndex 조합의 개수를 제한해 한 순간에 지나친 입력이 몰리는 것도 막는다.
    // =============================
    /**
      * 정규화된 action을 실행할 tick과 조각 번호에 묶어 `gameState.inputQueue`에 넣는다.
      * 외부 tick이 없으면 다음 local tick, pieceIndex가 없으면 현재 조각을 기본값으로 사용한다.
      * playing phase가 아니거나 같은 처리 슬롯이 가득 찼으면 상태를 바꾸지 않고 null을 반환한다.
      */
    function enqueueInput(
        action: InputAction | null,
        scheduledTick: number | null = null,
        inputPieceIndex: number | null = null,
    ): QueuedInput | null {
        if (!action) return null
        if (!canProcessPlayerInput()) return null
        const nextTick = typeof scheduledTick === "number" && Number.isFinite(scheduledTick)
            ? scheduledTick
            : runtime.currentTick + 1
        const pieceIndex = typeof inputPieceIndex === "number" && Number.isFinite(inputPieceIndex)
            ? inputPieceIndex
            : runtime.pieceIndex

        if (countQueuedInputs(nextTick, pieceIndex) >= MAX_QUEUED_INPUTS_PER_TICK) {
            return null
        }

        const queuedInput: QueuedInput = {
            tick: nextTick,
            action,
            pieceIndex,
        }

        gameState.inputQueue.push(queuedInput)
        return queuedInput
    }

    // queue 길이 조회와 같은 처리 슬롯의 개수 계산은 위 입력 제한을 위한 작은 읽기 helper다.
    function countQueuedInputs(tick: number, pieceIndex: number | null): number {
        return gameState.inputQueue.filter((input) => {
            return input.tick === tick && input.pieceIndex === pieceIndex
        }).length
    }

    function getPendingInputCount(): number {
        return gameState.inputQueue.length
    }

    /**
      * 현재 tick까지 도착한 입력을 queue 앞에서부터 제한된 개수만 실행한다.
      * 조각 번호가 오래된 입력은 버리되 recorder에는 실패 이유를 남기고, 유효한 입력은
      * 적용 전 조각 → action 결과 → 적용 후 조각 순서로 기록한다.
      * action 도중 line clear나 game over로 phase가 바뀌면 즉시 소비를 멈춘다.
      */
    function drainInputQueue(currentTick: number, maxPerTick = 8): void {
        if (!canProcessPlayerInput()) return
        let count = 0
        while (gameState.inputQueue.length > 0 && count < maxPerTick) {
            const nextInput = gameState.inputQueue[0]
            if (nextInput.tick > currentTick) break

            gameState.inputQueue.shift()
            const activePieceBefore = clonePendingPiece(gameState.activePiece)
            if (!isInputForCurrentPiece(nextInput)) {
                recordInputOutcome(nextInput, {
                    applied: false,
                    reason: "PIECE_INDEX_MISMATCH",
                }, activePieceBefore)
                count++
                continue
            }

            recordAppliedInput(nextInput)
            const actionResult = handleAction(nextInput.action)
            recordInputOutcome(nextInput, actionResult, activePieceBefore)
            count++
            if (!canProcessPlayerInput()) return
        }
    }

    /**
      * 늦게 도착한 이전 조각의 입력이 새 조각을 움직이지 않도록 pieceIndex를 비교한다.
      * 번호가 없는 입력은 local/기존 호출 호환을 위해 현재 조각 입력으로 허용한다.
      */
    function isInputForCurrentPiece(input: Pick<QueuedInput, "pieceIndex">): boolean {
        if (!Number.isFinite(input.pieceIndex)) return true
        return input.pieceIndex === runtime.pieceIndex
    }

    // =============================
    // 액션 실행
    // 큐에서 꺼낸 action으로 pendingPiece만 먼저 바꾸고 core 판정 뒤 activePiece에 확정한다.
    // =============================
    /**
      * activePiece를 직접 움직이지 않고 pendingPiece에 행/열 이동 후보를 만든다.
      * pendingPiece가 없으면 마지막 확정 상태를 복사해 시작하므로 실패 시 안전하게 되돌릴 수 있다.
      */
    function shiftActivePiece(rowDelta: number, colDelta: number): void {
        if (!gameState.pendingPiece) {
            gameState.pendingPiece = { ...gameState.activePiece }
        }
        gameState.pendingPiece.row += rowDelta
        gameState.pendingPiece.col += colDelta
    }

    /**
      * pendingPiece의 회전 후보를 시계 방향으로 한 단계 바꾼다.
      * 실제 배치 가능 여부와 wall kick은 다음 core 판정에서 처리한다.
      */
    function rotatePendingPiece(direction: "cw" | "ccw"): void {
        const { pendingPiece } = gameState
        if (!pendingPiece) return
        const rotation = pendingPiece.rotation
        if (direction === "cw") {
            pendingPiece.rotation = (rotation + 1) % 4
        } else {
            pendingPiece.rotation = (rotation + 3) % 4
        }
    }

    /**
      * activePiece를 가상으로 내려 마지막 가능한 row를 찾고 즉시 lock 흐름을 실행한다.
      * 이동 거리 점수를 먼저 반영하므로 placement log는 `pendingLockScoreBefore`에 드롭 전 점수를 보관한다.
      * 반환값은 조각이 실제 lock까지 완료됐는지를 입력 결과 recorder에 알려 준다.
      */
    function hardDrop(): boolean {
        const { activePiece } = gameState
        if (!activePiece.pieceType) return false
        stopGravity()

        const { row } = activePiece
        const nextRow = getHardDropRow(activePiece, targetRow => canPlace({
            ...activePiece,
            row: targetRow,
        }))

        const dropped = nextRow - row
        runtime.pendingLockScoreBefore = gameState.score
        if (dropped > 0) {
            gameState.score += dropped * 2
            ui.renderScore(gameState.score)
        }

        gameState.pendingPiece = { ...activePiece, row: nextRow }
        const moveResult = renderBlocks("hardDrop")
        return moveResult?.intent?.kind === "lock"
    }

    /**
      * 이동·회전 action을 pendingPiece 변화로 바꾸고 core에 전달할 원인 이름을 반환한다.
      * hard drop과 hold는 여러 상태를 함께 바꾸므로 여기서 처리하지 않고 null로 남긴다.
      */
    function applyInputAction(action: string): string | null {
        const intent = resolveInputMoveIntent(action)
        if (!intent) return null

        if (intent.kind === "shift") {
            shiftActivePiece(intent.rowDelta, intent.colDelta)
            return intent.moveType
        }

        if (intent.kind === "rotate") {
            rotatePendingPiece(intent.direction)
            return intent.moveType
        }

        return null
    }

    /**
      * action 종류를 일반 이동, hard drop, hold 처리기로 분기하고 공통 결과 모양으로 정리한다.
      * `applied`는 입력이 유효했는지, `placementCommitted`는 이 입력으로 조각 lock이 끝났는지를 뜻한다.
      * 이 결과는 gameplay 상태가 아니라 네트워크 acknowledgement와 입력 로그에 사용된다.
      */
    function handleAction(action: string): ActionResult {
        const moveType = applyInputAction(action)
        if (moveType) {
            const moveResult = renderBlocks(moveType)
            const intentKind = moveResult?.intent?.kind
            const applied = intentKind === "ok"
                || (action === INPUT_ACTION.SOFT_DROP && intentKind === "lock")
            return {
                applied,
                placementCommitted: action === INPUT_ACTION.SOFT_DROP && intentKind === "lock",
                reason: applied ? null : intentKind === "retry" ? "MOVE_RETRY" : "MOVE_NOT_HANDLED",
            }
        }

        if (action === INPUT_ACTION.HARD_DROP) {
            const applied = hardDrop()
            return {
                applied,
                placementCommitted: applied,
                reason: applied ? null : "INVALID_PLAYER_STATE",
            }
        }

        if (action === INPUT_ACTION.HOLD) {
            return {
                ...holdPiece(),
                placementCommitted: false,
            }
        }

        return {
            applied: false,
            placementCommitted: false,
            reason: "UNSUPPORTED_ACTION",
        }
    }

    // =============================
    // 고정 tick 처리
    // 입력 소비와 시간 기반 자동 하강을 하나의 반복 가능한 순서로 처리한다.
    // =============================
    /**
      * 한 runtime tick에서 먼저 입력을 처리하고, 남은 playing 상태에만 중력을 진행한다.
      * 실제 timer 오차는 `deltaMs`를 누적해 보정하며, fall interval을 여러 번 넘겼다면 필요한 만큼 반복 하강한다.
      * 자동 하강이 바닥에 처음 닿은 경우 한 번의 lock grace를 주고, 다음 실패에서 실제 lock한다.
      */
    function processTick(deltaMs: number): void {
        if (!canProcessPlayerInput()) return
        runtime.currentTick++
        drainInputQueue(runtime.currentTick, 4)
        if (!canProcessPlayerInput()) return
        if (!runtime.gravityRunning) return

        runtime.gravityAccumulatorMs += deltaMs

        while (runtime.gravityAccumulatorMs >= gameState.fallIntervalMs) {
            runtime.gravityAccumulatorMs -= gameState.fallIntervalMs
            shiftActivePiece(1, 0)
            const gravityResult = renderBlocks("fall", {
                automaticGravity: true,
            })

            if (!canProcessPlayerInput()) return
            if (gravityResult?.intent?.kind === "lock") return
        }
    }

    // =============================
    // 이동 판정 연결부
    // pendingPiece 후보를 core의 순수 판정에 넣고, 반환 intent를 runtime 부수효과로 이어 준다.
    // =============================
    /**
      * pendingPiece 한 번의 시도를 `resolveMoveAttempt → resolveMoveIntent` 순서로 계산한다.
      * 이 단계에서는 gameState를 확정하거나 화면을 그리지 않고 core 결과를 새 객체로 돌려준다.
      */
    function resolvePendingMove(moveType = ""): PendingMove | null {
        const { pendingPiece } = gameState
        if (!pendingPiece) return null
        if (!pendingPiece.pieceType) return null
        if (!gameState.board) return null

        const outcome = resolveMoveAttempt({
            board: gameState.board,
            activePiece: gameState.activePiece,
            pendingPiece,
            moveCause: moveType,
            blocks: BLOCKS,
            wallKicks: WALL_KICKS,
        })

        const intent = resolveMoveIntent({
            outcome,
            hasFallTimer: runtime.gravityRunning,
        })

        return {
            intent,
            pendingPiece: { ...outcome.pending },
        }
    }

    /**
      * core intent를 실제 gameState와 화면에 반영한다.
      * - `gameOver`: 입력과 loop를 정리하고 종료 UI를 표시한다.
      * - `lock`: activePiece를 마지막 유효 위치로 맞춘 뒤 자동 중력이면 1회 grace, 아니면 즉시 고정한다.
      * - `retry`: 실패 후보를 버리고 core가 돌려준 이전 active 위치를 다시 그린다.
      * - `ok`: 후보를 activePiece로 확정하고 회전 여부, 중력, Canvas를 갱신한다.
      */
    function applyMoveIntent(moveResult: PendingMove | null, options: MoveOptions = {}): void {
        if (!moveResult) return

        gameState.pendingPiece = { ...moveResult.pendingPiece }
        const { intent } = moveResult

        if (intent.kind === "gameOver") {
            runtime.automaticGroundedPieceIndex = null
            gameState.phase = GAME_PHASE.GAME_OVER
            gameState.pendingPiece = null
            gameState.inputQueue = []
            runtime.decisionStartPiece = null
            stopGameLoops()
            setActivePiece(intent.active)
            renderBoard()
            ui.showGameOver()
            return
        }

        if (intent.kind === "lock") {
            setActivePiece(intent.active)
            if (
                options.automaticGravity === true &&
                runtime.automaticGroundedPieceIndex !== runtime.pieceIndex
            ) {
                runtime.automaticGroundedPieceIndex = runtime.pieceIndex
                renderBoard()
                return
            }
            runtime.automaticGroundedPieceIndex = null
            seizeBlock()
            return
        }

        if (intent.kind === "retry") {
            setActivePiece(intent.active)
            renderBoard()
            return
        }

        if (intent.kind === "ok") {
            if (options.automaticGravity === true) {
                runtime.automaticGroundedPieceIndex = null
            }
            gameState.phase = GAME_PHASE.PLAYING
            if (intent.shouldStartGravity) startGravity()
            setActivePiece(intent.active)
            if (intent.moveCause) {
                gameState.lastActionWasRotation = intent.moveCause === "rotate"
            }
            renderBoard()
        }
    }

    /**
      * 이름은 `renderBlocks`지만 이동 판정과 상태 반영까지 묶는 기존 orchestration 진입점이다.
      * `resolvePendingMove → applyMoveIntent → publishDisplay` 순서로 실행하고 입력 recorder가 볼 결과를 반환한다.
      * 실제 규칙 판정은 core, Canvas drawing은 `renderBoard`에 남아 있다.
      */
    function renderBlocks(moveType = "", options: MoveOptions = {}): PendingMove | null {
        const moveResult = resolvePendingMove(moveType)
        applyMoveIntent(moveResult, options)
        displayBridge.publishDisplay()
        return moveResult
    }

    // =============================
    // 고정 및 후처리
    // 조각 고정 이후 T-Spin/top-out, line clear, placement log, 다음 턴으로 이어진다.
    // =============================
    /**
      * 마지막 유효 activePiece를 고정하는 전체 순서를 시작한다.
      * 1. board가 바뀌기 전에 배치 전 로그, top-out, T-Spin을 판정한다.
      * 2. 조각 cell을 board에 기록하고 움직이는 activePiece를 비운다.
      * 3. top-out이면 종료하고, 아니면 line clear와 다음 턴 처리로 넘긴다.
      *
      * 이 순서를 바꾸면 boardBefore 로그나 T-Spin 코너 판정이 이미 고정된 조각을 포함하게 된다.
      */
    function seizeBlock(): void {
        runtime.automaticGroundedPieceIndex = null
        const { activePiece, board } = gameState
        const { pieceType, rotation, row, col } = activePiece
        if (!pieceType || !board) return

        const lockedPiece: PlaceablePieceState = { ...activePiece }
        const placementContext = createPlacementDecisionContext(lockedPiece)
        runtime.decisionStartPiece = null
        const touchesAboveTop = isPieceAboveTop(activePiece, BLOCKS)
        gameState.isTSpin = isTSpinLock({
            board,
            piece: activePiece,
            lastActionWasRotation: gameState.lastActionWasRotation,
        })

        commitLockedPiece({ board, piece: activePiece, rotation, row, col })
        handlePostLockFlow(touchesAboveTop, placementContext)
    }

    /**
      * activePiece cell을 고정 board에 기록하고 움직이는 조각의 type만 비운다.
      * activePiece 객체 자체는 교체하지 않아 같은 참조를 보는 runtime 코드가 끊기지 않게 한다.
      */
    function commitLockedPiece({ board, piece, rotation, row, col }: {
        board: Board;
        piece: PlaceablePieceState;
        rotation: number;
        row: number;
        col: number;
    }): void {
        lockPieceOnBoard(board, piece, BLOCKS)
        setActivePiece({
            pieceType: "",
            rotation,
            row,
            col,
        })
        renderBoard()
    }

    /**
      * 고정 후 top-out 여부에 따라 게임오버 또는 라인 클리어 흐름으로 분기한다.
      * top-out에서도 placement 결과를 gameOver로 확정해 마지막 판단이 분석 로그에서 사라지지 않게 한다.
      */
    function handlePostLockFlow(
        touchesAboveTop: boolean,
        placementContext: PlacementContext | null,
    ): void {
        if (touchesAboveTop) {
            gameState.phase = GAME_PHASE.GAME_OVER
            gameState.inputQueue = []
            stopGameLoops()
            ui.showGameOver()
            finalizePlacementDecision(placementContext, {
                linesCleared: 0,
                isTSpin: gameState.isTSpin,
                gameOver: true,
            })
            return
        }
        checkMatch(placementContext)
    }

    // =============================
    // 고정 후 후처리
    // 완성 줄 애니메이션, 실제 삭제, 점수·로그 갱신, 다음 스폰을 정해진 순서로 실행한다.
    // =============================
    /**
      * 고정 board에서 완성된 줄을 찾고 line clear 유무에 맞는 후처리를 실행한다.
      * - 가득 찬 줄이 없으면 바로 다음 조각을 스폰한다.
      * - 줄이 있으면 phase를 `lineClearing`으로 바꿔 입력을 막고, 애니메이션 완료 뒤 실제 board를 삭제한다.
      * - 점수와 누적 line을 반영한 뒤 placement log의 boardAfter를 만들고 다음 조각을 스폰한다.
      * - T-Spin 상태는 이번 lock의 점수·공격 계산이 끝난 뒤 반드시 초기화한다.
      */
    function checkMatch(placementContext: PlacementContext | null): void {
        const board = gameState.board
        if (!board) return
        const { fullRows } = findFullRows(board)
        if (fullRows.length === 0) {
            const isTSpin = gameState.isTSpin
            if (gameState.isTSpin) {
                gameState.score += 15
                ui.renderScore(gameState.score)
            }
            gameState.isTSpin = false
            renderBoard()
            const finalizeResult = finalizePlacementDecision(placementContext, {
                linesCleared: 0,
                isTSpin,
                gameOver: false,
            })
            if (finalizeResult?.gameOver) return
            startNextTurn()
            return
        }

        gameState.phase = GAME_PHASE.LINE_CLEARING
        gameState.inputQueue = []
        stopGravity()
        playLineClearSfx()

        addLineClearEffect(fullRows, () => {
            const clearedLines = clearFilledLines(board)
            if (clearedLines > 0) {
                let points = clearedLines * 10
                if (gameState.isTSpin) points *= 5
                gameState.score += points
                gameState.lines += clearedLines
                ui.renderScore(gameState.score)
                ui.renderLines(gameState.lines)
            } else if (gameState.isTSpin) {
                gameState.score += 15
                ui.renderScore(gameState.score)
            }

            const isTSpin = gameState.isTSpin
            const finalizeResult = finalizePlacementDecision(placementContext, {
                linesCleared: clearedLines,
                isTSpin,
                gameOver: false,
            })
            gameState.isTSpin = false
            renderBoard()
            if (finalizeResult?.gameOver) return
            startNextTurn()
        })
    }

    // =============================
    // 배치 가능 여부 조회
    // 하드 드롭이나 고스트 계산에서 가상의 위치를 검사할 때 사용한다.
    // =============================
    /**
      * runtime의 현재 board와 고정 BLOCKS를 core `canPlacePiece`에 연결하는 읽기 전용 helper다.
      */
    function canPlace({ pieceType, rotation, row, col }: PlaceablePieceState): boolean {
        if (!gameState.board) return false
        return canPlacePiece(gameState.board, { pieceType, rotation, row, col }, BLOCKS);
    }

    // 중력 시작/중지는 timer를 새로 만들지 않고 processTick이 볼 flag와 누적 시간만 갱신한다.
    function startGravity(): void {
        runtime.gravityRunning = true
        runtime.gravityAccumulatorMs = 0
    }

    function stopGravity(): void {
        runtime.gravityRunning = false
        runtime.gravityAccumulatorMs = 0
    }

    /**
      * 고정 간격 timer에서 실제 경과 시간을 측정해 `processTick`을 반복 호출한다.
      * 키보드 listener 자체는 페이지가 연결하며, 이 loop는 keyboard와 network가 함께 쓰는 input queue를 소비한다.
      */
    function startInputLoop(): void {
        clearInterval(runtime.inputTimer)
        runtime.lastTickAt = performance.now()
        runtime.inputTimer = setInterval(() => {
            if (runtime.inputTimer === undefined) return
            const now = performance.now()
            const deltaMs = now - runtime.lastTickAt
            runtime.lastTickAt = now
            processTick(deltaMs)
        }, INPUT_TICK_MS)
    }

    /**
      * input timer, 중력, line clear animation을 중지하고 tick·pieceIndex 실행 카운터를 초기화한다.
      * 새 `init`, game over, destroy가 이전 세션의 비동기 callback을 남기지 않도록 공유한다.
      */
    function stopGameLoops(): void {
        clearInterval(runtime.inputTimer)
        cancelLineClearEffect()
        runtime.currentTick = 0
        runtime.inputTimer = undefined
        runtime.gravityRunning = false
        runtime.gravityAccumulatorMs = 0
        runtime.automaticGroundedPieceIndex = null
        runtime.lastTickAt = 0
        runtime.pieceIndex = 0
    }

    /**
      * 페이지 이탈이나 React unmount에서 runtime이 소유한 구독, loop, keyboard, DOM 참조를 해제한다.
      * 여러 cleanup 경로에서 중복 호출돼도 안전하며 destroy 이후 display 알림은 발행되지 않는다.
      */
    function destroy(): void {
        displayBridge.destroyDisplay()
        stopGameLoops()
        runtime.detachKeyboard?.()
        runtime.detachKeyboard = null
        ui.hideGameOver()
        gameState.inputQueue = []
        runtime.decisionStartPiece = null
        runtime.boardCtx = null
    }

    // 입력 가능 여부는 `phase === playing` 한곳에서 파생해 queue 소비와 enqueue가 같은 기준을 사용한다.
    function canProcessPlayerInput(): boolean {
        return gameState.phase === GAME_PHASE.PLAYING
    }

    // =============================
    // 렌더링 보조
    // gameState를 렌더 전용 값으로 바꿔 Canvas renderer에 전달하고 animation 수명을 관리한다.
    // =============================
    // Canvas context 조회는 init 시 한 번 수행하고 이후 frame에서 같은 참조를 재사용한다.
    function initBoardContext(): void {
        runtime.boardCtx = getBoardContext(boardCanvasEl);
    }

    /**
      * 현재 고정 board와 렌더용 active/ghost piece를 renderer에 전달해 한 frame을 그린다.
      * 게임 판정이나 gameState 변경은 하지 않는다.
      */
    function renderBoard(): void {
        if (!gameState.board) return
        renderBoardCanvas({
            ctx: runtime.boardCtx,
            board: gameState.board,
            activePiece: getRenderableActivePiece(),
            rows: ROWS,
            cols: COLS,
            blocks: BLOCKS,
            flashRows: [],
            isFlash: false,
        });
    }

    /**
      * activePiece를 복사하고 가상 하강으로 계산한 `ghostRow`만 덧붙인다.
      * 반환 객체는 renderer 전용 파생값이며 원천 gameState는 변경하지 않는다.
      */
    function getRenderableActivePiece(): (PieceState & { ghostRow?: number }) | null {
        const { activePiece } = gameState
        if (!activePiece || !activePiece.pieceType) return activePiece

        let ghostRow = activePiece.row
        while (canPlace({
            pieceType: activePiece.pieceType,
            rotation: activePiece.rotation,
            col: activePiece.col,
            row: ghostRow + 1,
        })) {
            ghostRow++
        }

        return { ...activePiece, ghostRow }
    }

    /**
      * 실제 줄 삭제 전에 requestAnimationFrame으로 line clear 진행률을 0~1까지 그린다.
      * Canvas가 없으면 animation을 생략하고 완료 callback을 즉시 실행해 gameplay가 멈추지 않게 한다.
      * animationVersion이 바뀐 오래된 callback은 상태를 건드리지 않고 종료한다.
      */
    function addLineClearEffect(
        rows: number[],
        onComplete: (() => void) | null,
        board: Board | null = gameState.board,
    ): void {
        if (!board) {
            onComplete?.()
            return
        }
        if (!runtime.boardCtx) {
            onComplete?.()
            return
        }

        cancelLineClearEffect()
        const animationVersion = runtime.animationVersion

        const DURATION = 350
        const startTime = performance.now()

        const presentationBoard = board
        function animate(currentTime: number): void {
            if (animationVersion !== runtime.animationVersion) return

            let elapsed = currentTime - startTime
            let progress = Math.min(elapsed / DURATION, 1)

            const animatedRows = rows.map(r => ({ row: r, progress: progress }))

            renderBoardCanvas({
                ctx: runtime.boardCtx,
                board: presentationBoard,
                activePiece: null,
                rows: ROWS,
                cols: COLS,
                blocks: BLOCKS,
                flashRows: animatedRows,
            })

            if (progress < 1) {
                runtime.animationFrameId = requestAnimationFrame(animate)
            } else {
                runtime.animationFrameId = null
                if (onComplete && animationVersion === runtime.animationVersion) onComplete()
            }
        }

        runtime.animationFrameId = requestAnimationFrame(animate)
    }

    // version 증가와 frame 취소를 함께 수행해 이미 queue된 오래된 callback까지 무효화한다.
    function cancelLineClearEffect(): void {
        runtime.animationVersion += 1
        if (runtime.animationFrameId !== null) cancelAnimationFrame(runtime.animationFrameId)
        runtime.animationFrameId = null
    }

    /**
      * authoritative gameplay state와 분리된 line clear 표시만 재생한다.
      * - 전달받은 clear 전 보드 복사본만 애니메이션에 사용한다.
      * - 완료 후 현재 runtime의 최신 authoritative 보드를 다시 렌더링한다.
      * - rows와 20x10 board 계약을 검사하지만 점수, phase, 중력은 변경하지 않는다.
      */
    function playLineClearPresentation({ rows, board }: {
        rows?: number[];
        board?: Board;
    } = {}): boolean {
        if (!Array.isArray(rows)) return false
        if (!Array.isArray(board) || board.length !== ROWS) return false
        if (!board.every(row => Array.isArray(row) && row.length === COLS)) return false

        const normalizedRows = [...new Set(rows)].filter(row => {
            return Number.isInteger(row) && row >= 0 && row < ROWS
        })
        if (normalizedRows.length === 0) return false

        const presentationBoard = board.map(row => [...row])
        addLineClearEffect(normalizedRows, renderBoard, presentationBoard)
        return true
    }

    // =============================
    // 상태 보조 함수
    // gameplay 실행 과정에서 필요한 입력 증거, placement log, snapshot, 조각 공급 상태를 관리한다.
    // =============================
    /**
      * 현재 pieceIndex 검사를 통과해 실행을 시도한 입력을 placement log용 순서로 기록한다.
      * 충돌로 실패한 입력도 판단 과정의 일부이므로 포함되며, 실제 성공 여부는 `recordInputOutcome`이 별도로 남긴다.
      */
    function recordAppliedInput(input: QueuedInput): void {
        runtime.inputLog.push({
            playerId: runtime.playerId,
            action: input.action,
            tick: input.tick,
            pieceIndex: input.pieceIndex,
            sequence: runtime.inputLog.length + 1,
            createdAt: Date.now(),
        })
    }

    /**
      * 입력 판정 전후 조각과 성공·lock 여부를 외부 recorder에 전달한다.
      * gameplay나 snapshot의 원천 상태에는 저장하지 않으며, 멀티 session이 acknowledgement와 로그에 활용한다.
      */
    function recordInputOutcome(
        input: QueuedInput,
        result: ActionResult,
        activePieceBefore: PieceState | null,
    ): void {
        if (typeof inputOutcomeRecorder !== "function") return

        inputOutcomeRecorder({
            input: {
                action: input.action,
                tick: input.tick,
                pieceIndex: input.pieceIndex,
            },
            applied: result?.applied === true,
            placementCommitted: result?.placementCommitted === true,
            reason: result?.reason ?? null,
            activePieceBefore: clonePendingPiece(activePieceBefore),
            activePieceAfter: clonePendingPiece(gameState.activePiece),
        })
    }

    /**
      * 조각을 board에 쓰기 직전, 한 placement 판단의 입력과 선택 결과를 복사한다.
      * - `boardBefore`는 아직 선택 조각이 고정되지 않은 board다.
      * - `activePiece`는 spawn/snapshot에서 판단을 시작한 위치, `selectedPlacement`는 최종 lock 위치다.
      * - 같은 player와 pieceIndex의 입력 순서, next queue, hold도 당시 값으로 고정한다.
      *
      * line clear 후에만 알 수 있는 boardAfter와 결과 지표는 `finalizePlacementDecision`이 채운다.
      */
    function createPlacementDecisionContext(
        lockedPiece: PlaceablePieceState,
    ): PlacementContext | null {
        const boardBefore = serializeGameState(gameState).board
        if (!boardBefore) return null
        const pendingScoreBefore = runtime.pendingLockScoreBefore
        const scoreBefore = typeof pendingScoreBefore === "number" && Number.isFinite(pendingScoreBefore)
            ? pendingScoreBefore
            : gameState.score
        const decisionStartPiece = runtime.decisionStartPiece

        return {
            eventType: "placement_decision",
            schemaVersion: 1,
            mode: runtime.mode,
            gameId: runtime.gameId,
            roomId: runtime.roomId,
            playerId: runtime.playerId,
            tick: runtime.currentTick,
            pieceIndex: runtime.pieceIndex,
            createdAt: Date.now(),
            scoreBefore,
            boardBefore,
            ...(decisionStartPiece
                ? { activePiece: createPieceLog(decisionStartPiece) }
                : {}),
            nextQueue: [...gameState.pieceQueue],
            holdPiece: gameState.holdPieceType,
            inputSequence: getInputSequenceForPiece(runtime.pieceIndex),
            selectedPlacement: createPieceLog(lockedPiece),
        }
    }

    /**
      * lock과 line clear가 끝난 상태를 더해 placement_decision 한 행을 완성한다.
      * - boardBefore/선택 배치와 boardAfter/점수·공격 결과를 한 decision으로 묶는다.
      * - 유효한 게임 lineage와 분석 결과가 모두 있으면 ML feature-ready schema v2, 아니면 원시 v1로 남긴다.
      * - 클라이언트 공격량은 기록용이며 garbage 상쇄·적용의 최종 결정은 authoritative 서버가 한다.
      * - 완성 로그는 메모리에 보관하고 선택적인 recorder로 전달한다.
      */
    function finalizePlacementDecision(
        placementContext: PlacementContext | null,
        result: { linesCleared: number; isTSpin: boolean; gameOver: boolean },
    ): { gameOver: boolean } {
        if (!placementContext) return { gameOver: false }

        const { scoreBefore, ...logBase } = placementContext
        const scoreAfter = gameState.score
        const attackState = updateAttackState({
            linesCleared: result.linesCleared,
            isTSpin: result.isTSpin,
        })
        const rawAttackLines = calculateGarbageAttack(attackState)
        const boardAfter = serializeGameState(gameState).board
        if (!boardAfter) return { gameOver: false }
        const log: PlacementDecisionLog = {
            ...logBase,
            boardAfter,
            placementResult: {
                linesCleared: result.linesCleared,
                isTSpin: attackState.isTSpin,
                combo: attackState.combo,
                backToBack: attackState.backToBack,
                rawAttackLines,
                attackLines: rawAttackLines,
                canceledGarbageLines: 0,
                incomingGarbageLines: 0,
                appliedGarbageLines: 0,
                scoreBefore,
                scoreAfter,
                scoreDelta: scoreAfter - scoreBefore,
                gameOver: result.gameOver,
            },
        }

        const analysis = createHumanPlacementLogAnalysis({
            boardBefore: log.boardBefore,
            boardAfter: log.boardAfter,
            activePieceAtDecisionStart: log.activePiece,
            selectedPlacement: log.selectedPlacement,
        })
        if (
            analysis &&
            typeof log.gameId === "string" && log.gameId.length > 0 &&
            typeof log.roomId === "string" && log.roomId.length > 0 &&
            typeof log.playerId === "string" && log.playerId.length > 0
        ) {
            log.schemaVersion = 2
            log.source = "human"
            log.modelType = null
            log.metricsBefore = analysis.metricsBefore
            log.metricsAfter = analysis.metricsAfter
            log.evaluation = analysis.evaluation
            log.aiComparison = analysis.aiComparison
        }

        runtime.placementDecisionLog.push(log)
        if (typeof placementDecisionRecorder === "function") {
            placementDecisionRecorder(log)
        }
        runtime.pendingLockScoreBefore = null

        return {
            gameOver: log.placementResult.gameOver,
        }
    }

    // pending garbage는 authoritative 값을 원천으로 삼고 UI/HUD에는 검증된 0 이상의 정수만 노출한다.
    function normalizePendingGarbageLines(lines: number | undefined): number {
        return typeof lines === "number" && Number.isInteger(lines) && lines > 0 ? lines : 0
    }

    function setAuthoritativePendingGarbageLines(
        lines: number | undefined,
        { publish = true }: { publish?: boolean } = {},
    ): number {
        runtime.authoritativePendingGarbageLines = normalizePendingGarbageLines(lines)
        ui.renderPendingGarbage(runtime.authoritativePendingGarbageLines)
        if (publish) displayBridge.publishDisplay()
        return runtime.authoritativePendingGarbageLines
    }

    /**
      * 이전 combo/back-to-back과 이번 line clear 결과를 core 규칙으로 계산한다.
      * 반환값은 이번 공격량에 사용하고 `nextCombo`/`nextBackToBack`만 다음 턴의 gameState에 저장한다.
      */
    function updateAttackState({ linesCleared, isTSpin }: {
        linesCleared: number;
        isTSpin: boolean;
    }): Pick<AttackStateResult, "linesCleared" | "isTSpin" | "combo" | "backToBack"> {
        const attackState = resolveAttackState({
            combo: gameState.combo,
            backToBack: gameState.backToBack,
            linesCleared,
            isTSpin,
        })

        gameState.combo = attackState.nextCombo
        gameState.backToBack = attackState.nextBackToBack

        return {
            linesCleared: attackState.linesCleared,
            isTSpin: attackState.isTSpin,
            combo: attackState.combo,
            backToBack: attackState.backToBack,
        }
    }

    /**
      * 현재 player와 pieceIndex에 속한 입력 시도만 복사해 한 placement decision에 묶는다.
      * 다른 조각이나 다른 player의 입력이 학습 예시에 섞이지 않게 하는 lineage 경계다.
      */
    function getInputSequenceForPiece(pieceIndex: number): AppliedInputLog[] {
        return runtime.inputLog
            .filter(input => {
                return input.playerId === runtime.playerId && input.pieceIndex === pieceIndex
            })
            .map(input => ({ ...input }))
    }

    /**
      * 조각 기준 좌표와 BLOCKS offset을 절대 board cell 좌표로 펼쳐 로그 형태로 만든다.
      * `row/col`과 호환용 `x/y`를 함께 기록하지만 gameplay piece를 변경하지 않는다.
      */
    function createPieceLog(piece: PlaceablePieceState): PieceLog {
        const cells = BLOCKS[piece.pieceType][piece.rotation].map(([offsetX, offsetY]) => {
            return {
                row: piece.row + offsetY,
                col: piece.col + offsetX,
                x: piece.col + offsetX,
                y: piece.row + offsetY,
            }
        })

        return {
            type: piece.pieceType,
            pieceType: piece.pieceType,
            rotation: piece.rotation,
            row: piece.row,
            col: piece.col,
            x: piece.col,
            y: piece.row,
            cells,
        }
    }

    /**
      * board를 변경하지 않고 모든 cell이 채워진 row 번호를 찾는다.
      * animation이 이 row를 먼저 표시하고 완료 callback에서 core가 실제 줄을 삭제한다.
      */
    function findFullRows(board: Board): { fullRows: number[]; cols: number } {
        const cols = board[0]?.length ?? 0
        const fullRows: number[] = []
        for (let row = 0; row < board.length; row++) {
            const isFull = board[row].every(cell => cell !== null)
            if (isFull) fullRows.push(row)
        }
        return { fullRows, cols }
    }

    /**
      * 기존 객체 참조를 유지한 채 activePiece 내부 필드를 덮어쓴다.
      * - null 또는 undefined 입력은 무시한다.
      * - 필드를 하나씩 갱신해서 같은 객체를 바라보는 참조가 깨지지 않게 한다.
      */
    function setActivePiece(piece: PieceState | null): void {
        if (!piece) return
        gameState.activePiece.pieceType = piece.pieceType
        gameState.activePiece.rotation = piece.rotation
        gameState.activePiece.row = piece.row
        gameState.activePiece.col = piece.col
    }

    /**
      * 현재 bag mode에 맞춰 스폰 한 개와 preview 두 개가 준비되도록 queue를 채운다.
      * - server 모드에서는 서버가 내려준 조각만 소비한다.
      * - local 모드에서는 gameState의 7-bag RNG 경로를 사용한다.
      * 서버 공급이 부족하면 임의 조각을 만들지 않고 현재 확보한 수에서 멈춘다.
      */
    function refillSpawnQueue(): void {
        if (runtime.bagMode === "server") {
            while (gameState.pieceQueue.length < NEXT_QUEUE_SIZE + 1 && runtime.serverBagQueue.length > 0) {
                const nextPiece = runtime.serverBagQueue.shift()
                if (!nextPiece) break
                gameState.pieceQueue.push(nextPiece)
            }
            return
        }

        fillPieceQueue(gameState, NEXT_QUEUE_SIZE, PIECE_TYPES, rng)
    }

    /**
      * queue 맨 앞을 현재 스폰 조각으로 꺼내고 preview가 유지되도록 다시 채운다.
      * server mode에서는 공급 고갈을 undefined로 드러내 authoritative 순서를 local RNG로 숨기지 않는다.
      */
    function takeNextPieceType(): PieceType | undefined {
        if (runtime.bagMode === "server") {
            refillSpawnQueue()
            const nextType = gameState.pieceQueue.shift()
            refillSpawnQueue()
            return nextType
        }

        return takeNextFromQueue(gameState, NEXT_QUEUE_SIZE, PIECE_TYPES, rng)
    }

    /**
      * 현재 gameState 복사본에 runtime 소유의 tick, pieceIndex, pending garbage를 더해 snapshot을 만든다.
      * 반환 board와 queue는 원천 상태와 참조를 공유하지 않아 네트워크 전송이나 디버깅 코드가 안전하게 읽을 수 있다.
      */
    function getSnapshot(): TetrisSnapshot {
        const serializedState = serializeGameState(gameState)
        return {
            board: serializedState.board,
            activePiece: serializedState.activePiece ?? { ...gameState.activePiece },
            pieceQueue: [...gameState.pieceQueue],
            holdPieceType: gameState.holdPieceType,
            holdUsedThisDrop: gameState.holdUsedThisDrop,
            score: gameState.score,
            lines: gameState.lines,
            phase: gameState.phase,
            fallIntervalMs: gameState.fallIntervalMs,
            combo: gameState.combo,
            backToBack: gameState.backToBack,
            tick: runtime.currentTick,
            pieceIndex: runtime.pieceIndex,
            pendingGarbageLines: runtime.authoritativePendingGarbageLines,
        }
    }

    /**
      * 외부 snapshot을 새 gameState로 복제한 뒤 현재 runtime과 UI에 한 번에 적용한다.
      * - board, queue, hold, 점수, activePiece와 공격 연속 상태를 authoritative 값으로 맞춘다.
      * - local tick은 되감지 않고 더 큰 값만 채택해 이전 입력이 새 조각에 다시 적용되지 않게 한다.
      * - 중력 누적값과 grounded grace를 초기화하고, 요청된 경우 stale input과 animation도 버린다.
      * - 모든 상태 적용이 끝난 뒤 Canvas와 HUD를 한 번 발행하고 playing phase에서만 loop를 재개한다.
      */
    function applySnapshot(snapshot: TetrisSnapshotInput | null, {
        resumeGravity = false,
        clearInputQueue = false,
        cancelPresentation = false,
    }: {
        resumeGravity?: boolean;
        clearInputQueue?: boolean;
        cancelPresentation?: boolean;
    } = {}): void {
        if (!snapshot) return
        if (cancelPresentation) cancelLineClearEffect()

        const restored = deserializeGameState(snapshot, {
            spawnRow: SPAWN_ROW,
            spawnCol: SPAWN_COL,
            fallIntervalMs: INITIAL_FALL_INTERVAL_MS,
            initialPhase: GAME_PHASE.PLAYING,

        })

        gameState.score = restored.score
        gameState.lines = restored.lines
        gameState.fallIntervalMs = restored.fallIntervalMs
        gameState.board = restored.board
        gameState.pieceQueue = restored.pieceQueue
        if (runtime.bagMode === "server") {
            runtime.serverBagQueue = []
        }
        gameState.holdPieceType = restored.holdPieceType
        gameState.holdUsedThisDrop = restored.holdUsedThisDrop
        gameState.pendingPiece = restored.pendingPiece ?? clonePendingPiece(restored.activePiece)
        gameState.phase = restored.phase
        gameState.lastActionWasRotation = restored.lastActionWasRotation
        gameState.isTSpin = restored.isTSpin
        gameState.combo = restored.combo
        gameState.backToBack = restored.backToBack
        if (clearInputQueue) gameState.inputQueue = []

        setActivePiece(restored.activePiece)
        if (gameState.phase === GAME_PHASE.GAME_OVER) {
            runtime.decisionStartPiece = null
        } else {
            captureDecisionStartPiece(restored.activePiece)
        }

        const snapshotTick = typeof snapshot.tick === "number"
            && Number.isInteger(snapshot.tick) && snapshot.tick >= 0
            ? snapshot.tick
            : runtime.currentTick
        runtime.currentTick = Math.max(runtime.currentTick, snapshotTick)
        runtime.gravityRunning = false
        runtime.gravityAccumulatorMs = 0
        runtime.automaticGroundedPieceIndex = null
        runtime.pieceIndex = typeof snapshot.pieceIndex === "number"
            ? snapshot.pieceIndex
            : runtime.pieceIndex
        runtime.pendingLockScoreBefore = null

        ui.renderScore(gameState.score)
        ui.renderLines(gameState.lines)
        setAuthoritativePendingGarbageLines(snapshot.pendingGarbageLines, { publish: false })
        ui.renderNextPieces(gameState.pieceQueue, BLOCKS)
        ui.renderHoldPiece(gameState.holdPieceType, BLOCKS)
        if (gameState.phase === GAME_PHASE.GAME_OVER) {
            ui.showGameOver()
        } else {
            ui.hideGameOver()
        }
        renderBoard()

        if (resumeGravity && gameState.phase === GAME_PHASE.PLAYING) {
            if (runtime.inputTimer === undefined) startInputLoop()
            startGravity()
        }
        displayBridge.publishDisplay()
    }

    /**
      * 서버의 여러 bag chunk를 한 소비 queue로 펼치고 조각 공급 원천을 server mode로 전환한다.
      */
    function setServerBagQueue(chunks: PieceType[][]): void {
        runtime.bagMode = "server"
        runtime.serverBagQueue = Array.isArray(chunks)
            ? chunks.flatMap(chunk => Array.isArray(chunk) ? [...chunk] : [])
            : []
    }

    /**
      * 추가 authoritative bag chunk를 기존 대기열 뒤에 붙이고 preview와 HUD를 갱신한다.
      */
    function appendServerBag(chunk: PieceType[]): void {
        if (!Array.isArray(chunk) || chunk.length === 0) return
        runtime.bagMode = "server"
        runtime.serverBagQueue.push(...chunk)
        refillSpawnQueue()
        ui.renderNextPieces(gameState.pieceQueue, BLOCKS)
        displayBridge.publishDisplay()
    }

    // server mode의 숨은 queue와 화면 queue를 합친 잔량이며 local mode는 공급 제한이 없어 Infinity다.
    function getServerBagRemainingCount(): number {
        if (runtime.bagMode !== "server") return Infinity
        return runtime.serverBagQueue.length + gameState.pieceQueue.length
    }

    // piece 복사는 snapshot, 입력 전후 기록, pending 후보가 원본 객체를 공유하지 않게 하는 공통 helper다.
    function clonePendingPiece(piece: PieceState | null): PieceState | null {
        if (!piece) return null
        return {
            pieceType: piece.pieceType,
            rotation: piece.rotation,
            row: piece.row,
            col: piece.col,
        }
    }

    /**
      * spawn 또는 snapshot 직후 조각을 placement 분석의 판단 시작 상태로 복사한다.
      * gameplay와 별도 메타데이터이며 type, 회전, 좌표 계약이 유효하지 않으면 이전 값을 재사용하지 않고 비운다.
      */
    function captureDecisionStartPiece(piece: PieceState | null): void {
        if (!piece?.pieceType) {
            runtime.decisionStartPiece = null
            return
        }
        const rotations = BLOCKS[piece.pieceType]
        const isValid = Number.isInteger(piece.rotation) &&
            piece.rotation >= 0 &&
            piece.rotation < rotations.length &&
            Number.isInteger(piece.row) &&
            Number.isInteger(piece.col)

        runtime.decisionStartPiece = isValid ? { ...piece } : null
    }
    // 외부에는 페이지/session이 필요한 수명주기, 입력, snapshot, 표시 API만 노출한다.
    return {
        init,
        enqueueInput,
        render: renderBoard,
        stop: stopGameLoops,
        destroy,
        getSnapshot,
        getDisplaySnapshot: displayBridge.getDisplaySnapshot,
        subscribeDisplay: displayBridge.subscribeDisplay,
        applySnapshot,
        playLineClearPresentation,
        getPendingInputCount,
        setAuthoritativePendingGarbageLines,
        appendServerBag,
        getServerBagRemainingCount,
        hideGameOver: ui.hideGameOver,
        showGameOver: ui.showGameOver,
        getPlacementDecisionLog() {
            return runtime.placementDecisionLog.map(log => ({ ...log }))
        },
        runtime,
    }
}
