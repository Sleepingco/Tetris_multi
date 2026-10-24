# AI/ML archive 안내

이 문서는 과거 AI/ML 작업을 순서대로 읽는 목차다. 완료 실험과 보류 제안을 구분한다.
이 디렉터리는 완료되었거나 현재 계약으로 대체된 AI/ML 문서를 보존한다.
실행 코드, Notebook, 계약 테스트와 현재 기준 문서는 원래 경로에 유지한다.
현재 진입점은 [AI/ML 문서와 파일 안내](../../ai-ml/README.md), 현재 프로그램 결정은
[전체 계획](../../ai-ml/strategy/ai-plan.md), 상세 실험 근거는
[실험 로그](../../ai-ml/experiments/ai-experiments-log.md)를 따른다.

## 처음부터 읽는 순서

아래 순서는 실험의 질문이 이어진 순서다. 수치·명령·데이터 checksum은 각 원문을
따른다. 과거 명령의 경로·환경·20행 엔진은 현재 checkout에서 검증 없이 재실행하지 않는다.
Notebook·result JSON은 참조를 보존하기 위해 기존 경로에 둔다.

경로 보완 (2026-10-24): Python 테스트만 `scripts/ml/tests/`로 통합했다.
아래 링크·명세의 현재 테스트 경로는 갱신했다. 원래 실행 기록의 `python_tests`
명령과 당시 checksum은 역사 증거로 보존한다.

| 순서 | 질문 → 확인한 것 → 다음 질문 | 설명·실행 근거 |
| --- | --- | --- |
| 1. Dataset 기반 | 로그를 후보 비교 데이터로 만들 수 있는가 → schema·game split 구성 → 수치 구현이 맞는가 | [연대기 Phase 0](../../ai-ml/experiments/ai-experiments-log.md#41-phase-0--placement-dataset-기반-구축), [평가 계약](../../ai-ml/contracts/placement-ml-evaluation-contract.md) |
| 2. JS/Python parity | 같은 입력에서 같은 수학인가 → 단일 fold 일치 → Python에서 전체 평가 | [연대기 Phase 1~2](../../ai-ml/experiments/ai-experiments-log.md), [ranker·parity 계약](../../ai-ml/experiments/placement-pairwise-ranker.md) |
| 3. Python LOGO | Human 선택을 예측하는가 → 13/26게임 baseline → 높은 feature 중복 원인은 무엇인가 | [Notebook 안내](experiments/placement-python-experiment-notebook.md), [Notebook](../../../scripts/ml/notebooks/placement_pairwise_logo_experiment.ipynb) |
| 4. Collision | geometry가 부족한가 → 동일 occupied-cell 표현 중복 → 물리적 후보를 묶으면 어떤가 | [분석](experiments/placement-feature-collision-analysis.md), [Notebook](../../../scripts/ml/notebooks/placement_feature_collision_analysis.ipynb) |
| 5. Cell equivalence | 동일 배치를 class로 묶으면 어떤가 → 중복 제거와 metric tradeoff 관측 → 원인 분해 | [설명·result 링크](../../ai-ml/experiments/placement-cell-equivalence-logo.md), [Notebook](../../../scripts/ml/notebooks/placement_cell_equivalence_logo_experiment.ipynb) |
| 6. Pair weight | 표현 압축과 weight 중 무엇이 영향을 줬는가 → V0~V4 단계적 분해 → 이후 cohort에서 정책 비교 | [설명·result 링크](../../ai-ml/experiments/placement-pair-weight-decomposition.md), [Notebook](../../../scripts/ml/notebooks/placement_pair_weight_decomposition_experiment.ipynb) |
| 7. V0/V4 temporal | 26게임 학습·신규 49게임에서 정책 차이는 → metric은 거의 같음, 물리적 weighting 의미로 V4 채택 | [명세·Notebook 경로](../../../ai-harness/ml-experiments/experiments/placement-temporal-holdout-v0-v4.md), [분석 기록](../../../ai-harness/runs/placement-temporal-holdout-v0-v4-analyze-result-2026-07-18.md) |
| 8. 75게임 fit | 누적 V4 학습이 안정적인가 → development checkpoint → 신규 게임 평가 필요 | [명세·Notebook 경로](../../../ai-harness/ml-experiments/experiments/placement-v4-cumulative-75g-development-fit.md), [분석 기록](../../../ai-harness/runs/placement-v4-cumulative-75g-development-fit-analyze-result-2026-07-18.md) |
| 9. Frozen 75→50 | 재학습 없이 신규 50게임에서도 모방하는가 → holdout 평가·training pool 편입 결정 → 125게임 fit | [명세·Notebook 경로](../../../ai-harness/ml-experiments/experiments/placement-v4-frozen-75g-temporal-holdout-50g.md) |
| 10. 125게임 trainer | 전체 cohort를 결정적으로 학습하는가 → candidate artifact 보존 → 추론 검증 | [명세·trainer·테스트 경로](../../../ai-harness/ml-experiments/experiments/placement-v4-125g-final-trainer.md) |
| 11. Reference·게임 연결 | 점수·안전 정책과 실행이 일치하는가 → Python reference·JS parity·실험적 PVE → gameplay 평가 | [reference 명세](../../../ai-harness/ml-experiments/experiments/placement-v4-reference-inference-safety.md), [구현 파일 안내](../../ai-ml/README.md) |
| 12. Gameplay 평가 | heuristic을 대체할 근거가 있는가 → 30×500에서 horizon 30/30 대 27/30, 기본 heuristic 유지 | [명세·Notebook·runner 경로](../../../ai-harness/ml-experiments/experiments/placement-v4-pve-gameplay-benchmark.md), [종료 기록](../../../ai-harness/runs/placement-v4-pve-gameplay-benchmark-analyze-result-2026-07-20.md) |
| 13. 이후 규칙 변경 | 40행·종료·관찰 문맥 변화 → v3 저장, 기존 V4 fallback → 새 행동 dataset 경계 필요 | [게임 규칙 구현 기록](../../gameplay/top-out-buffer-zone-plan.md), [현재 AI 계획](../../ai-ml/strategy/ai-plan.md) |

각 설명/명세 상단의 이전·다음 링크로 이어 읽을 수 있다. Reference→JS scorer→PVE는
위 11번의 구현 흐름이며, 별도 학습 실험이 실행됐다는 뜻은 아니다.

## 완료 이력과 보류 제안

- [기존 전체 roadmap 역사본](plans/placement-v4-roadmap.md): 완료 Phase와 당시
  미실행 Stage/개선 가설을 함께 보존했다. 모든 제안을 완료 실험으로 읽지 않는다.
- [신규 로그 정제·V4 재학습안](../../ai-ml/strategy/new-log-cleaning-training-plan.md):
  보류 제안이다. 정제·재학습 완료 이력이 아니다.
- [이전 대화 요약](../../ai-ml/strategy/data-cleaning-training-conversation-summary.md):
  조사 배경 자료다. 이후 v3·조작 AI 결정은 현재 계획을 따른다.
- 새 Human 조작 AI는 설계 단계이며 위 완료 실험의 metric을 새 모델 성능으로 사용하지 않는다.

## Plans

| 문서 | 원래 역할 | 종료 상태 | 관련 현재 경로 |
|---|---|---|---|
| [AI PVE plan](plans/ai-pve-plan.md) | heuristic PVE부터 ML inference까지의 초기 단계 계획 | 현재 heuristic 기본 정책, V4 candidate와 dev-only 통합으로 대체됨 | [현재 AI 계획](../../ai-ml/strategy/ai-plan.md), [heuristic 설계](../../ai-ml/strategy/heuristic-ai-design.md) |
| [Inference strategy](plans/inference-strategy.md) | browser/server/Python inference 위치를 비교한 초기 전략 | Python reference와 server-only dev opt-in 경계가 구현되어 대체됨 | [현재 AI 계획](../../ai-ml/strategy/ai-plan.md), [V4 inference 실험 명세](../../../ai-harness/ml-experiments/experiments/placement-v4-reference-inference-safety.md) |
| [ML dataset plan](plans/ml-dataset-plan.md) | placement dataset schema와 baseline을 만들기 전 수집 계획 | dataset schema v2, exporter와 평가 계약으로 대체됨 | [dataset 정책](../../ai-ml/strategy/game-log-dataset-policy.md), [평가 계약](../../ai-ml/contracts/placement-ml-evaluation-contract.md) |

## Experiments

| 문서 | 원래 역할 | 종료 상태 | 관련 실험 |
|---|---|---|---|
| [Python experiment Notebook 안내](experiments/placement-python-experiment-notebook.md) | Python-native LOGO baseline의 실행·판독 안내 | 13/26-game historical baseline으로 종료 | [baseline Notebook](../../../scripts/ml/notebooks/placement_pairwise_logo_experiment.ipynb), [실험 로그 Phase 3~4](../../ai-ml/experiments/ai-experiments-log.md) |
| [Feature collision 분석](experiments/placement-feature-collision-analysis.md) | zero-difference pair의 geometry 원인 분석 | `geometry_does_not_resolve_collision`로 종료 | [collision Notebook](../../../scripts/ml/notebooks/placement_feature_collision_analysis.ipynb), [cell-equivalence 후속 계약](../../ai-ml/experiments/placement-cell-equivalence-logo.md) |

이 archive의 문서는 당시 질문과 판단 근거를 보존하기 위한 것이다. 새 작업의
현재 요구사항이나 실행 경로를 정할 때는 archive 문서만 단독으로 사용하지 않는다.
