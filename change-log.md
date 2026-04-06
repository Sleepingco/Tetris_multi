# 10월 20일

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

# 10월 24일

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

# 12월 5일
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
