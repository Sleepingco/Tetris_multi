# AI 현재 계획

정리일: 2026-10-28. 상태: **existing_logs_only_new_capture_cancelled — 추가 수집 취소, 기존 로그 활용**.
목표는 사람의 배치 선택·조작 순서·리듬·Hold를 모방하는 실험적 PVE다.
B0~B3는 완료한 **상태를 보지 않는 timing 기준선**으로 남긴다. B3를 최종 AI나 runtime 기본값으로 채택하지 않는다.
사용자 결정으로 [Human action trace v1](../contracts/human-action-trace-v1.md) 신규 수집을 취소했고 관련 구현·검사·준비 Notebook을 제거했다. 모든 로그를 새로 수집하지 않는다. 다음 계획은 **기존 로그에서 확인된 행동 순서·리듬·Hold 시도와 검증 가능한 문맥만으로 모방 과제를 한정**하는 것이다. 새 수집·전체 replay·dataset 재생성·학습을 자동 시작하지 않는다.

프로젝트 구현·운영은 [PLAN.md](../../../PLAN.md), 실제 코드와 테스트를 따른다.
이 문서는 앞으로의 구조·순서의 단일 기준이며 과거 수치·실행 방법은 각 실험 명세에 둔다.
취소 전 구현 검증과 철회는 [실행 기록](../../../ai-harness/runs/human-action-trace-v1-implement-smoke-2026-10-28.md)에 남겼다. 커밋 준비에서 Git 저장 source만 출력/Full 설정을 정리한 격리 복사본은 ML Node 35/35·Python 220/220을 통과했다. 사용자 실행본은 그대로여서 작업 폴더의 형식 차이는 남는다. 새 수집은 현재 계획의 선행 조건이 아니다.

## 1. 왜 방향을 조정하는가

사용자가 원하는 것은 단순히 불규칙한 속도의 AI가 아니라 **보드와 공격 상황에 따라 무엇을 할지, 언제 할지가 달라지는 AI**다.
같은 300ms의 멈춤도 배치를 고르는 시간, Hold 전후 판단, 조작 중 휴지, 브라우저 처리 지연일 수 있다.
간격만으로 원인이나 전략적 의도를 판정할 수 없다.

현재 B3는 이전 action과 이미 끝난 간격 하나로 다음 **기록된 처리 시도 간격**의 분포를 예측한다.
보드·공격·다음 행동·Hold를 보지 않으며 spawn에서 첫 행동까지의 대기도 label에 없다.
따라서 CRPS 개선은 이력의 예측 정보에 대한 근거이지, 상황을 이해하거나 사람처럼 플레이한다는 증거가 아니다.
타이밍만 계속 세분화하거나 B3를 자체 생성에 먼저 연결하는 일을 주 경로로 삼지 않는다.

유지할 제품 목표와 제외할 주장은 다음과 같다.

- 정상적으로 참여한 Human의 선택·행동·리듬을 모방한다. 초보자의 실수도 학습 대상일 수 있다.
- PVE는 Human만, PVP는 양쪽 Human을 승패와 무관하게 후보로 삼는다. 승자·heuristic 행동으로 정답을 교체하지 않는다.
- 개인 식별·충분한 개인별 평가가 없으면 “특정 사용자를 복제했다”가 아니라 “수집된 Human 플레이를 학습했다”고 설명한다.
- 프로 수준 T-Spin·콤보 빌드업, 전략적 기다림의 의도 이해, 승률 향상을 보장하지 않는다. 강한 AI 연구는 별도 목표다.
- 사람다운 체감과 게임 안정성은 별도 검증한다. 시간 점수만 좋아졌다고 체험 기능에 승격하지 않는다.

## 2. 지금까지 확보한 것과 재사용 경계

| 확보한 것 | 재사용·한계 |
| --- | --- |
| 기존 placement V4 | 125게임·16-feature Human 배치 ranker와 추론/안전성 계약. 결론은 `imitation_only_not_gameplay_ready`. 현재 40행 `buffer20-v1`에서는 `RULESET_INCOMPATIBLE` heuristic fallback이며 새 AI의 배치 정답으로 사용하지 않음 |
| [조작 적합성 full 감사](../../../ai-harness/runs/human-action-data-readiness-analyze-result-2026-10-24.md) | legacy 235게임·10,816구간·88,845입력. timing usable 10,645/limited 171. 상태 조건부 행동·Hold는 10,816구간 모두 unverified였으며 불가능 판정은 아님 |
| [품질 계약](../contracts/human-action-dataset.md#1단계-게임-품질-gate) | 사용자 승인 `quality-policy-v1`: 213게임 포함·22격리·11 Human 없음 제외. 원본·격리 목록과 30초/600초/5조각/AI tail 60초 기준 보존 |
| [timing dataset](../../../ai-harness/ml-experiments/experiments/human-timing-dataset.md) | 213게임·61,190 pair, Train/Validation/Test 149/31/33게임. Hold 구간 제외, 인접 입력 간격만 있음. 상태·공격·첫 행동 대기를 추정해 붙이지 않음 |
| [B0~B2 Validation](../../../ai-harness/ml-experiments/experiments/human-timing-baseline.md) | 고정 평균/전체 분포/이전 행동별 분포. game-macro CRPS 75.150/54.270/53.028ms. CRPS·분할·경로 보호·표/그래프·테스트 재사용 |
| [고정 B2 Test](../../../ai-harness/ml-experiments/experiments/human-timing-b2-test-evaluation.md) | 33게임/9,859 pair, fit 0, game-macro CRPS 51.871ms. 이미 관측했으므로 후속 구조의 손대지 않은 최종 Test로 재사용하지 않음 |
| [B3 Full Validation](../../../ai-harness/ml-experiments/experiments/human-timing-history-baseline.md#사용자-full-결과와-계획-판단--2026-10-27) | B2 53.028 → B3 49.743ms, 약 6.20% 개선, 26게임 개선/5악화. Human 과거 간격을 제공한 one-step 평가이지 자체 실행 평가가 아님 |
| [관측 연결 감사](../experiments/human-action-observation-link-audit.md) | 기록 코드·legacy 일반/Hold trace·local v3 tail 표본 대조 완료. 시도 순서/간격은 재사용하되 action별 출발 상태·첫 대기·공격 관측·Hold 결과는 추가 증거/수집 필요. 전체 replay·v3 품질 감사는 하지 않음 |
| [최소 수집 계약 v1](../contracts/human-action-trace-v1.md) | 기존 Human/v3 placement의 optional versioned trace 설계 완료. 공개 관측·입력 전/후·단조 시간·누락/상한·저장 round-trip·수용 기준 고정. 구현·실제 pilot 미실행 |
| 기존 core·authoritative 입력·PVE 실행기 | 규칙·충돌·Hold 제한·실행 안전성 재사용. Python에서 게임 규칙을 다시 구현하지 않음 |

0ms 과거 원인 조사는 [마지막 재현 기록](../../../ai-harness/runs/human-timing-zero-ms-reproduction-2026-10-26.md)으로 종료했다.
0ms 포함 정책·민감도 분석을 유지하며 이 개정으로 원인 추적을 재개하지 않는다.
기존 source Notebook의 사용자 output/count·full 설정과 ML 전체 gate 보류는 보존한다. 문서 개정이 해당 검사 통과를 뜻하지 않는다.

## 3. 목표 구조: 상황 → 행동과 대기 → 실행 → 다시 관측

아래는 **제안 구조**이며 아직 구현된 시스템이 아니다.

```text
그 시점에 사람이 알 수 있었던 상태 + 최근 관측된 행동/시간
  ├─ 보드·활성 조각 위치/회전·공개 next·Hold/사용 가능 여부
  ├─ 당시 알려진 incoming garbage·중력/lock 시간 상태
  └─ 이미 끝난 행동·간격·관측 누락/불확실성
                       ↓
       Human 행동 정책 (아래 A 또는 B 비교)
       다음 action + 그 action까지의 대기 분포
                       ↓
       유효 행동 검사 + 중단 가능한 대기 예약
                       ↓
       기존 authoritative 입력 실행 → 결과·새 상태 재관측
                       ↑
       대기 중 공격/보정/Hold/spawn 등 관련 변화 시 재판단
```

- 예측 단위는 game/player의 연속 관측 지점이다. 로그를 독립된 블록 row로 섞지 않고 순서·piece/Hold 경계를 보존한다.
- 첫 범위는 기록이 지원하는 `move_left/right, rotate/rotate_ccw, soft_drop, hard_drop, hold` 같은 **semantic action**이다. 물리 키 누름/뗌·DAS/ARR 습관까지 복원했다고 주장하지 않는다.
- 한 번 고른 대기를 끝까지 고집하지 않는다. 공격 관측·보정·조각 교체 등 관련 변화에 대기를 취소/재평가한다. 이벤트 발생 전에는 미래 공격을 볼 수 없다.
- 행동 label은 다음 관측 action이다. 시간은 그 행동까지의 관측 간격이며, 의도·고민·공격 회피 같은 마음속 이유는 정답으로 만들지 않는다.
- `WAIT`를 매 tick의 추가 class로 바로 만들지 않는다. 우선 action+대기 분포를 설계 가설로 두고, 무입력 관측 구간과 종료/누락 경계를 확인한 뒤 필요한 경우에만 명시적 WAIT 방식과 비교한다.
- 안전 필터·실행기는 게임 규칙을 지키는 장치이지 Human 대신 heuristic을 정답으로 주는 장치가 아니다. fallback 사용 여부는 별도 기록한다.

### 시간은 세 가지로 나눠 검증한다

| 관측량 | 필요한 시작·끝 | 해석의 한계 |
| --- | --- | --- |
| 첫 행동까지 대기 | 조각을 관측·조작할 수 있게 된 시점 → 첫 action | 배치 고민을 포함할 수 있지만 인지 반응시간 자체는 아님 |
| 조작 사이 간격 | 직전 action → 다음 action, 도중 관측 변화 포함 | 기존 B0~B3가 다룬 범위. 실행 리듬과 상황 반응이 섞일 수 있음 |
| 사건 이후 행동 변화 | 사람이 공격/보정 등을 알게 된 시점 → 이후 action 또는 무입력 지속 | 공격 때문에 기다렸다는 인과·의도 증거는 아님 |

게임 종료·끊김·기록 잘림 전에 다음 action을 못 본 구간은 “매우 긴 대기” label로 만들지 않는다.
관측 종료로 시간을 끝까지 모르는 구간으로 구분한다. 새 관측이 도중 들어온 경우 최초 계획과 남은 대기를 구분한다.

## 전체 AI 구조 비교: 두 버전 실험 예정

사용자가 요청한 **A 모듈 조합형 / B 통합 신경망형** 비교는 유지한다.
A/B는 전체 구조 이름이며 timing B0~B3·과거 placement V0~V4와 다르다. 아직 최종 구조·층 수는 채택하지 않았다.

| 구조 | 제안·가설 | 주의점 |
| --- | --- | --- |
| A. 상황 조건부 모듈 조합형 | 검증된 상태에서 배치/Hold 선택 → 행동 순서 → 상태·선택한 행동·이력 조건부 대기. 역할별로 문제를 설명하고 적은 데이터로 검증하기 쉬운지 비교 | 시간 모듈도 보드/공격을 보게 한다. 앞 모듈의 잘못된 목표·행동이 뒤로 전파될 수 있으므로 자체 실행 확인 필요 |
| B. 통합 신경망형 | 같은 관측과 최근 이력을 공통으로 인코딩 → 다음 action 확률과 action 조건부 대기 분포. Hold도 지원 조건 아래 행동으로 선택 | 행동과 대기를 함께 학습하는 이점이 복잡도·자료 요구·추론 비용보다 큰지 검증. 단순히 신경망이므로 채택하지 않음 |

A도 필요하면 작은 신경망을 쓸 수 있다. 첫 상황 baseline은 검증된 소수 상태 feature의 간단한 분류기·조건부 분포부터 검토한다.
B의 encoder는 표 형태 관측이면 작은 MLP, 이력의 추가 가치가 확인되면 작은 순환 모델 등을 후보로 두되
구체 모델·loss·예산은 dataset 관측 가능성을 확인한 후 비교 명세에서 고정한다. 지금 대형 모델·GPU·새 dependency를 정하지 않는다.

배치 목표를 쓰는 A는 추론 시 실제 얻을 수 있는 목표만 쓴다. Human 최종 배치를 미리 준 oracle 실험은 별도 상한 진단이며 B와 동등 비교로 보고하지 않는다.
행동 조건부 시간 head를 학습할 때의 정답 action과 실제 추론 때 선택한 action도 구분한다. 전체 정책 평가에 실제 미래 action을 알려준 시간 점수를 섞지 않고, 정답 action 조건 평가는 별도 진단으로 표시한다.
Hold 직전 관측·사용 가능 여부·교체 결과를 확인한 뒤 학습하며, 교체 후 낡은 목표/경로를 버린다.
A/B 모두 같은 관측 범위·cohort·split·ruleset·실행기·안전 제한·평가 조건을 사용한다. Heuristic 지원이 다르면 그 차이를 분리한다.

## 4. 데이터 계획: 기존 자료를 버리지 않고 용도를 나눈다

| 자료 | 처리 |
| --- | --- |
| 검증된 timing-only v1 | immutable 유지. B0~B3 비교·기록 시간 진단에 재사용 |
| 원본에서 행동 직전 상태까지 연결 가능한 구간 | 증거를 확인한 후 **새 revision**의 상황 조건부 dataset 후보로 사용 |
| 상태는 불명확하고 순서/간격만 유효한 구간 | timing/sequence 제한 용도로 보존. 상황 label을 보간하거나 0으로 채우지 않음 |
| 누락·불일치·Hold 전후 불명확 구간 | 해당 과제에서 격리하고 사유·편향 보고. 원본 삭제 없음 |
| 현재 v3/40행 자료 | legacy 20행과 별도 lineage. 필드 이름이 같다고 혼합하지 않으며 사이트 평가에는 지원 ruleset 자료 필요 |

현재 [기록 코드](../../../src/client/game/runtime/tetris.ts)의 `createPlacementDecisionContext`는 **고정 직전** board/queue/Hold를 복사한다.
[저장 projector](../../../src/server/services/gameEventProjector.ts)의 개별 input은 action/tick/pieceIndex 및 선택적 sequence/createdAt이다.
따라서 placement의 `boardBefore`라는 이름만으로 모든 action 직전 상태·Hold 이전 상태·공격 큐가 보존됐다고 판단할 수 없다.
반대로 이것만으로 모든 원본이 복원 불가능하다고 결론 내리지도 않는다. 시점별 근거가 있는 구간만 검증한다.

새 계약에서 확인할 항목:

- 사람에게 실제 노출된 관측과 서버 확정 상태를 구분한다. 서버 state를 당시 Human의 관측으로 소급 대체하지 않는다.
- action 직전 보드·조각·공개 next·Hold availability, 이미 알려진 공격량/도착 정보, gravity/lock 상태의 출처·시점을 확인한다.
- spawn/관측/action attempt/action outcome/외부 사건의 순서와 clock domain을 명시한다. client `Date.now`와 server 수신시각을 그대로 빼지 않는다.
- 성공 여부 미기록을 성공으로 간주하지 않는다. 미래 배치·줄 삭제·공격 결과·승패·비공개 queue·전체 미래 입력을 feature에서 제외한다.
- 없는 기록은 요구하는 과제만 보류한다. 최소 추가 기록이 필요하면 로그 크기·빈도·개인정보·누락 표시를 포함한 별도 수집 변경안을 먼저 승인받는다.
- 이미 관측한 cohort는 개발 자료다. 새 구조 최종 평가는 손대지 않은 별도 cohort로 계획한다. 같은 game/PVP 양쪽을 split에 나누지 않는다.
- 사용자 식별 근거가 있으면 가명 user holdout을 별도로 검토한다. 없으면 개인화/신규 사용자 일반화 근거를 주장하지 않는다.

세부 data contract는 [Human 조작 dataset 계약](../contracts/human-action-dataset.md)에 둔다.
원본 export/parser·무결성/품질 gate·game split은 재사용하고, 바뀐 관측·label 추출만 확장한다. 파이프라인 전체를 새로 만들지 않는다.

## 5. 앞으로의 실행 순서

| 단계 | 질문·작업 | 산출물·완료 조건 |
| --- | --- | --- |
| 1. 관측 연결 확인 — 완료 | 기존 로그로 행동 직전 상태·첫 대기·공격·Hold를 구분할 수 있는가? | [감사 결과](../experiments/human-action-observation-link-audit.md). 활용 가능한 행동열/간격과 미확인 상태를 구분. 부족한 필드 때문에 기존 자료 전체를 폐기하지 않음 |
| 2. 기존 자료 기반 범위 재정의 — 다음 계획 | 새 수집 없이 어떤 행동·리듬·Hold 시도와 문맥을 신뢰할 수 있는가? | 기존 schema/split/품질 정책 보존. 직접 확인 가능한 입력·label과 미지원 주장을 명시한 작은 실험 명세. 추정 상태를 정답으로 쓰지 않음. 사용자 출력과 ML 검사 정합 문제 별도 해결 |
| 3. 기존 이력/검증된 문맥의 가치 검증 | 행동열·시간 이력 및 확인 가능한 문맥을 비교. 상태/공격 자료가 불충분한 과제는 제외 | Notebook과 pandas/Matplotlib. 같은 label·같은 표본일 때만 B2/B3와 직접 비교. 이 단계에서 추가 수집을 요구하지 않음 |
| 4. A/B 구조 비교 | 모듈형과 통합 신경망형을 같은 데이터·예산에서 학습·Validation 비교 | action/시간/Hold·처리 비용·복잡도와 실패 사례. 결과를 보기 전에 primary·허용 회귀폭 고정, 후보 하나 선정 |
| 5. 자체 실행·사람다운 체감·독립 평가 | Human 이력 대신 모델의 행동이 다음 관측을 만드는 상황에서도 작동하는가? | 기존 core rollout·상태 변화 중 대기 취소·평균 속도 통제 블라인드 비교·고정 후보의 미관측 cohort 평가. 미달이면 승격 보류 |
| 6. 실험적 사이트 적용 | 지원 ruleset과 안전 계약을 만족한 후보만 선택형 PVE로 제공 | 최종 Python trainer/artifact, TS 추론 parity, non-blocking 실행·명시적 fallback·로그 source 분리·rollback |

각 단계는 해당 질문까지만 마감한다. 데이터가 부족하면 부족한 항목만 보완하고 감사/기존 full을 기계적으로 반복하지 않는다.
학습을 조금씩 하는 이유는 fine-tuning을 반복하려는 것이 아니라, **어떤 관측이 어떤 행동을 설명하는지** 확인한 뒤 모델 복잡도를 늘리기 위해서다.

### 다음 한 작업: 최소 상황/action trace 수집 계약 설계

**취소된 과거 계획이다.** [Human action trace v1 계약](../contracts/human-action-trace-v1.md) 설계·합성 구현 뒤 사용자 결정으로 신규 수집과 코드를 철회했다. 아래 내용은 이력이며 실행 지시가 아니다. 현재는 문서 맨 위의 기존 로그 전용 방향을 따른다.

선택은 기존 Human/v3 placement의 optional humanActionTrace(version=1)다. 새 테이블/event 없이 기존 단일 sink를 사용하고, board 중복을 줄이며 pre_action뿐 아니라 post_action도 기록해 시간 label의 0ms 함정을 피한다. 마지막 미완결 턴이 유실될 수 있는 제한을 명시한다.

- 조작 가능 전환·action 직전 공개 관측·attempt/outcome·Hold/공격/보정·구간 종료를 같은 local 단조 clock과 연속 ID로 연결한다.
- 현재 공개 next 4개와 Canvas 관측 mask를 구분한다. 내부 전체 queue/보드·server-only 정보는 조용히 feature로 사용하지 않는다.
- 매 frame/full board 반복 저장 대신 checkpoint/delta를 검토하고 예상 bytes/game·rate/byte 상한·누락 표시·실패 보고를 제시한다.
- 기존 placement v3와의 호환, client→validator/projector→단일 sink→export/분석의 영향 파일과 검증을 정한다. 독립 gameplay state 원천·critical section의 DB await는 추가하지 않는다.
- 완료선은 필드/clock/관찰 단계·예제·부피 예산·privacy·누락/종료·검증/rollback 설계다. 수집 구현·새 dataset·학습은 별도 요청 전 시작하지 않는다.

### 다음 한 작업: 행동 직전 관측 연결 가능성 확인

이 제목은 이전 계획 링크를 유지하는 완료 작업의 진입점이다. 아래 범위는 [감사 문서](../experiments/human-action-observation-link-audit.md)로 마감했다. 후속 신규 수집은 취소됐다. 다음 계획은 추가 수집이 아니라 기존 자료에서 확인 가능한 과제의 범위 재정의다.

1. 기존 readiness 결과와 실제 기록/저장 schema를 재사용해 필요한 필드별 생성 시점·보존 여부·누락 상태를 표로 만든다.
2. 일반 조작·Hold·공격 도착·spawn 첫 행동의 작은 비식별 trace로 관측→action 연결을 확인한다. 기존 자료에 해당 사례가 없으면 없음으로 기록한다.
3. 직접 기록된 것과 재생으로만 복원 가능한 것을 나눈다. Replay가 필요하면 당시 ruleset·초기 상태·사건 순서와 대조 가능한 anchor부터 확인하며, 지금 전체 replay 구현/실행을 시작하지 않는다.
4. 기존 로그만으로 시작 가능한 최소 과제와 부족한 필드만 적는다. 가능한 범위면 단계 2 명세로, 불가능하면 최소 수집 계약 제안으로 끝낸다.

완료 조건: 모든 필요한 입력/label에 **근거 또는 미확인 사유**가 있고, 상태 미확인을 정상 값으로 채우지 않았으며,
원본·timing dataset·Test·runtime을 변경하지 않았음을 확인한다.
이번 감사에서는 기존 parser를 이용한 작은 읽기 전용 대조만 했다. 새 Notebook·학습·전체 replay·수집 구현은 선행하지 않았다.

## 6. 평가·학습·승격 계약

- 실험 코드는 Notebook 한 곳에 둔다. 설명→작은 예제→Smoke 설정/실행/결과→Full 설정/실행/결과→해석 순서로 작성한다. 사용자는 Notebook 안에서 실행하고 pandas·Matplotlib로 결과를 읽는다.
- Python 테스트는 Notebook 정의를 검증하며 실험 구현을 복제하지 않는다. 제목·코드 문자열 계약 검사도 유지한다. 최종 모델 동결 뒤에만 최종 trainer를 `.py`로 분리한다.
- action은 game별 집계와 행동별 precision/recall·macro F1·확률 오차를 본다. 드문 Hold·회전 방향과 “항상 같은 행동” 기준선을 따로 비교한다.
- 시간은 첫 행동/조작 사이/사건 이후를 분리하고 CRPS·분위수 보정·0ms/긴 대기 분포를 본다. 다른 label·다른 표본의 CRPS를 성능 향상으로 직접 비교하지 않는다.
- 보드 높이·holes·공격 유무·Hold·조각·game/ruleset별 slice를 보고, 같은 게임 안의 상관을 고려해 game 단위 변동/불확실성을 보고한다. 관측된 상관을 전략적 의도의 인과 증거로 해석하지 않는다.
- 한 단계 예측과 자체 실행 결과를 분리한다. Rollout에서는 불법/막힌 행동 반복·Hold 실패·무한 대기·deadline 초과·fallback·생존을 확인한다. 승률은 모방과 별도다.
- 사람다운 체감은 모델명을 가린 무작위 영상/체험 비교로 확인한다. 실제 속도 그대로의 결과와 평균 속도를 맞춘 비교를 구분하고 seed·난이도·입력 조건과 평가 인원/편향을 기록한다.
- 구체적인 학습 예산·성공/허용 회귀 기준은 baseline/pilot 이후 **후보 결과를 보기 전에** 명세에 고정한다. 현재 6.20% 개선을 새 과제의 채택 threshold로 전용하지 않는다.
- Full은 사용자가 실행하거나 명시 승인할 때만 한다. 독립 Test는 후보 고정 뒤 사용하고 다시 구조 선택에 쓰지 않는다.

## 7. 사이트 적용 경계와 rollback

기존 core/authoritative 입력 경로가 최종 판정을 소유한다. 모델은 board를 직접 수정하지 않는다.
대기는 다음 실행 시각으로 예약하며 sleep/추론 await로 ticker를 막지 않는다.
최대 대기·행동 수·반복 실패·추론 시간 예산과 관련 상태 변화의 취소 규칙은 통합 전에 정한다.
Hold/spawn/보정 후 낡은 조작과 예약을 폐기하고 최신 관측에서 다시 판단한다.

기본 heuristic은 유지하고 실험 opt-in에만 후보를 연결한다. Ruleset·feature/schema·clock 의미·전처리·model SHA가 맞지 않으면
명시적 사유와 함께 기존 정책으로 돌아간다. 관측 누락 시 B3를 조용히 기본값으로 붙이지 않는다. B2/B3는 우선 비교 기준일 뿐이다.
Human 로그와 ML/heuristic/fallback provenance를 분리해 자동 재학습에 섞지 않는다.
UI는 “Human 행동 학습 실험”과 한계를 알리고 개인 복제·강함을 과장하지 않는다.
다중 room·재접속·지연·모델 오류·로그 저장 실패를 별도 통합 검사하고,
문제 발생 시 opt-in을 끄거나 이전 호환 artifact로 돌릴 수 있어야 한다. 자동 온라인 학습·새 Python 추론 서버는 현재 범위가 아니다.

## 다음 작업 실행 계획: timing baseline

이 제목은 과거 계획 링크를 위한 역사적 진입점이다. 당시 구현·사용자 실행·해석 단계는
[baseline 명세](../../../ai-harness/ml-experiments/experiments/human-timing-baseline.md),
[B2 Test 명세](../../../ai-harness/ml-experiments/experiments/human-timing-b2-test-evaluation.md),
[B3 명세](../../../ai-harness/ml-experiments/experiments/human-timing-history-baseline.md)에 보존했다.
현재 실행 순서는 위 1~6단계이며 timing-only 재실행 지시가 아니다.

## 현재 참고 문서의 상태

| 문서 | 상태 |
| --- | --- |
| [AI 문서 안내](../README.md) | 현재 진입점 |
| [로그·dataset 정책](game-log-dataset-policy.md) | v3 저장과 legacy placement의 경계 |
| [V4 신규 로그 재학습안](new-log-cleaning-training-plan.md) | 보류 제안. 실행 완료 이력 아님 |
| [이전 대화 요약](data-cleaning-training-conversation-summary.md) | 조사 배경. 실행 지침 아님 |
| [과거 실험 순서](../../archive/ai-ml/README.md) | 완료·보류를 구분한 읽기 목차 |
