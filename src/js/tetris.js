import BLOCKS from "./blocks.js"
import {
    createEmptyBoard as createEngineBoard,
    canPlacePiece,
    lockPieceOnBoard,
    clearFilledLines,
} from "./engine/board.js"
import { resolveMoveAttempt } from "./engine/step.js"
import {
    BOARD_ROWS,
    BOARD_COLS,
    SPAWN_POSITION,
    INITIAL_FALL_INTERVAL_MS,
    NEXT_PREVIEW_DIMENSION,
} from "./config.js"

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
const restartBtn = document.querySelector(".game-text > button"); // 재시작 버튼
const nextPreviewEl = document.querySelector(".next-preview");    // 다음 블록 표시 영역

const PIECE_TYPES = Object.keys(BLOCKS);                           // 사용 가능한 모든 블록 타입
const ROWS = BOARD_ROWS;
const COLS = BOARD_COLS;
const SPAWN_ROW = SPAWN_POSITION.row;
const SPAWN_COL = SPAWN_POSITION.col;
const NEXT_PREVIEW_SIZE = NEXT_PREVIEW_DIMENSION;

const gameState = {
    score: 0,                               // 현재 점수
    fallIntervalMs: INITIAL_FALL_INTERVAL_MS, // 자동 하강 주기(ms)
    fallTimer: undefined,                   // setInterval 핸들(중력 타이머)
    board: null,                            // 2차원 배열로 관리하는 고정 블록 상태
    boardCells: null,                       // DOM 셀 참조(렌더링용 캐시)
    nextPreviewCells: null,                 // 다음 블록 미리보기 셀 모음
    nextPieceType: null,                    // 예정된 다음 블록 타입
    activePiece: {                          // 현재 확정된 조각 상태
        pieceType: "",
        rotation: 0,
        row: SPAWN_ROW,
        col: SPAWN_COL,
    },
    pendingPiece: null,                     // 이동/회전을 시도하는 임시 조각 상태
};

// 초기 진입점
init();

function buildNextPreview() {
    if (!nextPreviewEl) return;
    nextPreviewEl.innerHTML = "";
    gameState.nextPreviewCells = Array.from({ length: NEXT_PREVIEW_SIZE }, () => []);

    const grid = document.createElement("ul");
    grid.classList.add("next-grid");

    for (let row = 0; row < NEXT_PREVIEW_SIZE; row++) {
        for (let col = 0; col < NEXT_PREVIEW_SIZE; col++) {
            const cell = document.createElement("li");
            cell.classList.add("next-cell");
            grid.append(cell);
            gameState.nextPreviewCells[row].push(cell);
        }
    }

    nextPreviewEl.append(grid);
}

// =============================
// 헬퍼: 20x10 보드를 DOM에 생성하고 셀 참조를 캐싱
// =============================
function buildBoard() {
    boardEl.innerHTML = "";
    gameState.boardCells = [];

    for (let row = 0; row < ROWS; row++) {
        const rowLi = document.createElement("li");
        const rowUl = document.createElement("ul");
        const cellRow = [];

        for (let col = 0; col < COLS; col++) {
            const cell = document.createElement("li");
            rowUl.append(cell);
            cellRow.push(cell);
        }

        rowLi.append(rowUl);
        boardEl.append(rowLi);
        gameState.boardCells.push(cellRow);
    }
}

// =============================
// 초기화: 점수 리셋, 20x10 보드 생성, 첫 블록 소환
// =============================
/**
 * 게임을 처음 시작하거나 재시작할 때 전체 상태를 초기화한다.
 *
 * 수행 내용:
 * - 기존 중력 타이머(fallTimer)를 정지하고 기본 하강 주기(fallIntervalMs)로 리셋한다.
 * - 점수를 0으로 초기화하고 점수 표시 DOM(scoreEl)을 갱신한다.
 * - 엔진 보드 배열(gameState.board)을 ROWS x COLS 크기의 비어 있는 상태로 생성한다.
 * - DOM 보드(boardEl)와 다음 블록 미리보기 영역을 다시 생성하고 셀 참조를 캐싱한다.
 * - activePiece를 “아직 블록이 없는 상태”로 스폰 위치에 초기화한다.
 * - pendingPiece를 activePiece의 현재 상태 복사본으로 만들어,
 *   이후 이동/회전 시도 시 기준이 되는 임시 상태로 사용한다.
 * - 다음에 소환될 블록 타입(nextPieceType)을 무작위로 하나 선택해 저장한다.
 * - 비어 있는 보드를 한 번 렌더링한 뒤, generateNewBlock()을 호출해
 *   첫 블록을 소환하고 중력 타이머를 시작한다.
 */
function init() {
    clearInterval(gameState.fallTimer);
    gameState.score = 0;
    scoreEl.innerText = gameState.score;
    gameState.fallIntervalMs = INITIAL_FALL_INTERVAL_MS;

    gameState.board = createEngineBoard(ROWS, COLS);
    buildBoard();
    buildNextPreview();

    setActivePiece({
        pieceType: "",
        rotation: 0,
        row: SPAWN_ROW,
        col: SPAWN_COL,
    });
    gameState.pendingPiece = { ...gameState.activePiece };
    gameState.nextPieceType = pickRandomPiece();

    renderBoard();
    generateNewBlock();                // 첫 블록 생성 + 중력 타이머 시작
}

function setActivePiece(piece) {
    if (!piece) return;
    gameState.activePiece.pieceType = piece.pieceType;
    gameState.activePiece.rotation = piece.rotation;
    gameState.activePiece.row = piece.row;
    gameState.activePiece.col = piece.col;
}

// =============================
// 현재 조각을 화면에 그리기 + 충돌 판정 + 롤백/고정 처리
// - moveType: 'top'이면 아래로 이동 중(충돌 시 고정), 'retry'는 스폰 즉시 충돌 등
// =============================
/**
 * pendingPiece를 기준으로 한 번의 이동/회전을 시도하고,
 * 엔진 결과(resolveMoveAttempt)에 따라 activePiece/보드/게임오버를 처리한다.
 *
 * - moveType은 이번 시도가 어떤 원인에서 발생했는지를 나타낸다.
 *   ('top' 하강, 'horizontal' 좌우 이동, 'retry' 스폰 재시도 등)
 * - resolveMoveAttempt에 현재 보드 상태와 activePiece, pendingPiece를 넘겨
 *   충돌 여부와 다음 상태(outcome)를 계산한다.
 * - outcome.status에 따라:
 *   - 'ok'       → activePiece를 outcome.active로 갱신하고 보드를 다시 렌더링한다.
 *   - 'lock'     → activePiece를 고정 상태로 반영한 뒤 seizeBlock()을 호출한다.
 *   - 'retry'    → 스폰 직후 충돌 등의 상황에서 activePiece로 롤백 후,
 *                  setTimeout(0)으로 renderBlocks('retry')를 다시 호출해 재확인한다.
 *   - 'gameOver' → activePiece를 마지막 상태로 렌더링하고 타이머를 정지한 뒤,
 *                  게임오버 레이어를 표시한다.
 * - 항상 gameState.pendingPiece는 outcome.pending로 덮어써
 *   다음 시도에 사용할 임시 상태를 유지한다.
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

    if (outcome.status === "gameOver") {
        setActivePiece(outcome.active);
        renderBoard();
        clearInterval(gameState.fallTimer);
        showGameOver();
        return;
    }

    if (outcome.status === "lock") {
        setActivePiece(outcome.active);
        seizeBlock();
        return;
    }

    if (outcome.status === "retry") {
        setActivePiece(outcome.active);
        setTimeout(() => {
            renderBlocks("retry");   // 스폰 직후 충돌 여부 재확인
        }, 0);
        return;
    }

    if (outcome.status === "ok") {
        setActivePiece(outcome.active);
        renderBoard();
    }
}

// =============================
// 현재 ".moving"들을 ".seized"로 바꿔 보드에 "고정"
// - 이후 가득 찬 줄이 있는지 검사(checkMatch)
// =============================
function seizeBlock() {
    const { activePiece, board } = gameState;
    const { pieceType, rotation, row, col } = activePiece;
    if (!pieceType) return;

    lockPieceOnBoard(board, activePiece, BLOCKS);

    setActivePiece({
        pieceType: "",
        rotation,
        row,
        col,
    }); // 고정 후에는 활성 조각이 없음
    renderBoard();               // 보드 상태와 DOM 동기화
    checkMatch();
}

// =============================
// 줄 완성 검사:
// - 한 줄(10칸)이 모두 ".seized"면 그 줄 삭제 + 맨 위에 새 줄 추가
// - 점수 +10 (단순 규칙)
// - 새 블록 생성으로 다음 턴 진행
// =============================
function checkMatch() {
    const clearedLines = clearFilledLines(gameState.board);

    if (clearedLines > 0) {
        gameState.score += clearedLines * 10; // 단순 점수 규칙(+10)
        scoreEl.innerText = gameState.score;
    }

    renderBoard();
    generateNewBlock(); // 다음 블록 소환(게임 사이클 계속)
}

// =============================
// 보드 상태(boardState)와 DOM 보드를 동기화
// =============================
function renderBoard() {
    const { boardCells, board, activePiece } = gameState;
    if (!boardCells) return;

    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            const cell = boardCells[row]?.[col];
            if (!cell) continue;

            cell.classList.remove("moving", "seized");
            PIECE_TYPES.forEach(type => cell.classList.remove(type));

            const lockedPiece = board[row][col];
            if (lockedPiece) {
                cell.classList.add(lockedPiece, "seized");
            }
        }
    }

    if (!activePiece.pieceType) return;

    BLOCKS[activePiece.pieceType][activePiece.rotation].forEach(([offsetX, offsetY]) => {
        const targetCol = activePiece.col + offsetX;
        const targetRow = activePiece.row + offsetY;
        const cell = boardCells[targetRow]?.[targetCol];
        if (!cell) return;
        cell.classList.add(activePiece.pieceType, "moving");
    });
}

// =============================
// 새 블록 생성 + 중력 타이머 시작
// - fallIntervalMs마다 아래로 1칸씩 이동
// - BLOCKS에서 임의 유형 선택 후 (0,3)에서 시작
// =============================
function generateNewBlock() {
    clearInterval(gameState.fallTimer); // 기존 타이머 정지(중복 방지)
    gameState.fallTimer = setInterval(() => {
        shiftActivePiece(1, 0);
        renderBlocks("top");    // 아래로 1칸 이동 시도
    }, gameState.fallIntervalMs);

    const currentType = gameState.nextPieceType ?? pickRandomPiece();
    const nextActivePiece = {
        pieceType: currentType,
        row: SPAWN_ROW,
        col: SPAWN_COL,
        rotation: 0,
    };
    setActivePiece(nextActivePiece);
    gameState.pendingPiece = { ...nextActivePiece };        // 임시 상태 동기화
    gameState.nextPieceType = pickRandomPiece();
    renderNextPiece();
    renderBlocks();                                    // 화면에 그리기
}

// =============================
// 현재 조각이 특정 위치에 "놓일 수 있는지" 전부 검사 (하드 드롭 등에서 사용)
// - 모든 칸이 배치 가능해야(true)
// =============================
function canPlace({ pieceType, rotation, row, col }) {
    return canPlacePiece(gameState.board, { pieceType, rotation, row, col }, BLOCKS);
}

function pickRandomPiece() {
    const randomIndex = Math.floor(Math.random() * PIECE_TYPES.length);
    return PIECE_TYPES[randomIndex];
}

function renderNextPiece() {
    const { nextPreviewCells, nextPieceType } = gameState;
    if (!nextPreviewCells) return;

    nextPreviewCells.flat().forEach(cell => {
        cell.className = "next-cell";
    });

    if (!nextPieceType) return;

    const offsets = BLOCKS[nextPieceType][0];
    const minX = Math.min(...offsets.map(([x]) => x));
    const minY = Math.min(...offsets.map(([, y]) => y));

    offsets.forEach(([offsetX, offsetY]) => {
        const row = offsetY - minY;
        const col = offsetX - minX;
        const cell = nextPreviewCells[row]?.[col];
        if (!cell) return;
        cell.classList.add(nextPieceType, "preview");
    });
}

// =============================
// 하드 드롭: 가능한 한 아래로 쭉 내린 뒤 즉시 고정
// - 떨어진 칸 수 × 2 점수 보너스(간단 규칙)
// =============================
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
function changeDirection() {
    const { pendingPiece } = gameState;
    if (!pendingPiece) return;
    const r = pendingPiece.rotation;
    pendingPiece.rotation = (r === 3) ? 0 : r + 1;
    renderBlocks();
}

// =============================
// 소프트 드롭: 하강 속도를 10ms 주기로 잠시 빠르게
// =============================
function dropBlock() {
    clearInterval(gameState.fallTimer);
    gameState.fallTimer = setInterval(() => {
        shiftActivePiece(1, 0);
        renderBlocks("top");
    }, 10);
}

// =============================
// 키보드 입력 처리
// - 화살표 좌/우/하, 위(회전), 스페이스(하드 드롭)
// =============================
document.addEventListener("keydown", e => {
    switch (e.key) {
        case "ArrowRight":
            shiftActivePiece(0, 1);   // 오른쪽 한 칸
            renderBlocks("horizontal");
            break;
        case "ArrowLeft":
            shiftActivePiece(0, -1);  // 왼쪽 한 칸
            renderBlocks("horizontal");
            break;
        case "ArrowDown":
            shiftActivePiece(1, 0);    // 아래로 한 칸(소프트 드롭)
            renderBlocks("top");
            break;
        case "ArrowUp":
            changeDirection();       // 회전
            break;
        case " ":
            hardDrop();              // 하드 드롭
            break;
        default:
            break;
    }
});

// =============================
// 게임오버 레이어 표시
// =============================
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
