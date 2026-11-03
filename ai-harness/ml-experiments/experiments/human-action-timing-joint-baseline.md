# ML Experiment: Human 다음 행동·간격 공동 기준선

## 상태와 질문

- Experiment ID: `human-action-timing-joint-baseline`
- Lifecycle: `validation_analyzed`, Program gate: `continue_experimenting`
- 현재 작업: **사용자 Full 실행·결과 해석 완료**. 직전 action 조건의 예측 신호를 확인했고 전체 controller로 채택하지 않았다.
- 다음 작업: [배치·조작 연결 계약](../../../docs/ai-ml/contracts/human-placement-action-link.md)에 따른 기존 raw의 view 정합 확인. 재학습·Full 반복은 자동 시작하지 않는다.
- 질문: **직전 행동을 조건으로 주는 것이 전체 행동 분포만 쓰는 것보다 다음 시도 action을 더 잘 예측하면서 시간 분포도 유지하는가?**
- 목표: 기존 자료로 행동과 시간을 함께 출력하는 최소 기준선을 만든다. 보드 판단·Hold 전략·사람다운 실제 플레이를 검증하는 실험은 아니다.
- 근거: [기존 로그 활용 조사 6절](../../../docs/ai-ml/experiments/human-action-observation-link-audit.md#6-기존-로그만으로-완성할-경로-조사-2026-10-28), [현재 계획](../../../docs/ai-ml/strategy/ai-plan.md).

### 사용자 결정과 전체 계획에서의 역할 — 2026-10-29

- 모방 대상은 특정 개인이 아니라 **수집된 여러 Human의 전반적인 플레이 성향**이다. 기존 품질 정책·game split과 승패 무관 Human 선정은 유지하고, 개인별 모델·식별 feature·개인화 평가는 추가하지 않는다.
- 사용자는 배치 학습 준비보다 **이 공동 기준선의 구현을 먼저** 진행하는 순서를 선택했다. 이번 결정 반영은 문서 작업이며 Notebook implement-smoke와 Full은 별도 요청으로 진행한다.
- 이 실험은 전체 Human AI 중 **다음 행동·시간 부분의 기준선**이다. 결과가 좋아도 배치 판단·상황 이해·Hold 전략·전체 플레이 모방을 완료한 것으로 판정하지 않는다.
- 기준선 결과 검토 뒤 기존 raw의 보드·조각과 `selectedPlacement`를 연결하는 배치 view/명세를 준비한다. 배치 선택은 Human label로 학습하며 휴리스틱 배치를 전제로 대체하지 않는다.
- 이후 목표 조건부 조작 모델과 결합할 때 전체 추론/평가는 **배치 모델이 예측한 목표**를 사용한다. 정답 Human 목표를 제공한 평가는 oracle 진단으로 분리한다. 이번 기준선에 배치 목표나 보드를 입력으로 추가하지 않는다.

## 1. 입력·정답과 예측 시점

한 row는 이미 기록된 action `x` 뒤에 다음 시도 `y`가 기록될 때까지의 간격 `t`다.

| 역할 | 기존 열·의미 |
| --- | --- |
| 입력 `x` | `previousAction` 한 개. 이 시도까지 처리된 직후 다음 시도를 예측 |
| 행동 정답 `y` | `nextActionDiagnostic`. 이번 과제에서 label로만 사용 |
| 시간 정답 `t` | `recordedIntervalMs`. x→y의 기록된 처리 시도 간격 |
| 무결성·집계 전용 | sampleId, split, gameId, playerNumber, pieceIndex, sourceLine, previousInputIndex, currentInputIndex |

새로운 과제 view를 메모리에서 정의한다. 기존 dataset v1의 feature/label 명세·파일을 덮어쓰지 않는다.
`nextActionDiagnostic`, 현재 row의 `t`, 완성된 입력열·최종 배치·승패는 입력 feature가 아니다.
긴 prefix·직전 간격 bucket·board·piece 종류·난이도·gameId도 이번 모델의 입력에 추가하지 않는다.
특히 기존 B3와 비교해 시간 모델의 우월성을 새로 입증하는 실험으로 포장하지 않는다.

경계 검사는 같은 split/game/player/piece/sourceLine 안의 두 input index가 인접한지 확인한다.
서로 다른 구간을 이어 첫 대기/누락 시간을 만들지 않는다. 첫 action·무입력·Hold는 현재 pair에 없으므로 예측 대상으로 추가하지 않는다.
시간은 키 입력 시각·인지 반응시간·입력 성공 시간이 아니다. 0ms는 유지하고 원인 조사를 재개하지 않는다.

## 2. 고정 데이터

| 항목 | 계약 |
| --- | --- |
| Dataset | `data/datasets/human-timing-v1-20261024-full` |
| Manifest SHA-256 | `c203a1db7b8f2aa7014c565b371088a9614f6abb0df5632e93fe6c807712fc88` |
| Train | 149게임 / 41,151 pair, SHA `c42c01d6fba0eb7128b77c0773a1669a9be620530a2fb99171dcca67ff3fb7c3` |
| Validation | 31게임 / 10,180 pair, SHA `7e9099916aae3e0f7c3875d8169e88f7847b0f9f517a506c78b2776d4d44660f` |
| Test | 33게임/9,859 pair는 manifest의 역사적 수치. **파일을 열거나 평가하지 않음** |
| 전체 61,190 pair | 위 세 split의 합. 이번 full 평가 분모는 Validation 10,180뿐 |
| 정제·분할 | 승인 quality-policy-v1·기존 game split/seed 유지, 승패 무관 Human 자료 |
| 규칙·신뢰 | legacy 20×10, ruleset/stage unspecified, client_reported. 현재 40행의 상태 행동 label로 승격하지 않음 |

신규 raw·live log·DB·모델 artifact·기존 Full report는 입력으로 사용하지 않는다.
행동 vocabulary는 다음 Unicode code-point 순서의 여섯 개로 고정한다.

```text
hard_drop, move_left, move_right, rotate, rotate_ccw, soft_drop
```

다른 action·bool/음수/비유한 시간·누락·중복 sampleId·게임 누수·인접 index 오류는 중단한다.
Train에는 다음 action rotate_ccw가 38개 있고 Validation에는 없다. 희소 행동의 일반화는 미검증으로 표시한다.

## 3. 비교 방식 — 조건 변수 하나만 변경

두 방식 모두 같은 pair로 action 확률과 action 조건부 시간 분포를 학습한다. 달라지는 것은 **x를 조건으로 사용하는가**뿐이다.

| Variant ID | 행동 확률 | 시간 분포 |
| --- | --- | --- |
| `joint_global` | Train 전체의 P(y) | Train의 F(t｜y) |
| `joint_previous_action` | Train의 P(y｜x) | Train의 F(t｜x,y) |

- 고정 estimator: count 기반 확률 + 경험적 시간 CDF. Scaler·신경망·optimizer 없음.
- 행동 확률: 여섯 class에 Laplace alpha=1. Global은 `(n_y+1)/(N+6)`, 조건부는 `(n_xy+1)/(n_x+6)`다. Validation으로 alpha를 조정하지 않는다.
- 시간 CDF는 원래 정수 ms를 유지한다. Clipping·log 변환·시간 smoothing·resampling은 하지 않는다.
- 조건부에서 Train에 없는 x면 global joint 전체로 fallback한다. x는 있으나 (x,y) cell이 비면 F(t｜y), 해당 y도 Train에 없으면 전체 Train 시간 CDF를 사용한다. 각 fallback support/호출 수를 보고한다.
- Train fit은 pair-weighted다. 게임별 downsampling/reweighting은 하지 않고 평가는 game-macro를 primary로 사용한다.
- 항상 Train 최빈 action을 고르는 점수도 분류 참고값으로 표시한다. 별도 후보 선택/튜닝 모델은 아니다.
- Argmax 동률은 위 class 순서로 결정한다. Report의 집계 정렬도 locale에 의존하지 않는다.
- 후보 bundle에는 counts·support·CDF/fallback 계약과 input/code SHA를 담되 production model로 게시하지 않는다.

### 설명용 작은 예제

여기서만 두 class로 축약한다. 실제 실행 vocabulary는 여섯 개다.

```text
Train: left → rotate 100ms, left → rotate 200ms,
       left → hard_drop 300ms, right → hard_drop 100ms

전체 행동 확률(alpha=1): rotate 0.5 / hard_drop 0.5
left 조건 행동 확률:     rotate 0.6 / hard_drop 0.4
left 조건 시간 mixture:  100ms 0.3 / 200ms 0.3 / 300ms 0.4
```

정답이 rotate라는 사실을 예측 입력에 주지 않는다. 예측한 action 확률과 각 action의 CDF를 섞어서 시간 분포를 만든다.
임의 샘플링 결과나 평균 하나만으로 primary 점수를 계산하지 않는다.

## 4. 지표와 생성 해석

Primary는 **Validation game-macro next-action NLL**이다. 각 게임 안에서 `-ln P(관측 y)`의 평균을 낸 뒤 31게임을 같은 비중으로 평균한다. 낮을수록 좋다.
이 확률 점수는 한 class만 반복하는 예측과 불확실성을 구분하기 위해 선택했다. 로그는 natural log, epsilon clipping은 하지 않는다. Alpha=1로 확률은 양수다.

시간 guardrail은 **game-macro marginal CRPS(ms)**다. 각 variant의 `G(t)=sum_y P(y) F(t｜y)` 또는 x 조건의 같은 mixture를 계산한다.
실제 미래 action을 알려주지 않은 시간 예측이며, 가중 경험 분포의 CRPS를 정렬·누적합으로 정확히 계산한다. Row마다 quadratic pairwise distance 행렬을 만들지 않는다.

Secondary/진단:

- Game-macro F1: 고정 여섯 label·zero_division=0, argmax 예측. 행동별 true/predicted support·precision/recall과 confusion matrix를 함께 표시한다. 없는 Validation class의 F1=0은 학습 실패 증명이 아니다.
- Pair-micro NLL/F1/CRPS, game별 delta·median·worst·개선/동일/악화 수. Primary 분모를 subset으로 교체하지 않는다.
- 정답 y에 해당하는 CDF의 conditional CRPS는 **정답 action 조건 oracle 진단**으로 분리한다. 실제 공동 생성 성능/시간 guardrail을 대체하지 않는다.
- 시간 mixture의 중앙값 MAE, 0ms 확률·p50/p95, cell support·fallback 비율. 확률적 생성이 필요하면 seed=1337의 작은 합성 예제만 사용한다. Canonical 집계는 샘플링하지 않는다.
- 추론 개념은 먼저 예측 P(y)로 action을 고르고 그 action의 CDF로 간격을 정하는 것이다. 이번에는 실제 게임 실행·첫 대기 생성·runtime 통합을 하지 않는다.

수치 단위가 다른 NLL과 CRPS를 임의 가중합으로 합치지 않는다. 두 지표를 따로 해석한다.

## 5. 기술 gate와 탐색 판정

Full의 기술 gate: 정확한 cohort/rows·입력 SHA·Train/Validation 게임 교집합 0·Test open 0·finite 확률/score·확률 합 1·원본/의존 정의 불변이다.
실패하면 결과 게시를 중단한다. 작은 개선이나 개선 없음은 기술 실패가 아니다.

아래 delta는 `joint_previous_action - joint_global`이다. NLL/F1 비교 허용오차는 1e-12, CRPS는 1e-9ms다.

| 관측 | 분석 status |
| --- | --- |
| NLL 감소, marginal CRPS·macro F1 무악화 | `conditional_signal_observed` |
| NLL 감소지만 시간 또는 F1 악화 | `tradeoff_requires_review` |
| NLL 차이 없음 또는 악화 | `no_clear_gain` |

이는 탐색적 신호 구분이지 실질적 개선 임계값·통계적 유의성·A 구조 채택 rule이 아니다.
세 status 모두 `selectionDecision=needs_policy_decision`, `signalOnly=true`, `productionIntegration=false`, `canonicalResultEligible=false`다.
새 Human 데이터 확보를 판정 선택지로 요구하지 않는다. 결과에 따라 현재 과제를 마감하거나 별도 요청의 다음 가설로 진행한다.

Smoke는 `action_timing_joint_smoke_valid`, `fullCohortCovered=false`, `policyDecisionEligible=false`다.
Full은 기술 gate 통과 시 `action_timing_joint_validation_complete`, `fullCohortCovered=true`, `policyDecisionEligible=true`다.
여기서 full cohort는 이 명세의 Train/Validation이며 전체 raw나 Test를 뜻하지 않는다. Policy eligibility도 비교 검토만 가능하다는 뜻이다.

## 6. 구현 산출물·실행 계약

- Source Notebook: [human_action_timing_joint_baseline.ipynb](../../../scripts/ml/notebooks/human_action_timing_joint_baseline.ipynb) 하나. 23개 cell이며 별도 Python 구현/테스트 파일은 없다.
- 새 `.py` 구현/테스트/요약기·package/dependency를 추가하지 않는다. 기존 Python 파일은 유지한다.
- 기존 [baseline Notebook](../../../scripts/ml/notebooks/human_timing_baseline.ipynb)의 로딩/검증·경로 보호·분포 계산과 [readiness Notebook](../../../scripts/ml/notebooks/human_action_data_readiness.ipynb)의 게시 함수를 재사용한다. 선택한 정의 셀만 읽으며 이전 Notebook의 실행/Full 셀을 실행하지 않는다. 재사용 정의 SHA와 source SHA를 구분해 기록한다.
- 현재 loader가 진단 열을 허용해도 새 label의 enum/형식·누수 검사는 이 Notebook의 작은 assert로 추가한다. 기존 parser를 복사하거나 수정하지 않는다.
- 구조: 왜/작은 예제 → 공통 정의 → Smoke 설정/실행/결과 → Full 설정/실행/결과 → 해석/한계. 모든 표·그래프에 cohort와 단위를 표시한다.
- 기본 모두 실행은 가상 Train/Validation의 smoke만 수행한다. 실제 `.jsonl`·기존 report·Test를 열지 않는다. Smoke는 메모리 결과가 기본이며 파일 저장은 새 output을 명시할 때만 한다.
- Full은 `RUN_FULL=False`, `FULL_REPORT=None`이 기본이다. 사용자가 해당 설정을 바꾸고 실행 셀·결과 셀을 순서대로 실행한다. 별도 Python 테스트나 shell 명령을 먼저 실행할 필요는 없다.
- Full 출력 예정: ignored `data/ml-experiments/human-action-timing-joint-baseline/full-report-run1.json`. 기존 파일·source alias·symlink/hardlink 충돌은 거부한다. 사용자가 새 이름을 정해야 재실행할 수 있다.
- Smoke/full은 같은 fit/score 경로를 사용한다. Smoke Report와 Full Report 변수를 분리한다. 긴 Full을 구현 완료 명분으로 자동 실행하지 않는다.

Report에는 모델 두 개의 설정/Train bundle·입력/정의 SHA·cohort/count·full/smoke·지표/분모·game별 진단·fallback·기술 gate·분석 status를 남긴다. Timestamp/사용자 절대 경로·신원/원본 행 내용은 넣지 않는다.

## 7. 구현 검증과 허용 범위

다음 implement-smoke의 작은 assert:

- 분류 count·Laplace·확률 합·동률·unseen x/(x,y)/y fallback·입력 순서 불변.
- 위 worked example과 mixture CRPS의 작은 brute-force 대조·한 점 분포·0ms·비유한 값 거부.
- Validation label 변경이 Train bundle을 바꾸지 않음, y/t가 입력에 들어가지 않음, Test open 금지.
- SHA/count/중복/게임 누수·출력 보호·재실행 차단·기본 Full off·pandas/Matplotlib 렌더와 source 빈 output/고유 ID.
- 합성 smoke 2회 byte 결정성. 실제 Full run1/run2는 최초 구현 검증 뒤 별도 사용자 실행 사항이다.

계산 변경 후 `npm run verify:ml`과 `bash scripts/verify.sh`를 적용한다. 사용자 실행 Notebook은 지우지 않으며 source 형식 차이가 있으면 Git 저장 source의 격리 검증과 현재 작업 파일의 결과를 구분한다.

허용: 예정 Notebook·이 명세·현재 계획/안내/PLAN/change-log의 필요한 변경뿐이다.
금지: 신규 수집, raw/기존 dataset·Notebook/report 수정, Test 읽기, quality/split 변경, Hold view·긴 이력·GRU 선행 구현, JS 실험 재작성, runtime/PVE/DB·모델 승격·Git mutation 자동 수행.

Rollback은 새 실험 Notebook/문서만 되돌리는 범위다. 원본·운영 데이터 삭제나 기존 모델 교체가 필요하지 않다.
다음 gate는 **사용자 Full 실행 뒤 결과 해석**이다. Smoke는 실제 Human 성능이나 배치/전체 정책 채택 근거가 아니다.

위 gate는 최초 구현 당시 기록이며 사용자 실행 후의 현재 상태는 아래 9절이다.

## 8. Implement-smoke 결과 — 2026-10-29

- Notebook 공통 정의·작은 예제·내부 검사·가상 Smoke·Full 설정/실행/결과를 분리했다. 기본 `RUN_FULL=False`, `FULL_REPORT=None`이며 pandas 표·Matplotlib 그래프를 제공한다.
- 가상 Train 3게임/9 pair, Validation 2게임/6 pair로 Jupyter headless 두 실행을 마쳤다. 각 실행 error/traceback 0, 그래프 2개이며 실제 dataset/Test는 읽지 않았다.
- 두 smoke report는 byte-identical이다. SHA-256: `3096f8635362406805929ed5ae642bd969bfe5d20dcf1d993b8713778994a9fc`.
- 확률/count·Laplace·tie/fallback·미학습/희소 class·순서 불변·Train-only·정답 변경·CRPS 손계산·잘못된 입력·출력 alias/symlink/hardlink·독점 게시·source ID를 내부 검사했다. 추가 가상 검사에서 checksum 변경 시 게시 중단과 game leakage 거부를 확인했다.
- `bash scripts/verify.sh`: 793 pass·기존 1 skip·0 fail. 최초 sandbox 실행의 localhost `listen EPERM` 두 건은 권한 있는 재실행에서 통과했다.
- 현재 작업 파일의 `npm run verify:ml`: Node 35 pass, Python 213/220으로 **전체 미통과**다. 기존 실행 Notebook 다섯 개의 output/count·Full 설정 검사 5 fail/2 error를 보존했다. Git HEAD의 원본 Notebook을 내보낸 격리 경로에서 올바른 cwd로 Python 220/220을 확인했다. 격리 검사가 새 joint 검사까지 자동 포함한다는 뜻은 아니며 새 joint는 위 내부/가상/headless 검사로 검증했다.
- 사용자 실행 Notebook·기존 데이터·runtime·package는 변경하지 않았다. 실제 Full·Hold view·배치 학습·신경망·stage/commit은 하지 않았다.

사용자 실행은 Notebook 7절에서 `RUN_FULL=True`로 바꾸고 새 `FULL_OUTPUT` 경로를 지정한 뒤 설정 → 실행 → 결과 셀 순서다. 기존 결과가 있으면 run2 등 새 이름을 사용한다. 코드 기본값으로 모두 실행하면 6절 가상 Smoke만 수행한다. 원본 source의 출력 정리/커밋 준비는 별도 요청이며 현재 작업 폴더 전체 ML gate 미통과를 숨기지 않는다.

## 9. 사용자 Full 해석·하드드롭 재확인 — 2026-10-29

- Report: `data/ml-experiments/human-action-timing-joint-baseline/full-report-run1.json`, SHA-256 `7e4ba515d74bf139167e8fd9d5754e6c2f5c8666276ed8b51b43d14a3575e5df`.
- `runMode=full`, Train 149게임/41,151 pair, Validation 31게임/10,180 pair, Test 미평가·game leakage 0·`inputUnchanged=true`다. Manifest/Train/Validation SHA·candidate bundle SHA와 game별 재집계가 일치했다. Notebook의 저장된 Full 그래프도 report와 일치한다. 단일 Full이며 run1/run2 결정성은 새로 주장하지 않는다.

| Game-macro metric | Global | Previous action | Delta |
| --- | ---: | ---: | ---: |
| next-action NLL ↓ | 1.418558 | 1.232912 | -0.185646 |
| Macro F1 ↑ | 0.081364 | 0.237967 | +0.156604 |
| Marginal CRPS ms ↓ | 54.269946 | 53.028209 | -1.241737 |

- NLL/F1은 31게임 모두 개선, 시간은 28게임 개선/3악화다. 계약 판정은 `conditional_signal_observed`, report의 `selectionDecision=needs_policy_decision`, `signalOnly=true`를 보존한다. 통계적 유의성·실질적 개선 임계값·구조/제품 채택 판정은 아니다.
- 정제된 Validation의 조작 segment는 1,513개이며 1,511개(99.87%)에 hard_drop 정답이 있다. 1,511개 모두 해당 segment의 마지막 보존 pair다. 전체 pair의 hard_drop 비중은 14.84%다. 이 분모를 전체 raw의 게임/블록 수로 확대하지 않는다.
- Full argmax 평가의 hard_drop/rotate 예측은 0이다. 실제 hard_drop 1,511개는 left 607/right 904로 분류됐다. 하드드롭 확률은 left 뒤 17.65%, right 뒤 16.63% 등 0이 아니지만 각 조건의 1위가 아니다. 이동 반복과 최종 이동을 구분할 상태/목표가 없는 기준선의 한계이며, 부족한 hard_drop 기록이라는 결론이 아니다.
- 개발 방향은 **부분 기준선으로 보존하고 전체 controller로 승격하지 않음**이다. 단순 sampling·hard_drop reweighting이나 B3 재실험 대신 기존 보드·selectedPlacement·입력열 연결을 다음 질문으로 둔다. User Full 결과를 반영하는 문서 작업에서 새 모델을 학습하거나 report/Notebook을 수정하지 않았다.
