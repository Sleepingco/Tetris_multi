# Placement pair-weight decomposition

역사 기록 · [전체 순서](../../archive/ai-ml/README.md) ·
[이전: cell equivalence](placement-cell-equivalence-logo.md) ·
[다음: V0/V4 temporal](../../../ai-harness/ml-experiments/experiments/placement-temporal-holdout-v0-v4.md).

## 목적

이 실험은 occupied-cell grouping에서 관측된 작은 physical-class MRR 하락을
새 feature나 새 모델 없이 분해한다. 이전 실험은 네 변화가 동시에 들어갔다.

1. zero-difference pair 제거
2. 남은 informative pair의 decision weight 재정규화
3. non-selected physical class의 generator multiplicity 제거
4. 같은 class의 raw row 실제 압축

이번 Notebook은 이 변화를 V0부터 V4까지 한 단계씩 적용한다. 따라서 결과는
정해진 변환 순서의 controlled decomposition이다. 순서와 무관한 인과 분해나
Shapley attribution으로 해석하면 안 된다.

## 필요한 배경

- candidate: generator가 만든 rotation/anchor 표현 하나다.
- physical placement class: piece type과 네 absolute occupied cell이 같은
  candidate의 묶음이다.
- pair: Human이 고른 candidate와 대안 candidate의 16-feature 차이다.
- decision-balanced weight: 한 placement decision이 학습 목적함수에 주는
  총 weight를 통제하는 규칙이다.
- LOGO: game 하나를 validation으로 빼고 나머지 game만 학습하는
  Leave-One-Game-Out 평가다.
- shared scaler: 한 fold의 raw train candidate에 한 번만 fit하고 모든
  variant가 같은 mean/scale을 사용한다.

## 5~10분 walkthrough

1. Notebook의 ## 7. Worked example을 먼저 본다. 19개 raw candidate가
   10개 physical class로 줄고, selected class alias 하나가 V0 weight의
   1/18을 소비하는 것을 손으로 확인한다.
2. ## 8. V0~V4 pair와 weight 생성에서 다섯 식을 비교한다. V1만 남은
   weight를 다시 1로 만들지 않는다.
3. ## 12. 26-fold LOGO에서 validation game이 scaler, pair, weight에
   들어가지 않는 assertion을 확인한다.
4. ## 13과 ## 14에서 raw metric, physical-class metric, coefficient,
   held-out candidate score, rank 변화를 구분한다.
5. ## 16~## 19에서 endpoint reproduction, ordered delta, 보류 조건,
   최종 gate를 읽는다.

가장 먼저 볼 section 세 곳은 ## 7. Worked example,
## 13. Raw-candidate와 physical-class 결과,
## 17. Attribution 결과다.

## 실행 환경

VS Code에서 저장소를 열고 Notebook 우측 상단 kernel을
Python (tetris-ml)로 선택한다. source Notebook은 output과 execution count가
비어 있으므로 Run All로 위에서 아래 순서대로 실행한다. out-of-order 실행을
전제로 하지 않는다.

필요한 환경은 다음과 같이 고정돼 있다.

- Python 3.12.13
- NumPy 2.5.1
- pandas 3.0.3
- SciPy 1.18.0
- scikit-learn 1.9.0

### Headless 실행

~~~bash
PLACEMENT_PAIR_WEIGHT_REPORT=/private/tmp/placement-pair-weight-report-run1.json \
conda run -n tetris-ml python -m jupyter nbconvert \
  --to notebook \
  --execute scripts/ml/notebooks/placement_pair_weight_decomposition_experiment.ipynb \
  --output placement-pair-weight-executed-run1.ipynb \
  --output-dir /private/tmp \
  --ExecutePreprocessor.timeout=1200
~~~

run2는 report와 executed Notebook 이름의 run1만 run2로 바꾼다.

## Snapshot checksum

상대 경로:
data/datasets/human-behavior-v2-snapshot-26g-20260717

| File | SHA-256 |
|---|---|
| manifest.json | 51027be0ebad578f2c38bb8715aa491daa8f13208e3da551a5e4a2dd08bef088 |
| train.jsonl | 85034a66373add54324a56673cb99ed5854810e4299abcaf9c195ae8cbca631e |
| validation.jsonl | 23b832d95a2057b7b29e7062286c58c68524fa8db00f00870e6076a0a846f58a |
| rejected.jsonl | 06ede14119014e2b040f8a4d62e00532ca6eecae9424b93e9cc882394db8a85f |

Notebook은 시작과 끝에 네 checksum을 다시 계산한다. live game log에서 dataset을
재생성하지 않는다.

## 고정 계약

- 26 games, 1,158 decisions, 39,375 raw candidates
- 기존 16-feature와 순서
- gameId 기준 26-fold LOGO
- fold별 raw train candidate에만 fit한 StandardScaler
- variant 사이 shared mean/scale
- LogisticRegression, lbfgs, no intercept, no class weight
- tolerance 1e-12, max iteration 10,000
- L2 0.01
- C = 1 / (원래 fold의 전체 train decision 수 × L2)
- symmetric binary sample
- canonical Unicode code-point tie-break
- raw-candidate와 physical-class metric 계산식

selectedBySource는 label 식별에만 쓴다. metadata.isWinner는 사후 diagnostic
segmentation에만 쓴다. winnerPlayerId, heuristic score, Human input sequence,
validation candidate는 feature, grouping, scaler fit, pair/weight 생성에 쓰지 않는다.

## V0~V4

| Variant | Pair row | Pair weight |
|---|---|---|
| V0 raw_baseline | selected raw 대 모든 unselected raw | 1 / raw alternatives |
| V1 drop_zero_keep_weight | V0에서 zero만 제거 | V0 weight 유지 |
| V2 drop_zero_renormalized | informative raw pair | 1 / informative raw pairs |
| V3 class_balanced_expanded | raw alias row 유지 | 1 / (K × M) |
| V4 cell_grouped | non-selected class 대표 하나 | 1 / K |

여기서 K는 non-selected physical class 수, M은 그 class의 raw alias 수다.
V3와 V4는 class-level 총 weight가 같고 row 수만 다르다.

## Worked example 결과

결정적으로 선택한 decision:
5FBD427F-1784135419893:bb3aa6ad-faa6-4b60-922c-dfe09399f9c3:37

- raw candidate: 19
- physical class: 10
- selected class multiplicity: 2
- selected class 내부 zero pair: 1
- non-selected multiplicity: [1, 2, 2, 2, 2, 2, 2, 2, 2]

| Variant | Pair | Decision weight sum |
|---|---:|---:|
| V0 | 18 | 1 |
| V1 | 17 | 17/18 = 0.944444… |
| V2 | 17 | 1 |
| V3 | 17 | 1 |
| V4 | 9 | 1 |

V0에서는 selected alias와의 zero pair가 1/18을 소비한다. V1은 그 row를
없애지만 나머지를 키우지 않는다. V2는 남은 17 pair에 weight를 다시 배분한다.
V3는 singleton class에 1/9, double class의 각 alias에 1/18을 준다.
V4는 class당 row 하나에 1/9을 주므로 V3와 같은 class-level 목적함수다.

## 정상 checkpoint

Run All 중 다음 숫자를 순서대로 확인한다.

1. source checksum 네 개 일치
2. 26 game / 1,158 decision / 39,375 candidate / selected 1,158
3. 26,403 physical class / removed alias 12,972
4. V0 pair 38,217 / zero 1,010
5. V4 pair 25,245 / physical pairless decision 2
6. 모든 variant 26/26 convergence / leakage 0
7. V0 raw baseline과 V4 class-grouped endpoint reproduction 통과
8. V0↔V1, V3↔V4 physical rank change 0
9. source checksum 실행 후에도 일치

## Pair와 weight 결과

| Variant | Retained pair | Pairless | Symmetric sample | Weight total | Unit-weight decision |
|---|---:|---:|---:|---:|---:|
| V0 | 38,217 | 0 | 76,434 | 1,158.000000 | 1,158 |
| V1 | 37,207 | 2 | 74,414 | 1,126.140848 | 488 |
| V2 | 37,207 | 2 | 74,414 | 1,156.000000 | 1,156 |
| V3 | 37,207 | 2 | 74,414 | 1,156.000000 | 1,156 |
| V4 | 25,245 | 2 | 50,490 | 1,156.000000 | 1,156 |

V1의 represented decision weight min/max는 0.888888…/1.0이다. 나머지
represented decision의 min/max는 모두 1.0이다.

## Metric 읽는 법

Physical-class metric이 primary diagnostic이다.

| Variant | Class Top-1 | Top-3 | Micro MRR | Macro MRR | Mean rank |
|---|---:|---:|---:|---:|---:|
| V0 | 659 | 1,013 | 0.727805 | 0.703260 | 2.082902 |
| V1 | 659 | 1,013 | 0.727805 | 0.703260 | 2.082902 |
| V2 | 658 | 1,013 | 0.727084 | 0.702426 | 2.084629 |
| V3 | 657 | 1,013 | 0.726652 | 0.702139 | 2.085492 |
| V4 | 657 | 1,013 | 0.726652 | 0.702139 | 2.085492 |

Raw-candidate metric은 이전 결과와의 연속성을 위한 secondary metric이다.

| Variant | Raw Top-1 | Top-3 | MRR | Mean rank |
|---|---:|---:|---:|---:|
| V0 | 561 | 886 | 0.645290 | 2.961140 |
| V1 | 561 | 886 | 0.645290 | 2.961140 |
| V2 | 560 | 885 | 0.644451 | 2.963731 |
| V3 | 559 | 884 | 0.643760 | 2.967185 |
| V4 | 559 | 884 | 0.643760 | 2.967185 |

Candidate metric과 class metric은 rank 공간이 다르므로 숫자를 직접 같은 의미로
비교하지 않는다.

## Controlled attribution

| Ordered effect | Micro class MRR delta | Macro class MRR delta |
|---|---:|---:|
| V1−V0 zero-sample | 0 | 0 |
| V2−V1 informative-mass renormalization | -0.0007210023 | -0.0008342553 |
| V3−V2 generator-multiplicity | -0.0004317789 | -0.0002870264 |
| V4−V3 row-compression | 0 | 0 |
| V4−V0 total | -0.0011527812 | -0.0011212818 |

이 순서에서 Micro total의 약 62.5%는 informative-mass renormalization,
약 37.5%는 generator-multiplicity 변경에서 발생했다. Macro 기준은 각각
약 74.4%, 25.6%다. zero row 제거와 실제 row 압축은 held-out rank/metric을
바꾸지 않았다.

상태는 pair_weight_tradeoff_explained, 프로그램 gate는
continue_experimenting이다. 이는 representation freeze 승인이 아니다.

## 흔한 실패와 원인

- SOURCE_SNAPSHOT_MUTATED: snapshot checksum이 달라졌다. live log에서 다시
  만들지 말고 올바른 immutable snapshot을 복원한다.
- SCHEMA_MISMATCH/NON_HUMAN_SOURCE: exporter 계약이 다른 dataset이다.
- selected count 실패: decision grouping 또는 label schema가 달라졌다.
- equivalence result mismatch: 같은 occupied cells에 저장된 즉시 결과가
  모순된다. 학습하지 않는다.
- convergence warning: max iteration을 임의로 늘려 결과를 숨기지 말고 fold,
  pair, weight를 점검한다.
- V0/V4 mismatch: attribution을 중단하고 baseline 구현부터 비교한다.
- V3/V4 mismatch: optimizer 차이라고 단정하지 말고 pair identity, symmetric
  sample, class 총 weight를 먼저 검사한다.

## 안전하게 바꿔볼 값

학습 흐름을 이해하기 위한 별도 복사본에서는 display 행 수, 표 정렬, 출력
소수 자릿수처럼 계산 의미를 바꾸지 않는 값을 조정할 수 있다. 새로운 weighting
정책, feature, scaler, estimator, C, fold는 별도 실험 카드 없이 바꾸지 않는다.

## 변경하면 안 되는 leakage 값

- selectedBySource를 feature로 사용
- metadata.isWinner 또는 winnerPlayerId를 feature/grouping에 사용
- heuristic score나 Human input sequence 사용
- validation candidate로 scaler fit
- validation decision으로 pair 또는 weight 계산
- 전체 dataset 선행 fit
- fold metric으로 grouping/feature 선택

## byte 결정성 확인

같은 platform에서 다음을 실행한다.

~~~bash
cmp -s /private/tmp/placement-pair-weight-report-run1.json \
  /private/tmp/placement-pair-weight-report-run2.json
shasum -a 256 /private/tmp/placement-pair-weight-report-run1.json \
  /private/tmp/placement-pair-weight-report-run2.json
~~~

run1/run2 report가 byte-identical일 때만 canonical result를
docs/placement-pair-weight-decomposition-result.json에 보존한다.

이번 Phase 8 canonical report SHA-256:

e05a75d578f4d97781b03725eef65c57fee790f27ba9e941c404621386c080bd

다른 platform에서는 BLAS와 floating-point reduction 순서가 달라 byte가 다를
수 있다. 이때 integer count와 rank는 exact로, 공개 metric은 문서의 자릿수로,
coefficient/score는 Notebook에 명시한 종류별 tolerance로 비교한다.

## 한계와 다음 gate

26게임뿐이며 winner game은 3개뿐이다. winner 성능은 참고 segment일 뿐 별도
성능 결론을 내리지 않는다. Offline ranking은 gameplay 성능이나 승률을 증명하지
않는다. 다음 gate는 representation을 freeze하는 것이 아니라, 같은 고정 계약에서
어떤 weighting policy가 의도에 맞는지 결정하고 더 큰 snapshot에서 재검증하는
것이다. Production model, runtime, PVE 연결은 계속 보류한다.
