# ML Experiment: 배치 목표 조건에 따른 사람 조작·리듬 예측

## 질문·범위

- ID: `human-goal-conditioned-prefix`, MODE: `implement-smoke`.
- 같은 관측 prefix에 Human 배치 목표를 추가하면 다음 행동과 간격 분포 예측이 달라지는가?
- 비교: `prefix_only` / `oracle_goal_prefix`. 공통 적격 교집합·행 순서·전처리·모델·학습량은 같고 목표 입력만 zero-mask/활성화한다.
- Notebook 하나와 내부 assert만 추가한다. 기존 Notebook·원본·dataset·runtime·의존성·Git 상태는 변경하지 않는다. 실제 Full 학습은 사용자 실행 전까지 비활성이다.
- 이 명세는 **실제/가상 fit 전에** 고정한다. 신경망은 이 질문의 작은 실험 후보이며 최종 구조 채택이 아니다.

## 고정 데이터

- `data/datasets/human-placement-action-offline-v1-20261102-run1`.
- Manifest SHA: `9ae27fc0b85903f412b434f5667e51376e7d5bb3170d3bab3d439f0e415f28bf`.
- Train SHA: `535e87540b5d9983b4065df2904df5702f13aa7ba40df640f6fcb7dfa332c08c`.
- Validation SHA: `e2d598e4792f523e32b599b152d2adde8dd53568c6ade91af4c78a1a604a303e`.
- `offline-use-v1`, `quality-policy-v1`, 기존 game split 유지. Test는 manifest의 예약 ID만 확인하며 파일/payload를 열지 않는다. raw·rejected 파일도 학습에 열지 않는다.
- 공통 표본은 placement/control/oracle eligible이 모두 true인 구간이다. Train 6,417구간/149게임, Validation 1,516구간/31게임. 행동 정답 47,537/11,691개, 시간 정답 41,120/10,175개를 고정한다.
- 첫 행동은 BOS로 행동 loss에 포함하되 첫 시간 null은 시간 fit/평가에서 제외한다. 실제 0ms는 보존한다. Hold·선택 셀 범위 오류의 새 보정/추정은 하지 않는다.

## 입력·구조·학습 예산

- 고정 여섯 행동 순서: hard_drop, move_left, move_right, rotate, rotate_ccw, soft_drop.
- Prefix 86차원: 최근 8개 행동의 PAD/BOS 포함 one-hot(64), 지금까지 관측한 행동별 log1p 횟수(6), 최근 8개 관측 간격 log1p 값과 존재 mask(16). 긴 이력의 순서는 최근 8개까지만 보지만 누적 행동 횟수는 보존한다. 전체 미래 길이/진행률은 없다.
- Goal 15차원: pieceType one-hot(7), 정렬된 네 occupied cell의 row/19·col/9(8). alias rotation/pivot ID는 쓰지 않는다. 이 조건은 **조각 종류+목표 셀 묶음**이므로 개선을 목표 좌표 단독 효과로 해석하지 않는다.
- Board/activePiece snapshot·승패·game/player ID·다음 행동·미래 간격은 입력에 넣지 않는다. Goal은 oracle 진단 조건이지 Human 배치 예측 모델의 입력이 아니다.
- Train 행동 표본만으로 공통 StandardScaler fit. 같은 101차원에서 `prefix_only`는 표준화 후 goal 15차원을 0으로 마스킹한다. Validation은 transform/평가만 한다.
- 각 variant는 독립된 `MLPClassifier` 두 개: 101 → ReLU 64 → 행동 softmax 6, 101 → ReLU 64 → 시간 support softmax K. 공유 encoder/GRU/자율 실행 모델이 아니다.
- 시간 support는 Train 양의 간격의 15개 등간격 분위수에서 nearest 관측값을 택하고 중복 제거한 값 + 0이다(K≤16). 원시 시간은 보존하며 학습 class만 가장 가까운 support로 매핑한다(동률은 낮은 값). CE 학습이며 시간 회귀/CRPS 직접 최적화가 아니다. support 양자화 오차를 Train에서 보고한다.
- 행동·시간 loss는 각각 cross-entropy. Adam, lr=0.001, L2 alpha=0.0001, batch=min(128,해당 Train 수), shuffle=true, seed=1729/1730.
- Full 30 epoch 고정 `partial_fit`, 가상 Smoke 3 epoch. patience/early stopping/Validation checkpoint 선택/튜닝/재가중치/다운샘플링 없음. 표본별 균등 weight, 두 비교군은 같은 epoch·행 순서·seed·batch 규칙을 쓴다.
- 두 출력은 조건부 독립 근사다. 행동별 다른 시간 생성까지 검증한 joint 생성 모델로 부르지 않는다. 시간 예측에 실제 다음 행동을 주지 않는다.
- 기존 NumPy/scikit-learn만 사용하며 BLAS thread 1로 실행한다. 새 패키지/GPU 전환은 없다. 환경 버전은 고정된 environment-ml.yml과 대조한다.
- API 근거: [공식 MLPClassifier](https://scikit-learn.org/stable/modules/generated/sklearn.neural_network.MLPClassifier.html). 실제 설치된 1.9.0의 signature도 확인했으며 문서 최신 patch에 맞춘 업그레이드는 하지 않는다.

## 평가·사전 해석 규칙

- Primary: Validation game-macro 행동 NLL(낮을수록 좋음). softmax 확률의 수치 log 하한 1e-15를 공통 적용하고 clip 수를 보고한다.
- Secondary: 고정 6-class macro F1·accuracy, 행동별 precision/recall/F1/true/predicted support, confusion matrix, game별 차이. 드문 반시계 회전은 Validation support 부재를 표시하며 제거하지 않는다.
- 시간: 원래 ms 정답으로 예측 discrete 분포의 정확한 CRPS, 평균 예측값 MAE, 0ms 확률/Brier를 계산한다. BOS는 시간 분모에서 제외한다. 시간 분포 support가 제한돼 긴 tail 표현에 한계가 있다.
- Train epoch별 CE+L2 loss는 최적화 진단이다. 예산 종료는 수렴 증명이 아니며 정규화가 없는 Validation NLL과 수치를 그대로 동일시하지 않는다. Validation은 마지막 epoch에서만 평가하며 train→validation 일반화/과적합 여부를 구분한다.
- Oracle-minus-prefix ΔNLL < -1e-12, ΔF1 ≥ -1e-12, ΔCRPS ≤ 1e-9이면 `oracle_goal_signal_observed`; NLL만 개선하면 `goal_tradeoff_requires_review`; 아니면 `no_clear_goal_gain`. 이는 탐색적인 부호 비교일 뿐 효과 크기/유의성/채택 기준이 아니다. Smoke의 판정은 `smoke_only_no_policy_decision`이다.
- 과거 joint/B3와는 공통 표본·BOS 포함·feature가 달라 점수 차이를 모델 개선으로 직접 해석하지 않는다. 이번 두 비교군의 같은 표본 비교만 사용한다.
- 어느 결과에서도 자동 구조 채택·Human 배치 모델 대체·production 승격·runtime 실행을 하지 않는다. Human prefix+정답 목표를 준 teacher-forced one-step 평가이며 예측 목표/자체 rollout은 별도다.

## 실행·검증·산출물

- Notebook: `scripts/ml/notebooks/human_goal_conditioned_prefix.ipynb`.
- 공통 정의 → 가상 Smoke 설정/실행/결과 → 기본 비활성 Full 설정/실행/결과 → 한계/다음 gate. pandas·Matplotlib 사용. 별도 Python/테스트 파일을 만들지 않는다.
- 기본 모두 실행은 가상 자료뿐이다. Full은 별도 승인 후 `RUN_FULL=True`와 새 `FULL_REPORT` JSON 경로를 설정한다. 기존 report/alias/symlink/hardlink는 재사용할 수 없다. Full 실제 cohort를 확인한 경우에만 `policyDecisionEligible=true`(위 질문의 탐색 판단만)이며 `canonicalResultEligible=false`, `productionIntegration=false`, `wholePolicyEvidence=false`다.
- 내부 검사: input/label 분리·prefix mask·goal alias·시간 null/0·Train-only scaler/support·game split·희소 class·CRPS brute-force·동일 seed/구조·exclusive output·기본 real-data open 차단. 가상 headless 2회 byte 일치와 필수 verify:ml/verify.sh·source/기존 사용자 파일 불변을 확인한다.
- Full은 report/표/그래프만 게시한다. weights/model artifact·pickle·새 dataset은 만들지 않는다. 원본 snapshot과 고정 dataset은 덮어쓰지 않는다.
- 다음 gate: 사용자 Full 결과에서 행동별/게임별 목표 조건 효과와 시간 tradeoff를 해석한다. 이 요청에서 Human 배치 fit·Hold·신규 수집·replay·실행 통합은 시작하지 않는다.

## 구현·검증 상태 (2026-11-02)

- Notebook 18개 cell·내부 assert·기본 비활성 Full 구현. 실제 데이터 fit은 미실행이다. 기본 모두 실행의 real-data open 차단과 source output/count·고유 ID 검사를 적용한다.
- 최종 가상 headless 2회 byte-identical SHA `ef7c98e57130a6fb9b0313e25be49a164296fb8d54dbf175738cc3c54d4158a9`, 각 error0·Matplotlib 그림1개다. 임시 가상 증거는 `/private/tmp/human-goal-prefix-final-6fQHoV/`에 있으며 source/유일한 연구 보관소가 아니다.
- 실제 dataset은 모델 partial_fit을 금지한 상태로 읽기 전용 로딩 검사만 했다. 공통 Train/Validation 6,417/1,516구간·47,537/11,691행·시간41,120/10,175개·101개 feature·고정 파일 SHA·game split을 확인했다. 실제 신경망 Full을 실행한 것이 아니다.
- 필수 프로젝트 verify는 793 pass·기존1 skip. 현재 verify:ml은 Node35 pass·Python213/220(기존 사용자 실행본의 output/Full 설정에 따른5 fail·2 error)로 전체 gate 보류다. 사용자 실행본을 지우거나 검사를 약화하지 않는다. Git HEAD 원본의 기존 Python 검사는 격리 cwd에서220/220이며 새 Notebook의 가상/내부 검증과 구분한다.
- 사용자 Full: 4절에서 `RUN_FULL=True`, `FULL_REPORT="data/ml-experiments/human-goal-conditioned-prefix/full-report-run1.json"`로 설정하고 실행/결과 셀을 실행한다. report가 이미 있으면 새 run 이름을 사용한다. 이 명세 구현은 해당 Full 실행의 자동 승인이 아니다.

## 사용자 Full 해석·후속 (2026-11-03)

- 사용자 Full은 `oracle_goal_signal_observed`, report SHA `d4a5ef0101fb0c6796894c4143a98af3f67aa91eaf9e15ba5180dc1c6ac6284d`다. 목표 묶음 추가로 game-macro NLL1.105671→0.796889, accuracy0.505657→0.667455, F1 0.333499→0.480830, CRPS45.140807→44.571386ms였다. NLL/F1은31게임 모두 개선했다.
- 이후 [정보 분리 실험](human-goal-information-ablation.md)을 사용자 Full-only 승인으로 실행했다. 조각 종류만 제공한 중간 대조군보다 목표 셀까지 제공한 조건이 추가 개선돼 `goal_cells_additional_signal_observed`다. 기존 두 조건은 재현됐으며 원본 Notebook/report는 변경하지 않았다.
- 이 절 이후 위 과거 실행 방법은 재현 기록이다. 같은 질문의 자동 재학습/새 수집/프로덕션 연결을 하지 않는다. 두 실험 모두 oracle 목표와 Human prefix의 one-step 진단이며, Human 배치 모델/예측 목표 기반 실행은 별도 남아 있다.
