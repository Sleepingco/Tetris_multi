# ML Experiment: Human 배치 snapshot의 보드 정보 기준선

## 질문·실행 범위

- ID: `human-placement-snapshot-baseline`, executionPolicy: `full-only`, 현재 요청: epoch별 Train/Validation loss 계측 보완. 사용자 기존 Full run1은 완료했고 새 계측 Full은 실행하지 않는다.
- 질문: 같은 조각 종류와 Train 배치 어휘에서 보드 점유 정보가 Human selectedPlacement 예측을 추가로 설명하는가?
- `piece_only` / `board_piece`는 같은207차원·Train-only scaler·MLP·표본·어휘·예산을 쓰고 보드200차원 mask 유무만 바꾼다. 별도 Smoke 학습/작은 성능 평가는 없다.
- 이것은 제한된 **snapshot 관계 탐색/닫힌 어휘 분류**다. action 직전 관측 상태·합법/도달 가능 후보·현재40행 정책으로 검증됐다고 하지 않는다. 이 한계를 보고하기 위해 새 로그 수집/일괄 replay를 선행하지 않는다.

## 고정 데이터·누수 경계

- Dataset: `data/datasets/human-placement-action-offline-v1-20261102-run1`.
- Manifest SHA `9ae27fc0b85903f412b434f5667e51376e7d5bb3170d3bab3d439f0e415f28bf`, Train SHA `535e87540b5d9983b4065df2904df5702f13aa7ba40df640f6fcb7dfa332c08c`, Validation SHA `e2d598e4792f523e32b599b152d2adde8dd53568c6ade91af4c78a1a604a303e`.
- placement_snapshot_eligible인 Train6,417구간/149게임·Validation1,516구간/31게임을 구간당1표본으로 사용한다. 조작 행 수만큼 복제하지 않는다. 품질/승패 무관 Human 정책·기존 split 유지. Test33은 예약 ID만 확인하며 Test/raw/rejected 파일을 열지 않는다.
- 입력은 boardBefore20×10의 null/비null 점유(200) + **activePiece.pieceType만** one-hot(7)이다. 색/과거 블록 종류는 점유1로 단순화한다.
- activePiece 최종 row/col/rotation/cells·selectedPlacement/목표·oracleCondition·inputSequence/간격·boardAfter·점수/heuristic·승패·game/player ID는 입력에서 제외한다. 최종 좌표가 정답을 노출하는 직접 누수를 막는다.
- 정답은 selectedPlacement에서 이미 추출한 occupied-cell physicalClassKey다. 저장 셀 형식만 기존 physical_key로 재검증한다. rotation/pivot alias는 별도 label로 만들지 않는다.
- boardBefore의 기록 시점·과거 ruleset·공격 상태는 여전히 미검증이다. 직접 정답 필드를 제거한 것을 인과적/실제 추론 정합 검증 완료로 확대하지 않는다.

## Train-only 어휘·평가 의미

- Train target key를 Unicode code-point 순서로 정렬해2133-class 어휘와 class ID를 fit한다. Validation label로 어휘를 확장하거나 label을 제거하지 않는다. 어휘 SHA·조각별 class 수·희소 class 분포를 보고한다.
- 추론 점수는 입력 조각 종류와 일치하는 **Train에서 관측한 class** 안에서만 정규화/정렬한다. 이 목록은 보드별 합법/도달 가능한 후보 목록이 아니다. 충돌·지지·경로·게임오버 검사는 추가하지 않는다. Python 게임 규칙/후보 생성/시뮬레이션을 재구현하지 않는다.
- Validation 미관측 class는 Top-1/Top-3/MRR의 전체 분모에 남기고 모두0으로 집계한다. rank는 null, OOV count/coverage와 조각별 분포를 보고한다. 미관측 조각에 class가 없으면 선택 불가로 남기고 실패로 집계한다. 다른 조각/heuristic으로 조용히 대체하지 않는다.
- 알려진 target만의 NLL·평균 rank는 별도 known-only 지표다. OOV가 있으면 전체 NLL은 지원하지 않으며 null/사유를 기록한다. 이를 전체 성능처럼 보고하지 않는다. 전체 Top-1의 닫힌 어휘 상한은 coverage다.
- 동점은 같은 piece class의 canonical key 순서로 결정한다. per-game/per-piece/전체 지표의 분모를 명시한다. 과거 V4의 후보별 rank 지표와 직접 비교하지 않는다.

## 모델·학습 예산·사전 판단

- 기존 goal-prefix Notebook 정의 SHA `12f07e2a25b35fdaedd9c3c6ed805e9b6fbb6f5b3fd236569d0363b654b051d2`의 공통 JSON/경로·physical_key·fit_head/predict_probabilities를 재사용한다. 이전 실행·Smoke 정의는 호출하지 않는다. 기존 Notebook은 변경하지 않는다.
- 공통 StandardScaler는 Train207차원만 fit. piece_only는 transform 후 보드200차원을0으로 mask하고 나머지7차원은 동일하다.
- 두 모델: 207→ReLU64→softmax2133. Adam lr0.001, L2 alpha0.0001, batch128, seed1729,30epoch partial_fit 고정·BLAS1. 구간당 균등 weight이며 Validation 튜닝/early stopping/oversampling은 없다. 정규화된 학습 loss는 수렴이나 보드별 조건부 NLL과 동일한 값이 아니다.
- 매 epoch 업데이트가 끝난 같은 모델로 Train/Validation을 추론하고 `epochMetrics`에 구간 기준 NLL·Top-1·분모/OOV를 기록한다. 두 NLL은 같은 조각 class 내 재정규화·확률 하한1e-15·L2 제외의 known-target NLL이다. Train6417개와 Validation known1364개를 비교하며, Validation OOV152개는 NLL에 억지 값을 붙이지 않는다. Top-1은 Validation1516개 전체에서 OOV를 실패로 포함한다.
- 기존 `fit_head(..., epochs=1)` 초기화/첫 업데이트 후 같은 모델에 Train-only `partial_fit`29회를 이어간다. Validation은 관찰만 하고 optimizer/scaler/어휘/조기 종료/모델 선택에 사용하지 않는다. 원래 CE+L2 `trainingLoss`는 별도 진단으로 보존한다. Report schema2는 `epochMetrics`·측정 계약·monitoring/selection 플래그를 추가한다.
- Primary: 전체 Validation을 분모로 하는 game-macro Top-1. Secondary: Top-3/MRR·known-only NLL/rank·조각/게임별 차이·coverage·class별 support. 미관측/희소 label을 점수를 위해 제거하지 않는다.
- board-minus-piece ΔTop1>1e-12, ΔMRR≥-1e-12면 `board_snapshot_signal_observed`; Top1만 개선하면 `board_snapshot_tradeoff_requires_review`; 아니면 `no_clear_board_snapshot_gain`. 탐색적 부호 판정이며 효과 크기/유의성/정책 승격 기준이 아니다.
- 모델은 실제 새 배치 좌표를 조합해 생성하지 못한다. 결과가 낮으면 희소한2133-class 어휘/작은 자료/표현 한계를 함께 해석하며 자동으로 어휘·모델·예산을 바꾸지 않는다.

## Notebook·검증·금지

- Source: `scripts/ml/notebooks/human_placement_snapshot_baseline.ipynb`. 설명/예제·공통 정의·짧은 내부 assert·Full 설정/실행·결과 로딩·pandas/Matplotlib·한계를 나눈다. 새 Python/테스트 파일·패키지는 없다.
- 기본 Full 비활성. 사용자 실행 시 RUN_FULL=True와 새 FULL_REPORT 경로를 설정한다. 기존 파일/alias/symlink/hardlink를 거부한다. dataset·정의 SHA를 전후 대조한다. 새 dataset/weights/model artifact는 저장하지 않는다.
- 내부 검사는 최종 activePiece 필드/label/outcome 변화에 대한 입력 불변·board mask·alias label·Train-only 어휘·OOV 전체 분모 유지·동점·조각 mask·known-only NLL·입력 비변경·출력 보호를 다룬다. 모델 fit을 금지한 검사이며 Smoke 성능 지표를 만들지 않는다.
- 이번 코딩 요청에서는 내부 검사·실제 dataset 로딩/어휘/feature 변환 검사만 수행하고 Full fit은 하지 않는다. 필수 verify:ml/verify.sh를 실행하며 기존 사용자 실행본 오류를 보존/구분한다.
- Full report는 `canonicalResultEligible=false`, `productionIntegration=false`, `wholePolicyEvidence=false`, `inferenceEligible=false`, `legalityChecked=false`, `reachableCandidatesGenerated=false`다. 실제 게임 정책으로 연결하지 않는다.
- 다음 gate는 사용자 Full의 board-vs-piece 결과·coverage 해석이다. controller 연결·예측 목표 rollout·Hold·새 수집·replay·runtime·commit/push/merge는 자동 시작하지 않는다.

## 사용자 run1과 epoch 계측 보완 (2026-11-03)

- 기존 사용자 Full report SHA `5082a06d90692e1075db8734aa4895366083344e3123e20e76c4eb2b6343a4be`는 보존한다. Game-macro Top-1은 piece_only0.016802→board_piece0.134209, MRR0.048225→0.231145로 보드 신호가 관측됐다. board_piece 최종 known-target NLL은5.803012로 piece_only5.539601보다 나빠 과적합/과신을 의심하되 epoch별 검증 곡선은 당시 없었다.
- 새 계측 코드는 실제 Full을 실행하지 않고 Notebook 내부 가짜 모델로 epoch 순서·Train-only 업데이트·동일 NLL 수식·OOV 분모·마지막 Validation 집계 일치를 검사한다. 기존 공통 Notebook·사용자 output/count/Full 설정·run1 report는 수정하지 않는다. 사용자 저장 출력은 이전 코드 결과라고 본문에 명시한다.
- 새 곡선은 커널 재시작 후3절 `FULL_REPORT="data/ml-experiments/human-placement-snapshot-baseline/full-report-run2.json"`처럼 새 경로로 실행해야 얻는다. 기존 가중치를 저장하지 않았으므로 과거 epoch 검증값을 사후 복원하지 않는다. 읽기 전용4절은 새 schema/정의 SHA가 맞는 report만 읽는다.
- 계측 내부 검사·Full=False 메모리 사본의 전체 셀(data open/MLP fit 차단)·가짜 자료의 epoch 표/그림3개 렌더링을 확인했다. 사용자 출력/count/Full 설정과 dataset/run1 SHA는 불변이다. `verify.sh` 최종793 pass·기존1 skip, ML Node35 pass·Python213/220(기존 실행본5 fail·2 error)로 전체 ML gate는 계속 보류다. 첫 기본 suite의 기존 TTL JSONL 읽기 테스트1회 실패는 동일 테스트 단독/전체 재실행에서 통과했으며 해당 코드는 수정하지 않았다.
- 아래 구현 상태는 최초 코드 준비 당시의 이력이다. 새 계측의 실제 과적합 시점·Full 최종 수치 재현은 사용자 재실행 전까지 미검증이다.
- 사용자 새 실행의2번째 epoch에서 `INVALID_OR_WARNED_TRAIN_STEP`이 발생했다. JSON 입력용 `finite()`가 NumPy scalar를 거부하는 타입 불일치를 가짜 모델의 `np.float64` loss로 재현했다. 학습 내부 loss 검사는 기존 공통 fit과 같은 `np.isfinite()`로 수정하고 가짜 모델도 NumPy scalar를 반환하도록 회귀 검사를 보완했다. 경고는 무시하지 않고 category/message를 포함한 `UNEXPECTED_FIT_WARNING`, 실제 NaN/Infinity는 `NONFINITE_TRAIN_LOSS`로 구분한다. 기존 JSON 경계 함수/모델/예산은 변경하지 않고 실패 출력·설정도 보존한다.
- 이 수정의 회귀 검사는 정상 float64/float32 통과·NaN/양음 Infinity 거부·경고 category/message 보존의6경우를 실제 fit 없이 확인했다. 최종 verify793 pass·기존1 skip, ML Node35 pass·Python213/220(기존 실행본5 fail·2 error)이다. 실패 run2 report는 생성되지 않아 같은 새 경로를 재사용할 수 있지만 커널 재시작/정의 재실행이 필요하다. 실제 Full 성공 여부는 재실행 전까지 미검증이다.
- 이후 사용자 재실행에서 source가 이전 `finite(model.loss_)`로 돌아온 것을 디스크에서 확인하고 같은 수정을 재적용했다. 덮어쓴 주체는 확인하지 못했으므로 편집기 autosave는 가능성으로만 남긴다. 사용자 최신 실행 출력·설정은 보존하며, Notebook에 외부 변경 후 디스크 내용 다시 불러오기→커널 재시작 순서를 명시했다. 과거 traceback 문자열은 보존된 output이고 현재 source와 구분한다.
- 재적용 직후 새 source를 디스크에서 확인했지만 같은 작업의 검증 중 다시 구버전으로 덮어써졌다. 새 내부 회귀 검사는 source 확인 단계에서 중단됐으므로 현재 수정 완료로 판정하지 않는다. 기본 verify793 pass·기존1 skip, ML 기존7개 문제와 별개로 source 안정화가 필요하다. 추가 덮어쓰기는 멈추고 사용자가 해당 편집기를 닫은 뒤 다시 반영한다.
- 이후 사용자가 파일을 닫았다고 확인한 뒤 검사를 재적용했다. 새 회귀6경우·Notebook schema/구문 검증과 verify793 pass·기존1 skip을 통과했고 suite 종료 뒤에도 디스크 source가 새 검사를 유지함을 확인했다. ML Node35 pass·Python213/220(기존 실행본5 fail·2 error)이며 사용자 최신 output/count/Full 설정은 보존했다. 현재 NumPy 검사 수정은 반영됐고 전체 ML gate/실제 Full 성공은 별도 미완료다. 다시 열기→커널 재시작→현재 run2 경로로 실행한다.

## 구현·검증 상태 (2026-11-03)

- Notebook15개 cell·명시적 입력/정답 분리·기본 비활성 Full·결과 재로딩·pandas/Matplotlib을 구현했다. 원본 output/count는 비었고 ID는 고유하다. 실제 신경망 fit·Full 평가는 하지 않았다.
- 기본 모두 실행을 data 파일 open/MLP partial_fit 금지 상태로 검사했다. 입력 누수·alias·Train-only 어휘·OOV를 포함한 전체 분모/게임평균·stable tie·조각 mask·known-only NLL·입력 비변경·출력 보호 내부 검사가 통과했다. 별도 Smoke 학습/성능 report는 없다.
- 실제 dataset의 SHA·split·feature/어휘를 읽기 전용으로 확인했다. Train6,417×207·149게임·2133-class, Validation1,516×207·31게임 중 known target1364/OOV152다. known coverage 약89.97%는 **모델 성능이 아니라 닫힌 어휘 지원 범위**다. 미관측152개를 제거하거나 어휘를 확장하지 않았다.
- `bash scripts/verify.sh`:793 pass·기존1 skip. 현재 `npm run verify:ml`: Node35 pass·Python213/220(기존 사용자 실행본5 fail·2 error)로 전체 ML gate 보류다. 격리 Git 원본 Python220/220과 새 Notebook 내부 검사를 구분하며 기존 실행본은 수정하지 않는다.
- 사용자 Full:3절 `RUN_FULL=True`, `FULL_REPORT="data/ml-experiments/human-placement-snapshot-baseline/full-report-run1.json"`로 설정한 뒤 실행/결과 셀을 실행한다. 기존 파일이 있으면 새 run 이름을 사용한다. 완료한 결과는4절 REPORT_TO_READ로 학습 없이 다시 읽는다.
- 아직 실제 Full 실행시간·대규모 출력층 학습 안정성·held-out 성능·그림 렌더링은 실행 검증하지 않았다. fit helper는 재사용했지만 해당 배치 모델의 학습 성공을 선행 주장하지 않는다. 운영/자율 배치 연결도 미검증이다.
