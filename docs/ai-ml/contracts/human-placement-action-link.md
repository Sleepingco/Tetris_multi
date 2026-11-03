# Human 배치 선택·조작 연결 계약

작성일: 2026-10-29. 상태: **contract_draft — 코드·Train 표본 3개 연결 확인, 전체 정합성·reachability·학습 미실행**.

현재 데이터 결정(2026-11-02): **offline-use-v1 — 기존 기록을 과제별 오프라인 view로 구성하는 범위 확정**. 아래 9절을 현재 사용 기준으로 삼는다. 이는 전체 데이터 검사·학습·실제 controller 채택 완료가 아니다.

후속 구조 검토(2026-11-04 정정): [현재 AI 계획](../strategy/ai-plan.md)의 V4 배치 + 별도 조작/타이밍과 통합 신경망은 **미채택 비교 후보**다. 진행 순서는 사용자 선택 전 확정하지 않는다. 기존 artifact의 cohort·feature/ruleset 확인과 offline-use-v1의 라벨·Hold 경계는 그대로 유지한다.

후속 [점검 명세](../../../ai-harness/ml-experiments/experiments/human-placement-action-link-readiness.md)·[Notebook](../../../scripts/ml/notebooks/human_placement_action_link_readiness.ipynb)을 구현해 지정 Train 3개/28 pair 연결을 확인했다. 이 결과로 관측 시점·geometry·도달 가능성까지 검증된 것은 아니며 아래 계약 경계는 유지한다.

2026-11-02: [상태·규칙 근거 점검](../../../ai-harness/ml-experiments/experiments/human-placement-context-evidence.md) Notebook·가상 Smoke를 추가했다. 같은 작은 표본의 실제 점검은 사용자 실행 대기이며 snapshot/offset 일치나 marker 유무만으로 replay/상태 학습 가능성을 승인하지 않는다.

목표는 여러 Human의 **어디에 놓는가 + 어떻게·언제 조작하는가**를 기존 자료로 학습하는 것이다.
이번 문서는 데이터 연결과 학습 허용 범위를 정의한다. 새 dataset 생성·모델 학습·runtime 통합 승인이 아니다.
[전체 계획](../strategy/ai-plan.md) · [공통 품질/시간 계약](human-action-dataset.md) · [관측 감사](../experiments/human-action-observation-link-audit.md).

## 1. 왜 별도 연결이 필요한가

[joint 기준선](../../../ai-harness/ml-experiments/experiments/human-action-timing-joint-baseline.md)은 직전 action 하나만 본다.
Validation의 보존된 조작 구간 1,513개 중 1,511개에는 마지막 pair의 하드드롭 정답이 있다.
그러나 최고 확률 하나를 고르면 하드드롭 예측은 0건이다. 이는 하드드롭 기록이 없는 문제가 아니라
중간 이동과 마지막 이동을 구분할 보드·목표·진행 정보가 없는 기준선의 한계다.

```text
기존 raw의 한 Human placement 기록
  ├─ 기록된 보드·조각 anchor → 사람이 선택한 물리 배치 class
  └─ 같은 기록의 입력 순서·간격 → 다음 행동·시간 label
                          ↓
              학습한 배치 목표 + 목표 조건부 조작
                          ↓
            기존 core로 실행하고 목표 도달 여부 확인
```

전체 조작열을 보는 것과 지금 실행할 다음 행동을 예측하는 것은 다르다.
정답 배치를 미리 준 조작 평가는 oracle 진단이며 전체 AI의 추론에서는 **배치 모델의 예측 목표**를 사용한다.

## 2. 기존 입력과 cohort를 고정한다

| 자료 | 경로·계약 |
| --- | --- |
| 기존 immutable raw | `data/datasets/tetris-ml-snapshots-backup-0908/raw/game-events.jsonl` |
| raw SHA-256 | `eb64f86731ecb148ebf398773cb8e23cdf71217fc44f3bcb88460299bb092344` |
| 승인 게임·split 원천 | `data/datasets/human-timing-v1-20261024-full/manifest.json` |
| manifest SHA-256 | `c203a1db7b8f2aa7014c565b371088a9614f6abb0df5632e93fe6c807712fc88` |
| 정제 정책 | `quality-policy-v1`: 213게임 포함·22격리·11 Human 없음 제외 유지 |
| split | 기존 Train/Validation/Test 149/31/33게임 유지. PVP 양쪽도 같은 game split |
| 현재 준비 범위 | 설계용 표본은 기존 Train만. Test 파일·그 게임의 raw payload는 열거나 학습하지 않음 |
| 로그 계약 | legacy 20×10·schema 1/2·ruleset/build 미확인·client_reported. v3/40행과 자동 혼합하지 않음 |

새 로그 수집·운영 DB 접근·live log 사용은 없다. PVE는 Human만, PVP는 양쪽 Human을 승패와 무관하게 선정한다.
기존 timing 파일에 배치 열을 덧붙여 덮어쓰지 않는다. 이후 승인을 받아 만들 메모리 view 또는 새 immutable revision으로 분리한다.
배치만 가능한 구간과 timing까지 가능한 구간의 수는 다를 수 있다. 한 과제에서의 실패로 원본이나 다른 과제의 정상 표본을 삭제하지 않는다.

## 3. 먼저 정규화하고 그다음 연결한다

기존 [readiness Notebook](../../../scripts/ml/notebooks/human_action_data_readiness.ipynb)의 `normalize_event`·`event_metadata`와
[timing 생성 Notebook](../../../scripts/ml/notebooks/human_timing_dataset.ipynb)의 identity/품질 검증을 재사용한다. 새 parser를 복제하지 않는다.

- DB export는 `game_id/player_id/piece_index/schema_version`가 바깥 envelope에 있고 보드·선택 배치는 `payload` 안에 있다.
- 앱 JSONL과 DB export를 먼저 같은 event 의미로 정규화한다. Envelope/payload 값이 충돌하면 격리하며 어느 쪽을 조용히 우선하지 않는다.
- `playerNumber`는 기존 lifecycle/가명 player 대응 검증 결과를 재사용한다. payload에 번호가 없다고 기본값 1을 넣지 않는다.
- 한 segment의 연결 기준은 **source SHA + 원본 sourceLine + 정규화 event identity + gameId + player 대응 + pieceIndex**다.
- timing pair는 여기에 `previousInputIndex/currentInputIndex`를 더한다. 원본 입력의 action·pieceIndex·sequence·createdAt 차이가 기존 pair와 일치해야 한다.
- `sourceLine`만으로 다른 파일을 연결하거나 `pieceIndex`만으로 다른 player/Hold 구간을 합치지 않는다. 같은 event 중복은 한 번만 세고 내용 충돌은 사유와 함께 격리한다.
- 기존 placement candidate별로 복사된 inputSequence를 새 행동 표본처럼 여러 번 세지 않는다. 조작 label은 원본 segment에서 한 번만 만든다.

확인한 Train sourceLine은 `118015`, `118021`, `118023`이다. 세 DB envelope를 정규화한 뒤 게임·조각과 인접 action/time이 일치했다.
이는 연결 방법의 작은 예제이며 전체 213게임의 검사 통과 수가 아니다. 이번 표본에서는 player 대응 전체 index·reachability·행동별 상태를 새로 검증하지 않았다.

## 4. 배치 view: 입력과 정답

| 역할 | 필드·처리 |
| --- | --- |
| 입력 후보 | 기록된 `boardBefore`, `activePiece`와 조각 종류. shape·셀 값·anchor 시점을 검증 |
| 선택 정답 | `selectedPlacement`의 pieceType과 occupied-cell physical class |
| lineage/검증만 | game/player/piece/sourceLine·event identity·trust·schema·ruleset/geometry·split |
| 첫 범위에서 입력 제외 | 전체 inputSequence·최종 selectedPlacement·boardAfter·실제 결과 lines/attack·승패·heuristic score/순위 |
| 선택적 입력 보류 | nextQueue·holdPiece·incoming garbage·행동별 보드. 당시 공개 범위/시점의 증거가 없으면 넣지 않음 |

기존 [runtime](../../../src/client/game/runtime/tetris.ts)의 `createPlacementDecisionContext`는 **고정 직전** 보드를 복사하고,
`activePiece`는 `decisionStartPiece` anchor에서 가져온다. 두 값이 같은 시점의 관측이라는 뜻은 아니다.
현재 코드의 의미는 참고 증거이며 과거 빌드와의 binding이 확인됐다는 선언도 아니다.

따라서 상태는 따로 기록한다.

| 검사 축 | 예시 상태 | 허용하는 주장 |
| --- | --- | --- |
| 구조·원본 연결 | `structural_join_verified` / `join_conflict` | 어떤 원본의 보드·선택·입력인지 확인 |
| 관측 시점 | `recorded_pre_lock_only` / `decision_observation_verified` / `unverified` | 고정 직전 snapshot 관계와 실제 판단 시점 관측을 구분 |
| 후보/정답 정합 | `not_checked` / `selected_class_reachable` / `selected_class_missing` / `ruleset_unverified` | 해당 보드·anchor·규칙에서 선택 후보가 있는지 |
| 행동 상태 연결 | `sequence_only` / `action_state_verified` / `replay_diverged` / `hold_boundary_unverified` | 기록된 시도열과 검증된 상태 전이를 구분 |

정상 보드·정답이 연결됐더라도 모든 과거 action 직전 보드가 확인된 것은 아니다.
`recorded_pre_lock_only`는 snapshot-선택의 제한된 오프라인 탐색용 후보로 분리할 수 있으나,
spawn/첫 판단 입력을 학습한 모델이나 인과적으로 정합한 controller로 승격하지 않는다.
시점 미확인 표본은 결합 상태 학습 gate를 통과시키지 않으며 추가 수집 대신 기존 자료의 정합 가능 범위와 미확인 사유를 보고한다.

## 5. 물리 배치 class와 후보 검증

동일 pieceType에서 실제 점유 셀 집합이 같으면 같은 배치 class로 묶는다. Rotation/pivot 표현이 다르다는 이유로 별도 정답으로 세지 않는다.
key는 기존 V4 정의처럼 셀을 **row, col 수치 오름차순**으로 정렬해 `pieceType|r,c;r,c;...`로 만든다.
물리 셀 class는 배치 label의 동치 기준이며, T-Spin 자격·회전 이력·미래 공격 결과까지 동등하다는 뜻은 아니다.

- 셀은 정수 좌표·중복 없음·조각 geometry 일치 여부를 검사한다. Pivot의 row/col에 단순 비음수 조건을 강제하지 않는다.
- Train 표본 `118015`의 선택 pivot col은 `-1`이지만 점유 셀은 모두 보드 안이다. 실제 셀과 core geometry를 기준으로 판단한다.
- 합법성·도달 가능 후보는 기존 core/후보 생성 책임이다. Python에서 충돌·회전·lock·garbage 규칙을 새로 작성하지 않는다.
- [기존 builder](../../../src/client/game/ai/dataset/placementDatasetBuilder.ts)는 schema 2/legacy 경계와 strict placement 표현 검사를 가진다. 그대로 실행해 모든 Human 자료의 지원을 선언하지 않는다. 재사용 함수·지원 규칙·정답 class 매칭 경계를 먼저 확인한다.
- 기존 V4 artifact가 현재 40행에 호환되지 않는 것과 과거 raw의 배치 정답이 존재하는 것은 다른 문제다. 20행 위에 20행을 붙이는 것만으로 규칙 동등성을 주장하지 않는다.
- 정답 class가 후보에 없으면 `selected_class_missing`을 남긴다. 휴리스틱이 좋아하는 후보로 정답을 교체하거나 선택 위치에 후보를 억지로 추가하지 않는다.
- 후보를 만들더라도 heuristic score로 상위 일부만 남기지 않는다. 동일 class의 alias 수로 학습 weight를 부풀리지 않는다.
- 도달 가능한 대표 경로는 합법성 증거이지 사람이 실제 쓴 조작 정답이 아니다. 학습할 행동열은 Human inputSequence다.

## 6. 조작 view: prefix와 목표를 연결하는 경계

```text
원본 시도열: left → left → rotate → left → left → hard_drop
관측 prefix: left → left
행동 정답:   rotate
시간 정답:   두 번째 left에서 rotate까지의 기록 간격
```

- 입력 이력은 **예측 지점까지 완료된 prefix**만 사용한다. 완성된 열·남은 행동 수·전체 길이에 대한 현재 위치 비율·마지막 입력 표시를 feature로 쓰지 않는다.
- 하드드롭이 마지막이라는 사실은 사후 진단이다. `isLastInput`, `stepsUntilHardDrop`처럼 정답으로부터 만든 값을 예측 입력으로 넣지 않는다.
- 처음에는 기존 pair를 그대로 연결할 수 있다. Gap·불연속 sequence/index·다른 sourceLine에서 reset하며 첫 행동 대기를 추정하지 않는다.
- 목표 조건부 학습의 Human target은 decoder 조건/label 계층에 분리한다. 배치 모델의 입력에 selectedPlacement를 넣지 않는다.
- 전체 정책 평가에는 **배치 모델이 예측한 목표**를 넣는다. Human 목표를 미리 준 decoder 평가는 `oracle_goal_conditioned`로 별도 집계한다.
- 현재 조각이 목표에 도달했는지, 지금 hard_drop하면 목표 셀에 놓이는지는 action 직전 상태와 core 판정이 있어야 확인할 수 있다. 누락 상태를 최종 배치에서 역산해 정답처럼 쓰지 않는다.
- Hold 전후는 같은 pieceIndex라도 조각이 달라질 수 있다. 기존 timing v1은 Hold를 제외한다. 기존 raw의 별도 Hold view는 경계/시점 확인 후 후속 명세에서 다루고 조용히 끼워 넣지 않는다.
- 입력 성공·실제 회전/이동 결과가 없으면 `sequence_only`다. 시도열의 다음 행동 학습은 가능하지만 이를 성공 경로나 실제 상태-행동 정답으로 바꾸지 않는다.

## 7. 연결 점검 Notebook의 질문과 gate

다음 한 작업의 질문은 **기존 Train raw에서 배치 label과 조작 prefix를 어느 범위까지 올바르게 연결할 수 있는가?**다.
배치 estimator·신경망 구조·추가 feature 비교는 아직 정하지 않는다. 무조건 하드드롭 가중치를 늘리는 실험도 시작하지 않는다.

1. 기존 parser·정책·split을 재사용하는 Notebook 하나에 작은 예제·내부 assert·가상 Smoke·기본 비활성 Full을 둔다. 새 `.py`/테스트 파일은 만들지 않는다.
2. 첫 실제 점검은 승인된 Train의 명시적인 작은 sourceLine 집합이다. 실제 raw open은 별도로 켜야 하며 기본 모두 실행은 가상 자료만 사용한다. Test game payload는 읽지 않는다.
3. pandas로 원본/게임/segment/연결 pair/선택 class 수, 각 검사 축의 통과·미확인·격리 사유를 분리한다. Matplotlib은 그 분포만 표시한다.
4. assert는 envelope 충돌·source SHA·player 대응·인접 index/action/time·중복·Hold/구간 단절·물리 class alias·미래 label 입력 차단을 포함한다.
5. 실제 core 검사를 연결하기 전에는 reachability/replay를 `not_checked`로 둔다. 잘못된 ruleset의 현재 core로 만든 성공을 과거 행동 복원 증거로 쓰지 않는다.
6. 기술 gate는 source/checksum 불변·일관된 lineage·정답 누수 0·split 누수 0·Test 평가 0·잘못된 항목의 명시적 격리다. 표본 확인을 전체 cohort 통과나 모델 성능으로 확대하지 않는다.
7. 결과는 `placement_action_link_readiness_complete`와 검사 축별 coverage다. 미확인은 명시하며 결합 학습 가능 표본 수가 확인되기 전 trainer·모델/제품 채택을 하지 않는다. 게이트 미달은 원본 폐기나 신규 수집 요구가 아니다.

전체 raw를 훑는 readiness Full이나 replay·dataset 출판·학습은 별도 승인이 필요하다.
현재 구현은 가상 Smoke와 고정 Train 3개뿐이며 전체 Full 기능은 제공하지 않는다. Notebook의 Full 절은 별도 범위/승인이 필요함을 표시하고 실행을 차단한다.
이후 배치 학습은 physical-class Top-1/Top-3/MRR·선택 후보 누락률, 조작은 NLL/F1·hard_drop/회전별 precision/recall·CRPS로 평가한다.
실제 실행은 예측 목표 도달·불법/반복 행동·Hold 실패·강제 안전 개입·마무리 행동을 따로 확인한다. 같은 지표의 한 단계 개선으로 전체 실행을 대신하지 않는다.

## 8. 이번 확인과 보존 범위

- 코드의 호출/데이터 경계, 기존 joint Full report와 timing manifest를 읽었다. Train sourceLine 3개만 JSON 파싱해 연결했다. 원본은 checksum 확인을 위해 읽었지만 전체 event 파싱·replay·새 모델 fit은 하지 않았다.
- raw SHA와 manifest/Train/Validation checksum은 기존 값과 일치했다. Test JSONL은 열지 않았으며 Test 게임 raw payload를 파싱/평가하지 않았다. Live log·운영 DB는 읽지 않았다.
- 표본 3개는 schema 2·20×10·client_reported다. `activePiece`의 음수 row와 선택 pivot의 음수 col이 있어 실제 셀 geometry 기준이 필요하다.
- 원본·timing dataset·사용자 실행 Notebook·full report·runtime은 변경하지 않았다. 이번 산출물은 계약/현황 문서뿐이다. 취소하려면 이번 문서 추가와 참조/상태 변경만 되돌리며 운영 데이터 rollback은 없다.

## 9. 기존 로그의 학습 사용 범위 — offline-use-v1

사용자 실행의 작은 근거 감사에서 두 저장 보드 경계는 일치했고 순서 끊김/시간 역전은 없었다.
반면 ruleset/stage/build marker·입력별 전후 상태/outcome은 확인되지 않았다.
이는 한 게임/세 구간의 관측이다. 이 결과를 전체 원본의 보장으로 확대하지 않되, 같은 결측 여부를 반복 감사하는 일을 다음 단계의 선행 조건으로 두지 않는다.

### 과제별 사용 결정

| 과제 | 현재 허용 범위 | 표본 처리·주장의 한계 |
| --- | --- | --- |
| 배치 선택 | 기록된 boardBefore/조각 anchor와 Human selectedPlacement의 물리 class를 연결한 **snapshot 관계 탐색** | 구조가 맞는 표본만 `placement_snapshot_eligible`. 관측/규칙 정합은 별도 값으로 남기며 spawn 당시 정책·실제 추론 입력으로 검증됐다고 하지 않음 |
| 다음 조작 | 관측 지점까지 기록된 prefix에서 다음 semantic action 시도 예측 | `control_sequence_eligible`. 입력 성공·물리 키 습관·보드 이해를 학습했다는 주장은 하지 않음 |
| 조작 사이 시간 | 같은 구간의 인접 처리 시도 간격 | `timing_pair_eligible`. 0ms 유지, 첫 행동 대기·인지 반응·전략적 기다림으로 해석하지 않음 |
| 목표 조건부 조작 | 기록된 Human 목표를 **별도 oracle 조건**으로 제공한 decoder 실험 | `oracle_goal_conditioned`. 배치 모델에서 selectedPlacement는 label만 사용. 전체 평가에서는 배치 모델의 예측 목표로 바꿔 별도 검증 |
| 첫 행동 종류 | 기존 raw의 첫 semantic action을 BOS(구간 시작) 뒤 정답으로 사용 가능 | BOS는 내부 경계 기호이며 게임 행동이 아님. Spawn 시각이 없으므로 첫 시간 label은 null/미지원, 0ms를 넣지 않음 |
| Hold | 기존 raw에 남기고 후속 전용 view로 분리 | 첫 no-Hold 연결 view에서는 `hold_deferred`. Hold 전후 상태·성공/사용 가능 여부를 추정하지 않고, 미사용 구간을 곧바로 Hold 가능 상태의 음성 label로 만들지 않음 |
| 보드/공격 반응·상태 기반 통합 정책 | 판단 시점 상태가 확인된 표본에 한해 후속 검토 | 현 표본만으로 `action_state_verified` 또는 B 통합 모델 학습 준비 완료로 승격하지 않음 |

모든 eligibility는 **해당 과제의 데이터 구성 허용**이지 모델/제품 승인이 아니다.
`placement_snapshot_eligible=true`라도 `inferenceEligible=false`, `observationAlignment=unverified`, `reachability=not_checked`일 수 있다.
관측 시점이 미확인인 보드를 모든 과거 action에 붙이지 않으며, 저장 snapshot으로 만든 오프라인 점수를 실제 판단 시점 성능으로 보고하지 않는다.

### 분리할 데이터 구조

한 원본 segment를 한 번만 저장하고 과제별 입력/정답/조건을 분리한다.

```text
segment lineage: source SHA/line, game/player/piece, split, 원본 schema/trust/geometry
placement:
  inputSnapshot: 기록된 boardBefore·activePiece
  target: Human physical placement class
  observationAlignment / reachability / offlineOnly
control:
  observed prefix / 이미 관측한 간격
  target: 다음 semantic action / 인접 시도 간격
oracleCondition:
  Human 목표 class (decoder 진단 전용, placement input에는 없음)
eligibility:
  과제별 사용 가능 여부와 제외/미확인 사유
```

- 결과 보드·실제 줄 삭제/공격 결과·승패·heuristic score/rank·미래 action·전체 길이/남은 조작 수·마지막 입력 여부는 예측 feature가 아니다.
- Human 목표를 조건으로 쓰는 과제는 그 사실을 명시한다. 이를 실제 전체 정책의 causal input처럼 보고하는 것이 leakage다. 전체 policy 점수와 oracle decoder 점수를 합치지 않는다.
- 동일 class alias/candidate 수만큼 행동열을 복제하지 않는다. 기록이 불완전한 부분은 해당 component만 격리하고, 다른 정상 과제나 원본 전체를 삭제하지 않는다.
- Hard drop이 자주 마지막이라는 이유로 추가 hard_drop/EOS/긴 WAIT label을 합성하지 않는다. 실제 기록된 행동과 관측 종료를 구분한다.
- Legacy 20행과 v3/40행은 별도 lineage로 둔다. 날짜·높이·schema만으로 특정 과거 빌드나 현재 runtime 호환성을 확정하지 않는다.
- Source·quality-policy-v1·기존 game split은 유지한다. 새 초기 view는 Train/Validation만 구성하며 Test gameId는 manifest의 예약 metadata로 보존하고 Test 파일/payload는 열지 않는다.
- Train에서 vocabulary/전처리/모델을 정한다. Validation의 새 class/희소 행동은 미지원/미관측으로 보고하며 점수를 좋게 만들려고 제거하지 않는다.

### 첫 학습 질문과 전체 모델 목표를 구분한다

데이터 view의 count/eligibility 검토 뒤 첫 조작 학습 질문은 **같은 prefix 모델에 목표 조건을 제공하면 회전·hard_drop의 예측이 달라지는가?**로 한정한다.
비교 이름은 `prefix_only`와 `oracle_goal_prefix`이며, 같은 공통 적격 표본·split·모델 계열/예산·평가/weighting을 사용하고 목표 조건 유무만 바꾼다.
관측 단계가 미확인인 boardSnapshot을 이 조작 비교의 입력에 넣지 않는다. 이는 A/B 전체 구조 비교나 최종 정책 채택이 아니다.
구체적인 architecture·loss·hyperparameter·seed·예산·허용 회귀는 별도 학습 명세에서 **fit 전에** 고정한다. 이번 결정으로 신경망이나 estimator를 채택하지 않았다.

배치 선택 학습은 별도의 필수 과제다. Snapshot 관계의 탐색 점수와 판단 시점/규칙이 맞는 배치 정책 성능을 분리하고,
지원 core의 후보 합법성·실제 목표 도달·예측 목표 기반 rollout을 확인한 뒤에만 전체 모방 정책을 평가한다.
A는 **V4 계열 Human 배치 모델 + 목표 조건부 조작 습관 + 타이밍**으로 먼저 진행한다. B는 관측 정합과 데이터 지원 조건이 충족됐을 때 비교하는 후속 통합 신경망 후보다. V4가 예측한 목표와 다른 Human 목표의 원래 행동열을 새 목표의 경로 정답으로 바꾸지 않는다. Oracle 목표 decoder 진단과 예측 목표 기반 결합 도달 평가는 분리한다.
배치 정합이나 B의 조건이 미달이면 보류를 보고하며 휴리스틱 배치나 리듬 체험만으로 전체 목표를 완료 처리하지 않는다.

다음 구현은 [오프라인 view 구성 명세](../../../ai-harness/ml-experiments/experiments/human-placement-action-offline-views.md)의 Notebook·가상 Smoke·작은 Train 표본 구성이다.
여기서 아직 전체 데이터 생성·model fit·replay·새 수집·runtime·Git mutation을 실행하지 않았다.
