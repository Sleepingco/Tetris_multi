# ML Experiment: 배치 ID 분류와 공유 후보 점수화 비교

## 1. 질문과 현재 권한

- Experiment ID: `human-placement-candidate-scoring`
- Lifecycle: `analysis_complete`; 사용자 Coverage/모델 비교 Full 검토를 완료했다(2026-11-09). 결론은 `candidate_scoring_signal_observed`이며 다음은 [공유 scorer 조기 종료](human-placement-candidate-early-stopping.md)의 사용자 Full이다. 아래 미실행·차단 기록은 당시 이력이다.
- 질문: 기존 보드 snapshot에서 Human 배치를 예측할 때, Train 배치 ID 분류보다 **보드와 각 후보를 함께 읽는 공유 scorer**가 더 잘 일반화하는가?
- 모방 정답은 Human `selectedPlacement`다. 휴리스틱 정답·점수·승자 선별을 사용하지 않는다.
- 이 비교는 전체 AI의 모듈형/통합 신경망 선택과 독립적이다. V4125게임 모델 재사용·조작/시간/Hold·runtime 통합을 승인하지 않는다.
- 기존 [snapshot 기준선](human-placement-snapshot-baseline.md), [학습곡선](human-placement-game-count-learning-curve.md), [희소성 진단](human-placement-input-target-audit.md)을 재사용한다. 새 로그 수집·재감사를 반복하지 않는다.

## 2. 왜 이 실험인가 — 작은 예제

기존 분류기는 Train에서 본 배치 key만 출력할 수 있다. Validation 정답152/1516개는 그 어휘에 없었다. 공유 scorer는 후보마다 같은 함수를 적용하므로 **처음 보는 절대 배치 key도 입력 후보에 있으면 점수화**할 수 있다. 가능성이 생긴 것이지 정답을 잘 고른다는 보장은 아니다.

```text
같은 보드와 조각
  후보 생성: P, Q, R — 정답을 보지 않고 구성
  Human 정답: Q — 생성 완료 뒤 label로 연결

ID 분류: Train 어휘에서 점수 계산 → P/Q/R 중 알려진 key만 비교
공유 scorer: f(보드, 조각, P), f(보드, 조각, Q), f(보드, 조각, R)
             → 같은 함수를 적용해 가장 높은 후보 선택
```

Q가 후보에 없으면 추가하지 않고 후보 지원 실패로 남긴다. Q가 후보에는 있지만 Train 어휘에 없다면 ID 방식은 Q를 선택할 수 없고 scorer는 점수화할 수 있다.

## 3. 데이터와 입력·정답 경계

- 고정 dataset: `data/datasets/human-placement-action-offline-v1-20261102-run1`.
- SHA-256: manifest `9ae27fc0b85903f412b434f5667e51376e7d5bb3170d3bab3d439f0e415f28bf`, Train `535e87540b5d9983b4065df2904df5702f13aa7ba40df640f6fcb7dfa332c08c`, Validation `e2d598e4792f523e32b599b152d2adde8dd53568c6ade91af4c78a1a604a303e`.
- 기존 적격 Train149게임/6417구간·Validation31게임/1516구간을 시작 분모로 고정한다. 기존 품질·승패 무관 Human 정책·Hold 보류·game split을 유지한다. PVP 양쪽은 같은 game split이다.
- Test33은 manifest ID 경계만 확인한다. Test/raw/rejected/DB payload는 열지 않는다. 새 보드·상태·첫 행동 대기·공격 관측을 추정해 붙이지 않는다.
- 모델의 관측은 boardBefore20×10 점유와 pieceType뿐이다. candidate의 셀은 정답이 아니라 모든 가설에 같은 방법으로 제공하는 **선택지**다.
- 최종 activePiece의 row/col/rotation/cells, Human 행동열·목표·시간·boardAfter·성과·승패·ID는 모델 입력이나 후보 생성 출발점으로 사용하지 않는다.
- Human 정답은 기존 physical key로 연결한다. 색상·rotation/pivot alias는 별도 정답으로 늘리지 않는다. Input/label 분리는 [연결 계약](../../../docs/ai-ml/contracts/human-placement-action-link.md)을 따른다.

## 4. 후보 계약 — 도달 경로가 아닌 정적 snapshot 선택지

현재 [reachable planner](../../../src/client/game/ai/heuristic/reachablePlacementPlanner.ts)는 정확한 출발 row/col/rotation이 필요하다. 기존 최종 activePiece를 출발점으로 쓰거나 spawn을 임의 추정하면 누수/지원 범위 혼동이 생긴다. 따라서 이번 비교에는 사용하지 않는다.

후보 이름은 `snapshot_static_supported_cells_v1`로 고정한다.

1. 기존 [조각 정의](../../../src/client/game/state/blocks.ts)와 [placement 정규화·충돌 검사](../../../src/client/game/ai/heuristic/placementGenerator.ts)를 재사용한다. 회전별 offset에서 네 셀이 보드 안에 드는 유한 pivot 범위를 계산한다.
2. 모든 회전·pivot을 열거한다. `canPlacePlacement(board, type, rotation, col, row)`가 true이고 같은 placement의 row+1 검사가 false인 위치만 유지한다. 보드 아래 경계도 기존 검사로 처리한다.
3. 네 occupied cell을 정렬한 physical key로 alias를 묶는다. Unicode code-point key 순서로 정렬하고 대표 pivot은 별도 결정적 순서로 고른다. key에 정답 여부·heuristic score를 넣지 않는다.
4. 후보 생성 함수는 selectedPlacement를 인자로 받지 않는다. 생성이 끝난 뒤 정답 key 포함 여부를 검사한다. 정답 변경에 대해 후보 목록이 불변이어야 한다.
5. 이는 **현재 core geometry를 legacy snapshot에 적용한 비충돌·하방 이동 불가 선택지**다. 떠 있는 구멍 안의 도달 불가 위치가 포함될 수 있다. 과거 관측 시점·historical ruleset 재현·spawn에서의 reachability·game-over 안전성·현재40행 지원을 증명하지 않는다.
6. Python에 회전·충돌·낙하 규칙을 다시 쓰지 않는다. Coverage Notebook만 기존 Node24/core를 호출한다. 모델 비교 Notebook은 검토 완료한 candidate evidence를 SHA로 고정해 재사용하며 Node/후보 생성을 다시 실행하지 않는다. Node는 학습·평가·휴리스틱 선호를 구현하지 않는다. 새 JS/TS CLI를 만들지 않는다.

## 5. 먼저 확인할 gate — fit 없는 후보 지원도

후속 구현의 첫 실제 실행은 후보 지원도 집계다. 모델을 fit하기 전에 그 report를 검토한다.

- 구간별 candidate 수, distinct physical class 수, 정답 포함 여부·정규화 불일치·후보0·후보1·후보2개 이상을 기록한다.
- Train/Validation 각각 game·piece·기존 target OOV 여부별 coverage와 사유를 pandas 표/Matplotlib으로 표시한다. 원래 분모·공통 선택 필요 분모·그룹별 누락 수를 모두 보존한다.
- 생성 코드/core·조각 정의 SHA, source definition SHA·dataset checksum, 구간 ID/후보 key 순서와 후보 evidence SHA를 보존한다.
- 정답이 없는 표본을 삭제하거나 후보에 끼워 넣지 않는다. 값 변경·새 core fallback·20→40 padding/crop으로 지원도를 높이지 않는다.
- 지원도가 낮거나 특정 게임/조각에 편중되면 해당 한계를 먼저 보고한다. threshold를 결과에 맞춰 정하지 않는다. 이 단계 report는 `candidate_coverage_requires_review`, `modelFitCount=0`, `policyDecisionEligible=false`다.
- Coverage 결과 검토 전 모델 Full은 차단한다. 검토 후 학습 허용 구간 ID와 사유를 고정하고, 무단 재분할·반복 cohort 선택을 하지 않는다. 새 수집을 선행 조건으로 요구하지 않는다.

## 6. coverage 검토 후 비교할 세 출력

아래 학습 설정을 실제 모델 비교 Notebook에 구현하고 사용자 Full 결과를 검토했다. 아래 조건은 재현 계약이며 Full을 자동 재실행하지 않는다.

| 이름 | 학습 | 평가 출력 | 역할 |
| --- | --- | --- | --- |
| `id_unmasked` | 기존 board_piece ID 분류기 | 같은 piece의 Train 어휘 전체 | 이전 방식 진단 |
| `id_candidate_masked` | 위와 **같은 weight**, 추가 fit 없음 | 생성 후보와 Train 어휘의 교집합 | 후보 제약만의 효과 |
| `shared_candidate_score` | 보드·piece·후보 셀을 읽는 하나의 이진 MLP | 생성 후보 전체의 score 순서 | Train에 없던 key도 점수화 |

- 학습 공통 cohort는 후보2개 이상이고 Human 정답이 포함된 Train 구간이다. ID 분류기와 scorer 모두 같은 구간을 사용한다. Singleton은 대안 선택을 가르치지 않으므로 학습 양쪽에서 제외하고 count를 기록한다. Validation으로 어휘·scaler·학습 구간·하이퍼파라미터를 정하지 않는다.
- ID 분류기는 기존207차원·ReLU64·Train-only 어휘/StandardScaler를 재사용한다. 원래6417구간과 학습 cohort가 다르면 과거13.42%의 재현이라고 부르지 않는다.
- Scorer는 `[board occupancy200, piece one-hot7, candidate occupancy200]` 총407차원 → ReLU64 → 이진 출력이다. 보드와 후보를 함께 읽는 비선형 상호작용을 허용한다. 후보 key 자체·Human 정답 플래그는 feature가 아니다.
- Scorer의 label은 해당 후보가 Human 선택 class인지다. 구간별 positive 총 weight1/2, 나머지 후보 전체 weight1/2로 배분한다. 별도 후보/alias가 많은 구간이 과대표집되지 않게 구간 총합1을 확인한다. Alias grouping 뒤에 weight를 계산한다.
- B scaler는 Train 후보만 사용하고 후보별1/K의 label-independent weight로 구간을 균등 반영한다. constant scale은1. 설치된 sklearn1.9.0의 `MLPClassifier.partial_fit(sample_weight=...)`와 `StandardScaler.fit(sample_weight=...)`를 확인했다. 내부 검사로 Train 입력·weight 전달을 검사하며 지원이 없으면 중단한다. MLP의 L2 항은 minibatch weight 합으로 나뉘므로 같은 alpha가 같은 유효 규제를 뜻하지 않는다. 총 weight1 계약을 몰래 rescale하지 않는다.
- 두 모델은 seed1729, Adam lr0.001, alpha0.0001, batch128,30개 전체 pass·BLAS1을 출발 설정으로 한다. 별도 Smoke 모델 학습·early stopping·Validation tuning은 없다. 최대 총2 fit이다. Candidate row 증가에 따른 업데이트·표본 노출·파라미터 수·시간 차이는 반드시 보고한다. 계산량 동등 실험은 아니다.
- Score는 이진 log-odds(동등한 순서의 positive 확률도 가능)이며 후보 집합 전체에서 calibrated 선택 확률이라고 주장하지 않는다. 정렬 tie는 physical key Unicode 순서다. ID 후보 교집합이 비면 선택 불가이지 heuristic fallback이 아니다.
- 비교 단위는 **ID 분류 formulation과 공유 후보 점수 formulation**이다. 입력 크기·출력층·목적함수·학습 행 구성도 달라지므로 개선을 “출력 ID만 바꾼 단독 인과”로 해석하지 않는다. Candidate mask 대조가 후보 제한 효과 일부를 분리한다.

## 7. 평가와 사전 판단

- Primary: 동일한 Validation 선택 필요 구간(후보2개 이상·정답 포함)에서 `shared_candidate_score - id_candidate_masked`의 game-macro Top-1 차이. 유효 구간이 없는 game 수를 명시한다.
- Secondary: 같은 분모의 Top-3/MRR·게임별 delta·조각별 결과, Train/Validation 간 격차, known/OOV target별 결과와 score tie. NLL은 각 모델 정의·분모에 맞춰 따로 보고하며 이진 BCE와 다중분류 NLL을 직접 비교하지 않는다.
- 원래1516개 전체 기준 후보 정책 Top-1/Top-3/MRR도 별도 표시한다. 후보0/정답 미포함 등 미지원은 두 후보 정책 모두 실패0이며 원래 분모에 남긴다. 후보1개 자동 선택은 별도 집계해 학습한 선택 능력으로 과장하지 않는다. 모든 table/graph에 subset·game 수·구간 수를 표시한다.
- 기존 어휘에 없는 target에도 score를 낼 수 있다는 coverage 개선과 올바르게 고르는 능력을 구분한다. 과거 V4 수치와 직접 비교하지 않는다.
- Primary delta>1e-12이고 같은 분모 MRR delta≥-1e-12면 `candidate_scoring_signal_observed`; Top-1만 개선하면 `candidate_scoring_tradeoff_requires_review`; 아니면 `no_clear_candidate_scoring_gain`이다. 작은 부호 차이는 우월성·유의성·제품 승격 근거가 아니다.
- 어떤 결과도 모듈형 채택·통합 신경망 기각·강한 gameplay AI·Human 전체 controller 완성으로 자동 전환하지 않는다. Validation 재사용과 단일 seed의 개발 증거로 한정하고 후속 판단은 `needs_policy_decision`이다.

## 8. 후속 구현·검증 범위

- Source는 두 Notebook으로 분리한다. [coverage](../../../scripts/ml/notebooks/human_placement_candidate_scoring.ipynb)는 사용자가 실행한 출력·설정과 과거 차단 셀을 그대로 보존한다. 새 [실제 모델 비교](../../../scripts/ml/notebooks/human_placement_candidate_model_comparison.ipynb)는 재사용 정의 → 내부 assert → **모델 비교 Full 설정/실행/결과** → 저장 결과 읽기 → 한계 순서다. 과거 coverage의 모델 스위치를 켜지 않는다.
- 새 모델 Notebook은 `RUN_FULL=False`, report 초기값 None, 빈 source output/count로 제공한다. 기존 snapshot 정의를 SHA로 고정해 재사용하며 새 `.py`/Python test/dependency·runtime 파일을 늘리지 않는다. 기존 제목·문자열 계약 테스트를 유지한다.
- Full-only: 작은 성능 Smoke 학습은 없다. 내부 가상 assert는 후보의 정답 독립성·alias/순서·원본 불변·false 입력/NaN·weight 합·OOV/미지원 분모·동점·output 보호를 검사한다.
- 기존 shared parser·physical key·metric·report 보호는 definition SHA를 고정해 재사용한다. Source/core/dataset·기존 보고서는 전후 불변이어야 한다. model artifact는 아직 내보내지 않는다.
- 산출물은 ignored `data/ml-experiments/human-placement-candidate-scoring/`의 새 경로에만 게시한다. candidate evidence와 coverage report/model comparison report를 분리하고 기존 파일·alias·symlink·hardlink 충돌을 쓰기 전에 거부한다.
- Report에 `canonicalResultEligible=false`, `productionIntegration=false`, `inferenceEligible=false`, `wholePolicyEvidence=false`, `historicalRulesetVerified=false`, `reachableCandidatesGenerated=false`를 유지한다. 정적 충돌/착지 검사를 전체 합법성으로 부르지 않는다.
- 구현 후 `npm run verify:ml`·`bash scripts/verify.sh`와 내부 경계 검사를 수행한다. 명세 작성 당시 문서 검사와 이후 Notebook 구현 검증 결과는 아래에 구분한다.
- Stop: checksum/source drift, game leakage, selected/final pose가 후보 생성에 개입, 정답 주입, 비결정 순서, weight 무시, 실제 Full 자동 실행, 허용 밖 변경. 중단 사유를 숨기는 fallback은 금지한다.

## 9. 현재 마감과 다음 gate

2026-11-04: 코드 caller·core 후보 경계와 기존 실험 계약을 확인하고 명세만 작성했다. 실제 dataset payload·후보 생성·모델 fit·Full·runtime·Git stage/commit은 수행하지 않았다.

명세 작성 당시 다음 단계는 Notebook 구현·짧은 내부 assert였으며 아래 구현 기록으로 완료했다. 첫 실제 Full은 학습 없는 후보 지원도이고 결과 검토 뒤 모델 비교를 별도 구현/실행한다. 명세·환경변수만으로 실행 권한이 생기지 않는다.

### Notebook 구현·검증 (2026-11-04)

- Notebook18개 cell·고유 ID·빈 source output/count, 설명→작은 예제→공통 정의/core 경계→내부 검사→Coverage Full→결과 읽기→차단된 모델 Full→한계를 구현했다. 기존 snapshot 정의 SHA를 고정해 parser/loader/physical key·report 보호를 재사용한다. Python 게임 규칙은 추가하지 않았다.
- Node24.18 이상/25 미만에서 기존 TS core를 직접 호출한다. Python→Node payload는 board 점유·pieceType 두 필드뿐이다. 최대64개 snapshot/batch와 timeout을 적용하고 상대 import closure의 파일 SHA를 전후 대조한다. Label/final pose/heuristic score는 보내지 않는다.
- Evidence는 새 JSON 배열 파일로 streaming 기록하고 독점 게시한다. Report는 마지막 완료 표시다. 임시 파일은 정리하지만 게시 경쟁으로 evidence만 남을 수 있으며 이를 완료로 처리하거나 기존 파일을 지우지 않는다. 두 출력은 새 이름으로 재시도한다. Evidence SHA를 report에 기록하되 실행별 파일 경로는 canonical 내용에서 제외한다.
- Key 형식/정규화 불일치는 집계에서 제외하지 않고 중단한다. Target 부재는 `target_not_in_static_set`으로 기록하며 geometry 오류·나쁜 label의 원인을 단정하지 않는다. Baseline OOV는 기존 전체Train2133종 기준이며 future candidate-eligible Train 어휘가 아니다.
- 가상 빈 보드 square9class/alias4·bar17class·가득 찬 보드 후보0, 정답 변경 후보 불변·잘못된 입력/NaN·singleton/미지원 분모·출력 alias/symlink/hardlink/기존 파일 보호를 확인했다. 가상3구간을 같은 게시 경로로 처리해 evidence/report 결정성·SHA·flag 변조 거부를 확인했다. 이는 Human Full이 아니다.
- 기본 전체 코드 cell을 실제 `load_snapshots`·MLP fit/partial_fit·StandardScaler fit 차단 상태에서 통과시켰다. Synthetic pandas4표·Matplotlib2패널을 확인했다. Source schema/구문·ID/빈 출력, `npm run verify:ml` Node35/35·Python220/220, 기본 verify802 pass·기존1 skip·0 fail이다. 최초 localhost EPERM은 권한 재실행으로 해소했다.
- 이번에는 실제 dataset payload·후보 지원도 Full·모델 학습·gameplay·stage/commit을 수행하지 않았다. Model Full은 `COVERAGE_REVIEW_REQUIRED_MODEL_COMPARISON_NOT_IMPLEMENTED`로 차단된다. 위 모델 설정은 아직 비교안이며 sample-weight API 검증도 그 구현 단계에서 수행한다.

### Coverage Full 검토와 실제 모델 구현 (2026-11-09)

- 사용자 Full의 Train6417/Validation1516구간 모두 정답 후보 포함률100%다. 후보0·singleton·제외0, physical 후보 행147450/34552, Validation의 기존 ID OOV152개도 모두 포함됐다. 같은 Train149게임/Validation31게임을 학습·비교 분모로 고정한다.
- Coverage report SHA: `c6575ebaa63744cd2891096bb9ad37cf3d6206b488bf65ca038d8df29e861d8d`; candidate evidence SHA: `fcad6113509eab114f3a1639ef59b6f26071df22edf8d17273fa21c43026b684`. Coverage 계산 정의 SHA는 사용자 실행본의 `d3846c88f1f6656536e5f0247ac87e0ae61156145d1baf61aefa53e2786a1e18`이다. 후속 코드는 coverage Notebook을 실행하지 않고 저장 evidence와 당시 core SHA를 검증한다.
- 기존 ID 모델과 후보 scorer를 각각30epoch 실제 학습하는 경로를 구현했다. `id_candidate_masked`는 첫 ID 모델의 같은 확률을 재사용하므로 실제 fit은2개다. ID 최종 지표·30epoch 손실/지표가 과거 report와1e-12 이내로 재현되지 않으면 B 학습 전에 중단한다. 비교 미구현 예외나 가상 모델 성능으로 대체하지 않는다.
- 기본 전체 실행은 실제 data load·MLP/Scaler fit 차단 상태에서 통과했다. 짧은 가상 검사는 fit 호출·Train-only scaler·decision-balanced weight·OOV/동점/NaN·출력 보호·report 집계/변조를 확인한다. 실제 read-only preflight는7933개 evidence/label 연결·checksum을 검증하고 각 split 첫2구간 배열만 구성했다. 모델 학습은 하지 않았다.
- 결과는 pandas4표와 Matplotlib3패널이다. ID Train/Validation known-target NLL, scorer Train/Validation balanced BCE와 배치 Top-1을 별도로 표시한다. 파라미터 수·노출 행·업데이트 수를 report에 기록하고 실제 fit/epoch 측정 소요 시간은 non-canonical Notebook 출력으로 남긴다. 계산량/목적함수/유효 L2가 다른 formulation 비교이며 구조 하나만 바꾼 인과 주장은 하지 않는다.
- 검증: `npm run verify:ml` Node35/35·Python220/220, `bash scripts/verify.sh` Node802 pass·기존1 skip·0 fail. 기존 coverage Notebook과 report/evidence는 보존했고 새 Full·Test payload·runtime·stage/commit은 실행하지 않았다.

### 이전 모델 비교 실행 방법 (완료 이력)

2026-11-09 scaler 수정: 사용자 실행은 ID30epoch/기준선 재현을 통과한 뒤 `BOARD_PIECE_SCALER_WEIGHTING_CHANGED`로 중단됐다. 같은 Train6417개를147450후보로 반복해1/K 가중 집계하면 평균 누적 오차가 약1.34e-12로 기존1e-12 검사를 넘는다. scaler mean/scale 통계 대조에만 atol1e-10·rtol0을 적용하고 차이를 오류에 표시한다. 실제 통계 변경/NaN은 계속 거부한다. 모델 metric·ID 기준선 재현 허용오차1e-12와 weight 계약은 변경하지 않는다. 사용자 실행 출력/count·Full=True는 보존했으므로 현재 파일은 Git용 초기 source가 아닌 로컬 실행본 상태다. 수정 전 traceback은 이전 실행 기록이며 Notebook을 다시 열고 커널의 정의를 재실행해야 수정이 적용된다. Full 학습은 대신 실행하지 않는다.

수정 검증: 실제 Train147450/Validation34552 후보 행렬의 scaler-only 재현에서 mean 최대1.3399281684201014e-12·scale 최대9.489631302983526e-13이며 새 검사를 통과했다. 내부 경계·실제 통계 변경/NaN 거부, ML Node35/35·Python220/220, 기본 verify802 pass·기존1 skip·0 fail이다. 최초 localhost EPERM은 권한 재실행으로 해소했다. 자료 SHA와 기존 사용자 출력은 보존했고 모델 학습은 실행하지 않았다.

1. `tetris-ml` 커널로 **[새 모델 비교 Notebook](../../../scripts/ml/notebooks/human_placement_candidate_model_comparison.ipynb)**을 연다. Node 설정과 coverage 재실행은 필요 없다.
2. 4절에서 `RUN_FULL=True`로 바꾸고 `FULL_REPORT_PATH`를 아직 없는 `.json` 경로로 지정한다. 기본은 `data/ml-experiments/human-placement-candidate-scoring/model-comparison-run1.json`이다. 기존 파일이면 run2 등 새 이름을 쓰며 덮어쓰지 않는다.
3. 위쪽 정의·내부 검사와 4절 설정→실행→결과를 실행한다. 실제 ID30epoch → 기준선 재현 검사 → 공유 scorer30epoch → 같은 Validation 집계 순서다. 두407차원 배열만 약565MiB이며 파싱/전처리/학습 메모리는 더 크다. 별도 Smoke 모델 fit은 없다.
4. 결과만 다시 볼 때는 `RUN_FULL=False`로 두고 5절 `REPORT_TO_READ`에 생성 report 경로를 지정한다. 별도 Python 파일/테스트 실행은 필요 없다.
5. 실행본은 ignored 실험 폴더에 따로 보존하고 source 스위치를 다시 False로 둔다. Full 결과를 해석한 뒤 다음 gate를 결정한다. 새 학습·구조 채택·runtime·commit을 자동 시작하지 않는다.

### 사용자 모델 비교 Full 검토 (2026-11-09)

- `model-comparison-run1.json` SHA-256: `16efde71ae0a783b9e99b9960c36736385d399920031b3431a8cbcc41f9731b7`. Source/자료 SHA·집계·실제1516개 ID·후보 포함·기준선30epoch 재현을 검증했다. Warning/leakage0, 실제 model fit2다.
- 동일31게임 game-macro Top-1/Top-3/MRR: ID `0.134209 / 0.250533 / 0.231145`; 후보 제한 ID `0.250763 / 0.473399 / 0.407478`; 공유 scorer `0.435648 / 0.749480 / 0.614303`.
- 공유 scorer가 후보 제한 ID보다 Top-1 +18.49%p다. 게임별 Top-1 개선30/동일1/악화0, MRR 개선31게임이다. Micro Top-1은699/1516이며 기존 OOV152개 중41개를 맞혔다. 계산량/행 구성/목적함수도 달라 출력층 변경만의 인과로 단정하지 않는다.
- 공유 모델 Train/Validation micro Top-1 `75.36% / 46.11%`, BCE `0.228669 / 0.995475`; Validation BCE 최소는3epoch의 `0.444628`이다. 과적합은 남아 있으며3epoch를 사후 최종 모델로 채택하지 않았다. 다음은 Train 내부 게임만으로 종료 예산을 정하는 [조기 종료 명세](human-placement-candidate-early-stopping.md)다. 증강·신규 수집·runtime은 없다.
