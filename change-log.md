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

---

# 2026년 7월 6일
최근 변경 사항 정리

## 멀티 MVP 안정화
- **input relay + server bag + snapshot correction 흐름 정착**
  멀티 게임은 Socket.IO 기반 2인 플레이, 입력 중계, 서버 bag 공급, snapshot correction을 조합해 MVP 시연 가능한 흐름으로 정리되었습니다.

- **snapshot timer 책임 분리**
  snapshot 전송, bag request, game over report를 helper로 나눠 `tetrisMulti.html`의 주기 처리 책임을 줄였습니다.

- **score/lines drift 보정 추가**
  hard drop 예측 차이로 생기던 score/lines 불일치를 snapshot correction에서 보정하도록 개선했습니다.

- **garbage attack/cancel/apply 흐름 정리**
  공격량 계산, garbage cancel, garbage 적용 계산을 core pure function으로 정리해 멀티 공격 흐름의 기준을 명확히 했습니다.

## 공격 판정과 placementResult 정리
- **T-Spin 판정 pure function 분리**
  `isTSpinLock()`을 `src/client/game/core/tSpin.js`로 분리해 lock 결과 분석과 공격 계산에서 재사용 가능한 형태로 만들었습니다.

- **combo/back-to-back 상태 전이 분리**
  `resolveAttackState()`를 `src/client/game/core/attackState.js`로 분리해 combo와 back-to-back 갱신 규칙을 core logic으로 고정했습니다.

- **placementResult 의미 문서화**
  `placementResult.backToBack`은 “이번 lock 이후 상태”가 아니라 “이번 공격 계산에 사용된 이전 B2B 상태”에 가깝다는 의미를 `PLAN.md`에 정리했습니다.

- **runtime 통합 테스트 보강**
  T-Spin Single, back-to-back Tetris bonus, combo bonus, 일반 line clear 후 B2B reset 등 공격 계산 결과를 runtime 테스트로 검증했습니다.

## 서버 payload 검증 강화
- **`game:garbage:attack` 상태 검증 추가**
  room이 `playing` 상태가 아닐 때 garbage attack을 broadcast하지 않도록 막았습니다.

- **`game:over` reason enum 제한**
  client가 임의 문자열 reason으로 match finish를 처리하지 못하도록 `top_out`, `garbage_overflow`, `leave`만 허용했습니다.

- **`game:snapshot` 최소 scalar schema 검증**
  `phase`, `pieceIndex`, `tick`, `score`, `lines`를 최소 검증해 snapshot correction에 쓰이는 핵심 값의 오염 가능성을 줄였습니다.

- **`game:input` 최소 검증 강화**
  action enum 외에 `tick`, `pieceIndex`가 0 이상 정수인지 확인하도록 했습니다.

- **playing 상태 제한 추가**
  `game:input`, `game:snapshot`, `game:bag:request`가 `playing` 상태에서만 처리되도록 정리했습니다.

- **placement decision log 검증 추가**
  `game:log:placement_decision`은 `waiting` 상태에서 저장하지 않고, 마지막 lock 로그 누락을 피하기 위해 `playing`/`finished`에서는 허용하도록 정리했습니다. `placementResult` scalar field도 얕게 검증합니다.

## core pure logic 추가 분리
- **top-out 판정 분리**
  `isPieceAboveTop(piece, blocks)`를 core로 분리해 lock 후 game over 판정의 서버 재사용 가능성을 높였습니다.

- **spawn piece 생성 분리**
  `createSpawnedPiece(pieceType, spawnRow, spawnCol)`를 `src/client/game/core/piece.js`로 분리했습니다.

- **hard drop row 계산 분리**
  `getHardDropRow(piece, canPlaceAt)`를 pure function으로 분리해 hard drop의 “도달 가능한 최하단 row 계산”만 독립적으로 테스트할 수 있게 했습니다.

- **input action intent 매핑 분리**
  `resolveInputMoveIntent(action)`을 `src/client/game/core/step.js`로 분리해 `move_left`, `move_right`, `soft_drop`, `rotate`를 runtime move intent로 바꾸는 규칙을 core에 고정했습니다.

- **board metrics helper 추가**
  AI 분석 준비용으로 board 상태를 수치화하는 helper 기반을 추가했습니다.

## server authoritative 준비
- **player별 authoritative state 초안 추가**
  `matchService.createMatch()`에서 player별 `state`를 생성하도록 추가했습니다. 아직 input 적용, snapshot broadcast, server tick loop는 붙이지 않았습니다.

- **client ESM core를 server CommonJS에서 로딩하는 bridge 추가**
  `gameCoreLoader.js`를 추가해 `resolveInputMoveIntent`, `resolveMoveAttempt`, `resolveMoveIntent`, `canPlacePiece`, `createEmptyBoard`, `BLOCKS`, `WALL_KICKS`를 cached dynamic import로 로딩할 수 있게 했습니다.

- **server player state input 적용 함수 추가**
  `applyServerInputToPlayerState(playerState, input, gameCore)`를 추가해 `move_left`, `move_right`, `soft_drop`, `rotate`를 서버 state에 적용할 수 있게 했습니다. `hard_drop`, `hold`, lock, spawn, score, garbage는 아직 보류 상태입니다.

- **match player state wrapper 추가**
  `applyInputToMatchPlayerState(roomId, playerId, input, gameCore)`를 추가해 match/player를 찾아 해당 player의 server state에 input 1개를 적용할 수 있게 했습니다. 아직 `game:input` socket handler에는 연결하지 않았습니다.

## 현재 의미
- 멀티 MVP는 client prediction + input relay + server bag + snapshot correction 구조로 안정화되었습니다.
- 서버는 아직 완전 authoritative는 아니지만, player별 state를 들고 client core 판정을 재사용해 input을 적용하기 시작할 수 있는 기반이 생겼습니다.
- AI 기능으로 넘어가기 위해 필요한 “서버 기준 placement/result log”의 전 단계가 준비되었습니다.

## 다음 우선순위
- 서버에서 한 player의 조각 lifecycle을 test-only로 먼저 완성합니다.
  - spawn
  - hard drop
  - lock
  - line clear
  - score
  - next spawn
- 이후 hold, garbage, game over, socket 연결, authoritative snapshot 순서로 확장합니다.

## 검증
- 각 단계별 단위 테스트와 runtime/socket 통합 테스트를 보강했습니다.
- 최근 기준 `npm test`와 `git diff --check` 통과 상태로 정리되었습니다.
