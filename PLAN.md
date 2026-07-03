# PLAN

- Role: 이 문서는 현재 저장소의 단일 기준 문서다.
- Use: 현재 사실, 구조, 멀티 방향, 다음 액션을 한 곳에서 본다.
- Last update: 2026-07-03 기준. main은 `input relay + server bag + snapshot correction + garbage` 기반 멀티 MVP 상태로 본다. 과하게 커졌던 shadow/debug 실험은 별도 브랜치로 분리했고, main 계획에서는 서버 authoritative 재진입 전 client 책임 정리를 우선한다.

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
- [x] 멀티플레이 garbage cancel / combo / back-to-back / T-Spin attack 규칙 1차 추가
- [x] `npm test`로 roomService, matchService, multiplayerSocket, runtime, move step, snapshot correction 주요 흐름 검증 가능
- [x] `.gitignore`에 `node_modules/`, `.DS_Store`, `coverage/`, `dist/` 제외

### 부분 완료

- [~] `src/client/game/runtime/tetris.js`는 예전의 전역 싱글 파일 단계에서는 벗어남
- [~] `src/client/game/runtime/tetris.js`는 여전히 크고 orchestration 외 책임이 남아 있음
- [~] RNG 주입 구조는 있음
- [~] 기본 RNG는 아직 `Math.random`
- [~] 로비와 멀티 게임 흐름은 연결됐지만 브라우저 2탭 기준 반복 회귀 검증이 필요함
- [~] 멀티 게임은 input relay + server bag + snapshot correction 기반으로 동작하지만 서버 authoritative loop는 아님
- [x] `src/client/pages/tetrisMulti.html`의 `snapshotTimer`에서 bag request와 game over 보고 조건을 함수 단위로 분리했다.

### 아직 미구현

- [ ] 완전한 deterministic multiplayer
- [ ] authoritative server match loop
- [ ] 서버에서 input으로 game state를 계산하는 구조
- [ ] 서버가 생성한 authoritative `game:snapshot` 전송
- [ ] `match:ready` 같은 명시적 준비 상태
- [ ] 방 목록, quick match, match 결과 화면

### 현재 판단

- 현재 구조는 "싱글 런타임 정리 + 멀티 로비 + 멀티 게임 MVP 동기화 + 게임성 규칙 1차 구현" 단계다.
- 실제 멀티 게임은 동작 흐름이 생겼지만, 최종 진실 원천은 아직 서버가 아니라 클라이언트 예측 + snapshot 보정에 가깝다.
- shadow/server authoritative 방향은 유지하지만, main에서는 바로 debug 실험을 키우지 않는다. 먼저 현재 client loop의 책임을 작게 정리한 뒤 shadow로 재진입한다.

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
  - 현재 `snapshotTimer`는 snapshot 전송 후 server bag 부족 확인/request와 game over 보고를 함수 단위로 호출한다.
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
  - `createMatch`, `getMatchState`, `recordInput`, `appendPlayerBagChunk`, `resetMatches`를 제공한다.
  - player별 `inputLog`와 `bagChunks`를 갖지만, 아직 게임 상태를 직접 계산하지는 않는다.
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
- [x] 상대 보드는 현재 `autoStart: true`로 예측 실행하고 snapshot으로 보정
- [ ] 두 브라우저 탭 기준 create/join/start/play/finish/lobby 복귀 수동 회귀 검증
- [ ] 명시적 ready 흐름 도입 여부 결정
- [x] 서버 match 상태 초안
- [x] server bag 전달
- [x] 승패 판정과 match finish broadcast

## Current Phase

### 현재 단계

- 이름: Multiplayer MVP gameplay and sync stabilization before shadow/server authoritative re-entry

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
- [~] garbage cancel / combo / back-to-back / T-Spin attack은 구현됐고, 2탭 기준 안정성 확인이 필요함
- [~] shadow/debug 실험은 별도 브랜치로 분리했고, main에서는 바로 확장하지 않음
- [ ] 실제 authoritative match/game loop 시작 전

### 현재 단계의 핵심 문제

- `src/client/game/runtime/tetris.js`가 아직 크다.
- 현재 snapshot은 보정용으로 적용되지만, 서버 authoritative snapshot은 아직 아니다.
- `game:input`은 서버 검증/전달/inputLog 저장까지 연결됐지만 서버가 입력으로 게임 상태를 계산하지는 않는다.
- 상대 보드는 `autoStart: true`로 로컬 예측 실행 중이므로, 최종 진실 원천은 아직 서버가 아니다.
- deterministic 설계는 방향만 있고, 현재 MVP 구현 기준은 아니다.
- `src/client/pages/tetrisMulti.html`의 `snapshotTimer` 책임은 함수 단위로 1차 분리됐다.
- 다만 network orchestration 책임은 여전히 페이지 진입점에 모여 있어, 2탭 회귀 검증으로 snapshot, bag request, game over 흐름을 확인해야 한다.

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
   - garbage cancel, combo, back-to-back, T-Spin attack이 실제 플레이에서 안정적인지 확인
   - 빠른 이동/회전 연타
   - 블록 안착 직후 다음 블록 조작
   - 상대 보드가 과거 블록으로 되돌아가지 않고 snapshot으로 보정되는지 확인
   - game over, lobby 복귀, 재입장 흐름 확인
2. `src/client/pages/tetrisMulti.html`의 `snapshotTimer` 책임 분리 후 2탭 회귀 확인
   - snapshot 전송
   - server bag 부족 확인/request
   - game over 보고
3. pure logic으로 뺄 후보 정리
   - 당장 전체 runtime을 옮기지 않는다.
   - 서버에서도 쓸 수 있는 후보와 DOM/canvas에 묶인 후보를 구분한다.
   - 우선 후보: gravity tick, input 적용, lock/spawn, line clear, garbage cancel/apply, game over 판정
4. shadow 재진입
   - debug 시스템을 다시 키우는 것이 아니라, 최소 비교 기준으로 서버 계산 실험을 재개한다.
   - 비교 대상은 `tick`, `pieceIndex`, `phase`, `board`, `activePiece`, `pendingGarbage`, score/lines 정도로 제한한다.
5. 서버 authoritative 전환 설계 시작
   - 서버에서 player별 game state를 어디에 둘지 결정
   - 서버에서 `step(state, input)`을 호출할 수 있게 runtime/core 경계 정리
   - 서버가 내려줄 authoritative snapshot 형식 정의

### 권장 구현 순서

- [x] Step 1. 로비 create/join/leave/disconnect 브라우저 검증
- [x] Step 2. `game:input` 최소 이벤트 정의 및 서버 검증/전달
- [x] Step 3. `roomService`와 분리된 match state/service 초안 추가
- [x] Step 4. 서버가 local player용 `server bag` 또는 spawn stream을 관리
- [x] Step 5. 서버 match state에 input log를 저장
- [x] Step 6. local/remote 한 화면에서 상태 차이가 눈에 보이게 만들기
- [ ] Step 7. 멀티 gameplay 회귀 검증: garbage cancel / combo / back-to-back / T-Spin attack
- [x] Step 8. `tetrisMulti.html`의 snapshot timer 책임을 작은 함수로 분리
- [ ] Step 9. 서버가 input으로 game state를 계산할 수 있는 순수 step 후보 정리
- [ ] Step 10. shadow 서버 계산 실험으로 재진입
- [ ] Step 11. 서버 authoritative snapshot 방향으로 전환

### 이후 단계

- [ ] deterministic RNG를 실제로 주입 가능한 구조로 마무리
- [ ] seed 기반 replay 실험
- [ ] authoritative tick과 snapshot 주기 정리
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
    "holdPieceType": "bar",
    "nextQueue": ["square", "zee"],
    "score": 1200,
    "lines": 4,
    "phase": "playing",
    "pieceIndex": 10
  }
}
```

현재 서버 처리:
- room 참가자인지 확인한다.
- `snapshot.board`가 배열인지 최소 검증한다.
- 정상 snapshot은 같은 Socket.IO room의 상대에게 `game:snapshot`으로 전달한다.
- 실패 시 요청자에게 `game:snapshot:result`를 보낸다.

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
- 서버가 직접 생성한 authoritative `game:snapshot`
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
