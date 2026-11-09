# AI 실험 경과·결과·한계 보고서

기준일: 2026-11-04 (Asia/Seoul). 작성 목적은 완료한 실험의 근거와 미검증 범위를 한 문서에서 구분하는 것이다. 새 학습·평가·수집·모델 채택 보고서가 아니다.

## 1. 요약 결론

**Human 로그로 배치 선택·조작·시간을 학습할 수 있다는 부분적 근거는 확보했다. 그러나 사람처럼 스스로 플레이하는 전체 정책이나 휴리스틱보다 강한 AI를 완성했다는 근거는 없다.**

| 질문 | 현재 판단 |
| --- | --- |
| Human 배치 선택에 예측 가능한 신호가 있는가? | 있음. 과거 V4 temporal 평가와 현재 snapshot의 보드 정보 비교에서 각각 관측 |
| 행동 이력·배치 목표가 다음 조작을 설명하는가? | 있음. 직전 행동 조건과 정답 목표 조건에서 개선 관측 |
| 기록된 조작 간격을 분포로 설명할 수 있는가? | 있음. B0보다 B1/B2, 같은 Validation에서 B2보다 B3의 CRPS 개선 |
| 현재 모델이 배치·조작·리듬을 하나로 학습한 통합 신경망인가? | 아님. 독립된 부분 모델 실험이며 전체 자율 정책 미완성 |
| 현재 배치 신경망의 일반화가 충분한가? | 아님. Train/Validation 격차·닫힌 어휘·희소성이 큼 |
| V4가 휴리스틱보다 게임을 잘하는가? | 입증하지 못함. 고정 생존 screening은 경계에서 통과했지만 생존·보드 지표가 불리했음 |
| 모듈형 또는 통합 신경망 중 방향을 확정했는가? | 아님. 두 구조는 미채택 후보. 현재는 제한된 후보 점수화 비교 명세만 작성 |

이 보고서에서 “성공”은 **구현 정합성**, **오프라인 예측 신호**, **자체 실행/게임 성능**으로 나눈다. 앞의 둘이 통과해도 마지막을 통과한 것은 아니다.

## 2. 범위와 증거 수준

- 과거 연구: 13/26게임 LOGO, occupied-cell alias, V0~V4 weighting, temporal holdout,125게임 trainer, inference/PVE 경계, gameplay screening.
- 현재 연구: Human 자료 적합성·품질·0ms, timing B0~B3, 다음 행동/시간 공동 기준선, placement/action view, 목표 조건 신경망, snapshot 배치 신경망, 정규화·스케일링·학습곡선·입력/정답 진단.
- 작성 시 최근 Full report8개를 읽고 SHA-256와 표의 수치를 대조했다. Raw·운영 DB·Test payload를 새로 열거나 모델을 fit하지 않았다. 과거 Test 결과를 인용한 것은 새 Test 실행이 아니다.
- 오래된 V4 결과는 tracked 명세·run record·변경 이력을 근거로 인용했다. 명세상 로컬 `placement-v4-pve-gameplay-benchmark/full-report.json`, frozen50게임 report,125게임 model 경로는 이번 확인 시 존재하지 않았다. 다른 archive 전체를 수색하지 않았으므로 “유실”로 단정하지 않는다. 원본 바이트 재검증과 과거 기록 인용을 구분한다.
- 과거 문서에 “코드 준비/다음 Full/ML gate 보류”가 남은 것은 작성 당시 이력이다. 현재 상태는 최신 결과와 이 보고서·[AI 계획](../strategy/ai-plan.md)을 우선한다. 문서의 다음 단계는 자동 실행 권한이 아니다.

## 3. 학습 목표·데이터 계보

목표는 여러 Human의 **어디에 놓는가 + 어떻게 조작하는가 + 어떤 간격으로 움직이는가**를 모방하는 것이다. 특정 개인 복제·최적 행동 학습·승률 극대화와는 다르다.

### 3.1 자료는 같은 게임 수로 비교할 수 없다

| 자료/용도 | 범위 | 주의점 |
| --- | --- | --- |
| 과거 placement V4 |26→75→125게임 확장 | 후보별16-feature ranking. 현재 snapshot 분류와 후보·분모가 다름 |
| Human 게임 품질 감사 |246게임 중213포함·22격리·11 Human 없음 제외 | 사용자 승인 quality-policy-v1. 원본 보존 |
| Timing v1 |213게임·61,190 pair | Train149/41,151 pair, Validation31/10,180, Test33/9,859 |
| Placement/action offline view |Train+Validation180게임·7,959구간 | Test33 제외. 부모8,929구간 중 Hold970구간 보류 |
| 현재 placement 공통 적격 |Train149게임/6,417구간, Validation31게임/1,516구간 | 원래 view의 Train23·Validation3개 부적격 구간은 기존 정책대로 분리 |
| 목표 조건 행동/시간 |Train47,537행동·41,120시간, Validation11,691행동·10,175시간 | Timing v1 pair 전체와 다른 공통 적격 view. 첫 행동/BOS 처리도 구분 |

Game은 독립성에 가까운 평가 그룹이고, 구간은 조각/조작 단위이며, pair는 두 후보 또는 두 인접 행동 사이의 학습 표본이다. Pair가 많다고 같은 수의 독립 게임을 확보한 것은 아니다.

### 3.2 어떤 사람 기록을 사용하는가

- PVE는 Human만, PVP는 양쪽 Human을 승패와 무관하게 후보로 삼는다. **PVP 패자 자료는 이미 포함하는 정책**이다. 같은 자료 재추가는 데이터 증가가 아니다.
- 품질 검토는 조기 포기·하드드롭 반복 tail·비정상 장시간/AI 단독 tail 등 기록 신뢰성을 다룬다. 짧은 정상 패배 자체를 불량이나 나쁜 배치로 취급하지 않는다.
- 30초 검토·600초 상한·끝5조각·AI tail60초 등은 승인된 운영 기준이지 보편적인 정상 경기 법칙이 아니다. 정상적인 극단값도 일부 제외될 수 있어 편향을 보고한다.
- Game 단위 split을 유지하며 PVP 두 사람을 다른 split에 넣지 않는다. 게임 분리는 사용자 분리와 다르므로 신규 사람 일반화/개인화 검증으로 확대하지 않는다.
- 원본·격리 자료·split은 보존한다. 현재 신규 수집·DB payload 확장은 취소된 상태다.

근거: [Human dataset 계약](../contracts/human-action-dataset.md), [placement/action 연결 계약](../contracts/human-placement-action-link.md).

### 3.3 지표를 읽는 기준

- Top-1/Top-3는 정답이 예측1위/상위3개에 있는 비율, MRR은 정답 순위의 역수 평균이다. 높을수록 좋다. Accuracy는 행동 class 정답 비율이고 F1은 행동별 precision/recall을 함께 본다.
- NLL은 정답에 부여한 확률의 손실이다. 낮을수록 좋지만 Top-1 개선과 반드시 같은 방향은 아니다. 후보 공간·분모·목적함수가 다르면 숫자를 직접 비교하지 않는다.
- Game-macro는 게임별 점수를 같은 비중으로 평균한다. Segment/pair-micro는 모든 표본을 합쳐 긴 게임의 영향이 커진다. “Macro F1”의 행동 class 평균과 “game-macro”의 게임 평균은 다른 평균 축이다.
- Hard-drop recall은 실제 하드드롭 중 하드드롭으로 맞힌 비율이다. 전체 Accuracy나 실제 조각 고정 성공률과 다르다. CRPS의 시간 분포 의미는5.2절을 따른다.

## 4. 1차 연구 — 배치 선택 V4와 실제 게임 평가

### 4.1 학습 스택과 중복 표현 정리

초기 JS와 Python 비교는 feature/scaler/pair/weight/metric 계약을 확인하는 기술 검증이었다. 이후 실험은 Python-native로 옮겼다. JS 실험을 계속 재작성하는 방향은 아니다. 현재 parity 경로는 기존 회귀 검증 용도로 남아 있다.

초기13게임 Python LOGO에서는 canonical raw-candidate Top-1 0.463899, Top-3 0.772563, MRR0.636154, tie-aware Top-1 0.568592를 기록했다. Tie-aware 값은 낙관적 표현 진단이지 canonical 지표의 대체값이 아니다. 이후 physical-class 평가와도 같은 분모가 아니다. 근거는 [과거 실험 로그](ai-experiments-log.md)와 [Python 실험 문서](../../archive/ai-ml/experiments/placement-python-experiment-notebook.md)다.

26게임에서는 zero-difference1,010 pair가 관측됐다. 조사 결과 모든 pair가 **같은 occupied-cell placement의 rotation/pivot 표현 중복**이었다. 회전 번호를 feature로 추가해 별도 행동처럼 구분하지 않고 물리 배치 class로 묶었다.

V0~V4는 신경망 크기나 세대 이름이 아니라 pair/weight 정책의 비교다.

| 정책 | 차이 |
| --- | --- |
| V0 | 선택 raw 후보와 모든 대안 raw 후보를 비교. 구간별 총 weight1 |
| V1 | zero-difference pair만 제거하되 기존 weight 유지 |
| V2 | 남은 informative raw pair의 구간 총 weight를 다시1로 정규화 |
| V3 | raw alias를 유지하되 각 physical class의 총 weight를 동일하게 배분 |
| V4 | class마다 대표1개만 사용. V3와 같은 class-level weight, 더 적은 row |

V3↔V4의 물리 rank 차이는0이었다.26게임 class MRR의 V4−V0 차이 약−0.001153은 row 압축이 아니라 정규화/alias multiplicity weight 변화로 설명됐다. 이는 “중복 제거가 무조건 점수를 올린다”는 결론이 아니다.

근거: [pair-weight 분해](placement-pair-weight-decomposition.md), [collision 분석](../../archive/ai-ml/experiments/placement-feature-collision-analysis.md).

### 4.2 Temporal 평가와 최종 fit

- 26게임으로 학습하고 이후49게임의 선택 필요 physical-class2,320 decision을 평가했다. V0/V4 MRR은0.726368/0.726517, Top-1 정답 수는1,314/1,315다.49게임 중 개선3·동일43·악화3으로 **실질적 우월성 증거는 약했다**.
- V4는 작은 metric 차이보다 generator alias 수에 독립적인 의미를 우선한 정책 결정으로 채택했다. 통계적으로 더 강한 모델임을 확정한 것은 아니다.
- 고정75게임 모델의 신규50게임 temporal 평가에서는2,202 decision에서 Top-1 60.31%, Top-3 89.65%, MRR0.756290을 기록했다. Normal/Hard는 비슷한 관측치를 보였으나 난이도 동등성을 검정한 결과는 아니다.
- 이후125게임 전체 fit은5,682 decision·192,129 candidate·123,130 V4 pair,21 iteration·warning0이었다. Model/report 두 실행이 byte-identical했다. **125게임 fit 자체에는 새 held-out 성능 증거가 없다.** 앞의50게임은75게임 모델에는 holdout이지만125게임 모델에는 학습 자료다.

모델은16-feature StandardScaler 뒤 pairwise LogisticRegression이다. 점수는 `w · ((x - mean) / scale)`이고 sigmoid 없이 순위를 정한다. 후보/실행의 규칙 검사는 core가 담당하며 선호 weight는 Human 선택에서 학습한다. Heuristic은 독립 비교·fallback/기존 후보 계산 경계에 존재하지만 Human label을 대체하지 않는다.

근거: [V0/V4 temporal 기록](../../../ai-harness/runs/placement-temporal-holdout-v0-v4-analyze-result-2026-07-18.md), [75→50 명세](../../../ai-harness/ml-experiments/experiments/placement-v4-frozen-75g-temporal-holdout-50g.md), [변경 이력](../../../change-log.md).

### 4.3 Gameplay screening — 기술 성공과 성능 한계

고정30 stream×최대500 placement에서 같은 조각 stream을 두 정책이 각각 실행했다. 이는 직접 대전 승률이 아니고, incoming garbage 없는 고정 실행 조건의 생존 screening이다.

| 항목 | Heuristic | V4 |
| --- | ---: | ---: |
|500 placement horizon 도달 |30/30 |27/30 |
| Lines/100 placement |39.3667 |38.1443 |
| Attack/100 placement |17.3000 |15.5861 |
| 평균 holes |2.1798 |4.9995 |
| 평균 max height |5.2363 |6.9553 |

Invalid decision·fallback·non-finite score·plan divergence·unexpected error는 모두0이었다. Horizon 차이3개는 사전 pass 경계의 정확한 끝으로 `gameplay_screening_passed`였지만, V4가 더 강하다는 뜻은 아니다. V4의 조기 종료는313·487·220 placement에서 발생했다.

프로그램 결론은 **`imitation_only_not_gameplay_ready`**, 기본 정책은 **`keep_heuristic_default`**다. Accepted candidate에 gameOver=true 사례가 없었던 데이터의 안전성 공백은 fixture에서 별도 방어했으며, 이는 game-over 회피를 데이터로 학습했다는 증거가 아니다.

현재40행 `buffer20-v1`에서는 V4가 `RULESET_INCOMPATIBLE`로 heuristic fallback한다. Experimental V4 메뉴를 선택했다는 사실만으로 실제 ML score가 사용됐다고 볼 수 없다. 과거의 지원 ruleset demo와 현재 지원 범위를 구분해야 한다.

근거: [gameplay 종료 기록](../../../ai-harness/runs/placement-v4-pve-gameplay-benchmark-analyze-result-2026-07-20.md), [PVE adapter](../../../src/client/game/ai/ml/placementV4PveDecisionAdapter.ts), [service guard](../../../src/server/services/pveAiPlayerService.ts).

## 5. 2차 연구 — 사람의 조작과 기록 간격

### 5.1 0ms의 의미와 종료한 조사

0ms는 두 기록의 timestamp 차이가0이라는 뜻이다. 사람이 실제로0ms 만에 두 키를 눌렀거나 고민 없이 판단했다는 뜻은 아니다.

재현에서는 여러 입력이 같은 runtime tick에서 소비되면 같은 createdAt으로 기록되는 메커니즘을 확인했다. 과거 특정 게임이 자동화·OS 반복·중복 listener 중 무엇 때문에 그 패턴을 보였는지는 확정하지 못했다. 승인된 종료 조건에 따라 추적을 끝내고0ms를 보존했다. 포함/제외 비교는 영향 진단이지 특정 자료를 불량으로 확정하는 절차가 아니다.

또한 이후 제품 입력기가 OS 반복에서 공통 held 입력기로 바뀌고 DAS/ARR 설정도 변경됐다. 나중에 자료가 추가돼도 빌드/입력 방식에 따른 분포 차이를 확인해야 한다. 새 기록을 지금 요구한다는 뜻은 아니다.

근거: [마지막 runtime 재현](../../../ai-harness/runs/human-timing-zero-ms-reproduction-2026-10-26.md), [입력기 경계](../contracts/human-action-dataset.md#제품-입력기-변경-경계--2026-11-03).

### 5.2 Timing B0~B3

| 모델 | 학습 방식 | 동일 Validation31게임 game-macro CRPS↓ |
| --- | --- | ---: |
| B0 |Train 평균 한 값의 고정 예측 |75.149567ms |
| B1 |Train 전체 간격 경험적 분포 |54.270029ms |
| B2 |직전 action별 간격 경험적 분포 |53.028141ms |
| B3 |직전 action + 이전 간격 구간별 분포, 부족 시 fallback |49.742622ms |

같은 Validation에서 B3는 B2보다 약6.20% 낮은 CRPS, 게임별26개선·5악화를 보였다. 고정 B2의 별도 Test33게임 결과는51.871034ms다. **B3는 Test에서 새 최종 평가를 하지 않았다.**

CRPS는 예측 시간 분포 전체의 오차로 단위가ms다. “평균49.7ms 틀린다”라는 MAE 해석은 부정확하다. B0처럼 한 점 예측일 때만 절대 오차와 같아진다.

B0~B3는 신경망이 아니고 보드·목표·공격·Hold를 이해하지 않는다. 실제 Human 과거 간격을 제공받는 한 단계 예측이다. 고민/전략적 지연/키 누름 습관의 원인을 학습했다고 볼 수 없다.

근거: [B0~B2](../../../ai-harness/ml-experiments/experiments/human-timing-baseline.md), [B2 Test](../../../ai-harness/ml-experiments/experiments/human-timing-b2-test-evaluation.md), [B3](../../../ai-harness/ml-experiments/experiments/human-timing-history-baseline.md).

### 5.3 다음 행동·시간 공동 기준선

기존 timing pair의 nextActionDiagnostic을 label로 사용해 전체 분포와 직전 action 조건 분포를 비교했다. 다음 action은 입력이 아니다.

| 조건 | Game-macro 행동 NLL↓ | Game-macro F1↑ | Marginal CRPS↓ |
| --- | ---: | ---: | ---: |
| 전체 분포 |1.418558 |0.081364 |54.269946ms |
| 직전 action 조건 |1.232912 |0.237967 |53.028209ms |

조건 신호는 있었지만 argmax에서 회전/하드드롭 예측이0이었다. 하드드롭 기록이 없어서가 아니다. 다음 행동의 발생 위치·조각 목표·진행 문맥을 구분하지 못한 부분 기준선이다. Hard-drop을 강제로 삽입하면 표면적인 완료는 가능해도 Human 조작 학습 성공으로 집계할 수 없다.

근거: [공동 기준선 명세·재확인](../../../ai-harness/ml-experiments/experiments/human-action-timing-joint-baseline.md).

## 6. 3차 연구 — 목표와 조작을 연결한 신경망

현재 prefix/goal 실험은101차원 입력에서 **행동 MLP와 시간 MLP를 각각 학습**했다. 각 모델은 ReLU64 hidden layer를 가지며 행동6종, 시간은Train support 분포를 예측한다. 하나의 공유 encoder가 배치·조작·시간을 공동 학습한 모델은 아니다.

정보 분리 실험은 같은 Train149/Validation31게임에서 다음 세 조건을 비교했다.

| 조건 | 행동 NLL↓ | Accuracy↑ | F1↑ | 시간 CRPS↓ | Hard-drop recall↑ |
| --- | ---: | ---: | ---: | ---: | ---: |
| Prefix만 |1.105671 |50.5657% |0.333499 |45.140807ms |23.8441% |
| Piece type 추가 |1.066450 |51.8772% |0.356127 |44.966001ms |28.3355% |
| 정답 배치 목표까지 추가 |0.796889 |66.7455% |0.480830 |44.571386ms |75.6935% |

위 표는 game-macro 기준이다. 목표 추가의 행동 NLL/F1은31게임 모두 개선했고 시간 CRPS는27개선·4악화였다. Prefix/goal 두 조건은 이전 Full과 재현됐으며 새 중간 조건은 반복 결정성을 따로 검증하지 않았다.

**핵심 한계:** 마지막 조건은 사람이 최종적으로 놓은 위치를 미리 알려주는 oracle 진단이다. Human 과거 prefix도 제공한다. “어디에 놓을지 알고 있을 때 조작 설명이 좋아진다”는 근거이지 모델이 스스로 목표를 정하고66.7% 정확도로 전체 플레이한다는 뜻은 아니다. 동작 경로를 재생하거나 Human 과거를 제공받는 것과 자기 예측으로 연속 실행하는 것은 다르다.

Hold970구간은 초기 view에서 보류됐다. 현재 Hold 성공/전략, spawn→첫 행동 대기, 실시간 공격에 따른 기다림을 학습했다고 주장하지 않는다.

근거: [목표 조건 prefix](../../../ai-harness/ml-experiments/experiments/human-goal-conditioned-prefix.md), [정보 분리 Full](../../../ai-harness/ml-experiments/experiments/human-goal-information-ablation.md).

## 7. 4차 연구 — 사람이 놓을 위치를 예측하는 snapshot MLP

### 7.1 구조와 기본 결과

입력은 보드 점유200 + 조각 one-hot7, 모델은207→ReLU64→Train 배치 class2,133의 softmax다. 최종 row/col/rotation/cells·Human 목표·미래 행동·결과·승패는 입력에서 제외한다. StandardScaler와 class 어휘는Train만 fit한다.

| 조건 | Validation game-macro Top-1↑ | Top-3↑ | MRR↑ |
| --- | ---: | ---: | ---: |
| Piece만 |1.6802% |3.7893% |0.048225 |
| Board + piece |13.4209% |25.0533% |0.231145 |

보드가 Human 배치를 설명하는 신호는 관측됐다. 그러나 마지막 모델의 Train segment-micro Top-1은96.3379%, Validation segment-micro는13.4565%로 일반화 격차가 크다. Game-macro와 segment-micro를 섞어서 격차를 계산하지 않는다.

Validation1,516개 중1364개만Train 정답 어휘에 있고152개(10.03%)는 OOV다. OOV를 전체 Top-1/Top-3/MRR 분모에 남겨 실패로 집계했다. Known-only NLL5.803012는1364개에 대한 값이며 전체 NLL은 지원하지 않아null이다.

예측 class는 Train에서 관측한 셀 목록이지 보드별 합법/도달 가능한 후보가 아니다. 충돌·목표 도달·게임오버를 확인한 실제 placement 정책으로 해석할 수 없다.

### 7.2 Validation loss와 조절 실험

같은 정의의 NLL을 epoch별 기록하자 Validation known-target NLL은6epoch에서4.110142였다가30epoch에서5.803012로 상승했다. 확률 손실 기준 과적합을 보여주지만 Top-1은 후반에도 개선됐다. 따라서6epoch를 모든 목적의 최적 checkpoint로 사후 채택하지 않았다.

| 비교 | Validation game-macro Top-1↑ | Known-only NLL↓ | 결론 |
| --- | ---: | ---: | --- |
| 기존 alpha0.0001 |13.4209% |5.803012 |비교 기준 |
| alpha0.01 |12.5443% |5.048156 |NLL 개선, 선택 정확도 저하 |
| alpha1.0 |7.6767% |4.217178 |더 강한 규제가 전체 해결책은 아님 |
| 보드 표준편차 나눗셈 제거 |11.8404% |4.838461 |입력 극값 완화, 선택 정확도 저하 |

스케일링 비교에서는 보드 입력 최대 절댓값이46.24→약0.9995로 감소했지만 Top-1은 나빠졌다. “희소 픽셀 표준화만 고치면 해결된다”는 가설을 지지하지 않았다. 규제/스케일링은 과신과 최상위 선택에 다른 영향을 줄 수 있다.

근거: [snapshot](../../../ai-harness/ml-experiments/experiments/human-placement-snapshot-baseline.md), [L2](../../../ai-harness/ml-experiments/experiments/human-placement-l2-regularization.md), [scaling](../../../ai-harness/ml-experiments/experiments/human-placement-board-scaling.md).

### 7.3 게임 수별 학습곡선

같은1530 optimizer update에서 hash 순서의 중첩Train subset을 비교했다. Validation31게임/1516구간은 고정했다.

| Train게임 | 구간 | 출력 class | Val Top-1(game-macro)↑ | Val MRR↑ | Val target coverage(segment-micro)↑ |
| --- | ---: | ---: | ---: | ---: | ---: |
|38 |1,804 |1,104 |8.1683% |0.151194 |57.9156% |
|75 |3,396 |1,598 |9.9208% |0.182089 |74.2084% |
|112 |4,840 |1,907 |11.5298% |0.203443 |84.9604% |
|149 |6,417 |2,133 |13.4209% |0.231145 |89.9736% |

공통878구간/공통1104-class로 경쟁 공간을 제한한 projection Top-1도14.0635%→21.2688%로 개선됐다. 이는 낙관적인 제한 진단이지 전체1516개 성능을 대체하지 않는다.

관측된 결론은 “추가Train 게임이 이 설정에서 도움이 됐다”다. “데이터 부족만이 원인이다/300게임이면 충분하다/전체 구조가 틀렸다”는 결론은 아니다. 같은 update 수라도 출력층·scaler·표본 노출·전체 pass 수가 달라지고 부분집합 순서/seed는 하나뿐이었다. 필요한 추가 게임 수의 신뢰할 만한 예측은 아직 없다.

근거: [학습곡선 명세](../../../ai-harness/ml-experiments/experiments/human-placement-game-count-learning-curve.md).

### 7.4 입력·정답 진단

학습 없이Train149게임/6417구간을 집계한 두 report가 byte-identical했다.

| 항목 | 관측 |
| --- | ---: |
| 정답 class 수 |2,133 |
| 사례1~2개뿐인 class |1,241종(58.18%) |
| 해당 희소 class에 속한 구간 |1,764개(27.49%) |
| 입력이 한 번만 등장한 구간 |6,095개(94.98%) |
| 같은 입력에 정답이 여러 개인 그룹 |36그룹·246구간 |
| 입력별 최빈 정답으로도 틀리는 최소 관측 수 |76/6417(1.18%) |
| 저장된 정답 셀과 boardBefore 점유 겹침 |0 |

입력별 최빈 정답의 경험적 일치98.82%는 **학습 모델 정확도도 미래 성능 상한도 아니다**. 입력 대부분이 한 번뿐이면 높은 표본 일치가 쉽게 나올 수 있다. 빈 보드에서 서로 다른 Human이 다른 위치를 고르는 것도 자연스러운 행동 다양성이지 자동 라벨 오류가 아니다.

따라서 다중 정답만으로 낮은 Validation을 설명할 근거는 부족하고 희소성은 뚜렷하다. 하지만 데이터량·표현·모델·기록 시점 중 어느 것이 얼마나 기여했는지 확정하지 못했다. 셀 겹침0도 관측 시점·geometry·reachability 증명은 아니다.

근거: [입력/정답 진단](../../../ai-harness/ml-experiments/experiments/human-placement-input-target-audit.md).

## 8. 전체 한계와 남은 위험

| 한계 | 현재 영향 | 피해야 할 주장/대응 |
| --- | --- | --- |
| 데이터 희소·행동 불균형 |Rare placement·rotate_ccw/Hold 등 근거가 제한됨 |게임 수만 늘면 해결된다고 약속하거나 희소 정답을 제거해 점수 올리기 금지 |
| 관측 시점 미확인 |boardBefore와 action 직전 정보의 대응을 보장하지 못함 |필드가 있다는 이유로 인과적 입력/실제 관측이라고 선언하지 않음 |
| 소비 시각 기반 interval |0ms·지연이 Human 조작과 runtime 처리의 혼합 |반응시간·생각 시간·키 press/release를 복원했다고 하지 않음 |
| Pooled Human 스타일 |서로 다른 선택/리듬이 섞임 |개인 복제·프로 전략·최적 행동이라고 하지 않음 |
| Human/oracle 이력 제공 |자기 오류가 누적된 상태의 조작 성능 미확인 |one-step accuracy를 전체 controller 성공률로 해석하지 않음 |
| 닫힌 배치 어휘 |Train에 없던 절대 class를 고를 수 없음 |높은 Train accuracy만으로 모델 적합성을 판단하지 않음 |
| Validation 반복 관측 |새 가설/비교 선택 자체에 개발 자료가 영향 |optimizer fit에 안 썼어도 선택 편향이 전혀 없다고 하지 않음 |
| 이미 관측한 Test33 |후속 구조의 새 독립 최종 Test가 아님 |재분할/다시 평가해서 독립 증거라고 부르지 않음 |
| 단일 seed·조건부 metric |불확실성·코호트 편차의 근거가 제한됨 |작은 부호 차이를 유의성이나 채택 근거로 확대하지 않음 |
| Legacy20행/현재40행 차이 |기존 V4 runtime 미지원·명시적 fallback |padding/crop·guard 해제로 지원되는 척하지 않음 |
| 제한된 gameplay benchmark |무garbage·고정 horizon의 개별 rollout |직접 PVP 승률·장시간·모든 난이도/사용자 체감으로 일반화하지 않음 |
| 원본 증거의 보관 위치 |일부 과거 model/report가 명세 경로에 없음 |문서상 SHA와 이번에 실제 재검증한 SHA를 혼동하지 않음 |

정상 패자 자료 포함·모델 크기 축소·정규화·더 많은 게임·출력 formulation 변경은 각각 다른 가설이다. 하나의 원인으로 몰거나 동시에 바꿔 개선 원인을 알 수 없게 만들지 않는다.

## 9. 확보한 자산과 다음 실험

### 확보한 것

1. 원본 보존·schema/lineage·game split·품질 정책과 결정적 report 경계.
2. Physical class alias 처리·decision-balanced 학습과 수치 parity/불변성 검증.
3. Timing 분포·행동 확률·placement ranking을 서로 맞는 단위로 평가하는 기준선.
4. 목표 조건의 예측 신호, 정규화/스케일링의 trade-off, 게임 수와 어휘 희소성에 대한 실제 관측.
5. Python Notebook 설명·pandas/Matplotlib 결과·최종 trainer/reference·TS inference/core 안전성 경계.
6. “기술적으로 동작함”과 “게임을 더 잘함”을 분리하고 기본 정책 승격을 보류한 판단 기록.

### 아직 완료하지 않은 것

- Human 배치·조작·시간의 예측을 실제 조각 진행으로 결합한 자율 정책.
- 예측 목표 기반 closed-loop 도달률·오류 회복·무한 반복/대기 검사.
- Hold의 성공/선택 전략, 공격 상황을 보고 기다리는 행동의 학습 검증.
- 사람다운 체감을 확인하는 속도 통제·정책명을 가린 비교.
- 현재40행 ruleset에 맞는 ML inference/runtime 검증과 독립 일반화 증거.

### 현재 다음 명세

[배치 ID 분류 vs 공유 후보 점수화](../../../ai-harness/ml-experiments/experiments/human-placement-candidate-scoring.md)는 **명세만 작성**됐다. 기존 core의 비충돌·하방 이동 불가 정적 후보를 정답과 독립적으로 만들 수 있는지 지원도를 먼저 보고, 이후 ID 원래 출력·같은 weight의 candidate mask·공유 scorer를 비교한다.

이는 실제 출발 상태에서의 reachability를 검증하는 실험이 아니다. 정답 후보 주입·최종 pose 누수·휴리스틱 선호·Python 게임 규칙 복제를 금지한다. 모델 비교는 입력 크기/목적함수/학습 행도 달라지는 formulation 비교이므로 “출력층만 바꾼 순수 인과 실험”으로 부르지 않는다. 모듈형/통합 신경망 중 하나를 이 보고서로 채택하지 않는다.

## 10. 재현·추적 방법과 증거 목록

- 실험의 질문·입력·예산·Full 설정은 해당 명세와 source Notebook을 따른다. 결과 해석만 필요하면 saved report를 읽고 Full을 켜지 않는다.
- 2026-11-04 정리 전 Notebook16개는 ignored `data/ml-experiments/source-checkpoint-20261104/`에 당시 설정·출력과 byte-identical하게 보존했다. Git용 source는 빈 output/count·Full/실제 표본 기본 비활성·보고서 초기값None이다. 이 보관본은 실행 당시 원본 report와 같은 SHA라는 보장이 아니라 **정리 직전 source를 정확히 보존했다**는 의미다.
- AI 정리 당시 `verify:ml` Node35/35·Python220/220, 기본 verify801 pass·기존1 skip이었다. localhost EPERM은 권한 재실행으로 해소됐다. 이는 소프트웨어 회귀 결과이지 모델 정확도 보증이 아니다. 이 보고서 작성에서는 모델/전체 suite를 다시 실행하지 않았다.
- Git source·기존 형식 검사 테스트·ignored dataset/report/model의 역할을 구분한다. Git만 복제하면 ignored 입력/과거 산출물까지 자동 복구되는 것은 아니다. 새 report는 기존 파일·alias·symlink·hardlink를 덮어쓰지 않는다.

### 이번에 실제 읽고 SHA를 대조한 최근 Full report

경로는 `data/ml-experiments/<실험 ID>/<파일명>`이며 모두 local ignored 증거다. 배포/공유 환경에는 없을 수 있다.

| 실험 ID | 파일 | SHA-256 |
| --- | --- | --- |
| human-action-timing-joint-baseline |full-report-run1.json |`7e4ba515d74bf139167e8fd9d5754e6c2f5c8666276ed8b51b43d14a3575e5df` |
| human-goal-conditioned-prefix |full-report-run1.json |`d4a5ef0101fb0c6796894c4143a98af3f67aa91eaf9e15ba5180dc1c6ac6284d` |
| human-goal-information-ablation |full-report-run1.json |`fc5a17317d539de110755290a43160a8a51fdf1571a340b98b3609d01e790167` |
| human-placement-snapshot-baseline |full-report-run2.json |`d87456bbb3d4f289db38d1bc70d8b6b8d1615f34a5bd4ddaa3f025d40f6fb19e` |
| human-placement-l2-regularization |full-report-run1.json |`1b3d28aca7319265e8a73c06629ca2473d6dd7597b2967ccf78be5135491779e` |
| human-placement-board-scaling |full-report-run1.json |`f9897525f27e3e4c0b58408580fdb47d4af99f63d039e0be1cc72ff9e79d0671` |
| human-placement-game-count-learning-curve |full-report-run1.json |`974f23947e1f4b0f87fb581f658a365e13a7de88f4d0384d75a52d193dfb28e4` |
| human-placement-input-target-audit |full-report-run1.json |`635045e9dde6d301e27463c06ac045545fb948068707e0c6981355d4eb1c0155` |

### 포트폴리오에 사용할 수 있는 정직한 요약

> Tetris Human 로그에서 배치 선호·행동 순서·조작 간격을 학습하는 파이프라인을 구축했다. 후보 표현 중복과 가중치, 데이터 희소성, 관측 시점과 평가 누수를 분리해 검증했다. 목표 조건이 행동 예측을 개선하는 신호와 배치 신경망의 일반화 한계를 확인했으며, 실제 gameplay screening에서 휴리스틱 대체 근거가 부족해 기본 정책 승격을 보류했다. 다음 연구는 기존 데이터에서 닫힌 배치 ID 분류와 공유 후보 점수화의 비교다.

이 문구는 개인 행동의 완전 복제·프로급 전략·승률 향상·현재40행 ML 자율 플레이를 주장하지 않는다.
