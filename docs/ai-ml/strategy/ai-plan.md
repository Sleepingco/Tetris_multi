# AI 현재 계획

정리일: 2026-11-09. 상태: **architecture_decision_pending — 기존 Human 배치·조작·시간 실험과 입력·정답 진단 완료. 모듈형 V4 재사용과 통합 신경망은 비교 후보이며 전체 구조는 미채택**.

현재 [배치 ID 분류 vs 공유 후보 점수화](../../../ai-harness/ml-experiments/experiments/human-placement-candidate-scoring.md)의 사용자 Full 해석을 완료했다. 같은31게임 macro Top-1은 ID13.42%→후보 제한25.08%→공유 scorer43.56%로 개선됐지만 과적합은 남았다. 다음 순서는 **①공유 scorer 과적합 제어 → ②그 정책의 게임 수별 학습곡선**이다. 첫 [조기 종료 명세](../../../ai-harness/ml-experiments/experiments/human-placement-candidate-early-stopping.md)와 [Notebook](../../../scripts/ml/notebooks/human_placement_candidate_early_stopping.ipynb)은 Train149게임을 내부119/30게임으로 나눠 epoch를 고르고 전체149게임에 재학습한다. 기존 실제30epoch report와 비교하며 새 fit2개의 코드·내부 검증까지 완료했다. 기본 Full=False이고 다음은 사용자4절 Full이다. 원본 행동 증강·추가 수집·외부Validation 기반 epoch 선택·후속 학습곡선·runtime 통합은 하지 않았다. 실제 reachability·모듈형 우선·현재40행 통합을 채택하지 않는다. 이 문서 후반의 구조 선택·A/B 순서 논의는 전체 시스템 후보이지 새 실행 지시가 아니다.

2026-11-04 소스 정리: 기존 실행 설정·출력16개는 ignored `data/ml-experiments/source-checkpoint-20261104/`에 보존하고 Git용 Notebook은 출력/count를 비웠다. Full/실제 표본은 기본 비활성화하고 보고서 초기값을 복구했다. 계산 정의·데이터·결과·기존 테스트는 그대로다. `verify:ml` Node35/35·Python220/220, 기본 verify801 pass·기존1 skip이다. 아래 ML gate 보류·실행본 차이는 당시 이력이며 현재 gate 실패를 뜻하지 않는다. Full 학습/평가는 반복하지 않았다.

구조 검토(2026-11-03): 사용자는 **V4 배치 + 별도 조작/타이밍 모듈을 결합하고 향후 통합 신경망을 비교하는 방향이 어떤지** 질문했다. 이는 방향에 대한 논의이지 모듈형 우선 채택 승인이 아니다. 두 구조 모두 Human selectedPlacement와 입력열/간격을 학습 대상으로 하며 휴리스틱 배치로 목표를 대체하지 않는다.

여기서 V4 재사용은 **physical-class grouping·decision-balanced pair weighting·16-feature ranker·추론/안전성 계약의 재사용**을 우선 뜻한다. 기존125게임 artifact의 무검증 직접 연결을 뜻하지 않는다. 기존 artifact와 새 평가 cohort의 gameId 중복, legacy20행/현재40행 ruleset·feature 호환성을 먼저 확인한다. 현재40행 경로가 `RULESET_INCOMPATIBLE`로 heuristic fallback한다는 사실은 바꾸지 않는다.

현재 다음 단계는 완료한 실험과 희소성 진단을 바탕으로 후속 구조를 사용자와 선택하는 것이다. V4 재사용·모듈 인터페이스 명세는 A를 채택할 경우의 제안이며 아직 실행 지시가 아니다. 신규 수집·추가 학습·dataset·runtime 변경은 자동 시작하지 않는다.

현재 [입력·정답 진단 명세](../../../ai-harness/ml-experiments/experiments/human-placement-input-target-audit.md)와 [Notebook](../../../scripts/ml/notebooks/human_placement_input_target_audit.ipynb)의 승인된 Full2회를 마쳤다. Train149게임/6417구간의2133종 중1241종은 사례1~2개이고6095구간은 입력이 한 번뿐이다. 다중 정답36입력/246구간의 최소 관측 불일치는76구간(1.18%)이다. 점유 겹침0·기존 parser 통과는 형식적 근거이지 관측 시점/게임 규칙 증명이 아니다. 경험적 일치 한계98.82%를 미래 성능 상한으로 쓰지 않는다.

두 report SHA는 `635045e9dde6d301e27463c06ac045545fb948068707e0c6981355d4eb1c0155`로 동일하다. 모델/scaler fit·Validation/Test payload 분석/raw/DB·새 수집/제외/runtime은0이며 전체 ML gate는 기존 실행본7개 문제로 보류다. 다중 정답만으로 낮은 Validation을 설명할 근거는 부족하지만, 희소성만으로 원인의 단독 귀속도 불가하다. 이 결과는 후속 구조 논의의 근거이며 모듈형의 우월성을 실측한 증거는 아니다.

직전 [학습 게임 수별 Full](../../../ai-harness/ml-experiments/experiments/human-placement-game-count-learning-curve.md)은38→149게임에서 전체 Validation game-macro Top-1 8.17%→13.42%, 공통 정답/경쟁공간 진단14.06%→21.27%를 보였다. coverage와 예측력 모두 개선됐지만 출력층·전처리·행 노출 차이가 있고 하나의 부분집합 순서/seed이므로 데이터량의 단독 인과/필요 게임 수를 확정하지 않는다.
목표는 **어디에 블록을 놓을지부터 어떻게·언제 조작할지까지 사람의 행동을 모방하는 실험적 PVE**다. 배치 선택도 학습 대상이며 조작 리듬만 학습하는 것으로 목표를 축소하지 않는다.
B0~B3는 완료한 **상태를 보지 않는 timing 기준선**으로 남긴다. B3를 최종 AI나 runtime 기본값으로 채택하지 않는다.
**현재 신규 로그를 수집하지 않는다.** 관련 수집 설계·실행 문서도 삭제했다. [기존 로그 활용 조사](../experiments/human-action-observation-link-audit.md#6-기존-로그만으로-완성할-경로-조사-2026-10-28)를 재사용해 두 구조의 기존 자료 활용 범위를 검토한다. 향후 사용자가 추가 자료를 확보·제공하면 별도 승인으로 통합 신경망 B의 적합성을 검토한다. 이를 현재 수집 재개·DB payload 확장·자동 재학습 승인으로 읽지 않는다.

[첫 공동 기준선 명세](../../../ai-harness/ml-experiments/experiments/human-action-timing-joint-baseline.md)의 사용자 Full 해석을 완료했다. NLL/F1·시간 guardrail 개선은 관측됐지만 argmax는 회전/하드드롭을 선택하지 못했다. 부분 기준선으로 보존하며 다음은 [배치·조작 연결 계약](../contracts/human-placement-action-link.md)의 정합 확인이다. 기존 사용자 실행본의 ML 형식 gate와 격리 검증 결과는 별도로 남는다.

현재 사용 결정은 [offline-use-v1](../contracts/human-placement-action-link.md#9-기존-로그의-학습-사용-범위--offline-use-v1)이다. offline view180게임·7,959구간과 사용자 prefix Full을 해석한 뒤 [정보 분리 실험](../../../ai-harness/ml-experiments/experiments/human-goal-information-ablation.md)을 Full-only로 실행했다. pieceType만 제공할 때보다 목표 셀까지 제공하면 행동 예측이 개선됐다. 실제 판단 시점·예측 목표의 자체 실행·runtime 호환성은 여전히 미검증이며 새 수집/반복 결측 감사로 돌아가지 않는다.

사용자 결정(2026-10-29): **수집된 여러 Human의 전반적인 플레이 성향**을 모방한다. 특정 개인 복제를 목표로 삼지 않는다. 공동 기준선·view 정합·배치 snapshot 실험은 완료 이력이며, 이후 모듈형과 통합 신경망 중 무엇을 먼저 진행할지는 미정이다.

프로젝트 구현·운영은 [PLAN.md](../../../PLAN.md), 실제 코드와 테스트를 따른다.
이 문서는 앞으로의 구조·순서의 단일 기준이며 과거 수치·실행 방법은 각 실험 명세에 둔다.
기존 실험의 Git 저장 source는 격리 검증에서 ML Node 35/35·Python 220/220을 통과했다. 사용자 실행본은 그대로여서 작업 폴더의 출력/Full 설정 차이는 남는다. 이번 개정은 계획·보고이며 학습이나 runtime 변경 승인이 아니다.

완료 조건은 **기존 Human 로그의 보드 상태 → 사람 배치 선택(selectedPlacement)을 학습한 배치 정책 → 학습한 조작 순서·리듬 → 기존 core로 실행**이다. 배치 목표를 규칙 기반 점수로 대신 정하지 않는다. 현재 공동 기준선 명세는 조작/시간 부분의 비교 기준일 뿐이며, 별도의 사람 배치 선택 학습·평가를 통과해야 전체 목표를 완료한 것으로 본다. 기록 시점이 불명확한 상태나 공격 의도까지 증명됐다고 주장하지 않는다.

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
- 배치 정책의 입력은 예측 시점과 정합한 기존 보드·조각 상태이고 정답은 그 사람이 기록한 `selectedPlacement`다. 좋은 배치를 휴리스틱으로 골라 정답을 교체하지 않는다.
- PVE는 Human만, PVP는 양쪽 Human을 승패와 무관하게 후보로 삼는다. 승자·heuristic 행동으로 정답을 교체하지 않는다.
- 현재 모방 대상은 수집된 여러 Human의 전반적인 성향으로 고정한다. “특정 사용자를 복제했다”가 아니라 “수집된 Human 플레이를 학습했다”고 설명하며 개인화는 이번 범위에 넣지 않는다.
- 프로 수준 T-Spin·콤보 빌드업, 전략적 기다림의 의도 이해, 승률 향상을 보장하지 않는다. 강한 AI 연구는 별도 목표다.
- 사람다운 체감과 게임 안정성은 별도 검증한다. 시간 점수만 좋아졌다고 체험 기능에 승격하지 않는다.

## 2. 지금까지 확보한 것과 재사용 경계

| 확보한 것 | 재사용·한계 |
| --- | --- |
| 기존 placement V4 | 모듈형 A를 채택할 경우 재사용을 검토할 계열. physical-class grouping·decision-balanced weighting·16-feature pairwise ranker·trainer/reference/scorer를 재사용한다.125게임 artifact는 cohort 누수·feature/ruleset 확인 전 고정 baseline 후보일 뿐이다. 현재40행 `buffer20-v1`의 미지원 fallback과 `imitation_only_not_gameplay_ready` 결론은 유지하며 V4 예측을 Human 정답으로 바꾸지 않음 |
| 기존 raw의 `boardBefore`·`activePiece`·`selectedPlacement` | 사람의 배치 선택을 학습할 입력/정답 후보. 상태 시점·조각/Hold 경계·도달 가능성을 검증하고 배치 단위 view를 만든다. 입력마다 상태가 없다는 한계와 배치 정답 자체가 기록됐다는 사실을 구분 |
| [조작 적합성 full 감사](../../../ai-harness/runs/human-action-data-readiness-analyze-result-2026-10-24.md) | legacy 235게임·10,816구간·88,845입력. timing usable 10,645/limited 171. 상태 조건부 행동·Hold는 10,816구간 모두 unverified였으며 불가능 판정은 아님 |
| [품질 계약](../contracts/human-action-dataset.md#1단계-게임-품질-gate) | 사용자 승인 `quality-policy-v1`: 213게임 포함·22격리·11 Human 없음 제외. 원본·격리 목록과 30초/600초/5조각/AI tail 60초 기준 보존 |
| [timing dataset](../../../ai-harness/ml-experiments/experiments/human-timing-dataset.md) | 213게임·61,190 pair, Train/Validation/Test 149/31/33게임. 인접 입력 간격과 다음 action 진단 열이 있음. Hold 구간 제외. 상태·공격·첫 행동 대기를 추정해 붙이지 않음 |
| [B0~B2 Validation](../../../ai-harness/ml-experiments/experiments/human-timing-baseline.md) | 고정 평균/전체 분포/이전 행동별 분포. game-macro CRPS 75.150/54.270/53.028ms. CRPS·분할·경로 보호·표/그래프·테스트 재사용 |
| [고정 B2 Test](../../../ai-harness/ml-experiments/experiments/human-timing-b2-test-evaluation.md) | 33게임/9,859 pair, fit 0, game-macro CRPS 51.871ms. 이미 관측했으므로 후속 구조의 손대지 않은 최종 Test로 재사용하지 않음 |
| [B3 Full Validation](../../../ai-harness/ml-experiments/experiments/human-timing-history-baseline.md#사용자-full-결과와-계획-판단--2026-10-27) | B2 53.028 → B3 49.743ms, 약 6.20% 개선, 26게임 개선/5악화. Human 과거 간격을 제공한 one-step 평가이지 자체 실행 평가가 아님 |
| [joint Full Validation](../../../ai-harness/ml-experiments/experiments/human-action-timing-joint-baseline.md#9-사용자-full-해석하드드롭-재확인--2026-10-29) | Global→previous action: NLL 1.418558→1.232912, F1 0.081364→0.237967, marginal CRPS 54.269946→53.028209ms. 행동 확률의 조건 신호이나 argmax hard_drop/rotate 예측 0. 전체 controller로 미채택 |
| [기존 로그 활용 조사](../experiments/human-action-observation-link-audit.md#6-기존-로그만으로-완성할-경로-조사-2026-10-28) | timing v1에 다음 행동 label도 존재함을 Train/Validation 열·개수·SHA로 재확인. 같은 자료로 행동+간격 실험 가능. Hold 1,138구간이 제외돼 있어 Hold는 기존 raw의 별도 view로 다룸. 미확인 상태는 추정하지 않음 |
| 기존 core·authoritative 입력·PVE 실행기 | 규칙·충돌·Hold 제한·실행 안전성 재사용. Python에서 게임 규칙을 다시 구현하지 않음 |

0ms 과거 원인 조사는 [마지막 재현 기록](../../../ai-harness/runs/human-timing-zero-ms-reproduction-2026-10-26.md)으로 종료했다.
0ms 포함 정책·민감도 분석을 유지하며 이 개정으로 원인 추적을 재개하지 않는다.
기존 source Notebook의 사용자 output/count·full 설정과 ML 전체 gate 보류는 보존한다. 문서 개정이 해당 검사 통과를 뜻하지 않는다.

## 3. 검토 후보 A: V4 배치 → 조작 습관 → 타이밍 → 실행

아래 모듈형 A는 **미채택 검토 후보**다. 개별 자산은 있지만 이 결합 시스템은 아직 구현·검증되지 않았다.

```text
기존 Human raw
  ├─ 정합한 boardBefore·조각 상태 → selectedPlacement (배치 정답)
  └─ inputSequence·기록 간격·명시적 구간 경계 (조작/시간 정답)
                       ↓
       A1: V4 계열 배치 ranker → 선택한 물리 배치 목표
                       ↓
       A2: 목표 + 관측 prefix → 다음 조작의 분포
                       ↓
       A3: 선택한 조작 + 사용 가능한 이력/목표 → 대기시간 분포
                       ↓
       기존 core로 합법성·도달 가능성·실행 순서 확인
                       ↓
       중단 가능한 대기 → authoritative 입력 → 결과 확인
                       ↑
       Hold/spawn/보정/관련 상태 변화 → 예약 폐기·재판단

향후 B: 정합한 추가 자료가 충분할 때
        공유 encoder + 배치/action/시간 head를 A와 비교
```

### 모듈별 계약과 재사용

| 모듈 | 입력 → 출력 | 우선 재사용·검증 |
| --- | --- | --- |
| A1. 배치 선택 | 지원 ruleset의 후보·기존16-feature → physical class·대표 key·score | [V4 trainer](../../../scripts/ml/train_placement_v4.py), [reference](../../../scripts/ml/placement_v4_reference_inference.py), [scorer](../../../src/client/game/ai/ml/placementV4OfflineScorer.ts), [adapter](../../../src/client/game/ai/ml/placementV4PveDecisionAdapter.ts). Human 선택 class가 학습 정답이며 alias 개수로 weight를 부풀리지 않음 |
| A2. 조작 습관 | 선택 목표·조각·이미 관측한 action prefix 등 지원 정보 → 다음 semantic action 분포 | 기존 목표 조건 prefix/정보 분리 실험의 parser·feature·모델·평가 재사용. Human 행동열을 시도 label로 학습하며 성공 경로/미기록 action 직전 상태를 만들어 붙이지 않음 |
| A3. 타이밍 | 선택한 action·관측된 이전 간격 등 지원 이력 → 다음 실행까지의 대기 분포 | B2/B3는 비교 기준이며 자동 채택하지 않음. 지원되는 목표/prefix 조건과 시간 모델은 별도 명세에서 고정. 모델이 선택할 때 알 수 있는 정보만 입력으로 사용 |
| 실행·안전 | 목표·action·delay + authoritative current state → 실행/거부·취소·재계획 | 기존 core와 PVE executor. 학습 정책과 달리 현재 상태를 안전 검사에 쓸 수 있으나 이를 Human 상태 반응 학습의 증거로 부르지 않음 |

조작/시간은 별도 학습·평가 단위로 유지하되, 정보와 출력이 분리된 작은 head를 같은 controller에서 호출하는 구현은 허용한다. 지금 새 service·프레임워크·서버를 미리 나누지 않는다.
목표 전달에는 최소한 piece identity/index·physical class/key·ruleset·model/schema 식별을 보존한다. Hold/spawn/보정으로 대상이 바뀌면 이전 목표·prefix·예약을 무효화한다. 세부 runtime payload는 통합 명세에서 정한다.

현재 V4/PVE 경로는 선택 placement의 기존 `plannedActions`를 실행한다. **기존 경로에 사람 간격만 붙이는 것은 조작 습관 학습의 완료가 아니다.** 새 action 모델의 선택과 core 경로 보조/안전 개입을 구분해 집계하고, 무작위 이동을 섞는 것으로 Human 조작 모방을 대신하지 않는다.

- 예측 단위는 game/player의 연속 관측 지점이다. 로그를 독립된 블록 row로 섞지 않고 순서·piece/Hold 경계를 보존한다.
- 첫 범위는 기록이 지원하는 `move_left/right, rotate/rotate_ccw, soft_drop, hard_drop, hold` 같은 **semantic action**이다. 물리 키 누름/뗌·DAS/ARR 습관까지 복원했다고 주장하지 않는다.
- 학습 정책이 보는 이력과 실행기가 안전성을 위해 보는 current state를 분리한다. 실행기의 공격 변화 대응이 Human 공격 반응을 학습한 증거는 아니다.
- 행동 label은 다음 관측 action이다. 시간은 그 행동까지의 관측 간격이며, 의도·고민·공격 회피 같은 마음속 이유는 정답으로 만들지 않는다.
- `WAIT`를 매 tick의 추가 class로 바로 만들지 않는다. 우선 action+대기 분포를 설계 가설로 두고, 무입력 관측 구간과 종료/누락 경계를 확인한 뒤 필요한 경우에만 명시적 WAIT 방식과 비교한다.
- 도달 가능한 후보 생성·충돌 검사·입력 실행은 기존 core의 책임이다. 후보 중 어디를 선호할지는 Human 배치 정답으로 학습한 모델이 결정한다. 휴리스틱 점수로 목표를 선정하거나 후보를 사전 선별하지 않는다. 안전 제약의 개입/거부는 별도 집계한다.

### 시간은 세 가지로 나눠 검증한다

| 관측량 | 필요한 시작·끝 | 해석의 한계 |
| --- | --- | --- |
| 첫 행동까지 대기 | 기존 자료에서 시작 시각 미확인 | 학습 label로 만들지 않음. 실행 설정으로 제공하면 학습한 반응시간과 구분 |
| 조작 사이 간격 | 직전 action → 다음 action, 도중 관측 변화 포함 | 기존 B0~B3가 다룬 범위. 실행 리듬과 상황 반응이 섞일 수 있음 |
| 사건 이후 행동 변화 | 기존 기록에 관측 시점이 연결된 경우만 | 없는 경우 이 목표는 학습/성능 주장 범위에서 제외. 실행기 안전 대응은 별개 |

게임 종료·끊김·기록 잘림 전에 다음 action을 못 본 구간은 “매우 긴 대기” label로 만들지 않는다.
관측 종료로 시간을 끝까지 모르는 구간으로 구분한다. 새 관측이 도중 들어온 경우 최초 계획과 남은 대기를 구분한다.

## 전체 AI 구조 비교: 두 후보 검토

사용자가 요청한 **A 모듈 조합형 / B 통합 신경망형** 두 버전은 검토 후보로 유지한다. 어느 쪽을 먼저 개발할지 또는 기존 신경망 실험을 어떻게 이어갈지는 아직 결정하지 않았다.
A/B는 전체 구조 이름이며 timing B0~B3·placement V0~V4와 다르다. A의 controller 구체 크기·loss와 B의 층 수는 아직 채택하지 않았다.

| 구조 | 제안·가설 | 주의점 |
| --- | --- | --- |
| A. 모듈 조합형 — 검토 후보 | V4 계열 Human 배치 ranker → 목표 조건부 조작 습관 → 타이밍 모듈 | 배치/조작/시간을 따로 검증한 뒤 예측 목표로 결합. 기존 artifact 누수·ruleset·목표와 경로의 연결을 확인 |
| B. 통합 신경망형 — 검토 후보 | 정합한 보드/조각·관측 이력을 인코딩 → 배치 선택 head와 action/시간 head를 함께 학습하는 후보 | 추가 자료의 coverage·시점 정합·안정된 검증 근거가 있을 때만 비교. 게임 수가 늘었다는 이유로 자동 전환하지 않음 |

A/B의 최종 목표는 배치 결정과 조작/리듬 모두의 모방이다. 현재 timing pair 공동 기준선은 이 중 조작/시간의 부분 기준선으로만 사용한다. 기존 보드·조각/`selectedPlacement` offline view와 V4 candidate/feature 입력의 연결을 명세하며 이미 만든 view나 timing v1을 무조건 다시 생성/덮어쓰지 않는다.
구체 크기·loss·평활화·예산은 후보 결과를 보기 전 명세에서 정한다. 이번에는 신경망 dependency를 설치하지 않는다.

2133개의 절대 배치 ID를 직접 분류하는 snapshot MLP·L2·스케일링·학습곡선은 기존 근거로 보존하되 추가 튜닝 여부도 후속 실험 선택 때 결정한다. 후보의 관계를 점수화하는 V4 계열은 다른 상태의 후보에도 같은16개 weight를 적용하는 방식이므로 희소한 정답 ID 분류와 다른 재사용 가설이다. 더 낫다는 결론은 동일 cohort·같은 physical-class 평가 후에만 낸다. 과거 V4의 Top-1과 snapshot13.42%는 후보 공간·분모가 달라 직접 비교하지 않는다.

배치 모델에서 `selectedPlacement`는 label 전용이다. A의 목표 조건부 조작 모델은 학습 때 Human 목표를 조건으로 받을 수 있지만, 전체 추론/평가에서는 **배치 모델이 예측한 목표**를 사용한다. Human 최종 목표를 미리 준 decoder 평가는 oracle 진단으로 분리한다.
V4 예측 목표가 Human 목표와 다를 때 원래 Human 조작열을 그 예측 목표의 정답 경로로 바꾸어 학습하지 않는다. 같은 목표의 decoder 진단과 예측 목표 기반 실제 도달 평가를 분리한다. 각 모듈은 같은 split 경계를 따르되 타이밍 전용으로만 유효한 구간을 배치 정답에 억지로 결합하지 않는다.
행동 조건부 시간 head를 학습할 때의 정답 action과 실제 추론 때 선택한 action도 구분한다. 전체 정책 평가에 실제 미래 action을 알려준 시간 점수를 섞지 않고, 정답 action 조건 평가는 별도 진단으로 표시한다.
기존 원본 확장에서 Hold 시도를 행동 label로 배울 수 있다. 성공/전략 정답으로 승격하지 않으며 추론 시 가능 여부는 core가 판정하고 교체 후 낡은 목표/경로를 버린다.
A/B 모두 같은 관측 범위·cohort·split·ruleset·실행기·안전 제한·평가 조건을 사용한다. Heuristic 지원이 다르면 그 차이를 분리한다.

### B 통합 신경망을 다시 검토할 조건

- 현재 신규 수집은 하지 않는다. 향후 사용자가 확보한 자료가 추가되면 기존 품질·lineage·game split을 유지한 새 immutable revision을 별도 승인한다.
- 게임 수뿐 아니라 배치/보드·조작별 사례 수, 희소 행동·Hold의 지원 여부, 상태/목표/action의 시점 정합을 확인한다. 없는 필드를 추정해 채우지 않으며 현재 게임 수만으로 필요 판수를 정하지 않는다.
- A의 모듈별/결합 오류와 학습곡선의 변동을 기준선으로 확보하고, 동일 입력 정보·평가 범위에서 B의 Train/Validation loss·배치/행동/시간 지표와 자체 실행을 비교한다. 가능하면 모듈 결합만으로 설명되는 이익과 공동 학습의 이익을 분리한다.
- B가 모방 품질·목표 도달·안전성에서 사전 합의 기준을 충족할 때만 전환을 검토한다. A를 기준선으로 채택한 경우 개선이 없으면 A를 유지한다. 공유 encoder나 다중 head는 후보 구조이지 신경망이 자동으로 더 강하다는 약속이 아니다.
- B는 세 모듈의 파일이나 weight를 그대로 합치는 작업이 아니라, 정합한 입력·목표·이력과 Human label로 새롭게 공동 학습하는 실험이다. A의 데이터 계약·평가/안전 실행기를 재사용하고 A를 고정 비교 기준으로 남긴다.
- 이미 본 Test33게임은 새 독립 증거로 바꾸지 않는다. 추가 자료도 평가 전 학습에 섞지 않고 별도 holdout 계획을 정한다.

## 4. 데이터 계획: 기존 자료를 버리지 않고 용도를 나눈다

| 자료 | 처리 |
| --- | --- |
| 검증된 timing-only v1 | immutable 유지. B0~B3 비교·기록 시간 진단에 재사용 |
| 기존 Human placement 원본 | `boardBefore`·당시 조각 상태를 입력 후보, `selectedPlacement`를 정답으로 하는 배치 view. 같은 occupied-cell 배치의 표현 중복은 class로 묶고 사람 선택 class를 label로 사용 |
| 원본에서 행동 직전 상태까지 연결 가능한 구간 | 증거를 확인한 후 **새 revision**의 상황 조건부 dataset 후보로 사용 |
| 상태는 불명확하고 순서/간격만 유효한 구간 | timing/sequence 제한 용도로 보존. 상황 label을 보간하거나 0으로 채우지 않음 |
| 누락·불일치·Hold 전후 불명확 구간 | 해당 과제에서 격리하고 사유·편향 보고. 원본 삭제 없음 |
| 현재 v3/40행 자료 | legacy 20행과 별도 lineage. 필드 이름이 같다고 혼합하지 않으며 사이트 평가에는 지원 ruleset 자료 필요 |

V4 배치 재사용에서는 다음 경계를 먼저 정한다.

1. 기존125게임 artifact의 학습 gameId와 현재 Train149/Validation31/Test33 ID를 대조한다. 겹치면 그 artifact의 새 held-out 평가라고 부르지 않으며 현재 Train-only V4 계열 재학습 후보로 분리한다. 지금 ID가 겹친다/안 겹친다고 확인 없이 단정하지 않는다.
2. 기존 V4 candidate/16-feature가 어느 기존 로그·dataset에서 확보되는지 확인한다. 현재 snapshot view의 보드/정답만으로 모든 대안 candidate feature가 있다고 가정하지 않는다. 기존 exporter/parser/core를 재사용하고 Python 규칙 재구현이나 JS 학습 실험 재현을 만들지 않는다.
3. feature 순서·scaler·physical class·좌표·ruleset을 고정한다. legacy20행 artifact를 현재40행에 패딩/형 변환만으로 호환시키지 않는다. 호환 근거가 없으면 legacy offline 범위까지만 진행하고 사이트 연결은 보류한다.

현재 [기록 코드](../../../src/client/game/runtime/tetris.ts)의 `createPlacementDecisionContext`는 **고정 직전** board/queue/Hold를 복사한다.
[저장 projector](../../../src/server/services/gameEventProjector.ts)의 개별 input은 action/tick/pieceIndex 및 선택적 sequence/createdAt이다.
따라서 placement의 `boardBefore`라는 이름만으로 모든 action 직전 상태·Hold 이전 상태·공격 큐가 보존됐다고 판단할 수 없다.
반대로 이것만으로 모든 원본이 복원 불가능하다고 결론 내리지도 않는다. 시점별 근거가 있는 구간만 검증한다.

배치 단위에서는 보드·조각과 선택 결과의 대응, 선택 class의 합법성/도달 가능성, Hold 전후의 대상 조각을 기존 기록 안에서 확인한다. 고정 직전 보드를 spawn 당시 보드로 바꿔 부르지 않는다. 이 검증을 통과한 placement를 배치 모방에 쓰며 action별 상태 미확인을 이유로 배치 학습 목표를 없애지 않는다. `boardAfter`·줄 삭제/공격 결과·승패와 `selectedPlacement` 좌표는 배치 모델의 입력에 넣지 않는다.

새 계약에서 확인할 항목:

- 사람에게 실제 노출된 관측과 서버 확정 상태를 구분한다. 서버 state를 당시 Human의 관측으로 소급 대체하지 않는다.
- action 직전 보드·조각·공개 next·Hold availability, 이미 알려진 공격량/도착 정보, gravity/lock 상태의 출처·시점을 확인한다.
- spawn/관측/action attempt/action outcome/외부 사건의 순서와 clock domain을 명시한다. client `Date.now`와 server 수신시각을 그대로 빼지 않는다.
- 성공 여부 미기록을 성공으로 간주하지 않는다. 미래 배치·줄 삭제·공격 결과·승패·비공개 queue·전체 미래 입력을 feature에서 제외한다.
- 없는 기록은 요구하는 과제/주장을 제외하거나 보류한다. 추가 기록을 요청하는 방향으로 바꾸지 않는다.
- 이미 관측한 cohort는 개발 자료다. 현재 Train 내부 game-grouped 검증과 고정 Validation을 사용하고 Test는 이미 본 진단 자료로 표시한다. 재분할해도 새 독립 증거가 되지 않는다. 같은 game/PVP 양쪽을 split에 나누지 않는다.
- 사용자 식별 근거가 있으면 가명 user holdout을 별도로 검토한다. 없으면 개인화/신규 사용자 일반화 근거를 주장하지 않는다.

세부 data contract는 [Human 조작 dataset 계약](../contracts/human-action-dataset.md)에 둔다.
원본 export/parser·무결성/품질 gate·game split은 재사용하고, 바뀐 관측·label 추출만 확장한다. 파이프라인 전체를 새로 만들지 않는다.

## 5. 앞으로의 실행 순서

| 단계 | 질문·작업 | 산출물·완료 조건 |
| --- | --- | --- |
| 1. 관측 연결 확인 — 완료 | 기존 로그로 행동 직전 상태·첫 대기·공격·Hold를 구분할 수 있는가? | [감사 결과](../experiments/human-action-observation-link-audit.md). 활용 가능한 행동열/간격과 미확인 상태를 구분. 부족한 필드 때문에 기존 자료 전체를 폐기하지 않음 |
| 2. 첫 공동 예측 실험 — 사용자 Full 해석 완료 | [고정 명세](../../../ai-harness/ml-experiments/experiments/human-action-timing-joint-baseline.md)에서 직전 action 조건 사용 여부만 비교 | `conditional_signal_observed`, 조작/시간 부분 기준선 보존. 최종 배치·조작 controller나 구조/제품 채택 아님 |
| 3. 기존 자료의 학습 view 구성 — 사용자 Full 해석 완료 | [offline-use-v1](../contracts/human-placement-action-link.md#9-기존-로그의-학습-사용-범위--offline-use-v1)과 [구성 명세](../../../ai-harness/ml-experiments/experiments/human-placement-action-offline-views.md)에 따라 입력/정답/oracle 조건을 분리 |180게임·7,959구간 보존·970 Hold 보류. 목표 공통 적격 Train6,417/Validation1,516. Snapshot 관계와 실제 상태 정책의 지원을 구분 |
| 4. 후속 구조 선택 — 다음 논의 | 모듈형 V4 재사용과 통합 신경망 실험 중 어떤 가설을 먼저 검증할 것인가? | 사용자 선택 후 한 실험의 입력·비교 조건·예산·판정 기준을 명세. 아래5~8단계는 A를 채택할 경우의 미승인 제안 |
| 5. A 채택 시: 개별 모듈 검증 | V4 배치 Top-1/Top-3/MRR, 목표 조건 action NLL/F1/행동별 recall, 시간 CRPS/분포를 분리 | 배치/조작/시간 baseline과 고정 예산·지원 범위를 결과 전 명세. 기존 모듈 재사용·Train-only 처리·timing v1 불변. Hold는 기존 raw 지원 범위의 별도 확장으로 분리 |
| 6. A 채택 시: 결합·자체 실행·체감 검증 | 예측 V4 목표에 Human 조작/리듬 모듈이 실제 도달하는가? | oracle 목표 진단과 별개로 예측 목표 도달률·최종 placement·경로 보조/거부·deadline·무한 대기·생존·속도 통제 체감 비교. 합성 실행을 Human 학습 자료에 섞지 않음 |
| 7. A 채택 시: 모듈형 PVE 체험 | 지원 ruleset에서 배치·action·timing bundle과 안전 실행기가 결합 검증을 통과하는가? | 후보 동결 뒤 trainer/artifact·필요한 경계 parity·명시적 opt-in·오류 표시/rollback. 현재 운영 기본값과40행 V4 미지원 계약은 별도 구현/검증 전 유지 |
| 8. 후속 연구 후보: B 통합 신경망 | 향후 자료/관측 정합/coverage가 충분할 때 공동 학습이 A보다 유리한가? | A와 같은 조건에서 사전 고정된 평가. 미달이면 A 유지. 새 수집·학습·사이트 교체를 자동 시작하지 않음 |

각 단계는 해당 질문까지만 마감한다. 정보가 부족하면 목표/주장을 줄이거나 해당 가설을 보류한다. 새 수집이나 전량 replay를 선행 조건으로 만들지 않고 기존 감사/full을 기계적으로 반복하지 않는다.
학습을 조금씩 하는 이유는 fine-tuning을 반복하려는 것이 아니라, **어떤 관측이 어떤 행동을 설명하는지** 확인한 뒤 모델 복잡도를 늘리기 위해서다.

### 현재 다음 한 작업: 구조 선택 검토

다음 구현은 아직 승인되지 않았다. 완료한 품질·관측·view·희소성 결과를 재사용해 두 구조의 장단점과 기존 자료 지원 범위를 설명하고 사용자가 실험을 선택한 뒤 명세를 고정한다. A 선택 시에만 V4 cohort·feature/ruleset·목표/action/delay 인터페이스를 대조한다. 기존40행 미지원 guard와 운영 기본 정책은 유지한다.

아래 “다음” 제목은 이전 링크를 위한 완료/준비 당시 기록이다. 위 후보 순서도 아직 실행 승인이 아니며 과거 Full을 다시 실행하지 않는다.

### 다음 한 작업: 기존 pair의 행동·간격 공동 기준선 Full 결과 해석

이 절은 이전 링크를 위한 완료 기록이다. [명세 9절](../../../ai-harness/ml-experiments/experiments/human-action-timing-joint-baseline.md#9-사용자-full-해석하드드롭-재확인--2026-10-29)에서 사용자 Full을 해석했고 재실행하지 않았다. 다음 작업은 아래 연결 계약이며 이 부분 기준선의 완료로 전체 배치·조작 모방을 완료 처리하지 않는다.

### 다음 한 작업: 기존 raw의 배치·조작 연결 확인

[계약](../contracts/human-placement-action-link.md)에 따른 [점검 Notebook](../../../scripts/ml/notebooks/human_placement_action_link_readiness.ipynb)을 구현했다. 기본 모두 실행은 가상 Smoke이고, 승인된 Train 3개/28 pair도 기존 parser·readiness/품질 binding으로 연결했다. 구조 연결은 확인했지만 관측/과거 geometry·reachability·입력 성공은 미확인이다. 다음 별도 판단은 이 coverage를 바탕으로 과거 관측 시점/규칙 근거를 어느 범위에서 확인할지 정하는 것이다. 실제 전체 raw 검사·replay·dataset 생성·모델 fit·신경망·사이트 적용을 자동 시작하지 않으며 미확인을 정상 label로 채우지 않는다.

### 현재 다음 작업: 상태·규칙 근거 표본 결과 해석

이 절은 이전 링크를 위한 완료 기록이다. 사용자 실제 세 표본의 저장 출력을 해석했다. 두 저장 보드 경계와 같은 rotation의 저장 표현은 일관됐지만 ruleset/stage/build 및 입력별 상태/outcome 근거는 부족했다. 이를 기록한 [명세](../../../ai-harness/ml-experiments/experiments/human-placement-context-evidence.md)의 결과를 실제 replay 성공이나 전량 데이터 판정으로 확대하지 않는다.

### 완료 기록: 사람 배치·조작 오프라인 view 구성

[명세](../../../ai-harness/ml-experiments/experiments/human-placement-action-offline-views.md)의 사용자 작은 Train/Full을 검토했다. 180게임의 view를 생성했고 Hold를 보류하며 BOS 첫 행동/null 시간·실제0ms를 보존했다. 파일 SHA·공통 적격·누수0을 확인했으며 이 dataset을 반복 생성하지 않는다. 배치/상태 정책과 runtime 지원은 미검증이다.

### 완료 기록: 목표 조건 prefix Full

[Notebook](../../../scripts/ml/notebooks/human_goal_conditioned_prefix.ipynb)의 사용자 Full은 `oracle_goal_signal_observed`였다. 같은 공통 표본의 행동/시간 MLP(101→ReLU64→softmax,30epoch)에서 Human 목표 묶음의 신호를 확인했고 이후 조각 종류와 셀 좌표를 분리했다. 기존 Notebook/report를 보존하고 재현 경로로만 유지한다. Oracle 이득을 Human 배치 예측·전체 AI/rollout 성공으로 해석하지 않는다.

### 현재 다음 실행: Human 배치 snapshot 기준선 Full

[정보 분리 Notebook](../../../scripts/ml/notebooks/human_goal_information_ablation.ipynb)의 승인된 Full-only1회에서 목표 셀 추가 시 accuracy0.518772→0.667455, NLL1.066450→0.796889, F1 0.356127→0.480830을 관측했다. NLL/F1은31게임 모두 개선했고 이전 두 조건은 재현됐다. 별도 Smoke 학습은0이며 새 조건 반복 결정성/동결 감사는 하지 않았다.

[배치 snapshot 명세](../../../ai-harness/ml-experiments/experiments/human-placement-snapshot-baseline.md)와 [Notebook](../../../scripts/ml/notebooks/human_placement_snapshot_baseline.ipynb)을 작성했다. 보드 점유200+pieceType7 입력에서 보드 mask 유무를 같은 MLP(64hidden)로 비교한다. 최종 activePiece row/col/rotation/cells·selectedPlacement는 입력에서 제외한다. Train-only2133-class 어휘에 없는 Validation152/1516개도 실패로 전체 분모에 남긴다. 어휘 목록은 합법/도달 가능 후보 목록이 아니며 boardBefore도 행동 직전 관측으로 확정되지 않았다. 현재는 코드/내부 검사·로딩만 확인했고 실제 Full 학습은 사용자가3절에서 실행한다. 새 수집·replay·휴리스틱 정답·controller 연결을 시작하지 않았다.

구성 결과의 적격 수를 확인한 뒤 첫 조작 학습 질문은 동일 공통 표본에서 `prefix_only`와 `oracle_goal_prefix`를 비교하는 것이다. 목표 조건 유무만 바꾸며 구조/예산/지표는 별도 fit 전 명세에서 고정한다. 이것은 A/B 전체 구조 비교나 제품 채택이 아니다. 별도의 Human 배치 선택 학습과 예측 목표 기반 실행 검증은 최종 목표의 필수 단계로 남는다. B 통합 상태 모델은 action 관측 정합 조건이 확인될 때 비교하며 미확인 보드를 과거 action에 소급하지 않는다.

### 다음 한 작업: 행동 직전 관측 연결 가능성 확인

이 제목은 이전 계획 링크를 유지하는 완료 작업의 진입점이다. 아래 범위는 [감사 문서](../experiments/human-action-observation-link-audit.md)로 마감했다. 후속 신규 수집은 취소됐다. 다음 계획은 추가 수집이 아니라 기존 자료에서 확인 가능한 과제의 범위 재정의다.

1. 기존 readiness 결과와 실제 기록/저장 schema를 재사용해 필요한 필드별 생성 시점·보존 여부·누락 상태를 표로 만든다.
2. 일반 조작·Hold·공격 도착·spawn 첫 행동의 작은 비식별 trace로 관측→action 연결을 확인한다. 기존 자료에 해당 사례가 없으면 없음으로 기록한다.
3. 직접 기록된 것과 재생으로만 복원 가능한 것을 나눈다. Replay가 필요하면 당시 ruleset·초기 상태·사건 순서와 대조 가능한 anchor부터 확인하며, 지금 전체 replay 구현/실행을 시작하지 않는다.
4. 기존 로그만으로 시작 가능한 과제와 부족한 필드를 적는다. 부족한 필드는 해당 성능 주장에서 제외하고 기존 자료의 실험 명세로 연결한다.

완료 조건: 모든 필요한 입력/label에 **근거 또는 미확인 사유**가 있고, 상태 미확인을 정상 값으로 채우지 않았으며,
원본·timing dataset·Test·runtime을 변경하지 않았음을 확인한다.
이번 감사에서는 기존 parser를 이용한 작은 읽기 전용 대조만 했다. 새 Notebook·학습·전체 replay·수집 구현은 선행하지 않았다.

## 6. 평가·학습·승격 계약

- 새 실험 코드·작은 assert는 Notebook 한 곳에 둔다. 설명→작은 예제→Smoke 설정/실행/결과→Full 설정/실행/결과→해석 순서이며 pandas·Matplotlib로 결과를 읽는다. 새 실험용 `.py`/테스트를 늘리지 않고 기존 검사는 유지한다.
- 사용자 Full-only 원칙을 현재 후속 실험에도 유지한다. 별도 Smoke 학습은 만들지 않고 짧은 가상 assert와 Full 설정/실행/결과를 분리한다. 위 Smoke 순서는 과거 실험의 일반 형식이며 현재 새 모델을 작은 표본으로 먼저 학습하라는 지시가 아니다.
- Python 테스트는 Notebook 정의를 검증하며 실험 구현을 복제하지 않는다. 제목·코드 문자열 계약 검사도 유지한다. 최종 모델 동결 뒤에만 최종 trainer를 `.py`로 분리한다.
- action은 game별 집계와 행동별 precision/recall·macro F1·확률 오차를 본다. 드문 Hold·회전 방향과 “항상 같은 행동” 기준선을 따로 비교한다.
- 배치 선택은 같은 물리 배치 class의 Human 선택을 기준으로 Top-1/Top-3/MRR·game별 편차를 평가한다. 후보 생성/reachability는 규칙 검사이지 휴리스틱 선호 정답이 아니다. 기존 휴리스틱은 독립 비교 기준일 수 있으나 새 정책의 목표 선택/label을 대신하지 않는다.
- 시간은 첫 행동/조작 사이/사건 이후를 분리하고 CRPS·분위수 보정·0ms/긴 대기 분포를 본다. 다른 label·다른 표본의 CRPS를 성능 향상으로 직접 비교하지 않는다.
- 보드 높이·holes·공격 유무·Hold·조각·game/ruleset별 slice를 보고, 같은 게임 안의 상관을 고려해 game 단위 변동/불확실성을 보고한다. 관측된 상관을 전략적 의도의 인과 증거로 해석하지 않는다.
- 한 단계 예측과 자체 실행 결과를 분리한다. Rollout에서는 불법/막힌 행동 반복·Hold 실패·무한 대기·deadline 초과·fallback·생존을 확인한다. 승률은 모방과 별도다.
- 결합 비교는 최소한 V4+기존 경로/실행 설정 기준선과 V4+학습한 action/timing을 같은 seed·규칙으로 대조한다. V4+기존 경로+학습 timing은 조작 습관의 효과와 리듬 효과를 구분할 필요가 있을 때만 추가하는 진단이며 전체 Human action 학습 완료로 부르지 않는다.
- Human prefix/목표로 한 단계 점수가 좋아져도 자체 실행 중 생긴 prefix/보드에서 성공한다는 보장은 없다. 이 때문에 예측 목표 기반 결합 평가를 따로 둔다. 이는 [순차 모방학습 연구](https://proceedings.mlr.press/v15/ross11a.html)의 오류 누적 문제를 이 프로젝트에 적용한 설계 판단이며 신규 사람 정답을 요구하는 DAgger 도입은 아니다.
- 사람다운 체감은 모델명을 가린 무작위 영상/체험 비교로 확인한다. 실제 속도 그대로의 결과와 평균 속도를 맞춘 비교를 구분하고 seed·난이도·입력 조건과 평가 인원/편향을 기록한다.
- 구체적인 학습 예산·성공/허용 회귀 기준은 **후보 결과를 보기 전에** 명세에 고정한다. 현재 6.20% 개선을 새 과제의 채택 threshold로 전용하지 않는다.
- Full은 사용자가 실행하거나 명시 승인할 때만 한다. 기존 Test 33게임을 다시 분할하거나 반복 평가해 새 독립 검증으로 부르지 않는다. 현재는 개발/진단 증거와 합성 실행 안정성으로 범위가 제한된 체험 여부를 판단한다.

## 7. 사이트 적용 경계와 rollback

기존 core/authoritative 입력 경로가 최종 판정을 소유한다. 모델은 board를 직접 수정하지 않는다.
대기는 다음 실행 시각으로 예약하며 sleep/추론 await로 ticker를 막지 않는다.
최대 대기·행동 수·반복 실패·추론 시간 예산과 관련 상태 변화의 취소 규칙은 통합 전에 정한다.
Hold/spawn/보정 후 낡은 조작과 예약을 폐기하고 최신 관측에서 다시 판단한다.

현재 운영 기본 정책은 이 계획 수정으로 변경하지 않는다. 새 모방 opt-in 경로의 배치 목표는 학습한 Human 배치 모델이 결정한다. Ruleset·feature/schema·clock 의미·전처리·model SHA가 맞지 않으면 명시적으로 오류/미지원 상태를 표시한다. 장애 대응을 별도 정책으로 설계하되 이를 Human 배치 모델의 선택이나 모방 성공으로 집계하지 않는다. B2/B3를 조용히 전체 AI로 대체하지 않는다.
Human 로그와 ML/heuristic/fallback provenance를 분리해 자동 재학습에 섞지 않는다.
UI는 “Human 행동 학습 실험”과 한계를 알리고 개인 복제·강함을 과장하지 않는다.
다중 room·재접속·지연·모델 오류·로그 저장 실패를 별도 통합 검사하고,
문제 발생 시 opt-in을 끄거나 이전 호환 artifact로 돌릴 수 있어야 한다. 자동 온라인 학습·새 Python 추론 서버는 현재 범위가 아니다.

## 다음 작업 실행 계획: timing baseline

이 제목은 과거 계획 링크를 위한 역사적 진입점이다. 당시 구현·사용자 실행·해석 단계는
[baseline 명세](../../../ai-harness/ml-experiments/experiments/human-timing-baseline.md),
[B2 Test 명세](../../../ai-harness/ml-experiments/experiments/human-timing-b2-test-evaluation.md),
[B3 명세](../../../ai-harness/ml-experiments/experiments/human-timing-history-baseline.md)에 보존했다.
현재 실행 순서는 위1~8단계의 완료 이력과 미승인 후보 로드맵이며 timing-only 재실행 지시가 아니다.

## 현재 참고 문서의 상태

| 문서 | 상태 |
| --- | --- |
| [AI 문서 안내](../README.md) | 현재 진입점 |
| [로그·dataset 정책](game-log-dataset-policy.md) | v3 저장과 legacy placement의 경계 |
| [V4 신규 로그 재학습안](new-log-cleaning-training-plan.md) | 보류 제안. 실행 완료 이력 아님 |
| [이전 대화 요약](data-cleaning-training-conversation-summary.md) | 조사 배경. 실행 지침 아님 |
| [과거 실험 순서](../../archive/ai-ml/README.md) | 완료·보류를 구분한 읽기 목차 |
