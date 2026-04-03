import BLOCKS from "./blocks.js"
import {
    createEmptyBoard as createEngineBoard,
    canPlacePiece,
    lockPieceOnBoard,
    clearFilledLines,
} from "../core/board.js"
import { resolveMoveAttempt, resolveMoveIntent } from "../core/step.js"
import { playLineClearSfx } from "./sound.js"
import {
    BOARD_ROWS,
    BOARD_COLS,
    SPAWN_POSITION,
    INITIAL_FALL_INTERVAL_MS,
    NEXT_PREVIEW_DIMENSION,
    INPUT_TICK_MS,
    WALL_KICKS,
} from "./config.js"
import {
    getBoardContext,
    renderBoardCanvas,
    renderNextPieces as renderNextPiecesDom,
    renderHoldPiece as renderHoldPieceDom,
    buildHoldPreview as buildHoldPreviewDom,
    buildNextPreview as buildNextPreviewDom,
} from "../render/tetrisRender.js"
import { createGameState } from "./stateFactory.js"
import { applyMoveIntent } from "./moveExecution.js"
import {
    ensureQueueFilled as fillPieceQueue,
    generateNewBlock as spawnNextPiece,
    holdPiece as executeHoldPiece,
} from "./pieceExecution.js"
import { createGameUi } from "./ui.js"
import { checkMatch as runLineClearCheck } from "./lineExecution.js"
import { executeAction, shiftActivePiece } from "./actionExecution.js"

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
    initBoardContext()
    ui.buildHoldPreview()
    ui.buildNextPreview()
    runtime.currentTick = 0

    setActivePiece({
        pieceType: "",
        rotation: 0,
        row: SPAWN_ROW,
        col: SPAWN_COL,
    })
    gameState.pendingPiece = { ...gameState.activePiece }
    ensureQueueFilled()
    renderNextPieces()
    renderHoldPiece()

    renderBoard()
    if (autoStart) {
        startInputLoop()
        generateNewBlock()
    }
}

/**
 * 다음 조각을 스폰하고 새 턴의 중력 루프를 시작한다.
 *
 * @returns {void}
 */
function generateNewBlock() {
    spawnNextPiece({
        gameState,
        phases: GAME_PHASE,
        setActivePiece,
        spawnRow: SPAWN_ROW,
        spawnCol: SPAWN_COL,
        nextQueueSize: NEXT_QUEUE_SIZE,
        pieceTypes: PIECE_TYPES,
        rng,
        renderNextPieces,
        renderBlocks,
        startGravity,
    })
}

/**
 * 홀드가 가능한 상황이면 현재 조각과 홀드 슬롯을 교체한다.
 *
 * @returns {void}
 */
function holdPiece() {
    executeHoldPiece({
        gameState,
        spawnRow: SPAWN_ROW,
        spawnCol: SPAWN_COL,
        nextQueueSize: NEXT_QUEUE_SIZE,
        pieceTypes: PIECE_TYPES,
        rng,
        setActivePiece,
        renderHoldPiece,
        renderNextPieces,
        renderBlocks,
        startGravity,
        stopGravity,
    })
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
 * 정규화된 입력 액션을 actionExecution 모듈로 전달한다.
 *
 * @param {string} action - 입력 계층에서 넘어온 액션 식별자
 * @returns {void}
 */
function handleAction(action) {
    executeAction(action, {
        gameState,
        renderBlocks,
        canPlace,
        renderScore: ui.renderScore,
        stopGravity,
        holdPiece,
    })
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
        shiftActivePiece(gameState, 1, 0)
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
    applyMoveIntent(intent, {
        gameState,
        phases: GAME_PHASE,
        setActivePiece,
        stopGameLoops,
        renderBoard,
        showGameOver: ui.showGameOver,
        seizeBlock,
        startGravity,
    })
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

    lockPieceOnBoard(board, activePiece, BLOCKS)

    setActivePiece({
        pieceType: "",
        rotation,
        row,
        col,
    })
    renderBoard()
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
 * 라인 클리어 처리를 lineExecution 모듈로 위임한다.
 * - 애니메이션, 점수 계산, 다음 조각 스폰을 보조 모듈이 담당한다.
 *
 * @returns {void}
 */
function checkMatch() {
    runLineClearCheck({
        gameState,
        phases: GAME_PHASE,
        runtime,
        findFullRows,
        clearFilledLines,
        playLineClearSfx,
        addLineClearEffect,
        renderBoard,
        generateNewBlock,
        renderScore: ui.renderScore,
        stopGravity,
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
 * 현재 pieceQueue를 기준으로 다음 블록 미리보기 UI를 갱신한다.
 *
 * @returns {void}
 */
function renderNextPieces() {
    ui.renderNextPieces(gameState.pieceQueue, BLOCKS)
}

/**
 * 현재 hold 슬롯 상태를 기준으로 홀드 미리보기 UI를 갱신한다.
 *
 * @returns {void}
 */
function renderHoldPiece() {
    ui.renderHoldPiece(gameState.holdPieceType, BLOCKS)
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
/**
 * 스폰과 미리보기에 필요한 만큼 조각 큐를 채운다.
 *
 * @returns {void}
 */
function ensureQueueFilled() {
    fillPieceQueue(gameState, NEXT_QUEUE_SIZE, PIECE_TYPES, rng)
}

/**
 * 현재 고정이 T-Spin 조건을 만족하는지 검사한다.
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

    return {
        init,
        enqueueInput,
        render: renderBoard,
        stop: stopGameLoops,
        hideGameOver: ui.hideGameOver,
        showGameOver: ui.showGameOver,
        runtime,
        gameState,
    }
}
