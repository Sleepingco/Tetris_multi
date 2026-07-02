# 2025년 10월 20일

---

## 한눈에 비교

| 구분           | 이전(DOM 기반)                         | 지금(배열 기반)                          | 왜 좋은가                              |
| -------------- | ------------------------------------ | -------------------------------------- | ------------------------------------ |
| 데이터의 주인  | DOM 셀에 붙은 클래스( .moving, .seized )가 곧 데이터 | boardState[y][x] 2차원 배열이 데이터    | 빠르고 단순, 테스트/멀티/AI에 유리     |
| 충돌/배치 판정 | 셀 DOM을 찾아가 “비었는지” 확인        | checkEmpty()/canPlace()로 배열 값 확인   | 브라우저 의존 ↓, 성능 ↑                |
| 라인 클리어    | DOM 줄을 보고 꽉 찼는지 판단           | boardState[row].every(...)로 판단, splice/unshift | 로직이 명확하고 버그 적음              |
| 렌더링 역할    | 로직+화면이 섞여 있음                  | renderBoard()가 배열 → 화면만 반영       | 엔진/뷰 분리로 가독성 ↑                |
| 상태 저장 위치 | 화면(DOM)에 흩어져 있음                 | 하나의 소스(boardState)로 일원화          | 직렬화/네트워크/AI 처리 쉬움            |
| 확장성         | 멀티/AI/테스트가 어려움                 | 결정성(같은 입력=같은 결과) 확보 쉬움     | 리플레이/멀티/AI에 최적                 |

---

## 코드에서 달라진 핵심 포인트

### 1) “보드 = 배열” 도입

```js
let boardState // 2차원 배열
function createEmptyBoard(){
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null))
}
```

- 예전엔 “어떤 셀이 비었나?”를 DOM에서 찾았지만  
→ 지금은 boardState[y][x]가 진실이야.

### 2) 고정(착지) 로직이 배열을 채움

```js
function seizeBlock(){
  BLOCKS[pieceType][rotation].forEach(([dx, dy]) => {
    boardState[row + dy][col + dx] = pieceType
  })
  renderBoard()
  checkMatch()
}
```

- 예전: .moving → .seized 같은 클래스 토글이 곧 상태  
- 지금: 배열에 기입 → 그걸 화면에 그려줌(render)

### 3) 라인 클리어가 “배열 기준”

```js
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
```

- 예전: DOM 줄을 훑으며 꽉 찼나 확인  
- 지금: 배열 한 줄이 전부 null이 아닌지만 보면 끝 → 명확하고 빠름

### 4) 화면은 “결과만” 그린다

```js
function renderBoard(){
  // 1) boardState에 맞춰 .seized 칠하기
  // 2) activePiece 기준으로 .moving 칠하기
}
```

- 예전: 렌더링 중에 판정도 같이 하곤 함(섞임)  
- 지금: 판정(엔진) ↔ 렌더(뷰) 역할이 깔끔히 나뉨

### 5) 판정 함수가 배열만 본다

```js
function checkEmpty(row, col){
  if (col<0 || col>=COLS || row<0 || row>=ROWS) return false
  return boardState[row][col] === null
}

function canPlace({ pieceType, rotation, row, col }){
  return BLOCKS[pieceType][rotation].every(([dx, dy]) =>
    checkEmpty(row + dy, col + dx)
  )
}
```

- 예전: DOM 트리를 타고 셀을 찾아가 비었는지 체크  
- 지금: 배열 값만 검사 → 테스트/해석이 쉬움

---

## 왜 학습/확장에 유리한가 (체감 포인트)

- 테스트 쉬움: 브라우저 없이도 boardState만 주고 함수 테스트 가능  
- 성능/안정성: DOM 접근(느림) 대신 배열 접근(빠름) → 프레임 드랍 줄어듦  
- 결정성: 같은 입력이면 결과가 항상 같음 → 멀티/AI/리플레이 가능  
- 가독성: “데이터는 여기, 렌더는 저기”가 명확 → 디버깅 쉬움

---

## 스스로 점검해보는 체크리스트

- 콘솔에서 boardState 찍었을 때, 고정 블록이 제대로 기록되나?  
- 줄을 채우면 boardState가 splice/unshift로 정확히 변하나?  
- renderBoard()가 boardState만 보고 화면을 그리나? (DOM에서 상태를 읽지 않는가)  
- canPlace가 DOM 대신 boardState만 이용하나?

---

## 이전 DOM 직접 조작 버전과 지금 배열 기반 버전의 핵심 차이는 다음과 같아요.

- **보드 상태 저장 방식:**  
  과거에는 `.playground > ul`의 각 `<li>`에 클래스(`.moving`, `.seized`)를 붙여 놓고 DOM 자체가 곧 상태였어요. 지금은 `boardState[row][col]` 배열에 고정 블록 타입을 기록하고, 렌더링 시점에만 해당 값을 DOM 셀(`boardCells[row][col]`)에 반영합니다.

- **충돌/이동 판정:**  
  예전에는 원하는 좌표의 DOM 노드를 찾아 `classList.contains("seized")`로 막혀 있는지 확인했죠. 현재는 배열 값이 `null`인지로 바로 판단하고, `row < 0`도 허용해 스폰·회전 시 일부가 화면 밖에 걸쳐도 됩니다(`checkEmpty`).

- **라인 클리어 처리:**  
  기존에는 꽉 찬 `<li>`를 제거하고 맨 위에 새 `<li>`를 prepend하는 식이었는데, 지금은 배열에서 해당 행을 `splice`/`unshift`로 교체하고 한 번에 `renderBoard()`로 DOM을 갱신합니다.

- **렌더링 분리:**  
  이전 로직은 이동/회전 함수가 곧 DOM 조작이었고, 클래스 정리도 같은 곳에서 했습니다. 이제는 `renderBlocks`가 위치 검증만 하고, 확정된 상태는 `renderBoard`가 DOM과 싱크를 맞춰요. 이는 테스트나 추후 네트워크 전송 시 배열만 다루면 되도록 로직과 표현을 분리한 겁니다.

- **초기 스폰 위치:**  
  과거에는 `(row=0, col=3)`에서 시작해서 화면 밖을 허용하지 않았지만, 현재는 `SPAWN_ROW = -1`로 설정돼 있어 테트리스처럼 윗부분이 잠시 숨겨진 상태로 등장합니다.

요약하면, 이전 코드는 DOM을 상태 저장소로 삼고 즉시 조작하는 구조였고, 현재 코드는 배열이 게임 로직의 단일 진실 원천(Single Source of Truth)이 되며 DOM은 렌더링 용도로만 쓰입니다.

---

## State Initialization

- `createEmptyBoard()`는 20×10 배열을 `null`로 채워 반환하여 로직이 오직 JavaScript 데이터에서만 작동하도록 합니다 (`src/js/tetris.js` (lines 48-50)).  
  이전 버전은 `prependNewLine()`으로 `<li>`를 만들어 DOM 클래스 자체에 상태를 저장했습니다.

- `buildBoard()`는 한 번만 전체 DOM 셀을 만들어 `boardCells[row][col]`에 캐시합니다 (`src/js/tetris.js` (lines 55-74)).  
  과거에는 매 스폰/라인 클리어마다 DOM 노드를 추가·삭제했죠.

---

## Active Piece & Spawn

- `activePiece`와 `pendingPiece`는 배열 좌표를 기준으로 동작하며 스폰 시 `row = -1`을 활용해 화면 밖 일부를 허용합니다 (`src/js/tetris.js` (lines 35-47)).  
  DOM 버전은 `row = 0`에서 시작해서 위쪽 충돌이 즉시 발생했습니다.

---

## Collision & Movement

- `checkEmpty(row, col)`이 배열 경계를 검사하고 `row < 0`은 통과시켜 스폰 여유를 줍니다 (`src/js/tetris.js` (lines 240-243)).  
  이전에는 DOM 셀을 찾아 `classList.contains("seized")`로 판정했기 때문에 화면 밖 좌표를 다루기 힘들었습니다.

- `canPlace()`가 블록의 상대 좌표를 순회하면서 모두 배열상 비어 있는지를 계산합니다 (`src/js/tetris.js` (lines 249-254)).  
  DOM 시절에는 `boardEl.childNodes[row]`처럼 트리 탐색을 반복했어요.

---

## Locking & Line Clears

- `seizeBlock()`은 충돌이 확정된 블록 좌표를 돌면서 `boardState[row][col] = pieceType`으로 기록하고, 렌더링은 별도 단계로 넘깁니다 (`src/js/tetris.js` (lines 138-151)).

- `checkMatch()`는 배열 행을 뒤에서 앞으로 훑어 `splice`/`unshift`로 한 번에 밀어 올립니다 (`src/js/tetris.js` (lines 161-179)).  
  기존 구현은 DOM 행을 `remove()`하고 `prependNewLine()`을 호출했습니다.

---

## Rendering

- `renderBoard()`가 단일 진실 원천(`boardState`, `activePiece`)을 이용해 DOM 클래스를 재설정합니다 (`src/js/tetris.js` (lines 185-212)).  
  먼저 모든 셀에서 `.moving`, `.seized`, 타입 클래스를 제거한 뒤 고정 블록을 그리고, 마지막에 활성 조각을 덧입힙니다.  
  이전에는 이동 함수가 DOM 클래스를 직접 제거·추가했습니다.

---

## Game Loop

- `renderBlocks()`는 이동 시도 → 배열 충돌 검사 → 성공 시 `activePiece` 갱신 → `renderBoard()` 호출 순으로 명확히 분리되었습니다 (`src/js/tetris.js` (lines 101-132)).  
  DOM 버전은 이 함수 안에서 바로 DOM 조작과 클래스 롤백을 수행했습니다.

- 하강 타이머, 하드드롭, 이동, 회전 로직(`moveBlock`, `hardDrop`, `changeDirection`)은 같은 인터페이스를 유지하지만 내부적으로 `canPlace()`와 배열 좌표를 사용합니다 (`src/js/tetris.js` (lines 261-301)).

---

## 좋아! 지금 코드에서 바뀐 핵심을 아주 쉽게 풀어서 설명할게.

### 한 줄 요약: “블록이 윗쪽(화면 밖) 에 조금 걸쳐도 바로 게임오버가 안 나게 만들었어.”

---

### 1) 스폰 위치를 상수로 고정

```js
const SPAWN_ROW = -1  // 위로 한 칸 숨겨서 등장
const SPAWN_COL = 3   // 가운데쯤에서 등장
```

- 새 블록이 화면 위(-1행) 에서 살짝 숨겨진 채 시작해.  
- 그래서 위가 조금 막혀 있어도 즉사하지 않고 내려올 기회를 줘.

---

### 2) “윗공간은 빈칸 취급”

```js
function checkEmpty(row, col){
  if (col < 0 || col >= COLS || row >= ROWS) return false
  if (row < 0) return true   // 화면 위쪽은 비어있는 것으로 본다
  return boardState[row][col] === null
}
```

- `row < 0`(화면 위)는 충돌로 보지 않음 → 회전/이동도 가능해짐.  
- 결과: 스폰 직후 “머리 부분이 위에 걸쳐도” 충돌 판정이 안 나서 한두 수 더 플레이 가능.

---

### 3) 새 블록을 뽑는 방법 정리

```js
const PIECE_TYPES = Object.keys(BLOCKS)
const rand = Math.floor(Math.random() * PIECE_TYPES.length)
activePiece.pieceType = PIECE_TYPES[rand]
activePiece.row = SPAWN_ROW
activePiece.col = SPAWN_COL
activePiece.rotation = 0
```

- 블록 뽑기/배치 코드가 한 군데 상수(`SPAWN_ROW`/`COL`)로 통일되어 깔끔해졌어.  
- 동작은 같지만, 읽고 바꾸기 쉬워진 것이 포인트.

---

### 4) 게임오버는 언제?

- `renderBlocks("retry")` 단계(스폰 직후 재확인)에서 그 위치에 블록을 놓을 수 없으면 게임오버가 돼.  
- 이번 변경으로 `row<0`은 빈칸 취급이라 조금 막혀 있어도 바로 오버가 안 나고, 완전히 막혀 있으면 여전히 게임오버가 나.

더 관대하게 하려면?  
- 스폰이 막히면 스폰 킥(살짝 위/좌/우로 밀어보기) 시도  
- 락될 때(바닥에 고정될 때) 블록 일부가 화면 밖이면 그때 게임오버 처리  
→ 현대 테트리스의 “top-out” 규칙에 가까움

---

### 5) 화면 그리기(renderBoard)는 “결과만 반영”

- `boardState`(배열)에 적힌 걸 보고 고정 블록 칠함 → `.seized`  
- `activePiece`(현재 조각)는 움직이는 모양만 칠함 → `.moving`  
- 즉, 판정(배열)과 그리기(DOM) 를 분리해서 더 이해/수정이 쉬워졌어.

---

### 6) 이렇게 테스트 해보면 끝!

1. 최상단까지 쌓기 → 새 블록 소환  
   - 예전: 바로 게임오버  
   - 지금: 한두 수는 더 진행(윗공간 허용 덕분)  
2. 스폰 직후 회전/이동 시도  
   - 막히지 않고 동작해야 정상  
3. 완전 봉쇄(윗공간까지 다 막힘) 상황  
   - 여전히 게임오버가 나야 정상

---

## 머릿속 그림(아주 간단)

```
화면 위(보이지 않음)  ← row = -1  :  지금은 '빈칸'으로 본다 ✅
───────────────
보이는 보드 시작     ← row = 0
```

이 정도만 기억하면 돼:  
- `SPAWN_ROW = -1`: 위에서 살짝 시작  
- `row<0`는 빈칸: 스폰/회전이 부드러워짐  
- 완전 막히면 여전히 게임오버

---

## 엔진/렌더 분리 시작

- `boardState` 관련 순수 로직을 `src/js/engine/board.js`로 떼어내서 `tetris.js`는 DOM 렌더링에 집중할 수 있게 됐어요.

## 상태 관리 명확화

- `shiftActivePiece` 같은 이름으로 이동 로직을 정리하고, 다음 블록 미리보기 렌더를 별도 함수로 분리해 흐름을 따라가기 쉬워졌습니다.

## 설정 중앙화

- 보드 크기, 스폰 위치, 하강 주기 등 하드코딩된 상수를 `src/js/config.js`에서 통합 관리하도록 바꿔 모드 전환이나 난이도 조정이 간편해졌습니다.

## UI 진척

- 싱글 페이지 레이아웃과 Next 미리보기 패널을 추가해 이후 홀드/멀티플레이 확장에 필요한 UI 기반을 마련했습니다.

---

## 문제

- 동시에 두 줄 이상이 가득 찼을 때 한 줄만 비워지고 나머지는 남아 있었습니다.  
- 실제 동작에서는 한 줄을 `splice`로 제거한 뒤 `unshift`로 새 줄을 넣으면서 루프 인덱스가 계속 감소해, 바로 위 줄을 다시 검사하지 못한 것이 원인이었습니다.

## 수정

- `src/js/engine/board.js:27`에서 줄을 삭제했을 때 `row++`을 추가하여 같은 인덱스를 다시 검사하도록 했습니다.  
- 이제 두 줄 이상이 한 번에 채워지면 모두 제거되고 각 줄마다 점수가 정상적으로 반영됩니다.

---

## 중간 기록 게임 구조:

### 엔진 흐름

- `src/js/config.js:5`가 보드 크기, 스폰 위치, 중력 주기 같은 공통 설정을 제공하고, 모든 모드가 이 값을 공유합니다.  
- `src/js/engine/board.js:1`은 순수 로직만 담당합니다. 2D 배열 보드 생성, 충돌 판정(`canPlacePiece`), 착지 시 배열에 기록(`lockPieceOnBoard`), 꽉 찬 줄 삭제(`clearFilledLines`) 등을 DOM과 분리해두었습니다.  
- 이동 결과 판단은 `src/js/engine/step.js:1`에서 합니다. `resolveMoveAttempt`가 현재 보드와 임시 조각을 보고 `ok`/`lock`/`retry`/`gameOver` 중 하나를 반환해, 상위 레이어는 DOM 없이도 엔진 결과를 받아 처리할 수 있습니다.

### 게임 상태

- `src/js/tetris.js:34`에 DOM 참조(보드 `<ul>`, 점수, 재시작 버튼 등)와 엔진 상태(점수, 중력 타이머, `boardState`, `activePiece`, `pendingPiece`, 다음 조각)가 모여 있고, `init()`이 이 상태를 초기화합니다 (`src/js/tetris.js:109`).  
- `pendingPiece`는 이동/회전을 “시도”하는 값이고, 엔진 결과가 `ok`일 때만 `activePiece`에 확정됩니다. 이 분리 덕분에 충돌 시 롤백이 쉬워요.

### 게임 루프

- `generateNewBlock`(`src/js/tetris.js:237`)이 다음 조각을 활성화하고, 중력 인터벌이 `shiftActivePiece(1, 0, "top")`을 주기적으로 호출해 자동 하강합니다.  
- `resolveMoveAttempt`의 반환값에 따라 `seizeBlock`(착지 후 배열 기록), `renderBlocks("retry")`(스폰 충돌 재확인), `showGameOver`가 결정됩니다 (`src/js/tetris.js:210`).  
- 시각적인 렌더링은 `renderBoard`(`src/js/tetris.js:203`) 한 곳에서 처리합니다. 보드 배열을 읽어 `.seized`를 칠하고, 현재 조각(`activePiece`)은 `.moving`으로 덧칠하기 때문에 엔진과 뷰가 자연스럽게 분리됩니다.

### 입력 및 UI

- 키 입력은 `document.addEventListener("keydown")`(`src/js/tetris.js:350`)에서 받아 `shiftActivePiece` 또는 `changeDirection`, `hardDrop`을 호출합니다.  
- Next 미리보기는 `buildNextPreview`로 4×4 그리드를 만들고(`src/js/tetris.js:62`), `renderNextPiece`가 `BLOCKS` 데이터의 0번 회전을 사용해 박스를 채웁니다 (`src/js/tetris.js:268`).  
- 두 줄 이상 동시에 채워졌을 때 모두 제거되도록 `clearFilledLines`가 줄 삭제 후 인덱스를 한 번 되돌려(`src/js/engine/board.js:27`) 연속 줄 검사를 수행합니다.

이 구조 덕분에 보드 상태는 항상 배열 한 곳에 모이고, 렌더링/입력은 이 상태를 참조만 하므로 이후 step 기반 루프나 멀티플레이 동기화로 확장하기 용이합니다.

---

# 2025년 10월 24일

## 엔진 정리

- 런타임 데이터를 전역 변수 대신 `gameState` 객체 하나에 묶어 놨어요 (`src/js/tetris.js:42`).  
  점수·타이머·보드·조각 상태가 한 곳에 모여서 이후 멀티플레이나 AI 직렬화가 훨씬 간단해졌습니다.

- `setActivePiece`를 도입하고 `renderBlocks`가 `resolveMoveAttempt` 결과(`ok`/`lock`/`retry`/`gameOver`)를 해석하도록 재구성했습니다 (`src/js/tetris.js:132-185`).  
  중복되던 활성 조각 대입 코드가 사라지고, DOM 갱신 지점이 명확해졌어요.

- `shiftActivePiece`는 오직 임시 조각 좌표만 수정하고, 실제 렌더 호출은 호출자가 담당하도록 분리했습니다 (`src/js/tetris.js:354-401`).  
  덕분에 “입력 → 엔진 → 뷰” 흐름이 자연스럽게 읽힙니다.

- 이동 판정을 전담하는 엔진 모듈 `resolveMoveAttempt`를 추가해 (`src/js/engine/step.js:1`), DOM 없이도 이동 결과를 테스트하거나 재사용할 수 있게 했습니다.

---

## 다음으로 확인할 것

- 브라우저에서 `src/html/tetrisSingle.html`을 실행해 좌우 이동·소프트/하드 드롭·라인 클리어·게임 오버가 모두 정상 동작하는지 점검해 주세요.  
- 앞으로 홀드나 멀티플레이 동기화를 구현할 때는 이제 `gameState` 객체만 넘기면 되므로, 상태 관리와 직렬화가 한층 수월해질 것입니다.

# 2025년 12월 5일
오늘 작업 정리

src/js/sound.js 신규 모듈 도입: 로비/게임 BGM, 라인클리어 SFX, 사운드 토글 상태(localStorage) 관리. initLobbySound, initGameSound, tryPlayMusic, playLineClearSfx 제공.
사운드 통합:
src/html/index.html: 인라인 사운드 로직 제거, 모듈 import로 로비 BGM+토글 초기화.
src/js/tetris.js: 사운드 코드 제거 후 모듈 사용으로 교체, 키 입력 시 BGM 재생 시도.
src/html/tetrisSingle.html: 헤더에 사운드 토글 버튼(스타일 적용) 유지, 홈 이동 버튼 추가.
UI/스타일:
src/css/tetris.css: 사운드 토글/홈 버튼 스타일 추가, 보드 컨테이너 overflow: visible로 변경(이펙트 표시용).
라인 클리어 이펙트:
src/js/tetris.js: 가득 찬 줄 탐지 후 line-clear 클래스 부여 → 일정 시간 뒤 삭제/점수/새 블록 소환. findFullRows, addLineClearEffect 추가. seizeBlock에서 pendingPiece 초기화로 다음 블록 스폰 문제 해결.
src/css/tetris.css: lineClearFlash 애니메이션으로 흰색 플래시+스케일/블러 후 위로 사라지는 연출 추가.

---

# 2026년 2월 4일
최근 변경 사항 정리

## 기능 추가
- **다음 블록 2개 미리보기 + 큐 도입**  
  `pieceQueue`를 사용해 스폰 순서를 관리하고, 4x4 프리뷰 2개를 표시하도록 변경했습니다. (`src/game/tetris.js`)

- **홀드 기능 추가**  
  `C`(또는 Shift)로 현재 블록을 홀드하고, 턴당 1회 제한(`holdUsedThisDrop`)을 적용했습니다.  
  홀드/교환 시 스폰 위치로 리셋하고 미리보기 UI를 갱신합니다. (`src/game/tetris.js`, `src/pages/tetrisSingle.html`)

- **스폰 유예 로직 유지/정리**  
  스폰 즉시 충돌 시 `SPAWN_GRACE_MS` 동안 유예 후 게임오버 처리 흐름 유지. (`src/game/tetris.js`)

## 블록 정의 수정
- **L/J 회전 정의 보정**  
  4방향 회전이 중복되지 않도록 L/J 블록 좌표를 수정했습니다. (`src/game/blocks.js`)

- **S 블록 추가**  
  `ess` 조각을 추가하고 4회전 좌표를 정의했습니다. (`src/game/blocks.js`)

## UI/문서
- **홀드 UI 추가, 컨트롤 안내 갱신**  
  `Hold` 영역 추가 및 `C` 홀드 안내 문구 추가. (`src/pages/tetrisSingle.html`)

## 구조 변경(경로 정리)
- `src/js` → `src/game`, `src/js/engine` → `src/core`, `src/html` → `src/pages`, `src/css` → `src/styles`로 경로 구조가 바뀌었습니다.  
  이전 change-log의 경로 표기는 구버전 기준이니 참고 부탁해요.

---

# 2026년 2월 24일
최근 변경 사항 정리

## 구조/리팩토링
- **렌더러 분리(파라미터 주입 방식)**  
  DOM 렌더 관련 함수를 `src/render/tetrisRender.js`로 분리하고, `src/game/tetris.js`는 래퍼를 통해 필요한 상태만 전달하도록 정리했습니다.

- **결정 로직과 실행 로직 분리**  
  이동 시도 결과 해석은 `resolveMoveIntent`(`src/core/step.js`)에서 담당하고, 실제 DOM/타이머 반영은 `applyMoveIntent`(`src/game/tetris.js`)에서 처리하도록 분리했습니다.

## 입력 처리 개선
- **입력 큐 도입**  
  `INPUT_ACTION`, `enqueueInput`, `handleAction`, `drainInputQueue`를 추가해 입력 수집과 실행을 분리했습니다.  
  `keydown`에서는 액션을 큐에 넣고, 입력 루프에서 큐를 소비합니다.

- **입력 루프 추가**  
  `INPUT_TICK_MS`(현재 16ms)를 `src/game/config.js`에 추가하고, `startInputLoop`/`inputTimer`로 빠른 입력 처리 루프를 분리했습니다.

## 루프 수명/상태 관리
- **게임 상태(phase) 추가**  
  `PLAYING`, `SPAWN_GRACE`, `LINE_CLEARING`, `GAME_OVER` 상태를 도입해 입력 허용/차단, 루프 정지/재시작을 명확히 관리합니다.

- **루프 정리 함수 추가**  
  `stopGameLoops`로 `fallTimer`/`inputTimer`를 한 번에 정리하도록 통합했습니다.

## 스폰 유예(spawn grace) 로직 보정
- `spawnBlocked` 시 즉시 게임오버로 가지 않고 `SPAWN_GRACE` 상태로 전환되도록 수정했습니다.  
- 유예 시간 내 유효한 이동(`ok`)이 발생하면 `PLAYING`으로 복귀하고, 유예 시간 만료 시에만 `GAME_OVER`로 전환됩니다.

## 현재 상태 메모
- **캔버스 전환은 아직 미적용** 상태입니다. 현재 메인 보드는 기존 DOM(`<ul>/<li>`) 렌더링을 사용합니다.

---

# 2026년 2월 25일
최근 변경 사항 정리

## 렌더링/뷰
- **메인 보드 캔버스 렌더링 적용 유지**  
  싱글/멀티 페이지 보드 영역을 `<canvas>` 기준으로 사용하고, 메인 렌더는 `renderBoardCanvas` 중심으로 동작합니다. (`src/pages/tetrisSingle.html`, `src/pages/tetrisMulti.html`, `src/game/tetris.js`, `src/render/tetrisRender.js`)

- **겹침 렌더링 방지 보정**  
  고스트/활성 블록을 그릴 때 이미 고정 블록이 있는 칸은 스킵하도록 처리해, 스폰 충돌 상황에서 블록이 시각적으로 겹쳐 보이는 현상을 줄였습니다. (`src/render/tetrisRender.js`)

## 게임 상태/규칙
- **스폰 유예(Spawn Grace) 로직 제거**  
  `SPAWN_GRACE_MS`, `SPAWN_GRACE` phase, `spawnGraceTimer`, 관련 정리 함수를 제거했습니다. (`src/game/tetris.js`)

- **스폰 충돌 시 즉시 게임오버로 단순화**  
  `moveCause === "spawn"` 충돌 시 결과를 즉시 `gameOver`로 반환하도록 변경했습니다. (`src/core/step.js`)

- **입력 허용 조건 단순화**  
  플레이어 입력은 `PLAYING` 상태에서만 처리하도록 정리했습니다. (`src/game/tetris.js`)

## 검증
- 문법 확인: `node --check` 기준 `src/game/tetris.js`, `src/core/step.js`, `src/render/tetrisRender.js` 통과

---

# 2026년 3월 18일
최근 변경 사항 정리

## 구조/리팩토링
- **상태 팩토리 도입**
  `gameState` 초기값 생성을 `createGameState`(`src/game/stateFactory.js`)로 분리했습니다.
  직렬화 가능한 게임 데이터 스키마를 한 곳에서 관리할 수 있게 정리했습니다.

- **runtime 분리**
  `fallTimer`, `inputTimer`, `boardCtx`, `animationFrameId` 같은 실행 환경 전용 값은 `tetris.js` 내부 `runtime` 객체로 옮겼습니다.
  상태 데이터와 런타임 객체를 분리해 멀티플레이/리플레이용 상태 직렬화 준비를 진행했습니다.

- **입력 처리 모듈 분리**
  키보드 입력 매핑과 반복 입력 방지 로직을 `src/game/input.js`로 분리했습니다.
  `tetris.js`는 이제 입력 이벤트를 직접 해석하지 않고, 액션 큐에 들어온 값만 소비합니다.

## 실행 로직 분리
- **이동 결과 실행 분리**
  `applyMoveIntent`를 `src/game/moveExecution.js`로 이동했습니다.
  코어가 계산한 intent를 실제 게임 상태/루프/UI에 반영하는 책임을 별도 모듈로 분리했습니다.

- **스폰/큐/홀드 실행 분리**
  `ensureQueueFilled`, `generateNewBlock`, `holdPiece` 실행 흐름을 `src/game/pieceExecution.js`로 옮겼습니다.
  `tetris.js`에는 얇은 래퍼만 남기고, 큐 관리와 스폰 실행 책임을 분리했습니다.

- **라인 클리어/점수 반영 분리**
  줄 검사 후 점수 갱신과 다음 블록 소환 흐름을 `src/game/lineExecution.js`로 분리했습니다.
  점수 표시 및 게임오버 DOM 조작은 `src/game/ui.js`로 모아 UI 책임을 별도로 정리했습니다.

- **액션 실행 분리**
  `shiftActivePiece`, `changeDirection`, `hardDrop`, `handleAction` 성격의 실행 로직을 `src/game/actionExecution.js`로 이동했습니다.
  입력 액션 처리 책임을 묶어 `tetris.js`를 엔트리/조립 파일에 가깝게 정리했습니다.

## 규칙/상태 보정
- **하드 드롭 판정 일원화**
  `hardDrop` 고정 처리를 `tetris.js`의 직접 고정 호출 방식에서 제거하고, `resolveMoveAttempt`(`src/core/step.js`)가 `moveCause === "hardDrop"`일 때 `lock`을 반환하도록 변경했습니다.
  하드 드롭도 일반 이동과 같은 intent 실행 파이프라인을 타도록 정리했습니다.

- **렌더 파생값(state 오염) 제거**
  `ghostRow`를 `activePiece` 상태에 직접 기록하던 방식을 제거하고, `getRenderableActivePiece()`에서 렌더 직전 계산한 복사 객체로만 넘기도록 변경했습니다.
  authoritative state와 렌더 전용 파생값을 분리했습니다.

## 문서/검증
- `QnA.md`에 최근 질문/답변 주제를 정리해 추가했습니다.
- 문법 확인: `node --check` 기준
  `src/game/tetris.js`,
  `src/core/step.js`,
  `src/game/stateFactory.js`,
  `src/game/input.js`,
  `src/game/moveExecution.js`,
  `src/game/pieceExecution.js`,
  `src/game/lineExecution.js`,
  `src/game/ui.js`,
  `src/game/actionExecution.js`
  통과

---

# 2026년 3월 30일
최근 변경 사항 정리

## 오디오 무중단 재생을 위한 SPA(PJAX) 라우팅 도입
메인 페이지(`index.html`)와 멀티 로비(`multiLobby.html`) 간 이동 시 배경음악(BGM)이 끊기지 않고 자연스럽게 이어지도록 **바닐라 JS 기반의 AJAX 라우터(`src/net/router.js`)**를 도입했습니다.

### 🛠 기능적 변경 사항
- **`src/net/router.js` 신설:** HTML 내의 모든 `<a>` 태그 클릭 이벤트를 가로채고(`preventDefault`), 대상을 `fetch`로 불러와 `<div id="app-content">` 구역만 갈아끼웁니다.
- **히스토리(주소창) 관리:** `history.pushState`와 `popstate` 이벤트를 처리하여 뒤로 가기 및 앞으로 가기가 브라우저 순정 기능처럼 완벽히 동작합니다.
- **스크립트 생명주기 제어:** `innerHTML`로 교체된 DOM 안의 `<script>` 태그는 브라우저 정책상 자동으로 실행되지 않습니다. 이를 마운트하기 위해 라우터 모듈 내부에 `executeScripts()` 함수를 두어, 새로 삽입된 본문의 `<script>` 요소를 동적으로 복제 파싱하여 강제로 재실행되게 만들었습니다.
- **스타일 전역화:** 로비 페이지(`multiLobby.html`) 내부에 존재하던 전용 `<style>` 블록을 전역 체계인 `style.css` 최하단에 편입시켜, AJAX 렌더링 시 간헐적으로 발생할 수 있는 스타일 깜빡임이나 누락을 완벽히 방지했습니다.

### 🧠 왜 이렇게 짰고, 무엇을 배워야 할까? (이론과 아키텍처)
1. **페이지 이동과 자원 소멸의 원리**
   일반적인 MPA(Multi-Page Application) 상에서 다른 HTML로 화면을 넘기면, 브라우저는 이전 문서의 DOM 구조는 물론 힙 메모리에 상주하는 자바스크립트 인스턴스(`Audio`, `WebSocket` 등)를 전부 **가비지 컬렉팅(소멸)** 시킵니다. 따라서 음악이나 웹소켓 연결을 장시간 한 번에 묶어 유지하려면 "실제로 페이지를 엎지 않으면서 본문 데이터만 갈아치우는" **SPA(Single Page Application)** 기법이 필수적입니다.
2. **선택적 라우팅의 미학 (안정성과 생명주기 관리)**
   이 패치의 핵심 목적은 오디오 객체 유지 구역(로비 ↔ 메인)을 묶는 것이었습니다. 하지만 정반대로 `tetris.js`처럼 거대한 `setInterval` 루프와 전역 키보드 이벤트가 얽혀 있는 하드코어한 엔진 모듈을 SPA 내부에서 무작정 스와핑하면 지옥의 메모리 누수와 좀비 이벤트가 발생합니다.
   따라서 `router.js`에는 `href.includes("tetrisSingle.html")`인 경우 강제로 일반(Hard) 이동 동작을 허락해, **브라우저가 기존 메모리를 깔끔하게 전부 사멸시켜주는 기본 동작을 전략적으로 이용**했습니다. (직접 메모리를 닦는 것보다 브라우저에게 청소를 맡기는 것이 구조적으로 훨씬 안전할 때가 있습니다.)
3. **HTML 파싱과 DOM 스와핑의 정수**
   `new DOMParser().parseFromString(html, "text/html")`를 사용해 문자열 형태의 HTML 텍스트를 응답받아 메모리상에 독립된 문서를 구축하고, 필요한 부분(`.querySelector('#app-content')`)만 적출해내는 흐름은, 리액트나 Vue.js와 같은 최신 프론트엔드 프레임워크가 내부적으로 사용하는 스와핑 기법의 태동이 되는 기초 원리입니다. 프레임워크 없이 이를 바닐라 JS로 짜보면 DOM의 렌더링 과정을 온전히 통제하는 직관을 체득할 수 있습니다.

---

# 2026년 4월 3일
최근 변경 사항 정리

## 버그 픽스 (Wall Kick 및 블록 회전 버그 원천 해결)
- **블록 좌표 및 기준점 SRS(Super Rotation System) 표준 탑재**
  `src/game/blocks.js` 내부에 하드코딩 되어있던 J, L, S, T, Z 블록의 2차원 배열 데이터가 표준 SRS의 3x3 Bounding Box(격자) 규격과 정확히 일치하지 않고 각각 좌우로 어긋나 정렬되어 있던 문제를 발견하고 수정했습니다.
- **월킥(Wall Kick) 오작동 방지**
  블록의 회전 중심축이 어긋나면서 Z 블록 등의 넓은 면을 벽에 최대한 밀착시키고 회전시킬 경우, `step.js` 엔진의 시스템이 월킥 보정 좌표점(offset)을 제안했음에도 기준점이 달라 보정치 적용에 실패하는 현상을 완전히 해결했습니다. 이제 모든 블록이 표준 규격에 안착되어 있어 벽에 바짝 붙은 상태에서도 데이터를 정확히 물고 자연스럽게 밀착+회전(킥 동작)이 이루어집니다.

---

# 2026년 4월 3일 (추가)
최근 변경 사항 정리

## 멀티플레이 준비용 시간축 정리
- **입력/중력 이중 인터벌 구조를 단일 tick 흐름으로 정리**
  `src/game/tetris.js`에 `processTick(deltaMs)`를 추가하고, 입력 소비와 자동 하강이 같은 tick 안에서 순서대로 처리되도록 바꿨습니다. 이전처럼 입력 루프와 중력 루프가 각각 상태를 바꾸는 구조를 줄여, 멀티플레이에서 시간축을 맞추기 쉬운 형태로 정리했습니다.

- **입력 큐를 tick-aware 구조로 변경**
  `enqueueInput()`이 단순 문자열 대신 `{ tick, action }` 형태의 명령 객체를 큐에 넣도록 변경했습니다. `drainInputQueue(currentTick)`는 현재 tick 이하의 입력만 처리하고, 미래 tick 입력은 남겨두도록 바꿨습니다. (`src/game/tetris.js`)

## 조각 공급 구조 개선
- **RNG 주입 경로 확보**
  `src/game/pieceExecution.js`의 `pickRandomPiece`, `ensureQueueFilled`, `takeNextFromQueue`, `generateNewBlock`, `holdPiece`가 외부 RNG를 전달받을 수 있도록 수정했습니다. 현재는 임시로 `Math.random`을 주입하지만, 이후 server bag 또는 seed 기반 PRNG로 교체할 수 있는 구조를 열어두었습니다.

## 런타임 팩토리화 시작
- **`createTetrisRuntime(...)` 도입**
  `src/game/tetris.js`가 페이지 로드 시 전역으로 게임 1판을 바로 만드는 구조에서 벗어나, 게임 한 판을 생성하는 `createTetrisRuntime(...)` 팩토리를 export하도록 변경했습니다. `gameState`, `runtime`, `ui`가 이제 팩토리 내부에서 플레이어별로 생성될 수 있는 구조로 이동했습니다.

- **싱글 페이지 부트스트랩 분리**
  싱글 플레이 페이지 연결 책임을 `src/game/singleGamePage.js`로 분리했습니다. DOM query, 사운드 초기화, 키보드 연결, 재시작 버튼 연결은 이제 부트스트랩 파일이 담당하고, `src/game/tetris.js`는 런타임 생성기 역할에 집중합니다. `src/pages/tetrisSingle.html`도 새 부트스트랩 파일을 로드하도록 변경했습니다.

- **멀티 페이지용 런타임 자리 생성**
  `src/game/multiGamePage.js`를 추가해 `src/pages/tetrisMulti.html`에서 `localGame`과 `remoteGame` 두 개의 runtime을 만들 수 있는 최소 구조를 마련했습니다. 현재는 로컬 플레이어만 입력을 받고, 원격 플레이어는 `init({ autoStart: false })`로 빈 보드/UI만 준비하는 단계입니다.

## 현재 의미
- 이번 변경으로 구조가 `싱글 게임 1판 전역 실행`에서 `플레이어별 런타임 생성 가능 구조`로 넘어가기 시작했습니다.
- 아직 네트워크 동기화(`applyAction`, `applySnapshot`, server bag 공급`)는 붙지 않았지만, 멀티플레이 본격 구현을 위한 엔진/페이지 경계가 처음으로 분리되었습니다.

## 검증
- 문법 확인: `node --check` 기준
  `src/game/tetris.js`,
  `src/game/pieceExecution.js`,
  `src/game/singleGamePage.js`,
  `src/game/multiGamePage.js`
  통과

---

# 2026년 4월 6일
추상화 경계 재조정 및 런타임 응집도 강화 (리팩토링 완료)

## 과도한 추상화 및 Props Drilling 해결
- **실행 모듈(Execution) 런타임 본가(`tetris.js`)로 병합**
  파일 분리에 따른 "의존성 노출(Prop Drilling)" 및 콜백 지옥 문제를 해결하기 위해, 조율자(Orchestrator) 역할을 하던 외부 모듈들을 과감히 삭제하고 기능을 모두 `tetris.js`의 `createTetrisRuntime` 스코프 내부로 직관적으로 전면 재흡수했습니다.
  - 삭제된 파일: `src/game/execution/actionExecution.js`
  - 삭제된 파일: `src/game/execution/lineExecution.js`
  - 삭제된 파일: `src/game/execution/moveExecution.js`
  - `pieceExecution.js` 축소: `generateNewBlock`(-> `startNextTurn`으로 개편) 및 `holdPiece`를 `tetris.js` 내부 함수로 이관.

## 모듈 역할의 본질 회복
- **런타임 제어권 회수:** 화면 갱신, 점수 갱신(`checkMatch`), 의도 반영(`applyMoveIntent`), 이동 처리(`handleAction/hardDrop`) 등의 흐름 제어 로직을 런타임(`tetris.js`)으로 일원화했습니다.
- 10개가 넘는 파라미터를 넘기던 인라인 클로저들이 모두 사라졌으며, 코드가 위에서 아래로 물 흐르듯 읽히는 최상의 응집도를 확보했습니다.
- `pieceExecution.js`는 이제 외부 상태나 렌더러에 의존하지 않고 오직 배열의 순서(bag, queue)만 관리하는 독립적이고 안전한 도구 모음(Utility)으로 완전히 탈바꿈했습니다.

---

# 2026년 5월 4일
멀티플레이 구현 전 폴더 책임 경계 정리

## 서버 구조 분리
- **`src/app.js`를 얇은 서버 entry로 변경**
  기존에 Express, HTTP 서버, Socket.IO 이벤트가 한 파일에 섞여 있던 구조에서 벗어나, `src/app.js`는 `src/server/app.js`를 실행하는 진입점 역할만 담당하도록 정리했습니다.

- **`src/server` 폴더 추가**
  Node.js 서버 전용 책임을 `src/server` 아래로 분리했습니다.
  현재는 기존 채팅 서버 동작을 유지하는 범위에서만 분리했으며, 멀티플레이 room/snapshot/bag 구현은 추가하지 않았습니다.
  - `src/server/app.js`: Express/Socket.IO 서버 조립
  - `src/server/chatSocket.js`: 기존 `chatting` Socket.IO 이벤트 처리

## 게임 core 위치 정리
- **`src/core`를 `src/game/core`로 이동**
  보드 생성, 충돌 검사, 고정, 줄 삭제, 이동 판정은 테트리스 게임 내부 도메인에 속하므로 `src/game/core` 아래로 이동했습니다.
  - `src/core/board.js` -> `src/game/core/board.js`
  - `src/core/step.js` -> `src/game/core/step.js`

- **core import 경로 갱신**
  `src/game/runtime/tetris.js`에서 core 모듈을 새 위치 기준으로 import하도록 변경했습니다.
  - `../../core/board.js` -> `../core/board.js`
  - `../../core/step.js` -> `../core/step.js`

## 구조 문서 갱신
- **`AGENTS.md` 구조 설명 갱신**
  현재 실제 구조에 맞춰 `game/core`와 `server` 책임을 반영했습니다.
  현재 기준 구조는 `game(core/entry/runtime/execution/state/ui) / render / net / server / pages / styles`입니다.

## 검증
- 전체 `src/**/*.js`에 대해 `node --check` 통과
- 코드 기준으로 남은 `src/core` import 없음
- 멀티플레이 구현 로직은 추가하지 않고, 사용자가 직접 구현할 수 있도록 폴더 책임만 정리

---

# 2026년 5월 6일
RoomService 기반 멀티플레이 서버 상태 관리 시작

## 커밋 정보
- `2026-05-06 17:08:45 +0900`
- `4963602`
- `refactor: replace frontend routing and legacy game pages with server-side RoomService implementation`

## 변경 사항
- **서버 room 상태 관리 도입**
  `Map` 기반 `RoomService`를 추가해 서버 메모리에서 방 상태를 관리하기 시작했습니다.

- **roomService 기본 API 추가**
  `createRoom`, `joinRoom`, `removePlayer`, `getRoomState`를 만들고, 결과 반환 형태를 `{ ok, room, reason }`으로 통일했습니다.

- **Node 내장 테스트 기반 마련**
  `node --test` 기반 `testRoomService.js`를 추가해 방 생성, 입장, 퇴장, 실패 케이스를 검증할 수 있게 했습니다.

## 의미
- 멀티플레이 구현의 첫 기준점이 클라이언트 화면이 아니라 서버 room 상태로 이동했습니다.
- 이후 Socket.IO 이벤트는 이 roomService를 호출하는 얇은 입구가 될 수 있는 구조가 생겼습니다.

---

# 2026년 5월 13일
채팅 중심 소켓에서 room 이벤트 중심 구조로 전환

## 커밋 정보
- `2026-05-13 14:49:47 +0900`
- `40f54f0`
- `feat: implement multiplayer room and socket services to replace legacy chat handling`

## 변경 사항
- **roomClient 어댑터 추가**
  브라우저에서 `room:create` 요청을 보낼 수 있는 `roomClient` 흐름을 만들었습니다.

- **멀티플레이 Socket.IO 이벤트 입구 추가**
  서버에 `room:create`, `room:join`, `room:leave` 이벤트를 받을 수 있는 소켓 처리 흐름을 추가했습니다.

- **멀티 로비와 roomService 연결 시작**
  `multiLobby.html`에서 방 생성 요청을 서버로 보내고, 서버의 room 결과를 받을 수 있는 기반을 마련했습니다.

## 의미
- 기존 전역 채팅 소켓 중심 구조에서 실제 멀티플레이에 필요한 room 단위 이벤트 구조로 방향이 바뀌었습니다.

---

# 2026년 5월 20일
현재 `src/client` / `src/server` 구조로 재배치

## 커밋 정보
- `2026-05-20 19:28:11 +0900`
- `f0b198c`
- `feat: add multiplayer and single player Tetris pages with responsive design`

## 변경 사항
- **브라우저 정적 루트 정리**
  프론트엔드 파일을 `src/client` 아래로 이동해 서버 코드와 브라우저 코드를 더 명확히 분리했습니다.

- **서버 책임 분리**
  서버는 `src/server/services`와 `src/server/sockets` 기준으로 나뉘기 시작했습니다.

- **싱글/멀티 페이지 재배치**
  `tetrisSingle.html`, `tetrisMulti.html`, `multiLobby.html`을 현재 클라이언트 루트 기준으로 정리했습니다.

- **스타일 구조 정리**
  공통 스타일과 테트리스 게임 스타일을 `src/client/styles` 기준으로 관리하도록 재배치했습니다.

## 의미
- 현재 프로젝트 구조인 `src/client/...`와 `src/server/...` 경계가 이 시점부터 본격적으로 자리 잡았습니다.

---

# 2026년 5월 29일
Socket.IO room join/broadcast 흐름과 UI 스타일 정리

## 커밋 정보
- `2026-05-29 18:44:26 +0900`
- `33b2b23`
- `Refactor CSS for consistency and readability; update server socket handling for room creation and joining`

## 변경 사항
- **Socket.IO room 참가 도입**
  방 생성/입장 성공 시 `socket.join(roomId)`를 호출해 같은 방 참가자에게만 이벤트를 보낼 수 있게 했습니다.

- **room 상태 broadcast 추가**
  `room:updated`, `room:message` 이벤트를 통해 같은 room 참가자에게 상태 변경과 시스템 메시지를 전달하도록 했습니다.

- **client room adapter 확장**
  `roomClient`에서 room 결과뿐 아니라 room 업데이트와 메시지도 구독할 수 있게 했습니다.

- **CSS 정리**
  멀티 로비와 게임 화면 스타일을 정리해 UI 구조를 읽기 쉽게 만들었습니다.

## 의미
- 방 상태가 더 이상 요청자 한 명에게만 머무르지 않고, 같은 room 참가자에게 동기화되는 기반이 생겼습니다.

---

# 2026년 6월 9일
닉네임 입력, 플레이어 세션, 퇴장/disconnect 처리 추가

## 커밋 정보
- `2026-06-09 10:56:36 +0900`
- `3d1ead7`
- `feat: implement player nickname entry and add socket logic for leaving rooms and handling disconnections`

## 변경 사항
- **닉네임 입력 흐름 추가**
  메인 화면에서 닉네임을 입력하고, 로비에서 현재 플레이어 프로필로 표시할 수 있게 했습니다.

- **`sessionStorage` 기반 플레이어 정보 유지**
  닉네임과 player 정보를 브라우저 세션에 저장해 로비 이동 후에도 같은 사용자 맥락을 유지하도록 했습니다.

- **room 퇴장 흐름 추가**
  수동 `room:leave` 이벤트로 방에서 나가고, 남은 참가자에게 room 상태 변경을 알릴 수 있게 했습니다.

- **disconnect 정리**
  소켓 연결이 끊어졌을 때 `findRoomBySocketId`로 해당 player를 찾아 room에서 제거하는 흐름을 추가했습니다.

- **테스트 보강**
  `roomService`와 `multiplayerSocket` 테스트에 퇴장 및 disconnect 케이스를 추가했습니다.

## 의미
- 멀티플레이 room이 단순 생성/입장만 가능한 상태에서, 실제 사용자 세션과 이탈 상황을 다루는 구조로 발전했습니다.

---

# 2026년 6월 12일
방장 기준 게임 시작 흐름 추가

## 커밋 정보
- `2026-06-12 01:56:45 +0900`
- `7cecbb3`
- `feat: implement room host logic and game start functionality in room service and lobby UI`

## 변경 사항
- **host player 개념 추가**
  room에 `hostPlayerId`를 저장해 방장을 구분할 수 있게 했습니다.

- **방장만 게임 시작 가능**
  `room:start` 이벤트를 추가하고, 방장 socket/player만 게임 시작을 요청할 수 있게 검증했습니다.

- **게임 시작 조건 검증**
  2명이 입장하기 전에는 시작할 수 없고, 이미 시작된 room은 다시 시작하지 않도록 서버에서 막았습니다.

- **room 상태 전환**
  게임 시작 시 room 상태를 `waiting`에서 `playing`으로 전환했습니다.

- **로비 UI 연결**
  방장 배지와 게임 시작 버튼을 로비에 연결했습니다.

- **테스트 보강**
  host 권한, 인원 부족, 중복 시작 등 room start 관련 테스트를 추가했습니다.

## 의미
- 단순 room 입장 기능에서 실제 match 시작 직전 단계로 넘어갔습니다.
- 아직 authoritative match loop는 없지만, room이 게임 시작 상태를 가질 수 있게 되었습니다.

---

# 2026년 6월 22일
멀티 게임 화면 연결 및 snapshot 기반 초기 동기화 초안

> 이 항목은 현재 작업 트리의 미커밋 변경 기준입니다. 아직 최종 커밋 메시지는 없습니다.

## 변경 사항
- **로비 room 세션 복구**
  `multiLobby.html`에서 `sessionStorage`에 저장된 `roomId`와 player 정보를 기준으로 `room:sync`를 요청해, 새로고침이나 페이지 이동 후에도 방 상태를 복구할 수 있게 했습니다.

- **playing 상태 진입 시 게임 화면 이동**
  room 상태가 `playing`으로 바뀌면 로비에서 `tetrisMulti.html`로 이동하도록 연결했습니다.

- **멀티 게임 화면에 room/player 표시 추가**
  `tetrisMulti.html`에서 방 코드, host/guest 이름, 내 보드/상대 보드 배지를 표시하도록 했습니다.

- **local/opponent runtime 연결**
  멀티 게임 화면에서 내 보드용 `createTetrisRuntime(...)`과 상대 보드용 runtime을 각각 생성하는 초안을 추가했습니다.

- **snapshot 송수신 초안**
  `game:snapshot` 이벤트로 내 게임 상태를 주기적으로 전송하고, 상대 runtime에는 받은 snapshot을 `applySnapshot`으로 반영하는 초기 동기화 흐름을 추가했습니다.

- **게임 화면 입장/이탈 이벤트 추가**
  `game:join`, `game:leave`, `game:opponent-left`, `game:join:result` 흐름을 추가했습니다.

- **roomService 책임 확장**
  `leaveRoom`, `leaveGame`, `syncRoom`, `removePlayerBySocketId`, `getRoomPlayerContext`를 추가해 room/player 검증과 이탈 흐름을 더 명확히 분리했습니다.

- **Socket.IO 이벤트 확장**
  `room:sync`, `game:join`, `game:snapshot`, `game:leave`를 서버 소켓에 추가했습니다.

- **테스트 확장**
  `testRoomService.js`와 `testMultiplayerSocket.js`에 room sync, game join, snapshot 전달, playing room disconnect, game leave 관련 케이스를 추가했습니다.

## 의미
- 이제 로비에서 게임 화면으로 넘어가고, 양쪽 보드가 snapshot으로 연결되는 첫 단계까지 왔습니다.
- 다만 현재 구조는 아직 초안입니다. 100ms snapshot 전송은 구현은 쉽지만 장기적으로는 `game:input`, server bag, authoritative tick 구조로 정리해야 합니다.

## 남은 것
- `console.log` 디버깅 출력 정리
- `game:snapshot` payload 검증 추가
- snapshot 주기와 데이터 크기 조정
- `game:input` 기반 authoritative 흐름 설계
- server bag 또는 seed 기반 조각 공급 정책 확정
- 브라우저 2탭 수동 검증

---

# 2026년 6월 23일
멀티 로비 재입장 socket 동기화와 snapshot 서버 검증 추가

> 이 항목은 현재 작업 트리의 미커밋 변경 기준입니다. 아직 최종 커밋 메시지는 없습니다.

## 변경 사항
- **로비 복귀 시 socketId 갱신**
  `room:sync`에서 현재 로비 socket id를 `syncRoom(roomId, playerId, socketId)`로 전달해, 페이지 이동 후 새로 생성된 Socket.IO 연결을 room player 상태에 반영하도록 했습니다.

- **게임 페이지 socket과 로비 권한 socket 분리**
  `game:join`에서는 room 권한 기준 socket id를 갱신하지 않고, 게임 room 참가만 처리하도록 유지했습니다.

- **재시작 `NOT_AUTHORIZED` 문제 수정**
  게임 중 한 명이 홈으로 이동하고 남은 플레이어가 로비로 돌아온 뒤, 같은 방에서 다시 게임을 시작할 때 오래된 socket id 때문에 `NOT_AUTHORIZED`가 발생하던 흐름을 해결했습니다.

- **snapshot 전송 권한 검증**
  `game:snapshot` 수신 시 `syncRoom(roomId, playerId)`로 room 참가자인지 확인하고, room에 속하지 않은 player의 snapshot은 상대에게 broadcast하지 않도록 했습니다.

- **snapshot payload 최소 검증**
  `snapshot.board`가 배열이 아닌 경우 `INVALID_SNAPSHOT` 결과를 요청자에게 반환하고, 상대에게 잘못된 snapshot이 전달되지 않도록 했습니다.

- **테스트 보강**
  `testRoomService.js`와 `testMultiplayerSocket.js`에 다음 케이스를 추가했습니다.
  - `room:sync`가 새 lobby socket id를 room player 상태에 반영하는지
  - 새 socket id로 다시 `room:start`를 실행할 수 있는지
  - room 참가자가 아닌 player의 `game:snapshot`이 차단되는지
  - 잘못된 snapshot payload가 상대에게 전달되지 않는지

## 의미
- 로비와 게임 페이지를 오가며 Socket.IO 연결이 새로 생기는 실제 브라우저 흐름을 서버 상태가 따라갈 수 있게 되었습니다.
- `game:snapshot`은 이제 단순 중계가 아니라 최소한의 room/player 검증과 payload 검증을 거친 뒤 상대에게 전달됩니다.
- 이후 `game:input`, `match:finish`, server bag 같은 이벤트에도 같은 검증 패턴을 적용할 수 있는 기준이 생겼습니다.

## 검증
- `node --test test/testMultiplayerSocket.js`
- `npm test`
- 총 `58`개 테스트 통과

## 다음 후보
- `game:snapshot:result` 클라이언트 수신 처리
- snapshot 전송 주기와 중복 listener 정리
- `match:finish` / 승패 처리 설계
- server bag 또는 next queue 동기화 설계

---

# 2026년 6월 24일
멀티 로비 global/room 채팅 분리와 XSS 방어 기준 추가

> 이 항목은 현재 작업 트리의 미커밋 변경 기준입니다. 아직 최종 커밋 메시지는 없습니다.

## 변경 사항
- **채팅 이벤트 분리**
  `global:chat` / `global:message`와 `room:chat` / `room:message`를 분리해 전체 채팅과 방 채팅의 범위를 명확히 나눴습니다.

- **채팅 범위 선택 UI 추가**
  멀티 로비 메시지 입력창 앞에 `전체` / `방` 선택 UI를 추가했습니다.

- **서버 검증 추가**
  빈 메시지, 200자 초과 메시지, room 권한 없는 채팅을 차단하고, 같은 socket의 1초 내 연속 채팅을 `CHAT_RATE_LIMITED`로 막도록 했습니다.

- **스크립트 인젝션 방어**
  로비 채팅 렌더링에서 `innerHTML` 조립을 제거하고 `textContent` / text node 기반으로 메시지를 출력하도록 변경했습니다. 기존 실험용 `chat.js`도 사용자 문자열을 HTML로 조립하지 않도록 정리했습니다.

- **테스트 보강**
  `testMultiplayerSocket.js`에 global 채팅 broadcast, room 채팅 broadcast, 권한 없는 room 채팅 차단, 빈 메시지/길이 제한, rate limit 검증 케이스를 추가했습니다.

- **채팅 소켓 파일 분리**
  서버 채팅 이벤트와 검증 로직을 `src/server/sockets/chatHandlers.js`로 분리하고, `multiplayerHandlers.js`는 room/game 이벤트 중심으로 유지했습니다.
  `sockets/index.js`는 연결 시 `registerChatHandlers(socketServer, clientSocket)`와 `registerMultiplayerHandlers(socketServer, clientSocket)`를 함께 등록합니다.

## 의미
- 채팅이 더 이상 단순 로컬 출력이 아니라 서버 검증과 broadcast를 거치는 실제 멀티 기능이 됐습니다.
- 사용자 입력은 서버와 클라이언트 양쪽에서 plain text로 다루는 기준이 생겼습니다.
- 서버 소켓 계층에서 chat과 multiplayer room/game 책임이 분리되어 다음 match/game 이벤트를 추가하기 쉬워졌습니다.

## 검증
- `node --test test/testMultiplayerSocket.js`
- `npm test`
- 총 `59`개 테스트 통과

---

# 2026년 6월 25일
`game:input` 1차 배관 추가

> 이 항목은 현재 작업 트리의 미커밋 변경 기준입니다. 아직 최종 커밋 메시지는 없습니다.

## 변경 사항
- **서버 `game:input` 이벤트 추가**
  `multiplayerHandlers.js`에서 `game:input`을 받아 `syncRoom(roomId, playerId)`로 room 참가자인지 확인한 뒤, 같은 room의 상대 socket에게 전달하도록 했습니다.

- **input action 검증 추가**
  서버에서 `move_left`, `move_right`, `soft_drop`, `rotate`, `hard_drop`, `hold`만 허용하고, 그 외 action은 `INVALID_ACTION`으로 차단합니다.

- **클라이언트 input 송신 추가**
  `roomClient.js`에 `sendGameInput`, `receiveGameInput`, `onGameInputResult`를 추가했습니다.
  `tetrisMulti.html`에서는 기존 로컬 입력 처리(`myGame.enqueueInput`)를 유지하면서 같은 action을 서버에도 전송합니다.

- **테스트 보강**
  `testMultiplayerSocket.js`에 `game:input` 정상 전달, room 참가자가 아닌 player 차단, 잘못된 action 차단 케이스를 추가했습니다.

## 의미
- 현재 단계는 서버 authoritative 게임 루프가 아니라 input 기반 구조로 가기 위한 첫 배관입니다.
- snapshot은 아직 상대 보드 표시용으로 유지합니다.
- 다음 단계에서는 서버 match state에 input log를 저장하고, 그 다음 서버가 input으로 상태를 계산해 authoritative snapshot을 내려주는 방향으로 확장합니다.

## 검증
- `node --test test/testMultiplayerSocket.js`
- `npm test`
- 총 `62`개 테스트 통과

---

# 2026년 6월 28일
멀티 게임 동기화 안정화: server bag, pieceIndex, snapshot correction, input 제한

> 이 항목은 현재 작업 트리의 미커밋 변경 기준입니다. 아직 최종 커밋 메시지는 없습니다.

## 변경 사항
- **server bag 기반 조각 공급**
  match 생성 시 player별 server bag chunks를 만들고, 멀티 게임 진입 시 각 runtime에 전달하도록 연결했습니다.
  클라이언트는 남은 server bag 수가 낮아지면 `game:bag:request`로 추가 chunk를 요청하고, 서버는 `game:bag:append`를 room에 broadcast합니다.

- **`pieceIndex` 기반 입력 동기화**
  조각이 새로 스폰될 때 runtime의 `pieceIndex`를 증가시키고, snapshot과 `game:input` payload에 포함했습니다.
  상대 runtime은 현재 조각의 `pieceIndex`와 맞지 않는 입력을 적용하지 않도록 제한했습니다.

- **snapshot correction 분리**
  `shouldCorrectSnapshot`과 `isSamePiece`를 `src/client/game/runtime/snapshotCorrection.js`로 분리했습니다.
  snapshot 보정 규칙은 다음 기준을 따릅니다.
  - 과거 `pieceIndex` snapshot은 무시
  - 미래 `pieceIndex` snapshot은 뒤처진 상대 보드를 따라잡기 위해 적용
  - 같은 `pieceIndex`에서는 `phase` 또는 `activePiece` 차이가 있을 때만 적용
  - `gameOver` snapshot은 예외적으로 적용

- **snapshot 전송 주기 조정**
  멀티 게임 snapshot 전송 주기를 100ms에서 500ms로 줄였습니다.
  현재 snapshot은 상대 보드의 주 표시 수단이 아니라 input 예측 실행이 어긋났을 때의 보정 수단으로 사용합니다.

- **상대 보드 예측 실행 정책 명시**
  `opponentGame`은 `autoStart: true`를 유지합니다.
  `autoStart: false` 실험에서는 상대 보드가 snapshot 도착 시점에만 움직여 크게 끊겨 보였으므로, 서버 authoritative runtime으로 전환하기 전까지는 input relay + snapshot correction 기반 예측 실행을 유지합니다.

- **과도 입력 제한**
  `enqueueInput()`이 같은 `tick + pieceIndex`에 입력을 최대 4개까지만 큐에 넣도록 제한했습니다.
  멀티 화면에서는 실제로 큐에 들어간 입력만 `sendGameInput()`으로 서버에 전송해, 내 보드와 상대 보드 입력 흐름이 달라지지 않게 했습니다.

- **테스트 보강**
  `testTetrisRuntime.js`에 `pieceIndex` 입력 필터링, snapshot의 `pieceIndex` 복원, 같은 tick 과도 입력 제한 테스트를 추가했습니다.
  `testSnapshotCorrection.js`를 추가해 snapshot 보정 규칙을 순수 함수 테스트로 고정했습니다.

## 의미
- 현재 멀티 게임은 `input relay + server bag + snapshot correction` 구조로 동작합니다.
- 상대 보드는 로컬에서 예측 실행하고, 어긋난 상태는 500ms snapshot으로 보정합니다.
- 아직 서버 authoritative 게임 루프는 아닙니다. 서버는 input을 검증/전달/inputLog 저장까지 수행하지만, input으로 직접 게임 상태를 계산하지는 않습니다.

## 검증
- `node --test test/testTetrisRuntime.js`
- `node --test test/testSnapshotCorrection.js`
- `npm test`
- 총 `82`개 테스트 통과

## 다음 후보
- 브라우저 2탭 기준 빠른 입력/안착/다음 블록 조작 회귀 검증 계속
- 서버가 input으로 game state를 계산할 수 있게 `step(state, input)` 경계 정리
- 서버 authoritative snapshot 전환 설계

# 2026-06-30

---

## placement_decision 로그 생성

### 목적

- 향후 AI 추천, 플레이 분석, 리플레이, 학습 데이터 생성을 위해 "플레이어가 한 조각을 어디에 두기로 결정했는지"를 이벤트 단위로 남길 수 있게 했다.
- 매 프레임 전체 상태를 저장하면 데이터가 너무 커지고 의미 있는 의사결정 단위를 찾기 어렵기 때문에, 우선 piece lock 시점만 기록 대상으로 삼았다.
- 이번 단계에서는 AI 판단, board metrics, ML 학습, DB 저장까지 확장하지 않고, `placement_decision` 로그 객체를 안정적으로 만드는 것에 집중했다.

### 변경 사항

- `createTetrisRuntime()`에 `placementDecisionRecorder` 옵션을 추가했다.
  - 런타임은 로그 객체를 만들기만 하고, 저장 방식은 외부 recorder가 결정한다.
  - 이 덕분에 싱글/멀티/테스트/서버 전송을 같은 런타임 구조에서 다룰 수 있다.
- piece lock 시점에 `placement_decision` 로그를 생성한다.
  - 실제 lock 흐름은 `seizeBlock()`에서 시작되고, 보드 병합은 `commitLockedPiece()`의 `lockPieceOnBoard()`에서 일어난다.
  - 로그 문맥은 보드 병합 전에 만들고, 최종 로그는 line clear와 score 갱신 이후 확정한다.
- `boardBefore`는 activePiece가 board에 merge되기 전 상태로 저장한다.
  - 즉, 현재 조각은 아직 board에 들어가지 않은 상태다.
  - 이후 AI가 "이 배치 전 보드가 어땠는지"를 평가할 수 있다.
- `boardAfter`는 piece merge와 line clear가 반영된 뒤 상태로 저장한다.
  - line clear가 발생하면 줄 삭제 이후의 최종 board가 들어간다.
  - 단순히 조각이 붙은 직후가 아니라, 실제 게임 규칙 처리가 끝난 결과를 남긴다.
- `selectedPlacement`는 board diff로 역산하지 않고, lock 직전 activePiece 기준으로 기록한다.
  - board diff로 계산하면 line clear, T-spin, top-out 같은 후처리 때문에 원래 위치를 잃을 수 있다.
  - 그래서 `pieceType`, `rotation`, `row`, `col`, `cells`를 lock 직전 조각 상태에서 직접 만든다.
- `inputSequence`는 현재 `playerId`와 `pieceIndex` 기준으로 실제 적용된 입력만 묶는다.
  - 입력 큐에 들어왔지만 현재 조각에 적용되지 않은 입력은 제외한다.
  - 이전 조각 입력이나 상대 player 입력이 섞이지 않도록 `pieceIndex`를 기준으로 분리한다.
- `placementResult`에 `linesCleared`, `scoreBefore`, `scoreAfter`, `scoreDelta`, `gameOver`를 기록한다.
  - 이후 AI 평가에서 "이 배치가 어떤 결과를 만들었는지"를 바로 비교할 수 있다.

### 의미

- 이제 한 조각의 결정 단위를 다음처럼 설명할 수 있다.
  1. 배치 전 보드 상태
  2. 어떤 조각을 어떤 입력 순서로 조작했는지
  3. 최종적으로 어디에 놓았는지
  4. 놓은 뒤 보드와 점수가 어떻게 바뀌었는지
- 이 구조는 나중에 heuristic AI, 리플레이, ML 데이터셋, LLM 코칭 리포트로 확장하기 위한 가장 작은 기반이다.
- 아직 서버 authoritative game state는 아니며, 현재는 클라이언트 런타임이 만든 의사결정 로그를 기록하는 단계다.

### 이번에 하지 않은 것

- AI 추천 결과 저장
- board metrics 계산
- DB 저장
- 서버에서 game state 직접 계산
- JSONL 외 분석 파이프라인

검증:
- `npm test` 통과
- `git diff --check` 통과

## placement_decision JSONL 저장

### 목적

- 클라이언트에서 만든 `placement_decision` 로그를 서버 파일로 누적 저장할 수 있게 했다.
- 아직 DB나 분석 서버를 붙이기 전 단계이므로, 가장 단순하고 확인하기 쉬운 JSON Lines 파일을 사용했다.
- JSONL은 한 줄에 하나의 JSON object를 저장하므로, 나중에 로그를 줄 단위로 읽어 분석하거나 학습 데이터로 변환하기 쉽다.

### 변경 사항

- 클라이언트에 `src/client/net/logClient.js`를 추가했다.
  - `sendPlacementDecisionLog(roomId, playerId, log)`가 Socket.IO 이벤트 `game:log:placement_decision`으로 로그를 전송한다.
  - emit 중 예외가 나도 게임이 멈추지 않도록 `console.warn`만 남긴다.
- `tetrisMulti.html`에서 `placementDecisionRecorder`를 `sendPlacementDecisionLog()`에 연결했다.
  - 조각이 lock될 때마다 생성된 로그가 서버로 전송된다.
  - 서버 저장 결과는 `game:log:result`로 받을 수 있고, 실패해도 경고만 출력한다.
- 서버 소켓 핸들러에 `game:log:placement_decision` 이벤트를 추가했다.
  - 먼저 `syncRoom(roomId, playerId)`로 해당 player가 room에 속해 있는지 확인한다.
  - payload의 `playerId`와 log 내부 `playerId`가 다르면 저장하지 않는다.
  - 인증이 통과한 로그만 `logService`로 넘긴다.
- `src/server/services/logService.js`를 추가했다.
  - 로그 저장 흐름의 중심 계층이다.
  - validator를 먼저 호출하고, 통과한 로그만 repository에 넘긴다.
  - repository 저장 실패가 발생해도 예외를 밖으로 던지지 않고 warning과 실패 결과만 반환한다.
- `src/server/validators/gameLogValidator.js`를 추가했다.
  - `schemaVersion`, `eventType`, `playerId`, `gameId`, `pieceIndex`, `boardBefore`, `boardAfter`, `selectedPlacement`를 검증한다.
  - payload 크기가 제한을 넘으면 `LOG_PAYLOAD_TOO_LARGE`로 저장을 거부한다.
- `src/server/repositories/jsonlLogRepository.js`를 추가했다.
  - 기본 저장 경로는 `data/logs/game-events.jsonl`이다.
  - 저장 전 `data/logs` 디렉터리를 `recursive: true`로 생성한다.
  - `JSON.stringify(log) + "\n"` 형태로 append해서 한 줄에 하나의 JSON object만 저장한다.
- 런타임 로그 파일은 저장소 변경 목록에 계속 잡히지 않도록 `.gitignore`에 `data/logs/*.jsonl`을 추가했다.

### 저장 흐름

```text
tetris runtime
  -> placementDecisionRecorder(log)
  -> client/net/logClient.js
  -> Socket.IO game:log:placement_decision
  -> server/sockets/multiplayerHandlers.js
  -> server/services/logService.js
  -> server/validators/gameLogValidator.js
  -> server/repositories/jsonlLogRepository.js
  -> data/logs/game-events.jsonl
```

### 실패 처리

- 클라이언트 전송 실패:
  - `console.warn`만 남기고 게임 루프는 계속 진행한다.
- 서버 검증 실패:
  - 저장하지 않고 `game:log:result`로 실패 이유를 반환한다.
- 서버 파일 저장 실패:
  - 서버 프로세스를 죽이지 않고 warning만 남긴다.
  - 게임 진행과 Socket.IO room 흐름은 계속 유지된다.

### JSONL 예시

```json
{"eventType":"placement_decision","schemaVersion":1,"playerId":"sample-player","gameId":"sample-game","pieceIndex":1,"boardBefore":[[null]],"boardAfter":[["square"]],"selectedPlacement":{"pieceType":"square","rotation":0,"row":18,"col":4}}
```

### 의미

- 이제 멀티 게임 플레이 중 조각 배치 단위의 분석 로그를 서버에 남길 수 있다.
- 기존 `matchService`의 inputLog는 멀티 동기화/replay 준비용으로 유지하고, JSONL 로그는 AI/분석 데이터 수집용으로 분리했다.
- 두 로그의 목적이 다르기 때문에 하나로 합치지 않았다.
  - `matchService.inputLog`: 현재 match 내부에서 입력 순서를 추적
  - `game-events.jsonl`: 장기적으로 저장할 분석 이벤트

검증:
- `npm test` 통과
- `git diff --check` 통과
- 기본 경로 `data/logs/game-events.jsonl` append 확인

# 2026-07-01

---

## 멀티플레이 garbage cancel / combo / back-to-back / T-Spin 공격 규칙 추가

### 목적

- 멀티플레이에서 줄 삭제가 단순 점수 변화로 끝나지 않고 상대에게 공격으로 이어지게 했다.
- 상대에게서 받은 garbage가 즉시 올라오는 방식은 방어 타이밍을 만들 수 없어서, 다음 조각 lock 시점에 먼저 상쇄하고 남은 garbage만 적용하는 구조로 바꿨다.
- 향후 AI 학습/분석에서 "어떤 배치가 공격, 방어, 상쇄를 만들었는지"를 판단할 수 있도록 placement 결과에 공격 관련 값을 함께 기록했다.

### 변경 사항

- `src/client/game/core/garbage.js`에 공격량 계산 규칙을 확장했다.
  - Double: 1줄
  - Triple: 2줄
  - Tetris: 4줄
  - T-Spin Single: 2줄
  - T-Spin Double: 4줄
  - T-Spin Triple: 6줄
  - combo는 연속 line clear 단계에 따라 추가 garbage를 더한다.
  - back-to-back은 Tetris 또는 T-Spin clear가 연속될 때 1줄 보너스를 더한다.
- `createGameState()`에 `combo`, `backToBack` 상태를 추가했다.
  - `combo`는 첫 line clear를 0으로 기록하기 위해 초기값을 `-1`로 둔다.
  - line clear가 끊기면 combo는 다시 `-1`로 돌아간다.
  - back-to-back은 Tetris 또는 T-Spin clear가 이어질 때만 유지된다.
- snapshot 직렬화/복원에 `combo`, `backToBack`을 포함했다.
  - 멀티플레이 보정 시 공격 상태도 같이 맞출 수 있게 했다.
- runtime에 pending garbage queue를 추가했다.
  - `queueGarbageLines()`로 받은 garbage를 즉시 board에 올리지 않고 대기시킨다.
  - 조각이 lock될 때 내 공격량이 먼저 pending garbage를 상쇄한다.
  - 공격량이 더 크면 남은 공격만 상대에게 보낸다.
  - pending garbage가 더 크면 남은 garbage만 내 board 아래에서 올라온다.
- placement 결과에 공격/방어 값을 추가했다.
  - `rawAttackLines`: combo/back-to-back/T-Spin까지 계산한 원래 공격량
  - `attackLines`: pending garbage를 상쇄한 뒤 실제 상대에게 보낼 공격량
  - `incomingGarbageLines`: lock 시점에 대기 중이던 garbage 수
  - `canceledGarbageLines`: 내 공격으로 상쇄한 garbage 수
  - `appliedGarbageLines`: 상쇄 후 실제 내 board에 올라온 garbage 수
  - `combo`, `backToBack`, `isTSpin`
- `tetrisMulti.html`의 garbage 수신 흐름을 즉시 적용에서 queue 방식으로 바꿨다.
  - `game:garbage:append`를 받으면 local/opponent runtime 모두에 pending garbage로 넣는다.
  - 실제 적용은 해당 player의 다음 lock 시점에 일어난다.
- 서버의 `game:garbage:attack` 검증 최대값을 8줄에서 12줄로 늘렸다.
  - T-Spin Triple + combo + back-to-back 조합처럼 8줄을 넘을 수 있는 합법 공격을 막지 않기 위해서다.

### 의미

- 이제 멀티플레이 공격 흐름은 다음 순서로 읽을 수 있다.

```text
line clear / T-Spin
  -> rawAttackLines 계산
  -> pending garbage 먼저 상쇄
  -> 남은 attackLines만 상대에게 전송
  -> 남은 pending garbage만 내 board에 적용
```

- 이 구조는 "공격을 보냈다"와 "상대 공격을 방어했다"를 분리해서 기록한다.
- 즉, AI 분석에서는 단순히 줄을 많이 지운 배치뿐 아니라, 위험한 incoming garbage를 얼마나 상쇄했는지도 평가할 수 있다.

### 검증

- `node --test test/testGarbageRules.js test/testTetrisRuntime.js test/testMultiplayerSocket.js` 통과
  - 58개 테스트 통과
- `npm test` 통과
  - 124개 테스트 통과
- `git diff --check` 통과

# 2026-07-02

---

## Shadow authoritative 관찰 실험과 desync 진단 로그 정리

### 목적

- 최종 목표는 서버 authoritative 구조지만, 현재 멀티플레이 MVP를 바로 서버 authoritative로 전환하면 위험 범위가 너무 크다.
- 그래서 실제 화면과 플레이는 기존 client prediction 구조를 유지하고, 서버는 같은 input/server bag을 이용해 뒤에서 shadow state를 계산하는 방식으로 먼저 관찰했다.
- 이 단계의 목적은 서버 계산을 게임에 강제 적용하는 것이 아니라, 클라이언트 snapshot과 서버 shadow snapshot이 어디서 어떻게 어긋나는지 안전하게 확인하는 것이다.

### 현재 구조

```text
실제 플레이 화면
  -> 클라이언트 런타임이 계속 계산
  -> 기존 input / snapshot / garbage 흐름 유지

서버 shadow
  -> matchService가 player별 shadowState 보관
  -> game:input을 shadowInputLog에 저장하고 shadowState에도 적용
  -> 서버 gravity loop가 shadow state를 주기적으로 진행
  -> game:snapshot 수신 시 client snapshot과 shadow snapshot을 비교
```

- 서버 shadow 계산 결과는 아직 클라이언트 화면에 적용하지 않는다.
- desync가 발생해도 실제 멀티플레이 화면은 멈추지 않는다.
- 이 구조는 완전 authoritative 전환 전에 위험 지점을 찾기 위한 중간 단계다.

### 변경 사항

- `matchService`에 player별 shadow 관찰 상태를 추가했다.
  - `shadowState`
  - `shadowTick`
  - `shadowPieceIndex`
  - `shadowInputLog`
  - `lastClientSnapshot`
  - `lastShadowSnapshot`
  - `desyncLog`
- 서버 전용 `shadowGameEngine`을 추가했다.
  - DOM, canvas, sound 없이 board/piece 상태만 계산한다.
  - 초기 server bag으로 active piece와 preview queue를 만든다.
  - move, rotate, soft drop, hard drop, hold, gravity tick을 처리한다.
- `recordInput()`이 기존 `inputLog`뿐 아니라 `shadowInputLog`에도 입력을 저장하고 shadow state에 적용하게 했다.
- `advanceShadowMatch()`와 `startShadowMatchLoop()`를 추가했다.
  - match 단위로 player shadow state에 gravity tick을 적용한다.
  - `room:start` 성공 후 shadow loop를 시작한다.
  - `game:leave`, `game:over`에서 shadow loop를 정리한다.
- `game:snapshot` 수신 시 client snapshot을 저장하고, 마지막 shadow snapshot과 비교해 desync를 기록한다.
- `game:shadow:state` debug 이벤트를 추가했다.
  - 브라우저 콘솔에서 현재 player의 shadow 상태와 desync 요약을 조회할 수 있다.
- `summary`를 추가해 콘솔에서 핵심 값만 빠르게 볼 수 있게 했다.
  - `shadowTick`
  - `shadowPieceIndex`
  - `phase`
  - `score`
  - `linesClearedTotal`
  - `pendingGarbageLines`
  - `activePiece`
  - `desyncCount`
  - `lastDesync`
  - `lastDesyncSeverity`
  - `lastDesyncReason`
- desync 분류를 추가했다.
  - `low / ACTIVE_PIECE_OFFSET`
  - `medium / BOARD_MISMATCH`
  - `medium / STATE_MISMATCH`
  - `high / PIECE_INDEX_MISMATCH`
  - `high / PHASE_MISMATCH`
  - `info / POST_GAME_SNAPSHOT`

### 실험 결과

- 서버 재시작 전에는 `lastDesyncSeverity`, `lastDesyncReason`이 `undefined`로 나왔다.
  - 원인은 새 코드가 실행 중인 서버에 반영되지 않았기 때문이다.
  - 서버 재시작 후 새 방에서 테스트하니 severity/reason이 정상 출력됐다.
- 플레이 초반에는 주로 다음 패턴이 나왔다.

```text
fields: activePiece
severity: low
reason: ACTIVE_PIECE_OFFSET
```

- 이 패턴은 같은 조각을 보고 있지만 위치만 다른 상태다.
- 현재 서버 shadow gravity와 클라이언트 gravity 기준이 다르기 때문에 MVP 단계에서는 예상 가능한 차이다.
- 중반 이후에는 주로 다음 패턴이 반복됐다.

```text
fields: score, activePiece
severity: medium
reason: STATE_MISMATCH
```

- 이 패턴은 board나 pieceIndex가 크게 깨진 것은 아니다.
- 주된 원인은 서버 shadow score 계산과 클라이언트 runtime score 계산이 아직 다르기 때문으로 해석했다.
- 서버 shadow engine은 현재 단순 점수 계산을 하고 있고, 클라이언트 runtime은 기존 점수/라인클리어/콤보/백투백/가비지 흐름을 더 많이 반영한다.
- 게임 종료 후에는 다음 패턴으로 분류됐다.

```text
severity: info
reason: POST_GAME_SNAPSHOT
phase: gameOver
```

- 종료 후 snapshot 차이는 동기화 오류라기보다 종료 이후 잔여 비교로 보는 것이 맞다.

### 의미

- 이번 실험은 서버가 이미 완벽히 클라이언트와 일치한다는 것을 증명하기 위한 작업이 아니다.
- 목적은 서버 authoritative 전환 전에 다음을 데이터로 확인하는 것이다.
  - 어떤 필드가 어긋나는지
  - 그 어긋남이 치명적인지 아닌지
  - 어떤 순서로 맞춰야 하는지
- 현재 로그에서 반복적으로 보이지 않은 것은 좋은 신호다.

```text
high / PIECE_INDEX_MISMATCH
medium / BOARD_MISMATCH
high / PHASE_MISMATCH
```

- 즉, 현재 관찰 기준에서는 주로 activePiece 위치 차이와 score 차이가 보이고, 조각 진행이나 board 고정 결과가 크게 무너지는 패턴은 핵심 반복 문제로 보이지 않았다.

### 다음 작업

- `medium / STATE_MISMATCH`를 더 세분화한다.
  - `SCORE_MISMATCH`
  - `SCORE_AND_ACTIVE_PIECE_MISMATCH`
  - `LINE_CLEAR_MISMATCH`
  - `GARBAGE_MISMATCH`
- 이후 서버 shadow score 계산을 클라이언트 runtime 점수 규칙과 맞춘다.
- gravity/lock delay 기준을 서버 shadow와 클라이언트 runtime 사이에서 더 명확히 분리한다.
- 장기적으로는 `serverShadowTick`과 `clientTick`을 분리해서 현재처럼 shadowTick이 client input tick에 의해 크게 점프하는 현상을 정리한다.

### 검증

- `node --test test/testMatchService.js` 통과
- `node --test test/testMultiplayerSocket.js` 통과
- `npm test` 통과
  - 153개 테스트 통과
- `git diff --check` 통과

## Shadow desync 분류 세분화와 details 진단값 추가

### 목적

- 브라우저 2탭 shadow 실험에서 `medium / STATE_MISMATCH`가 반복적으로 보였지만, 이 이름만으로는 실제 원인이 score인지, line clear인지, garbage인지 구분하기 어려웠다.
- 서버 authoritative 전환 전에 "어떤 필드가 얼마나 어긋났는지"를 더 작게 나누어 관찰할 수 있게 했다.
- 이번 변경은 게임 화면에 영향을 주지 않고, debug API와 테스트에서만 확인하는 진단 정보다.

### 변경 사항

- desync 분류를 더 구체적인 reason으로 나누었다.
  - `medium / SCORE_MISMATCH`
  - `medium / SCORE_AND_ACTIVE_PIECE_MISMATCH`
  - `medium / LINE_CLEAR_MISMATCH`
  - `medium / GARBAGE_MISMATCH`
  - 기존 `low / ACTIVE_PIECE_OFFSET`, `medium / BOARD_MISMATCH`, `high / PIECE_INDEX_MISMATCH`, `high / PHASE_MISMATCH`, `info / POST_GAME_SNAPSHOT`은 유지했다.
- `desyncLog` 항목에 `details`를 추가했다.
  - `score`, `pieceIndex`, `linesClearedTotal`, `pendingGarbageLines`는 `client`, `shadow`, `delta` 형태로 저장한다.
  - `activePiece`는 client/shadow 각각의 조각 상태를 저장한다.
  - `board` 차이는 필요할 때 client/shadow board를 함께 저장한다.
- `getPlayerShadowState()`가 debug 응답으로 `details`까지 복사해서 내려주게 했다.
  - 브라우저 콘솔에서 `summary.lastDesync.details`를 바로 확인할 수 있다.

### 실험 해석 기준

- `SCORE_MISMATCH`는 active piece 위치는 거의 맞지만 점수 계산 규칙이 다를 가능성이 높다.
- `SCORE_AND_ACTIVE_PIECE_MISMATCH`는 점수 차이와 조각 위치 차이가 함께 난 상태다.
  - 빠른 입력, lock 타이밍, gravity tick 기준 차이를 같이 의심해야 한다.
- `LINE_CLEAR_MISMATCH`는 client와 shadow가 줄 삭제 결과를 다르게 계산했다는 신호다.
- `GARBAGE_MISMATCH`는 pending garbage queue의 총량이 다르다는 신호다.
  - garbage cancel/apply 타이밍을 확인해야 한다.
- `POST_GAME_SNAPSHOT`은 게임 종료 후 남은 snapshot 비교이므로 우선순위가 낮은 정보성 로그로 본다.

### 콘솔 확인 예시

```js
const summary = result.shadow?.summary;

console.log(summary?.lastDesyncReason);
console.log(summary?.lastDesync?.details);
console.table(summary?.lastDesync?.details?.score);
console.table(summary?.lastDesync?.details?.pendingGarbageLines);
```

### 의미

- 이제 `STATE_MISMATCH`처럼 넓은 이름으로 묶이지 않고, 다음 작업 대상을 더 명확히 고를 수 있다.
- 예를 들어 score만 반복해서 다르면 score 규칙부터 맞추고, garbage만 반복해서 다르면 pending garbage 처리 순서부터 확인하면 된다.
- shadow mode의 목적은 아직 서버 결과를 화면에 강제 적용하는 것이 아니라, authoritative 전환 전에 차이를 관찰하고 줄여 가는 것이다.

### 검증

- `node --test test/testMatchService.js` 통과

## Shadow score 규칙 일부 보정

### 목적

- shadow debug에서 `SCORE_MISMATCH` 또는 `SCORE_AND_ACTIVE_PIECE_MISMATCH`가 반복될 때, 실제 원인이 점수 규칙 차이인지 lock/gravity 타이밍 차이인지 구분하기 어렵다.
- 먼저 클라이언트 런타임과 명확히 다른 shadow score 규칙부터 맞춰서 score mismatch의 원인을 줄였다.

### 변경 사항

- 서버 전용 `shadowGameEngine`에 `lastActionWasRotation`과 `isTSpin` 상태를 추가했다.
- 성공한 회전 입력은 `lastActionWasRotation = true`로 기록하고, 성공한 좌우/하강 이동은 `false`로 갱신한다.
- shadow lock 시점에 클라이언트와 같은 T-Spin 판정을 수행한다.
  - 조각이 `tree`여야 한다.
  - 마지막 성공 액션이 회전이어야 한다.
  - 중심 기준 4개 코너 중 3개 이상이 막혀 있어야 한다.
- T-Spin no line lock은 15점을 더한다.
- T-Spin line clear는 클라이언트와 같이 `clearedLines * 10 * 5`로 계산한다.

### 의미

- 이제 T-Spin 관련 점수는 shadow와 client가 같은 기준으로 계산한다.
- 이후에도 `SCORE_MISMATCH`가 반복되면 T-Spin 점수보다는 hard drop 타이밍, line clear 애니메이션 지연, lock timing, tick 기준 차이를 우선 의심하면 된다.

### 검증

- `node --test test/testShadowGameEngine.js` 통과
- `node --test test/testMatchService.js` 통과
- `node --test test/testMultiplayerSocket.js` 통과
- `npm test` 통과
  - 160개 테스트 통과
- `git diff --check` 통과

## Shadow garbage attack 기록 연결

### 목적

- 실제 멀티플레이에서는 `game:garbage:attack`이 발생하면 target player의 클라이언트 runtime에는 pending garbage가 쌓인다.
- 하지만 서버 shadow state가 같은 garbage를 기록하지 않으면 `GARBAGE_MISMATCH`가 계속 발생할 수 있다.
- 이번 변경은 garbage 이벤트를 서버 shadow에도 기록해서, client snapshot과 shadow snapshot이 같은 입력/공격 이벤트를 기준으로 비교되게 만드는 작업이다.

### 변경 사항

- `shadowGameEngine`에 `garbage` step을 추가했다.
  - `{ type: "garbage", lines, holeCol }`를 받으면 `pendingGarbageQueue`에 추가한다.
  - 기존 state를 직접 변경하지 않고 clone된 next state에 반영한다.
- `matchService`에 `recordGarbageAttack()`을 추가했다.
  - 공격 player와 target player가 match 안에 있는지 검증한다.
  - `lines`가 유효한지 검증한다.
  - target player의 shadow state에 pending garbage를 추가하고 `lastShadowSnapshot`을 갱신한다.
- `game:garbage:attack` 소켓 핸들러에서 broadcast 전에 `recordGarbageAttack()`을 호출한다.
  - 클라이언트에 보내는 `game:garbage:append` payload와 서버 shadow에 기록되는 garbage가 같은 `lines`, `holeCol`을 사용한다.

### 의미

- 이제 garbage 공격 이벤트는 클라이언트 화면뿐 아니라 서버 shadow 관찰 상태에도 반영된다.
- 이후에도 `GARBAGE_MISMATCH`가 남는다면 단순 이벤트 누락보다는 garbage cancel/apply 타이밍, lock 시점 처리, snapshot 전송 타이밍을 의심하면 된다.

### 검증

- `node --test test/testShadowGameEngine.js` 통과
- `node --test test/testMatchService.js` 통과
- `node --test test/testMultiplayerSocket.js` 통과
- `npm test` 통과
  - 162개 테스트 통과
- `git diff --check` 통과

## Shadow garbage cancel/apply 처리 추가

### 목적

- 이전 단계에서는 `game:garbage:attack`을 shadow pending queue에 기록하는 것까지 연결했다.
- 하지만 shadow engine이 lock 후 pending garbage를 상쇄하거나 board에 적용하지 않으면, client와 shadow의 `pendingGarbageQueue`와 board가 계속 다르게 남을 수 있다.
- 이번 변경은 클라이언트 runtime과 같은 순서로 garbage를 처리하게 만들어 `GARBAGE_MISMATCH`와 board mismatch 원인을 줄이는 작업이다.

### 변경 사항

- shadow lock 후처리에 pending garbage 적용을 추가했다.
  - pending garbage가 남아 있으면 board 위쪽 줄을 밀어내고 아래에 garbage line을 추가한다.
  - `holeCol` 위치는 빈 칸으로 유지한다.
  - 밀려나간 윗줄에 블록이 있으면 shadow phase를 `gameOver`로 바꾼다.
- shadow lock 후처리에 garbage cancel을 추가했다.
  - line clear로 만든 attack lines를 먼저 pending garbage에 사용한다.
  - 공격량이 pending garbage보다 작으면 pending queue의 줄 수만 줄인다.
  - 공격량이 pending garbage 이상이면 해당 pending 항목을 제거한다.
- shadow engine에 클라이언트와 같은 기본 garbage attack 계산을 추가했다.
  - Double: 1
  - Triple: 2
  - Tetris: 4
  - T-Spin line clear: 2 / 4 / 6
  - combo와 back-to-back 보너스도 같은 기준으로 계산한다.

### 의미

- 이제 shadow는 garbage를 "받는 것"뿐 아니라 "lock 시점에 방어하거나 실제 board에 적용하는 것"까지 따라간다.
- 이후에도 garbage 관련 desync가 남으면 이벤트 누락보다 lock timing, line clear animation timing, client snapshot 전송 시점을 우선 확인하면 된다.

### 검증

- `node --test test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js` 통과
  - 74개 테스트 통과
- `npm test` 통과
  - 164개 테스트 통과
- `git diff --check` 통과

## Shadow authoritative 브라우저 실험 의미 정리

### 목적

- 현재 멀티플레이는 아직 완전한 서버 authoritative 구조가 아니다.
- 실제 화면과 조작은 기존 client prediction 구조가 담당하고, 서버는 같은 input과 server bag을 이용해 뒤에서 shadow state를 계산한다.
- 이번 실험의 목적은 서버 shadow 계산 결과를 클라이언트에 강제 적용하는 것이 아니라, client snapshot과 shadow snapshot이 어디서 얼마나 어긋나는지 관찰하는 것이다.

### 실험한 내용

- 브라우저 2탭으로 같은 room에 들어가 기존 멀티플레이가 정상 동작하는지 확인했다.
- 게임 중 콘솔에서 `game:shadow:state`를 요청해 서버가 들고 있는 shadow 요약값을 확인했다.
- 확인한 주요 값은 다음이다.
  - `shadowTick`
  - `shadowPieceIndex`
  - `phase`
  - `score`
  - `linesClearedTotal`
  - `pendingGarbageLines`
  - `activePiece`
  - `desyncCount`
  - `lastDesync`
  - `lastDesyncSeverity`
  - `lastDesyncReason`

### 콘솔 확인 방식

```js
window.__shadowDebug?.socket?.disconnect();
clearInterval(window.__shadowDebug?.timer);

const roomId = new URLSearchParams(location.search).get("roomId");
const playerId = sessionStorage.getItem("tetris:playerId");
const socket = io();

socket.on("connect", () => {
    socket.emit("game:join", { roomId, playerId });

    const timer = setInterval(() => {
        socket.emit("game:shadow:state", { roomId, playerId });
    }, 2000);

    window.__shadowDebug = { socket, timer };
});

socket.on("game:shadow:state:result", (result) => {
    const summary = result.shadow?.summary;

    console.log("summary:", summary);
    console.log("lastDesync fields:", summary?.lastDesync?.fields);
    console.log("lastDesync:", summary?.lastDesync);

    console.table({
        severity: summary?.lastDesyncSeverity,
        reason: summary?.lastDesyncReason,
        fields: summary?.lastDesync?.fields?.join(", "),
        desyncCount: summary?.desyncCount,
        shadowTick: summary?.shadowTick,
        shadowPieceIndex: summary?.shadowPieceIndex,
    });
});
```

### 관찰한 점

- `io()` 직후 콘솔에 보이는 `connected: false`는 즉시 실패를 의미하지 않는다.
  - Socket.IO 연결이 비동기로 진행되기 때문에, 실제 연결 완료 여부는 `connect` 이벤트 안에서 확인해야 한다.
- 새 debug socket은 기존 게임 socket과 다른 연결이다.
  - 따라서 단순히 `game:shadow:state`만 보내면 room 참가자로 인정되지 않을 수 있다.
  - debug socket에서도 먼저 `game:join`을 호출한 뒤 shadow 상태를 조회해야 한다.
- 게임 종료 후에 조회한 shadow summary는 `desyncCount`, `pieceIndex`, `tick` 차이가 크게 보일 수 있다.
  - 종료 후에도 남은 snapshot 비교가 들어오면 `POST_GAME_SNAPSHOT` 또는 큰 tick 차이처럼 보일 수 있다.
  - 이 값은 실제 플레이 중 동기화 품질보다 종료 이후 잔여 이벤트 정리 상태를 더 많이 반영할 수 있다.
- 게임 중 조회한 summary에서 `activePiece`만 다른 경우는 우선 lock/gravity/input timing 차이로 본다.
  - 아직 서버 shadow tick과 client tick이 완전히 같은 루프에서 돌지 않기 때문이다.
  - 중요한 것은 board, score, line clear, garbage 같은 핵심 상태 차이가 계속 누적되는지 확인하는 것이다.

### 왜 필요한가

- 완전한 서버 authoritative 전환은 서버가 게임 상태를 최종 결정하고 클라이언트가 그 결과를 따라가는 구조다.
- 하지만 지금 바로 완전 전환하면 화면, 입력, snapshot, garbage, game over 흐름이 한 번에 흔들릴 수 있다.
- shadow 실험은 기존 플레이를 유지한 채 서버 계산만 뒤에서 돌려서 다음 질문에 답하기 위한 단계다.
  - 서버가 같은 input과 bag으로 클라이언트와 비슷한 board를 만들 수 있는가?
  - 빠른 입력 연타 후에도 `pieceIndex`가 계속 벌어지지 않는가?
  - garbage cancel/apply 이후 pending garbage가 양쪽에서 같은 값으로 남는가?
  - score, line clear, game over 시점이 어느 정도까지 맞는가?

### 다음 판단 기준

- `GARBAGE_MISMATCH`가 줄어들면 garbage 이벤트 누락보다 lock timing과 snapshot timing을 본다.
- `SCORE_MISMATCH`가 반복되면 T-Spin, combo, back-to-back, hard drop 점수 규칙 차이를 본다.
- `ACTIVE_PIECE_OFFSET`만 반복되면 상대적으로 낮은 우선순위로 두고 tick/gravity 기준을 정리한다.
- `PIECE_INDEX_MISMATCH`가 계속 누적되면 조각 spawn, lock, bag 소비 순서를 우선 점검한다.
- shadow summary는 당장 화면을 고치는 도구가 아니라, 서버 authoritative로 넘어가기 전에 어디를 맞춰야 하는지 알려주는 진단 도구다.

## Shadow desync reason count summary 추가

### 목적

- 브라우저 콘솔에서 shadow 상태를 반복 조회할 때 `lastDesyncReason`만 보면 마지막 한 건만 확인할 수 있다.
- 실제로는 여러 snapshot이 쌓이면서 `SCORE_MISMATCH`, `GARBAGE_MISMATCH`, `PIECE_INDEX_MISMATCH` 등이 함께 발생할 수 있다.
- 이번 변경은 `desyncLog` 전체를 직접 펼쳐 보지 않아도 어떤 desync 원인이 반복되는지 summary에서 바로 확인하기 위한 작업이다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 `desyncReasonCounts`를 추가했다.
- `desyncReasonCounts`는 `desyncLog`의 `primaryReason`을 기준으로 reason별 발생 횟수를 누적한다.
- 예시:

```js
{
    SCORE_MISMATCH: 1,
    GARBAGE_MISMATCH: 1,
    PIECE_INDEX_MISMATCH: 1,
}
```

### 콘솔 확인 방식

```js
socket.on("game:shadow:state:result", (result) => {
    const summary = result.shadow?.summary;

    console.table(summary?.desyncReasonCounts);
});
```

### 의미

- 이제 마지막 desync 하나만 보지 않고, 누적된 원인의 분포를 볼 수 있다.
- 예를 들어 `ACTIVE_PIECE_OFFSET`만 많이 쌓이면 위치 예측 차이로 보고 우선순위를 낮출 수 있다.
- 반대로 `PIECE_INDEX_MISMATCH`나 `GARBAGE_MISMATCH`가 반복되면 authoritative 전환 전에 먼저 맞춰야 할 핵심 동기화 문제로 볼 수 있다.

### 검증

- `node --test test/testMatchService.js` 통과
- `node --test test/testShadowGameEngine.js test/testMultiplayerSocket.js` 통과
- `npm test` 통과
  - 165개 테스트 통과
- `git diff --check` 통과

## Shadow dominant desync reason summary 추가

### 목적

- `desyncReasonCounts`는 누적 분포를 보여주지만, 콘솔에서 사람이 직접 가장 많이 나온 reason을 골라야 했다.
- shadow 실험 중에는 빠르게 "지금 가장 많이 반복되는 문제"를 보는 것이 중요하다.
- 이번 변경은 summary가 우선 확인할 desync reason과 횟수를 직접 제공하게 만든 작업이다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 다음 필드를 추가했다.
  - `dominantDesyncReason`
  - `dominantDesyncCount`
- `dominantDesyncReason`은 `desyncReasonCounts` 중 가장 큰 count를 가진 reason이다.
- desync가 없으면 `dominantDesyncReason`은 `null`, `dominantDesyncCount`는 `0`이다.

### 콘솔 확인 방식

```js
socket.on("game:shadow:state:result", (result) => {
    const summary = result.shadow?.summary;

    console.table({
        dominantReason: summary?.dominantDesyncReason,
        dominantCount: summary?.dominantDesyncCount,
        lastReason: summary?.lastDesyncReason,
        total: summary?.desyncCount,
    });
});
```

### 의미

- `lastDesyncReason`은 가장 최근에 발생한 차이를 보여준다.
- `dominantDesyncReason`은 누적된 차이 중 가장 반복되는 원인을 보여준다.
- 예를 들어 마지막 값은 `ACTIVE_PIECE_OFFSET`이어도, dominant 값이 `GARBAGE_MISMATCH`라면 다음 작업은 garbage 처리 순서를 먼저 보는 것이 맞다.

### 검증

- `node --test test/testMatchService.js` 통과
- `node --test test/testMultiplayerSocket.js test/testShadowGameEngine.js` 통과
- `npm test` 통과
  - 165개 테스트 통과
- `git diff --check` 통과

## Multiplayer debug 모드 shadow summary polling 추가

### 목적

- 이전까지 shadow 상태를 보려면 브라우저 콘솔에 `game:shadow:state` 요청 코드를 직접 붙여넣어야 했다.
- 반복 실험 중에는 이 과정이 번거롭고, 콘솔 출력 형식도 매번 달라질 수 있다.
- 이번 변경은 `debug=1` 멀티 게임 화면에서 shadow summary를 자동으로 요청하고, 핵심 진단값을 고정된 `console.table` 형식으로 보여주기 위한 작업이다.

### 변경 사항

- `src/client/game/debug/multiplayerDebug.js`에 `createShadowSummaryDebugRow()`를 추가했다.
  - shadow summary를 콘솔 표에 넣기 좋은 한 줄 객체로 변환한다.
  - 포함 값:
    - `dominantReason`
    - `dominantCount`
    - `lastReason`
    - `lastSeverity`
    - `total`
    - `lastTickDelta`
    - `maxTickDelta`
    - `lastPieceDelta`
    - `maxPieceDelta`
    - `shadowTick`
    - `shadowPieceIndex`
- `src/client/net/roomClient.js`에 shadow debug용 얇은 wrapper를 추가했다.
  - `requestGameShadowState(roomId, playerId)`
  - `onGameShadowStateResult(handler)`
- `tetrisMulti.html`의 debug 모드에서 게임 세션이 시작되면 2초마다 shadow state를 요청한다.
- `game:shadow:state:result`를 받으면 `createShadowSummaryDebugRow()` 결과를 `console.table()`로 출력한다.
- 게임 세션 cleanup 시 shadow polling interval과 result listener를 함께 정리한다.

### 사용 방법

1. 로비 URL에 `?debug=1`을 붙인다.
2. 방 생성/입장 후 게임을 시작한다.
3. 멀티 게임 화면 콘솔에서 2초마다 shadow summary table이 출력되는지 확인한다.

예시:

```text
http://localhost:5000/pages/multiLobby.html?debug=1
```

### 의미

- 이제 shadow 상태 확인을 위해 별도 콘솔 코드를 붙여넣을 필요가 줄었다.
- 같은 콘솔 table 형식으로 `dominantReason`, tick delta, pieceIndex delta를 계속 볼 수 있다.
- 다음 shadow 안정화 작업에서는 이 table을 기준으로 가장 많이 반복되는 원인을 먼저 줄이면 된다.

### 검증

- `node --test test/testMultiplayerDebug.js` 통과
- `node --test test/testRoomClient.js` 통과
- `node --test test/testMultiplayerDebug.js test/testRoomClient.js test/testMultiplayerSocket.js` 통과
- `npm test` 통과
  - 169개 테스트 통과
- `git diff --check` 통과

## Shadow desync pieceIndex delta summary 추가

### 목적

- tick delta는 시간 진행 차이를 보여주지만, 조각 spawn/lock 순서가 실제로 벌어졌는지는 `pieceIndex` 차이를 봐야 더 명확하다.
- 기존에는 `lastDesync` 안의 `clientPieceIndex`, `shadowPieceIndex`를 직접 비교해야 했다.
- 이번 변경은 summary에서 pieceIndex 차이를 바로 볼 수 있게 해서, 서버 shadow와 클라이언트가 같은 조각 순서를 따라가고 있는지 빠르게 확인하기 위한 작업이다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 다음 필드를 추가했다.
  - `lastDesyncPieceIndexDelta`
  - `maxAbsoluteDesyncPieceIndexDelta`
- `lastDesyncPieceIndexDelta`는 마지막 desync의 `clientPieceIndex - shadowPieceIndex` 값이다.
  - 양수면 client가 shadow보다 더 뒤의 조각을 플레이 중이다.
  - 음수면 shadow가 client보다 더 뒤의 조각을 계산 중이다.
- `maxAbsoluteDesyncPieceIndexDelta`는 현재 보관 중인 `desyncLog` 안에서 가장 큰 pieceIndex 차이의 절대값이다.

### 콘솔 확인 방식

```js
socket.on("game:shadow:state:result", (result) => {
    const summary = result.shadow?.summary;

    console.table({
        dominantReason: summary?.dominantDesyncReason,
        lastTickDelta: summary?.lastDesyncTickDelta,
        maxTickDelta: summary?.maxAbsoluteDesyncTickDelta,
        lastPieceDelta: summary?.lastDesyncPieceIndexDelta,
        maxPieceDelta: summary?.maxAbsoluteDesyncPieceIndexDelta,
        lastReason: summary?.lastDesyncReason,
    });
});
```

### 의미

- tick delta가 커도 pieceIndex delta가 0이면, 같은 조각을 다른 위치/시간 기준으로 보고 있을 가능성이 높다.
- pieceIndex delta가 1 이상으로 반복되면, lock 이후 다음 조각 spawn 시점이나 bag 소비 순서가 어긋나는 문제로 우선 본다.
- `PIECE_INDEX_MISMATCH`와 `maxAbsoluteDesyncPieceIndexDelta`가 같이 커지면 authoritative 전환 전에 반드시 줄여야 하는 핵심 동기화 문제다.

### 검증

- `node --test test/testMatchService.js` 통과
- `node --test test/testMultiplayerSocket.js test/testShadowGameEngine.js` 통과
- `npm test` 통과
  - 165개 테스트 통과
- `git diff --check` 통과

## Shadow desync tick delta summary 추가

### 목적

- 브라우저 shadow 실험에서 `clientTick`과 `shadowTick` 차이가 크게 보이는 경우가 있었다.
- 기존에는 `lastDesync` 객체를 직접 펼쳐서 `clientTick`, `shadowTick`을 비교해야 했다.
- 이번 변경은 summary에서 tick 차이를 바로 볼 수 있게 해서, 현재 문제가 단순 activePiece 위치 차이인지 tick 진행 기준 차이인지 빠르게 구분하기 위한 작업이다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 다음 필드를 추가했다.
  - `lastDesyncTickDelta`
  - `maxAbsoluteDesyncTickDelta`
- `lastDesyncTickDelta`는 마지막 desync의 `clientTick - shadowTick` 값이다.
  - 양수면 client snapshot tick이 shadow tick보다 앞서 있다.
  - 음수면 shadow tick이 client snapshot tick보다 앞서 있다.
- `maxAbsoluteDesyncTickDelta`는 현재 보관 중인 `desyncLog` 안에서 가장 큰 tick 차이의 절대값이다.

### 콘솔 확인 방식

```js
socket.on("game:shadow:state:result", (result) => {
    const summary = result.shadow?.summary;

    console.table({
        dominantReason: summary?.dominantDesyncReason,
        lastTickDelta: summary?.lastDesyncTickDelta,
        maxTickDelta: summary?.maxAbsoluteDesyncTickDelta,
        lastReason: summary?.lastDesyncReason,
        total: summary?.desyncCount,
    });
});
```

### 의미

- reason count는 "무엇이 자주 틀리는지"를 보여준다.
- tick delta는 "시간 기준이 얼마나 어긋나는지"를 보여준다.
- `ACTIVE_PIECE_OFFSET`이 많고 tick delta가 작으면 상대적으로 낮은 우선순위의 예측 위치 차이로 볼 수 있다.
- `PIECE_INDEX_MISMATCH`와 큰 tick delta가 같이 보이면 spawn/lock/tick 진행 순서를 먼저 확인해야 한다.

### 검증

- `node --test test/testMatchService.js` 통과
- `node --test test/testMultiplayerSocket.js test/testShadowGameEngine.js` 통과
- `npm test` 통과
  - 165개 테스트 통과
- `git diff --check` 통과

## Shadow actionable desync summary 추가

### 목적

- shadow authoritative 실험의 핵심은 현재 클라이언트 게임을 멈추지 않고, 서버가 뒤에서 같은 입력과 server bag 기준으로 계산한 결과를 관찰하는 것이다.
- 이 과정에서 모든 desync가 같은 중요도를 갖지는 않는다.
  - 예: 게임 종료 후 늦게 도착한 snapshot은 `POST_GAME_SNAPSHOT`으로 남길 수는 있지만, 실제 동기화 버그의 1순위 원인으로 보기는 어렵다.
  - 반대로 `PIECE_INDEX_MISMATCH`, `SCORE_MISMATCH`, `GARBAGE_MISMATCH`는 authoritative 전환 전에 줄여야 하는 실제 검토 대상이다.
- 이번 변경은 전체 desync 통계와 실제 수정 우선순위 통계를 분리해서, 브라우저 실험 중 어떤 문제를 먼저 볼지 더 명확히 하기 위한 작업이다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 actionable desync 필드를 추가했다.
  - `actionableDesyncCount`
  - `actionableDesyncReasonCounts`
  - `dominantActionableDesyncReason`
  - `dominantActionableDesyncCount`
- `severity: "info"`인 desync는 전체 `desyncReasonCounts`에는 남기되 actionable 통계에서는 제외한다.
  - 현재 대표적인 info 항목은 `POST_GAME_SNAPSHOT`이다.
- `src/client/game/debug/multiplayerDebug.js`의 `createShadowSummaryDebugRow()`가 actionable 값을 콘솔 table에 포함하게 했다.
  - `actionableReason`
  - `actionableCount`
  - `actionableTotal`

### 실험 의미

- 기존 실험은 브라우저 2탭에서 실제 플레이를 유지하면서 shadow state를 주기적으로 조회했다.
- 이 실험으로 확인하려는 것은 다음이다.
  - 클라이언트와 서버 shadow가 같은 조각 순서(`pieceIndex`)를 유지하는가
  - 같은 입력 후 active piece 위치가 크게 벌어지는가
  - score, line clear, pending garbage 같은 게임 규칙 결과가 일치하는가
  - 게임 종료 후 남은 snapshot처럼 실제 플레이에 영향이 작은 로그가 핵심 원인처럼 보이지 않는가
- actionable summary는 마지막 항목을 해결하기 위한 진단 값이다.
  - `dominantReason`은 전체 로그에서 가장 많은 원인이다.
  - `actionableReason`은 info성 로그를 제외하고 실제로 먼저 고칠 후보를 보여준다.

### 콘솔 확인 기준

`?debug=1`로 멀티 게임을 실행하면 2초마다 shadow summary table이 출력된다.

```text
actionableReason
actionableCount
actionableTotal
dominantReason
dominantCount
lastReason
lastSeverity
total
lastTickDelta
maxTickDelta
lastPieceDelta
maxPieceDelta
shadowTick
shadowPieceIndex
```

판단 기준:

- `lastSeverity`가 `info`이고 `actionableTotal`이 낮으면, 실제 게임 흐름보다 종료 후 잔여 snapshot 같은 관찰 로그일 가능성이 높다.
- `actionableReason`이 `PIECE_INDEX_MISMATCH`로 반복되면 lock/spawn/bag 소비 순서를 먼저 본다.
- `actionableReason`이 `GARBAGE_MISMATCH`로 반복되면 공격/상쇄/가비지 적용 순서를 먼저 본다.
- `actionableReason`이 `SCORE_MISMATCH`로 반복되면 line clear, combo, back-to-back, T-Spin 점수 규칙 차이를 먼저 본다.

### 검증

- `node --test test/testMatchService.js test/testMultiplayerDebug.js` 통과
  - 34개 테스트 통과
- `npm test` 통과
  - 169개 테스트 통과
- `git diff --check` 통과

## Shadow last actionable desync summary 추가

### 목적

- `actionableReason`은 누적 기준으로 가장 많이 반복된 실제 수정 후보를 보여준다.
- 하지만 브라우저 실험 중에는 "가장 최근에 실제로 봐야 할 desync"도 필요하다.
- 마지막 desync가 `POST_GAME_SNAPSHOT`처럼 `severity: "info"`이면, `lastReason`만 보고는 방금 전까지 발생한 의미 있는 문제를 놓치기 쉽다.
- 이번 변경은 전체 마지막 desync와 actionable 마지막 desync를 분리해서 보여주기 위한 작업이다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 마지막 actionable desync 필드를 추가했다.
  - `lastActionableDesync`
  - `lastActionableDesyncSeverity`
  - `lastActionableDesyncReason`
  - `lastActionableDesyncTickDelta`
  - `lastActionableDesyncPieceIndexDelta`
- `lastActionableDesync`는 `severity !== "info"`인 desync 중 가장 최근 항목이다.
- `src/client/game/debug/multiplayerDebug.js`의 콘솔 row에도 같은 기준을 추가했다.
  - `lastActionableReason`
  - `lastActionableSeverity`
  - `lastActionableTickDelta`
  - `lastActionablePieceDelta`

### 콘솔 해석 기준

- `lastReason`은 가장 최근에 들어온 모든 desync를 보여준다.
- `lastActionableReason`은 info 로그를 제외한 가장 최근 desync를 보여준다.
- 예를 들어:

```text
lastReason: POST_GAME_SNAPSHOT
lastSeverity: info
lastActionableReason: SCORE_MISMATCH
lastActionableSeverity: medium
```

위 경우 마지막 로그 자체는 종료 후 snapshot이지만, 실제 다음 점검 후보는 score 규칙 차이다.

### 의미

- 이제 debug table에서 세 가지 관점을 동시에 볼 수 있다.
  - `lastReason`: 방금 들어온 마지막 차이
  - `lastActionableReason`: 방금 전까지 실제로 봐야 할 마지막 차이
  - `actionableReason`: 누적 기준으로 가장 반복되는 실제 수정 후보
- 이 구조는 shadow mode에서 관찰 로그가 많아져도, 종료 후 잔여 이벤트와 실제 동기화 문제를 섞어 보지 않게 해준다.

### 검증

- `node --test test/testMatchService.js test/testMultiplayerDebug.js` 통과
  - 34개 테스트 통과
- `npm test` 통과
  - 169개 테스트 통과
- `git diff --check` 통과

## Shadow line clear animation snapshot 분류 추가

### 목적

- 클라이언트 runtime은 줄 삭제 시 `lineClearing` phase로 들어가고, 350ms 애니메이션이 끝난 뒤 실제 line clear, 점수, 다음 스폰을 확정한다.
- 서버 shadow engine은 DOM/canvas 애니메이션이 없기 때문에 같은 상황을 즉시 계산하고 다음 상태로 넘어간다.
- 이 차이는 현재 shadow mode에서 예상 가능한 과도 상태다.
- 기존 분류는 `lineClearing` 중 snapshot이 들어오면 `pieceIndex`, `phase`, `score`, `linesClearedTotal` 차이 때문에 `PIECE_INDEX_MISMATCH`나 `PHASE_MISMATCH`처럼 actionable 문제로 보일 수 있었다.
- 이번 변경은 line clear 애니메이션 중 snapshot을 실제 동기화 오류가 아니라 info성 관찰 로그로 분류하기 위한 작업이다.

### 변경 사항

- `recordClientSnapshot()`의 desync 분류에서 client 또는 shadow snapshot의 phase가 `lineClearing`이면 다음 reason을 사용한다.
  - `severity: "info"`
  - `primaryReason: "LINE_CLEAR_ANIMATION_SNAPSHOT"`
- `severity: "info"`이므로 기존 actionable summary에서는 제외된다.
  - `actionableDesyncCount`
  - `actionableDesyncReasonCounts`
  - `dominantActionableDesyncReason`
  - `lastActionableDesyncReason`
- `test/testMatchService.js`에 line clear animation snapshot 분류 테스트를 추가했다.

### 의미

- 이제 줄 삭제 애니메이션 중 일시적으로 들어온 snapshot이 실제 수정 우선순위를 오염시키지 않는다.
- debug table에서 다음처럼 보이면 line clear 애니메이션 중간 snapshot으로 해석한다.

```text
lastReason: LINE_CLEAR_ANIMATION_SNAPSHOT
lastSeverity: info
```

- 이 값이 마지막 로그로 보여도 `lastActionableReason`과 `actionableReason`을 보면 실제로 다음에 고쳐야 할 후보를 계속 확인할 수 있다.
- 서버 authoritative 전환 전까지 client animation phase와 server calculation phase가 완전히 같을 필요는 없지만, 이 차이를 명확히 분류해 두면 실제 `PIECE_INDEX_MISMATCH`를 더 정확히 찾을 수 있다.

### 검증

- `node --test test/testMatchService.js` 통과
  - 30개 테스트 통과
- `node --test test/testMatchService.js test/testMultiplayerSocket.js test/testMultiplayerDebug.js` 통과
  - 71개 테스트 통과
- `npm test` 통과
  - 170개 테스트 통과
- `git diff --check` 통과

## Shadow input tick 진단 summary 추가

### 목적

- 현재 shadow mode에서는 `game:input` payload의 `tick`을 shadow state에 함께 반영한다.
- 이 구조는 클라이언트 입력 tick과 서버 shadow loop tick이 섞여 보일 수 있다.
- 이전부터 장기 과제로 `serverShadowTick`과 `clientTick` 분리가 남아 있었지만, 바로 루프 구조를 바꾸면 영향 범위가 크다.
- 이번 변경은 구조를 바로 바꾸기 전에, 마지막으로 적용된 input tick과 현재 shadow tick의 차이를 debug table에서 관찰할 수 있게 만든 작업이다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 마지막 shadow input 정보를 추가했다.
  - `lastShadowInputTick`
  - `lastShadowInputPieceIndex`
  - `lastShadowInputSequence`
  - `lastShadowInputToShadowTickDelta`
- `lastShadowInputToShadowTickDelta`는 다음 값이다.

```text
lastShadowInputTick - shadowTick
```

- `src/client/game/debug/multiplayerDebug.js`의 console table row에도 같은 값을 추가했다.
  - `lastInputTick`
  - `lastInputPieceIndex`
  - `lastInputSequence`
  - `inputToShadowTickDelta`

### 의미

- `lastTickDelta`는 client snapshot tick과 shadow snapshot tick의 차이다.
- `inputToShadowTickDelta`는 마지막으로 서버 shadow에 적용된 input tick이 현재 shadow tick과 얼마나 떨어져 있는지 보여준다.
- 예를 들어 `inputToShadowTickDelta`가 `-2`라면, 마지막 input tick 이후 shadow gravity가 2 tick 더 진행된 상태로 볼 수 있다.
- 이 값은 실제 게임 상태를 바꾸지 않는다.
- 다음 단계에서 server shadow tick과 client input tick을 분리할 때, 어느 방향으로 분리해야 하는지 판단하는 관찰 값이다.

### 콘솔 확인 기준

`?debug=1` 멀티 게임 화면의 shadow summary table에서 다음 값을 본다.

```text
lastInputTick
lastInputPieceIndex
lastInputSequence
inputToShadowTickDelta
shadowTick
lastTickDelta
```

판단 기준:

- `lastTickDelta`만 크고 `inputToShadowTickDelta`가 작으면 snapshot 전송/수신 시점 차이를 먼저 의심한다.
- `inputToShadowTickDelta`가 계속 크게 벌어지면 shadow gravity loop와 input 적용 순서 차이를 먼저 본다.
- `pieceIndex` mismatch와 함께 input tick 차이가 커지면 lock/spawn 시점의 순서 보장이 다음 점검 대상이다.

### 검증

- `node --test test/testMatchService.js test/testMultiplayerDebug.js` 통과
  - 36개 테스트 통과
- `node --test test/testMatchService.js test/testMultiplayerSocket.js test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 74개 테스트 통과
- `npm test` 통과
  - 171개 테스트 통과
- `git diff --check` 통과

## Shadow input tick과 server shadow tick 분리

### 목적

- 이전 단계에서는 `game:input` payload의 client tick을 서버 shadow state의 `tick`에 직접 반영했다.
- 이 구조에서는 서버가 실제로 몇 번 gravity simulation을 진행했는지와, 클라이언트가 입력을 보낸 시점이 같은 값처럼 섞여 보였다.
- 그래서 shadow summary에서 `shadowTick`이 클라이언트 runtime tick처럼 크게 뛰고, desync 원인을 해석할 때 다음 두 질문이 구분되지 않았다.
  - 클라이언트 입력이 언제 발생했는가?
  - 서버 shadow simulation은 어디까지 진행됐는가?
- 이번 변경은 shadow authoritative 전환을 위한 중간 정리다. 아직 서버 결과를 클라이언트에 강제 적용하지 않고, tick 의미만 먼저 분리했다.

### 변경 사항

- `src/server/services/shadowGameEngine.js`의 shadow state에 client input 기준 값을 추가했다.
  - `lastClientInputTick`
  - `lastClientInputPieceIndex`
- `input` step은 더 이상 `state.tick`을 증가시키지 않는다.
  - 대신 마지막으로 받은 client input tick과 pieceIndex만 별도 필드에 기록한다.
  - 실제 이동, 회전, hard drop 같은 입력 적용은 기존처럼 shadow state에 반영한다.
- `gravity` step만 서버 shadow tick을 진행한다.
  - 즉, `state.tick`은 이제 "서버 shadow simulation이 진행한 tick"으로 읽는다.
- `createShadowSnapshot()`에 마지막 client input 정보를 포함했다.
  - shadow snapshot과 summary에서 입력 시점과 서버 진행 시점을 함께 비교할 수 있다.
- 테스트 기대값을 새 의미에 맞게 바꿨다.
  - input만 적용하면 activePiece는 움직이지만 `shadowTick`은 증가하지 않아야 한다.
  - gravity를 적용해야 `shadowTick`이 증가해야 한다.
  - `lastShadowInputToShadowTickDelta`는 client input tick과 server shadow tick의 차이로 해석한다.

### 의미

- 이제 shadow debug 값은 다음처럼 나눠서 읽는다.

```text
lastInputTick
  -> 클라이언트가 입력을 보낸 게임 tick

shadowTick
  -> 서버 shadow simulation이 gravity 기준으로 진행한 tick

inputToShadowTickDelta
  -> 마지막 input tick과 현재 server shadow tick의 차이
```

- 예를 들어 `lastInputTick`이 10이고 `shadowTick`이 2라면, 클라이언트 입력은 tick 10 기준으로 왔지만 서버 shadow simulation은 아직 gravity 2 tick까지만 진행한 상태다.
- 이 값이 크다고 바로 버그는 아니다.
  - 현재 shadow mode는 실제 플레이를 멈추지 않고 뒤에서 비교하는 구조라서 client tick과 server tick이 완전히 같을 필요는 없다.
  - 다만 pieceIndex mismatch나 board mismatch와 함께 계속 커진다면, 다음 단계에서 input replay 순서와 서버 gravity loop 간격을 점검해야 한다.
- 이번 변경으로 client tick이 server shadow tick을 오염시키지 않게 되었고, 이후 서버 authoritative loop를 만들 때 `serverTick`을 더 명확하게 사용할 수 있다.

### 콘솔 확인 기준

`?debug=1` 멀티 게임 화면에서 shadow summary를 보면 다음 값을 함께 확인한다.

```text
shadowTick
lastInputTick
lastInputPieceIndex
inputToShadowTickDelta
lastReason
lastSeverity
actionableReason
```

해석 기준:

- `lastReason`이 `LINE_CLEAR_ANIMATION_SNAPSHOT`이고 `lastSeverity`가 `info`면 줄 삭제 애니메이션 중 과도 상태로 본다.
- `actionableReason`이 계속 `PIECE_INDEX_MISMATCH`로 쌓이면 실제 lock/spawn 순서 차이를 의심한다.
- `inputToShadowTickDelta`가 계속 커지면 client input tick과 server gravity tick의 진행 속도 차이를 먼저 본다.
- `shadowTick`은 더 이상 client tick을 따라 커지는 값이 아니라 server shadow simulation 진행량이다.

### 검증

- `node --test test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 84개 테스트 통과
- `npm test` 통과
  - 171개 테스트 통과
- `git diff --check` 통과

## Shadow snapshot tick delta summary 추가

### 목적

- 직전 변경에서 client input tick과 server shadow tick을 분리했다.
- 하지만 브라우저 debug table에서는 여전히 "마지막 client snapshot tick"과 "마지막 shadow snapshot tick"의 직접 차이를 desync가 발생한 경우에만 간접적으로 봐야 했다.
- shadow mode에서는 desync가 없어도 client snapshot이 어느 tick 기준으로 들어왔고, 서버 shadow snapshot이 어느 tick 기준인지 계속 확인할 수 있어야 한다.
- 이번 변경은 input tick 차이와 snapshot tick 차이를 분리해서 관찰하기 위한 작은 진단 보강이다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 마지막 snapshot tick 비교값을 추가했다.
  - `lastClientSnapshotTick`
  - `lastShadowSnapshotTick`
  - `lastClientSnapshotToShadowTickDelta`
- `lastClientSnapshotToShadowTickDelta`는 다음 값이다.

```text
lastClientSnapshotTick - lastShadowSnapshotTick
```

- `src/client/game/debug/multiplayerDebug.js`의 console table row에도 같은 값을 추가했다.
  - `clientSnapshotTick`
  - `shadowSnapshotTick`
  - `snapshotToShadowTickDelta`
- 기존 input tick 진단값은 그대로 유지한다.
  - `lastInputTick`
  - `inputToShadowTickDelta`

### 의미

- 이제 debug table에서 tick 차이를 두 갈래로 나누어 읽을 수 있다.

```text
inputToShadowTickDelta
  -> 마지막 입력 tick과 서버 shadow tick의 차이

snapshotToShadowTickDelta
  -> 마지막 client snapshot tick과 마지막 shadow snapshot tick의 차이
```

- `inputToShadowTickDelta`가 크면 입력 적용 시점과 서버 shadow gravity 진행 속도를 먼저 본다.
- `snapshotToShadowTickDelta`가 크면 snapshot 전송 주기, snapshot 수신 시점, client runtime tick과 server shadow loop tick의 기준 차이를 먼저 본다.
- 둘 다 작지만 `BOARD_MISMATCH`나 `PIECE_INDEX_MISMATCH`가 반복되면 tick보다 lock/spawn/line clear 후처리 순서를 의심한다.
- 이 변경은 게임 화면을 바꾸지 않는다. shadow authoritative 전환 전에 관찰값을 더 명확히 분리하는 작업이다.

### 콘솔 확인 기준

`?debug=1` 멀티 게임 화면의 shadow summary table에서 다음 값을 함께 본다.

```text
lastInputTick
inputToShadowTickDelta
clientSnapshotTick
shadowSnapshotTick
snapshotToShadowTickDelta
shadowTick
lastReason
actionableReason
```

해석 기준:

- `snapshotToShadowTickDelta`만 크면 snapshot 주기/루프 기준 차이를 먼저 의심한다.
- `inputToShadowTickDelta`와 `snapshotToShadowTickDelta`가 둘 다 크면 server shadow loop 진행 속도와 client runtime tick 기준을 같이 본다.
- `actionableReason`이 `PIECE_INDEX_MISMATCH`로 반복되면 tick 차이보다 실제 조각 lock/spawn 순서 차이가 더 중요할 수 있다.

### 검증

- `node --test test/testMatchService.js test/testMultiplayerDebug.js` 통과
  - 37개 테스트 통과
- `node --test test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 85개 테스트 통과
- `npm test` 통과
  - 172개 테스트 통과
- `git diff --check` 통과

## Shadow snapshot pieceIndex delta summary 추가

### 목적

- 직전 단계에서는 마지막 client snapshot tick과 shadow snapshot tick의 차이를 debug table에서 볼 수 있게 했다.
- 하지만 멀티 동기화에서 더 중요한 기준은 시간 차이뿐 아니라 "서로 같은 조각 순서를 보고 있는가"다.
- 기존에는 `pieceIndex` 차이를 desync가 발생한 로그 안에서만 확인해야 했다.
- 이번 변경은 desync 유무와 관계없이 마지막 client snapshot과 마지막 shadow snapshot의 `pieceIndex` 차이를 항상 summary에서 볼 수 있게 만든 작업이다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 마지막 snapshot pieceIndex 비교값을 추가했다.
  - `lastClientSnapshotPieceIndex`
  - `lastShadowSnapshotPieceIndex`
  - `lastClientSnapshotToShadowPieceIndexDelta`
- `lastClientSnapshotToShadowPieceIndexDelta`는 다음 값이다.

```text
lastClientSnapshotPieceIndex - lastShadowSnapshotPieceIndex
```

- `src/client/game/debug/multiplayerDebug.js`의 console table row에도 같은 값을 추가했다.
  - `clientSnapshotPieceIndex`
  - `shadowSnapshotPieceIndex`
  - `snapshotToShadowPieceIndexDelta`

### 의미

- 이제 shadow debug table에서 tick 차이와 pieceIndex 차이를 분리해서 볼 수 있다.

```text
snapshotToShadowTickDelta
  -> 마지막 client snapshot과 shadow snapshot의 시간 기준 차이

snapshotToShadowPieceIndexDelta
  -> 마지막 client snapshot과 shadow snapshot의 조각 순서 차이
```

- `snapshotToShadowTickDelta`가 크고 `snapshotToShadowPieceIndexDelta`가 0이면, 같은 조각을 다른 시간 기준으로 보고 있을 가능성이 크다.
- `snapshotToShadowPieceIndexDelta`가 양수면 client가 shadow보다 더 뒤의 조각을 플레이 중이다.
- `snapshotToShadowPieceIndexDelta`가 음수면 shadow가 client보다 더 뒤의 조각을 계산 중이다.
- 이 값이 계속 0이 아니면 서버 authoritative 전환 전에 lock/spawn 순서, hard drop 처리, line clear 후처리 순서를 먼저 맞춰야 한다.

### 콘솔 확인 기준

`?debug=1` 멀티 게임 화면의 shadow summary table에서 다음 값을 함께 본다.

```text
clientSnapshotTick
shadowSnapshotTick
snapshotToShadowTickDelta
clientSnapshotPieceIndex
shadowSnapshotPieceIndex
snapshotToShadowPieceIndexDelta
lastReason
actionableReason
```

해석 기준:

- tick delta만 크고 pieceIndex delta가 0이면 상대적으로 낮은 우선순위의 시간 진행 차이로 본다.
- pieceIndex delta가 0이 아니고 `PIECE_INDEX_MISMATCH`가 반복되면 실제 게임 진행 순서 차이를 우선 조사한다.
- pieceIndex delta가 커지다가 `LINE_CLEAR_ANIMATION_SNAPSHOT`으로만 분류되면 line clear 애니메이션 중 과도 상태일 가능성을 함께 본다.

### 검증

- `node --test test/testMatchService.js test/testMultiplayerDebug.js` 통과
  - 38개 테스트 통과
- `node --test test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 86개 테스트 통과
- `npm test` 통과
  - 173개 테스트 통과
- `git diff --check` 통과

## Shadow snapshot phase summary 추가

### 목적

- 이전 단계에서 snapshot tick 차이와 pieceIndex 차이를 debug table에서 볼 수 있게 했다.
- 하지만 `lineClearing`처럼 client runtime에만 존재하는 애니메이션 phase는 tick/pieceIndex만으로 바로 구분하기 어렵다.
- 기존에는 마지막 desync reason이 `LINE_CLEAR_ANIMATION_SNAPSHOT`인지 보거나, `lastDesync.details.phase`를 직접 펼쳐야 client/shadow phase 차이를 확인할 수 있었다.
- 이번 변경은 마지막 client snapshot과 shadow snapshot의 phase를 summary에서 항상 볼 수 있게 해서, 애니메이션 중 과도 상태와 실제 진행 순서 문제를 더 빨리 구분하기 위한 작업이다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 마지막 snapshot phase 비교값을 추가했다.
  - `lastClientSnapshotPhase`
  - `lastShadowSnapshotPhase`
  - `lastClientSnapshotPhaseMismatch`
- `lastClientSnapshotPhaseMismatch`는 둘 다 phase가 있을 때만 boolean으로 계산한다.
  - 둘 중 하나라도 phase가 없으면 `null`
  - 둘이 같으면 `false`
  - 둘이 다르면 `true`
- `src/client/game/debug/multiplayerDebug.js`의 console table row에도 같은 값을 추가했다.
  - `clientSnapshotPhase`
  - `shadowSnapshotPhase`
  - `snapshotPhaseMismatch`

### 의미

- 이제 shadow debug table에서 다음 세 축을 함께 볼 수 있다.

```text
snapshotToShadowTickDelta
  -> 시간 기준 차이

snapshotToShadowPieceIndexDelta
  -> 조각 순서 차이

snapshotPhaseMismatch
  -> client/shadow phase 차이
```

- `snapshotPhaseMismatch`가 `true`이고 client phase가 `lineClearing`이면, 줄 삭제 애니메이션 중 과도 상태일 가능성이 크다.
- phase가 같고 pieceIndex delta도 0인데 board mismatch가 반복되면, 애니메이션보다는 board 계산/garbage/lock 후처리를 의심한다.
- phase가 다르면서 `PIECE_INDEX_MISMATCH`도 반복되면, line clear 후 다음 조각 spawn 시점 차이를 우선 본다.

### 콘솔 확인 기준

`?debug=1` 멀티 게임 화면의 shadow summary table에서 다음 값을 함께 본다.

```text
clientSnapshotPhase
shadowSnapshotPhase
snapshotPhaseMismatch
snapshotToShadowTickDelta
snapshotToShadowPieceIndexDelta
lastReason
actionableReason
```

해석 기준:

- `clientSnapshotPhase: lineClearing`, `shadowSnapshotPhase: playing`, `lastReason: LINE_CLEAR_ANIMATION_SNAPSHOT`이면 정보성 과도 상태로 본다.
- `snapshotPhaseMismatch: false`인데 `BOARD_MISMATCH`가 반복되면 실제 board 계산 차이를 의심한다.
- `snapshotPhaseMismatch: true`와 `PIECE_INDEX_MISMATCH`가 같이 반복되면 lock/spawn/line clear 확정 순서를 우선 조사한다.

### 검증

- `node --test test/testMatchService.js test/testMultiplayerDebug.js` 통과
  - 39개 테스트 통과
- `node --test test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 87개 테스트 통과
- `npm test` 통과
  - 174개 테스트 통과
- `git diff --check` 통과

## Shadow authoritative debug 실험 정리 및 board checksum summary 추가

### 목적

- 현재 멀티플레이는 여전히 client prediction 구조로 동작한다.
  - 각 브라우저가 자기 게임을 직접 진행한다.
  - 서버는 input, snapshot, bag, garbage 이벤트를 중계하고 일부 상태를 기록한다.
- 최종 목표는 서버 authoritative 구조지만, 바로 전환하면 화면 동작과 서버 계산이 동시에 바뀌어서 원인 추적이 어려워진다.
- 그래서 현재 단계에서는 shadow authoritative 실험을 먼저 진행한다.
  - 실제 게임 화면은 기존 클라이언트 계산을 그대로 사용한다.
  - 서버는 같은 input과 server bag을 기준으로 뒤에서 shadow state를 계산한다.
  - 클라이언트가 보내는 snapshot과 서버 shadow snapshot을 비교한다.
  - 차이가 나도 게임에는 강제 적용하지 않고 debug summary와 desync log로만 관찰한다.

### 지금까지의 실험 의미

- `game:input` 실험
  - 플레이어 입력이 서버에 기록되고 상대에게 relay되는지 확인한다.
  - shadow state도 같은 입력을 받아 계산할 준비가 되었는지 확인한다.
- `game:snapshot` 실험
  - 클라이언트가 실제로 보고 있는 상태를 서버에 보낸다.
  - 서버는 마지막 client snapshot과 shadow snapshot을 비교해 desync 여부를 판단한다.
- `game:shadow:state` debug 실험
  - 브라우저 콘솔에서 현재 shadow summary를 조회한다.
  - 실시간 게임에는 영향을 주지 않고 서버가 계산한 상태와 client snapshot 차이를 확인한다.
- `?debug=1` 실험
  - shadow summary를 주기적으로 console table로 확인한다.
  - 빠른 입력, hard drop, line clear, game over 같은 상황에서 어떤 값이 어긋나는지 관찰한다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 마지막 snapshot board 비교값을 추가했다.
  - `lastClientSnapshotBoardChecksum`
  - `lastShadowSnapshotBoardChecksum`
  - `lastClientSnapshotBoardMismatch`
- `src/client/game/debug/multiplayerDebug.js`의 console table row에도 같은 값을 추가했다.
  - `clientBoardChecksum`
  - `shadowBoardChecksum`
  - `snapshotBoardMismatch`
- board checksum은 `JSON.stringify(board)` 결과를 기준으로 만든 디버그용 짧은 hash다.
  - 보안용 hash가 아니다.
  - 전체 board 배열을 매번 펼쳐 보지 않고도 client/shadow board가 같은지 빠르게 확인하기 위한 값이다.

### 의미

- 이제 shadow debug table에서 다음 네 축을 함께 볼 수 있다.

```text
snapshotToShadowTickDelta
  -> 시간 기준 차이

snapshotToShadowPieceIndexDelta
  -> 조각 순서 차이

snapshotPhaseMismatch
  -> client/shadow phase 차이

snapshotBoardMismatch
  -> client/shadow board 차이
```

- `snapshotBoardMismatch: false`이면 마지막 client snapshot과 shadow snapshot의 board가 같은 상태로 본다.
- `snapshotBoardMismatch: true`인데 `snapshotPhaseMismatch: true`이고 client phase가 `lineClearing`이면 애니메이션 중 과도 상태일 수 있다.
- `snapshotBoardMismatch: true`이고 phase/pieceIndex 차이가 없으면 board 계산, lock 처리, line clear 후처리, garbage 적용 순서를 우선 의심한다.
- `snapshotBoardMismatch: true`와 `snapshotToShadowPieceIndexDelta`가 함께 커지면 조각 spawn/lock 순서가 어긋났을 가능성이 크다.

### 콘솔 확인 기준

`?debug=1` 멀티 게임 화면의 shadow summary table에서 다음 값을 함께 본다.

```text
clientBoardChecksum
shadowBoardChecksum
snapshotBoardMismatch
clientSnapshotPhase
shadowSnapshotPhase
snapshotPhaseMismatch
snapshotToShadowPieceIndexDelta
lastReason
actionableReason
```

해석 기준:

- board checksum이 같고 desync reason이 activePiece 중심이면 상대적으로 낮은 위험으로 본다.
- board checksum이 다르고 phase가 같으면 실제 게임 상태 계산 차이일 가능성이 높다.
- board checksum이 다르지만 phase가 `lineClearing`이면 animation snapshot으로 분류되는지 함께 본다.
- board mismatch가 지속되면 서버 authoritative 전환 전에 board/garbage/lock/line clear 순서를 먼저 맞춘다.

### 검증

- `node --test test/testMatchService.js test/testMultiplayerDebug.js` 통과
  - 40개 테스트 통과
- `node --test test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 88개 테스트 통과
- `npm test` 통과
  - 175개 테스트 통과
- `git diff --check` 통과

## Shadow health summary 추가

### 목적

- shadow debug summary에 tick, pieceIndex, phase, board checksum이 추가되면서 관찰 가능한 값은 늘어났다.
- 하지만 콘솔에서 매번 여러 필드를 조합해서 "지금 이 desync가 조치 대상인지" 판단해야 했다.
- 이번 변경은 shadow 상태를 사람이 바로 볼 수 있는 health 값으로 요약해서, debug table의 첫 판단 기준을 만들기 위한 작업이다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 `shadowHealth`를 추가했다.
- `src/client/game/debug/multiplayerDebug.js`의 console table row에 `health`를 추가했다.
- health 값은 현재 다음 세 가지다.

```text
stable
  -> desync log가 없음

info_only
  -> desync는 있지만 모두 정보성 desync임
     예: game over 이후 snapshot, line clear animation 중 snapshot

needs_attention
  -> 하나 이상 actionable desync가 있음
     예: pieceIndex, board, garbage, score, line clear mismatch
```

### 의미

- 이제 `?debug=1` 멀티 게임 화면의 shadow summary table에서 `health`를 먼저 보면 된다.
- `stable`이면 현재 서버 shadow와 client snapshot 사이에서 관찰된 차이가 없다.
- `info_only`이면 차이는 있지만 현재 기준으로는 게임 종료 후 snapshot이나 애니메이션 과도 상태처럼 직접 조치할 우선순위가 낮다.
- `needs_attention`이면 서버 authoritative 전환 전에 원인을 줄여야 하는 차이가 있다는 뜻이다.
- 이 값은 게임에 영향을 주지 않는 debug summary다.
  - 클라이언트 보정 정책을 바꾸지 않는다.
  - 서버 authoritative snapshot을 강제 적용하지 않는다.

### 콘솔 확인 기준

`?debug=1` 멀티 게임 화면의 shadow summary table에서 다음 순서로 본다.

```text
health
actionableReason
snapshotBoardMismatch
snapshotToShadowPieceIndexDelta
snapshotPhaseMismatch
lastReason
```

해석 기준:

- `health: stable`
  - 현재 관찰된 shadow/client 차이가 없다.
- `health: info_only`
  - `lastReason`이 `LINE_CLEAR_ANIMATION_SNAPSHOT` 또는 `POST_GAME_SNAPSHOT`인지 확인한다.
- `health: needs_attention`
  - `actionableReason`을 우선 본다.
  - `PIECE_INDEX_MISMATCH`면 lock/spawn 순서부터 본다.
  - `BOARD_MISMATCH`면 board/garbage/line clear 적용 순서부터 본다.
  - `GARBAGE_MISMATCH`면 garbage queue와 cancel/apply 타이밍을 본다.

### 검증

- `node --test test/testMatchService.js test/testMultiplayerDebug.js` 통과
  - 41개 테스트 통과
- `node --test test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 89개 테스트 통과
- `npm test` 통과
  - 176개 테스트 통과
- `git diff --check` 통과

## Shadow pieceIndex direction summary 추가

### 목적

- `PIECE_INDEX_MISMATCH`가 발생했을 때 단순히 조각 순서가 다르다는 것만으로는 다음 조치가 모호했다.
- 중요한 것은 "client가 server shadow보다 앞서 있는지" 또는 "server shadow가 client보다 앞서 있는지"다.
- 이번 변경은 마지막 client snapshot과 shadow snapshot의 pieceIndex 차이 방향을 summary/debug table에서 바로 볼 수 있게 해서, 다음 원인 분석의 출발점을 명확하게 만드는 작업이다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 `lastClientSnapshotToShadowPieceIndexDirection`을 추가했다.
- `src/client/game/debug/multiplayerDebug.js`의 console table row에 `snapshotPieceIndexDirection`을 추가했다.
- 방향 값은 다음과 같다.

```text
client_ahead
  -> client snapshot pieceIndex가 shadow snapshot보다 큼

shadow_ahead
  -> shadow snapshot pieceIndex가 client snapshot보다 큼

in_sync
  -> client/shadow pieceIndex가 같음

null
  -> 둘 중 하나의 pieceIndex를 판단할 수 없음
```

### 의미

- `client_ahead`가 반복되면 클라이언트가 서버 shadow보다 먼저 lock/spawn을 진행하고 있다는 뜻이다.
  - shadow gravity loop가 느린지 확인한다.
  - hard drop/input이 shadow에 즉시 반영되는지 확인한다.
  - client snapshot 전송 시점이 lock 직후인지 line clear animation 중인지 함께 본다.
- `shadow_ahead`가 반복되면 서버 shadow가 클라이언트보다 먼저 lock/spawn을 진행하고 있다는 뜻이다.
  - shadow gravity가 너무 빠른지 확인한다.
  - client 쪽 lock delay, line clear delay, animation phase를 확인한다.
- `in_sync`인데 board mismatch가 반복되면 조각 순서 문제가 아니라 board/garbage/line clear 적용 순서를 의심한다.

### 콘솔 확인 기준

`?debug=1` 멀티 게임 화면의 shadow summary table에서 다음 값을 함께 본다.

```text
health
actionableReason
snapshotToShadowPieceIndexDelta
snapshotPieceIndexDirection
snapshotPhaseMismatch
snapshotBoardMismatch
```

해석 기준:

- `health: needs_attention`, `actionableReason: PIECE_INDEX_MISMATCH`, `snapshotPieceIndexDirection: client_ahead`
  - client 진행이 shadow보다 빠른 케이스다.
- `health: needs_attention`, `actionableReason: PIECE_INDEX_MISMATCH`, `snapshotPieceIndexDirection: shadow_ahead`
  - shadow 진행이 client보다 빠른 케이스다.
- `snapshotPieceIndexDirection: in_sync`, `snapshotBoardMismatch: true`
  - pieceIndex보다 board 계산 순서를 우선 본다.

### 검증

- `node --test test/testMatchService.js test/testMultiplayerDebug.js` 통과
  - 42개 테스트 통과
- `node --test test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 90개 테스트 통과
- `npm test` 통과
  - 177개 테스트 통과
- `git diff --check` 통과

## Shadow lineClearing phase 반영

### 목적

- `PIECE_INDEX_MISMATCH`의 실제 원인 후보 중 하나는 line clear 처리 시점 차이였다.
- 클라이언트 런타임은 줄 삭제가 발생하면 다음 순서로 진행한다.

```text
piece lock
  -> board에 조각 반영
  -> activePiece 비움
  -> phase: lineClearing
  -> line clear animation 후 줄 삭제/점수/garbage/다음 조각 spawn
```

- 반면 기존 shadow engine은 줄 삭제가 발생한 lock에서 즉시 줄을 지우고 다음 조각을 spawn했다.
- 이러면 client가 아직 `lineClearing` phase인 동안 shadow는 이미 다음 `pieceIndex`로 넘어가서 `shadow_ahead` 방향의 mismatch가 생길 수 있다.

### 변경 사항

- `src/server/services/shadowGameEngine.js`에 `lineClearing` phase를 추가했다.
- line clear가 발생한 lock에서는 shadow도 즉시 다음 조각을 spawn하지 않는다.
  - board에는 고정된 조각이 반영된 상태를 유지한다.
  - activePiece는 빈 조각으로 비운다.
  - phase를 `lineClearing`으로 바꾼다.
  - pieceIndex는 증가시키지 않는다.
- 다음 `gravity` step에서 line clear를 완료한다.
  - full row 삭제
  - score / linesClearedTotal 갱신
  - combo / back-to-back / T-Spin 공격 계산
  - pending garbage cancel/apply
  - 다음 조각 spawn
  - phase를 `playing`으로 복귀

### 의미

- shadow mode가 클라이언트의 line clear 중간 상태를 더 잘 따라가게 되었다.
- line clear 직후의 snapshot에서 `PIECE_INDEX_MISMATCH`가 정보성 phase 차이와 섞이는 상황을 줄인다.
- `snapshotPieceIndexDirection: shadow_ahead`가 반복될 때 line clear animation 시점 차이인지 확인하기 쉬워졌다.
- 아직 서버 authoritative 완전 전환은 아니다.
  - 클라이언트 화면은 그대로 client prediction으로 동작한다.
  - shadow 계산 결과를 클라이언트에 강제 적용하지 않는다.

### 검증

- `node --test test/testShadowGameEngine.js` 통과
  - 12개 테스트 통과
- `node --test test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 92개 테스트 통과
- `npm test` 통과
  - 179개 테스트 통과
- `git diff --check` 통과

## Shadow input/client snapshot tick delta 추가

### 목적

- shadow debug 콘솔에서 `lastShadowInputToShadowTickDelta`만 보면 입력 반영 지연을 오해할 수 있었다.
- 이 값은 client input의 `tick`과 server shadow gravity의 `shadowTick`을 비교한다.
- 두 값은 같은 주기로 증가하는 tick이 아니다.
  - client input tick은 클라이언트 게임 루프 기준이다.
  - shadowTick은 서버 shadow gravity loop 기준이다.
- 따라서 `lastShadowInputToShadowTickDelta`는 대략적인 참고값으로는 쓸 수 있지만, "입력 후 client snapshot이 얼마나 뒤에 왔는지"를 판단하는 기준으로 쓰면 안 된다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 `lastShadowInputToClientSnapshotTickDelta`를 추가했다.
- `src/client/game/debug/multiplayerDebug.js`의 debug table row에 `inputToClientSnapshotTickDelta`를 추가했다.
- 계산 기준은 다음과 같다.

```text
lastClientSnapshot.tick - lastShadowInput.tick
```

- 이 값은 둘 다 클라이언트 tick 기준이므로, 기존 `inputToShadowTickDelta`보다 입력과 snapshot 사이의 시간 관계를 해석하기 쉽다.

### 의미

- `inputToClientSnapshotTickDelta > 0`
  - 마지막 client snapshot이 마지막 input보다 뒤의 client tick에서 만들어졌다.
  - 일반적인 상황에서는 이 값이 양수로 나오는 것이 자연스럽다.
- `inputToClientSnapshotTickDelta === 0`
  - 마지막 input과 마지막 client snapshot이 같은 client tick 기준으로 기록됐다.
- `inputToClientSnapshotTickDelta < 0`
  - 마지막 input보다 오래된 client snapshot을 보고 있거나, 이벤트 관측 순서가 뒤섞였을 수 있다.
  - 이 경우 snapshot 전송/수신 순서와 debug socket 조회 시점을 먼저 확인한다.
- `null`
  - 마지막 input tick 또는 마지막 client snapshot tick 중 하나가 없어서 비교할 수 없다.

### 기존 값과의 차이

```text
inputToShadowTickDelta
  -> client input tick과 server shadow gravity tick 비교
  -> 서로 다른 단위가 섞여 있으므로 참고 신호로만 사용

inputToClientSnapshotTickDelta
  -> client input tick과 client snapshot tick 비교
  -> 같은 단위이므로 입력 이후 snapshot 흐름 확인에 우선 사용
```

### 콘솔 확인 기준

`?debug=1` 멀티 게임 화면의 shadow summary table에서 다음 값을 함께 본다.

```text
inputToClientSnapshotTickDelta
inputToShadowTickDelta
snapshotToShadowTickDelta
snapshotToShadowPieceIndexDelta
snapshotPieceIndexDirection
health
actionableReason
```

해석 순서:

1. 먼저 `inputToClientSnapshotTickDelta`로 마지막 입력과 마지막 client snapshot의 상대 시점을 본다.
2. 그 다음 `snapshotToShadowPieceIndexDelta`와 `snapshotPieceIndexDirection`으로 client와 shadow 중 어느 쪽이 앞서는지 본다.
3. 마지막으로 `inputToShadowTickDelta`는 shadow gravity loop와 입력 tick의 대략적인 차이를 보는 보조 값으로만 사용한다.

### 검증

- `node --test test/testMatchService.js test/testMultiplayerDebug.js` 통과
  - 43개 테스트 통과

## Shadow recent desync window summary 추가

### 목적

- shadow debug summary의 누적 `shadowHealth`는 전체 `desyncLog`를 기준으로 계산된다.
- 그래서 게임 초반에 발생한 actionable desync가 남아 있으면, 이후 최근 상태가 안정되거나 정보성 desync만 남아도 계속 `needs_attention`으로 보일 수 있다.
- 브라우저 실험에서는 "지금 현재도 위험한가?"와 "과거에 한 번 위험했는가?"를 분리해서 봐야 한다.
- 이번 변경은 최근 10개 desync만 따로 요약해서, 누적 상태와 최근 상태를 함께 판단하기 위한 작업이다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 최근 window 기준 필드를 추가했다.
  - `recentShadowHealth`
  - `recentDesyncCount`
  - `recentDesyncReasonCounts`
  - `recentDominantDesyncReason`
  - `recentDominantDesyncCount`
  - `recentActionableDesyncCount`
  - `recentActionableDesyncReasonCounts`
  - `recentDominantActionableDesyncReason`
  - `recentDominantActionableDesyncCount`
- 최근 window 크기는 현재 10개 desync다.
- `src/client/game/debug/multiplayerDebug.js`의 console table row에도 recent 값을 추가했다.
  - `recentHealth`
  - `recentDominantReason`
  - `recentDominantCount`
  - `recentActionableReason`
  - `recentActionableCount`
  - `recentActionableTotal`

### 의미

```text
health
  -> 전체 desyncLog 누적 기준 상태

recentHealth
  -> 최근 10개 desync 기준 상태
```

- `health: needs_attention`, `recentHealth: info_only`
  - 과거에는 조치 대상 desync가 있었지만, 최근에는 game over 이후 snapshot이나 line clear animation 같은 정보성 차이만 관찰되고 있다는 뜻이다.
- `health: needs_attention`, `recentHealth: needs_attention`
  - 최근에도 실제 조치가 필요한 차이가 반복되고 있다는 뜻이다.
- `recentActionableTotal: 0`
  - 최근 window 안에는 actionable desync가 없다.
- `recentActionableReason`이 특정 값으로 반복되면 다음 조사를 그 reason부터 시작한다.

### 콘솔 확인 기준

`?debug=1` 멀티 게임 화면의 shadow summary table에서는 다음 순서로 본다.

```text
recentHealth
recentActionableReason
recentActionableTotal
health
actionableReason
snapshotBoardMismatch
snapshotPieceIndexDirection
```

해석 순서:

1. 먼저 `recentHealth`로 현재 근처의 상태를 본다.
2. `recentHealth`가 `needs_attention`이면 `recentActionableReason`을 우선 조사한다.
3. `recentHealth`가 `info_only`인데 `health`가 `needs_attention`이면, 누적 과거 로그 때문에 전체 health가 높게 유지되는 상황으로 본다.
4. 이 경우 `lastReason`, `recentDominantReason`, `snapshotPhaseMismatch`를 함께 보고 line clear/game over 같은 정보성 상태인지 확인한다.

### 검증

- `node --test test/testMatchService.js test/testMultiplayerDebug.js` 통과
  - 44개 테스트 통과
- `node --test test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 94개 테스트 통과
- `npm test` 통과
  - 181개 테스트 통과

## Shadow rotation wall kick 반영

### 목적

- 클라이언트 runtime의 회전 판정은 SRS wall kick을 사용한다.
- 하지만 서버 shadow engine은 기존에 제자리 회전이 가능한 경우에만 회전을 성공 처리했다.
- 이 차이는 벽 근처나 블록 옆에서 회전할 때 client snapshot과 shadow snapshot의 activePiece 위치/rotation이 달라지는 원인이 된다.
- shadow mode의 목적은 클라이언트와 같은 input/server bag 기준으로 뒤에서 같은 상태를 계산하는 것이므로, 회전 규칙도 클라이언트와 맞춰야 한다.

### 변경 사항

- `src/server/services/shadowGameEngine.js`에 SRS wall kick 테이블을 추가했다.
  - normal piece용 kick
  - bar piece용 kick
- `rotate` input 처리에서 단순 제자리 회전 대신 `rotateWithWallKick()`을 사용한다.
- 회전 후보가 막히면 클라이언트와 같은 순서로 kick offset을 시도한다.
- 처음 성공한 위치를 shadow `activePiece`에 반영하고 `lastActionWasRotation`을 `true`로 둔다.
- square piece는 기존처럼 회전 후보만 확인한다.

### 의미

- 벽 근처에서 회전한 조각이 클라이언트에서는 kick으로 성공하고 shadow에서는 실패하던 차이를 줄인다.
- 특히 bar 조각은 전용 kick table을 사용하므로, I-piece 회전에서 발생하던 shadow/client 위치 차이를 줄일 수 있다.
- 이는 아직 서버 authoritative 완전 전환은 아니다.
  - shadow 계산 결과를 클라이언트 화면에 강제 적용하지 않는다.
  - client snapshot과 shadow snapshot의 차이를 줄이기 위한 계산 규칙 정렬이다.

### 검증

- `node --test test/testShadowGameEngine.js` 통과
  - 13개 테스트 통과
- `node --test test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 95개 테스트 통과
- `npm test` 통과
  - 182개 테스트 통과

## Shadow snapshot 비교 기준에 next/hold 상태 추가

### 목적

- 클라이언트 `getSnapshot()`과 서버 shadow snapshot에는 이미 다음 상태가 포함되어 있다.
  - `pieceQueue`
  - `holdPieceType`
  - `holdUsedThisDrop`
- 하지만 기존 desync 비교는 `pieceIndex`, `phase`, `score`, `linesClearedTotal`, `pendingGarbage`, `activePiece`, `board`만 확인했다.
- 이러면 next queue나 hold 상태가 어긋나도 당장은 desync로 잡히지 않고, 나중에 다른 조각이 spawn된 뒤 `pieceIndex`나 `board` 차이로 늦게 드러난다.
- 서버 authoritative 전환 전에는 원인을 가능한 한 이른 지점에서 잡아야 하므로, queue/hold 상태도 비교 기준에 포함했다.

### 변경 사항

- `src/server/services/matchService.js`의 client/shadow snapshot 비교 필드에 다음을 추가했다.
  - `pieceQueue`
  - `holdPieceType`
  - `holdUsedThisDrop`
- `pieceQueue`가 다르면 `PIECE_QUEUE_MISMATCH`로 분류한다.
  - severity: `high`
  - 다음 조각 순서가 어긋나면 이후 board/pieceIndex가 연쇄적으로 달라질 수 있기 때문이다.
- hold 상태가 다르면 `HOLD_STATE_MISMATCH`로 분류한다.
  - severity: `high`
  - hold 조각과 이번 drop에서 hold 사용 여부가 다음 spawn/입력 결과에 직접 영향을 주기 때문이다.
- desync detail에도 client/shadow 값을 함께 남긴다.
  - `details.pieceQueue`
  - `details.holdPieceType`
  - `details.holdUsedThisDrop`

### 의미

- 이제 shadow debug에서 다음 조각 순서가 틀어진 문제를 더 빨리 볼 수 있다.
- `PIECE_QUEUE_MISMATCH`가 먼저 보이면 bag append, queue 소비, hold 처리 순서를 우선 확인한다.
- `HOLD_STATE_MISMATCH`가 먼저 보이면 hold input 적용 여부와 `holdUsedThisDrop` reset 시점을 우선 확인한다.
- board mismatch가 발생하기 전 단계에서 원인을 좁힐 수 있으므로, 서버 authoritative 전환 전 관찰 품질이 올라간다.

### 검증

- `node --test test/testMatchService.js` 통과
  - 41개 테스트 통과
- `node --test test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 97개 테스트 통과
- `npm test` 통과
  - 184개 테스트 통과

## Shadow queue/hold summary debug 노출

### 목적

- 앞선 변경으로 `pieceQueue`, `holdPieceType`, `holdUsedThisDrop` 차이를 desync reason으로 감지할 수 있게 됐다.
- 하지만 콘솔 summary/debug table에서는 실제 client 값과 shadow 값을 바로 볼 수 없었다.
- 그래서 `PIECE_QUEUE_MISMATCH` 또는 `HOLD_STATE_MISMATCH`가 나와도, 어떤 값이 어떻게 다른지 확인하려면 raw shadow object를 직접 펼쳐봐야 했다.
- 이번 변경은 mismatch 원인을 콘솔에서 바로 비교할 수 있게 만드는 관찰성 개선이다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 마지막 client/shadow snapshot의 queue/hold 값을 추가했다.
  - `lastClientSnapshotPieceQueue`
  - `lastShadowSnapshotPieceQueue`
  - `lastClientSnapshotHoldPieceType`
  - `lastShadowSnapshotHoldPieceType`
  - `lastClientSnapshotHoldUsedThisDrop`
  - `lastShadowSnapshotHoldUsedThisDrop`
- `src/client/game/debug/multiplayerDebug.js`의 shadow summary table row에 비교용 필드를 추가했다.
  - `clientPieceQueue`
  - `shadowPieceQueue`
  - `clientHold`
  - `shadowHold`
- hold 표시는 `pieceType:holdUsedThisDrop` 형태로 정리했다.
  - 예: `bar:false`
  - hold 조각이 없으면 `none`으로 표시한다.

### 의미

- `PIECE_QUEUE_MISMATCH`가 보이면 이제 `clientPieceQueue`와 `shadowPieceQueue`를 바로 비교하면 된다.
- `HOLD_STATE_MISMATCH`가 보이면 `clientHold`와 `shadowHold`를 먼저 보면 된다.
- 이 변경은 게임 진행에는 영향을 주지 않는다.
  - shadow 계산 결과를 클라이언트에 강제 적용하지 않는다.
  - snapshot correction 정책도 바꾸지 않는다.
  - 서버 authoritative 전환 전 디버깅 정보를 더 잘 보이게 만든 것이다.

### 콘솔 확인 기준

`?debug=1` 멀티 게임 화면의 shadow summary table에서 다음 값을 함께 본다.

```text
recentHealth
actionableReason
clientPieceQueue
shadowPieceQueue
clientHold
shadowHold
snapshotPieceIndexDirection
```

해석 기준:

- `actionableReason: PIECE_QUEUE_MISMATCH`
  - `clientPieceQueue`와 `shadowPieceQueue`의 첫 차이를 확인한다.
  - queue 소비, bag append, hold 이후 spawn 순서를 우선 의심한다.
- `actionableReason: HOLD_STATE_MISMATCH`
  - `clientHold`와 `shadowHold`를 비교한다.
  - hold input 적용 여부와 `holdUsedThisDrop` reset 시점을 우선 확인한다.
- queue/hold는 같은데 board만 다르면 조각 순서 문제가 아니라 board merge, line clear, garbage 적용 순서를 우선 본다.

### 검증

- `node --test test/testMatchService.js test/testMultiplayerDebug.js` 통과
  - 47개 테스트 통과

## Shadow desync next investigation hint 추가

### 목적

- shadow summary/debug table은 desync reason과 client/shadow 값을 많이 보여주지만, 다음에 어떤 흐름을 먼저 봐야 하는지는 사람이 매번 해석해야 했다.
- 특히 `PIECE_QUEUE_MISMATCH`, `HOLD_STATE_MISMATCH`, `BOARD_MISMATCH`는 서로 조사 경로가 다르다.
- 이번 변경은 마지막 actionable desync를 기준으로 `nextInvestigationHint`를 만들어, 콘솔에서 다음 조사 방향을 바로 볼 수 있게 한 관찰성 개선이다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 `nextInvestigationHint`를 추가했다.
- `src/client/game/debug/multiplayerDebug.js`의 console table row에 `nextHint`를 추가했다.
- 현재 hint 매핑은 다음 기준이다.

```text
PIECE_QUEUE_MISMATCH
  -> CHECK_QUEUE_FLOW

HOLD_STATE_MISMATCH
  -> CHECK_HOLD_FLOW

BOARD_MISMATCH
  -> CHECK_BOARD_LINE_CLEAR_GARBAGE_FLOW

GARBAGE_MISMATCH
  -> CHECK_GARBAGE_QUEUE_CANCEL_FLOW

LINE_CLEAR_MISMATCH
  -> CHECK_LINE_CLEAR_FLOW

PIECE_INDEX_MISMATCH
  -> CHECK_LOCK_SPAWN_TIMING

PHASE_MISMATCH
  -> CHECK_PHASE_TRANSITION

SCORE_MISMATCH
  -> CHECK_SCORE_RULES

ACTIVE_PIECE_OFFSET
  -> CHECK_INPUT_ROTATION_GRAVITY_ORDER
```

### 의미

- 이제 shadow debug table에서 `nextHint`를 먼저 보고 다음 조사 대상을 정할 수 있다.
- `CHECK_QUEUE_FLOW`면 bag append, queue 소비, spawn 순서를 우선 본다.
- `CHECK_HOLD_FLOW`면 hold input 적용과 `holdUsedThisDrop` reset 시점을 우선 본다.
- `CHECK_BOARD_LINE_CLEAR_GARBAGE_FLOW`면 조각 순서보다는 board merge, line clear, garbage 적용 순서를 우선 본다.
- 이 값은 debug용 힌트일 뿐이며 게임 진행이나 보정 정책에는 영향을 주지 않는다.

### 검증

- `node --test test/testMatchService.js test/testMultiplayerDebug.js` 통과
  - 48개 테스트 통과
- `node --test test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 99개 테스트 통과
- `npm test` 통과
  - 186개 테스트 통과
- `git diff --check` 통과

## Shadow activePiece diff summary 추가

### 목적

- `ACTIVE_PIECE_OFFSET`이나 `PIECE_INDEX_MISMATCH`가 발생했을 때 기존 summary만으로는 activePiece가 어떻게 다른지 바로 보기 어려웠다.
- activePiece 차이는 입력 적용 순서, 회전 wall kick, gravity tick, lock/spawn 타이밍 문제를 가르는 중요한 단서다.
- 이번 변경은 client/shadow activePiece의 type, rotation, row, col 차이를 debug summary에서 바로 볼 수 있게 한다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 activePiece diff 필드를 추가했다.
  - `lastClientSnapshotActivePieceTypeChanged`
  - `lastClientSnapshotActivePieceRotationDelta`
  - `lastClientSnapshotActivePieceRowDelta`
  - `lastClientSnapshotActivePieceColDelta`
- `src/client/game/debug/multiplayerDebug.js`의 console table row에 표시 필드를 추가했다.
  - `activePieceTypeChanged`
  - `activePieceRotationDelta`
  - `activePieceRowDelta`
  - `activePieceColDelta`
- delta 값은 `client - shadow` 기준이다.
  - 예: `activePieceRowDelta: 2`는 client activePiece가 shadow보다 2칸 아래에 있다는 뜻이다.
  - 예: `activePieceColDelta: -1`은 client activePiece가 shadow보다 1칸 왼쪽에 있다는 뜻이다.

### 의미

- `ACTIVE_PIECE_OFFSET`에서 row/col만 다르면 이동 입력이나 gravity tick 순서를 먼저 본다.
- rotation만 다르면 rotate 입력 적용, wall kick, rotation state 처리를 먼저 본다.
- type이 다르면 queue/hold/spawn 순서를 우선 의심한다.
- 이 값은 debug용 관찰 정보이며 게임 진행이나 snapshot correction 정책에는 영향을 주지 않는다.

### 검증

- `node --test test/testMatchService.js test/testMultiplayerDebug.js` 통과
  - 49개 테스트 통과
- `node --test test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 100개 테스트 통과
- `npm test` 통과
  - 187개 테스트 통과
- `git diff --check` 통과

## Shadow board mismatch diff summary 추가

### 목적

- `BOARD_MISMATCH`가 발생하면 기존에는 client/shadow board checksum이 다르다는 사실만 볼 수 있었다.
- checksum은 "다르다"는 판단에는 충분하지만, 어디가 얼마나 다른지 확인하려면 raw board를 직접 비교해야 했다.
- 이번 변경은 board mismatch 조사 속도를 높이기 위해 차이 칸 수와 첫 차이 좌표를 shadow summary/debug table에 노출한다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 board diff 요약 필드를 추가했다.
  - `lastClientSnapshotBoardDiffCellCount`
  - `lastClientSnapshotFirstBoardDiff`
- `lastClientSnapshotFirstBoardDiff`는 다음 값을 가진다.
  - `row`
  - `col`
  - `client`
  - `shadow`
- `src/client/game/debug/multiplayerDebug.js`의 console table row에 표시 필드를 추가했다.
  - `boardDiffCells`
  - `firstBoardDiff`
- `firstBoardDiff`는 콘솔에서 빠르게 읽을 수 있도록 `row,col:client/shadow` 문자열로 표시한다.
  - 예: `18,4:bar/null`

### 의미

- `snapshotBoardMismatch: true`일 때 이제 `boardDiffCells`를 같이 보면 차이가 작은 위치 차이인지, board 전체가 크게 틀어진 상황인지 빠르게 구분할 수 있다.
- `firstBoardDiff`는 첫 번째로 다른 좌표를 보여주므로, line clear 이후 줄 이동 문제인지, garbage 적용 문제인지, lock 위치 문제인지 추적을 시작할 지점을 제공한다.
- 이 값은 debug용 관찰 정보이며 게임 진행이나 snapshot correction 정책에는 영향을 주지 않는다.

### 검증

- `node --test test/testMatchService.js test/testMultiplayerDebug.js` 통과
  - 48개 테스트 통과
- `node --test test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 99개 테스트 통과
- `npm test` 통과
  - 186개 테스트 통과
- `git diff --check` 통과

## Shadow debug 실험 목적과 확인 흐름 정리

### 목적

- 현재 멀티 플레이는 실제 화면과 조작은 client prediction이 담당하고, 서버는 shadow mode로 같은 input과 server bag을 따라가며 별도의 상태를 계산한다.
- 이 실험의 목적은 서버 계산 결과를 게임에 강제로 적용하기 전에 client 상태와 shadow 상태가 어디서 어긋나는지 관찰하는 것이다.
- 즉, 지금 단계의 핵심은 게임을 고치는 것이 아니라 desync 원인을 좁히는 것이다.

### 실험 방식

- 브라우저 2탭으로 기존 멀티 플레이를 그대로 진행한다.
- 게임 중 콘솔에서 debug socket으로 `game:shadow:state`를 주기적으로 요청한다.
- 서버는 해당 player의 shadow summary를 반환한다.
- 반환된 summary를 console table로 확인하면서 다음 값을 비교한다.
  - `severity`
  - `reason`
  - `nextHint`
  - `desyncCount`
  - `shadowTick`
  - `shadowPieceIndex`
  - `clientPieceIndex`
  - `snapshotBoardMismatch`
  - `boardDiffCells`
  - `firstBoardDiff`
  - `activePieceTypeChanged`
  - `activePieceRotationDelta`
  - `activePieceRowDelta`
  - `activePieceColDelta`

### 관찰 기준

- `desyncCount`는 누적된 차이 기록 수다.
  - 게임 종료 후 오래 지난 상태에서 보면 값이 크게 보일 수 있다.
  - 그래서 플레이 중 같은 타이밍에 반복해서 보는 것이 더 중요하다.
- `pieceIndex`가 다르면 lock/spawn 타이밍 차이를 먼저 의심한다.
- activePiece의 row/col만 다르면 input 적용 순서나 gravity tick 순서를 먼저 본다.
- activePiece의 rotation만 다르면 rotate 처리나 wall kick 흐름을 먼저 본다.
- activePiece type이 다르면 queue, hold, spawn 순서를 먼저 본다.
- board mismatch가 있으면 `boardDiffCells`와 `firstBoardDiff`로 차이 범위를 확인한다.

### 의미

- 이 실험은 서버 authoritative로 완전히 전환하기 전의 안전장치다.
- 서버가 계산한 shadow state가 client state와 충분히 비슷해져야 나중에 authoritative snapshot을 실제 화면 보정에 사용할 수 있다.
- 반대로 shadow state가 자주 어긋나는 상태에서 서버 authoritative로 바로 전환하면, 클라이언트 화면이 튀거나 입력감이 나빠질 가능성이 크다.
- 따라서 지금은 debug summary를 늘려 desync를 작게 쪼개서 보는 단계다.

### 현재 판단

- shadow debug API는 정상적으로 조회된다.
- 게임 중 summary를 확인하면 activePiece, board, pieceIndex 차이를 분리해서 볼 수 있다.
- 종료 후 로그는 실제 플레이 중 로그보다 차이가 크게 보일 수 있으므로, 다음 조사는 플레이 중 2초 간격 summary를 기준으로 진행한다.

## Shadow activePiece nextHint 세분화

### 목적

- 기존에는 `ACTIVE_PIECE_OFFSET`이 발생하면 `nextHint`가 항상 `CHECK_INPUT_ROTATION_GRAVITY_ORDER`로만 표시됐다.
- 하지만 activePiece 차이는 여러 원인으로 나뉜다.
  - row/col 차이: 입력 적용 순서, gravity tick, 위치 예측 차이
  - rotation 차이: rotate 처리, wall kick, 회전 상태 차이
  - piece type 차이: queue 소비, hold, spawn 순서 차이
- 이번 변경은 같은 `ACTIVE_PIECE_OFFSET`이라도 다음에 어디를 먼저 볼지 더 좁혀 주기 위한 관찰성 개선이다.

### 변경 사항

- `getNextInvestigationHint()`가 `ACTIVE_PIECE_OFFSET`일 때 `desync.details.activePiece`를 읽어 세부 hint를 반환하게 했다.
- 새 hint 기준은 다음과 같다.

```text
activePiece type이 다름
  -> CHECK_QUEUE_HOLD_SPAWN_FLOW

rotation만 다름
  -> CHECK_ROTATION_WALL_KICK_FLOW

row 또는 col이 다름
  -> CHECK_INPUT_GRAVITY_POSITION_ORDER

세부 차이를 알 수 없음
  -> CHECK_INPUT_ROTATION_GRAVITY_ORDER
```

### 의미

- 이제 debug table의 `nextHint`만 봐도 activePiece mismatch의 1차 조사 대상을 좁힐 수 있다.
- `CHECK_INPUT_GRAVITY_POSITION_ORDER`면 빠른 이동/중력/lock 전후 입력 순서를 먼저 본다.
- `CHECK_ROTATION_WALL_KICK_FLOW`면 client runtime과 shadow engine의 회전 판정, wall kick 적용 순서를 먼저 본다.
- `CHECK_QUEUE_HOLD_SPAWN_FLOW`면 queue 소비, hold 이후 spawn, 다음 조각 선택 순서를 먼저 본다.
- 이 값은 여전히 debug용 힌트이며 게임 진행이나 보정 정책에는 영향을 주지 않는다.

### 검증

- `node --test test/testMatchService.js` 통과
  - 45개 테스트 통과
- `node --test test/testMatchService.js test/testMultiplayerDebug.js` 통과
  - 50개 테스트 통과
- `node --test test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 101개 테스트 통과

## Game snapshot field validation 추가

### 목적

- 서버가 받는 `game:snapshot`은 아직 authoritative source가 아니라 client prediction 관찰/보정용 데이터다.
- 하지만 shadow 비교가 `score`, `phase`, `pieceIndex`, `activePiece`, `pendingGarbageQueue` 같은 여러 필드를 사용하게 되면서, 잘못된 타입의 snapshot이 들어오면 desync log 자체가 오염될 수 있다.
- 이번 변경은 authoritative 전환 전에 snapshot 계약을 작게 고정하기 위한 준비 작업이다.

### 변경 사항

- `src/server/validators/gameSnapshotValidator.js`를 추가했다.
- 현재 MVP 호환성을 위해 `board`만 필수로 유지했다.
- 다음 필드는 존재할 때 타입을 검증한다.
  - `activePiece`
  - `score`
  - `linesClearedTotal`
  - `phase`
  - `tick`
  - `pieceIndex`
  - `holdPieceType`
  - `holdUsedThisDrop`
  - `pieceQueue`
  - `combo`
  - `backToBack`
  - `pendingGarbageQueue`
- `game:snapshot` socket handler가 validator를 통과한 snapshot만 shadow 기록과 상대 broadcast에 사용하도록 바꿨다.
- 외부 응답 reason은 기존처럼 `INVALID_SNAPSHOT`으로 유지했다.

### 의미

- 지금 단계에서는 snapshot 필드를 더 많이 필수화하지 않는다.
- 오래된 테스트나 최소 relay snapshot과의 호환성을 유지하면서, 명백히 잘못된 타입만 차단한다.
- 이 검증은 나중에 server authoritative snapshot schema로 넘어가기 전의 중간 계약이다.

### 검증

- `node --test test/testMultiplayerSocket.js` 통과
  - 37개 테스트 통과
- `git diff --check -- src/server/validators/gameSnapshotValidator.js src/server/sockets/multiplayerHandlers.js test/testMultiplayerSocket.js change-log.md` 통과
- `npm test` 통과
  - 189개 테스트 통과

## Authoritative snapshot field 기준 상수 추가

### 목적

- `game:snapshot` 검증은 아직 client prediction 관찰/보정용이지만, 이후 server authoritative snapshot으로 전환하려면 기준 필드 목록이 코드에 고정되어 있어야 한다.
- 지금까지는 validator 내부 조건문으로만 필드가 흩어져 있었기 때문에, "어떤 상태를 authoritative snapshot 후보로 볼 것인가"를 한눈에 확인하기 어려웠다.
- 이번 변경은 서버 authoritative 전환 전에 snapshot schema의 중심 필드를 상수로 고정하는 작업이다.

### 변경 사항

- `src/server/validators/gameSnapshotValidator.js`에서 `AUTHORITATIVE_SNAPSHOT_FIELDS`를 export한다.
- 기준 필드는 다음과 같다.
  - `board`
  - `activePiece`
  - `pieceQueue`
  - `holdPieceType`
  - `holdUsedThisDrop`
  - `score`
  - `linesClearedTotal`
  - `phase`
  - `combo`
  - `backToBack`
  - `pendingGarbageQueue`
  - `tick`
  - `pieceIndex`
- validator 직접 테스트 파일 `test/testGameSnapshotValidator.js`를 추가했다.
- `combo`, `backToBack`, `holdPieceType`도 optional field 타입 검증 대상에 포함했다.
- `createAuthoritativeSnapshot(source)`를 추가했다.
  - `AUTHORITATIVE_SNAPSHOT_FIELDS`에 포함된 필드만 복사한다.
  - `lastClientInputTick`, `lastClientInputPieceIndex`, `isTSpin`처럼 shadow/debug 전용 필드는 제외한다.
  - board, activePiece, pieceQueue, pendingGarbageQueue 같은 중첩 값은 source 변경이 결과에 영향을 주지 않도록 복사한다.

### 의미

- 아직 이 필드들이 모두 필수라는 뜻은 아니다.
- 현재 MVP에서는 `board`만 필수이고 나머지는 존재할 때 타입을 검사한다.
- 다만 server authoritative 전환 단계에서는 이 상수 목록을 기준으로 서버 snapshot schema를 더 엄격하게 만들 수 있다.
- DTO 생성 함수는 아직 클라이언트로 authoritative snapshot을 전송하지 않는다.
- 지금은 shadow snapshot에서 "나중에 클라이언트에 내려줄 수 있는 상태"만 골라내는 준비 단계다.

### 검증

- `node --test test/testGameSnapshotValidator.js` 통과
  - 7개 테스트 통과
- `node --test test/testGameSnapshotValidator.js test/testMultiplayerSocket.js` 통과
  - 44개 테스트 통과
- `git diff --check -- src/server/validators/gameSnapshotValidator.js test/testGameSnapshotValidator.js src/server/sockets/multiplayerHandlers.js test/testMultiplayerSocket.js change-log.md` 통과
- `npm test` 통과
  - 194개 테스트 통과

## Shadow last input action debug summary 추가

### 목적

- `ACTIVE_PIECE_OFFSET`이나 `CHECK_INPUT_GRAVITY_POSITION_ORDER`를 조사할 때 마지막 입력의 tick, pieceIndex, sequence만으로는 어떤 조작 직후 어긋났는지 바로 알기 어려웠다.
- 예를 들어 같은 위치 차이라도 마지막 입력이 `move_left`인지, `rotate`인지, `hard_drop`인지에 따라 확인해야 할 코드 경로가 달라진다.
- 이번 변경은 shadow summary/debug table에서 마지막 shadow input action을 바로 볼 수 있게 하는 관찰성 개선이다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 `lastShadowInputAction`을 추가했다.
- `src/client/game/debug/multiplayerDebug.js`의 console table row에 `lastInputAction`을 추가했다.
- 기존 `lastShadowInputTick`, `lastShadowInputPieceIndex`, `lastShadowInputSequence`와 같은 묶음으로 읽을 수 있다.

### 의미

- `nextHint: CHECK_INPUT_GRAVITY_POSITION_ORDER`가 나왔을 때 `lastInputAction`을 같이 보면 다음 조사 경로를 좁힐 수 있다.
- `lastInputAction: move_left` 또는 `move_right`면 이동 입력 적용 순서와 collision 판정을 먼저 본다.
- `lastInputAction: rotate`면 rotation/wall kick 흐름을 먼저 본다.
- `lastInputAction: hard_drop`이면 lock/spawn/pieceIndex 증가 타이밍을 먼저 본다.
- 이 값은 debug용 관찰 정보이며 게임 진행이나 보정 정책에는 영향을 주지 않는다.

### 검증

- `node --test test/testMatchService.js test/testMultiplayerDebug.js` 통과
  - 50개 테스트 통과
- `node --test test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 101개 테스트 통과
- `git diff --check -- src/server/services/matchService.js src/client/game/debug/multiplayerDebug.js test/testMatchService.js test/testMultiplayerDebug.js` 통과

## Shadow recent actionable field count summary 추가

### 목적

- `actionableField`는 전체 desync log 기준으로 가장 자주 어긋난 field를 보여준다.
- 하지만 브라우저에서 게임을 계속 플레이하면 오래된 desync가 누적되어, 방금 발생한 문제의 원인을 보기 어려울 수 있다.
- 이번 변경은 최근 desync window 안에서 actionable field count를 따로 계산해 "현재 보고 있는 문제"를 더 빠르게 좁히기 위한 관찰성 개선이다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 다음 필드를 추가했다.
  - `recentActionableDesyncFieldCounts`
  - `recentDominantActionableDesyncField`
  - `recentDominantActionableDesyncFieldCount`
- `src/client/game/debug/multiplayerDebug.js`의 console table row에 다음 표시 필드를 추가했다.
  - `recentActionableField`
  - `recentActionableFieldCount`
- 최근 field count도 기존 기준과 동일하게 info-only desync를 제외하고 actionable desync의 `fields`만 누적한다.

### 의미

- `actionableField`는 전체 경기 동안 반복된 주요 field를 보여준다.
- `recentActionableField`는 최근 window에서 반복된 주요 field를 보여준다.
- 두 값이 같으면 같은 문제가 계속 반복되는 것으로 볼 수 있다.
- 두 값이 다르면 오래된 문제와 현재 문제가 다를 수 있으므로, 최근 값을 먼저 보고 조사한다.
  - 예: 전체는 `score`, 최근은 `activePiece`면 현재는 점수 규칙보다 입력/중력 위치 차이를 먼저 본다.
  - 예: 전체는 `activePiece`, 최근은 `board`면 최근 lock/line clear/garbage 적용 순서를 먼저 본다.
- 이 값은 debug용 관찰 정보이며 게임 진행이나 보정 정책에는 영향을 주지 않는다.

### 검증

- `node --test test/testMatchService.js test/testMultiplayerDebug.js` 통과
  - 50개 테스트 통과
- `node --test test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 101개 테스트 통과
- `npm test` 통과
  - 188개 테스트 통과

## Shadow desync fields summary 추가

### 목적

- 기존 debug table은 `lastReason`, `lastActionableReason`, `nextHint`를 보여줬지만, 실제로 어떤 snapshot 필드들이 함께 어긋났는지는 `lastDesync` 객체를 직접 펼쳐 봐야 했다.
- reason은 대표 원인이고, fields는 실제 차이가 난 상태 목록이다.
- 예를 들어 `PIECE_INDEX_MISMATCH`가 대표 reason이어도 `score`, `pendingGarbageLines`, `activePiece`가 같이 다르면 lock/spawn만 볼 것이 아니라 후처리 흐름도 같이 확인해야 한다.
- 이번 변경은 콘솔 표에서 마지막 desync fields를 바로 보이게 해서 조사 범위를 빠르게 좁히기 위한 관찰성 개선이다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 다음 필드를 추가했다.
  - `lastActionableDesyncFields`
  - `lastDesyncFields`
- `src/client/game/debug/multiplayerDebug.js`의 console table row에 다음 표시 필드를 추가했다.
  - `lastActionableFields`
  - `lastFields`
- debug row에서는 배열을 사람이 읽기 쉬운 문자열로 변환한다.
  - 예: `pieceIndex,score,pendingGarbageLines,activePiece`

### 의미

- `lastActionableFields`는 마지막으로 실제 조사가 필요한 desync에서 어떤 상태가 같이 달랐는지 보여준다.
- `lastFields`는 마지막 desync가 정보성 desync인지 여부와 관계없이 가장 최근 차이 필드를 보여준다.
- `lastActionableReason`과 `lastActionableFields`를 같이 보면 다음처럼 해석할 수 있다.
  - `PIECE_INDEX_MISMATCH + pieceIndex,activePiece`: lock/spawn 타이밍 우선
  - `BOARD_MISMATCH + board`: board merge, line clear, garbage 적용 우선
  - `GARBAGE_MISMATCH + pendingGarbageLines`: garbage queue/cancel/apply 우선
  - `SCORE_MISMATCH + score`: 점수 규칙 우선
- 이 값은 debug용 관찰 정보이며 게임 진행이나 보정 정책에는 영향을 주지 않는다.

### 검증

- `node --test test/testMatchService.js test/testMultiplayerDebug.js` 통과
  - 50개 테스트 통과
- `node --test test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 101개 테스트 통과
- `git diff --check -- src/server/services/matchService.js src/client/game/debug/multiplayerDebug.js test/testMatchService.js test/testMultiplayerDebug.js` 통과
- `npm test` 통과
  - 188개 테스트 통과

## Shadow actionable field count summary 추가

### 목적

- `desyncReasonCounts`는 어떤 대표 원인이 많이 발생했는지 보여준다.
- 하지만 하나의 desync reason 안에서도 실제로 같이 어긋난 상태 필드는 여러 개일 수 있다.
- 예를 들어 `PIECE_INDEX_MISMATCH`가 대표 reason이어도 `score`, `pendingGarbageLines`, `activePiece`가 반복적으로 같이 틀어지면 lock/spawn만 볼 것이 아니라 후처리 상태도 함께 확인해야 한다.
- 이번 변경은 actionable desync에서 어떤 snapshot field가 가장 자주 어긋나는지 summary/debug table에서 바로 보이게 하는 관찰성 개선이다.

### 변경 사항

- `getPlayerShadowState()`의 `summary`에 다음 필드를 추가했다.
  - `actionableDesyncFieldCounts`
  - `dominantActionableDesyncField`
  - `dominantActionableDesyncFieldCount`
- `src/client/game/debug/multiplayerDebug.js`의 console table row에 다음 표시 필드를 추가했다.
  - `actionableField`
  - `actionableFieldCount`
- `actionableDesyncFieldCounts`는 info-only desync를 제외하고 실제 조사가 필요한 desync의 `fields`만 누적한다.

### 의미

- `actionableReason`은 대표 원인을 보여준다.
- `actionableField`는 실제로 가장 자주 달라진 상태 필드를 보여준다.
- 두 값을 함께 보면 다음 조사 방향을 더 잘 고를 수 있다.
  - `actionableReason: PIECE_INDEX_MISMATCH`, `actionableField: pieceIndex`
    - lock/spawn 타이밍 우선
  - `actionableReason: BOARD_MISMATCH`, `actionableField: board`
    - board merge, line clear, garbage 적용 우선
  - `actionableReason: SCORE_MISMATCH`, `actionableField: score`
    - score/combo/back-to-back/T-Spin 점수 규칙 우선
  - `actionableField: pendingGarbageLines`
    - garbage queue, cancel, apply 순서 우선
- 이 값은 debug용 관찰 정보이며 게임 진행이나 보정 정책에는 영향을 주지 않는다.

### 검증

- `node --test test/testMatchService.js test/testMultiplayerDebug.js` 통과
  - 50개 테스트 통과
- `node --test test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 101개 테스트 통과
- `git diff --check -- src/server/services/matchService.js src/client/game/debug/multiplayerDebug.js test/testMatchService.js test/testMultiplayerDebug.js` 통과

## Shadow debug API authoritative snapshot DTO 노출

### 목적

- 이전 단계에서 `AUTHORITATIVE_SNAPSHOT_FIELDS`와 `createAuthoritativeSnapshot(source)`를 추가해 서버 authoritative snapshot 후보 필드를 고정했다.
- 하지만 이 DTO는 아직 validator 단위에서만 검증되고 있었고, 실제 shadow 조회 흐름에서는 raw `lastShadowSnapshot`만 볼 수 있었다.
- 이번 변경은 `game:shadow:state` debug API 응답 안에서 서버가 authoritative snapshot 후보로 인정할 값을 직접 확인할 수 있게 하는 작업이다.

### 변경 사항

- `getPlayerShadowState()` 응답에 `lastAuthoritativeSnapshot`을 추가했다.
- `lastAuthoritativeSnapshot`은 `lastShadowSnapshot`을 기준으로 `createAuthoritativeSnapshot()`을 적용해 만든다.
- 포함 필드는 `AUTHORITATIVE_SNAPSHOT_FIELDS` 기준으로 제한된다.
  - `board`
  - `activePiece`
  - `pieceQueue`
  - `holdPieceType`
  - `holdUsedThisDrop`
  - `score`
  - `linesClearedTotal`
  - `phase`
  - `combo`
  - `backToBack`
  - `pendingGarbageQueue`
  - `tick`
  - `pieceIndex`
- raw shadow snapshot에 남아 있는 debug/계산 보조 필드는 제외된다.
  - `isTSpin`
  - `lastActionWasRotation`
  - `lastClientInputTick`
  - `lastClientInputPieceIndex`
- 반환 DTO는 중첩 객체/배열을 복사하므로, raw `lastShadowSnapshot`과 같은 참조를 공유하지 않는다.

### 의미

- `lastShadowSnapshot`은 여전히 디버깅용 raw shadow 상태다.
- `lastAuthoritativeSnapshot`은 나중에 `game:authoritative:snapshot` 같은 이벤트로 내려보낼 수 있는 후보 형태다.
- 아직 클라이언트 화면에 강제 적용하지 않는다.
- 따라서 이번 변경은 게임 동작 변경이 아니라, 서버 authoritative 전환 전에 "서버가 어떤 상태를 권위 snapshot으로 내릴 것인가"를 실제 debug 응답에서 확인할 수 있게 만든 준비 작업이다.

### 검증

- `node --test test/testMatchService.js` 통과
  - 46개 테스트 통과
- `node --test test/testGameSnapshotValidator.js test/testMultiplayerSocket.js` 통과
  - 44개 테스트 통과

## Multiplayer debug table authoritative snapshot 후보 표시

### 목적

- `game:shadow:state` 응답에는 `lastAuthoritativeSnapshot`이 들어가지만, 브라우저 `?debug=1` 콘솔 table은 아직 `summary`만 표시하고 있었다.
- 그 상태에서는 authoritative snapshot 후보를 보려면 콘솔에서 응답 객체를 직접 펼쳐봐야 했다.
- 이번 변경은 서버가 계산한 shadow 상태 중 "나중에 authoritative snapshot으로 내려보낼 후보"를 debug table에서 바로 확인하기 위한 관찰성 개선이다.

### 변경 사항

- `src/client/game/debug/multiplayerDebug.js`에 `createShadowStateDebugRow(shadow)`를 추가했다.
  - 기존 `createShadowSummaryDebugRow(summary)` 결과를 그대로 포함한다.
  - 여기에 `shadow.lastAuthoritativeSnapshot` 요약값을 덧붙인다.
- debug table에 추가된 authoritative 후보 필드:
  - `authoritativeTick`
  - `authoritativePieceIndex`
  - `authoritativePhase`
  - `authoritativeScore`
  - `authoritativeLines`
  - `authoritativeGarbageLines`
  - `authoritativeActivePiece`
  - `authoritativePieceQueue`
  - `authoritativeHold`
  - `authoritativeBoardChecksum`
- `src/client/pages/tetrisMulti.html`의 shadow debug polling에서 `createShadowStateDebugRow(result.shadow)`를 사용하게 바꿨다.

### 의미

- 이제 `?debug=1` 멀티 게임 화면의 콘솔 table에서 다음 두 축을 같이 볼 수 있다.
  - client snapshot과 shadow snapshot의 차이 요약
  - 서버가 authoritative snapshot 후보로 내릴 수 있는 상태 요약
- `authoritativeBoardChecksum`은 raw board 전체를 table에 펼치지 않고도 board 상태가 바뀌는지 추적하기 위한 값이다.
- `authoritativeActivePiece`, `authoritativePieceQueue`, `authoritativeHold`는 다음 단계에서 서버 authoritative snapshot을 실제 이벤트로 전송할 때 우선 확인할 핵심 필드다.
- 아직 이 값을 클라이언트 게임 화면에 적용하지 않는다.
- 따라서 이번 변경은 authoritative 전환이 아니라, 전환 전에 서버 snapshot 후보를 더 쉽게 관찰하기 위한 debug UI 정리다.

### 검증

- `node --test test/testMultiplayerDebug.js` 통과
  - 7개 테스트 통과
- `node --test test/testMatchService.js test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 55개 테스트 통과
- `git diff --check -- src/client/game/debug/multiplayerDebug.js src/client/pages/tetrisMulti.html test/testMultiplayerDebug.js` 통과

## 요청형 authoritative snapshot API 추가

### 목적

- 이전 단계에서는 `game:shadow:state` 응답 안에서 `lastAuthoritativeSnapshot`을 확인할 수 있었다.
- 하지만 authoritative snapshot 후보만 따로 요청하는 경로는 없었다.
- 이번 변경은 서버 authoritative 전환 전에, 클라이언트가 서버가 만든 authoritative 후보 snapshot을 독립 이벤트로 요청하고 응답받을 수 있는 얇은 API를 추가한 작업이다.

### 변경 사항

- `matchService`에 `getPlayerAuthoritativeSnapshot(roomId, playerId)`를 추가했다.
  - 성공 시 `{ ok: true, snapshot, reason: null }`을 반환한다.
  - 실패 시 `{ ok: false, snapshot: null, reason }`을 반환한다.
  - snapshot은 `createAuthoritativeSnapshot()`을 거친 DTO라서 debug-only 필드는 포함하지 않는다.
- 서버 Socket.IO 핸들러에 요청 이벤트를 추가했다.
  - 요청: `game:authoritative:snapshot`
  - 응답: `game:authoritative:snapshot:result`
- 요청 처리 흐름:

```text
client
  -> game:authoritative:snapshot { roomId, playerId }
  -> syncRoom(roomId, playerId)
  -> getPlayerAuthoritativeSnapshot(roomId, playerId)
  -> game:authoritative:snapshot:result { ok, snapshot, reason }
```

- `client/net/roomClient.js`에 브라우저 adapter 함수를 추가했다.
  - `requestGameAuthoritativeSnapshot(roomId, playerId)`
  - `onGameAuthoritativeSnapshotResult(handler)`

### 의미

- 이 API는 아직 게임 화면에 authoritative snapshot을 적용하지 않는다.
- 상대 보드 보정 정책도 바꾸지 않는다.
- 지금 단계의 목적은 "서버가 만든 authoritative 후보 snapshot을 독립적으로 요청할 수 있는가"를 확인하는 것이다.
- 다음 단계에서 이 응답을 debug table이나 수동 콘솔 테스트로 확인하면서, 실제 push형 `game:authoritative:snapshot` 또는 주기 전송 정책으로 넘어갈 수 있다.
- 즉, 이번 변경은 완전 authoritative 전환이 아니라, 그 전 단계의 관찰/검증용 이벤트 계약이다.

### 검증

- `node --test test/testMatchService.js` 통과
  - 48개 테스트 통과
- `node --test test/testMultiplayerSocket.js` 통과
  - 39개 테스트 통과
- `node --test test/testRoomClient.js` 통과
  - 4개 테스트 통과

## 요청형 authoritative snapshot debug polling 연결

### 목적

- `game:authoritative:snapshot` 요청 API는 추가되었지만, 브라우저 멀티 게임 화면에서는 아직 직접 호출하지 않았다.
- 즉, 콘솔에서 수동으로 이벤트를 emit하지 않으면 요청형 authoritative snapshot 응답을 확인하기 어려웠다.
- 이번 변경은 `?debug=1` 멀티 게임 화면에서 shadow summary와 함께 요청형 authoritative snapshot도 주기적으로 확인할 수 있게 만든 작업이다.

### 변경 사항

- `src/client/game/debug/multiplayerDebug.js`에 `createAuthoritativeSnapshotDebugRow(snapshot)`를 추가했다.
  - authoritative snapshot 단독 응답을 console table용 row로 변환한다.
  - 기존 `createShadowStateDebugRow(shadow)`도 이 helper를 재사용하게 정리했다.
- `src/client/pages/tetrisMulti.html`의 debug polling에서 다음을 함께 수행한다.
  - `requestGameShadowState(roomId, playerId)`
  - `requestGameAuthoritativeSnapshot(roomId, playerId)`
- `onGameAuthoritativeSnapshotResult()` listener를 등록해 응답을 `console.table()`로 출력한다.
- debug polling 중지 시 authoritative snapshot result listener도 함께 해제한다.

### 의미

- `?debug=1` 멀티 게임 화면에서는 이제 2초마다 두 종류의 table을 볼 수 있다.
  - shadow summary table: client snapshot과 서버 shadow state의 차이 관찰
  - authoritative snapshot table: 서버가 현재 authoritative 후보로 내릴 수 있는 상태 관찰
- 두 table을 비교하면 다음을 더 쉽게 확인할 수 있다.
  - shadow state가 어떤 tick/pieceIndex/phase에 있는지
  - 별도 요청 API가 반환하는 snapshot 후보가 같은 기준을 따르는지
  - board 전체를 펼치지 않고 `authoritativeBoardChecksum`으로 변화가 있는지
- 아직 authoritative snapshot을 게임 화면에 적용하지 않는다.
- 아직 서버가 주기적으로 push하지도 않는다.
- 이 단계는 완전 authoritative 전환 전에 브라우저에서 요청형 snapshot 계약을 관찰하는 준비 작업이다.

### 검증

- `node --test test/testMultiplayerDebug.js test/testRoomClient.js` 통과
  - 13개 테스트 통과

## Shadow authoritative 실험 목적 및 authoritative snapshot 응답 메타데이터 추가

### 목적

- 최근 실험은 서버 authoritative로 바로 전환하기 위한 작업이 아니라, 현재 client prediction 구조와 서버 shadow 계산이 얼마나 어긋나는지 관찰하기 위한 단계다.
- 클라이언트는 계속 기존 방식대로 게임을 진행하고, 서버는 같은 input/server bag 기준으로 뒤에서 shadow state를 계산한다.
- 이후 `game:shadow:state`와 `game:authoritative:snapshot` debug 응답을 비교해 다음을 확인한다.
  - 서버 shadow state가 어느 tick/pieceIndex까지 따라왔는지
  - client snapshot과 server shadow snapshot이 어떤 필드에서 어긋나는지
  - 서버가 나중에 authoritative snapshot으로 내려줄 수 있는 DTO가 어떤 상태인지
- 이 실험을 통해 완전 authoritative 전환 전에 desync 원인을 좁히고, 실제 화면에 서버 상태를 강제 적용했을 때 생길 위험을 줄인다.

### 변경 사항

- `getPlayerAuthoritativeSnapshot(roomId, playerId)` 응답에 debug 식별 메타데이터를 추가했다.
  - `roomId`
  - `playerId`
  - `source: "server_shadow"`
  - `createdAt`
- 성공 응답은 이제 다음 형태를 가진다.

```js
{
    ok: true,
    roomId,
    playerId,
    source: "server_shadow",
    snapshot,
    createdAt,
    reason: null,
}
```

- 실패 응답도 같은 메타데이터 형태를 유지한다.

```js
{
    ok: false,
    roomId,
    playerId,
    source: "server_shadow",
    snapshot: null,
    createdAt,
    reason,
}
```

- 서버 소켓의 `game:authoritative:snapshot` unauthorized 응답도 같은 구조로 맞췄다.
- 관련 테스트에서 성공/실패 응답 모두 `roomId`, `playerId`, `source`, `createdAt`을 검증하게 했다.

### 의미

- debug 콘솔에서 여러 탭, 여러 room, 여러 player의 응답이 섞여도 어떤 응답인지 바로 구분할 수 있다.
- `source: "server_shadow"`는 이 snapshot이 아직 실제 authoritative state가 아니라 shadow 계산 기반 후보라는 점을 명확히 한다.
- `createdAt`은 같은 2초 polling 안에서도 응답 시점을 비교할 수 있게 한다.
- 이 변경은 게임 플레이나 보정 정책을 바꾸지 않는다.
- 목적은 관찰성 개선이며, 다음 단계에서 server push형 authoritative snapshot 또는 완전 authoritative 전환을 검토할 때 기준 데이터를 더 명확하게 보기 위함이다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js` 통과

## Placement comparison debug row별 investigationHint 추가

### 목적

- 이전 단계에서 summary의 `nextInvestigationHint`는 piece alignment를 고려하게 됐다.
- 하지만 `recentPlacementComparisonLog`를 console table로 볼 때는 각 row를 직접 해석해야 했다.
- 최근 10개 mismatch 중 어떤 것은 같은 조각의 계산 차이이고, 어떤 것은 이미 조각 순서가 어긋난 결과일 수 있으므로 row 단위 힌트가 필요하다.

### 변경 사항

- `createPlacementComparisonDebugRows()` row에 다음 필드를 추가했다.
  - `pieceAlignment`
  - `investigationHint`
- `pieceAlignment`는 `pieceIndexDelta`를 기준으로 계산한다.
  - `client_ahead`
  - `shadow_ahead`
  - `in_sync`
  - `null`
- `investigationHint`는 summary 힌트와 같은 우선순위를 따른다.
  - `pieceIndexDelta !== 0`: `CHECK_PLACEMENT_LOCK_SPAWN_ORDER`
  - garbage 관련 field mismatch: `CHECK_PLACEMENT_GARBAGE_RESULT_FLOW`
  - combo/back-to-back/T-Spin mismatch: `CHECK_PLACEMENT_ATTACK_RULE_FLOW`
  - line clear mismatch: `CHECK_PLACEMENT_LINE_CLEAR_RESULT_FLOW`
  - game over mismatch: `CHECK_PLACEMENT_GAME_OVER_FLOW`

### RED/GREEN

- RED: placement comparison debug row에 `pieceAlignment`, `investigationHint`가 없어 deepEqual 테스트가 실패했다.
- GREEN: debug helper에 row 단위 alignment/hint 계산을 추가한 뒤 `test/testMultiplayerDebug.js`가 통과했다.

### 의미

- `?debug=1`에서 recent placement comparison table을 볼 때, 각 row마다 다음에 볼 흐름을 바로 확인할 수 있다.
- summary의 `nextHint`는 마지막/대표 상태를 빠르게 보는 용도이고, row의 `investigationHint`는 최근 mismatch들을 하나씩 비교하는 용도다.
- 같은 room에서 여러 종류의 mismatch가 섞여 발생할 때 원인 분리를 더 빨리 할 수 있다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerDebug.js` 통과

## Critical placement drift warning reset 추가

### 목적

- 이전 변경에서 같은 critical placement warning signature를 반복 출력하지 않도록 dedupe를 추가했다.
- 하지만 critical 상태가 해소된 뒤 같은 signature가 다시 발생하면, 이전 signature가 남아 warning이 다시 나오지 않을 수 있었다.
- 반복 warning은 줄이되, "해소 후 재발"은 다시 감지해야 한다.

### 변경 사항

- `warnCriticalPlacementDebug()`가 non-critical row를 받으면 `warningState.lastCriticalPlacementWarningKey`를 초기화한다.
- 이후 같은 critical signature가 다시 들어와도 새 발생으로 보고 warning을 남긴다.

### RED/GREEN

- RED: critical → stable → 같은 critical 순서에서 warning이 한 번만 찍혀 테스트가 실패했다.
- GREEN: non-critical 상태에서 warning state를 reset한 뒤 `test/testMultiplayerDebug.js`가 통과했다.

### 의미

- 같은 critical 상태가 유지되는 동안은 콘솔 소음을 줄인다.
- critical 상태가 해소됐다가 재발하면 다시 warning을 남겨 실제 재발 이벤트를 놓치지 않는다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerDebug.js` 통과

## Critical placement drift warning dedupe 추가

### 목적

- `?debug=1` shadow polling은 기본적으로 2초마다 실행된다.
- 같은 critical placement drift가 유지되는 동안 매번 `console.warn`이 찍히면, 실제로 값이 바뀐 순간을 보기 어려워진다.
- 따라서 동일한 critical warning signature는 한 번만 출력하고, drift 값이 바뀌었을 때 다시 warning을 남기게 했다.

### 변경 사항

- `warnCriticalPlacementDebug(row, logWarn, warningState)`가 optional `warningState`를 받게 했다.
- warning payload를 JSON signature로 만들어 `warningState.lastCriticalPlacementWarningKey`와 비교한다.
- 같은 signature면 warning을 생략한다.
- `tetrisMulti.html`의 shadow debug polling에 `criticalPlacementDebugWarningState`를 추가했다.
- `stopShadowDebugPolling()` 시 warning state를 초기화한다.

### RED/GREEN

- RED: 같은 critical row를 두 번 호출해도 warning이 두 번 찍혀 테스트가 실패했다.
- GREEN: warning signature dedupe를 추가한 뒤 `test/testMultiplayerDebug.js`가 통과했다.

### 의미

- critical drift warning은 유지하되, 반복 polling으로 인한 콘솔 소음을 줄인다.
- `maxTickDelta`, `maxPieceIndexDelta`, `hint`, `driftLevel`이 바뀌면 새 signature로 보고 다시 warning이 나온다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerDebug.js` 통과

## Recent placement max delta summary 추가

### 목적

- recent placement mismatch summary는 out-of-order mismatch 개수와 dominant hint를 보여줬지만, 어긋남의 크기는 바로 알 수 없었다.
- 같은 `CHECK_PLACEMENT_LOCK_SPAWN_ORDER`라도 `pieceIndexDelta`가 1인 경우와 10 이상 누적된 경우는 조사 우선순위가 다르다.
- 따라서 최근 placement comparison window에서 tick/pieceIndex 차이의 최대 절대값을 summary에 추가했다.

### 변경 사항

- `getPlayerShadowState()` summary에 다음 필드를 추가했다.
  - `recentMaxAbsolutePlacementTickDelta`
  - `recentMaxAbsolutePlacementPieceIndexDelta`
- 기존 desync max delta helper를 recent placement comparison log에도 재사용했다.
- `createShadowSummaryDebugRow()`가 console table에서 짧은 이름으로 표시한다.
  - `recentMaxPlacementTickDelta`
  - `recentMaxPlacementPieceIndexDelta`

### RED/GREEN

- RED: summary에 `recentMaxAbsolutePlacementTickDelta`가 없어 테스트가 실패했다.
- RED: debug row에 `recentMaxPlacementTickDelta`, `recentMaxPlacementPieceIndexDelta`가 없어 deepEqual 테스트가 실패했다.
- GREEN: matchService summary와 debug row에 max delta를 연결한 뒤 `test/testMatchService.js`, `test/testMultiplayerDebug.js`가 통과했다.

### 의미

- recent placement mismatch의 빈도와 규모를 함께 볼 수 있다.
- out-of-order count가 낮더라도 max piece delta가 크면 특정 순간 큰 진행 점프가 있었는지 먼저 볼 수 있다.
- out-of-order count가 높고 max delta가 작으면 지속적인 1-piece 지연/선행 문제일 가능성이 크다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js test/testMultiplayerDebug.js` 통과

## Shadow/authoritative debug 실험 흐름 정리

### 목적

- 이번 실험은 서버 authoritative로 바로 전환하기 전에, 현재 client prediction 게임 흐름과 서버 shadow 계산 흐름이 어디서 어긋나는지 관찰하기 위한 단계다.
- 실제 화면 조작과 렌더링은 아직 클라이언트가 담당한다.
- 서버는 같은 room/player/match context에서 snapshot, input, placement, authoritative snapshot debug 값을 모아 비교한다.
- 이 단계의 핵심은 게임을 멈추거나 강제로 보정하는 것이 아니라, desync가 발생하는 시점과 원인을 로그로 좁히는 것이다.

### 왜 필요한가

- 현재 멀티는 input relay, server bag, snapshot correction, garbage attack/cancel이 섞여 있다.
- 단순히 상대 보드가 맞아 보이는지만 확인하면, 실제로는 다음 문제를 구분하기 어렵다.
  - 입력 순서가 밀린 문제
  - lock/spawn 순서가 어긋난 문제
  - line clear animation 중 snapshot이 찍힌 문제
  - garbage cancel/apply 계산 순서가 다른 문제
  - 게임 종료 후 tick과 snapshot 송신이 정상 플레이 중과 다르게 보이는 문제
- shadow/authoritative debug는 위 문제를 `tick`, `pieceIndex`, `phase`, `board`, `activePiece`, `placementResult` 기준으로 나눠서 볼 수 있게 한다.

### 확인한 실험 방식

- 멀티 로비에서 debug query를 붙여 2탭 테스트를 진행한다.
  - 예: `/pages/multiLobby.html?resetPlayer=1&debug=1&authoritativeApply=opponent`
- 게임 화면 진입 후 debug panel에서 현재 모드를 확인한다.
  - `Debug on | Apply opponent`
- authoritative snapshot update 구독 상태와 적용 경로를 확인한다.
  - `Route waiting`
  - `Opponent applied N | Local blocked M | Last opponent seq X`
  - `Route subscribe failed | REASON`
- 콘솔에서는 `game:shadow:state`, placement comparison, authoritative snapshot route table을 같이 본다.
- 별도 debug socket을 만들 때는 새 socket도 서버 입장에서 독립 연결이므로 `game:join` 이후 `game:shadow:state`를 요청해야 한다.

### 콘솔 확인 코드

```js
window.__shadowDebug?.socket?.disconnect();
clearInterval(window.__shadowDebug?.timer);

const roomId = new URLSearchParams(location.search).get("roomId");
const playerId = sessionStorage.getItem("tetris:playerId");
const socket = io();

socket.on("connect", () => {
    socket.emit("game:join", { roomId, playerId });

    const timer = setInterval(() => {
        socket.emit("game:shadow:state", { roomId, playerId });
    }, 2000);

    window.__shadowDebug = { socket, timer };
});

socket.on("game:shadow:state:result", (result) => {
    const summary = result.shadow?.summary;

    console.log("summary:", summary);
    console.log("lastDesync fields:", summary?.lastDesync?.fields);
    console.log("lastDesync:", summary?.lastDesync);

    console.table({
        severity: summary?.lastDesyncSeverity,
        reason: summary?.lastDesyncReason,
        fields: summary?.lastDesync?.fields?.join(", "),
        desyncCount: summary?.desyncCount,
        shadowTick: summary?.shadowTick,
        shadowPieceIndex: summary?.shadowPieceIndex,
    });
});
```

### 해석 기준

- 게임 종료 후 찍은 summary는 client tick, shadow tick, snapshot 송신 타이밍이 정상 플레이 중과 다를 수 있다.
- 따라서 큰 차이가 보이면 먼저 "플레이 중 관찰값인지, 종료 후 관찰값인지"를 구분한다.
- 플레이 중 반복적으로 나타나는 `lastDesyncReason`, `fields`, `tickDelta`, `pieceIndexDelta`를 우선 조사한다.
- `pieceIndexDelta`가 0이면 같은 조각 안에서 결과가 다른 것이므로 placement/garbage/score 계산 순서를 본다.
- `pieceIndexDelta`가 0이 아니면 placement 결과보다 lock, spawn, input 처리 순서를 먼저 봐야 한다.
- `phase`가 `lineClearing`이면 animation 중간 snapshot일 수 있으므로 보정/비교 기준에서 예외 처리 대상인지 확인한다.

### 이번에 보강한 점

- authoritative snapshot route status를 단순 마지막 이벤트가 아니라 누적 상태로 표시하게 했다.
  - opponent 적용 성공 횟수
  - local target 차단 횟수
  - 마지막 opponent update sequence
- subscribe 실패도 debug panel에 표시되게 했다.
  - 이전에는 콘솔 warning만 남아 `Route waiting`과 구독 실패를 구분하기 어려웠다.
  - 이제 실패 시 `Route subscribe failed | NOT_AUTHORIZED`처럼 확인할 수 있다.
- `attachAuthoritativeSnapshotUpdateDebug()`가 subscribe 결과를 외부 handler로 전달할 수 있게 했다.
- `tetrisMulti.html` debug panel이 subscribe 결과를 route status tracker에 반영한다.

### RED/GREEN

- RED: `createAuthoritativeRouteStatusTracker`에 `recordSubscribeResult()`가 없어 subscribe 실패 표시 테스트가 실패했다.
- GREEN: route status tracker에 subscribe 결과 기록을 추가하고, debug attach/page 연결을 보강한 뒤 테스트를 통과시켰다.

### 의미

- 이제 `Route waiting`은 실제로 아직 update가 없다는 뜻에 가깝고, 구독 실패는 별도 상태로 보인다.
- 2탭 실험 중 "상대 보드에 authoritative snapshot이 적용되지 않는다"는 문제가 생겼을 때, 서버 update 자체가 없는지, 구독이 실패했는지, local target으로 차단된 것인지 더 빠르게 구분할 수 있다.
- 이 관찰 체계가 안정되면 다음 단계에서 snapshot 의존도를 줄이고, shadow 계산 결과를 authoritative 전환 판단 기준으로 사용할 수 있다.

## Authoritative route debug 표시를 누적 상태로 변경

### 목적

- 서버 authoritative snapshot push는 room 안의 player별 snapshot을 모두 보낸다.
- 그래서 opponent snapshot이 적용된 직후 local snapshot이 `TARGET_NOT_ALLOWED`로 차단되면, debug panel의 마지막 route 표시가 local 차단 상태로 덮일 수 있었다.
- 이 경우 실제로 opponent 적용이 성공했는지 화면에서 바로 알기 어렵다.

### 변경 사항

- `createAuthoritativeRouteStatusTracker()`를 `multiplayerDebug.js`에 추가했다.
- tracker는 다음 값을 누적해서 표시한다.
  - opponent snapshot 적용 성공 횟수
  - local snapshot 적용 차단 횟수
  - 마지막 opponent 적용 update sequence
- `tetrisMulti.html`의 debug route 표시를 마지막 이벤트 label에서 tracker label로 변경했다.
- 표시 예:
  - 초기: `Route waiting`
  - opponent 적용 후: `Opponent applied 1 | Local blocked 0 | Last opponent seq 20`
  - 같은 update 묶음에서 local 차단 후: `Opponent applied 1 | Local blocked 1 | Last opponent seq 20`
- `PLAN.md`의 수동 검증 기준도 누적 표시 방식으로 갱신했다.

### RED/GREEN

- RED: `createAuthoritativeRouteStatusTracker()`가 없어 누적 표시 테스트가 실패했다.
- GREEN: tracker 구현과 게임 화면 연결 후 `test/testMultiplayerDebug.js`가 통과했다.

### 의미

- 수동 검증자는 local 차단 이벤트가 마지막에 와도 opponent 적용 성공 여부를 잃지 않고 볼 수 있다.
- `Opponent applied`가 증가하면 상대 보드에 서버 snapshot 후보가 적용된 것이다.
- `Local blocked`가 증가하면 내 보드 적용 차단 안전장치가 동작한 것이다.

## 멀티 게임 debug panel에 authoritative route 상태 표시

### 목적

- `Debug on | Apply opponent`만으로는 실험 모드 진입 여부는 알 수 있지만, 서버 snapshot push가 실제로 들어왔는지와 적용됐는지는 알기 어렵다.
- 기존에는 `authoritative_snapshot_route` console table을 직접 봐야 했다.
- 수동 2탭 검증 중에는 화면에서 마지막 route/apply 상태를 바로 볼 수 있어야 한다.

### 변경 사항

- `createAuthoritativeRouteStatusLabel(routeResult, applyResult)`를 `multiplayerDebug.js`에 추가했다.
  - 대기 상태: `Route waiting`
  - 적용 성공: `Route opponent | Applied yes | Seq 12`
  - 적용 차단: `Route local | Applied no | TARGET_NOT_ALLOWED | Seq 13`
- `tetrisMulti.html` debug panel에 `#multiDebugRouteText`를 추가했다.
- authoritative snapshot push handler에서 route/apply 결과가 나올 때마다 debug panel의 route 상태를 갱신한다.
- `tetris.css`에 `.debug-route` 스타일을 추가했다.
- `PLAN.md`의 수동 검증 절차에 route 상태 확인 기준을 추가했다.

### RED/GREEN

- RED: `createAuthoritativeRouteStatusLabel()`이 없어 테스트가 실패했다.
- GREEN: helper와 게임 화면 표시 연결 후 `test/testMultiplayerDebug.js`가 통과했다.

### 의미

- 수동 검증자는 콘솔을 열기 전에 화면에서 server snapshot push가 들어오는지 확인할 수 있다.
- `Applied yes`가 보이면 opponent runtime에 authoritative snapshot 후보가 실제 적용된 것이다.
- `TARGET_NOT_ALLOWED`가 보이면 local target snapshot이 차단된 것이므로, `authoritativeApply=opponent`의 안전장치가 의도대로 동작한 것이다.

## 멀티 게임 debug panel에 apply mode 표시

### 목적

- `?debug=1&authoritativeApply=opponent`가 로비에서 게임 화면까지 전달되더라도, 화면만 보면 현재 어떤 apply mode인지 바로 알기 어려웠다.
- 수동 2탭 검증에서는 먼저 "실험 모드가 실제로 켜졌는지" 확인해야 하므로, 게임 화면 debug panel에 현재 mode를 표시하게 했다.

### 변경 사항

- `createMultiplayerDebugModeLabel({ debugEnabled, authoritativeApplyMode })`를 `multiplayerDebug.js`에 추가했다.
  - debug on + opponent mode: `Debug on | Apply opponent`
  - debug on + off mode: `Debug on | Apply off`
  - debug off: `Debug off | Apply off`
- `tetrisMulti.html` debug panel에 `#multiDebugModeText`를 추가했다.
- 게임 화면 초기화 시 `location.search`를 기준으로 debug/apply mode 텍스트를 채운다.
- `tetris.css`에 `.debug-mode` 표시 스타일을 추가했다.
- `PLAN.md`의 2탭 검증 절차에 debug panel에서 `Debug on | Apply opponent`를 먼저 확인하라고 기록했다.

### RED/GREEN

- RED: `createMultiplayerDebugModeLabel()`이 없어 테스트가 실패했다.
- GREEN: helper와 게임 화면 표시를 연결한 뒤 `test/testMultiplayerDebug.js`가 통과했다.

### 의미

- 수동 검증자가 콘솔 로그를 보기 전에 화면에서 실험 모드 진입 여부를 확인할 수 있다.
- URL 보존 문제와 실제 동기화 문제를 더 쉽게 분리할 수 있다.

## 로비에서 authoritativeApply 실험 query 보존

### 목적

- `?debug=1&authoritativeApply=opponent`는 상대 보드를 server authoritative snapshot 후보 중심으로 표시하는 실험 모드다.
- 하지만 로비에서 게임 화면으로 이동할 때 기존 `appendMultiplayerDebugParam()`은 `debug=1`만 전달하고 `authoritativeApply=opponent`는 버렸다.
- 이 상태에서는 로비를 실험 모드로 열어도 `tetrisMulti.html`에서는 기본 모드로 시작되어, 실제 검증 결과가 의도한 opponent authoritative apply mode가 아니게 된다.

### 변경 사항

- `appendMultiplayerDebugParam(url, search)`가 `debug=1` 또는 `debug=true`일 때 `authoritativeApply=opponent`도 함께 전달하게 했다.
- `resetPlayer=1`은 로비 player session 초기화용 query이므로 게임 URL에는 전달하지 않는다.
- `test/testMultiplayerDebug.js`에 `authoritativeApply=opponent` 보존 테스트를 추가했다.
- `PLAN.md`의 2탭 검증 절차에 다음 기준을 추가했다.
  - 로비: `/pages/multiLobby.html?resetPlayer=1&debug=1&authoritativeApply=opponent`
  - 게임: `/pages/tetrisMulti.html?roomId=...&debug=1&authoritativeApply=opponent`

### RED/GREEN

- RED: 기존 구현은 실제 결과가 `/pages/tetrisMulti.html?roomId=ABCD1234&debug=1`이라 테스트가 실패했다.
- GREEN: `authoritativeApply=opponent`를 명시적으로 보존한 뒤 `test/testMultiplayerDebug.js`가 통과했다.

### 브라우저 확인 중 발견한 한계

- Codex in-app browser는 이번 환경에서 열린 탭을 하나만 유지했다.
- 두 번째 탭을 열면 기존 host tab handle도 같은 로비 상태를 보게 되어, 실제 2-player 브라우저 검증에는 적합하지 않았다.
- 따라서 자동화 도구로는 URL 보존 단위 테스트와 단일 탭 로비 상태만 확인하고, 실제 2인 플레이는 사용자의 일반 브라우저에서 두 창/두 프로필로 확인하는 것이 맞다.

### 의미

- 이제 로비에서 시작한 opponent authoritative apply 실험 모드가 게임 화면까지 이어진다.
- 다음 수동 검증에서 URL이 실험 모드를 잃어버리는 문제와 실제 동기화 문제를 구분할 수 있다.

## 멀티 로비 2탭 검증용 player session reset query 추가

### 목적

- 같은 브라우저에서 새 탭을 열면 기존 탭의 `sessionStorage`가 복제될 수 있다.
- 이 경우 두 탭이 같은 `tetris:playerId`를 사용해서 실제 2인 플레이 검증이 어려워진다.
- 브라우저 2탭 회귀 검증을 안정적으로 하기 위해, 두 번째 탭에서 player session을 명시적으로 초기화할 수 있는 debug query를 추가했다.

### 변경 사항

- `shouldResetPlayerSession(search)`를 `src/client/pages/multiLobbyState.js`에 추가했다.
  - `?resetPlayer=1`일 때만 true를 반환한다.
  - `?resetPlayer=true`, `?debug=1`, 빈 query는 false다.
- `multiLobby.html`에서 `currentPlayer`를 만들기 전에 `resetPlayer=1`을 확인한다.
- reset 대상:
  - `tetris:playerId`
  - `tetris:nickname`
  - `tetris:roomId`
  - `room`
- `PLAN.md`의 브라우저 2탭 검증 절차에 `/pages/multiLobby.html?resetPlayer=1` 사용 기준을 추가했다.

### RED/GREEN

- RED: `shouldResetPlayerSession()`이 없어 query 판정 테스트가 실패했다.
- GREEN: helper와 로비 초기화 연결 후 `test/testMultiLobbyState.js`가 통과했다.

### 브라우저 확인

- 로컬 서버를 `PORT=5602 npm start`로 실행했다.
- `http://localhost:5602/pages/multiLobby.html?resetPlayer=1`로 로비를 열었다.
- 기존 stale room 메시지 없이 새 `Guest####` 닉네임과 로비 대기 상태가 표시되는 것을 확인했다.

### 의미

- 실제 서비스 기능이라기보다, 현재 MVP 단계에서 같은 브라우저로 두 player를 검증하기 위한 작은 debug 진입점이다.
- 이후 2탭 검증에서는 host는 일반 로비, guest는 `?resetPlayer=1` 로비로 열면 playerId 충돌을 피할 수 있다.

## 멀티 로비 stale room sync 실패 메시지 숨김

### 목적

- 브라우저 새 탭이나 이전 세션에서 stale `tetris:roomId`가 남아 있으면 로비 진입 직후 `room:sync`가 실패할 수 있다.
- 기존 로직은 이 실패를 처리하면서 방 세션은 정리했지만, 채팅에 `ROOM_NOT_FOUND`를 그대로 출력했다.
- 사용자는 방에 직접 입장한 적이 없는 상태처럼 보이는데 채팅에는 에러가 떠서, 실제 문제가 있는 것처럼 느껴졌다.

### 변경 사항

- `src/client/pages/multiLobbyState.js`를 추가했다.
- `resolveFailedRoomResultEffect(result, requestType)`가 실패 결과 처리 정책을 결정한다.
  - `sync` 실패는 room session만 정리하고 채팅 메시지는 표시하지 않는다.
  - `join`의 `ROOM_NOT_FOUND`는 기존처럼 room session을 정리하고 메시지는 표시한다.
  - 그 외 실패는 기존처럼 reason 메시지를 표시한다.
- `multiLobby.html`의 `onRoomResult()` 실패 분기가 이 helper를 사용하게 했다.

### RED/GREEN

- RED: `multiLobbyState.js`가 없어 stale sync 실패 정책 테스트가 실패했다.
- GREEN: helper를 추가하고 로비 실패 처리에 연결한 뒤 `test/testMultiLobbyState.js`가 통과했다.

### 브라우저 확인

- 로컬 서버를 `PORT=5602 npm start`로 실행했다.
- `http://localhost:5602/pages/multiLobby.html`에서 stale room session이 있는 탭을 새로고침했다.
- 채팅에는 기본 안내 메시지만 남고 `ROOM_NOT_FOUND`가 표시되지 않는 것을 확인했다.

### 의미

- `sync` 실패는 사용자 액션 실패가 아니라 저장된 세션 복구 실패이므로 조용히 정리하는 편이 맞다.
- 직접 방 코드로 입장하다 실패한 경우는 여전히 사용자에게 이유를 보여준다.

## Opponent authoritative apply mode에서 상대 bag append 예측 비활성화

### 목적

- `?debug=1&authoritativeApply=opponent` 모드는 상대 보드를 server authoritative snapshot 후보 중심으로 관찰한다.
- 이전 단계에서 상대 보드의 client snapshot correction, input prediction, runtime autoStart, garbage prediction은 껐다.
- 하지만 상대 player의 `game:bag:append`를 받으면 여전히 `opponentGame.appendServerBag()`이 호출될 수 있었다.
- 이 경우 상대 runtime의 다음 조각 queue가 client-side bag append prediction으로 보충되어 server snapshot 후보와 섞일 수 있다.

### 변경 사항

- `shouldApplyOpponentBagPrediction(authoritativeApplyMode)`를 추가했다.
  - `off`에서는 기존처럼 상대 bag append 예측을 유지한다.
  - `opponent`에서는 상대 보드에 대한 bag append 예측을 건너뛴다.
- `tetrisMulti.html`의 `receiveGameBagAppend()` 처리에서 상대 player 대상 bag append에 이 정책을 적용했다.
- 내 player의 bag append는 기존처럼 `myGame.appendServerBag()`로 처리한다.
  - 내 보드는 아직 local prediction 기반으로 실제 플레이 중이기 때문이다.
- `PLAN.md`에 opponent authoritative apply mode에서 상대 bag append 예측도 건너뛴다고 기록했다.

### RED/GREEN

- RED: `shouldApplyOpponentBagPrediction()`이 없어 테스트가 실패했다.
- GREEN: bag prediction 정책 함수와 멀티 페이지 수신 경로를 연결한 뒤 관련 테스트가 통과했다.

### 의미

- opponent authoritative apply mode에서 상대 보드는 다음 client-side 예측 경로를 피한다.
  - client-generated snapshot correction
  - remote input prediction
  - opponent runtime autoStart
  - opponent garbage prediction
  - opponent bag append prediction
- 상대 보드 표시를 server authoritative snapshot 후보 중심으로 분리하는 실험 범위가 더 명확해졌다.
- 내 보드의 server bag 소비와 추가 요청 흐름은 유지하므로, 실제 조작 중인 플레이어 경험은 건드리지 않는다.

## Shadow authoritative 실험 목적과 해석 기준 정리

### 목적

- 현재 멀티플레이는 아직 완전한 서버 authoritative 구조가 아니다.
- 실제 플레이 화면은 client prediction, input relay, server bag, snapshot correction을 함께 사용한다.
- 서버는 shadow mode에서 같은 input과 server bag을 사용해 뒤에서 별도 game state를 계산한다.
- 이번 실험의 목적은 서버 계산값을 바로 화면에 강제 적용하는 것이 아니라, client state와 server shadow state가 어디서 어긋나는지 관찰하는 것이다.

### 왜 필요한가

- 바로 서버 authoritative로 전환하면 화면이 끊기거나 조작감이 나빠져도 원인을 분리하기 어렵다.
- shadow mode를 먼저 두면 기존 플레이는 유지하면서 다음 차이를 안전하게 확인할 수 있다.
  - client와 shadow의 `pieceIndex` 차이
  - active piece 위치/회전 차이
  - board 차이
  - pending garbage 차이
  - line clear, score, game over 시점 차이
- 이 차이를 줄여야 이후 서버 snapshot을 실제 화면의 기준으로 사용할 수 있다.

### 지금까지 확인한 것

- 브라우저 콘솔에서 별도 debug socket을 열어 `game:shadow:state`를 조회할 수 있다.
- debug socket은 기존 게임 socket과 다른 연결이므로, 먼저 `game:join`으로 같은 room context에 들어가야 한다.
- `game:shadow:state:result`의 `summary`에서 다음 값을 확인한다.
  - `shadowTick`
  - `shadowPieceIndex`
  - `phase`
  - `score`
  - `linesClearedTotal`
  - `pendingGarbageLines`
  - `activePiece`
  - `desyncCount`
  - `lastDesync`
  - `lastDesyncSeverity`
  - `lastDesyncReason`
- 게임 종료 후에 찍은 summary는 tick 차이가 크게 보일 수 있으므로, 실제 동기화 판단은 플레이 중 반복해서 찍은 summary를 우선 본다.

### 해석 기준

- `pieceIndex`가 다르면 같은 조각을 비교하고 있지 않을 가능성이 크다.
  - 이 경우 board나 attack 결과보다 spawn, lock, input 처리 순서를 먼저 확인한다.
- `pieceIndex`가 같고 `activePiece`만 다르면 이동, 회전, gravity tick 적용 순서를 먼저 확인한다.
- `pieceIndex`가 같고 board만 다르면 lock, line clear, garbage apply 순서를 먼저 확인한다.
- garbage 관련 값만 다르면 garbage cancel/apply 계산 순서와 snapshot 포함 필드를 먼저 확인한다.
- 게임 종료 후 desync 로그는 참고용으로만 보고, 플레이 중 반복되는 `lastDesyncReason`을 우선 조사한다.

### 의미

- 이 실험은 서버 authoritative 전환의 중간 단계다.
- 목표는 "서버가 맞다"를 바로 강제하는 것이 아니라, 서버와 클라이언트가 같은 입력으로 같은 결과를 만들 수 있는지 검증하는 것이다.
- desync 원인을 줄인 뒤에야 `game:authoritative:snapshot:update`를 상대 보드 또는 전체 보드에 더 넓게 적용할 수 있다.

## Shadow authoritative 콘솔 실험 의미 보강

### 목적

- 최근 브라우저 콘솔에서 `game:shadow:state`를 직접 요청한 실험은 서버 shadow state를 실제 게임 화면에 적용하기 위한 작업이 아니다.
- 목적은 현재 client prediction 구조를 유지한 상태에서, 서버가 같은 input/server bag 기준으로 계산한 shadow 결과가 클라이언트 상태와 어디서 어긋나는지 관찰하는 것이다.
- 이 관찰값을 통해 서버 authoritative 전환 전에 맞춰야 할 우선순위를 정한다.

### 실험한 내용

- 멀티 게임 화면에서 `roomId`와 `sessionStorage`의 `playerId`를 읽었다.
- 별도 `io()` debug socket을 열어 `game:shadow:state`를 요청했다.
- 처음에는 새 socket이 기존 게임 socket과 다른 연결이기 때문에 결과를 받지 못했다.
- 이후 debug socket에서도 먼저 `game:join`을 호출한 뒤 `game:shadow:state`를 요청했다.
- `game:join:result`, `game:snapshot`, `game:shadow:state:result`가 들어오는 것을 확인했다.

### 왜 필요한가

- Socket.IO socket은 페이지 안에서 새로 `io()`를 호출해도 기존 게임 socket을 공유하지 않는다.
- 따라서 debug socket도 서버 입장에서는 별도 연결이며, room/player 권한 검증을 통과해야 한다.
- 이 구조를 확인해 두면 debug API가 아무나 조회 가능한 전역 API가 아니라, room 참가자 기준으로 제한되는 테스트용 API라는 점을 검증할 수 있다.
- 또한 `onAny()`로 snapshot broadcast와 shadow result를 함께 보면, 현재 클라이언트 snapshot 전송이 얼마나 자주 발생하는지도 관찰할 수 있다.

### 해석 기준

- `desyncCount`가 증가한다고 즉시 실패로 판단하지 않는다.
- 현재 shadow mode의 목표는 desync를 0으로 만드는 것이 아니라, 어떤 상황에서 어떤 필드가 어긋나는지 추적 가능한 상태를 만드는 것이다.
- 게임 종료 후 조회한 summary는 client tick과 shadow tick 차이가 크게 보일 수 있다.
  - 종료 후에는 client game loop, snapshot 송신, shadow loop가 같은 기준으로 진행된다고 보기 어렵다.
  - 따라서 종료 후의 큰 차이는 플레이 중 실시간 desync와 분리해서 해석한다.
- 플레이 중에는 다음 값을 함께 본다.
  - `shadowTick`
  - `shadowPieceIndex`
  - `desyncCount`
  - `lastDesync.fields`
  - `lastDesyncReason`
  - `nextInvestigationHint`
  - `snapshotToShadowTickDelta`
  - `snapshotToShadowPieceIndexDelta`
  - `inputToShadowTickDelta`

### 다음 판단 기준

- `activePiece`만 짧게 어긋나는 경우는 snapshot 수신 시점이나 animation phase 차이일 수 있다.
- `pieceIndex`, `board`, `pieceQueue`, `pendingGarbageQueue`, `combo`, `backToBack`이 반복해서 어긋나면 서버 authoritative 전환 전에 먼저 원인을 좁혀야 한다.
- `pieceIndexDelta`가 0인데 placement result만 다르면 lock 이후 공격량, garbage cancel/apply 계산 순서를 본다.
- `pieceIndexDelta`가 0이 아니면 placement result보다 spawn, lock, input 처리 순서를 먼저 확인한다.

### 의미

- 이번 실험은 서버 authoritative 전환의 안전장치다.
- 서버 계산 결과를 바로 화면에 강제 적용하면 조작감, lock 타이밍, garbage 처리, line clear 타이밍 문제가 한꺼번에 드러날 수 있다.
- shadow mode는 기존 플레이를 유지하면서 서버 계산과 클라이언트 계산의 차이를 먼저 작게 나누어 보는 단계다.
- 이 차이가 충분히 줄어든 뒤에만 `game:authoritative:snapshot`을 실제 보정 후보로 쓰고, client-generated snapshot을 debug/desync 용도로 축소하는 단계로 넘어간다.

## Shadow placement scoreBefore/scoreAfter debug summary 추가

### 목적

- 기존 shadow placement 비교는 `scoreDelta`만 콘솔 summary에 노출했다.
- `scoreDelta`만 보면 점수 차이가 hard drop, line clear, 이전 총점 불일치 중 어디에서 시작됐는지 바로 구분하기 어렵다.
- 서버 authoritative 전환 전에 client placement log와 shadow placement result의 점수 흐름을 더 작은 단위로 비교할 수 있게 했다.

### 변경 사항

- `getPlayerShadowState()` summary에 shadow placement 점수 기준값을 추가했다.
  - `lastShadowPlacementScoreBefore`
  - `lastShadowPlacementScoreAfter`
- client placement 비교 summary에 client 값과 delta를 추가했다.
  - `lastClientPlacementScoreBefore`
  - `lastPlacementScoreBeforeDelta`
  - `lastClientPlacementScoreAfter`
  - `lastPlacementScoreAfterDelta`
- `createShadowSummaryDebugRow()`가 위 값을 콘솔 table row로 변환하게 했다.
  - `shadowPlacementScoreBefore`
  - `shadowPlacementScoreAfter`
  - `clientPlacementScoreBefore`
  - `placementScoreBeforeDelta`
  - `clientPlacementScoreAfter`
  - `placementScoreAfterDelta`

### RED/GREEN

- RED: summary 테스트에서 `scoreBefore/scoreAfter` 필드가 없어 실패했다.
- RED: debug row 테스트에서 콘솔 row에 점수 before/after 필드가 없어 실패했다.
- GREEN: `matchService` summary와 `multiplayerDebug` row 변환에 필드를 연결한 뒤 관련 테스트가 통과했다.

### 의미

- 이제 placement result mismatch가 점수 쪽에서 발생할 때 `scoreBefore`, `scoreAfter`, `scoreDelta`를 함께 볼 수 있다.
- `scoreBefore`부터 다르면 이전 placement나 line clear 후처리에서 이미 점수가 어긋난 것이다.
- `scoreBefore`는 같고 `scoreAfter/scoreDelta`만 다르면 현재 placement의 점수 계산 규칙을 먼저 보면 된다.
- 이 변경은 debug 관찰값만 추가하며 실제 게임 진행이나 화면 보정에는 영향을 주지 않는다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js test/testMultiplayerDebug.js` 통과

## Placement comparison debug row 점수 상세값 추가

### 목적

- 직전 단계에서 shadow summary에는 `scoreBefore`, `scoreAfter`, `scoreDelta`가 노출됐다.
- 하지만 summary는 마지막 placement 비교만 보여주므로, 최근 mismatch들이 어떤 점수 흐름으로 반복됐는지는 보기 어렵다.
- `recentPlacementComparisonLog`를 콘솔 table로 볼 때도 점수 before/after/delta를 함께 확인할 수 있게 했다.

### 변경 사항

- `createPlacementComparisonDebugRows()`가 placement comparison details에서 다음 필드를 row로 펼치게 했다.
  - `scoreBeforeClient`
  - `scoreBeforeShadow`
  - `scoreBeforeDelta`
  - `scoreAfterClient`
  - `scoreAfterShadow`
  - `scoreAfterDelta`
  - `scoreDeltaClient`
  - `scoreDeltaShadow`
  - `scoreDeltaDelta`

### RED/GREEN

- RED: placement comparison row 테스트에서 score 관련 필드가 없어 실패했다.
- GREEN: `createPlacementComparisonDebugRows()`에 score field row를 추가한 뒤 테스트가 통과했다.

### 의미

- 이제 `?debug=1`에서 최근 placement mismatch table을 볼 때 점수 차이의 누적 흐름을 확인할 수 있다.
- `scoreBeforeDelta`가 반복되면 이전 placement나 line clear 후처리에서 이미 score가 벌어진 것이다.
- `scoreBeforeDelta`는 0이고 `scoreAfterDelta` 또는 `scoreDeltaDelta`만 반복되면 현재 placement의 점수 계산 규칙을 먼저 보면 된다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerDebug.js` 통과

## Placement score mismatch 조사 힌트 추가

### 목적

- placement comparison row와 shadow summary에서 점수 before/after/delta를 볼 수 있게 됐지만, score field만 어긋나는 경우 조사 힌트는 여전히 일반 `CHECK_PLACEMENT_RESULT_FLOW`였다.
- 서버 authoritative 전환 전에는 score mismatch가 line clear, hard drop, level/score rule 중 어느 흐름에서 시작됐는지 빠르게 좁혀야 한다.
- 따라서 placement result의 점수 필드만 어긋나는 경우 score 전용 힌트를 반환하게 했다.

### 변경 사항

- `getPlayerShadowState()` summary의 placement fallback 힌트에 score field 분기를 추가했다.
  - `scoreBefore`
  - `scoreAfter`
  - `scoreDelta`
  - 위 필드가 포함되면 `CHECK_PLACEMENT_SCORE_RESULT_FLOW`를 반환한다.
- `createPlacementComparisonDebugRows()`의 row별 `investigationHint`도 같은 정책을 사용하게 했다.
- 기존 우선순위는 유지했다.
  - `pieceIndexDelta`가 0이 아니면 여전히 `CHECK_PLACEMENT_LOCK_SPAWN_ORDER`를 우선한다.
  - garbage, attack rule, line clear, game over 힌트도 기존 순서를 유지한다.

### RED/GREEN

- RED: score-only placement mismatch summary가 `CHECK_PLACEMENT_RESULT_FLOW`를 반환해 실패했다.
- RED: score-only placement comparison row가 일반 result 힌트를 반환해 실패했다.
- GREEN: server/client debug 힌트 분기에 score field를 추가한 뒤 관련 테스트가 통과했다.

### 의미

- 이제 점수 mismatch가 반복될 때 일반 placement result 흐름이 아니라 점수 계산 흐름을 바로 볼 수 있다.
- `scoreBefore`가 어긋나면 이전 placement 또는 line clear 후처리 이후 이미 점수가 벌어진 것으로 해석한다.
- `scoreBefore`는 같고 `scoreAfter/scoreDelta`만 어긋나면 현재 placement의 점수 계산 규칙을 먼저 확인한다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js test/testMultiplayerDebug.js` 통과

## game:input 후 authoritative snapshot debug update 추가

### 목적

- 기존 `game:authoritative:snapshot:update`는 shadow loop tick에서만 debug 구독자에게 전달됐다.
- 하지만 서버 authoritative 전환에서는 input 적용 직후의 서버 shadow state도 중요한 관찰 지점이다.
- 특히 빠른 입력 연타, lock 직전 입력, pieceIndex drift를 볼 때 input 직후 snapshot 후보를 확인할 수 있어야 한다.

### 변경 사항

- `game:input` 처리에서 `recordInput()`이 성공하면 `broadcastAuthoritativeSnapshotUpdates()`를 호출하게 했다.
- 이 update는 `game:authoritative:snapshot:subscribe`로 구독한 debug socket에만 전달된다.
- 기존 input relay는 유지한다.
  - 요청자는 shadow state update를 debug event로 볼 수 있다.
  - 상대는 기존처럼 `game:input` 이벤트를 받는다.
- 일반 플레이 화면에는 아직 authoritative snapshot을 적용하지 않는다.

### RED/GREEN

- RED: `game:input` 후 구독 socket이 `game:authoritative:snapshot:update`를 받지 않아 실패했다.
- GREEN: input 성공 직후 authoritative snapshot update broadcast를 연결한 뒤 socket 테스트가 통과했다.

### 의미

- 이제 debug 모드에서 shadow loop 주기뿐 아니라 input 적용 직후의 서버 snapshot 후보도 관찰할 수 있다.
- 서버 authoritative 전환 전에 "입력이 들어간 직후 서버 state가 어떻게 바뀌었는지"를 더 직접적으로 볼 수 있다.
- 이 단계는 여전히 debug-only이며, 클라이언트 화면의 최종 상태를 서버 snapshot으로 강제하지 않는다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerSocket.js` 통과

## game:garbage:attack 후 authoritative snapshot debug update 추가

### 목적

- `game:garbage:attack`은 target player의 shadow pending garbage queue를 바꾸는 상태 변경 이벤트다.
- 기존에는 garbage append broadcast와 shadow state 갱신은 되었지만, debug authoritative snapshot update는 shadow loop tick을 기다려야 했다.
- 서버 authoritative 전환 전에는 공격을 받은 직후 target shadow state가 어떻게 바뀌는지 바로 관찰할 수 있어야 한다.

### 변경 사항

- `game:garbage:attack` 처리에서 `recordGarbageAttack()`이 성공하면 `broadcastAuthoritativeSnapshotUpdates()`를 호출하게 했다.
- 이 update는 `game:authoritative:snapshot:subscribe`로 구독한 debug socket에만 전달된다.
- 기존 `game:garbage:append` broadcast는 유지한다.
- 일반 플레이 화면에는 아직 authoritative snapshot을 적용하지 않는다.

### RED/GREEN

- RED: garbage attack 후 구독 socket이 `game:authoritative:snapshot:update`를 받지 않아 실패했다.
- GREEN: garbage attack 성공 직후 authoritative snapshot update broadcast를 연결한 뒤 socket 테스트가 통과했다.

### 의미

- 이제 debug 모드에서 incoming garbage가 서버 shadow state에 들어간 직후의 snapshot 후보를 볼 수 있다.
- `pendingGarbageQueue` desync나 garbage cancel/apply mismatch를 조사할 때 shadow loop tick까지 기다리지 않아도 된다.
- 이 단계도 여전히 debug-only이며, 클라이언트 화면의 최종 상태를 서버 snapshot으로 강제하지 않는다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerSocket.js` 통과

## game:bag:request 후 authoritative snapshot debug update 추가

### 목적

- `game:bag:request`는 player별 server bag chunk를 추가하고 shadow state의 server bag queue도 갱신한다.
- visible `pieceQueue`가 즉시 바뀌지 않는 경우가 있어도, 서버 authoritative 전환 기준에서는 bag queue 변경도 중요한 상태 변화다.
- 따라서 bag request 직후 debug 구독자가 서버 snapshot 후보를 확인할 수 있게 했다.

### 변경 사항

- `game:bag:request` 처리에서 `appendPlayerBagChunk()`가 성공하면 `broadcastAuthoritativeSnapshotUpdates()`를 호출하게 했다.
- 이 update는 `game:authoritative:snapshot:subscribe`로 구독한 debug socket에만 전달된다.
- 기존 `game:bag:append` room broadcast는 유지한다.
- 일반 플레이 화면에는 아직 authoritative snapshot을 적용하지 않는다.

### RED/GREEN

- RED: bag request 후 구독 socket이 `game:authoritative:snapshot:update`를 받지 않아 실패했다.
- GREEN: bag append 성공 직후 authoritative snapshot update broadcast를 연결한 뒤 socket 테스트가 통과했다.

### 의미

- 이제 debug 모드에서 server bag queue 변경 직후의 authoritative snapshot 후보를 볼 수 있다.
- queue mismatch를 조사할 때 shadow loop tick을 기다리지 않고 bag append 직후 상태를 확인할 수 있다.
- 이 단계도 debug-only이며, client-generated snapshot과 input prediction 흐름은 유지된다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerSocket.js` 통과

## placement_decision log 후 authoritative snapshot debug update 추가

### 목적

- `game:log:placement_decision`은 단순 저장 이벤트처럼 보이지만, 서버에서는 `recordClientPlacementDecision()`으로 shadow placement result와 client placement result를 비교한다.
- 이 과정에서 shadow가 `lineClearing` 상태라면 line clear 완료 step을 먼저 적용할 수 있으므로 shadow state가 실제로 바뀔 수 있다.
- 따라서 placement decision 처리 직후 debug 구독자가 서버 snapshot 후보를 볼 수 있어야 한다.

### 변경 사항

- `game:log:placement_decision` 처리에서 로그 저장이 성공하고 `placementResult`가 있을 때 `recordClientPlacementDecision()` 결과를 확인한다.
- `recordClientPlacementDecision()`이 성공하면 `broadcastAuthoritativeSnapshotUpdates()`를 호출한다.
- 이 update는 `game:authoritative:snapshot:subscribe`로 구독한 debug socket에만 전달된다.
- 저장 실패, 권한 실패, `placementResult` 없는 로그는 기존 흐름을 유지한다.

### RED/GREEN

- RED: placement decision log 후 구독 socket이 `game:authoritative:snapshot:update`를 받지 않아 실패했다.
- GREEN: placement decision 비교 성공 직후 authoritative snapshot update broadcast를 연결한 뒤 socket 테스트가 통과했다.

### 의미

- 이제 debug 모드에서 lock/placement 결과 비교 직후의 서버 snapshot 후보를 볼 수 있다.
- placement comparison mismatch와 authoritative snapshot 후보를 같은 시점에 관찰하기 쉬워졌다.
- 이 단계도 debug-only이며, 일반 플레이 화면에는 아직 서버 snapshot을 강제 적용하지 않는다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerSocket.js` 통과

## authoritative snapshot subscribe 초기 update 추가

### 목적

- 기존 `game:authoritative:snapshot:subscribe`는 구독 등록 결과만 반환했다.
- 그래서 debug 모드에서는 다음 shadow loop tick, input, garbage, bag, placement 이벤트가 발생할 때까지 서버 snapshot 후보를 기다려야 했다.
- 구독 직후 현재 match의 authoritative snapshot 후보를 바로 받아야 debug 시작 시점의 기준 상태를 확인할 수 있다.

### 변경 사항

- `game:authoritative:snapshot:subscribe` 성공 직후 해당 socket에 현재 room의 player별 `game:authoritative:snapshot:update`를 emit하게 했다.
- 기존 room 전체 broadcast가 아니라 새로 구독한 socket에만 초기 update를 보낸다.
- `broadcastAuthoritativeSnapshotUpdates()`는 특정 socket에 player별 snapshot 후보를 보내는 helper를 재사용하도록 정리했다.
- 기존 cleanup 테스트는 구독 직후 초기 update를 baseline으로 잡고, unsubscribe/leave/game over 이후 추가 update가 없는지 확인하도록 조정했다.

### RED/GREEN

- RED: subscribe 직후 구독 socket이 `game:authoritative:snapshot:update`를 받지 않아 실패했다.
- GREEN: subscribe 성공 직후 초기 snapshot update emit을 연결한 뒤 socket 테스트가 통과했다.

### 의미

- 이제 `?debug=1`에서 authoritative snapshot push 구독을 시작하면, 다음 서버 이벤트를 기다리지 않고 현재 서버 shadow snapshot 후보를 바로 볼 수 있다.
- 이후 input, garbage, bag, placement, shadow loop update와 초기 상태를 비교하기 쉬워졌다.
- 이 단계도 debug-only이며, 일반 플레이 화면에 서버 snapshot을 강제 적용하지 않는다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerSocket.js` 통과

## authoritative snapshot updateReason metadata 추가

### 목적

- `game:authoritative:snapshot:update`는 이제 여러 경로에서 발생한다.
  - subscribe 직후 초기 상태
  - shadow loop tick
  - input
  - garbage attack
  - bag request
  - placement decision log
- 기존 debug table에서는 모두 `push`로만 보여서, 어떤 이벤트 때문에 snapshot 후보가 내려왔는지 구분하기 어려웠다.
- 서버 authoritative 전환 전에는 push 원인을 함께 봐야 desync 흐름을 빠르게 추적할 수 있다.

### 변경 사항

- 서버 `game:authoritative:snapshot:update` payload에 `updateReason`을 추가했다.
  - `subscribe_initial`
  - `shadow_tick`
  - `input`
  - `garbage`
  - `bag`
  - `placement`
- `createAuthoritativeSnapshotDebugRow()`가 `updateReason`을 `authoritativeUpdateReason`으로 console table row에 표시하게 했다.
- 요청형 `game:authoritative:snapshot:result`에는 기존처럼 `updateReason`이 없으며 debug row에서는 `null`로 표시된다.

### RED/GREEN

- RED: socket update payload에 `updateReason`이 없어 subscribe/input update 테스트가 실패했다.
- RED: debug row에 `authoritativeUpdateReason`이 없어 debug row 테스트가 실패했다.
- GREEN: 서버 update payload와 클라이언트 debug row에 metadata를 연결한 뒤 관련 테스트가 통과했다.

### 의미

- 이제 `?debug=1` table에서 같은 push라도 초기 구독인지, input 직후인지, garbage/bag/placement로 인한 것인지 바로 구분할 수 있다.
- 이 metadata는 관찰용이며, 게임 상태 계산이나 일반 플레이 화면에는 영향을 주지 않는다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerSocket.js test/testMultiplayerDebug.js` 통과

## Shadow 초기 fallIntervalMs client 기준 정렬

### 목적

- shadow debug summary에서 `FALL_INTERVAL_MISMATCH`가 반복될 경우, 실제 gameplay 차이인지 초기 설정 차이인지 먼저 구분해야 한다.
- 클라이언트 runtime은 `INITIAL_FALL_INTERVAL_MS = 500`으로 시작하지만, server shadow engine은 `DEFAULT_FALL_INTERVAL_MS = 800`으로 시작하고 있었다.
- 이 차이는 게임 시작 직후부터 client snapshot과 shadow snapshot의 `fallIntervalMs`를 다르게 만들어, 다른 desync 원인을 흐릴 수 있다.

### 변경 사항

- `src/server/services/shadowGameEngine.js`의 `DEFAULT_FALL_INTERVAL_MS`를 `500`으로 변경했다.
- `test/testShadowGameEngine.js`의 초기 shadow state 검증도 `fallIntervalMs: 500`을 기대하도록 수정했다.

### RED/GREEN

- RED: 테스트 기대값을 `500`으로 바꾸자 기존 shadow state가 `800`을 반환해 실패했다.
- GREEN: shadow engine 기본값을 `500`으로 맞춘 뒤 `test/testShadowGameEngine.js`가 통과했다.

### 의미

- 이제 shadow state는 클라이언트 게임 시작 시점과 같은 초기 낙하 간격으로 비교된다.
- 이후에도 `FALL_INTERVAL_MISMATCH`가 남는다면 단순 초기값 차이가 아니라, level/score/fall interval 갱신 규칙 차이를 봐야 한다.
- 이 변경은 실제 클라이언트 조작이나 화면에는 영향을 주지 않고, server shadow 관찰 기준만 client runtime에 맞춘다.

### 검증

- `node --test --test-reporter=dot test/testShadowGameEngine.js` 통과
- `node --test --test-reporter=dot test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js` 통과
- `node --test --test-reporter=dot` 통과

## Shadow placementResult 점수 필드 추가

### 목적

- client placement log의 `placementResult`에는 `scoreBefore`, `scoreAfter`, `scoreDelta`가 포함된다.
- 하지만 server shadow의 `lastPlacementResult`에는 공격/가비지 결과만 있고 점수 필드가 없어, 점수 차이가 placement 단위에서 비교되지 않았다.
- 서버 authoritative 전환 전에는 "같은 조각 lock 결과가 같은 점수 변화를 만들었는지"를 확인해야 하므로, shadow placement 결과도 client log와 같은 점수 필드를 갖게 했다.

### 변경 사항

- `src/server/services/shadowGameEngine.js`의 `lastPlacementResult`에 다음 필드를 추가했다.
  - `scoreBefore`
  - `scoreAfter`
  - `scoreDelta`
- hard drop은 클라이언트와 같이 hard drop 점수가 더해지기 전의 점수를 `scoreBefore`로 기록한다.
- line clear animation 단계처럼 lock과 최종 placement result 생성이 분리되는 경우를 위해 `pendingLockScoreBefore`를 shadow state에 보관한다.
- `src/server/services/matchService.js`의 placement result 비교 필드에 점수 필드를 추가했다.
  - `scoreBefore`
  - `scoreAfter`
  - `scoreDelta`

### RED/GREEN

- RED: shadow hard drop placement result에 `scoreBefore`가 없어 `undefined !== 0`으로 실패했다.
- RED: matchService placement comparison이 `scoreDelta` 차이를 fields에 포함하지 않아 실패했다.
- GREEN: shadow placement result와 matchService 비교 필드를 확장한 뒤 관련 테스트가 통과했다.

### 의미

- 이제 placement result mismatch를 볼 때 공격량뿐 아니라 점수 변화도 같은 조각 기준으로 비교할 수 있다.
- `scoreDelta`만 다르면 점수 규칙 차이를 먼저 보면 되고, `pieceIndexDelta`도 함께 다르면 점수보다 lock/spawn 순서 차이를 먼저 보면 된다.
- 이 변경은 shadow 관찰 정확도를 높이는 작업이며, 아직 클라이언트 화면에 서버 점수를 강제 적용하지 않는다.

### 검증

- `node --test --test-reporter=dot test/testShadowGameEngine.js test/testMatchService.js` 통과
- `node --test --test-reporter=dot` 통과

## Shadow line clear 완료 타이밍 보정

### 목적

- 클라이언트는 line clear가 발생하면 350ms 애니메이션이 끝난 뒤 `placement_decision` 로그를 보낸다.
- server shadow는 기존에 `lineClearing` 상태를 다음 shadow gravity tick에서 완료했다.
- shadow loop interval은 500ms이므로, 클라이언트 placement log가 먼저 도착하는 150ms 정도의 구간에서는 shadow가 아직 `lineClearing` 상태일 수 있다.
- 이 경우 client placement result와 shadow placement result를 비교할 때, 실제 규칙 차이가 아니라 완료 타이밍 차이 때문에 모든 필드가 mismatch로 기록될 수 있다.

### 변경 사항

- `src/server/services/shadowGameEngine.js`에 `line_clear_complete` step을 추가했다.
  - shadow state가 `lineClearing`일 때만 줄 삭제, 점수/라인/공격 결과 계산, 다음 조각 스폰을 완료한다.
  - 기존 gravity tick으로 line clear를 완료하는 경로는 유지한다.
- `recordClientPlacementDecision()`에서 client placement log가 line clear 결과를 포함하고 shadow가 아직 `lineClearing`이면, 비교 전에 shadow를 `line_clear_complete`로 한 단계 진행한다.
- 이 완료 후 갱신된 `lastShadowSnapshot`과 client placement result를 비교한다.

### RED/GREEN

- RED: `line_clear_complete` step 테스트에서 shadow phase가 `lineClearing`에 머물러 실패했다.
- RED: client placement log가 도착했을 때 shadow가 아직 `lineClearing`이면 모든 placement result field가 mismatch로 기록되어 실패했다.
- GREEN: explicit line clear complete step과 placement 비교 전 완료 처리를 추가한 뒤 관련 테스트가 통과했다.

### 의미

- line clear 자체의 규칙 차이가 아니라 애니메이션/loop 타이밍 차이로 생기는 placement mismatch를 줄인다.
- 이제 line clear placement log가 들어오는 시점에는 shadow도 같은 placement 완료 지점까지 진행한 뒤 비교한다.
- 이후에도 `linesCleared`, `scoreDelta`, `attackLines` mismatch가 남으면 타이밍 문제가 아니라 실제 line clear/score/garbage 규칙 차이를 보면 된다.

### 검증

- `node --test --test-reporter=dot test/testShadowGameEngine.js test/testMatchService.js` 통과
- `node --test --test-reporter=dot test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js` 통과
- `node --test --test-reporter=dot` 통과

## Shadow line clear complete의 tick 기준 분리

### 목적

- `line_clear_complete`는 client placement log 도착 시점에 shadow를 같은 placement 완료 지점까지 진행시키기 위한 서버 내부 step이다.
- 이때 client log의 `tick`을 그대로 shadow engine step tick으로 사용하면, shadow tick이 client tick 값으로 점프한다.
- 그러면 `shadowTick`이 "서버 shadow가 몇 step 진행했는가"가 아니라 "마지막으로 받은 client tick"처럼 보이게 되어 debug summary 해석이 어려워진다.

### 변경 사항

- `recordClientPlacementDecision()`에서 shadow `line_clear_complete`를 실행할 때 `log.tick` 대신 `player.shadowTick + 1`을 사용한다.
- client tick은 placement log/metadata의 시간축으로 유지하고, shadow tick은 서버 shadow step 시간축으로 유지한다.

### RED/GREEN

- RED: client placement log tick을 `100`으로 보낸 line clear 완료 테스트에서 shadow tick이 `100`으로 점프해 실패했다.
- GREEN: `line_clear_complete`의 tick을 `player.shadowTick + 1`로 바꾼 뒤 shadow tick이 `1`로 유지되어 테스트가 통과했다.

### 의미

- 이제 shadow tick은 client tick과 섞이지 않고 서버 shadow 진행 횟수를 나타낸다.
- 큰 client tick 값이 들어와도 shadow summary의 `shadowTick`이 갑자기 커지지 않는다.
- 이후 tick delta를 볼 때는 "서버 shadow 진행 속도"와 "client input/snapshot tick"의 차이로 해석할 수 있다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js` 통과
- `node --test --test-reporter=dot test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js` 통과
- `node --test --test-reporter=dot` 통과

## Shadow line clear complete pieceIndex guard 추가

### 목적

- `line_clear_complete`는 client placement log가 도착했을 때 shadow가 같은 line clear 완료 지점까지 따라오도록 만든 보정 step이다.
- 하지만 늦게 도착한 out-of-order placement log가 현재 shadow의 `lineClearing` 조각과 다른 `pieceIndex`를 가질 수 있다.
- 이런 로그로 shadow line clear를 완료해 버리면, 서버 shadow가 실제 진행 중인 조각이 아닌 과거/미래 로그 때문에 다음 조각으로 넘어갈 수 있다.

### 변경 사항

- `completeShadowLineClearBeforePlacementComparison()`에 pieceIndex guard를 추가했다.
- client placement log에 `pieceIndex`가 있고, 이 값이 현재 shadow state의 `pieceIndex`와 다르면 `line_clear_complete`를 실행하지 않는다.
- pieceIndex가 일치할 때만 shadow를 line clear 완료 상태로 진행시킨다.

### RED/GREEN

- RED: client placement log의 `pieceIndex`가 shadow `pieceIndex`와 다른데도 shadow phase가 `playing`으로 진행되어 실패했다.
- GREEN: pieceIndex guard를 추가한 뒤 shadow phase가 `lineClearing`에 남고, out-of-order log로 shadow가 진행되지 않았다.

### 의미

- line clear 완료 보정이 정상적인 같은 조각 로그에만 적용된다.
- out-of-order placement log는 mismatch로 기록될 수 있지만, shadow state 자체를 잘못 전진시키지는 않는다.
- 이후 `CHECK_PLACEMENT_LOCK_SPAWN_ORDER`가 반복될 때 실제 순서 문제인지, 늦은 로그인지 구분하기 쉬워진다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js` 통과
- `node --test --test-reporter=dot test/testMatchService.js test/testMultiplayerSocket.js` 통과
- `node --test --test-reporter=dot` 통과

## Shadow line clear complete skip reason debug 추가

### 목적

- line clear complete pieceIndex guard가 발동하면 shadow state는 안전하게 유지되지만, 기존에는 왜 완료가 건너뛰어졌는지 summary에서 바로 확인할 수 없었다.
- out-of-order placement log가 반복되는지 확인하려면 마지막 skip reason과 client/shadow pieceIndex를 볼 수 있어야 한다.

### 변경 사항

- match player 상태에 `lastSkippedShadowLineClearComplete`를 추가했다.
- pieceIndex mismatch로 `line_clear_complete`를 건너뛴 경우 다음 정보를 저장한다.
  - `reason`
  - `clientPieceIndex`
  - `shadowPieceIndex`
  - `clientTick`
  - `shadowTick`
- `getPlayerShadowState()` summary에 다음 필드를 추가했다.
  - `lastSkippedShadowLineClearComplete`
  - `lastSkippedShadowLineClearCompleteReason`
- `createShadowSummaryDebugRow()`가 console table에 `skippedLineClearCompleteReason`을 표시한다.
- 정상적으로 line clear complete가 실행되면 이전 skip 정보는 `null`로 초기화한다.

### RED/GREEN

- RED: out-of-order placement log 테스트에서 summary의 skip reason이 `undefined`라 실패했다.
- RED: multiplayer debug row에 `skippedLineClearCompleteReason`이 없어 실패했다.
- GREEN: matchService summary와 debug row에 skip reason을 연결한 뒤 관련 테스트가 통과했다.

### 의미

- `CHECK_PLACEMENT_LOCK_SPAWN_ORDER`가 반복될 때, 실제 lock/spawn 순서 문제인지 line clear complete guard가 out-of-order log를 막고 있는 상황인지 구분할 수 있다.
- 이 정보는 debug 전용이며 클라이언트 화면이나 게임 진행에는 영향을 주지 않는다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js` 통과
- `node --test --test-reporter=dot test/testMultiplayerDebug.js` 통과
- `node --test --test-reporter=dot test/testMatchService.js test/testMultiplayerDebug.js test/testMultiplayerSocket.js` 통과
- `node --test --test-reporter=dot` 통과

## Shadow line clear complete skip debug row 세부값 추가

### 목적

- `skippedLineClearCompleteReason`만으로는 line clear complete가 왜 막혔는지는 알 수 있지만, 어떤 client/shadow pieceIndex와 tick에서 발생했는지는 raw summary를 따로 열어봐야 했다.
- 브라우저 `?debug=1` console table에서 바로 out-of-order 정도를 확인할 수 있도록 핵심 숫자를 함께 표시한다.

### 변경 사항

- `createShadowSummaryDebugRow()`에 다음 필드를 추가했다.
  - `skippedLineClearClientPieceIndex`
  - `skippedLineClearShadowPieceIndex`
  - `skippedLineClearClientTick`
  - `skippedLineClearShadowTick`
- 값은 `summary.lastSkippedShadowLineClearComplete`에서 읽는다.
- summary가 없거나 skip 정보가 없으면 모두 `null`로 표시한다.

### RED/GREEN

- RED: debug row expected에 skip 세부값을 추가하자 실제 row에 해당 필드가 없어 실패했다.
- GREEN: `multiplayerDebug.js`에서 skip metadata를 row로 변환한 뒤 debug helper 테스트가 통과했다.

### 의미

- `CHECK_PLACEMENT_LOCK_SPAWN_ORDER`나 `PIECE_INDEX_MISMATCH`를 볼 때, client가 몇 번째 조각 로그를 보냈고 shadow가 몇 번째 조각에서 막혔는지 바로 확인할 수 있다.
- 이 변경은 debug console 출력만 확장하며 게임 진행에는 영향을 주지 않는다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerDebug.js` 통과
- `node --test --test-reporter=dot test/testMatchService.js test/testMultiplayerDebug.js test/testMultiplayerSocket.js` 통과
- `node --test --test-reporter=dot` 통과

## Shadow placement scoreDelta debug summary 추가

### 목적

- server shadow placement result에는 `scoreDelta`가 포함되지만, 기존 debug summary와 console row에서는 공격/가비지 값만 바로 볼 수 있었다.
- 점수 mismatch를 줄이려면 같은 조각 lock 결과에서 client와 shadow가 각각 얼마의 scoreDelta를 만들었는지 바로 비교할 수 있어야 한다.

### 변경 사항

- `getPlayerShadowState()` summary에 다음 필드를 추가했다.
  - `lastShadowPlacementScoreDelta`
  - `lastClientPlacementScoreDelta`
  - `lastPlacementScoreDeltaDelta`
- `createShadowSummaryDebugRow()`에 다음 console table 필드를 추가했다.
  - `shadowPlacementScoreDelta`
  - `clientPlacementScoreDelta`
  - `placementScoreDeltaDelta`
- 값이 없으면 `null`로 표시한다.

### RED/GREEN

- RED: matchService summary에 scoreDelta 필드가 없어 placement comparison summary 테스트가 실패했다.
- RED: multiplayer debug row에 scoreDelta 필드가 없어 debug helper 테스트가 실패했다.
- GREEN: matchService summary와 debug row 변환을 연결한 뒤 관련 테스트가 통과했다.

### 의미

- `SCORE_MISMATCH`나 placement result의 `scoreDelta` mismatch가 보일 때, raw log를 열지 않고도 client/shadow 점수 변화 차이를 콘솔에서 바로 확인할 수 있다.
- 이 변경은 debug 관찰값만 확장하며 게임 진행에는 영향을 주지 않는다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js test/testMultiplayerDebug.js` 통과
- `node --test --test-reporter=dot test/testMatchService.js test/testMultiplayerDebug.js test/testMultiplayerSocket.js` 통과
- `node --test --test-reporter=dot` 통과

## Shadow spawn 시 lastActionWasRotation 초기화

### 목적

- T-Spin 판정은 `lastActionWasRotation` 상태에 의존한다.
- 클라이언트 runtime은 새 조각 스폰 시 `renderBlocks("spawn")` 흐름을 지나면서 `lastActionWasRotation`을 false로 되돌린다.
- server shadow는 기존에 `startNextTurn()`에서 이 값을 초기화하지 않아, 이전 조각의 회전 상태가 다음 조각으로 새어 들어갈 수 있었다.
- 이 경우 다음 조각이 실제로 회전하지 않았는데도 shadow에서 T-Spin으로 판정될 위험이 있다.

### 변경 사항

- `src/server/services/shadowGameEngine.js`의 `startNextTurn()`에서 새 `activePiece`를 스폰한 뒤 `lastActionWasRotation = false`로 초기화했다.
- T-Spin no line lock 후 다음 조각이 스폰되면 회전 플래그가 false로 내려가는 테스트를 추가했다.

### RED/GREEN

- RED: T-Spin no line lock 후 다음 조각이 스폰되어도 shadow `lastActionWasRotation`이 true로 남아 실패했다.
- GREEN: `startNextTurn()`에서 회전 플래그를 초기화한 뒤 shadow engine 테스트가 통과했다.

### 의미

- client와 shadow의 새 턴 시작 상태가 더 가까워졌다.
- 이전 조각의 회전 상태가 다음 조각의 T-Spin 판정을 오염시키는 문제를 막는다.
- 이후 T-Spin/attack mismatch가 남으면 spawn 초기화보다 회전 wall kick, lock 위치, line clear 규칙을 우선 확인하면 된다.

### 검증

- `node --test --test-reporter=dot test/testShadowGameEngine.js` 통과
- `node --test --test-reporter=dot test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerSocket.js` 통과
- `node --test --test-reporter=dot` 통과

## Shadow debug 브라우저 실험 흐름 정리

### 목적

- 지금까지의 shadow 실험은 서버 계산 결과를 바로 게임 화면에 적용하기 위한 작업이 아니다.
- 현재 멀티플레이는 client prediction 구조로 플레이를 유지하고, 서버는 같은 input과 server bag을 이용해 뒤에서 shadow state를 계산한다.
- 이 실험의 목적은 client snapshot과 server shadow snapshot을 비교해서, 완전한 server authoritative 전환 전에 어떤 상태가 어긋나는지 확인하는 것이다.
- 특히 빠른 입력, lock 직후 입력, garbage cancel/apply, combo/back-to-back, piece queue 소비 순서가 client와 shadow에서 같은 흐름으로 처리되는지 관찰한다.

### 실험한 내용

- 멀티 게임 화면에서 `roomId`와 `sessionStorage`의 `playerId`를 읽어 shadow debug 요청을 보냈다.
- 처음에는 새로 만든 debug socket에서 바로 `game:shadow:state`를 요청했지만 결과를 받지 못했다.
- 원인은 새 `io()` 호출이 기존 게임 socket을 재사용하는 것이 아니라, 서버 입장에서는 별도의 새 socket connection이기 때문이다.
- 따라서 debug socket도 먼저 `game:join`으로 room context에 들어간 뒤 `game:shadow:state`를 요청해야 한다.

```js
window.__shadowDebug?.socket?.disconnect();
clearInterval(window.__shadowDebug?.timer);

const roomId = new URLSearchParams(location.search).get("roomId");
const playerId = sessionStorage.getItem("tetris:playerId");
const socket = io();

socket.on("connect", () => {
    socket.emit("game:join", { roomId, playerId });

    const timer = setInterval(() => {
        socket.emit("game:shadow:state", { roomId, playerId });
    }, 2000);

    window.__shadowDebug = { socket, timer };
});

socket.on("game:shadow:state:result", (result) => {
    const summary = result.shadow?.summary;

    console.log("summary:", summary);
    console.log("lastDesync fields:", summary?.lastDesync?.fields);
    console.log("lastDesync:", summary?.lastDesync);

    console.table({
        severity: summary?.lastDesyncSeverity,
        reason: summary?.lastDesyncReason,
        fields: summary?.lastDesync?.fields?.join(", "),
        desyncCount: summary?.desyncCount,
        shadowTick: summary?.shadowTick,
        shadowPieceIndex: summary?.shadowPieceIndex,
    });
});
```

### 확인한 점

- `game:join:result`가 먼저 들어온 뒤 `game:shadow:state:result`를 받을 수 있었다.
- `onAny()`로 이벤트를 찍으면 shadow 결과뿐 아니라 현재 `game:snapshot` broadcast 흐름도 같이 확인할 수 있었다.
- 게임 중 조회한 summary는 실시간 desync 관찰에 유효하다.
- 게임 종료 후 조회한 summary는 client tick과 shadow tick 차이가 크게 보일 수 있으므로, 실시간 플레이 중 desync와 구분해서 해석해야 한다.

### 해석 기준

- `desyncCount`가 증가한다고 바로 실패로 보지 않는다.
- `activePiece`만 약간 다르면 gravity/lock timing 차이일 수 있으므로 낮은 위험으로 본다.
- `pieceIndex`, `board`, `pieceQueue`, `pendingGarbageQueue`, `combo`, `backToBack`이 반복해서 어긋나면 server authoritative 전환 전에 먼저 좁혀야 할 문제로 본다.
- placement comparison의 `pieceIndexDelta`가 0이면 같은 조각 결과 비교로 볼 수 있고, 이때 garbage 관련 field가 다르면 cancel/apply 계산 순서를 우선 확인한다.
- `pieceIndexDelta`가 0이 아니면 placement result 자체보다 spawn, lock, input 처리 순서 차이를 먼저 의심한다.

### 의미

- shadow debug 실험은 "서버가 이미 정답을 만들고 있다"는 증명이 아니다.
- 기존 플레이를 깨지 않고 서버 계산과 클라이언트 계산의 차이를 축적해, 완전 authoritative 전환의 위험 지점을 줄이는 중간 단계다.
- 이 관찰값을 기준으로 다음에는 반복되는 desync reason부터 하나씩 줄인다.
  - `QUEUE_MISMATCH`: server bag 소비 순서 확인
  - `GARBAGE_MISMATCH`: garbage 수신, cancel, apply 타이밍 확인
  - `ATTACK_STATE_MISMATCH`: combo/back-to-back 갱신 순서 확인
  - `FALL_INTERVAL_MISMATCH`: level, score, fall interval 갱신 기준 확인

## Critical placement drift debug warning 추가

### 목적

- `recentPlacementAttentionLevel === "critical"`은 서버 authoritative 전환 전에 우선 조사해야 하는 상태다.
- 하지만 `?debug=1`에서는 summary table, placement comparison table, authoritative snapshot table이 계속 출력되므로 critical 값을 놓칠 수 있다.
- critical placement drift가 감지되면 console warning을 별도로 남겨 가시성을 높인다.

### 변경 사항

- `warnCriticalPlacementDebug(row, logWarn)` helper를 추가했다.
- `row.recentPlacementAttentionLevel === "critical"`일 때만 warning을 남긴다.
- warning payload에는 다음 정보를 포함한다.
  - `attention`
  - `driftLevel`
  - `hint`
  - `maxTickDelta`
  - `maxPieceIndexDelta`
- `tetrisMulti.html`의 shadow debug polling에서 `createShadowStateDebugRow()` 결과를 table로 출력한 뒤 `warnCriticalPlacementDebug()`를 호출한다.

### RED/GREEN

- RED: `warnCriticalPlacementDebug` export가 없어 debug helper 테스트가 실패했다.
- GREEN: helper와 `tetrisMulti.html` 연결을 추가한 뒤 `test/testMultiplayerDebug.js`가 통과했다.

### 의미

- 이 경고는 debug 전용 관찰 기능이며 게임 상태를 수정하지 않는다.
- critical drift가 발생하면 콘솔에서 바로 lock/spawn/input/server bag 순서를 우선 확인할 수 있다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerDebug.js` 통과

## Recent placement attention level 추가

### 목적

- 기존 `recentOverallShadowHealth`는 `stable / info_only / needs_attention` 범위에서 동작한다.
- placement mismatch가 있으면 이미 `needs_attention`이지만, `major_order_drift`처럼 더 우선적으로 봐야 하는 상태를 구분하지는 못했다.
- 기존 health enum을 흔들지 않고 placement 전용 우선순위 필드로 `recentPlacementAttentionLevel`을 추가했다.

### 변경 사항

- `getPlayerShadowState()` summary에 `recentPlacementAttentionLevel`을 추가했다.
- `createShadowSummaryDebugRow()`가 console table에 같은 값을 표시한다.
- 분류 기준은 다음과 같다.
  - `stable`: `recentPlacementDriftLevel === "none"`
  - `critical`: `recentPlacementDriftLevel === "major_order_drift"`
  - `needs_attention`: 그 외 placement drift/mismatch 상태

### RED/GREEN

- RED: summary에 `recentPlacementAttentionLevel`이 없어 테스트가 실패했다.
- RED: debug row에 `recentPlacementAttentionLevel`이 없어 deepEqual 테스트가 실패했다.
- GREEN: drift level을 attention level로 변환하는 helper와 debug row 필드를 추가한 뒤 `test/testMatchService.js`, `test/testMultiplayerDebug.js`가 통과했다.

### 의미

- 기존 shadow health는 유지하면서 placement mismatch 전용 우선순위를 더 세밀하게 볼 수 있다.
- `critical`이면 placement 계산보다 lock/spawn/input/server bag 순서 문제를 먼저 조사한다.
- `needs_attention`이면 recent row와 dominant hint를 기준으로 세부 원인을 본다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js test/testMultiplayerDebug.js` 통과

## Recent placement drift level 추가

### 목적

- recent placement summary는 max tick/piece delta를 숫자로 보여주지만, 실험 중에는 이 값이 얼마나 심각한지 바로 판단하기 어렵다.
- 서버 authoritative 전환 전 debug에서는 숫자와 함께 간단한 분류값이 있으면 다음 조사 우선순위를 더 빨리 잡을 수 있다.

### 변경 사항

- `getPlayerShadowState()` summary에 `recentPlacementDriftLevel`을 추가했다.
- `createShadowSummaryDebugRow()`가 `recentPlacementDriftLevel`을 console table에 표시한다.
- 분류 기준은 다음과 같다.
  - `none`: recent placement mismatch 없음
  - `same_piece_mismatch`: 같은 pieceIndex 안에서 placement result만 다름
  - `minor_order_drift`: out-of-order mismatch가 있고 max pieceIndex delta가 1
  - `major_order_drift`: out-of-order mismatch가 있고 max pieceIndex delta가 2 이상
  - `unknown`: pieceIndex 비교가 불가능한 mismatch만 있음

### RED/GREEN

- RED: summary에 `recentPlacementDriftLevel`이 없어 테스트가 실패했다.
- RED: debug row에 `recentPlacementDriftLevel`이 없어 deepEqual 테스트가 실패했다.
- GREEN: drift level helper와 debug row 필드를 추가한 뒤 `test/testMatchService.js`, `test/testMultiplayerDebug.js`가 통과했다.

### 의미

- `major_order_drift`가 나오면 placement 계산보다 lock/spawn/server bag/input 순서 차이를 우선 확인한다.
- `same_piece_mismatch`가 나오면 같은 조각 기준으로 garbage, line clear, attack rule 계산을 우선 확인한다.
- `minor_order_drift`는 지속적으로 누적되는 1-piece 차이인지, 일시적인 timing 차이인지 recent row와 함께 본다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js test/testMultiplayerDebug.js` 통과

## Recent placement investigation hint 집계 추가

### 목적

- placement comparison row마다 `investigationHint`는 표시되지만, 최근 mismatch 전체에서 어떤 힌트가 가장 많이 나오는지는 직접 세어야 했다.
- shadow authoritative 전환 중에는 최근 10개 mismatch의 우세 원인을 빠르게 판단하는 것이 중요하다.
- 따라서 summary에 recent placement hint count와 dominant hint를 추가했다.

### 변경 사항

- `getPlayerShadowState()` summary에 다음 필드를 추가했다.
  - `recentPlacementInvestigationHintCounts`
  - `recentDominantPlacementInvestigationHint`
  - `recentDominantPlacementInvestigationHintCount`
- hint count는 `recentPlacementComparisonLog`에 있는 각 entry를 `getPlacementInvestigationHint()`로 분류해 집계한다.
- `createShadowSummaryDebugRow()`는 console table에 dominant hint와 count만 표시한다.
  - `recentDominantPlacementInvestigationHint`
  - `recentDominantPlacementInvestigationHintCount`

### RED/GREEN

- RED: summary에 `recentPlacementInvestigationHintCounts`가 없어 테스트가 실패했다.
- RED: debug row에 `recentDominantPlacementInvestigationHint`가 없어 deepEqual 테스트가 실패했다.
- GREEN: matchService summary와 debug row에 집계 필드를 연결한 뒤 `test/testMatchService.js`, `test/testMultiplayerDebug.js`가 통과했다.

### 의미

- `recentDominantPlacementInvestigationHint === "CHECK_PLACEMENT_LOCK_SPAWN_ORDER"`이면 최근 mismatch의 주된 원인은 placement 계산보다 진행 순서 차이일 가능성이 높다.
- `recentDominantPlacementInvestigationHint === "CHECK_PLACEMENT_GARBAGE_RESULT_FLOW"`이면 같은 조각 기준 garbage cancel/apply 계산을 먼저 볼 수 있다.
- row 단위 `investigationHint`는 개별 mismatch 분석용이고, summary의 dominant hint는 최근 흐름의 우선순위 판단용이다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js test/testMultiplayerDebug.js` 통과

## Placement investigation hint count 콘솔 표시 추가

### 목적

- `recentPlacementInvestigationHintCounts`는 server summary payload에는 있었지만, `?debug=1`의 summary console table에서는 dominant hint만 보였다.
- 여러 원인이 섞여 있을 때 dominant hint만 보면 두 번째 원인의 존재를 놓칠 수 있다.
- console table에서도 recent placement hint count 전체를 한 줄로 볼 수 있게 했다.

### 변경 사항

- `createShadowSummaryDebugRow()`에 `recentPlacementInvestigationHintCounts` 표시를 추가했다.
- count 객체는 table에서 읽기 쉽도록 정렬된 문자열로 변환한다.
  - 예: `CHECK_PLACEMENT_GARBAGE_RESULT_FLOW:1|CHECK_PLACEMENT_LOCK_SPAWN_ORDER:2`
- 값이 없거나 count가 0뿐이면 `null`로 표시한다.

### RED/GREEN

- RED: debug row에 `recentPlacementInvestigationHintCounts`가 없어 deepEqual 테스트가 실패했다.
- GREEN: `formatCountMap()`을 추가하고 summary row에 연결한 뒤 `test/testMultiplayerDebug.js`가 통과했다.

### 의미

- 이제 `?debug=1` summary table에서 recent placement mismatch의 우세 원인과 섞인 원인을 동시에 볼 수 있다.
- dominant hint는 우선순위 판단용이고, count 문자열은 원인 분포 확인용이다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerDebug.js` 통과

## recent placement comparison debug table 추가

### 목적

- `game:shadow:state` payload에 `recentPlacementComparisonLog`가 포함되지만, 기존 `?debug=1` 콘솔 출력은 summary row만 표시했다.
- 따라서 최근 placement mismatch의 실제 `client`, `shadow`, `delta` 값을 보려면 콘솔에서 직접 객체를 펼쳐야 했다.
- 브라우저 2탭 실험 중 빠르게 원인을 보기 위해 recent placement comparison 전용 console table을 추가했다.

### 변경 사항

- `createPlacementComparisonDebugRows(shadow)`를 추가했다.
  - `shadow.recentPlacementComparisonLog`를 console table용 row 배열로 변환한다.
  - `fields`, `recordedAt`을 표시한다.
  - 주요 garbage/attack field의 client/shadow/delta를 펼쳐서 표시한다.
    - `attackLines`
    - `canceledGarbageLines`
    - `rawAttackLines`
    - `appliedGarbageLines`
- `tetrisMulti.html`의 `?debug=1` shadow polling 결과 처리에서 placement comparison rows가 있으면 별도 `console.table()`로 출력하게 했다.
- log가 없으면 빈 배열을 반환해 불필요한 table 출력은 하지 않는다.

### RED/GREEN

- RED: `createPlacementComparisonDebugRows`가 없어 debug helper 테스트가 실패했다.
- GREEN: helper와 `tetrisMulti.html` debug 출력 연결을 추가한 뒤 `test/testMultiplayerDebug.js`가 통과했다.

### 의미

- 이제 `?debug=1` 상태에서 placement mismatch가 발생하면 summary table 외에 최근 placement comparison table도 함께 볼 수 있다.
- `attackLinesDelta`, `canceledGarbageLinesDelta`를 콘솔에서 바로 확인할 수 있어, garbage attack/cancel 원인 추적이 쉬워진다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerDebug.js` 통과

## shadow/authoritative debug row 식별값 추가

### 목적

- placement comparison row에는 `debugType`이 있었지만, shadow summary와 authoritative snapshot row에는 식별값이 없었다.
- `?debug=1`에서 여러 console table이 연속 출력될 때 table 종류를 일관되게 구분하기 위해 row 식별값을 맞췄다.

### 변경 사항

- `createShadowSummaryDebugRow()` row에 `debugType: "shadow_summary"`를 추가했다.
- `createAuthoritativeSnapshotDebugRow()` row에 `authoritativeDebugType: "authoritative_snapshot"`을 추가했다.
- 기존 placement comparison row의 `debugType: "placement_comparison"`과 함께 세 debug table을 구분할 수 있다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerDebug.js` 통과

## placement comparison debug row 식별값 추가

### 목적

- `?debug=1`에서는 shadow summary, authoritative snapshot, placement comparison table이 함께 출력될 수 있다.
- placement comparison table row가 어떤 debug table인지 바로 구분되도록 식별값을 추가했다.

### 변경 사항

- `createPlacementComparisonDebugRows()` row에 다음 필드를 추가했다.
  - `debugType: "placement_comparison"`
  - `fieldCount`
- console table에서 placement comparison row를 summary/authoritative row와 더 쉽게 구분할 수 있다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerDebug.js` 통과

## placementResult mismatch field count 관찰값 추가

### 목적

- 이전 단계에서는 마지막 `placementResult` mismatch field만 확인할 수 있었다.
- 하지만 실제 2탭 플레이 실험에서는 한 번의 차이보다 어떤 field가 반복해서 어긋나는지가 더 중요하다.
- 서버 authoritative garbage 전환 전에 `attackLines`, `canceledGarbageLines`, `appliedGarbageLines` 같은 field 중 어디가 자주 틀어지는지 볼 수 있게 했다.

### 변경 사항

- player별 shadow match state에 `placementComparisonLog`를 추가했다.
  - mismatch가 있는 placement comparison만 기록한다.
  - 최대 50개까지만 유지해 debug 로그가 무한히 커지지 않게 했다.
- `getPlayerShadowState()` summary에 누적 mismatch 관찰값을 추가했다.
  - `placementResultMismatchCount`
  - `placementResultMismatchFieldCounts`
  - `dominantPlacementResultMismatchField`
  - `dominantPlacementResultMismatchFieldCount`
- `createShadowSummaryDebugRow()`가 console table에 다음 값을 표시하게 했다.
  - `placementResultMismatchCount`
  - `dominantPlacementResultMismatchField`
  - `dominantPlacementResultMismatchFieldCount`

### RED/GREEN

- RED: placement comparison을 두 번 기록해도 summary에 누적 count가 없어 실패했다.
- RED: debug row에 placement mismatch count/dominant field가 없어 실패했다.
- GREEN: bounded `placementComparisonLog`, summary count, debug row 변환을 추가한 뒤 관련 테스트가 통과했다.

### 의미

- 이제 마지막 mismatch만 보는 것이 아니라, 한 match 안에서 어떤 placement 결과 field가 반복해서 어긋나는지 볼 수 있다.
- 예를 들어 `dominantPlacementResultMismatchField`가 계속 `canceledGarbageLines`라면, line clear 자체보다 garbage cancel 순서를 먼저 의심할 수 있다.
- `attackLines`가 dominant라면 combo/back-to-back/T-Spin 보너스 계산 또는 raw attack 계산 순서를 먼저 확인하면 된다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js test/testMultiplayerDebug.js` 통과

## Placement mismatch 조사 힌트에 piece alignment 우선순위 반영

### 목적

- placement result mismatch가 있을 때 기존 힌트는 mismatch field를 먼저 봤다.
- 예를 들어 `attackLines`, `canceledGarbageLines`가 다르면 항상 `CHECK_PLACEMENT_GARBAGE_RESULT_FLOW`가 나왔다.
- 하지만 client와 shadow의 `pieceIndex`가 이미 다르면, garbage 계산 자체보다 lock/spawn/input/server bag 순서 차이를 먼저 봐야 한다.

### 변경 사항

- `getPlayerShadowState()` summary의 `nextInvestigationHint` 계산에서 마지막 placement comparison log entry를 사용하게 했다.
  - 이 entry에는 `clientPieceIndex`, `shadowPieceIndex`, `pieceIndexDelta` metadata가 들어 있다.
- `getPlacementInvestigationHint()`에서 `pieceIndexDelta !== 0`이면 field 기반 힌트보다 먼저 `CHECK_PLACEMENT_LOCK_SPAWN_ORDER`를 반환한다.
- pieceIndex를 비교할 수 없거나 `pieceIndexDelta === 0`이면 기존 field 기반 힌트를 유지한다.
  - garbage 관련 field mismatch: `CHECK_PLACEMENT_GARBAGE_RESULT_FLOW`
  - combo/back-to-back/T-Spin mismatch: `CHECK_PLACEMENT_ATTACK_RULE_FLOW`
  - line clear mismatch: `CHECK_PLACEMENT_LINE_CLEAR_RESULT_FLOW`
  - game over mismatch: `CHECK_PLACEMENT_GAME_OVER_FLOW`

### RED/GREEN

- RED: out-of-order placement mismatch 테스트에서 기존 로직이 `CHECK_PLACEMENT_GARBAGE_RESULT_FLOW`를 반환해 실패했다.
- GREEN: pieceIndex delta를 우선 확인하게 바꾼 뒤 `test/testMatchService.js`가 통과했다.

### 의미

- 이제 placement mismatch를 봤을 때 "같은 조각의 결과 계산 문제"와 "이미 다른 조각을 비교한 문제"를 더 빨리 구분할 수 있다.
- `CHECK_PLACEMENT_LOCK_SPAWN_ORDER`가 나오면 garbage rule보다 먼저 다음 흐름을 확인한다.
  - lock 확정 시점
  - 다음 조각 spawn 시점
  - server bag 소비 순서
  - input queue 처리 순서
- `pieceIndexDelta === 0`에서 garbage 힌트가 나오면 같은 조각 기준으로 cancel/apply 계산 순서를 보면 된다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js` 통과

## Placement comparison piece alignment 분류 추가

### 목적

- 이전 단계에서 placement comparison log에 `tick`과 `pieceIndex` metadata를 붙였다.
- 하지만 콘솔을 보는 사람이 직접 `clientPieceIndex`, `shadowPieceIndex`, `pieceIndexDelta`를 해석해야 했다.
- 서버 authoritative 전환 전에는 mismatch를 발견했을 때 바로 다음 조사 경로를 줄이는 것이 중요하다.

### 변경 사항

- `getPlayerShadowState()` summary에 placement comparison 기준 진행 차이를 추가했다.
  - `lastPlacementComparisonTickDelta`
  - `lastPlacementComparisonPieceIndexDelta`
  - `lastPlacementComparisonPieceAlignment`
  - `recentSamePiecePlacementMismatchCount`
  - `recentOutOfOrderPlacementMismatchCount`
  - `recentUnknownPiecePlacementMismatchCount`
- `lastPlacementComparisonPieceAlignment`는 기존 pieceIndex 방향 표현을 재사용한다.
  - `in_sync`: client와 shadow가 같은 pieceIndex의 placement 결과를 비교 중
  - `client_ahead`: client가 shadow보다 더 뒤 조각의 placement 결과를 보냄
  - `shadow_ahead`: shadow가 client보다 더 뒤 조각 상태에 있음
  - `null`: 양쪽 pieceIndex를 비교할 수 없음
- `createShadowSummaryDebugRow()`가 위 값을 console table row에 표시한다.

### RED/GREEN

- RED: summary에 `lastPlacementComparisonTickDelta`가 없어 `undefined !== 10`으로 실패했다.
- RED: debug row에 `placementTickDelta`, `placementPieceAlignment`, recent alignment count가 없어 deepEqual 테스트가 실패했다.
- GREEN: summary와 debug row에 alignment 분류를 연결한 뒤 `test/testMatchService.js`, `test/testMultiplayerDebug.js`가 통과했다.

### 의미

- `placementPieceAlignment === "in_sync"`인데 `attackLines`나 `canceledGarbageLines`가 다르면 같은 조각의 결과 계산 차이다.
  - 이때는 garbage cancel/apply, combo/back-to-back, T-Spin 공격량 계산 순서를 먼저 본다.
- `placementPieceAlignment === "client_ahead"` 또는 `"shadow_ahead"`이면 placement result 자체보다 진행 순서 차이가 먼저다.
  - 이때는 lock, spawn, server bag 소비, input queue 처리 순서를 먼저 본다.
- `recentSamePiecePlacementMismatchCount`와 `recentOutOfOrderPlacementMismatchCount`를 함께 보면 최근 mismatch가 계산 규칙 문제인지 진행 동기화 문제인지 빠르게 구분할 수 있다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js test/testMultiplayerDebug.js` 통과

## recent placement comparison log debug payload 추가

### 목적

- placement mismatch summary는 어떤 field가 자주 어긋나는지 보여준다.
- 하지만 실제 원인을 좁히려면 마지막 몇 건의 `client`, `shadow`, `delta` 값을 바로 확인할 수 있어야 한다.
- 기존에는 `lastPlacementComparison`만 내려와서 최근 흐름을 확인하려면 서버 상태를 추가로 추적해야 했다.

### 변경 사항

- `getPlayerShadowState()` debug payload에 placement comparison log를 추가했다.
  - `placementComparisonLog`
  - `recentPlacementComparisonLog`
- `placementComparisonLog`는 기존 bounded log 전체를 복사해서 내려준다.
  - 최대 50개
  - mismatch가 있는 placement comparison만 포함
- `recentPlacementComparisonLog`는 최근 debug window 기준으로 잘라서 내려준다.
  - 현재 기준은 `RECENT_DESYNC_WINDOW_SIZE`
- 각 entry는 다음 정보를 포함한다.
  - `fields`
  - `details`
  - `recordedAt`

### RED/GREEN

- RED: `getPlayerShadowState()` 결과에 `placementComparisonLog`와 `recentPlacementComparisonLog`가 없어 실패했다.
- GREEN: placement comparison log 복사와 최근 window 반환을 추가한 뒤 `test/testMatchService.js`가 통과했다.

### 의미

- 이제 콘솔에서 다음처럼 최근 mismatch의 실제 차이를 바로 볼 수 있다.

```js
result.shadow.recentPlacementComparisonLog.at(-1).details
```

- summary count는 반복 경향을 보는 용도이고, recent comparison log는 마지막 몇 건의 실제 값 차이를 확인하는 용도다.
- 서버 authoritative garbage 전환 전에 `attackLines`, `canceledGarbageLines`, `appliedGarbageLines`의 실제 delta를 더 빠르게 확인할 수 있다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js` 통과

## overallShadowHealth debug 상태 추가

### 목적

- `shadowHealth`는 snapshot desync를 본다.
- `placementResultHealth`는 client/shadow placement result 비교를 본다.
- 두 값이 분리되면서 원인은 더 명확해졌지만, console table의 첫 health만 보면 placement mismatch가 있는 상황을 놓칠 수 있었다.
- 따라서 top-line 상태로 사용할 수 있는 `overallShadowHealth`를 추가했다.

### 변경 사항

- `getPlayerShadowState()` summary에 전체 health를 추가했다.
  - `overallShadowHealth`
  - `recentOverallShadowHealth`
- 계산 기준:
  - `shadowHealth` 또는 `placementResultHealth` 중 하나라도 `needs_attention`이면 `needs_attention`
  - 하나라도 `info_only`이면 `info_only`
  - 둘 다 안정 상태면 `stable`
- `createShadowSummaryDebugRow()`가 console table에 다음 값을 표시하게 했다.
  - `overallHealth`
  - `recentOverallHealth`

### RED/GREEN

- RED: snapshot desync만 있는 summary에서 `overallShadowHealth`가 없어 실패했다.
- RED: placement mismatch만 있는 summary에서 `overallShadowHealth`가 없어 실패했다.
- RED: debug row에 `overallHealth`, `recentOverallHealth`가 없어 실패했다.
- GREEN: summary health 결합과 debug row 변환을 추가한 뒤 관련 테스트가 통과했다.

### 의미

- 이제 debug table에서 `overallHealth`를 먼저 보고, 세부 원인은 `health`와 `placementHealth`를 나눠서 보면 된다.
- `overallHealth`가 `needs_attention`이고 `health`가 `stable`이면, board/pieceIndex보다 placement result, attack, garbage cancel/apply 쪽을 먼저 보면 된다.
- `recentOverallHealth`는 최근 실험 구간에서 문제가 남아 있는지 빠르게 확인하는 값이다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js test/testMultiplayerDebug.js` 통과

## placementResultHealth debug 상태 추가

### 목적

- `shadowHealth`는 snapshot desync 기준으로 계산된다.
- 따라서 snapshot desync가 없어도 client `placementResult`와 shadow `lastPlacementResult`가 다르면, 실제로는 garbage/attack 계산을 확인해야 하는데 health가 stable처럼 보일 수 있었다.
- placement result 비교는 snapshot desync와 다른 관찰 층이므로, 별도의 health 값을 추가했다.

### 변경 사항

- `getPlayerShadowState()` summary에 placement result 전용 health를 추가했다.
  - `placementResultHealth`
  - `recentPlacementResultHealth`
- health 기준은 단순하다.
  - placement mismatch count가 0이면 `stable`
  - 1개 이상이면 `needs_attention`
- `createShadowSummaryDebugRow()`가 console table에 다음 값을 표시하게 했다.
  - `placementHealth`
  - `recentPlacementHealth`

### RED/GREEN

- RED: placement mismatch가 있어도 `placementResultHealth`가 없어 실패했다.
- RED: debug row에 `placementHealth`, `recentPlacementHealth`가 없어 실패했다.
- GREEN: summary와 debug row에 placement health를 추가한 뒤 관련 테스트가 통과했다.

### 의미

- 이제 snapshot desync 상태와 placement result mismatch 상태를 분리해서 볼 수 있다.
- `shadowHealth`가 stable이어도 `placementHealth`가 `needs_attention`이면, board/pieceIndex보다 lock 결과, attack, cancel, garbage apply 계산을 먼저 보면 된다.
- 최근 실험 상태는 `recentPlacementHealth`를 보면 된다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js test/testMultiplayerDebug.js` 통과

## recent placementResult mismatch field count 추가

### 목적

- 전체 `placementResult` mismatch count는 match 동안 누적된 경향을 보여준다.
- 하지만 긴 플레이에서는 과거 mismatch가 계속 남아 있어, 최근에 실제로 반복되는 문제를 빠르게 보기 어렵다.
- 기존 desync summary처럼 최근 window 기준 placement mismatch 통계를 따로 제공해, 현재 실험 구간의 원인을 더 쉽게 좁히게 했다.

### 변경 사항

- `getPlayerShadowState()` summary에 최근 placement mismatch 통계를 추가했다.
  - `recentPlacementResultMismatchCount`
  - `recentPlacementResultMismatchFieldCounts`
  - `recentDominantPlacementResultMismatchField`
  - `recentDominantPlacementResultMismatchFieldCount`
- 최근 기준은 기존 desync recent window와 같은 `RECENT_DESYNC_WINDOW_SIZE`를 사용한다.
- `createShadowSummaryDebugRow()`가 console table에 최근 placement mismatch 값을 표시하게 했다.
  - `recentPlacementResultMismatchCount`
  - `recentDominantPlacementResultMismatchField`
  - `recentDominantPlacementResultMismatchFieldCount`

### RED/GREEN

- RED: 11개 placement mismatch 중 최근 10개가 모두 `attackLines`인 테스트에서 recent field 값이 없어 실패했다.
- RED: debug row에 recent placement mismatch field가 없어 실패했다.
- GREEN: recent placement comparison window 계산과 debug row 변환을 추가한 뒤 관련 테스트가 통과했다.

### 의미

- 이제 전체 누적 mismatch와 최근 mismatch를 구분해서 볼 수 있다.
- 예를 들어 전체 dominant는 `canceledGarbageLines`인데 최근 dominant는 `attackLines`라면, 최근 수정 이후에는 공격량 계산 쪽을 먼저 보면 된다.
- 실제 2탭 실험에서 특정 조작 직후 recent 값이 바뀌는지 확인하면 원인 범위를 더 좁힐 수 있다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js test/testMultiplayerDebug.js` 통과
- `node --test --test-reporter=dot test/testMultiplayerSocket.js` 통과

## Authoritative snapshot update debug 구독 방식으로 전환

### 목적

- `game:authoritative:snapshot:update`는 아직 게임 화면에 적용하지 않는 debug/관찰용 payload다.
- 이전 단계에서는 서버 shadow loop가 진행될 때 같은 room 전체에 update를 broadcast했다.
- 이 방식은 `?debug=1`이 아닌 일반 게임 탭에도 authoritative 후보 snapshot을 계속 내려보내므로, 관찰용 데이터가 실제 플레이 네트워크 흐름에 섞이는 문제가 있다.
- 이번 변경은 debug 클라이언트가 명시적으로 구독한 경우에만 push update를 받게 만든 작업이다.

### 변경 사항

- `src/client/net/roomClient.js`에 구독 요청 adapter를 추가했다.
  - `subscribeGameAuthoritativeSnapshotUpdates(roomId, playerId)`
  - `unsubscribeGameAuthoritativeSnapshotUpdates(roomId, playerId)`
- 서버 Socket.IO 핸들러에 구독/해제 이벤트를 추가했다.
  - `game:authoritative:snapshot:subscribe`
  - `game:authoritative:snapshot:unsubscribe`
- 서버는 `syncRoom(roomId, playerId)`로 참가자만 구독할 수 있게 검증한다.
- 서버는 room 전체 broadcast 대신 구독 socket Set에만 `game:authoritative:snapshot:update`를 직접 emit한다.
- socket disconnect 시 해당 socket의 debug 구독도 정리한다.
- `attachAuthoritativeSnapshotUpdateDebug()`가 debug attach 시 subscribe, detach 시 unsubscribe를 호출하게 했다.
- `tetrisMulti.html`은 `?debug=1`일 때만 update 구독을 시작하고, debug polling 정리 시 구독도 해제한다.

### 의미

- 일반 플레이 클라이언트는 더 이상 debug-only authoritative update를 받지 않는다.
- `?debug=1` 클라이언트만 push형 authoritative 후보 snapshot을 관찰한다.
- 요청형 `game:authoritative:snapshot`은 그대로 유지한다.
- 아직 이 snapshot을 화면에 적용하지 않는다.
- 목적은 server authoritative 전환 전 관찰 경로를 실제 플레이 경로와 분리하는 것이다.

### 검증

- `node --test --test-reporter=dot test/testRoomClient.js` 통과
- `node --test --test-reporter=dot test/testMultiplayerSocket.js` 통과
- `node --test --test-reporter=dot test/testMultiplayerDebug.js` 통과

## Authoritative snapshot update debug table 연결

### 목적

- 서버는 이제 shadow loop tick마다 `game:authoritative:snapshot:update`를 push할 수 있다.
- 하지만 클라이언트 멀티 게임 화면에서는 아직 이 push update를 직접 관찰하지 않았다.
- 이번 변경은 `?debug=1` 상태에서 서버가 push한 authoritative snapshot 후보를 console table로 출력해, 요청형 snapshot과 push형 snapshot을 함께 비교할 수 있게 만든 작업이다.

### 변경 사항

- `src/client/game/debug/multiplayerDebug.js`에 `attachAuthoritativeSnapshotUpdateDebug()`를 추가했다.
  - `debugEnabled`가 false면 구독하지 않는다.
  - update 결과가 실패면 warning만 남긴다.
  - 성공 결과는 `createAuthoritativeSnapshotDebugRow()`로 변환해 `console.table()`에 출력한다.
- `src/client/pages/tetrisMulti.html`에서 debug mode일 때 `receiveGameAuthoritativeSnapshotUpdate()`를 연결했다.
- debug polling 중지 시 update listener도 함께 해제한다.
- `PLAN.md`에 `?debug=1` 멀티 게임 화면에서 push update를 console table로 관찰할 수 있음을 추가했다.

### 의미

- 이제 authoritative 후보 snapshot은 브라우저에서 두 방식으로 볼 수 있다.
  - 요청형 table: 2초 polling으로 요청한 `game:authoritative:snapshot:result`
  - push형 table: 서버 shadow loop가 보낸 `game:authoritative:snapshot:update`
- 아직 이 값은 `applySnapshot()`으로 게임 화면에 적용하지 않는다.
- 현재 목적은 서버 push snapshot의 주기, payload, player 구분, shadow 기반 상태 변화를 관찰하는 것이다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerDebug.js` 통과
- `node --test --test-reporter=dot test/testRoomClient.js` 통과

## Authoritative snapshot debug delivery 구분 추가

### 목적

- `?debug=1`에서는 요청형 `game:authoritative:snapshot:result`와 push형 `game:authoritative:snapshot:update`가 모두 console table로 출력된다.
- 두 row가 같은 형태라서 콘솔에서 어떤 값이 수동/주기 요청 결과이고, 어떤 값이 서버 push 결과인지 구분하기 어려웠다.
- 이번 변경은 debug table row에 전달 경로를 표시해 snapshot 후보를 비교하기 쉽게 만든 작업이다.

### 변경 사항

- `createAuthoritativeSnapshotDebugRow(snapshot, delivery)`가 `authoritativeDelivery` 필드를 반환하게 했다.
- 요청형 debug polling에서는 `delivery`를 `"request"`로 넘긴다.
- 서버 push update debug listener에서는 `delivery`를 `"push"`로 넘긴다.
- snapshot이 없으면 `authoritativeDelivery`는 `null`이다.

### 의미

- 콘솔 table에서 `authoritativeDelivery`를 보면 snapshot 후보의 출처를 바로 구분할 수 있다.
  - `request`: 클라이언트가 2초 polling으로 요청한 응답
  - `push`: 서버 shadow loop가 능동적으로 보낸 update
- 여전히 이 값은 화면에 적용하지 않는다.
- 목적은 authoritative 전환 전 관찰성을 높이는 것이다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerDebug.js` 통과
- `node --test --test-reporter=dot test/testRoomClient.js` 통과

## Authoritative snapshot debug table 메타데이터 표시

### 목적

- 이전 단계에서 `game:authoritative:snapshot:result` 응답에 `roomId`, `playerId`, `source`, `createdAt`을 추가했다.
- 하지만 브라우저 `?debug=1` console table은 `result.snapshot`만 넘기고 있어서, 실제 table에서는 이 메타데이터를 볼 수 없었다.
- 이번 변경은 서버 응답 식별값을 debug table에 그대로 표시해서 여러 탭/플레이어/room 실험 중 어떤 응답인지 바로 구분하기 위한 작업이다.

### 변경 사항

- `createAuthoritativeSnapshotDebugRow()`가 snapshot 단독 객체와 서버 응답 전체 객체를 모두 처리하게 했다.
- 서버 응답 전체를 받을 경우 다음 필드를 table row에 포함한다.
  - `authoritativeRoomId`
  - `authoritativePlayerId`
  - `authoritativeSource`
  - `authoritativeCreatedAt`
- `tetrisMulti.html`의 authoritative snapshot debug listener가 `result.snapshot` 대신 `result` 전체를 넘기도록 바꿨다.

### 의미

- `?debug=1` 상태에서 authoritative snapshot table을 보면 이제 어떤 room/player 기준 응답인지 바로 확인할 수 있다.
- `authoritativeSource: "server_shadow"`를 통해 이 값이 아직 화면에 강제 적용되는 최종 서버 상태가 아니라, shadow 기반 authoritative 후보임을 구분할 수 있다.
- 게임 진행 로직, snapshot correction, 상대 보드 표시 정책은 바꾸지 않는다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerDebug.js` 통과
- `node --test --test-reporter=dot test/testRoomClient.js` 통과

## Authoritative snapshot push 수신 adapter 계약 추가

### 목적

- 지금까지 authoritative snapshot 후보는 클라이언트가 `game:authoritative:snapshot`을 요청해야만 `game:authoritative:snapshot:result`로 받을 수 있었다.
- 하지만 이후 서버 authoritative 방향으로 전환하려면, 서버가 일정 tick 또는 주기마다 snapshot 후보를 밀어주는 경로도 필요하다.
- 이번 변경은 아직 서버 자동 broadcast를 만들지 않고, 클라이언트 쪽 수신 이벤트 이름과 adapter 계약만 먼저 고정한 작업이다.

### 변경 사항

- `src/client/net/roomClient.js`에 `receiveGameAuthoritativeSnapshotUpdate(handler)`를 추가했다.
- 이 함수는 서버 push 이벤트 `game:authoritative:snapshot:update`를 구독하고, 해제 함수를 반환한다.
- `PLAN.md`의 MVP Event Contract에 `game:authoritative:snapshot` 요청/응답과 향후 `game:authoritative:snapshot:update` push 이벤트 의미를 추가했다.

### 의미

- `game:authoritative:snapshot:result`는 클라이언트 요청에 대한 응답이다.
- `game:authoritative:snapshot:update`는 나중에 서버가 능동적으로 보내는 authoritative 후보 snapshot이다.
- 두 경로를 분리하면 debug polling, 수동 요청, 서버 push 전환을 섞지 않고 단계적으로 진행할 수 있다.
- 아직 이 update 이벤트는 화면에 적용하지 않는다.
- 아직 서버가 자동 broadcast하지도 않는다.

### 검증

- `node --test --test-reporter=dot test/testRoomClient.js` 통과

## Authoritative snapshot update 서버 push 연결

### 목적

- 이전 단계에서는 `game:authoritative:snapshot:update`를 클라이언트가 받을 수 있는 adapter 계약만 준비했다.
- 이번 변경은 서버 shadow loop가 진행될 때, 서버가 계산한 authoritative snapshot 후보를 실제 Socket.IO room에 push하는 경로를 연결한 작업이다.
- 아직 이 snapshot은 화면에 적용하지 않고, server authoritative 전환 전 payload와 주기, 관찰 흐름을 검증하는 용도로만 둔다.

### 변경 사항

- `startShadowMatchLoop(roomId, intervalMs, onAdvance)`가 shadow tick 진행 후 callback을 호출할 수 있게 했다.
  - callback에는 `advanceShadowMatch(roomId)`의 결과 객체가 전달된다.
  - match가 사라졌거나 실패하면 기존처럼 shadow loop를 정리하고 callback은 호출하지 않는다.
- `multiplayerHandlers.js`의 `room:start` 흐름에서 shadow loop callback을 등록했다.
- callback이 호출되면 match의 각 player에 대해 `getPlayerAuthoritativeSnapshot(roomId, playerId)`를 호출한다.
- 생성된 snapshot 후보를 같은 Socket.IO room에 `game:authoritative:snapshot:update`로 broadcast한다.
- 테스트에서는 실제 interval을 기다리는 service 테스트와, dependency injection으로 callback을 직접 호출하는 socket 테스트를 분리했다.

### 의미

- 이제 authoritative snapshot 후보는 두 경로로 볼 수 있다.
  - 요청형: `game:authoritative:snapshot` → `game:authoritative:snapshot:result`
  - push형: shadow loop tick → `game:authoritative:snapshot:update`
- push형 update는 아직 최종 서버 권위 상태가 아니다.
- `source: "server_shadow"`를 유지하므로, 클라이언트는 이 값이 shadow 기반 후보라는 점을 구분할 수 있다.
- 이 단계는 화면 적용이 아니라 server push 계약과 payload 흐름을 검증하기 위한 중간 단계다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js` 통과
- `node --test --test-reporter=dot test/testMultiplayerSocket.js` 통과

## Shadow authoritative debug 실험 흐름 정리

### 목적

- 이번 실험은 서버 authoritative로 바로 전환하는 작업이 아니라, 현재 client prediction 구조와 서버 shadow 계산이 얼마나 어긋나는지 관찰하기 위한 작업이다.
- 클라이언트는 기존처럼 직접 게임을 진행하고, 서버는 같은 input/server bag 기준으로 뒤에서 shadow state를 계산한다.
- 이 상태에서 `game:shadow:state`, 요청형 `game:authoritative:snapshot:result`, push형 `game:authoritative:snapshot:update`를 비교해 desync 원인을 좁힌다.
- 핵심 목적은 서버 계산 결과를 화면에 강제 적용하기 전에, 서버가 만든 후보 상태가 client snapshot과 어느 정도 일치하는지 확인하는 것이다.

### 실험 방법

- 멀티 게임 페이지에 `?debug=1`을 붙여 debug polling을 활성화한다.
- 브라우저 콘솔에서 shadow summary와 authoritative snapshot table을 확인한다.
- `authoritativeDelivery` 값으로 snapshot 후보의 출처를 구분한다.
  - `request`: 클라이언트가 주기적으로 요청한 응답
  - `push`: 서버 shadow loop가 구독 socket에 보낸 update
- `lastDesync`, `lastDesyncSeverity`, `lastDesyncReason`, `shadowTick`, `shadowPieceIndex`, `authoritativeBoardChecksum`을 같이 보면서 차이가 누적되는지 확인한다.

### 관찰 기준

- `desyncCount`가 증가하더라도 바로 실패로 보지 않는다.
- 현재 shadow state는 실제 화면에 적용되지 않으므로, desync는 게임을 멈추는 조건이 아니라 관찰 데이터다.
- 게임 종료 후 찍은 값은 client tick과 shadow tick 차이가 크게 보일 수 있다.
  - 종료 후에는 클라이언트 게임 루프, snapshot 송신, shadow loop 상태가 같은 속도로 진행된다고 보기 어렵다.
  - 따라서 의미 있는 비교는 플레이 중 같은 시점에 반복해서 찍은 summary를 기준으로 한다.
- `activePiece`만 어긋나는 경우와 `pieceIndex`, `board`까지 같이 어긋나는 경우를 구분해서 본다.
  - `activePiece` 차이는 입력/중력 타이밍 차이일 수 있다.
  - `pieceIndex` 또는 `board` 차이는 lock, line clear, garbage 적용 순서까지 확인해야 하는 신호다.

### 의미

- shadow debug 실험은 완전 authoritative 전환 전 안전장치다.
- 지금 단계에서 서버 snapshot은 화면을 고치는 값이 아니라, 서버가 나중에 권위 상태로 내려줄 수 있는 후보 값이다.
- 이 실험으로 다음 전환 조건을 확인한다.
  - 같은 input/server bag 기준으로 서버 shadow board가 client board와 충분히 일치하는가
  - 빠른 입력 연타 후에도 `pieceIndex` 차이가 누적되지 않는가
  - line clear, score, pending garbage, game over 시점이 크게 어긋나지 않는가
- 이 조건이 안정화된 뒤에만 상대 보드 표시나 최종 보정 기준을 서버 authoritative snapshot으로 옮긴다.

## Authoritative snapshot debug 구독 결과 관찰 연결

### 목적

- `?debug=1` 멀티 게임 화면은 authoritative snapshot push update를 받기 위해 서버에 debug 구독을 요청한다.
- 기존에는 push update 자체의 실패만 warning으로 볼 수 있었고, 구독/해제 요청이 실패했을 때는 브라우저에서 원인을 바로 보기 어려웠다.
- 이번 변경은 debug 구독 요청 결과도 같은 debug 흐름에서 관찰할 수 있게 만든 작업이다.

### 변경 사항

- `attachAuthoritativeSnapshotUpdateDebug()`가 선택적으로 구독 결과 listener를 받을 수 있게 했다.
  - `receiveSubscribeResult`
  - `receiveUnsubscribeResult`
- 구독 실패 시 `authoritative snapshot update subscribe failed:` warning을 남긴다.
- 구독 해제 실패 시 `authoritative snapshot update unsubscribe failed:` warning을 남긴다.
- debug detach 시 update listener뿐 아니라 구독 결과 listener도 함께 해제한다.
- `tetrisMulti.html`의 `?debug=1` 연결에서 room client adapter를 helper에 넘기도록 연결했다.

### 의미

- debug 구독이 `NOT_AUTHORIZED`, `ROOM_NOT_FOUND` 같은 이유로 실패하면 콘솔에서 바로 확인할 수 있다.
- 일반 플레이 흐름은 바뀌지 않는다.
- 여전히 authoritative snapshot update는 debug 구독 socket에만 내려가며, 게임 화면에는 적용하지 않는다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerDebug.js` 통과

## Authoritative tick / snapshot 주기 기준 문서화

### 목적

- 서버 authoritative 전환을 계속 진행하려면 서버 tick, snapshot push, client snapshot 축소 기준을 먼저 맞춰야 한다.
- 지금은 요청형 snapshot, debug push snapshot, client-generated snapshot이 함께 존재하므로 각 경로의 역할을 문서로 분리했다.

### 변경 사항

- `PLAN.md`의 `Client prediction -> server authoritative 전환 계획`에 tick/snapshot 주기 기준을 추가했다.
- 현재 shadow/debug 단계의 기준을 명확히 했다.
  - 서버 authoritative tick은 우선 100ms 단위로 검증한다.
  - `game:authoritative:snapshot:update`는 현재 `?debug=1` 구독 socket에만 보낸다.
  - 일반 플레이 화면은 아직 client prediction + client snapshot correction을 유지한다.
- 완전 authoritative 전환 시점의 1차 목표를 적었다.
  - 서버 simulation tick: 50-100ms
  - authoritative snapshot push: 100-250ms
  - client-generated `game:snapshot`: debug/desync report 용도로 축소
- snapshot에 포함/제외할 필드 기준을 다시 고정했다.

### 의미

- 다음 구현에서 "push snapshot을 얼마나 자주 보낼지", "일반 클라이언트에도 보낼지", "client snapshot을 언제 줄일지"를 매번 다시 결정하지 않아도 된다.
- 이 변경은 코드 동작을 바꾸지 않는 설계 기준 정리다.

### 검증

- `git diff --check -- PLAN.md change-log.md` 통과

## Shadow engine server bag queue buffer 정렬

### 목적

- shadow/client desync summary에서 queue mismatch가 반복되면 실제 board 계산 차이를 보기 전에 next queue 기준부터 맞춰야 한다.
- 클라이언트 runtime의 server bag 모드는 `pieceQueue`를 `NEXT_QUEUE_SIZE + 1`개까지 채운다.
- 기존 shadow engine은 `NEXT_QUEUE_SIZE`개까지만 채워서, 같은 server bag을 써도 snapshot의 `pieceQueue` 길이가 달라질 수 있었다.

### 변경 사항

- `src/server/services/shadowGameEngine.js`에 `SERVER_QUEUE_BUFFER_SIZE = NEXT_QUEUE_SIZE + 1` 기준을 추가했다.
- shadow engine의 `refillPieceQueue()`가 클라이언트 server bag 모드와 같은 3개 buffer를 유지하게 했다.
- `test/testShadowGameEngine.js`에 client server bag 모드와 같은 queue buffer 크기를 유지하는 테스트를 추가했다.
- 기존 초기 shadow state 테스트의 `pieceQueue` 기대값도 새 기준으로 갱신했다.

### 의미

- 이제 shadow authoritative snapshot의 `pieceQueue`가 클라이언트 snapshot과 같은 buffer 기준을 사용한다.
- 이 변경은 server bag 소비 순서를 맞추기 위한 parity 수정이다.
- 다음 desync 관찰에서 queue mismatch가 줄어들면 board merge, line clear, garbage 적용 순서 같은 실제 계산 차이에 더 집중할 수 있다.

### 검증

- `node --test --test-reporter=dot test/testShadowGameEngine.js` 통과
- `node --test --test-reporter=dot test/testMatchService.js` 통과
- `node --test --test-reporter=dot test/testGameSnapshotValidator.js` 통과

## Shadow engine hold 후 회전 상태 초기화

### 목적

- 클라이언트 runtime은 hold 후 새 조각을 스폰하면서 `renderBlocks("spawn")` 흐름을 거친다.
- 이때 마지막 성공 액션이 회전인지 나타내는 `lastActionWasRotation`은 spawn 원인으로 인해 false가 된다.
- shadow engine은 hold 후 새 조각을 스폰해도 이전 조각의 `lastActionWasRotation`이 남아 있었다.
- 이 상태가 유지되면 hold 직전 회전한 조각 때문에, hold로 나온 다음 T 조각이 회전하지 않았는데도 T-Spin 후보처럼 판정될 수 있다.

### 변경 사항

- `src/server/services/shadowGameEngine.js`의 `holdPiece()`에서 새 activePiece를 만든 직후 `lastActionWasRotation`을 false로 초기화했다.
- `test/testShadowGameEngine.js`에 회전 직후 hold하면 새로 스폰된 조각은 마지막 회전 상태로 취급되지 않는다는 테스트를 추가했다.

### 의미

- shadow engine의 hold/spawn 흐름이 클라이언트 runtime의 spawn 흐름과 더 가까워졌다.
- T-Spin, score, garbage attack desync 중 hold 직후 발생할 수 있는 오판정 가능성을 줄인다.

### 검증

- `node --test --test-reporter=dot test/testShadowGameEngine.js` 통과
- `node --test --test-reporter=dot test/testMatchService.js` 통과
- `node --test --test-reporter=dot test/testTetrisRuntime.js` 통과

## Shadow engine lineClearing 중 garbage queue 반영

### 목적

- 클라이언트 runtime은 `game:garbage:append`를 받으면 현재 phase와 상관없이 `queueGarbageLines()`로 pending garbage를 저장한다.
- 기존 shadow engine은 `phase !== playing`이면 `garbage` step도 무시했다.
- 따라서 상대 공격이 line clear 애니메이션 중 도착하면 클라이언트 snapshot에는 pending garbage가 있지만, shadow snapshot에는 없는 `GARBAGE_MISMATCH`가 생길 수 있었다.

### 변경 사항

- `stepAuthoritativeState()`에서 `garbage` step 처리를 `playing` phase 검사보다 앞으로 옮겼다.
- `gameOver` 상태가 아니면 `lineClearing` 중에도 garbage를 pending queue에 추가한다.
- `test/testShadowGameEngine.js`에 lineClearing 중 garbage step이 pending queue에 저장되는 테스트를 추가했다.

### 의미

- shadow engine이 garbage 수신 타이밍을 클라이언트와 더 비슷하게 처리한다.
- line clear 직후/도중에 발생하는 pending garbage mismatch를 줄일 수 있다.
- 실제 board에 garbage를 올리는 시점은 기존처럼 lock/line clear 후처리 흐름에서 처리한다.

### 검증

- `node --test --test-reporter=dot test/testShadowGameEngine.js` 통과
- `node --test --test-reporter=dot test/testMatchService.js` 통과

## Authoritative snapshot debug 구독 leave cleanup 추가

### 목적

- `game:authoritative:snapshot:update`는 debug 구독 socket에만 보내는 관찰용 이벤트다.
- 기존 서버 cleanup은 명시적 `unsubscribe`와 `disconnect`에는 대응했지만, socket이 `game:leave` 또는 `room:leave`로 방을 나갈 때 구독이 남을 수 있었다.
- 클라이언트가 정상적으로 unsubscribe를 보내지 못해도, 서버가 room leave 흐름에서 구독을 정리해야 불필요한 debug update가 남지 않는다.

### 변경 사항

- `room:leave` 성공 시 `removeAuthoritativeSnapshotSubscriber(result.roomId, clientSocket)`를 호출한다.
- `game:leave` 성공 시 `removeAuthoritativeSnapshotSubscriber(roomId, clientSocket)`를 호출한다.
- `test/testMultiplayerSocket.js`에 `game:leave` 후 shadow loop callback이 실행돼도 `game:authoritative:snapshot:update`를 받지 않는 회귀 테스트를 추가했다.

### 의미

- debug update 구독 생명주기가 room/game leave 흐름과 더 잘 맞게 정리됐다.
- 일반 플레이 이벤트에는 영향을 주지 않는다.
- 서버 authoritative 전환 전 debug-only push 경로가 실제 플레이 경로에 남는 위험을 줄인다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerSocket.js` 통과
- `node --test --test-reporter=dot test/testRoomClient.js test/testMultiplayerDebug.js` 통과
- `node --test --test-reporter=dot test/testMatchService.js` 통과

## Shadow authoritative 실험 목적과 해석 기준 보강

### 목적

- 지금까지의 shadow authoritative 실험은 멀티 게임을 바로 서버 authoritative 방식으로 바꾸기 위한 작업이 아니다.
- 현재 플레이는 기존 client prediction 구조를 유지하고, 서버는 같은 input/server bag을 이용해 뒤에서 shadow state를 계산한다.
- 이 실험의 목적은 서버 계산 결과가 실제 클라이언트 플레이 상태와 얼마나 어긋나는지 관찰하는 것이다.
- 서버 계산 결과를 화면에 강제 적용하기 전에 desync 원인을 먼저 기록하고 줄여야, 완전 authoritative 전환 시 게임 조작감과 동기화가 동시에 안정된다.

### 실험에서 확인한 것

- `game:shadow:state`로 서버가 보관 중인 player별 shadow summary를 조회할 수 있다.
- `game:authoritative:snapshot` 요청형 응답과 `game:authoritative:snapshot:update` push형 update를 분리해서 볼 수 있다.
- `?debug=1` 화면에서는 debug 전용 socket 구독을 통해 서버 shadow loop가 만든 authoritative snapshot 후보를 관찰할 수 있다.
- `desyncCount`, `lastDesync.fields`, `lastDesyncSeverity`, `lastDesyncReason`, `shadowTick`, `shadowPieceIndex`를 함께 보면서 단순 위치 차이인지, 조각 순서/board 차이인지 구분한다.

### 실험 구조

현재 실험은 세 가지 값을 비교한다.

1. 클라이언트 실제 플레이 상태
   - 사용자가 보고 조작하는 현재 게임 상태다.
   - 아직 최종 기준은 클라이언트 runtime이 만든 상태다.
2. 서버 shadow state
   - 서버가 같은 input과 server bag을 이용해 뒤에서 계산하는 관찰용 상태다.
   - 이 값은 아직 화면에 강제 적용하지 않는다.
3. authoritative snapshot 후보
   - 서버 shadow state를 바탕으로 나중에 클라이언트에 내려줄 수 있는 snapshot 형태를 미리 확인하는 값이다.
   - 요청형 응답과 debug push update로 payload 구조와 주기를 관찰한다.

이 비교를 통해 "서버가 계산한 상태를 지금 바로 화면에 적용해도 되는가"가 아니라, "완전 authoritative 전환 전에 어떤 필드를 먼저 맞춰야 하는가"를 판단한다.

### 왜 필요한가

- 클라이언트가 직접 계산한 게임 상태를 신뢰하는 구조는 구현이 빠르지만, 빠른 입력 연타, lock 타이밍, garbage 적용, line clear 중 입력 처리에서 양쪽 화면이 쉽게 어긋날 수 있다.
- 서버 authoritative 구조로 바꾸면 최종 기준은 서버가 되지만, 한 번에 전환하면 조작감 저하나 큰 동기화 버그를 바로 플레이 화면에서 겪게 된다.
- shadow mode는 서버 계산을 실제 게임에 적용하지 않으면서도, 나중에 서버 authoritative로 갈 수 있는지 검증하는 안전한 중간 단계다.

### 해석 기준

- 플레이 중 찍은 summary가 가장 의미 있다.
- 게임 종료 후에는 client tick, snapshot 송신, shadow loop 진행이 같은 속도로 유지되지 않으므로 tick 차이가 크게 보일 수 있다.
- `activePiece`만 어긋나면 입력/중력 타이밍 차이일 가능성이 높다.
- `pieceIndex` 또는 `board`가 같이 어긋나면 lock, spawn, line clear, garbage 적용 순서를 더 확인해야 한다.
- `GARBAGE_MISMATCH`, `QUEUE_MISMATCH` 같은 특정 reason이 반복되면 해당 상태를 client runtime과 shadow engine에서 같은 기준으로 맞추는 작업을 우선한다.
- `FALL_INTERVAL_MISMATCH`가 보이면 낙하 속도, 레벨 변화, 서버 tick 정책이 client와 shadow 사이에서 다르게 적용되는지 확인한다.

### 현재 결론

- shadow snapshot은 아직 플레이 화면을 고치는 값이 아니라 관찰용 후보 상태다.
- 현재 단계의 목표는 desync를 0으로 만드는 것이 아니라, 어떤 조건에서 어떤 필드가 어긋나는지 추적 가능한 상태를 만드는 것이다.
- 이 관찰 결과를 바탕으로 server bag queue, hold 후 회전 상태, lineClearing 중 garbage queue 같은 parity 차이를 하나씩 줄이고 있다.

## Authoritative snapshot debug 구독 game over cleanup 추가

### 목적

- `game:authoritative:snapshot:update`는 shadow authoritative 관찰용 debug 이벤트다.
- 이전 단계에서 `unsubscribe`, `disconnect`, `room:leave`, `game:leave` cleanup은 연결했지만, 정상적인 게임 종료인 `game:over` / `match:finish`에서는 room의 debug 구독이 남을 수 있었다.
- match가 끝난 뒤에는 해당 room의 shadow update 후보를 더 보낼 이유가 없으므로, room 단위 구독을 정리해야 한다.

### 변경 사항

- `src/server/sockets/multiplayerHandlers.js`에 room 단위 authoritative snapshot debug 구독 제거 helper를 추가했다.
- `game:over` 성공 시 `stopShadowMatchLoop(roomId)` 전에 해당 room의 debug 구독 전체를 제거한다.
- `test/testMultiplayerSocket.js`에 `game:over` 후 shadow loop callback이 실행돼도 구독자가 `game:authoritative:snapshot:update`를 받지 않는 회귀 테스트를 추가했다.

### RED/GREEN

- RED: 새 테스트 추가 직후 `game:over` 이후에도 update 이벤트가 2개 발생해 실패했다.
- GREEN: room 단위 구독 제거를 연결한 뒤 같은 테스트가 통과했다.

### 의미

- debug push 구독 생명주기가 match 생명주기와 더 가까워졌다.
- 종료된 게임의 관찰용 update가 남아 다음 실험이나 재입장 흐름에 섞일 위험을 줄인다.
- 일반 플레이 화면에는 영향을 주지 않고, `?debug=1` 관찰 경로만 정리한다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerSocket.js` 통과

## Match lifecycle cleanup 추가

### 목적

- shadow authoritative mode에서는 `matchService`가 room별 match와 player별 shadow state를 메모리에 보관한다.
- 기존 흐름은 `game:leave`나 `game:over`에서 shadow loop는 멈출 수 있었지만, match 자체는 `matches` Map에 남을 수 있었다.
- 종료되거나 버려진 match가 남으면 다음 실험에서 stale shadow state가 조회되거나, 장시간 실행 시 불필요한 메모리 사용이 누적될 수 있다.

### 변경 사항

- `src/server/services/matchService.js`에 `deleteMatch(roomId)`를 추가했다.
  - match가 없으면 `MATCH_NOT_FOUND`를 반환한다.
  - match가 있으면 shadow loop timer를 정리하고 `matches` Map에서 제거한다.
- `game:leave` 성공 시 `deleteMatch(roomId)`를 호출하게 했다.
- `game:over` 성공 시 game over 로그에 필요한 match 정보를 먼저 읽은 뒤 `deleteMatch(roomId)`를 호출하게 했다.
- `test/testMatchService.js`에 `deleteMatch` 이후 `getMatchState()`가 `MATCH_NOT_FOUND`를 반환하는 테스트를 추가했다.
- `test/testMultiplayerSocket.js`에서 `game:leave`, `game:over` 이후 match가 제거되는지 확인하게 했다.

### RED/GREEN

- RED: `deleteMatch` 테스트는 처음에 `deleteMatch is not a function`으로 실패했다.
- RED: socket 테스트는 `game:leave`, `game:over` 이후에도 `getMatchState(roomId).ok`가 `true`여서 실패했다.
- GREEN: `deleteMatch` 구현과 socket 연결 후 관련 테스트가 통과했다.

### 의미

- room/game lifecycle과 match/shadow lifecycle이 더 잘 맞게 됐다.
- 종료된 match의 shadow state가 다음 debug 조회나 재시작 흐름에 섞일 가능성을 줄인다.
- 이후 완전 authoritative 전환 시에도 match 생성/삭제 경계가 명확해진다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js` 통과
- `node --test --test-reporter=dot test/testMultiplayerSocket.js` 통과

## Authoritative snapshot debug 구독 활성 match 검증 추가

### 목적

- `game:authoritative:snapshot:update` 구독은 shadow match loop가 있을 때만 의미가 있다.
- 기존 subscribe 흐름은 room 참가자 검증만 통과하면 waiting/finished room에서도 구독을 허용했다.
- 이 경우 활성 match가 없는 debug socket이 구독자로 남았다가, 이후 같은 room에서 새 match가 시작될 때 의도치 않게 update를 받을 수 있다.

### 변경 사항

- `game:authoritative:snapshot:subscribe`에서 `syncRoom(roomId, playerId)` 이후 `getMatchState(roomId)`를 추가로 확인한다.
- 활성 match가 없으면 구독자를 추가하지 않고 `MATCH_NOT_FOUND`를 반환한다.
- `test/testMultiplayerSocket.js`에 room은 있지만 match가 없는 상태에서 subscribe가 실패해야 한다는 테스트를 추가했다.

### RED/GREEN

- RED: 테스트 추가 직후 subscribe가 `ok: true`를 반환해 실패했다.
- GREEN: match 존재 검증을 추가한 뒤 `MATCH_NOT_FOUND`로 실패 응답을 반환하며 테스트가 통과했다.

### 의미

- debug push 구독이 실제 shadow match lifecycle과 더 강하게 묶였다.
- 종료된 게임 또는 아직 시작하지 않은 room의 debug socket이 다음 match update를 받는 위험을 줄인다.
- 일반 플레이 흐름에는 영향을 주지 않고, `?debug=1` 관찰 경로의 안전성만 높인다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerSocket.js` 통과

## Game snapshot 활성 match 검증 추가

### 목적

- `game:snapshot`은 현재 client prediction 구조에서 상대 보드 표시와 shadow desync 기록에 쓰인다.
- 기존 흐름은 room 참가자 검증과 snapshot payload 검증은 했지만, `recordClientSnapshot()` 실패를 확인하지 않았다.
- 따라서 room은 있지만 아직 `room:start`로 match가 생성되지 않은 상태에서도 snapshot이 상대에게 broadcast될 수 있었다.

### 변경 사항

- `game:snapshot` handler에서 `recordClientSnapshot(roomId, playerId, snapshot)` 결과를 확인하게 했다.
- `MATCH_NOT_FOUND`나 `PLAYER_NOT_FOUND`가 발생하면 요청자에게 `game:snapshot:result`를 보내고 상대에게 전달하지 않는다.
- 기존 정상 broadcast 테스트는 활성 match가 생성된 뒤 snapshot을 보내도록 `room:start` 흐름을 추가했다.
- `test/testMultiplayerSocket.js`에 활성 match가 없으면 snapshot을 상대에게 전달하지 않는 회귀 테스트를 추가했다.

### RED/GREEN

- RED: 새 테스트 추가 직후 `game:snapshot:result`가 없고, 상대 socket에 snapshot이 전달되는 기존 동작 때문에 실패했다.
- GREEN: `recordClientSnapshot()` 실패 결과를 확인하고 즉시 반환하게 한 뒤 테스트가 통과했다.

### 의미

- snapshot 흐름도 match lifecycle 안에서만 동작하게 됐다.
- waiting/finished room에서 오래된 client snapshot이 상대 화면이나 shadow 관찰 흐름에 섞이는 위험을 줄인다.
- 서버 authoritative 전환 전까지 client-generated snapshot을 유지하더라도, 최소한 활성 match가 있을 때만 관찰/전달된다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerSocket.js` 통과

## Authoritative snapshot fallIntervalMs 필드 정렬

### 목적

- `PLAN.md`의 snapshot 포함 기준에는 `fallIntervalMs`가 포함되어 있었다.
- 클라이언트 snapshot은 `fallIntervalMs`를 직렬화하지만, 서버 authoritative snapshot field 목록과 shadow snapshot에는 이 값이 빠져 있었다.
- 서버 authoritative 전환 시 낙하 속도 상태도 공개 진행 상태에 포함되어야 하므로, client snapshot과 server shadow snapshot의 기준을 맞춘다.

### 변경 사항

- `AUTHORITATIVE_SNAPSHOT_FIELDS`에 `fallIntervalMs`를 추가했다.
- `validateGameSnapshot()`이 `fallIntervalMs`가 숫자가 아니면 `INVALID_FALL_INTERVAL`을 반환하게 했다.
- `createInitialShadowState()`에 기본 `fallIntervalMs: 800`을 추가했다.
- `createShadowSnapshot()`이 `fallIntervalMs`를 snapshot에 포함하게 했다.
- `test/testGameSnapshotValidator.js`와 `test/testShadowGameEngine.js`에 관련 테스트를 추가했다.

### RED/GREEN

- RED: `AUTHORITATIVE_SNAPSHOT_FIELDS` 기대값에 `fallIntervalMs`를 추가하자 field 목록 테스트가 실패했다.
- RED: 문자열 `fallIntervalMs`를 검증하지 않아 validator 테스트가 실패했다.
- RED: shadow 초기 state에 `fallIntervalMs`가 없어 shadow engine 테스트가 실패했다.
- GREEN: validator, shadow state, shadow snapshot에 필드를 추가한 뒤 관련 테스트가 통과했다.

### 의미

- client-generated snapshot과 server shadow authoritative snapshot의 공개 진행 상태 기준이 더 가까워졌다.
- 이후 server authoritative snapshot을 실제 화면 보정 기준으로 사용할 때, 낙하 속도 상태가 누락되는 문제를 줄인다.

### 검증

- `node --test --test-reporter=dot test/testGameSnapshotValidator.js test/testShadowGameEngine.js` 통과

## Shadow desync fallIntervalMs 비교 추가

### 목적

- 이전 단계에서 `fallIntervalMs`를 authoritative snapshot 필드와 shadow snapshot에 추가했다.
- 하지만 `recordClientSnapshot()`의 desync 비교 대상에는 아직 포함되지 않아, client와 shadow의 낙하 속도 상태가 달라도 debug summary에서 보이지 않았다.
- 서버 authoritative 전환에서는 속도/레벨 상태도 진행 결과에 영향을 주므로 mismatch를 관찰할 수 있어야 한다.

### 변경 사항

- `findDesyncedFields()`가 `fallIntervalMs` 차이를 `fallIntervalMs` field로 기록하게 했다.
- `classifyDesync()`가 해당 차이를 `FALL_INTERVAL_MISMATCH`, `medium` severity로 분류하게 했다.
- desync details에 `fallIntervalMs`의 `client`, `shadow`, `delta` 값을 남기게 했다.
- 다음 조사 힌트로 `CHECK_LEVEL_SPEED_FLOW`를 반환하게 했다.
- `test/testMatchService.js`에 fall interval mismatch 분류 테스트를 추가했다.

### RED/GREEN

- RED: 테스트 추가 직후 desyncLog가 생성되지 않아 `lastDesync`가 `undefined`였다.
- GREEN: field 비교, 분류, details, hint를 추가한 뒤 테스트가 통과했다.

### 의미

- shadow summary가 속도 상태 차이도 관찰할 수 있게 됐다.
- 이후 line clear에 따른 레벨/속도 변화나 서버 authoritative tick 정책을 맞출 때, fall interval mismatch를 별도 원인으로 구분할 수 있다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js` 통과

## Shadow debug fallIntervalMs 관찰값 추가

### 목적

- 이전 단계에서 `fallIntervalMs` 차이를 desync reason으로 분류하게 했지만, 브라우저 `?debug=1` 콘솔 table에서는 client/shadow 각각의 낙하 간격을 바로 볼 수 없었다.
- `FALL_INTERVAL_MISMATCH`가 발생했을 때 낙하 속도, 레벨 변화, 서버 tick 정책 중 어느 쪽을 봐야 하는지 빠르게 좁히기 위해 debug summary에 값을 노출한다.

### 변경 사항

- `getPlayerShadowState()`의 summary에 다음 값을 추가했다.
  - `lastClientSnapshotFallIntervalMs`
  - `lastShadowSnapshotFallIntervalMs`
  - `lastClientSnapshotToShadowFallIntervalDelta`
- `createShadowSummaryDebugRow()`가 위 값을 console table용 row로 변환하게 했다.
  - `clientFallIntervalMs`
  - `shadowFallIntervalMs`
  - `snapshotFallIntervalDelta`
- `createAuthoritativeSnapshotDebugRow()`가 authoritative snapshot 후보의 `fallIntervalMs`를 `authoritativeFallIntervalMs`로 표시하게 했다.
- `test/testMatchService.js`와 `test/testMultiplayerDebug.js`에 관련 기대값을 추가했다.

### RED/GREEN

- RED: summary/debug row 테스트 추가 직후 fall interval 값이 `undefined` 또는 `null`로 나와 실패했다.
- GREEN: server summary와 client debug row 변환에 fall interval 필드를 연결한 뒤 관련 테스트가 통과했다.

### 의미

- 이제 `?debug=1` 실험 중 콘솔 table만 봐도 client와 shadow의 낙하 간격 차이를 확인할 수 있다.
- 서버 authoritative 전환 전, 속도/레벨 상태가 실제 desync 원인인지 다른 board/lock 문제의 부수 효과인지 더 쉽게 구분할 수 있다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js test/testMultiplayerDebug.js` 통과

## Shadow attack state desync 관찰값 추가

### 목적

- `combo`와 `backToBack`은 멀티플레이 garbage attack 계산에 영향을 주는 전투 상태다.
- 기존 shadow/client 비교는 pending garbage 총량은 비교했지만, 그 원인이 될 수 있는 공격 상태 자체는 별도 desync field로 보지 않았다.
- 서버 authoritative 전환 전에 client runtime과 shadow engine이 같은 공격 상태를 유지하는지 관찰할 수 있어야 한다.

### 변경 사항

- `recordClientSnapshot()`의 desync 비교 대상에 `combo`, `backToBack`을 추가했다.
- `combo` 또는 `backToBack` 차이는 `ATTACK_STATE_MISMATCH`, `medium` severity로 분류한다.
- desync details에 다음 값을 남긴다.
  - `combo`: `client`, `shadow`, `delta`
  - `backToBack`: `client`, `shadow`
- 다음 조사 힌트로 `CHECK_ATTACK_STATE_FLOW`를 반환하게 했다.
- `getPlayerShadowState()` summary에 client/shadow 공격 상태와 delta/mismatch 값을 추가했다.
  - `lastClientSnapshotCombo`
  - `lastShadowSnapshotCombo`
  - `lastClientSnapshotToShadowComboDelta`
  - `lastClientSnapshotBackToBack`
  - `lastShadowSnapshotBackToBack`
  - `lastClientSnapshotBackToBackMismatch`
- `createShadowSummaryDebugRow()`와 `createAuthoritativeSnapshotDebugRow()`가 console table에 공격 상태를 표시하게 했다.
  - `clientCombo`, `shadowCombo`, `snapshotComboDelta`
  - `clientBackToBack`, `shadowBackToBack`, `snapshotBackToBackMismatch`
  - `authoritativeCombo`, `authoritativeBackToBack`

### RED/GREEN

- RED: combo/back-to-back 차이를 기록하는 테스트에서 desyncLog가 생기지 않아 실패했다.
- RED: debug row 테스트에서 공격 상태 필드가 `undefined`로 나와 실패했다.
- GREEN: matchService 비교/분류/details/summary와 multiplayer debug row 변환을 연결한 뒤 관련 테스트가 통과했다.

### 의미

- 이제 `?debug=1` 실험에서 garbage mismatch가 발생했을 때, pending garbage만 볼 것이 아니라 공격 상태인 combo/back-to-back이 먼저 어긋났는지도 확인할 수 있다.
- 서버 authoritative 전환 전 shadow engine의 공격 규칙 parity를 더 작은 단위로 추적할 수 있게 됐다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js test/testMultiplayerDebug.js` 통과

## Shadow placementResult 공격 결과 기록 추가

### 목적

- 클라이언트 runtime은 조각이 lock될 때 `placementResult`에 공격/상쇄/가비지 적용 결과를 남긴다.
- 반면 서버 shadow engine은 `rawAttackLines`를 계산하고 pending garbage를 상쇄/적용하지만, 그 결과를 state에 보존하지 않았다.
- 서버 authoritative 전환 전에는 shadow가 계산한 마지막 lock 결과를 관찰할 수 있어야, client placement log와 shadow 계산 결과를 비교할 수 있다.

### 변경 사항

- `shadowGameEngine`의 state에 `lastPlacementResult`를 추가했다.
- line clear 완료 또는 line clear 없는 lock 후 다음 값을 기록한다.
  - `linesCleared`
  - `isTSpin`
  - `combo`
  - `backToBack`
  - `rawAttackLines`
  - `attackLines`
  - `canceledGarbageLines`
  - `incomingGarbageLines`
  - `appliedGarbageLines`
  - `gameOver`
- `resolveGarbageCancel()`이 남은 공격량뿐 아니라 incoming/canceled/attack 결과 객체를 반환하게 했다.
- `createShadowSnapshot()`이 `lastPlacementResult`를 복사해서 포함하게 했다.
- `getPlayerShadowState()` summary와 `createShadowSummaryDebugRow()`가 마지막 shadow placement 결과를 table에 표시하게 했다.
  - `shadowPlacementLinesCleared`
  - `shadowPlacementRawAttackLines`
  - `shadowPlacementAttackLines`
  - `shadowPlacementCanceledGarbageLines`
  - `shadowPlacementIncomingGarbageLines`
  - `shadowPlacementAppliedGarbageLines`
  - `shadowPlacementGameOver`
- `test/testShadowGameEngine.js`, `test/testMatchService.js`, `test/testMultiplayerDebug.js`에 관련 테스트를 추가했다.

### RED/GREEN

- RED: shadow engine 테스트에서 `lastPlacementResult`가 `undefined`로 나와 실패했다.
- RED: summary/debug row 테스트에서 마지막 placement 공격 결과가 누락되어 실패했다.
- GREEN: shadow state/snapshot/summary/debug row에 마지막 placement 결과를 연결한 뒤 관련 테스트가 통과했다.

### 의미

- 이제 shadow mode에서 "공격 상태가 무엇이었는가"뿐 아니라 "마지막 lock이 실제로 몇 줄 공격을 만들고, 몇 줄을 상쇄하고, 몇 줄을 적용했는가"까지 볼 수 있다.
- 아직 서버가 이 결과로 상대에게 garbage를 authoritative하게 보내는 단계는 아니다.
- 다음 단계에서는 이 `lastPlacementResult`를 client placement log와 비교하거나, 서버 authoritative garbage 전송 후보로 삼을 수 있다.

### 검증

- `node --test --test-reporter=dot test/testShadowGameEngine.js test/testMatchService.js test/testMultiplayerDebug.js` 통과

## Client placementResult와 shadow placementResult 비교 기록 추가

### 목적

- 이전 단계에서 서버 shadow engine은 마지막 lock 결과를 `lastPlacementResult`로 보관하게 됐다.
- 이번 변경은 클라이언트가 남기는 `placement_decision.placementResult`와 서버 shadow의 `lastPlacementResult`를 비교하는 관찰 경로를 추가한 작업이다.
- 아직 이 비교 결과로 게임 화면이나 garbage 전송을 강제하지 않는다.
- 목표는 client runtime과 shadow engine이 같은 lock 결과를 계산하는지 확인하고, 서버 authoritative garbage 전환 전에 공격/상쇄 차이를 좁히는 것이다.

### 변경 사항

- `matchService`에 `recordClientPlacementDecision(roomId, playerId, log)`를 추가했다.
  - `log.placementResult`를 client placement 결과로 저장한다.
  - 마지막 shadow snapshot의 `lastPlacementResult`와 비교한다.
  - 차이가 있는 field와 `client`, `shadow`, `delta` 값을 `lastPlacementComparison`에 보관한다.
- 비교 대상은 placement 결과 중 authoritative 전환에 중요한 필드로 제한했다.
  - `linesCleared`
  - `isTSpin`
  - `combo`
  - `backToBack`
  - `rawAttackLines`
  - `attackLines`
  - `canceledGarbageLines`
  - `incomingGarbageLines`
  - `appliedGarbageLines`
  - `gameOver`
- `getPlayerShadowState()` summary에 client/shadow placement 비교 결과를 추가했다.
  - `lastPlacementResultMismatch`
  - `lastPlacementResultMismatchFields`
  - `lastClientPlacementAttackLines`
  - `lastPlacementAttackLinesDelta`
  - `lastClientPlacementCanceledGarbageLines`
  - `lastPlacementCanceledGarbageLinesDelta`
- `game:log:placement_decision` socket handler가 로그 저장 성공 후 `placementResult`가 있으면 비교 기록을 남기게 했다.
  - 기존 log save 결과 응답 형식은 유지했다.
  - `placementResult`가 없는 기존 최소 로그도 계속 저장 가능하다.
- `createShadowSummaryDebugRow()`가 console table에 placement 비교값을 표시하게 했다.
  - `placementResultMismatch`
  - `placementResultMismatchFields`
  - `clientPlacementAttackLines`
  - `placementAttackLinesDelta`
  - `clientPlacementCanceledGarbageLines`
  - `placementCanceledGarbageLinesDelta`

### RED/GREEN

- RED: `recordClientPlacementDecision()` 테스트에서 함수가 없어 실패했다.
- RED: `canceledGarbageLines: 0`이 `null`로 비교되어 실패했다.
  - 원인은 placement result 복사 시 `cloneSnapshot()`이 falsy 값인 `0`을 `null`로 처리한 것이었다.
  - placement result 전용 JSON value clone을 추가해 `0`을 보존하게 했다.
- RED: summary 테스트에서 shadow placement 값이 `null`로 덮여 실패했다.
  - 원인은 summary 안에서 `lastShadowPlacementAttackLines`, `lastShadowPlacementCanceledGarbageLines`가 중복 선언된 것이었다.
  - shadow snapshot 기반 값은 유지하고, 비교 전용 값은 client/delta 필드로만 분리했다.
- RED: socket handler가 placement log 저장 후 비교 기록을 남기지 않아 실패했다.
- RED: debug row에 placement 비교 필드가 없어 실패했다.
- GREEN: matchService, socket handler, debug row를 연결한 뒤 관련 테스트가 통과했다.

### 의미

- 이제 브라우저 `?debug=1` 또는 `game:shadow:state` 조회에서 client가 보고한 공격 결과와 서버 shadow가 계산한 공격 결과를 나란히 볼 수 있다.
- 특히 `attackLines`와 `canceledGarbageLines` 차이를 보면 garbage cancel/apply 타이밍이 client와 shadow 사이에서 맞는지 확인할 수 있다.
- 이 단계는 서버가 garbage를 authoritative하게 보내기 전의 관찰 단계다.
- 차이가 반복해서 발생하면 바로 서버 강제 적용으로 넘어가지 않고, lock 이후 placement result 생성 순서와 garbage 상쇄 규칙부터 맞춰야 한다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js test/testMultiplayerDebug.js test/testMultiplayerSocket.js` 통과

## placement_decision placementResult 검증 보강

### 목적

- 서버는 이제 `placement_decision.placementResult`를 shadow `lastPlacementResult`와 비교한다.
- 따라서 client가 보낸 `placementResult`가 문자열이나 잘못된 타입이면 debug 비교값이 오염될 수 있다.
- 기존 최소 placement log 호환성은 유지하되, `placementResult`가 포함된 경우에는 타입 검증을 수행하게 했다.

### 변경 사항

- `validatePlacementDecisionLog()`가 optional `placementResult`를 검증한다.
- `placementResult`가 없거나 `null`이면 기존처럼 허용한다.
- `placementResult`가 있으면 객체여야 한다.
  - 객체가 아니거나 배열이면 `PLACEMENT_RESULT_INVALID`
- 숫자 필드는 `Number.isFinite()` 기준으로 검증한다.
  - `linesCleared`
  - `scoreBefore`
  - `scoreAfter`
  - `scoreDelta`
  - `combo`
  - `rawAttackLines`
  - `attackLines`
  - `canceledGarbageLines`
  - `incomingGarbageLines`
  - `appliedGarbageLines`
- boolean 필드는 실제 boolean 값만 허용한다.
  - `isTSpin`
  - `backToBack`
  - `gameOver`

### RED/GREEN

- RED: `placementResult: "invalid"`가 기존 validator에서 통과해 실패했다.
- RED: `attackLines: "4"`가 기존 validator에서 통과해 실패했다.
- RED: `gameOver: "false"`가 기존 validator에서 통과해 실패했다.
- GREEN: optional placementResult 검증을 추가한 뒤 validator/log/socket/runtime 관련 테스트가 통과했다.

### 의미

- client placement log와 shadow placement result 비교가 더 신뢰 가능한 입력을 받게 됐다.
- 과거처럼 최소 placement log만 보내는 흐름은 유지되므로, 로그 스키마 확장 중에도 기존 테스트/호출부를 깨지 않는다.
- 이후 `placementResult` 비교값을 서버 authoritative garbage 전환 판단에 사용할 때, 타입 오류로 인한 잘못된 mismatch를 줄일 수 있다.

### 검증

- `node --test --test-reporter=dot test/testGameLogValidator.js` 통과
- `node --test --test-reporter=dot test/testGameLogValidator.js test/testLogService.js test/testMultiplayerSocket.js test/testTetrisRuntime.js` 통과

## placementResult mismatch 조사 힌트 추가

### 목적

- `placement_decision.placementResult`와 shadow `lastPlacementResult` 비교값은 debug summary에 표시되지만, 기존 `nextInvestigationHint`는 snapshot desync 중심으로 계산됐다.
- 따라서 snapshot desync가 없고 placement result만 다른 경우에는 어떤 흐름을 먼저 봐야 하는지 힌트가 `null`로 남을 수 있었다.
- 서버 authoritative garbage 전환 전에는 공격/상쇄 결과 차이를 빠르게 좁혀야 하므로, placement mismatch만 있어도 조사 힌트를 제공하게 했다.

### 변경 사항

- `getPlayerShadowState()` summary의 `nextInvestigationHint` 계산에 placement comparison fallback을 추가했다.
- 기존 actionable snapshot desync가 있으면 기존 desync hint를 우선한다.
- actionable desync가 없고 placement result mismatch가 있으면 mismatch field에 따라 힌트를 반환한다.
  - `attackLines`, `canceledGarbageLines`, `incomingGarbageLines`, `appliedGarbageLines`, `rawAttackLines`
    - `CHECK_PLACEMENT_GARBAGE_RESULT_FLOW`
  - `combo`, `backToBack`, `isTSpin`
    - `CHECK_PLACEMENT_ATTACK_RULE_FLOW`
  - `linesCleared`
    - `CHECK_PLACEMENT_LINE_CLEAR_RESULT_FLOW`
  - `gameOver`
    - `CHECK_PLACEMENT_GAME_OVER_FLOW`
  - 그 외 placement result 차이
    - `CHECK_PLACEMENT_RESULT_FLOW`

### RED/GREEN

- RED: placement result mismatch만 있는 테스트에서 `nextInvestigationHint`가 `null`로 나와 실패했다.
- GREEN: placement comparison fallback 힌트를 추가한 뒤 `test/testMatchService.js`가 통과했다.

### 의미

- 이제 `?debug=1`이나 `game:shadow:state` 조회에서 placement 결과만 다를 때도 다음 조사 방향을 바로 알 수 있다.
- 특히 garbage cancel/apply mismatch가 반복되면 `CHECK_PLACEMENT_GARBAGE_RESULT_FLOW`를 기준으로 lock 이후 공격량 계산, incoming garbage 상쇄, 적용 순서를 먼저 보면 된다.
- snapshot desync 힌트 우선순위는 유지되므로, board/pieceIndex 같은 더 큰 상태 불일치가 있을 때는 기존 힌트가 먼저 나온다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js` 통과

## Shadow authoritative 실험 목적과 해석 기준 정리

### 목적

- 현재 멀티플레이는 아직 완전한 서버 authoritative 구조가 아니다.
- 클라이언트는 기존처럼 직접 게임을 진행하고, 서버는 같은 input과 server bag을 이용해 뒤에서 shadow state를 계산한다.
- 이 실험의 목적은 서버 계산 결과를 화면에 바로 적용하는 것이 아니라, 나중에 서버 authoritative로 전환해도 되는지 확인하기 위한 desync 관찰이다.
- 즉, 지금의 shadow 값은 "정답으로 강제 적용할 상태"가 아니라 "클라이언트와 서버 계산이 어디서 어긋나는지 찾기 위한 비교 대상"이다.

### 관찰하는 값

- `game:shadow:state`로 서버가 보관 중인 player별 shadow summary를 조회한다.
- `?debug=1`에서는 서버 shadow loop가 push하는 authoritative snapshot 후보를 console table로 확인한다.
- 주로 함께 보는 값은 다음이다.
  - `shadowTick`, `shadowPieceIndex`
  - `desyncCount`
  - `lastDesync.fields`
  - `lastDesyncSeverity`
  - `lastDesyncReason`
  - `nextInvestigationHint`
  - `clientFallIntervalMs`, `shadowFallIntervalMs`
  - `clientCombo`, `shadowCombo`
  - `clientBackToBack`, `shadowBackToBack`
  - `shadowPlacementAttackLines`, `shadowPlacementCanceledGarbageLines`

### 이번 브라우저 실험 흐름

- 멀티 게임 화면에서 현재 `roomId`와 `sessionStorage`의 `playerId`를 읽었다.
- 별도 debug socket을 열어 `game:shadow:state`를 바로 요청해 봤다.
- 처음에는 socket이 아직 연결되기 전이거나, 새 socket이 room에 참가하지 않은 상태라 결과를 받지 못했다.
- 이후 debug socket의 `connect` 이후 `game:join`을 먼저 보내고, 같은 `roomId/playerId`로 `game:shadow:state`를 요청했다.
- 이 방식으로 `game:join:result`, `game:snapshot`, `game:shadow:state:result`가 실제로 들어오는 것을 확인했다.

이 실험의 의미는 다음과 같다.

- Socket.IO 연결은 페이지 이동이나 새 `io()` 호출마다 별도 socket이므로, debug socket도 서버 입장에서는 새 참가자처럼 검증 대상이 된다.
- `game:shadow:state`는 아무 socket에서나 조회할 수 있는 전역 debug API가 아니라, 해당 room/player 권한 검증을 통과해야 하는 테스트용 API다.
- 따라서 콘솔에서 shadow state를 확인하려면 debug socket도 최소한 `game:join`으로 같은 room context에 들어간 뒤 조회해야 한다.
- `onAny()`로 이벤트를 찍으면 shadow 결과뿐 아니라 현재 snapshot broadcast가 얼마나 자주 발생하는지도 함께 볼 수 있다.

### 해석 기준

- `desyncCount`가 증가한다고 바로 실패로 보지 않는다.
- 현재 단계에서는 실제 게임 화면을 멈추거나 보정하지 않고, 어떤 필드가 어떤 조건에서 어긋나는지 기록하는 것이 우선이다.
- 게임 종료 후 찍은 summary는 client tick과 shadow tick 차이가 크게 보일 수 있다.
  - 종료 후에는 클라이언트 게임 루프, snapshot 송신, shadow loop가 같은 속도로 유지된다고 보기 어렵다.
  - 따라서 종료 후의 큰 tick 차이는 실시간 플레이 중 desync와 구분해서 봐야 한다.
- 플레이 중 summary에서 `activePiece`만 조금 다르면 낮은 위험으로 볼 수 있다.
- `pieceIndex`, `board`, `pieceQueue`, `pendingGarbageQueue`, `combo`, `backToBack`이 반복해서 어긋나면 서버 authoritative 전환 전에 원인을 좁혀야 한다.

### 왜 필요한가

- 바로 서버 authoritative로 완전 전환하면 조작감, lock 타이밍, garbage 처리, line clear 타이밍이 한꺼번에 흔들릴 수 있다.
- shadow mode는 실제 플레이는 유지하면서 서버 계산이 클라이언트와 얼마나 맞는지 먼저 확인하는 안전한 중간 단계다.
- 이 실험을 통해 다음 질문에 답할 수 있어야 한다.
  - 같은 server bag을 쓰면 client와 shadow의 piece queue가 유지되는가
  - 빠른 입력 연타 후에도 `pieceIndex`가 누적해서 어긋나지 않는가
  - lock 이후 board와 score, line clear 결과가 같은가
  - garbage attack, cancel, apply 결과가 같은가
  - 낙하 속도나 combo/back-to-back 상태가 desync 원인인지 확인 가능한가

### 다음 작업 기준

- 특정 reason이 반복되면 해당 상태를 먼저 맞춘다.
  - `QUEUE_MISMATCH`: server bag 소비 순서와 next queue buffer 확인
  - `GARBAGE_MISMATCH`: garbage 수신, cancel, apply 타이밍 확인
  - `ATTACK_STATE_MISMATCH`: combo/back-to-back 갱신 순서 확인
  - `FALL_INTERVAL_MISMATCH`: level, score, fall interval 갱신 기준 확인
- shadow/client 차이가 충분히 줄어든 뒤에만 다음 단계로 넘어간다.
  - `game:authoritative:snapshot`을 실제 보정 후보로 사용
  - 상대 보드의 input prediction 의존도 축소
  - client-generated snapshot을 debug/desync 용도로 축소
  - garbage attack/game over를 서버 authoritative 흐름으로 이전

## authoritative snapshot updateSequence metadata 추가

### 목적

- `game:authoritative:snapshot:update`는 한 번의 update trigger마다 room 안의 각 player snapshot을 여러 개 보낸다.
- 기존에는 `updateReason`으로 왜 push됐는지는 알 수 있었지만, 같은 trigger에서 나온 두 player snapshot인지 콘솔에서 바로 구분하기 어려웠다.
- debug console table에서 update 묶음과 순서를 읽기 쉽게 하기 위해 방별 `updateSequence`를 추가했다.

### 변경 사항

- `multiplayerHandlers`에 room별 authoritative snapshot update sequence를 추가했다.
- 다음 이벤트들은 push update를 보낼 때 sequence를 1씩 증가시킨다.
  - `game:authoritative:snapshot:subscribe`
  - `game:input`
  - `game:garbage:attack`
  - `game:bag:request`
  - `game:log:placement_decision`
  - shadow loop tick callback
- 같은 push trigger에서 전송되는 player별 snapshot은 같은 `updateSequence`를 가진다.
  - 예: host snapshot과 guest snapshot이 같은 input으로 push됐다면 둘 다 같은 sequence다.
- 새 match가 시작되거나 match가 삭제되는 흐름에서는 room의 sequence를 정리한다.
- `createAuthoritativeSnapshotDebugRow()`가 `authoritativeUpdateSequence`를 console table row에 표시하게 했다.

### RED/GREEN

- RED: subscribe 초기 update payload에 `updateSequence`가 없어 실패했다.
- RED: input 이후 push update payload에 증가한 `updateSequence`가 없어 실패했다.
- RED: debug row가 `authoritativeUpdateSequence`를 표시하지 않아 실패했다.
- GREEN: 서버 payload와 client debug row에 sequence를 연결한 뒤 관련 테스트가 통과했다.

### 의미

- 이제 `?debug=1`에서 authoritative snapshot push를 볼 때, 같은 sequence끼리 묶어 읽으면 된다.
- `updateReason`은 "왜 보냈는가"를 보여주고, `updateSequence`는 "몇 번째 push 묶음인가"를 보여준다.
- 이 값은 debug/관찰용이며 현재 게임 화면의 판정이나 보정에는 영향을 주지 않는다.

### 검증

- `node --test --test-reporter=dot test/testMultiplayerSocket.js test/testMultiplayerDebug.js` 통과
- `node --test --test-reporter=dot` 통과

## authoritative snapshot push 계약 문서화

### 목적

- 서버와 클라이언트 구현에는 `game:authoritative:snapshot:update`의 `updateReason`, `updateSequence`가 추가됐다.
- 하지만 `PLAN.md`의 이벤트 계약 설명에는 아직 push metadata 기준이 빠져 있었다.
- 이후 server authoritative 전환을 진행할 때 코드와 문서가 다른 기준을 말하지 않도록 현재 구현 기준을 문서에 맞췄다.

### 변경 사항

- `PLAN.md`의 `game:authoritative:snapshot` 섹션에 push payload metadata를 추가했다.
- `updateReason`의 의미를 "snapshot 후보가 push된 이유"로 정리했다.
  - 예: `subscribe_initial`, `shadow_tick`, `input`, `garbage`, `bag`, `placement`
- `updateSequence`의 의미를 "room 안에서 몇 번째 authoritative update 묶음인지 나타내는 증가값"으로 정리했다.
- 같은 trigger에서 나온 host/guest snapshot은 같은 `updateSequence`를 가진다는 기준을 명시했다.

### 의미

- 브라우저 `?debug=1` 콘솔에서 authoritative snapshot push를 볼 때, 문서만 보고도 `updateReason`과 `updateSequence`를 해석할 수 있다.
- 이후 실제 authoritative snapshot 적용 단계로 넘어갈 때, push 이벤트의 현재 debug 계약과 완전 전환 시 변경해야 할 계약을 구분하기 쉬워졌다.

## authoritative snapshot debug row playerScope 추가

### 목적

- authoritative snapshot push는 room 안의 player별 snapshot을 모두 보낸다.
- 기존 debug table에서는 `authoritativePlayerId`를 직접 보고 현재 플레이어와 비교해야 했다.
- 서버 authoritative 전환 전에는 local state와 opponent state를 빠르게 나눠 봐야 하므로, debug row에 표시용 scope를 추가했다.

### 변경 사항

- `createAuthoritativeSnapshotDebugRow(snapshot, delivery, currentPlayerId)`가 현재 player 기준 scope를 계산한다.
  - `local`: snapshot의 `playerId`가 현재 페이지의 `playerId`와 같음
  - `opponent`: snapshot의 `playerId`가 현재 페이지의 `playerId`와 다름
  - `null`: 비교할 `currentPlayerId` 또는 snapshot `playerId`가 없음
- `attachAuthoritativeSnapshotUpdateDebug()`가 push update row를 만들 때 구독자의 `playerId`를 넘기게 했다.
- `tetrisMulti.html`의 요청형 authoritative snapshot debug table도 현재 페이지 `playerId`를 넘기게 했다.
- `PLAN.md`의 push debug table 설명에 `authoritativePlayerScope` 기준을 추가했다.

### RED/GREEN

- RED: 기본 row에 `authoritativePlayerScope`가 없어 실패했다.
- RED: push update row에서 local scope가 표시되지 않아 실패했다.
- RED: 현재 playerId 기준 local/opponent 구분 테스트가 실패했다.
- GREEN: debug row 생성과 `?debug=1` 호출 경로에 current playerId를 연결한 뒤 관련 테스트가 통과했다.

### 의미

- 이제 `?debug=1` 콘솔에서 authoritative snapshot row를 볼 때 `authoritativePlayerScope`만으로 내 보드 후보인지 상대 보드 후보인지 바로 구분할 수 있다.
- 이 값은 서버 payload가 아니라 클라이언트 debug 표시용 파생값이다.
- 이후 server authoritative snapshot을 실제 local/opponent runtime에 적용하는 단계에서 라우팅 기준을 눈으로 검증하기 쉬워졌다.

## Shadow state debug row playerScope 연결

### 목적

- 이전 단계에서 요청형/push형 authoritative snapshot row에는 `authoritativePlayerScope`가 추가됐다.
- 하지만 `game:shadow:state` 응답을 `createShadowStateDebugRow()`로 표시할 때는 내부 `lastAuthoritativeSnapshot`에 현재 player 기준이 전달되지 않았다.
- 그 결과 shadow summary table 안에 포함된 authoritative snapshot 후보는 local/opponent 구분이 비어 있었다.

### 변경 사항

- `createShadowStateDebugRow(shadow, currentPlayerId)` 형태로 확장했다.
- 내부에서 `createAuthoritativeSnapshotDebugRow(shadow.lastAuthoritativeSnapshot, null, currentPlayerId)`를 호출하게 했다.
- `tetrisMulti.html`의 shadow debug polling 결과 처리에서 현재 페이지 `playerId`를 넘기게 했다.
- `PLAN.md`에 shadow summary 안의 마지막 authoritative snapshot 후보 row도 같은 scope 기준을 쓴다고 명시했다.

### RED/GREEN

- RED: `createShadowStateDebugRow()`에 current playerId를 넘겨도 `authoritativePlayerScope`가 `null`로 나와 실패했다.
- GREEN: shadow state debug row와 멀티 게임 호출부에 current playerId를 연결한 뒤 관련 테스트가 통과했다.

### 의미

- 이제 `game:shadow:state` 기반 summary table과 `game:authoritative:snapshot:update` 기반 push table이 같은 local/opponent 해석 기준을 사용한다.
- debug 화면에서 같은 player의 shadow summary와 authoritative snapshot 후보를 더 일관되게 비교할 수 있다.

## Authoritative snapshot routing helper 추가

### 목적

- 다음 단계에서 서버 authoritative snapshot 후보를 실제 runtime에 적용하려면 먼저 "이 snapshot이 내 보드용인지 상대 보드용인지"를 안정적으로 판정해야 한다.
- debug row에는 이미 `authoritativePlayerScope` 표시가 있지만, 이 기준은 debug 파일 안의 표시용 로직이었다.
- 실제 적용 단계에서 debug helper에 의존하지 않도록, DOM/Socket.IO 없는 순수 라우팅 helper로 기준을 분리했다.

### 변경 사항

- `src/client/game/runtime/authoritativeSnapshotRouting.js`를 추가했다.
- `getAuthoritativeSnapshotScope(snapshotPlayerId, currentPlayerId)`를 추가했다.
  - 같은 player면 `local`
  - 다른 player면 `opponent`
  - 비교할 값이 없으면 `null`
- `resolveAuthoritativeSnapshotTarget(result, currentPlayerId)`를 추가했다.
  - 성공한 authoritative snapshot 결과를 `local`/`opponent` target으로 분류한다.
  - 실패 응답은 적용 대상 없이 실패 결과로 반환한다.
  - 현재 playerId 또는 snapshot playerId가 없으면 `PLAYER_ID_REQUIRED`를 반환한다.
  - snapshot이 없으면 `SNAPSHOT_REQUIRED`를 반환한다.
- `multiplayerDebug.js`의 `authoritativePlayerScope` 계산이 새 helper를 재사용하게 했다.
- `PLAN.md`의 runtime layer 설명에 authoritative snapshot routing helper를 추가했다.

### RED/GREEN

- RED: helper 파일이 없어 `ERR_MODULE_NOT_FOUND`로 테스트가 실패했다.
- GREEN: 순수 helper를 추가하고 debug row가 같은 scope helper를 재사용하게 한 뒤 관련 테스트가 통과했다.

### 의미

- 아직 서버 authoritative snapshot을 게임 화면에 적용하지 않는다.
- 대신 적용 전 단계에서 필요한 라우팅 기준을 테스트 가능한 순수 함수로 고정했다.
- 다음 단계에서는 이 helper 결과를 기준으로 `localGame` 또는 `opponentGame`에 어떤 snapshot을 넘길지 제한적으로 실험할 수 있다.

## Authoritative snapshot route dry-run 연결

### 목적

- 이전 단계에서 `resolveAuthoritativeSnapshotTarget()`으로 local/opponent 라우팅 기준을 만들었다.
- 하지만 이 helper는 테스트와 debug row 내부에서만 사용됐고, 실제 멀티 페이지의 authoritative snapshot push 흐름에서는 아직 호출되지 않았다.
- 이번 변경은 적용을 시작하기 전에, push로 들어온 snapshot 후보가 어느 runtime으로 갈지 dry-run으로 확인하는 단계다.

### 변경 사항

- `attachAuthoritativeSnapshotUpdateDebug()`에 optional `handleResolvedTarget` callback을 추가했다.
- push update를 받을 때 기존 authoritative snapshot table 출력 후 `resolveAuthoritativeSnapshotTarget(result, playerId)`를 호출한다.
- callback이 있으면 라우팅 결과를 전달한다.
- `tetrisMulti.html`의 `?debug=1` 설정에서 route dry-run 결과를 console table로 출력하게 했다.
  - `debugType: "authoritative_snapshot_route"`
  - `target`: `local` 또는 `opponent`
  - `updateReason`
  - `updateSequence`
  - `snapshotTick`
  - `snapshotPieceIndex`
  - `reason`
- `PLAN.md`에 이 dry-run이 아직 `applySnapshot()`을 호출하지 않는 관찰 단계라고 명시했다.

### RED/GREEN

- RED: `attachAuthoritativeSnapshotUpdateDebug()`가 route callback을 호출하지 않아 dry-run 결과 배열이 비어 실패했다.
- GREEN: push update handler가 라우팅 helper를 호출하고 callback에 결과를 넘긴 뒤 관련 테스트가 통과했다.

### 의미

- 이제 `?debug=1`에서 authoritative snapshot 후보가 실제 적용된다면 `localGame`과 `opponentGame` 중 어디로 가야 하는지 console table로 확인할 수 있다.
- 아직 게임 화면에는 적용하지 않는다.
- 다음 단계에서 제한적 적용 실험을 할 때, target 라우팅이 이미 맞는지 먼저 눈으로 검증할 수 있다.

## Resolved authoritative snapshot 적용 helper 추가

### 목적

- 이전 단계에서 authoritative snapshot 후보를 `local`/`opponent`로 분류하는 route helper와 dry-run console table을 준비했다.
- 다음 단계에서 실제 적용을 실험하려면, 분류된 결과를 받아 어느 runtime의 `applySnapshot()`을 호출할지 작은 단위로 검증해야 한다.
- 이 변경은 페이지에 바로 연결하지 않고, 적용 동작만 순수하게 테스트 가능한 helper로 준비한 단계다.

### 변경 사항

- `authoritativeSnapshotRouting.js`에 `applyResolvedAuthoritativeSnapshotTarget(result, targets)`를 추가했다.
- `result.target === "local"`이면 `targets.localGame.applySnapshot(result.snapshot)`만 호출한다.
- `result.target === "opponent"`이면 `targets.opponentGame.applySnapshot(result.snapshot)`만 호출한다.
- 실패 result는 어느 runtime에도 적용하지 않고 실패 결과를 반환한다.
- snapshot이 없으면 `SNAPSHOT_REQUIRED`, 대상 runtime이 없으면 `TARGET_RUNTIME_NOT_FOUND`를 반환한다.
- `PLAN.md`에 적용 helper가 존재하지만 아직 멀티 페이지 실게임 적용 경로에는 연결하지 않았다고 명시했다.

### RED/GREEN

- RED: `applyResolvedAuthoritativeSnapshotTarget` export가 없어 테스트가 실패했다.
- GREEN: local/opponent/실패 result 적용 규칙을 구현한 뒤 관련 테스트가 통과했다.

### 의미

- 서버 authoritative snapshot을 실제 화면에 적용하기 위한 마지막 전 단계가 생겼다.
- 아직 기존 client prediction + snapshot correction 동작은 바꾸지 않는다.
- 다음 실험에서는 `?debug=1` 또는 별도 query flag 아래에서 이 helper를 사용해 opponent snapshot부터 제한적으로 적용할 수 있다.

## Opponent authoritative snapshot 제한 적용 flag 추가

### 목적

- route dry-run과 적용 helper가 준비됐으므로, 다음 단계는 아주 제한된 조건에서 실제 적용을 확인하는 것이다.
- 내 보드에 authoritative snapshot을 적용하면 조작감과 예측 흐름에 직접 영향을 줄 수 있다.
- 그래서 이번 단계에서는 기본 동작을 유지하고, 명시적 query flag가 있을 때만 상대 보드 후보에 한정해 적용한다.

### 변경 사항

- `getAuthoritativeSnapshotApplyMode(search)`를 추가했다.
  - 기본값은 `off`
  - `?authoritativeApply=opponent`일 때만 `opponent`
  - `local` 등 다른 값은 아직 `off`
- `applyResolvedAuthoritativeSnapshotTarget()`에 `allowedTargets` 옵션을 추가했다.
  - `allowedTargets: ["opponent"]`이면 local target은 `TARGET_NOT_ALLOWED`로 적용하지 않는다.
- `tetrisMulti.html`의 `?debug=1` authoritative route handler에서 적용 mode를 읽게 했다.
- `?debug=1&authoritativeApply=opponent`일 때만 `opponentGame.applySnapshot()`을 호출한다.
- route table에 다음 값을 추가했다.
  - `applyMode`
  - `applied`
  - 적용 실패 또는 route 실패 `reason`
- `PLAN.md`에 opponent 제한 적용 flag와 local target 미적용 정책을 기록했다.

### RED/GREEN

- RED: `getAuthoritativeSnapshotApplyMode()`가 없어 테스트가 실패했다.
- RED: `allowedTargets: ["opponent"]`인데 local target이 적용되어 테스트가 실패했다.
- GREEN: apply mode parser와 allowed target 제한을 추가한 뒤 관련 테스트가 통과했다.

### 의미

- 기본 멀티 플레이 동작은 그대로 유지된다.
- `?debug=1&authoritativeApply=opponent`를 붙인 경우에만 상대 보드에 서버 authoritative snapshot 후보를 적용해볼 수 있다.
- 이 단계는 완전 authoritative 전환이 아니다.
- 목적은 상대 보드 표시를 client input prediction 중심에서 server snapshot 후보 중심으로 옮길 수 있는지 제한적으로 확인하는 것이다.

## Opponent authoritative apply mode에서 client snapshot 보정 비활성화

### 목적

- `?debug=1&authoritativeApply=opponent`는 상대 보드를 서버 authoritative snapshot 후보로 제한 적용하는 실험 모드다.
- 그런데 기존 `game:snapshot` 수신 보정이 계속 동작하면, 서버 snapshot으로 적용한 상대 보드를 다시 클라이언트가 만든 snapshot이 덮어쓸 수 있다.
- 그러면 실험 결과가 server snapshot 기준인지 client snapshot 기준인지 구분하기 어렵다.

### 변경 사항

- `shouldApplyClientSnapshotCorrection(authoritativeApplyMode)`를 추가했다.
  - `off`에서는 기존처럼 client-generated snapshot correction을 유지한다.
  - `opponent`에서는 상대 보드에 대한 client-generated snapshot correction을 건너뛴다.
- `tetrisMulti.html`의 `receiveSnapshot()` 처리에서 이 정책을 확인하게 했다.
- `?debug=1&authoritativeApply=opponent`일 때도 client snapshot 송신 자체는 유지한다.
  - shadow/desync 비교와 서버 관찰 데이터가 필요하기 때문이다.
  - 단, 상대 화면 적용 경로에서는 사용하지 않는다.
- `PLAN.md`에 opponent authoritative apply mode에서 client snapshot correction을 건너뛴다는 기준을 기록했다.

### RED/GREEN

- RED: `shouldApplyClientSnapshotCorrection()`이 없어 테스트가 실패했다.
- GREEN: apply mode별 snapshot correction 정책을 추가하고 멀티 페이지 수신 경로에 연결한 뒤 관련 테스트가 통과했다.

### 의미

- 이제 opponent authoritative apply mode에서는 상대 보드 표시가 server snapshot 후보 중심으로 실험된다.
- 기존 client snapshot은 계속 서버로 전송되므로 shadow desync 관찰은 유지된다.
- 다음 단계에서는 이 모드에서 input prediction까지 유지할지 줄일지 별도로 판단할 수 있다.

## Opponent authoritative apply mode에서 상대 입력 예측 비활성화

### 목적

- `?debug=1&authoritativeApply=opponent` 모드는 상대 보드를 서버 authoritative snapshot 후보 중심으로 표시하는 실험이다.
- 이전 단계에서 client-generated snapshot correction은 껐지만, 상대가 보낸 `game:input`은 여전히 `opponentGame.enqueueInput()`에 들어갔다.
- 이 상태에서는 상대 보드가 server snapshot 후보와 client input prediction을 동시에 받아 실험 결과가 섞일 수 있다.

### 변경 사항

- `shouldApplyOpponentInputPrediction(authoritativeApplyMode)`를 추가했다.
  - `off`에서는 기존처럼 상대 입력 예측을 유지한다.
  - `opponent`에서는 상대 입력 예측을 건너뛴다.
- `tetrisMulti.html`의 `receiveGameInput()` 처리에서 이 정책을 확인하게 했다.
- `?debug=1&authoritativeApply=opponent`일 때 상대 player input은 `opponentGame.enqueueInput()`에 들어가지 않는다.
- `PLAN.md`에 opponent authoritative apply mode에서 상대 input prediction도 건너뛴다고 기록했다.

### RED/GREEN

- RED: `shouldApplyOpponentInputPrediction()`이 없어 테스트가 실패했다.
- GREEN: input prediction 정책 함수와 멀티 페이지 수신 경로를 연결한 뒤 관련 테스트가 통과했다.

### 의미

- 이제 opponent authoritative apply mode에서 상대 보드는 client snapshot correction과 client input prediction을 모두 피한다.
- 상대 보드 표시를 server authoritative snapshot 후보 중심으로 관찰하기 쉬워졌다.
- 내 보드 local prediction과 client snapshot 송신은 유지되므로, shadow/desync 관찰 경로는 계속 남아 있다.

## Opponent authoritative apply mode에서 상대 runtime autoStart 비활성화

### 목적

- `?debug=1&authoritativeApply=opponent` 모드에서는 상대 보드를 서버 authoritative snapshot 후보 중심으로 표시한다.
- 이전 단계에서 client snapshot correction과 input prediction은 껐지만, `opponentGame` runtime 자체는 `autoStart: true`로 시작했다.
- 그러면 상대 runtime의 자체 gravity/tick 진행이 server snapshot 적용 결과와 섞일 수 있다.

### 변경 사항

- `shouldAutoStartOpponentRuntime(authoritativeApplyMode)`를 추가했다.
  - `off`에서는 기존처럼 상대 runtime을 자동 진행한다.
  - `opponent`에서는 상대 runtime 자동 진행을 끈다.
- `tetrisMulti.html`의 `opponentGame.init()`에서 이 정책을 사용하게 했다.
- 기존 주석을 현재 정책에 맞게 갱신했다.
- `PLAN.md`에 opponent authoritative apply mode에서 상대 runtime `autoStart`도 끈다고 기록했다.

### RED/GREEN

- RED: `shouldAutoStartOpponentRuntime()`이 없어 테스트가 실패했다.
- GREEN: 정책 함수를 추가하고 상대 runtime init에 연결한 뒤 관련 테스트가 통과했다.

### 의미

- 이제 opponent authoritative apply mode에서 상대 보드는 다음 세 가지 client-side 예측 경로를 피한다.
  - client-generated snapshot correction
  - remote input prediction
  - opponent runtime 자체 autoStart
- 상대 보드 표시가 server authoritative snapshot 후보에 더 가깝게 분리된다.

## Opponent authoritative apply mode에서 상대 garbage 예측 비활성화

### 목적

- `?debug=1&authoritativeApply=opponent` 모드에서는 상대 보드를 server authoritative snapshot 후보 중심으로 관찰한다.
- 이전 단계에서 snapshot correction, input prediction, runtime autoStart는 껐지만, 상대 보드에 대한 `game:garbage:append`는 여전히 `opponentGame.queueGarbageLines()`로 들어갈 수 있었다.
- 이 경우 상대 보드의 pending garbage 상태가 server snapshot 후보와 client-side garbage prediction을 동시에 반영할 수 있다.

### 변경 사항

- `shouldApplyOpponentGarbagePrediction(authoritativeApplyMode)`를 추가했다.
  - `off`에서는 기존처럼 상대 garbage 예측 queue를 유지한다.
  - `opponent`에서는 상대 보드에 대한 garbage prediction을 건너뛴다.
- `tetrisMulti.html`의 `receiveGarbageAppend()` 처리에서 상대 player 대상 garbage에 이 정책을 적용했다.
- 내 player가 target인 garbage는 기존처럼 `myGame.queueGarbageLines()`로 처리한다.
- `PLAN.md`에 opponent authoritative apply mode에서 상대 garbage prediction도 건너뛴다고 기록했다.

### RED/GREEN

- RED: `shouldApplyOpponentGarbagePrediction()`이 없어 테스트가 실패했다.
- GREEN: garbage prediction 정책 함수와 멀티 페이지 수신 경로를 연결한 뒤 관련 테스트가 통과했다.

### 의미

- opponent authoritative apply mode에서 상대 보드는 다음 client-side 예측 경로를 피한다.
  - client-generated snapshot correction
  - remote input prediction
  - opponent runtime autoStart
  - opponent garbage prediction
- 내 보드 gameplay와 incoming garbage 처리는 유지하므로, 플레이어 조작 흐름은 그대로 둔다.

## Shadow debug socket 확인 절차 정리

### 목적

- `game:shadow:state`가 실제 브라우저 콘솔에서 조회 가능한지 확인했다.
- 단순히 `io()`로 새 socket을 만들고 바로 `game:shadow:state`를 보내면 결과가 오지 않을 수 있음을 확인했다.
- 이유는 새 socket이 기존 게임 화면 socket과 다른 연결이며, 서버의 room/player 검증을 통과하려면 같은 room context에 먼저 들어가야 하기 때문이다.

### 확인 흐름

- 멀티 게임 화면에서 다음 값을 읽었다.
  - URL query의 `roomId`
  - `sessionStorage`의 `tetris:playerId`
- 새 debug socket을 열었다.
- `connect` 이벤트 이후 `game:join`을 먼저 보냈다.
- 잠시 뒤 같은 `roomId/playerId`로 `game:shadow:state`를 요청했다.
- `onAny()`로 이벤트를 확인해 `game:join:result`, `game:snapshot`, `game:shadow:state:result`가 들어오는 것을 확인했다.

```js
window.__shadowDebug?.socket?.disconnect();
clearInterval(window.__shadowDebug?.timer);

const roomId = new URLSearchParams(location.search).get("roomId");
const playerId = sessionStorage.getItem("tetris:playerId");
const socket = io();

socket.on("connect", () => {
    socket.emit("game:join", { roomId, playerId });

    const timer = setInterval(() => {
        socket.emit("game:shadow:state", { roomId, playerId });
    }, 2000);

    window.__shadowDebug = { socket, timer };
});

socket.on("game:shadow:state:result", (result) => {
    const summary = result.shadow?.summary;
    console.log("summary:", summary);
    console.log("lastDesync fields:", summary?.lastDesync?.fields);
    console.log("lastDesync:", summary?.lastDesync);

    console.table({
        severity: summary?.lastDesyncSeverity,
        reason: summary?.lastDesyncReason,
        fields: summary?.lastDesync?.fields?.join(", "),
        desyncCount: summary?.desyncCount,
        shadowTick: summary?.shadowTick,
        shadowPieceIndex: summary?.shadowPieceIndex,
    });
});
```

### 해석

- `Socket { connected: false }`가 콘솔에 먼저 찍혀도 즉시 실패를 의미하지 않는다.
  - `io()` 호출 직후 객체가 반환된 시점에는 아직 연결 전일 수 있다.
  - 실제 요청은 `connect` callback 안에서 보내야 한다.
- debug socket도 서버 입장에서는 별도 client socket이다.
  - 기존 게임 화면에서 이미 room에 들어가 있어도, 새 socket은 자동으로 그 room에 속하지 않는다.
  - 그래서 `game:join` 없이 `game:shadow:state`만 보내면 권한 검증이나 room context 부족으로 결과를 못 받을 수 있다.
- `onAny()`로 찍으면 shadow 결과뿐 아니라 현재 snapshot broadcast 빈도도 같이 보인다.
  - 이는 snapshot이 아직 debug/desync 관찰에 사용되고 있음을 확인하는 데 도움이 된다.

### 의미

- shadow authoritative 실험은 "서버 계산값을 바로 게임에 적용하는 단계"가 아니라, 서버와 클라이언트의 계산 차이를 관찰하는 단계다.
- 브라우저 콘솔 확인 절차를 문서화해 두면, 이후 desync 원인을 볼 때 같은 방식으로 재현하고 비교할 수 있다.
- 특히 게임 종료 후 summary와 플레이 중 summary를 구분해서 봐야 한다.
  - 종료 후에는 client tick, snapshot 송신, shadow loop가 같은 속도로 유지된다고 보기 어렵다.
  - 플레이 중 summary에서 반복되는 `lastDesyncReason`과 `fields`가 실제로 우선 조사할 대상이다.

## Placement comparison tick/pieceIndex metadata 추가

### 목적

- 기존 placement comparison log는 어떤 placement result field가 다른지는 보여줬지만, 그 차이가 어느 tick과 어느 pieceIndex에서 발생했는지는 바로 알기 어려웠다.
- 서버 authoritative 전환 전에는 client placement log와 server shadow snapshot을 같은 시간축에서 비교해야 한다.
- 특히 `attackLines`, `canceledGarbageLines`, `appliedGarbageLines` 차이가 보일 때, 이것이 같은 조각의 lock 결과 차이인지, 이미 client/shadow의 조각 진행 순서가 어긋난 뒤의 결과인지 구분할 필요가 있다.

### 변경 사항

- `recordClientPlacementDecision()`에서 placement comparison을 기록할 때 다음 metadata를 함께 저장한다.
  - `clientTick`
  - `shadowTick`
  - `tickDelta`
  - `clientPieceIndex`
  - `shadowPieceIndex`
  - `pieceIndexDelta`
- client 값은 `placement_decision` log payload의 `tick`, `pieceIndex`에서 읽는다.
- shadow 값은 마지막 shadow snapshot, 없으면 현재 shadow state에서 읽는다.
- `getPlayerShadowState()`의 `placementComparisonLog`, `recentPlacementComparisonLog`에 위 metadata가 그대로 포함된다.
- `createPlacementComparisonDebugRows()`가 브라우저 `?debug=1` console table row에 같은 metadata를 표시한다.

### RED/GREEN

- RED: `recentPlacementComparisonLog`에 `clientTick`이 없어 `undefined !== 101`로 실패했다.
- RED: `createPlacementComparisonDebugRows()` 결과 row에 tick/pieceIndex metadata가 없어 deepEqual 테스트가 실패했다.
- GREEN: placement comparison 기록과 debug row에 metadata를 연결한 뒤 `test/testMatchService.js`, `test/testMultiplayerDebug.js`가 통과했다.

### 의미

- 이제 placement result mismatch를 볼 때 단순히 "공격량이 다르다"에서 멈추지 않고, 같은 `pieceIndex`의 결과인지 먼저 확인할 수 있다.
- `pieceIndexDelta`가 0인데 garbage 관련 field만 다르면 garbage cancel/apply 계산 순서를 먼저 보면 된다.
- `pieceIndexDelta`가 0이 아니면 placement result 자체보다 spawn/lock/input 처리 순서 차이를 먼저 봐야 한다.
- `tickDelta`는 client와 shadow loop가 얼마나 떨어진 상태에서 비교됐는지 보여주므로, 게임 종료 후 큰 차이와 플레이 중 실시간 차이를 구분하는 데 도움이 된다.

### 검증

- `node --test --test-reporter=dot test/testMatchService.js test/testMultiplayerDebug.js` 통과
