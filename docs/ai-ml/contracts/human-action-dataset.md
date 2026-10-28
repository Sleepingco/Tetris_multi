# Human 조작 dataset 설계 계약

상태: 첫 timing-only 게임 정책 `quality-policy-v1` 승인, full dataset·B0~B2 Validation/B2 Test·B3 Full Validation 해석 완료. 2026-10-28 사용자 결정으로 신규 action trace 수집은 취소했다. **기존 로그만 활용**하며 dataset schema·split·label·원본은 유지한다. [관측 연결 감사](../experiments/human-action-observation-link-audit.md)의 한계 안에서 확인 가능한 행동열·리듬·Hold 시도부터 범위를 정한다. 새 dataset 생성·전체 상태 복원·학습은 자동 시작하지 않는다.
[현재 계획](../strategy/ai-plan.md)에 따라 품질 경계를 학습 전에 고정한다.

## 목적과 단위

배치 candidate row와 별도로 game/player/piece의 실제 입력 구간을 학습 단위로 한다.
후보별 metadata에 복사된 inputSequence를 반복 표본으로 세지 않는다.
한 턴 안에서 hold로 조각이 바뀌면 action 경계로 구분하고 pieceIndex만으로
동일 조각이라고 가정하지 않는다.

| 학습 과제 | 관측 입력 | 정답 |
| --- | --- | --- |
| 조작 간격 | 현재까지의 문맥·이력, 현재 계획한 행동 | 해당 행동까지의 대기시간 |
| 다음 행동 | 현재 상태·이력, 사용하는 경우 목표 배치 | 다음 Human action |
| Hold 여부 | hold 직전 보드·현재 조각·보관 조각·공개 next·사용 가능 여부 | hold 사용/미사용 |

입력 feature는 예측 시점까지 이용 가능한 값만 사용한다. 관측하지 못한 과거를
미래의 최종 배치·hold·queue에서 가져와 채우지 않는다. Human이 최종 선택한
배치를 조건으로 쓰는 오프라인 실험은 그 조건을 명시하고, 사이트에서는 실제
배치 정책이 제공한 목표로 따로 검증한다.

## 기존 로그와 v3 해석

### 상황 조건부 확장 전 확인할 계약 — 설계, 미구현

- 예측 지점의 입력은 그 시점에 사람이 알 수 있었던 보드·활성 조각·공개 next·Hold 가능 여부·알려진 incoming garbage·최근 행동/시간이다. 필드 존재뿐 아니라 관찰 시점과 연결 근거를 확인한다.
- 서버 확정 상태와 Human에게 표시된 상태를 구분한다. Placement 고정 직전 `boardBefore`/queue/Hold를 모든 action 직전으로 소급 복사하지 않는다.
- 다음 action과 그때까지의 대기를 함께 다루되, 조각 관측 가능 시점→첫 action / action 사이 / 외부 사건 관측 이후를 구분한다. 현재 timing v1은 첫 행동 대기를 포함하지 않는다.
- 무입력 구간의 시작·관측 종료·누락을 확인한다. 종료/끊김 때문에 다음 입력을 못 본 구간은 큰 시간 label이나 전략적 WAIT로 만들지 않는다. 생각·의도·공격을 기다린 이유는 직접 관측 label이 아니다.
- client 처리 시각과 server 수신 시각 등 다른 clock을 그대로 빼지 않는다. 입력 attempt와 실제 outcome, Hold 교체 전/후, 중간 garbage/보정의 사건 순서를 확인한다.
- 관측 중 변화가 생기면 새 관측 지점을 정의하고 미래 사건을 이전 feature에 넣지 않는다. 대기 취소·재판단의 학습 표본 계약과 실행 계약을 맞춘다.
- 현재는 semantic action 모방이다. keydown/keyup/repeat/DAS/ARR를 복원했다고 주장하지 않는다. 필요한 새 기록은 수집 비용·개인정보·누락/잘림 표시와 함께 별도 승인한다.
- 과제별 verified / timing-only / unverified를 분리한다. 기존 raw·timing v1·품질 정책은 보존하고 새 표본은 새 revision으로 만든다. Legacy와 v3/40행은 자동 혼합하지 않는다.
- B2 Test는 이미 관측했고 후속 가설에 영향을 주었다. 새 구조의 최종 독립 검증에는 미관측 cohort를 예약한다. 기존 cohort를 다시 섞어 독립 Test라고 부르지 않는다.

이 절은 필요한 증거의 계약이지 해당 필드가 현재 전부 저장돼 있다는 선언이 아니다.
첫 작업과 A/B 구조 비교는 [AI 계획](../strategy/ai-plan.md)을 따른다.
[Action trace v1](human-action-trace-v1.md)은 취소된 과거 제안이다. 신규 수집이나 전량 재수집을 현재 학습의 선행 조건으로 삼지 않는다. 기존에 없는 상태/성공/첫 대기 label은 미지원으로 표시하고, 확인 가능한 표본·과제만 사용한다.

### 유지하는 legacy·v3 해석 규칙

- 원본 bytes를 보존한다. schema, gameplayRulesVersion, geometry, coordinateSystem,
  observation stage, trust level과 source를 함께 해석한다. legacy→v3로 번호만 바꾸지 않는다.
- 20행 상태를 40행으로 옮겨도 이동·종료·후속 상태 동등성이 입증되는 것은 아니다.
  다른 ruleset의 데이터는 분리하고 혼합/전이는 별도 실험으로 평가한다.
- client_reported 결과는 서버 확정 상태로 승격하지 않는다. post_line_clear의
  gameOver=false를 garbage/next spawn 이후 생존 label로 사용하지 않는다.
- createdAt이 사용자 키 입력·queue 처리·서버 수신 중 무엇인지 생성 경로와 당시
  빌드로 확인한다. tick을 ms로 가정하지 않는다. wall clock 역전·같은 시각 입력을 집계한다.
- holdPiece/nextQueue는 기록 시점의 값이다. hold 전 값이 입증되지 않으면 hold
  정책 표본으로 쓰지 않는다. 공개된 preview 범위를 넘는 queue는 feature에서 제외한다.
- Human 입력 시도와 성공은 다를 수 있다. 성공 여부가 없으면 미확인으로 남긴다.
  과거 tSpinType 누락도 none/mini/full로 추정해 채우지 않는다.

## 품질 판정과 분할

### 목표에 맞는 공통 선정 원칙

목표는 좋은 배치나 승자 전략의 복제가 아니라 **정상적으로 참여한 사람의 조작
간격·리듬·행동 순서·hold 사용**을 배우는 것이다. 초보자의 실수·빠른 패배와 포기·
기록 오류를 구분한다. 사람답게 조작한다는 것과 강한 AI가 된다는 것도 별개다.

| 모드 | 학습 주체 | 승패 처리 |
| --- | --- | --- |
| PVE | Human만. 상대 AI 행동은 제외 | Human 승리·패배 모두 후보 |
| PVP (`multi`/`multiplayer`/`pvp`) | 양쪽 Human | 승자만 고르지 않음. 각각의 기록 품질 확인 |

상대 AI 이벤트는 학습 표본이나 Human 속도의 기준으로 쓰지 않는다. 게임이 끝난
뒤 AI만 계속 진행한 이상을 확인하는 진단 근거로는 볼 수 있다. 승패·난이도·mode는
제외 편향과 평가 분포를 확인하는 metadata이며, 승패를 행동 feature로 넣지 않는다.

### 1단계: 게임 품질 gate

첫 dataset에서는 확정된 이상 게임 전체를 제외하며, 의심/판정 불가 게임은 검토
대기 목록으로 분리해 학습·validation/test에 넣지 않는다. 원본이나 감사 report를
삭제하지 않는다. 정상 여부를 확인해 복원할 때는 dataset 정책 revision을 바꾼다.

| 상황 | 첫 dataset 처리 | 사유 |
| --- | --- | --- |
| 짧지만 사람이 이동·회전·hold 등 정상 조작을 하다가 패배 | 길이만으로 포기로 판정하지 않음 | 빠른 정상 패배와 포기의 구분 |
| 최소 검토 시간보다 짧고, 종료 직전 여러 조각에서 다른 조작 없이 하드드롭만 연속한 패턴 | 포기 의심으로 격리, 학습 미포함 | `EARLY_ABANDONMENT_SUSPECTED` |
| 사용자 확인 또는 재현 가능한 근거로 고의 조기 종료가 확인됨 | 게임 전체 제외 | `EARLY_ABANDONMENT_CONFIRMED` |
| 사전에 확정한 최대 게임 시간을 초과 | 게임 전체 제외 | `ABNORMAL_LONG_GAME` — 버그 원인은 별도로 확인 |
| Human 기록이 멈춘 뒤 AI 이벤트만 계속 발생 | AI 단독 진행 의심으로 격리, 확인 시 게임 전체 제외 | `AI_ONLY_CONTINUATION_SUSPECTED` / `CONFIRMED` |
| lifecycle·시각이 없어 실제 종료까지의 길이를 판정할 수 없음 | 첫 dataset에서는 격리, 학습 미포함 | `GAME_DURATION_UNVERIFIED` |

포기 의심은 로그 패턴이지 의도를 입증한 정답이 아니다. 하드드롭 비율이나 짧은
생존만으로 포기를 확정하지 않는다. 특히 Hard의 정상 빠른 패배를 따로 확인한다.
AI만 남은 구간도 Human placement 누락 때문일 수 있으므로 마지막 Human 기록을
실제 이탈 시각으로 확정하지 않는다. 초과 시간 기준으로 제외하더라도 버그로 단정하지 않는다.

길이는 유일하고 일관된 game_start→game_over의 이벤트 시각으로 계산한다.
DB `ingested_at`, 마지막 AI 이벤트 시각, 마지막 Human 입력만으로 게임 종료나
실제 Human 참여 시간을 대체하지 않는다. 미완결 게임은 `observedSpanSeconds`만
기록하고 완료 게임 duration과 섞지 않는다. 첫 dataset의 검증된 lifecycle 요구는
이번 품질 gate의 명시적 선택이며 과거 placement 필터를 자동 승계한 것이 아니다.

2026-10-24 사용자가 full 결과를 검토한 뒤 첫 timing-only dataset에
`shortGameReviewSeconds=30`, `maxGameDurationSeconds=600`,
`abandonmentTailMinPieces=5`, `aiOnlyTailReviewSeconds=60`을 승인했다.
이를 `quality-policy-v1`로 고정한다. 이전 V4 기준의 자동 승계나 모델/test 점수에
맞춘 조정이 아니다. 다른 source·ruleset이나 정책 변경에는 별도 revision·검토가 필요하다.

검토 구현은 [게임 품질 감사 명세](../../../ai-harness/ml-experiments/experiments/human-game-quality-audit.md)를 따른다.
`provisional-review-v1`은 30초/600초/5조각/AI tail 60초를 후보로 출력하지만
`policyStatus=provisional_review_only`를 유지한다. 당시 정책 승인이 아니었다. 그 report를
수정하지 않고 후속 [timing dataset 명세](../../../ai-harness/ml-experiments/experiments/human-timing-dataset.md)와
manifest에 사용자의 별도 채택을 기록한다. 213게임 사용·22게임 격리·11게임 Human 없음 제외이며 원본은 보존한다.

이 gate는 짧은 패배·긴 정상 플레이·PVP 상대의 정상 데이터도 일부 줄일 수 있다.
포함/제외/검토 대기 수를 mode·난이도·승패별로 보고하고, 사유와 대표 trace를 남긴다.
원본 품질 판단은 모델 점수·승률이 아니라 기록 근거로 재현할 수 있어야 한다.

### 2단계: 통과 게임 안의 과제별 구간 품질

- 입력 identity 중복은 한 번만 처리하고 같은 identity의 내용 충돌은 격리한다.
- game/player/piece/action 순서, 시간, hold 경계, 재접속·보정, 누락·잘림을 검사한다.
- 완결 게임이라도 입력 기록은 빠질 수 있다. rate-limit 거부와 연속 piece 공백을
  구분해 보고하고 기록된 행동만으로 완전성을 주장하지 않는다.
- 상태까지 복원 가능한 구간, 시간/순서만 사용 가능한 구간, 사용 불가 구간을 나눈다.
  replay 성공 범위와 실패 사유를 기록한다. 현재 엔진으로 과거 규칙 replay를 대체하지 않는다.
- 초기 5개 조각 제외 같은 legacy placement 정책은 자동 적용하지 않는다.
  첫 dataset은 위 게임 gate를 먼저 통과해야 한다. 미완결 게임의 앞부분을 살리는 정책은
  현재 포함하지 않으며 후속 dataset revision에서 별도로 검증한다. 단절을 가로질러 이력을 연결하지 않는다.
- 같은 game은 모든 variant에서 같은 split을 유지한다. 사용자 holdout 여부와
  시간 경계를 명시하며 사용자 정보는 필요한 가명 식별자만 둔다. token은 저장하지 않는다.
- 입력 누락이나 시간 정제로 빠른 플레이·특정 사용자·행동이 더 많이 제외되는지 비교한다.

## 보존할 산출물

Versioned manifest에 source checksum, ruleset/좌표/관찰 단계, 추출 코드 revision,
과제별 입력·정답·시간 정의, 포함/제외 수와 사유, split game 목록·seed를 기록한다.
첫 timing-only schema/split/파일명은 [timing dataset 명세](../../../ai-harness/ml-experiments/experiments/human-timing-dataset.md)에서 고정한다. 기존 네 파일의
placement bundle 형식을 조작 dataset에 억지로 맞추지 않는다.

관측 불가능한 상태는 0·빈 배열·안전으로 조용히 대체하지 않는다. 부족하면
학습 범위를 줄이거나 새 수집 항목을 제안하고, 현재 기록 계약을 임의로 변경하지 않는다.

## 입력 시간 생성 경로 조사 (2026-10-24)

### 왜 시간의 뜻을 나누는가

`inputSequence[i].createdAt`은 브라우저 runtime이 입력 큐에서 action을 꺼내
**실행을 시도하기 직전**에 호출한 `Date.now()`다. 키를 누른 순간, 서버 수신 시각,
입력 성공 시각과 같지 않다. 함수명 `recordAppliedInput`만 보고 성공한 입력이라고
해석하면 안 된다. 실패한 이동·두 번째 hold도 시도 기록에는 들어갈 수 있다.

```text
keydown (방향/soft drop은 브라우저 반복도 허용)
→ enqueueInput (action·scheduled tick·pieceIndex만 저장)
→ input timer에서 큐 소비
→ pieceIndex 검사
→ recordAppliedInput: createdAt = Date.now()
→ handleAction: 성공/실패 판정
→ inputOutcomeRecorder: 성공한 local action만 서버에 전송
→ placement log의 inputSequence 복사 → commit 확인 → 저장
```

판단 근거는 [입력 매핑](../../../src/client/game/runtime/input.ts),
[큐·기록·처리](../../../src/client/game/runtime/tetris.ts),
[멀티 session](../../../src/client/game/entry/multiplayerGameSession.ts)다.
서버의 [projectInputSequence](../../../src/server/services/gameEventProjector.ts)는
nested `createdAt`을 숫자로 검증·복사하며 서버 시각으로 바꾸지 않는다.
placement `createdAt`에서 만든 DB `occurred_at`은 배치 시각이고,
[ingested_at](../../../src/server/db/migrations/001_game_events.sql)은 DB 저장 시각이다.
둘 다 개별 입력 간격의 대체값이 아니다.

현재 input timer 설정은 16ms지만 tick 차이에 16을 곱해 실제 입력 시간으로
바꾸지 않는다. 큐 대기·메인 스레드 지연·한 번에 여러 action 처리의 영향을 받는다.
같은 batch에서 두 입력의 Date.now가 같아 0ms가 나와도 두 키를 동시에 눌렀다는
뜻은 아니다. wall-clock이므로 음수 차이도 별도 검사해야 한다.

### 과거 코드와 원본의 연결 수준

- 시작 commit `9db8fe1`부터 현재 `bbf26b7`까지 `tetris` 경로의 Git 이력을 추적했다.
  기록 함수가 존재하는 38개 버전에서 본문이 같았고 모두 action 처리 전에 기록했다.
- 당시 JS 키보드 구현에서도 방향/soft drop 반복을 허용했다. `repeat`·keydown/keyup
  구분이나 브라우저 `event.timeStamp`는 inputSequence에 보존하지 않는다.
- Raw의 report 순서상 첫/중간/마지막 Human 표본 3건(source line
  39,516 / 118,015 / 119,699)을 확인했다. 입력은 tick/action/sequence/createdAt/pieceIndex이며
  실행 build/commit과 입력별 applied 정보는 없었다. 표본 확인을 전체 새 감사로 표현하지 않는다.
- 저장 allowlist도 build revision을 남기지 않는다. 따라서 **저장소 코드의 의미는
  확인했지만 각 과거 경기의 실행 빌드와 연결됐다는 증거는 부족**하다. 기존 full report의
  `TIMESTAMP_SEMANTICS_UNVERIFIED`를 수정하거나 모든 행을 verified로 올리지 않는다.

현재 runtime의 synthetic 재현에서는 enqueue 시각 1,000, 큐 소비 시각 9,000일 때
createdAt은 9,000이었다. 벽으로 이동 실패도 기록됐고, 연속 hold의 성공/실패는
true/false인데 둘 다 시각 9,100으로 기록됐다. stale piece 입력은 시도 로그에서 제외됐다.
이는 현재 구현의 설명을 검증하며 과거 게임 replay나 실제 키 입력 시간 검증은 아니다.

직접 코드 흐름을 확인하는 명령(저장소 루트):

```bash
rg -n 'recordAppliedInput|handleAction\(nextInput.action\)|createdAt: Date.now' src/client/game/runtime/tetris.ts
git show 9db8fe1:src/client/game/runtime/tetris.js | rg -n -A 12 'function recordAppliedInput'
git show 83e29f9:src/client/game/runtime/input.js | rg -n 'NON_REPEATABLE|event.repeat|enqueueAction'
```

## 첫 timing-only dataset의 제한된 범위

다음 구현은 상태 조건부 행동 모델이 아닌 **기록된 입력 처리 시도 간격**만 다룬다.
배치·경로는 별도 정책이 정한다. 이 시간 모델로 배치 선택이나 hold를 학습했다고
표현하지 않는다. 기존 audit Notebook/정의 셀은 유지하고 dataset 실험은 별도 명세로
질문·split·출력·포함/제외 수를 확정한 뒤 Notebook에서 구현한다.

| 항목 | 최초 범위 |
| --- | --- |
| 데이터 | 이번 full 감사와 같은 immutable legacy 원본, Human만 사용 |
| 후보 | 품질 gate 전 hold 없는 9,485구간. 승인 213게임의 최종 eligible 9,283구간에서 61,190 pair 생성; hold 1,138/timing limited 95구간과 pair 3개 분리 |
| 표본 | 같은 placement 입력 배열의 인접 두 action. 서로 다른 piece/게임/불연속 구간은 연결하지 않음 |
| label | `recorded_interval_ms = current.createdAt - previous.createdAt` |
| 최소 feature | 이전 action만. 첫 baseline은 train의 전체 간격 분포, 다음 비교는 이전 action별 분포 |
| diagnostic 전용 | 뒤 action, tick·sequence·source line·game lineage. 첫 모델의 입력 feature에서 제외 |
| 금지 feature | board/hold/queue 추정값, 실제 최종 배치·결과·전체 미래 inputSequence |
| 분할 | game 단위. 같은 game/player/piece의 인접 pair가 split을 넘지 않음 |
| 의미·provenance | recorded interval, 저장소 구현과 일치하나 경기별 실행 build binding 미확인 |

게임 품질 gate를 먼저 적용하고 Human, timing usable, hold 시도 없는 구간을 고른다. 각 pair는 유한하고
0 이상인 두 timestamp, 같은 pieceIndex, sequence가 정확히 1 증가하고 tick이
역전하지 않는지 확인한다. 불량 pair를 건너뛴 뒤 앞뒤를 새 pair로 잇지 않는다.
Piece gap이 있는 게임도 한 placement 내부의 유효 pair는 따로 판단하되 piece를
가로질러 반응시간이나 연속 이력을 만들지 않는다.

0ms는 원본 관측으로 보존하고 비율을 진단한다. 긴 간격을 임의로 제거하거나
test를 보고 clipping 기준을 고르지 않는다. 배포용 최소/최대 대기시간은 게임 실행의
안전 정책이며 원본 label과 구분해 후속 실험에서 고정한다. 통계·전처리·분포는 train에서만
fit하고 validation/test는 별도로 평가한다. 사용자 식별 근거가 없으면 개인 모방이라
주장하지 않으며, 기록된 Human 집단의 처리 간격을 재현하는 탐색적 baseline으로 한정한다.

**현재 고정:** 게임 품질 `quality-policy-v1`, game 단위 SHA-256 split seed
`human-timing-v1-20261024`, 70%/15%/나머지(213게임이면 149/31/33)다.
**Full 확인:** 61,190 pair, Train/Validation/Test 41,151/10,180/9,859 pair, manifest SHA `c203a1db7b8f2aa7014c565b371088a9614f6abb0df5632e93fe6c807712fc88`이다.
**아직 미확정:** 제외 편향·production 모델 채택·runtime 대기 경계·실제 사람다운 체감·v3/40행 전이다. [baseline 명세](../../../ai-harness/ml-experiments/experiments/human-timing-baseline.md)의 사용자 full Validation과 고정 B2 Test를 완료했으며 B2는 timing 비교 기준으로만 유지한다.
새 데이터 수집 없이 제한적 행동열/리듬 실험을 계획할 수 있다. 상태 조건부 action/hold는
기존 로그 안에서 연결 근거가 확인되는 범위만 사용한다. 불충분하면 해당 주장을 제한하며 추가 수집을 강제하지 않는다.
