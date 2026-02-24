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
} from "./config.js"
import {
    renderBoard as renderBoardDom,
    renderNextPieces as renderNextPiecesDom,
    renderHoldPiece as renderHoldPieceDom,
    buildBoard as buildBoardDom,
    buildHoldPreview as buildHoldPreviewDom,
    buildNextPreview as buildNextPreviewDom,
} from "../render/tetrisRender.js"

const SPAWN_GRACE_MS = 400
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
const boardEl = document.querySelector(".playground > ul");       // 20x10 격자 컨테이너
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

const INPUT_ACTION = {
    MOVE_LEFT: "move_left",
    MOVE_RIGHT: "move_right",
    SOFT_DROP: "soft_drop",
    ROTATE: "rotate",
    HARD_DROP: "hard_drop",
    HOLD: "hold",
}

const GAME_PHASE = {
    PLAYING: "playing",
    SPAWN_GRACE: "spawnGrace",
    LINE_CLEARING: "lineClearing",
    GAME_OVER: "gameOver",
}

const gameState = {
    score: 0,                               // 현재 점수
    fallIntervalMs: INITIAL_FALL_INTERVAL_MS, // 자동 하강 주기(ms)
    inputTimer: undefined,                  // 입력 처리 타이머
    fallTimer: undefined,                   // setInterval 핸들(중력 타이머)
    board: null,                            // 2차원 배열로 관리하는 고정 블록 상태
    boardCells: null,                       // DOM 셀 참조(렌더링용 캐시)
    nextPreviewCells: [],                   // 다음 블록 미리보기 셀 모음(2개)
    holdPreviewCells: null,                 // 홀드 블록 미리보기 셀 모음
    pieceQueue: [],                         // 예정된 블록 큐
    holdPieceType: null,                    // 홀드한 블록
    holdUsedThisDrop: false,                // 이번 턴에 홀드 사용 여부
    spawnGraceTimer: null,                  // 스폰 막힘 시 게임오버 유예 타이머
    activePiece: {                          // 현재 확정된 조각 상태
        pieceType: "",
        rotation: 0,
        row: SPAWN_ROW,
        col: SPAWN_COL,
    },
    pendingPiece: null,                     // 이동/회전을 시도하는 임시 조각 상태
    inputQueue: [],                          // 입력 버퍼
    phase: GAME_PHASE.PLAYING,              // 게임 진행 상태
};

// 초기 진입점
initGameSound(soundToggleBtn);
init();

// =============================
// Renderer wrappers (param injection)
// =============================
function buildBoard() {
    gameState.boardCells = buildBoardDom({
        boardEl,
        rows: ROWS,
        cols: COLS,
    });
}

function buildNextPreview() {
    gameState.nextPreviewCells = buildNextPreviewDom({
        nextPreviewEl,
        nextQueueSize: NEXT_QUEUE_SIZE,
        previewSize: NEXT_PREVIEW_SIZE,
    });
}

function buildHoldPreview() {
    gameState.holdPreviewCells = buildHoldPreviewDom({
        holdPreviewEl,
        previewSize: NEXT_PREVIEW_SIZE,
    });
}

function renderBoard() {
    renderBoardDom({
        boardCells: gameState.boardCells,
        board: gameState.board,
        activePiece: gameState.activePiece,
        rows: ROWS,
        cols: COLS,
        blocks: BLOCKS,
        pieceTypes: PIECE_TYPES,
    });
}

function renderNextPieces() {
    renderNextPiecesDom({
        nextPreviewCells: gameState.nextPreviewCells,
        pieceQueue: gameState.pieceQueue,
        blocks: BLOCKS,
    });
}

function renderHoldPiece() {
    renderHoldPieceDom({
        holdPreviewCells: gameState.holdPreviewCells,
        holdPieceType: gameState.holdPieceType,
        blocks: BLOCKS,
    });
}


// =============================
// 초기화: 점수 리셋, 20x10 보드 생성, 첫 블록 소환
// =============================
/**
 * 게임을 처음 시작하거나 재시작할 때 전체 상태를 초기화한다.
 *
 * 수행 내용:
 * - 중력 타이머(fallTimer)를 정지하고 하강 주기(fallIntervalMs)를 기본값으로 복원한다.
 * - 점수를 0으로 리셋하고 scoreEl에 반영한다.
 * - 엔진 보드 배열을 ROWS x COLS 크기의 빈 상태로 만들고, DOM 보드/미리보기를 재구성해 셀 캐시를 채운다.
 * - activePiece를 “빈 스폰 상태”로 두고 pendingPiece를 동기화해 이후 이동/회전 기준을 만든다.
 * - 무작위 블록 큐를 채워 두고 비어 있는 보드를 일단 렌더한다.
 * - generateNewBlock()으로 첫 블록을 소환하고 중력 타이머를 다시 시작한다.
 *
 * @returns {void}
 */
function init() {
    stopGameLoops()
    if (gameState.spawnGraceTimer) {
        clearTimeout(gameState.spawnGraceTimer);
        gameState.spawnGraceTimer = null;
    }
    gameState.score = 0;
    scoreEl.innerText = gameState.score;
    gameState.fallIntervalMs = INITIAL_FALL_INTERVAL_MS;
    gameState.pieceQueue = [];
    gameState.holdPieceType = null;
    gameState.holdUsedThisDrop = false;
    gameState.inputQueue = [];
    gameState.phase = GAME_PHASE.PLAYING;
    startInputLoop();
    gameState.board = createEngineBoard(ROWS, COLS);
    buildBoard();
    buildHoldPreview();
    buildNextPreview();

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

/**
 * core가 계산한 intent를 실제 게임 상태/타이머/렌더에 적용한다.
 * - 이 함수는 DOM/타이머/사운드 같은 부수효과 실행만 담당한다.
 *
 * @param {{kind: string, active: Object, shouldStartGravity?: boolean}} intent - 실행 의도
 * @returns {void}
 */
function applyMoveIntent(intent) {
    if (intent.kind === "spawnBlocked") {
        clearSpawnGraceTimer();
        gameState.phase = GAME_PHASE.SPAWN_GRACE;
        gameState.inputQueue = [];
        clearInterval(gameState.fallTimer);
        gameState.fallTimer = undefined;
        setActivePiece(intent.active);
        renderBoard();
        gameState.spawnGraceTimer = setTimeout(() => {
            gameState.phase = GAME_PHASE.GAME_OVER;
            gameState.inputQueue = [];
            stopGameLoops();
            setActivePiece(intent.active);
            renderBoard();
            showGameOver();
        }, SPAWN_GRACE_MS);
        return;
    }

    if (intent.kind === "gameOver") {
        clearSpawnGraceTimer();
        gameState.phase = GAME_PHASE.GAME_OVER;
        gameState.inputQueue = [];
        stopGameLoops();
        setActivePiece(intent.active);
        renderBoard();
        showGameOver();
        return;
    }

    if (intent.kind === "lock") {
        setActivePiece(intent.active);
        seizeBlock();
        return;
    }

    if (intent.kind === "retry") {
        setActivePiece(intent.active);
        setTimeout(() => {
            renderBlocks("retry");   // 스폰 직후 충돌 여부 재확인
        }, 0);
        return;
    }

    if (intent.kind === "ok") {
        clearSpawnGraceTimer();
        gameState.phase = GAME_PHASE.PLAYING;
        if (intent.shouldStartGravity) startGravity();
        setActivePiece(intent.active);
        renderBoard();
    }
}

// =============================
// 현재 조각을 화면에 그리기 + 충돌 판정 + 롤백/고정 처리
// - moveType: 'top'이면 아래로 이동 중(충돌 시 고정), 'retry'는 스폰 즉시 충돌 등
// =============================
/**
 * pendingPiece를 기준으로 이동/회전을 한 번 시도하고, 엔진 결과(resolveMoveAttempt)에 따라 확정/고정/재시도/게임오버를 처리한다.
 *
 * 호출 흐름:
 * - moveType은 시도 원인을 표현한다: 'top'(중력), 'horizontal'(좌우 이동), 'retry'(스폰 충돌 재확인) 등.
 * - resolveMoveAttempt에 board, activePiece, pendingPiece, moveCause, blocks를 전달해 충돌/배치 가능 여부와 다음 상태를 계산한다.
 * - resolveMoveIntent가 outcome을 intent(kind)로 변환한다.
 * - intent 실행은 applyMoveIntent에 위임한다.
 * - 매 호출마다 pendingPiece는 outcome.pending로 갱신해 다음 입력 시도를 위한 기준 상태를 유지한다.
 *
 * @param {string} [moveType=""] - 이동/회전 시도의 원인('top' 하강, 'horizontal' 좌우, 'retry' 재확인 등)
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
    });

    gameState.pendingPiece = { ...outcome.pending };

    const intent = resolveMoveIntent({
        outcome,
        hasFallTimer: Boolean(gameState.fallTimer),
    });
    applyMoveIntent(intent);
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

function clearSpawnGraceTimer() {
    if (!gameState.spawnGraceTimer) return;
    clearTimeout(gameState.spawnGraceTimer);
    gameState.spawnGraceTimer = null;
}

function startGravity() {
    clearInterval(gameState.fallTimer);
    gameState.fallTimer = setInterval(() => {
        shiftActivePiece(1, 0);
        renderBlocks("top");
    }, gameState.fallIntervalMs);
}

function addLineClearEffect(rows) {
    const { boardCells } = gameState;
    if (!boardCells) return;
    rows.forEach(row => {
        boardCells[row]?.forEach(cell => {
            if (!cell) return;
            cell.classList.add("line-clear");
        });
    });
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
    lockPieceOnBoard(board, activePiece, BLOCKS);

    setActivePiece({
        pieceType: "",
        rotation,
        row,
        col,
    }); // 고정 후에는 활성 조각이 없음
    renderBoard();               // 보드 상태와 DOM 동기화
    if (touchesAboveTop) {
        clearSpawnGraceTimer();
        gameState.phase = GAME_PHASE.GAME_OVER;
        gameState.inputQueue = [];
        stopGameLoops();
        showGameOver();
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
 * - DOM 점수(scoreEl)를 갱신하고 보드를 재렌더한다.
 * - generateNewBlock()을 호출해 다음 턴을 시작한다.
 *
 * @returns {void}
 */
function checkMatch() {
    const { fullRows } = findFullRows(gameState.board);
    if (fullRows.length === 0) {
        renderBoard();
        generateNewBlock(); // 다음 블록 소환(게임 사이클 계속)
        return;
    }

    gameState.phase = GAME_PHASE.LINE_CLEARING;
    gameState.inputQueue = [];
    clearInterval(gameState.fallTimer);
    playLineClearSfx();
    addLineClearEffect(fullRows);

    setTimeout(() => {
        const clearedLines = clearFilledLines(gameState.board);
        if (clearedLines > 0) {
            gameState.score += clearedLines * 10; // 단순 점수 규칙(+10)
            scoreEl.innerText = gameState.score;
        }
        renderBoard();
        generateNewBlock(); // 다음 블록 소환(게임 사이클 계속)
    }, 350); // 깜빡-폭발 이펙트 타이밍
}


// =============================
// 새 블록 생성 + 중력 타이머 시작
// - fallIntervalMs마다 아래로 1칸씩 이동
// - BLOCKS에서 임의 유형 선택 후 (0,3)에서 시작
// =============================
/**
 * 새 블록을 소환하고 중력 타이머를 재설정한다. 큐에서 한 개를 소비하고 부족한 부분은 채운다.
 * - 기존 중력 타이머를 정지 후, fallIntervalMs 주기로 하강/충돌 검사를 진행하도록 새 타이머를 건다.
 * - 큐에서 꺼낸 블록을 active/pending으로 설정하고 스폰 위치/회전을 0으로 맞춘다.
 * - 미리보기(renderNextPieces)와 화면(renderBlocks)을 갱신한다.
 *
 * @returns {void}
 */
function generateNewBlock() {
    gameState.phase = GAME_PHASE.PLAYING;
    startGravity(); // 기존 타이머 정지(중복 방지)

    const currentType = takeNextFromQueue();
    const nextActivePiece = {
        pieceType: currentType,
        row: SPAWN_ROW,
        col: SPAWN_COL,
        rotation: 0,
    };
    setActivePiece(nextActivePiece);
    gameState.pendingPiece = { ...nextActivePiece };        // 임시 상태 동기화
    gameState.holdUsedThisDrop = false;
    renderNextPieces();
    renderBlocks("spawn");                             // 스폰 충돌 여부 검사
}

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

/**
 * 사용 가능한 블록 타입 중 하나를 무작위로 선택한다.
 *
 * @returns {string} 블록 타입
 */
function pickRandomPiece() {
    const randomIndex = Math.floor(Math.random() * PIECE_TYPES.length);
    return PIECE_TYPES[randomIndex];
}

/**
 * 예정된 블록 큐가 최소 길이를 만족하도록 무작위 블록을 채워 넣는다.
 *
 * @returns {void}
 */
function ensureQueueFilled() {
    while (gameState.pieceQueue.length < NEXT_QUEUE_SIZE + 1) {
        gameState.pieceQueue.push(pickRandomPiece());
    }
}

/**
 * 큐에서 다음 블록을 꺼내고 즉시 최소 길이를 유지하도록 채운다.
 *
 * @returns {string} 다음에 소환할 블록 타입
 */
function takeNextFromQueue() {
    ensureQueueFilled();
    const nextType = gameState.pieceQueue.shift();
    ensureQueueFilled();
    return nextType;
}







// =============================
// 하드 드롭: 가능한 한 아래로 쭉 내린 뒤 즉시 고정
// - 떨어진 칸 수 × 2 점수 보너스(간단 규칙)
// =============================
/**
 * 조각을 가능한 최하단까지 즉시 이동시켜 고정하고, 이동한 칸 수만큼 보너스 점수를 준다.
 * - 하강 타이머를 잠시 멈춘 뒤, 아래가 막힐 때까지 row를 증가시키며 최종 위치를 계산한다.
 * - pendingPiece를 최종 위치로 두고 renderBlocks()로 렌더 후 seizeBlock()으로 즉시 고정한다.
 * - 이동한 칸 수 × 2 점수를 추가하고 표시한다.
 *
 * @returns {void}
 */
function hardDrop() {
    const { activePiece } = gameState;
    if (!activePiece.pieceType) return; // 타입이 없으면 아무 것도 안 함
    clearInterval(gameState.fallTimer);            // 하강 타이머 잠시 정지(중복 처리 방지)

    const { pieceType, rotation, col, row } = activePiece;
    let nextRow = row;

    // 바로 아래 칸이 비어 있는 동안 row를 1씩 증가 → 최종 유효 위치 계산
    while (canPlace({ pieceType, rotation, col, row: nextRow + 1 })) {
        nextRow++;
    }

    // 계산된 최종 위치로 이동 후 렌더 → 즉시 고정
    gameState.pendingPiece = { ...activePiece, row: nextRow };
    renderBlocks();

    const dropped = nextRow - row; // 몇 칸을 한 번에 떨어뜨렸는지
    if (dropped > 0) {
        gameState.score += dropped * 2;       // 간단한 하드 드롭 보너스 규칙
        scoreEl.innerText = gameState.score;
    }
    seizeBlock();                 // 고정 → 줄 검사 → 새 블록 순으로 진행
}

// =============================
// 이동/하강 명령: 전달받은 델타를 임시 조각에 적용
// =============================
/**
 * pendingPiece에 행/열 델타를 적용한다. pendingPiece가 없으면 activePiece를 복사해 사용한다.
 * - 이동 입력 시 항상 pending을 수정해 renderBlocks에서 충돌 판정 후 확정 여부를 결정하게 한다.
 *
 * @param {number} rowDelta - 행 변화량
 * @param {number} colDelta - 열 변화량
 * @returns {void}
 */
function shiftActivePiece(rowDelta, colDelta) {
    if (!gameState.pendingPiece) {
        gameState.pendingPiece = { ...gameState.activePiece };
    }
    gameState.pendingPiece.row += rowDelta;
    gameState.pendingPiece.col += colDelta;
}

// =============================
// 회전: 0→1→2→3→0 순환
// =============================
/**
 * 조각 회전을 0→1→2→3→0 순환으로 변경하고 렌더한다.
 * - pendingPiece가 없으면 아무 것도 하지 않는다.
 * - 회전만 변경하고 나머지 좌표는 그대로 두며, renderBlocks가 충돌 여부를 판단한다.
 *
 * @returns {void}
 */
function changeDirection() {
    const { pendingPiece } = gameState;
    if (!pendingPiece) return;
    const r = pendingPiece.rotation;
    pendingPiece.rotation = (r === 3) ? 0 : r + 1;
    renderBlocks();
}

// =============================
// 홀드: 이번 턴에 1회, 현재 조각을 홀드/교체
// =============================
/**
 * 현재 조각을 홀드하거나 홀드된 조각과 교체한다.
 * - 한 턴에 한 번만 사용할 수 있도록 holdUsedThisDrop 플래그를 체크한다.
 * - 홀드가 비어 있으면 현재 조각을 저장하고 큐에서 새 조각을 가져온다.
 * - 홀드가 이미 있으면 서로 교체하고 스폰 위치/회전을 초기화한다.
 *
 * @returns {void}
 */
function holdPiece() {
    const { activePiece, holdPieceType, holdUsedThisDrop } = gameState;
    const currentType = activePiece.pieceType;
    if (!currentType || holdUsedThisDrop) return;

    clearInterval(gameState.fallTimer);

    let incomingType;
    if (holdPieceType) {
        incomingType = holdPieceType;
        gameState.holdPieceType = currentType;
    } else {
        incomingType = takeNextFromQueue();
        gameState.holdPieceType = currentType;
    }

    const swappedPiece = {
        pieceType: incomingType,
        rotation: 0,
        row: SPAWN_ROW,
        col: SPAWN_COL,
    };

    setActivePiece(swappedPiece);
    gameState.pendingPiece = { ...swappedPiece };
    gameState.holdUsedThisDrop = true;

    renderHoldPiece();
    renderNextPieces();
    startGravity();
    renderBlocks("spawn");
}

function enqueueInput(action) {
    if (!action) return;
    if (!canProcessPlayerInput()) return;
    gameState.inputQueue.push(action);
}

function handleAction(action) {
    if (action === INPUT_ACTION.MOVE_RIGHT) { shiftActivePiece(0, 1); renderBlocks("horizontal"); return }
    if (action === INPUT_ACTION.MOVE_LEFT) { shiftActivePiece(0, -1); renderBlocks("horizontal"); return }
    if (action === INPUT_ACTION.SOFT_DROP) { shiftActivePiece(1, 0); renderBlocks("top"); return }
    if (action === INPUT_ACTION.HARD_DROP) { hardDrop(); return }
    if (action === INPUT_ACTION.ROTATE) { changeDirection(); return }
    if (action === INPUT_ACTION.HOLD) { holdPiece(); return }
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
    clearInterval(gameState.inputTimer);
    gameState.inputTimer = setInterval(() => {
        drainInputQueue(4);
    }, INPUT_TICK_MS);

}

function stopGameLoops() {
    clearInterval(gameState.fallTimer);
    clearInterval(gameState.inputTimer);
    gameState.fallTimer = undefined;
    gameState.inputTimer = undefined;
}

function canProcessPlayerInput() {
    return (
        gameState.phase === GAME_PHASE.PLAYING ||
        gameState.phase === GAME_PHASE.SPAWN_GRACE
    );
}
// =============================
// 키보드 입력 처리
// - 화살표 좌/우/하, 위(회전), 스페이스(하드 드롭)
// =============================
document.addEventListener("keydown", e => {
    tryPlayMusic()

    let action = null
    if (e.code === "KeyC" || e.key?.toLowerCase() === "c") action = INPUT_ACTION.HOLD
    else if (e.key === "ArrowRight") action = INPUT_ACTION.MOVE_RIGHT
    else if (e.key === "ArrowLeft") action = INPUT_ACTION.MOVE_LEFT
    else if (e.key === "ArrowDown") action = INPUT_ACTION.SOFT_DROP
    else if (e.key === "ArrowUp") action = INPUT_ACTION.ROTATE
    else if (e.code === "Space" || e.key === " ") action = INPUT_ACTION.HARD_DROP

    if (!action) return

    if (e.repeat && (action === INPUT_ACTION.HOLD || action === INPUT_ACTION.HARD_DROP || action === INPUT_ACTION.ROTATE)) return
    if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", " "].includes(e.key) || e.code === "Space") e.preventDefault()

    enqueueInput(action)
})


// =============================
// 게임오버 레이어 표시
// =============================
/**
 * 게임오버 레이어를 화면에 표시한다.
 * - 중력 타이머 정지 이후 호출되며, 재시작 버튼 클릭 시 숨겨진다.
 *
 * @returns {void}
 */
function showGameOver() {
    gameOverEl.style.display = "flex";
}

// =============================
// 재시작: 보드를 비우고 다시 init()
// =============================
restartBtn.addEventListener("click", () => {
    boardEl.innerHTML = "";   // 모든 줄/칸 제거
    gameOverEl.style.display = "none";
    init();                    // 초기화부터 재시작
});
