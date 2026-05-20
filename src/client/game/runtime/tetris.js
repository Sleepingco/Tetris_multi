import BLOCKS from "../state/blocks.js"
import {
    createEmptyBoard as createEngineBoard,
    canPlacePiece,
    lockPieceOnBoard,
    clearFilledLines,
} from "../core/board.js"
import { resolveMoveAttempt, resolveMoveIntent } from "../core/step.js"
import { playLineClearSfx } from "./sound.js"
import { INPUT_ACTION } from "./input.js"
import {
    BOARD_ROWS,
    BOARD_COLS,
    SPAWN_POSITION,
    INITIAL_FALL_INTERVAL_MS,
    NEXT_PREVIEW_DIMENSION,
    INPUT_TICK_MS,
    WALL_KICKS,
} from "../state/config.js"
import {
    getBoardContext,
    renderBoardCanvas,
    renderNextPieces as renderNextPiecesDom,
    renderHoldPiece as renderHoldPieceDom,
    buildHoldPreview as buildHoldPreviewDom,
    buildNextPreview as buildNextPreviewDom,
} from "../render/tetrisRender.js"
import { createGameState } from "../state/stateFactory.js"
import {
    ensureQueueFilled as fillPieceQueue,
    takeNextFromQueue,
} from "../execution/pieceExecution.js"
import { createGameUi } from "../ui/ui.js"
import {
    serializeGameState,
    deserializeGameState,
} from "../state/stateSerialization.js"
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

const GAME_PHASE = {
    PLAYING: "playing",
    LINE_CLEARING: "lineClearing",
    GAME_OVER: "gameOver",
}

export function createTetrisRuntime({
    boardCanvasEl = null,
    multiCanvasEls = [],
    gameOverEl = null,
    scoreEl = null,
    nextPreviewEl = null,
    holdPreviewEl = null,
    rng = Math.random,
}) {
    const gameState = createGameState({
        spawnRow: SPAWN_ROW,
        spawnCol: SPAWN_COL,
        fallIntervalMs: INITIAL_FALL_INTERVAL_MS,
        initialPhase: GAME_PHASE.PLAYING,
    })

    const runtime = {
        boardCtx: null,
        inputTimer: undefined,
        animationFrameId: null,
        detachKeyboard: null,
        bagMode: "local",
        serverBagQueue: [],
        gravityRunning: false,
        gravityAccumulatorMs: 0,
        lastTickAt: 0,
        currentTick: 0,
    }

    const ui = createGameUi({
        scoreEl,
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
    function init({ autoStart = true } = {}) {
        resetSessionState()
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
    }

    /**
     * 새 세션 시작 전에 점수, 보드, 입력 큐, 루프 상태를 기본값으로 되돌린다.
     *
     * @returns {void}
     */
    function resetSessionState() {
        stopGameLoops()
        gameState.score = 0
        ui.renderScore(gameState.score)
        gameState.fallIntervalMs = INITIAL_FALL_INTERVAL_MS
        gameState.pieceQueue = []
        gameState.holdPieceType = null
        gameState.holdUsedThisDrop = false
        gameState.inputQueue = []
        gameState.phase = GAME_PHASE.PLAYING
        gameState.board = createEngineBoard(ROWS, COLS)
        runtime.currentTick = 0
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
     * 스폰 위치 기준으로 회전이 초기화된 새 조각 상태를 만든다.
     *
     * @param {string} pieceType - 생성할 조각 타입
     * @param {number} spawnRow - 기본 스폰 행
     * @param {number} spawnCol - 기본 스폰 열
     * @returns {{pieceType: string, rotation: number, row: number, col: number}} 스폰용 조각 상태
     */
    function createSpawnedPiece(pieceType, spawnRow, spawnCol) {
        return {
            pieceType,
            row: spawnRow,
            col: spawnCol,
            rotation: 0,
        }
    }

    /**
     * 생성된 스폰 조각을 active/pending 상태에 동시에 반영한다.
     *
     * @param {{pieceType: string, rotation: number, row: number, col: number}} piece - 반영할 조각 상태
     * @returns {void}
     */
    function activateSpawnedPiece(piece) {
        setActivePiece(piece)
        gameState.pendingPiece = { ...piece }
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
            return
        }
        const nextActivePiece = createSpawnedPiece(currentType, SPAWN_ROW, SPAWN_COL)

        activateSpawnedPiece(nextActivePiece)
        gameState.holdUsedThisDrop = false
        ui.renderNextPieces(gameState.pieceQueue, BLOCKS)
        renderBlocks("spawn")
    }

    /**
     * 홀드가 가능한 상황이면 현재 조각과 홀드 슬롯을 교체한다.
     *
     * @returns {void}
     */
    function holdPiece() {
        const { activePiece, holdPieceType, holdUsedThisDrop } = gameState
        const currentType = activePiece.pieceType
        if (!currentType || holdUsedThisDrop) return

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
            return
        }

        const swappedPiece = createSpawnedPiece(incomingType, SPAWN_ROW, SPAWN_COL)

        activateSpawnedPiece(swappedPiece)
        gameState.holdUsedThisDrop = true
        ui.renderHoldPiece(gameState.holdPieceType, BLOCKS)
        ui.renderNextPieces(gameState.pieceQueue, BLOCKS)
        startGravity()
        renderBlocks("spawn")
    }

    // =============================
    // 입력 처리
    // 입력 큐에 액션을 쌓고, 순서대로 게임 상태 변화로 연결한다.
    // =============================
    /**
     * 현재 게임이 입력을 받을 수 있을 때만 플레이어 액션을 큐에 넣는다.
     *
     * @param {string|null} action - 정규화된 입력 액션
     * @returns {void}
     */
    function enqueueInput(action) {
        if (!action) return
        if (!canProcessPlayerInput()) return
        gameState.inputQueue.push({
            tick: runtime.currentTick + 1,
            action
        })
    }

    /**
     * 한 번의 입력 틱에서 제한된 개수만큼 입력 큐를 소비한다.
     *
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
            handleAction(nextInput.action)
            count++
            if (!canProcessPlayerInput()) return
        }
    }

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
        renderBlocks("rotate")
    }

    /**
     * activePiece를 도달 가능한 최하단까지 내리고 하드 드롭 점수를 부여한다.
     *
     * @returns {void}
     */
    function hardDrop() {
        const { activePiece } = gameState
        if (!activePiece.pieceType) return
        stopGravity()

        const { pieceType, rotation, col, row } = activePiece
        let nextRow = row

        while (canPlace({ pieceType, rotation, col, row: nextRow + 1 })) {
            nextRow++
        }

        gameState.pendingPiece = { ...activePiece, row: nextRow }
        renderBlocks("hardDrop")

        const dropped = nextRow - row
        if (dropped > 0) {
            gameState.score += dropped * 2
            ui.renderScore(gameState.score)
        }
    }

    /**
     * 정규화된 입력 액션을 맞는 게임플레이 처리기로 직접 분기한다.
     *
     * @param {string} action - 입력 계층에서 넘어온 액션 식별자
     * @returns {void}
     */
    function handleAction(action) {
        if (action === INPUT_ACTION.MOVE_RIGHT) {
            shiftActivePiece(0, 1)
            renderBlocks("horizontal")
            return
        }

        if (action === INPUT_ACTION.MOVE_LEFT) {
            shiftActivePiece(0, -1)
            renderBlocks("horizontal")
            return
        }

        if (action === INPUT_ACTION.SOFT_DROP) {
            shiftActivePiece(1, 0)
            renderBlocks("fall")
            return
        }

        if (action === INPUT_ACTION.HARD_DROP) {
            hardDrop()
            return
        }

        if (action === INPUT_ACTION.ROTATE) {
            rotatePendingPiece()
            return
        }

        if (action === INPUT_ACTION.HOLD) {
            holdPiece()
        }
    }

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
            shiftActivePiece(1, 0)
            renderBlocks("fall")
            runtime.gravityAccumulatorMs -= gameState.fallIntervalMs

            if (!canProcessPlayerInput()) return
        }
    }

    // =============================
    // 이동 판정 연결부
    // pendingPiece 변경을 엔진 판정 결과와 런타임 부수효과로 이어 준다.
    // =============================
    /**
     * pendingPiece 기준으로 이동 또는 회전 1회를 판정한다.
     * - 엔진이 이동 성공, 롤백, 고정, 게임오버 중 무엇인지 결정한다.
     * - 반환된 intent는 런타임 계층에서 실제 부수효과로 실행된다.
     * - 다음 입력이 최신 결과를 기준으로 시작되도록 pendingPiece를 항상 갱신한다.
     *
     * @param {string} [moveType=""] - 이동 시도 원인 (`fall`, `horizontal`, `rotate`, `spawn` 등)
     * @returns {void}
     */
    function renderBlocks(moveType = "") {
        const pendingPiece = gameState.pendingPiece
        if (!pendingPiece) return
        const { pieceType } = pendingPiece
        if (!pieceType) return

        const outcome = resolveMoveAttempt({
            board: gameState.board,
            activePiece: gameState.activePiece,
            pendingPiece,
            moveCause: moveType,
            blocks: BLOCKS,
            wallKicks: WALL_KICKS,
        })

        gameState.pendingPiece = { ...outcome.pending }

        const intent = resolveMoveIntent({
            outcome,
            hasFallTimer: runtime.gravityRunning,
        })
        if (intent.kind === "gameOver") {
            gameState.phase = GAME_PHASE.GAME_OVER
            gameState.inputQueue = []
            stopGameLoops()
            setActivePiece(intent.active)
            renderBoard()
            ui.showGameOver()
            return
        }

        if (intent.kind === "lock") {
            setActivePiece(intent.active)
            seizeBlock()
            return
        }

        if (intent.kind === "retry") {
            setActivePiece(intent.active)
            renderBoard()
            return
        }

        if (intent.kind === "ok") {
            gameState.phase = GAME_PHASE.PLAYING
            if (intent.shouldStartGravity) startGravity()
            setActivePiece(intent.active)
            if (intent.moveCause) {
                gameState.lastActionWasRotation = intent.moveCause === "rotate"
            }
            renderBoard()
        }
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
        const { activePiece, board } = gameState
        const { pieceType, rotation, row, col } = activePiece
        if (!pieceType) return

        const touchesAboveTop = BLOCKS[pieceType][rotation].some(([, offsetY]) => row + offsetY < 0)
        gameState.isTSpin = isTSpinLock({
            board,
            piece: activePiece,
            lastActionWasRotation: gameState.lastActionWasRotation,
        })

        commitLockedPiece({ board, piece: activePiece, rotation, row, col })
        handlePostLockFlow(touchesAboveTop)
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
     * @returns {void}
     */
    function handlePostLockFlow(touchesAboveTop) {
        if (touchesAboveTop) {
            gameState.phase = GAME_PHASE.GAME_OVER
            gameState.inputQueue = []
            stopGameLoops()
            ui.showGameOver()
            return
        }
        checkMatch()
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
    function checkMatch() {
        const { fullRows } = findFullRows(gameState.board)
        if (fullRows.length === 0) {
            if (gameState.isTSpin) {
                gameState.score += 15
                ui.renderScore(gameState.score)
            }
            gameState.isTSpin = false
            renderBoard()
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
                ui.renderScore(gameState.score)
            } else if (gameState.isTSpin) {
                gameState.score += 15
                ui.renderScore(gameState.score)
            }

            gameState.isTSpin = false
            renderBoard()
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
        if (runtime.animationFrameId) cancelAnimationFrame(runtime.animationFrameId)
        runtime.currentTick = 0
        runtime.inputTimer = undefined
        runtime.animationFrameId = null
        runtime.gravityRunning = false
        runtime.gravityAccumulatorMs = 0
        runtime.lastTickAt = 0
    }

    /**
     * 라우트 이탈이나 화면 제거 전에 런타임 루프와 입력 연결을 정리한다.
     *
     * @returns {void}
     */
    function destroy() {
        stopGameLoops()
        runtime.detachKeyboard?.()
        runtime.detachKeyboard = null
        ui.hideGameOver()
        gameState.inputQueue = []
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
     * 렌더링에 사용할 캔버스를 정하고, 그리기 컨텍스트를 runtime에 저장한다.
     * - 싱글 플레이 캔버스가 없으면 첫 번째 멀티 플레이 캔버스를 대신 사용한다.
     *
     * @returns {void}
     */
    function initBoardContext() {
        const targetCanvas = boardCanvasEl || multiCanvasEls[0];
        runtime.boardCtx = getBoardContext(targetCanvas);
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
    function addLineClearEffect(rows, onComplete) {
        if (!runtime.boardCtx) {
            if (onComplete) onComplete()
            return
        }

        if (runtime.animationFrameId) cancelAnimationFrame(runtime.animationFrameId)

        const DURATION = 350
        const startTime = performance.now()

        function animate(currentTime) {
            let elapsed = currentTime - startTime
            let progress = Math.min(elapsed / DURATION, 1)

            const animatedRows = rows.map(r => ({ row: r, progress: progress }))

            renderBoardCanvas({
                ctx: runtime.boardCtx,
                board: gameState.board,
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
                if (onComplete) onComplete()
            }
        }

        runtime.animationFrameId = requestAnimationFrame(animate)
    }

    // =============================
    // 상태 보조 함수
    // 작은 계산과 상태 갱신 helper를 모아 둔다.
    // =============================
    /** 현재 고정이 T-Spin 조건을 만족하는지 검사한다.
    * - T 조각(`tree`)이 아니면 false다.
    * - 마지막 액션이 회전이 아니면 false다.
    * - 중심 4코너 중 3개 이상이 막혀 있으면 T-Spin으로 본다.
    *
    * @param {Object} params - T-Spin 판정 입력값
    * @param {Array<Array<string|null>>} params.board - 현재 보드 배열
    * @param {{pieceType: string, rotation: number, row: number, col: number}} params.piece - 현재 고정 중인 조각
    * @param {boolean} params.lastActionWasRotation - 마지막 성공 액션이 회전인지 여부
    * @returns {boolean} T-Spin 조건을 만족하면 true
    */
    function isTSpinLock({ board, piece, lastActionWasRotation }) {
        if (!piece || piece.pieceType !== "tree") return false
        if (!lastActionWasRotation) return false

        const centerCol = piece.col + 1
        const centerRow = piece.row + 1
        const corners = [
            [centerCol - 1, centerRow - 1],
            [centerCol + 1, centerRow - 1],
            [centerCol - 1, centerRow + 1],
            [centerCol + 1, centerRow + 1],
        ]

        let filledCorners = 0
        for (const [cx, cy] of corners) {
            if (cx < 0 || cx >= COLS || cy >= ROWS || (cy >= 0 && board[cy][cx])) {
                filledCorners++
            }
        }

        return filledCorners >= 3
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
            phase: gameState.phase,
            fallIntervalMs: gameState.fallIntervalMs,
            tick: runtime.currentTick,
        }
    }

    /**
     * 외부에서 받은 스냅샷으로 gameState와 UI를 현재 시점에 맞게 복원한다.
     * - 보드, 큐, 홀드, 점수, activePiece를 모두 덮어쓴 뒤 다시 렌더링한다.
     * - 복원 직후 중력 누적값은 초기화해 이전 루프 상태가 이어지지 않게 한다.
     *
     * @param {Object|null} snapshot - 복원할 스냅샷
     * @returns {void}
     */
    function applySnapshot(snapshot) {
        if (!snapshot) return

        const restored = deserializeGameState(snapshot, {
            spawnRow: SPAWN_ROW,
            spawnCol: SPAWN_COL,
            fallIntervalMs: INITIAL_FALL_INTERVAL_MS,
            initialPhase: GAME_PHASE.PLAYING,

        })

        gameState.score = restored.score
        gameState.fallIntervalMs = restored.fallIntervalMs
        gameState.board = restored.board
        gameState.pieceQueue = restored.pieceQueue
        gameState.holdPieceType = restored.holdPieceType
        gameState.holdUsedThisDrop = restored.holdUsedThisDrop
        gameState.pendingPiece = restored.pendingPiece ?? clonePendingPiece(restored.activePiece)
        gameState.phase = restored.phase
        gameState.lastActionWasRotation = restored.lastActionWasRotation
        gameState.isTSpin = restored.isTSpin

        setActivePiece(restored.activePiece)

        runtime.currentTick = snapshot.tick ?? runtime.currentTick
        runtime.gravityRunning = false
        runtime.gravityAccumulatorMs = 0

        ui.renderScore(gameState.score)
        ui.renderNextPieces(gameState.pieceQueue, BLOCKS)
        ui.renderHoldPiece(gameState.holdPieceType, BLOCKS)
        if (gameState.phase === GAME_PHASE.GAME_OVER) {
            ui.showGameOver()
        } else {
            ui.hideGameOver()
        }
        renderBoard()
    }

    /**
     * 서버에서 받은 초기 bag chunk들을 런타임 대기열에 저장한다.
     * - 멀티플레이 MVP에서는 스폰 조각 공급을 서버가 결정한다.
     *
     * @param {string[][]} chunks - 서버가 보낸 7-bag chunk 목록
     * @returns {void}
     */
    function applyServerBag(chunks) {
        runtime.bagMode = "server"
        runtime.serverBagQueue = Array.isArray(chunks)
            ? chunks.flatMap(chunk => Array.isArray(chunk) ? [...chunk] : [])
            : []
        gameState.bag = []
        gameState.pieceQueue = []
        refillSpawnQueue()
        ui.renderNextPieces(gameState.pieceQueue, BLOCKS)
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
    return {
        init,
        enqueueInput,
        render: renderBoard,
        stop: stopGameLoops,
        destroy,
        getSnapshot,
        applySnapshot,
        applyServerBag,
        appendServerBag,
        hideGameOver: ui.hideGameOver,
        showGameOver: ui.showGameOver,
        runtime,
    }
}
