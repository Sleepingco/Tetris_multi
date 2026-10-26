# ML Experiment: Human timing baseline

## 상태와 질문

- Experiment ID: `human-timing-baseline`, Lifecycle: `proposed`, 다음 MODE: `implement-smoke`.
- 현재 단계는 **명세 준비만**이다. Notebook·학습 코드·fit·평가는 아직 구현하거나 실행하지 않았다.
- 질문: 직전 action별로 기록 간격 분포를 구분하면, action을 구분하지 않는 분포보다 held-out 게임의 기록 간격을 잘 설명하는가?
- 최종 목표는 Human 조작 모방이지만 이번 범위는 **기록된 처리 시도 간격**이다. 입력 순서·배치·hold·개인화·사람다운 체감·v3/40행 적용은 검증하지 않는다.
- 사용자는 0ms 집중 게임을 v1에 포함한 채, 나중에 제외한 결과도 함께 비교하는 방침에 동의했다. 이는 다른 모델을 재학습하거나 test 결과로 후보를 고르는 승인이 아니다.

## 고정 입력

- Dataset: `data/datasets/human-timing-v1-20261024-full`.
- Manifest SHA: `c203a1db7b8f2aa7014c565b371088a9614f6abb0df5632e93fe6c807712fc88`.
- 213게임·61,190 pair. Train 149게임/41,151 pair, Validation 31/10,180, Test 33/9,859.
- Feature는 `previousAction` 하나, label은 `recordedIntervalMs`다. 다음 action·gameId·playerNumber·pieceIndex·sourceLine은 진단용이며 feature로 쓰지 않는다.
- 기존 schema·quality-policy-v1·seed·split을 유지한다. 원본 재추출·game 재배치·0ms 삭제·clipping·시간 보간·test 기반 cutoff 변경은 없다.
- 0ms 집중 gameId: `119e01c9-b982-4907-9480-2308f4604635`. Test에만 718 pair가 있다. 제외 평가를 해도 Train은 41,151 pair 그대로다.
- 과거 0ms 원인은 미확인으로 종료했다. 추가 원인 조사를 이 실험의 gate로 만들지 않는다.

## 비교할 세 baseline

| ID | 예측 분포 | Train에서 계산하는 값 |
| --- | --- | --- |
| B0 fixed_mean | Train 전체 평균 한 값에 확률 1 | 전체 label 평균 |
| B1 global_empirical | Train 전체 label의 경험적 분포 | 정렬된 전체 label, 각 표본에 같은 확률 |
| B2 previous_action_empirical | 직전 action에 해당하는 Train label의 경험적 분포 | action별 정렬된 label, 각 그룹 안에서 같은 확률 |

핵심 비교는 **B2 대 B1**이며 변경 변수는 action 조건화 하나다. B0는 고정 속도의 참고선이다.
0ms를 보존하고 log 변환·정규분포 가정·smoothing·최소 표본 cutoff·신경망·hyperparameter 탐색을 추가하지 않는다.
모든 학습 pair는 같은 weight다. 긴 게임이 Train 분포에 더 많이 기여하는 한계는 보고하며 이 실험 중 game-balanced weighting으로 바꾸지 않는다.
지원되는 정상 action이 Train subset에 없으면 B2는 B1로 fallback하고 횟수를 기록한다. 잘못된 action/type은 거부한다.
현재 rotate_ccw는 Train 38 pair에만 있고 Validation/Test에는 없다. 해당 action의 일반화 성능을 측정했다고 주장하지 않는다.

## 평가 지표 — 결과를 보기 전에 고정

### Primary: game-macro CRPS, 단위 ms, 작을수록 좋음

모델은 한 숫자가 아니라 **간격 분포**를 반환한다. 임의 추출 한 번의 MAE만으로 비교하면
원하는 분포의 퍼짐보다 중앙값 근처의 고정 출력을 유리하게 평가할 수 있으므로 CRPS를 사용한다.
CRPS는 예측 분포 전체를 평가하고 관측값과 같은 단위를 사용한다.
[Gneiting·Balabdaoui·Raftery의 원문](https://sites.stat.washington.edu/raftery/Research/PDF/Gneiting2007jrssb.pdf).

```text
CRPS(F, y) = E|X - y| - 0.5 E|X - X'|
```

각 pair의 CRPS → game 안에서 평균 → game별 평균을 동등하게 평균한다.
따라서 조작 기록이 많은 한 게임이 primary score를 지배하지 않는다. Pair-micro 평균은 secondary다.
B0처럼 한 점에 확률 1이면 CRPS는 그 고정 예측의 절대 오차와 같다.

계산은 정렬·누적합·binary search를 사용해 정확히 구한다. N×N 거리 행렬·전체 pairwise loop·Monte Carlo 점수를 만들지 않는다.
정렬된 경험 표본 x[i], n개일 때 두 번째 항은 아래 식이며 첫 번째 항은 prefix sum으로 계산한다.

```text
0.5 E|X - X'| = sum((2*i - n + 1) * x[i]) / n²   # i = 0 ... n-1
```

Synthetic worked example: Train 분포 [0, 100]ms와 관측 0ms의 CRPS는 25ms다.
고정 평균 50ms의 CRPS는 50ms다. 이 예제는 계산 검증이며 실제 결과가 아니다.

### Secondary와 진단

- Pair-micro CRPS, game별 B2−B1 CRPS, 개선/동일/악화 game 수·worst game·action별 CRPS와 표본 수.
- 예측 분포 평균·median·p95·0ms 확률, 관측 분포와의 차이. B2 전체 예측 분포는 평가 입력 action 비율로 Train 분포들을 혼합하며 평가 label로 다시 fit하지 않는다.
- Median 예측 MAE는 point 진단일 뿐 모델 선택의 primary가 아니다. Quantile은 CDF가 q 이상이 되는 최소 support 값으로 정의한다.
- Unseen action fallback count, finite/nonnegative support, split leakage, fit에 사용한 game/pair 수.
- 통계적 유의성·실제 사람다운 체감·gameplay 개선·추론 지연·평균 속도를 맞춘 rollout은 이번 offline 비교에서 판정하지 않는다.
- 무작위 샘플링은 primary/secondary 점수에 쓰지 않는다. 설명용 표본이 필요하면 seed를 고정하고 점수에서 분리한다.

## 실행을 두 단계로 분리

### A. Validation 비교 — 다음 구현의 기본 범위

1. Manifest와 Train/Validation 파일 checksum·row schema·unique sampleId·인접 lineage·game split을 검증한다. Test 파일 검증은 B 단계까지 미룬다.
2. Train만 읽어 B0/B1/B2를 각각 한 번 만든다. Validation/Test label·통계는 fit·지원 범위·fallback cutoff 계산에 사용하지 않는다.
3. Validation 전체 31게임에서 세 baseline을 비교한다. 이 단계에서는 Test row를 읽거나 성능을 계산하지 않는다.
4. Primary로 B2−B1의 관측 차이를 보고한다. 개선은 이 cohort의 offline 결과이지 강한 AI·체감 개선이나 통계적 우월 판정이 아니다.
5. Validation 점수 차이가 1e-12ms 이내면 tie로 보고 단순한 B1을 우선 검토한다. 최종 후보 채택은 결과 해석 뒤 별도 결정으로 기록한다.
6. Train 분포·모델 ID·feature·manifest SHA·코드 SHA와 Validation 결과를 결정적 candidate bundle/report로 보존한다. 이 bundle은 production 모델이 아니다.

### B. Test 확인 — 후보 고정 후 별도 승인

선택한 모델 ID와 candidate bundle SHA를 고정한 뒤 같은 모델을 한 번만 평가한다.

| 결과 | 범위 | 역할 |
| --- | --- | --- |
| test_all | 기존 33게임/9,859 pair 전체 | 최종 primary 평가 범위 |
| test_without_flagged_game | 지정 게임을 제외한 32게임/9,141 pair | 시간 불확실성에 대한 민감도 분석 |
| flagged_game_only | 지정 게임 1개/718 pair | 문제 게임의 별도 진단 |

**세 결과 사이에서 fit은 0회이며 모델·분포·파라미터가 동일해야 한다.** 새 dataset 파일이나 split을 생성하지 않고 평가 mask만 다르게 적용한다.
결과를 보고 B0/B1/B2 선택·cutoff·feature·clipping을 바꾸지 않는다. 좋게 나온 subset만 대표 성능으로 제시하지 않는다.
Test의 데이터 품질 분포는 이미 조사했지만 모델 점수는 아직 관측하지 않았다는 이력을 report에 명시한다.
Test 결과에 반응해 새 후보를 만들 경우 이번 Test는 더 이상 새 후보의 손대지 않은 최종 평가로 부르지 않는다.

## 구현 산출물과 허용 범위

다음 구현은 `scripts/ml/notebooks/human_timing_baseline.ipynb`와
`scripts/ml/tests/test_human_timing_baseline_notebook.py`로 한다. **현재 두 파일은 아직 작성하지 않았다.**
Notebook에 왜→작은 예제→Train 분포→Validation 표/그래프→한계 흐름을 넣고 실험 코드를 별도 .py로 복사하지 않는다.
Pandas 표와 Matplotlib CDF·분포·game별 CRPS delta 그래프를 제공한다. raw label을 바꾸지 않고 표시 변환은 명확히 구분한다.
Python/NumPy/pandas/Matplotlib 기존 환경만 사용하며 새 dependency·JS 실험 복제·runtime·PVE·DB·로그 수집은 변경하지 않는다.
기존 사용자 Notebook output과 다른 dirty 파일도 보존한다. Commit/push/merge는 별도 승인 사항이다.

## Smoke·검증·출력 보호

- Synthetic: point-mass CRPS=절대 오차, [0,100] 예제, 빠른 계산과 작은 brute-force의 1e-12 수치 일치, 중복 support·0ms·큰 값·empty/nonfinite 거부.
- Leakage: Train-only fit, evaluation label 변경이 candidate bundle을 바꾸지 않음, game 간 split 0, unseen fallback, rare action 미검증 표시.
- 민감도: mock bundle 고정 후 full/제외/단독 mask를 적용해 분할 합계·fit 호출 0·동일 bundle SHA를 확인한다. 실제 Test는 사용하지 않는다.
- Smoke는 fixture와 Train 앞 5게임/Validation 앞 3게임만 사용한다. Test file은 열지 않는다. Smoke 기준·결론과 full 범위를 명확히 구분한다.
- 모델/점수 배열·report 순서는 결정적이며 NaN/Infinity를 거부한다. 입력·기존 산출물·symlink/hardlink/path alias 출력 충돌을 게시 전에 거부한다.
- 출력은 ignored `data/ml-experiments/human-timing-baseline/` 또는 임시 경로의 새 파일만 쓴다. timestamp·timing·사용자 절대 경로는 canonical JSON에서 제외한다.
- 구현 후 targeted → `npm run verify:ml` → `bash scripts/verify.sh`를 적용한다. 기존 사용자 source Notebook output에 따른 별도 검사 실패는 구분해 보고하고 임의로 지우지 않는다.
- Full Validation 명령은 구현·smoke 검증 뒤 실제 경로를 채워 제공한다. 지금은 실행할 Notebook이 없으므로 작동하지 않는 명령을 안내하지 않는다.

## 판단·중단 gate

- Smoke는 `policyDecisionEligible=false`, `fullCohortCovered=false`, `canonicalResultEligible=false`다.
- Full Validation이 정합하면 `validation_baseline_comparison_complete`. 후보를 자동 production 채택하거나 Test를 자동 실행하지 않는다.
- Full Test의 `test_all`/민감도/단독 결과는 최종 평가·진단이며 후보 재선택에 사용하지 않는다. Canonical/freeze는 별도 요청 전까지 false다.
- 입력 SHA 변경, split 누수, evaluation fit 유입, 음수/비유한 label, support 계약 오류, 결과 기반 Test 제외 또는 runtime 변경은 중단 사유다.
- 이번 준비 요청에서는 명세·계획·안내만 작성한다. fit·Notebook 구현·smoke/full·후속 기능은 시작하지 않는다.
