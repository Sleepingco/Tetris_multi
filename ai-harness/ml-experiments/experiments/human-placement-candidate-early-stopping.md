# ML Experiment: 공유 후보 모델의 조기 종료

## 1. 질문과 범위

- Family Experiment ID: `human-placement-candidate-scoring`; report stage: `early_stopping`.
- MODE: `implement-smoke`; 사용자 Full-only 방식을 유지해 별도 성능 Smoke fit은 하지 않는다.
- 질문: 같은 공유 후보 scorer에서 **Train 내부 게임으로 정한 epoch 수**가 고정30epoch보다 외부 Validation BCE를 낮추면서 배치 순위를 유지하는가?
- 이번에는 종료 예산만 바꾼다. 폭64·alpha0.0001·Adam·lr0.001·batch128·seed1729·407차원·candidate/label/weight/scaler 계약은 유지한다. 모델 축소/L2 탐색/증강/새 수집/학습곡선 구현을 섞지 않는다.
- Source: [human_placement_candidate_early_stopping.ipynb](../../../scripts/ml/notebooks/human_placement_candidate_early_stopping.ipynb). 새 Python/test/dependency/runtime 파일은 만들지 않는다. 작은 검사는 Notebook assert다.

## 2. 실제 존재하는 기준선

- [이전 명세](human-placement-candidate-scoring.md)의 사용자 Full report `data/ml-experiments/human-placement-candidate-scoring/model-comparison-run1.json`을 고정한다.
- SHA-256: `16efde71ae0a783b9e99b9960c36736385d399920031b3431a8cbcc41f9731b7`.
- 공유 scorer의 Validation31게임 game-macro Top-1/Top-3/MRR: `0.4356484764779739 / 0.7494800041612361 / 0.6143027534783945`.
- Train/Validation segment-micro Top-1: `0.7536231884057971 / 0.46108179419525064`; BCE: `0.22866916642452653 / 0.9954748539167801`.
- 이전 기준선은 실제30epoch 학습 결과다. 이번에 동일한30epoch baseline을 또 학습하지 않고 report의 metrics/predictions/epoch history를 재사용한다. 새로운 조건은 실제 학습한다. 미구현 모델이나 가상 성능으로 비교하지 않는다.
- 이전 비교 Notebook의 definitions SHA `282c64c675e59bf533a4b4c3c7e9b80ce3c04312b3e1c37f42724118203a04a3`를 고정해 parser·candidate pack·weighted scaler·학습·평가·출력 보호를 재사용한다. 기존 실행 출력/count/Full 설정은 보존한다.

## 3. 데이터와 선택 경계

- 같은 immutable dataset과 저장 candidate evidence만 사용한다. Train149게임6417구간147450후보 / 외부 Validation31게임1516구간34552후보, 기존 OOV152개·제외0을 유지한다. 원본 SHA는 이전 report와 loader로 검증한다.
- PVE Human, PVP 양쪽 Human·승패 무관·기존 품질/split·Hold 보류 정책을 유지한다. Human 선택 class가 정답이며 heuristic 정답/선호는 없다.
- Train 게임 ID를 `SHA256("1729:early-stop:" + gameId)`와 gameId 순서로 정렬해 첫30게임을 inner monitor, 나머지119게임을 inner fit으로 정한다. 양쪽 Human은 game 단위로 함께 이동한다. 게임 수·ID 정렬만 사용하며 결과/정답/Validation metric으로 게임을 고르지 않는다.
- 실제 고정 분할은 inner fit119게임5035구간115808후보 / monitor30게임1382구간31642후보다. Inner scaler는 inner fit 후보에만 fit한다. 후보별1/K의 label-independent scaler weight, positive1/2·negative합1/2의 구간 총 loss weight1을 유지한다. inner monitor를 scaler/model fit에 넣지 않는다.
- Test33은 기존 manifest ID 경계만 확인한다. Test/raw/rejected/DB payload·Node 후보 재생성·행동 증강은 하지 않는다.

## 4. 종료 정책과 두 실제 fit

1. **Inner selection fit**: inner fit119게임에서 최대30epoch. 각 epoch 뒤 inner fit/monitor의 decision-balanced BCE를 계산한다. inner monitor BCE가 이전 인정 best보다 `1e-4` 초과 낮을 때 개선으로 인정한다. `loss < best - 1e-4`; 동일값은 개선이 아니다.
2. 개선 없음이 연속3epoch면 중단한다. 그때까지 인정된 best epoch를 선택한다. 중단이 없으면30epoch에서 종료한다. 첫 유한 loss는 best로 인정한다. 선택 budget은1~30이며 내장 random-row early stopping은 사용하지 않는다.
3. **Full-Train refit**: inner 모델 weight를 가져오지 않고 seed1729로 새로 시작한다. 전체 Train149게임에서 scaler를 다시 fit하고, 선택한 epoch 수만 실제 학습한다. 외부 Validation31게임은 epoch 선택/gradient/scaler fit에 사용하지 않는다.
4. 같은 초기화·전체Train·설정이므로 refit의 epoch별 Train/외부 Validation 지표·optimization loss가 고정30epoch report의 같은 prefix와1e-12 이내로 일치해야 한다. 일치하지 않으면 원인을 조사하며 epoch/seed/threshold를 바꾸지 않는다. 이 검사는 재현성 gate이며 외부 Validation을 종료 선택에 쓰는 절차가 아니다.
5. 기준선 신규 fit0 + inner fit1 + full refit1 = 신규 model fit2다. Inner 모델/배열은 refit 전에 해제해 큰 배열의 동시 보유를 줄인다. 선택 단계 계산비도 report에 남긴다.

## 5. 비교와 해석

- Primary: 같은1516구간/31게임의 game-macro Top-1 차이와 외부 Validation BCE 차이를 함께 본다. Top-3/MRR·micro·게임별 delta·기존 OOV152개·Train/Validation gap을 함께 기록한다.
- BCE가1e-12보다 많이 감소하고 macro Top-1/MRR이1e-12보다 많이 나빠지지 않으면 `early_stopping_signal_observed`다. BCE 또는 Top-1만 좋아지면 `early_stopping_tradeoff_requires_review`; 아니면 `no_clear_early_stopping_gain`이다. 부호 판단은 실용/통계적 우월성의 증명이 아니다.
- Inner monitor의 BCE 최저 시점이 외부 배치 Top-1의 최적 시점이라는 보장은 없다. Inner119→전체149게임 refit에서도 최적 epoch가 이동할 수 있다. 선택된 epoch를 자동 최종 모델로 동결하지 않는다.
- 외부 Validation은 이전부터 개발에 반복 사용했다. 이번 선택은 Train 내부에서 수행하더라도 독립 Test 증거로 바뀌지 않는다. 신규 반복 결정성·convergence·reachable 실행·game-over·40행·전체 조작/시간/Hold·gameplay·production은 미검증이다.
- 모든 결과의 다음 판단은 `needs_policy_decision`이다. 그 뒤에만 새 scorer의 게임 수별 학습곡선을 준비한다. 이전 ID 분류 학습곡선을 새 scorer의 데이터 충분성 증거로 대체하지 않는다.

## 6. 구현·검증·실행

- Notebook은 왜 → 손계산 stop 예제 → 기존 정의 재사용 → inner split/scaler/fit → report 검증/표/그림 → 내부 assert → Full 설정/실행/결과 → report 읽기 → 한계 순서다.
- `RUN_FULL=False`, report 초기값 None, source output/count 비움. 내부 가상 optimizer/assert는 stop/patience/NaN·게임 분리·Train-only scaler·weight 전달·prefix 재현·report 집계·출력 보호를 확인한다. 가상 모델 수치를 성능 결과로 게시하지 않는다.
- pandas 표는 최종 지표·inner 경계/계산량·게임별 차이·OOV를 보여준다. Matplotlib은 inner Train/monitor BCE·full Train/외부 Validation BCE·배치 Top-1·게임별 delta를 표시한다. BCE와 순위 지표의 단위를 혼합하지 않는다.
- 산출물은 `data/ml-experiments/human-placement-candidate-scoring/early-stopping-run1.json` 같은 새 ignored 경로에만 독점 게시한다. 이미 있는 파일·alias·symlink·hardlink를 덮어쓰지 않는다. timing은 non-canonical Notebook 출력뿐이다.
- 구현 검증: 실제 모델 fit 없이 기본 실행/내부 assert, read-only 실제 ID split/preflight, `npm run verify:ml`, `bash scripts/verify.sh`, schema/고유 ID/빈 출력·문서 링크 검사. Full은 사용자가 실행한다.
- 사용자 실행: `tetris-ml` 커널로 새 Notebook을 열고4절 `RUN_FULL=True`와 새 `FULL_REPORT_PATH`를 지정한다. 위 정의/검사와 Full을 실행한다. 결과만 볼 때는 Full을 끄고5절 `REPORT_TO_READ`를 지정한다. Node 설정·별도 Python 실행은 필요 없다.
- 허용 변경은 새 Notebook/이 명세와 현재 안내·PLAN/change-log 문서다. 기존 Notebook·dataset/evidence/report·동시 제품/배포 변경은 보존한다. commit/push/merge는 하지 않는다. Rollback은 새 실험 코드와 안내만 제거하며 원본/기존 결과는 삭제하지 않는다.

## 7. 구현 마감 (2026-11-09)

- Notebook15개 cell에 실제 inner selection/full-Train refit·report 검증/읽기·pandas4표/Matplotlib4패널을 구현했다. 두 실험 모델은 실제 학습 경로이며 미구현 비교는 없다. 기존30epoch 기준선은 실제 report를 읽어 재사용한다.
- 실제 fit/data load를 차단한 기본 전체 실행·내부 stop/split/scaler/optimizer/prefix/output 경계 검사 통과. 실제 자료의 read-only join과 Train-only scaler-only 진단에서 fit119게임5035구간115808후보 / monitor30게임1382구간31642후보, 외부31게임과 중복0을 확인했다. 실제 모델 fit은0이다.
- 메모리 안의 report validator 검사·flag/집계 변조 거부·pandas/Matplotlib 표시 검사를 통과했다. 가상 신규 모델 성능을 저장하거나 게시하지 않았다.
- `npm run verify:ml`: Node35/35·Python220/220; `bash scripts/verify.sh`: Node805 pass·기존1 skip·0 fail. Source schema/구문·고유 ID·빈 출력/count·Full 기본 False, 기존 사용자 Notebook과 baseline report SHA 불변을 확인했다.
- 다음은 사용자4절 Full 실행과 결과 해석이다. Full 학습·새 조건 반복 결정성·게임 수별 학습곡선·Test·runtime·stage/commit은 실행하지 않았다.
