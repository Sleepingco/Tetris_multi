# ML Experiment: Human 조작 데이터 적합성 조사

## 상태

- Experiment ID: `human-action-data-readiness`
- Lifecycle: `analyzed` — 사용자 full 감사 완료·결과 검증 완료, 후속 범위 판단 기록
- Result status: `data_readiness_audit_complete`
- Recommended mode: `analyze-result` — 재실행이나 다음 실험의 자동 시작 지시가 아님
- Task: 입력 순서·시간·hold 문맥의 복원 가능성 조사
- 관련 계약: [Human 조작 dataset](../../../docs/ai-ml/contracts/human-action-dataset.md)
- 관련 계획: [현재 AI 계획](../../../docs/ai-ml/strategy/ai-plan.md)

## 질문 하나

기존 Human 원본에서 조작 간격·다음 행동·hold 학습에 사용할 수 있는 구간은
어느 범위이며, 어떤 상태와 시간은 복원할 수 없는가?

## Baseline과 고정 조건

기존 raw 이벤트를 근거로 구조상 이용 가능 구간과 replay로 검증한 구간을 구분한다.
모델 metric이나 채택 판정을 만들지 않는다. 과거 v1/v2와 현재 v3 ruleset은 분리한다.
상태 복원이 안 되면 시간/순서 조사만 수행하고 의미를 줄여 보고한다.

이번 단계는 모델 비교가 아닌 **학습 과제별 데이터 적합성 감사**다.
Feature/scaler/estimator/학습 split/모델 metric은 해당 없음이다. 정답이나 미래
행동이 입력에 들어가는지 검토하지만 fit하지 않았다는 이유로 leakage 검증을
통과했다고 표시하지 않는다. Train/validation/test 생성은 다음 dataset 단계다.

## 입력

- 첫 대상: `data/datasets/tetris-ml-snapshots-backup-0908/raw/game-events.jsonl`.
  실행 직전 실제 존재·byte 수·line 수·SHA-256을 확인한다. 과거 집계 수치를 assertion으로 고정하지 않는다.
- 한 실행은 source 하나만 읽는다. `data/logs/game-events.jsonl` 또는 보존한 v3 export는
  별도 실행의 대상이다. 서로 다른 파일의 결과를 더하거나 training pool로 합치지 않는다.
- 입력 파일은 실행 중 변하지 않는 보관본을 사용한다. 읽기 전후 checksum이 다르면
  source 변경으로 실패 처리한다. live log가 변경되면 해당 실행 결과를 채택하지 않는다.
- DB row의 `event_type/schema_version/game_id/player_id/piece_index/payload`와 app event의
  camelCase 필드를 원본 형식에 맞춰 해석한다. 외부 envelope와 payload가 충돌하면 사유를 남긴다.
- Schema v1/v2/v3를 구분한다. 규칙 정보가 없으면 `unspecified`와 관측 geometry를
  별도로 기록한다. 20행이라는 이유만으로 과거 빌드·lock delay·종료 규칙까지 확정하지 않는다.
- 운영 DB·네트워크에 접속하지 않는다. Source 형식 변환·새 파일 복사 자체는 이 조사에서 수행하지 않는다.

### 환경변수 계약

| 변수 | 값·기본값 | 검증 |
| --- | --- | --- |
| `HUMAN_ACTION_SOURCE` | 위 첫 대상의 repo-relative 경로 | repo-relative 경로와 입력 존재 검증, 실제 경로 기록은 로컬 실행 기록에만 |
| `HUMAN_ACTION_RUN_MODE` | 기본 `smoke`, 또는 `full` | 다른 값 거부. full 설정 자체는 실행 승인이 아님 |
| `HUMAN_ACTION_REPORT` | 기본 `/private/tmp/human-action-data-readiness-smoke.json` | full은 명시적으로 새 출력 경로 지정 |

기존 환경을 사용하고 새 dependency를 추가하지 않는다. 코드·raw·기존 artifact를
출력으로 덮지 않는다. output 기존 파일·symlink와 source의 canonical path/inode
충돌을 거부한다. report는 검사 완료 뒤에만 게시한다. 실패한 부분 report를
정상 완료 산출물로 남기지 않는다.

## 구현 범위와 산출물

구현은 `scripts/ml/notebooks/human_action_data_readiness.ipynb`와 해당
`scripts/ml/tests/test_human_action_data_readiness_notebook.py`를 대상으로 한다.
원본은 streaming으로 읽고 Notebook은 worked example과 제외 사유를 설명한다.
공통 하네스, 로그 writer·DB·runtime·기존 trainer/Notebook/canonical 결과는 수정하지 않는다.

허용 변경은 위 Notebook·테스트, 이 명세의 구현 상태·명령, 필요한
`ai-harness/runs/human-action-data-readiness-<mode>-<date>.md`다.
별도 parser service·새 학습기·dataset exporter는 만들지 않는다. raw 전체 문자열이나
모든 placement 보드를 메모리에 모으지 않는다. 메타데이터 pass와 선택 구간 pass를
나눌 수 있으며 같은 파싱·판정 함수를 smoke/full에서 사용한다.

Notebook에서 확인할 항목:

1. DB row/app event 형식, schema/ruleset/trust/관찰 단계와 source
2. event 중복·충돌, game/player/piece/action lineage와 시각·순번
3. 입력 timestamp 생성 의미, 성공 여부·시작 상태·queue/hold 기록 시점
4. hold 시도/성공 미확인/문맥 복원 가능 수, hold 전후 경계의 작은 예제
5. 누락·단절·보정·rate-limit 근거와 과제별 적합 구간 수
6. replay에 필요한 증거의 존재. 이번 구현에서는 엔진 replay를 실행하지 않고 `unverified`로 기록
7. source checksum 재확인, 결정적 report와 후속 작업 범위

조작 action의 미래 값을 feature로 사용하지 않는다. 같은 game을 쪼개 검증하지 않는다.
현재 core를 Python에서 재구현하지 않는다. 역사 빌드 확보·Node replay runner 추가는
이번 allowlist 밖이다. 구조 검사가 통과한 것을 엔진 replay 통과로 표현하지 않는다.

### Notebook 읽기·실행 순서

1. 질문·비목표·용어: placement, 입력 시도, 성공, 조각 교체와 관찰 단계
2. 작은 worked example: 일반 이동 / 빈 hold / 보관 조각 교체 / 실패·미확인 hold
3. 환경·MODE·경로 보호와 실제 source checksum
4. Streaming 파싱, DB/app 형식과 schema·source·trust·ruleset 분포
5. identity 중복·충돌, game lifecycle·player/piece 경계
6. Human inputSequence 필드·순서·시간과 빈 값/누락의 구분
7. 조각 단절·hold·기록 시작 상태·queue 시점·성공 여부 증거
8. 과제별 적합성 표, 이유 코드·편향·미검증 replay
9. 집계 불변식·checksum 재검사·결정적 report
10. 결과 해석·한계·다음 작업 하나

각 cell은 의미 기반 고정 ID를 갖고 source output/execution count는 비운다.
Worked example은 synthetic임을 표시하고 실데이터 count에 합치지 않는다.

## 검사·이유 코드

| 검사 | 기록할 값과 처리 |
| --- | --- |
| 파싱·형식 | blank/JSON 실패/unsupported event·schema/envelope 충돌을 별도로 집계 |
| event identity | DB identity는 envelope 기준. app event는 eventType/game/player/piece의 명시적 key 사용. 동일 key·동일 내용은 한 번, 다른 내용은 충돌 격리 |
| lineage | game/player/piece 누락·같은 piece의 중복·입력 pieceIndex 불일치·sequence 역전/중복·게임 내 ruleset 혼합 |
| 시각 | 유한 createdAt 존재율·시간 역전·0ms 간격·간격 분포. tick 단위 미확인은 ms로 변환하지 않음 |
| 구간 | pieceIndex 공백은 `PIECE_GAP`, 원인은 `unknown`. 별도 거부 증거가 있을 때만 rate limit으로 분류 |
| 상태·성공 | `START_STATE_MISSING`, `INPUT_OUTCOME_UNKNOWN`, `TIMESTAMP_SEMANTICS_UNVERIFIED`를 구분 |
| Hold | 시도 수·구간 수, 성공 증거, hold 직전 active/slot/공개 queue/사용 가능 상태의 존재·출처 검사 |
| 관찰·신뢰 | client_reported와 server_authoritative, lock/clear/garbage/spawn 단계를 별도 분포로 표시 |

최종 holdPiece에서 hold 전 슬롯을 역산하거나, hold action 하나를 성공 증거로
사용하지 않는다. 비교용 hold 미사용 구간에서도 사용 가능 여부가 확인되는지 검사한다.
첫 행동 이전의 시각 근거가 없으면 반응시간 label을 만들지 않는다. 미완결 게임은
게임 품질로 표시하되 그 안의 모든 입력을 자동 제외하지 않는다. 공백을 가로지르는
간격·이력은 학습 적합 구간으로 연결하지 않는다.

결측·invalid reason은 겹칠 수 있다. 분포용 다중 reason count와 합계 검증용
단일 처리 결과를 구분한다. 변환한 canonical 내용으로 중복을 비교할 때 raw
내용 차이를 숨기는 필드 삭제·v3 승격·unknown 값 보간을 하지 않는다.

## 적합성 판정표

판정은 game 전체가 아니라 **과제별 구간**에 부여하고 원본 위치로 추적할 수 있게 한다.

| 판정 | 의미 |
| --- | --- |
| `usable` | 명시한 제한적 과제에 필요한 증거가 있음. 예: 정의된 기록 시각 사이의 간격 분석 |
| `limited` | 일부 순서·간격만 사용 가능하며 상태 조건부 학습·반응시간 등은 지원하지 못함 |
| `unverified` | 구조적 단서는 있지만 생성 의미·hold 전후 상태·성공·replay 증거가 부족 |
| `unusable` | 해당 과제의 identity·순서·시간·경계가 깨져 사용할 수 없음 |

각 과제는 `logged_inter_action_timing`, `next_action_with_state`, `hold_decision`으로
분리한다. 단일 전체 readiness score를 만들지 않는다. 시간 분석 usable과 사람다운
controller 학습 가능을 동일시하지 않는다. 깨끗한 일부 로그로 전체 수집의 완전성을 주장하지 않는다.

## Smoke와 full

1차 streaming pass는 전체 source의 파싱·identity·game 메타데이터를 확인한다.
Smoke의 상세 분석은 Human 입력이 있는 gameId를 Unicode code-point로 정렬해
앞의 최대 3게임을 선택한다. 가능하면 hold를 포함한 첫 게임 하나를 추가한다
(최대 4게임). lifecycle 완결 여부로 먼저 고르지 않는다. 선택 ID와 규칙을 report에 남긴다.
full은 모든 Human 게임·구간을 상세 검사하며 임의 head/행 제한을 적용하지 않는다.
소스 전체 스캔 집계와 smoke 선택 cohort 상세 집계는 report에서 분리한다.

Synthetic 검사는 일반 이동·빈 hold/교체·같은 조각 hold·실패/미확인 hold,
timestamp 누락/0ms/역전, sequence 중복/역전, piece 공백/불일치, identity 중복/충돌,
v2/v3·ruleset 혼합, output 경로 충돌과 checksum 변화, 비정상 JSON을 포함한다.

사용자가 저장소 루트에서 실행할 full 명령이다. 이번 implement-smoke에서는 실행하지 않았다.
기존 full-report.json이 있으면 보호 오류로 멈추므로 다른 새 이름을 사용한다.

```bash
mkdir -p data/ml-experiments/human-action-data-readiness
IPYTHONDIR=/private/tmp/human-action-ipython \
HUMAN_ACTION_SOURCE=data/datasets/tetris-ml-snapshots-backup-0908/raw/game-events.jsonl \
HUMAN_ACTION_RUN_MODE=full \
HUMAN_ACTION_REPORT="$(pwd)/data/ml-experiments/human-action-data-readiness/full-report.json" \
conda run -n tetris-ml jupyter nbconvert \
  --to notebook --execute scripts/ml/notebooks/human_action_data_readiness.ipynb \
  --ExecutePreprocessor.timeout=600 \
  --output "$(pwd)/data/ml-experiments/human-action-data-readiness/executed-full.ipynb"
```

커널은 conda 환경에 포함된 python3를 사용한다. GUI에서는 tetris-ml 환경을 선택한다.
실행을 중단하려면 터미널에서 Ctrl-C를 사용한다. 실패한 감사는 완성 report를 게시하지 않는다.
Report를 열어 source SHA, runMode=full, fullCohortCovered=true, modelFitCount=0,
과제별 readiness/이유와 replayStatus=unverified를 확인한다. traceback이 있거나 report가
없으면 결과 분석 단계로 넘어가지 않는다. Full 실행은 모델 학습이 아니다.

## Report 계약과 불변식

JSON report는 `reportSchemaVersion: 1`, `experimentId`, `runMode`와 다음을 포함한다.

- `fullCohortCovered`: smoke=false, full 전체 감사 완료 시에만 true
- `policyDecisionEligible: false`, `canonicalResultEligible: false`, `modelFitCount: 0`
- `dataDecisionEligible`: full 감사·불변식·source 불변이 모두 통과한 경우에만 true
- source 상대 경로·SHA·bytes·행 수, source 전체 집계, 선택 cohort와 과제별 집계
- schema/source/mode/trust/ruleset 분포, 누락·이유·hold 증거, 대표 worked example
- `replayStatus: unverified`, 과제별 readiness와 추가 수집 필요 필드

이 감사는 정책 채택 평가가 아니므로 full/analyze-result에서도 공통 모델 평가의
`policyDecisionEligible: true` 조건 대신 위 데이터 감사 계약을 적용한다.
full은 fit/성능 검증이 아니며 `dataDecisionEligible`도 모델·운영 승인을 뜻하지 않는다.

필수 불변식:

1. nonblank line = parsed + parse failure
2. parsed = unique valid event + exact duplicate + identity conflict row + invalid/unsupported row
3. unique placement = Human + heuristic + 그 밖의 source (원인별 유일한 bucket)
4. Human 구간 수 = 과제별 usable + limited + unverified + unusable
5. input array 원소 수 = valid + invalid action record (빈 배열·누락은 별도)
6. full 상세 Human 수 = 전체 스캔의 해당 unique Human 수
7. 실행 전후 source checksum 일치, modelFitCount=0

충돌 identity의 첫 행도 최종 conflict bucket으로 옮겨 unique valid와 중복 계산하지 않는다.
다중 reason 합은 위 식에 넣지 않는다. 분모와 중복 처리 전후 수를 함께 기록한다.

정렬·example 선택은 결정적으로 하고 report에 절대 경로·닉네임·token·원본
wall-clock timestamp·실행시간을 넣지 않는다. 시간 정보는 상대 간격과 분포로 보존한다.
gameId/원본 line으로 trace하고 player는 game 내 결정적 가명 번호로 표시한다.
동일 source·옵션의 smoke run1/run2 report가 byte-identical인지 확인한다.
장기 보관이 필요한 full 근거는 `data/ml-experiments/human-action-data-readiness/`에
ignored copy와 checksum을 보존하고 `/private/tmp`만 남기지 않는다.

## 검증과 인계

- 구현 시 parser·판정의 작은 synthetic 회귀, Notebook cell 순서/ID·output/환경 계약을 검사한다.
- 실제 source smoke와 결정성 확인 후 공통 [검증 지침](../verification.md)의
  implement-smoke gate를 수행한다. 문서만 바꾸는 경우에는 문서 검증을 적용한다.
- run record에는 실제 branch/HEAD/dirty·환경·source·허용 변경·실행 명령·report SHA,
  통과/실패/미검증을 남긴다. 과거 집계나 CI 결과를 이번 실행의 결과로 사용하지 않는다.
- 구현 인계에는 source와 report 경로가 채워진 full 명령, 예상 출력·해석 순서와
  실패 시 중단 방법을 포함한다. Full 시간 예측이 필요하면 별도 timing으로 측정한다.

## 판단 기준

- 모델 adopt/reject가 아니라 과제별 `usable`, `limited`, `unverified`, `unusable` 판정이다.
- raw/중복/제외/사용 수가 맞고 근거를 추적할 수 있어야 한다.
- hold 흔적만 존재하는 경우 hold 정책 학습 가능으로 판정하지 않는다.
- timestamp가 있다는 이유만으로 첫 반응시간·물리 key timing을 복원했다고 하지 않는다.
- legacy→buffer 규칙 동등성, 운영 수집 완전성, 프로 수준 전략은 주장하지 않는다.
- Source mutation, label leakage, 신원 정보 노출, 입력 계약 모호함은 중단 사유다.

일반적인 필드 결측·invalid row·모호한 timestamp 의미는 감사 결과로 보고한다.
집계는 계속할 수 있지만 해당 과제를 usable로 올리지 않는다. 파서가 형식을
해석할 수 없거나 모호함을 임의 추정해야만 진행 가능한 경우, count 불일치,
원본 변경·출력 보호 실패·신원 노출은 실행 실패로 중단한다.

완료 후에는 dataset 생성 범위와 추가 수집 필요 항목만 제안한다. 모델 학습·수집
정책 변경·사이트 통합·배포를 자동 시작하지 않는다.

## Full 결과와 다음 gate (2026-10-24)

사용자가 실행한 [full 결과 분석 기록](../../runs/human-action-data-readiness-analyze-result-2026-10-24.md)을 기준으로 한다.
235개 Human 게임·10,816구간·88,845개 입력을 상세 감사했다. 기록 간격 분석은
usable 10,645 / limited 171이며, 상태 조건부 next action과 hold 정책은 모두
10,816구간 unverified다. Hold 시도 1,173건은 성공 여부를 확인하지 못했다.

원본 전체 placement의 110,803건은 heuristic, 10,816건은 Human이다. 행동 적합성
상세 집계에는 Human만 사용했다. 전체 placement는 20×10, schema v1/v2이며
ruleset과 관찰 단계는 unspecified다. 현재 v3/40행 데이터로 해석하지 않는다.

- Full report SHA-256: `27f2a5dc3dae6143d22b0930987b3cd102e90d07ae1f228deadd0da41db41b4a`
- `fullCohortCovered=true`, `dataDecisionEligible=true`, `modelFitCount=0`.
- `policyDecisionEligible=false`, `canonicalResultEligible=false`, `replayStatus=unverified`.
- 간격은 기록된 timestamp의 차이다. 첫 반응시간·물리 키 입력 시간·성공한 조작의
  시간 분포라고 단정하지 않는다. usable과 timestamp 의미 미검증은 모순이 아니라
  서로 다른 판단 범위다. 게임 완결이나 piece 공백만으로 실제 누락 원인을 확정하지 않는다.

Full 분석 직후의 다음 질문은 **기존 inputSequence timestamp가 어디에서 생성됐으며
어떤 간격을 뜻하는가**였다. 후속 코드 조사에서 runtime 처리 시도 직전의 Date.now와
38개 역사 버전의 동일 기록 함수를 확인했다. 경기별 build binding은 여전히 미확인이다.
[조사 근거와 timing-only 범위](../../../docs/ai-ml/contracts/human-action-dataset.md#입력-시간-생성-경로-조사-2026-10-24)를 따른다.
다음 gate는 행동 모방용 게임 품질 감사와 인접 입력 간격 dataset의 별도 명세를
정하는 것이다. PVE/PVP 모두 Human 승패가 아니라 조기 포기·비정상 장시간·기록
품질을 기준으로 한다. 9,485구간은 게임 품질 gate 전 후보이며 최종 수가 아니다.
[게임 품질 계약](../../../docs/ai-ml/contracts/human-action-dataset.md#1단계-게임-품질-gate)을
먼저 적용한다. 기존 감사에서는 미완결 구간을 자동 제외하지 않았지만 첫 학습 dataset은
새 게임 gate를 적용한다. 상태·hold 정책은 후속 replay/수집 계약 검증 전까지 보류한다.
새 명세·Notebook·dataset·모델·수집 변경은 이번 조사에서 시작하지 않았다.

## Implement-smoke 결과 (2026-10-24)

- Source: 650,669,388 bytes / 122,095 lines,
  SHA-256 `eb64f86731ecb148ebf398773cb8e23cdf71217fc44f3bcb88460299bb092344`.
  전체 metadata scan은 Human 10,816건, exact duplicate/identity conflict/parse failure는 0이다.
- 상세 cohort: 고정 규칙으로 선택한 4게임, Human 184구간·입력 1,514건·hold 시도 21건.
- logged_inter_action_timing: usable 182 / limited 2. 상태 조건부 next action과 hold는
  각 184구간 모두 unverified다. hold 시도 21건의 성공 여부는 모두 미확인이다.
- Smoke report run1/run2 byte-identical,
  SHA-256 `257b4371eb23d35a0aa94b389829c30ed34502c28d6ba4704f125ea7ccb6ec26`.
- Synthetic/Notebook 테스트 16개, verify:ml Node 35·Python 131개 통과.
  필수 verify는 Node 781 pass·기존 1 skip·0 fail이다. 실행 조건과 환경 실패/보완은
  [run record](../../runs/human-action-data-readiness-implement-smoke-2026-10-24.md)에 보존했다.
- fullCohortCovered=false, dataDecisionEligible=false, policyDecisionEligible=false,
  canonicalResultEligible=false, modelFitCount=0. 이 관측으로 전체 데이터의 적합성이나
  새 controller 성능을 결론 내리지 않는다.
