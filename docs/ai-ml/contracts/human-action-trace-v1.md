# Human action trace v1 — 최소 수집 계약

- 날짜/Revision: 2026-10-28 / 취소 기록
- 상태: **cancelled_by_user — 신규 수집 취소, 관련 구현 제거**
- 기준: main / 77af682e6f4914bba6a0534e628c9cd4a2bebac6
- 목적: [관측 연결 감사](../experiments/human-action-observation-link-audit.md)의 빈틈을 최소 기록으로 보완한다.
- 사용자 계획은 기존 로그 활용이며 신규/전량 재수집이 아니다. 신규 수집을 취소하고 미커밋 구현·전용 테스트·fixture·준비 Notebook을 제거했다. 실제 Human pilot·배포·dataset 생성·학습·commit은 수행하지 않았다. [철회 기록](../../../ai-harness/runs/human-action-trace-v1-implement-smoke-2026-10-28.md)을 따른다.

**아래 1~10절은 취소된 설계·검증 이력이며 현재 실행 지시가 아니다.** 현행 방향은 [기존 로그 전용 AI 계획](../strategy/ai-plan.md)이다. 부족한 관측은 해당 과제의 한계로 표시하며 이 문서를 근거로 추가 수집을 자동 재개하지 않는다.

## 1. 목표와 선택

**그 시점에 공개된 상황 → Human 입력 시도와 결과 → 다음 관측**을 연결하고,
첫 행동 대기·조작 간격·공격/Hold 이후 행동을 구분할 증거를 남긴다.
사람의 생각·공격을 기다린 의도·물리 keydown을 관측했다고 주장하지 않는다.

첫 local pilot은 **기존 Human placement v3 안에 optional humanActionTrace를 추가**한다.

- 외부 placement schema/ruleset·identity 의미는 유지하고 내부 version=1을 별도 검증한다.
- 새 Socket event·테이블·migration·독립 전송 queue·매 frame 업로드는 만들지 않는다. 기존 단일 sink를 사용한다.
- 독립 chunk event는 event type/identity/DB 제약을 더 요구한다. 미완성 마지막 턴까지 보존하는 요구가 생기면 다음 revision으로 검토한다.
- Client 필드 추가만으로 끝내지 않는다. Validator/projector/canonical/저장 응답까지 보존을 검증한다.
- 기존 raw/v1 timing·B0~B3는 보존하고 trace를 과거 로그에 추정해 채우지 않는다.

### 수용하는 한계

연결 종료·보정으로 placement가 폐기되면 그 trace도 저장되지 않을 수 있다.
따라서 모든 무입력/실패/마지막 행동을 수집했다는 주장은 금지한다.
수집된 placement에 조건부인 선택 편향을 명시하며, 별도 background flush/retry/dual-write로 조용히 보완하지 않는다.
미완결 마지막 조각을 학습 대상으로 살리거나 기존 품질 정책을 변경하는 작업도 포함하지 않는다.

## 2. 공개 관측 계약

관찰 단계는 client_public_state_available이다.
공개 gameplay 상태가 local 표시/입력 계층에 제공된 시점이지 실제 화면 paint·사람의 지각 시각은 아니다.
기존 placement observation.stage=post_line_clear와 별개의 trace 계약이다.

| 필드 | v1 의미·검증 |
| --- | --- |
| view | rowStart=16, rows=24, cols=10, nextCount=4. 현재 상단 표시 4행+기본 20행. 다른 layout/ruleset은 별도 지원 전 거부 |
| boardVersions | 공개 고정 보드를 row-major 240문자로 저장. 0 empty / 1 bar / 2 eleft / 3 eright / 4 ess / 5 square / 6 tree / 7 zee / 8 garbage |
| boardRef | 이미 등록된 boardVersions index. 고정 보드가 바뀔 때만 새 값을 등록하고 동일 값 재사용 |
| activeCells/ghostCells | 화면 범위의 cell 좌표 각각 0~4개. 내부 row 16~39, col 0~9. 안 보이는 cell은 제외, ghost 미표시는 빈 배열. 내부 pivot/rotation/숨은 전체 cell을 feature로 넣지 않음 |
| next | HUD에 제공한 공개 next 4개. 없는 칸 null. 전체 bag/저장 queue 금지 |
| holdPiece | 당시 표시된 Hold 종류 또는 null |
| holdAvailable | 자기 턴/Hold 이력과 규칙으로 아는 사용 가능 여부. 화면 버튼 표시를 관측한 값이라는 주장은 하지 않음 |
| pendingGarbageLines | 당시 HUD에 제공된 0 이상의 safe integer. 서버 hole/미래 공격/도착 예정 시간을 추정해 추가하지 않음 |
| inputReady | 실제 session/runtime의 입력 허용 상태. 준비 화면·countdown은 ready 시작점이 아님 |
| pieceEpoch | trace 내 조각 관측 세대. ready=0, 성공 Hold 등 교체 시 증가. 기존 pieceIndex 의미를 바꾸지 않음 |

Metric은 공개 보드에서 파생한다. 내부 40행 metric을 같은 관측으로 섞지 않는다.
중력/lock 내부 잔여 예산은 실행 안전성에 유지하지만 v1 모델 입력에는 넣지 않는다.
필요하면 별도 privileged-state 실험으로 비교한다.

## 3. 시간·연결·마감 계약

### Clock

- 처음 inputReady=true가 된 공개 상태의 ready 기록을 trace 원점으로 삼는다.
- atMs는 동일 performance.now 계열 시계에서 원점을 뺀 값을 내림한 정수다. 같은 ms는 i 순서로 구분하며 0ms를 허용한다.
- 기존 inputSequence.createdAt은 유지한다. 새 atMs는 wall clock 변환값이 아니다. 서버/DB 시각·tick×16과 혼합하지 않는다.
- traceId는 32 hex random ID로 원점 구간을 구분한다. 인증 정보가 아니며 다른 trace 사이 시간을 연결하지 않는다.
- ready 누락/mid-piece 시작은 startKind=partial, status=incomplete다. 첫 입력을 원점으로 바꿔 반응시간 0을 만들지 않는다.
- visibility loss·clock 이상·실제 snapshot rebase/단절은 첫 pilot에서 incomplete로 닫는다. 일반 pending-garbage 갱신은 정상 관측 사건이다.

### Payload

Human/v3 placement에만 optional humanActionTrace를 허용한다.
Game/player/ruleset/좌표와 inputSequence는 외부 event를 참조하고 중복 복사하지 않는다.
AI/fallback 행동은 Human trace로 저장하지 않는다.

| 필드 | 계약 |
| --- | --- |
| version/status | version=1. status=complete 또는 incomplete |
| clientBuild | 실제 source manifest의 SHA-256(64 hex). Manifest는 git SHA·dirty 여부·관련 source/lock SHA를 ignored evidence로 보관. 누락 시 수집 비활성화/명시적 오류. 서버 HEAD로 대체 금지. Client 주장이지 인증 증명은 아님 |
| clock/observationStage | segment_monotonic_ms / client_public_state_available 고정 |
| startKind | ready 또는 partial. complete는 ready만 가능 |
| events | i는 0부터 연속, atMs는 비감소. Observation/action을 하나의 순서에 저장 |
| Observation | kind=observation. reason=ready/pre_action/post_action/hold_changed/public_change/correction. 위 공개 관측을 포함 |
| Action | kind=action, inputIndex(기존 inputSequence의 0-based index), beforeObservation(앞선 observation의 i), applied boolean, reason(실패 enum 또는 null) |
| end | atMs, reason, inputCount(외부 inputSequence 길이). 정상 reason=placement_commit. Incomplete 사유는 아래 고정 목록 |

Action 이름/기존 timestamp를 다시 복사하지 않는다. inputIndex를 사용하고 봉인할 때 immutable 복사본과 대조한다.
이 index·기존 sequence와 server clientSequence는 다른 식별자이므로 숫자만 같다고 join하지 않는다.
Applied/reason은 local runtime 판정이다. 서버 승인/실제 Human 키 입력 성공으로 이름을 바꾸거나 신뢰 수준을 올리지 않는다.
Action outcome은 applied=true면 reason=null, false면 현재 runtime의 HOLD_NOT_AVAILABLE/NO_PIECE_AVAILABLE/INVALID_PLAYER_STATE/MOVE_RETRY/MOVE_NOT_HANDLED/UNSUPPORTED_ACTION 중 하나다. 새 이유를 지원하려면 계약과 test를 함께 개정한다.

Complete trace는 외부 inputSequence의 모든 index를 순서대로 정확히 한 번 포함해야 한다.
각 action 직전에 새 pre_action 관측을 채집하고 같은 처리 단계의 atMs로 연결한다.
Action의 beforeObservation은 바로 앞 event(i-1)의 pre_action이고 같은 atMs여야 한다.
Board version은 최초 참조 순서로 index를 붙인다. 분석기는 나중 version을 이전 feature로 펼치거나 pool 전체를 입력으로 사용하지 않는다.
Action→outcome 사이에 await를 넣지 않는다.
Stale piece로 실행하지 않은 큐 항목은 기존 inputSequence 대상이 아니므로 임의 학습 action으로 추가하지 않는다.

일반 action은 직후 post_action 관측도 남긴다. 성공 Hold는 이를 hold_changed 관측으로 대신하고 새 pieceEpoch를 남긴다.
Terminal action은 end로 닫으며 새 턴의 상태를 이전 조각의 post_action으로 붙이지 않는다.
공격 표시 변화는 local에 반영한 뒤 public_change로 남긴다.
중력 이동은 매 frame 기록하지 않고 다음 pre_action에서 관측한다.
따라서 full engine replay 파일이나 연속 영상은 아니며 보이지 않는 중간 궤적을 복원했다고 주장하지 않는다.

### 예측 기준점과 시간 label을 구분한다

주 행동/대기 예측 기준점은 ready·post_action·hold_changed·public_change다.
그 뒤 다음 action attempt까지의 시간과 action을 label 후보로 연결한다. 기준점과 target 사이 clock/coverage가 확인돼야 한다.
도중 새 외부 관측이 들어오면 이전 예측 구간은 그 시점에서 중단된 것으로 표시하고 새 관측에서 다시 시작한다.
후속 dataset에서 중단 구간의 처리 방식을 명시하며 다음 action이 있었다고 단순 완결 대기 label을 만들지 않는다.

Pre_action→같은 action은 행동 분류의 순간 진단에는 쓸 수 있지만 대부분 atMs 차이가 0이다.
이를 기다림 예측의 주 학습 표본으로 만들거나, 미래 pre_action 상태를 이전 기준점의 feature로 가져오지 않는다.
Post_action→다음 attempt는 기존 attempt→attempt 간격과 label이 다르므로 기존 CRPS와 직접 개선 비교하지 않는다.

### 마지막 action과 로그 봉인 순서

현재 hard_drop→placement finalize가 recordInputOutcome보다 먼저 실행될 수 있다.
구현 시 placementContext가 **이전 조각의 trace owner**를 보존하고 terminal outcome을 붙인 뒤에만 로그를 봉인/알림 처리한다.
Line-clear 지연 여부로 outcome/finalize 도착 순서가 달라도 정확히 한 번 봉인한다.
자연 gravity lock은 action을 만들지 않고 마감한다.
새 턴이 먼저 시작돼도 이전 outcome을 새 trace에 붙이지 않는다.
게임 판정·spawn·gravity 순서 및 authoritative receipt 조건을 변경하지 않는다.

### 누락·무입력·종료

Incomplete reason은 missing_ready/action_limit/event_limit/board_limit/byte_limit/time_limit/
visibility_loss/local_rebase/clock_error/collection_backpressure로 고정한다.
한도를 넘기려 할 때 append를 멈추고 마지막 관측 종료 시각과 최초 이유를 보존한다.
첫 dataset은 incomplete trace 전체를 상태 조건부 학습에서 제외하고 사유/행동 수/난이도 편향을 보고한다.

자율 gravity lock으로 action 없이 끝난 complete trace는 다음 행동을 관측하지 못한 유한 구간이다.
다음 action label이나 end까지의 시간을 행동 시간으로 만들지 않는다.
공격/공개 상태 갱신으로 관측이 바뀌면 다음 action까지 남은 시간의 기준도 그 관측 지점으로 구분한다.
이전 시점 feature에 뒤에 도착한 상태를 넣지 않는다. Hold 후 첫 대기와 spawn 첫 대기는 별도 label이다.

기존 inputLog overflow로 placement 자체가 미전송되는 정책은 유지한다.
Trace만 한도를 넘으면 유효 base placement는 버리지 않고 최소 incomplete metadata를 함께 남긴다.
전체 log/envelope 한도 때문에 최소 metadata도 넣지 못하면 client가 trace 수집 실패를 명시하고 base만 봉인한다. 이 경우 trace 완료로 집계하지 않는다.
Malformed trace를 서버가 조용히 삭제/수정해 저장하지 않는다. 잘못된 요청은 명시적으로 거부한다.
연결 종료로 저장 event가 아예 없으면 lifecycle/piece gap과 수집 실패로 표시하고 무입력으로 간주하지 않는다.

## 4. 합성 예제 — Hold 후 자연 고정

아래는 trace만 발췌한 구조 예다. 외부 inputSequence[0].action은 hold다.
Ready 0ms→Hold 200ms→교체 후 관측 200ms→자연 고정 12000ms다.
12000ms를 두 번째 action의 시간 label로 만들지 않는다. ID/빌드는 가짜 값이다.

~~~json
{
  "version": 1,
  "status": "complete",
  "traceId": "00000000000000000000000000000001",
  "clientBuild": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "clock": "segment_monotonic_ms",
  "observationStage": "client_public_state_available",
  "view": {"rowStart":16,"rows":24,"cols":10,"nextCount":4},
  "boardCodec": "cells-v1",
  "boardVersions": ["000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"],
  "startKind": "ready",
  "events": [{"i":0,"atMs":0,"kind":"observation","reason":"ready","pieceEpoch":0,"boardRef":0,"activeCells":[[18,3],[18,4],[18,5],[18,6]],"ghostCells":[[39,3],[39,4],[39,5],[39,6]],"next":["tree","square","ess","bar"],"holdPiece":"square","holdAvailable":true,"pendingGarbageLines":0,"inputReady":true},{"i":1,"atMs":200,"kind":"observation","reason":"pre_action","pieceEpoch":0,"boardRef":0,"activeCells":[[18,3],[18,4],[18,5],[18,6]],"ghostCells":[[39,3],[39,4],[39,5],[39,6]],"next":["tree","square","ess","bar"],"holdPiece":"square","holdAvailable":true,"pendingGarbageLines":0,"inputReady":true},{"i":2,"atMs":200,"kind":"action","inputIndex":0,"beforeObservation":1,"applied":true,"reason":null},{"i":3,"atMs":200,"kind":"observation","reason":"hold_changed","pieceEpoch":1,"boardRef":0,"activeCells":[[18,4],[18,5],[19,4],[19,5]],"ghostCells":[[38,4],[38,5],[39,4],[39,5]],"next":["tree","square","ess","bar"],"holdPiece":"bar","holdAvailable":false,"pendingGarbageLines":0,"inputReady":true}],
  "end": {"atMs":12000,"reason":"placement_commit","inputCount":1}
}
~~~

## 5. Resource 예산과 저장량

아래는 **v1 local pilot 제안 상한**이다. 실제 운영 수용량이나 학습 품질 근거가 아니다.
직렬화한 UTF-8 bytes를 검사하고 먼저 도달하는 한도를 적용한다.

| 항목 | 상한·처리 |
| --- | --- |
| trace bytes | 64 KiB. 전체 raw log와 canonical envelope도 각각 기존 256 KiB 이하 검증 |
| actions / events / boardVersions | 64 / 512 / 32. 한 board value는 240 ASCII bytes |
| 관측 길이 | 120000ms 초과면 time_limit 중단. Label clipping/게임 강제 종료 아님 |
| 보관 총량 | active·봉인/전송 대기 trace 합계 256 KiB, 미확인 봉인 trace 최대 4개. 초과 시 새 수집만 중단/표시 |
| Trace ACK deadline | 전송 후 5000ms. 미확인 시 ACTION_TRACE_ACK_TIMEOUT으로 이번 game의 새 trace 수집 중단, ID/byte 추적 해제. 자동 재전송 없음 |
| 전송 | placement당 기존 한 번. placementLog 60건/10초 및 single-sink in-flight/retry 상한 유지 |

새 queue/service 없이 기존 buffer의 trace byte를 계수한다.
봉인 뒤 immutable 값을 전달하고 ACK 추적에는 ID/bytes만 남겨 full trace를 복제하지 않는다.
표시 callback·전송/DB Promise를 input/ticker에서 await하지 않는다. 실패는 redacted code로 보고한다.

### 합성 JSON 직렬화 계산

보드 한 version, 같은 공개 상태, ASCII build ID, action마다 pre_action+action+post_action,
처음 ready 한 개의 compact JSON을 직렬화했다. 물리 게임/처리 시간/압축/JSONB 용량 측정이 아니다.

| 입력 수 | Event 수 | trace bytes |
| ---: | ---: | ---: |
| 4 | 13 | 3,763 |
| 8 | 25 | 6,571 |
| 16 | 49 | 12,216 |
| 32 | 97 | 23,512 |
| 64 | 193 | 46,228 |

8 actions/placement 가정에서 100 placement 약 0.66MB, 300 placement 약 1.97MB의 **추가 trace**다.
기존 log·ACK echo·DB index/JSONB 비용은 제외한다. 보드 변화/공격 갱신이 많으면 한도에 빨리 닿는다.
Pilot에서 실제 bytes/game·완전 수집률·overflow 사유·처리 시간과 분포를 pandas/Matplotlib로 보고한다.
한도는 운영 실측 없이 자동 확대하지 않는다.

## 6. 저장·버전·보안·활성화

- 외부 schemaVersion=3의 의미·identity는 유지한다. humanActionTrace.version=1은 명시적 optional extension이다. 없는 과거 event는 계속 읽는다.
- Trace 존재 시 Human/v3/ruleset/view/enum/count/time/ref/bytes를 엄격 검증한다. Unknown version/key·중복 index·미래 참조·NaN/Infinity·잘못된 board/cell은 거부한다.
- 동일 event identity에 처음 봉인한 bytes만 보낸다. Base 저장 후 trace를 붙여 재게시하면 conflict이므로 금지한다.
- 새 서버는 구 client의 trace 없는 event를 허용한다. 구 서버는 새 필드를 버릴 수 있으므로 pilot은 맞는 빌드 조합만 쓴다.
  기존 game:log:result.log의 raw 또는 canonical payload에서 기대 trace ID/version 보존을 확인한다.
  ok=true만으로 성공 처리하지 않고 누락이면 ACTION_TRACE_NOT_PRESERVED로 pilot을 중단한다.
- 현재 인가·room/player 소유권·receipt를 유지한다. Token/nickname/socket ID/IP/URL/원시 key event를 trace에 넣지 않는다.
- Client trace는 client_reported다. 구조/receipt/checksum 검증은 인간의 실제 인지·정직한 플레이를 인증하지 않는다.
- JSONL 또는 명시적 PostgreSQL 단일 sink와 기존 retry/drain/실패 보고를 유지한다. Optional JSONB extension만을 위한 migration은 제안하지 않는다.
  PostgreSQL 실제 round-trip은 구현 검증에서 통과했다. 운영 DB·실제 Human pilot 검증을 뜻하지 않는다.

**기본 off**이며 첫 범위는 local Vite-dev PVE/PVP Human이다. 새 UI·싱글·공개 서버 수집은 제외한다.
VITE_HUMAN_ACTION_TRACE_BUILD_ID에 위 source manifest SHA를 넣은 dev 실행에서만 session→runtime 수집 옵션을 전달한다.
Production build는 이 pilot 옵션으로 켜지지 않게 한다. 환경변수 지정 자체는 실행 승인이 아니다.
Frontend에는 비밀이 아닌 SHA만 노출한다. 빌드 manifest가 없는 값을 임의로 발급해 과거 버전 근거로 쓰지 않는다.
Manifest는 src 아래 source(.ts/.tsx/.js/.mjs/.json), package-lock.json, vite.config.mjs의 상대 경로/파일 SHA를 정렬해 보관하고 git SHA/dirty 상태를 진단값으로 둔다. 해당 경로의 신규 미추적 source도 포함하며 .env·credential·파일 본문은 포함하지 않는다. Build ID는 이 manifest의 정규화 JSON SHA-256이다. 실제 source 상태가 달라지면 manifest/ID를 다시 생성한다.

공개 서비스의 동의·보관 기간·사용자 요청 처리 정책은 아직 제공되지 않았다.
이를 코드에서 추정하지 않으며 외부 수집 전 별도 결정한다. DB 자동 삭제/정리·새 backup 체계도 추가하지 않는다.

## 7. 파일별 구현 영향 지도

아래는 책임 경계 지도다. 구현 파일·실제 검증 목록은 실행 기록에 별도로 남긴다.

| 경계 | 실제 파일·필요한 최소 변경 |
| --- | --- |
| 수집·ready/Hold/마감 | [tetris.ts](../../../src/client/game/runtime/tetris.ts): 공개 snapshot·bounded trace·stable input index/outcome·terminal 순서·자연 lock |
| Session·보정·단절 | [multiplayerGameSession.ts](../../../src/client/game/entry/multiplayerGameSession.ts): 수집 옵션/중단·기존 commit buffer의 봉인/byte 수명주기 |
| 공개 표시 근거 | [displayBridge.ts](../../../src/client/game/runtime/displayBridge.ts), [tetrisRender.ts](../../../src/client/game/render/tetrisRender.ts): 공개 범위 재사용. 표시/규칙 변경·DOM 역수집 없음 |
| Dev/ACK 오류 | [tetrisMulti.tsx](../../../src/client/pages/tetrisMulti.tsx), [logClient.ts](../../../src/client/net/logClient.ts): default off와 trace 보존 확인. 별도 React game state 금지 |
| Wire/인가 | [socketContracts.mjs](../../../src/shared/socketContracts.mjs), [multiplayerHandlers.ts](../../../src/server/sockets/multiplayerHandlers.ts): 기존 roomId/log wrapper·인증/receipt/한도 유지. 새 event 불필요 |
| 검증/보존 | [gameLogValidator.ts](../../../src/server/validators/gameLogValidator.ts), [gameEventProjector.ts](../../../src/server/services/gameEventProjector.ts), [canonicalGameEvent.ts](../../../src/server/db/canonicalGameEvent.ts): optional strict 검증/복사. 같은 검증은 작은 shared 순수 validator 하나로 재사용 |
| 저장 회귀 | [runtimeEventStorage.ts](../../../src/server/services/runtimeEventStorage.ts), [postgresEventRepository.ts](../../../src/server/repositories/postgresEventRepository.ts): single sink/identity/상한 유지, round-trip 검증. 새 저장 service/테이블 없음 |
| Export/분석 | [기존 export](../../operations/deployment/postgres-production-runbook.md#db-내용을-csv-또는-jsonl로-export)의 payload 보존. Readiness parser를 재사용하는 후속 Notebook/새 dataset revision. legacy placement exporter로 v3 우회 금지 |

## 8. 수용 기준과 구현 검증

모든 AC는 필수다. AC-001~006은 합성 runtime/session·저장 테스트로 검증했다. AC-007의 준비 Notebook은 합성 smoke만 통과했으며 실제 pilot·운영량 측정과 전체 ML gate는 보류다.

| AC | 시작 조건·행동 → 기대 결과 / 금지 부작용 | 검증 |
| --- | --- | --- |
| AC-001 시간 | Countdown 뒤 실제 입력 가능→ready, 첫 action까지 같은 clock 차이. 동일 ms·wall-clock 역전에도 순서 유지. 첫 입력 이전을 0으로 채우지 않음 | Fake clock runtime test: ready 전 입력·무입력 natural lock·visibility/clock 오류 |
| AC-002 공개 상태 | 숨은 행/queue가 있는 상태→저장에는 row 16~39/next 4개만. Action 직전 공개 상태와 일치, 원본 mutation 없음 | Codec/관측 test와 현재 renderer/HUD 계약 대조 |
| AC-003 Hold/봉인 | 성공/실패·동일 조각 Hold·즉시/line-clear hard drop→정확한 outcome, 성공 때만 epoch 증가. 새 턴과 순서가 달라도 terminal 누락/중복 없음 | [Input test](../../../test/testInputTimingBatching.js)/[session test](../../../test/testMultiplayerGameSession.js)를 참고한 synthetic 회귀 |
| AC-004 사건/누락 | 공격 표시→public_change. Rebase/단절/상한→incomplete/폐기+이유. 미래 상태/미기록 구간을 이전 feature/WAIT label로 만들지 않음 | Fake snapshot/garbage/visibility/한도 경계 test와 사유별 표 |
| AC-005 저장 경계 | Malformed/oversize/unsupported/ref 오류→거부. 정상 optional trace→raw/canonical에 같은 의미로 보존. 과거 event bytes 불변 | Validator/projector/canonical test, JSONL·임시 PostgreSQL round-trip, secret/unknown key 거부 |
| AC-006 자원/호환 | Off·느린/실패 ACK·같은 ID→기존 gameplay/base 경로·single sink/상한 유지. Off는 trace 필드 없음, 구 server 누락은 명시적 실패 | Socket/session test·off/on 고정 입력 비교·bytes/in-flight test·관련 Chromium smoke |
| AC-007 Pilot/재현 | 명시 승인 local pilot→source manifest/checksum·complete/incomplete·action/Hold/공격/무입력 coverage·로그량·처리 시간 보존. 자동 학습/정책 채택 없음 | Notebook Smoke/Full 분리, pandas/Matplotlib, immutable report. 필수 verify·관련 ML/DB 결과 구분 |

현재 구현은 collector/검증·저장 보존·synthetic smoke까지다. 기존 사용자 Notebook의 출력/Full 설정과 충돌하는 ML gate를 정리할 방침을 별도로 합의한 뒤 사용자 pilot gate를 검토한다.
Targeted 뒤 bash scripts/verify.sh, 변경 범위의 ML/DB/브라우저 검증을 적용한다.
Full/pilot 수집·운영 배포·dataset 생성·학습을 자동 시작하지 않는다.
기존 Notebook output/count 관련 ML gate를 사용자 출력 삭제나 검사 약화로 해결하지 않는다.

## 9. 위험·rollback·미결정

| 위험 | 처리·현재 상태 |
| --- | --- |
| 부피/CPU 증가 | 제안 cap·보드 중복 제거. 실제 브라우저 시간/완전 수집률 미측정 |
| 마지막 미완결/긴·복잡한 턴 제외 편향 | Embedded v1의 제한. Pilot에서 제외 원인·mode/difficulty 분포를 보고 완전 수집으로 홍보하지 않음 |
| 시점/clock 누수 | 공개 관측·동일 clock·input index 검증. 관측 가능과 인지/의도를 구분 |
| 보안/정책 | 인가·단일 sink·신원 최소화. 공개 수집의 동의/보관 정책은 미결정이며 local 밖 진행 차단 |
| 혼합 버전 | ACK/readback trace 누락은 실패. 구 데이터 변환·재기록 없음 |

Rollback은 dev 수집 옵션 off다. 서버 optional reader/validator는 남겨 이미 저장한 trace를 읽는다.
구 server로 되돌릴 때도 저장된 같은 event를 다시 게시하지 않는다.
운영 row/volume·raw·artifact 삭제나 identity 재작성은 없다.

다음 gate는 **기존 사용자 출력 보존과 ML 검사 정합 방침 결정**이다. 이를 해결하기 전 전체 완료나 실제 pilot 준비 완료로 선언하지 않는다. 모델 선정/승격 기준·실제 pilot 데이터·공개 수집 정책은 결정하지 않았다.

## 10. 이번 설계 검증 기록

아래는 2026-10-27 설계 당시의 기록이다. 2026-10-28 구현 결과로 대체해 읽지 않는다.

- 합성 JSON의 ID 형식·240-cell board·관측 좌표·event/time 순서·input index·pre_action 참조·Hold outcome을 assert로 확인했다.
- 별도 Python 직렬화로 4/8/16/32/64 actions의 3,763/6,571/12,216/23,512/46,228 bytes를 재계산해 표와 일치함을 확인했다. 실제 수집기/서버 validator 테스트가 아니다.
- 변경 문서 9개 상대 링크 307개·앵커 22개·fence/공백 검사를 통과했다.
- 문서만 변경해 전체 테스트·브라우저/DB 검증은 실행하지 않았다. 기존 사용자 실행 Notebook·dirty 파일·ML 전체 gate 보류는 보존했다. Stage/commit은 하지 않았다.

## 11. 사용자 취소와 구현 철회 (2026-10-28)

- Runtime collector/schema·session ACK 추적·page dev 옵션·Vite manifest gate·서버 optional payload 보존·전용 Node/DB 검사를 철회했다. 추가했던 source 파일·fixture·pilot 준비 Notebook은 제거했다.
- 기존 placement v3 수집과 JSONL/PostgreSQL 저장, 기존 source·dataset·timing Notebook·사용자 출력·동시 UI 변경을 보존했다. 운영 DB row/volume을 삭제하거나 재기록하지 않았다.
- 실제 Human trace 수집이나 학습은 시작하지 않았으므로 새 trace dataset을 원복할 작업은 없다. 임시 합성 검증 증거는 실제 학습 데이터가 아니다.
- 기존 자료의 행동열/간격/Hold 시도는 계속 활용한다. 미기록 상태/공격 반응/첫 대기의 증거 부족은 한계로 남기며 모든 로그의 재수집을 강제하지 않는다.
