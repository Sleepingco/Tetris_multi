# ML Experiment: Frozen B2 timing Test evaluation

## 상태·질문

- Experiment ID: `human-timing-b2-test-evaluation`, Lifecycle: `closed`, MODE: `analyze-result`.
- 질문: Validation에서 선택한 고정 B2는 미평가 Test의 기록 간격을 얼마나 설명하며, 지정 게임 제외 시 결과가 얼마나 달라지는가?
- 2026-10-26 사용자의 다음 단계 준비 요청에 따라 B2를 **이번 Test 평가 후보로만 고정**한다. Production/freeze 채택이나 Test 실행 승인이 아니다.
- 사용자 full Test와 결과 검토를 완료했다. 아래 구현 당시의 Test 미실행 기록과 구분한다. 기존 source 출력 형식 검사로 전체 ML gate는 보류다.

## 사용자 full 결과 검토 — 2026-10-27

- Full report SHA `9962f54478a3d0d557756401e4683164b291ce0b752f33798157de19ce3f5833`, 상태 `fixed_b2_test_evaluation_complete`. 기대 cohort·입력 checksum·B2 bundle SHA·game split·게임/전체 집계·fit 0·Notebook 오류 출력 0을 확인했다. 재실행하지 않았다.
- 전체 33게임/9,859 pair의 game-macro CRPS `51.87103420312984`ms, pair-micro `55.435419636285445`ms. 지정 게임 제외 32게임/9,141 pair는 macro `50.57872413031196`, 단독 1게임/718 pair는 `93.22495653330179`ms다. 전체 결과가 primary다.
- 전체 0ms 473개 중 396개가 지정 게임에 있다. 그 게임의 예측/관측 평균은 161.91/22.33ms, 0ms 비율 0.56%/55.15%다. 시간 의미·기원 한계는 유지하고 원인 조사를 재개하지 않는다. 반시계 회전은 Test에 없어 미검증이다.
- Validation 53.03ms와 Test 51.87ms는 비슷한 크기지만 다른 cohort이므로 성능 개선이나 통계적 우월로 해석하지 않는다. B2를 timing 비교 기준으로 유지하고 이 평가를 마감한다. Canonical/production 승격은 없다.
- 사용자 source는 저장된 출력 및 full 설정 때문에 실행 전 source SHA와 다르다. 기존 검증 smoke Notebook과 비교한 소스 변경은 full 설정/실행 셀뿐이며 계산 정의는 같았다. 출력 형식 실패와 계산 오류를 구분하고 원본 report의 SHA를 갱신하지 않는다.
- 후속 질문은 [과거 간격 하나의 조건 추가](human-timing-history-baseline.md)다. 기존 Test를 본 뒤 정한 가설이므로 Train/Validation 탐색으로만 진행하고 새 후보의 최종 평가는 별도 미관측 cohort가 필요하다.

## 후보 선택 근거와 고정 입력

기존 [baseline 명세](human-timing-baseline.md)의 사용자 full Validation은 Train 149게임/41,151 pair, Validation 31게임/10,180 pair다.
Game-macro CRPS는 B0 `75.14956728707253`, B1 `54.27002863620122`, B2 `53.02814125677356`ms다.
B2는 B1보다 약 2.29% 낮고 28게임 개선/3게임 악화였다. 통계적 유의성·체감·gameplay의 증거로 확대하지 않는다.

| 고정 항목 | 값 |
| --- | --- |
| Candidate model ID | `B2` (`previous_action_empirical`) |
| 원본 full report | `data/ml-experiments/human-timing-baseline/full-report-run1.json` |
| 원본 report SHA-256 | `3c631c003ad1b80ae3cad653b552a3c69869dd2309ea0f27cb92968aa41ba902` |
| 원본 candidate bundle SHA-256 | `4bda9fb6e840cc997e0eae03c7a6b9e21ec809aa6a9c5a3947f3a7ffa197eddf` |
| Dataset | `data/datasets/human-timing-v1-20261024-full` |
| Manifest SHA-256 | `c203a1db7b8f2aa7014c565b371088a9614f6abb0df5632e93fe6c807712fc88` |
| Test SHA-256（manifest 기록값） | `2c6aa13c19a40c1a1599ad6bebfbcc7ef26e3bfec39a0a2dcfeb5020811944be` |
| Feature / label | `previousAction` / `recordedIntervalMs` |
| 지정 gameId | `119e01c9-b982-4907-9480-2308f4604635` |

Full run1/run2 report는 byte-identical이다. Bundle은 세 baseline을 담고 있지만 **B2만 점수화**한다.
미학습 정상 action의 전체 Train 분포 fallback은 고정 B2 계약의 일부다. B0/B1의 Test 점수를 계산해 후보를 다시 고르지 않는다.
원본 bundle의 과거 fit count는 보존하고, **이번 평가의 fit count는 0**으로 별도 기록한다.

## 평가 범위·지표

| Scope | 기대 범위 | 역할 |
| --- | --- | --- |
| `test_all` | 33게임/9,859 pair | Primary cohort |
| `test_without_flagged_game` | 32게임/9,141 pair | 지정 게임 영향에 대한 민감도 분석 |
| `flagged_game_only` | 1게임/718 pair | 단독 진단 |

Primary는 `test_all`의 game-macro CRPS(ms, 낮을수록 좋음)다. Pair-micro CRPS·median 예측 MAE·game/action별 점수와 표본 수·worst game·0ms 확률·미평가 action·fallback을 함께 본다.
세 범위는 같은 고정 bundle과 계산 함수를 사용하고 평가 mask만 다르게 한다. 원본·split·0ms·긴 간격을 수정하지 않는다.
Test의 시간 품질 분포는 과거에 조사했지만 모델 점수는 미관측이었다는 이력을 기록한다.
Validation 점수는 참고선이지 서로 다른 cohort 간 동등성·개선 판정의 threshold가 아니다. 수치 채택 기준이 없으므로 결과를 자동 pass/adopt로 만들지 않는다.
Test 결과로 후보·feature·분포·cutoff를 바꾸면 새 후보의 최종 검증에는 별도 미관측 cohort가 필요하다.

## 구현: Notebook 안의 smoke/full 분리

- [Notebook](../../../scripts/ml/notebooks/human_timing_b2_test_evaluation.ipynb).
- [정의 셀을 직접 실행하는 테스트](../../../scripts/ml/tests/test_human_timing_b2_test_evaluation_notebook.py).
- 공통 정의 → smoke 설정/실행/표·그래프 → full 설정/실행/표·그래프 → 한계·다음 gate 순서다. 별도 Python 실험 구현은 만들지 않는다.
- 기존 baseline Notebook의 정의 셀에서 CRPS·분포 요약·표본 검증·JSON/SHA·경로 보호/게시를 재사용한다. 기존 세 모델 평가 함수를 그대로 호출해 Test에서 B0/B1까지 평가하지 않는다. 재사용 정의 셀의 코드 hash를 기록하고 output/count 차이와 계산 코드 변경을 구분한다.
- Smoke는 **가상 bundle·가상 Test 표본만** 사용한다. 실제 frozen report·dataset·Test 파일을 열지 않고 전체/제외/단독의 count·동일 bundle SHA·fit 0을 검사한다. Real Test의 일부를 smoke로 먼저 점수화하지 않는다.
- Full은 `RUN_FULL = False`를 기본으로 두고, 사용자가 full 섹션에서 명시적으로 켰을 때만 실제 report·manifest·Test를 읽는다. 모두 실행만으로 full이 시작되지 않아야 한다. 환경변수 설정 자체는 에이전트 실행 승인이 아니다.
- Full에서 입력 SHA·bundle schema/support의 finite/nonnegative·feature/label·cohort·sample ID/인접 lineage·Train/Validation/Test game 경계와 count를 검증한다. Train/Validation 재학습·재추출·scaler fit·raw 로그 읽기는 없다.
- Smoke/full 결과 변수와 출력 경로를 분리한다. 출력은 ignored `data/ml-experiments/human-timing-b2-test-evaluation/`의 새 파일로 보존한다. 기존 파일·symlink·hardlink·path alias 충돌을 쓰기 전에 거부한다.
- Pandas로 세 scope 요약·game/action 진단·표본 수를 표시하고 Matplotlib으로 같은 B2의 예측/관측 분포·0ms·game별 점수를 보여준다. 전체 결과를 제외 결과로 대체하지 않는다.

## 검증·중단·인계

- Synthetic 검사: B2 수치·fallback, malformed bundle/label 거부, 누수·중복·count, 민감도 partition, bundle 비변경·fit 호출 금지, 출력 보호·결정성.
- Notebook 제목·필수 코드 문자열 검사도 유지한다. 기본 full 비활성화 상태에서 Notebook 실행 시 real Test open이 0인지 검사한다.
- 구현 후 targeted 검사·가상 headless smoke·`npm run verify:ml`·`bash scripts/verify.sh`를 수행한다. 기존 사용자 source output/count 검사 문제를 새 계산 오류와 구분하고 임의로 지우지 않는다. 전체 suite 실패 시 전체 gate 통과로 선언하지 않는다.
- Smoke는 `fullCohortCovered=false`, `policyDecisionEligible=false`, `canonicalResultEligible=false`다. Full은 기대 cohort·무결성 통과 시에만 앞 두 값을 true로 하고 canonical/production은 false를 유지한다.
- Full 결과 상태는 `fixed_b2_test_evaluation_complete`이며 후속 판단은 별도 `analyze-result`다. 모델 재선택·production 승격·다음 신경망 실험은 자동 실행하지 않는다.
- SHA/contract 불일치·누수·실제 Test의 smoke 유입·추가 fit·지정 cohort 변경·비유한 점수·입력 변조 시 중단한다.
- 허용 변경은 예정 Notebook/테스트, 이 명세, AI 계획·안내·PLAN·change-log·필요 실행 기록이다. 기존 Notebook·사용자 출력·runtime/PVE·dependency·dataset·원본 full report는 변경하지 않는다. Commit/push/merge는 별도 요청 사항이다.
- 실제 full 안내는 아래와 같이 Notebook의 해당 섹션을 기준으로 제공한다. 명령어 실행은 필수가 아니다.

## 사용자 실행 순서

1. Notebook의 공통 정의 셀을 실행한다. **3번 Smoke 섹션**의 설정·실행·결과를 순서대로 보거나 기본 모두 실행으로 가상 검사만 확인한다. Python 테스트 파일을 먼저 실행할 필요는 없다.
2. 기본 smoke는 report를 메모리에서 만들고 표·그래프를 표시하므로 반복 실행해도 기존 파일을 덮지 않는다. 파일 보관이 필요하면 `HUMAN_TIMING_B2_SMOKE_REPORT`에 새 경로를 지정한다.
3. 실제 Test 평가를 사용자가 선택할 때 **4번 Full 섹션**에서 `RUN_FULL = True`로 바꾸고 `FULL_OUTPUT`을 새 report 경로로 지정한다. 기본 경로는 `data/ml-experiments/human-timing-b2-test-evaluation/full-report-run1.json`이다.
4. Full 설정·실행 셀 뒤 **5번 결과 셀**을 실행한다. 세 scope의 표와 B2/관측 CDF·0ms·게임별 점수를 확인한다. 기존 report가 있으면 삭제하지 않고 다른 출력 이름을 쓴다.
5. 첫 full 계산의 반복 결정성을 확인할 때는 모델·dataset·계산 코드가 같은 상태에서 출력 경로만 새 이름으로 바꿔 재실행한다. 결과로 parameter나 제외 기준을 바꾸지 않는다. Source 파일의 output/설정 저장으로 파일 SHA가 바뀌면 provenance 차이와 계산 차이를 구분해 보고한다.
6. Full report와 실행 Notebook을 보존하고 결과 해석을 요청한다. 실행 성공과 source output/count 형식 검사는 다르다. 현재 기존 형식 검사 보류가 해결됐다고 간주하지 않는다.

## 구현·가상 smoke 검증 기록 — 2026-10-26

- 새 Python 테스트 **17개 통과**. 같은 bundle의 세 mask·fit 호출 금지·B2만 점수화·fallback·수치·입력 SHA/중복/누수·출력 보호·입력 변경 시 게시 금지·기본 full 비활성화·그래프를 검사했다. Full 경로 검사도 임시 가상 파일만 사용했다.
- 재사용 baseline 정의 셀 SHA는 `f1943f93868c31d03ff942b90a2a3effbd083f8b8801e3729848916bfba467fb`다. 실행 output/count를 제외한 정의 코드만 비교한다. Readiness 공유 코드도 원본 SHA를 실행 전에 확인한다. 기존 Notebook은 변경하지 않았다.
- 가상 3게임/6 pair → 제외 2게임/4 pair·단독 1게임/2 pair, 모든 scope fit 0·같은 bundle SHA다. 실제 Human/Test 결과가 아니다.
- `smoke-report-run2.json`/`smoke-report-run3.json`은 byte-identical이며 SHA `588c8449c70c35213f812d54c89fd1882d502269345254e6f500a69159ba3c6d`다. 보관 경로는 `data/ml-experiments/human-timing-b2-test-evaluation/`이다.
- `smoke-executed-run2.ipynb` headless error 0·그래프 2개·full skipped를 확인했다. 반복 smoke는 `.jsonl`과 실제 frozen report 열기를 금지한 guard 아래 통과했다. JSON 재로딩 후에도 전체 scope가 먼저 보이도록 표시 순서를 고정했다.
- `npm run verify:ml`: Node **35/35**, Python **201/204**. 실패 3개는 기존 baseline/dataset/0ms 진단 Notebook의 사용자 execution count/output 형식 검사다. 새 구현 검사는 통과했지만 전체 ML gate는 미통과다. 사용자 출력은 지우지 않았다.
- `bash scripts/verify.sh`: type/build/artifact와 Node **793 pass·기존 1 skip·0 fail**. 실제 Test·재학습·runtime·dependency 변경·stage/commit은 수행하지 않았다.
