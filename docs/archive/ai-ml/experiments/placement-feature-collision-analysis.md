# Placement Feature Collision Analysis

역사 기록 · [전체 순서](../README.md) ·
[이전: Python LOGO](placement-python-experiment-notebook.md) ·
[다음: cell equivalence](../../../ai-ml/experiments/placement-cell-equivalence-logo.md).

## 결론

26-game Human snapshot의 기존 16-feature collision은 **새 geometry 정보 부족보다
candidate 표현 중복**이 원인이다.

- zero-difference pair 1,010개는 기존 `placementKey`로는 모두 다르다.
- 하지만 1,010개 모두 selected/unselected가 정확히 같은 네 occupied cell을 사용한다.
- `rotation`은 1,010개 전부를 구분하고 placement anchor `col`은 410개, `row`는
  90개를 구분하지만, 이는 대칭 조각의 동일 placement를 다른 rotation/pivot으로
  표현한 차이다.
- cell 높이·폭, 평균 위치와 wall distance 등 physical geometry는 1,010개 중
  하나도 구분하지 못한다.

따라서 실험 상태는 `geometry_does_not_resolve_collision`이다. 이번 단계에서는
LogisticRegression에 geometry feature를 추가하거나 새 모델을 학습하지 않는다.

## 산출물과 실행

- Notebook: `scripts/ml/notebooks/placement_feature_collision_analysis.ipynb`
- 계약 테스트: `scripts/ml/tests/test_placement_feature_collision_notebook.py`
- 분석 문서: `docs/archive/ai-ml/experiments/placement-feature-collision-analysis.md`

Notebook은 snapshot JSONL을 pandas로 직접 읽는다. 실행본과 report는 저장소 밖에
둔다.

```bash
PLACEMENT_COLLISION_DATASET=data/datasets/human-behavior-v2-snapshot-26g-20260717 \
PLACEMENT_COLLISION_REPORT=/private/tmp/placement-collision-report-run1.json \
conda run -n tetris-ml python -m jupyter nbconvert \
  --to notebook --execute \
  scripts/ml/notebooks/placement_feature_collision_analysis.ipynb \
  --output placement-collision-run1-executed.ipynb \
  --output-dir /private/tmp \
  --ExecutePreprocessor.timeout=600
```

source notebook의 code cell은 execution count와 output을 저장하지 않는다. report에는
timestamp, 저장소 절대 경로 또는 실행별 temp 이름을 넣지 않는다.

## Baseline collision 재현

분석 전에 source SHA-256과 baseline count를 hard assertion으로 검증한다.

| 항목 | 값 |
|---|---:|
| Game | 26 |
| Decision | 1,158 |
| Candidate | 39,375 |
| Selected candidate | 1,158 |
| Selected-vs-unselected pair | 38,217 |
| Zero-difference pair | 1,010 |
| Affected decision | 670 |

기존 Top-1, Top-3, MRR 등의 model metric은 다시 계산하지 않았다. 이 작업에서
baseline 동일성의 증거는 고정 snapshot checksum, 16-feature 이름·순서와 위 count다.

## Geometry 정의

board row는 위에서 아래로 증가한다. `board_height`와 `board_width`는 각 row의
`boardBefore`에서 읽으며 이 snapshot에서는 각각 20과 10이다.

### 저장된 placement identity

- `placement_row = candidatePlacement.row`
- `placement_col = candidatePlacement.col`
- `rotation = candidatePlacement.rotation`

### Candidate cell 값

- `minimum_cell_row`, `maximum_cell_row`, `mean_cell_row`
- `minimum_cell_col`, `maximum_cell_col`, `mean_cell_col`
- `row_span = maximum_cell_row - minimum_cell_row`
- `col_span = maximum_cell_col - minimum_cell_col`

### 정규화와 wall distance

- `normalized_placement_row = placement_row / (board_height - 1)`
- `normalized_placement_col = placement_col / (board_width - 1)`
- `normalized_average_cell_height = ((board_height - 1) - mean_cell_row) / (board_height - 1)`
- `left_wall_distance = minimum_cell_col`
- `right_wall_distance = (board_width - 1) - maximum_cell_col`
- `nearest_wall_distance = min(left_wall_distance, right_wall_distance)`

모든 값은 finite/type 검증을 통과한다. placement anchor는 조각 pivot이 board 밖에
있을 수 있어 `placement_row`와 `placement_col`의 전체 관측 범위에 음수가 존재한다.
occupied cell 좌표는 board 범위 안이다.

## Feature별 collision 구분 결과

`단독 기여`는 해당 pair에서 17개 후보 중 그 feature만 값이 다른 경우다. `중복
기여`는 다른 geometry도 함께 다른 경우다.

| Feature | 구분 pair | 구분 비율 | 영향 decision | 단독 기여 | 중복 기여 | 남은 pair |
|---|---:|---:|---:|---:|---:|---:|
| `rotation` | 1,010 | 100.00% | 670 | 510 | 500 | 0 |
| `placement_col` | 410 | 40.59% | 410 | 0 | 410 | 600 |
| `normalized_placement_col` | 410 | 40.59% | 410 | 0 | 410 | 600 |
| `placement_row` | 90 | 8.91% | 90 | 0 | 90 | 920 |
| `normalized_placement_row` | 90 | 8.91% | 90 | 0 | 90 | 920 |
| `minimum_cell_row` | 0 | 0.00% | 0 | 0 | 0 | 1,010 |
| `maximum_cell_row` | 0 | 0.00% | 0 | 0 | 0 | 1,010 |
| `mean_cell_row` | 0 | 0.00% | 0 | 0 | 0 | 1,010 |
| `minimum_cell_col` | 0 | 0.00% | 0 | 0 | 0 | 1,010 |
| `maximum_cell_col` | 0 | 0.00% | 0 | 0 | 0 | 1,010 |
| `mean_cell_col` | 0 | 0.00% | 0 | 0 | 0 | 1,010 |
| `row_span` | 0 | 0.00% | 0 | 0 | 0 | 1,010 |
| `col_span` | 0 | 0.00% | 0 | 0 | 0 | 1,010 |
| `normalized_average_cell_height` | 0 | 0.00% | 0 | 0 | 0 | 1,010 |
| `left_wall_distance` | 0 | 0.00% | 0 | 0 | 0 | 1,010 |
| `right_wall_distance` | 0 | 0.00% | 0 | 0 | 0 | 1,010 |
| `nearest_wall_distance` | 0 | 0.00% | 0 | 0 | 0 | 1,010 |

`normalized_placement_row/col`은 raw anchor를 scale만 바꾼 값이라 구분 pair 집합이
완전히 같다. 이 중복은 overlap 진단에 명시되며 두 값을 동시에 feature로 제안하지
않는다.

## Overlap 분석

| 비교 | Left only | 교집합 | Right only | 합집합 | 남은 pair |
|---|---:|---:|---:|---:|---:|
| placement row vs col | 90 | 0 | 410 | 500 | 510 |
| placement col vs rotation | 0 | 410 | 600 | 1,010 | 0 |
| landing-height 계열 vs col | 90 | 0 | 410 | 500 | 510 |
| wall-distance 계열 vs col | 0 | 0 | 410 | 410 | 600 |
| cell-span 계열 vs rotation | 0 | 0 | 1,010 | 1,010 | 0 |

`placement_col`의 410개는 전부 rotation이 이미 구분한다. cell span과 wall distance는
raw coordinate 차이에 추가 정보를 주지 않는다.

## Placement identity와 unresolved pair

| 판정 | Pair |
|---|---:|
| 동일 기존 placementKey | 0 |
| 동일 occupied-cell 집합 | 1,010 |
| placement row가 다름 | 90 |
| placement col이 다름 | 410 |
| rotation이 다름 | 1,010 |
| rotation/pivot identity로 구분 | 1,010 |
| physical geometry로 구분 | 0 |
| physical geometry unresolved | 1,010 |

즉 `pieceType:rotation:row:col` key는 서로 다르지만 실제 board 결과는 같다. square는
네 rotation이 같은 cell을 만들고, bar/ess/zee는 180도 대칭 rotation이 같은 cell을
만든다.

## Segmentation

### Piece type

| Piece | 전체 decision | collision decision | 비율 | Zero pair |
|---|---:|---:|---:|---:|
| `square` | 170 | 170 | 100% | 510 |
| `ess` | 173 | 173 | 100% | 173 |
| `zee` | 165 | 165 | 100% | 165 |
| `bar` | 162 | 162 | 100% | 162 |
| `eleft` | 168 | 0 | 0% | 0 |
| `eright` | 159 | 0 | 0% | 0 |
| `tree` | 161 | 0 | 0% | 0 |

collision은 rotational symmetry가 있는 네 piece에만 존재한다. square의 170
decision은 각각 같은 cell을 가진 나머지 세 rotation과 pair를 만들어 510개가 된다.

### Difficulty와 outcome

| Segment | 전체 decision | collision decision | 비율 | Zero pair |
|---|---:|---:|---:|---:|
| normal | 877 | 508 | 57.92% | 762 |
| hard | 281 | 162 | 57.65% | 248 |
| loss | 988 | 572 | 57.89% | 862 |
| winner | 170 | 98 | 57.65% | 148 |

normal/hard와 loss/winner의 collision decision 비율은 거의 같다. winner는 3게임뿐이므로
outcome 차이는 성능 또는 모집단 차이로 일반화하지 않는다. `metadata.isWinner`는 이
표의 segmentation에만 사용하며 feature/geometry/pair equality에는 사용하지 않는다.

### Game과 candidate count

- collision은 26게임 모두에서 나타난다.
- 가장 큰 game은 76 pair로 전체의 7.52%다.
- 다음 game들은 59, 58, 58, 57 pair다.
- 30~39 candidate 구간이 986 pair를 차지하지만, 이 구간은 전체 1,158 decision 중
  1,122개를 포함한다. collision decision rate는 57.93%다.
- 다른 candidate count 구간은 표본이 작아 차이를 일반화하지 않는다.

가장 흔한 rotation pair는 `1 -> 3` 474개, 다음은 `0 -> 2` 120개다. 이는
bar/ess/zee의 180도 대칭과 square의 rotation alias를 직접 보여준다.

## 단일 feature 선정 결과

선정 결과: `geometry_does_not_resolve_collision`

`rotation`은 raw separation 100%, 26게임 일관성, inference 가능성, 0~3의 안정적인
범위를 갖는다. 그러나 동일 occupied-cell placement의 표현 ID를 구분하므로 의미
설명 가능성 계약을 통과하지 못한다. placement row/col 역시 pivot alias이며 절대 위치
편향 위험이 있다. physical geometry 후보의 구분률은 모두 0%다.

따라서 `selectedFeature = null`이다. 가장 많은 pair를 구분한다는 이유만으로
`rotation`을 모델에 넣지 않는다.

## Leakage와 편향 위험

- `selectedBySource`는 selected-vs-unselected label 식별에만 사용한다.
- `metadata.isWinner`는 outcome segmentation에만 사용한다.
- `winnerPlayerId`, `heuristicBaseline.score`, 실제 Human `metadata.inputSequence`, fold
  metric과 미래 결과는 분석 값에 사용하지 않는다.
- Python post-placement simulation, T-Spin/attack/garbage 재구현을 하지 않는다.
- raw rotation을 추가하면 physical choice가 아니라 candidate representation과 Human
  입력 orientation을 모방할 위험이 있다.
- raw row/col은 pivot 정의와 board 절대 위치에 민감하며 같은 cell set에도 값이
  달라질 수 있다.

## 결정성과 원본 불변성

두 headless 실행 report의 예상 SHA-256은 다음과 같다.

```text
4428d771cec784d26b645f60582694b3863c926b290c90a0d470f58846b92fd1
```

검증 계약:

- 두 report byte-identical 및 SHA-256 동일
- 실행 notebook error/traceback 0
- source 네 파일의 실행 전후 SHA-256 동일
- report에 timestamp와 사용자 절대 경로 없음
- source notebook code cell output 비어 있음

## 다음 실험 게이트

다음 작업은 새 geometry feature나 모델 학습이 아니다. 정확한 범위는 다음과 같다.

1. decision 내부 candidate를 정렬된 occupied-cell 좌표로 equivalence class화한다.
2. 동일 cell candidate를 하나의 physical placement로 취급하는 label/ranking 계약을
   먼저 정의한다.
3. 같은 snapshot, 기존 16-feature, 동일 LOGO fold, train-only scaler,
   LogisticRegression 설정과 metric을 유지한다.
4. 기존 representation baseline과 occupied-cell grouping baseline의 candidate/pair/tie
   count 및 held-out ranking만 비교한다.
5. 새 feature, 새 estimator, 최종 trainer, production artifact, runtime/PVE 연결은
   제외한다.

이 representation gate가 통과한 뒤에도 서로 다른 occupied-cell placement 사이의
collision이 남을 때만 새로운 geometry feature 하나를 비교한다.
