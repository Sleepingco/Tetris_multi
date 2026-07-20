# AI/ML archive 안내

이 디렉터리는 완료되었거나 현재 계약으로 대체된 AI/ML 문서만 보존한다.
실행 코드, Notebook, 계약 테스트와 현재 기준 문서는 원래 경로에 유지한다.
현재 진입점은 [AI/ML 문서와 파일 안내](../../README.md), 현재 프로그램 결정은
[전체 계획](../../ai-plan.md), 상세 실험 근거는
[실험 로그](../../ai-experiments-log.md)를 따른다.

## Plans

| 문서 | 원래 역할 | 종료 상태 | 관련 현재 경로 |
|---|---|---|---|
| [AI PVE plan](plans/ai-pve-plan.md) | heuristic PVE부터 ML inference까지의 초기 단계 계획 | 현재 heuristic 기본 정책, V4 candidate와 dev-only 통합으로 대체됨 | [현재 AI 계획](../../ai-plan.md), [heuristic 설계](../../heuristic-ai-design.md) |
| [Inference strategy](plans/inference-strategy.md) | browser/server/Python inference 위치를 비교한 초기 전략 | Python reference와 server-only dev opt-in 경계가 구현되어 대체됨 | [현재 AI 계획](../../ai-plan.md), [V4 inference 실험 명세](../../../ai-harness/ml-experiments/experiments/placement-v4-reference-inference-safety.md) |
| [ML dataset plan](plans/ml-dataset-plan.md) | placement dataset schema와 baseline을 만들기 전 수집 계획 | dataset schema v2, exporter와 평가 계약으로 대체됨 | [dataset 정책](../../game-log-dataset-policy.md), [평가 계약](../../placement-ml-evaluation-contract.md) |

## Experiments

| 문서 | 원래 역할 | 종료 상태 | 관련 실험 |
|---|---|---|---|
| [Python experiment Notebook 안내](experiments/placement-python-experiment-notebook.md) | Python-native LOGO baseline의 실행·판독 안내 | 13/26-game historical baseline으로 종료 | [baseline Notebook](../../../scripts/ml/notebooks/placement_pairwise_logo_experiment.ipynb), [실험 로그 Phase 3~4](../../ai-experiments-log.md) |
| [Feature collision 분석](experiments/placement-feature-collision-analysis.md) | zero-difference pair의 geometry 원인 분석 | `geometry_does_not_resolve_collision`로 종료 | [collision Notebook](../../../scripts/ml/notebooks/placement_feature_collision_analysis.ipynb), [cell-equivalence 후속 계약](../../placement-cell-equivalence-logo.md) |

이 archive의 문서는 당시 질문과 판단 근거를 보존하기 위한 것이다. 새 작업의
현재 요구사항이나 실행 경로를 정할 때는 archive 문서만 단독으로 사용하지 않는다.
