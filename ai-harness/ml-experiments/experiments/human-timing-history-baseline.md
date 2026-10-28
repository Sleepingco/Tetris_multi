# ML Experiment: Human timing history baseline

## 질문과 상태

- Experiment ID: `human-timing-history-baseline`. 구현·사용자 Full Validation·결과 해석 완료. 현재는 timing 비교 기준으로 보존하며 새 실행 지시가 아니다.
- 질문: 직전 action만 쓰는 B2보다 **그 전에 끝난 입력 간격 하나**를 추가한 B3가 다음 기록 간격을 더 잘 설명하는가?
- 기존 B2 Test는 사용자 full을 완료했다. 33게임/9,859 pair game-macro CRPS `51.87103420312984`ms, 지정 게임 제외 `50.57872413031196`, 단독 `93.22495653330179`다. Report SHA `9962f54478a3d0d557756401e4683164b291ce0b752f33798157de19ce3f5833`. Fit 0·입력 checksum·집계 정합성을 확인했다. Production/freeze 채택은 아니다.
- 새 가설을 정하기 전에 기존 Test 결과를 관측했다. 이번 실험은 기존 Train/Validation 탐색만 수행하며 해당 Test는 열거나 새 후보의 독립 평가로 사용하지 않는다. 미래 최종 평가는 별도 미관측 cohort가 필요하다.

## 고정 입력과 변경 변수

- Dataset: `data/datasets/human-timing-v1-20261024-full`, manifest SHA `c203a1db7b8f2aa7014c565b371088a9614f6abb0df5632e93fe6c807712fc88`.
- 기존 Train 149게임/41,151 pair, Validation 31게임/10,180 pair와 split·모든 label·0ms·품질 정책을 유지한다. Dataset schema를 덮어쓰지 않고 메모리에서 문맥을 파생한다.
- B2: Train의 previousAction별 경험 분포, 미학습 action은 전체 Train 분포.
- B3: B2에 직전 완료 간격 bucket만 추가. Train에서 복원한 직전 간격의 nearest-rank 1/3·2/3 quantile을 경계로 고정한다. `bisect_right`로 경계와 같은 값은 오른쪽 bucket에 둔다. 같은 경계가 나와 빈 bucket이 생겨도 경계를 조정하지 않는다.
- Action×bucket의 Train label 경험 분포를 예측에 사용한다. 이력 없음/Train cell 없음은 B2, action도 없으면 B1 fallback. 최소 표본 threshold·smoothing·hyperparameter 탐색은 추가하지 않고 cell 표본 수를 보고한다.
- 바뀌는 것은 **과거 간격 하나의 조건 추가**뿐이다. 최근 행동열·다음 action 예측·신경망·개인화·Hold·게임 상태는 이번 범위가 아니다.

## 예측 시점과 이력 경계

입력 `a0 →(80ms) a1 →(?) a2`에서 현재 `previousAction=a1`, 과거 간격 `80ms`는 이미 관측됐고 `a1→a2` 간격이 label이다. 현재 label이나 미래 행동을 현재 feature로 사용하지 않는다.

- 동일 `(split, gameId, playerNumber, pieceIndex, sourceLine)` 안에서 직전 row의 `currentInputIndex`가 현재 row의 `previousInputIndex`와 같을 때만 연결한다.
- 이전 row의 `nextActionDiagnostic`과 현재 `previousAction` 일치는 연결 검사에만 쓰고 미래 action을 feature로 사용하지 않는다.
- 첫 pair·불량 pair로 생긴 index gap·서로 다른 source/piece/player/game/split은 연결하지 않는다. 원래 Hold 구간 제외 정책도 유지한다.
- 표본은 버리지 않는다. 연결되지 않은 표본은 이력 없음으로 B2 fallback한다. 동일 위치 중복·action 불일치는 중단한다.
- Validation의 과거 실측 간격은 순차 예측 시 이미 관측된 문맥으로만 사용한다. Teacher-forced one-step 평가이며 모델이 자기 출력으로 이어가는 rollout·사람다운 실제 실행은 검증하지 않는다.

## 평가와 판단

- Primary: 동일 Validation 전체의 game-macro CRPS 차이 `B3 - B2` (음수가 개선).
- Secondary: pair-micro CRPS, median 예측 MAE, game/action별 차이·개선/동일/악화·worst game.
- Diagnostics: 이력 있음/없음·첫 pair/gap 수, Train bucket 경계·cell 표본 수·fallback, 두 모델 CDF/0ms/평균·중앙값·p95.
- 모든 Validation pair와 history-available subset을 구분한다. Subset을 primary 대신 쓰지 않는다. 양쪽 모두 같은 평가 row를 사용한다.
- Full의 수치 차이가 ±`1e-12`ms 이내면 tie다. 자동 채택하지 않고 `needs_policy_decision`. Smoke는 성능 판단 불가다. 새 Test 실행·수집·재학습 확대·runtime 통합은 자동 시작하지 않는다.

## 산출물과 실행

- [Notebook](../../../scripts/ml/notebooks/human_timing_history_baseline.ipynb): 공통 정의 → 3번 가상 smoke 설정/실행/결과 → 4번 full 설정/실행 → 5번 full 결과 → 한계.
- [계약 테스트](../../../scripts/ml/tests/test_human_timing_history_baseline_notebook.py): 별도 실험 구현을 복사하지 않고 정의 셀을 실행한다. 제목·문자열 계약 검사도 유지한다.
- 기존 baseline 정의 코드 hash `f1943f93868c31d03ff942b90a2a3effbd083f8b8801e3729848916bfba467fb`와 readiness SHA를 실행 전에 검증한다. 기존 CRPS·로딩·경로 보호·게시를 재사용한다.
- 기본 모두 실행은 가상 smoke만 수행하고 실제 dataset을 읽지 않는다. 개발자가 확인하는 실제 smoke는 기존 Train 앞 5게임/Validation 앞 3게임, full과 같은 함수 경로다.
- Full은 `RUN_FULL=False` 기본이다. 사용자가 `True`로 바꾸고 4번 설정·실행·5번 결과를 실행한다. 기본 `FULL_OUTPUT`은 ignored `data/ml-experiments/human-timing-history-baseline/full-report-run1.json`. 기존 출력이 있으면 새 이름을 쓴다.
- 반복 결정성 확인 시 출력 이름만 바꾼다. Python 테스트를 먼저 실행할 필요는 없다. 결과는 pandas 표/Matplotlib 그래프다.
- Smoke/full report는 각각 범위·fit 횟수·code/input SHA·bundle·fallback·한계를 기록한다. `canonicalResultEligible=false`, `productionIntegration=false`를 유지한다.

## 허용 범위·검증·중단

허용 파일은 새 Notebook·테스트·이 명세 및 현재 안내/계획/결과 기록이다. 기존 Notebook과 사용자 output·dataset·원본 report·runtime·dependency는 변경하지 않는다. Commit은 별도 요청 사항이다.

Synthetic에서 인접 연결·gap/경계 비연결·현재 label 비사용·Train-only cutoff/fit·fallback·동일 평가 분모·CRPS/집계·결정성·Test open 금지·출력 보호·기본 full 비활성화·그래프를 검사한다. 새 코드 targeted와 실제 작은 smoke 뒤 최종 `npm run verify:ml`, `bash scripts/verify.sh`를 실행한다. 기존 source-format 실패는 사용자 출력을 지우거나 검사 약화로 해결하지 않는다.

SHA 변경·중복/누수·미래 문맥·Test open·입력 변조·비유한 값·출력 덮어쓰기면 중단한다. 긴 full은 사용자가 실행하며 이번 구현에서 실행하지 않는다.

## 구현·검증 기록 — 2026-10-27

- Notebook·계약 테스트를 작성했고 새 검사 16개는 최종 suite에서 모두 통과했다. 별도 Python 실험 모듈이나 dependency는 추가하지 않았다. 직접 파일 실행과 module/discovery 실행이 같은 fixture를 재사용하도록 저장소 root를 찾는다.
- 실제 작은 smoke는 Train 5게임/1,223 pair·Validation 3게임/1,167 pair다. Train 이력 있음/없음 1,042/181, Validation 989/178이며 누락 없이 모든 pair를 평가했다. Train 경계는 112/175ms다. B2/B3 game-macro CRPS 56.2103/53.5181ms는 작은 smoke의 관측치일 뿐 채택 근거가 아니다.
- 최종 `smoke-real-run3.json`/`smoke-real-run4.json` report는 byte-identical, SHA `b5176a803bdcc396cc5608b25ddd366cc7d9c37e7664c3b6ba80081dad5fea4e`다. Ignored `data/ml-experiments/human-timing-history-baseline/`에 보존했다. Test/raw open 금지 guard를 적용했다.
- 가상 headless Notebook은 오류 0, 표 5개와 3-panel figure 1개이며 기본 full skipped를 확인했다. 최초 kernel 이름 미설치 오류는 기존 환경의 `python3` kernelspec으로 metadata를 맞춰 재실행 후 해소했다. 패키지/kernel 등록은 변경하지 않았다.
- 필수 verify: 793 pass·기존 1 skip·0 fail. `verify:ml`: Node 35/35, Python 215/220로 **전체 미통과**다. 기존 source 형식 실패 4개와, 사용자가 B2 source의 full을 켠 상태여서 발생한 기존 report 덮어쓰기 방지 오류 1개다. 기존 source/output/설정을 임의로 수정하지 않았다.
- 실제 full Train/Validation fit·Test 재평가·runtime·stage/commit은 수행하지 않았다. Source output/count는 비어 있고 실제 full report는 아직 없다. 전체 ML gate 보류와 새 smoke 통과를 구분한다.

## 사용자 Full 결과와 계획 판단 — 2026-10-27

위 구현 기록 이후 사용자가 Full을 실행했다. 아래는 저장 결과의 해석이며 재학습·재평가가 아니다.

- Report: `data/ml-experiments/human-timing-history-baseline/full-report-run1.json`
- SHA-256: `601a55ac229c70c2ddf5ba6cf2dcb2e024597c543d284cfce2f72a0d25d6fd12`
- Train 149게임/41,151 pair, Validation 31게임/10,180 pair. 입력 checksum·cohort·집계 정합, 누수 0, evaluation fit 0, Test read/evaluation false.
- Train 경계 128/176ms. Validation 이력 있음 8,667 / 시작 이력 없음 1,513이며 이력 없음은 B2와 같은 예측이다.

| 지표 | B2 | B3 |
| --- | ---: | ---: |
| Game-macro CRPS (ms) | 53.028141 | 49.742622 |
| Pair-micro CRPS (ms) | 52.884764 | 49.711553 |
| Median 예측 MAE (ms) | 72.369450 | 67.873183 |

Primary delta는 -3.285519ms, 약 6.20% 개선이다. 26게임 개선/0동일/5악화이며 회전 action의 micro CRPS는 56.450→56.348ms로 차이가 작다.
이 결과는 과거 간격의 조건 정보가 유용하다는 근거다. Human 과거를 제공한 one-step 예측이며 상황 판단·첫 행동 대기·Hold·자체 실행·개인화는 검증하지 않았다.
Full 반복 결정성은 이번 단일 report로 증명하지 않는다. 앞선 smoke 두 번 일치와 구분한다.

사용자 요청에 따른 계획 판단은 **B0~B3를 상태를 보지 않는 기준선으로 보존하고 상황 조건부 행동 모방으로 전환**하는 것이다.
원본 report의 상태/bytes는 바꾸지 않는다. B3의 영구 채택·production 승격·새 Test 실행은 없으며
다음은 [AI 계획의 관측 연결 확인](../../../docs/ai-ml/strategy/ai-plan.md#다음-한-작업-행동-직전-관측-연결-가능성-확인)이다.
사용자가 실행한 source Notebook과 기존 ML 전체 gate 보류도 그대로 보존한다.
