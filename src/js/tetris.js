import BLOCKS from "./blocks.js"

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

const PIECE_TYPES = Object.keys(BLOCKS);                           // 사용 가능한 모든 블록 타입

// 설정(행/열 수)
const ROWS = 20;
const COLS = 10;

// 상태 변수들
let score = 0;                 // 현재 점수
let fallIntervalMs = 500;      // 자동 하강 주기(ms)
let fallTimer;                 // setInterval 핸들(중력 타이머)
let pendingPiece;              // 이동/회전을 "시도"해보는 임시 조각 상태
let boardState;                // 2차원 배열로 관리하는 고정 블록 상태
let boardCells;                // DOM 셀 참조(렌더링용 캐시)

// 실제 확정된 현재 조각 상태(성공적으로 렌더되면 여기에 반영)
const activePiece = {
  pieceType: "",   // 'I','O','T','S','Z','J','L'
  rotation: 0,      // 0~3
  row: 0,           // 보드 y (위→아래)
  col: 3,           // 보드 x (왼→오)
}

// 초기 진입점
init();

// =============================
// 헬퍼: 비어 있는 보드 배열 생성
// =============================
function createEmptyBoard(){
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

// =============================
// 헬퍼: 20x10 보드를 DOM에 생성하고 셀 참조를 캐싱
// =============================
function buildBoard(){
  boardEl.innerHTML = "";
  boardCells = [];

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
    boardCells.push(cellRow);
  }
}

// =============================
// 초기화: 점수 리셋, 20x10 보드 생성, 첫 블록 소환
// =============================
function init(){
  clearInterval(fallTimer);
  score = 0;
  scoreEl.innerText = score;

  boardState = createEmptyBoard();
  buildBoard();

  activePiece.pieceType = "";
  activePiece.rotation = 0;
  activePiece.row = 0;
  activePiece.col = 3;
  pendingPiece = { ...activePiece };

  renderBoard();
  generateNewBlock();                // 첫 블록 생성 + 중력 타이머 시작
}

// =============================
// 현재 조각을 화면에 그리기 + 충돌 판정 + 롤백/고정 처리
// - moveType: 'top'이면 아래로 이동 중(충돌 시 고정), 'retry'는 스폰 즉시 충돌 등
// =============================
function renderBlocks(moveType = ""){
  const { pieceType } = pendingPiece; // 시도 중인 좌표/회전
  if (!pieceType) return;

  if (!canPlace(pendingPiece)) {
    pendingPiece = { ...activePiece }; // 이동 실패 → 원래 상태로 롤백

    if (moveType === "retry") {
      clearInterval(fallTimer);
      showGameOver();
      return;
    }

    if (moveType === "top") {
      seizeBlock();
      return;
    }

    setTimeout(() => {
      renderBlocks("retry");   // 스폰 직후 충돌 여부 재확인
    }, 0);
    return;
  }

  const { rotation, row, col } = pendingPiece;
  activePiece.pieceType = pieceType;
  activePiece.col = col;
  activePiece.row = row;
  activePiece.rotation = rotation;

  renderBoard();
}

// =============================
// 현재 ".moving"들을 ".seized"로 바꿔 보드에 "고정"
// - 이후 가득 찬 줄이 있는지 검사(checkMatch)
// =============================
function seizeBlock(){
  const { pieceType, rotation, row, col } = activePiece;
  if (!pieceType) return;

  BLOCKS[pieceType][rotation].forEach(([offsetX, offsetY]) => {
    const targetCol = col + offsetX;
    const targetRow = row + offsetY;
    if (targetCol >= 0 && targetCol < COLS && targetRow >= 0 && targetRow < ROWS) {
      boardState[targetRow][targetCol] = pieceType;
    }
  });

  activePiece.pieceType = ""; // 고정 후에는 활성 조각이 없음
  renderBoard();               // 보드 상태와 DOM 동기화
  checkMatch();
}

// =============================
// 줄 완성 검사:
// - 한 줄(10칸)이 모두 ".seized"면 그 줄 삭제 + 맨 위에 새 줄 추가
// - 점수 +10 (단순 규칙)
// - 새 블록 생성으로 다음 턴 진행
// =============================
function checkMatch(){
  let clearedLines = 0;

  for (let row = boardState.length - 1; row >= 0; row--) {
    const isFull = boardState[row].every(cell => cell !== null);
    if (isFull) {
      boardState.splice(row, 1);
      boardState.unshift(Array(COLS).fill(null));
      clearedLines++;
    }
  }

  if (clearedLines > 0) {
    score += clearedLines * 10; // 단순 점수 규칙(+10)
    scoreEl.innerText = score;
  }

  renderBoard();
  generateNewBlock(); // 다음 블록 소환(게임 사이클 계속)
}

// =============================
// 새 블록 생성 + 중력 타이머 시작
// - fallIntervalMs마다 아래로 1칸씩 이동(moveBlock('top',1))
// - BLOCKS에서 임의 유형 선택 후 (0,3)에서 시작
// =============================
function generateNewBlock(){
  clearInterval(fallTimer); // 기존 타이머 정지(중복 방지)
  fallTimer = setInterval(() => {
    moveBlock("top", 1);    // 아래로 1칸 이동 시도
  }, fallIntervalMs);

  const entries = Object.entries(BLOCKS);           // [['I', shape], ['O', shape], ...]
  const randomIndex = Math.floor(Math.random() * entries.length);

  activePiece.pieceType = entries[randomIndex][0];  // 랜덤 조각 타입 선택
  activePiece.row = 0;                               // 화면 위에서 시작
  activePiece.col = 3;                               // 가운데 근처에서 시작
  activePiece.rotation = 0;                          // 기본 회전 상태

  pendingPiece = { ...activePiece };                 // 임시 상태 동기화
  renderBlocks();                                    // 화면에 그리기
}

// =============================
// 해당 셀이 비어 있는지(존재하고, 아직 고정되지 않았는지) 검사
// =============================
function checkEmpty(row, col){
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return false;
  return boardState[row][col] === null;
}

// =============================
// 현재 조각이 특정 위치에 "놓일 수 있는지" 전부 검사 (하드 드롭 등에서 사용)
// - 모든 칸이 배치 가능해야(true)
// =============================
function canPlace({ pieceType, rotation, row, col }){
  return BLOCKS[pieceType][rotation].every(([blockOffsetX, blockOffsetY]) => {
    const boardCol = col + blockOffsetX;
    const boardRow = row + blockOffsetY;
    return checkEmpty(boardRow, boardCol);
  });
}

// =============================
// 하드 드롭: 가능한 한 아래로 쭉 내린 뒤 즉시 고정
// - 떨어진 칸 수 × 2 점수 보너스(간단 규칙)
// =============================
function hardDrop(){
  if (!activePiece.pieceType) return; // 타입이 없으면 아무 것도 안 함
  clearInterval(fallTimer);            // 하강 타이머 잠시 정지(중복 처리 방지)

  const { pieceType, rotation, col, row } = activePiece;
  let nextRow = row;

  // 바로 아래 칸이 비어 있는 동안 row를 1씩 증가 → 최종 유효 위치 계산
  while (canPlace({ pieceType, rotation, col, row: nextRow + 1 })) {
    nextRow++;
  }

  // 계산된 최종 위치로 이동 후 렌더 → 즉시 고정
  pendingPiece = { ...activePiece, row: nextRow };
  renderBlocks();

  const dropped = nextRow - row; // 몇 칸을 한 번에 떨어뜨렸는지
  if (dropped > 0) {
    score += dropped * 2;       // 간단한 하드 드롭 보너스 규칙
    scoreEl.innerText = score;
  }
  seizeBlock();                 // 고정 → 줄 검사 → 새 블록 순으로 진행
}

// =============================
// 이동/하강 명령: 임시 상태에 먼저 반영 후 렌더 시도
// - axis: 'left' 또는 'top'
// =============================
function moveBlock(axis, amount){
  if (axis === "left") pendingPiece.col += amount;   // 좌/우 이동
  else if (axis === "top") pendingPiece.row += amount; // 하강
  renderBlocks(axis); // 배치 성공 시 확정, 실패 시 롤백
}

// =============================
// 회전: 0→1→2→3→0 순환
// =============================
function changeDirection(){
  const r = pendingPiece.rotation;
  pendingPiece.rotation = (r === 3) ? 0 : r + 1;
  renderBlocks();
}

// =============================
// 소프트 드롭: 하강 속도를 10ms 주기로 잠시 빠르게
// =============================
function dropBlock(){
  clearInterval(fallTimer);
  fallTimer = setInterval(() => {
    moveBlock('top', 1);
  }, 10);
}

// =============================
// 키보드 입력 처리
// - 화살표 좌/우/하, 위(회전), 스페이스(하드 드롭)
// =============================
document.addEventListener("keydown", e => {
  switch (e.key) {
    case "ArrowRight":
      moveBlock("left", 1);   // 오른쪽 한 칸
      break;
    case "ArrowLeft":
      moveBlock("left", -1);  // 왼쪽 한 칸
      break;
    case "ArrowDown":
      moveBlock("top", 1);    // 아래로 한 칸(소프트 드롭)
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
function showGameOver(){
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
