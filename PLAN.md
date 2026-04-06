# PLAN

- Role: 이 문서는 현재 저장소의 단일 기준 문서다.
- Use: 현재 사실, 구조, 멀티 방향, 다음 액션을 한 곳에서 본다.
- Last update: `createTetrisRuntime(...)`, page bootstrap 분리, tick-tagged input queue, state serialization 도입 이후 기준으로 정리했다.

## Document Role

- 이 문서는 `ROADMAP.md`, `PROTOCOL.md`, `PHASE1_PLAN.md`의 핵심 내용을 현재 코드 기준으로 통합한 문서다.
- 이상적인 장기 계획보다 현재 구현 상태와 바로 다음 작업을 우선한다.
- 사람과 Codex/AI가 같이 참고하는 기준 문서로 사용한다.
- 용어는 아래 기준으로 고정한다.
  - `action`: 플레이어 입력 의미. 예: `move_left`, `rotate`
  - `moveCause`: 엔진 판정 문맥. 예: `fall`, `spawn`, `hardDrop`
  - `tick`: 입력과 진행 순서를 맞추기 위한 시간 단위
  - `snapshot`: 직렬화 가능한 게임 상태 복사본
  - `authoritative`: 최종 진실의 원천. 멀티에서는 서버 기준

## Project Direction

- 핵심 목표는 멀티플레이 가능한 테트리스 구조를 만드는 것이다.
- 현재 우선순위는 프레임워크 도입이 아니라 런타임, 엔진, 네트워크 경계를 안정화하는 것이다.
- 방향은 유지한다.
  - 엔진은 최대한 순수하게 유지
  - 런타임은 orchestration 중심
  - 렌더러는 상태 소비자
  - 멀티는 서버 authoritative
- 장기적으로는 deterministic loop를 지향한다.
- 하지만 현재 MVP 멀티는 `seed` 기반 완전 결정론보다 `server bag` 정책이 더 현실적이다.

## Current Status

### 구현된 것

- [x] `createTetrisRuntime(...)` 도입
- [x] single/multi page bootstrap 분리
- [x] tick-tagged input queue 도입
- [x] `src/core/board.js`에 보드 생성, 충돌, 고정, 줄 삭제 순수 함수 존재
- [x] `src/core/step.js`에 `resolveMoveAttempt`, `resolveMoveIntent` 존재
- [x] `src/game/stateSerialization.js`에 snapshot serialize/deserialize 보조 함수 존재
- [x] `src/game/multiGamePage.js`에서 local runtime / remote runtime 생성

### 부분 완료

- [~] `src/game/tetris.js`는 예전의 전역 싱글 파일 단계에서는 벗어남
- [~] `src/game/tetris.js`는 여전히 크고 orchestration 외 책임이 남아 있음
- [~] RNG 주입 구조는 있음
- [~] 기본 RNG는 아직 `Math.random`
- [~] remote runtime은 생성되지만 network sync는 아직 없음
- [~] 멀티 화면 bootstrap은 분리됐지만 실제 match 흐름은 아직 없음

### 아직 미구현

- [ ] 완전한 deterministic multiplayer
- [ ] authoritative server match loop
- [ ] room/match/game 이벤트 기반 멀티 프로토콜 구현
- [ ] remote runtime snapshot 반영 경로
- [ ] server bag 배포와 소비 경로

### 현재 판단

- 현재 구조는 "멀티 준비가 된 싱글 런타임" 단계다.
- 아직 "실제 멀티 게임 루프" 단계는 아니다.

## Current Architecture

### Page bootstrap

- `src/game/singleGamePage.js`
  - 싱글 페이지용 DOM 조회
  - `createTetrisRuntime(...)` 생성
  - keyboard input 연결
  - `init()` 호출
- `src/game/multiGamePage.js`
  - local/remote player DOM 분리
  - local runtime 생성 후 입력 연결
  - remote runtime 생성 후 `init({ autoStart: false })`
  - 현재 remote는 렌더 대상만 준비된 상태

### Runtime layer

- `src/game/tetris.js`
  - 현재 런타임 진입점은 `createTetrisRuntime(...)`
  - 내부에서 다음을 조율한다.
    - game state 초기화
    - input queue 소비
    - gravity 진행
    - engine 판정 호출
    - piece spawn/hold/seize
    - line clear sequencing
    - canvas/UI 반영
  - 반환값은 현재 runtime 제어 API 역할을 한다.
    - `init`
    - `enqueueInput`
    - `render`
    - `stop`
    - `hideGameOver`
    - `showGameOver`
    - `runtime`
    - `gameState`

### Core engine layer

- `src/core/board.js`
  - `createEmptyBoard`
  - `canPlacePiece`
  - `lockPieceOnBoard`
  - `clearFilledLines`
- `src/core/step.js`
  - `resolveMoveAttempt`
  - `resolveMoveIntent`
- 현재 core는 순수 함수 중심으로 유지되고 있다.
- 이 방향은 맞다.

### State and snapshot layer

- `src/game/stateSerialization.js`
  - `serializeGameState`
  - `deserializeGameState`
- 현재 snapshot 보조 함수는 준비되어 있다.
- 하지만 실제 네트워크 sync 경로에는 아직 연결되지 않았다.

### 현재 구조에 대한 짧은 평가

- 구조는 이전보다 훨씬 좋아졌다.
- 특히 page bootstrap 분리와 runtime factory 도입은 큰 진전이다.
- 다만 `tetris.js`는 아직 다음 책임이 남아 있다.
  - line clear sequencing
  - piece lifecycle 세부 흐름
  - 일부 state helper
  - runtime loop 세부 구현

## Multiplayer Direction

### 기본 원칙

- 서버 authoritative 방향을 유지한다.
- 클라이언트는 `action`을 보낸다.
- 서버는 room 상태와 match 상태를 관리한다.
- remote 화면은 결국 authoritative snapshot 또는 그에 준하는 state apply 결과를 보여준다.

### 현재 기준 MVP 정책

- MVP에서는 `seed`보다 `server bag`이 더 현실적이다.
- 의미:
  - 서버가 각 플레이어의 조각 순서를 소유한다.
  - 클라이언트의 RNG는 authoritative source가 아니다.
  - 클라이언트는 서버가 정한 bag/queue 또는 spawn 결과를 따른다.
- 이유:
  - 지금은 완전 deterministic loop가 아직 아니다.
  - 기본 RNG가 여전히 `Math.random`이다.
  - runtime 구조는 정리 중이고, 먼저 작동하는 멀티 MVP가 필요하다.

### action과 moveCause 규약

- 네트워크로 보내는 값은 `action`이다.
- 예:
  - `move_left`
  - `move_right`
  - `soft_drop`
  - `rotate`
  - `hard_drop`
  - `hold`
- `moveCause`는 엔진 내부 판정 문맥으로 유지한다.
- 예:
  - `horizontal`
  - `fall`
  - `rotate`
  - `hardDrop`
  - `spawn`

### snapshot 방향

- `snapshot`은 멀티 sync와 remote render를 위한 상태 복사본이다.
- 현재는 serialization helper만 있음
- 아직 없는 것:
  - 서버에서 snapshot 생성
  - 클라이언트에서 snapshot 적용
  - remote runtime에 authoritative state 반영

### 현재 멀티 진행 상태

- [x] 멀티 페이지에서 local/remote runtime 캔버스 구조 준비
- [x] remote runtime은 `autoStart: false`로 생성 가능
- [ ] local 입력을 네트워크로 보내는 경로
- [ ] 서버 room/match 상태
- [ ] server bag 전달
- [ ] snapshot 수신 후 remote runtime 반영
- [ ] 승패 판정과 match lifecycle

## Current Phase

### 현재 단계

- 이름: Runtime boundary stabilization with multiplayer prep

### 진행 현황

- [x] 전역 단일 파일 구조 탈출
- [x] runtime factory 도입
- [x] single/multi bootstrap 분리
- [x] tick-tagged input queue 도입
- [x] core board/step 분리
- [~] `tetris.js` 축소 진행 중
- [~] snapshot 기반 멀티 준비 중
- [ ] 실제 authoritative multiplayer 시작 전

### 현재 단계의 핵심 문제

- `tetris.js`가 아직 크다.
- snapshot을 만들 수는 있지만 적용 경로가 없다.
- 멀티 page는 준비됐지만 멀티 규약과 서버 상태가 아직 없다.
- deterministic 설계는 방향만 있고, 현재 MVP 구현 기준은 아니다.

### Phase 1 완료 조건

- [ ] `tetris.js`가 orchestration 중심으로 읽힌다.
- [ ] 엔진 판단이 `src/core`에서 이해된다.
- [ ] DOM 없이 핵심 규칙 테스트가 가능하다.
- [ ] 입력 -> 판정 -> 상태 변경 -> 렌더 흐름을 추적할 수 있다.

### 현재 단계에서 하지 않을 것

- 전체 프런트 프레임워크 전환
- rollback netcode
- checksum 자동 복구
- spectator
- ranking
- seed 기반 완전 재현을 멀티 MVP의 선행조건으로 두기

## Next Actions

### 바로 해야 할 일

1. `PLAN` 기준 용어와 상태 기준 고정
   - `action`, `moveCause`, `tick`, `snapshot`, `authoritative`
   - 서버와 클라이언트가 같은 용어를 쓰게 정리
2. `tetris.js`를 한 단계 더 축소
   - line clear sequencing
   - piece lifecycle sequencing
   - runtime loop helper
3. 멀티 서버 상태 초안 추가
   - room state
   - match state
   - player state
4. `server bag` 정책 문서화 후 최소 구현
   - 서버가 bag 또는 next queue를 관리
   - 클라이언트는 이를 소비
5. snapshot apply 경로 설계
   - `serializeGameState`는 있음
   - 이제 remote runtime에 state를 반영하는 경로 필요

### 권장 구현 순서

- [ ] Step 1. `src/app.js`를 room/match 단위 서버로 확장
- [ ] Step 2. `match:start`, `match:ready`, `game:input` 최소 이벤트 정의
- [ ] Step 3. 서버가 local player용 `server bag` 또는 spawn stream을 관리
- [ ] Step 4. remote runtime에 snapshot 또는 spawn/update 반영 API 추가
- [ ] Step 5. local/remote 한 화면에서 상태 차이가 눈에 보이게 만들기

### 이후 단계

- [ ] deterministic RNG를 실제로 주입 가능한 구조로 마무리
- [ ] seed 기반 replay 실험
- [ ] authoritative tick과 snapshot 주기 정리
- [ ] multiplayer MVP 완료 후 AI 단계로 이동

## MVP Event Contract

- 목적: MVP 멀티에서 바로 구현할 이벤트만 작게 고정한다.
- 기준: 서버 authoritative, 네트워크에는 `action`, 내부 판정에는 `moveCause`
- 필수 공통 필드
  - `roomId`
  - `matchId`
  - `playerId`
  - `tick`
  - `action`
  - `tickRate`
  - `startTick`

### `room:create`

```json
{
  "nickname": "park",
  "mode": "versus",
  "isPrivate": false
}
```

### `room:join`

```json
{
  "roomId": "room_123",
  "nickname": "guest"
}
```

### `match:ready`

```json
{
  "roomId": "room_123",
  "playerId": "player_a",
  "ready": true
}
```

### `match:start`

- 현재 MVP 기준
  - `seed` 고정 전제 대신 `bagMode: "server"`를 사용
  - 필요하면 나중에 `seed`를 옵션으로 추가

```json
{
  "roomId": "room_123",
  "matchId": "match_001",
  "startTick": 0,
  "tickRate": 30,
  "bagMode": "server",
  "initialBagChunks": {
    "player_a": ["tee", "bar", "square", "rightZee", "leftZee", "leftL", "rightL"],
    "player_b": ["bar", "square", "tee", "leftL", "rightL", "leftZee", "rightZee"]
  },
  "seed": null
}
```

### `game:input`

```json
{
  "roomId": "room_123",
  "matchId": "match_001",
  "playerId": "player_a",
  "tick": 42,
  "action": "move_left"
}
```

### `game:snapshot`

```json
{
  "roomId": "room_123",
  "matchId": "match_001",
  "tick": 60,
  "players": [
    {
      "playerId": "player_a",
      "score": 1200,
      "board": [],
      "activePiece": {
        "pieceType": "tee",
        "rotation": 1,
        "row": 5,
        "col": 4
      },
      "holdPieceType": "bar",
      "nextQueue": ["square", "leftZee"],
      "phase": "playing"
    }
  ]
}
```

### `match:finish`

```json
{
  "roomId": "room_123",
  "matchId": "match_001",
  "winnerPlayerId": "player_a",
  "reason": "top_out",
  "finalTick": 321
}
```

## Later Roadmap

### 멀티 MVP 이후

- [ ] 배포와 운영 기초 정리
- [ ] AI 상대 추가
- [ ] deterministic seed/replay 고도화

### 운영 체크리스트 최소 항목

- [ ] `start` / `build` / `dev` script
- [ ] `env` / `port` 정리
- [ ] room cleanup
- [ ] health check

### AI 원칙

- AI는 DOM이 아니라 game state를 읽는다.
- AI 출력은 사람과 같은 `action` 형식을 사용한다.

## Existing Docs Note

- `ROADMAP.md`: 상위 방향 문서였음. 핵심 방향은 이 문서에 흡수했다.
- `PROTOCOL.md`: 멀티 철학은 유지하되, MVP 기준은 `seed`보다 `server bag`으로 수정 반영했다.
- `PHASE1_PLAN.md`: 오래된 계획서 성격이 강해서 "진행 현황"과 "다음 액션"으로 흡수했다.
- 가능하면 이후에는 이 `PLAN`을 기준으로 유지하고, 나머지 문서는 보조 기록 또는 아카이브로 두는 편이 좋다.
