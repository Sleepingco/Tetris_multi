# ML Experiment: Human 배치 모델 L2 정규화 비교

## 상태·질문

- ID: `human-placement-l2-regularization`, MODE: `implement-smoke`, executionPolicy: `full-only`, program gate: `continue_experimenting`.
- 질문: 같은 보드/조각 snapshot 분류기에서 **L2 alpha만 높이면** 최종 Human 배치 정확도와 확률 예측의 과적합이 줄어드는가?
- 근거: [snapshot 기준선](human-placement-snapshot-baseline.md) run2의 board_piece는 Validation known-target NLL이6epoch에서4.110142로 최소,30epoch에서5.803012로 증가했다. 최종 Train/Validation 구간 Top-1은96.34%/13.46%다. NLL과 Top-1의 최적 epoch가 달라 이번에는 조기 종료를 함께 바꾸지 않는다.

## 비교 변수·고정 조건

- `alpha=0.0001` 재현 baseline / `0.01` / `1.0`의3조건. 앞선 결과를 본 뒤 고른 개발 가설이며 광범위 자동 탐색이 아니다. 실행 후 후보를 추가/삭제하지 않는다.
- board_piece만 사용한다. 같은207→ReLU64→softmax2133, Adam lr0.001·batch128·shuffle=True·seed1729·30회 partial_fit·BLAS1. Alpha 외 optimizer/구조/epoch/seed/label/feature를 바꾸지 않는다.
- 구간당 균등 표본, Train-only StandardScaler와2133-class 어휘, 같은 조각 내 확률 재정규화/Unicode tie-break를 유지한다. 모든 모델을30epoch까지 학습한다. best-epoch 선택·early stopping·학습률 조절·oversampling·dropout·새 feature·표현 변경은 없다.
- 모든 epoch 끝에 Train/Validation 구간 기준 known-target NLL(L2 제외)·Top-1/Top-3/MRR·분모·OOV를 기록한다. L2를 포함한 최적화 loss는 alpha 사이의 예측 성능 비교 지표로 사용하지 않는다.

## 입력·누수 경계

- 기존 immutable dataset: `data/datasets/human-placement-action-offline-v1-20261102-run1`. Train149게임/6417구간, Validation31게임/1516구간, known1364/OOV152. 기존 품질 정책·승패 무관 Human 선정·split을 바꾸지 않는다.
- Manifest SHA `9ae27fc0b85903f412b434f5667e51376e7d5bb3170d3bab3d439f0e415f28bf`, Train `535e87540b5d9983b4065df2904df5702f13aa7ba40df640f6fcb7dfa332c08c`, Validation `e2d598e4792f523e32b599b152d2adde8dd53568c6ade91af4c78a1a604a303e`.
- 입력은 boardBefore20×10 점유200+activePiece.pieceType7뿐이다. 정답은 Human selectedPlacement의 occupied-cell physical class다. 최종 activePiece pose/cells·목표·oracle·행동열·간격·boardAfter·outcome·heuristic·ID는 feature에 넣지 않는다.
- Validation은 측정 전용이며 fit/scaler/어휘/early stopping에 쓰지 않는다. OOV152는 전체 Top-1/Top-3/MRR에서 실패, NLL에서는 제외하고 분모를 명시한다. 예약 Test33 ID와 split 경계만 확인하며 Test payload/raw/rejected/DB는 읽지 않는다. 동일 Validation 반복 개발이므로 독립 최종 일반화/통계적 우월을 주장하지 않는다.
- Legacy20행 snapshot의 관측 시점/합법성/도달 가능성/현재40행 호환성은 미검증이다. 휴리스틱 목표나 Python 게임 규칙을 추가하지 않는다. 새 수집은 요구하지 않는다.

## 재사용·재현 gate

- 기존 snapshot Notebook의 SHA 고정 정의(`233ceca8322bd4335b798cdd452064d389e0ddbce6451610c7ba7d56a1dd9c5c`)를 별도 namespace에서 읽는다. 파서·feature/label·scaler·ranking/metric·출력 보호·기존 내부 검사를 재사용하며 기존 Notebook은 변경하지 않는다.
- Reference report: `data/ml-experiments/human-placement-snapshot-baseline/full-report-run2.json`, SHA `d87456bbb3d4f289db38d1bc70d8b6b8d1615f34a5bd4ddaa3f025d40f6fb19e`.
- 먼저 alpha0.0001을 학습해 reference의 board_piece 최종 metric·epoch metric·trainingLoss·scaler·어휘를 절대오차1e-12 이내에서 재현해야 다른 alpha로 진행한다. 이 검사는 새 조건의 반복 결정성/동결 검증을 대신하지 않는다.
- Alpha를 받지 않는 기존 고정 fit 함수 대신 새 Notebook에만 명시적인 sklearn 학습 loop를 둔다. 생성자 설정이 alpha 외 동일함을 내부 검사하고 metric은 공유한다. 기존 namespace/model 함수를 monkey-patch해 정규화를 바꾸지 않는다.

## 지표·판단

- Primary:30epoch의 Validation **game-macro Top-1**, secondary: game-macro Top-3/MRR·구간 known-target NLL·game별 delta.
- 진단: Train/Val epoch NLL·정확도·gap·NLL 최소 epoch(관찰 전용)·OOV/clip 수·coefficient L2 norm·scaler/어휘 동일성.
- 더 낮은 NLL만으로 성공/채택하지 않는다. 정확도/MRR와 NLL의 상충, game별 개선/악화를 함께 검토한다. 수치 threshold를 새로 정해 자동 승격하지 않고 Full 상태는 `l2_comparison_requires_review`다. 최종 candidate/best epoch/artifact는 선택/저장하지 않는다.

## Notebook·실행

- Source: [human_placement_l2_regularization.ipynb](../../../scripts/ml/notebooks/human_placement_l2_regularization.ipynb). 새 `.py`/테스트 파일·dependency 없이 내부 assert로 검사한다.
- Full-only: 작은 표본 학습/Smoke 성능 report는 없다. 기본 모두 실행은 모델 fit/data open 없는 내부 검사만 한다. Full은 총3모델×30epoch이며 이번 구현 요청에서는 실행하지 않는다.
- 3절에서 `RUN_FULL=True`, `FULL_REPORT="data/ml-experiments/human-placement-l2-regularization/full-report-run1.json"`로 설정 후 위에서부터 실행한다. 이후 결과만 볼 때는 RUN_FULL=False,4절 REPORT_TO_READ에 report 경로를 넣는다. Notebook만 실행하면 되며 Python 테스트를 먼저 실행할 필요는 없다.
- 출력은 새 JSON report뿐이다. 기존 파일/alias/symlink/hardlink를 거부하고 임시 파일+독점 게시를 재사용한다. 데이터·정의·reference SHA를 전후 비교한다. pandas 비교표·Matplotlib 곡선/게임 delta를 제공한다.
- `canonicalResultEligible=false`, `productionIntegration=false`, `inferenceEligible=false`, `wholePolicyEvidence=false`, `legalityChecked=false`, `reachableCandidatesGenerated=false`. Full1회는 개발 관측이며 새 조건의 반복 결정성은 미검증으로 남긴다.

## 허용 변경·검증·중단

- 허용: 이 명세·새 Notebook, `PLAN.md`, `change-log.md`, AI 계획·ML 안내의 현재 진입 링크. 기존 dirty/untracked 내용은 보존한다.
- 내부 검사: alpha 외 생성자 설정 동일·NumPy loss·Train-only partial_fit·epoch NLL/OOV 분모·NaN/Infinity/경고 거부·재현 비교 허용오차·출력 보호·기본 Full 비활성. 실제 dataset 로딩/전처리/기준선 report 검사는 fit 금지로 확인할 수 있다.
- 필수 `npm run verify:ml`, `bash scripts/verify.sh`. 기존 실행본 형식 실패는 보존/구분하고 새 Notebook은 내부 검사로 따로 검증한다.
- 중단: baseline drift, source/input 변경, leakage, nonfinite, warning, count/어휘 변화, 기존 출력 충돌. 실패를 metric 결과로 감추지 않는다.
- 다음 gate는 사용자 Full 결과 해석이다. 추가 alpha/epoch 조정·모델 동결·Hold·rollout·runtime·새 수집·commit/push/merge는 자동 시작하지 않는다.

## 구현·검증 기록 (2026-11-03)

- Notebook14개 cell·고유 ID·빈 output/count·기본 Full=False다. 실제 모델 fit/data open을 차단한 전체 셀 실행과 내부 assert를 통과했다. Alpha 외 생성자 설정, NumPy loss·경고/비유한 값·Train-only 업데이트·NLL/OOV·허용오차·공유 경로 보호를 확인했다.
- 실제 입력/기준선 report의 SHA·count·split·6417/1516×207 feature·2133-class·Train-only scaler 동일성을 실제 fit 금지로 확인했다. Baseline drift가 생긴 가짜 학습 결과로 run_full을 검사해 alpha0.0001 단계에서 중단되고 다른 후보를 호출하지 않음을 확인했다. 실제 기준선 수치 재현은 사용자 Full 전까지 미검증이다.
- 명시적 가짜 자료로 pandas4개 표·Matplotlib2개 figure 렌더링과 alpha 순서/zero-delta를 검사했다. 이는 성능 report가 아니다. 실제 작은 학습/Smoke report·새 Full report·가중치는 생성하지 않았다.
- `bash scripts/verify.sh`:793 pass·기존1 skip. `npm run verify:ml`: Node35 pass·Python213/220(기존 사용자 실행본5 fail·2 error)로 전체 ML gate는 보류다. 기존 source 실행본을 비우거나 검사를 약화하지 않았으며 새 Notebook은 내부 검사로 구분했다.
- 기존 snapshot Notebook·run1/run2 report·dataset·runtime·환경은 변경하지 않았다. Commit/stage/push/merge는 수행하지 않았다.
