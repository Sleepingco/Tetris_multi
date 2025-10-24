10월 20일

⸻

한눈에 비교

구분	이전(DOM 기반)	지금(배열 기반)	왜 좋은가
데이터의 주인	DOM 셀에 붙은 클래스( .moving, .seized )가 곧 데이터	boardState[y][x] 2차원 배열이 데이터	빠르고 단순, 테스트/멀티/AI에 유리
충돌/배치 판정	셀 DOM을 찾아가 “비었는지” 확인	checkEmpty()/canPlace()로 배열 값 확인	브라우저 의존 ↓, 성능 ↑
라인 클리어	DOM 줄을 보고 꽉 찼는지 판단	boardState[row].every(...)로 판단, splice/unshift	로직이 명확하고 버그 적음
렌더링 역할	로직+화면이 섞여 있음	renderBoard()가 배열 → 화면만 반영	엔진/뷰 분리로 가독성 ↑
상태 저장 위치	화면(DOM)에 흩어져 있음	하나의 소스(boardState)로 일원화	직렬화/네트워크/AI 처리 쉬움
확장성	멀티/AI/테스트가 어려움	결정성(같은 입력=같은 결과) 확보 쉬움	리플레이/멀티/AI에 최적


⸻

코드에서 달라진 핵심 포인트

1) “보드 = 배열” 도입

let boardState // 2차원 배열
function createEmptyBoard(){
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null))
}

	•	예전엔 “어떤 셀이 비었나?”를 DOM에서 찾았지만
→ 지금은 boardState[y][x]가 진실이야.

2) 고정(착지) 로직이 배열을 채움

function seizeBlock(){
  BLOCKS[pieceType][rotation].forEach(([dx, dy]) => {
    boardState[row + dy][col + dx] = pieceType
  })
  renderBoard()
  checkMatch()
}

	•	예전: .moving → .seized 같은 클래스 토글이 곧 상태
	•	지금: 배열에 기입 → 그걸 화면에 그려줌(render)

3) 라인 클리어가 “배열 기준”

function checkMatch(){
  for (let r = boardState.length - 1; r >= 0; r--) {
    const full = boardState[r].every(cell => cell !== null)
    if (full) {
      boardState.splice(r, 1)
      boardState.unshift(Array(COLS).fill(null))
      clearedLines++
    }
  }
}

	•	예전: DOM 줄을 훑으며 꽉 찼나 확인
	•	지금: 배열 한 줄이 전부 null이 아닌지만 보면 끝 → 명확하고 빠름

4) 화면은 “결과만” 그린다

function renderBoard(){
  // 1) boardState에 맞춰 .seized 칠하기
  // 2) activePiece 기준으로 .moving 칠하기
}

	•	예전: 렌더링 중에 판정도 같이 하곤 함(섞임)
	•	지금: 판정(엔진) ↔ 렌더(뷰) 역할이 깔끔히 나뉨

5) 판정 함수가 배열만 본다

function checkEmpty(row, col){
  if (col<0 || col>=COLS || row<0 || row>=ROWS) return false
  return boardState[row][col] === null
}

function canPlace({ pieceType, rotation, row, col }){
  return BLOCKS[pieceType][rotation].every(([dx, dy]) =>
    checkEmpty(row + dy, col + dx)
  )
}

	•	예전: DOM 트리를 타고 셀을 찾아가 비었는지 체크
	•	지금: 배열 값만 검사 → 테스트/해석이 쉬움

⸻

왜 학습/확장에 유리한가 (체감 포인트)
	•	테스트 쉬움: 브라우저 없이도 boardState만 주고 함수 테스트 가능
	•	성능/안정성: DOM 접근(느림) 대신 배열 접근(빠름) → 프레임 드랍 줄어듦
	•	결정성: 같은 입력이면 결과가 항상 같음 → 멀티/AI/리플레이 가능
	•	가독성: “데이터는 여기, 렌더는 저기”가 명확 → 디버깅 쉬움

⸻

스스로 점검해보는 체크리스트
	•	콘솔에서 boardState 찍었을 때, 고정 블록이 제대로 기록되나?
	•	줄을 채우면 boardState가 splice/unshift로 정확히 변하나?
	•	renderBoard()가 boardState만 보고 화면을 그리나? (DOM에서 상태를 읽지 않는가)
	•	canPlace가 DOM 대신 boardState만 이용하나?

⸻

 좋아! 지금 코드에서 바뀐 핵심을 아주 쉽게 풀어서 설명할게.
한 줄 요약: “블록이 윗쪽(화면 밖) 에 조금 걸쳐도 바로 게임오버가 안 나게 만들었어.”

⸻

1) 스폰 위치를 상수로 고정

const SPAWN_ROW = -1  // 위로 한 칸 숨겨서 등장
const SPAWN_COL = 3   // 가운데쯤에서 등장

	•	새 블록이 화면 위(-1행) 에서 살짝 숨겨진 채 시작해.
	•	그래서 위가 조금 막혀 있어도 즉사하지 않고 내려올 기회를 줘.

⸻

2) “윗공간은 빈칸 취급”

function checkEmpty(row, col){
  if (col < 0 || col >= COLS || row >= ROWS) return false
  if (row < 0) return true   // 화면 위쪽은 비어있는 것으로 본다
  return boardState[row][col] === null
}

	•	row < 0(화면 위)는 충돌로 보지 않음 → 회전/이동도 가능해짐.
	•	결과: 스폰 직후 “머리 부분이 위에 걸쳐도” 충돌 판정이 안 나서 한두 수 더 플레이 가능.

⸻

3) 새 블록을 뽑는 방법 정리

const PIECE_TYPES = Object.keys(BLOCKS)
const rand = Math.floor(Math.random() * PIECE_TYPES.length)
activePiece.pieceType = PIECE_TYPES[rand]
activePiece.row = SPAWN_ROW
activePiece.col = SPAWN_COL
activePiece.rotation = 0

	•	블록 뽑기/배치 코드가 한 군데 상수(SPAWN_ROW/COL)로 통일되어 깔끔해졌어.
	•	동작은 같지만, 읽고 바꾸기 쉬워진 것이 포인트.

⸻

4) 게임오버는 언제?

renderBlocks("retry") 단계(스폰 직후 재확인)에서 그 위치에 블록을 놓을 수 없으면 게임오버가 돼.
	•	이번 변경으로 row<0은 빈칸 취급이라 조금 막혀 있어도 바로 오버가 안 나고,
완전히 막혀 있으면 여전히 게임오버가 나.

더 관대하게 하려면?
	•	스폰이 막히면 스폰 킥(살짝 위/좌/우로 밀어보기) 시도
	•	락될 때(바닥에 고정될 때) 블록 일부가 화면 밖이면 그때 게임오버 처리
→ 현대 테트리스의 “top-out” 규칙에 가까움

⸻

5) 화면 그리기(renderBoard)는 “결과만 반영”
	•	boardState(배열)에 적힌 걸 보고 고정 블록 칠함 → .seized
	•	activePiece(현재 조각)는 움직이는 모양만 칠함 → .moving
	•	즉, 판정(배열)과 그리기(DOM) 를 분리해서 더 이해/수정이 쉬워졌어.

⸻

6) 이렇게 테스트 해보면 끝!
	1.	최상단까지 쌓기 → 새 블록 소환
	•	예전: 바로 게임오버
	•	지금: 한두 수는 더 진행(윗공간 허용 덕분)
	2.	스폰 직후 회전/이동 시도
	•	막히지 않고 동작해야 정상
	3.	완전 봉쇄(윗공간까지 다 막힘) 상황
	•	여전히 게임오버가 나야 정상

⸻

머릿속 그림(아주 간단)

화면 위(보이지 않음)  ← row = -1  :  지금은 '빈칸'으로 본다 ✅
───────────────
보이는 보드 시작     ← row = 0

이 정도만 기억하면 돼:
	•	SPAWN_ROW = -1: 위에서 살짝 시작
	•	row<0는 빈칸: 스폰/회전이 부드러워짐
	•	완전 막히면 여전히 게임오버

엔진/렌더 분리 시작: boardState 관련 순수 로직을 src/js/engine/board.js로 떼어내서 tetris.js는 DOM 렌더링에 집중할 수 있게 됐어요.
상태 관리 명확화: shiftActivePiece 같은 이름으로 이동 로직을 정리하고, 다음 블록 미리보기 렌더를 별도 함수로 분리해 흐름을 따라가기 쉬워졌습니다.
설정 중앙화: 보드 크기, 스폰 위치, 하강 주기 등 하드코딩된 상수를 src/js/config.js에서 통합 관리하도록 바꿔 모드 전환이나 난이도 조정이 간편해졌습니다.
UI 진척: 싱글 페이지 레이아웃과 Next 미리보기 패널을 추가해 이후 홀드/멀티플레이 확장에 필요한 UI 기반을 마련했습니다.

문제: 동시에 두 줄 이상이 가득 찼을 때 한 줄만 비워지고 나머지는 남아 있었습니다. 실제 동작에서는 한 줄을 splice로 제거한 뒤 unshift로 새 줄을 넣으면서 루프 인덱스가 계속 감소해, 바로 위 줄을 다시 검사하지 못한 것이 원인이었습니다.
수정: src/js/engine/board.js:27에서 줄을 삭제했을 때 row++을 추가하여 같은 인덱스를 다시 검사하도록 했습니다. 이제 두 줄 이상이 한 번에 채워지면 모두 제거되고 각 줄마다 점수가 정상적으로 반영됩니다.

 ---

중간 기록 게임 구조:
엔진 흐름

src/js/config.js:5가 보드 크기, 스폰 위치, 중력 주기 같은 공통 설정을 제공하고, 모든 모드가 이 값을 공유합니다.
src/js/engine/board.js:1은 순수 로직만 담당합니다. 2D 배열 보드 생성, 충돌 판정(canPlacePiece), 착지 시 배열에 기록(lockPieceOnBoard), 꽉 찬 줄 삭제(clearFilledLines) 등을 DOM과 분리해두었습니다.
이동 결과 판단은 src/js/engine/step.js:1에서 합니다. resolveMoveAttempt가 현재 보드와 임시 조각을 보고 ok/lock/retry/gameOver 중 하나를 반환해, 상위 레이어는 DOM 없이도 엔진 결과를 받아 처리할 수 있습니다.
게임 상태

src/js/tetris.js:34에 DOM 참조(보드 <ul>, 점수, 재시작 버튼 등)와 엔진 상태(점수, 중력 타이머, boardState, activePiece, pendingPiece, 다음 조각)가 모여 있고, init()이 이 상태를 초기화합니다 (src/js/tetris.js:109).
pendingPiece는 이동/회전을 “시도”하는 값이고, 엔진 결과가 ok일 때만 activePiece에 확정됩니다. 이 분리 덕분에 충돌 시 롤백이 쉬워요.
게임 루프

generateNewBlock(src/js/tetris.js:237)이 다음 조각을 활성화하고, 중력 인터벌이 shiftActivePiece(1, 0, "top")을 주기적으로 호출해 자동 하강합니다.
resolveMoveAttempt의 반환값에 따라 seizeBlock(착지 후 배열 기록), renderBlocks("retry")(스폰 충돌 재확인), showGameOver가 결정됩니다 (src/js/tetris.js:210).
시각적인 렌더링은 renderBoard(src/js/tetris.js:203) 한 곳에서 처리합니다. 보드 배열을 읽어 .seized를 칠하고, 현재 조각(activePiece)은 .moving으로 덧칠하기 때문에 엔진과 뷰가 자연스럽게 분리됩니다.
입력 및 UI

키 입력은 document.addEventListener("keydown")(src/js/tetris.js:350)에서 받아 shiftActivePiece 또는 changeDirection, hardDrop을 호출합니다.
Next 미리보기는 buildNextPreview로 4×4 그리드를 만들고(src/js/tetris.js:62), renderNextPiece가 BLOCKS 데이터의 0번 회전을 사용해 박스를 채웁니다 (src/js/tetris.js:268).
두 줄 이상 동시에 채워졌을 때 모두 제거되도록 clearFilledLines가 줄 삭제 후 인덱스를 한 번 되돌려(src/js/engine/board.js:27) 연속 줄 검사를 수행합니다.
이 구조 덕분에 보드 상태는 항상 배열 한 곳에 모이고, 렌더링/입력은 이 상태를 참조만 하므로 이후 step 기반 루프나 멀티플레이 동기화로 확장하기 용이합니다.

# 10월 24일