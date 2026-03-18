import BLOCKS from "./blocks.js"
import {
    createEmptyBoard as createEngineBoard,
    canPlacePiece,
    lockPieceOnBoard,
    clearFilledLines,
} from "../core/board.js"
import { resolveMoveAttempt, resolveMoveIntent } from "../core/step.js"
import { initGameSound, tryPlayMusic, playLineClearSfx } from "./sound.js"
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
import { attachKeyboardInput } from "./input.js"
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
// 테트리스 메인 스크립트 (단일 플레이)
// -----------------------------
// DOM(ul/li)을 보드로 사용하고, 현재 조각을 CSS 클래스로 렌더링합니다.
// 게임 사이클
//   1) 블록 자동 하강(중력 타이머)
//   2) 충돌 시 고정(seize)
//   3) 가득 찬 줄 삭제(checkMatch) + 점수 갱신
//   4) 새 블록 생성(generateNewBlock)
// =============================

// DOM 참조
const boardCanvasEl = document.querySelector("canvas#tetrisBoardCanvas"); // 20x10 캔버스 컨테이너
const multiCanvasEls = document.querySelectorAll("canvas.tetrisBoardCanvas"); // (멀티플레이어 용)
const gameOverEl = document.querySelector(".game-text");          // 게임오버 레이어
const scoreEl = document.querySelector(".score");                 // 점수 표시 영역
const restartBtn = document.querySelector(".game-text > button"); // 재시작 버튼d
const nextPreviewEl = document.querySelector(".next-preview");    // 다음 블록 표시 영역
const holdPreviewEl = document.querySelector(".hold-preview");    // 홀드 블록 표시 영역
const soundToggleBtn = document.getElementById("soundToggle");    // 사운드 온/오프 버튼

const PIECE_TYPES = Object.keys(BLOCKS);                           // 사용 가능한 모든 블록 타입
const ROWS = BOARD_ROWS;
const COLS = BOARD_COLS;
const SPAWN_ROW = SPAWN_POSITION.row;
const SPAWN_COL = SPAWN_POSITION.col;
const NEXT_PREVIEW_SIZE = NEXT_PREVIEW_DIMENSION;

const GAME_PHASE = {
    PLAYING: "playing",
    LINE_CLEARING: "lineClearing",
    GAME_OVER: "gameOver",
}

const gameState = createGameState({
    spawnRow: SPAWN_ROW,
    spawnCol: SPAWN_COL,
    fallIntervalMs: INITIAL_FALL_INTERVAL_MS,
    initialPhase: GAME_PHASE.PLAYING,
})

const runtime = {
    boardCtx: null,
    fallTimer: undefined,
    inputTimer: undefined,
    animationFrameId: null,
    detachKeyboard: null,
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

// 초기 진입점
initGameSound(soundToggleBtn);
runtime.detachKeyboard = attachKeyboardInput({
    enqueueAction: enqueueInput,
    onUserInteract: tryPlayMusic,
})
init();

// =============================
// Renderer wrappers (param injection)
// =============================
function initBoardContext() {
    // 만약 싱글모드 캔버스가 없으면 첫 번째 멀티모드 캔버스라도 가져옵니다 (임시/기본 처리)
    const targetCanvas = boardCanvasEl || multiCanvasEls[0];
    runtime.boardCtx = getBoardContext(targetCanvas);
}

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

function renderNextPieces() {
    ui.renderNextPieces(gameState.pieceQueue, BLOCKS)
}

function renderHoldPiece() {
    ui.renderHoldPiece(gameState.holdPieceType, BLOCKS)
}

function ensureQueueFilled() {
    fillPieceQueue(gameState, NEXT_QUEUE_SIZE, PIECE_TYPES)
}

function generateNewBlock() {
    spawnNextPiece({
        gameState,
        phases: GAME_PHASE,
        spawnRow: SPAWN_ROW,
        spawnCol: SPAWN_COL,
        nextQueueSize: NEXT_QUEUE_SIZE,
        pieceTypes: PIECE_TYPES,
        setActivePiece,
        renderNextPieces,
        renderBlocks,
        startGravity,
    })
}

function holdPiece() {
    executeHoldPiece({
        gameState,
        spawnRow: SPAWN_ROW,
        spawnCol: SPAWN_COL,
        nextQueueSize: NEXT_QUEUE_SIZE,
        pieceTypes: PIECE_TYPES,
        setActivePiece,
        renderHoldPiece,
        renderNextPieces,
        renderBlocks,
        startGravity,
        stopGravity: () => clearInterval(runtime.fallTimer),
    })
}


// =============================
// 초기화: 점수 리셋, 20x10 보드 생성, 첫 블록 소환
// =============================
/**
 * 게임을 처음 시작하거나 재시작할 때 전체 상태를 초기화한다.
 *
 * 수행 내용:
 * - 중력 타이머(fallTimer)를 정지하고 하강 주기(fallIntervalMs)를 기본값으로 복원한다.
 * - 점수를 0으로 리셋하고 UI에 반영한다.
 * - 엔진 보드 배열을 ROWS x COLS 크기의 빈 상태로 만들고, DOM 보드/미리보기를 재구성해 셀 캐시를 채운다.
 * - activePiece를 “빈 스폰 상태”로 두고 pendingPiece를 동기화해 이후 이동/회전 기준을 만든다.
 * - 무작위 블록 큐를 채워 두고 비어 있는 보드를 일단 렌더한다.
 * - generateNewBlock()으로 첫 블록을 소환하고 중력 타이머를 다시 시작한다.
 *
 * @returns {void}
 */
function init() {
    stopGameLoops()
    gameState.score = 0;
    ui.renderScore(gameState.score);
    gameState.fallIntervalMs = INITIAL_FALL_INTERVAL_MS;
    gameState.pieceQueue = [];
    gameState.holdPieceType = null;
    gameState.holdUsedThisDrop = false;
    gameState.inputQueue = [];
    gameState.phase = GAME_PHASE.PLAYING;
    startInputLoop();
    gameState.board = createEngineBoard(ROWS, COLS);
    initBoardContext();
    ui.buildHoldPreview();
    ui.buildNextPreview();

    setActivePiece({
        pieceType: "",
        rotation: 0,
        row: SPAWN_ROW,
        col: SPAWN_COL,
    });
    gameState.pendingPiece = { ...gameState.activePiece };
    ensureQueueFilled();
    renderNextPieces();
    renderHoldPiece();

    renderBoard();
    generateNewBlock();                // 첫 블록 생성 + 중력 타이머 시작
}

/**
 * activePiece를 전달된 조각 상태로 덮어쓴다.
 * - null/undefined 입력은 무시한다.
 * - 개별 필드를 직접 할당해 기존 객체 참조를 유지한다.
 *
 * @param {{pieceType: string, rotation: number, row: number, col: number}} piece - 설정할 조각 상태
 * @returns {void}
 */
function setActivePiece(piece) {
    if (!piece) return;
    gameState.activePiece.pieceType = piece.pieceType;
    gameState.activePiece.rotation = piece.rotation;
    gameState.activePiece.row = piece.row;
    gameState.activePiece.col = piece.col;
}

// =============================
// 현재 조각을 화면에 그리기 + 충돌 판정 + 롤백/고정 처리
// - moveType: 'fall'이면 아래로 이동 중(충돌 시 고정), 나머지 충돌은 롤백(retry)
// =============================
/**
 * pendingPiece를 기준으로 이동/회전을 한 번 시도하고, 엔진 결과(resolveMoveAttempt)에 따라 확정/고정/재시도/게임오버를 처리한다.
 *
 * 호출 흐름:
 * - moveType은 시도 원인을 표현한다: 'fall'(하강), 'horizontal'(좌우 이동), 'rotate'(회전) 등.
 * - resolveMoveAttempt에 board, activePiece, pendingPiece, moveCause, blocks를 전달해 충돌/배치 가능 여부와 다음 상태를 계산한다.
 * - resolveMoveIntent가 outcome을 intent(kind)로 변환한다.
 * - intent 실행은 applyMoveIntent에 위임한다.
 * - 매 호출마다 pendingPiece는 outcome.pending로 갱신해 다음 입력 시도를 위한 기준 상태를 유지한다.
 *
 * @param {string} [moveType=""] - 이동/회전 시도의 원인('fall' 하강, 'horizontal' 좌우, 'rotate' 회전 등)
 * @returns {void}
 */
function renderBlocks(moveType = "") {
    const pendingPiece = gameState.pendingPiece;
    if (!pendingPiece) return;
    const { pieceType } = pendingPiece; // 시도 중인 좌표/회전
    if (!pieceType) return;


    const outcome = resolveMoveAttempt({
        board: gameState.board,
        activePiece: gameState.activePiece,
        pendingPiece,
        moveCause: moveType,
        blocks: BLOCKS,
        wallKicks: WALL_KICKS,
    });

    gameState.pendingPiece = { ...outcome.pending };

    const intent = resolveMoveIntent({
        outcome,
        hasFallTimer: Boolean(runtime.fallTimer),
    });
    applyMoveIntent(intent, {
        gameState,
        phases: GAME_PHASE,
        setActivePiece,
        stopGameLoops,
        renderBoard,
        showGameOver: ui.showGameOver,
        seizeBlock,
        startGravity,
    });
}

function findFullRows(board) {
    const cols = board[0]?.length ?? 0;
    const fullRows = [];
    for (let row = 0; row < board.length; row++) {
        const isFull = board[row].every(cell => cell !== null);
        if (isFull) fullRows.push(row);
    }
    return { fullRows, cols };
}

function startGravity() {
    clearInterval(runtime.fallTimer);
    runtime.fallTimer = setInterval(() => {
        shiftActivePiece(gameState, 1, 0);
        renderBlocks("fall");
    }, gameState.fallIntervalMs);
}

function addLineClearEffect(rows, onComplete) {
    if (!runtime.boardCtx) {
        if (onComplete) onComplete();
        return;
    }

    if (runtime.animationFrameId) cancelAnimationFrame(runtime.animationFrameId);

    const DURATION = 350; // CSS 애니메이션 지속 시간과 동일
    const startTime = performance.now();

    function animate(currentTime) {
        let elapsed = currentTime - startTime;
        let progress = Math.min(elapsed / DURATION, 1);

        const animatedRows = rows.map(r => ({ row: r, progress: progress }));

        renderBoardCanvas({
            ctx: runtime.boardCtx,
            board: gameState.board,
            activePiece: null,
            rows: ROWS,
            cols: COLS,
            blocks: BLOCKS,
            flashRows: animatedRows,
        });

        if (progress < 1) {
            runtime.animationFrameId = requestAnimationFrame(animate);
        } else {
            runtime.animationFrameId = null;
            if (onComplete) onComplete();
        }
    }

    runtime.animationFrameId = requestAnimationFrame(animate);
}


/**
 * activePiece를 보드에 고정하고 렌더 후 줄 검사까지 이어서 처리한다.
 * - lockPieceOnBoard로 엔진 보드에 조각을 채운다(경계 밖은 무시).
 * - activePiece를 빈 상태로 초기화해 “현재 움직이는 조각 없음”을 표시한다.
 * - renderBoard()로 고정 상태를 DOM에 반영한 뒤 checkMatch()로 라인 삭제/점수를 진행한다.
 *
 * @returns {void}
 */
function seizeBlock() {
    const { activePiece, board } = gameState;
    const { pieceType, rotation, row, col } = activePiece;
    if (!pieceType) return;

    const touchesAboveTop = BLOCKS[pieceType][rotation].some(([, offsetY]) => row + offsetY < 0);

    // T-Spin 판별 (T 블록이고, 마지막 행동이 회전이었으며, 3/4코너가 막혀있음)
    let tSpin = false;
    if (pieceType === "tree" && gameState.lastActionWasRotation) {
        const centerCol = col + 1;
        const centerRow = row + 1;
        const corners = [
            [centerCol - 1, centerRow - 1], [centerCol + 1, centerRow - 1],
            [centerCol - 1, centerRow + 1], [centerCol + 1, centerRow + 1],
        ];
        let filledCorners = 0;
        for (const [cx, cy] of corners) {
            if (cx < 0 || cx >= COLS || cy >= ROWS || (cy >= 0 && board[cy][cx])) {
                filledCorners++;
            }
        }
        if (filledCorners >= 3) tSpin = true;
    }

    gameState.isTSpin = tSpin;

    lockPieceOnBoard(board, activePiece, BLOCKS);

    setActivePiece({
        pieceType: "",
        rotation,
        row,
        col,
    }); // 고정 후에는 활성 조각이 없음
    renderBoard();               // 보드 상태와 DOM 동기화
    if (touchesAboveTop) {
        gameState.phase = GAME_PHASE.GAME_OVER;
        gameState.inputQueue = [];
        stopGameLoops();
        ui.showGameOver();
        return;
    }
    checkMatch();
}

// =============================
// 줄 완성 검사:
// - 한 줄(10칸)이 모두 ".seized"면 그 줄 삭제 + 맨 위에 새 줄 추가
// - 점수 +10 (단순 규칙)
// - 새 블록 생성으로 다음 턴 진행
// =============================
/**
 * 가득 찬 줄을 삭제하고 점수를 갱신한 뒤 보드를 렌더하고 새 블록을 소환한다.
 * - clearFilledLines로 삭제된 줄 수를 얻고, 줄당 10점씩 점수를 추가한다.
 * - 점수를 UI에 반영하고 보드를 재렌더한다.
 * - generateNewBlock()을 호출해 다음 턴을 시작한다.
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
    })
}


// =============================
// 새 블록 생성 + 중력 타이머 시작
// - fallIntervalMs마다 아래로 1칸씩 이동
// - BLOCKS에서 임의 유형 선택 후 (0,3)에서 시작
// =============================
// =============================
// 현재 조각이 특정 위치에 "놓일 수 있는지" 전부 검사 (하드 드롭 등에서 사용)
// - 모든 칸이 배치 가능해야(true)
// =============================
/**
 * 현재 보드에 주어진 조각을 놓을 수 있는지 전부 검사한다.
 * - canPlacePiece 엔진 함수를 그대로 위임 사용한다.
 *
 * @param {{pieceType: string, rotation: number, row: number, col: number}} piece - 검사 대상 조각 상태
 * @returns {boolean} 모든 블록이 유효하면 true
 */
function canPlace({ pieceType, rotation, row, col }) {
    return canPlacePiece(gameState.board, { pieceType, rotation, row, col }, BLOCKS);
}

function enqueueInput(action) {
    if (!action) return;
    if (!canProcessPlayerInput()) return;
    gameState.inputQueue.push(action);
}

function handleAction(action) {
    executeAction(action, {
        gameState,
        renderBlocks,
        canPlace,
        renderScore: ui.renderScore,
        stopGravity: () => clearInterval(runtime.fallTimer),
        holdPiece,
    })
}

function drainInputQueue(maxPerTick = 8) {
    if (!canProcessPlayerInput()) return;
    let count = 0;
    while (gameState.inputQueue.length > 0 && count < maxPerTick) {
        const action = gameState.inputQueue.shift();
        handleAction(action);
        count++;
    }
}

function startInputLoop() {
    clearInterval(runtime.inputTimer);
    runtime.inputTimer = setInterval(() => {
        drainInputQueue(4);
    }, INPUT_TICK_MS);

}

function stopGameLoops() {
    clearInterval(runtime.fallTimer);
    clearInterval(runtime.inputTimer);
    if (runtime.animationFrameId) cancelAnimationFrame(runtime.animationFrameId);
    runtime.fallTimer = undefined;
    runtime.inputTimer = undefined;
    runtime.animationFrameId = null;
}

function canProcessPlayerInput() {
    return gameState.phase === GAME_PHASE.PLAYING;
}
// =============================
// 게임오버 레이어 표시
// =============================
/**
 * 게임오버 레이어를 화면에 표시한다.
 * - 중력 타이머 정지 이후 호출되며, 재시작 버튼 클릭 시 숨겨진다.
 *
 * @returns {void}
 */
// =============================
// 재시작: 보드를 비우고 다시 init()
// =============================
restartBtn.addEventListener("click", () => {
    ui.hideGameOver();
    init();                    // 초기화부터 재시작
});
