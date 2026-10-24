# AI/ML 문서와 파일 안내

이 문서는 placement AI와 Human 조작 AI 관련 파일을 찾는 단일 진입점이다. 실행 코드와 Notebook
경로는 유지하면서 현재 재사용할 경로와 과거 실험 근거를 구분한다. 종료되거나
대체되어 이동한 문서는 [AI/ML archive와 시간순 목차](../archive/ai-ml/README.md)에서 찾는다.

실험·Python 검사는 [scripts/ml 안내](../../scripts/ml/README.md) 아래의 `notebooks/`,
`tests/`, `tests/fixtures/`로 묶었다. CLI는 같은 부모의 `.py` 파일이다.

기존 V4 연구의 결론은 `imitation_only_not_gameplay_ready`다. 현재 40행
`buffer20-v1`에서 V4 선택은 호환 불가 사유를 표시하고 heuristic으로 fallback한다.
새 Human 조작 AI는 데이터 full 적합성 감사를 완료했고 모델 학습은 시작하지 않았다.
기록 간격 분석과 상태 조건부 행동·hold 학습의 미검증 범위를 구분하며,
[full 결과 기록](../../ai-harness/runs/human-action-data-readiness-analyze-result-2026-10-24.md)을 따른다.
자세한 현재 계획은 [ai-plan.md](strategy/ai-plan.md), 과거 수치와 명령은
[실험 로그](experiments/ai-experiments-log.md), 프로젝트 구현·운영은 [PLAN.md](../../PLAN.md)를 본다.

## 권장 읽기 순서

1. [ai-plan.md](strategy/ai-plan.md)에서 현재 정책과 금지된 승격 범위를 확인한다.
2. 로그와 dataset 경계: [logService.ts](../../src/server/services/logService.ts),
   [gameLogValidator.ts](../../src/server/validators/gameLogValidator.ts),
   [export-placement-dataset.js](../../scripts/export-placement-dataset.js).
3. candidate/feature/metric 계약: [placementDatasetBuilder.ts](../../src/client/game/ai/dataset/placementDatasetBuilder.ts),
   [placementFeatureSchema.ts](../../src/client/game/ai/dataset/placementFeatureSchema.ts),
   [placement-ml-evaluation-contract.md](contracts/placement-ml-evaluation-contract.md).
4. 기본 gameplay 정책: [heuristicEvaluator.ts](../../src/client/game/ai/heuristic/heuristicEvaluator.ts),
   [reachablePlacementPlanner.ts](../../src/client/game/ai/heuristic/reachablePlacementPlanner.ts).
5. V4 artifact와 reference: [train_placement_v4.py](../../scripts/ml/train_placement_v4.py),
   [placement_v4_reference_inference.py](../../scripts/ml/placement_v4_reference_inference.py).
6. 기존 V4 runtime 경계와 ruleset guard: [placementV4OfflineScorer.ts](../../src/client/game/ai/ml/placementV4OfflineScorer.ts),
   [placementV4PveDecisionAdapter.ts](../../src/client/game/ai/ml/placementV4PveDecisionAdapter.ts),
   [pveAiPlayerService.ts](../../src/server/services/pveAiPlayerService.ts).
7. 마지막으로 historical evidence와 run record를 읽어 현재 정책의 근거를 확인한다.

과거를 공부하려면 [처음부터 읽는 실험 순서](../archive/ai-ml/README.md#처음부터-읽는-순서)를
먼저 연다. 새 작업은 [Human 조작 dataset 설계](contracts/human-action-dataset.md)와
[첫 데이터 적합성 명세](../../ai-harness/ml-experiments/experiments/human-action-data-readiness.md)를 읽는다.
아래 reusable은 구성 요소의 참고 가치이며 새 ruleset·학습 과제에 무조건 호환된다는 뜻이 아니다.

## Current / reusable

| 역할 | 입력 | 출력 | 재사용 | 실제 경로 |
|---|---|---|---|---|
| 로그 수집·검증 | server placement event | append-only placement log, schema rejection | 예 | [logService.ts](../../src/server/services/logService.ts), [gameLogValidator.ts](../../src/server/validators/gameLogValidator.ts), [placementLogAnalysis.ts](../../src/client/game/ai/heuristic/placementLogAnalysis.ts) |
| Dataset exporter와 builder | JSONL game events | train/validation/rejected JSONL와 manifest, in-memory dataset | 예 | [export-placement-dataset.js](../../scripts/export-placement-dataset.js), [placementDatasetBuilder.ts](../../src/client/game/ai/dataset/placementDatasetBuilder.ts), [game-log-dataset-policy.md](strategy/game-log-dataset-policy.md) |
| Feature·decision·metric 계약 | dataset candidate/decision | 16-feature vector, selected contract, ranking metric | 예 | [placementFeatureSchema.ts](../../src/client/game/ai/dataset/placementFeatureSchema.ts), [placementDecisionGroups.ts](../../src/client/game/ai/dataset/placementDecisionGroups.ts), [placementRankingEvaluator.ts](../../src/client/game/ai/dataset/placementRankingEvaluator.ts), [placement-ml-evaluation-contract.md](contracts/placement-ml-evaluation-contract.md) |
| Heuristic 기본 정책 | board와 active piece | reachable placement ranking과 plan | 예, production 기본 | [heuristicEvaluator.ts](../../src/client/game/ai/heuristic/heuristicEvaluator.ts), [reachablePlacementPlanner.ts](../../src/client/game/ai/heuristic/reachablePlacementPlanner.ts), [simulatePlacement.ts](../../src/client/game/ai/heuristic/simulatePlacement.ts) |
| V4 trainer | immutable 125-game dataset | non-canonical candidate model과 training report | 예, 재학습은 새 승인 필요 | [train_placement_v4.py](../../scripts/ml/train_placement_v4.py), [placement-v4-125g-final-trainer.md](../../ai-harness/ml-experiments/experiments/placement-v4-125g-final-trainer.md) |
| V4 reference inference·safety | frozen model과 candidate fixture | deterministic physical-class ranking, game-over safety diagnostic | 예, Python reference | [placement_v4_reference_inference.py](../../scripts/ml/placement_v4_reference_inference.py), [placement-v4-reference-inference-safety.md](../../ai-harness/ml-experiments/experiments/placement-v4-reference-inference-safety.md) |
| Experimental PVE runtime | existing heuristic evaluations와 server-owned V4 model | 사용자 opt-in V4 decision 또는 explicit heuristic fallback | 예, 실험 기능 | [placementV4OfflineScorer.ts](../../src/client/game/ai/ml/placementV4OfflineScorer.ts), [placementV4PveDecisionAdapter.ts](../../src/client/game/ai/ml/placementV4PveDecisionAdapter.ts), [pveAiPlayerService.ts](../../src/server/services/pveAiPlayerService.ts), [experimental model](../../src/server/assets/placement-v4-125g-experimental-model.json) |
| Gameplay benchmark runner | frozen model, deterministic 7-bag stream | canonical gameplay report와 non-canonical timing report | 예, evaluation only | [run-placement-v4-pve-gameplay-benchmark.js](../../scripts/run-placement-v4-pve-gameplay-benchmark.js) |
| 공통 experiment harness | experiment spec과 MODE | smoke/full/analyze-result workflow와 run record | 예 | [ml-experiments README](../../ai-harness/ml-experiments/README.md), [constraints](../../ai-harness/ml-experiments/constraints.md), [workflow](../../ai-harness/ml-experiments/workflow.md), [verification](../../ai-harness/ml-experiments/verification.md) |

사용자가 로비에서 Experimental PVE를 명시적으로 선택했을 때만
[pveAiPlayerService.ts](../../src/server/services/pveAiPlayerService.ts)가 V4 경로를
load한다. 모델 경로는 검토된 server-owned asset을 기본으로 사용하며,
`PVE_PLACEMENT_V4_MODEL_PATH`는 같은 SHA의 검증 artifact 위치만 바꾸는 override다.
Heuristic을 선택하거나 PVP를 실행하면 V4 module과 model을 load하지 않는다. 실제
사용 policy는 match에 보존해 게임 페이지 진입 시 다시 전달하며, game-over log에는
마지막 사용 policy, fallback 횟수·사유와 model SHA를 남긴다.

위 흐름은 지원되는 기존 규칙의 V4 경로다. 현재 buffer20-v1은 모델 로드 전에
ruleset guard가 fallback을 선택한다. UI의 Experimental 선택과 실제 V4 추론을 구분한다.
기존 placement exporter/builder도 v3/40행을 거부하며 새 행동 dataset 생성기는 아직 없다.

## Historical evidence

아래 파일은 현재 runtime의 의존성이 아니라, 현재 V4 representation·weighting과
production 보류 결론을 설명하는 근거다. 새 실험은 같은 질문을 다시 시작하지
않고 current/reusable 계약을 사용한다.

| 근거 | 입력 | 출력 | 현재 재사용 | 실제 경로 |
|---|---|---|---|---|
| 초기 Python LOGO | 13/26-game Human snapshot | baseline LOGO metric과 Python-native notebook 계약 | 역사적 baseline | [placement_pairwise_logo_experiment.ipynb](../../scripts/ml/notebooks/placement_pairwise_logo_experiment.ipynb), [archived Notebook 안내](../archive/ai-ml/experiments/placement-python-experiment-notebook.md) |
| Feature collision | 26-game snapshot | zero-difference/feature collision 원인 | 진단 근거 | [placement_feature_collision_analysis.ipynb](../../scripts/ml/notebooks/placement_feature_collision_analysis.ipynb), [archived 분석 문서](../archive/ai-ml/experiments/placement-feature-collision-analysis.md) |
| Cell equivalence | 26-game snapshot | occupied-cell physical class 계약과 canonical result | representation 근거 | [placement_cell_equivalence_logo_experiment.ipynb](../../scripts/ml/notebooks/placement_cell_equivalence_logo_experiment.ipynb), [placement-cell-equivalence-logo.md](experiments/placement-cell-equivalence-logo.md), [result JSON](experiments/results/placement-cell-equivalence-logo-result.json) |
| Pair-weight decomposition | 26-game snapshot | V0–V4 controlled decomposition과 V4 선택 근거 | weighting 근거 | [placement_pair_weight_decomposition_experiment.ipynb](../../scripts/ml/notebooks/placement_pair_weight_decomposition_experiment.ipynb), [placement-pair-weight-decomposition.md](experiments/placement-pair-weight-decomposition.md), [result JSON](experiments/results/placement-pair-weight-decomposition-result.json) |
| V0/V4 temporal holdout | time-ordered 75-game cohort | V4 adoption evidence for imitation | historical evaluation | [temporal notebook](../../scripts/ml/notebooks/placement_temporal_holdout_v0_v4_experiment.ipynb), [spec](../../ai-harness/ml-experiments/experiments/placement-temporal-holdout-v0-v4.md), [run record](../../ai-harness/runs/placement-temporal-holdout-v0-v4-analyze-result-2026-07-18.md) |
| 75-game development fit | cumulative 75-game dataset | development-only scaler/coefficient checkpoint | historical fit checkpoint | [development notebook](../../scripts/ml/notebooks/placement_v4_cumulative_75g_development_fit.ipynb), [spec](../../ai-harness/ml-experiments/experiments/placement-v4-cumulative-75g-development-fit.md), [run record](../../ai-harness/runs/placement-v4-cumulative-75g-development-fit-analyze-result-2026-07-18.md) |
| 75→50 frozen holdout | frozen 75-game checkpoint와 50-game later cohort | held-out imitation evidence | historical evaluation | [frozen notebook](../../scripts/ml/notebooks/placement_v4_frozen_75g_temporal_holdout_50g.ipynb), [spec](../../ai-harness/ml-experiments/experiments/placement-v4-frozen-75g-temporal-holdout-50g.md) |
| V4 gameplay evaluation | 30 deterministic 7-bag streams와 frozen 125-game artifact | survival screening, board diagnostics, keep-heuristic decision | closed evidence | [gameplay benchmark notebook](../../scripts/ml/notebooks/placement_v4_pve_gameplay_benchmark.ipynb), [benchmark spec](../../ai-harness/ml-experiments/experiments/placement-v4-pve-gameplay-benchmark.md), [run record](../../ai-harness/runs/placement-v4-pve-gameplay-benchmark-analyze-result-2026-07-20.md) |
| JS↔Python parity | dataset/parity bundle | feature, scaler, pair, weight, ranking equivalence | 역사적 hardening 경로이며 현재 `verify:ml` 회귀 검증에도 사용 | [export-placement-parity-bundle.js](../../scripts/export-placement-parity-bundle.js), [placement_pairwise_parity.py](../../scripts/ml/placement_pairwise_parity.py), [placement-pairwise-ranker.md](experiments/placement-pairwise-ranker.md), [verify-ml.sh](../../scripts/verify-ml.sh) |

## Local ignored evidence

이 경로들은 Git source가 아니라 실행 증거 또는 원본 데이터다. 링크가 가리키는
파일은 환경마다 없을 수 있으므로, 없으면 재생성·복구 권한을 먼저 확인한다.

| 역할 | 입력 | 출력 또는 보관물 | 재사용 | 실제 상대 경로 |
|---|---|---|---|---|
| Local game logs / production export | local gameplay 또는 DB export | JSONL source | 원본 읽기 전용, 실제 경로는 실행 때 확인 | `data/logs/`, `data/datasets/`의 raw export. 운영은 PostgreSQL single-sink |
| Immutable datasets | exporter input log | versioned train/validation/rejected/manifest snapshot | 승인된 snapshot만 읽기 | `data/datasets/` |
| Full experiment evidence | user-run report/notebook | ignored copied full reports와 timing evidence | analysis only | `data/ml-experiments/` |
| Candidate artifacts | frozen trainer output | model.json과 training report | reference/dev-only only | `data/models/` |
| Temporary execution output | notebook/runner commands | smoke/full report, executed notebook, comparison scratch files | durable source 아님 | `/private/tmp` |

`/private/tmp`는 repository-relative Markdown link가 될 수 없으므로 절대 경로를
텍스트로만 기록한다. 장기 분석에 필요한 full report는 `data/ml-experiments/`의
ignored copy와 SHA-256로 추적한다.

## 기존 V4 결정과 새 작업

- V4 125-game candidate artifact, reference inference safety, dev-only PVE integration은 완료됐다.
- 사용자 선택형 Experimental PVE demo는 완료됐으며 현재 40행 규칙에서는 명시적 heuristic fallback을 표시한다.
- V4 gameplay evaluation은 종료됐고, `imitation_only_not_gameplay_ready`다.
- Production 기본 정책은 `keep_heuristic_default`다.
- `canonicalArtifact=false`, `productionIntegration=false`를 유지한다.
- 새 Human 조작 AI는 설계 단계다. 데이터 적합성 명세가 있으며 구현·full 실행·배포는 아직 수행하지 않았다.

다음 작업이 필요해지면 먼저 [ai-plan.md](strategy/ai-plan.md)의 현재 상태와 해당
experiment spec 또는 새 승인 문서를 갱신한다.
