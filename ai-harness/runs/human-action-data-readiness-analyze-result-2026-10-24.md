# Human action data readiness — analyze-result

- Date: 2026-10-24 (Asia/Seoul)
- Worktree: 로컬 Tetris_multi, branch `main`
- 기준 HEAD: `bbf26b72554907017765338c331416f32debc80a`
- MODE: `analyze-result`
- [명세](../ml-experiments/experiments/human-action-data-readiness.md), [구현·smoke 이력](human-action-data-readiness-implement-smoke-2026-10-24.md)
- 사용자가 완료한 full 실행을 해석했다. 기존 deployment·AI 문서·ML 경로 이동 등
  dirty/untracked 변경은 보존했다. 계산 코드·증거 파일·raw·모델은 변경하지 않았다.

## 왜 이 검사를 했는가

사람다운 입력 간격·행동 순서·hold를 학습하려면 입력 기록이 존재한다는 사실과
그 기록이 정확한 상태/시간/성공 label을 제공한다는 사실을 구분해야 한다.
이번 결과는 학습 준비 전체 승인이나 모델 성능 평가가 아니다.

## 증거와 실행 범위

- Source: `data/datasets/tetris-ml-snapshots-backup-0908/raw/game-events.jsonl`
- Source bytes: 650,669,388; report의 전체 행 수: 122,095.
- Source SHA-256: `eb64f86731ecb148ebf398773cb8e23cdf71217fc44f3bcb88460299bb092344`
- Full report: `data/ml-experiments/human-action-data-readiness/full-report.json`
- Report SHA-256: `27f2a5dc3dae6143d22b0930987b3cd102e90d07ae1f228deadd0da41db41b4a`
- Executed Notebook: 같은 디렉터리의 `executed-full.ipynb`
- Executed SHA-256: `5d3feb9f2ec0d9727d6f74aafcb1e255dbdde9b24dd81235b43e4e1a3d723baa`
- 현재 source Notebook SHA-256: `dc80ff5c3c5e08b907efbe0bb34f226878303ec51487907d514770e2c3d1ec53`

사용자는 nbconvert 완료 메시지를 제공했다. 실행본의 cell ID/종류/코드·설명 내용은
현재 source와 일치하고 error output은 0이다. 정확한 당시 shell 환경 전체와 package
version은 full report에 없으므로 독립 환경 재현성까지 확인했다고 주장하지 않는다.
재현 명령은 명세의 환경변수 포함 full 명령을 사용하고 report는 새 이름으로 생성한다.
파일명에 full을 붙이는 것과 `HUMAN_ACTION_RUN_MODE=full` 설정은 서로 다르다.

## 확인한 집계

전체 placement 121,619건 중 Human 10,816 / heuristic 110,803이다. Human만 상세
분석했으며 완료 게임의 승자만 선택한 결과가 아니다. JSON 실패·invalid·중복·identity
충돌은 report에서 모두 0이다. Human 235게임 중 lifecycle의 completeNormal은
225게임이지만 미완결 게임 전체를 일괄 제외하지 않았다.

| 과제 | usable | limited | unverified | unusable |
| --- | ---: | ---: | ---: | ---: |
| 기록된 입력 간격 | 10,645 | 171 | 0 | 0 |
| 상태 조건부 다음 행동 | 0 | 0 | 10,816 | 0 |
| Hold 정책 | 0 | 0 | 10,816 | 0 |

- 입력 88,845건, valid/timestamp 존재 88,845건. 이 구조 검사는 입력 성공 증명이 아니다.
- 간격 78,029개, 0ms 972개, median 158ms / p95 351ms / max 5,383ms.
- Hold 포함 1,160구간, 시도 1,173건, 성공 미확인 1,173건.
- Piece gap 109구간: 수집 한도·hold·그 밖의 원인으로 확정하지 않는다.
- 행동 종류에는 rotate_ccw 39건처럼 희소한 label도 있다. 현재 과제의 분포 진단이며
  분할·balance 처리나 모델 학습을 수행한 것은 아니다.

전체 placement의 geometry는 20×10, schema는 v1 1건/v2 121,618건이다.
ruleset과 관찰 단계는 unspecified이며 Human은 client_reported다.
현재 v3/40행 데이터에 이 결과를 일반화하지 않는다.

## 검증과 판단

Report flags: `runMode=full`, `fullCohortCovered=true`, `dataDecisionEligible=true`,
`modelFitCount=0`, `policyDecisionEligible=false`, `canonicalResultEligible=false`,
`sourceUnchanged=true`, `replayStatus=unverified`.

Report의 parsing/source 합계 불변식과 Human/heuristic 분리, 입력 합계를 검사했다.
상세 구간에서 과제별 readiness와 hold 시도를 재집계했고 cohort gameId의 유일성·
구간 소속을 확인했다. 실제 원본 SHA/bytes를 재확인했다. 전체 raw 감사를 재실행하거나
행 수를 별도로 다시 세지는 않았다. Full 한 번을 routine 데이터 감사 근거로 사용하며
full run1/run2 결정성 검증이나 canonical 동결을 주장하지 않는다.

`data_readiness_audit_complete`: 기록 시간 차이 분석은 가능하다. 다만 모든 구간의
`TIMESTAMP_SEMANTICS_UNVERIFIED`, `START_STATE_UNVERIFIED`, `INPUT_OUTCOME_UNKNOWN`을
그대로 유지한다. 숫자가 유한하고 순서가 맞는 것과 실제 사람의 조작 시간이 검증되는
것은 다르다. 전체 unverified는 학습 불가능의 증명이 아니라 증거 부족 상태다.

## 다음 질문 하나

**기존 inputSequence timestamp는 어느 시점에 기록됐으며 어떤 간격을 뜻하는가?**

기록 당시 코드/버전과 연결되는 근거를 찾아 입력 요청·처리·자동 반복·성공 여부 중
무엇을 관측한 값인지 확인한다. 현재 코드와 닮았다는 이유만으로 과거 의미를 확정하지
않는다. 확인 범위로 timing-only dataset을 정의하고, 확인 불가 시 recorded interval
분석으로 의미를 제한한다. 상태/hold는 별도 replay·수집 계약 전까지 보류한다.

이번 작업은 그 조사를 구현하거나 새 명세를 작성하지 않는다. 새 full 실행·학습·
dataset 생성·운영 DB·runtime 변경·파일 삭제·stage/commit/push도 하지 않았다.
문서 링크·fence·공백을 확인하며 계산 코드가 그대로여서 전체 테스트는 반복하지 않는다.

## 후속: 입력 시각 생성 경로 조사 (같은 날)

위 다음 질문에 대한 후속 코드 조사를 완료했다. [계약의 조사·timing-only 범위](../../docs/ai-ml/contracts/human-action-dataset.md#입력-시간-생성-경로-조사-2026-10-24)에
caller·저장 경계·예제·재현 명령을 정리했다. 새 source 분석 코드·Notebook은 만들지 않았다.

- `recordAppliedInput`은 Date.now를 기록하고 그 뒤 `handleAction`이 성공/실패를 정한다.
  브라우저 keydown timestamp·repeat 여부·입력별 outcome은 저장된 입력 배열에 없다.
- Git의 tetris.ts→tetris.js 경로 이력 43개 중 기록 함수가 있는 38개 버전을 검사했다.
  함수 본문(공백 정규화 후)은 하나였고 38개 모두 action 실행 전에 기록했다.
  현재 구현과 초기 `9db8fe1`, authoritative commit 경계 `83e29f9`, TS 전환 `cda715e`를 확인했다.
- 현재 session은 applied=true인 local action만 서버에 보내지만 placement inputSequence는
  local 시도 기록이다. 최종 placement의 commit 확인이 과거 개별 action 성공을 증명하지 않는다.
- 초기 canonical projector `ad9345a`와 현재 projector 모두 nested createdAt을 그대로 보존한다.
  DB의 occurred_at·ingested_at과 입력별 createdAt을 혼용하지 않는다.
- Raw 표본 3건만 필드 확인했다. source line 39,516 / 118,015 / 119,699이며
  원본 epoch·신원은 문서에 복사하지 않았다. 각 경기의 실행 build는 연결하지 못했다.
- Node 24.18.0의 현재 runtime을 일회성 synthetic 입력으로 확인했다. 타이머·Date.now를
  프로세스 내에서만 제어해 enqueue 1,000→소비 9,000→기록 9,000, 실패한 벽 이동 기록,
  hold true/false 둘 다 시각 9,100 기록, stale piece 입력 제외를 assert로 통과했다.
  이후 mock을 복원했다. 실제 사람 키 입력·과거 engine replay·full 재실행은 아니다.
- 기존 report의 usable 구간만 재집계해 hold 포함 1,160 / hold 없음 9,485를 확인했다.
  9,485는 dataset 후보 구간 수이며 새 pair 필터 통과 수나 학습 표본 수가 아니다.

판단: 기록된 처리 시도 간격으로 한정한 탐색적 timing baseline은 진행 가능하다.
경기별 build·성공·상태 미확인을 유지하며 원 report의 flags/reason/checksum은 변경하지 않는다.
다음은 별도 timing-only dataset 실험 명세를 고정하는 작업이다. 학습·추론기·수집 변경·
새 dataset 생성·파일 삭제·stage/commit은 수행하지 않았다.
