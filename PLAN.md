# PLAN

- Role: 이 문서는 현재 저장소의 단일 기준 문서다.
- Use: 현재 사실, 구조, 멀티 방향, 다음 액션을 한 곳에서 본다.
- Last update: 2026-07-21 기준. main `3b235dd` 위 Goal 3 후보 branch는 Zod runtime schema와 schema-derived Socket payload type, server/browser 수신 검증 경계를 준비해 merge gate에 있다. Goal 4의 server TypeScript 전환은 시작하지 않았다.

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

- 기준은 local `main@2d4d66e`이며 Goal 0 main 반영 commit `57152ce`를 포함한다.
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

- 기준은 `main@21d191f`이며 Goal 1 main 반영을 포함한다.
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

- 기준은 `main@3b235dd`이며 Goal 2의 최종 terminal disconnect 수정까지 포함한다.
- production dependency `zod@4.4.3`을 exact version으로 추가하고, server CommonJS와 Vite browser가 함께 import하는 `src/shared/socketContracts.mjs`에 handshake, 12개 C2S와 16개 S2C schema를 둔다.
- `src/shared/socketContractTypes.d.ts`는 wire payload를 `z.input`, parse 이후 payload를 `z.output`으로 파생한다. 현재 JavaScript handler는 `checkJs:false`이므로 compile-time Socket.IO generic 강제를 주장하지 않으며 그 적용은 Goal 4 범위다.
- production runtime parse는 server의 handshake/C2S 수신과 browser의 S2C 수신에서 한 번만 수행한다. client outbound와 server outbound에는 parse wrapper를 추가하지 않고 실제 fake socket/server emission을 계약 테스트로 검증한다.
- server app event 순서는 active session 확인, server-derived rate key, Zod parse, room/host/status authorization, input queue, service/domain 호출로 고정했다. stale socket은 정상 player rate bucket을 소모하지 않는다.
- strict control envelope, UUID/room/token 형식, nickname/chat 길이, transform/board/DTO 중첩 구조와 숫자·enum 범위를 검증한다. authoritative board의 기존 `garbage` cell은 허용하되 active piece와 piece queue는 7개 tetromino enum을 유지한다.
- invalid payload는 기존 event별 result channel에서 `INVALID_PAYLOAD`만 반환한다. raw payload, unknown key, Zod issue와 stack은 응답·로그에 포함하지 않으며 game input의 안전한 정수 sequence/piece metadata만 보존한다.

### 기존 domain과 browser 호환성

- placement log 외부 `{roomId, log}`만 strict 처리하고 256 KiB 제한, private-field scan과 기존 `validatePlacementDecisionLog`를 유지한다. server가 roomId/playerId를 인증된 socket 값으로 덮어쓴 뒤 human v1/v2 domain validation과 저장을 수행한다.
- `game:bag:request`는 기존 `ensurePlayerBagQueue` low-water 경계를 사용한다. queue가 충분하면 mutation 없이 `BAG_QUEUE_SUFFICIENT`를 반환하고 client pending을 해제하며, 부족할 때만 정확히 7개 chunk를 broadcast한다. 장시간 queue/bagChunks에 schema-only hard cap은 추가하지 않았다.
- `roomClient`의 모든 S2C application listener가 shared schema를 통과한다. `logClient`의 raw socket 우회를 제거했고 invalid S2C는 handler를 호출하지 않는다. invalid `session:ready`는 credential을 지우지 않고 terminal protocol 오류로 연결을 중단한다.
- 정상 PVP/PVE payload 의미와 Goal 2의 session/token, reconnect, origin/rate 정책은 유지했다. 존재하지 않는 방 E2E는 실제 8자리 방 코드 형식의 미존재 값으로 fixture를 바로잡았다.

### 검증, bundle과 남은 위험

- Node 24.18.0/npm 11.16.0에서 `bash scripts/verify.sh`가 diff check, typecheck, 124-module build와 Node test 570개 중 569개 통과, 기존 조건부 1개 skip으로 통과했다.
- 전체 Chromium Playwright는 PVP/PVE/session/reconnect/rollback/single을 포함해 24/24 통과했다. 첫 실행의 2건 실패는 invalid 7자리 room fixture와 정상 garbage snapshot schema 누락을 드러냈고, 계약/fixture 수정 후 전체를 다시 통과했다.
- production dependency-only 임시 설치에서 Express, Socket.IO와 Zod만으로 server를 기동했다. `/`, 네 page, Socket.IO client와 대표 built JS/CSS가 모두 HTTP 200을 반환했다.
- 기준 build의 `roomClient` chunk는 4.10 kB(gzip 1.59 kB)였고 Zod 기반 S2C runtime 검증 후 75.41 kB(gzip 20.78 kB)로 증가했다. 증가는 raw 71.31 kB, gzip 19.19 kB이며 향후 bundle 최적화는 정상 계약을 바꾸지 않는 별도 판단 대상이다.
- strict schema에 정상 protocol variant가 새로 발견되면 해당 event group의 schema와 parity fixture를 함께 보완해야 한다. 외부 TLS/reverse proxy, WebKit/Firefox, 장시간 malformed traffic/soak와 실제 TypeScript Socket.IO generic은 이번 Goal에서 검증하지 않았다.
- Goal 3는 merge gate에서 멈추며 push, PR, main merge, branch 삭제와 Goal 4는 별도 승인 전 수행하지 않는다.

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

### 2026-07-19 요약

- 멀티 MVP는 기존 `client snapshot relay` 중심 구조에서 `server authoritative snapshot` 중심 구조로 전환됐다.
- 서버는 player별 `authoritativeState`를 들고 `game:input`과 room ticker gravity step으로 상태를 갱신한다.
- 상대 보드는 `game:authoritative:snapshot`만 full apply한다.
- 내 보드는 client prediction을 우선하고, server snapshot은 제한적으로 적용한다.
- client-driven `game:snapshot`, `game:garbage:attack`, `game:over` gameplay 경로는 제거됐다.
- garbage 원천은 server `authoritativeState.pendingGarbageQueue`다.
- client DTO에는 표시용 `pendingGarbageLines` scalar를 내려준다.
- server gameOver가 match finish의 원천이다.
- match cleanup, client sequence acknowledgment, roomId collision retry가 보강됐다.
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
- [x] `src/server/services/matchService.js`에 match 생성, player별 server bag chunk와 authoritative state 로직 존재
- [x] `src/server/sockets/multiplayerHandlers.js`에 `room:create`, `room:join`, `room:leave`, `room:start`, `game:join`, `game:input`, `game:bag:request`, `disconnect` 흐름 존재
- [x] `src/server/sockets/chatHandlers.js`에 `global:chat`, `room:chat` 흐름 분리
- [x] `src/client/net/roomClient.js`에 room/chat/game 이벤트 adapter 함수 존재
- [x] `src/client/pages/multiLobby.html`에서 방 코드, 상태, player 수 표시와 방 입장/나가기 UI 연결
- [x] 로비 채팅을 `global:chat` / `room:chat`으로 분리
- [x] 채팅 입력은 1초 1회 서버 rate limit과 plain text 렌더링 기준 적용
- [x] `game:input` 배관: 클라이언트 입력을 서버 검증 후 authoritative state에 적용하고 ack/snapshot 전송
- [x] `game:snapshot` 1차 배관 추가: 클라이언트 snapshot을 서버 검증 후 상대에게 전달했던 초기 단계 완료. 현재 gameplay 경로에서는 제거된 legacy 흐름이다.
- [x] `game:bag:request` / `game:bag:append` 1차 배관 추가: 서버가 player별 bag chunk를 생성해 room에 전달
- [x] `match:finish` 배관: server authoritative top-out 기준 승패 결과 broadcast. client `game:over` handler는 제거됐다.
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
- [x] roomId 충돌 재시도와 client sequence acknowledgment 추가
- [x] `src/client/game/core/boardMetrics.js`에 `columnHeights`, `aggregateHeight`, `maxHeight`, `holes`, `bumpiness`, `completeLines` 계산 순수 함수 추가
- [x] `test/testBoardMetrics.js`로 board metric과 mutation 방지 검증

### 부분 완료

- [~] `src/client/game/runtime/tetris.js`는 예전의 전역 싱글 파일 단계에서는 벗어남
- [~] `src/client/game/runtime/tetris.js`는 여전히 크고 orchestration 외 책임이 남아 있음
- [~] RNG 주입 구조는 있음
- [~] 기본 RNG는 아직 `Math.random`
- [~] 로비와 멀티 게임 흐름은 연결됐고, 포트폴리오 시연 완료 전 garbage/gameOver/reconnect를 포함한 브라우저 2탭 전체 흐름의 수동 회귀 검증이 필요함
- [x] 내 보드 prediction/correction 정책은 sequence/ack·gravity timing 보강 후 rollback 전용 2탭 E2E 반복 검증을 통과함
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
- shadow/debug 방향은 현재 main 우선순위가 아니다. 해결된 rollback 경로는 기존 회귀 테스트로 감시하고, 재현 증거 없이 debug 시스템이나 correction 방어를 추가하지 않는다.
- AI 쪽은 이미 구현된 `boardMetrics`를 기반으로 `placementGenerator` -> `simulatePlacement` -> `heuristicEvaluator` -> PVE AI Player 순서로 진행한다.
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

- 상세 계획: `docs/codebase-cleanup-plan.md`
- Goal 실행 프롬프트: `docs/codebase-cleanup-goal-prompt.md`
- 상태: Phase 0~5 완료, 최종 검증 통과
- 순서: 확정된 dead leaf 삭제 → client local garbage 제거 → 미사용 input relay 제거 → 조건부 server inputLog 제거 → 남은 test setup 축소
- cleanup은 migration이나 새 기능과 섞지 않고, 각 단계를 독립 검증·커밋한다.

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
  - 상대 runtime은 `autoStart: false`이며, server input relay 없이 authoritative snapshot만 적용한다.
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
- `shouldCorrectSnapshot`은 own authoritative snapshot correction 기준을 판정한다.
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
  - production static root는 `dist/client`다.
- `src/server/services/roomService.js`
  - `Map` 기반 메모리 room 상태를 관리한다.
  - `createRoom`, `joinRoom`, `removePlayer`, `removePlayerBySocketId`, `leaveRoom`, `startGame`, `leaveGame`, `syncRoom`, `finishGame`, `getRoomState`를 제공한다.
- `src/server/services/matchService.js`
  - `Map` 기반 메모리 match 상태를 관리한다.
  - `createMatch`, `getMatchState`, `deleteMatch`, `appendPlayerBagChunk`, `getAuthoritativePlayerSnapshotDto`, `resetMatches`를 제공한다.
  - player별 `lastProcessedClientSequence`, `bagChunks`, `authoritativeState`를 갖는다.
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
  - `global:chat`, `room:chat`, `chat:result` 흐름을 담당한다.
  - 채팅 입력 검증, 1초 rate limit, room 채팅 권한 확인을 담당한다.

### Client network layer

- `src/client/net/roomClient.js`
  - 브라우저 Socket.IO room adapter다.
  - create/join/leave/start 요청, room result/update/message 구독, global/room chat 송수신, game join/input/bag/authoritative snapshot/finish 함수를 제공한다.
  - 제거된 legacy gameplay source `game:snapshot`, `game:garbage:attack`, `game:over` 경로는 제공하지 않는다.

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
- `game:input`은 서버 검증 후 server authoritative state에 적용되고 sender ack와 room snapshot으로 수렴한다.
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
- [x] Step 2. `game:input` 최소 이벤트 정의 및 서버 검증/authoritative 적용
- [x] Step 3. `roomService`와 분리된 match state/service 초안 추가
- [x] Step 4. 서버가 local player용 `server bag` 또는 spawn stream을 관리
- [x] Step 5. 초기 서버 match state에 input log 저장 경로 구현 후, consumer 부재를 확인한 cleanup에서 제거
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
        "lastProcessedClientSequence": 0,
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
- `clientSequence`를 검증해 중복·역순 입력을 거부한다.
- 정상 input을 server authoritative state에 적용한다.
- authoritative apply 성공 시 `game:authoritative:snapshot`을 emit한다.
- lock 결과로 garbage attack이 생기면 target player의 authoritative snapshot도 즉시 emit한다.
- 실패 시 요청자에게 `game:input:result`를 보낸다.

### `game:snapshot`

현재 상태:
- legacy client-driven snapshot handler는 제거됐다.
- client session은 `game:snapshot`을 송신하지 않으며 상대 보드는 `game:authoritative:snapshot`만 따른다.

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

현재 서버에는 `game:snapshot` listener가 없다.

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
- legacy client report handler는 제거됐다.
- client session은 `game:over`를 송신하지 않는다.

과거 payload 형태:

```json
{
  "roomId": "ABCD1234",
  "playerId": "player_a",
  "reason": "top_out"
}
```

현재 서버 처리:
- `game:over` listener는 없다.
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
