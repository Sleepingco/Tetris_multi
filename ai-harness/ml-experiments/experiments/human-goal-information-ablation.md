# ML Experiment: 조각 종류와 목표 셀 정보의 기여 분리

## 승인·질문

- ID: `human-goal-information-ablation`, MODE: `run-full`, executionPolicy: `full-only`.
- 사용자 승인(2026-11-03): 별도 Smoke 학습/평가 없이 전체 Train/Validation 비교를 진행한다. 짧은 내부 assert와 필수 회귀 검사는 유지한다. 기존 Smoke Notebook은 과거 기록으로 보존한다.
- 질문: prefix에 조각 종류를 알려주는 것에 더해 **목표 셀**이 다음 행동/시간 예측에 추가 정보를 주는가?
- 세 조건: `prefix_only`, `piece_type_prefix`, `oracle_goal_prefix`. 변화는 제공 정보 mask뿐이다. 같은101차원·표본·scaler·모델·budget·seed·평가를 유지한다.
- 별도 Smoke 표본의 성능 지표는 생성하지 않는다. Full은1회 수행하고 기존 두 조건의 이전 Full 재현을 대조한다. 새 중간 조건의 반복 결정성/동결 검증은 이번 범위가 아니다.

## 고정 입력·재사용

- 기존 dataset `data/datasets/human-placement-action-offline-v1-20261102-run1`과 공통 적격 Train6,417/Validation1,516구간·행동47,537/11,691·시간41,120/10,175·게임149/31 유지. Test33은 예약 metadata만 확인하며 raw·Test·rejected 파일은 열지 않는다.
- Manifest SHA `9ae27fc0b85903f412b434f5667e51376e7d5bb3170d3bab3d439f0e415f28bf`; Train/Validation SHA는 [이전 명세](human-goal-conditioned-prefix.md)를 그대로 따른다.
- 이전 Full report: `data/ml-experiments/human-goal-conditioned-prefix/full-report-run1.json`, SHA `d4a5ef0101fb0c6796894c4143a98af3f67aa91eaf9e15ba5180dc1c6ac6284d`.
- 이전 Notebook 정의 SHA `12f07e2a25b35fdaedd9c3c6ed805e9b6fbb6f5b3fd236569d0363b654b051d2`. shared/feature/input/model/metric 정의 셀만 가져온다. Smoke 정의/실행, 기존 Full 실행, 사용자 출력은 실행하거나 수정하지 않는다.
- 새 parser·feature 추출·MLP·평가를 복제하지 않는다. 기존 train_variants로 두 조건을 fit하고 같은 fit_head로 중간 조건만 추가한다. 같은 evaluate_model을 사용한다.

## 정보 mask·학습

- Prefix86차원은 동일하다. Goal15차원은 pieceType7 + 정렬한 네 셀의 좌표8이다.
- `prefix_only`: 표준화된 goal15를0으로 mask.
- `piece_type_prefix`: pieceType7은 유지하고 좌표8만0으로 mask.
- `oracle_goal_prefix`: 모두 유지.
- 기존 evaluator에는 raw 좌표8을 Train scaler mean으로 치환한 복사본을 전달한다. 표준화 후0이 되는 같은 projection이며 입력/정답/원본을 수정하지 않는다. 내부 검사로 두 표현의 동일성을 확인한다.
- 기존 행동/시간 독립 MLP(101→ReLU64→softmax6/16),30epoch, Adam lr0.001·alpha0.0001·batch128·seed1729/1730·uniform example weight·BLAS1 유지. 총6개 모델 fit이다. Train-only scaler/시간 support, BOS 시간 null 제외, 실제0ms 보존도 동일하다.
- Validation 튜닝·early stopping·새 feature/재가중치·희소 class 제거·epoch 재선택은 하지 않는다. Validation은 마지막 epoch에서만 평가한다. 이 Validation은 개발용이며 새 독립 Test로 부르지 않는다.

## 평가·판정 사전 고정

- Primary: game-macro 행동 NLL. F1·accuracy·행동별 support/precision/recall·confusion·시간 CRPS/MAE/0ms Brier·게임별 차이는 기존 정의를 재사용한다.
- `piece_minus_prefix`, `goal_minus_piece`, `goal_minus_prefix`의 지표 차이와 게임별 차이를 모두 남긴다. 음의 NLL/CRPS, 양의 F1이 유리하다. 차이를 인과적 정보 기여율/백분율로 해석하지 않는다.
- 목표 셀 추가의 ΔNLL < -1e-12·ΔF1 ≥ -1e-12·ΔCRPS ≤1e-9이면 `goal_cells_additional_signal_observed`; NLL만 개선하면 `goal_cells_tradeoff_requires_review`; 아니면 `no_clear_goal_cells_gain`. 부호 기반 탐색 판정이며 유의성/최종 채택/프로덕션 근거가 아니다.
- 기존 prefix/goal 두 조건의 macro 지표·행동/시간 support·Train loss trace를 이전 report와 atol1e-12, rtol0으로 대조한다. 불일치면 재현 실패로 중단하고 효과를 정책 결론으로 사용하지 않는다.
- 좌표 효과가 없더라도 목표가 불필요하다는 결론은 아니다. 현재 절대 좌표 표현·작은 MLP·Human prefix가 정보를 충분히 활용하지 못할 가능성이 있다. Goal은 oracle이며 Human 배치 예측 모델은 여전히 별도 필요하다.

## 산출물·경계

- Notebook 하나: `scripts/ml/notebooks/human_goal_information_ablation.ipynb`. 새 Python/테스트/dependency는 만들지 않는다.
- 구조: 설명/예제 → 재사용 정의/짧은 내부 assert → Full 설정/실행 → pandas·Matplotlib 결과 → 한계. 별도 Smoke 학습/작은 성능 report는 없다.
- 기본 Full 비활성. 이번 승인된 실행은 `HUMAN_GOAL_ABLATION_RUN_FULL=1`과 새 report 경로로1회 실행한다. Notebook은 이후 사용자 모두 실행만으로 재학습하지 않도록 원본 output/count를 비운다.
- Ignored 결과: `data/ml-experiments/human-goal-information-ablation/full-report-run1.json`, `executed-full-run1.ipynb`. 기존 입력·report·Notebook은 덮어쓰지 않는다. source·reference·dataset SHA와 source 정의 불변을 실행 전후 확인한다.
- `fullCohortCovered=true`, `policyDecisionEligible=true`(현재 탐색 질문만), `canonicalResultEligible=false`, `productionIntegration=false`, `wholePolicyEvidence=false`. weights/model artifact·새 dataset은 게시하지 않는다.
- 내부 검사는 mask 경계/동일 prefix·좌표 projection·입력 비변경·CRPS·경로/기존 output 보호를 다룬다. 실제 Full 오류/유한 loss·count·누수·이전 두 조건 재현과 필수 verify:ml/verify.sh를 확인한다.
- runtime·Human 배치 fit·Hold·새 수집·Test 평가·추가 실험·commit/push/merge는 하지 않는다. 결과가 좋거나 나쁘다고 자동으로 예산/표현을 바꿔 재실행하지 않는다.

## Full 실행·해석 (2026-11-03)

- 승인된 Full-only1회 실행. 별도 Smoke 학습은0, 실제 모델6개×30epoch다. Train149게임/6,417구간·47,537행동/41,120시간, Validation31게임/1,516구간·11,691행동/10,175시간이다.
- 결과 `goal_cells_additional_signal_observed`. 조각 종류를 이미 제공한 조건에서도 목표 셀 추가 정보가 관측됐다. 인과/통계적 유의성/최종 모델 채택이 아닌 고정 개발 cohort의 탐색 결과다.

| 조건 | Game-macro 행동 NLL↓ | Accuracy↑ | Macro F1↑ | 시간 CRPS(ms)↓ | Hard-drop recall↑ |
| --- | ---: | ---: | ---: | ---: | ---: |
| prefix_only | 1.105671 | 0.505657 | 0.333499 | 45.140807 | 0.238441 |
| piece_type_prefix | 1.066450 | 0.518772 | 0.356127 | 44.966001 | 0.283355 |
| oracle_goal_prefix | 0.796889 | 0.667455 | 0.480830 | 44.571386 | 0.756935 |

- 목표 셀 추가(oracle−piece): ΔNLL -0.269562, Δaccuracy +0.148683, ΔF1 +0.124703, ΔCRPS -0.394615ms. NLL/F1은31게임 모두 개선, 시간은27개선/4악화다. 조각 종류만 추가한 개선은 더 작다(ΔNLL -0.039221, Δaccuracy +0.013115).
- 기존 prefix/goal 두 조건은 이전 Full과 macro 지표 최대 절대오차0·confusion/count 일치·loss trace 허용오차1e-12 이내로 재현됐다. 새 중간 조건의 반복 실행은 하지 않았다.
- Full report: `data/ml-experiments/human-goal-information-ablation/full-report-run1.json`, SHA `fc5a17317d539de110755290a43160a8a51fdf1571a340b98b3609d01e790167`.
- Executed Notebook: 같은 폴더의 `executed-full-run1.ipynb`, SHA `c1d3ff8aefe4f507571deab28e77c96167890e7f1b350a7419a9fab41e50c663`. headless 실행 오류0·그림1개, 임시 원본은 `/private/tmp/human-goal-ablation-full-P2T15K/`이며 ignored 프로젝트 사본과 byte 일치다.
- report의31게임 재집계·confusion/support·유한30epoch loss·정의 SHA·기존25개 Notebook/입력/보고서 SHA 불변을 확인했다. source Notebook은 output/count 비어 있음·Full 기본 비활성·고유 ID를 유지한다. 내부 검사는 모델 fit과 기본 data open을 차단한 상태에서도 통과했다.
- `bash scripts/verify.sh`:793 pass·기존1 skip. 현재 `npm run verify:ml`: Node35 pass·Python213/220(기존 사용자 실행본의5 fail·2 error), 전체 ML gate는 별도 보류다. 기존 실행본은 수정하지 않았으며 격리 Git 원본 Python220/220과 구분한다.
- 다음은 별도 Human 배치 모델의 입력/정답 명세다. 고정 직전 activePiece의 최종 row/col/rotation/cells 같은 정답 노출 입력을 제외하고 snapshot 관측 시점 한계를 명시해야 한다. 이 결과만으로 실제 목표 선택·자체 실행·runtime 호환성까지 확보됐다고 보지 않는다. 추가 구현/실험은 시작하지 않았다.
