

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

- 향후 PVE AI 선택 비교, 플레이 분석, 리플레이, 학습 데이터 생성을 위해 "플레이어가 한 조각을 어디에 두기로 결정했는지"를 이벤트 단위로 남길 수 있게 했다.
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

- PVE AI 선택 결과 저장
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

---

# 2026년 7월 9일
server authoritative 전환 작업 정리

## 큰 방향 전환

- 멀티플레이 구조를 기존 `client prediction + input relay + client snapshot relay` 중심에서 `server authoritative state + server snapshot` 중심으로 옮기기 시작했습니다.
- 기존 목표였던 "클라이언트가 서로 snapshot을 주고받고 서버가 중계하는 구조"를 줄이고, 서버가 계산한 `game:authoritative:snapshot`을 내려주는 방향으로 정리했습니다.
- 단, 내 보드는 여전히 즉각적인 조작감을 위해 client prediction을 유지하고, 서버 snapshot은 보수적인 correction 후보로만 적용합니다.

```text
이전 흐름:
client input
  -> local runtime prediction
  -> game:input relay
  -> 상대 client prediction
  -> client game:snapshot relay/correction

현재 전환 흐름:
client input
  -> local runtime prediction
  -> game:input
  -> server authoritativeState 적용
  -> game:authoritative:snapshot emit
  -> 상대 board는 server snapshot 적용
  -> 내 board는 필요한 경우에만 보수적 correction
```

## server authoritative state와 input 처리

- `matchService`의 player별 게임 상태 이름을 `authoritativeState`로 정리했습니다.
  - client runtime의 `gameState`와 서버 기준 상태를 구분하기 위한 이름입니다.
  - snapshot payload나 client 상태 이름은 바꾸지 않았습니다.
- `createMatch()`에서 각 player의 `bagChunks`를 기준으로 `authoritativeState.pieceQueue`를 초기화합니다.
  - 첫 조각은 즉시 `activePiece` / `pendingPiece`로 올립니다.
  - `pieceIndex`는 첫 조각을 이미 소비한 상태라 `1`부터 시작합니다.
  - hard drop 시점의 lazy spawn은 제거했습니다.
- `applyAuthoritativeInput(authoritativeState, input, gameCore)`를 server gameplay의 public entry로 정리했습니다.
  - 처리 action:
    - `move_left`
    - `move_right`
    - `soft_drop`
    - `rotate`
    - `hard_drop`
    - `hold`
  - 기존 `applyHardDropInput()`은 외부 entry가 아니라 내부 helper가 되었습니다.
- `applyAuthoritativeInputToMatchPlayerState(roomId, playerId, input, gameCore)`를 match 단위 진입점으로 정리했습니다.
  - `pieceIndex` mismatch면 state를 변경하지 않고 실패 반환합니다.
  - socket relay와 input log는 MVP 호환을 위해 유지하되, stale input은 authoritative state에는 반영하지 않습니다.

## 서버 lock / 공격 / garbage 계산

- server authoritative lock 경로에서 다음 계산을 처리합니다.
  - hard drop score
  - line clear score
  - `lines`
  - `combo`
  - `backToBack`
  - T-Spin
  - `rawAttackLines`
  - `attackLines`
  - incoming garbage cancel
  - 남은 pending garbage apply
  - next spawn
- `placementResult.backToBack`은 기존 문서화한 의미를 유지합니다.
  - "이번 lock 이후 상태"가 아니라 "이번 공격 계산에 사용된 이전 B2B 상태"입니다.
  - 저장 상태는 `authoritativeState.backToBack = nextBackToBack`으로 갱신합니다.
- top-out lock에서는 line clear, attack, T-Spin no-line score를 만들지 않도록 정리했습니다.
  - `placementResult.gameOver: true`
  - `linesCleared: 0`
  - `rawAttackLines: 0`
  - `attackLines: 0`
  - `nextPiece: null`
- 조각 spawn / hold swap 후에는 `lastActionWasRotation`을 `false`로 reset합니다.
  - 이전 조각의 rotate 상태가 다음 T 조각의 T-Spin 판정으로 새는 문제를 막기 위함입니다.

## server authoritative snapshot

- `getAuthoritativePlayerSnapshot(roomId, playerId)`를 추가해 서버 내부 state 복사본을 조회할 수 있게 했습니다.
  - `board`, `activePiece`, `pendingPiece`, `pieceQueue`, `pendingGarbageQueue` 등 내부 확인에 필요한 값을 포함합니다.
  - 원본 `authoritativeState`를 직접 반환하지 않고 복사본을 반환합니다.
- `getAuthoritativePlayerSnapshotDto(roomId, playerId)`를 추가했습니다.
  - client `applySnapshot()` 후보 형태에 맞춰 `currentTick` 대신 `tick`을 노출합니다.
  - DTO에서는 `pendingPiece`, `pendingGarbageQueue`, `lastActionWasRotation` 같은 서버 내부 필드는 제외했습니다.
- 서버 `game:input` 처리 후 authoritative apply가 성공하면 `game:authoritative:snapshot`을 room 전체에 emit합니다.
  - payload 형태:

```js
{
    roomId,
    playerId,
    snapshot,
}
```

- `roomClient.js`에 `receiveAuthoritativeSnapshot(handler)`를 추가해 client가 새 snapshot channel을 받을 수 있게 했습니다.

## 멀티 페이지 책임 분리

- `tetrisMulti.html`에서 게임 세션 구성 책임을 분리했습니다.
  - 새 모듈: `src/client/game/entry/multiplayerGameSession.js`
- `tetrisMulti.html`에 남긴 책임:
  - sessionStorage에서 room/player 정보 복원
  - host/guest role 계산
  - DOM element 조회
  - player label 설정
  - `startMultiplayerGame()` 호출
  - match finish UI
  - lobby/home 이동
  - pagehide cleanup
- `multiplayerGameSession.js`로 옮긴 책임:
  - local/opponent `createTetrisRuntime()` 생성
  - keyboard input relay
  - server bag request / append
  - authoritative snapshot 수신
  - runtime cleanup handle 반환

## client snapshot relay 제거와 authoritative 적용

- 기존 client-driven `game:snapshot` 송신/수신 경로를 제거했습니다.
  - client가 만든 snapshot을 서버가 상대에게 중계하는 구조를 더 이상 사용하지 않습니다.
  - legacy `game:snapshot`은 테스트에서 더 이상 상대에게 전달되지 않는 것으로 고정했습니다.
- 상대 보드는 `game:authoritative:snapshot`만 적용하도록 변경했습니다.
  - `opponentGame.init({ autoStart: false, ... })`
  - 상대 `game:input` relay를 받아 `opponentGame.enqueueInput()`으로 예측 실행하던 경로를 제거했습니다.
- 내 보드는 server snapshot으로 무조건 덮지 않습니다.
  - own snapshot은 기본적으로 `pendingGarbageLines` 표시만 갱신합니다.
  - `phase: "gameOver"` snapshot은 full apply합니다.
  - `pendingGarbageLines`가 감소했고 board가 달라진 snapshot은 server garbage가 실제 board에 적용된 결과로 보고 full apply합니다.
  - local phase가 `lineClearing`이면 gameOver가 아닌 full apply는 막습니다.
  - 단순 `pieceIndex` ahead만으로는 내 보드를 즉시 보정하지 않습니다.

## legacy client-driven event 정리

- client 송신 API에서 다음 경로를 제거했습니다.
  - `sendGameSnapshot()`
  - `receiveSnapshot()`
  - `onGameSnapshotResult()`
  - `sendGarbageAttack()`
  - `onGarbageResult()`
  - `sendGameOver()`
  - `onGameOverResult()`
- `placementDecisionRecorder()`는 분석용 placement log만 보냅니다.
  - garbage attack은 client가 선언하지 않고 server lock 결과를 따릅니다.
- `heartbeatTimer`는 이제 server bag request만 유지합니다.
  - client가 `phase: "gameOver"`를 감지해도 `game:over`를 emit하지 않습니다.
- server의 legacy event는 match 결과를 바꾸지 않는 방향으로 테스트가 유지됩니다.
  - legacy `game:snapshot`
  - legacy `game:garbage:attack`
  - legacy `game:over`

## server authoritative ticker

- `applyAuthoritativeGravityStep(authoritativeState, gameCore)`를 추가했습니다.
  - 서버가 player state에 gravity 1회를 적용합니다.
  - 이동 성공 시 `currentTick`을 증가시킵니다.
  - 아래가 막히면 기존 lock/spawn helper를 재사용합니다.
  - `phase !== "playing"`이면 state를 변경하지 않습니다.
- `applyGravityStepToMatchPlayerState(roomId, playerId, gameCore)` wrapper를 추가했습니다.
  - match/player lookup만 담당하고 실제 gravity 처리는 `applyAuthoritativeGravityStep()`에 위임합니다.
- `authoritativeTickerService`를 추가했습니다.
  - room별 ticker lifecycle을 관리합니다.
  - timer는 100ms마다 돌지만, gravity/snapshot은 500ms 누적 기준으로 실행합니다.
  - `room:start` 성공 후 ticker를 시작합니다.
  - `game:leave`와 authoritative match finish 시 ticker를 정리합니다.
  - playing 중 disconnect는 재입장 여지를 위해 ticker를 멈추지 않습니다.
- ticker 경로에서도 lock 결과의 `attackLines`를 상대 `pendingGarbageQueue`에 추가하고 target player의 authoritative snapshot을 즉시 emit합니다.
- `game:garbage:append`는 gameplay state 변경 경로로 사용하지 않습니다.

## authoritative match finish 정리

- client `game:over` report를 제거하고, match finish 소유권을 server authoritative 결과로 옮겼습니다.
- input 경로와 ticker 경로에서 gameOver가 발생할 수 있어, 공통 helper를 추가했습니다.
  - 새 파일: `src/server/services/authoritativeMatchFinish.js`
  - 함수: `finishAuthoritativeMatch(...)`
- `finishAuthoritativeMatch()`가 담당하는 side effect:
  - `finishGame(roomId, loserPlayerId, "top_out")`
  - room ticker stop
  - `match:finish` emit
  - `deleteMatch(roomId)`
  - `game_over` log 저장
- `finishGame()`이 `GAME_NOT_PLAYING`을 반환하면 이미 처리된 finish로 보고 중복 emit/log를 만들지 않습니다.
- `game_over` log는 match 삭제 전에 생성해 `roomId-createdAt` 형태의 gameId를 보존합니다.

## 테스트 보강

- server gameplay 단위 테스트를 보강했습니다.
  - `applyAuthoritativeInput()` action 전체
  - hard drop lock/score/line clear
  - hold / hold swap / same drop hold 실패
  - combo / back-to-back / T-Spin attack scalar
  - garbage cancel / garbage apply
  - top-out lock
  - gravity step
- match service 테스트를 보강했습니다.
  - authoritative state 초기화
  - pieceQueue와 bagChunks 동기화
  - `pieceIndex` mismatch 차단
  - authoritative snapshot DTO
  - gravity wrapper
  - pending garbage append
- socket 테스트를 보강했습니다.
  - input relay 유지 + authoritative state apply
  - stale input은 relay/inputLog는 유지하되 authoritative state는 변경하지 않음
  - authoritative snapshot emit
  - legacy snapshot/garbage/gameOver 차단
  - authoritative gameOver finish/log/ticker stop
- client session 테스트를 보강했습니다.
  - heartbeat가 `game:snapshot` / `game:over`를 보내지 않음
  - 내 keyboard input은 `game:input`으로 전송됨
  - legacy snapshot은 상대 보드를 덮지 않음
  - 상대 `game:input` relay는 opponent runtime을 움직이지 않음
  - 내 authoritative snapshot은 보수적 조건을 통과한 경우에만 적용됨
- ticker service 테스트를 추가했습니다.
  - room ticker start/stop
  - 500ms 누적 후 gravity/snapshot 실행
  - target authoritative snapshot emit
  - gameOver finish/log
  - stop 후 restart 시 accumulator 초기화
  - finish 중복 방지

## 현재 의미

- 멀티플레이는 더 이상 client snapshot relay를 중심으로 동작하지 않습니다.
- 상대 보드는 server authoritative snapshot을 단일 기준으로 삼습니다.
- 내 보드는 조작감을 위해 client prediction을 유지하되, gameOver와 server garbage apply correction만 제한적으로 받아들입니다.
- game over / match finish는 client report가 아니라 server authoritative lock/tick 결과가 결정합니다.
- garbage 원천은 server `authoritativeState.pendingGarbageQueue`이며, client는 `pendingGarbageLines`를 표시용으로 받습니다.

## 아직 남은 확인

- **2탭 수동 회귀**
  - `start -> input -> attack -> garbage -> top-out -> match finish -> lobby/rejoin` 흐름은 실제 브라우저 2탭에서 확인해야 합니다.
- **상대 보드 line clear 표시용 effect**
  - 정확한 gameplay 로직이 아니라 presentation effect로 별도 검토합니다.
  - 소리는 제외합니다.
- **휴리스틱 PVE AI 준비**
  - placement decision log와 board metric을 기준으로 PVE AI 선택 후보를 정리합니다.

## 검증

- 최근 작업 단위에서 다음 검증을 반복했습니다.
  - `node --test test/testPlayerGameplayStep.js`
  - `node --test test/testMatchService.js`
  - `node --test test/testMultiplayerSocket.js`
  - `node --test test/testMultiplayerGameSession.js`
  - `node --test test/testAuthoritativeTickerService.js`
  - `npm test -- --test-reporter=dot`
  - `git diff --check`

## 다음 우선순위

1. 2탭 수동 회귀
2. 상대 보드 line clear 표시용 effect 여부 결정
3. `placementGenerator` / `simulatePlacement` / `heuristicEvaluator` 설계
4. 커밋/문서 최종 정리

---
# 2026년 7월 10일

---

## AI 문서와 boardMetrics 상태 동기화

- `src/client/game/core/boardMetrics.js`가 이미 구현된 순수 board metric 기반임을 문서에 반영했다.
- `test/testBoardMetrics.js`가 empty board, complete line, hole, bumpiness, height, mutation 방지를 검증한다는 점을 기록했다.
- 다음 AI 구현 순서를 `placementGenerator` -> `simulatePlacement` -> `heuristicEvaluator` -> PVE AI Player로 정리했다.
- PVE AI는 추천 코치가 아니라 실제 AI 상대이며, 현재 우선순위는 ML 학습이 아니라 휴리스틱 PVE AI와 로그 축적이라고 명시했다.
- Python AI 서버, 강화학습, LLM 코칭 리포트는 후순위로 유지했다.
- `boardMetrics`가 현재 `src/client/game/core`에 있는 이유와, 필요해지면 나중에 `shared` 계층으로 옮길 수 있다는 기준을 적었다.
- 현재 `npm test` 기준 전체 275개 테스트 통과 상태를 확인했다.

---

## Server Authoritative 멀티 MVP 전환 정리

### 핵심 변화

- 멀티플레이 동기화 기준을 기존 client-driven snapshot relay에서 server authoritative snapshot 중심으로 전환했다.
- 서버가 player별 `authoritativeState`를 들고, `game:input`과 server gravity ticker를 통해 상태를 갱신한다.
- 상대 보드는 더 이상 상대 input relay나 client snapshot을 예측 실행하지 않고, `game:authoritative:snapshot`만 적용한다.
- 내 보드는 조작감을 위해 client prediction을 유지하되, server snapshot은 제한적으로만 적용한다.

### 제거/축소된 legacy client-driven 경로

- client가 보내던 `game:snapshot` 송신/수신 흐름을 제거했다.
- client가 공격량을 직접 선언하던 `game:garbage:attack` 흐름을 제거했다.
- client가 패배를 직접 보고하던 `game:over` 흐름을 제거했다.
- `game:garbage:append`는 더 이상 client runtime queue를 변경하지 않는다.
- garbage, game over, match finish는 server authoritative lock/tick 결과를 따른다.

### Server authoritative state

- `matchService`가 player별 `authoritativeState`를 보관한다.
- 초기 match 생성 시 server bag chunk에서 첫 조각을 즉시 spawn한다.
- server state는 다음을 포함한다.
  - `board`
  - `activePiece`
  - `pendingPiece`
  - `pieceQueue`
  - `holdPieceType`
  - `score`
  - `lines`
  - `phase`
  - `combo`
  - `backToBack`
  - `pieceIndex`
  - `pendingGarbageQueue`
- `applyAuthoritativeInput()`는 `move_left`, `move_right`, `soft_drop`, `rotate`, `hard_drop`, `hold`를 단일 public entry로 처리한다.
- lock 경로에서 line clear, score, combo, B2B, T-Spin, garbage cancel/apply, top-out을 server state에 반영한다.

### Authoritative ticker

- `authoritativeTickerService`를 추가했다.
- room별 ticker는 100ms마다 깨어나지만, gravity step은 500ms 누적 기준으로 처리한다.
- event loop가 밀려도 callback당 gravity step은 최대 1회로 제한한다.
- ticker 경로에서도 lock 결과의 attack/cancel/garbage/gameOver를 처리한다.
- room이 더 이상 playing이 아니거나 match가 사라지면 ticker를 정리한다.

### Authoritative snapshot

- 서버는 `game:authoritative:snapshot`을 room에 emit한다.
- snapshot DTO는 client 적용 후보로 다음을 포함한다.
  - `board`
  - `activePiece`
  - `pieceQueue`
  - `holdPieceType`
  - `holdUsedThisDrop`
  - `score`
  - `lines`
  - `phase`
  - `combo`
  - `backToBack`
  - `tick`
  - `pieceIndex`
  - `pendingGarbageLines`
- `pendingGarbageQueue` 자체는 DTO에 노출하지 않고, 표시용 scalar인 `pendingGarbageLines`만 내려준다.
- 공격자가 lock으로 garbage를 만들면 target player의 snapshot도 즉시 emit한다.

### Client 적용 정책

- 상대 보드는 `opponentGame.applySnapshot(snapshot)`으로 server snapshot을 full apply한다.
- 내 보드는 기본적으로 local prediction을 우선한다.
- `game:join:result`에 player별 client snapshot DTO를 포함해, game page 진입 시 server가 먼저 진행한 state와 양쪽 runtime을 초기 정렬한다.
- 내 초기 snapshot은 gravity를 재개하고, 상대 초기 snapshot은 snapshot-only 상태를 유지한다.
- 내 playerId의 snapshot은 `pendingGarbageLines` 표시를 갱신하면서 다음 조건에서만 full apply한다.
  - `snapshot.phase === "gameOver"`
  - garbage 적용으로 `pendingGarbageLines`가 감소하고 server board가 local board와 다른 경우
  - 같은 `pieceIndex`인데 settled board가 다른 경우
  - server/local `pieceIndex` 차이가 2 이상인 경우
  - 같은 방향의 `pieceIndex` 차이 1이 750ms 이상 유지되는 경우
- local phase가 `lineClearing`이면 non-gameOver full apply를 보류해 line clear effect를 보호한다.
- active piece의 `pieceType`, `row`, `col`, `rotation` 차이와 snapshot `tick` 차이는 움직이는 조각의 일시적인 prediction 차이로 보고 own correction 판단에서 제외한다.
- own full apply 후 phase가 `playing`이면 gravity를 재개한다. 상대 보드는 계속 독립 gravity를 실행하지 않는다.
- authoritative `pieceQueue`를 적용할 때 client runtime의 숨은 server bag queue를 비워 같은 조각이 중복 공급되지 않게 한다.

### Prediction drift와 입력 반응 안정화

- A가 보는 A의 local board와 B가 보는 A의 authoritative board가 장시간 달라지는 문제를 보완했다.
- server input 적용이 `PIECE_INDEX_MISMATCH`로 실패하면 authoritative state는 변경하지 않고 현재 player snapshot을 즉시 room에 emit한다.
- sender에도 `game:input:result`로 mismatch reason을 반환해 실패를 조용히 삼키지 않는다.
- 초기 correction은 snapshot 2회 연속 차이를 persistent drift로 판단했지만, server가 모든 성공한 input 뒤에도 snapshot을 보내므로 빠른 키 입력에서 과도한 full apply가 발생할 수 있었다.
- 이를 `{ key, startedAtMs }` 기반 시간 정책으로 변경했다.
  - 750ms 미만의 한 조각 차이는 local prediction을 유지한다.
  - gap 방향이 바뀌거나 snapshot이 다시 일치하면 drift timer를 초기화한다.
  - 빠른 좌우 이동, soft drop, 회전 중 active piece 차이는 own board를 덮어쓰지 않는다.
- 이 정책으로 local 입력 반응을 유지하면서, lock 이후 settled board와 piece 순번은 server state로 다시 수렴하도록 했다.

### Match finish와 cleanup

- `finishAuthoritativeMatch()`를 추가해 input 경로와 ticker 경로의 gameOver side effect를 한 곳으로 모았다.
- 공통 처리 순서:
  1. `finishGame()`
  2. `game_over` log 생성용 match 정보 확보
  3. ticker stop
  4. `match:finish` emit
  5. `deleteMatch(roomId)`
  6. `game_over` log 저장
- 중복 finish는 `ALREADY_FINISHED`로 처리하고 emit/log/delete를 반복하지 않는다.

### Server 안정화

- `roomId` 생성 시 충돌을 감지하고 최대 5회 재시도한다.
- 재시도 실패 시 `ROOM_ID_GENERATION_FAILED`를 반환한다.
- `matchService.deleteMatch(roomId)`를 추가했다.
- `game:leave` 성공 시 match를 정리한다.
- 정상 authoritative gameOver finish에서도 match를 정리한다.
- player별 `inputLog`는 최대 1000개로 제한한다.
- `nextInputSequence`로 오래된 로그가 잘려도 sequence 중복을 막는다.

### 테스트/검증

- 주요 검증 명령:
  - `node --test test/testMultiplayerGameSession.js`
  - `node --test test/testTetrisRuntime.js`
  - `node --test test/testMultiplayerSocket.js`
  - `node --test test/testAuthoritativeTickerService.js`
  - `node --test test/testMatchService.js`
  - `node --test test/testRoomService.js`
  - `npm test -- --test-reporter=dot`
  - `git diff --check`
- 자동 테스트 기준으로 server authoritative 멀티 MVP 핵심 흐름은 닫힌 상태다.
- `scripts/verify.sh` 기준 전체 275개 테스트가 통과했다.
- 초기 join snapshot 정렬, `PIECE_INDEX_MISMATCH` 복구, settled board 수렴, 750ms piece gap 경계, rapid input over-correction 방지를 자동 테스트로 고정했다.
- 포트폴리오 시연 완료 판정은 2탭 수동 회귀 통과 후로 둔다.

### 남은 확인

- 2탭에서 다음 흐름을 최종 확인해야 한다.
  - room create/join/start
  - 양쪽 입력 반응
  - 좌우 이동/soft drop/회전 연속 입력 중 own board가 되돌아가거나 끊기지 않는지
  - 상대 보드 authoritative snapshot 표시
  - hard drop과 lock 이후 A가 보는 A board와 B가 보는 A board가 다시 수렴하는지
  - 내 line clear effect
  - incoming garbage 표시와 실제 board 적용
  - top-out/gameOver/match finish
  - lobby 복귀/restart/rejoin
- AI 기능은 이 수동 회귀가 통과된 뒤 시작한다.

---

# 2026년 7월 14일

---

## 상대 보드 line clear presentation 동기화

- server authoritative lock 결과에 gameplay state와 분리된 `presentationEffect`를 추가했다.
- line clear 직전 board와 삭제 대상 row를 기존 `game:authoritative:snapshot` payload에 선택적으로 포함한다.
- 상대 runtime은 authoritative snapshot을 먼저 적용한 뒤 line clear presentation만 재생한다.
- presentation은 전달받은 board 복사본만 렌더링하고 authoritative board, active piece, phase, score, input queue를 변경하지 않는다.
- 상대 화면에서는 line clear 효과음을 재생하지 않는다.
- effect의 `playerId`, `pieceIndex`, `id`를 기준으로 own-player effect, 중복 effect, 오래된 effect를 차단한다.
- input lock과 ticker gravity lock 모두 같은 presentation 경로를 사용한다.

## Local prediction correction 안정화

- own authoritative snapshot이 대기 중인 local input을 덮지 않도록 correction 적용을 다음 snapshot까지 보류한다.
- snapshot의 `tick`이 local tick보다 과거여도 runtime tick을 되감지 않도록 단조 증가 규칙을 적용했다.
- playing snapshot을 full apply한 뒤 중단된 input loop와 gravity를 다시 시작할 수 있게 보완했다.
- snapshot correction 직후 이전 lock score 문맥이 다음 조각으로 누수되지 않도록 `pendingLockScoreBefore`를 초기화한다.
- 빠른 좌우 이동, 회전, soft drop 중 local prediction이 반복적으로 되돌아가는 현상을 줄이면서 settled board correction은 유지한다.

## 휴리스틱 PVE 기본 흐름

- PVE room mode와 `heuristic_ai` player type을 추가했다.
- 로비에서 PVP 방 생성과 AI 대전을 구분해 시작할 수 있다.
- PVE room은 human host와 heuristic AI player를 함께 생성하며 외부 guest 참가를 허용하지 않는다.
- human socket이 AI playerId로 input을 보내는 경로를 차단했다.
- server authoritative ticker가 human player에는 gravity step을, heuristic AI에는 AI turn을 실행한다.
- AI 판단 실패나 legal placement 부재도 server authoritative game over와 match finish 흐름으로 연결한다.

## 휴리스틱 AI 순수 모듈

- `src/client/game/ai/heuristic`에 다음 순수 모듈을 추가했다.
  - `placementGenerator.js`
  - `simulatePlacement.js`
  - `heuristicEvaluator.js`
  - `placementLogAnalysis.js`
- placement 후보 생성, 가상 board 적용, line clear 반영, board metric 평가를 DOM/Canvas/Socket.IO 없이 실행한다.
- 휴리스틱 평가는 다음 metric을 사용한다.
  - lines cleared
  - holes
  - aggregate height
  - bumpiness
  - max height
- 동일한 입력에서 후보 순서와 최종 선택이 같도록 score 이후 동점 처리 기준을 고정했다.
- AI 판단 결과는 `selectedPlacement`, score, candidate count, 평가 근거를 함께 반환한다.

## Reachability planner

- 기존 회전/열별 직선 hard drop 후보를 실제 입력으로 도달 가능한 후보 탐색으로 확장했다.
- 새 모듈: `src/client/game/ai/heuristic/reachablePlacementPlanner.js`
- BFS 상태 key는 `pieceType:rotation:row:col`을 사용한다.
- 고정 action 탐색 순서:
  1. `move_left`
  2. `move_right`
  3. `rotate`
  4. `soft_drop`
- 각 도달 상태에서 마지막 `hard_drop`을 붙여 `{ placement, plannedActions }` 후보를 만든다.
- 이동 intent는 `resolveInputMoveIntent()`, 충돌과 SRS wall kick은 `resolveMoveAttempt()`를 재사용한다.
- 동일 final placement는 BFS에서 처음 발견한 최단 경로 하나만 유지한다.
- 같은 길이의 경로는 고정 action 순서로 결정해 결과를 재현할 수 있게 했다.
- 장애물 아래 tuck, wall kick, 좌우 이동, 회전이 필요한 placement도 실제 authoritative input replay로 검증했다.
- `heuristicEvaluator`는 reachable 후보만 평가하고 decision에 `plannedActions`를 포함한다.

## Human placement log 의미 보정

- reachability planner는 BFS 시작 위치가 필요하므로 human placement log의 `activePiece` 의미를 바로잡았다.
- `runtime.decisionStartPiece`에 gameplay state와 분리된 분석용 조각 시작 상태를 보관한다.
- 판단 시작 상태는 다음 경계에서 갱신한다.
  - 일반 spawn
  - hold 후 incoming piece spawn
  - own authoritative snapshot full correction
- placement log 필드 의미:
  - `activePiece`: spawn 또는 correction 직후 판단 시작 상태
  - `selectedPlacement`: 실제 최종 locked 위치
- 새 조각 spawn, init/reset, game over, destroy에서 이전 판단 시작 상태가 누수되지 않게 정리했다.
- 판단 시작 상태가 없으면 locked piece를 BFS 시작점으로 대신 사용하지 않는다.
- 이 경우 부정확한 `aiComparison`을 생성하지 않고 `schemaVersion: 1` legacy log로 fallback한다.

## Placement log schema와 분석 데이터

- feature-ready human/heuristic AI placement log는 `schemaVersion: 2`를 사용한다.
- 공통 분석 필드:
  - `source`
  - `modelType`
  - `metricsBefore`
  - `metricsAfter`
  - `evaluation`
- human 로그는 같은 board와 판단 시작 조각을 기준으로 heuristic 선택과 실제 선택을 비교한 `aiComparison`을 기록한다.
- heuristic AI 로그는 `source: "heuristic_ai"`, `modelType: "heuristic"`을 기록한다.
- validator는 schema version, board shape, placement, metric, evaluation, source/model 조합과 human `aiComparison`을 검증한다.
- schema v1은 legacy 호환을 위해 유지하지만 feature-ready 데이터셋에서는 제외 또는 migration 대상으로 둔다.

## 현재 AI 실행 경계

- reachability planner가 만든 `plannedActions`는 현재 decision 결과에만 포함된다.
- PVE AI는 아직 `selectedPlacement`를 server authoritative placement 경로로 직접 적용한다.
- AI placement log의 `inputSequence`는 아직 빈 배열이다.
- 다음 단계는 `plannedActions`를 server authoritative input 경로로 하나씩 실행하는 AI action executor다.
- executor에서 실제 성공한 action만 `inputSequence`에 기록해야 하며, 계획했지만 실패하거나 폐기된 action은 학습 데이터에 넣지 않는다.
- 아직 구현하지 않은 항목:
  - AI action queue
  - action별 authoritative snapshot
  - AI action cadence
  - `pieceIndex` mismatch 시 plan 폐기와 재계획
  - direct placement 경로 제거

## 문서 정리

- 프로젝트 진입용 `README.md`를 추가했다.
- `docs/current-project-architecture-report.md`에 현재 client/server authoritative/PVE/로그 구조를 정리했다.
- `PLAN.md`, `QnA.md`, `docs/heuristic-ai-design.md`, `docs/game-log-dataset-policy.md`, `docs/archive/ai-ml/plans/ml-dataset-plan.md`를 당시 구현 상태에 맞춰 갱신했다.
- LLM은 게임 판단 원천이 아니라 분석 결과를 설명하는 후순위 코칭 계층으로 유지한다.

## 테스트와 검증

- line clear presentation의 gameplay state 비변경과 무음 재생을 검증했다.
- local prediction correction에서 pending input 보호, tick 단조 증가, input loop 복구를 검증했다.
- PVE room lifecycle, AI player input 차단, ticker integration, AI game over를 검증했다.
- placement generation, simulation, heuristic evaluation, placement log analysis를 순수 테스트로 고정했다.
- reachability planner의 wall kick, tuck, 최단 경로, 결정론, mutation 방지, authoritative action replay를 검증했다.
- human 로그의 일반 spawn, hold, correction, 연속 piece, fallback 의미를 검증했다.
- `bash scripts/verify.sh` 기준 전체 348개 테스트가 통과했다.
- 기존 `MODULE_TYPELESS_PACKAGE_JSON` 경고는 남아 있지만 테스트 실패는 아니다.

---

# 2026년 7월 15일

---

## Authoritative input sequence와 rollback 방지

- 빠른 이동이나 회전 후 lock 직전에 own authoritative snapshot이 local prediction을 이전 위치로 되돌리는 문제를 수정했다.
- client input마다 1부터 증가하는 `clientSequence`를 부여하고, server player metadata에 `lastProcessedClientSequence`를 저장한다.
- `lastProcessedClientSequence`는 gameplay state가 아니라 input 처리 완료 acknowledgment이므로 `authoritativeState`와 분리했다.
- reconnect 시 initial authoritative snapshot의 마지막 처리 sequence 다음 값부터 input sequence를 재개한다.
- client는 server acknowledgment 전 입력을 `pendingServerInputs`로 관리하고, 미처리 입력이 있으면 own snapshot full correction을 보류한다.
- pending input이 모두 처리된 뒤에만 기존 own snapshot correction 정책으로 deferred snapshot을 다시 평가한다.
- 최신 acknowledged sequence보다 오래된 deferred snapshot은 폐기하고 다음 authoritative snapshot을 기다린다.
- `gameOver` snapshot은 pending input 여부와 관계없이 즉시 적용한다.

## Server input 처리 경계 강화

- 같은 socket의 `game:input`을 직렬 처리해 input 순서가 authoritative apply 순서와 일치하도록 했다.
- 중복되거나 역순인 `clientSequence`는 `recordInput()`과 상대 relay 전에 `CLIENT_SEQUENCE_OUT_OF_ORDER`로 거부한다.
- `PIECE_INDEX_MISMATCH`는 gameplay state를 변경하지 않지만 해당 sequence를 처리 완료로 acknowledgment한다.
- authoritative core 로딩 또는 input 적용 중 내부 예외가 발생하면 현재 snapshot과 `AUTHORITATIVE_INPUT_FAILED` result를 반환한다.
- 내부 예외도 terminal failure로 acknowledgment해 client pending input이 영구적으로 남지 않게 했다.
- `game:input:result`와 authoritative snapshot에 `clientSequence` 또는 `lastProcessedClientSequence`를 포함해 client가 처리 완료 경계를 확인할 수 있게 했다.

## 테스트와 검증

- local input queue가 비어도 server acknowledgment 전 stale own snapshot이 prediction을 되감지 않는지 검증했다.
- 최신 acknowledgment snapshot 적용, 오래된 deferred snapshot 폐기, reconnect sequence 재개를 검증했다.
- 중복·역순 input이 input log와 상대 relay, authoritative state를 변경하지 않는지 검증했다.
- authoritative 내부 예외가 sequence를 acknowledgment하고 현재 snapshot과 실패 result를 반환하는지 검증했다.
- `bash scripts/verify.sh` 기준 전체 397개 테스트가 통과했다.
- 수정 JavaScript 파일의 `node --check`와 `git diff --check`가 통과했다.
- production game event log의 line count와 SHA-256이 테스트 전후 동일함을 확인했다.
- 실제 브라우저에서는 빠른 좌우 이동, 회전, soft drop, hard drop과 lock 직전 rollback이 사라졌는지 2탭 수동 회귀 확인이 남아 있다.

---

# 2026년 7월 16일

---

## Authoritative rollback과 lock timing 안정화

- local에서 성공한 입력만 server에 전송하도록 runtime input outcome 계약을 추가했다.
- browser input에 `expectedTransform`을 포함해 이동·회전 후 `soft_drop` 또는 `hard_drop`이 server의 이전 위치에서 실행되는 prediction divergence를 lock 전에 감지한다.
- divergence는 `PREDICTION_DIVERGED`와 최신 authoritative snapshot으로 응답하고, client는 일반 750ms correction을 기다리지 않고 즉시 재동기화한다.
- room 전체가 공유하던 gravity 누적 시간을 player별 timing으로 분리했다.
- spawn, hold, hard drop, soft-drop lock, line clear 이후 해당 player의 gravity timing만 초기화한다.
- server와 client 모두 첫 blocked automatic gravity에서는 grounded 상태만 기록하고, 같은 조각의 다음 blocked gravity에서 lock하도록 맞췄다.
- socket input과 ticker gravity는 player별 authoritative mutation queue를 공유해 먼저 등록된 mutation 순서를 보존한다.
- 한 player의 queue 대기나 gravity 예외가 다른 player의 ticker 진행을 막지 않도록 room ticker를 player별 작업과 `Promise.allSettled()` 경계로 정리했다.
- 빠른 이동·회전 직후 hard drop, 높은 board, jagged surface, gravity-first 경합을 server/service/socket/runtime 테스트로 고정했다.

## Authoritative placement log 신뢰성

- local lock 직후 로그를 바로 저장하지 않고 server terminal input이 실제 placement를 commit했는지 확인한 뒤 저장한다.
- runtime과 `game:input:result`에 `placementCommitted` 계약을 추가했다.
- placement log에 `authoritativeClientSequence`, `authoritativePieceIndex`를 기록해 local 판단과 server commit lineage를 연결한다.
- terminal input 실패, forced resync, game over, session cleanup에서는 저장 대기 중인 phantom placement log를 폐기한다.
- server validator가 lineage 필드 쌍과 piece index 일치를 검증한다.
- test Socket.IO logger는 no-op 또는 spy를 주입해 `npm test`가 production JSONL을 오염시키지 않게 했다.

## PVE AI action executor와 난이도

- reachability planner의 `plannedActions`를 AI plan에 저장하고 ticker cadence마다 authoritative input을 최대 하나씩 실행한다.
- AI도 human과 같은 `applyAuthoritativeInputToMatchPlayerState()` 경로로 이동, 회전, soft drop, hard drop, lock을 처리한다.
- 성공한 실제 action만 AI placement log의 `inputSequence`에 기록한다.
- terminal placement를 즉시 적용하던 direct placement production API와 전용 테스트를 제거했다.
- Normal AI는 terminal hard drop 전에 최대 5회의 soft drop을 실행해 이동 과정을 화면에 노출한다.
- Hard AI는 planner의 terminal hard drop을 빠르게 실행한다.
- hard-drop 점수, line clear, garbage, combo/B2B/T-Spin, game over는 기존 authoritative gameplay side effect를 그대로 사용한다.
- AI plan 생성, 폐기, stale piece index 재계획, action cadence, snapshot 순서와 최종 placement 일치를 테스트로 고정했다.

## Playwright PVP/PVE 회귀 게이트

- 독립 browser context 2개를 사용하는 Playwright 멀티플레이 E2E를 추가했다.
- room 생성·참가·host 권한·채팅·게임 session·game over·로비 복귀를 실제 Socket.IO와 canvas 기준으로 검증한다.
- PVP rollback spec은 양쪽 player의 빠른 이동·회전·soft drop·hard drop 이후 source와 observer board fingerprint가 계속 일치하는지 확인한다.
- 한 번 rollback된 뒤 다시 수렴하는 경우도 실패하도록 committed board fingerprint를 연속 authoritative snapshot 동안 추적한다.
- PVE E2E는 Normal/Hard AI action 진행, human 입력, 양쪽 gravity, garbage, top-out, 로비 복귀와 재시작을 검증한다.
- line clear, garbage, game over와 AI의 T-Spin/B2B 준비 경로를 authoritative snapshot과 canvas 상태로 확인한다.
- E2E 로그는 `GAME_EVENTS_LOG_PATH`로 `test-results/e2e-game-events.jsonl`에 격리하고 production log를 변경하지 않는다.

## Placement dataset builder와 exporter

- schema v2 placement log에서 모든 reachable candidate를 다시 생성하는 결정론적 dataset builder를 추가했다.
- candidate마다 board metric 전후 값, delta, 실제 선택 label, planned actions와 heuristic baseline을 기록한다.
- dataset split은 candidate row가 아니라 `gameId` 단위로 수행해 train/validation leakage를 막는다.
- Node 전용 exporter가 production JSONL을 읽어 train, validation, rejected JSONL과 manifest를 생성한다.
- export policy에 `winner-only`, `all-completed`, source filter, minimum piece index, finish type, player prefix 제외를 추가했다.
- Human 난이도는 같은 game의 AI metadata에서 보강하며, 명시값과 추론값이 충돌하면 `AMBIGUOUS_AI_DIFFICULTY`로 거부한다.
- test와 E2E 로그를 production 학습 로그에서 분리하고, 실제 export 전후 원본 SHA-256이 동일한지 검증한다.

## Placement ML dataset schema v2와 평가 계약

- dataset schema v2에 candidate simulation 결과인 `candidateResult.linesCleared`, `candidateResult.gameOver`를 추가했다.
- feature schema v1은 다음 16개 값을 고정 순서로 추출한다.
  - lines cleared
  - game over flag
  - aggregate height, max height, holes, bumpiness delta
  - column height delta 10개
- heuristic score, winner 정보, finish type, AI difficulty는 feature에서 제외하고 평가 segmentation metadata로만 유지한다.
- `(gameId, playerId, pieceIndex)`를 decision group으로 묶고 최소 2개 후보, 정확히 하나의 선택 label, 고유 placement와 동일 context를 검증한다.
- scorer의 모든 candidate score 존재 여부와 finite 값을 검증해 잘못된 모델 출력을 canonical tie-break로 숨기지 않게 했다.
- seeded random은 `seed + decisionKey + placementKey`로 전체 후보 순위를 결정적으로 만든다.
- Leave-One-Game-Out aggregate는 각 held-out fold prediction만 합산해 학습 데이터 재평가 leakage를 제거했다.

### Human dataset v2 결과

- 완료 game: 13개
- accepted human decision: 554개
- candidate row: 18,950개
- decision당 평균 후보: 34.21개
- decision group rejection: 0개
- JSON parse failure: 0개
- train/validation gameId leakage: 0개
- Human 승리 game은 1개이므로 winner segment는 참고 수치로만 사용한다.

| 모델 | Top-1 | Top-3 | MRR |
| --- | ---: | ---: | ---: |
| Heuristic | 0.5000 | 0.8087 | 0.6694 |
| Seeded random | 0.0379 | 0.0993 | 0.1327 |

## JavaScript Pairwise Linear Ranker 실험

- 외부 ML dependency 없이 16개 feature를 사용하는 결정론적 Pairwise Linear Ranker baseline을 구현했다.
- 각 decision에서 선택 후보와 모든 미선택 후보의 표준화 feature 차이를 만들고 pairwise logistic loss를 최소화한다.
- 후보가 많은 decision이 학습을 지배하지 않도록 decision별 pair weight 합을 1로 맞춘다.
- fold마다 train candidate로만 scaler를 fit하고 validation candidate는 변환과 score 계산에만 사용한다.
- fixed full-batch gradient descent, L2 regularization, canonical ordering으로 같은 입력과 설정에서 같은 artifact를 생성한다.
- 전체 데이터 final model은 artifact 생성용으로만 사용하고, 성능은 13-fold held-out LOGO prediction으로만 보고한다.
- `model.json`과 `evaluation.json`은 source dataset, feature schema, training pipeline hash와 재현 config를 포함한다.
- 모델은 Human placement 선택 모방 실험이며, 더 강한 gameplay AI임을 의미하지 않는다.

### Pairwise Ranker 결과

| 모델 | Top-1 | Top-3 | MRR | 평균 선택 순위 |
| --- | ---: | ---: | ---: | ---: |
| Heuristic | 0.5000 | 0.8087 | 0.6694 | 2.7256 |
| Pairwise LOGO | 0.4585 | 0.7744 | 0.6330 | 3.0126 |
| Seeded random | 0.0379 | 0.0993 | 0.1327 | 17.8051 |

- Pairwise model은 random보다 충분히 학습됐지만 heuristic baseline에는 미달했다.
- 가장 큰 음수 weight는 holes였으며, correlated feature의 선형 계수이므로 개별 weight를 게임 규칙으로 해석하지 않는다.
- 현재 데이터는 13게임, winner 1게임으로 작고 fold별 편차도 커서 PVE runtime 연결은 보류한다.
- JavaScript trainer는 이후 Python 구현의 reference baseline과 Node inference 계약으로 유지할 수 있다.

## Python 학습 스택 결정 전 상태

- 초기 장기 방향은 Python에서 오프라인 학습하고 Node.js가 `model.json`을 읽어 추론하는 구조다.
- 현재 JavaScript ranker는 평가 계약을 빠르게 검증하기 위한 dependency-free baseline이며 Python 학습을 대체하는 최종 선택은 아니다.
- 현재 로컬 환경은 Apple Silicon macOS와 Miniconda Python 3.13.2다.
- 공통 라이브러리 호환성을 고려한 다음 검증 후보는 별도 Python 3.12 환경이다.
- 첫 Python 학습 후보는 작은 tabular dataset과 sample weighting에 적합한 scikit-learn이다.
- PyTorch는 board tensor나 비선형 ranking model이 필요할 때 후속 후보로 두고, TensorFlow는 현재 범위에서 제외한다.
- 다음 작업은 Python 3.12 + scikit-learn 격리 환경에서 동일 feature, pair weighting, scaler와 13-fold LOGO를 재현하고 JavaScript baseline과 parity를 비교하는 것이다.

## 검증과 현재 판단

- dataset schema, feature extraction, decision grouping, evaluator와 Pairwise Ranker 테스트가 추가됐다.
- JavaScript Pairwise Ranker 구현 시 `bash scripts/verify.sh` 기준 전체 507개 테스트가 통과했다.
- model 및 evaluation artifact를 같은 명령으로 두 번 생성했을 때 각각 동일한 SHA-256을 확인했다.
- production game event log와 source dataset의 checksum과 line count는 학습 전후 동일했다.
- 현재 Pairwise model은 PVE에 연결하지 않으며 `runtimeIntegration: false`를 유지한다.
- 다음 단계는 Python 학습 스택 기술 검증이며, Python AI server나 실시간 serving은 아직 도입하지 않는다.

---

# 2026년 7월 17일

## Migration Goal 0 기준선 안정화

- 최신 main `3b1329e84c8269c984e23e10eaf7f11c8b170690`에서 `codex/stabilize-migration-baseline-v2`를 만들었다.
- 기존 `fe8dabf`의 고유 baseline 테스트 변경만 재적용했다.
- main에 이미 동등 패치 `bf04a4e`로 반영된 `cbfc882` Python parity는 재적용하지 않았다.
- Vite, React, TypeScript, Zod, PostgreSQL과 새 package는 추가하지 않았다.

## 싱글과 rollback 관찰력

- `e2e/singlePlayer.spec.js`가 테스트 전용 고정 RNG로 비정사각형 T 조각을 준비하고 Playwright clock으로 자동 중력을 분리한다.
- 이동은 동일 Canvas cell 집합의 열 이동, 회전은 T 조각의 cell 배치 변화, soft drop은 행 이동, hard drop은 하단 고정 cell과 화면 score 증가로 각각 독립 검증한다.
- 키 입력 호출 자체, production debug global과 gameplay API 노출은 assertion 근거로 사용하지 않는다.
- multiplayer WebSocket monitor가 outgoing `game:input`의 `clientSequence`를 기록한다.
- rollback test는 첫 4개 입력과 전체 6개 입력이 실제 전송된 뒤 board 수렴과 두 authoritative snapshot tick 동안의 안정성을 판정한다.
- production gameplay 코드, correction 조건, snapshot 주기와 Socket.IO protocol은 변경하지 않았다.

## 승인된 worktree 경로 호환성 예외

- Codex-managed worktree의 절대 경로에 포함된 `.codex`를 Express `send@1.2.1`이 dotfile 경로로 판단해 root `sendFile()`이 404를 반환했다.
- 사용자 승인에 따라 `src/server/init.js`의 root `sendFile()` 한 줄만 상대 경로와 기존 `STATIC_ROOT`를 사용하도록 변경했다.
- `dotfiles: "allow"`, redirect, Playwright readiness 우회와 서버 구조 리팩토링은 하지 않았다.
- 호환성 수정은 baseline E2E 변경과 별도 커밋으로 분리했다.

## 검증 결과

- `.codex` worktree HTTP smoke: `/`, `/pages/index.html`, `/styles/style.css` 모두 200
- 호환성 수정만 적용한 기존 Playwright: 14/14 통과
- 싱글과 rollback 5회 반복: 10/10 통과
- 전체 Playwright: 15/15 통과
- `bash scripts/verify.sh`: Git diff check와 Node test 519/519 통과
- Node `v22.18.0`, npm `10.9.3`을 Goal 0 기준선 환경으로 기록했다.
- single E2E 리뷰 정정 후 반복 검증은 10/10, 전체 Playwright는 15/15, Node test는 519/519가 다시 통과했다.

## 남은 위험

- rollback 검증은 local Chromium과 고정 입력 시나리오 기준이다.
- packet loss, 높은 외부 latency, 장시간 soak와 다른 browser engine은 미검증이다.
- Goal 0이 main에 반영되고 같은 gate가 재검증되기 전에는 Goal 1을 시작하지 않는다.

---

# 2026년 7월 18일

---

## Python-native placement ML 실험 경로 확정

- 기존 JavaScript 학습 실험을 계속 복제하지 않고 Python Notebook을 새 실험의 단일 경로로 정했다.
- JavaScript는 authoritative 게임 규칙, candidate 생성과 최종 Node inference 경계만 담당한다.
- Python은 dataset JSONL을 직접 읽어 feature, V4 pair, scaler, 학습과 평가를 수행한다.
- 단일 fold parity에서 feature, scaler, pair, weight, rank와 metric이 허용오차 `1e-12` 이내로 일치했다.
- sklearn과 기존 JavaScript 결과 차이는 데이터 계약이 아니라 optimizer 종료점 차이임을 확인했다.

## 13게임과 26게임 LOGO 평가

| Dataset | Decision | Candidate | Top-1 | MRR |
| --- | ---: | ---: | ---: | ---: |
| 13게임 | 554 | 18,950 | 0.463899 | 0.636154 |
| 26게임 | 1,158 | 39,375 | 0.484456 | 0.645290 |

- 모든 fold에서 validation game을 train과 scaler fit에서 제외했다.
- 13게임은 `13 / 13`, 26게임은 `26 / 26` fold가 수렴했다.
- 데이터 확대 후에도 selected-feature 중복과 fold 편차가 커서 이 결과만으로 모델을 동결하지 않았다.
- 이 metric은 Human placement 선택 모방 성능이며 생존, 공격과 승률을 의미하지 않는다.

## Occupied-cell alias 원인 분석

- 26게임 dataset의 zero-difference pair `1,010`개와 영향 decision `670`개를 조사했다.
- `1,010`개 모두 occupied-cell 집합이 같았고, rotation과 pivot 표현만 다른 동일 물리 placement였다.
- geometry feature를 더 넣어 해결할 문제가 아니므로 새 feature 추가를 중단했다.
- 같은 occupied-cell candidate를 하나의 physical class로 묶는 representation을 정의했다.

## V0~V4 pair-weight 분해

- V0 raw candidate부터 V4 physical-class 대표 row까지 한 변수씩 분리해 비교했다.
- zero-difference pair 제거 자체는 metric을 바꾸지 않았다.
- physical-class Micro MRR 하락 약 `0.001153`은 row compression이 아니라 pair-weight 재분배로 설명됐다.
- V3와 V4의 rank와 metric은 같았고 V4가 더 적은 row와 pair로 같은 의미를 표현했다.
- 이 결과로 V4를 다음 확장 평가의 representation 후보로 선택했다.

## 26게임 학습과 신규 49게임 temporal holdout

- 기존 26게임만 학습에 사용하고 이후 수집된 신규 49게임은 평가에만 사용했다.
- choice-required physical-class decision `2,320`개에서 V4는 V0보다 Top-1이 `1`개 많았다.
- MRR은 `0.7263681329`에서 `0.7265167713`으로 `0.0001486385` 증가했다.
- 49게임 중 V4 개선 3게임, 동일 43게임, 악화 3게임으로 metric 차이는 사실상 매우 작았다.
- 성능 우월성이 아니라 generator alias 수와 무관한 physical-class 의미를 근거로 `adopt_v4`를 결정했다.

## 반복 실험 하네스

- Notebook 구현·smoke, 사용자 full 실행, 결과 분석과 동결 감사를 서로 다른 MODE로 분리했다.
- 긴 실험 프롬프트 대신 `ai-harness/ml-experiments/`의 공통 계약과 실험 명세 하나를 사용한다.
- source checksum, gameId leakage, train-only scaler, 결정성, ignored evidence 보존을 공통 gate로 고정했다.
- 상세 실험 과정과 재현 명령은 [AI 실험 로그](docs/ai-experiments-log.md)에 정리했다.

## 현재 의미

- Python 실험 파이프라인과 V4 representation의 기술 계약은 검증됐다.
- 아직 강한 gameplay AI나 production 모델을 만든 단계는 아니었다.
- 다음 검증은 과거 dataset을 반복 평가하는 대신 이후 수집된 시간 순서 cohort에서 진행하기로 했다.

---

# 2026년 7월 20일

---

## 대용량 dataset streaming export

- 누적 125게임 export에서 JSONL 전체를 한 문자열로 합쳐 Node 최대 문자열 길이를 넘는 문제를 확인했다.
- dataset 형식은 JSONL로 유지하고 exporter만 row 단위 streaming write로 변경했다.
- CSV 전환이나 날짜별 logger 분할 없이 기존 schema와 downstream 코드를 보존했다.
- live log와 기존 immutable dataset checksum은 실행 전후 동일했다.

## 고정 75게임 모델의 신규 50게임 평가

- 75게임으로 학습한 scaler와 coefficient를 고정하고 이후 신규 50게임을 재학습 없이 평가했다.
- 신규 cohort는 `2,202` decision과 `74,324` candidate이며 base/new gameId leakage는 0이었다.

| Metric | 결과 |
| --- | ---: |
| Top-1 | 60.31% |
| Top-3 | 89.65% |
| MRR | 0.756290 |
| 평균 선택 순위 | 1.9387 |

- Normal과 Hard의 Top-1과 MRR이 비슷해 난이도별 temporal 안정성을 확인했다.
- Line-clear 선택지가 있던 decision의 Top-1은 `66.36%`, MRR은 `0.788960`이었다.
- accepted candidate에 `gameOver=true` 사례가 없어 game-over 회피는 별도 안전성 계약으로 검증하기로 했다.
- 결과를 `temporal_holdout_passed`, `keep_v4`, `ready_to_freeze`로 마감했다.

## 125게임 V4 candidate trainer

- 동결된 16-feature, V4 weighting, StandardScaler와 Logistic Regression 계약을 Python CLI trainer로 추출했다.
- 누적 125게임에서 `5,682` decision, `192,129` candidate, `123,130` V4 pair를 사용했다.
- physical alternative가 없는 pairless decision은 4개였고 `5,678`개 decision이 학습에 기여했다.
- 두 번 학습한 model과 training report가 각각 byte-identical했다.
- model SHA-256은 `ff64b0d3e4cd9eb6c6d7920f2cbe961f1d70e4c90ccc69a5d9ab8bcd410cb33d`다.
- 이 artifact는 `canonicalArtifact=false`, `productionIntegration=false`이며 training loss는 held-out 성능 증거로 사용하지 않았다.

## Reference inference와 game-over safety

- Python reference scorer가 artifact schema, 16-feature 순서, scaler와 coefficient를 검증하도록 했다.
- 동일 occupied-cell alias를 하나의 physical class로 묶고 Unicode code-point 순으로 대표와 tie-break를 결정했다.
- 안전한 class가 있으면 score와 관계없이 `gameOver=true` class를 ranking에서 제외한다.
- 모든 class가 game-over이면 결정적 fallback과 `unavoidableGameOver=true`를 반환한다.
- JavaScript offline scorer가 Python과 최대 절대오차 `8.88e-16`으로 일치했다.

## Dev-only PVE 연결과 사용자 체험 기능

- 기존 heuristic candidate generator, planner와 authoritative action executor를 그대로 재사용했다.
- 사용자가 `내 선택 모방 AI (실험)`을 명시적으로 고른 경우에만 V4를 요청한다.
- 모델 누락, JSON 오류, SHA·schema 불일치와 scorer 실패는 기존 heuristic으로 fallback한다.
- 화면에 `실험 AI · 동작 중` 또는 fallback 상태를 표시하고 game lifecycle log에 실제 policy와 model SHA를 남긴다.
- V4가 선택한 placement는 Human 또는 heuristic training log로 저장하지 않아 provenance를 보호한다.
- 기본 PVE 정책은 계속 heuristic이며 별도 AI server, DB와 model manager는 추가하지 않았다.

## 30×500 gameplay screening

- heuristic과 V4를 같은 30개 seed stream, 최대 500 placement로 비교했다.
- safety event, invalid decision과 model fallback은 모두 0이었다.
- heuristic은 `30 / 30`, V4는 `27 / 30` stream에서 500 placement horizon에 도달했다.
- 사전 기준이 horizon 차이 3개까지 pass였으므로 `gameplay_screening_passed`였지만 정확히 경계값이었다.
- V4는 stream `004`, `009`, `025`에서만 game-over됐고 holes와 max height가 더 높았으며 attack/100도 낮았다.
- 상세 수치와 종료 판단은 [gameplay benchmark 결과](ai-harness/runs/placement-v4-pve-gameplay-benchmark-analyze-result-2026-07-20.md)에 보존했다.

## 최종 판단과 main 통합

- 프로그램 상태는 `imitation_only_not_gameplay_ready`로 종료했다.
- production 결정은 `keep_heuristic_default`다.
- V4는 Human placement imitation, offline ranking과 opt-in Experimental PVE 체험 기능으로만 유지한다.
- “나를 완전히 모방한다” 또는 “heuristic보다 강하다”는 표현은 사용하지 않는다.
- 추가 100-stream, hybrid, 재학습과 production 기본값 변경은 새 질문과 성공 기준 없이 진행하지 않는다.
- Experimental PVE 기능 commit `231d217`과 AI 작업 이력을 merge commit `76ade21`을 통해 main에 통합했다.
- 향후 개선 방향은 [AI 전체 계획](docs/ai-plan.md)의 Human imitation Track과 Gameplay policy Track으로 분리했다.

## 검증

- main 병합 상태에서 `npm run verify:ml`: Node 34개, Python 115개 통과
- `bash scripts/verify.sh`: 537개 중 536개 통과, skip 1, 실패 0
- 실제 브라우저에서 `My Imitation AI (Experimental)`과 `실험 AI · 동작 중` 표시 확인
- 브라우저 console error 0
- bundled experimental model SHA-256 일치

## Migration Goal 1 후보 완료

- local `main@2d4d66e`에서 Node `24.18.0`, Vite `8.1.5`, TypeScript `7.0.2` 기반을 추가했다.
- `src/client`의 index, lobby, single, multiplayer 네 HTML을 Vite multi-page build로 구성하고 production output을 `dist/client`로 분리했다.
- client/server/test `tsconfig` 경계와 `allowJs` 공존을 추가하고 client theme leaf 하나를 TypeScript로 전환했다.
- 개발 Vite proxy와 production Express static 경계를 분리했으며 production start는 build나 devDependency 설치를 수행하지 않는다.
- root에서 single/lobby로 실제 click 이동하는 Playwright 회귀를 추가했다.
- Node 24에서 typecheck, build, Node test 542개와 Playwright 16개를 검증했다. 기존 조건부 Node test 1개는 skip이며 첫 Playwright 실행의 기존 PVE timing 실패는 단독, 전체와 3회 반복 재실행에서 통과했다.
- production dependency만 설치한 HTTP smoke에서 네 page, build asset과 Socket.IO client를 확인했고 source map은 노출되지 않았다.
- gameplay 규칙, Socket.IO event 의미, session 보안과 dataset schema는 변경하지 않았다.

---

# 2026년 7월 21일

---

## Migration Goal 1 main 반영

- Vite + TypeScript 기반과 리뷰 보완을 main에 반영했다.
- Node `24.18.0`, Vite `8.1.5`, TypeScript `7.0.2`와 `dist/client` production build 경계를 유지한다.
- 기존 JavaScript는 `allowJs`로 공존하고 client theme leaf 하나만 TypeScript로 전환했다.
- React, root ESM 전환과 server 전체 TypeScript 변환은 다음 Goal로 넘겼다.
- Goal 2는 Goal 1 최종 commit `21d191f`을 포함한 clean main에서 시작했다.

## Migration Goal 2 player session 보안

- client payload의 `playerId`를 신원 증명으로 사용하던 경계를 제거했다.
- 서버가 256-bit CSPRNG token과 UUID playerId를 발급하고 token은 SHA-256 digest만 memory에 저장한다.
- browser는 versioned credential을 `sessionStorage` 하나에 저장하고 reconnect마다 token과 generation을 회전한다.
- newest socket wins 정책으로 이전 socket 권한을 즉시 폐기하고, active socket이 없을 때만 직전 token을 60초 안에 한 번 복구할 수 있다.
- partial, malformed, invalid, expired와 replayed credential은 조용히 새 identity로 바꾸지 않고 terminal auth 경계로 처리한다.

## Reconnect와 room lifecycle

- 일시적인 transport disconnect에는 30초 grace를 적용한다.
- lobby reconnect는 `room:sync`, game reconnect는 `game:join`으로 최신 authoritative 상태를 다시 받는다.
- playing player가 grace 안에 돌아오지 않으면 `disconnect_timeout`으로 match를 종료한 뒤 loser를 제거한다.
- `io server disconnect`는 자동 재연결되지 않는 terminal 상태로 구분하고 사용자에게 새로고침을 안내한다.
- stale socket의 queued input과 placement log는 side effect 직전에 active socket과 generation을 다시 확인한다.
- disconnect 시 Socket.IO reconnect send buffer를 비워 이전 generation mutation이 새 연결에서 실행되지 않게 했다.

## Socket ownership과 공개 보안 경계

- room, game, bag, placement log와 chat mutation의 identity를 모두 active socket session에서 파생한다.
- client가 보낸 playerId와 nickname은 인증 근거로 사용하지 않는다.
- 한 player는 하나의 room에만 속하며 playing 중 `room:leave`는 거부하고 명시적 `game:leave`만 허용한다.
- public room DTO는 whitelist 필드만 반환하고 token, digest, generation, socketId와 expiry를 노출하지 않는다.
- production은 exact `SOCKET_ALLOWED_ORIGINS` 없이는 시작하지 않으며 CORS와 Engine.IO가 같은 allowlist를 사용한다.
- payload 상한은 512KiB, socket별 outstanding game input 상한은 120개로 고정했다.
- session, lifecycle, input, bag, chat과 placement log에 서로 독립된 in-memory rate bucket을 적용했다.

## Goal 2 검증과 남은 위험

- Node `24.18.0`에서 typecheck와 44-module production build가 통과했다.
- Node test는 556개 중 555개 통과, 기존 조건부 1개 skip, 실패 0이었다.
- Chromium Playwright는 session 발급·rotation·replay, duplicate tab, reload, reconnect, Origin, DTO, disconnect grace와 기존 PVP/PVE/single을 포함해 24/24 통과했다.
- production HTTP smoke에서 주요 page, Socket.IO client와 built asset이 모두 HTTP 200을 반환했다.
- session, rate limiter, room과 match는 단일 Node process memory에 있으므로 server restart와 multi-instance 공유는 아직 지원하지 않는다.
- TLS termination, Redis, WebKit/Firefox, 장시간 abuse·network soak와 CSP는 후속 Goal 범위로 남겼다.

## 배포 전 게임 로그 용량 감사

- 현재 `data/logs/game-events.jsonl`은 130게임, 17,636줄, 약 82.7MiB다.
- placement decision이 17,378줄로 전체의 약 98.5%이며 게임당 원본 로그는 평균 약 0.67MiB다.
- 현재 repository는 하나의 JSONL 파일에 계속 append하고 총 용량, rotation과 retention 상한이 없다.
- 현재 exporter도 단일 파일 하나를 `readFile()`로 메모리에 올리며 rotated shard와 gzip 입력은 지원하지 않는다.
- 실제 로그를 gzip으로 측정했을 때 약 4.1MiB로 줄어 약 95% 압축 효과를 확인했다.

## 로그 운영 결정

- 단일 instance 배포에서는 `GAME_EVENTS_LOG_PATH`를 영속 volume으로 지정한다.
- 운영 도구에서 일 단위와 50~100MiB 크기 상한을 함께 적용해 rename 기반으로 rotation한다.
- 닫힌 shard는 gzip으로 압축하고 서버에는 최근 30~90일만 보관한다.
- 장기 학습 원본은 object storage에 checksum과 함께 보관하고 삭제 전에 immutable dataset snapshot을 생성한다.
- 다음 학습 시점에만 exporter를 여러 `.jsonl`과 `.jsonl.gz` shard의 순차 streaming 입력으로 확장한다.
- 현재 압축 효과가 충분하므로 CSV 전환, payload schema 축소, DB와 별도 logging framework는 추가하지 않았다.
- ephemeral filesystem 또는 multi-instance 배포가 확정되면 로컬 JSONL 대신 공용 object storage나 Goal 9~10의 PostgreSQL 경계를 검토한다.

## Migration Goal 3 Socket 계약과 Zod 검증

- `zod@4.4.3`을 exact production dependency로 추가하고 handshake, client→server 12개, server→client 16개 event 계약을 `src/shared/socketContracts.mjs`에 통합했다.
- wire payload와 parse 이후 payload 타입은 `z.input`과 `z.output`에서 파생해 runtime schema와 타입 선언이 서로 다른 계약으로 어긋나지 않게 했다.
- 서버는 active session과 rate limit 확인 뒤 service 호출 전에 C2S payload를 검증하고, browser는 모든 application S2C event를 `roomClient`의 공통 검증 경계에서 처리한다.
- invalid payload는 기존 result channel의 `INVALID_PAYLOAD`로만 응답하며 raw payload, token, Zod issue와 stack을 외부 응답이나 production log에 남기지 않는다.
- placement log의 기존 256KiB 상한, private-field 차단과 domain validator를 유지하고, 충분한 bag queue에는 추가 mutation 없이 `BAG_QUEUE_SUFFICIENT`를 반환하도록 보완했다.
- Goal 3 최종 commit `79042e8`까지 main에 반영했으며 session, reconnect, room ownership과 gameplay protocol 의미는 유지했다.

## Goal 3 검증과 남은 위험

- Node `24.18.0`에서 typecheck, 124-module build와 Node test 571개 중 570개 통과, 기존 조건부 1개 skip을 확인했다.
- Chromium Playwright는 PVP/PVE/session/reconnect/rollback/single을 포함해 24/24 통과했다.
- production dependency-only 환경에서 Express, Socket.IO와 Zod만으로 server를 기동하고 주요 page, built JS/CSS와 Socket.IO client의 HTTP 200을 확인했다.
- browser inbound 검증으로 `roomClient` chunk는 기준 대비 gzip 약 19.60kB 증가했다.
- strict schema가 아직 관찰되지 않은 정상 variant를 차단할 가능성과 WebKit/Firefox, 외부 TLS·reverse proxy, 장시간 malformed traffic 미검증 위험은 남아 있다.

## Migration Goal 4 server TypeScript build main 반영

- `NodeNext + allowJs`로 `dist/server` mirror를 생성하고 production에서 TypeScript runtime loader 없이 `dist/server/app.js`를 실행하도록 구성했다.
- `src/app.ts`와 `src/server/socketSecurity.ts`만 대표 TypeScript entry/leaf로 전환하고 나머지 기존 server JavaScript는 Goal 8까지 `allowJs`로 유지한다.
- `src/client/package.json`의 ESM 경계를 output에도 복사해 server가 사용하는 core/state/AI module의 export 의미를 보존했다.
- Vite hashed browser bundle은 `dist/client`, server shared core와 PVE dependency는 `dist/server/client/game`, Socket 계약은 `dist/server/shared`로 분리했다.
- build helper는 stale output을 제거한 뒤 TypeScript emit, client ESM manifest와 bundled V4 model asset 복사를 수행하며 새 dependency나 framework를 추가하지 않았다.
- production source map과 source `.ts`, test fixture, `.env`는 server artifact에 포함하지 않는다.
- `dev:server`는 server artifact를 먼저 build한 뒤 production과 같은 compiled entry를 실행한다.
- Goal 4 branch `codex/add-server-typescript-build`의 리뷰 수정 commit `7533095`까지 merge commit `128ac39`로 main에 반영하고 origin/main과 동기화했다.

## Goal 4 검증과 남은 위험

- artifact test는 output whitelist, 금지 파일, client ESM manifest, compiled game core와 bundled `placement_v4` decision을 검증해 1/1 통과했다.
- Node `24.18.0`에서 `bash scripts/verify.sh`가 통과했고 Node test는 571개 중 570개 통과, 기존 조건부 1개 skip이었다.
- compiled server 기준 Chromium Playwright는 24/24 통과했다.
- `npm run dev:server`에서 `/`와 `/socket.io/socket.io.js`가 HTTP 200을 반환했다.
- production dependency-only 환경은 Express, Socket.IO와 Zod만으로 기동했고 주요 page/asset은 200, server artifact와 source map 요청은 404였다.
- 기존 server JavaScript의 strict TypeScript 전환, WebKit/Firefox, 외부 TLS·reverse proxy, container와 장시간 soak는 후속 Goal로 남겼다.

## Migration Goal 5 React shell main 반영

- Vite multi-page와 기존 URL을 유지하면서 index와 multiplayer lobby body만 독립 `React.StrictMode` TSX entry로 전환했다.
- single/multiplayer Canvas runtime, Socket.IO protocol, server service와 gameplay rule은 변경하지 않았다.
- `react@19.2.7`, `react-dom@19.2.7`, `@types/react@19.2.17`, `@types/react-dom@19.2.3`만 exact version으로 추가했다.
- roomClient singleton의 session/handshake 소유권을 유지하고 lobby의 8개 구독을 React effect cleanup에서 정확히 해제한다.
- index와 lobby는 BFCache `pagehide`에서 sound/구독 side effect를 정리하고 `pageshow.persisted`에서 reload해 listener를 복원한다.
- review fix `87a679d`에서 disconnect-before-microtask, 실제 `pagehide → pageshow → reload`, index sound 복원과 host/guest token 비노출 회귀를 보강했다.
- local main은 Goal 5 구현과 review fix까지 fast-forward로 반영했다. Goal 5 branch는 보존하고 Goal 6은 시작하지 않았다.

## Goal 5 main 재검증

- Node `24.18.0`에서 `bash scripts/verify.sh`가 typecheck, 134-module build, artifact 1/1과 Node test 571개 중 570 pass, 기존 조건부 1 skip으로 통과했다.
- Vite-dev Playwright는 StrictMode lifecycle과 index BFCache 2 pass, production-only artifact 1 skip으로 통과했다.
- compiled production Chromium Playwright는 gameplay/session과 React lifecycle 회귀를 포함해 27/27 통과했다.
- WebKit/Firefox, 외부 TLS/reverse proxy, 실제 browser history 기반 BFCache eligibility와 장시간 soak는 계속 미검증 범위다.

## Migration Goal 6 main 통합 (2026-07-21)

- clean한 local `main`/`origin/main`이 `cc62f3e`와 일치하고 Goal branch HEAD가 `0cdc3cee`인 상태에서 `codex/migrate-react-single`을 `--ff-only`로 main에 병합했다.
- Node `24.18.0`/npm `11.16.0`에서 `bash scripts/verify.sh`를 재실행했다. typecheck와 clean build, artifact 1/1, Node test 576개 중 575 pass와 기존 조건부 1 skip, 실패 0이었다.
- main에서 `git diff --check`와 clean worktree를 확인했고 `0cdc3cee`가 main에 포함됐다.
- 동일 HEAD에서 이미 전체 production Playwright 31/31과 Vite-dev 5 pass가 통과했으며 코드 변경이 없으므로 두 E2E 명령은 재실행하지 않았다.
- 실제 browser history 기반 BFCache eligibility, WebKit/Firefox, 외부 TLS/reverse proxy와 장시간 timer/animation soak는 남은 위험이다. Goal 6 branch는 보존하고 push와 Goal 7은 수행하지 않았다.

## Migration Goal 7 multiplayer React main 통합 (2026-07-21)

- Goal 7의 display snapshot, session cleanup, multiplayer React shell과 접근성 review fix를 `c673856`까지 `--ff-only`로 local main에 반영했다. Goal branch는 보존한다.
- main Node `24.18.0`에서 `bash scripts/verify.sh`를 재실행해 artifact 1/1, Node test 579개 중 578 pass와 기존 조건부 1 skip, `git diff --check`와 clean worktree를 확인했다.
- 전체 branch gate는 Vite-dev 8 pass/2 skip, production Playwright 34/34였고, local main은 origin/main보다 6커밋 ahead다. push와 Goal 8은 수행하지 않았다.

## Migration Goal 7A SPA 실험 보류 (2026-07-21)

- 자동 gate를 통과했지만 review blocker가 남은 SPA 실험 구현은 `codex/migrate-react-spa@5b0f848`에 보존하고 main에는 병합하지 않는다.
- leave result 상관관계, membership 보존, hash navigation과 server cleanup 검증 문제가 남아 Goal 7A를 선택 실험으로 보류했다.
- 현재 four-entry MPA를 유지하며 Goal 8의 선행조건을 Goal 7로 복구했다. 상세 문제와 재개 조건은 `PLAN.md`와 `migration-harness/goals/07a-react-spa.md`를 따른다.

## Migration Goal 8B client runtime TypeScript main 통합 (2026-07-22)

- `codex/migrate-typescript-client-runtime@bead1b7`를 local main에 `--ff-only`로 병합했다. production client runtime/render/net/AI의 23개 JavaScript 경계를 TypeScript로 전환하고 consumer specifier, Socket/session 타입 경계와 PVE AI parity를 유지한 결과다.
- main Node `24.18.0`에서 `bash scripts/verify.sh`가 typecheck, clean build, artifact 1/1과 Node 586 pass·기존 조건부 1 skip으로 통과했다. 동일 Goal HEAD의 Vite-dev 8 pass·2 production-only skip과 production Playwright 34/34 결과를 통합 근거로 사용했으며 main E2E는 중복 실행하지 않았다.
- Goal branch는 보존하고 package/lockfile, gameplay·protocol·security와 보류 SPA는 변경하지 않았다. WebKit/Firefox, 장시간 soak와 외부 네트워크 조건은 남은 위험이며 Goal 8C/8D와 Goal 9는 시작하지 않았다.

---

# 이전 기록 누락 보완

## 비교 기준

- `change-log.md`의 마지막 변경 commit은 `b4960ad`였고 본문은 Goal 8B 통합에서 끝나 있었다.
- 아래에는 그 이후 current main `a1cf812`까지의 변경을 추가하고, 기존 본문에서 빠졌던 migration harness와 Goal 8A만 별도 누락 보완으로 구분했다.

## Migration harness 운영 기반 (2026-07-17)

- `AGENTS.md`와 `migration-harness/`에 공통 제약, workflow, verification, roadmap, Goal 범위와 merge gate 운영 절차를 추가했다.
- 각 Goal은 최신 main 기반의 별도 `codex/` branch/worktree에서 실행하고, 검증·로컬 커밋 뒤 사용자 승인 전에는 push, main 병합과 다음 Goal을 수행하지 않는 방식으로 고정했다.
- 이 harness는 runtime 기능을 변경하지 않는 문서 governance이며 `35093cc`, `ad85ee4`, `3b1329e`를 통해 main에 반영했다.

## Migration Goal 8A core/state TypeScript main 통합 (2026-07-22)

- Goal 8을 8A~8D로 분할하고 gameplay core 7개와 state 5개를 strict TypeScript로 전환했다.
- `blocks.ts`가 `PieceType`을 단독 소유하고 serialization의 기존 fallback과 복제 범위를 보존했다. JavaScript consumer의 import 경로도 같은 rename 경계에서 갱신했다.
- targeted core/state 49/49, Node 584 pass·기존 조건부 1 skip, artifact 1/1과 production Playwright 34/34를 통과했다.
- 최종 `7286ab6`까지 main에 반영했으며 package/lockfile, gameplay와 Socket 계약은 변경하지 않았다. 선택 Goal 8D는 계속 보류했다.

---

# 2026년 7월 22일

## Migration Goal 8C server TypeScript main 통합

- `src/server` production JavaScript를 strict TypeScript로 전환해 server source `.js`를 0개로 만들었다. shared `socketContracts.mjs`만 Zod runtime의 명시적인 예외로 유지했다.
- production은 TypeScript source를 직접 실행하지 않고 compiled `dist/server/app.js`에서 시작한다. Socket.IO raw payload는 계속 `unknown`에서 Zod 검증 후 typed service로 전달된다.
- compiled server test, artifact test와 source-less release gate를 추가해 source, devDependency, source map과 model override가 production runtime에 유입되지 않게 했다.
- Node 587 pass·기존 조건부 1 skip, artifact/release 각각 1/1, production Playwright 34/34와 ML Node 35/35·Python 115/115를 통과했다.
- 최종 `4d5bcd5`까지 main에 반영했고 dependency, lockfile, client behavior와 protocol 의미는 유지했다.

## PostgreSQL shadow 실험 보류

- 초기 PostgreSQL shadow 구현은 `codex/add-postgres-event-shadow@2245fef`에 보존하고 main에는 병합하지 않았다.
- 당시 단일 server와 ML 분석에는 JSONL로 충분하다고 판단해 Goal 9와 DB/JSONL cutover Goal 10을 보류하고, main에는 보류 결정 `1ab2237`만 반영했다.
- 과거 구현은 이후 CSP, Docker, 8초 shutdown과 CI 이전 기준이므로 현재 코드에 그대로 합치지 않는다.

## Migration Goal 11A CSP와 HTTP security headers

- `default-src 'none'` 기반 CSP, 고정 inline hash, exact `CSP_CONNECT_ORIGINS`, `nosniff`, frame deny와 no-referrer를 적용했다.
- report-only 관찰에서 확인한 Zod eval probe는 공식 `jitless` 설정으로 제거했다. 404/416과 Express 오류에서도 선택한 CSP mode 하나만 유지하고 raw 오류는 노출하지 않는다.
- 기존 same-origin Socket.IO와 built-in client serving은 유지하고 first-party TS/TSX와 source map은 계속 404로 차단했다.
- targeted 5/5, artifact/release 각각 1/1, Node 592 pass·기존 조건부 1 skip과 production Playwright 35/35를 통과했다.
- 최종 `5a2bb22`까지 main에 반영했다. 외부 TLS/reverse proxy와 WebKit/Firefox는 미검증 범위다.

## Migration Goal 11B dependency hardening

- npm audit의 low advisory를 제거하기 위해 lockfile의 `body-parser 2.2.2 → 2.3.0`, `type-is 2.0.1 → 2.1.0`과 필요한 nested `content-type 2.0.0`만 갱신했다.
- production source, `package.json`, `environment-ml.yml`, script와 engine 설정은 변경하지 않았다.
- production/full npm audit 0건, Node 592 pass·기존 조건부 1 skip, release 1/1, production Playwright 35/35와 ML Node 35/35·Python 115/115를 통과했다.
- 최종 `a18801c`까지 main에 반영했다. Conda 환경은 exact top-level pin이지만 전체 transitive build lockfile은 아니라는 한계가 남아 있다.

## 브라우저 BGM 재생 복구

- 사운드 설정이 켜져 있어도 browser autoplay 정책으로 첫 BGM 재생이 차단되면 음악이 계속 재생되지 않던 문제를 수정했다.
- 차단된 재생만 trusted user interaction 뒤 한 번 다시 시도하고, sound 설정과 기존 page lifecycle은 유지했다.
- 수정 `65b1903`은 index와 single lifecycle E2E로 검증한 뒤 Goal 11C branch에 동기화했다.

## Migration Goal 11C production Docker

- official Node `24.18.0-bookworm-slim` digest를 고정한 multi-stage Docker image를 추가하고 build dependency, production dependency와 runtime을 분리했다.
- runtime은 non-root `node`, read-only root, JSONL named volume, bounded health check와 exec-form command를 사용한다. source, test, devDependency, secret과 first-party source map은 포함하지 않는다.
- SIGTERM에서 Socket.IO, HTTP server, session/disconnect timer와 room ticker를 idempotent하게 정리한다. 최종 container는 약 0.16초, exit code 0으로 종료됐다.
- same-origin no-Origin Socket.IO polling은 `Sec-Fetch-Site`와 allowlisted Host가 모두 맞을 때만 허용하고 cross-origin과 forged Host는 계속 거부한다.
- container PVP/PVE 6/6, Node 594 pass·기존 조건부 1 skip, Vite-dev 10 pass·2 skip과 production Playwright 37/37을 통과했다.
- 최종 `84f8659`까지 main에 반영했다. registry publish/deploy, amd64, 외부 TLS/reverse proxy와 장시간 soak는 수행하지 않았다.

---

# 2026년 7월 23일

## Migration Goal 11D GitHub Actions CI

- token 원문이 assertion failure에 노출되지 않도록 boolean 비교로 바꾸고 `Fast gate`, `Chromium PVP and PVE`, `Production container smoke` 세 job workflow를 추가했다.
- 모든 job은 `ubuntu-24.04`, `.nvmrc`, clean install을 사용한다. workflow 권한은 `contents: read`뿐이며 공식 action은 full commit SHA로 고정했다.
- 실패 artifact는 redaction 정책 전까지 업로드하지 않고 Docker job은 image를 registry에 push하지 않는다.
- Draft PR [#1](https://github.com/Sleepingco/Tetris_multi/pull/1)의 hosted clean run에서 세 job이 모두 통과했고 PR merge commit `d6112e1`로 main에 반영했다.
- 이후 main push에서는 Fast/Docker가 통과했지만 Browser가 T-Spin과 pending garbage timing 경계에서 각각 36/37로 실패했다. main CI 전체가 green이라고 기록하지 않고 Goal 11E에서 별도로 안정화한다.

## 포트폴리오와 학습 문서 정비

- `README.md`를 현재 Vite/React/TypeScript, server-authoritative multiplayer, AI/ML, 보안, Docker와 CI 결과 중심의 포트폴리오 문서로 갱신했다.
- architecture report, gameplay flow와 heuristic AI 문서를 실제 TypeScript 경로와 현재 책임 경계에 맞췄다.
- `docs/goal-11-security-docker-ci-history.md`에 CSP, dependency, Docker와 GitHub Actions 변경 이유·검증·남은 위험을 학습용으로 정리했다.
- 이 구간은 documentation-only 변경이며 production behavior는 바꾸지 않았다.

## Goal 11E와 PostgreSQL roadmap 재개

- 실제 사용자 gameplay event를 container 수명과 분리해 보존한다는 요구에 따라 실행 순서를 `11E → 9A → 9B → 9C → 9D`로 문서화했다.
- Goal 11E는 최종 `8cc16d9`까지 main과 origin/main에 반영됐다. 자연 중력과 GitHub-hosted runner scheduling에 의존하던 PVE T-Spin E2E와 전용 helper를 제거하고 pending-garbage authoritative/UI 일관성 검증은 유지했다. T-Spin 보장은 `test/testTSpin.js`, `test/testPlayerGameplayStep.js`, `test/testTetrisRuntime.js`의 결정론적 core·authoritative·runtime 테스트가 담당한다.
- 최종 production Playwright는 36/36이며, 동일 SHA의 hosted Fast gate와 Production container smoke, Chromium PVP and PVE 연속 2회가 모두 성공했다. production code, workflow와 dependency는 변경하지 않았다.
- Goal 9A는 raw SQL migration과 `pg` repository, 9B는 canonical runtime storage, 9C는 기존 JSONL의 streaming·멱등 import, 9D는 실제 PostgreSQL CI/release와 운영 gate를 담당한다.
- event identity, immutable `event_sha256`, server-owned `gameId`, privacy allowlist, bounded retry, pool/in-flight 상한, 8초 shutdown과 retention 경계를 공통 계약으로 고정했다.
- 과거 `codex/add-postgres-event-shadow`는 merge/rebase나 commit 전체 cherry-pick 없이 identity·parameterized SQL·TLS·integration test 아이디어만 참고한다.
- Goal 9D와 별도 production 활성화 승인 후에는 `GAME_EVENT_STORAGE=postgres`만 사용하고 JSONL writer와 writable volume을 끈다. 기존 JSONL file과 repository code는 local/test 및 명시적 rollback용으로 보존한다.
- 문서 commit `c7614e4`, `a1cf812`의 PostgreSQL 계약은 유지한다. 이 시점의 Goal 9A~9D 미구현 상태는 아래 Goal 9A main 통합 기록으로 갱신한다.

## Migration Goal 9A PostgreSQL schema/repository main 통합

- Goal 9A `1fb2633`은 main과 origin/main에 fast-forward로 반영됐고 hosted [Migration CI #29994429680](https://github.com/Sleepingco/Tetris_multi/actions/runs/29994429680)의 Fast gate, Chromium PVP and PVE, Production container smoke가 모두 green이다.
- raw PostgreSQL migration은 checksum history와 bounded advisory lock runner를 사용하며, canonical event identity/hash와 idempotent inserted/duplicate/conflict repository를 제공한다. strict TLS, ambient `PG*` 차단과 migration bootstrap owner 검증도 포함한다.
- PostgreSQL 17.10 실제 integration test는 6/6, Node는 616 pass·기존 조건부 1 skip, artifact/release는 각각 1/1이며 production E2E는 같은 gameplay/client 코드에서 선행 36/36을 통과했다.
- 64-byte identity, whitespace-only identity와 infinite timestamp는 거부한다. JSONL은 계속 기본 runtime sink이고 PostgreSQL runtime 저장은 아직 구현하지 않았으며 Goal 9B 설계 gate의 범위다. production storage mode, gameplay와 Socket protocol은 변경하지 않았다.

## Migration Goal 9B PostgreSQL runtime event storage main 통합

- Goal 9B를 fast-forward로 main에 통합했다. JSONL/PostgreSQL은 strict single-sink이며 JSONL은 계속 기본 sink다. PostgreSQL runtime mode는 구현됐지만 production에서 활성화하지 않았다.
- server-owned `gameId`, authoritative receipt와 receipt replay 차단, lifecycle v1/v2 migration 호환, privacy allowlist, 3회·총 2.7초 retry, pool 4/in-flight 16과 안전한 shutdown 순서를 반영했다.
- Draft PR #3과 main push의 Fast gate, Chromium PVP and PVE, Production container smoke가 모두 green이었다. main에서는 Node 24.18.0 `npm ci`, `bash scripts/verify.sh`, `git diff --check`를 통과했고, 같은 Goal HEAD의 hosted Browser/Docker green 결과가 있어 전체 E2E와 Docker는 반복하지 않았다.
- managed provider, production TLS/credential, retention·deletion ownership과 용량 threshold는 남은 운영 위험이다. 다음 단계는 Goal 9C 설계 gate이며 Goal 9C/9D와 production PostgreSQL 활성화는 아직 미수행이다.

## Migration Goal 9C JSONL backfill main 통합

- Node stream/readline 기반 importer가 기존 JSONL을 전체 메모리에 올리지 않고 canonical projection과 privacy allowlist를 거쳐 PostgreSQL로 import한다.
- dry-run, 멱등 재실행, duplicate/conflict, partial failure 복구, lifecycle/placement completeness와 원본 checksum 불변을 실제 PostgreSQL 17.10에서 검증했다.
- Goal 9C는 main/origin에 반영했지만 production database와 실제 운영 JSONL은 변경하지 않았다.

## Migration Goal 9D PostgreSQL CI/release main 통합

- 기존 Fast/Browser/Docker job을 유지하고 실제 PostgreSQL 17.10의 migration/repository/runtime/import와 production-like Docker boundary를 검증하는 hosted job을 추가했다.
- private-CA TLS hostname 검증, migration/runtime/maintenance role 분리, JSONL 없는 PostgreSQL single-sink, PVP/PVE, backup/restore, restart, DB-down과 shutdown을 검증했다.
- PR #4와 최종 main `6775bfb`의 [Migration CI #30042098224](https://github.com/Sleepingco/Tetris_multi/actions/runs/30042098224)에서 네 job이 모두 green이다.
- production PostgreSQL, 실제 JSONL import와 OCI 배포는 활성화하지 않았다. 다음 단계는 OCI read-only preflight와 JSONL 기반 app + HTTPS 기준선 배포다.
