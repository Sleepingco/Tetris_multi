# AI/ML 문서와 파일 안내

이 문서는 placement AI 관련 파일을 찾는 단일 진입점이다. 파일을 이동하거나
역할을 바꾸지 않고, 현재 재사용할 경로와 과거 실험 근거를 구분한다.

현재 프로그램 상태는 `imitation_only_not_gameplay_ready`다. V4는 Human
placement imitation과 offline 분석에만 유지하며, PVE/production 기본 정책은
heuristic이다. 자세한 현재 계획은 [ai-plan.md](ai-plan.md), 실험 수치와
명령은 [ai-experiments-log.md](ai-experiments-log.md)를 본다.

## 권장 읽기 순서

1. [ai-plan.md](ai-plan.md)에서 현재 정책과 금지된 승격 범위를 확인한다.
2. 로그와 dataset 경계: [logService.js](../src/server/services/logService.js),
   [gameLogValidator.js](../src/server/validators/gameLogValidator.js),
   [export-placement-dataset.js](../scripts/export-placement-dataset.js).
3. candidate/feature/metric 계약: [placementDatasetBuilder.js](../src/client/game/ai/dataset/placementDatasetBuilder.js),
   [placementFeatureSchema.js](../src/client/game/ai/dataset/placementFeatureSchema.js),
   [placement-ml-evaluation-contract.md](placement-ml-evaluation-contract.md).
4. 기본 gameplay 정책: [heuristicEvaluator.js](../src/client/game/ai/heuristic/heuristicEvaluator.js),
   [reachablePlacementPlanner.js](../src/client/game/ai/heuristic/reachablePlacementPlanner.js).
5. V4 artifact와 reference: [train_placement_v4.py](../scripts/ml/train_placement_v4.py),
   [placement_v4_reference_inference.py](../scripts/ml/placement_v4_reference_inference.py).
6. dev-only runtime 경계: [placementV4OfflineScorer.js](../src/client/game/ai/ml/placementV4OfflineScorer.js),
   [placementV4PveDecisionAdapter.js](../src/client/game/ai/ml/placementV4PveDecisionAdapter.js),
   [pveAiPlayerService.js](../src/server/services/pveAiPlayerService.js).
7. 마지막으로 historical evidence와 run record를 읽어 현재 정책의 근거를 확인한다.

## Current / reusable

| 역할 | 입력 | 출력 | 재사용 | 실제 경로 |
|---|---|---|---|---|
| 로그 수집·검증 | server placement event | append-only placement log, schema rejection | 예 | [logService.js](../src/server/services/logService.js), [gameLogValidator.js](../src/server/validators/gameLogValidator.js), [placementLogAnalysis.js](../src/client/game/ai/heuristic/placementLogAnalysis.js) |
| Dataset exporter와 builder | JSONL game events | train/validation/rejected JSONL와 manifest, in-memory dataset | 예 | [export-placement-dataset.js](../scripts/export-placement-dataset.js), [placementDatasetBuilder.js](../src/client/game/ai/dataset/placementDatasetBuilder.js), [game-log-dataset-policy.md](game-log-dataset-policy.md) |
| Feature·decision·metric 계약 | dataset candidate/decision | 16-feature vector, selected contract, ranking metric | 예 | [placementFeatureSchema.js](../src/client/game/ai/dataset/placementFeatureSchema.js), [placementDecisionGroups.js](../src/client/game/ai/dataset/placementDecisionGroups.js), [placementRankingEvaluator.js](../src/client/game/ai/dataset/placementRankingEvaluator.js), [placement-ml-evaluation-contract.md](placement-ml-evaluation-contract.md) |
| Heuristic 기본 정책 | board와 active piece | reachable placement ranking과 plan | 예, production 기본 | [heuristicEvaluator.js](../src/client/game/ai/heuristic/heuristicEvaluator.js), [reachablePlacementPlanner.js](../src/client/game/ai/heuristic/reachablePlacementPlanner.js), [simulatePlacement.js](../src/client/game/ai/heuristic/simulatePlacement.js) |
| V4 trainer | immutable 125-game dataset | non-canonical candidate model과 training report | 예, 재학습은 새 승인 필요 | [train_placement_v4.py](../scripts/ml/train_placement_v4.py), [placement-v4-125g-final-trainer.md](../ai-harness/ml-experiments/experiments/placement-v4-125g-final-trainer.md) |
| V4 reference inference·safety | frozen model과 candidate fixture | deterministic physical-class ranking, game-over safety diagnostic | 예, Python reference | [placement_v4_reference_inference.py](../scripts/ml/placement_v4_reference_inference.py), [placement-v4-reference-inference-safety.md](../ai-harness/ml-experiments/experiments/placement-v4-reference-inference-safety.md) |
| Runtime scorer·adapter | existing heuristic evaluations와 optional V4 model | V4 decision 또는 explicit heuristic fallback | 예, dev-only opt-in | [placementV4OfflineScorer.js](../src/client/game/ai/ml/placementV4OfflineScorer.js), [placementV4PveDecisionAdapter.js](../src/client/game/ai/ml/placementV4PveDecisionAdapter.js), [pveAiPlayerService.js](../src/server/services/pveAiPlayerService.js) |
| Gameplay benchmark runner | frozen model, deterministic 7-bag stream | canonical gameplay report와 non-canonical timing report | 예, evaluation only | [run-placement-v4-pve-gameplay-benchmark.js](../scripts/run-placement-v4-pve-gameplay-benchmark.js) |
| 공통 experiment harness | experiment spec과 MODE | smoke/full/analyze-result workflow와 run record | 예 | [ml-experiments README](../ai-harness/ml-experiments/README.md), [constraints](../ai-harness/ml-experiments/constraints.md), [workflow](../ai-harness/ml-experiments/workflow.md), [verification](../ai-harness/ml-experiments/verification.md) |

`PVE_PLACEMENT_V4_MODEL_PATH`가 비어 있으면 [pveAiPlayerService.js](../src/server/services/pveAiPlayerService.js)는
V4 module을 load하지 않고 heuristic만 사용한다. Gameplay evaluation 종료 결정은
이 기본값을 바꾸지 않는다.

## Historical evidence

아래 파일은 현재 runtime의 의존성이 아니라, 현재 V4 representation·weighting과
production 보류 결론을 설명하는 근거다. 새 실험은 같은 질문을 다시 시작하지
않고 current/reusable 계약을 사용한다.

| 근거 | 입력 | 출력 | 현재 재사용 | 실제 경로 |
|---|---|---|---|---|
| 초기 Python LOGO | 13/26-game Human snapshot | baseline LOGO metric과 Python-native notebook 계약 | 역사적 baseline | [placement_pairwise_logo_experiment.ipynb](../scripts/ml/notebooks/placement_pairwise_logo_experiment.ipynb), [placement-python-experiment-notebook.md](placement-python-experiment-notebook.md) |
| Feature collision | 26-game snapshot | zero-difference/feature collision 원인 | 진단 근거 | [placement_feature_collision_analysis.ipynb](../scripts/ml/notebooks/placement_feature_collision_analysis.ipynb), [placement-feature-collision-analysis.md](placement-feature-collision-analysis.md) |
| Cell equivalence | 26-game snapshot | occupied-cell physical class 계약과 canonical result | representation 근거 | [placement_cell_equivalence_logo_experiment.ipynb](../scripts/ml/notebooks/placement_cell_equivalence_logo_experiment.ipynb), [placement-cell-equivalence-logo.md](placement-cell-equivalence-logo.md), [result JSON](placement-cell-equivalence-logo-result.json) |
| Pair-weight decomposition | 26-game snapshot | V0–V4 controlled decomposition과 V4 선택 근거 | weighting 근거 | [placement_pair_weight_decomposition_experiment.ipynb](../scripts/ml/notebooks/placement_pair_weight_decomposition_experiment.ipynb), [placement-pair-weight-decomposition.md](placement-pair-weight-decomposition.md), [result JSON](placement-pair-weight-decomposition-result.json) |
| V0/V4 temporal holdout | time-ordered 75-game cohort | V4 adoption evidence for imitation | historical evaluation | [temporal notebook](../scripts/ml/notebooks/placement_temporal_holdout_v0_v4_experiment.ipynb), [spec](../ai-harness/ml-experiments/experiments/placement-temporal-holdout-v0-v4.md), [run record](../ai-harness/runs/placement-temporal-holdout-v0-v4-analyze-result-2026-07-18.md) |
| 75-game development fit | cumulative 75-game dataset | development-only scaler/coefficient checkpoint | historical fit checkpoint | [development notebook](../scripts/ml/notebooks/placement_v4_cumulative_75g_development_fit.ipynb), [spec](../ai-harness/ml-experiments/experiments/placement-v4-cumulative-75g-development-fit.md), [run record](../ai-harness/runs/placement-v4-cumulative-75g-development-fit-analyze-result-2026-07-18.md) |
| 75→50 frozen holdout | frozen 75-game checkpoint와 50-game later cohort | held-out imitation evidence | historical evaluation | [frozen notebook](../scripts/ml/notebooks/placement_v4_frozen_75g_temporal_holdout_50g.ipynb), [spec](../ai-harness/ml-experiments/experiments/placement-v4-frozen-75g-temporal-holdout-50g.md) |
| V4 gameplay evaluation | 30 deterministic 7-bag streams와 frozen 125-game artifact | survival screening, board diagnostics, keep-heuristic decision | closed evidence | [gameplay benchmark notebook](../scripts/ml/notebooks/placement_v4_pve_gameplay_benchmark.ipynb), [benchmark spec](../ai-harness/ml-experiments/experiments/placement-v4-pve-gameplay-benchmark.md), [run record](../ai-harness/runs/placement-v4-pve-gameplay-benchmark-analyze-result-2026-07-20.md) |
| JS↔Python parity | dataset/parity bundle | feature, scaler, pair, weight, ranking equivalence | 역사적 hardening 경로이며 현재 `verify:ml` 회귀 검증에도 사용 | [export-placement-parity-bundle.js](../scripts/export-placement-parity-bundle.js), [placement_pairwise_parity.py](../scripts/ml/placement_pairwise_parity.py), [placement-pairwise-ranker.md](placement-pairwise-ranker.md), [verify-ml.sh](../scripts/verify-ml.sh) |

## Local ignored evidence

이 경로들은 Git source가 아니라 실행 증거 또는 원본 데이터다. 링크가 가리키는
파일은 환경마다 없을 수 있으므로, 없으면 재생성·복구 권한을 먼저 확인한다.

| 역할 | 입력 | 출력 또는 보관물 | 재사용 | 실제 상대 경로 |
|---|---|---|---|---|
| Live game logs | main gameplay/server event | append-only JSONL source | 읽기 전용, AI worktree에는 없음 | main worktree `../Tetris_multi/data/logs/` (`game-events.jsonl`) |
| Immutable datasets | exporter input log | versioned train/validation/rejected/manifest snapshot | 승인된 snapshot만 읽기 | `data/datasets/` |
| Full experiment evidence | user-run report/notebook | ignored copied full reports와 timing evidence | analysis only | `data/ml-experiments/` |
| Candidate artifacts | frozen trainer output | model.json과 training report | reference/dev-only only | `data/models/` |
| Temporary execution output | notebook/runner commands | smoke/full report, executed notebook, comparison scratch files | durable source 아님 | `/private/tmp` |

`/private/tmp`는 repository-relative Markdown link가 될 수 없으므로 절대 경로를
텍스트로만 기록한다. 장기 분석에 필요한 full report는 `data/ml-experiments/`의
ignored copy와 SHA-256로 추적한다.

## 현재 결정과 다음 작업

- V4 125-game candidate artifact, reference inference safety, dev-only PVE integration은 완료됐다.
- V4 gameplay evaluation은 종료됐고, `imitation_only_not_gameplay_ready`다.
- Production 기본 정책은 `keep_heuristic_default`다.
- `canonicalArtifact=false`, `productionIntegration=false`를 유지한다.
- 현재 활성 실험은 없다. 새 feature, hybrid, 재학습, 100-stream 확장은 이 문서만으로 시작하지 않는다.

다음 작업이 필요해지면 먼저 [ai-plan.md](ai-plan.md)의 현재 상태와 해당
experiment spec 또는 새 승인 문서를 갱신한다.
