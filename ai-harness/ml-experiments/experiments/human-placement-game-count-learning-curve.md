# ML Experiment: Human 배치 학습 게임 수별 학습곡선

## 질문·실행 범위

- ID: `human-placement-game-count-learning-curve`, MODE: `implement-smoke`, executionPolicy: `full-only`, program gate: `continue_experimenting`.
- 질문: 기존 Train 게임 수가 늘면 현재 배치 분류 pipeline의 Validation 성능이 개선되는가? 새 정답을 학습해 coverage가 늘어난 효과와 공통 배치 예측력 변화를 구분한다.
- 별도 Smoke 학습은 없다.25/50/75/100%는 정식 비교 조건이며 모두 정해진 업데이트 예산을 끝까지 사용한다. 이번 요청에서는 코드/검사만 수행하고 실제 신경망 학습은 하지 않는다.

## 고정 입력·조건

- Dataset `data/datasets/human-placement-action-offline-v1-20261102-run1`: 전체 Train149게임/6417구간, 고정 Validation31게임/1516구간. 기존 품질·Human 선정·split·Hold 보류는 유지한다. Test33 ID 경계만 확인하고 payload/raw/rejected/DB는 읽지 않는다. 신규 수집은 요구하지 않는다.
- Manifest SHA `9ae27fc0b85903f412b434f5667e51376e7d5bb3170d3bab3d439f0e415f28bf`, Train `535e87540b5d9983b4065df2904df5702f13aa7ba40df640f6fcb7dfa332c08c`, Validation `e2d598e4792f523e32b599b152d2adde8dd53568c6ade91af4c78a1a604a303e`.
- 입력은 boardBefore20×10 점유200+pieceType7, 정답은 Human selectedPlacement physical class다. 최종 pose/cells·oracle·행동열/시간·미래 상태/승패·ID·heuristic은 feature로 쓰지 않는다.
- 원래 StandardScaler 표준화를 사용한다. 같은 MLP hidden64·alpha0.0001·Adam lr0.001·batch128·shuffle=True·seed1729·BLAS1·동일 ranking/tie-break를 유지한다. 평균 중심화 후보/새 feature/출력 분해/early stopping/추가 alpha는 섞지 않는다.

## 게임 부분집합·학습 예산

- 전체 Train gameId를 `SHA256("human-placement-games-v1|" + gameId)`와 Unicode gameId 순서로 정렬한다. 앞 ceil(149×비율)개를 사용해38/75/112/149게임의 중첩 집합을 만든다. 승패/Validation/label 성능을 보고 순서를 바꾸지 않는다. 같은 PVP 게임의 양쪽 Human은 분리하지 않는다.
- 각 subset의 scaler/어휘는 해당 subset Train만으로 fit한다. 어휘가 늘면 출력 class 수/파라미터 수도 달라진다. 이를 기록하고, 이 실험을 고정 출력층의 순수 표본 복잡도 증명으로 해석하지 않는다.
- 예산은 전체 Train의 기존30회 partial_fit에 해당하는 `ceil(6417/128)×30=1530` optimizer 업데이트다. 모든 subset에 같은 예산을 적용한다. 전체 pass를 반복하고 남은 업데이트만큼은 별도 RNG seed1729로 고른 중복 없는 행을 한 partial_fit에 넣는다. 마지막 부분 호출은128배수 행이며 작은 batch 경고를 피한다.
- full-pass 마지막 batch는128보다 작을 수 있다. 동일 업데이트 수가 동일 행 노출량/시간/파라미터 계산량을 뜻하지 않는다. full pass 수·부분 pass 행 수·행 노출량·부분 호출 수·표본당 평균 노출을 기록한다. model.t_로 실제 행 노출량도 대조한다.
- Full 실행 순서는100% 기준선 재현→25/50/75%다.100%는 기존30 full pass이며 최종 지표/Train NLL·trainingLoss/coef norm·scaler/어휘를 reference와1e-12 이내 대조한다. 실패하면 작은 조건을 학습하지 않는다.

## 평가 범위 세 가지

- Primary `validationAll`: 동일1516구간 전체의 game-macro Top-1. OOV는 실패, known NLL은 지원 정답만으로 계산하므로 크기별 분모가 다름을 명시한다. game-macro Top-3/MRR·OOV/coverage도 보고한다.
- 공통 어휘는 네 subset의 **Train 어휘 교집합**으로만 정한다. 이 어휘의 정답을 가진 Validation 구간을 평가용으로 선택하며 모든 조건의 segment ID SHA·구간/게임 수가 같아야 한다. 이 선택은 fit/부분집합 선택에 쓰지 않는다.
- `validationCommonFullVocabulary`: 같은 공통 정답 구간을 각 모델의 전체 어휘로 순위화한다. 정답 coverage 차이는 제거되지만 경쟁 class 수는 다르다.
- `validationCommonProjection`: 같은 공통 정답 구간에서 확률 열도 공통 어휘로 제한/재정규화한다. 평가 정답/경쟁 class 공간을 고정한 낙관적 진단이며 전체 성능으로 바꾸어 보고하지 않는다. Train에서도 같은 projection NLL/정확도를 계산하되 Train 평가 행은 subset마다 다름을 명시한다.
- fit은 Train-only이며 Validation/scaler/어휘/업데이트 예산 선택 누수는 금지한다. 공통 평가도 Validation label을 학습 입력/후보 생성에 넣지 않는다. 모든 지표에 분모를 기록하고 공통 scope가 비면 중단한다.

## 재사용·출력·판단

- [L2 Notebook](../../../scripts/ml/notebooks/human_placement_l2_regularization.ipynb)의 정의 SHA `9112dedc65f7b4d5f04ef2f0107561914be53da022f7f7e51dc7e50d9ce60cbd`에서 parser/feature/model/ranking/metric/path/검사를 재사용한다. 고정 업데이트 스케줄과 공통 projection만 새 Notebook에 작성한다. 기존 source/출력은 변경하지 않는다.
- Reference `data/ml-experiments/human-placement-l2-regularization/full-report-run1.json`, SHA `1b3d28aca7319265e8a73c06629ca2473d6dd7597b2967ccf78be5135491779e`의 alpha0.0001 baseline.
- Report에는 selected gameIds·순서 seed·subset counts·어휘 SHA/크기·공통 scope SHA·scaler 통계·예산·Train/Val final metrics를 기록한다. 실제 weights/artifact·새 dataset은 저장하지 않는다. source/reference/dataset SHA를 전후 비교하고 기존 경로/alias/symlink/hardlink 덮어쓰기를 거부한다.
- `learning_curve_requires_review`로 종료하고 자동 데이터량/모델 채택·추가 게임 수 추정은 하지 않는다. 하나의 중첩 표본 순서/모델 seed·반복 관측한 Validation이므로 불확실성이 남는다. 공동 어휘/출력 차원/평가 경쟁 공간과 마지막 batch·노출량 차이가 있어 단독 인과/독립 일반화 주장이 아니다.

## Notebook·검증·다음 gate

- Source: [human_placement_game_count_learning_curve.ipynb](../../../scripts/ml/notebooks/human_placement_game_count_learning_curve.ipynb). 새 Python/테스트 파일·dependency 없이 내부 assert·pandas/Matplotlib을 사용한다.
- 기본 RUN_FULL=False다.3절 RUN_FULL=True와 `FULL_REPORT="data/ml-experiments/human-placement-game-count-learning-curve/full-report-run1.json"`로 전체 실행한다. 결과만 읽을 때 RUN_FULL=False와4절 REPORT_TO_READ를 사용한다. 그래프 가로축은 epoch가 아니라 Train 게임 수이며 Train/Val NLL을 둘 다 보고한다.
- 내부 검사는 subset 결정성/중첩/게임 경계·공통 scope/투영·OOV 전체 분모·예산의 정수/부분 pass·Train-only updates·NumPy loss/경고/NaN 거부·기준선 drift 차단·경로 보호·기본 data/fit 차단을 다룬다. 필수 verify:ml/verify.sh와 문서 링크/공백 검사를 수행한다.
- 허용 변경:새 명세/Notebook·PLAN/change-log·AI 계획/ML 진입 링크. 기존 dirty 사용자 파일·dataset/report·runtime/환경은 보존한다. 과거 사용자 실행본 ML 형식 문제는 별도 보고한다.
- canonicalResultEligible/productionIntegration/inferenceEligible/wholePolicyEvidence/legalityChecked/reachableCandidatesGenerated는 모두false다. Legacy 관측/40행 호환성·합법성/도달 가능성·과거 Test 관측 한계를 유지한다. 다음은 사용자 Full 해석이며 새 수집·추가 학습·runtime·commit/push/merge를 자동 시작하지 않는다.

## 구현·검증 기록 (2026-11-03)

- Notebook15개 cell·고유 ID·빈 output/count·기본 Full=False다. 실제 data open/신경망 fit 차단 상태로 전체 셀·내부 assert를 실행했다. 게임 중첩/순서·부분 pass/동일 업데이트·NumPy loss/경고·공통 projection/OOV·기존 경로 보호를 확인했다.
- 실제 파일 SHA/split·부분집합/어휘·subset Train-only scaler를 신경망 학습 없이 점검했다.38/75/112/149게임은1804/3396/4840/6417구간,1104/1598/1907/2133-class이며 Validation known coverage는57.92/74.21/84.96/89.97%다. 공통1104-class의 평가 scope는878구간/31게임이다. 이 수치는 모델 예측 성능이 아니다.
- 동일1530업데이트의 full pass/추가 행은102/0,56/2304,40/1280,30/0이다. 실제 신경망 fit 대신 가짜 모델로 행 노출량/public t_·부분 pass·point metric 조립·실제 parameter count를 확인했다. Reference 복사본의 baseline 비교와 drift 중단을 검사했지만 실제100% 재학습 재현은 사용자 Full 전까지 미검증이다.
- 가짜 자료의 pandas4개 표·4-panel figure 렌더링을 확인했다. 가짜 결과는 성능 report로 저장하지 않았으며 실제 Full/작은 학습·가중치·새 dataset은 생성하지 않았다.
- `bash scripts/verify.sh`:793 pass·기존1 skip. `npm run verify:ml`: Node35 pass·Python213/220(기존 실행본5 fail·2 error)로 전체 ML gate는 보류다. 기존 사용자 source/출력·보고서·테스트/환경·Git 상태는 임의 정리하지 않았다.
