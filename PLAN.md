# PLAN

- Role: 이 문서는 현재 저장소의 단일 기준 문서다.
- Use: 현재 사실, 구조, 멀티 방향, 다음 액션을 한 곳에서 본다.
- Last update: 2026-07-24 기준. Goal 11E와 Goal 9A~9D는 main/origin에 반영됐고 hosted [Migration CI #30042098224](https://github.com/Sleepingco/Tetris_multi/actions/runs/30042098224)의 Fast/Browser/Docker/PostgreSQL 네 job이 모두 green이다. OCI 단일 VM의 공개 HTTPS·Caddy·same-origin Socket.IO 운영과 PostgreSQL 단일 sink 전환도 완료했다. 기존 JSONL 131건을 멱등 import했고 실제 게임 뒤 195행, app 재시작 뒤에도 195행이 보존됐다. JSONL은 local/test 기본값과 명시적 rollback 원본으로만 유지한다.

## Current Project Status

- 이 문서는 `ROADMAP.md`, `PROTOCOL.md`, `PHASE1_PLAN.md`의 핵심 내용을 현재 코드 기준으로 통합한 문서다.
- 이상적인 장기 계획보다 현재 구현 상태와 바로 다음 작업을 우선한다.
- 사람과 Codex/AI가 같이 참고하는 기준 문서로 사용한다.
- 용어는 아래 기준으로 고정한다.
  - `action`: 플레이어 입력 의미. 예: `move_left`, `rotate`
  - `moveCause`: 엔진 판정 문맥. 예: `fall`, `spawn`, `hardDrop`
  - `tick`: 입력과 진행 순서를 맞추기 위한 시간 단위
  - `snapshot`: 직렬화 가능한 게임 상태 복사본
  - `authoritative`: 최종 진실의 원천. 멀티에서는 서버 기준

### Project Direction

- 핵심 목표는 멀티플레이 가능한 테트리스 구조를 만드는 것이다.
- 현재 우선순위는 새 프레임워크 확장이 아니라 이미 도입한 Vite/React/TypeScript, server authoritative gameplay, 보안·운영 gate를 안정화하는 것이다.
- 방향은 유지한다.
  - 엔진은 최대한 순수하게 유지
  - 런타임은 orchestration 중심
  - 렌더러는 상태 소비자
  - 멀티는 서버 authoritative
- 장기적으로는 deterministic loop를 지향한다.
- 하지만 현재 MVP 멀티는 `seed` 기반 완전 결정론보다 `server bag` 정책이 더 현실적이다.
- LLM 기능은 현재 MVP 범위가 아니다.
- 추후 LLM은 게임 판단이나 AI 의사결정의 원천이 아니라, 플레이 로그와 AI 분석 결과를 사용자에게 설명하는 코칭 리포트 계층으로 둔다.
- 기본 AI 축은 휴리스틱 PVE AI 상대와 placement 로그·평가다.
- PVE AI는 추천 코치가 아니라 실제 게임에 참여하는 AI 상대이며, 사람과 같은 authoritative input 경로를 사용한다.
- V4 placement model은 사용자 선택형 Experimental PVE와 offline imitation 분석에만 사용한다. 기본 production PVE 정책은 heuristic이다.
- Python AI 서버, 강화학습, LLM 코칭은 현재 범위가 아니며, LLM은 분석 결과 설명 계층으로만 검토한다.

### Current Implementation

### 2026-07-23 요약

- 멀티 MVP는 기존 `client snapshot relay` 중심 구조에서 `server authoritative snapshot` 중심 구조로 전환됐다.
- 서버는 player별 `authoritativeState`를 들고 `game:input`과 room ticker gravity step으로 상태를 갱신한다.
- 상대 보드는 `game:authoritative:snapshot`만 full apply한다.
- 내 보드는 client prediction을 우선하고, server snapshot은 제한적으로 적용한다.
- client-driven `game:snapshot`, `game:garbage:attack`, `game:over` gameplay 경로는 제거됐다.
- garbage 원천은 server `authoritativeState.pendingGarbageQueue`다.
- client DTO에는 표시용 `pendingGarbageLines` scalar를 내려준다.
- server gameOver가 match finish의 원천이다.
- match cleanup, client sequence acknowledgment, roomId collision retry가 보강됐다.
- `src/client/game/core/boardMetrics.ts`에 휴리스틱 AI와 향후 ML feature 재사용을 위한 순수 board metric 함수가 구현됐다.
- `test/testBoardMetrics.js`가 board metric 계산과 원본 board mutation 방지를 검증한다.
- PVE room, heuristic AI player, reachable placement planner, placement decision log, dataset/export/evaluation, V4 parity와 Experimental PVE 경로가 구현됐다.
- Vite multi-page, page-local React shell, client/runtime/server TypeScript migration과 production Docker image가 main에 반영됐다.
- 자동 테스트 기준으로 PVP/PVE 핵심 gameplay와 production artifact는 고정돼 있다.
- 포트폴리오 시연 완료 판정은 현재 README와 Goal run 기록의 production/browser gate를 기준으로 본다. 추가 수동 2탭 검증은 release 전 보조 확인이다.

### 구현된 것

- [x] `createTetrisRuntime(...)` 도입
- [x] 기존 Canvas runtime bootstrap은 유지되며 `tetrisSingle.tsx`가 React HUD와 lifecycle을 조율
- [x] 기존 local/remote runtime 연결은 유지되며 `tetrisMulti.tsx`가 React HUD/overlay와 session lifecycle을 조율

### Legacy JavaScript implementation record

- [x] `[Legacy]` `src/client/pages/tetrisSingle.html`의 module script가 싱글 runtime bootstrap, DOM 조회와 keyboard input 연결을 구현했다.
- [x] `[Legacy]` `src/client/pages/tetrisMulti.html`이 local/remote runtime, authoritative snapshot, server bag과 match finish 화면 연결을 구현했다.
- [x] `[Legacy]` `src/client/pages/multiLobby.html`이 방 코드·상태·인원 표시와 create/join/leave UI 연결을 구현했다.
- [x] `[Legacy]` client core는 board 생성·충돌·고정·줄 삭제, move/rotation, T-Spin, combo/back-to-back, garbage 판정을 JavaScript 순수 함수로 구현했다.
- [x] `[Legacy]` client state/runtime은 piece queue·snapshot 직렬화·input queue·gravity·hold·line clear·Canvas render·sound·snapshot correction을 JavaScript 모듈로 구현했다.
- [x] `[Legacy]` browser network와 lobby는 `roomClient`, room/chat UI, `game:input`/bag/snapshot/match finish 흐름을 JavaScript로 구현했다.
- [x] `[Legacy]` server는 room/match/player state, authoritative input·ticker·game-over, session·rate limit, Socket/chat handler와 JSONL repository를 JavaScript로 구현했다.
- [x] `[Legacy]` PVE AI와 분석은 board metrics, placement generation/reachability/simulation/heuristic, placement JSONL·dataset/export/evaluation·JS/Python parity를 JavaScript 경로로 구현했다.
- [x] `[Legacy]` unit/integration/browser 회귀와 production artifact 검증을 구축해 위 gameplay·network·AI 구현을 고정했다.
- 위 작업은 완료된 구현 이력이다. 이후 migration은 동일 책임의 source를 `.ts`/`.tsx`로 옮긴 것이며, HTML은 mount/head 경계로 남기고 화면 lifecycle과 HUD 소유권만 TSX shell로 옮긴 것이다.
- [x] tick-tagged input queue 도입
- [x] `src/client/game/core/board.ts`에 보드 생성, 충돌, 고정, 줄 삭제 순수 함수 존재
- [x] `src/client/game/core/step.ts`에 `resolveMoveAttempt`, `resolveMoveIntent` 존재
- [x] `src/client/game/state/stateSerialization.ts`에 snapshot serialize/deserialize 보조 함수 존재
- [x] `src/client/game/state/pieceQueue.ts`에 7-bag/next queue 유틸리티 존재
- [x] `src/client/game/runtime/snapshotCorrection.ts`에 원격 snapshot 보정 판단 유틸리티 존재
- [x] `src/server/services/roomService.ts`에 room 생성/참가/퇴장/시작/종료/동기화 로직 존재
- [x] `src/server/services/matchService.ts`에 match 생성, player별 server bag chunk와 authoritative state 로직 존재
- [x] `src/server/sockets/multiplayerHandlers.ts`에 `room:create`, `room:join`, `room:leave`, `room:start`, `game:join`, `game:input`, `game:bag:request`, `disconnect` 흐름 존재
- [x] `src/server/sockets/chatHandlers.ts`에 `global:chat`, `room:chat` 흐름 분리
- [x] `src/client/net/roomClient.ts`에 room/chat/game 이벤트 adapter 함수 존재
- [x] 기존 방 UI 연결은 유지되며 `multiLobby.tsx`가 React 화면에 방 코드, 상태, player 수를 반영
- [x] 로비 채팅을 `global:chat` / `room:chat`으로 분리
- [x] 채팅 입력은 1초 1회 서버 rate limit과 plain text 렌더링 기준 적용
- [x] `game:input` 배관: 클라이언트 입력을 서버 검증 후 authoritative state에 적용하고 ack/snapshot 전송
- [x] `game:snapshot` 1차 배관 추가: 클라이언트 snapshot을 서버 검증 후 상대에게 전달했던 초기 단계 완료. 현재 gameplay 경로에서는 제거된 legacy 흐름이다.
- [x] `game:bag:request` / `game:bag:append` 1차 배관 추가: 서버가 player별 bag chunk를 생성해 room에 전달
- [x] `match:finish` 배관: server authoritative top-out 기준 승패 결과 broadcast. client `game:over` handler는 제거됐다.
- [x] 멀티플레이 garbage cancel / combo / back-to-back / T-Spin attack 규칙 1차 추가
- [x] `src/client/game/core/tSpin.ts`에 T-Spin lock 판정 pure function 추가
- [x] `src/client/game/core/attackState.ts`에 combo/back-to-back 상태 전이 pure function 추가
- [x] `src/client/game/core/garbage.ts`에 garbage cancel/apply/attack 계산 pure function 정리
- [x] 상대 보드 score/lines drift를 snapshot correction에서 보정하도록 수정
- [x] runtime 통합 테스트로 T-Spin, back-to-back, combo, 일반 line clear의 B2B reset이 `placementResult`에 반영되는지 검증
- [x] `npm test`로 roomService, matchService, multiplayerSocket, runtime, move step, snapshot correction 주요 흐름 검증 가능
- [x] `.gitignore`에 `node_modules/`, `.DS_Store`, `coverage/`, `dist/` 제외
- [x] server authoritative player state 초기화
- [x] `applyAuthoritativeInput()` 단일 public entry로 `move_left`, `move_right`, `soft_drop`, `rotate`, `hard_drop`, `hold` 처리
- [x] server lock 경로에서 line clear, score, combo, B2B, T-Spin, garbage cancel/apply, top-out 처리
- [x] `authoritativeTickerService`로 room별 gravity tick과 authoritative snapshot emit 처리
- [x] `game:authoritative:snapshot` 추가
- [x] 상대 보드는 authoritative snapshot만 적용하도록 변경
- [x] 내 보드는 prediction 우선, `gameOver` 또는 garbage 적용 snapshot만 제한적으로 full apply
- [x] client-driven `game:snapshot`, `game:garbage:attack`, `game:over` gameplay 경로 제거
- [x] `pendingGarbageLines` DTO로 incoming garbage 표시와 적용 correction 분리
- [x] server authoritative match finish 공통 helper 추가
- [x] 정상 gameOver와 `game:leave`에서 match cleanup 수행
- [x] roomId 충돌 재시도와 client sequence acknowledgment 추가
- [x] `src/client/game/core/boardMetrics.ts`에 `columnHeights`, `aggregateHeight`, `maxHeight`, `holes`, `bumpiness`, `completeLines` 계산 순수 함수 추가
- [x] `test/testBoardMetrics.js`로 board metric과 mutation 방지 검증
- [x] `placementGenerator`, `reachablePlacementPlanner`, `simulatePlacement`, `heuristicEvaluator` 기반 휴리스틱 PVE decision path 구현
- [x] `pveAiPlayerService`가 AI plan을 사람과 같은 authoritative input으로 실행
- [x] placement decision JSONL log, dataset exporter/evaluator, JS/Python parity 검증 경로 구현
- [x] 사용자 선택형 Experimental PVE V4 model 경로와 heuristic fallback 구현
- [x] Vite multi-page + page-local React shell + TypeScript client/runtime/server migration 반영
- [x] CSP/security headers, dependency hardening, production Docker image 반영

### 부분 완료

- [~] `src/client/game/runtime/tetris.ts`는 예전의 전역 싱글 파일 단계에서는 벗어남
- [~] `src/client/game/runtime/tetris.ts`는 여전히 크고 orchestration 외 책임이 남아 있음
- [~] RNG 주입 구조는 있음
- [~] 기본 RNG는 아직 `Math.random`
- [~] 로비와 멀티 게임 흐름은 자동 브라우저 회귀로 고정돼 있다. 공개 OCI 환경의 HTTPS와 same-origin Socket.IO smoke는 통과했으며 실제 두 브라우저 gameplay와 장시간 운영 smoke는 별도 확인 대상이다.
- [x] 내 보드 prediction/correction 정책은 sequence/ack·gravity timing 보강 후 rollback 전용 2탭 E2E 반복 검증을 통과함
- [x] `startMultiplayerGame()`이 bag request, authoritative snapshot과 match finish를 session 경계에서 처리한다.
- [x] `src/client/game/runtime/tetris.ts`에서 T-Spin 판정과 공격 상태 전이 일부를 core pure function 호출로 분리했다.
- [~] `placementResult.backToBack`은 현재 “이번 lock 이후 상태”가 아니라 “이번 공격 계산에 사용된 이전 B2B 상태”에 가깝다. 추후 필요하면 `backToBackBefore` / `backToBackAfter`처럼 의미를 명확히 나누는 정리를 검토한다.

### 아직 미구현

- [ ] 완전한 deterministic multiplayer
- [ ] 서버/클라이언트 완전 동일 deterministic replay
- [x] 상대 보드 line clear `presentationEffect` 처리
- [ ] `match:ready` 같은 명시적 준비 상태
- [ ] 방 목록, quick match, match 결과 화면

### 현재 판단

- 현재 구조는 "싱글 런타임 정리 + 멀티 로비 + server authoritative 멀티 MVP" 단계다.
- 실제 멀티 게임의 최종 진실 원천은 server authoritative state로 이동했다.
- 내 보드는 조작감을 위해 client prediction을 유지하고, 서버 snapshot은 gameOver/garbage 적용 등 제한된 상황에서만 full apply한다.
- shadow/debug 방향은 현재 main 우선순위가 아니다. 해결된 rollback 경로는 기존 회귀 테스트로 감시하고, 재현 증거 없이 debug 시스템이나 correction 방어를 추가하지 않는다.
- AI 쪽은 휴리스틱 PVE와 Experimental V4 체험까지 구현됐다. 새 AI 작업은 기본 PVE 정책 변경이 아니라 별도 승인된 실험·평가 질문에서 시작한다.
- 현재 `boardMetrics`는 core board 표현을 그대로 읽는 DOM-free 순수 함수라서 `src/client/game/core`에 둔다. 서버/클라이언트/AI가 더 넓게 공유하는 시점이 오면 `shared` 계층으로 이동할 수 있다.

### 2026-07-19 멀티 안정화 상태

#### P0: 간헐적 own board rollback — 해결, 회귀 감시

- 기존 증상:
  - 사용자가 조각을 lock 직전 위치까지 이동하거나 회전했을 때 own authoritative correction이 적용되며 직전 위치로 되돌아가는 현상이 간헐적으로 관찰됐다.
- 해결 판정:
  - 2026-07-16 gravity lock timing 정렬과 rollback E2E 강화 이후 알려진 재현 경로에서 rollback이 다시 관찰되지 않았다.
  - 현재 관찰·자동 회귀 기준으로 P0는 해결된 것으로 본다.
- 적용된 방어:
  - client input마다 단조 증가하는 `clientSequence`를 전송한다.
  - server player metadata의 `lastProcessedClientSequence`로 처리 완료 경계를 관리한다.
  - server acknowledgment 전 input이 있으면 own snapshot full correction을 보류한다.
  - 최신 acknowledgment보다 오래된 deferred snapshot은 폐기한다.
  - 같은 player의 input과 gravity mutation을 FIFO로 직렬 처리한다.
  - 중복·역순 sequence는 authoritative state 적용 전에 거부한다.
  - `PIECE_INDEX_MISMATCH`와 authoritative 내부 예외도 terminal result로 acknowledgment한다.
- 검증 근거:
  - 2026-07-19 관련 unit/integration 테스트 172개가 통과했다.
  - `e2e/multiplayerRollback.spec.js`를 5회 반복해 5/5 통과했다.
  - E2E는 Host/Guest 양방향 빠른 좌우 이동·회전·soft drop 1회·hard drop과 lock 이후 양쪽 board 수렴을 확인한다.
- 남은 회귀 위험:
  - key repeat 기반 soft drop 유지와 자연 lock 경계
  - 인위적인 latency/jitter와 pending input 중 reconnect
  - garbage·line clear·gameOver와 lock timing이 겹치는 조합
  - 위 항목은 현재 재현된 버그가 아니라 rollback E2E에서 직접 다루지 않은 조합이다. 재현 전에는 correction 조건이나 lock delay를 추가로 변경하지 않는다.
- 이 문제는 전체 rollback netcode 구현과 다르다. 현재 해결 범위는 stale authoritative snapshot이 정상적인 local prediction을 되감던 알려진 경로다.

#### P2: 입력별 full snapshot 전송 최적화

- 현재 구조는 authoritative input이 성공할 때마다 room에 full snapshot을 보내므로 소수 사용자 MVP에는 충분하지만 동시 room이 많아지면 board 복사, JSON 직렬화, 네트워크 전송 비용이 커질 수 있다.
- rollback 안정화 gate는 통과했다. 이 최적화는 동시 room 부하가 실제 병목으로 확인되거나 명시적으로 우선순위가 정해질 때 별도 작업으로 진행한다.
- 목표 전송 정책:
  - 매 input: sender에게 작은 `game:input:result` acknowledgment만 전송한다.
  - 일반 이동 상태: player별 최신 snapshot을 모아 약 100ms 주기로 trailing coalescing한다.
  - lock, line clear presentation, garbage 적용, gameOver: 즉시 full snapshot을 전송한다.
  - `PIECE_INDEX_MISMATCH`, `AUTHORITATIVE_INPUT_FAILED`, game join/reconnect: 즉시 correction snapshot을 전송한다.
  - 상대 client가 소비하지 않던 `game:input` relay는 제거됐다.
- 구현 시 지켜야 할 조건:
  - coalescing 구간의 마지막 authoritative state를 반드시 전송한다.
  - `presentationEffect` 같은 일회성 결과를 일반 snapshot 병합 과정에서 잃지 않는다.
  - own board는 local prediction으로 즉시 반응하고, 상대 보드는 주기적 authoritative snapshot으로 갱신한다.
  - rapid input 5개가 100ms 안에 들어오면 acknowledgment는 5개, 일반 movement snapshot은 최대 1개가 되는지 테스트한다.
  - lock/garbage/gameOver snapshot은 주기적 flush를 기다리지 않는지 테스트한다.

### 코드베이스 정리 실행 계획

- 상세 계획: `docs/maintenance/codebase-cleanup-plan.md`
- Goal 실행 프롬프트: `docs/maintenance/codebase-cleanup-goal-prompt.md`
- 상태: Phase 0~5 완료, 최종 검증 통과
- 순서: 확정된 dead leaf 삭제 → client local garbage 제거 → 미사용 input relay 제거 → 조건부 server inputLog 제거 → 남은 test setup 축소
- cleanup은 migration이나 새 기능과 섞지 않고, 각 단계를 독립 검증·커밋한다.

## Current Architecture and Responsibility Boundaries

### Page bootstrap

- HTML은 head, theme pre-paint, stylesheet와 React mount point만 유지한다.
- `src/client/pages/tetrisSingle.tsx`는 React HUD와 Canvas runtime mount, input lifecycle을 조율한다.
- `src/client/pages/tetrisMulti.tsx`는 공개 room/session 정보와 React HUD/overlay를 소유하고 `startMultiplayerGame(...)`을 연결한다.
- `src/client/game/entry/multiplayerGameSession.ts`는 local/opponent runtime, authoritative snapshot, server bag, placement log와 cleanup을 조율한다.
- `src/client/pages/multiLobby.tsx`는 room create/join/leave UI와 Socket.IO room 상태를 React 화면에 반영한다.

### Runtime layer

- `src/client/game/runtime/tetris.ts`
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
    - `appendServerBag`
    - `getServerBagRemainingCount`
    - `hideGameOver`
    - `showGameOver`
    - `runtime`

### Core engine layer

- `src/client/game/core/board.ts`
  - `createEmptyBoard`
  - `canPlacePiece`
  - `lockPieceOnBoard`
  - `clearFilledLines`
- `src/client/game/core/step.ts`
  - `resolveMoveAttempt`
  - `resolveMoveIntent`
- `src/client/game/core/tSpin.ts`
  - `isTSpinLock`
- `src/client/game/core/attackState.ts`
  - `resolveAttackState`
- `src/client/game/core/garbage.ts`
  - `calculateGarbageAttack`
  - `resolveGarbageCancel`
  - `applyGarbageLines`
- 현재 core는 순수 함수 중심으로 유지되고 있다.
- 이 방향은 맞다.

### State and snapshot layer

- `src/client/game/state/stateSerialization.ts`
  - `serializeGameState`
  - `deserializeGameState`
- `src/client/game/state/pieceQueue.ts`
  - `pickRandomPiece`
  - `ensureQueueFilled`
  - `takeNextFromQueue`
- `src/client/game/runtime/snapshotCorrection.ts`
  - `isSamePiece`
  - `shouldCorrectSnapshot`
- `shouldCorrectSnapshot`은 own authoritative snapshot correction 기준을 판정한다.
- 현재 멀티 gameplay의 주 snapshot은 서버가 만든 `game:authoritative:snapshot`이다.
- 상대 보드는 authoritative snapshot을 full apply한다.
- 내 보드는 prediction 우선 정책을 유지하며, 다음 경우에만 full apply한다.
  - `snapshot.phase === "gameOver"`
  - local phase가 `lineClearing`이 아니고, `pendingGarbageLines`가 감소했으며, server board가 local board와 다른 경우

### Server and room layer

- `src/app.ts`
  - TypeScript source 진입점이며 production은 compiled `dist/server/app.js`를 실행한다.
  - `src/server/init.ts`를 source `.js` specifier로 로드하며 NodeNext build가 compiled `init.js`를 만든다.
- `src/server/init.ts`
  - Express static server, HTTP server, Socket.IO server를 조립한다.
  - production static root는 `dist/client`다.
- `src/server/services/roomService.ts`
  - `Map` 기반 메모리 room 상태를 관리한다.
  - `createRoom`, `joinRoom`, `removePlayer`, `leaveRoom`, `startGame`, `leaveGame`, `syncRoom`, `finishGame`, `getRoomState`를 제공한다.
- `src/server/services/matchService.ts`
  - `Map` 기반 메모리 match 상태를 관리한다.
  - `createMatch`, `getMatchState`, `deleteMatch`, `appendPlayerBagChunk`, `getAuthoritativePlayerSnapshotDto`, `resetMatches`를 제공한다.
  - player별 `lastProcessedClientSequence`, `bagChunks`, `authoritativeState`를 갖는다.
- `src/server/services/authoritativeTickerService.ts`
  - room별 authoritative gravity ticker lifecycle을 관리한다.
  - 100ms interval에서 500ms 누적 기준으로 gravity step과 snapshot emit을 처리한다.
- `src/server/services/authoritativeMatchFinish.ts`
  - input 경로와 ticker 경로의 authoritative gameOver side effect를 공통 처리한다.
  - ticker stop, `match:finish`, `deleteMatch`, `game_over` log 저장을 한 곳에서 관리한다.
- `src/server/sockets/multiplayerHandlers.ts`
  - room/game Socket.IO 이벤트 입구다.
  - `room:create`, `room:join`, `room:leave`, `room:sync`, `room:start`, `game:*`, `disconnect`를 등록한다.
  - room 단위 join/broadcast를 수행한다.
- `src/server/sockets/chatHandlers.ts`
  - chat Socket.IO 이벤트 입구다.
  - `global:chat`, `room:chat`, `chat:result` 흐름을 담당한다.
  - 채팅 입력 검증, 1초 rate limit, room 채팅 권한 확인을 담당한다.

### Client network layer

- `src/client/net/roomClient.ts`
  - 브라우저 Socket.IO room adapter다.
  - create/join/leave/start 요청, room result/update/message 구독, global/room chat 송수신, game join/input/bag/authoritative snapshot/finish 함수를 제공한다.
  - 제거된 legacy gameplay source `game:snapshot`, `game:garbage:attack`, `game:over` 경로는 제공하지 않는다.

### 현재 구조에 대한 짧은 평가

- 구조는 이전보다 훨씬 좋아졌다.
- 특히 page bootstrap 분리와 runtime factory 도입은 큰 진전이다.
- 다만 `src/client/game/runtime/tetris.ts`는 아직 다음 책임이 남아 있다.
  - line clear sequencing
  - piece lifecycle 세부 흐름
  - 일부 state helper
  - runtime loop 세부 구현

## Gameplay, PVP, PVE, AI, and Logs

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
- 현재 멀티 gameplay의 기준 snapshot은 서버가 만든 `game:authoritative:snapshot`이다.
- 클라이언트가 만든 `game:snapshot` relay는 gameplay 경로에서 제거됐다.
- 상대 보드는 authoritative snapshot을 full apply한다.
- 내 보드는 client prediction을 우선한다.
- 내 playerId snapshot 처리 정책:
  - `pendingGarbageLines`는 표시용으로 갱신한다.
  - `phase: "gameOver"` snapshot은 full apply한다.
  - `pendingGarbageLines`가 감소했고 board가 달라진 snapshot은 server garbage가 실제 board에 적용된 결과로 보고 full apply한다.
  - local phase가 `lineClearing`이면 gameOver가 아닌 full apply는 막는다.
  - 단순 `pieceIndex` ahead만으로는 full apply하지 않는다.
- snapshot DTO에는 `pendingGarbageQueue`를 직접 노출하지 않는다.
- 표시용 scalar인 `pendingGarbageLines`만 포함한다.

### placementResult 의미

- `placementResult`는 조각 lock 1회에 대한 결과 기록이다.
- 현재는 runtime의 placement decision log 안에 포함되며, 다음 정보를 함께 담는다.
  - score 변화
  - line clear 결과
  - T-Spin, combo, back-to-back 기반 attack 계산 결과
  - pending garbage cancel/apply 결과
  - game over 여부
- 이 값은 AI 분석, replay 검증, 서버 authoritative 전환 시 client/server 결과 비교 후보 데이터다.

#### 주요 필드

- `linesCleared`
  - 이번 lock 이후 실제로 삭제된 줄 수.
- `scoreBefore`
  - 이번 lock 결과를 반영하기 전 점수.
- `scoreAfter`
  - 이번 lock 결과를 반영한 뒤 점수.
- `scoreDelta`
  - `scoreAfter - scoreBefore`.
  - 점수 drift 확인과 서버 검증에 사용하기 좋다.
- `isTSpin`
  - 이번 lock이 T-Spin으로 판정됐는지 여부.
- `combo`
  - 이번 attack 계산에 사용된 combo 값.
  - 저장될 다음 combo 상태와 같은 의미로 단정하지 않는다.
- `backToBack`
  - 현재 의미는 "이번 lock 이후의 B2B 상태"가 아니다.
  - 현재 의미는 "이번 공격 계산에 사용된 이전 B2B 상태"에 가깝다.
  - 예를 들어 Tetris 다음 일반 Double clear가 발생하면, 그 Double clear는 B2B를 끊는 역할을 하지만 해당 clear의 `placementResult.backToBack`만 보면 true일 수 있다.
  - 현재 테스트에서는 B2B reset을 "일반 line clear 직후 값"만으로 판단하지 않고, 다음 eligible clear에 B2B bonus가 붙지 않는지로 검증한다.
- `rawAttackLines`
  - combo/back-to-back/T-Spin 규칙을 반영한 원 공격량.
  - pending garbage cancel을 적용하기 전 값이다.
- `attackLines`
  - pending garbage cancel 후 실제 상대에게 보낼 공격량.
- `incomingGarbageLines`
  - 이번 lock 시점에 대기 중이던 incoming garbage 총량.
- `canceledGarbageLines`
  - 이번 공격으로 상쇄한 incoming garbage 줄 수.
- `appliedGarbageLines`
  - cancel 후 남아서 실제 보드에 적용된 pending garbage 줄 수.
- `gameOver`
  - 이번 lock 처리 결과로 game over가 발생했는지 여부.
  - top out뿐 아니라 garbage apply overflow도 포함될 수 있다.

#### 추후 정리 후보

- 서버 authoritative 전환 전에 필요하면 `backToBack` 의미를 더 명확한 필드로 나눌 수 있다.
  - `backToBackBefore`
  - `backToBackAfter`
  - `usedBackToBack`
- 이번 단계에서는 새 필드를 추가하지 않는다.
- 지금은 기존 runtime/log 의미를 문서화하고, 테스트 작성 시 혼동을 줄이는 것을 우선한다.

#### server authoritative 연결

- 서버가 나중에 placement 결과를 직접 계산하려면 `placementResult` 필드 의미가 client와 server에서 같아야 한다.
- 특히 다음 필드는 서버 garbage 판정 후보가 된다.
  - `rawAttackLines`
  - `attackLines`
  - `canceledGarbageLines`
  - `appliedGarbageLines`
- `scoreBefore`, `scoreAfter`, `scoreDelta`는 client 예측 점수와 서버 계산 점수의 drift를 확인하는 데 필요하다.
- `linesCleared`, `isTSpin`, `combo`, `backToBack`은 attack 계산의 입력/중간 상태 검증에 필요하다.

### 현재 멀티 진행 상태

- [x] 로비에서 `room:create` 요청 가능
- [x] 로비에서 생성된 roomId, 상태, player 수 표시 가능
- [x] 로비에서 `room:join` 요청 가능
- [x] 로비에서 `room:leave` 요청 가능
- [x] 서버에서 `disconnect` 발생 시 room player 제거 가능
- [x] Socket.IO room 단위 `room:updated`, `room:message` broadcast 가능
- [x] 멀티 게임 페이지에서 local/remote runtime 연결
- [x] local 입력을 `game:input`으로 서버에 전송하고, 서버가 room/player/action 검증 후 authoritative state에 적용
- [x] server authoritative snapshot 수신 후 상대 runtime full apply
- [x] `server bag`을 match/player별로 생성하고 클라이언트 runtime에 공급
- [x] `pieceIndex`를 snapshot/input에 포함하고, 오래된 입력이 현재 조각에 적용되지 않도록 제한
- [x] 같은 tick/pieceIndex에 과도한 입력이 쌓이지 않도록 runtime input queue에서 제한
- [x] 상대 보드는 `autoStart: false`로 두고 server authoritative snapshot으로만 갱신
- [x] 내 보드는 prediction 우선, pending garbage/gameOver/garbage apply snapshot만 제한적으로 correction
- [ ] 두 브라우저 탭 기준 create/join/start/play/finish/lobby 복귀 수동 회귀 검증
- [ ] 명시적 ready 흐름 도입 여부 결정
- [x] 서버 match 상태 초안
- [x] server bag 전달
- [x] 승패 판정과 match finish broadcast

## Authentication, Socket, and Security

- 인증은 client `playerId`나 `socketId`가 아니라 opaque session token과 서버가 보관한 session identity로 처리한다. token은 SHA-256 digest만 server memory에 남기며, active socket과 generation이 현재 session과 일치할 때만 mutation을 허용한다.
- `playerId`는 서버가 session에서 파생하는 공개 식별자이고, client payload의 `playerId`와 nickname은 권한 근거가 아니다. `socketId`는 연결 주소일 뿐 신원이나 room 권한의 원천이 아니다.
- 최신 Socket payload와 타입 계약은 `src/shared/socketContracts.mjs`, `src/shared/socketContractTypes.d.ts`를 단일 기준으로 둔다. 이 문서는 이벤트 이름과 소유권만 요약하며 payload 예시는 중복 유지하지 않는다.
- 핵심 흐름은 `room:create`/`join`/`leave`/`sync`/`start`, `game:join`/`input`/`bag:request`/`leave`, 그리고 server-to-client 결과·snapshot·finish다. legacy client-driven `game:snapshot`과 `game:over` handler는 없다.
- `game:authoritative:snapshot`의 optional `presentationEffect`는 구현 완료 상태다. line clear 효과는 runtime에서 중복 없이 소비하며 gameplay state의 원천은 계속 server authoritative snapshot이다.
- Zod schema, active-session 확인, rate limit, origin allowlist와 CSP를 server 경계에 적용한다. 채팅은 plain text/JSX text로 렌더링한다.

## Docker, CI, and Verification

### 현재 상태

- 이름: Goal 9D main 통합, OCI 단일 VM 공개 배포와 PostgreSQL single-sink 운영 완료. 안전 배포 자동화와 무중단 배포는 후속 계획

### 진행 현황

- [x] server authoritative PVP/PVE gameplay MVP 구현
- [x] own-board rollback 주요 재현 경로 E2E 회귀 고정
- [x] 휴리스틱 PVE AI와 authoritative input executor 구현
- [x] placement decision log, dataset/export/evaluation, JS/Python parity 경로 구현
- [x] 사용자 선택형 Experimental PVE V4 경로와 fallback 구현
- [x] Vite multi-page, React page shell, TypeScript client/runtime/server 전환
- [x] CSP/security headers와 dependency hardening 반영
- [x] production Docker image와 graceful shutdown 반영
- [x] Goal 11D workflow는 PR #1과 PR clean run을 거쳐 `main`에 반영됐으며, 이후 발견된 PVE timing 경계는 Goal 11E에서 별도로 안정화했다.
- [x] Goal 11E는 main과 origin/main에 반영됐다. timing-dependent PVE T-Spin E2E를 제거하고 pending-garbage authoritative/UI 일관성 검증을 유지했으며 hosted Fast/Docker와 동일 코드 Browser 연속 2회가 통과했다.
- [x] Goal 9A는 raw SQL migration, canonical identity와 parameterized PostgreSQL repository를 실제 PostgreSQL 17.10으로 검증한 뒤 main과 origin/main에 반영됐다. hosted [Migration CI #29994429680](https://github.com/Sleepingco/Tetris_multi/actions/runs/29994429680)의 Fast/Docker/Browser도 모두 green이다.
- [x] Goal 9A review에서 injective canonical serialization, PostgreSQL-safe text·64-byte identity와 whitespace-only SQL 거부, finite timestamp, strict loopback·ambient `PG*` 차단, explicit URL password와 migration bootstrap owner 검증을 고정했다. 최종 gate는 실제 PostgreSQL 6/6, Node 616 pass·기존 1 skip, artifact/release 각 1/1이며 production E2E는 같은 gameplay/client의 선행 36/36을 유지한다.
- [x] Goal 9B는 `GAME_EVENT_STORAGE=jsonl|postgres` single-sink, lifecycle schema v2, server UUID game identity와 1회용 authoritative human receipt, privacy allowlist projector, pool 4/in-flight 16, 3회·2.7초 retry와 3초 drain/8초 shutdown을 main에 통합했다. receipt replay와 retry 최악 경로 budget review 수정도 반영했으며, PR와 main의 Fast gate, Chromium PVP and PVE, Production container smoke가 모두 green이었다. 통합 시점에는 JSONL이 기본 sink였고 이후 OCI 운영 전환에서 PostgreSQL mode를 활성화했다.
- [x] Goal 9C는 Node stream/readline importer, dry-run, canonical projection·privacy·identity 재사용, 멱등 재실행, partial failure 복구와 completeness reason report를 구현해 main/origin에 반영했다. 통합 시점에는 synthetic fixture와 승인된 local JSONL copy만 PostgreSQL 17.10 test DB에서 검증했고, 이후 OCI 운영 전환에서 실제 JSONL import와 재실행 멱등성을 확인했다.
- [x] Goal 9D는 기존 세 hosted job을 보존한 채 실제 PostgreSQL 17.10 storage job, 외부 PostgreSQL과 source-less image의 production-like gate, synthetic backup/restore·retention rehearsal과 provider-neutral 운영 runbook을 구현했다. shutdown 결과를 안전 코드로 구분한 최종 `6775bfb`가 main/origin에 반영됐고 hosted 네 job이 모두 green이다.
- [x] OCI `VM.Standard.E2.1.Micro`에 Docker Compose와 Caddy 기반 구성을 배포했다. 공개 주소의 HTTP/2 `200`, 유효한 TLS, CSP/security headers와 same-origin Socket.IO handshake를 확인했다.
- [x] PostgreSQL 17.10을 internal Docker network와 TLS `verify-full`로 운영하고 JSONL 131건을 최초 inserted·재실행 duplicate로 검증했다. 실제 gameplay로 195행까지 증가했고 app 재시작 후에도 행 수가 보존됐으며 storage error는 없었다.
- [~] 현재 배포는 단일 VM·단일 app instance의 수동 운영이다. immutable image 배포 자동화, readiness 기반 traffic 전환, active room drain과 host 장애 대응은 아직 구현하지 않았다.

### 알려진 위험과 보류 범위

- `src/client/game/runtime/tetris.ts`는 여전히 크다. 다만 현재 병목은 기능 부재가 아니라 장기 유지보수 비용이다.
- room, match, session, limiter는 단일 Node process memory에 있다. 다중 instance나 restart persistence는 아직 목표가 아니다.
- JSONL은 local 분석과 rollback 원본으로 보존한다. production은 PostgreSQL 단일 sink로 전환했고 기존 JSONL import, 실제 gameplay write와 app restart 보존까지 확인했다. 자동 backup, 90일 retention과 용량 경고는 아직 운영 자동화하지 않았다.
- Experimental V4는 Human placement imitation 관찰용이다. 기본 PVE를 대체하거나 더 강한 gameplay AI라고 주장하지 않는다.
- pending garbage E2E는 적용 전후 authoritative sequence·piece index·board 변화와 같은 snapshot 경계의 UI 숫자·danger class 일치를 검증한다. lock 뒤 새 AI attack으로 pending이 다시 증가하는 정상 동작은 허용한다.
- T-Spin 판정은 `test/testTSpin.js`, authoritative placement scalar는 `test/testPlayerGameplayStep.js`, runtime placement log/attack 결과는 `test/testTetrisRuntime.js`의 결정론적 테스트가 담당한다. 자연 중력과 browser scheduling에 의존하는 PVE 7-bag T-Spin E2E는 gate에서 제거했다.
- Goal 11E의 hosted Fast/Docker와 Browser 연속 2회가 성공했다. 자연 중력과 browser scheduling에 의존하던 PVE 7-bag T-Spin E2E는 제거했고, T-Spin은 core·authoritative·runtime 결정론적 테스트로 보장한다. 후속 main에서도 hosted Fast/Docker/Browser가 모두 성공했다.
- WebKit/Firefox, TLS 인증서 자동 갱신·VM reboot 복구, 장시간 soak와 amd64 Docker run은 아직 별도 검증 대상이다. 외부 HTTPS/Caddy reverse proxy와 same-origin Socket.IO 기본 경로는 실제 공개 주소에서 확인했다.

### 현재 단계에서 하지 않을 것

- SPA 전환
- 문서 branch에서 PostgreSQL code/dependency/CI를 선행 구현
- PostgreSQL과 JSONL dual-write 또는 silent fallback
- Redis/Socket.IO adapter와 multi-instance 운영
- rollback netcode
- V4를 기본 PVE 또는 production gameplay AI로 승격
- 충분한 메모리·공유 상태·drain 계약 없이 blue-green/rolling 배포를 무중단이라고 주장하는 것

## Performance, Reliability, and Deployment Improvement Plan

### 조사 결론

현재 소수 room 환경에서 병목으로 입증된 항목은 없다. 성능 코드를 먼저
변경하지 않고 계측과 재현 가능한 부하 결과를 우선한다.

| 항목 | 현재 판정 | 다음 결정 |
| --- | --- | --- |
| 입력별 full snapshot | 실재하는 전송 증폭이며 첫 성능 최적화 후보 | 동시 room 부하에서 bytes·ack 지연이 증가할 때 coalescing |
| authoritative ticker | 실제 경과 시간 유실 가능성이 있는 정확성 문제 | 성능 최적화와 분리해 우선 수정 후보 |
| runtime placement 로그 | 장시간 세션에서 메모리·재탐색 증가 위험 | 출력 parity를 고정한 뒤 piece 단위로 bounded 처리 |
| PVE AI | 단일 decision은 현재 충분히 빠름 | 많은 PVE room에서 event-loop 지연이 확인될 때만 재검토 |
| PostgreSQL·React | 현재 병목 근거 없음 | 운영 측정 전 최적화하지 않음 |
| Canvas·로비 메시지 | 잠재 비용 | 실제 frame·메모리 문제를 재현한 경우에만 변경 |

현재 측정에서 일반 snapshot은 약 `1,533~1,992B`, line-clear effect 포함
snapshot은 약 `2,726~3,644B`다. PVP 지속 입력 가정의 전송량은 방당 약
`0.37~0.48MB/s`이며 Zod snapshot 검증 p50은 약 `10µs`다. 전송량 증폭은
사실이지만 board 복사와 Zod 자체는 아직 병목으로 측정되지 않았다.

PVE heuristic decision은 후보 `34~38개`에서 p50 `0.67~0.79ms`,
p95 `0.90~1.32ms`, p99 `1.37~1.97ms`였다. 동일한 `metricsBefore` 계산을
후보 밖으로 옮겨 얻을 예상 절감은 decision당 약 `0.03ms`이므로 현재는
worker pool이나 추가 abstraction을 만들지 않는다.

### 1. 부하 측정 gate

1. production 사용자 traffic이 아닌 격리 환경에서 동일한 fixture·시간·입력률로
   `1`, `10`, `50`개 room을 각각 3회 이상 실행한다. `50` room은 수용량
   약속이 아니라 stress 관찰값이다.
2. room별 `snapshot count/bytes`, input acknowledgment p50/p95/p99,
   event-loop delay, wall-clock 대비 tick drift, CPU, RSS, network와
   runtime log 길이를 함께 기록한다.
3. 먼저 1-room 기준선과 증가 기울기를 문서화하고 목표치를 정한다. 목표치를
   넘는 항목만 별도 branch에서 수정하며 최적화 전후 같은 fixture를 비교한다.

### 2. Ticker 시간 정확성

- production ticker는 고정 `tickMs`가 아니라 monotonic clock의 실제 경과
  시간을 누적해야 한다.
- async callback이 겹친 동안의 시간도 버리지 않고 다음 처리에 넘긴다.
- 이미 구현된 accumulator 잔여 시간 보존은 유지하고, 한 callback의 catch-up
  step 수에는 상한을 둬 event loop 독점을 막는다.
- injected clock으로 지연, overlap, 잔여 delta, catch-up 상한과 mutation
  중복 없음을 결정론적으로 검증한다.

이 항목은 현재 사용자 장애로 확인된 것은 아니지만 부하 시 gameplay 시간이
느려질 수 있는 정확성 문제이므로 snapshot 최적화보다 먼저 별도 버그 수정
후보로 다룬다.

### 3. Runtime placement 로그 상한

- 현재 누적 `inputLog` 재필터링은 장시간 세션에서
  `O(placements × accumulated inputs)` 비용으로 커질 수 있다.
- 외부 placement log의 schema·순서·canonical hash는 유지하면서 per-piece
  input buffer 또는 처리 cursor로 완료된 입력을 다시 탐색하지 않게 한다.
- recorder로 전달을 마친 board/input은 필요한 분석 계약만 남기고 runtime
  메모리 보관 범위를 제한한다.
- 기존 placement fixture의 byte/hash parity와 장시간 placement soak의
  heap/RSS가 bounded인지 검증한 뒤 적용한다.

### 4. Snapshot coalescing 조건

- 기존 `P2: 입력별 full snapshot 전송 최적화`의 계약을 재사용한다.
- 매 input acknowledgment는 유지하고 일반 movement snapshot만 약 `100ms`
  trailing coalescing한다.
- lock, line clear presentation, garbage 적용, gameOver, reconnect와 correction
  snapshot은 즉시 전송한다.
- 마지막 authoritative state와 일회성 `presentationEffect`가 유실되지 않는
  회귀 테스트가 선행돼야 한다.
- 구현 gate는 부하 측정에서 snapshot bytes, acknowledgment latency 또는
  event-loop delay가 실제 목표치를 넘은 경우로 제한한다.

### 5. 현재 하지 않을 최적화

- AI worker pool 또는 AI service 분리
- React memoization 확대와 Context/state manager 추가
- Canvas 부분 redraw
- PostgreSQL canonical hash·retention query micro-optimization
- 로비 메시지 pagination/상한

위 항목은 profiler나 재현 가능한 장애가 생길 때 다시 판단한다.

### 6. 배포 안정화와 무중단 배포 경계

현재 OCI VM은 RAM 약 `954MiB`이고 app `320MiB`, PostgreSQL `256MiB`,
Caddy `96MiB` 제한을 사용한다. app 두 개를 동시에 두면 limit 합계만
`992MiB`가 되어 OS 메모리도 남지 않는다. room, match와 session도 단일
Node process memory에 있으므로 현재 구조의 container 교체는 진행 중인
Socket.IO 경기를 보존하지 못한다. 따라서 지금 상태를 진정한 무중단 배포라고
부르지 않는다.

첫 운영 관찰값은 app 약 `30.94MiB`, PostgreSQL 약 `55.64MiB`, Caddy 약
`15.77MiB`, VM available memory 약 `434MiB`, swap 사용 약 `83MiB`였다.
이는 한 시점의 값일 뿐 peak headroom이나 두 app 동시 실행 안전성을 증명하지
않으므로 blue-green 승인 전 별도 부하 측정이 필요하다.

#### 단계 A — planned drain + 안전한 짧은 중단 배포

1. hosted CI가 green인 immutable image digest와 이전 rollback digest를 고정한다.
2. DB migration은 기존 app과 호환되는 forward/expand 변경만 먼저 적용하고,
   DB와 현재 event sink를 backup한다.
3. 최소 maintenance/readiness 경계를 추가해 신규 room create/join/start를
   차단하고, active room/match가 `0`이 될 때까지 bounded drain한다.
4. event producer를 정지하고 기존 PostgreSQL in-flight write를 drain한 뒤
   app을 정상 종료한다.
5. app만 새 digest로 교체하고 liveness와 storage readiness를 모두 확인한다.
   PostgreSQL과 Caddy는 불필요하게 재시작하지 않는다.
6. HTTPS, same-origin Socket.IO, Single/PVP/PVE와 event 저장을 smoke한 뒤
   실패하면 이전 digest로 즉시 복귀한다.

이 단계의 목표는 장애 시간을 예측·제한하고 rollback을 확실히 하는 것이며
무중단을 주장하지 않는다.

#### 단계 B — 조건부 near-zero HTTP 전환

- image는 VM 밖의 CI에서 build하고 immutable digest로 pull해 VM build 부하를
  없앤다.
- 메모리 실측에서 OS·PostgreSQL·Caddy·blue·green을 동시에 실행할 안전한
  headroom이 확인되거나 VM 용량을 늘린 경우에만 두 app을 띄운다.
- green readiness 성공 뒤 Caddy가 신규 연결만 green으로 보내고, blue의 기존
  HTTP/WebSocket 연결은 room 종료 또는 명시적 drain timeout까지 유지한다.
- Caddy config reload는 기본적으로 기존 WebSocket을 닫을 수 있으므로
  `stream_close_delay`, release-aware affinity와 reconnect가 원래 instance로
  돌아가는지까지 검증한다.
- 이 단계는 새 HTTP 요청의 중단을 줄일 뿐, process memory에 있는 active match
  보존까지 검증하기 전에는 전체 서비스 무중단이라고 부르지 않는다.

현재 `VM.Standard.E2.1.Micro` 자원에서는 단계 B를 기본안으로 사용하지 않는다.

#### 단계 C — 실제 무중단 배포

- 최소 두 app instance와 이를 감당할 별도 VM 또는 충분한 메모리를 준비한다.
- 신규 연결의 green 전환과 blue의 active room drain을 지원한다.
- 배포 중 reconnect와 active match까지 보존하려면 shared session/room/match
  state, sticky routing 또는 Socket.IO adapter와 version-compatible protocol이
  선행돼야 한다.
- DB migration은 `expand → 양 버전 호환 → traffic cutover → contract` 순서로
  수행한다.
- 단일 OCI VM 장애까지 견디려면 app과 DB의 장애 영역·backup/restore도 분리해야
  한다.

#### 배포 완료 기준

- 단계 A는 외부 probe로 실제 중단 시간을 기록하고 새 app readiness 이후
  network error와 `5xx`가 없는지 확인한다. 측정 전에는 중단 시간을 보장하지 않는다.
- 단계 B의 endpoint near-zero를 주장하려면 전환 중 연속 HTTPS probe에
  network error와 `5xx`가 없어야 한다.
- 단계 C의 gameplay 무중단을 주장하려면 기존 Socket.IO 연결과 진행 중
  PVP/PVE의 board·sequence가 끝까지 유지돼야 한다.
- event 누락·중복·idempotency conflict가 없고 shutdown 뒤 DB pool connection이
  `0`이다.
- old/new image digest, Caddy 전환 시점, health/readiness, exit code와
  `OOMKilled=false`를 기록한다.
- 새 version smoke 실패 시 DB row를 삭제하지 않고 이전 image와 호환 설정으로
  rollback할 수 있다.

## Data Storage Plan and Next Work

### 바로 해야 할 일

1. 운영 backup과 retention 자동화
   - 보존한 import 전 backup과 restore rehearsal을 기준으로 정기 `pg_dump`, backup checksum·복구 점검, 90일 retention dry-run과 disk 70%/85% 경고를 설계한다.
2. 운영 recovery 기준선 확장
   - 현재 image와 JSONL rollback 원본을 보존하고 Caddy/TLS 자동 갱신, VM reboot 후 app/PostgreSQL 자동 복구와 backup restore를 다시 확인한다.
3. 성능·배포 후속 gate
   - 위 부하 측정과 ticker 정확성 수정부터 진행하고, 무중단 배포는 단계 B/C 선행조건이 충족된 경우에만 별도 Goal로 연다.
4. `PLAN.md` 단일 기준성 유지
   - 실행 결과는 각 `runs/goal-*`에 남기고 현재 우선순위만 이 섹션에서 갱신한다.

### 이후 단계

- [x] Goal 11E는 main/origin/main에 반영됐고 hosted Fast/Docker 및 Browser 연속 2회가 통과함
- [x] portfolio trailing whitespace와 PLAN 상태 정정 뒤 후속 main의 Fast/Docker/Browser green을 확인함
- [x] Goal 9A 설계와 local schema/migration/repository 구현·검증, main/origin/main 통합과 hosted Fast/Docker/Browser green
- [x] Goal 9B 설계·구현·검증과 main/origin 통합
- [x] Goal 9C JSONL backfill 구현·검증과 main/origin 통합
- [x] Goal 9D local PostgreSQL CI/release/Docker gate 구현·검증
- [x] Goal 9D main/origin 통합과 hosted 네 job의 cache-independent clean run 검증
- [x] OCI 단일 VM Docker Compose/Caddy 구성과 공개 app + HTTPS 기준선 배포
- [x] PostgreSQL provisioning, JSONL 멱등 import, single-sink cutover와 실제 gameplay/restart row 보존
- [~] maintenance window 기반 app 교체와 rollback 근거 보존. 이전 image로 실제 rollback하는 rehearsal은 미실행
- [ ] 정기 PostgreSQL backup/restore, 90일 retention과 용량 경고 자동화
- [ ] 자원·상태 공유 선행조건이 충족될 때만 near-zero/무중단 배포 Goal 승인
- [ ] Goal 9D 이후 DB dataset read-source가 필요할 때만 Goal 10 재개
- [ ] 유지보수 이득이 분명해지면 Goal 8D test/e2e/scripts TypeScript 정리 재검토
- [ ] 실제 gameplay 성능 목표가 생기면 heuristic/V4/hybrid를 새 실험 문서와 benchmark로 분리 검토
- [ ] LLM 코칭 리포트는 분석 지표와 사용자-vs-AI 비교 결과가 준비된 뒤 별도 승인으로 검토

## Known Risks and Deferred Work

### production hardening 이후

- [x] Goal 11D PR 원격 실행 증거와 main 반영
- [x] main push에서 확인된 PVE timing failure는 Goal 11E에서 deterministic coverage로 재배치하고 hosted CI green을 확인함
- [x] portfolio trailing whitespace와 PLAN 상태 정정 뒤 hosted Fast/Docker/Browser green을 확인함
- [x] Goal 9A main 통합과 hosted Fast/Docker/Browser green
- [x] Goal 9B runtime PostgreSQL 검증과 main 통합
- [x] Goal 9C JSONL import/completeness 검증과 main 통합
- [x] Goal 9D local PostgreSQL CI/release/Docker 검증
- [x] Goal 9D hosted PostgreSQL 포함 네 job과 cache-independent clean run 검증 및 main 통합
- [x] OCI 단일 VM의 공개 HTTPS/Caddy와 same-origin Socket.IO 기준선 운영 확인
- [x] production PostgreSQL single-sink, JSONL import·실제 write·app restart 보존과 최초 backup/restore rehearsal
- [ ] 정기 backup/retention·disk alert와 VM reboot recovery 검증
- [ ] ticker wall-clock 정확성 수정과 1·10·50 room 부하 계측
- [ ] 현재 VM에서는 안전한 짧은 중단 배포를 우선하고, true zero-downtime은 다중 instance·상태 공유 뒤 재검토
- [ ] WebKit/Firefox와 장시간 soak가 필요해지는 시점에 별도 browser matrix 추가
- [ ] Goal 9D 이후 DB export/read-source 전환이 필요하면 Goal 10 재검토
- [ ] deterministic seed/replay 고도화
- [ ] 사용자 행동과 PVE AI 선택 비교 리포트 고도화
- [ ] LLM 기반 코칭 리포트 추가 검토

### 운영과 검증

- [x] `start` script
- [x] `test` script
- [x] `dev` / `dev:server` script
- [x] `build` script
- [x] `env` / `port` 기본 경계 정리
- [x] disconnect 기반 room cleanup
- [x] production Docker health check
- [ ] TTL 또는 오래된 room cleanup
- [x] 공개 OCI 주소의 external TLS/Caddy reverse proxy와 same-origin Socket.IO smoke
- [ ] TLS 자동 갱신·VM reboot·장시간 운영 recovery 검증
- [x] PostgreSQL production event sink, JSONL import와 최초 backup/restore 증거
- [ ] 정기 PostgreSQL backup/retention과 용량 경고 자동화
- [x] GitHub-hosted CI에서 Fast, Docker, Browser가 모두 성공

### AI 원칙

- AI는 DOM이 아니라 game state를 읽는다.
- AI 출력은 사람과 같은 `action` 형식을 사용한다.
- 현재 구현된 AI 기반은 `boardMetrics`, reachable placement planning, simulation, heuristic evaluation, PVE AI Player다.
- PVE AI는 추천 코치가 아니라 실제 AI 상대다.
- production 기본 PVE는 heuristic이다.
- V4는 사용자 선택형 Experimental PVE와 offline Human imitation 분석용이다.
- Python AI 서버와 강화학습은 현재 범위가 아니며, 별도 gameplay 목표와 benchmark가 생긴 뒤 검토한다.
- LLM은 보조 설명 계층이다.
- LLM 입력은 원본 게임 로그 전체가 아니라 요약 통계, 주요 실수 장면, PVE AI 선택 행동, 사용자 행동 차이를 중심으로 구성한다.
- LLM이 판단을 대신하지 않는다. 판단은 휴리스틱/ML 분석 계층에서 만들고, LLM은 그 결과를 자연어로 설명한다.

### Existing Docs Note

- `ROADMAP.md`: 상위 방향 문서였음. 핵심 방향은 이 문서에 흡수했다.
- `PROTOCOL.md`: 멀티 철학은 유지하되, MVP 기준은 `seed`보다 `server bag`으로 수정 반영했다.
- `PHASE1_PLAN.md`: 오래된 계획서 성격이 강해서 "진행 현황"과 "다음 액션"으로 흡수했다.
- 가능하면 이후에는 이 `PLAN`을 기준으로 유지하고, 나머지 문서는 보조 기록 또는 아카이브로 두는 편이 좋다.

## Migration Baseline Gate (2026-07-17)

### 범위와 현재 구조

- 현재 기준 기술은 Vanilla JS + Express + Socket.IO + Node 내장 테스트 + Playwright다.
- 싱글은 local runtime이 입력, 중력, hold, next queue, score, line clear와 game over를 소유한다.
- PVP/PVE의 최종 gameplay state는 서버 `authoritativeState`이며, input, ticker, snapshot, garbage와 game over 경로를 공유한다.
- Python placement parity와 JSONL 분석 경로는 main의 기존 결과를 그대로 보존한다.
- Goal 0은 게임 규칙, Socket.IO protocol, 로그 schema와 migration dependency를 변경하지 않는다.

### 기준선 관찰력

- 싱글 Playwright characterization은 테스트 전용 고정 RNG로 비정사각형 T 조각을 준비하고 Playwright clock으로 자동 중력을 분리한다.
- 이동, 회전과 soft drop은 각각 불투명 T 조각의 Canvas cell 좌표 변화로 검증하며, hard drop은 하단 고정 cell과 화면 score 증가로 검증한다. 키 입력 호출 자체는 성공 증거로 사용하지 않는다.
- PVP rollback gate는 첫 burst 4개와 전체 6개 입력이 실제 outgoing `game:input` frame으로 송신된 뒤 board 수렴과 안정성을 판정한다.
- 수렴한 PVP board는 서로 다른 authoritative snapshot tick 2회 동안 이전 fingerprint로 돌아가지 않아야 한다.
- rollback과 싱글 test를 각각 5회 반복했으며 10/10이 통과했다.
- 전체 Playwright 15/15와 `bash scripts/verify.sh`의 Node test 542개 중 541개 통과, 1개 skip이 확인됐다.

### Codex-managed worktree 호환성 예외

- `.codex`가 포함된 절대 경로를 Express `send`가 dotfile 경로로 판단해 `/`가 404가 되는 preflight 실패를 확인했다.
- 사용자 승인에 따라 root `sendFile()`만 상대 경로와 기존 `STATIC_ROOT` 옵션을 사용하도록 변경했다.
- `dotfiles: "allow"`, redirect, Playwright readiness 우회와 서버 구조 변경은 적용하지 않았다.
- 동일 `.codex` worktree에서 `/`, `/pages/index.html`, `/styles/style.css`가 모두 HTTP 200을 반환했다.

### 완료 판단과 남은 위험

- Chromium local 고정 시나리오에서는 known own board rollback이 재현되지 않았다.
- packet loss, 높은 외부 latency, 장시간 soak와 다른 browser engine은 아직 검증하지 않았다.
- Goal 0 merge 후 main에서 같은 gate를 재검증하기 전에는 Goal 1을 시작하지 않는다.

## Migration Goal 1 Gate (2026-07-20)

### 실행·빌드 경계

- 기준은 Goal 0가 반영된 clean local main이다.
- Node는 `.nvmrc`와 `engines`에서 `24.18.0` 계열로 고정했다.
- 개발은 `npm run dev:server`와 `npm run dev`를 분리하고, Vite가 `/socket.io`를 Express/Socket.IO로 proxy한다.
- production은 `npm run build`가 `dist/client`를 만들고 기존 `npm start`가 그 결과만 제공한다. start가 build나 Vite 설치를 암묵적으로 수행하지 않는다.
- Vite input은 index, lobby, single, multiplayer 네 HTML이며 root click navigation을 유지한다.

### TypeScript 공존 경계

- client, server와 test는 별도 `tsconfig`에서 검사하고 기존 JavaScript는 `allowJs: true`, `checkJs: false`로 유지한다.
- 새 TypeScript에는 strict 검사를 적용했으며 기존 server/test JavaScript 전체가 strict 전환됐다고 간주하지 않는다.
- client leaf인 theme module 하나만 `.ts`로 옮겼다. React, root `type: module`, typed Socket contract와 server 전체 변환은 포함하지 않았다.

### 검증과 남은 위험

- Node 24 clean install, typecheck, build와 Node test를 포함한 `bash scripts/verify.sh`가 통과했다. Node test는 542개 중 541개 통과, 기존 조건부 1개 skip이다.
- 전체 Playwright 최종 재실행은 16/16 통과했다. 첫 전체 실행에서 기존 PVE timing assertion 1건이 실패했으나 단독 재실행, 전체 재실행과 3회 반복이 모두 통과해 코드 변경 없이 timing 변동 위험으로 기록했다.
- production dependency만 설치한 runtime에서 `/`, 네 page, CSS/JS/MP3와 Socket.IO client를 HTTP 200으로 확인했고 source map 요청은 404였다.
- production build를 실제 브라우저 세 탭에서 수동 검증했다. root→single과 root→lobby, 두 탭 PVP 생성·참가·시작·입력, heuristic PVE 시작·종료·로비 복귀가 통과했다.
- theme/sound 토글, Canvas 렌더, hashed CSS와 세 MP3 resource를 확인했고 세 탭의 browser console error는 0개였다.
- Goal 1은 merge gate에서 멈추며 push, main merge와 Goal 2는 별도 승인 전 수행하지 않는다.

## Migration Goal 2 Gate (2026-07-20)

### Player session과 reconnect 계약

- 기준은 Goal 1이 반영된 main이다.
- 서버는 256-bit CSPRNG opaque token과 UUID playerId를 발급하고 token은 SHA-256 digest만 memory session에 저장한다.
- session record는 token digest, generation, active socket, canonical nickname과 최초 발급 기준 8시간 절대 만료만 소유한다. room membership은 계속 `roomService`가 단일 진실 원천이다.
- client는 versioned JSON credential 하나를 sessionStorage에 원자 저장한다. Socket.IO auth callback은 연결할 때마다 최신 값을 읽고 `session:ready`가 된 active socket만 회전 credential을 기록한다.
- reconnect는 token과 generation을 동기적으로 회전하고 newest socket wins로 이전 socket 권한을 즉시 폐기한다. active socket이 없을 때만 직전 token을 60초 안에 한 번 recovery할 수 있다.
- client는 Socket.IO disconnect reason을 구독자에게 전달한다. `io server disconnect`는 자동 재연결되지 않는 terminal 상태로 안내하고 stale page의 credential은 삭제하지 않으며, transport 단절만 기존 재연결 UI를 사용한다.
- disconnect는 30초 grace를 적용한다. lobby는 reconnect마다 `room:sync`, game은 `game:join`을 다시 실행하며 최신 authoritative match로 runtime을 재생성한다. grace가 끝나면 waiting membership을 제거하고, playing match는 `disconnect_timeout` 결과를 먼저 전송한 뒤 loser를 제거해 승자가 waiting room을 재사용할 수 있게 한다.
- partial, malformed, invalid, expired와 replayed credential은 신규 identity로 조용히 대체하지 않는다. client는 terminal credential 오류에서 identity와 저장 room을 지우고 무자격 신규 연결을 최대 한 번만 시도한다.

### Socket mutation과 공개 경계

- create/join/sync/start/leave, game join/input/bag/placement log/leave와 global/room chat의 identity는 모두 active socket session에서 파생한다. client payload의 playerId와 nickname은 인증 근거로 사용하지 않는다.
- 모든 mutation은 active 연결에서만 전송하고 disconnect 때 Socket.IO reconnect send buffer를 비운다. queued game input과 async placement log는 실제 state/log side effect 직전에 active socket과 generation을 다시 확인하며, 이전 generation 요청은 resume 뒤 적용하지 않는다.
- socket별 `game:input` outstanding 상한은 120개다. 121번째 요청은 side effect 없이 거부하고 완료·실패·disconnect에서 counter를 정리한다.
- create/join은 기존 membership을 먼저 검사해 player 하나가 room 하나에만 속하게 한다. playing 상태의 `room:leave`는 거부하고 명시적 `game:leave`만 즉시 퇴장시킨다.
- public room mapper는 room/player 허용 필드만 내보내며 room result, updated, game join/leave, opponent-left와 match-finish 중첩 room에 공통 적용한다.
- token 원문/digest, generation, socketId와 expiry 내부 정보는 public DTO, log, error와 console에 남기지 않는다. public playerId와 roomId는 표시·분석 식별자로 유지한다.
- production은 exact `SOCKET_ALLOWED_ORIGINS`가 없으면 시작하지 않으며 CORS와 Engine.IO `allowRequest`가 같은 allowlist를 사용한다. local Vite/Playwright origin만 development allowlist에 명시했고 `maxHttpBufferSize`는 512 KiB다.
- 신규 session, invalid resume, lifecycle, input, bag, chat과 placement log는 서로 독립된 in-memory bucket을 사용하며 만료 bucket과 session을 주기적으로 정리한다. production 기본값은 신규 session 20/분/IP, lifecycle 10/분/player, bag 2/초/player이고 전체 E2E만 명시적 test profile 120/100/20을 사용한다. trusted proxy 설정 없이 `X-Forwarded-For`는 rate key로 사용하지 않는다.
- 최초 `session:ready` 전과 disconnect 중 mutation UI를 비활성화한다. pagehide 자동 `game:leave`는 제거했고, BFCache 복원은 reload하며 명시적 Leave/Home만 즉시 membership을 변경한다.

### 검증과 남은 위험

- Node 24.18.0에서 `bash scripts/verify.sh`가 typecheck, 44-module build와 Node test 556개 중 555개 통과, 기존 조건부 1개 skip으로 통과했다.
- 전체 Chromium Playwright는 current-token 중복 연결의 이전 탭 terminal 전환, session 발급·rotation·replay·reload, game transport reconnect의 board/sequence/bag 복구, 30초 grace 뒤 loser 정리·room 재사용, Origin·DTO와 기존 PVP/PVE/single을 포함해 24/24 통과했다.
- production HTTP smoke에서 `/`, index/lobby/game pages, Socket.IO client와 대표 built JS가 모두 200을 반환했다.
- session과 limiter는 단일 Node process memory에 있으므로 process restart 후 기존 credential은 terminal invalid 처리되고 room/match 상태도 함께 사라진다. 다중 instance/Redis 공유는 이번 Goal 범위가 아니다.
- sessionStorage token은 XSS에 노출될 수 있으므로 CSP와 broader input validation은 별도 hardening 대상이다. 외부 TLS termination, multi-browser engine, 장시간 abuse/soak는 이번 local gate에서 검증하지 않았다.
- Goal 2는 merge gate에서 멈추며 push, main merge, branch 삭제와 Goal 3은 별도 승인 전 수행하지 않는다.

## Migration Goal 3 Gate (2026-07-21)

### Socket 계약과 검증 경계

- 기준은 Goal 2의 최종 terminal disconnect 수정까지 반영된 main이다.
- production dependency `zod@4.4.3`을 exact version으로 추가하고, server CommonJS와 Vite browser가 함께 import하는 `src/shared/socketContracts.mjs`에 handshake, 12개 C2S와 16개 S2C schema를 둔다.
- `src/shared/socketContractTypes.d.ts`는 wire payload를 `z.input`, parse 이후 payload를 `z.output`으로 파생한다. 현재 JavaScript handler는 `checkJs:false`이므로 compile-time Socket.IO generic 강제를 주장하지 않으며 그 적용은 Goal 4 범위다.
- production runtime parse는 server의 handshake/C2S 수신과 browser의 S2C 수신에서 한 번만 수행한다. client outbound와 server outbound에는 parse wrapper를 추가하지 않고 실제 fake socket/server emission을 계약 테스트로 검증한다.
- server app event 순서는 active session 확인, server-derived rate key, Zod parse, room/host/status authorization, input queue, service/domain 호출로 고정했다. stale socket은 정상 player rate bucket을 소모하지 않는다.
- strict control envelope, UUID/room/token 형식, nickname/chat 길이, transform/board/DTO 중첩 구조와 숫자·enum 범위를 검증한다. authoritative board의 기존 `garbage` cell은 허용하되 active piece와 piece queue는 7개 tetromino enum을 유지한다.
- `game:input`은 hold/non-hold discriminated union으로 정의해 non-hold의 `expectedTransform` 필수 조건이 runtime뿐 아니라 `z.input`/`z.output` 타입에도 반영된다.
- invalid payload는 기존 event별 result channel에서 `INVALID_PAYLOAD`만 반환한다. raw payload, unknown key, Zod issue와 stack은 응답·로그에 포함하지 않으며 game input의 안전한 정수 sequence/piece metadata만 보존한다.

### 기존 domain과 browser 호환성

- placement log 외부 `{roomId, log}`만 strict 처리하고 256 KiB 제한, 순환 안전한 iterative private-field scan과 기존 `validatePlacementDecisionLog`를 유지한다. human v1/v2의 placementResult 전체 scalar를 socket 경계에서 검사하고 server가 roomId/playerId를 인증된 값으로 덮어쓴 뒤 domain validation과 저장을 수행한다.
- `game:bag:request`는 기존 `ensurePlayerBagQueue` low-water 경계를 사용한다. queue가 충분하면 mutation 없이 `BAG_QUEUE_SUFFICIENT`를 반환하고 client pending을 해제하며, 부족할 때만 정확히 7개 chunk를 broadcast한다. 장시간 queue/bagChunks에 schema-only hard cap은 추가하지 않았다.
- `roomClient`의 모든 S2C application listener가 shared schema를 통과한다. `logClient`의 raw socket 우회를 제거했고 invalid S2C는 handler를 호출하지 않는다. invalid `session:ready`와 malformed `connect_error.data`는 credential을 지우지 않는 terminal protocol 오류다. 연결 중인 invalid `session:ready`는 실제 disconnect event로 한 번만 알리고, 이미 연결이 끊긴 malformed `connect_error`도 구독자에게 `terminal:true`를 정확히 한 번 전달한다. data 없는 transport 오류는 nonterminal이다.
- 정상 PVP/PVE payload 의미와 Goal 2의 session/token, reconnect, origin/rate 정책은 유지했다. 존재하지 않는 방 E2E는 실제 8자리 방 코드 형식의 미존재 값으로 fixture를 바로잡았다.

### 검증, bundle과 남은 위험

- Node 24.18.0/npm 11.16.0에서 `bash scripts/verify.sh`가 diff check, typecheck, 124-module build와 Node test 571개 중 570개 통과, 기존 조건부 1개 skip으로 통과했다.
- 전체 Chromium Playwright는 PVP/PVE/session/reconnect/rollback/single을 포함해 24/24 통과했다. 첫 실행의 2건 실패는 invalid 7자리 room fixture와 정상 garbage snapshot schema 누락을 드러냈고, 계약/fixture 수정 후 전체를 다시 통과했다.
- production dependency-only 임시 설치에서 Express, Socket.IO와 Zod만으로 server를 기동했다. `/`, 네 page, Socket.IO client와 대표 built JS/CSS가 모두 HTTP 200을 반환했다.
- 기준 build의 `roomClient` chunk는 4.10 kB(gzip 1.59 kB)였고 최종 리뷰 수정 후 76.86 kB(gzip 21.19 kB)다. 증가는 raw 72.76 kB, gzip 19.60 kB이며 향후 bundle 최적화는 정상 계약을 바꾸지 않는 별도 판단 대상이다.
- strict schema에 정상 protocol variant가 새로 발견되면 해당 event group의 schema와 parity fixture를 함께 보완해야 한다. 외부 TLS/reverse proxy, WebKit/Firefox, 장시간 malformed traffic/soak와 실제 TypeScript Socket.IO generic은 이번 Goal에서 검증하지 않았다.
- Goal 3는 merge gate에서 멈추며 push, PR, main merge, branch 삭제와 Goal 4는 별도 승인 전 수행하지 않는다.

## Migration Goal 4 Gate (2026-07-21)

### Build와 module 경계

- 기준은 Goal 3 최종 수정까지 반영된 main이다.
- root CommonJS와 `socketContracts.mjs` 경계를 유지하고 `NodeNext + allowJs`로 `dist/server`를 emit한다. root `type: module`, server bundler와 runtime TypeScript loader는 추가하지 않았다.
- `src/client/package.json`의 `type: module`을 NodeNext 입력과 output에 동일하게 적용해 stable client core를 ESM으로 emit한다. compiled `gameCoreLoader`에서 `BLOCKS.tree` 네 rotation을 직접 확인한다.
- Vite hashed browser bundle은 `dist/client`, server가 dynamic import하는 core/state/AI는 `dist/server/client/game`에 분리한다. Zod 계약은 `dist/server/shared/socketContracts.mjs`, PVE model은 server asset 경로에 둔다.
- Node 표준 라이브러리 build helper 하나가 clean build, Vite, TypeScript emit과 manifest/model 복사를 처리한다. dependency와 lockfile은 변경하지 않았다.

### Runtime과 검증 경계

- package entry와 production start는 `dist/server/app.js`다. `dev:server`는 server artifact를 먼저 build하고 같은 compiled entry를 실행한다.
- 대표 TypeScript 전환은 실제 entry `src/app.ts`와 gameplay 밖의 leaf `socketSecurity.ts`만 포함한다. 기존 source security unit test는 Node 24 source `.ts`를 직접 검증한다.
- compiled `init.js`는 자신의 `__dirname`에서 `dist/client`를 계산한다. production source map은 생성하지 않으며 stack trace는 compiled JavaScript 위치를 기록한다.
- clean build 직후 단일 artifact test가 output whitelist, `.ts`/`.map`/`.env`와 test fixture 부재, source/output manifest 일치와 compiled loader fixture를 함께 확인한다.
- Node 24.18.0에서 fast gate는 artifact test 1개와 Node test 571개 중 570개 통과, 기존 조건부 1개 skip으로 통과했다. compiled `npm start` 기준 전체 Playwright는 24/24 통과했다.
- production dependency-only release는 Express, Socket.IO와 Zod만으로 기동했다. 주요 HTML, hashed asset과 Socket.IO client는 HTTP 200, server artifact와 source map은 404였고 실제 bundled V4 decision은 `placement_v4`, fallback 0이었다.
- Goal 4는 main에 반영했으며, Goal 5는 해당 main의 clean 상태와 선행 gate를 확인한 뒤 별도 branch에서 시작한다.

## Migration Goal 5 React shell main 반영 (2026-07-21)

### React shell과 DOM 경계

- 기준은 Goal 4가 반영된 main이다.
- Vite multi-page와 기존 URL을 유지하고 index와 multiplayer lobby만 독립 `React.StrictMode` TSX entry로 옮겼다. single/multiplayer Canvas page, game runtime, protocol과 server service는 변경하지 않았다.
- HTML은 head, theme pre-paint, CSS link와 mount point만 소유한다. lobby는 classic `/socket.io/socket.io.js`를 React module보다 먼저 로드한다.
- 기존 ID, class, href, form semantics와 `theme`, `tetrisSoundEnabled`, `tetris:nickname`, `tetris:roomId`, `room`, `tetris:playerSession` storage key를 보존한다.
- `react@19.2.7`, `react-dom@19.2.7`, `@types/react@19.2.17`, `@types/react-dom@19.2.3`만 exact version으로 추가했다. Vite 기본 TSX 변환을 사용하며 React plugin, Router, 상태관리와 DOM test framework는 추가하지 않았다.

### Socket lifecycle과 보안

- `roomClient` singleton이 Socket.IO 연결, handshake와 credential을 계속 소유한다. React mount/cleanup은 socket을 생성·연결·해제하지 않는다.
- session subscriber는 등록마다 고유 wrapper와 idempotent disposer를 사용한다. `onSessionReady` replay는 예약 당시 `activeSession` 객체와 현재 Set membership이 모두 유지될 때만 실행돼 unsubscribe, rotation과 disconnect 뒤 stale replay를 전달하지 않는다.
- lobby effect는 room updated/message/result, global message, chat result와 session ready/error/disconnected의 8개 disposer를 모두 보관한다. StrictMode setup-cleanup-setup 뒤 listener와 초기 `room:sync`는 한 세트만 남는다.
- lobby pagehide는 구독과 sound side effect만 idempotent하게 정리하고 root를 unmount하지 않는다. index와 lobby의 `pageshow.persisted` listener는 남아 복귀 즉시 reload하고 sound listener와 socket 구독을 복원한다.
- React state에는 공개 playerId, nickname, public room DTO와 UI 상태만 저장한다. token은 React state/props, DOM, URL과 console에 남기지 않고 사용자 문자열은 JSX text로 렌더링한다.

### 검증과 남은 위험

- Node 24.18.0/npm 11.16.0에서 `bash scripts/verify.sh`가 typecheck, 134-module clean build, artifact 1/1과 Node test 571개 중 570 pass, 기존 조건부 1 skip으로 통과했다.
- Vite development StrictMode gate는 listener 한 세트, 초기 `room:sync` 1회, server result/message DOM 1회, index BFCache sound 복원과 console error/pageerror 0을 확인해 2 pass, production-only artifact test 1 skip으로 통과했다.
- compiled production 전체 Chromium Playwright는 실제 `pagehide → pageshow → reload`, index BFCache sound 복원, host/guest token 비노출과 기존 gameplay/session 회귀를 포함해 27/27 통과했다. 별도 UI 체크리스트 2/2에서 theme, sound, footer year, nickname/Guest, clipboard와 placement_v4 hard PVE 선택을 확인했다.
- production dependency-only 임시 설치는 Express, Socket.IO, Zod와 React/ReactDOM만으로 compiled server를 기동했다. root/index/lobby, Socket.IO client와 React/index/lobby bundle은 HTTP 200, `.tsx`와 source map은 404였다.
- 공용 React runtime은 189.60 kB(gzip 59.63 kB) shared chunk 하나다. index entry는 4.68 kB(gzip 1.93 kB), lobby entry는 11.61 kB(gzip 3.98 kB)다.
- WebKit/Firefox, 외부 TLS/reverse proxy, 실제 browser history 기반 BFCache eligibility와 장시간 soak는 이번 local Chromium gate에서 검증하지 않았다.
- Goal 5 구현과 review fix는 main에 반영됐고 Goal 5 branch는 보존한다. Goal 6은 별도 승인 후 독립 branch에서 진행했다.

## Migration Goal 6 Single React main integration (2026-07-21)

### Runtime display bridge와 React 소유권

- 기준은 Goal 5가 반영된 main이다.
- `gameState`와 runtime은 gameplay 상태의 단일 진실 원천으로 유지한다. React는 `useSyncExternalStore`로 score, lines, hold, next 2개와 phase만 포함한 cached display snapshot을 읽는다.
- snapshot 값이 같으면 같은 객체를 반환하고 HUD 값이 실제로 바뀔 때만 새 객체와 알림을 만든다. 일반 이동·회전·gravity는 알리지 않으며 hold/lock, line clear, snapshot 적용과 init의 최종 표시 경계만 알린다.
- `lines`는 display 계약과 unit/integration test에 포함하지만 기존 single 화면에 visible Lines HUD를 추가하지 않는다. 점수·line 계산과 gameplay/protocol 의미도 변경하지 않는다.
- single runtime에는 Canvas만 전달한다. score, hold, next와 game-over DOM은 page-local `SingleHud`/`PiecePreview`가 소유하며 multiplayer의 기존 DOM UI adapter는 유지한다.
- StrictMode cleanup은 자신이 만든 runtime만 idempotent하게 destroy한다. restart는 같은 runtime의 `init()`을 재사용하고 pagehide는 runtime·sound를 정리하며 `pageshow.persisted`는 reload한다.

### 검증과 남은 위험

- Node 24.18.0/npm 11.16.0에서 `bash scripts/verify.sh`가 typecheck, 135-module clean build, artifact 1/1과 Node test 576개 중 575 pass, 기존 조건부 1 skip으로 통과했다.
- 관련 display/runtime Node test 43개가 snapshot reference, 독립 unsubscribe, HUD 불변 이동 0회, hold/hard drop 1회, line clear 2단계, server bag 고갈, applySnapshot/init과 destroy idempotency를 검증했다.
- Vite development StrictMode gate는 기존 lobby/index와 single lifecycle을 함께 실행해 5 pass, production-only 2 skip으로 통과했다. single input/sound listener 단일성, preview DOM, 반복 restart, BFCache와 console error/pageerror 0을 확인했다.
- compiled production 전체 Chromium Playwright는 기존 Canvas 입력, PVP/PVE/session/rollback과 single lifecycle/artifact를 포함해 31/31 통과했다. `/pages/tetrisSingle.tsx`와 built single module source map은 HTTP 404였다.
- current production bundle은 single entry 4.75 kB(gzip 1.76 kB), gameplay runtime chunk 34.58 kB(gzip 10.84 kB), shared React runtime 189.66 kB(gzip 59.65 kB)다. Goal 5 shared React 기준 증가는 0.06 kB(gzip 0.02 kB)이며 dependency와 lockfile 변화는 없다.
- 실제 browser history 기반 BFCache eligibility, WebKit/Firefox, 장시간 timer/animation soak는 이번 local Chromium gate에서 검증하지 않았다.
- `main`은 Goal 6 최종 변경까지 fast-forward 되었고, Node 24.18.0 기준 `bash scripts/verify.sh`를 다시 통과했다. Goal 6 branch는 보존하며 Goal 7은 시작하지 않았다.

## Migration Goal 7 Multiplayer React merge gate (2026-07-21)

### Runtime display와 React 소유권

- 기준은 Goal 6 main 통합 기록까지 반영된 main이다.
- cached display snapshot에 표시 전용 `pendingGarbageLines`만 추가했다. 같은 값은 기존 snapshot reference와 알림 0회를 유지하고 pending-only 변경은 1회만 알린다. `applySnapshot`은 pending 갱신과 최종 publish를 한 번으로 합친다.
- `startMultiplayerGame()`의 idempotent `destroy()`가 heartbeat, Socket disposer 5개, pending/deferred input, placement log, bag request와 두 runtime을 한 경계에서 정리한다. 기존 반환 필드는 rollback과 test 호환을 위해 유지한다.
- `tetrisMulti.html`은 기존 head, theme pre-paint, CSS와 Socket.IO classic script 순서를 유지하고 `tetrisMulti.tsx`의 단일 `React.StrictMode` root를 mount한다. Host/Guest·AI의 두 Canvas만 runtime에 전달하며 score, lines, pending garbage, hold/next preview, badge와 overlay는 React가 소유한다.
- gameplay state와 authoritative match는 기존 runtime/server가 단일 진실 원천이다. React state에는 좁은 공개 page 정보, display handle과 overlay만 두며 token, socketId, raw match/snapshot, board와 bag은 저장하거나 렌더링하지 않는다.

### Reconnect, cleanup과 검증

- page effect는 placement result, game join, PVE policy, match finish, opponent left와 session ready/error/disconnected의 8개 disposer를 보관한다. disconnect와 match finish에서 현재 session은 즉시 destroy하되 마지막 display handle을 유지하고, reconnect join 성공 시 새 handle로 교체한다.
- `session:ready`의 disposed/terminal/match-finished/join-pending/active-session gate로 최초 `game:join` 1회와 transport reconnect 뒤 정확히 1회 추가만 허용한다. current-token 중복 연결은 마지막 HUD 위에 terminal 안내를 표시하고 입력을 차단하며 stale credential을 지우지 않는다.
- Node 24.18.0/npm 11.16.0에서 관련 display/runtime/session test 85/85가 통과했다. `bash scripts/verify.sh`는 typecheck, 134-module clean build, artifact 1/1과 Node test 579개 중 578 pass, 기존 조건부 1 skip으로 통과했다.
- Vite development StrictMode gate는 기존 shell/single과 multiplayer lifecycle을 함께 실행해 8 pass, production-only 2 skip이었다. compiled production 전체 Chromium Playwright는 기존 PVP/PVE/session/rollback/single과 신규 multiplayer lifecycle을 포함해 34/34 통과했다.
- production에서 `/pages/tetrisMulti.tsx`와 built multiplayer module source map은 HTTP 404였다. Host/Guest token은 URL, HTML과 수집한 console message에 없었고 browser console error와 pageerror는 0개였다.
- review fix는 React state가 runtime 전체 객체 대신 `getDisplaySnapshot`/`subscribeDisplay`만 가진 page-local handle을 보관하게 했다. session destroy test는 네 game Socket handler가 1개에서 0개가 되는지 확인하고, reconnect는 상대 hold HUD 유지와 양쪽 overlay 해제를 확인한다. 기존 incoming/PVE badge 알림을 보존하며 reconnect/terminal/result overlay만 사용자 소유 column에서 알린다.
- 기준 multiplayer entry는 12,963 bytes(gzip 4,839), 최종은 17,297 bytes(gzip 6,181)로 4,334 bytes(gzip 1,342) 증가했다. shared React chunk는 189,660 bytes(gzip 58,971)에서 192,260 bytes(gzip 60,025)로 2,600 bytes(gzip 1,054) 증가해 합계 증가는 6,934 bytes(gzip 2,396)다.
- dependency, lockfile, server runtime/Socket contract, roomClient session 정책, core/renderer/AI 규칙과 single page는 변경하지 않았다. 실제 browser history 기반 BFCache eligibility, WebKit/Firefox와 장시간 reconnect/gameplay soak는 미검증 범위다.
- Goal 7 branch는 보존하며 push, PR, branch 삭제와 Goal 8은 별도 승인 전 수행하지 않는다.

### Main integration (2026-07-21)

- clean한 `main`/`origin/main`과 Goal branch를 확인한 뒤 `codex/migrate-react-multiplayer`의 최종 변경을 `--ff-only`로 local main에 반영했다. merge commit은 만들지 않았고 Goal branch는 보존한다.
- main의 Node `24.18.0`/npm `11.16.0`에서 `bash scripts/verify.sh`를 재실행해 artifact 1/1, Node test 579개 중 578 pass와 기존 조건부 1 skip을 확인했다. main `git diff --check`와 clean worktree도 통과했다.
- Goal branch 최종 HEAD는 main의 조상이며 당시 local main은 `origin/main`보다 6커밋 ahead였다. push와 Goal 8은 수행하지 않았다.

## Migration Goal 7A SPA 보류 결정 (2026-07-21)

- 보류 결정 당시 main과 origin/main에는 Goal 7A 명세만 추가돼 있었다. SPA 구현은 `codex/migrate-react-spa`의 clean worktree에만 존재하며 main에는 SPA runtime code가 없어 code revert는 필요하지 않다.
- 구현 브랜치는 단일 shell, exact legacy URL allowlist, lazy multiplayer import와 route cleanup을 만들고 fast gate, Vite-dev 15 pass/2 skip, production Playwright 41/41을 통과했다. dependency와 lockfile은 변경하지 않았다.
- review에서 start/leave 경합 시 pending intent가 다른 `room:result`로 제거되어 ghost match가 남을 수 있는 P1을 확인했다. stale Forward의 membership 보존과 hash-only history의 route exit 오판은 P2, modifier 새 탭 의미 훼손은 P3이다.
- 현재 E2E는 leave 송신 1회는 확인하지만 ack와 최종 server room/match 제거 상태, multiplayer 구간의 same-document/Socket 유지, 반복 route 진입 뒤 runtime·subscription 단일성을 직접 증명하지 않는다. 필수 수동 PVP/PVE도 완료되지 않았다.
- 브랜치 전체 변화는 net 644줄이며 production 183줄, test 353줄, docs 108줄이다. index Vite bundle은 gzip 13.45 kB 증가하고 모든 route가 classic Socket.IO script와 두 stylesheet를 연결해 현재 네 개의 큰 page에 비해 초기 전송과 lifecycle 비용이 크다.
- 따라서 SPA 구현은 실험 브랜치에 보존하되 main에 병합하지 않는다. Goal 7A는 Goal 8 선행조건에서 제외하고, Goal 8은 Goal 7이 반영된 현재 four-entry MPA 기준에서 시작한다.
- 다음 단계는 Goal 8 분할 문서를 main에 반영·검증한 뒤 8A를 최신 main의 별도 branch에서 시작하는 것이다. SPA를 재개할 때는 Goal 7A 문서의 문제와 재개 조건을 먼저 해결한다.

## Migration Goal 8 TypeScript 분할 설계 (2026-07-21)

- 기존 단일 Goal 8은 production과 test/tooling을 한 diff에 묶지 않는다. 8A는 `core/state`, 8B는 client runtime/render/net/AI, 8C는 server와 compiled artifact 경계를 각각 독립 branch와 merge gate에서 전환한다.
- 8D는 test/e2e/scripts 중 유지보수 이득이 분명한 파일만 정리하는 선택 Goal이며 production hardening을 막지 않는다.
- 각 rename Goal은 아직 JavaScript인 consumer를 포함해 해당 모듈을 참조하는 source import/require 경로를 함께 갱신한다. client ESM은 `.ts`/`.tsx` source specifier와 `rewriteRelativeImportExtensions`를 사용해 output의 `.js` 경로를 보존한다.
- server CommonJS TypeScript source는 직접 실행하지 않는다. build 뒤 `dist/server` JavaScript만 test, artifact, development와 production 검증에 사용한다. 8C 시작 전 compiled `app → init → sockets → services`, game core loader와 V4 model chain을 작은 interop gate로 고정한다.
- root `type: module`, 새 loader와 runtime dependency는 추가하지 않는다. `socketContracts.mjs`는 shared Zod runtime의 명시적인 `allowJs` 예외이며 `allowJs: false`는 Goal 8 완료 조건이 아니다.
- 모든 하위 Goal은 검증 전에 `.nvmrc`와 일치하는 Node `24.18.0`을 명시적으로 확인한다. dependency, lockfile, protocol/schema, gameplay, JSONL/Python parity와 보류된 SPA branch는 변경하지 않는다.
- `codex/complete-typescript-migration`은 이 분할 문서만 소유한다. 문서가 main에 반영되기 전에는 8A 구현을 시작하지 않는다.

## Migration Goal 8A Core/State TypeScript merge gate (2026-07-21)

- Goal 8 분할 문서가 반영된 main을 기준으로 `codex/migrate-typescript-core-state`에서 production `core` 7개와 `state` 5개를 strict TypeScript로 전환했다. 아직 JavaScript인 내부 3개와 외부 19개 consumer의 source specifier도 같은 rename 경계에서 `.ts`로 갱신했다.
- `blocks.ts`가 `PieceType = keyof typeof BLOCKS`를 유일하게 소유하고 `piece.ts`는 이를 `import type`으로 가져와 `PieceState`만 소유한다. 빈 조각 sentinel은 `PieceType | ""`로 표현하며 별도 type registry나 중복 literal 목록은 만들지 않았다.
- state deserialize는 기존 fallback을 유지하는 `Partial<SerializedGameState>` 입력을 허용한다. board와 row, active/pending piece 및 queue/bag/inputQueue 배열 컨테이너의 기존 복제 범위만 고정했고 inputQueue 원소의 deep clone이나 serialization schema 변경은 추가하지 않았다.
- `rewriteRelativeImportExtensions`를 기존 shared tsconfig 경계에 적용해 source의 `.ts` specifier를 browser/server artifact의 `.js`로 emit한다. client/test의 Node source 경계는 `erasableSyntaxOnly`, `verbatimModuleSyntax`와 `import type`을 검사하며 root CommonJS, client ESM marker, `allowJs`와 compiled-only server 실행 계약은 유지한다.
- clean artifact test는 compiled `loadGameCore()`의 `BLOCKS`, 빈 board와 대표 move/step fixture를 실제 실행한다. 별도 parity framework, dependency, lockfile, loader, gameplay/Socket/SPA 변경은 없다.
- Node `24.18.0`/npm `11.16.0`에서 typecheck, build, artifact 1/1, targeted core/state 49/49, fast gate의 Node tests 584 pass·기존 조건부 1 skip과 production Playwright 34/34가 통과했다. Single/PVP/PVE 수동 검증에서도 Canvas 입력, hold/restart, authoritative 양방향 보드와 PVE AI line/garbage를 확인했고 네 page의 console error는 0개였다.
- shared tetris bundle은 기준 34.82 kB(gzip 10.90 kB)에서 34.93 kB(gzip 10.93 kB)로 소폭 증가했다. package manifest와 lockfile checksum은 기준과 동일하다.
- Goal 8A는 main과 origin/main에 반영됐다. Goal 8B는 이 기준에서 별도 branch로 시작했으며 Goal 8A branch와 보류된 SPA branch는 보존한다.

## Migration Goal 8B Client Runtime TypeScript main integration (2026-07-22)

- Goal 8A가 반영된 main을 기준으로 `codex/migrate-typescript-client-runtime`에서 production client AI 12개, Canvas entry/render/runtime/UI 8개, network/session 3개 등 기존 JavaScript 23개(전환 전 5,566 LOC)를 strict TypeScript로 전환했다. 리뷰 수정 후 최종 전환 source는 타입 선언을 포함해 6,865 LOC이며 기존 `entry/theme.ts`는 rename 수치에서 제외했다.
- 각 값 모듈이 runtime handle/display snapshot, DOM/Canvas adapter, placement dataset·heuristic·V4 result와 multiplayer lifecycle 타입을 직접 소유한다. Goal 8A의 `PieceType`, `Board`, `PieceState`, `GameState`, `BoardMetrics`를 재사용하고 별도 type registry, manager, framework와 dependency는 추가하지 않았다.
- `roomClient.ts` 내부에 browser Socket.IO global의 private structural type을 두고 기존 `socketContractTypes.d.ts`와 Zod parsed output을 재사용한다. page-facing session 타입은 공개 `playerId`와 `nickname`만 제공하며 token, socketId와 server-private session 필드는 React state, DOM, URL, console 또는 공개 타입에 포함하지 않는다.
- 리뷰 수정에서 malformed ranker 입력의 BASE 실패 이유를 복구하고 `INPUT_ACTION`의 닫힌 literal union을 state 소유 경계로 내렸다. `runtime/input.ts`는 그 타입을 import/re-export해 기존 public import를 보존하고 state/core의 runtime 역방향 의존을 제거했다. C2S emit은 event별 wire payload generic으로 연결했고 persisted credential은 `resumed`를 요구하지 않으며 각 session-ready subscriber는 독립 public projection을 받는다. multiplayer page는 display/session/Piece 타입을 소유 모듈에서 직접 import한다.
- rename commit에서 page TSX, server dynamic import, test와 script consumer를 실제 `.ts` source specifier로 함께 갱신했다. `rewriteRelativeImportExtensions`를 통해 Vite와 compiled server artifact는 `.js` import를 사용하며, build artifact에는 `.ts`, `.tsx`, declaration과 source map이 남지 않는다.
- Node `24.18.0`/npm `11.16.0`에서 typecheck, build 134 modules, artifact 1/1, ranker 14/14와 room/session/runtime targeted 84/84, ML Node 35/35·Python 115/115, fast gate의 Node tests 586 pass·기존 조건부 1 skip, Vite-dev 8 pass·production-only 2 skip과 production Playwright 34/34가 통과했다. 첫 기준선 PVE hold 시나리오는 한 번 timeout됐지만 격리 재실행과 전체 재실행에서 통과했으며 최종 production gate도 34/34다.
- 수동 Single에서 이동·회전·soft/hard drop·hold·restart·sound/BFCache 경계를, PVP에서 양쪽 HUD·overlay·입력·reload reconnect를 확인했다. 최종 수동 production browser gate는 기본 heuristic과 명시적 `placement_v4` UI 선택, 양쪽 AI Canvas의 visible descent, heuristic 경기의 실제 승패 결과와 로비 복귀 후 같은 방 재시작을 확인했으며 console error는 0건이었다.
- 자동 production Playwright 34/34는 normal/hard heuristic, V4 runtime badge, server `match:finish` 결과·같은 방 재시작과 Host/Guest token의 URL·HTML·console 비노출을 별도로 검증했다.
- production HTTP에서 대표 runtime/net `.ts` source와 bundle source map은 404, root와 Socket.IO client는 200이었다. package manifest와 lockfile checksum은 기준과 동일하다.
- shared tetris bundle은 직전 문서 기준 34.93 kB(gzip 10.93 kB)에서 36.31 kB(gzip 11.29 kB), roomClient chunk는 76.86 kB(gzip 21.19 kB)에서 77.39 kB(gzip 21.31 kB)로 증가했다. 새 dependency나 runtime chunk는 없다.
- Chromium local dev/production과 수동 시나리오는 검증했지만 WebKit/Firefox, 장시간 soak와 외부 network 조건은 실행하지 않았다. server TypeScript는 Goal 8C에서 완료했으며 test/e2e/script 자체의 선택 전환은 Goal 8D 범위로 남는다.
- 정확한 rollback 순서는 Goal 8B 실행 기록을 따르며 목적별 커밋을 역순으로 revert한다. rename과 consumer specifier를 같은 경계에서 되돌리고 일부 output만 복구하지 않는다.
- Goal branch를 clean한 local main에 `--ff-only`로 병합했다. Goal branch와 worktree는 보존한다.
- 병합 후 Node `24.18.0`에서 `bash scripts/verify.sh`를 재실행해 typecheck, clean build, artifact 1/1과 Node 586 pass·기존 조건부 1 skip을 확인했고 `git diff --check`도 통과했다.
- 동일한 Goal HEAD에서 이미 production Playwright 34/34와 Vite-dev 8 pass·2 production-only skip이 통과했으므로 main에서 전체 E2E는 코드 변경이 없어 반복하지 않았다. push 후 Goal 8C/8D, Goal 9와 SPA 작업은 별도 승인으로 남긴다.

## Migration Goal 8C Server TypeScript main integration (2026-07-22)

- Goal 8B가 반영된 main을 기준으로 `codex/migrate-typescript-server`에서 `src/server`의 production JavaScript를 strict TypeScript로 전환했다. source server `.js`는 0개이며 `socketContracts.mjs`만 shared production `allowJs` runtime 예외로 유지한다.
- root CommonJS와 `module: NodeNext`를 유지한다. server의 정적 source import는 `.js`, client ESM dynamic import는 `.ts`를 사용하고 build output에서 `.js`로 rewrite한다. root `type: module`, TypeScript runtime loader와 새 dependency는 추가하지 않았다.
- Room, Match, authoritative player state, session, limiter, DTO, repository와 Socket handler가 값을 소유하는 모듈에서 type-aware export를 제공한다. production Socket.IO `Server`/`Socket` 타입을 유지하고 raw C2S payload는 `unknown`에서 기존 event별 Zod schema로 parse한 `validation.data`만 service에 전달한다.
- handshake는 raw auth·remote address·credential 유무 판별 → credential 없는 신규 session rate-limit → handshake Zod parse → malformed resume rate-limit → authenticate → 인증 실패 resume rate-limit → 성공한 SocketData 설정 순서를 유지한다. mutation은 active-session/rate-limit → event별 Zod parse → ownership → service 순서를 보존했다. SocketData에는 token, digest나 internal session을 추가하지 않았고 protocol, gameplay, session/reconnect, JSONL/Python 의미를 변경하지 않았다.
- `npm test`는 clean `build:server` 뒤 compiled suite를 실행하고 `test:compiled`는 기존 artifact를 재사용한다. `scripts/verify.sh`는 typecheck → full build → artifact → build-free compiled test 순서여서 full client/server artifact 사이에 server-only rebuild를 끼우지 않는다. production `npm start`는 prebuilt `dist/server/app.js`만 실행한다.
- artifact gate는 source/dist V4 model byte equality와 SHA-256 `ff64b0d3e4cd9eb6c6d7920f2cbe961f1d70e4c90ccc69a5d9ab8bcd410cb33d`, default copied model의 실제 `placement_v4` decision, compiled client loader와 source-map 없는 expected stack trace를 검증한다.
- hermetic release test는 별도 임시 디렉터리의 `dist`, package manifests와 `npm ci --omit=dev --ignore-scripts` production dependencies만으로 HTTP와 Socket.IO client asset, authoritative PVP와 PVE V4 decision을 실행한다. 실제 auth/handshake는 compiled security tests와 Playwright에서 검증한다. child cwd와 환경 allowlist를 고정하고 workspace dependency, source, test, script, devDependency, source map과 model override 유입을 금지한다.
- 리뷰 수정에서 TTL cleanup의 기본 game-over logger fallback을 복구하고 임시 `GAME_EVENTS_LOG_PATH`에 정확히 한 줄이 저장되는 integration test를 추가했다. stack-trace child는 token/session sentinel을 실제 room/player 인자로 사용하고 별도 고정 non-function mutation으로 실패한다.
- Node `24.18.0`/npm `11.16.0`에서 targeted authoritative gameplay 129/129, 기존 Socket/security 105/105와 TTL log 1/1, artifact 1/1과 hermetic release 1/1이 통과했다. `bash scripts/verify.sh`는 Node tests 587 pass·기존 조건부 1 skip, ML은 Node 35/35·Python 115/115, Vite-dev는 8 pass·production-only 2 skip, production Playwright는 34/34다.
- package dependency와 lockfile은 기준과 동일하다. client source와 dependency를 변경하지 않았으며 final build의 기존 client bundle 구성을 유지했다.
- Chromium local과 hermetic release를 검증했지만 WebKit/Firefox, 외부 TLS/reverse proxy와 장시간 soak는 실행하지 않았다. Express vendor surface는 현재 사용 API만 local declaration으로 좁혔으므로 사용 범위가 커지면 별도 type dependency 판단이 필요하다. test/e2e/script 자체의 선택적 TypeScript 전환은 Goal 8D, storage는 Goal 9 범위다.
- 정확한 rollback 순서는 Goal 8C 실행 기록을 따르며 목적별 커밋을 역순으로 revert한다. pre-interop 문서 커밋은 구현 rollback 대상이 아니다.
- Goal 8C는 local main에 반영됐다. 당시 `origin/main` push, branch 삭제, Goal 8D와 SPA 작업은 수행하지 않았다.

## Storage roadmap decision (2026-07-22, historical)

- 현재 단일 서버와 ML 분석에는 JSONL 경로로 충분하므로 Goal 9 PostgreSQL shadow storage를 main에 병합하지 않는다. 검증된 실험 구현은 `codex/add-postgres-event-shadow`에 보존한다.
- Goal 10 DB/JSONL cutover도 함께 보류한다. 중앙 SQL 조회, 사용자 기록·대시보드 또는 다중 서버 event 수집 요구가 생기면 JSONL batch import부터 다시 판단한다.
- Goal 8D와 SPA는 계속 선택·보류 상태다. 다음 migration 작업은 DB와 무관한 Goal 11A CSP/security headers이며 Goal 8C main 반영만 선행조건으로 사용한다.

## CI and PostgreSQL roadmap reactivation (2026-07-23)

- 실제 사용자 gameplay event를 container 수명과 분리해 장기 보존하고 SQL로 중복·완전성·용량을 점검한다는 요구가 생겼다. 위 2026-07-22 보류 판단은 당시 사실로 남기되 향후 실행 순서는 `11E → 9A → 9B → 9C → 9D`로 갱신한다.
- Goal 11E는 timing-dependent PVE T-Spin E2E를 제거하고 pending garbage의 authoritative/UI 일관성 검증을 유지하는 방식으로 완료됐다. 결과는 main과 origin/main에 반영됐고 hosted Fast/Docker 및 동일 revision의 Browser 연속 2회가 통과했다. T-Spin 보장은 `test/testTSpin.js`, `test/testPlayerGameplayStep.js`, `test/testTetrisRuntime.js`의 결정론적 테스트가 담당한다. 이제 다음 단계는 Goal 9A 설계 준비다.
- Goal 9는 구현 index이며 9A schema/repository, 9B runtime canonical storage, 9C JSONL import/completeness, 9D PostgreSQL CI/release로 나눈다. 각 단계는 별도 branch/worktree와 main merge gate를 사용한다.
- local/development는 JSONL, 배포 환경은 명시적 PostgreSQL 단일 sink를 사용한다. dual-write, silent fallback, Drizzle, Redis, Kafka와 custom in-memory queue는 현재 범위가 아니다.
- Goal 9D와 production 활성화 승인이 끝나면 배포는 `GAME_EVENT_STORAGE=postgres`만 사용하고 JSONL writer와 writable volume을 끈다. 기존 JSONL 파일과 repository code는 삭제하지 않고 local/test 및 명시적 rollback 경로로 보존한다.
- read-only 감사 기준 현재 JSONL은 약 82.7 MiB/17,636 event이며 lifecycle 불완전 경기와 placement 내부 gap이 존재한다. 모든 `game_start`에 포함된 nickname은 DB projection에서 제거하고 human payload는 `client_reported`로 유지한다. 실제 구현 preflight에서 수치를 다시 측정한다.
- 문서 설계 시점의 `codex/add-postgres-event-shadow`는 Goal 8C 시점에서 갈라진 오래된 branch다. current main 쪽 24 commit, old branch 쪽 6 commit으로 나뉘어 있으며 branch 고유 Drizzle/queue 구현은 payload conflict를 숨기고 queue drop, silent JSONL success와 65초 shutdown을 사용한다. CSP, Docker, 현재 8초 shutdown과 CI가 없으므로 전체 merge/rebase와 commit 전체 cherry-pick은 금지한다.
- 과거 branch에서 참고 가능한 것은 semantic identity, parameterized query, TLS/least-privilege 검토와 실제 DB integration test 아이디어뿐이다. 새 구현은 최신 main에서 `pg`와 검토된 SQL로 다시 작성한다.
- 이 문서 branch는 Goal 명세만 변경한다. SQL, dependency, CI workflow, production env, managed DB와 기존 JSONL data를 변경하지 않는다.

## Migration Goal 11A CSP/security headers merge gate (2026-07-22)

- Goal 8C가 반영된 main을 기준으로 `codex/harden-csp-headers`에서 compiled production HTTP 응답에 CSP, `nosniff`, `X-Frame-Options: DENY`와 `Referrer-Policy: no-referrer`를 적용한다. Express `x-powered-by`는 비활성화했고 새 dependency는 추가하지 않았다.
- CSP는 `default-src 'none'`에서 시작한다. 네 page의 동일한 theme pre-paint script hash 하나와 세 종류의 inline theme style hash만 허용하고, script/style attribute, eval과 wildcard origin은 허용하지 않는다. HTML의 유일한 정적 style attribute는 기존 CSS로 이동했다.
- `CSP_MODE=report-only`는 `Content-Security-Policy-Report-Only`, 기본 enforce mode는 `Content-Security-Policy`만 보낸다. 최초 report-only 관찰에서 Zod runtime의 eval probe를 확인해 shared Socket contract에 공식 `jitless` 설정을 적용했고 이후 네 page의 `securitypolicyviolation`, console error와 pageerror는 0건이다. React style prop과 개별 `element.style` property는 위반이 없어 변경하지 않았다.
- 불필요한 static directory redirect는 비활성화했다. Express static 오류는 4-인자 error middleware가 유효한 4xx/5xx status를 보존하면서 두 CSP header를 제거하고 선택된 mode의 header 하나만 다시 적용하며 raw error 내용은 노출하지 않는다.
- `roomClient`의 same-origin `io()`와 `/socket.io/socket.io.js`, Vite proxy와 Socket.IO built-in client serving은 유지한다. CSP의 추가 connect destination은 `SOCKET_ALLOWED_ORIGINS`와 분리된 `CSP_CONNECT_ORIGINS`만 사용하며 WHATWG URL로 protocol, credentials, path, query, fragment와 wildcard를 검사한다.
- first-party TS/TSX와 bundle source map은 HTTP 404를 유지한다. Socket.IO가 공개하는 third-party client map은 기존 built-in serving을 보존하기 위한 승인된 200 예외이며 first-party source를 포함하지 않는다.
- Node `24.18.0`/npm `11.16.0`에서 header/hash와 HTTP mode targeted 5/5, artifact 1/1, source-less release 1/1과 report-only/enforce CSP browser gate 각각 1/1이 통과했다. `/pages` 404와 hashed asset Range 416에서도 선택된 CSP mode 하나만 존재한다. `bash scripts/verify.sh`는 Node tests 592 pass·기존 조건부 1 skip, Vite-dev는 기존 8 pass·production-only 2 skip, enforce production Playwright는 Single/PVP/PVE를 포함해 35/35다.
- HSTS, COOP/COEP/CORP, report collector, dependency hardening과 외부 TLS/reverse proxy는 이번 Goal 범위가 아니다. WebKit/Firefox와 실제 배포 origin은 미검증이며 production에서 외부 connect destination이 필요하면 exact `CSP_CONNECT_ORIGINS`를 별도로 설정해야 한다.
- Goal 11A는 local merge gate에서 멈춘다. push, main merge, branch 삭제, Goal 11B와 보류된 Goal 8D/9/10/SPA는 수행하지 않는다.

## Migration Goal 11B Dependency hardening merge gate (2026-07-22)

- Goal 11A가 반영된 main을 기준으로 `codex/harden-dependencies`에서 fresh npm audit의 유일한 low advisory인 `body-parser@2.2.2`의 invalid-limit DoS 경계를 검토하고 patched `2.3.0`으로 갱신했다. `package.json`, production source, script와 engine 설정은 변경하지 않았다.
- Express는 `body-parser` 모듈을 로드한다. 현재 애플리케이션은 `express.json()`, `express.urlencoded()`, `express.raw()`, `express.text()` 또는 `body-parser` middleware를 생성하지 않으므로 취약점의 invalid-limit 처리 경로는 현재 코드에서 도달하지 않는다. 그래도 알려진 취약점을 제거하기 위해 Express의 기존 `^2.2.1` 범위와 Node 24에 호환되는 patched version을 적용했다.
- lockfile 변경은 `body-parser@2.3.0`, 그 dependency인 `type-is@2.1.0`과 각 모듈 아래 `content-type@2.0.0` 네 entry뿐이다. 모든 변경 package는 npm registry URL과 integrity를 가지며 install-script allowlist는 optional `fsevents@2.3.2`, Vite 내부 optional `fsevents@2.3.3` 두 개로 유지된다.
- Node `24.18.0`/npm `11.16.0`에서 `npm ci --ignore-scripts`, production/full npm audit 0건, artifact 1/1, source-less release 1/1이 통과했다. `bash scripts/verify.sh`는 Node tests 592 pass·기존 조건부 1 skip, Vite-dev는 8 pass·production-only 2 skip, production Playwright는 CSP·Socket.IO·Single/PVP/PVE를 포함해 35/35다.
- 기존 `tetris-ml` 환경은 수정하지 않았다. `/private/tmp`의 별도 prefix에서 `environment-ml.yml` exact pin을 clean resolve해 Python 115/115를 통과한 뒤 prefix를 제거했다. 기존 `npm run verify:ml`도 Node 35/35·Python 115/115를 통과했고 source/dist V4 model SHA-256은 모두 `ff64b0d3e4cd9eb6c6d7920f2cbe961f1d70e4c90ccc69a5d9ab8bcd410cb33d`다.
- `package.json`과 `environment-ml.yml` checksum은 기준과 동일하다. `environment-ml.yml`은 exact top-level pin을 제공하지만 전체 transitive package/build lockfile은 아니며, Conda solver와 defaults channel의 미래 metadata 변화는 남은 재현성 한계다.
- rollback은 현재 Goal 11B 문서 커밋을 먼저 revert한 뒤 dependency 커밋을 revert하고 `npm ci --ignore-scripts`로 기준 lock resolve를 복구한다. Python/Conda 파일은 변경하지 않아 별도 rollback이 없다.
- Goal 11B는 clean local merge gate에서 멈춘다. push, main merge, branch 삭제, Goal 11C와 보류된 Goal 8D/9/10/SPA는 수행하지 않는다.

## Migration Goal 11C Production Docker main integration (2026-07-22)

- Goal 11B가 반영된 main을 기준으로 `codex/add-production-docker`에서 official Node `24.18.0-bookworm-slim` digest를 고정한 multi-stage image를 추가했다. 이후 사운드 재시도 수정이 포함된 최신 main을 merge commit으로 동기화했으며 기존 Goal 11C 커밋과 Docker 계약을 보존했다. build dependency와 production dependency 설치를 분리하고 runtime에는 `dist`, production `node_modules`와 명시적인 `/app/data/logs` 경계만 둔다. package/lockfile과 dependency는 변경하지 않았다.
- runtime은 built-in `node` user로 실행하며 exec-form `CMD`, read-only root filesystem과 named JSONL volume을 사용한다. health check는 내부 상태를 노출하지 않고 `/`의 성공 여부만 확인한다. `.env`, credential, source, test, devDependency, first-party TypeScript와 source map은 image에 포함하지 않는다.
- SIGTERM은 Socket.IO session cleanup interval, disconnect grace timer와 authoritative room ticker를 idempotent하게 정리하고 Socket.IO가 연결된 HTTP server를 닫는다. 8초 상한을 두었고 실제 container는 0.16초, exit code 0으로 종료됐다. restart 뒤 named volume의 기존 JSONL이 유지됐다.
- production browser의 same-origin Socket.IO polling은 `Origin` header를 보내지 않는 실제 동작을 확인했다. exact origin allowlist 필수 정책과 cross-origin 거부를 유지하면서 `Sec-Fetch-Site: same-origin`과 allowlisted `Host`가 함께 맞는 경우만 no-Origin polling을 허용한다. 일반 no-Origin 요청과 forged/unlisted host·origin은 계속 거부한다.
- 동기화 코드로 새로 build한 local image는 `tetris-multi:goal11c-6d09a28`, image ID `sha256:6c5a00b67f4013d901f6913da89f5328299b5c5ccf3cd47e9d054e77886118db`, linux/arm64 88,083,089 bytes다. health `starting → healthy`, non-root/read-only, writable JSONL volume, 네 page·asset·Socket.IO client HTTP 200, CSP/security header, first-party TS/TSX/map 404와 public Socket.IO map 200 예외를 확인했다.
- container PVP/PVE Playwright는 6/6, `bash scripts/verify.sh`는 Node tests 594 pass·기존 조건부 1 skip, Vite-dev는 10 pass·production-only 2 skip, production Playwright는 37/37 통과했다. named volume은 재시작 전 484줄의 hash를 재시작 후 prefix에서 그대로 유지했고 lifecycle 로그 1줄을 append했으며, 최종 SIGTERM은 0.16초·exit code 0으로 종료됐다. production/full npm audit은 기존 Goal 11C 검증에서 모두 0건이다.
- 첫 production image라 실제 이전 image로의 downgrade는 검증할 대상이 없다. 현재는 commit tag와 image ID 재실행만 확인했으며, 다음 배포부터는 배포 전 현재 registry digest를 보존하고 실패 시 해당 digest로 동일 runtime 환경을 재기동한다. registry publish/deploy, amd64 build, 외부 TLS/reverse proxy와 장시간 soak는 미검증이다.
- Goal 11C는 main과 origin/main에 반영됐다. image publish/deploy, branch 삭제, Goal 11D와 보류된 Goal 8D/9/10/SPA는 수행하지 않았다.

## Migration Goal 11D CI execution gate (2026-07-23)

- Goal 11C가 반영된 main을 기준으로 `codex/add-migration-ci`에 GitHub Actions workflow 하나를 추가했다. `fast`, `browser`, `docker` 세 job은 `ubuntu-24.04`에서 실행하고 `.nvmrc`를 Node 단일 기준으로 사용한다. 실제 npm 버전은 출력만 하며 `11.16.0`으로 고정됐다고 주장하지 않는다.
- `fast`는 pull request에서 base/head merge-base부터 head까지, main push에서 `github.event.before`부터 `github.sha`까지 committed diff를 검사하고 수동 dispatch에서는 현재 HEAD commit을 검사한다. 이어 `npm ci --ignore-scripts`, `bash scripts/verify.sh`와 `npm run test:release`를 실행한다. `browser`는 독립 checkout·Node setup·clean install 뒤 기존 Playwright webServer lifecycle로 Chromium Vite-dev와 production PVP/PVE를 실행한다. `docker`는 registry push 없이 local image를 만들고 고유 container/volume, read-only root, JSONL writable volume, bounded health, HTTP/CSP/source-map 404와 SIGTERM exit 0을 확인한다.
- workflow 권한은 `contents: read`뿐이며 공식 `actions/checkout`과 `actions/setup-node`를 검증된 full commit SHA로 고정했다. npm cache는 `package-lock.json`에 연결하되 모든 job이 clean install을 수행해 cache miss에도 동작한다. trace, HTML report, JSONL을 포함한 실패 artifact는 redaction 정책 전까지 업로드하지 않는다.
- token rotation, stale credential 보존과 URL/DOM/console 비노출 E2E는 token 원문을 matcher에 넘기지 않는 boolean 비교로 바꿨다. 관련 production Playwright 19/19, canonical Node 594 pass·기존 조건부 1 skip, source-less release 1/1, Vite-dev 10 pass·2 skip, production Playwright 37/37과 Docker smoke가 통과했다. Docker smoke는 root HTML에서 동적으로 찾은 hashed module을 실제 HTTP 200으로 확인한 뒤 같은 module의 map 404를 확인한다.
- Draft PR [#1](https://github.com/Sleepingco/Tetris_multi/pull/1)의 GitHub-hosted `ubuntu-24.04` clean run [#1](https://github.com/Sleepingco/Tetris_multi/actions/runs/29960528790)에서 `Fast gate`, `Chromium PVP and PVE`, `Production container smoke`가 모두 통과했다. fast는 cache miss 후 저장, browser는 cache hit였고 Node 594 pass·기존 조건부 1 skip, release 1/1, Vite-dev 10 pass·2 skip, production 37/37과 Docker health/HTTP/CSP/artifact/shutdown이 통과했다. 의도적인 type/build/unit/E2E 실패 routing, main push·수동 dispatch event와 branch protection 연결은 실행하지 않았으며 사용자가 포트폴리오 범위의 수용된 미검증 위험으로 보류했다. 이를 검증했다고 주장하지 않고 workflow/branch-protection 변경 시 재검토한다. registry/deployment와 optional ML workflow는 수행하지 않았으며 Goal 11D는 PR merge gate다.
