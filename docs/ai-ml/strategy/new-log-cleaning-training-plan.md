# 신규 로그 정제와 V4 재학습 계획

> 상태 보완 (2026-10-24): **보류 제안**. 아래는 기존 V4의 데이터 확장안이며
> 정제·재학습을 완료한 기록이 아니다. 새 조작·시간·hold 연구에는
> [현재 AI 계획](ai-plan.md)과 [행동 dataset 계약](../contracts/human-action-dataset.md)을 적용한다.
> 원본 무결성·DB row 해석·중복 검증 아이디어는 재사용하되 기존 정상 종료/초기
> 조각 필터와 20행 후보 생성 정책을 행동 dataset에 자동 적용하지 않는다.

작성일: 2026-10-04 (Asia/Seoul)
상태: 계획 작성 완료. 정제 실행, 모델 학습 및 runtime 적용은 아직 수행하지 않음.

## 1. 목적과 범위

새 PostgreSQL JSONL 로그에서 학습 가능한 Human placement를 추출하고,
기존 V4 모델의 신규 게임 성능을 평가한 뒤 다음 모델 후보를 만든다.
우선 제외 기준은 사용자가 제시한 다음 두 항목이다.

1. 정상적으로 종료되지 않은 게임
2. 지나치게 오래 진행된 게임

원본은 보존하고 학습 대상에서 제외한다. 제외 사유를 기록해 나중에
기준을 재검토할 수 있게 한다. 이번 계획은 feature, estimator 또는
게임 규칙을 바꾸지 않고 데이터 정제와 cohort 확장에 집중한다.

## 2. 현재 입력과 관찰 결과

입력: `data/datasets/tetris-ml-snapshots-backup-0908/raw/game-events.jsonl`

현재 파일을 읽기 전용으로 줄 단위 집계한 결과다.
이 수치는 정제 후 accepted game/decision/candidate 수와 다르다.

| 항목 | 관찰값 |
| --- | ---: |
| 파일 크기 | 약 624 MiB |
| JSON 행 | 122,095 |
| JSON 파싱 실패 | 0 |
| 고유 gameId | 246 |
| game_start | 244 |
| placement_decision | 121,619 |
| game_over | 232 |
| 시작·종료가 모두 있는 게임 | 230 |
| lifecycle 불완전 게임 | 16 |
| lifecycle 중복 게임 | 0 |
| 완결 게임의 finishType | 230게임 모두 normal |
| 완결 게임의 유효하지 않은 진행 시간 | 0 |

완결 게임의 진행 시간은 `game_over.occurred_at - game_start.occurred_at`으로
계산했다. PVE 207게임, multiplayer 23게임이 포함된다.

| 시간 지표 | 관찰값 |
| --- | ---: |
| 중앙값 | 54.673초 |
| P95 | 117.318초 |
| 최장 | 199.730초 |
| 10분 초과 완결 게임 | 0 |

불완전한 16게임 중 10게임은 기록된 `occurred_at`의 최대값과 최소값 차이가
10분을 넘는다. 가장 긴 관찰 구간은 21,236.542초(약 5시간 54분)이며,
이 게임에는 시작 기록과 placement 20,065건이 있지만 종료 기록이 없다.
이 값은 마지막으로 관찰된 이벤트까지의 구간이며 실제 종료까지의
진행 시간으로 해석하지 않는다.

따라서 이번 입력에서는 정상 종료 기준으로 장시간 문제 게임도 상당 부분
제외할 수 있다. 오래 기록된 원인이 AFK, 이벤트 저장 누락 또는 runtime
오류인지는 현재 집계만으로 확정할 수 없다.

## 3. 정제 기준

### 게임 단위 판정

| 조건 | 처리 | 사유 코드 |
| --- | --- | --- |
| 시작 또는 종료 이벤트 누락 | 게임 전체 제외 | INCOMPLETE_GAME |
| 시작 또는 종료 이벤트가 여러 개 | 게임 전체 제외 | AMBIGUOUS_GAME_LIFECYCLE |
| finishType이 normal이 아님 | 게임 전체 제외 | NON_NORMAL_FINISH |
| 시작·종료 시각 누락, 파싱 불가 또는 종료 <= 시작 | 게임 전체 제외 | INVALID_GAME_DURATION |
| 정상 종료됐지만 확정된 최대 진행 시간 초과 | 게임 전체 제외 | LONG_GAME |
| 필요한 schema/게임 상태가 유효하지 않음 | 해당 계약에 따라 제외 | 기존 validator 사유 |

게임 판정은 `gameId` 단위로 한 번 수행하고 해당 게임의 모든 placement에
같은 포함·제외 결과를 적용한다. 한 게임에서 중간 구간만 잘라 학습에
넣지 않는다.

장시간 기준은 다음 절차로 확정한다.

1. 진행 시간 분포를 PVE/multiplayer와 난이도별로 확인한다.
2. **10분(600초)을 초기 검토선으로 제안**하고 해당 게임의 이벤트 흐름을 확인한다.
3. 너무 긴 정상 종료 게임이 있으면 정상 플레이인지 기록 이상인지 검토한다.
4. 최종 `maxDurationSeconds`를 평가·학습 전에 고정한다. 현재 값은 미확정이다.
5. 평가 성능을 높이기 위해 결과를 보고 cutoff를 조정하지 않는다.

현재 입력에서는 10분 초과 완결 게임이 없으므로 이 검토선을 사용해도
완결 230게임에 추가 제외가 발생하지 않는다. 다만 board/schema/source
검증과 placement 필터를 통과한 최종 학습 게임 수는 아직 알 수 없다.

### 시간 필드 사용

- 정상 종료 게임: 시작과 종료 이벤트의 `occurred_at`으로 `durationSeconds` 계산
- 불완전 게임: 관찰 가능한 이벤트 시각으로 `observedSpanSeconds`만 기록
- `ingested_at`: DB 저장/수집 시각 진단에만 사용. 플레이 시간 계산에 사용하지 않음
- 시각이 누락됐다고 `ingested_at`으로 대체하거나 종료 시각을 추정하지 않음

### placement 단위 판정

기존 Human 행동 데이터 정책을 유지한다.

- `source=human`, `selection-policy=all-completed`: 완료 게임의 승자·패자 모두 포함
- 초반 pieceIndex 0~4 제외
- schema, board, activePiece, selectedPlacement와 필수 feature 검증
- 기존 후보 생성·reachability 검사로 실제 가능한 placement만 포함
- 난이도 누락·충돌은 기존 exporter 정책 적용
- 제외 placement는 reason과 함께 보존

mode, 난이도, 승패와 진행 시간은 평가용 metadata로 둔다.
이 값들을 임의로 새 feature에 추가하지 않는다. AI placement는 Human
모방 학습 라벨에서 제외하되 게임 문맥과 난이도 확인에 필요한 원본은 유지한다.

## 4. 구현과 데이터 산출물

현재 입력은 `event_type`, `game_id`, `payload`를 사용하는 DB row 형식이고,
기존 exporter는 `eventType`, `gameId` 등을 사용하는 앱 이벤트 형식을 읽는다.
또한 기존 exporter는 파일 전체를 문자열로 읽으므로 이 입력 크기를
그대로 처리할 수 없다.

새 규칙 엔진을 만들지 않고 기존 validator/exporter/candidate builder를
재사용하는 방향으로 다음 경계만 보완한다.

1. 줄 단위 읽기로 DB row를 검증하고 기존 이벤트 계약으로 변환한다.
   단순 key 이름 변경으로 끝내지 않고 payload와 시간 필드까지 계약에 맞춘다.
2. lifecycle과 시간 metadata를 먼저 집계해 게임별 판정을 확정한다.
3. 두 번째 읽기에서 포함 게임의 placement를 제한된 배치로 처리한다.
   후보 출력도 순차적으로 기록해 전체 입력과 후보를 메모리에 쌓지 않는다.
4. 기존과 동일한 입력에 대해 기존 exporter 결과가 유지되는지 확인한다.
5. 실행 전후 원본 SHA-256을 비교하고 새 versioned 출력 경로만 사용한다.

산출물은 기존 네 파일 계약을 유지하고, 게임 판정 근거를 하나 추가한다.

- `manifest.json`: source checksum, 정제 정책, cutoff, 행·게임·placement·candidate 수,
  source/mode/난이도 분포와 제외 사유 집계
- `train.jsonl`, `validation.jsonl`: 모델용 후보와 Human 선택 라벨
- `rejected.jsonl`: 기존 제외 행과 사유
- `game-quality.jsonl`: gameId별 lifecycle, duration/observed span과 모든 발견 사유,
  최종 판정 및 대표 제외 사유

원본 파일은 수정하지 않는다. output은 기존 dataset 경로를 덮어쓰지 않고,
실제 실행일과 최종 accepted game 수를 확인한 뒤 이름을 정한다.

## 5. 장시간 게임의 원인 확인

학습 제외와 원인 조사는 분리한다. 불완전한 장시간 게임은 제외 사유를
먼저 기록하고, 다음 정보로 원인을 좁힌다.

1. 시작, 마지막 Human placement, 마지막 AI placement와 종료 이벤트 유무
2. source별 placement 수, pieceIndex 진행, 연속 이벤트 간 최대 시간 간격
3. Human 입력이 멈춘 뒤 AI placement만 계속 기록됐는지
4. 게임 발생 시각과 DB 저장 시각 간격, 해당 시간대 서버 재시작·저장 실패 로그

원인이 확인되지 않으면 `cause=unknown`으로 남긴다. AFK나 서버 버그라고
단정하지 않는다. runtime 문제 수정은 별도의 재현·원인 분석 작업으로 진행한다.

## 6. 학습과 평가 데이터 분류

게임 수 증가와 학습 가능 게임 수 증가는 별도로 보고한다.
분류 순서는 게임 품질 판정 → Human placement 정제 → 기존/new gameId 분리다.

현재 작업폴더에는 과거 75/125게임 dataset snapshot과 해당 checkpoint가 없다.
체크섬이 기록된 기존 snapshot과 모델 artifact를 먼저 확보해야 한다.
현재 `human-behavior-v2` manifest의 13게임을 과거 기준선 대신 사용하지 않는다.

1. 과거 모델이 실제 학습한 gameId 집합과 모델·dataset checksum을 확인한다.
2. 정제된 새 입력과 과거 학습 gameId의 교집합을 계산한다.
3. 과거 학습 게임은 신규 평가에서 제외하고 중복 집계를 방지한다.
4. 실제 발생 시각으로 신규 cohort가 과거 학습 이후인지 확인한다.
5. 신규 평가 게임은 frozen 모델의 scaler, pair/weight 생성과 fit에 넣지 않는다.

과거 학습 cohort를 복구할 수 없다면 기존 모델에 대한 temporal holdout
평가를 주장하지 않는다. 이 경우 새 데이터만으로 별도의 baseline 실험을
설계하고 게임 단위 시간 순서 split을 고정하는 대안을 검토한다.

## 7. V4 평가와 다음 모델 후보

기존 채택 정책인 V4, 16-feature와 estimator 계약을 재사용한다.
V0~V3 비교나 새 feature 실험은 이번 데이터 확장에 섞지 않는다.

1. 신규 정제 cohort에서 기존 frozen V4를 재학습 없이 평가한다.
2. choice-required physical-class Top-1, Top-3, MRR, 평균 선택 순위를 본다.
3. 게임별 macro/worst case와 mode·난이도·진행 시간 구간별 결과를 확인한다.
4. 이 평가는 Human placement 모방 성능이며 게임 승률이나 안전성을 보장하지 않는다.
5. 결과 분석 후 신규 cohort를 다음 training pool에 포함할지 결정한다.
6. 포함이 결정되면 누적 training pool로 V4 모델 후보를 다시 batch fit한다.
7. 이때 학습에 넣은 신규 게임의 점수를 새 모델의 held-out 성능으로 보고하지 않는다.
   새 모델의 독립 성능 확인에는 별도로 남겨둔 미사용 게임 또는 이후 수집 게임을 사용한다.
8. model artifact와 dataset/feature/training 정책·checksum을 함께 보존한다.

PVE 적용은 Python/Node parity와 gameplay benchmark를 통과한 뒤 별도 단계로
진행한다. 정제 완료나 Human 모방 지표만으로 운영 AI를 교체하지 않는다.

## 8. 작업 순서와 완료 조건

| 단계 | 산출물 | 완료 조건 |
| --- | --- | --- |
| 1. 입력 감사 | 원본 checksum·게임 품질 집계 | 원본 불변, JSON/schema/lifecycle/시간 이상 집계 |
| 2. 정책 고정 | 정제 정책과 cutoff | 장시간 기준 확정, 제외 사유 우선순위 명시 |
| 3. 변환·정제 구현 | streaming 경로와 작은 smoke | 기존 계약 호환, 불완전·장시간 게임 제외, 이유 보존 |
| 4. 전체 데이터 export | versioned dataset bundle | count invariant, checksum, 메모리 제한, 결정적 출력 |
| 5. frozen 모델 평가 | temporal full report | gameId leakage 0, parameter 재학습 0, 전체 cohort 평가 |
| 6. 결과 분석 | cohort 편입 결정 | 전체·분포·worst case를 함께 검토 |
| 7. 누적 재학습 | 새 V4 모델 후보 | 유한한 parameter, convergence, 재현 가능한 artifact |
| 8. 별도 gameplay 검증 | parity·benchmark 결과 | 모델을 게임에 적용할 근거 확보 |

첫 구현 범위는 1~3단계다. ML 하네스 기본 `MODE=implement-smoke`에 따라
소규모 smoke와 필요한 검증 후 전체 export/평가 명령을 인계한다.
긴 full 실행은 사용자 실행 또는 명시적 `MODE=run-full` 승인으로 진행한다.
runtime, exporter 또는 테스트 코드를 변경하면 `bash scripts/verify.sh`를 실행하고,
Notebook 변경 시에는 ML 하네스의 추가 검증을 적용한다.

### 핵심 검증 항목

- 정상 종료 게임은 포함, 종료 누락·비정상 종료·중복 lifecycle 게임은 제외
- 장시간 경계값과 invalid duration 판정이 고정 정책과 일치
- 불완전 게임의 observed span을 정상 duration으로 오인하지 않음
- 과거 학습/신규 validation gameId 교집합 0
- 기존 소규모 입력의 exporter 결과와 신규 경로의 결과 일치
- accepted/rejected 집계가 입력과 일치하며 각 제외 사유를 역추적 가능
- 같은 원본·정책에서 동일한 출력, 원본 checksum 불변
- smoke 결과로 학습 성능이나 운영 적용을 판단하지 않음

관련 계약: [ML 실험 공통 계약](../../../ai-harness/ml-experiments/constraints.md),
[실험 실행 흐름](../../../ai-harness/ml-experiments/workflow.md),
[게임 로그 정책](game-log-dataset-policy.md).
