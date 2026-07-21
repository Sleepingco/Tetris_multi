import BLOCKS from "../state/blocks.ts"
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
import { createSpawnedPiece, getHardDropRow } from "../core/piece.ts"
import { isTSpinLock } from "../core/tSpin.ts"
import { playLineClearSfx } from "./sound.js"
import { createRuntimeDisplayBridge } from "./displayBridge.js"
import { INPUT_ACTION } from "./input.js"
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
} from "../render/tetrisRender.js"
import { createGameState } from "../state/stateFactory.ts"
import {
    ensureQueueFilled as fillPieceQueue,
    takeNextFromQueue,
} from "../state/pieceQueue.ts"
import { createGameUi } from "../ui/ui.js"
import {
    serializeGameState,
    deserializeGameState,
} from "../state/stateSerialization.ts"
import { createHumanPlacementLogAnalysis } from "../ai/heuristic/placementLogAnalysis.ts"
const NEXT_QUEUE_SIZE = 2

// =============================
// 싱글 플레이 런타임
// 보드 상태, 입력, 중력, 고정 판정, UI 렌더링을 조율한다.
// =============================

const PIECE_TYPES = Object.keys(BLOCKS)
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
}

/**
  * 테트리스 게임 런타임을 생성한다.
  * - 싱글/멀티 화면에서 같은 보드 실행 흐름을 재사용한다.
  * - 게임 규칙 상태는 gameState에, 루프/입력/동기화/로그 상태는 runtime에 둔다.
  * - 반환된 API는 페이지 진입점과 네트워크 동기화 코드가 호출하는 외부 경계다.
  *
  * @param {Object} options - 런타임 생성 옵션
  * @returns {Object} init, enqueueInput, snapshot, garbage 처리 API를 가진 런타임 컨트롤러
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
}) {
    const gameState = createGameState({
        spawnRow: SPAWN_ROW,
        spawnCol: SPAWN_COL,
        fallIntervalMs: INITIAL_FALL_INTERVAL_MS,
        initialPhase: GAME_PHASE.PLAYING,
    })

    // gameState는 보드/점수/현재 조각 같은 게임 규칙의 원천 상태다.
    // runtime은 타이머, 입력 로그, 서버 bag, 멀티 동기화처럼 실행 중에만 필요한 상태다.
    const runtime = {
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
    // 런타임 상태, 미리보기, 첫 스폰까지 새 세션 기준으로 다시 구성한다.
    // =============================
    /**
      * 새 게임 시작 기준으로 싱글 플레이 전체 상태를 초기화한다.
      * - 실행 중인 타이머를 멈추고 기본 하강 속도로 되돌린다.
      * - 점수, 홀드, 큐, 입력 대기열, 보드를 모두 비운다.
      * - 렌더러 컨텍스트와 미리보기 DOM을 다시 준비한다.
      * - 큐를 채우고 빈 보드를 렌더한 뒤 첫 조각을 스폰한다.
      *
      * @returns {void}
      */
    function init({ autoStart = true, serverBagChunks = null } = {}) {
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
      * 새 세션 시작 전에 점수, 보드, 입력 큐, 루프 상태를 기본값으로 되돌린다.
      *
      * @returns {void}
      */
    function resetSessionState() {
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
      * 보드 컨텍스트와 preview DOM을 준비하고, 현재 큐 상태를 화면에 반영한다.
      *
      * @returns {void}
      */
    function preparePreviewUi() {
        initBoardContext()
        ui.buildHoldPreview()
        ui.buildNextPreview()
        refillSpawnQueue()
        ui.renderNextPieces(gameState.pieceQueue, BLOCKS)
        ui.renderHoldPiece(gameState.holdPieceType, BLOCKS)
    }

    /**
      * 생성된 스폰 조각을 active/pending 상태에 동시에 반영한다.
      *
      * @param {{pieceType: string, rotation: number, row: number, col: number}} piece - 반영할 조각 상태
      * @returns {void}
      */
    function activateSpawnedPiece(piece) {
        runtime.automaticGroundedPieceIndex = null
        setActivePiece(piece)
        gameState.pendingPiece = { ...piece }
        captureDecisionStartPiece(piece)
    }

    /**
      * 큐에서 다음 조각을 꺼내 새 턴을 시작한다.
      *
      * @returns {void}
      */
    function startNextTurn() {
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
      * 홀드가 가능한 상황이면 현재 조각과 홀드 슬롯을 교체한다.
      *
      * @returns {{applied: boolean, reason: string|null}} 홀드 적용 결과
      */
    function holdPiece() {
        const { activePiece, holdPieceType, holdUsedThisDrop } = gameState
        const currentType = activePiece.pieceType
        if (!currentType || holdUsedThisDrop) {
            return { applied: false, reason: "HOLD_NOT_AVAILABLE" }
        }

        stopGravity()

        let incomingType
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
    // 키보드/네트워크 입력을 고정 tick 순서로 소비하기 위해 쌓아 둔다.
    // =============================
    /**
      * 현재 게임이 입력을 받을 수 있을 때만 플레이어 액션을 큐에 넣는다.
      *
      * @param {string|null} action - 정규화된 입력 액션
      * @param {number|null} scheduledTick - 외부에서 지정한 입력 처리 tick
      * @param {number|null} inputPieceIndex - 입력이 발생한 조각 순번
      * @returns {{tick: number, action: string, pieceIndex: number|null}|null} 큐에 들어간 입력 또는 거부 시 null
      */
    function enqueueInput(action, scheduledTick = null, inputPieceIndex = null) {
        if (!action) return null
        if (!canProcessPlayerInput()) return null
        const nextTick = Number.isFinite(scheduledTick)
            ? scheduledTick
            : runtime.currentTick + 1
        const pieceIndex = Number.isFinite(inputPieceIndex)
            ? inputPieceIndex
            : runtime.pieceIndex

        if (countQueuedInputs(nextTick, pieceIndex) >= MAX_QUEUED_INPUTS_PER_TICK) {
            return null
        }

        const queuedInput = {
            tick: nextTick,
            action,
            pieceIndex,
        }

        gameState.inputQueue.push(queuedInput)
        return queuedInput
    }

    /**
      * 같은 tick/pieceIndex에 이미 쌓인 입력 수를 센다.
      *
      * @param {number} tick - 입력이 처리될 tick
      * @param {number|null} pieceIndex - 입력 대상 조각 순번
      * @returns {number} 같은 처리 슬롯에 쌓인 입력 수
      */
    function countQueuedInputs(tick, pieceIndex) {
        return gameState.inputQueue.filter((input) => {
            return input.tick === tick && input.pieceIndex === pieceIndex
        }).length
    }

    function getPendingInputCount() {
        return gameState.inputQueue.length
    }

    /**
      * 한 번의 입력 틱에서 제한된 개수만큼 입력 큐를 소비한다.
      *
      * @param {number} currentTick - 현재 처리 중인 고정 입력 tick
      * @param {number} [maxPerTick=8] - 이번 틱에서 처리할 최대 액션 수
      * @returns {void}
      */
    function drainInputQueue(currentTick, maxPerTick = 8) {
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
      * 멀티플레이에서 늦게 도착한 이전 조각 입력을 현재 조각에 적용하지 않도록 거른다.
      * - pieceIndex가 없는 로컬 입력은 기존 싱글/내 보드 입력 흐름을 유지하기 위해 허용한다.
      *
      * @param {{pieceIndex?: number|null}} input - 큐에서 꺼낸 입력
      * @returns {boolean} 현재 active piece에 적용 가능한 입력이면 true
      */
    function isInputForCurrentPiece(input) {
        if (!Number.isFinite(input.pieceIndex)) return true
        return input.pieceIndex === runtime.pieceIndex
    }

    // =============================
    // 액션 실행
    // 큐에서 꺼낸 액션을 pendingPiece 변경과 런타임 처리로 연결한다.
    // =============================
    /**
      * pendingPiece에 행/열 이동량을 더한다.
      * - pendingPiece가 없으면 필요한 시점에만 activePiece를 복사해 만든다.
      *
      * @param {number} rowDelta - 적용할 행 이동량
      * @param {number} colDelta - 적용할 열 이동량
      * @returns {void}
      */
    function shiftActivePiece(rowDelta, colDelta) {
        if (!gameState.pendingPiece) {
            gameState.pendingPiece = { ...gameState.activePiece }
        }
        gameState.pendingPiece.row += rowDelta
        gameState.pendingPiece.col += colDelta
    }

    /**
      * pendingPiece를 시계 방향으로 회전시키고 이동 판정을 다시 요청한다.
      *
      * @returns {void}
      */
    function rotatePendingPiece() {
        const { pendingPiece } = gameState
        if (!pendingPiece) return
        const rotation = pendingPiece.rotation
        pendingPiece.rotation = rotation === 3 ? 0 : rotation + 1
    }

    /**
      * activePiece를 도달 가능한 최하단까지 내리고 하드 드롭 점수를 부여한다.
      *
      * @returns {boolean} 현재 조각이 실제로 고정됐으면 true
      */
    function hardDrop() {
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
      * 입력 액션을 pendingPiece 변경으로 변환하고, 필요한 판정 원인을 반환한다.
      *
      * @param {string} action - 입력 계층에서 넘어온 액션 식별자
      * @returns {string|null} 이동 판정에 사용할 moveType
      */
    function applyInputAction(action) {
        const intent = resolveInputMoveIntent(action)
        if (!intent) return null

        if (intent.kind === "shift") {
            shiftActivePiece(intent.rowDelta, intent.colDelta)
            return intent.moveType
        }

        if (intent.kind === "rotate") {
            rotatePendingPiece()
            return intent.moveType
        }

        return null
    }

    /**
      * 정규화된 입력 액션을 맞는 게임플레이 처리기로 직접 분기한다.
      *
      * @param {string} action - 입력 계층에서 넘어온 액션 식별자
      * @returns {{applied: boolean, placementCommitted: boolean, reason: string|null}} 실제 action 적용 결과
      */
    function handleAction(action) {
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
    // 입력 소비와 자동 하강을 같은 tick 루프에서 순서대로 처리한다.
    // =============================
    /**
      * 고정 tick 안에서 입력 소비와 중력 진행을 함께 처리한다.
      * - 입력 큐를 먼저 제한 개수만큼 비운다.
      * - 그 뒤 누적된 시간만큼 자동 하강을 적용한다.
      *
      * @param {number} deltaMs - 직전 tick 이후 경과 시간
      * @returns {void}
      */
    function processTick(deltaMs) {
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
    // pendingPiece 변경을 엔진 판정 결과와 런타임 부수효과로 이어 준다.
    // =============================
    /**
      * pendingPiece 기준으로 이동 또는 회전 1회를 판정하고 intent를 만든다.
      *
      * @param {string} [moveType=""] - 이동 시도 원인 (`fall`, `horizontal`, `rotate`, `spawn` 등)
      * @returns {{intent: Object, pendingPiece: Object}|null} 런타임에서 실행할 이동 결과
      */
    function resolvePendingMove(moveType = "") {
        const { pendingPiece } = gameState
        if (!pendingPiece) return null
        if (!pendingPiece.pieceType) return null

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
      * 이동 판정 결과를 실제 런타임 상태 변경, 렌더링, UI 부수효과로 반영한다.
      *
      * @param {{intent: Object, pendingPiece: Object}|null} moveResult - `resolvePendingMove`가 반환한 이동 결과
      * @param {{automaticGravity?: boolean}} options - automatic gravity lock grace 적용 여부
      * @returns {void}
      */
    function applyMoveIntent(moveResult, options = {}) {
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
      * pendingPiece 기준으로 이동 또는 회전 1회를 처리한다.
      * - 엔진 판정 결과를 intent로 만들고, 런타임 부수효과로 실행한다.
      *
      * @param {string} [moveType=""] - 이동 시도 원인 (`fall`, `horizontal`, `rotate`, `spawn` 등)
      * @param {{automaticGravity?: boolean}} options - automatic gravity 실행 문맥
      * @returns {{intent: Object, pendingPiece: Object}|null} 적용한 이동 판정 결과
      */
    function renderBlocks(moveType = "", options = {}) {
        const moveResult = resolvePendingMove(moveType)
        applyMoveIntent(moveResult, options)
        displayBridge.publishDisplay()
        return moveResult
    }

    // =============================
    // 고정 및 후처리
    // 조각 고정 이후 게임오버, 라인 클리어, 다음 턴으로 이어진다.
    // =============================
    /**
      * activePiece를 보드에 고정하고, 이후 후처리 단계로 넘긴다.
      * - 다음 조각을 만들기 전에 top-out 여부를 먼저 확인한다.
      * - T 조각이 회전 직후 고정되면서 4개 코너 중 3개 이상이 막혀 있으면 T-Spin으로 기록한다.
      * - 보드 반영이 끝나면 라인 클리어 판정 단계로 제어를 넘긴다.
      *
      * @returns {void}
      */
    function seizeBlock() {
        runtime.automaticGroundedPieceIndex = null
        const { activePiece, board } = gameState
        const { pieceType, rotation, row, col } = activePiece
        if (!pieceType) return

        const lockedPiece = clonePendingPiece(activePiece)
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
      * 현재 activePiece를 보드에 반영하고, 다음 단계 준비를 위해 activePiece를 비운다.
      *
      * @param {Object} params - 고정 반영에 필요한 값
      * @param {Array<Array<string|null>>} params.board - 현재 보드 배열
      * @param {{pieceType: string, rotation: number, row: number, col: number}} params.piece - 고정할 조각 상태
      * @param {number} params.rotation - 현재 조각 회전값
      * @param {number} params.row - 현재 조각 행 위치
      * @param {number} params.col - 현재 조각 열 위치
      * @returns {void}
      */
    function commitLockedPiece({ board, piece, rotation, row, col }) {
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
      *
      * @param {boolean} touchesAboveTop - 고정된 조각이 보드 상단 밖 칸을 포함하는지 여부
      * @param {Object|null} placementContext - lock 직전 생성한 placement_decision 로그 문맥
      * @returns {void}
      */
    function handlePostLockFlow(touchesAboveTop, placementContext) {
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
    // 완성 줄 삭제, 점수 갱신, 다음 스폰 흐름으로 이어진다.
    // =============================
    /**
      * 고정된 뒤 완성된 줄을 처리한다.
      * - 가득 찬 줄이 없으면 바로 다음 조각을 스폰한다.
      * - 가득 찬 줄이 있으면 애니메이션이 끝날 때까지 입력을 멈춘다.
      * - T-Spin 보너스 점수는 보드가 실제로 변경된 뒤에 반영한다.
      *
      * @returns {void}
      */
    function checkMatch(placementContext) {
        const { fullRows } = findFullRows(gameState.board)
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
            const clearedLines = clearFilledLines(gameState.board)
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
      * 전달된 조각 상태를 현재 보드에 놓을 수 있는지 검사한다.
      *
      * @param {{pieceType: string, rotation: number, row: number, col: number}} piece - 검사할 조각 상태
      * @returns {boolean} 모든 블록 칸이 유효하면 true
      */
    function canPlace({ pieceType, rotation, row, col }) {
        return canPlacePiece(gameState.board, { pieceType, rotation, row, col }, BLOCKS);
    }

    /**
      * activePiece를 아래로 밀어내는 중력 타이머를 시작하거나 다시 시작한다.
      *
      * @returns {void}
      */
    function startGravity() {
        runtime.gravityRunning = true
        runtime.gravityAccumulatorMs = 0
    }

    /**
      * 자동 하강을 멈추고 누적 시간을 비운다.
      *
      * @returns {void}
      */
    function stopGravity() {
        runtime.gravityRunning = false
        runtime.gravityAccumulatorMs = 0
    }

    /**
      * 키보드 입력 큐를 주기적으로 소비하는 입력 루프를 시작한다.
      *
      * @returns {void}
      */
    function startInputLoop() {
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
      * 중력, 입력 폴링, 라인 클리어 애니메이션을 모두 중지한다.
      *
      * @returns {void}
      */
    function stopGameLoops() {
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
      * 라우트 이탈이나 화면 제거 전에 런타임 루프와 입력 연결을 정리한다.
      *
      * @returns {void}
      */
    function destroy() {
        displayBridge.destroyDisplay()
        stopGameLoops()
        runtime.detachKeyboard?.()
        runtime.detachKeyboard = null
        ui.hideGameOver()
        gameState.inputQueue = []
        runtime.decisionStartPiece = null
        runtime.boardCtx = null
    }

    /**
      * 현재 phase가 플레이어 입력을 허용하는 상태인지 반환한다.
      *
      * @returns {boolean} 실제 플레이 중인 상태일 때만 true
      */
    function canProcessPlayerInput() {
        return gameState.phase === GAME_PHASE.PLAYING
    }

    // =============================
    // 렌더링 보조
    // 화면에 그릴 데이터와 애니메이션 처리를 담당한다.
    // =============================
    /**
      * 렌더링에 사용할 캔버스 컨텍스트를 runtime에 저장한다.
      *
      * @returns {void}
      */
    function initBoardContext() {
        runtime.boardCtx = getBoardContext(boardCanvasEl);
    }

    /**
      * 현재 보드와 activePiece를 기준으로 한 프레임을 그린다.
      *
      * @returns {void}
      */
    function renderBoard() {
        renderBoardCanvas({
            ctx: runtime.boardCtx,
            board: gameState.board,
            activePiece: getRenderableActivePiece(),
            rows: ROWS,
            cols: COLS,
            blocks: BLOCKS,
            isFlash: false,
        });
    }

    /**
      * 렌더링용 activePiece를 만든다.
      * - 고스트 피스 표시를 위해 착지 예정 행(`ghostRow`)을 계산해 포함한다.
      * - 실제 gameState는 여기서 변경하지 않는다.
      * - 반환값은 렌더러에서만 사용한다.
      *
      * @returns {{pieceType: string, rotation: number, row: number, col: number, ghostRow?: number}|null}
      */
    function getRenderableActivePiece() {
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
      * 실제 줄 삭제 전에 라인 클리어 플래시 애니메이션을 재생한다.
      *
      * @param {number[]} rows - 강조해서 보여줄 줄 인덱스 목록
      * @param {Function} onComplete - 애니메이션 종료 후 실행할 콜백
      * @returns {void}
      */
    function addLineClearEffect(rows, onComplete, board = gameState.board) {
        if (!runtime.boardCtx) {
            if (onComplete) onComplete()
            return
        }

        cancelLineClearEffect()
        const animationVersion = runtime.animationVersion

        const DURATION = 350
        const startTime = performance.now()

        function animate(currentTime) {
            if (animationVersion !== runtime.animationVersion) return

            let elapsed = currentTime - startTime
            let progress = Math.min(elapsed / DURATION, 1)

            const animatedRows = rows.map(r => ({ row: r, progress: progress }))

            renderBoardCanvas({
                ctx: runtime.boardCtx,
                board,
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

    function cancelLineClearEffect() {
        runtime.animationVersion += 1
        if (runtime.animationFrameId !== null) cancelAnimationFrame(runtime.animationFrameId)
        runtime.animationFrameId = null
    }

    /**
      * authoritative gameplay state와 분리된 상대 라인 클리어 표시만 재생한다.
      * - 전달받은 clear 전 보드 복사본만 애니메이션에 사용한다.
      * - 완료 후 현재 runtime의 최신 authoritative 보드를 다시 렌더링한다.
      *
      * @param {{rows: number[], board: Array<Array<string|null>>}} effect - 표시할 줄과 clear 전 보드
      * @returns {boolean} 유효한 presentation을 시작했으면 true
      */
    function playLineClearPresentation({ rows, board } = {}) {
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
    // 작은 계산과 상태 갱신 helper를 모아 둔다.
    // =============================
    /**
      * 현재 조각에 적용된 입력을 placement_decision에서 재사용할 수 있게 기록한다.
      *
      * @param {{action: string, tick: number, pieceIndex: number|null}} input - 실제 적용된 입력
      * @returns {void}
      */
    function recordAppliedInput(input) {
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
      * runtime tick에서 판정이 끝난 입력의 최소 결과를 외부 recorder에 전달한다.
      * - 네트워크와 snapshot 상태에는 저장하지 않는다.
      *
      * @param {{action: string, tick: number, pieceIndex: number|null}} input - 판정한 입력
      * @param {{applied: boolean, placementCommitted?: boolean, reason: string|null}} result - action 적용 결과
      * @param {Object|null} activePieceBefore - action 적용 전 조각
      * @returns {void}
      */
    function recordInputOutcome(input, result, activePieceBefore) {
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
      * lock 직전 상태를 기준으로 placement_decision 초안을 만든다.
      *
      * @param {{pieceType: string, rotation: number, row: number, col: number}} lockedPiece - 고정될 조각
      * @returns {Object} boardAfter와 placementResult를 제외한 로그 문맥
      */
    function createPlacementDecisionContext(lockedPiece) {
        const scoreBefore = Number.isFinite(runtime.pendingLockScoreBefore)
            ? runtime.pendingLockScoreBefore
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
            boardBefore: serializeGameState(gameState).board,
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
      * lock 후 보드와 결과값을 채워 placement_decision 로그를 확정한다.
      * - 클라이언트는 공격량만 계산하고 garbage 상쇄·적용은 authoritative server가 결정한다.
      * - 멀티플레이에서는 placementDecisionRecorder를 통해 서버 로그와 공격 이벤트로 이어진다.
      *
      * @param {Object|null} placementContext - lock 직전 생성한 로그 문맥
      * @param {{linesCleared: number, isTSpin: boolean, gameOver: boolean}} result - lock 처리 결과
      * @returns {{gameOver: boolean}} lock 결과의 game over 여부
      */
    function finalizePlacementDecision(placementContext, result) {
        if (!placementContext) return { gameOver: false }

        const { scoreBefore, ...logBase } = placementContext
        const scoreAfter = gameState.score
        const attackState = updateAttackState({
            linesCleared: result.linesCleared,
            isTSpin: result.isTSpin,
        })
        const rawAttackLines = calculateGarbageAttack(attackState)
        const log = {
            ...logBase,
            boardAfter: serializeGameState(gameState).board,
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

    function normalizePendingGarbageLines(lines) {
        return Number.isInteger(lines) && lines > 0 ? lines : 0
    }

    function setAuthoritativePendingGarbageLines(lines, { publish = true } = {}) {
        runtime.authoritativePendingGarbageLines = normalizePendingGarbageLines(lines)
        ui.renderPendingGarbage(runtime.authoritativePendingGarbageLines)
        if (publish) displayBridge.publishDisplay()
        return runtime.authoritativePendingGarbageLines
    }

    /**
      * 라인 클리어 결과를 combo/back-to-back 원천 상태에 반영한다.
      *
      * @param {{linesCleared: number, isTSpin: boolean}} params - 방금 고정된 조각의 공격 판정 입력
      * @returns {{linesCleared: number, isTSpin: boolean, combo: number, backToBack: boolean}} 공격 계산에 사용할 현재 상태
      */
    function updateAttackState({ linesCleared, isTSpin }) {
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
      * 현재 player/pieceIndex에 실제 적용된 입력만 placement_decision에 묶는다.
      *
      * @param {number} pieceIndex - 현재 고정된 조각 순번
      * @returns {Array<Object>} 입력 시퀀스
      */
    function getInputSequenceForPiece(pieceIndex) {
        return runtime.inputLog
            .filter(input => {
                return input.playerId === runtime.playerId && input.pieceIndex === pieceIndex
            })
            .map(input => ({ ...input }))
    }

    /**
      * 조각 상태를 분석 로그에서 쓰기 쉬운 좌표와 cell 목록으로 변환한다.
      *
      * @param {{pieceType: string, rotation: number, row: number, col: number}} piece - 조각 상태
      * @returns {Object} 로그용 조각 정보
      */
    function createPieceLog(piece) {
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
      * 보드를 검사해 가득 찬 줄 번호를 찾아 반환한다.
      *
      * @param {Array<Array<string|null>>} board - 검사할 보드 배열
      * @returns {{fullRows: number[], cols: number}} 가득 찬 줄 목록과 보드 너비
      */
    function findFullRows(board) {
        const cols = board[0]?.length ?? 0
        const fullRows = []
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
      *
      * @param {{pieceType: string, rotation: number, row: number, col: number}} piece - 적용할 조각 상태
      * @returns {void}
      */
    function setActivePiece(piece) {
        if (!piece) return
        gameState.activePiece.pieceType = piece.pieceType
        gameState.activePiece.rotation = piece.rotation
        gameState.activePiece.row = piece.row
        gameState.activePiece.col = piece.col
    }

    /**
      * 현재 bag 모드에 맞춰 다음 스폰/미리보기 큐를 채운다.
      * - server 모드에서는 서버가 내려준 조각만 소비한다.
      * - local 모드에서는 기존 7-bag RNG 경로를 유지한다.
      *
      * @returns {void}
      */
    function refillSpawnQueue() {
        if (runtime.bagMode === "server") {
            while (gameState.pieceQueue.length < NEXT_QUEUE_SIZE + 1 && runtime.serverBagQueue.length > 0) {
                gameState.pieceQueue.push(runtime.serverBagQueue.shift())
            }
            return
        }

        fillPieceQueue(gameState, NEXT_QUEUE_SIZE, PIECE_TYPES, rng)
    }

    /**
      * 현재 모드에 맞게 다음 스폰 조각을 가져오고 큐를 다시 채운다.
      *
      * @returns {string|undefined} 스폰할 조각 타입
      */
    function takeNextPieceType() {
        if (runtime.bagMode === "server") {
            refillSpawnQueue()
            const nextType = gameState.pieceQueue.shift()
            refillSpawnQueue()
            return nextType
        }

        return takeNextFromQueue(gameState, NEXT_QUEUE_SIZE, PIECE_TYPES, rng)
    }

    /**
      * 현재 런타임 상태를 직렬화 가능한 스냅샷으로 꺼낸다.
      * - 멀티플레이 동기화나 디버깅 저장 지점에서 사용할 수 있다.
      *
      * @returns {Object} 현재 gameState와 tick 정보를 담은 스냅샷
      */
    function getSnapshot() {
        return {
            board: serializeGameState(gameState).board,
            activePiece: serializeGameState(gameState).activePiece,
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
      * 외부에서 받은 스냅샷으로 gameState와 UI를 현재 시점에 맞게 복원한다.
      * - 보드, 큐, 홀드, 점수, activePiece를 모두 덮어쓴 뒤 다시 렌더링한다.
      * - 복원 직후 중력 누적값은 초기화해 이전 루프 상태가 이어지지 않게 한다.
      *
      * @param {Object|null} snapshot - 복원할 스냅샷
      * @param {{resumeGravity?: boolean, clearInputQueue?: boolean, cancelPresentation?: boolean}} options - 복원 옵션
      * @returns {void}
      */
    function applySnapshot(snapshot, {
        resumeGravity = false,
        clearInputQueue = false,
        cancelPresentation = false,
    } = {}) {
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

        const snapshotTick = Number.isInteger(snapshot.tick) && snapshot.tick >= 0
            ? snapshot.tick
            : runtime.currentTick
        runtime.currentTick = Math.max(runtime.currentTick, snapshotTick)
        runtime.gravityRunning = false
        runtime.gravityAccumulatorMs = 0
        runtime.automaticGroundedPieceIndex = null
        runtime.pieceIndex = snapshot.pieceIndex ?? runtime.pieceIndex
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
      * 서버가 내려준 bag chunks를 런타임의 조각 공급원으로 설정한다.
      *
      * @param {string[][]} chunks - 서버가 보낸 7-bag chunk 목록
      * @returns {void}
      */
    function setServerBagQueue(chunks) {
        runtime.bagMode = "server"
        runtime.serverBagQueue = Array.isArray(chunks)
            ? chunks.flatMap(chunk => Array.isArray(chunk) ? [...chunk] : [])
            : []
    }

    /**
      * 서버가 추가로 보낸 bag chunk를 런타임 대기열 뒤에 붙인다.
      *
      * @param {string[]} chunk - 추가 공급된 7-bag 한 묶음
      * @returns {void}
      */
    function appendServerBag(chunk) {
        if (!Array.isArray(chunk) || chunk.length === 0) return
        runtime.bagMode = "server"
        runtime.serverBagQueue.push(...chunk)
        refillSpawnQueue()
        ui.renderNextPieces(gameState.pieceQueue, BLOCKS)
        displayBridge.publishDisplay()
    }

    /**
      * 현재 런타임이 소비 가능한 서버 조각 수를 반환한다.
      *
      * @returns {number} server bag 모드가 아니면 Infinity
      */
    function getServerBagRemainingCount() {
        if (runtime.bagMode !== "server") return Infinity
        return runtime.serverBagQueue.length + gameState.pieceQueue.length
    }

    /**
      * activePiece 복원 실패 시 pendingPiece를 최소 상태로 맞춘다.
      *
      * @param {{pieceType: string, rotation: number, row: number, col: number}|null} piece - 기준 조각 상태
      * @returns {{pieceType: string, rotation: number, row: number, col: number}|null} 복사된 pendingPiece
      */
    function clonePendingPiece(piece) {
        if (!piece) return null
        return {
            pieceType: piece.pieceType,
            rotation: piece.rotation,
            row: piece.row,
            col: piece.col,
        }
    }

    /**
      * 현재 조각의 판단 시작 상태를 placement log 분석용 메타데이터로 복사한다.
      * - gameplay 상태와 분리하며 유효하지 않은 조각은 이전 값을 남기지 않는다.
      *
      * @param {{pieceType: string, rotation: number, row: number, col: number}|null} piece - spawn 또는 snapshot으로 적용된 조각
      * @returns {void}
      */
    function captureDecisionStartPiece(piece) {
        const rotations = BLOCKS[piece?.pieceType]
        const isValid = Array.isArray(rotations) &&
            Number.isInteger(piece.rotation) &&
            piece.rotation >= 0 &&
            piece.rotation < rotations.length &&
            Number.isInteger(piece.row) &&
            Number.isInteger(piece.col)

        runtime.decisionStartPiece = isValid
            ? clonePendingPiece(piece)
            : null
    }
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
