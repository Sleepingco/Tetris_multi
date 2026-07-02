# PLAN

- Role: 이 문서는 현재 저장소의 단일 기준 문서다.
- Use: 현재 사실, 구조, 멀티 방향, 다음 액션을 한 곳에서 본다.
- Last update: `matchService`, server bag, `game:input`, `game:snapshot`, `game:over`, `snapshotCorrection`, `pieceQueue`, 멀티 게임 local/remote runtime 연결 이후 기준으로 정리했다.

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
- LLM 기능은 현재 MVP 범위가 아니다.
- 추후 LLM은 게임 판단이나 AI 의사결정의 원천이 아니라, 플레이 로그와 AI 분석 결과를 사용자에게 설명하는 코칭 리포트 계층으로 둔다.

## Current Status

### 구현된 것

- [x] `createTetrisRuntime(...)` 도입
- [x] `src/client/pages/tetrisSingle.html` module script에서 싱글 런타임 bootstrap
- [x] `src/client/pages/tetrisMulti.html` 멀티 게임 local/remote runtime 연결
- [x] tick-tagged input queue 도입
- [x] `src/client/game/core/board.js`에 보드 생성, 충돌, 고정, 줄 삭제 순수 함수 존재
- [x] `src/client/game/core/step.js`에 `resolveMoveAttempt`, `resolveMoveIntent` 존재
- [x] `src/client/game/state/stateSerialization.js`에 snapshot serialize/deserialize 보조 함수 존재
- [x] `src/client/game/state/pieceQueue.js`에 7-bag/next queue 유틸리티 존재
- [x] `src/client/game/runtime/snapshotCorrection.js`에 원격 snapshot 보정 판단 유틸리티 존재
- [x] `src/server/services/roomService.js`에 room 생성/참가/퇴장/시작/종료/동기화 로직 존재
- [x] `src/server/services/matchService.js`에 match 생성, input log, player별 server bag chunk 로직 존재
- [x] `src/server/sockets/multiplayerHandlers.js`에 `room:create`, `room:join`, `room:leave`, `room:start`, `game:join`, `game:input`, `game:snapshot`, `game:bag:request`, `game:over`, `disconnect` 흐름 존재
- [x] `src/server/sockets/chatHandlers.js`에 `global:chat`, `room:chat`, legacy `chatting` 흐름 분리
- [x] `src/client/net/roomClient.js`에 room/chat/game 이벤트 adapter 함수 존재
- [x] `src/client/pages/multiLobby.html`에서 방 코드, 상태, player 수 표시와 방 입장/나가기 UI 연결
- [x] 로비 채팅을 `global:chat` / `room:chat`으로 분리
- [x] 채팅 입력은 1초 1회 서버 rate limit과 plain text 렌더링 기준 적용
- [x] `game:input` 1차 배관 추가: 클라이언트 입력을 서버 검증 후 같은 room 상대에게 전달
- [x] `game:snapshot` 1차 배관 추가: 클라이언트 snapshot을 서버 검증 후 상대에게 전달
- [x] `game:bag:request` / `game:bag:append` 1차 배관 추가: 서버가 player별 bag chunk를 생성해 room에 전달
- [x] `game:over` / `match:finish` 1차 배관 추가: top out 기준 승패 결과 broadcast
- [x] shadow authoritative mode 1차 구현
  - `matchService`가 player별 shadow state를 만들고, `game:input`과 shadow gravity tick으로 서버 측 game state를 뒤에서 계산한다.
  - client snapshot과 shadow snapshot을 비교해 desync reason, severity, recent health, queue/hold 차이를 debug summary로 관찰할 수 있다.
  - shadow 결과는 아직 클라이언트 화면에 강제 적용하지 않는다.
- [x] `npm test`로 roomService, matchService, multiplayerSocket, runtime, move step, snapshot correction 주요 흐름 검증 가능
- [x] `.gitignore`에 `node_modules/`, `.DS_Store`, `coverage/`, `dist/` 제외

### 부분 완료

- [~] `src/client/game/runtime/tetris.js`는 예전의 전역 싱글 파일 단계에서는 벗어남
- [~] `src/client/game/runtime/tetris.js`는 여전히 크고 orchestration 외 책임이 남아 있음
- [~] RNG 주입 구조는 있음
- [~] 기본 RNG는 아직 `Math.random`
- [~] 로비와 멀티 게임 흐름은 연결됐지만 브라우저 2탭 기준 반복 회귀 검증이 필요함
- [~] 멀티 게임 화면은 input relay + server bag + snapshot correction 기반으로 동작하지만, 서버는 shadow mode로 같은 입력을 뒤에서 계산 중임
- [~] shadow authoritative 계산은 존재하지만 아직 화면의 최종 진실 원천은 아님

### 아직 미구현

- [ ] 완전한 deterministic multiplayer
- [ ] 화면에 적용되는 authoritative server match loop
- [~] 서버 shadow state를 client authoritative snapshot 후보로 내려주는 구조
- [ ] 서버가 생성한 authoritative `game:snapshot` 전송
- [ ] `match:ready` 같은 명시적 준비 상태
- [ ] 방 목록, quick match, match 결과 화면

### 현재 판단

- 현재 구조는 "싱글 런타임 정리 + 멀티 로비 + 멀티 게임 MVP 동기화 1차 구현" 단계다.
- 실제 멀티 게임은 동작 흐름이 생겼지만, 최종 진실 원천은 아직 서버가 아니라 클라이언트 예측 + snapshot 보정에 가깝다.

## Current Architecture

### Page bootstrap

- `src/client/pages/tetrisSingle.html`
  - module script에서 싱글 페이지용 DOM 조회
  - `createTetrisRuntime(...)` 생성
  - keyboard input 연결
  - `init()` 호출
- `src/client/pages/tetrisMulti.html`
  - 세션의 room/player 정보를 검증하고 실패 시 로비로 되돌린다.
  - host/guest 역할에 따라 local canvas와 remote canvas를 배정한다.
  - local runtime과 opponent runtime을 각각 생성한다.
  - local 입력은 `game:input`으로 서버에 보내고, 상대 입력은 opponent runtime에 enqueue한다.
  - local snapshot은 500ms마다 서버에 보내고, 상대 snapshot은 `snapshotCorrection` 기준으로 opponent runtime에 보정 적용한다.
  - server bag chunk를 받아 local/opponent runtime에 append한다.
  - `match:finish`를 받아 승패 표시와 로비 복귀 버튼을 처리한다.
- `src/client/pages/multiLobby.html`
  - room create/join/leave UI와 Socket.IO room 상태 표시 연결
  - `room:result`, `room:updated`, `room:message`를 받아 방 코드, 상태, 인원 수, 시스템 메시지 반영

### Runtime layer

- `src/client/game/runtime/tetris.js`
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
    - `destroy`
    - `getSnapshot`
    - `applySnapshot`
    - `applyServerBag`
    - `appendServerBag`
    - `getServerBagRemainingCount`
    - `hideGameOver`
    - `showGameOver`
    - `runtime`

### Core engine layer

- `src/client/game/core/board.js`
  - `createEmptyBoard`
  - `canPlacePiece`
  - `lockPieceOnBoard`
  - `clearFilledLines`
- `src/client/game/core/step.js`
  - `resolveMoveAttempt`
  - `resolveMoveIntent`
- 현재 core는 순수 함수 중심으로 유지되고 있다.
- 이 방향은 맞다.

### State and snapshot layer

- `src/client/game/state/stateSerialization.js`
  - `serializeGameState`
  - `deserializeGameState`
- `src/client/game/state/pieceQueue.js`
  - `pickRandomPiece`
  - `ensureQueueFilled`
  - `takeNextFromQueue`
- `src/client/game/runtime/snapshotCorrection.js`
  - `isSamePiece`
  - `shouldCorrectSnapshot`
- `src/client/game/runtime/authoritativeSnapshotRouting.js`
  - `resolveAuthoritativeSnapshotTarget`
  - `applyResolvedAuthoritativeSnapshotTarget`
  - `getAuthoritativeSnapshotScope`
  - 서버 authoritative snapshot 후보를 실제로 적용하기 전에 local/opponent 대상과 실패 사유를 순수 함수로 판정한다.
  - resolved target을 받은 뒤 해당 runtime의 `applySnapshot()`을 호출하는 작은 적용 helper도 존재한다.
  - 단, 현재 멀티 페이지에서는 아직 이 적용 helper를 실게임 화면에 연결하지 않았다.
- 현재 snapshot은 멀티 화면에서 500ms 주기로 전송되고, 상대 runtime 보정에 사용된다.
- 단, snapshot을 만드는 주체는 아직 클라이언트다. 서버 authoritative snapshot은 아니다.

### Server and room layer

- `src/app.js`
  - Node.js 실행 진입점
  - `src/server/init.js`를 로드한다.
- `src/server/init.js`
  - Express static server, HTTP server, Socket.IO server를 조립한다.
  - static root는 `src/client`다.
- `src/server/services/roomService.js`
  - `Map` 기반 메모리 room 상태를 관리한다.
  - `createRoom`, `joinRoom`, `removePlayer`, `removePlayerBySocketId`, `leaveRoom`, `startGame`, `leaveGame`, `syncRoom`, `finishGame`, `getRoomState`를 제공한다.
- `src/server/services/matchService.js`
  - `Map` 기반 메모리 match 상태를 관리한다.
  - `createMatch`, `getMatchState`, `deleteMatch`, `recordInput`, `appendPlayerBagChunk`, `recordClientSnapshot`, `getPlayerShadowState`, `resetMatches`를 제공한다.
  - player별 `inputLog`, `bagChunks`, `shadowState`, `shadowInputLog`, `lastClientSnapshot`, `lastShadowSnapshot`, `desyncLog`를 관리한다.
  - shadow mode에서는 `recordInput()`과 shadow gravity loop가 서버 측 game state를 계산한다.
  - 이 계산 결과는 아직 클라이언트 화면에 적용하지 않고, client snapshot과 비교하는 관찰/검증 용도로만 사용한다.
  - `deleteMatch()`는 match와 shadow loop timer를 함께 정리해 stale shadow state가 남지 않게 한다.
- `src/server/services/shadowGameEngine.js`
  - DOM 없는 서버용 shadow game step을 담당한다.
  - move, rotate wall kick, soft/hard drop, hold, gravity, lock, line clear, score, combo/back-to-back, T-Spin, pending garbage 흐름을 계산한다.
  - 현재 목적은 완전 authoritative 적용이 아니라 client prediction과 같은 입력/server bag 기준으로 얼마나 일치하는지 관찰하는 것이다.
- `src/server/sockets/multiplayerHandlers.js`
  - room/game Socket.IO 이벤트 입구다.
  - `room:create`, `room:join`, `room:leave`, `room:sync`, `room:start`, `game:*`, `disconnect`를 등록한다.
  - room 단위 join/broadcast를 수행한다.
- `src/server/sockets/chatHandlers.js`
  - chat Socket.IO 이벤트 입구다.
  - `global:chat`, `room:chat`, legacy `chatting`, `chat:result` 흐름을 담당한다.
  - 채팅 입력 검증, 1초 rate limit, room 채팅 권한 확인을 담당한다.

### Client network layer

- `src/client/net/roomClient.js`
  - 브라우저 Socket.IO room adapter다.
  - create/join/leave/start 요청, room result/update/message 구독, global/room chat 송수신, game join/input/snapshot/bag/finish 함수를 제공한다.
- `src/client/net/chat.js`
  - 기존 채팅 adapter다. 현재 멀티 로비의 주 채팅 경로는 `roomClient.js`다.

### 현재 구조에 대한 짧은 평가

- 구조는 이전보다 훨씬 좋아졌다.
- 특히 page bootstrap 분리와 runtime factory 도입은 큰 진전이다.
- 다만 `src/client/game/runtime/tetris.js`는 아직 다음 책임이 남아 있다.
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

### 현재 MVP 인증/소켓 정책

- 현재는 로그인, DB, 서버 세션이 없는 학습/MVP 단계다.
- 따라서 `playerId`를 임시 신원 값처럼 사용하고, `socketId`는 현재 연결 검증에 사용한다.
- `room:start`처럼 권한이 필요한 요청은 `playerId`와 현재 요청 socket을 함께 확인한다.
- 페이지 이동이나 새로고침 후 Socket.IO 연결은 새로 만들어질 수 있으므로, 로비 복귀 시 `room:sync`에서 room에 저장된 player의 `socketId`를 최신 로비 socket id로 갱신한다.
- 단, `game:join`에서는 room 권한 기준 socket id를 갱신하지 않는다.
  - 게임 페이지 socket은 게임 sync용 연결이다.
  - room host 권한 기준은 로비에서 다시 동기화되는 socket을 기준으로 둔다.
  - 이렇게 해야 게임 페이지 이동, 종료, disconnect 흐름이 room 권한 상태를 덮어쓰지 않는다.

### 실무형 인증/연결 관리 전환 계획

- 실제 서비스에서는 `socketId`를 신원의 원천으로 두지 않는다.
- `socketId`는 현재 연결 주소이고, 권한 판단의 기준은 로그인 세션, JWT, 서버 세션에서 확인된 `userId`가 된다.
- 전환 시 room 상태는 의미 상태 중심으로 정리한다.
  - `userId` 또는 서버가 발급한 안정적인 `playerId`
  - `nickname`
  - `role`
  - `ready`
  - `status`
- socket 연결 정보는 room 상태와 분리된 connection map으로 관리한다.
  - 예: `userId -> socketId`
  - 예: `socketId -> userId`
  - 예: `userId -> roomId`
- Socket.IO 연결 시 인증 middleware에서 토큰/세션을 검증하고, 검증된 사용자만 room 이벤트를 처리한다.
- 권한 검사는 `socketId === player.socketId`보다 `authenticatedUserId === room.hostUserId` 같은 형태로 이동한다.
- 이 전환은 멀티 MVP가 동작한 뒤 별도 단계로 진행한다.
  - 현재 단계에서 로그인, DB, JWT를 먼저 도입하지 않는다.
  - 먼저 room/start/game sync 흐름을 이해 가능한 상태로 완성한다.

### 채팅 이벤트와 XSS 방어 정책

- 채팅 범위는 이벤트 이름으로 분리한다.
  - `global:chat`: 로비 전체 채팅 요청
  - `global:message`: 서버가 전체 socket에 broadcast하는 전체 채팅 메시지
  - `room:chat`: 현재 room 참가자에게만 보내는 채팅 요청
  - `room:message`: room 단위 시스템 메시지와 room 채팅 메시지
  - `chat:result`: 채팅 검증 실패 결과
- 채팅 도배 방지는 서버 socket 기준으로 먼저 적용한다.
  - 현재 MVP 규칙: 같은 socket은 1초에 1회만 채팅을 보낼 수 있다.
  - 이 제한은 global/room 채팅에 공통 적용한다.
- 사용자 입력 문자열은 HTML이 아니라 plain text로 취급한다.
  - 서버는 빈 메시지, 최대 길이, 권한, rate limit만 검증한다.
  - 서버는 사용자 메시지를 HTML로 만들지 않는다.
  - 클라이언트는 사용자 문자열을 `innerHTML`에 넣지 않고 `textContent` 또는 text node로 렌더링한다.
  - `<script>alert(1)</script>` 같은 입력은 실행 대상이 아니라 그대로 보이는 텍스트여야 한다.
- 추후 DB 저장이 생기면 저장 전/후에도 같은 원칙을 유지한다.
  - 저장 데이터는 plain text다.
  - 화면 출력 시점에는 반드시 DOM text API로 렌더링한다.

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
- 현재는 클라이언트가 만든 snapshot을 서버가 검증 후 상대에게 전달하고, 상대 runtime에 보정용으로 적용한다.
- snapshot 전송 주기는 500ms로 낮췄다. 현재 snapshot은 주 표시 수단이 아니라, input 예측 실행이 어긋났을 때 따라잡는 보정 장치다.
- snapshot 보정은 `pieceIndex` 기준으로 제한한다.
  - 과거 `pieceIndex` snapshot은 무시한다.
  - 미래 `pieceIndex` snapshot은 뒤처진 상대 보드를 따라잡기 위해 적용한다.
  - 같은 `pieceIndex`에서는 `phase` 또는 `activePiece` 차이가 있을 때만 적용한다.
- 이후 input 중심 구조에서는 서버가 계산한 authoritative snapshot을 클라이언트에게 내려주는 방향으로 전환한다.
- 아직 없는 것:
  - 서버에서 snapshot 생성
  - remote runtime에 authoritative state 반영

### snapshot에 포함할 상태 기준

현재 snapshot은 "상대 화면을 그리기 위한 상태"이면서 "예측 실행이 어긋났을 때 복원할 수 있는 최소 상태"다.
따라서 포함 기준은 단순히 모든 runtime 값을 복사하는 것이 아니라, 상대 runtime이 같은 화면과 같은 진행 위치로 돌아갈 수 있는지로 판단한다.

포함하는 상태:

- `board`
  - 이미 고정된 블록 상태다.
  - 상대 보드 렌더와 보정의 핵심 기준이다.
- `activePiece`
  - 현재 떨어지는 조각의 종류, 회전, 위치다.
  - 상대 화면에서 지금 조작 중인 조각을 표시하려면 필요하다.
- `pieceQueue`
  - 다음 조각 표시와 다음 spawn 예측에 필요하다.
  - server bag을 쓰더라도 클라이언트 runtime의 현재 소비 위치를 보여주는 값이다.
- `holdPieceType`, `holdUsedThisDrop`
  - hold UI와 현재 조각에서 hold 가능 여부를 복원한다.
- `score`, `linesClearedTotal`
  - 상대 점수/라인 UI에 표시해야 하는 공개 상태다.
- `phase`
  - `playing`, `gameOver`, `lineClearing` 같은 runtime 상태를 맞춘다.
- `fallIntervalMs`
  - 현재 낙하 속도 상태를 복원한다.
- `combo`, `backToBack`
  - 다음 공격량 계산에 영향을 줄 수 있는 전투 규칙 상태다.
- `pendingGarbageQueue`
  - 아직 보드에 올라오지 않은 incoming garbage 상태다.
  - 이 값이 빠지면 상대 화면의 incoming 표시가 실제 상태와 어긋난다.
- `tick`
  - snapshot 시점의 시간 순서 기준이다.
- `pieceIndex`
  - 몇 번째 조각인지 나타내는 순서 기준이다.
  - 과거 조각 snapshot이 현재 조각을 덮어쓰는 문제를 막는다.

제외하는 상태:

- `inputQueue`
  - 아직 처리 전인 로컬 입력 대기열이다.
  - 네트워크로 공유하면 상대 runtime에 중복 입력이 적용될 수 있다.
- `pendingPiece`
  - 이동/회전을 시도하는 내부 임시값이다.
  - snapshot 적용 시 `activePiece`에서 다시 만들 수 있다.
- `bag`
  - 멀티에서는 server bag chunk가 조각 공급 원천이다.
  - snapshot에 bag을 넣으면 server bag 소비 흐름과 충돌할 수 있다.
- `lastActionWasRotation`, `isTSpin`
  - T-Spin 판정 직전의 순간 상태다.
  - 현재 MVP snapshot은 상대 표시/보정을 우선하므로 기본 전송 필드로 두지 않는다.
- timer id, gravity accumulator, DOM element, sound state, debug flag
  - 브라우저 실행 환경의 부수 상태다.
  - 다른 클라이언트나 서버가 복원할 수 있는 게임 규칙 상태가 아니다.
- `roomId`, `playerId`
  - Socket.IO payload의 바깥 메타데이터로 둔다.
  - snapshot 내부에는 게임 상태만 둔다.

현재 기준:

- snapshot은 "공개 가능한 게임 진행 상태"만 담는다.
- 로컬 입력 처리 중간값과 브라우저 환경 상태는 담지 않는다.
- 서버 authoritative 전환 전까지는 client-generated snapshot을 보정/관찰용으로 유지한다.
- 서버 authoritative 전환 후에는 같은 기준을 서버 snapshot schema로 옮긴다.

### Client prediction -> server authoritative 전환 계획

현재 멀티 MVP는 클라이언트 예측 구조다.
내 보드는 내 브라우저 runtime이 직접 진행하고, 상대 보드는 상대 input을 받아 로컬 runtime으로 따라 실행한다.
서버는 room 검증, input relay, inputLog 저장, server bag 전달, garbage attack 전달을 담당한다.
현재는 추가로 shadow mode에서 player별 shadow state를 뒤에서 계산한다.
다만 이 shadow state는 아직 클라이언트 화면에 강제 적용되지 않으므로, 최종 진실 원천은 아직 서버 authoritative snapshot이 아니다.

목표 구조는 서버 authoritative 구조다.
최종적으로는 서버가 player별 game state를 들고 input을 처리한 뒤, 서버가 만든 snapshot을 클라이언트에 내려준다.
클라이언트는 조작감 때문에 local prediction을 유지할 수 있지만, 최종 진실 원천은 서버 snapshot이다.

전환 원칙:

- 한 번에 `game:snapshot`을 제거하지 않는다.
- `game:input`, server bag, playerId/roomId 검증은 현재 프로토콜을 유지한다.
- 먼저 서버가 뒤에서 같은 계산을 수행하는 shadow mode를 만든 뒤, 차이를 로그로 확인한다.
- shadow mode가 안정화된 뒤에만 client-generated snapshot 의존도를 줄인다.

전환 단계:

1. 현재 프로토콜 고정
   - `game:input`: `{ roomId, playerId, action, tick, pieceIndex }`
   - `game:bag:request` / `game:bag:append`
   - `game:garbage:attack` / `game:garbage:append`
   - `game:over` / `match:finish`
   - client snapshot은 당분간 보정/관찰용으로 유지한다.
2. 서버 match state 확장
   - `matchService`에 player별 `gameState` 저장 위치를 추가한다.
   - 처음에는 실제 게임 진행에 사용하지 않고, 초기 state와 server bag 소비 상태만 보관한다.
   - 테스트로 "room start 시 두 player의 server state가 만들어지는지"부터 확인한다.
3. 순수 step 경계 만들기
   - runtime 내부의 DOM, timer, sound, UI 의존 없는 진행 로직을 `step(state, input)` 형태로 꺼낼 수 있게 정리한다.
   - 서버는 이 순수 step만 호출해야 한다.
   - 클라이언트 runtime은 기존 UI/렌더 흐름을 유지하되 같은 core 판정 함수를 사용한다.
4. Shadow authoritative mode
   - 서버가 `game:input`을 받을 때 player별 server state에도 같은 input을 적용한다.
   - 이 단계에서는 서버 state를 클라이언트에 강제 적용하지 않는다.
   - client snapshot과 server snapshot/checksum을 비교해서 차이를 로그로 남긴다.
5. Server authoritative snapshot 전송
   - 서버가 일정 tick 또는 이벤트 단위로 authoritative snapshot을 내려준다.
   - 내 보드는 local prediction 후 서버 snapshot으로 보정한다.
   - 상대 보드는 client input 예측보다 서버 snapshot 반영 비중을 높인다.

Authoritative tick / snapshot 주기 기준:

- 서버 authoritative tick은 우선 100ms 단위로 검증한다.
  - 현재 shadow loop와 맞추기 쉬운 값이다.
  - 브라우저 2탭 MVP에서 CPU/메모리 부담을 크게 늘리지 않는 선에서 desync를 관찰할 수 있다.
  - 완전 authoritative 전환 후 조작감이 부족하면 50ms로 낮추는 것을 별도 실험으로 둔다.
- 서버 push snapshot은 모든 tick마다 일반 클라이언트에 보내지 않는다.
  - 현재 단계에서는 `?debug=1`로 구독한 socket에만 `game:authoritative:snapshot:update`를 보낸다.
  - 일반 플레이 화면은 아직 client prediction + client snapshot correction을 유지한다.
- 완전 전환 전까지 요청형 snapshot과 push형 snapshot의 역할을 분리한다.
  - `game:authoritative:snapshot:result`: 수동/주기 debug 요청 응답
  - `game:authoritative:snapshot:update`: 서버 loop가 만든 push 후보
- 완전 authoritative 전환 시점의 1차 목표 주기는 다음과 같이 잡는다.
  - 서버 simulation tick: 50-100ms
  - authoritative snapshot push: 100-250ms
  - client-generated `game:snapshot`: debug/desync report 용도로 축소
- line clear, lock, game over, garbage 적용처럼 상태가 크게 바뀌는 이벤트는 주기와 별도로 즉시 snapshot push 후보가 될 수 있다.
- snapshot push에는 authoritative 기준 필드만 포함한다.
  - 포함: `board`, `activePiece`, `pieceQueue`, `holdPieceType`, `holdUsedThisDrop`, `score`, `linesClearedTotal`, `phase`, `combo`, `backToBack`, `pendingGarbageQueue`, `tick`, `pieceIndex`
  - 제외: DOM/UI/sound/debug state, input queue 내부 구현, socket 메타데이터
6. Client-generated snapshot 축소
   - `game:snapshot`은 더 이상 상대 표시의 주 경로가 아니다.
   - client snapshot은 debug/desync report 용도로만 남긴다.
   - `snapshotCorrection`은 client snapshot 보정이 아니라 server snapshot 보정 기준으로 바뀐다.
7. Client-generated snapshot 제거
   - 서버 snapshot이 안정화되면 클라이언트가 만든 snapshot broadcast를 제거한다.
   - 이 시점부터 remote board는 서버가 계산한 state만 표시한다.

제거/축소 시점:

- input relay는 authoritative 전환 후에도 유지한다. 서버가 계산하려면 input은 계속 필요하다.
- snapshot correction은 shadow mode와 server snapshot 검증이 안정화되기 전까지 유지한다.
- client-generated snapshot은 server state와 client state 차이를 추적할 수 있을 때까지 유지한다.
- 상대 보드의 `autoStart: true` 예측은 현재 `authoritativeApply=opponent` 실험 모드에서만 끈다.
  일반 모드까지 확장할지는 server snapshot 기반 remote render 안정성을 확인한 뒤 결정한다.

검증 기준:

- 같은 server bag과 같은 inputLog를 넣으면 서버 state가 클라이언트 state와 같은 board/pieceIndex/score/lines를 만든다.
- 빠른 이동/회전 연타 후에도 pieceIndex가 과거 조각으로 되돌아가지 않는다.
- garbage pending/cancel/applied 상태가 server snapshot과 client UI에서 일치한다.
- game over 이후 room/match 상태가 재시작 가능한 상태로 정리된다.

### 현재 멀티 진행 상태

- [x] 로비에서 `room:create` 요청 가능
- [x] 로비에서 생성된 roomId, 상태, player 수 표시 가능
- [x] 로비에서 `room:join` 요청 가능
- [x] 로비에서 `room:leave` 요청 가능
- [x] 서버에서 `disconnect` 발생 시 room player 제거 가능
- [x] Socket.IO room 단위 `room:updated`, `room:message` broadcast 가능
- [x] 멀티 게임 페이지에서 local/remote runtime 연결
- [x] local 입력을 `game:input`으로 서버에 전송하고, 서버가 room/player/action 검증 후 상대에게 전달
- [x] snapshot 수신 후 remote runtime 보정 반영
- [x] `server bag`을 match/player별로 생성하고 클라이언트 runtime에 공급
- [x] `pieceIndex`를 snapshot/input에 포함하고, 오래된 입력이 현재 조각에 적용되지 않도록 제한
- [x] 같은 tick/pieceIndex에 과도한 입력이 쌓이지 않도록 runtime input queue에서 제한
- [x] 기본 모드에서 상대 보드는 `autoStart: true`로 input relay + snapshot correction 기반 예측 실행
- [x] `?debug=1&authoritativeApply=opponent`에서는 상대 보드의 client-side prediction 경로를 제한적으로 차단
  - client-generated snapshot correction 차단
  - 상대 input prediction 차단
  - 상대 runtime `autoStart` 차단
  - 상대 garbage prediction 차단
  - 상대 bag append prediction 차단
- [x] 서버 shadow state가 input/server bag/gravity 기준으로 뒤에서 진행됨
- [x] `game:shadow:state` debug API로 shadow summary 조회 가능
- [x] shadow/client snapshot 차이를 reason, severity, recent health, queue/hold 값으로 관찰 가능
- [ ] 두 브라우저 탭 기준 create/join/start/play/finish/lobby 복귀 수동 회귀 검증
- [ ] 명시적 ready 흐름 도입 여부 결정
- [x] 서버 match 상태 초안
- [x] server bag 전달
- [x] 승패 판정과 match finish broadcast

## Current Phase

### 현재 단계

- 이름: Multiplayer MVP sync stabilization before authoritative server loop

### 진행 현황

- [x] 전역 단일 파일 구조 탈출
- [x] runtime factory 도입
- [x] 싱글 페이지 runtime bootstrap 정리
- [x] tick-tagged input queue 도입
- [x] core board/step 분리
- [x] 서버 roomService 구현
- [x] Socket.IO room create/join/leave/disconnect 연결
- [x] 클라이언트 로비 room create/join/leave UI 연결
- [x] roomService와 multiplayerSocket Node 테스트 추가
- [~] `src/client/game/runtime/tetris.js` 축소 진행 중
- [~] snapshot correction 기반 멀티 보정 중
- [~] `game:input` 기반 authoritative 전환 준비 중
- [~] room/start/game sync MVP는 연결됐고 안정화 검증이 필요함
- [~] 현재 멀티 게임은 input relay + server bag + snapshot correction 기반으로 동작
- [~] shadow authoritative match loop 관찰 중
- [ ] 실제 authoritative match/game loop 전환 전

### 현재 단계의 핵심 문제

- `src/client/game/runtime/tetris.js`가 아직 크다.
- 현재 snapshot은 보정용으로 적용되지만, 서버 authoritative snapshot은 아직 아니다.
- `game:input`은 서버 검증/전달/inputLog 저장까지 연결됐고, shadow mode에서는 같은 입력으로 서버 shadow state도 계산한다.
- 다만 서버 shadow state는 아직 화면에 적용되지 않으므로 authoritative source는 아니다.
- 기본 모드의 상대 보드는 여전히 `autoStart: true`로 로컬 예측 실행 중이므로, 최종 진실 원천은 아직 서버가 아니다.
- 단, `?debug=1&authoritativeApply=opponent` 실험 모드에서는 상대 보드 표시를 server authoritative snapshot 후보 중심으로 분리하는 중이다.
- deterministic 설계는 방향만 있고, 현재 MVP 구현 기준은 아니다.

### Phase 1 완료 조건

- [ ] `src/client/game/runtime/tetris.js`가 orchestration 중심으로 읽힌다.
- [ ] 엔진 판단이 `src/client/game/core`에서 이해된다.
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

1. 브라우저 2탭 멀티 플레이 회귀 검증
   - 같은 브라우저에서 두 player를 만들 때는 두 번째 탭을 `/pages/multiLobby.html?resetPlayer=1`로 열어 player session을 분리한다.
   - authoritative snapshot 적용 실험은 로비를 `/pages/multiLobby.html?resetPlayer=1&debug=1&authoritativeApply=opponent`로 열어 시작한다.
   - 로비에서 게임 화면으로 이동할 때 `debug=1`과 `authoritativeApply=opponent`는 `/pages/tetrisMulti.html` URL로 전달된다.
   - 게임 화면 debug panel에 `Debug on | Apply opponent`가 표시되는지 먼저 확인한다.
   - server snapshot push가 들어오면 debug panel의 route 상태가 `Opponent applied ... | Local blocked ... | Last opponent seq ...`처럼 누적 갱신되는지 확인한다.
   - 빠른 이동/회전 연타
   - 블록 안착 직후 다음 블록 조작
   - 상대 보드가 과거 블록으로 되돌아가지 않고 snapshot으로 보정되는지 확인
2. 현재 MVP 동기화 파라미터 유지 여부 결정
   - snapshot 주기 500ms 유지 또는 조정
   - same tick/pieceIndex 입력 제한값 4 유지 또는 조정
   - 기본 모드에서는 opponentGame `autoStart: true` 유지
   - `authoritativeApply=opponent` 실험 모드에서는 opponentGame `autoStart: false` 유지
3. shadow/client desync 원인 축소
   - `recentHealth`, `actionableReason`, `clientPieceQueue`, `shadowPieceQueue`, `clientHold`, `shadowHold`를 기준으로 mismatch 원인을 분류한다.
   - queue/hold가 같고 board만 다르면 board merge, line clear, garbage 적용 순서를 우선 맞춘다.
   - queue/hold가 다르면 bag append, queue 소비, hold reset 시점을 우선 맞춘다.
   - shadow engine의 server bag queue buffer는 client runtime server bag 모드와 같은 `NEXT_QUEUE_SIZE + 1` 기준으로 맞췄다.
   - shadow engine의 hold 후 스폰은 client runtime의 `renderBlocks("spawn")` 흐름처럼 `lastActionWasRotation`을 false로 초기화한다.
   - shadow engine은 `lineClearing` 중에 들어온 garbage step도 client runtime처럼 pending queue에 저장한다.
4. 서버 authoritative snapshot 전송 설계
   - shadow snapshot 중 어떤 필드를 client authoritative snapshot으로 내려줄지 정한다.
   - client-generated `game:snapshot`을 언제 debug/desync report 용도로 축소할지 정한다.
   - 현재 `authoritativeApply=opponent`에서만 차단한 상대 예측 경로를 일반 모드까지 확장할지 결정한다.

### 권장 구현 순서

- [x] Step 1. 로비 create/join/leave/disconnect 브라우저 검증
- [x] Step 2. `game:input` 최소 이벤트 정의 및 서버 검증/전달
- [x] Step 3. `roomService`와 분리된 match state/service 초안 추가
- [x] Step 4. 서버가 local player용 `server bag` 또는 spawn stream을 관리
- [x] Step 5. 서버 match state에 input log를 저장
- [x] Step 6. local/remote 한 화면에서 상태 차이가 눈에 보이게 만들기
- [~] Step 7. 서버가 input으로 game state를 계산할 수 있는 순수 step 경계 만들기
  - shadow mode 기준으로 1차 구현됨
  - client runtime과 완전히 같은 계산인지 desync summary로 계속 검증 중
- [~] Step 8. 서버 authoritative snapshot 방향으로 전환

### 이후 단계

- [ ] deterministic RNG를 실제로 주입 가능한 구조로 마무리
- [ ] seed 기반 replay 실험
- [x] authoritative tick과 snapshot 주기 문서 기준 정리
- [ ] multiplayer MVP 완료 후 AI 단계로 이동
- [ ] 플레이 로그 수집과 사용자 행동 feature 추출
- [ ] rule-based AI와 사용자 수 비교 지표 추가
- [ ] LLM 코칭 리포트는 분석 지표와 AI 비교 결과가 준비된 뒤 검토

## MVP Event Contract

- 목적: 현재 코드에 구현된 Socket.IO 이벤트를 기준으로 MVP 계약을 작게 고정한다.
- 현재는 `matchId`가 따로 없고 `roomId`가 match 조회 key 역할을 한다.
- 현재는 `match:start` 이벤트가 없다. 게임 시작 요청은 `room:start`이고, 성공 시 서버가 내부에서 `createMatch(room)`을 호출한다.
- 네트워크에는 `action`을 보내고, 내부 판정 문맥은 `moveCause`로 유지한다.

### `room:create`

현재 구현 기준:

```json
{
  "playerId": "player_a",
  "nickname": "Host"
}
```

### `room:join`

현재 구현 기준:

```json
{
  "roomId": "ABCD1234",
  "player": {
    "playerId": "player_b",
    "nickname": "Guest"
  }
}
```

### `room:leave`

현재 구현 기준:

```json
{
  "roomId": "ABCD1234",
  "playerId": "player_a"
}
```

### `room:sync`

현재 구현 기준:

```json
{
  "roomId": "ABCD1234",
  "playerId": "player_a"
}
```

현재 서버 처리:
- room 참가자인지 확인한다.
- 로비 복귀 상황에서는 socket id를 최신 로비 연결로 갱신한다.
- finished room의 두 플레이어가 모두 로비로 돌아오면 room status를 `waiting`으로 되돌린다.

### `room:start`

현재 구현 기준:

```json
{
  "roomId": "ABCD1234",
  "playerId": "player_a"
}
```

현재 서버 처리:
- 요청자가 host인지, 현재 socket이 host player의 socket인지 확인한다.
- player가 2명이고 room status가 `waiting`일 때만 `playing`으로 변경한다.
- 성공 시 `room:result`, `room:updated`, `room:message`를 보내고 `createMatch(room)`으로 match 상태를 만든다.

### `room:result`

현재 구현 기준:

```json
{
  "ok": true,
  "room": {
    "roomId": "ABCD1234",
    "players": [],
    "status": "waiting",
    "createdAt": 1710000000000
  },
  "reason": null
}
```

### `room:updated`

현재 구현 기준:

```json
{
  "roomId": "ABCD1234",
  "players": [],
  "status": "waiting",
  "createdAt": 1710000000000
}
```

### `room:message`

현재 구현 기준:

```json
{
  "type": "system",
  "text": "Guest님이 입장하였습니다.",
  "roomId": "ABCD1234"
}
```

### `game:join`

```json
{
  "roomId": "ABCD1234",
  "playerId": "player_a"
}
```

현재 서버 응답 `game:join:result`:

```json
{
  "ok": true,
  "room": {
    "roomId": "ABCD1234",
    "status": "playing"
  },
  "match": {
    "roomId": "ABCD1234",
    "status": "playing",
    "players": [
      {
        "playerId": "player_a",
        "inputLog": [],
        "bagChunks": [["bar", "eleft", "eright", "ess", "square", "tree", "zee"]]
      }
    ]
  },
  "reason": null
}
```

현재 처리:
- room 참가자인지 확인한다.
- 성공 시 socket을 room에 join시킨다.
- 현재 match state를 함께 내려준다.

### `game:input`

현재 구현 기준:

```json
{
  "roomId": "ABCD1234",
  "playerId": "player_a",
  "action": "move_left",
  "tick": 42,
  "pieceIndex": 10
}
```

현재 서버 처리:
- `syncRoom(roomId, playerId)`로 room 참가자만 허용한다.
- 허용 action은 `move_left`, `move_right`, `soft_drop`, `rotate`, `hard_drop`, `hold`다.
- `matchService.recordInput()`으로 action, tick, pieceIndex를 저장한다.
- 정상 input은 같은 Socket.IO room의 상대에게 `game:input`으로 전달한다.
- 실패 시 요청자에게 `game:input:result`를 보낸다.

### `game:snapshot`

```json
{
  "roomId": "ABCD1234",
  "playerId": "player_a",
  "snapshot": {
    "board": [],
    "activePiece": {
      "pieceType": "tree",
      "rotation": 1,
      "row": 5,
      "col": 4
    },
    "pieceQueue": ["square", "zee", "bar"],
    "holdPieceType": "bar",
    "holdUsedThisDrop": false,
    "score": 1200,
    "linesClearedTotal": 4,
    "phase": "playing",
    "fallIntervalMs": 800,
    "combo": 1,
    "backToBack": false,
    "pendingGarbageQueue": [
      {
        "lines": 2,
        "holeCol": 4
      }
    ],
    "tick": 42,
    "pieceIndex": 10
  }
}
```

현재 서버 처리:
- room 참가자인지 확인한다.
- `snapshot.board`가 배열인지 최소 검증한다.
- 활성 match가 없거나 player가 match에 없으면 실패 응답을 보내고 상대에게 전달하지 않는다.
- 정상 snapshot은 같은 Socket.IO room의 상대에게 `game:snapshot`으로 전달한다.
- 실패 시 요청자에게 `game:snapshot:result`를 보낸다.

현재 snapshot 필드 기준:
- 포함: `board`, `activePiece`, `pieceQueue`, `holdPieceType`, `holdUsedThisDrop`, `score`, `linesClearedTotal`, `phase`, `fallIntervalMs`, `combo`, `backToBack`, `pendingGarbageQueue`, `tick`, `pieceIndex`
- 제외: `inputQueue`, `pendingPiece`, 내부 `bag`, DOM/UI/sound/debug 상태, socket 메타데이터

### `game:authoritative:snapshot`

현재 구현 기준:

```json
{
  "roomId": "ABCD1234",
  "playerId": "player_a"
}
```

현재 서버 처리:
- `syncRoom(roomId, playerId)`로 room 참가자만 허용한다.
- `matchService.getPlayerAuthoritativeSnapshot(roomId, playerId)`로 해당 player의 shadow 기반 authoritative snapshot 후보를 만든다.
- 요청자에게 `game:authoritative:snapshot:result`를 보낸다.

응답 기준:

```json
{
  "ok": true,
  "roomId": "ABCD1234",
  "playerId": "player_a",
  "source": "server_shadow",
  "snapshot": {
    "board": [],
    "activePiece": {
      "pieceType": "tree",
      "rotation": 1,
      "row": 5,
      "col": 4
    },
    "pieceQueue": ["square", "zee", "bar"],
    "holdPieceType": "bar",
    "holdUsedThisDrop": false,
    "score": 1200,
    "linesClearedTotal": 4,
    "phase": "playing",
    "combo": 1,
    "backToBack": false,
    "pendingGarbageQueue": [],
    "tick": 42,
    "pieceIndex": 10
  },
  "createdAt": 1783000000000,
  "reason": null
}
```

현재 의미:
- 아직 게임 화면에 적용하지 않는다.
- 서버가 만든 authoritative snapshot 후보를 debug/검증용으로 요청해서 보는 단계다.
- `source: "server_shadow"`는 이 값이 아직 최종 authoritative source가 아니라 shadow 계산 기반 후보라는 뜻이다.

서버 push 이벤트:
- 서버 shadow loop가 진행될 때 구독 중인 debug socket에만 `game:authoritative:snapshot:update`로 player별 authoritative snapshot 후보를 보낸다.
- 클라이언트 adapter에는 이 이벤트를 받기 위한 `receiveGameAuthoritativeSnapshotUpdate(handler)` 수신 경로가 있다.
- debug 구독은 `game:authoritative:snapshot:subscribe`, 해제는 `game:authoritative:snapshot:unsubscribe`로 요청한다.
- debug 구독은 room 참가자이면서 활성 match가 있는 경우에만 허용한다.
- debug 구독은 `unsubscribe`, `disconnect`, `room:leave`, `game:leave`, `game:over` / `match:finish`에서 서버 측에서도 정리한다.
- `?debug=1` 멀티 게임 화면에서는 이 update를 `console.table()`로 출력해 관찰할 수 있다.
- debug table row는 `authoritativeDelivery`로 요청형 `request`와 push형 `push`를 구분한다.
- debug table row는 현재 페이지의 `playerId`와 snapshot의 `playerId`를 비교해 `authoritativePlayerScope`를 표시한다.
  - `local`: 내 player snapshot
  - `opponent`: 상대 player snapshot
  - `null`: 비교할 현재 playerId가 없거나 snapshot playerId가 없는 경우
- 같은 scope 기준은 `game:shadow:state` summary 안에 포함된 마지막 authoritative snapshot 후보 row에도 적용한다.
- `?debug=1`의 authoritative snapshot push handler는 `resolveAuthoritativeSnapshotTarget()`을 dry-run으로 호출해 적용 대상 후보를 console table에 표시한다.
  - 기본값에서는 `localGame.applySnapshot()` 또는 `opponentGame.applySnapshot()`을 호출하지 않는다.
  - 목적은 실제 적용 전에 라우팅 결과가 기대와 맞는지 확인하는 것이다.
- `?debug=1&authoritativeApply=opponent`일 때만 authoritative snapshot 후보를 `opponentGame`에 제한 적용할 수 있다.
  - `local` target은 이 flag에서도 적용하지 않는다.
  - 조작감에 직접 영향을 주는 내 보드 보정은 아직 열지 않는다.
  - route table에는 `applyMode`, `applied`, `reason`을 함께 표시한다.
  - 이 mode에서는 기존 client-generated `game:snapshot`으로 상대 보드를 보정하는 경로를 건너뛴다.
  - 상대 player의 `game:input`을 `opponentGame`에 예측 적용하는 경로도 건너뛴다.
  - 상대 보드에 대한 `game:garbage:append` 예측 queue도 건너뛴다.
  - 상대 보드에 대한 `game:bag:append` 예측 queue 보충도 건너뛴다.
  - 내 보드로 들어오는 garbage queue는 기존처럼 유지한다.
  - 내 player의 server bag append는 기존처럼 유지한다.
  - 상대 runtime의 자체 `autoStart`도 끈다.
  - snapshot 송신 자체는 shadow/desync 관찰을 위해 유지한다.
- push payload에는 debug 해석용 metadata를 포함한다.
  - `updateReason`: snapshot 후보가 push된 이유
    - 예: `subscribe_initial`, `shadow_tick`, `input`, `garbage`, `bag`, `placement`
  - `updateSequence`: room 안에서 몇 번째 authoritative update 묶음인지 나타내는 증가값
    - 같은 trigger에서 나온 host/guest snapshot은 같은 `updateSequence`를 가진다.
    - 다음 trigger에서는 sequence가 증가한다.
- 아직 이 snapshot을 게임 화면에 적용하지 않는다.
- 현재 목적은 일반 플레이 클라이언트에 불필요한 debug payload를 보내지 않으면서 server push 계약과 payload 형태를 관찰 가능한 상태로 만드는 것이다.

### `game:bag:request`

현재 구현 기준:

```json
{
  "roomId": "ABCD1234",
  "playerId": "player_a"
}
```

현재 서버 처리:
- room 참가자인지 확인한다.
- `matchService.appendPlayerBagChunk()`로 player의 bag chunk를 추가한다.
- 성공 시 room 전체에 `game:bag:append`를 보낸다.

`game:bag:append` 예:

```json
{
  "roomId": "ABCD1234",
  "playerId": "player_a",
  "bagChunk": ["bar", "eleft", "eright", "ess", "square", "tree", "zee"]
}
```

### `game:leave`

현재 구현 기준:

```json
{
  "roomId": "ABCD1234",
  "playerId": "player_a"
}
```

현재 서버 처리:
- playing room에서만 처리한다.
- 정상 처리 시 요청 socket을 room에서 leave하고 상대에게 `game:opponent-left`를 보낸다.
- 정상 처리 시 해당 room의 match/shadow loop를 정리한다.
- 요청자에게 `game:leave:result`를 보낸다.

### `game:over`

현재 구현 기준:

```json
{
  "roomId": "ABCD1234",
  "playerId": "player_a",
  "reason": "top_out"
}
```

현재 서버 처리:
- `finishGame(roomId, loserPlayerId, reason)`으로 room status를 `finished`로 바꾼다.
- 상대 player를 winner로 계산한다.
- 성공 시 room 전체에 `match:finish`를 보낸다.
- 성공 시 game over 로그에 필요한 match 정보를 읽은 뒤 해당 room의 match/shadow loop를 정리한다.
- 실패 시 요청자에게 `game:over:result`를 보낸다.

### `match:finish`

현재 구현 기준:

```json
{
  "room": {
    "roomId": "ABCD1234",
    "status": "finished"
  },
  "winnerPlayerId": "player_a",
  "loserPlayerId": "player_b",
  "reason": "top_out"
}
```

### 아직 없는 이벤트

- `match:ready`
- `match:start`
- 서버 tick loop 기반 `game:state`

## Later Roadmap

### 멀티 MVP 이후

- [ ] 배포와 운영 기초 정리
- [ ] AI 상대 추가
- [ ] 플레이 로그 기반 사용자 패턴 분석
- [ ] 사용자 행동과 AI 추천 행동 비교
- [ ] LLM 기반 코칭 리포트 추가 검토
- [ ] deterministic seed/replay 고도화

### 운영 체크리스트 최소 항목

- [x] `start` script
- [x] `test` script
- [ ] `dev` script 필요 여부 결정
- [ ] `build` script는 프론트엔드 마이그레이션 전까지 보류
- [ ] `env` / `port` 정리
- [~] disconnect 기반 room cleanup
- [ ] TTL 또는 오래된 room cleanup
- [ ] health check

### AI 원칙

- AI는 DOM이 아니라 game state를 읽는다.
- AI 출력은 사람과 같은 `action` 형식을 사용한다.
- rule-based AI를 먼저 만들고, 이후 ML/RL은 비교 가능한 지표 위에서 확장한다.
- LLM은 보조 설명 계층이다.
- LLM 입력은 원본 게임 로그 전체가 아니라 요약 통계, 주요 실수 장면, AI 추천 행동, 사용자 행동 차이를 중심으로 구성한다.
- LLM이 판단을 대신하지 않는다. 판단은 rule/ML 분석 계층에서 만들고, LLM은 그 결과를 자연어로 설명한다.

## Existing Docs Note

- `ROADMAP.md`: 상위 방향 문서였음. 핵심 방향은 이 문서에 흡수했다.
- `PROTOCOL.md`: 멀티 철학은 유지하되, MVP 기준은 `seed`보다 `server bag`으로 수정 반영했다.
- `PHASE1_PLAN.md`: 오래된 계획서 성격이 강해서 "진행 현황"과 "다음 액션"으로 흡수했다.
- 가능하면 이후에는 이 `PLAN`을 기준으로 유지하고, 나머지 문서는 보조 기록 또는 아카이브로 두는 편이 좋다.
