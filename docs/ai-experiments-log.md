# Tetris placement AI 실험 로그와 재현 가이드

마지막 정리: 2026-07-18

실험 상태: **continue_experimenting**
현재 결론: **pair_weight_tradeoff_explained** — production 모델을 동결하거나 PVE에 연결할 단계가 아니다.

이 문서는 다음 두 가지를 한곳에 보존한다.

1. 지금까지 어떤 질문을 어떤 순서로 검증했고, 무엇을 알게 되었는가
2. 사용자가 같은 실험을 직접 재현하거나 새 게임 로그로 다시 평가하려면 무엇을 실행해야 하는가

이 문서에서 말하는 성능은 모두 **Human placement 선택 모방 성능**이다. 실제 생존 시간, 공격량, 승률 또는 강한 gameplay AI를 직접 의미하지 않는다.

---

## 1. 5분 요약

현재 placement AI 실험의 흐름은 다음과 같다.

~~~text
게임 플레이
  ↓
main worktree의 append-only game-events.jsonl
  ↓
기존 dataset exporter로 immutable snapshot 생성
  ↓
Python Notebook에서 JSONL 직접 로딩
  ↓
게임 하나를 통째로 제외하는 LOGO 교차 검증
  ↓
선택 후보와 비선택 후보의 feature 차이로 Logistic Regression 학습
  ↓
held-out 게임에서 Top-1 / Top-3 / MRR / 평균 순위 평가
  ↓
중복 표현과 pair weighting을 별도 실험으로 진단
~~~

핵심 판단은 다음과 같다.

- Python 수치 경로가 기존 JavaScript 경로와 일치하는지 단일 fold parity로 검증했다.
- 그 뒤의 새 실험은 JavaScript로 중복 구현하지 않고 Python Notebook을 단일 실험 경로로 사용한다.
- 13게임에서 26게임으로 늘리자 일부 지표는 좋아졌지만, 데이터가 겹치므로 독립적인 성능 향상 증거는 아니다.
- 선택 후보와 같은 occupied-cell placement가 여러 rotation/pivot 표현으로 중복 기록돼 있었다.
- 물리적으로 같은 placement를 묶을 때 관측된 작은 metric trade-off는 row compression 자체가 아니라 pair-weight 재분배에서 발생했다.
- Phase 8은 pair_weight_tradeoff_explained로 마감됐고, 프로그램 gate는 continue_experimenting이다.
- 다음 작업은 새 feature나 모델 실험이 아니라 Phase 0~8 merge-readiness 감사와 목표·weighting 정책 계약의 정리다.
- 최종 전체 데이터 trainer와 production model은 아직 만들지 않는다.

---

## 2. 작업 위치와 단일 진실 원천

### 2.1 Worktree와 branch

작성 시점의 AI 실험 작업 위치는 다음과 같다.

| 구분 | 경로 | branch | 용도 |
|---|---|---|---|
| AI 실험 | /Users/parkseongho/visualstudio-workspace/Tetris_multi-ai | codex/python-sklearn-logo-evaluation | Notebook, Python 평가, 실험 문서 |
| 통합 기준 | /Users/parkseongho/visualstudio-workspace/Tetris_multi | main | 실제 게임 실행과 최종 통합 |
| 기술 migration | 별도 worktree | 별도 migration branch | Vite/React/TypeScript migration |

Phase 0~7의 Python 실험 기반은 4cf858575addddf9dcaa624ec607c7503286ed8a에 고정된 historical baseline이다. Phase 8 checkpoint는 이 기준 위에 별도 commit으로 보존한다. 현재 AI HEAD와 main HEAD는 자주 변하므로 이 문서의 고정 사실로 기록하지 않으며, 작업 시작 시 Git에서 확인한다.

AI 실험 명령은 특별한 설명이 없는 한 항상 다음 경로에서 실행한다.

~~~bash
cd /Users/parkseongho/visualstudio-workspace/Tetris_multi-ai
~~~

AI worktree와 migration worktree를 분리한 이유는 같은 working tree에서 branch를 바꾸며 실험 파일과 migration 파일이 섞이는 일을 막기 위해서다. AI 실험을 main에서 직접 진행하지 않고, 검증이 끝난 작은 단위만 나중에 병합한다.

### 2.2 데이터와 코드의 책임

| 책임 | 단일 진실 원천 |
|---|---|
| 실제 플레이 이벤트 | main worktree의 data/logs/game-events.jsonl |
| dataset 전처리 경계 | scripts/export-placement-dataset.js |
| 새 모델 실험과 평가 | Python Jupyter Notebook |
| Notebook 환경 | environment-ml.yml |
| 반복 실행 report | /private/tmp 아래의 JSON |
| 장기 재현 데이터 | immutable snapshot 네 파일과 SHA-256 |
| production 모델 | 아직 생성 또는 교체하지 않음 |

dataset exporter가 JavaScript인 것은 현재 게임 로그 schema와 기존 전처리 계약을 안정적으로 고정하는 경계이기 때문이다. 이것을 유지하는 일과, 모델 실험을 JavaScript로 다시 구현하는 일은 다르다. **새 학습·feature·평가 실험은 Python에서만 진행한다.**

---

## 3. 모델을 이해하기 위한 최소 개념

### 3.1 모델 구조

현재 모델은 scikit-learn의 **LogisticRegression 기반 선형 pairwise ranker**다. 신경망이 아니므로 hidden layer는 없다.

한 decision에서 Human이 선택한 후보의 feature를 x_selected, 선택하지 않은 후보의 feature를 x_other라고 하면 다음 차이를 학습한다.

~~~text
difference = standardized(x_selected) - standardized(x_other)

positive sample:  difference, label 1
negative sample: -difference, label 0

prediction = sigmoid(weight · difference)
~~~

즉 모델은 “이 후보 하나가 절대적으로 좋은가?”보다 “두 후보 중 Human이 어느 쪽을 선택했는가?”를 학습한다.

### 3.2 현재 16개 feature

feature 순서는 모델 계약의 일부다.

1. candidateResult.linesCleared
2. candidateResult.gameOver
3. metricDelta.aggregateHeight
4. metricDelta.maxHeight
5. metricDelta.holes
6. metricDelta.bumpiness
7. metricDelta.columnHeights[0]
8. metricDelta.columnHeights[1]
9. metricDelta.columnHeights[2]
10. metricDelta.columnHeights[3]
11. metricDelta.columnHeights[4]
12. metricDelta.columnHeights[5]
13. metricDelta.columnHeights[6]
14. metricDelta.columnHeights[7]
15. metricDelta.columnHeights[8]
16. metricDelta.columnHeights[9]

Human 선택 여부, winner 정보, 미래 결과는 입력 feature가 아니다.

### 3.3 학습 계약

- 검증 방식: Leave-One-Game-Out, 이하 LOGO
- scaler fit 범위: 해당 fold의 train candidate만
- pair: 선택 후보와 같은 decision의 각 비선택 후보
- symmetric sample: difference와 negative difference를 모두 생성
- decision balancing: 한 decision의 pair weight 합이 1이 되도록 정규화
- solver: lbfgs
- fit_intercept: false
- class_weight: null
- tolerance: 1e-12
- max_iter: 10,000
- L2: 0.01
- C: 1 / (train decision 수 × 0.01)

### 3.4 Leakage 방지 계약

- selectedBySource는 정답 label을 만드는 데만 사용한다.
- metadata.isWinner는 결과 segmentation에만 사용한다.
- winnerPlayerId는 feature로 사용하지 않는다.
- 기존 heuristic score는 feature로 사용하지 않는다.
- Human input sequence, 미래 이벤트, held-out fold 결과는 feature로 사용하지 않는다.
- gameId 하나가 train과 validation 양쪽에 동시에 나타나면 실험을 실패로 처리한다.

### 3.5 지표 해석

| 지표 | 뜻 | 해석 방향 |
|---|---|---|
| Canonical Top-1 | 결정적 tie-break 후 Human 선택이 1위인 비율 | 높을수록 좋음 |
| Top-3 | Human 선택이 상위 3개 안에 든 비율 | 높을수록 좋음 |
| MRR | Human 선택 순위의 역수 평균 | 높을수록 좋음 |
| Mean selected rank | Human 선택의 평균 순위 | 낮을수록 좋음 |
| Tie-aware Top-1 | Human 선택이 최고 score 동률 집합에 포함된 비율 | 표현 중복 진단용 |
| Physical-class metric | 동일 occupied-cell placement를 한 class로 본 순위 | 표현 중복 제거 후 진단용 |

Tie-aware Top-1은 낙관적인 표현 진단이다. Canonical Top-1을 대체하지 않는다.

---

## 4. 실험 연대기

### 4.1 Phase 0 — Placement dataset 기반 구축

시기: 2026-07-15~16

목표는 gameplay runtime을 바꾸지 않고 Human placement decision을 재현 가능한 dataset으로 만드는 것이었다.

관련 기반:

- scripts/export-placement-dataset.js
- dataset:export npm script
- manifest.json
- train.jsonl
- validation.jsonl
- rejected.jsonl

이 단계에서 정한 중요한 계약은 다음과 같다.

- 완료된 게임 단위로 dataset을 선택한다.
- source는 human으로 제한할 수 있다.
- train/validation은 candidate row가 아니라 gameId 단위로 분리한다.
- manifest에 source log SHA-256, 정책, count, rejection reason을 기록한다.
- 원본 game-events.jsonl은 읽기 전용으로 취급한다.

기반 commit:

| commit | 시기 | 역할 |
|---|---|---|
| e9dbf4a | 2026-07-15 | placement dataset exporter |
| 8ae5f58 | 2026-07-16 | all-completed와 Human source 정책 |
| 0d61eff | 2026-07-16 | feature schema와 evaluation 계약 |
| bf04a4e | 2026-07-17 | Python parity 환경과 도구 |

결론:

- 모델 실험 전에 데이터 provenance와 leakage 경계를 먼저 고정했다.
- 이후 모든 Python 실험은 이 immutable snapshot을 입력으로 사용한다.

---

### 4.2 Phase 1 — JavaScript와 Python 단일 fold parity

시기: 2026-07-17 전후

상태: **완료된 기술 검증, 새 실험에서는 동결**

목적은 Python으로 옮긴 수치 경로가 기존 JavaScript 학습 계약을 잘못 해석하지 않았는지 확인하는 것이었다. 이 단계는 JavaScript 모델이 더 좋다는 증명이 아니라 Python 실험 스택의 정확성 검증이다.

데이터:

| 항목 | 값 |
|---|---:|
| validation gameId | 3A5869D1-1784156123783 |
| train / validation game | 12 / 1 |
| train / validation decision | 512 / 42 |
| train / validation candidate | 17,519 / 1,431 |
| train pair | 17,007 |
| gameId leakage | 0 |

JS-equivalent 결과:

- scaler mean 최대 오차: 0
- scaler scale 최대 오차: 0
- pair difference 최대 오차: 0
- pair weight 최대 오차: 0
- final loss 오차: 약 2.78e-17
- weight 최대 오차: 부동소수점 반올림 수준
- validation score: 부동소수점 반올림 수준
- candidate rank와 metric: 일치

JavaScript 500-step 결과:

| 지표 | 값 |
|---|---:|
| Top-1 | 0.476190 |
| Top-3 | 0.785714 |
| MRR | 0.646088 |
| Mean selected rank | 2.523810 |
| Tie-aware Top-1 | 0.571429 |

scikit-learn 수렴 결과:

| 항목 | 값 |
|---|---:|
| iteration | 21 |
| convergence warning | 없음 |
| Top-1 | 0.500000 |
| Top-3 | 0.761905 |
| MRR | 0.651644 |
| Mean selected rank | 2.547619 |

차이가 난 이유는 feature, scaler 또는 pair가 아니라 optimizer 종료 조건이었다. JavaScript는 고정 500 gradient step에서 멈췄고, scikit-learn은 같은 objective를 lbfgs로 수렴점까지 최적화했다.

이후 보강:

- source와 같은 output path, parent alias, symlink, hardlink를 차단했다.
- Unicode code-point 정렬로 locale 의존성을 제거했다.
- Python train scaler를 sklearn 학습과 validation에 공통 적용했다.
- parity 실패 시 sklearn 결과를 skipped로 처리하도록 원인 귀속을 제한했다.
- top-score tie, selected-feature duplicate, zero-difference 진단을 추가했다.

표현 중복 진단:

- train zero-difference pair: 457 / 17,007
- 영향받은 train decision: 303 / 512
- validation selected-feature duplicate: 24 / 42
- validation top-score tie: 24 / 42

최종 hardening 실행의 결정적 산출물 SHA-256:

- parity bundle: f7e6bdd60a1f661adc7ccbf4aeed95d7650a6fda4f4840a5ef17337012593cd6
- parity report: 1584704584f8ad4ea0fd3225426f5f9e29795d153d7e06608a5f12ed8caa12a5

관련 파일:

- [JavaScript parity bundle exporter](../scripts/export-placement-parity-bundle.js)
- [Python parity CLI](../scripts/ml/placement_pairwise_parity.py)
- [Python parity tests](../python_tests/test_placement_pairwise_parity.py)
- [Node parity tests](../test/testPlacementParityBundle.js)
- [수학 계약 문서](placement-pairwise-ranker.md)
- [ML 검증 스크립트](../scripts/verify-ml.sh)

결론:

> Python 수치 경로는 검증됐다. 이후 새 실험을 JavaScript로 재작성할 필요가 없다.

---

### 4.3 Phase 2 — JS feature table + Python 13-fold 평가

상태: **과도기 경로, 현재 사용하지 않음**

Python-native Notebook으로 완전히 전환하기 전, JavaScript가 feature table을 만들고 Python이 13-fold LOGO를 평가하는 과도기 실험을 수행했다.

주요 결과:

| 지표 | 값 |
|---|---:|
| Top-1 | 0.463899 |
| Top-3 | 0.772563 |
| MRR | 0.636154 |
| Mean selected rank | 3.001805 |
| Tie-aware Top-1 | 0.568592 |

당시 산출물 SHA-256:

- feature table: 24c955a073482ac8e78861b65d9db9bb8327972154dca391efae9fd4fe079de2
- feature manifest: 64492bdeb15a7cc35466f7c074d92efae61e42045fcac1759a71b11973604d01
- evaluation report: 2c97f385d92fd0c2125be08fbc83f7d3e000b85eae57a20f420abcdfd7a8c3e6

이 경로의 exporter와 evaluator는 현재 Python-native Notebook에 의해 대체됐다. 사라진 과도기 파일을 복원할 필요가 없고, 새 실험에서 이 구조를 다시 만들지 않는다.

---

### 4.4 Phase 3 — Python-native 13게임 LOGO baseline

상태: **완료, continue_experimenting**

목적은 사용자가 셀 순서대로 읽고 직접 재실행할 수 있는 Python-native 실험을 만드는 것이었다. Notebook은 원본 snapshot JSONL을 직접 읽고 feature 추출부터 평가 report 생성까지 한 흐름으로 보여준다.

관련 파일:

- [Python LOGO baseline Notebook](../scripts/ml/notebooks/placement_pairwise_logo_experiment.ipynb)
- [Notebook 설명](placement-python-experiment-notebook.md)
- [Notebook 계약 테스트](../python_tests/test_placement_experiment_notebook.py)
- [Conda 환경](../environment-ml.yml)

데이터:

| 항목 | 값 |
|---|---:|
| game | 13 |
| decision | 554 |
| candidate | 18,950 |
| selected candidate | 554 |
| pair | 18,396 |

Micro aggregate:

| 지표 | 값 |
|---|---:|
| Top-1 | 0.463899 |
| Top-3 | 0.772563 |
| MRR | 0.636154 |
| Mean selected rank | 3.001805 |
| Tie-aware Top-1 | 0.568592 |

Macro aggregate:

| 지표 | 값 |
|---|---:|
| Top-1 | 0.428160 |
| Top-3 | 0.729442 |
| MRR | 0.595992 |
| Mean selected rank | 4.120839 |
| Tie-aware Top-1 | 0.521331 |

진단:

- 13 / 13 fold 수렴
- iteration 범위: 20~22
- gameId leakage: 0
- selected-feature duplicate decision: 327
- zero-difference pair: 493 / 18,396
- top-score tie decision: 329
- worst fold: 5FBD427F-1784135673581
- worst fold decision: 9
- worst fold Top-1: 0
- worst fold MRR: 0.078373

두 실행 report SHA-256:

~~~text
8769a322eb7dfd096e48e06a6841a3aeb9c82eb887e6dea4c3d9b5313ce46c8e
~~~

당시 source snapshot SHA-256:

| 파일 | SHA-256 |
|---|---|
| manifest.json | 40e6605f906be40888614c11a7311b024b0c0a612bdb71d64dedc4e35b8f3ff5 |
| train.jsonl | 891bb070314030cbdaf90a9c2d5c547c8c86da3830e42990ba366095ca94d3fb |
| validation.jsonl | a7c517acc62c6242cd80753846eef9d9f9e74dfe2d7c98282b15ab23601e0a51 |
| rejected.jsonl | 4a3153b18da8e41c155e0ee3e18ca80b4b453e24fb0607efffe4cd0922d2f60e |

결론:

- 13게임은 파이프라인 검증에는 충분했지만 일반화 결론에는 작다.
- micro와 macro 차이, 9-decision worst fold, 높은 feature 중복 때문에 동결하지 않았다.

---

### 4.5 Phase 4 — 26게임 immutable snapshot과 LOGO baseline

상태: **완료, continue_experimenting**

게임을 더 플레이한 뒤 live log를 직접 학습에 넣지 않고 새로운 immutable snapshot을 만들었다.

snapshot:

~~~text
data/datasets/human-behavior-v2-snapshot-26g-20260717
~~~

source live log:

- line: 3,657
- game_start: 26
- game_over: 26
- placement_decision: 3,605
- SHA-256: 40596db651a62d8e0456d774fcb33314f2153cdec7220276ddc5d926b70585d5

dataset:

| 항목 | 값 |
|---|---:|
| eligible game | 26 |
| decision | 1,158 |
| candidate | 39,375 |
| selected candidate | 1,158 |
| train / validation game | 21 / 5 |
| normal / hard decision | 877 / 281 |
| winner / loss game | 3 / 23 |

snapshot SHA-256:

| 파일 | SHA-256 |
|---|---|
| manifest.json | 51027be0ebad578f2c38bb8715aa491daa8f13208e3da551a5e4a2dd08bef088 |
| train.jsonl | 85034a66373add54324a56673cb99ed5854810e4299abcaf9c195ae8cbca631e |
| validation.jsonl | 23b832d95a2057b7b29e7062286c58c68524fa8db00f00870e6076a0a846f58a |
| rejected.jsonl | 06ede14119014e2b040f8a4d62e00532ca6eecae9424b93e9cc882394db8a85f |

26-fold micro:

| 지표 | 값 | 13게임 대비 |
|---|---:|---:|
| Top-1 | 0.484456 | +0.020557 |
| Top-3 | 0.765112 | -0.007451 |
| MRR | 0.645290 | +0.009136 |
| Mean selected rank | 2.961140 | -0.040665 |
| Tie-aware Top-1 | 0.569085 | +0.000493 |

26-fold macro:

| 지표 | 값 |
|---|---:|
| Top-1 | 0.466060 |
| Top-3 | 0.737154 |
| MRR | 0.623181 |
| Mean selected rank | 3.576960 |
| Tie-aware Top-1 | 0.543668 |

진단:

- 26 / 26 fold 수렴
- iteration 범위: 19~21
- gameId leakage: 0
- pair: 38,217
- selected-feature duplicate decision: 670 / 1,158
- zero-difference pair: 1,010 / 38,217
- top-score tie decision: 672
- worst fold는 기존 9-decision 게임과 동일

두 실행 report SHA-256:

~~~text
e75293adf8cdbc5689dceb6c1efa9857fd8cf1440e4acc33ec77052f11c0878c
~~~

해석 주의:

26게임 snapshot은 기존 13게임을 포함한다. 따라서 위 delta는 독립 holdout에서의 개선이 아니라 **데이터 확대 전후 추세**다.

---

### 4.6 Phase 5 — Feature collision geometry 분석

상태: **geometry_does_not_resolve_collision**

질문:

> 1,010개의 zero-difference pair가 현재 16개 feature에 geometry 정보가 부족해서 생긴 것인가?

관련 파일:

- [Collision 분석 Notebook](../scripts/ml/notebooks/placement_feature_collision_analysis.ipynb)
- [Collision 분석 결과 문서](placement-feature-collision-analysis.md)
- [Collision Notebook 계약 테스트](../python_tests/test_placement_feature_collision_notebook.py)

결과:

- 1,010 pair 모두 occupied-cell 집합이 물리적으로 동일했다.
- rotation은 1,010 pair를 전부 구분했지만, 실제로 다른 placement가 아니라 같은 cell placement의 표현 ID 차이였다.
- placement_col은 410 pair, placement_row는 90 pair를 구분했다.
- cell min/max/mean row·col, span, 평균 높이, wall distance는 물리적 구분을 만들지 못했다.

piece별 collision:

| piece | pair |
|---|---:|
| square | 510 |
| ess | 173 |
| zee | 165 |
| bar | 162 |
| eleft / eright / tree | 0 |

두 실행 report SHA-256:

~~~text
4428d771cec784d26b645f60582694b3863c926b290c90a0d470f58846b92fd1
~~~

결론:

- geometry feature 부족 문제가 아니었다.
- rotation을 feature로 추가하면 표현 ID를 외우게 되므로 채택하지 않았다.
- feature를 추가하기 전에 occupied-cell equivalence class를 정의해야 한다.
- 이 실험에서는 모델을 학습하거나 feature를 변경하지 않았다.

---

### 4.7 Phase 6 — Occupied-cell equivalence와 pair canonicalization

상태: **pair_canonicalization_valid_but_metric_tradeoff**

질문:

> 물리적으로 같은 occupied-cell placement를 하나의 class로 묶고 pair를 만들면 zero-difference 문제를 제거하면서 평가를 유지할 수 있는가?

관련 파일:

- [Cell-equivalence 비교 Notebook](../scripts/ml/notebooks/placement_cell_equivalence_logo_experiment.ipynb)
- [Cell-equivalence 결과 문서](placement-cell-equivalence-logo.md)
- [Canonical result JSON](placement-cell-equivalence-logo-result.json)
- [Cell-equivalence Notebook 계약 테스트](../python_tests/test_placement_cell_equivalence_notebook.py)

representation 변화:

| 항목 | 기존 raw candidate | occupied-cell class |
|---|---:|---:|
| candidate 또는 class | 39,375 | 26,403 |
| 중복 alias | - | 12,972 |
| 중복 alias 비율 | - | 32.94% |
| pair | 38,217 | 25,245 |
| zero-difference pair | 1,010 | 0 |

selected class multiplicity:

| selected class multiplicity | decision |
|---|---:|
| 1 | 488 |
| 2 | 500 |
| 4 | 170 |

물리적으로 선택 가능한 다른 class가 없어 pair가 사라진 decision은 2개였다.

같은 raw train-candidate scaler를 사용한 비교:

| Physical-class metric | Baseline pair | Grouped pair |
|---|---:|---:|
| Top-1 count | 659 | 657 |
| Top-3 count | 1,013 | 1,013 |
| Micro MRR | 0.727805 | 0.726652 |
| Macro MRR | 0.703260 | 0.702139 |
| Mean selected rank | 2.082902 | 2.085492 |

MRR delta:

- micro: -0.0011527812
- macro: -0.0011212818
- fold 개선 / 동일 / 하락: 1 / 19 / 6
- coefficient cosine similarity: 0.9999940194
- 최대 coefficient 차이: 0.0103174915

두 실행 report와 canonical result SHA-256:

~~~text
8ef4c4668afb108d7b497d33e126e447bcf8a9b1659b2c7692750e63c81d24f7
~~~

결론:

- occupied-cell canonicalization 자체는 유효하다.
- zero-difference pair를 완전히 제거했다.
- 하지만 alias를 하나로 묶으며 decision 내부 pair weight 분포도 함께 바뀌었다.
- 작은 metric 하락만 보고 raw representation이 본질적으로 더 좋다고 결론 낼 수 없다.
- 다음에는 scaler나 feature를 바꾸지 않고 pair-weight 효과를 먼저 분해해야 한다.

---

### 4.8 Phase 7 — 현재 live log 준비 상태 감사

상태: **새 snapshot 생성 가능, 아직 새 모델 평가를 완료한 것은 아님**

2026-07-17 감사 시점의 main live log:

| 항목 | 값 |
|---|---:|
| line | 6,125 |
| game_start | 46 |
| game_over | 46 |
| placement_decision | 6,033 |
| JSON parse failure | 0 |

source SHA-256:

~~~text
2b63e5c61f1c9651accd3c95e6d6052f56d2068b1e859da412e4dbb0dca9bdad
~~~

/private/tmp로 두 번 시험 export했을 때 byte-identical이었다.

| 항목 | 값 |
|---|---:|
| accepted Human decision | 1,972 |
| candidate | 66,721 |
| train / validation game | 37 / 9 |
| normal / hard decision | 1,562 / 410 |
| rejected | 4,061 |

임시 recheck snapshot SHA-256:

| 파일 | SHA-256 |
|---|---|
| manifest.json | 4a0d4f045b054053072408c96bb9f23bdfca9691d1dc0fa59d7d3fd76ce35c12 |
| train.jsonl | 44146ef9aaddc8d9f04971d77369a4d90e5114b0bdb0df82892c7c3aa963bf79 |
| validation.jsonl | 4d23d2ee6dc71e00b940094b2b7956158c92e3922e55df790bfb653f2c3c4255 |
| rejected.jsonl | 9593bf278108ddf535f88e96f5c66f6f67567383c67a32702971ae1688112289 |

rejection reason:

- early piece index: 359
- source filtered: 3,701
- selected candidate unreachable: 1

이 값은 움직이는 live log를 점검한 **임시 감사 결과**다. 아직 46게임 canonical snapshot 이름을 확정하거나 LOGO report를 생성한 완료 실험으로 기록하지 않는다. 실제 새 실험을 시작할 때 서버와 플레이를 멈춘 뒤 아래 절차로 새 snapshot을 다시 생성한다.

---

### 4.9 Phase 8 — Pair-weight controlled decomposition

상태: **pair_weight_tradeoff_explained**

프로그램 gate: **continue_experimenting**

질문:

> Cell grouping의 작은 MRR 하락은 zero-difference 제거,
> selected-alias dilution 해소, non-selected class multiplicity 제거,
> 실제 row compression 중 어디에서 발생했는가?

이번 실험은 새 feature, scaler, estimator를 추가하지 않았다. 26게임 snapshot,
기존 16-feature, raw train candidate에 fit한 fold별 shared StandardScaler,
26-fold LOGO, pairwise LogisticRegression 설정과 C 계산을 고정했다.

variant:

| Variant | 변경 |
|---|---|
| V0 raw_baseline | selected raw candidate 대 모든 unselected raw candidate, decision 총 weight 1 |
| V1 drop_zero_keep_weight | zero pair만 제거하고 V0 weight 유지 |
| V2 drop_zero_renormalized | informative raw pair만 남기고 decision 총 weight 1로 재정규화 |
| V3 class_balanced_expanded | raw alias row는 유지하고 non-selected class별 총 weight를 동일화 |
| V4 cell_grouped | class 대표 pair 하나만 남기고 V3와 같은 class-level weight 사용 |

source snapshot:

data/datasets/human-behavior-v2-snapshot-26g-20260717

| 파일 | SHA-256 |
|---|---|
| manifest.json | 51027be0ebad578f2c38bb8715aa491daa8f13208e3da551a5e4a2dd08bef088 |
| train.jsonl | 85034a66373add54324a56673cb99ed5854810e4299abcaf9c195ae8cbca631e |
| validation.jsonl | 23b832d95a2057b7b29e7062286c58c68524fa8db00f00870e6076a0a846f58a |
| rejected.jsonl | 06ede14119014e2b040f8a4d62e00532ca6eecae9424b93e9cc882394db8a85f |

worked example:

5FBD427F-1784135419893:bb3aa6ad-faa6-4b60-922c-dfe09399f9c3:37

- raw candidate 19
- occupied-cell class 10
- selected class multiplicity 2
- zero pair 1
- non-selected class multiplicity [1, 2, 2, 2, 2, 2, 2, 2, 2]
- V0/V1/V2/V3/V4 pair 수: 18 / 17 / 17 / 17 / 9
- decision weight 합: 1 / 17÷18 / 1 / 1 / 1

전체 pair와 weight:

| Variant | Retained pair | Zero | Pairless | Symmetric sample | Weight total | Weight 1 decision |
|---|---:|---:|---:|---:|---:|---:|
| V0 | 38,217 | 1,010 | 0 | 76,434 | 1,158.000000 | 1,158 |
| V1 | 37,207 | 0 | 2 | 74,414 | 1,126.140848 | 488 |
| V2 | 37,207 | 0 | 2 | 74,414 | 1,156.000000 | 1,156 |
| V3 | 37,207 | 0 | 2 | 74,414 | 1,156.000000 | 1,156 |
| V4 | 25,245 | 0 | 2 | 50,490 | 1,156.000000 | 1,156 |

raw-candidate metric:

| Variant | Top-1 | Top-3 | MRR | Mean rank |
|---|---:|---:|---:|---:|
| V0 | 561 | 886 | 0.645290 | 2.961140 |
| V1 | 561 | 886 | 0.645290 | 2.961140 |
| V2 | 560 | 885 | 0.644451 | 2.963731 |
| V3 | 559 | 884 | 0.643760 | 2.967185 |
| V4 | 559 | 884 | 0.643760 | 2.967185 |

primary physical-class metric:

| Variant | Top-1 | Top-3 | Micro MRR | Macro MRR | Mean rank |
|---|---:|---:|---:|---:|---:|
| V0 | 659 | 1,013 | 0.727805 | 0.703260 | 2.082902 |
| V1 | 659 | 1,013 | 0.727805 | 0.703260 | 2.082902 |
| V2 | 658 | 1,013 | 0.727084 | 0.702426 | 2.084629 |
| V3 | 657 | 1,013 | 0.726652 | 0.702139 | 2.085492 |
| V4 | 657 | 1,013 | 0.726652 | 0.702139 | 2.085492 |

coefficient, score, rank 진단:

| 비교 | Min cosine | Max coefficient diff | Max held-out candidate score diff | Physical rank change |
|---|---:|---:|---:|---:|
| V1−V0 | 1.000000000000 | 1.5169e-10 | 2.8565e-9 | 0 |
| V2−V1 | 0.999992371140 | 0.0108866 | 0.3129449 | 7 |
| V3−V2 | 0.999999496661 | 0.0014148 | 0.0137789 | 1 |
| V4−V3 | 1.000000000000 | 2.8708e-11 | 6.2307e-10 | 0 |
| V4−V0 | 0.999992791985 | 0.0103175 | 0.3046999 | 8 |

fold 분포:

| Effect | Improved | Equal | Worse | Worst fold delta |
|---|---:|---:|---:|---:|
| V1−V0 zero sample | 0 | 26 | 0 | 0 |
| V2−V1 informative mass | 1 | 20 | 5 | -0.0151515 |
| V3−V2 generator multiplicity | 0 | 25 | 1 | -0.0074627 |
| V4−V3 row compression | 0 | 26 | 0 | 0 |
| V4−V0 total | 1 | 19 | 6 | -0.0151515 |

모든 variant는 26/26 fold에서 수렴했다. iteration 범위는 V0/V1/V2가 19~21,
V3/V4가 20~21이다. gameId leakage는 0이고 모든 variant가 같은 fold scaler를
사용했다.

ordered attribution:

| Effect | Micro class MRR delta | Macro class MRR delta |
|---|---:|---:|
| zero-sample | 0 | 0 |
| informative-mass renormalization | -0.0007210023 | -0.0008342553 |
| generator-multiplicity | -0.0004317789 | -0.0002870264 |
| row-compression | 0 | 0 |
| total | -0.0011527812 | -0.0011212818 |

이 순서에서 Micro 하락의 약 62.5%는 informative-mass 재정규화, 약 37.5%는
generator multiplicity 제거로 설명된다. Macro는 약 74.4%와 25.6%다.
zero sample 자체와 동일 class의 실제 row compression은 held-out rank와 metric을
바꾸지 않았다. 이것은 순서가 고정된 controlled decomposition이며 Shapley
attribution이나 완전한 인과 분해가 아니다.

결정성:

- run1 SHA-256:
  e05a75d578f4d97781b03725eef65c57fee790f27ba9e941c404621386c080bd
- run2 SHA-256:
  e05a75d578f4d97781b03725eef65c57fee790f27ba9e941c404621386c080bd
- report byte-identical: true
- executed Notebook error/Traceback: 0 / 0
- canonical result와 run1 bytes: identical

남은 위험:

- 26게임뿐이고 winner game은 3개뿐이다.
- winner segment는 참고 수치이며 별도 성능 결론을 내릴 수 없다.
- offline rank metric은 gameplay 성능이나 승률을 증명하지 않는다.
- 현재 결과는 어떤 weighting policy를 production에 쓸지 자동 결정하지 않는다.

다음 gate:

1. Phase 0~8 merge-readiness 감사를 수행한다.
2. Human imitation 목표와 gameplay promotion 목표를 분리해 기록한다.
3. occupied-cell representation과 V4 weighting 정책 계약을 명시한다.
4. 새 immutable snapshot을 검증한다.

이 순서를 새 feature 구현이나 모델 학습과 섞지 않는다. 상태는
pair_weight_tradeoff_explained, 프로그램 gate는 continue_experimenting으로
유지하며, production model, runtime, PVE 연결은 계속 보류한다.

직접 재현:

~~~bash
PLACEMENT_PAIR_WEIGHT_REPORT=/private/tmp/placement-pair-weight-report-run1.json \
conda run -n tetris-ml python -m jupyter nbconvert \
  --to notebook \
  --execute scripts/ml/notebooks/placement_pair_weight_decomposition_experiment.ipynb \
  --output placement-pair-weight-executed-run1.ipynb \
  --output-dir /private/tmp \
  --ExecutePreprocessor.timeout=1200
~~~

run2는 report와 output 이름만 run2로 바꾼다.

---

## 5. 환경 준비

고정 환경:

| package | version |
|---|---|
| Python | 3.12.13 |
| NumPy | 2.5.1 |
| pandas | 3.0.3 |
| SciPy | 1.18.0 |
| scikit-learn | 1.9.0 |
| ipykernel | 7.2.0 |
| nbconvert | 7.17.1 |

처음 환경을 만들 때:

~~~bash
cd /Users/parkseongho/visualstudio-workspace/Tetris_multi-ai
conda env create -f environment-ml.yml
~~~

이미 tetris-ml 환경이 있을 때:

~~~bash
cd /Users/parkseongho/visualstudio-workspace/Tetris_multi-ai
conda env update -n tetris-ml -f environment-ml.yml --prune
~~~

VS Code Notebook kernel 등록:

~~~bash
conda run -n tetris-ml python -m ipykernel install \
  --user \
  --name tetris-ml \
  --display-name "Python (tetris-ml)"
~~~

확인:

~~~bash
conda run -n tetris-ml python -c "import sys, numpy, pandas, scipy, sklearn; print(sys.version); print(numpy.__version__, pandas.__version__, scipy.__version__, sklearn.__version__)"

command -v jq
jq --version
command -v shasum
command -v comm
command -v sort
~~~

환경 생성 중 prefix already exists가 나오면 환경을 임의로 삭제하지 말고 env update 명령을 사용한다.

이 문서의 shell 명령은 macOS의 zsh 또는 bash 계열 shell, jq, shasum, comm, sort를 전제로 한다. jq는 Conda 또는 npm dependency가 아니라 현재 시스템 도구이므로 새 컴퓨터에서는 위 확인을 먼저 통과해야 한다. JupyterLab은 환경에 추가하지 않았으며 VS Code Notebook 또는 headless nbconvert를 사용한다.

---

## 6. 기존 26게임 실험 직접 재현하기

### 6.1 Snapshot checksum 확인

~~~bash
cd /Users/parkseongho/visualstudio-workspace/Tetris_multi-ai

SNAPSHOT_DIR=data/datasets/human-behavior-v2-snapshot-26g-20260717

shasum -a 256 \
  "$SNAPSHOT_DIR/manifest.json" \
  "$SNAPSHOT_DIR/train.jsonl" \
  "$SNAPSHOT_DIR/validation.jsonl" \
  "$SNAPSHOT_DIR/rejected.jsonl"
~~~

출력이 Phase 4의 네 SHA-256과 다르면 같은 26게임 실험을 재현하는 것이 아니다. 덮어쓴 snapshot을 사용하지 말고 보관본을 복구한다.

### 6.2 VS Code에서 흐름을 읽으며 실행

1. Tetris_multi-ai worktree를 VS Code로 연다.
2. scripts/ml/notebooks/placement_pairwise_logo_experiment.ipynb를 연다.
3. 우측 상단 kernel에서 Python (tetris-ml)을 선택한다.
4. 각 Markdown cell의 질문과 다음 code cell을 위에서 아래로 읽는다.
5. Restart Kernel and Run All Cells를 실행한다.
6. 중간 cell부터 실행하거나 이전 kernel state를 재사용하지 않는다.
7. source Notebook을 저장하기 전 Clear All Outputs를 실행한다.

새 snapshot을 대화형 kernel에서 선택하는 환경변수 전달은 IDE 실행 방식에 따라 달라질 수 있다. 정확한 재현과 두 번 실행 비교에는 아래 headless 명령을 권장한다.

### 6.3 Headless로 두 번 실행

Run 1:

~~~bash
set -euo pipefail

PLACEMENT_EXPERIMENT_DATASET=data/datasets/human-behavior-v2-snapshot-26g-20260717 \
PLACEMENT_EXPERIMENT_REPORT=/private/tmp/placement-logo-26g-report-run1.json \
conda run -n tetris-ml python -m jupyter nbconvert \
  --to notebook \
  --execute scripts/ml/notebooks/placement_pairwise_logo_experiment.ipynb \
  --output placement-logo-26g-executed-run1.ipynb \
  --output-dir /private/tmp \
  --ExecutePreprocessor.timeout=600
~~~

Run 2:

~~~bash
PLACEMENT_EXPERIMENT_DATASET=data/datasets/human-behavior-v2-snapshot-26g-20260717 \
PLACEMENT_EXPERIMENT_REPORT=/private/tmp/placement-logo-26g-report-run2.json \
conda run -n tetris-ml python -m jupyter nbconvert \
  --to notebook \
  --execute scripts/ml/notebooks/placement_pairwise_logo_experiment.ipynb \
  --output placement-logo-26g-executed-run2.ipynb \
  --output-dir /private/tmp \
  --ExecutePreprocessor.timeout=600
~~~

결정성 확인:

~~~bash
cmp -s \
  /private/tmp/placement-logo-26g-report-run1.json \
  /private/tmp/placement-logo-26g-report-run2.json \
  && echo "reports are byte-identical" \
  || {
    echo "26g reports differ"
    exit 1
  }

shasum -a 256 \
  /private/tmp/placement-logo-26g-report-run1.json \
  /private/tmp/placement-logo-26g-report-run2.json
~~~

핵심 결과만 보기:

~~~bash
jq '{
  experimentStatus,
  dataSummary,
  aggregate: {
    foldCount: .aggregate.foldCount,
    convergedFoldCount: .aggregate.convergedFoldCount,
    gameIdLeakageCount: .aggregate.gameIdLeakageCount,
    micro: .aggregate.micro,
    macroAverage: .aggregate.macroAverage,
    range: .aggregate.range,
    worstFold: .aggregate.worstFold
  }
}' /private/tmp/placement-logo-26g-report-run1.json
~~~

완료 조건:

- 두 nbconvert 실행이 exit code 0이다.
- executed Notebook에 error와 Traceback이 없다.
- report가 byte-identical이다.
- foldCount와 validation game 수가 같다.
- convergedFoldCount와 foldCount가 같다.
- gameIdLeakageCount가 0이다.
- source snapshot checksum이 실행 전후 같다.

### 6.4 Historical 13게임 baseline 재현

13게임 snapshot은 작성 시점에 main worktree의 다음 위치에 남아 있다.

~~~text
/Users/parkseongho/visualstudio-workspace/Tetris_multi/data/datasets/human-behavior-v2
~~~

Baseline Notebook은 parent alias를 거부하므로 ../Tetris_multi 경로를 직접 입력할 수 없다. 과거 report에는 sourceDataset.relativeDirectory도 들어 있으므로 historical report SHA까지 재현하려면 AI worktree에도 당시와 같은 상대 경로인 data/datasets/human-behavior-v2를 사용해야 한다.

~~~bash
set -euo pipefail

cd /Users/parkseongho/visualstudio-workspace/Tetris_multi-ai

SOURCE_13G=/Users/parkseongho/visualstudio-workspace/Tetris_multi/data/datasets/human-behavior-v2
SNAPSHOT_13G=data/datasets/human-behavior-v2

test -d "$SOURCE_13G"
test ! -L "$SNAPSHOT_13G"

if test ! -e "$SNAPSHOT_13G"; then
  cp -R "$SOURCE_13G" "$SNAPSHOT_13G"
fi

shasum -a 256 \
  "$SNAPSHOT_13G/manifest.json" \
  "$SNAPSHOT_13G/train.jsonl" \
  "$SNAPSHOT_13G/validation.jsonl" \
  "$SNAPSHOT_13G/rejected.jsonl"
~~~

네 checksum이 Phase 3과 일치할 때만 다음을 실행한다.

~~~bash
PLACEMENT_EXPERIMENT_DATASET="$SNAPSHOT_13G" \
PLACEMENT_EXPERIMENT_REPORT=/private/tmp/placement-logo-13g-report-run1.json \
conda run -n tetris-ml python -m jupyter nbconvert \
  --to notebook \
  --execute scripts/ml/notebooks/placement_pairwise_logo_experiment.ipynb \
  --output placement-logo-13g-executed-run1.ipynb \
  --output-dir /private/tmp \
  --ExecutePreprocessor.timeout=600

PLACEMENT_EXPERIMENT_DATASET="$SNAPSHOT_13G" \
PLACEMENT_EXPERIMENT_REPORT=/private/tmp/placement-logo-13g-report-run2.json \
conda run -n tetris-ml python -m jupyter nbconvert \
  --to notebook \
  --execute scripts/ml/notebooks/placement_pairwise_logo_experiment.ipynb \
  --output placement-logo-13g-executed-run2.ipynb \
  --output-dir /private/tmp \
  --ExecutePreprocessor.timeout=600

cmp -s \
  /private/tmp/placement-logo-13g-report-run1.json \
  /private/tmp/placement-logo-13g-report-run2.json \
  || {
    echo "13g reports differ"
    exit 1
  }

shasum -a 256 \
  /private/tmp/placement-logo-13g-report-run1.json \
  /private/tmp/placement-logo-13g-report-run2.json
~~~

### 6.5 Historical 단일 fold parity 재현

이 명령은 Python 전환의 수치 검증을 다시 확인할 때만 사용한다. 새 feature 실험의 기본 경로가 아니다.

~~~bash
set -euo pipefail

cd /Users/parkseongho/visualstudio-workspace/Tetris_multi-ai

npm run model:export-placement-parity -- \
  --dataset-dir data/datasets/human-behavior-v2 \
  --validation-game-id 3A5869D1-1784156123783 \
  --output /private/tmp/placement-parity-bundle-run1.json

conda run -n tetris-ml python scripts/ml/placement_pairwise_parity.py \
  --bundle /private/tmp/placement-parity-bundle-run1.json \
  --output /private/tmp/placement-parity-report-run1.json

npm run model:export-placement-parity -- \
  --dataset-dir data/datasets/human-behavior-v2 \
  --validation-game-id 3A5869D1-1784156123783 \
  --output /private/tmp/placement-parity-bundle-run2.json

conda run -n tetris-ml python scripts/ml/placement_pairwise_parity.py \
  --bundle /private/tmp/placement-parity-bundle-run2.json \
  --output /private/tmp/placement-parity-report-run2.json

cmp -s \
  /private/tmp/placement-parity-bundle-run1.json \
  /private/tmp/placement-parity-bundle-run2.json \
  || {
    echo "parity bundles differ"
    exit 1
  }

cmp -s \
  /private/tmp/placement-parity-report-run1.json \
  /private/tmp/placement-parity-report-run2.json \
  || {
    echo "parity reports differ"
    exit 1
  }

shasum -a 256 \
  /private/tmp/placement-parity-bundle-run1.json \
  /private/tmp/placement-parity-bundle-run2.json \
  /private/tmp/placement-parity-report-run1.json \
  /private/tmp/placement-parity-report-run2.json

jq '{
  validationGameId,
  counts,
  jsEquivalent,
  sklearn: {
    status: .sklearn.status,
    converged: .sklearn.converged,
    iterationCount: .sklearn.iterationCount,
    warnings: .sklearn.warnings,
    metrics: .sklearn.metrics,
    comparison: .sklearn.comparison
  },
  analysis
}' /private/tmp/placement-parity-report-run1.json
~~~

현재 명령 옵션이나 report schema가 궁금하면 [수학 계약 문서](placement-pairwise-ranker.md)를 먼저 확인한다.

### 6.6 Historical collision 분석 재현

Collision Notebook은 26게임 경로, checksum, count와 예상 collision 수를 고정한다. 반드시 같은 snapshot에서만 실행한다.

Run 1:

~~~bash
set -euo pipefail

PLACEMENT_COLLISION_DATASET=data/datasets/human-behavior-v2-snapshot-26g-20260717 \
PLACEMENT_COLLISION_REPORT=/private/tmp/placement-collision-report-run1.json \
conda run -n tetris-ml python -m jupyter nbconvert \
  --to notebook \
  --execute scripts/ml/notebooks/placement_feature_collision_analysis.ipynb \
  --output placement-collision-run1-executed.ipynb \
  --output-dir /private/tmp \
  --ExecutePreprocessor.timeout=600
~~~

Run 2:

~~~bash
PLACEMENT_COLLISION_DATASET=data/datasets/human-behavior-v2-snapshot-26g-20260717 \
PLACEMENT_COLLISION_REPORT=/private/tmp/placement-collision-report-run2.json \
conda run -n tetris-ml python -m jupyter nbconvert \
  --to notebook \
  --execute scripts/ml/notebooks/placement_feature_collision_analysis.ipynb \
  --output placement-collision-run2-executed.ipynb \
  --output-dir /private/tmp \
  --ExecutePreprocessor.timeout=600

cmp -s \
  /private/tmp/placement-collision-report-run1.json \
  /private/tmp/placement-collision-report-run2.json \
  || {
    echo "collision reports differ"
    exit 1
  }

shasum -a 256 \
  /private/tmp/placement-collision-report-run1.json \
  /private/tmp/placement-collision-report-run2.json
~~~

### 6.7 Historical cell-equivalence 비교 재현

이 Notebook도 26게임 snapshot을 고정한다. 또한 report 외에 docs/placement-cell-equivalence-logo-result.json을 atomic write하므로 실행 전후 Git 상태와 checksum을 확인한다.

~~~bash
set -euo pipefail

git status --short -- docs/placement-cell-equivalence-logo-result.json
git diff -- docs/placement-cell-equivalence-logo-result.json

PLACEMENT_CELL_EQUIVALENCE_REPORT=/private/tmp/placement-cell-equivalence-logo-report-run1.json \
conda run -n tetris-ml jupyter nbconvert \
  --to notebook \
  --execute \
  --ExecutePreprocessor.timeout=1200 \
  --output /private/tmp/placement-cell-equivalence-logo-executed-run1.ipynb \
  scripts/ml/notebooks/placement_cell_equivalence_logo_experiment.ipynb

PLACEMENT_CELL_EQUIVALENCE_REPORT=/private/tmp/placement-cell-equivalence-logo-report-run2.json \
conda run -n tetris-ml jupyter nbconvert \
  --to notebook \
  --execute \
  --ExecutePreprocessor.timeout=1200 \
  --output /private/tmp/placement-cell-equivalence-logo-executed-run2.ipynb \
  scripts/ml/notebooks/placement_cell_equivalence_logo_experiment.ipynb

cmp -s \
  /private/tmp/placement-cell-equivalence-logo-report-run1.json \
  /private/tmp/placement-cell-equivalence-logo-report-run2.json \
  || {
    echo "cell-equivalence reports differ"
    exit 1
  }

shasum -a 256 \
  /private/tmp/placement-cell-equivalence-logo-report-run1.json \
  /private/tmp/placement-cell-equivalence-logo-report-run2.json \
  docs/placement-cell-equivalence-logo-result.json

git status --short -- docs/placement-cell-equivalence-logo-result.json
git diff -- docs/placement-cell-equivalence-logo-result.json
~~~

현재 canonical result가 untracked이면 git diff에는 나타나지 않으므로 git status와 shasum을 기준으로 확인한다. commit된 뒤에는 git diff도 유효하다. 동일 환경에서 canonical result는 같은 bytes여야 한다. 다른 platform에서 값이 바뀌면 자동으로 덮어쓰지 말고 수치 차이와 environment를 먼저 비교한다.

---

## 7. 게임 로그가 더 추가됐을 때 전체 실행 절차

이 절차는 새 게임 로그를 **기존 전처리로 export하고 Python baseline을 재평가**한다. 기존 snapshot은 절대 덮어쓰지 않는다.

### Step 1 — 게임과 서버를 멈춘다

game-events.jsonl에 append가 계속되는 동안 export하면 source checksum과 line 수가 실행 중 바뀔 수 있다. 새 게임이 정상 종료된 뒤 서버와 플레이를 멈춘다.

### Step 2 — 새 snapshot 이름과 경로를 정한다

아래 예시는 46게임, 2026-07-17 snapshot이다. 실제 game count와 날짜로 바꾼다.

~~~bash
set -euo pipefail

cd /Users/parkseongho/visualstudio-workspace/Tetris_multi-ai

SOURCE_LOG=/Users/parkseongho/visualstudio-workspace/Tetris_multi/data/logs/game-events.jsonl
SNAPSHOT_TAG=46g-20260717
SNAPSHOT_DIR="data/datasets/human-behavior-v2-snapshot-$SNAPSHOT_TAG"
RECHECK_DIR="/private/tmp/human-behavior-v2-snapshot-$SNAPSHOT_TAG-recheck"
REPORT_RUN1="/private/tmp/placement-logo-$SNAPSHOT_TAG-report-run1.json"
REPORT_RUN2="/private/tmp/placement-logo-$SNAPSHOT_TAG-report-run2.json"
EXECUTED_RUN1="placement-logo-$SNAPSHOT_TAG-executed-run1.ipynb"
EXECUTED_RUN2="placement-logo-$SNAPSHOT_TAG-executed-run2.ipynb"

test -f "$SOURCE_LOG"
test ! -e "$SNAPSHOT_DIR"
test ! -L "$SNAPSHOT_DIR"
test ! -e "$RECHECK_DIR"
test ! -L "$RECHECK_DIR"
~~~

경로 규칙:

- SNAPSHOT_DIR는 AI worktree 안의 새로운 상대 경로를 사용한다.
- 이미 존재하는 snapshot 이름을 재사용하지 않는다.
- symlink를 snapshot 경로로 사용하지 않는다.
- /private/tmp는 recheck와 실행 report에만 사용한다.

Step 2부터 Step 12까지는 변수와 set -euo pipefail이 유지되도록 같은 zsh/bash terminal session에서 순서대로 실행한다. SNAPSHOT_TAG 하나를 바꾸면 snapshot, report, executed Notebook 이름이 함께 바뀌어 provenance가 어긋나는 것을 막는다.

### Step 3 — 원본 상태를 기록한다

~~~bash
LOG_SHA_BEFORE=$(shasum -a 256 "$SOURCE_LOG" | awk '{print $1}')
LOG_LINE_BEFORE=$(wc -l < "$SOURCE_LOG" | tr -d ' ')

echo "source sha: $LOG_SHA_BEFORE"
echo "source lines: $LOG_LINE_BEFORE"

jq -s '{
  gameStart: [.[] | select(.eventType == "game_start")] | length,
  gameOver: [.[] | select(.eventType == "game_over")] | length,
  humanPlacementDecision: [
    .[]
    | select(
        .eventType == "placement_decision"
        and .source == "human"
      )
  ] | length
}' "$SOURCE_LOG"
~~~

게임별 lifecycle 이상을 확인한다.

~~~bash
jq -s '
  [
    .[]
    | select(
        .eventType == "game_start"
        or .eventType == "placement_decision"
        or .eventType == "game_over"
      )
    | select(
        (.gameId | type) == "string"
        and (.gameId | length) > 0
      )
  ]
  | group_by(.gameId)
  | map({
      gameId: .[0].gameId,
      starts: [ .[] | select(.eventType == "game_start") ] | length,
      overs: [ .[] | select(.eventType == "game_over") ] | length,
      normalOvers: [
        .[]
        | select(
            .eventType == "game_over"
            and .finishType == "normal"
          )
      ] | length,
      decisions: [
        .[]
        | select(.eventType == "placement_decision")
      ] | length
    })
  | {
      totalGameIds: length,
      ready: [
        .[]
        | select(
            .starts == 1
            and .overs == 1
            and .normalOvers == 1
            and .decisions > 0
          )
      ] | length,
      incomplete: [
        .[]
        | select(.starts == 0 or .overs == 0)
      ],
      ambiguous: [
        .[]
        | select(.starts > 1 or .overs > 1)
      ],
      nonNormal: [
        .[]
        | select(.overs == 1 and .normalOvers != 1)
      ],
      noDecisions: [
        .[]
        | select(.decisions == 0)
      ]
    }
' "$SOURCE_LOG"
~~~

ready가 totalGameIds와 같고 incomplete, ambiguous, nonNormal, noDecisions가 모두 비어 있어야 한다. 그렇지 않으면 바로 export하지 말고 해당 gameId의 이벤트를 먼저 확인한다.

### Step 4 — 기존 exporter로 immutable snapshot을 만든다

옵션을 생략하지 않는다. exporter 기본 정책과 새 실험 정책이 다를 수 있기 때문이다.

~~~bash
npm run dataset:export -- \
  --input "$SOURCE_LOG" \
  --output-dir "$SNAPSHOT_DIR" \
  --validation-ratio 0.2 \
  --seed placement-dataset-v1 \
  --selection-policy all-completed \
  --source human
~~~

역사 실험은 exclude-player-prefix를 지정하지 않았다. 기본값은 빈 배열이라 테스트 player를 자동으로 제외하지 않는다. 앞으로 테스트 계정 로그가 섞인다면 제외할 prefix를 먼저 문서화하고, 두 export 모두 같은 repeatable 옵션으로 명시해야 한다.

생성 파일:

~~~text
manifest.json
train.jsonl
validation.jsonl
rejected.jsonl
~~~

이 단계는 기존 JavaScript 전처리 경계를 사용하는 것이다. JavaScript에서 새 모델 실험을 반복하는 것이 아니다.

### Step 5 — 원본 불변성과 manifest를 검증한다

~~~bash
LOG_SHA_AFTER=$(shasum -a 256 "$SOURCE_LOG" | awk '{print $1}')
LOG_LINE_AFTER=$(wc -l < "$SOURCE_LOG" | tr -d ' ')

test "$LOG_SHA_BEFORE" = "$LOG_SHA_AFTER"
test "$LOG_LINE_BEFORE" = "$LOG_LINE_AFTER"
test "$(jq -r '.inputSha256' "$SNAPSHOT_DIR/manifest.json")" = "$LOG_SHA_BEFORE"

jq '{
  selectionPolicy,
  sourceFilter,
  jsonParseFailureCount,
  totalGameCount,
  eligibleGameCount,
  excludedGameCount,
  acceptedPlacementLogCount,
  selectedBySourceSampleCount,
  trainGameCount,
  validationGameCount,
  inputLineCount,
  inputSha256,
  rejectionReasonCounts
}' "$SNAPSHOT_DIR/manifest.json"

jq -e '
  .datasetSchemaVersion == 2
  and .exportPolicyVersion == 2
  and .selectionPolicy == "all-completed"
  and .sourceFilter == "human"
  and .winnerOnly == false
  and .minimumPieceIndex == 5
  and .requiredFinishType == "normal"
  and .validationRatio == 0.2
  and .seed == "placement-dataset-v1"
  and .jsonParseFailureCount == 0
  and .acceptedPlacementLogCount > 0
  and .selectedBySourceSampleCount == .acceptedPlacementLogCount
' "$SNAPSHOT_DIR/manifest.json"
~~~

필수 gate:

- selectionPolicy가 all-completed다.
- sourceFilter가 human이다.
- jsonParseFailureCount가 0이다.
- acceptedPlacementLogCount와 selectedBySourceSampleCount가 기대한 Human decision 수와 맞는다.
- trainGameCount + validationGameCount가 eligibleGameCount보다 클 수 없다. 더 작다면 해당 eligible game의 Human placement가 schema, difficulty 또는 reachable 검증에서 전부 거부됐는지 조사한다.
- manifest의 inputSha256이 export 전 원본 SHA와 같다.

EARLY_PIECE_INDEX와 SOURCE_FILTERED는 정책상 발생할 수 있다. INVALID_JSON_LINE, AMBIGUOUS_GAME_LIFECYCLE, AMBIGUOUS_AI_DIFFICULTY, schema 오류는 원인을 확인해야 한다. SELECTED_PLACEMENT_NOT_REACHABLE도 소수라도 gameId와 decision을 기록해 검토한다.

### Step 6 — train/validation gameId leakage를 확인한다

~~~bash
LEAKAGE_COUNT=$(comm -12 \
  <(jq -r '.gameId' "$SNAPSHOT_DIR/train.jsonl" | LC_ALL=C sort -u) \
  <(jq -r '.gameId' "$SNAPSHOT_DIR/validation.jsonl" | LC_ALL=C sort -u) \
  | wc -l \
  | tr -d ' ')

echo "gameId leakage: $LEAKAGE_COUNT"
test "$LEAKAGE_COUNT" = "0"
~~~

### Step 7 — snapshot checksum을 기록한다

~~~bash
shasum -a 256 \
  "$SNAPSHOT_DIR/manifest.json" \
  "$SNAPSHOT_DIR/train.jsonl" \
  "$SNAPSHOT_DIR/validation.jsonl" \
  "$SNAPSHOT_DIR/rejected.jsonl"
~~~

이 네 값은 새 실험 결과 문서와 report에 함께 남긴다.

### Step 8 — exporter 결정성을 재확인한다

같은 source와 같은 옵션으로 /private/tmp의 새 경로에 한 번 더 export한다.

~~~bash
npm run dataset:export -- \
  --input "$SOURCE_LOG" \
  --output-dir "$RECHECK_DIR" \
  --validation-ratio 0.2 \
  --seed placement-dataset-v1 \
  --selection-policy all-completed \
  --source human

for name in manifest.json train.jsonl validation.jsonl rejected.jsonl; do
  cmp -s "$SNAPSHOT_DIR/$name" "$RECHECK_DIR/$name" || exit 1
done

echo "snapshot export is byte-identical"

test "$(shasum -a 256 "$SOURCE_LOG" | awk '{print $1}')" = "$LOG_SHA_BEFORE"
~~~

현재 exporter는 같은 resolved 문자열 경로에 대한 기본 보호는 하지만 기존 output 디렉터리를 immutable하게 잠그지는 않는다. 그래서 fresh path, symlink 사전 검사, source SHA 전후 비교를 절차로 강제한다.

### Step 9 — snapshot을 영구 보관한다

data/datasets는 Git ignore 대상이다. worktree를 삭제하면 snapshot도 사라질 수 있다.

최소 보관 단위:

- manifest.json
- train.jsonl
- validation.jsonl
- rejected.jsonl
- 네 파일 SHA-256
- source log SHA-256
- exporter 명령과 옵션

예시:

~~~bash
ARCHIVE_PATH="/영구보관경로/human-behavior-v2-snapshot-$SNAPSHOT_TAG.tar.gz"

tar -czf "$ARCHIVE_PATH" \
  -C "$SNAPSHOT_DIR" \
  manifest.json \
  train.jsonl \
  validation.jsonl \
  rejected.jsonl

shasum -a 256 "$ARCHIVE_PATH"
~~~

/영구보관경로는 실제 백업 디렉터리로 바꾼 뒤 실행한다.

### Step 10 — 새 snapshot으로 Python baseline을 두 번 실행한다

Run 1:

~~~bash
PLACEMENT_EXPERIMENT_DATASET="$SNAPSHOT_DIR" \
PLACEMENT_EXPERIMENT_REPORT="$REPORT_RUN1" \
conda run -n tetris-ml python -m jupyter nbconvert \
  --to notebook \
  --execute scripts/ml/notebooks/placement_pairwise_logo_experiment.ipynb \
  --output "$EXECUTED_RUN1" \
  --output-dir /private/tmp \
  --ExecutePreprocessor.timeout=1200
~~~

Run 2:

~~~bash
PLACEMENT_EXPERIMENT_DATASET="$SNAPSHOT_DIR" \
PLACEMENT_EXPERIMENT_REPORT="$REPORT_RUN2" \
conda run -n tetris-ml python -m jupyter nbconvert \
  --to notebook \
  --execute scripts/ml/notebooks/placement_pairwise_logo_experiment.ipynb \
  --output "$EXECUTED_RUN2" \
  --output-dir /private/tmp \
  --ExecutePreprocessor.timeout=1200
~~~

두 report 비교:

~~~bash
cmp -s \
  "$REPORT_RUN1" \
  "$REPORT_RUN2" \
  && echo "reports are byte-identical" \
  || {
    echo "new snapshot reports differ"
    exit 1
  }

shasum -a 256 \
  "$REPORT_RUN1" \
  "$REPORT_RUN2"
~~~

핵심 결과 확인:

~~~bash
jq '{
  experimentStatus,
  dataSummary,
  representation: .fullDatasetRepresentation,
  aggregate: {
    foldCount: .aggregate.foldCount,
    validationGameCount: .aggregate.validationGameCount,
    convergedFoldCount: .aggregate.convergedFoldCount,
    gameIdLeakageCount: .aggregate.gameIdLeakageCount,
    micro: .aggregate.micro,
    macroAverage: .aggregate.macroAverage,
    median: .aggregate.median,
    range: .aggregate.range,
    worstFold: .aggregate.worstFold
  }
}' "$REPORT_RUN1"
~~~

### Step 11 — 이전 결과와 올바르게 비교한다

새 snapshot이 이전 게임을 포함하면 다음처럼 표현한다.

좋은 표현:

> 26게임에서 46게임으로 dataset을 확대했을 때 LOGO 지표 추세가 이렇게 변했다.

피해야 할 표현:

> 독립 테스트에서 모델 성능이 이만큼 향상됐다.

비교할 항목:

- game, decision, candidate, pair 수
- micro와 macro를 함께
- median, min, max, worst fold
- convergence fold 수
- gameId leakage
- selected-feature duplicate
- zero-difference pair
- top-score tie
- difficulty와 winner/loss segmentation
- 기존 게임과 새 게임이 겹치는지

### Step 12 — 검증한다

~~~bash
conda run -n tetris-ml python -m unittest \
  python_tests/test_placement_experiment_notebook.py \
  python_tests/test_placement_feature_collision_notebook.py \
  python_tests/test_placement_cell_equivalence_notebook.py

npm run verify:ml
bash scripts/verify.sh
git diff --check
~~~

Notebook 계약 테스트는 cell 구조와 코드 계약을 검증한다. 실제 실험 완료를 주장하려면 headless 실행, report 2회 결정성, convergence, leakage, source checksum도 함께 통과해야 한다.

---

## 8. 어떤 Notebook을 새 데이터에 쓸 수 있는가

| Notebook | 새 snapshot에 그대로 사용 | 이유 |
|---|---|---|
| placement_pairwise_logo_experiment.ipynb | 예 | PLACEMENT_EXPERIMENT_DATASET 상대 경로를 받고 count와 fold를 manifest에서 계산 |
| placement_feature_collision_analysis.ipynb | 아니오 | 26게임 경로, checksum, count, collision 수를 historical contract로 고정 |
| placement_cell_equivalence_logo_experiment.ipynb | 아니오 | 26게임 snapshot과 canonical result 계약을 고정 |

새 로그가 추가됐을 때 첫 진입점은 항상 **placement_pairwise_logo_experiment.ipynb**다.

Collision 또는 cell-equivalence 가설을 새 snapshot에서 다시 검증하고 싶다면:

1. 기존 historical Notebook을 덮어쓰지 않는다.
2. 새 snapshot 이름과 질문을 명시한 새 Notebook을 만든다.
3. 첫 Markdown cell에 가설, 고정 조건, 변경 변수, 성공/중단 기준을 적는다.
4. 새 checksum과 count를 계약 테스트에 기록한다.
5. report는 두 번 생성하고 byte 비교한다.
6. 기존 결과와 새 결과를 독립 실험처럼 보이게 섞지 않는다.

Cell-equivalence Notebook은 실행할 때 /private/tmp report뿐 아니라 docs/placement-cell-equivalence-logo-result.json도 atomic write한다. 실행 전후 Git diff를 반드시 확인한다.

---

## 9. /private/tmp를 사용하는 이유와 제한

/private/tmp는 코드 작성 장소가 아니다.

사용해도 되는 것:

- executed Notebook
- run1 / run2 report
- exporter 결정성 recheck snapshot
- Jupyter runtime/config 우회 디렉터리

저장소에 있어야 하는 것:

- source Notebook
- Notebook 계약 테스트
- 사람이 읽는 실험 설명
- 채택한 canonical result
- 환경 파일

영구 데이터 보관소에 있어야 하는 것:

- immutable dataset snapshot
- snapshot checksum
- 필요하다면 source log 보관본

이 구분을 쓰는 이유:

- 실행 output 때문에 source Notebook이 매번 dirty해지는 일을 막는다.
- 결정성 비교용 파일을 쉽게 폐기할 수 있다.
- 절대 경로와 timestamp가 canonical source에 섞이는 것을 막는다.
- 실험 코드와 일회성 산출물을 분리해 사용자가 실제 흐름을 읽기 쉽게 한다.

/private/tmp의 파일은 재부팅이나 정리 작업으로 사라질 수 있다. 과거 실험의 유일한 증거로 사용하면 안 된다.

---

## 10. 흔한 실패와 해결

### DATASET_PATH_MUST_BE_RELATIVE

원인: Notebook dataset 환경변수에 절대 경로를 넣었다.

해결: AI worktree 기준 data/datasets/... 상대 경로를 사용한다.

### DATASET_PATH_PARENT_ALIAS_NOT_ALLOWED

원인: ../Tetris_multi/...를 Notebook에 직접 넣었다.

해결: immutable snapshot을 AI worktree의 ignored data/datasets 아래에 복사한 뒤 상대 경로로 지정한다.

### REPORT_MUST_BE_OUTSIDE_REPOSITORY

적용 범위: collision Notebook.

원인: collision 실행 report를 저장소 안에 지정했다. Baseline과 cell-equivalence의 output 계약은 서로 다르므로 이 오류를 모든 Notebook의 공통 규칙으로 해석하지 않는다.

해결: run report는 /private/tmp에 둔다.

### checksum mismatch

가능한 원인:

- historical snapshot을 덮어썼다.
- 다른 snapshot을 historical Notebook에 넣었다.
- 원본 로그가 export 도중 append됐다.

해결:

- source SHA 전후를 비교한다.
- 새로운 snapshot 이름을 사용한다.
- 보관한 네 checksum과 대조한다.

### environment mismatch

원인: tetris-ml kernel이 아니거나 package 버전이 다르다.

해결:

~~~bash
conda env update -n tetris-ml -f environment-ml.yml --prune
~~~

### timeout

- baseline과 collision: 보통 600초
- 데이터가 늘어난 baseline과 equivalence: 1,200초 권장

timeout을 늘리기 전에 실제 무한 loop인지, kernel이 시작되지 않은 것인지 실행 output을 확인한다.

### Jupyter home 또는 IPC 권한 문제

제한된 sandbox에서만 다음 임시 디렉터리를 사용한다.

~~~bash
mkdir -p \
  /private/tmp/tetris-jupyter/config \
  /private/tmp/tetris-jupyter/data \
  /private/tmp/tetris-jupyter/runtime \
  /private/tmp/tetris-jupyter/ipython

JUPYTER_CONFIG_DIR=/private/tmp/tetris-jupyter/config \
JUPYTER_DATA_DIR=/private/tmp/tetris-jupyter/data \
JUPYTER_RUNTIME_DIR=/private/tmp/tetris-jupyter/runtime \
IPYTHONDIR=/private/tmp/tetris-jupyter/ipython \
conda run -n tetris-ml python -m jupyter nbconvert ...
~~~

### source Notebook이 계속 dirty

원인: VS Code가 execution count와 output을 source ipynb에 저장했다.

해결: source Notebook에서 Clear All Outputs를 실행한다. 자동 재현은 /private/tmp의 executed Notebook을 사용한다.

### report 두 개가 다름

확인 순서:

1. source snapshot SHA가 같은가
2. environment version이 같은가
3. feature 순서가 같은가
4. gameId와 placementKey 정렬이 결정적인가
5. report에 timestamp나 사용자 절대 경로가 들어갔는가
6. scaler fit 범위, C, sample weight가 달라졌는가

### Exporter의 MODULE_TYPELESS_PACKAGE_JSON 경고

현재 export가 성공하고 output이 결정적이면 비치명 경고다. 경고를 없애기 위한 package 구조 변경을 AI 실험 작업에 섞지 않는다.

---

## 11. 새 실험 Notebook 작성 규칙

사용자가 직접 흐름을 읽고 재현할 수 있도록 모든 새 실험 Notebook은 다음 순서를 따른다.

1. 질문
2. 왜 이 질문이 필요한지
3. 가설
4. 고정할 baseline 계약
5. 이번에 하나만 바꿀 변수
6. 입력 snapshot 경로와 네 checksum
7. 작은 worked example
8. 전체 데이터 진단
9. LOGO 실행
10. micro / macro / fold 분포
11. 실패 사례와 worst fold
12. source checksum 재검증
13. 결정적 report
14. 결론과 다음 gate

각 code cell 앞 Markdown cell에는 최소한 다음을 설명한다.

- 이 셀이 받는 입력
- 무엇을 계산하는지
- 결과를 어떻게 읽는지
- 어떤 결과면 다음 단계로 가지 않는지

새 실험은 feature, pair construction, scaler, estimator, metric 중 하나만 바꾸는 것을 기본으로 한다. 둘 이상을 동시에 바꾸면 어느 변화가 결과를 만들었는지 알 수 없다.

최종 모델 trainer를 일반 Python 파일로 옮기는 시점:

- representation과 feature가 동결됐다.
- pair weighting이 동결됐다.
- LOGO 결과가 여러 snapshot에서 안정적이다.
- 실패 사례를 설명할 수 있다.
- production integration을 승인했다.

그전까지는 Notebook이 실험의 주 실행 문서다.

---

## 12. 다음 작업 gate

Phase 8은 pair-weight decomposition 질문을 끝냈다. 바로 다음 작업은 새 feature,
scaler, estimator, trainer 또는 snapshot export가 아니다.

1. **Phase 0~8 merge-readiness 감사**: historical baseline, Phase 8 commit,
   checksum, Notebook 계약, dirty-file 분리를 검토한다.
2. **Human imitation과 gameplay promotion 목표 분리**: placement ranking metric이
   gameplay 생존·공격·승률 promotion을 의미하지 않음을 목표와 acceptance criteria에
   분리해 기록한다.
3. **Occupied-cell representation과 V4 weighting 정책 계약**: physical class를
   학습·평가 단위로 채택할지, V4의 class-balanced weight를 어떤 scope에서
   기본 정책으로 삼을지 명시한다.
4. **새 immutable snapshot 검증**: 새 dataset을 만들기 전에 provenance, checksum,
   split leakage, 보관 경로와 재현성을 검증한다.

이 순서가 끝나기 전에는 새 geometry feature, scaler 변경, neural network,
full-data trainer, production model.json 교체, runtime/PVE 연결, JavaScript
실험 재구현을 수행하지 않는다.

---

## 13. 실험 결과 기록 템플릿

새 실험이 끝나면 아래 형식으로 이 문서에 다음 Phase를 추가한다.

~~~markdown
## Phase N — 실험 이름

상태:

질문:

가설:

고정 조건:

변경 변수:

snapshot:
- 경로:
- manifest SHA-256:
- train SHA-256:
- validation SHA-256:
- rejected SHA-256:

데이터:
- game:
- decision:
- candidate:
- pair:

결과:
- micro:
- macro:
- fold range:
- worst fold:
- convergence:
- leakage:

결정성:
- run1 report:
- run2 report:
- SHA-256:

해석:

채택 또는 기각:

다음 gate:
~~~

---

## 14. 최종 체크리스트

새 게임 로그를 평가할 때:

- [ ] AI worktree와 AI branch에서 작업한다.
- [ ] 게임 서버와 로그 append를 멈춘다.
- [ ] source log SHA와 line 수를 기록한다.
- [ ] 새 snapshot 경로를 사용한다.
- [ ] all-completed와 human 옵션을 명시한다.
- [ ] source SHA가 export 전후 같다.
- [ ] manifest 정책과 count를 확인한다.
- [ ] train/validation gameId leakage가 0이다.
- [ ] snapshot 네 파일 SHA를 기록한다.
- [ ] 같은 export를 /private/tmp에서 한 번 더 만들어 byte 비교한다.
- [ ] snapshot을 Git 밖의 영구 위치에도 보관한다.
- [ ] Python baseline Notebook을 처음부터 두 번 실행한다.
- [ ] report가 byte-identical이다.
- [ ] 모든 fold가 수렴한다.
- [ ] micro와 macro, range, worst fold를 함께 본다.
- [ ] 이전 snapshot과 데이터가 겹친다는 점을 해석에 반영한다.
- [ ] npm run verify:ml과 bash scripts/verify.sh를 모두 실행한다.
- [ ] source Notebook output을 비운다.
- [ ] production/runtime/PVE를 자동으로 변경하지 않는다.

이 체크리스트까지 통과해야 새 snapshot baseline을 재현 가능한 완료 실험으로 기록한다.
