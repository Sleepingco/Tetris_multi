# Placement cell-equivalence LOGO experiment

역사 기록 · [전체 순서](../../archive/ai-ml/README.md) ·
[이전: collision](../../archive/ai-ml/experiments/placement-feature-collision-analysis.md) ·
[다음: pair-weight 분해](placement-pair-weight-decomposition.md).

## 왜 이 실험을 하는가

Placement generator는 rotation이나 pivot 표현이 달라도 같은 네 칸을 차지하는 candidate를 여러 개 만들 수 있다. 기존 pairwise baseline은 selected candidate를 모든 unselected candidate와 비교하므로, selected와 물리적으로 같은 alias도 negative pair가 되고 generator의 중복 생성 횟수가 decision의 학습 구성에 영향을 준다.

이 실험은 feature나 estimator를 바꾸지 않는다. **pair 생성 단위만 raw candidate에서 occupied-cell physical class로 바꾸고**, 두 모델이 fold별 raw train candidate 전체에 fit한 같은 scaler를 공유하도록 통제한다.

## 필요한 배경 개념

- candidate는 generator 표현 하나이고 physical placement는 실제 occupied-cell 집합이다.
- equivalence class는 같은 decision에서 piece type과 정렬된 절대 occupied cells가 같은 candidate 묶음이다.
- pairwise 학습은 selected feature에서 alternative feature를 뺀 벡터를 학습한다.
- symmetric sample은 차이와 부호를 뒤집은 차이를 label 1/0으로 함께 넣는다.
- decision-balanced weight는 학습 가능한 한 decision의 sample weight 합을 1로 만든다.
- LOGO는 game 하나 전체를 validation으로 남겨 decision leakage를 막는다.

## Notebook 권장 읽기 순서

처음 확인할 세 곳은 다음이다.

1. **7. 실제 duplicate decision worked example**: candidate와 physical class의 차이를 표로 본다.
2. **10. LOGO와 shared scaler 설명**: validation 배제와 두 모델의 scaler 공유를 확인한다.
3. **14. 2×2 평가**: model representation과 evaluation unit을 분리해 결과를 읽는다.

그 전에 1절의 실험 카드와 3절의 snapshot gate를 반드시 통과해야 한다. 15~16절은 수치 진단과 제한된 결론이다.

## 5~10분 walkthrough

1. 0~3절을 실행해 용어, 환경, 네 checksum, 26 game/1,158 decision/39,375 candidate를 확인한다.
2. 4~5절에서 16-feature와 실제 한 candidate pair의 raw/scaled 차이를 본다.
3. 6~8절에서 label-free equivalence key, deterministic duplicate example, class 내부 즉시 결과 일관성을 확인한다.
4. 9절에서 candidate가 class로 얼마나 압축되는지와 3 winner game 제한을 확인한다.
5. 10~13절에서 한 fold의 shared scaler, 두 pair representation, symmetric weight, class rank 계산을 따라간다.
6. 14~16절에서 26-fold 2×2 metric, paired delta, coefficient 차이, 최종 gate를 읽는다.

## VS Code에서 실행

1. 사용자별 절대 경로를 문서에 기록하지 않고 현재 AI worktree를 연다.
2. `scripts/ml/notebooks/placement_cell_equivalence_logo_experiment.ipynb`를 연다.
3. 우측 상단 kernel에서 `Python (tetris-ml)`을 선택한다.
4. `Restart Kernel and Run All Cells`를 사용한다. 중간 cell만 재실행하지 않는다.

환경은 다음으로 준비된 것을 전제로 한다.

```bash
conda env update -n tetris-ml -f environment-ml.yml --prune
conda run -n tetris-ml python -m ipykernel install --user --name tetris-ml --display-name "Python (tetris-ml)"
```

## Headless 실행

```bash
PLACEMENT_CELL_EQUIVALENCE_REPORT=/private/tmp/placement-cell-equivalence-logo-report.json \
  conda run -n tetris-ml jupyter nbconvert \
  --to notebook --execute \
  --ExecutePreprocessor.timeout=1200 \
  --output /private/tmp/placement-cell-equivalence-logo-executed.ipynb \
  scripts/ml/notebooks/placement_cell_equivalence_logo_experiment.ipynb
```

Source Notebook의 output과 execution count는 비어 있어야 한다. 실행 output은 `/private/tmp`의 executed copy에서만 확인한다.

## Dataset snapshot과 checksum

Project-relative snapshot은 `data/datasets/human-behavior-v2-snapshot-26g-20260717`이다.

| 파일 | SHA-256 |
|---|---|
| manifest.json | `51027be0ebad578f2c38bb8715aa491daa8f13208e3da551a5e4a2dd08bef088` |
| train.jsonl | `85034a66373add54324a56673cb99ed5854810e4299abcaf9c195ae8cbca631e` |
| validation.jsonl | `23b832d95a2057b7b29e7062286c58c68524fa8db00f00870e6076a0a846f58a` |
| rejected.jsonl | `06ede14119014e2b040f8a4d62e00532ca6eecae9424b93e9cc882394db8a85f` |

다르면 live log에서 재생성하지 말고 중단한다.

## 정상 실행 checkpoint

- Snapshot: 26 game, 1,158 decision, 39,375 candidate, selected 1,158, original split leakage 0.
- Baseline: Top-1 561, Top-3 886, tie-aware Top-1 659, MRR 0.645290, mean rank 2.961140(각 6자리 반올림).
- Equivalence: 26,403 class, alias 12,972 제거, duplicate decision 670.
- Pair: baseline 38,217, grouped 25,245, grouped zero-difference 0.
- LOGO: 26/26 fold 두 모델 수렴, game leakage 0, 모든 fold raw train candidate scaler 공유.
- Result: temp report와 `docs/ai-ml/experiments/results/placement-cell-equivalence-logo-result.json` payload가 동일.

## Metric 읽는 법

- Primary는 baseline/grouped 모델의 **physical-class micro MRR와 macro MRR** 비교다.
- micro는 모든 held-out decision을 합친 값이고 macro는 26 fold metric의 단순 평균이다.
- class Top-1/Top-3/mean rank/tie-aware Top-1은 secondary class metric이다.
- raw candidate metric은 기존 기준선 호환용이다. class metric과 분모/rank 공간이 다르므로 직접 같은 의미로 비교하지 않는다.
- canonical tie-break는 Unicode code-point 순서이며 legacy raw Top-1에 영향을 줄 수 있다.
- winner game은 3개뿐이므로 승패 segment로 독립 성능 결론을 내리지 않는다.

## 흔한 실패와 원인

- checksum mismatch: 고정 snapshot이 바뀌었거나 다른 경로를 열었다.
- environment mismatch: `tetris-ml`이 아닌 kernel이거나 dependency 버전이 다르다.
- equivalence contract failure: 같은 occupied cells 안에서 feature/즉시 결과가 불일치한다. 학습을 진행하면 안 된다.
- baseline reproduction failure: 정렬, feature 순서, scaler scope, C, weight, metric이 바뀌었다.
- convergence failure: estimator 설정이나 데이터 계약이 달라졌다. warning을 숨기지 않는다.
- nondeterministic report: platform/정렬/serialization이 달라졌거나 실행별 값이 report에 들어갔다.

## 안전하게 변경해볼 값

다음 실험에서 한 번에 하나만 별도 실험 카드로 변경할 수 있다.

- class 대표 선택 방식(단, class feature 동일성 assertion 유지)
- scaler를 class 분포에 fit하는 별도 scaler-canonicalization 실험
- multiplicity 제거와 decision/pair weight 효과를 분리하는 weight 실험
- report 출력 경로와 Notebook display 행 수

이번 baseline 비교의 snapshot, feature, estimator, l2, C, tie-break를 바꾸면 같은 실험이 아니다.

## 변경하면 안 되는 leakage 값

`selectedBySource`는 label/class 식별 이외에 쓰지 않는다. `metadata.isWinner`는 evaluation segmentation 전용이다. `winnerPlayerId`, heuristic score, Human input sequence, validation candidate, fold metric은 scaler/feature/grouping/model에 넣지 않는다. 전체 데이터에 scaler를 먼저 fit하지 않는다.

## 결정성 확인

같은 platform에서 두 번 headless 실행해 report를 다른 `/private/tmp` 경로로 쓰고 비교한다.

```bash
cmp -s /private/tmp/placement-cell-equivalence-logo-report-run1.json \
       /private/tmp/placement-cell-equivalence-logo-report-run2.json
shasum -a 256 /private/tmp/placement-cell-equivalence-logo-report-run1.json \
               /private/tmp/placement-cell-equivalence-logo-report-run2.json \
               docs/placement-cell-equivalence-logo-result.json
```

같은 platform에서는 byte-identical을 요구한다. 다른 BLAS/libc/platform에서는 optimizer의 마지막 부동소수점이 달라질 수 있으므로 source checksum과 계약을 먼저 확인하고 metric은 명시된 tolerance/6자리 baseline gate로 비교한다. 다른 platform의 JSON byte가 다르다는 사실만으로 representation 결과를 판단하지 않는다.

## 결과가 의미하지 않는 것

이 실험은 고정 snapshot의 Human choice imitation representation 비교다. gameplay 승률, 실시간 PVE 성능, production 일반화, causality를 증명하지 않는다. 최종 trainer나 production model도 생성하지 않는다.
