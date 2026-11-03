# ML Experiment: Human 배치 보드 입력의 분산 스케일링 비교

## 질문·범위

- ID: `human-placement-board-scaling`, MODE: `implement-smoke`, executionPolicy: `full-only`, program gate: `continue_experimenting`.
- 질문: 보드200차원에서 **표준편차 나눗셈만 제거**하면 같은 모델의 Human 배치 선택·확률 예측이 개선되는가?
- Baseline `standardized`:207차원 모두 `(x - Train mean) / Train scale`. Candidate `board_centered`:보드200차원만 `x - Train mean`, 조각7차원은 baseline과 완전히 동일한 표준화다. 평균 중심화는 유지하며 raw0/1 입력·새 feature를 함께 비교하지 않는다.
- 일부 희소 상단 칸의 점유1이 표준화 후46.24가 되는 것은 확인했다. 이것이 과적합의 확정 원인은 아니다. 기존 최악 NLL14.4 게임의7구간에는0행 점유가 없었으므로 해당 실패를 이 증폭으로 단정하지 않는다.

## 고정 조건·입력

- 동일 dataset `data/datasets/human-placement-action-offline-v1-20261102-run1`: Train149게임/6417구간, Validation31게임/1516구간·known1364/OOV152. 승패 무관 Human·품질/split 정책을 유지한다.
- Manifest SHA `9ae27fc0b85903f412b434f5667e51376e7d5bb3170d3bab3d439f0e415f28bf`, Train `535e87540b5d9983b4065df2904df5702f13aa7ba40df640f6fcb7dfa332c08c`, Validation `e2d598e4792f523e32b599b152d2adde8dd53568c6ade91af4c78a1a604a303e`.
- 입력은 boardBefore20×10 점유200+pieceType one-hot7, Human selectedPlacement occupied-cell class는 label 전용이다. 최종 activePiece pose/cells·oracle·행동열/간격·미래 상태/승패·ID·heuristic을 feature로 쓰지 않는다.
- Train-only StandardScaler/2133-class 어휘,207→ReLU64→softmax2133·alpha0.0001·Adam lr0.001·batch128·seed1729·30 partial_fit·BLAS1을 유지한다. 조기 종료/모델/label/구조/epoch/L2/후보 생성을 바꾸지 않는다.
- 같은 입력 조각 class 내 확률 재정규화·Unicode tie-break. OOV152는 전체 Top-1/Top-3/MRR의 실패로 남기며 NLL은 known1364개만 계산한다. 두 split NLL은 L2 제외·동일 확률 하한1e-15다.
- Validation은 fit/scaler/어휘/epoch 선택에 쓰지 않는다. 예약 Test33은 ID 경계만 확인하며 payload/raw/rejected/DB는 읽지 않는다. 기존 Test의 timing 평가 이력과 같은 Validation 반복 개발 한계를 유지한다. 새로운 독립 Test라고 부르지 않는다.

## 재사용·재현

- [L2 Notebook](../../../scripts/ml/notebooks/human_placement_l2_regularization.ipynb)의 SHA 고정 정의 `9112dedc65f7b4d5f04ef2f0107561914be53da022f7f7e51dc7e50d9ce60cbd`에서 파서·feature·학습 loop·metric·NumPy loss/경고 검사·출력 보호·내부 검사를 그대로 재사용한다. 기존 Notebook/함수 소스는 수정하지 않는다.
- Reference는 `data/ml-experiments/human-placement-l2-regularization/full-report-run1.json`, SHA `1b3d28aca7319265e8a73c06629ca2473d6dd7597b2967ccf78be5135491779e`의 `alpha_0.0001` 결과다.
- 먼저 standardized 조건의 최종 지표·전체 epoch metric·trainingLoss·coefficient norm을 reference와 절대오차1e-12 이내 재현해야 candidate로 진행한다. Scaler mean/scale·어휘 SHA도 대조한다. 실패 시 중단하고 결과로 감추지 않는다.
- 원래 fitted scale은 보존한다. report에는 variant별 effective scale을 추가 기록하며 candidate는 앞200개만1, 뒤7개는 원래 scale이다. 보드/조각의 Train·Validation 입력 최대 절댓값/p99를 진단한다.

## 지표·해석

- Primary:30epoch Validation game-macro Top-1. Secondary:game-macro Top-3/MRR·known-target NLL·game별 delta. Diagnostic:Train/Val epoch NLL/정확도·분모/OOV/clip·coefficient norm·입력값 범위.
- NLL만 낮거나 Train/Validation gap만 작다고 성공으로 판정하지 않는다. 자동 alpha/epoch 선택·후보 채택 없이 `board_scaling_comparison_requires_review`로 종료한다.
- Feature scale과 L2의 효과는 상호작용한다. alpha 숫자를 고정해도 raw 좌표의 유효 패널티가 같다는 뜻은 아니다. 결과는 전처리 변경의 효용이며 특정 픽셀이 암기를 유발했다는 단독 인과 증거가 아니다.
- 같은 Validation의 단일 seed/단일 Full 개발 실험이다. 새 조건 반복 결정성·수렴·동결/독립 일반화는 미검증이다. Legacy 관측 시점·합법/도달 가능성·현재40행 호환성 한계도 유지한다.

## 실행·검증

- Source: [human_placement_board_scaling.ipynb](../../../scripts/ml/notebooks/human_placement_board_scaling.ipynb). Notebook만 실행하며 새 Python/테스트 파일·dependency는 없다.
- Full-only:기본 모두 실행은 실제 fit/data open 없는 내부 assert뿐이다. 작은 성능 학습/Smoke report는 없다. 이번 요청에서는 Full을 실행하지 않는다.
- 3절 `RUN_FULL=True`, `FULL_REPORT="data/ml-experiments/human-placement-board-scaling/full-report-run1.json"`로 바꿔 위에서부터 실행한다. 두 조건×30epoch다.4절에서 pandas 표·Matplotlib 곡선/게임 delta를 확인한다. 저장 결과만 읽을 때는 RUN_FULL=False, REPORT_TO_READ에 경로를 넣는다.
- 기존 출력/alias/symlink/hardlink 거부·임시 파일/독점 JSON 게시·source/dataset/reference 전후 SHA 검사를 재사용한다. Report만 저장하고 weights/artifact/runtime은 만들지 않는다.
- 내부 검사는 공유 학습/경계·보드만 분산 제거·조각 완전 동일·불변성·상수 feature·비유한 값/shape/variant 거부·기준선 drift 차단을 다룬다. `npm run verify:ml`, `bash scripts/verify.sh`를 실행하고 기존 실행본 문제는 별도 보존한다.
- 허용 변경:이 명세·새 Notebook, PLAN/change-log/AI 계획·ML 안내의 현재 진입점. 기존 사용자 source/output·dataset/report·runtime·환경은 변경하지 않는다.
- `canonicalResultEligible=false`, `productionIntegration=false`, `inferenceEligible=false`, `wholePolicyEvidence=false`, `legalityChecked=false`, `reachableCandidatesGenerated=false`. 다음 gate는 사용자 Full 결과 해석이다. 새 수집·지형 feature·출력 분해·후보 랭킹·온도 보정·rollout·commit/push/merge는 자동 시작하지 않는다.

## 구현·검증 기록 (2026-11-03)

- Notebook14개 cell·고유 ID·빈 output/count·RUN_FULL=False다. 실제 data open/신경망 fit을 차단한 전체 셀 실행과 내부 assert를 통과했다. 공유 학습/경계 검사와 보드만 분산 제거·조각 동일·Train 통계/원본 불변·상수 feature·비유한 값/shape/variant 거부를 확인했다.
- 실제 입력/reference의 SHA·count·split·어휘·Train-only 전처리를 확인했다. 실제 입력의 보드 최대 절댓값은 두 split 모두46.238512→0.999532, 조각 최대값은2.533475로 같았다. 이는 입력 진단이지 성능 결과가 아니다.
- 실제 신경망 fit을 금지하고 가짜 fit 반환값으로 Full report 조립/effective scale/zero delta를 검사했다. Baseline drift 시 첫 조건에서 중단돼 candidate를 호출하지 않는 것과 고정 epoch guard도 확인했다. 실제 기준선 fit 재현은 사용자 Full 전까지 미검증이다. 가짜 결과는 메모리에서만 사용하고 JSON report로 게시하지 않았다.
- 명시적 가짜 자료로 pandas5개 표·Matplotlib2개 figure 렌더링을 확인했다. 실제 작은 학습/새 Full/가중치·dataset은 생성하지 않았다.
- `bash scripts/verify.sh`:793 pass·기존1 skip. `npm run verify:ml`: Node35 pass·Python213/220(기존 실행본5 fail·2 error)로 전체 ML gate는 보류다. 기존 사용자 실행본/테스트를 수정하거나 약화하지 않았다.
