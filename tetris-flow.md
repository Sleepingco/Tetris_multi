# Tetris Flow Notes

> Last update: 2026-07-23.
> 이 문서는 `src/client/game/runtime/tetris.ts` 내부의 이동/고정/라인 클리어 흐름을 읽기 위한 학습 노트다.
> 현재 페이지는 React shell이 담당하지만, 게임 규칙과 Canvas 실행은 runtime/core/render 경계가 계속 소유한다.
> 멀티플레이 최종 상태는 서버 authoritative state가 소유하므로, 이 문서는 서버 흐름과 함께 읽어야 한다.

## 현재 큰 그림

```text
React page shell
  -> createTetrisRuntime(...)
  -> enqueueInput(action, tick, pieceIndex)
  -> runtime input queue
  -> resolveMoveAttempt / resolveMoveIntent
  -> board, score, line clear, placement log
  -> Canvas render + display bridge

PVP/PVE multiplayer
  -> client prediction for own board
  -> game:input
  -> server authoritative player state
  -> game:authoritative:snapshot
  -> opponent full apply, own limited correction
```

## 0) 용어/변수 사전 (Glossary)

### gameState 핵심 필드
- `board`: 보드 2D 배열(고정된 블록들). “현재까지 쌓인 상태”.
- `activePiece`: 현재 조작 중인 조각(확정된 위치)
  - 예: `{ pieceType, rotation, row, col }`
- `pendingPiece`: 이번 입력/중력으로 “가려고 시도하는” 조각
  - active에서 row/col/rotation을 바꾼 “후보” 상태
- `pieceQueue`: 앞으로 나올 조각 타입 큐
  - `shift()`로 다음 조각 꺼내고, `push(random)`로 보충
- `holdPieceType`: 홀드에 저장된 조각 타입(없으면 `null`/`""` 등)
- `holdUsedThisDrop`: “이번 드랍 턴에서 홀드를 이미 썼는지” 플래그
  - `true`면 같은 조각이 고정되기 전까지 홀드 재사용 금지
- `inputTimer`: 고정 tick에서 입력 큐와 자동 중력을 처리하는 interval 핸들
- `gravityRunning`: 자동 중력 처리 여부
- `automaticGroundedPieceIndex`: 자동 중력으로 바닥에 처음 닿은 조각을 한 번 그려 준 뒤 다음 gravity에서 lock하기 위한 표시값
- `score`: 점수

---

### moveCause(=cause) 정의
`renderBlocks(moveCause)`에 전달되는 문자열. “왜 이번 이동/판정이 발생했는지”를 의미.
- `"spawn"`: 새 조각을 스폰한 직후, 스폰 위치가 유효한지 검사
- `"fall"`: 자동 중력/하강으로 인해 더 내려가려다 막혀서 “락(lock) 판정”이 필요한 케이스
  - gravity tick → renderBlocks("fall")
- `"horizontal"`: 좌/우 이동 입력으로 발생
- `"rotate"`: 회전 입력으로 발생
- `"hardDrop"`: 하드 드롭으로 즉시 lock까지 이어지는 케이스

---

### attempt / resolveMoveAttempt 의미
- `resolveMoveAttempt(...)`는 “이번 시도(attempt)가 가능한지”를 판정하는 엔진 함수
- “attempt”는 보통 아래를 묶어서 말해:
  - 입력/중력으로 바뀐 후보 상태(pending)를
  - 현재 board 위에 둘 수 있는지(canPlace) 검사하고
  - 가능하면 commit, 불가능하면 revert/lock/gameOver/spawnBlocked로 “결과(status)”를 내는 과정

---

### status 정의 (resolveMoveAttempt 결과)
- `idle`: pendingPiece가 비어 있음 → 아무 처리 없음
- `ok`: pending이 유효 → commit
- `retry`: pending이 불가 → revert만 하고 끝(대부분 “입력 무시”와 동일)
- `lock`: 하강 시도 실패(더 내려갈 수 없음) → 고정(seizeBlock)로 이동
- `spawnBlocked`: 스폰 위치부터 불가 → 현재 런타임에서는 gameOver 판정 흐름으로 이어지는 예전 상태명
- `gameOver`: 더 이상 진행 불가(유예 끝, 또는 상단 침범 고정 등) → 종료

---

1) “한 장” Flow (변수 변화 포함)

# Tetris Flow (Detailed, Current)

## A. 전체 플로우 (필드 변화까지 포함)
```mermaid
flowchart TD
  %% Safe-mode: avoid subgraph, HTML <br/>, special chars, and long labels

  K[keydown]
  T[tick]

  L[shift left/right]
  R[rotate]
  D[down 1]
  HD[hard drop]
  H[hold]
  G[gravity step]

  RB[renderBlocks cause]
  RMA[resolveMoveAttempt]

  OK[ok: commit + render]
  RT[retry: revert + recheck]
  LK[lock: seizeBlock]
  SB[spawnBlocked: stopGravity + grace]
  GO[gameOver]

  SZ[seizeBlock]
  CM[checkMatch]
  SP[spawnNextActivePiece]

  K --> L --> RB
  K --> R --> RB
  K --> D --> RB
  K --> HD --> RB
  K --> H --> RB
  T --> G --> RB

  RB --> RMA

  RMA --> OK
  RMA --> RT
  RMA --> LK
  RMA --> SB
  RMA --> GO

  LK --> SZ --> CM
  CM --> SP
  SB --> GO
```

## B. 시퀀스 (실제 호출 순서 + 필드 변화 포인트)
```mermaid
sequenceDiagram
  %% Safe-mode: avoid <br/>, parentheses, and long participant labels
  participant I as Input
  participant M as Mutate
  participant RB as renderBlocks
  participant E as resolveMoveAttempt
  participant SZ as seizeBlock
  participant CM as checkMatch
  participant SP as spawnNext

  I->>M: keydown or tick
  M->>RB: call renderBlocks(cause)
  RB->>E: resolve(board, active, pending, cause)

  alt ok
    E-->>RB: ok
    RB->>RB: commit + render
  else retry
    E-->>RB: retry
    RB->>RB: revert + setTimeout retry
  else lock
    E-->>RB: lock
    RB->>SZ: seizeBlock
    SZ->>CM: checkMatch
    CM->>SP: spawnNext
  else spawnBlocked
    E-->>RB: spawnBlocked
    RB->>RB: stopGravity + grace
  else gameOver
    E-->>RB: gameOver
    RB->>RB: stopGravity + showGameOver
  end
```

## C. 상태 전이 (cause와 status 중심)
```mermaid
stateDiagram-v2
  [*] --> NoPending: pendingPiece 없음
  NoPending --> Spawning: spawnNextActivePiece()

  Spawning --> Active: renderBlocks("spawn")
  Active --> Active: ok (commit)

  Active --> SpawnBlocked: canPlace=false && cause=spawn
  SpawnBlocked --> GameOver: spawn blocked

  Active --> Locking: canPlace=false && cause=fall or hardDrop
  Locking --> Seized: seizeBlock()

  Seized --> LineCheck: checkMatch()
  LineCheck --> Spawning: rows 없음 또는 삭제 후

  Active --> Active: retry (revert + retry timer)
  GameOver --> [*]
```

## 2) 함수별 정의 (무엇을 읽고/쓰는지)

### `shiftActivePiece(dr, dc)`
- 의미: “activePiece 기반으로 이동 후보(pendingPiece)를 만든다”
- 읽기: `gameState.activePiece`
- 쓰기: `gameState.pendingPiece` (row/col 변경)
- 다음: `renderBlocks(cause)` 호출

### `rotatePendingPiece()`
- 의미: 회전 후보(pendingPiece.rotation)를 만든다
- 읽기: `activePiece`
- 쓰기: `pendingPiece.rotation`
- 다음: `renderBlocks("rotate")`

### `renderBlocks(moveCause)`
- 의미: “pending이 실제로 가능한지”를 엔진에 물어보고(status), 그 결과에 따라 state 변경/렌더/타이머 제어
- 읽기: `board, activePiece, pendingPiece`
- 쓰기: `activePiece/pendingPiece`, `gravityRunning`, `automaticGroundedPieceIndex`, `UI(renderBoard)`
- 핵심: **상태를 바꾸는 게 여기서 최종 결정됨**

### `resolveMoveAttempt(board, active, pending, cause)`
- 의미: “이번 attempt가 가능한가?”
- 하는 일:
  - `canPlace(pending, board)` 검사
  - 불가면 `cause`에 따라 `spawnBlocked/lock/retry/gameOver` 판정
  - 가능하면 `ok(commit)`
- 반환: `{ status, active: commitOrRevert, pending: normalized }` 같은 형태

### `seizeBlock()`
- 의미: 더 내려갈 수 없으면 “activePiece를 board에 박아서 고정”
- 읽기: `activePiece, board`
- 쓰기: `board`(고정 반영), `activePiece=empty`, `holdUsedThisDrop=false`
- 추가: `touchesAboveTop`면 즉시 gameOver

### `checkMatch()`
- 의미: 꽉 찬 줄 찾고, 있으면 이펙트 후 삭제/점수/스폰
- 읽기: `board`
- 쓰기: `board`(줄 삭제), `score`
- 타이머: `350ms` 연출 동안 중력 멈춤/재개 관리
  - 실제 구현은 `findFullRows`로 이펙트 줄 찾은 뒤 `clearFilledLines`에서 다시 스캔

### `spawnNextActivePiece()`
- 의미: 큐에서 다음 조각 뽑아 스폰하고 프리뷰 갱신
- 읽기/쓰기: `pieceQueue`
- 쓰기: `activePiece`, `pendingPiece`
- 다음: `renderBlocks('spawn')`로 스폰 유효성 검사

### `holdCurrentPiece()`
- (현재 이름은 `holdPiece()`)
- 의미: 현재 조각을 hold로 보내거나, hold와 swap
- 조건: `holdUsedThisDrop==true`면 무시
- 쓰기: `holdPieceType`, `activePiece`, `pendingPiece`, `holdUsedThisDrop=true`
- 타이머: hold 순간 중력 멈추고 스폰 검사 후 재개

---

## 3) 자동 중력 lock grace가 실제로 의미하는 것

- 자동 중력이 조각을 더 내릴 수 없게 만들면 즉시 lock하지 않고, 같은 조각의 바닥 접촉 상태를 한 번 렌더한 뒤 다음 gravity에서 lock한다.
- 목적: 자동 중력 tick 하나 때문에 조각이 눈에 보이기도 전에 고정되는 느낌을 줄이는 것이다.
- 핵심 포인트:
  - 이 처리는 `automaticGroundedPieceIndex`로 조각당 한 번만 적용한다.
  - 플레이어가 그 사이 입력으로 빠져나가면 lock하지 않고 계속 진행한다.
  - hard drop과 soft drop lock은 이 자동 중력 grace와 별도로 처리한다.

## 4) 서버 authoritative 흐름에서 같은 개념이 쓰이는 방식

- 클라이언트 runtime은 내 보드 조작감을 위해 prediction을 한다.
- 서버는 같은 action을 authoritative player state에 적용하고 snapshot을 보낸다.
- 상대 보드는 서버 snapshot을 full apply한다.
- 내 보드는 pending input, line clear, garbage/gameOver 조건을 보고 제한적으로 correction한다.
- PVE AI도 최종 좌표를 직접 꽂지 않고 `move_left`, `rotate`, `soft_drop`, `hard_drop` 같은 action을 서버 authoritative input 경로로 실행한다.
