# PLAN

- Role: 이 문서는 현재 저장소의 단일 기준 문서다.
- Use: 현재 사실, 구조, 멀티 방향, 다음 액션을 한 곳에서 본다.
- Last update: 2026-07-17 기준. `codex/stabilize-migration-baseline`에서 현재 Vanilla JS + Express + Socket.IO 싱글/PVP/PVE 기준선을 검증했다. migration 기술은 아직 도입하지 않았고, own board rollback gate는 실제 input 송신을 확인하도록 보강한 뒤 5회 반복에서 재현되지 않았다. 최종 `npm test`, `scripts/verify.sh`, 전체 Playwright가 모두 통과해 checkpoint는 migration 전 병합 준비 상태다.

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

## Migration Baseline Gate (2026-07-17)

### 범위 고정

- 현재 기준 기술은 Vanilla JS + Express + Socket.IO + Node 내장 테스트 + Playwright다.
- Vite, React, TypeScript, PostgreSQL 의존성이나 설정은 이 기준선에 포함하지 않는다.
- 게임 규칙, 점수, garbage 수치, UI 동작은 이번 안정화에서 변경하지 않는다.
- migration은 아래 기능 동등성 gate가 모두 통과한 checkpoint 이후에만 시작한다.

### 현재 구현 기준

- 싱글
  - local runtime이 입력, 중력, hold, next queue, score, line clear, gameOver를 소유한다.
  - browser E2E는 이동, 회전, soft drop, hard drop, 점수 증가, board 고정을 확인한다.
- PVP
  - 서버 `authoritativeState`가 최종 gameplay state다.
  - own board는 local prediction을 사용하고, 상대 board는 authoritative snapshot만 full apply한다.
  - `clientSequence` / `lastProcessedClientSequence`가 input acknowledgment 경계를 만든다.
  - 같은 player의 socket input과 gravity는 authoritative mutation queue에서 직렬화된다.
  - garbage와 gameOver는 client report가 아니라 server lock/ticker 결과가 원천이다.
- PVE
  - `heuristic_ai` player와 normal/hard 난이도가 구현되어 있다.
  - AI는 reachable planner의 `plannedActions`를 human과 같은 authoritative input 경로로 실행한다.
  - AI attack, garbage, gameOver, lobby restart는 기존 authoritative match lifecycle을 재사용한다.

### 기능 동등성 체크리스트

- [x] 싱글 페이지가 실제 브라우저에서 준비되고 기본 이동/회전/soft drop/hard drop 후 board와 score가 갱신된다.
- [x] PVP 두 독립 browser context에서 create -> join -> host start -> play가 동작한다.
- [x] server gameOver 후 양쪽 결과가 일치하고 두 player가 lobby로 돌아오면 같은 room을 다시 시작할 수 있다.
- [x] 빠른 좌우 이동, 회전, soft drop, hard drop의 6개 입력이 실제 WebSocket으로 전송된 뒤 source/observer board가 수렴한다.
- [x] 수렴한 PVP board가 서로 다른 authoritative snapshot tick 2회 동안 이전 fingerprint로 돌아가지 않는다.
- [x] rollback gate를 5회 반복해 Host/Guest 양방향 총 30 placement에서 known own board rollback이 재현되지 않았다.
- [x] server garbage attack이 상대 `pendingGarbageQueue`와 `pendingGarbageLines` authoritative snapshot에 반영된다.
- [x] PVE E2E에서 AI attack이 human pending 표시 후 다음 lock에 실제 board garbage로 적용된다.
- [x] `game:leave`는 ticker와 match를 정리한다.
- [x] playing 중 일시 disconnect는 reconnect를 위해 match/ticker를 유지하고, 명시적 leave 또는 정상 gameOver가 cleanup 경계가 된다.
- [x] PVE normal/hard action cadence, human T-Spin, garbage, gameOver, lobby restart가 browser E2E에서 동작한다.
- [x] tracked Node test baseline이 509/509 통과한다.
- [x] Playwright 기존 14개 PVP/PVE test가 통과한다.
- [x] 싱글 기본 플레이 Playwright characterization test를 추가하고 통과했다.
- [x] 전체 `npm test`가 최종 연속 2회 519/519 통과한다.
  - 첫 실행에서는 기존 미커밋 parity 작업의 임시 dataset에 `rejected.jsonl`이 없어 4개가 실패했지만, 후속 두 전체 실행에서는 같은 실패가 재현되지 않았다.
  - 해당 기존 미커밋 파일은 수정하거나 checkpoint에 포함하지 않았다.
- [x] `bash scripts/verify.sh`가 전체 519/519 test와 Git diff check를 통과한다.
- [x] 전체 Playwright 15/15가 통과한다.
- [x] `npm start`로 서버가 기동되고 `/`가 HTTP 200을 반환한다.

### Rollback 재현 판정

- 최초 3회 반복에서는 1회 실패했지만, artifact상 source/observer canvas는 모든 관찰에서 계속 동일했다.
- 실패 원인은 세 번째 placement의 첫 4개 입력만 송신된 상태에서 active piece가 하단 canvas 관찰 영역에 들어온 것을 test가 settled board 변화로 오인한 것이었다.
- 회귀 gate는 첫 burst 4개와 전체 6개 입력이 실제 `game:input` frame으로 송신됐는지 확인한 뒤 수렴/안정성을 판정하도록 보강했다.
- 보강 후 5회 반복, 양방향 30 placement에서는 rollback이 재현되지 않았다.
- 남은 위험:
  - Chromium local 환경과 고정 입력 시나리오 기준이다.
  - packet loss, 높은 외부 latency, 장시간 soak, 여러 브라우저 엔진은 아직 검증하지 않았다.
  - 따라서 “known reproduction 없음”이지 일반적인 rollback 가능성이 수학적으로 제거됐다는 의미는 아니다.

### Migration 시작/병합 gate

- 현재 gameplay 기준선 자체는 코드와 browser E2E로 확정됐다.
- `bash scripts/verify.sh`, `npm test`, `npm run test:e2e`, 서버 기동 gate가 모두 통과해 이 checkpoint를 migration 기능 동등성 비교의 출발점으로 사용할 수 있다.
- 초기 parity fixture 실패는 최종 실행에서 재현되지 않았지만, 외부 미커밋 작업이 계속 변하는 작업 트리에서는 checkpoint commit과 해당 작업을 분리해 관리한다.
- checkpoint 병합 후에도 migration 기술 도입은 별도 변경으로 시작하고, 이 체크리스트를 기능 동등성 회귀 기준으로 유지한다.

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
- AI 구현의 다음 축은 ML 학습이 아니라 휴리스틱 PVE AI 상대와 로그 축적이다.
- PVE AI는 추천 코치가 아니라 실제 게임에 참여하는 AI 상대다.
- Python AI 서버, 강화학습, LLM 코칭은 `placementGenerator` / `simulatePlacement` / `heuristicEvaluator` / PVE AI Player가 안정화된 뒤 검토한다.

## Current Status

### 2026-07-10 요약

- 멀티 MVP는 기존 `client snapshot relay` 중심 구조에서 `server authoritative snapshot` 중심 구조로 전환됐다.
- 서버는 player별 `authoritativeState`를 들고 `game:input`과 room ticker gravity step으로 상태를 갱신한다.
- 상대 보드는 `game:authoritative:snapshot`만 full apply한다.
- 내 보드는 client prediction을 우선하고, server snapshot은 제한적으로 적용한다.
- client-driven `game:snapshot`, `game:garbage:attack`, `game:over` gameplay 경로는 제거됐다.
- garbage 원천은 server `authoritativeState.pendingGarbageQueue`다.
- client DTO에는 표시용 `pendingGarbageLines` scalar를 내려준다.
- server gameOver가 match finish의 원천이다.
- match cleanup, inputLog 상한, roomId collision retry가 보강됐다.
- `src/client/game/core/boardMetrics.js`에 휴리스틱 AI와 향후 ML feature 재사용을 위한 순수 board metric 함수가 구현됐다.
- `test/testBoardMetrics.js`가 board metric 계산과 원본 board mutation 방지를 검증한다.
- 자동 테스트 기준으로 멀티 MVP 핵심 구현은 완료에 가깝다.
- 포트폴리오 시연 완료 판정은 2탭 수동 회귀 통과 후로 둔다.

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
- [x] `src/server/sockets/multiplayerHandlers.js`에 `room:create`, `room:join`, `room:leave`, `room:start`, `game:join`, `game:input`, legacy `game:snapshot`, `game:bag:request`, legacy `game:over`, `disconnect` 흐름 존재
- [x] `src/server/sockets/chatHandlers.js`에 `global:chat`, `room:chat`, legacy `chatting` 흐름 분리
- [x] `src/client/net/roomClient.js`에 room/chat/game 이벤트 adapter 함수 존재
- [x] `src/client/pages/multiLobby.html`에서 방 코드, 상태, player 수 표시와 방 입장/나가기 UI 연결
- [x] 로비 채팅을 `global:chat` / `room:chat`으로 분리
- [x] 채팅 입력은 1초 1회 서버 rate limit과 plain text 렌더링 기준 적용
- [x] `game:input` 1차 배관 추가: 클라이언트 입력을 서버 검증 후 같은 room 상대에게 전달
- [x] `game:snapshot` 1차 배관 추가: 클라이언트 snapshot을 서버 검증 후 상대에게 전달했던 초기 단계 완료. 현재 gameplay 경로에서는 제거된 legacy 흐름이다.
- [x] `game:bag:request` / `game:bag:append` 1차 배관 추가: 서버가 player별 bag chunk를 생성해 room에 전달
- [x] `game:over` / `match:finish` 1차 배관 추가: top out 기준 승패 결과 broadcast. 현재 승패 확정은 server authoritative top-out 경로가 담당하고, client `game:over`는 legacy 입력으로 남아 있다.
- [x] 멀티플레이 garbage cancel / combo / back-to-back / T-Spin attack 규칙 1차 추가
- [x] `src/client/game/core/tSpin.js`에 T-Spin lock 판정 pure function 추가
- [x] `src/client/game/core/attackState.js`에 combo/back-to-back 상태 전이 pure function 추가
- [x] `src/client/game/core/garbage.js`에 garbage cancel/apply/attack 계산 pure function 정리
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
- [x] roomId 충돌 재시도와 `inputLog` 상한 추가
- [x] `src/client/game/core/boardMetrics.js`에 `columnHeights`, `aggregateHeight`, `maxHeight`, `holes`, `bumpiness`, `completeLines` 계산 순수 함수 추가
- [x] `test/testBoardMetrics.js`로 board metric과 mutation 방지 검증

### 부분 완료

- [~] `src/client/game/runtime/tetris.js`는 예전의 전역 싱글 파일 단계에서는 벗어남
- [~] `src/client/game/runtime/tetris.js`는 여전히 크고 orchestration 외 책임이 남아 있음
- [~] RNG 주입 구조는 있음
- [~] 기본 RNG는 아직 `Math.random`
- [~] 로비와 멀티 게임 흐름은 연결됐고, 포트폴리오 시연 완료 전 브라우저 2탭 기준 반복 회귀 검증이 필요함
- [~] 멀티 게임은 server authoritative snapshot 기반으로 전환됐지만, 내 보드 조작감과 correction 정책은 2탭 체감 검증이 필요함
- [x] `src/client/pages/tetrisMulti.html`의 `snapshotTimer`에서 bag request와 game over 보고 조건을 함수 단위로 분리했다.
- [x] `src/client/game/runtime/tetris.js`에서 T-Spin 판정과 공격 상태 전이 일부를 core pure function 호출로 분리했다.
- [~] `placementResult.backToBack`은 현재 “이번 lock 이후 상태”가 아니라 “이번 공격 계산에 사용된 이전 B2B 상태”에 가깝다. 추후 필요하면 `backToBackBefore` / `backToBackAfter`처럼 의미를 명확히 나누는 정리를 검토한다.

### 아직 미구현

- [ ] 완전한 deterministic multiplayer
- [ ] 서버/클라이언트 완전 동일 deterministic replay
- [ ] 상대 보드 line clear 표시용 effect
- [ ] `match:ready` 같은 명시적 준비 상태
- [ ] 방 목록, quick match, match 결과 화면

### 현재 판단

- 현재 구조는 "싱글 런타임 정리 + 멀티 로비 + server authoritative 멀티 MVP" 단계다.
- 실제 멀티 게임의 최종 진실 원천은 server authoritative state로 이동했다.
- 내 보드는 조작감을 위해 client prediction을 유지하고, 서버 snapshot은 gameOver/garbage 적용 등 제한된 상황에서만 full apply한다.
- shadow/debug 방향은 현재 main 우선순위가 아니다. debug 시스템을 다시 키우지 않고, 2탭 회귀 통과 후 AI 분석 로그와 평가 지표로 넘어간다.
- AI 쪽은 이미 구현된 `boardMetrics`를 기반으로 `placementGenerator` -> `simulatePlacement` -> `heuristicEvaluator` -> PVE AI Player 순서로 진행한다.
- 현재 `boardMetrics`는 core board 표현을 그대로 읽는 DOM-free 순수 함수라서 `src/client/game/core`에 둔다. 서버/클라이언트/AI가 더 넓게 공유하는 시점이 오면 `shared` 계층으로 이동할 수 있다.

### 2026-07-15 멀티 안정화 개선사항

#### P0: 간헐적 own board rollback

- 현재 관찰된 문제:
  - 사용자가 조각을 lock 직전 위치까지 이동하거나 회전했는데, own authoritative correction이 적용되면서 직전 위치로 되돌아가는 현상이 간헐적으로 남아 있다.
  - 자동 테스트에서는 sequence/ack 경계가 통과하지만 실제 브라우저 플레이에서는 아직 완전히 해결됐다고 판단하지 않는다.
- 현재 적용된 방어:
  - client input마다 단조 증가하는 `clientSequence`를 전송한다.
  - server player metadata의 `lastProcessedClientSequence`로 처리 완료 경계를 관리한다.
  - server acknowledgment 전 input이 있으면 own snapshot full correction을 보류한다.
  - 최신 acknowledgment보다 오래된 deferred snapshot은 폐기한다.
  - 같은 socket의 input은 server에서 직렬 처리한다.
  - 중복·역순 sequence는 input log 저장과 상대 relay 전에 거부한다.
  - `PIECE_INDEX_MISMATCH`와 authoritative 내부 예외도 terminal result로 acknowledgment한다.
- 남은 조사 범위:
  - 빠른 좌우 이동, 연속 회전, soft drop 유지, hard drop, lock 직전 입력 중 어떤 순서에서 재현되는지 고정한다.
  - rollback 직전의 local/server `clientSequence`, `lastProcessedClientSequence`, `pieceIndex`, `phase`를 비교한다.
  - deferred snapshot이 pending input 해소 직후 적용되는 경우와 server lock이 먼저 확정되는 경우를 구분한다.
  - 원인을 확인하기 전 correction 조건, lock delay 또는 snapshot 주기를 임의로 완화하지 않는다.
- 완료 기준:
  - 2탭 반복 플레이에서 lock 직전 이동·회전이 이전 상태로 돌아가지 않는다.
  - correction 후에도 own input loop, gravity, line clear effect가 유지된다.
  - A가 보는 A board와 B가 보는 A board가 lock 이후 정상적으로 수렴한다.
  - garbage 적용, gameOver, reconnect sequence 재개가 회귀하지 않는다.
- 이 문제는 전체 rollback netcode 구현과 다르다. 현재 목표는 stale authoritative snapshot이 정상적인 local prediction을 되감는 경로를 제거하는 것이다.

#### P2: 입력별 full snapshot 전송 최적화

- 현재 구조는 authoritative input이 성공할 때마다 room에 full snapshot을 보내므로 소수 사용자 MVP에는 충분하지만 동시 room이 많아지면 board 복사, JSON 직렬화, 네트워크 전송 비용이 커질 수 있다.
- 이 최적화는 rollback 원인 추적과 섞지 않고, rollback 안정화와 커밋 이후 별도 작업으로 진행한다.
- 목표 전송 정책:
  - 매 input: sender에게 작은 `game:input:result` acknowledgment만 전송한다.
  - 일반 이동 상태: player별 최신 snapshot을 모아 약 100ms 주기로 trailing coalescing한다.
  - lock, line clear presentation, garbage 적용, gameOver: 즉시 full snapshot을 전송한다.
  - `PIECE_INDEX_MISMATCH`, `AUTHORITATIVE_INPUT_FAILED`, game join/reconnect: 즉시 correction snapshot을 전송한다.
  - 상대 client가 더 이상 소비하지 않는 `game:input` relay는 참조를 확인한 뒤 제거 후보로 둔다.
- 구현 시 지켜야 할 조건:
  - coalescing 구간의 마지막 authoritative state를 반드시 전송한다.
  - `presentationEffect` 같은 일회성 결과를 일반 snapshot 병합 과정에서 잃지 않는다.
  - own board는 local prediction으로 즉시 반응하고, 상대 보드는 주기적 authoritative snapshot으로 갱신한다.
  - rapid input 5개가 100ms 안에 들어오면 acknowledgment는 5개, 일반 movement snapshot은 최대 1개가 되는지 테스트한다.
  - lock/garbage/gameOver snapshot은 주기적 flush를 기다리지 않는지 테스트한다.

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
  - `startMultiplayerGame(...)`을 호출해 local runtime과 opponent runtime, socket listener, heartbeat cleanup을 구성한다.
  - local 입력은 `game:input`으로 서버에 보내고, local runtime prediction에도 enqueue한다.
  - 상대 runtime은 `autoStart: false`이며, 상대 입력 relay를 예측 실행하지 않는다.
  - 상대 보드는 `game:authoritative:snapshot`을 full apply한다.
  - 내 보드는 client prediction을 우선하고, own authoritative snapshot은 pending garbage 표시와 제한된 correction에만 사용한다.
  - server bag chunk를 받아 local/opponent runtime에 append한다.
  - `match:finish`를 받아 승패 표시와 로비 복귀 버튼을 처리한다.
  - 현재 heartbeat는 server bag 부족 확인/request만 유지한다.
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
- `src/client/game/core/tSpin.js`
  - `isTSpinLock`
- `src/client/game/core/attackState.js`
  - `resolveAttackState`
- `src/client/game/core/garbage.js`
  - `calculateGarbageAttack`
  - `resolveGarbageCancel`
  - `applyGarbageLines`
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
- `shouldCorrectSnapshot`은 legacy client snapshot correction 테스트 기준으로 남아 있다.
- 현재 멀티 gameplay의 주 snapshot은 서버가 만든 `game:authoritative:snapshot`이다.
- 상대 보드는 authoritative snapshot을 full apply한다.
- 내 보드는 prediction 우선 정책을 유지하며, 다음 경우에만 full apply한다.
  - `snapshot.phase === "gameOver"`
  - local phase가 `lineClearing`이 아니고, `pendingGarbageLines`가 감소했으며, server board가 local board와 다른 경우

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
  - `createMatch`, `getMatchState`, `deleteMatch`, `recordInput`, `appendPlayerBagChunk`, `getAuthoritativePlayerSnapshotDto`, `resetMatches`를 제공한다.
  - player별 `inputLog`, `bagChunks`, `authoritativeState`를 갖는다.
  - `inputLog`는 player별 1000개 상한을 갖고, `nextInputSequence`로 전체 입력 순서를 유지한다.
- `src/server/services/authoritativeTickerService.js`
  - room별 authoritative gravity ticker lifecycle을 관리한다.
  - 100ms interval에서 500ms 누적 기준으로 gravity step과 snapshot emit을 처리한다.
- `src/server/services/authoritativeMatchFinish.js`
  - input 경로와 ticker 경로의 authoritative gameOver side effect를 공통 처리한다.
  - ticker stop, `match:finish`, `deleteMatch`, `game_over` log 저장을 한 곳에서 관리한다.
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
  - create/join/leave/start 요청, room result/update/message 구독, global/room chat 송수신, game join/input/bag/authoritative snapshot/finish 함수를 제공한다.
  - legacy gameplay source였던 `game:snapshot`, `game:garbage:attack`, `game:over` 송신 경로는 사용하지 않는다.
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
- [x] local 입력을 `game:input`으로 서버에 전송하고, 서버가 room/player/action 검증 후 상대에게 전달
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

## Current Phase

### 현재 단계

- 이름: Server authoritative multiplayer MVP final verification

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
- [x] server authoritative snapshot 기반 멀티 보정으로 전환
- [x] `game:input` 기반 server authoritative input apply 연결
- [x] room/start/game sync MVP는 연결됨
- [x] 현재 멀티 게임은 server bag + server authoritative state + authoritative snapshot 기반으로 동작
- [x] garbage cancel / combo / back-to-back / T-Spin attack은 서버 lock 결과 기준으로 처리
- [x] T-Spin, back-to-back, combo, 일반 line clear의 B2B reset은 runtime 통합 테스트로 `placementResult` 반영을 검증함
- [~] shadow/debug 실험은 별도 브랜치로 분리했고, main에서는 바로 확장하지 않음
- [x] authoritative input/ticker loop 시작
- [ ] 2탭 수동 회귀로 MVP 완료 판정

### 현재 단계의 핵심 문제

- `src/client/game/runtime/tetris.js`가 아직 크다.
- 현재 snapshot의 주 원천은 server authoritative state다.
- `game:input`은 서버 검증/전달/inputLog 저장뿐 아니라 server authoritative state에도 반영된다.
- 상대 보드는 로컬 예측 실행이 아니라 authoritative snapshot으로만 갱신된다.
- deterministic 설계는 방향만 있고, 현재 MVP 구현 기준은 아니다.
- `src/client/pages/tetrisMulti.html`의 멀티 세션 책임은 `src/client/game/entry/multiplayerGameSession.js`로 분리됐다.
- 2탭 회귀 검증으로 authoritative snapshot, bag request, garbage, game over 흐름을 확인해야 한다.
- `placementResult.backToBack`은 현재 계산에 사용된 이전 B2B 상태를 나타내므로, 테스트와 문서에서 “이번 lock 이후 상태”로 오해하지 않도록 주의해야 한다.

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
   - room create / join / start
   - 양쪽 입력 반응
   - 상대 보드가 authoritative snapshot으로 자연스럽게 갱신되는지 확인
   - 내 보드 line clear effect가 끊기지 않는지 확인
   - incoming garbage 숫자와 실제 garbage board 적용이 맞는지 확인
   - Tetris, combo, B2B, T-Spin attack이 실제 플레이에서 체감되는지 확인
   - top-out / gameOver / match finish / lobby 복귀 확인
   - leave / disconnect / 재입장 흐름 확인
2. 상대 보드 line clear 표시용 effect 검토
   - 서버 snapshot DTO에 표시용 `lineClearEffect`를 넣을지 결정한다.
   - 소리는 재생하지 않는다.
   - 같은 effect가 반복 재생되지 않도록 `pieceIndex` 또는 effect key를 둔다.
3. 휴리스틱 PVE AI 단계 진입 준비
   - `boardMetrics`는 이미 구현된 기반으로 본다.
   - 다음 구현 순서는 `placementGenerator` -> `simulatePlacement` -> `heuristicEvaluator` -> PVE AI Player다.
   - PVE AI는 추천 코치가 아니라 실제 상대다.
   - placement decision log와 PVE AI 선택을 비교할 수 있게 최소 feature를 정리한다.
   - LLM은 아직 붙이지 않고, 휴리스틱 PVE AI와 로그 축적을 먼저 만든다.
4. 문서/커밋 정리
   - server authoritative 전환 커밋과 안정화 커밋을 구분해 유지한다.
   - `.DS_Store` 같은 로컬 파일은 커밋하지 않는다.

### 권장 구현 순서

- [x] Step 1. 로비 create/join/leave/disconnect 브라우저 검증
- [x] Step 2. `game:input` 최소 이벤트 정의 및 서버 검증/전달
- [x] Step 3. `roomService`와 분리된 match state/service 초안 추가
- [x] Step 4. 서버가 local player용 `server bag` 또는 spawn stream을 관리
- [x] Step 5. 서버 match state에 input log를 저장
- [x] Step 6. local/remote 한 화면에서 상태 차이가 눈에 보이게 만들기
- [~] Step 7. 멀티 gameplay 회귀 검증: garbage cancel / combo / back-to-back / T-Spin attack
  - core/runtime 자동 테스트는 보강됨
  - 브라우저 2탭 체감 검증은 아직 필요함
- [x] Step 8. `tetrisMulti.html`의 snapshot timer 책임을 작은 함수로 분리
- [x] Step 8-1. 상대 보드 score/lines drift를 snapshot correction 조건에 포함
- [x] Step 8-2. T-Spin / attack state / garbage cancel 계산 일부를 core pure logic으로 분리
- [x] Step 8-3. T-Spin / B2B / combo / B2B reset runtime 통합 테스트 추가
- [x] Step 9. 서버가 input으로 game state를 계산할 수 있는 core 함수/서버 wrapper 연결
- [x] Step 10. server authoritative input/ticker loop 추가
- [x] Step 11. 서버 authoritative snapshot 방향으로 전환
- [ ] Step 12. 2탭 수동 회귀 통과
- [x] Step 13-0. `boardMetrics` 순수 함수와 Node 테스트 추가
- [ ] Step 13-1. `placementGenerator` 설계/구현
- [ ] Step 13-2. `simulatePlacement` 설계/구현
- [ ] Step 13-3. `heuristicEvaluator` 설계/구현
- [ ] Step 13-4. PVE AI Player 설계/구현

### 이후 단계

- [ ] deterministic RNG를 실제로 주입 가능한 구조로 마무리
- [ ] seed 기반 replay 실험
- [x] authoritative tick과 snapshot 주기 1차 정리
- [ ] 2탭 회귀 통과 후 multiplayer MVP 완료 선언
- [ ] multiplayer MVP 완료 후 휴리스틱 PVE AI 단계로 이동
- [ ] 플레이 로그 수집과 사용자 행동 feature 추출
- [ ] PVE AI 선택과 사용자 선택 비교 지표 추가
- [ ] ML/RL은 휴리스틱 baseline과 로그가 안정화된 뒤 검토
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
- 이후 server authoritative state에 input을 best-effort로 적용한다.
- authoritative apply 성공 시 `game:authoritative:snapshot`을 emit한다.
- lock 결과로 garbage attack이 생기면 target player의 authoritative snapshot도 즉시 emit한다.
- 실패 시 요청자에게 `game:input:result`를 보낸다.

### `game:snapshot`

현재 상태:
- legacy client-driven snapshot event다.
- server authoritative 전환 후 gameplay source로 사용하지 않는다.
- client session은 더 이상 `game:snapshot`을 송신하지 않는다.
- 상대 보드도 `game:snapshot`이 아니라 `game:authoritative:snapshot`을 따른다.

과거 payload 형태:

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

legacy 서버 처리:
- room 참가자인지 확인한다.
- `snapshot.board`가 배열인지 최소 검증한다.
- 정상 snapshot relay 경로는 남아 있을 수 있으나, 현재 client gameplay는 이를 사용하지 않는다.
- 실패 시 요청자에게 `game:snapshot:result`를 보낸다.

### `game:authoritative:snapshot`

현재 구현 기준:

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
    "pieceQueue": ["square", "zee"],
    "holdPieceType": "bar",
    "holdUsedThisDrop": false,
    "score": 1200,
    "lines": 4,
    "phase": "playing",
    "combo": 1,
    "backToBack": true,
    "tick": 42,
    "pieceIndex": 10,
    "pendingGarbageLines": 3
  }
}
```

현재 클라이언트 처리:
- `playerId === opponentPlayerId`이면 opponent runtime에 full apply한다.
- `playerId === my playerId`이면 `pendingGarbageLines`를 표시한다.
- 내 snapshot full apply는 `gameOver` 또는 garbage 적용 correction 조건을 통과한 경우로 제한한다.

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
- room ticker를 멈추고 `deleteMatch(roomId)`로 match를 정리한다.
- 요청자에게 `game:leave:result`를 보낸다.

### `game:over`

현재 상태:
- legacy client report event다.
- server authoritative 전환 후 match finish의 원천으로 사용하지 않는다.
- client session은 더 이상 `game:over`를 송신하지 않는다.

과거 payload 형태:

```json
{
  "roomId": "ABCD1234",
  "playerId": "player_a",
  "reason": "top_out"
}
```

현재 서버 처리:
- legacy `game:over`는 match finish를 처리하지 않는다.
- 실제 game over는 server authoritative input/ticker lock 결과에서 발생한다.
- authoritative game over는 `finishAuthoritativeMatch()`가 처리한다.

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
- 상대 line clear 표시용 effect event 또는 snapshot field

## Later Roadmap

### 멀티 MVP 이후

- [ ] 배포와 운영 기초 정리
- [ ] `placementGenerator` 추가
- [ ] `simulatePlacement` 추가
- [ ] `heuristicEvaluator` 추가
- [ ] PVE AI 상대 추가
- [ ] 플레이 로그 기반 사용자 패턴 분석
- [ ] 사용자 행동과 PVE AI 선택 비교
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
- 현재 구현된 AI 기반은 `src/client/game/core/boardMetrics.js`다.
- 현재 다음 구현 순서는 `placementGenerator` -> `simulatePlacement` -> `heuristicEvaluator` -> PVE AI Player다.
- PVE AI는 추천 코치가 아니라 실제 AI 상대다.
- rule-based PVE AI를 먼저 만들고, 이후 ML/RL은 비교 가능한 지표와 로그 위에서 확장한다.
- Python AI 서버는 현재 범위가 아니며, JavaScript 순수 함수 baseline이 안정화된 뒤 검토한다.
- LLM은 보조 설명 계층이다.
- LLM 입력은 원본 게임 로그 전체가 아니라 요약 통계, 주요 실수 장면, PVE AI 선택 행동, 사용자 행동 차이를 중심으로 구성한다.
- LLM이 판단을 대신하지 않는다. 판단은 휴리스틱/ML 분석 계층에서 만들고, LLM은 그 결과를 자연어로 설명한다.

## Existing Docs Note

- `ROADMAP.md`: 상위 방향 문서였음. 핵심 방향은 이 문서에 흡수했다.
- `PROTOCOL.md`: 멀티 철학은 유지하되, MVP 기준은 `seed`보다 `server bag`으로 수정 반영했다.
- `PHASE1_PLAN.md`: 오래된 계획서 성격이 강해서 "진행 현황"과 "다음 액션"으로 흡수했다.
- 가능하면 이후에는 이 `PLAN`을 기준으로 유지하고, 나머지 문서는 보조 기록 또는 아카이브로 두는 편이 좋다.
