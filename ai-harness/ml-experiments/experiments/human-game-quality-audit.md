# ML Experiment: Human 게임 품질 감사

## 상태와 질문

- Experiment ID: `human-game-quality-audit`
- Lifecycle: `analyzed`, MODE: `analyze-result` — 사용자 full 완료·첫 timing dataset 정책 승인
- Task: 학습 전 게임 품질 검토, model fit·dataset export 없음
- 질문: 정상 참여 Human 게임과 조기 포기/장시간/AI 단독 진행 의심 기록을 어떤 근거로 구분할 수 있는가?
- [행동 dataset 계약](../../../docs/ai-ml/contracts/human-action-dataset.md#1단계-게임-품질-gate), [현재 계획](../../../docs/ai-ml/strategy/ai-plan.md)

## Baseline과 고정 범위

기존 적합성 감사는 원본 유효성·과제별 구간 상태를 조사했다. 이번 변경 변수는
게임 품질 gate다. 승자 선택·feature·estimator·게임 규칙은 바꾸지 않는다.
PVE는 Human만, PVP는 양쪽 Human을 대상으로 한다. AI 이벤트는 기록 이상 진단용이다.
전수 metadata와 선택 cohort의 상세 결과를 분리한다. legacy/v3 규칙을 승격하거나
서로 다른 원본을 합치지 않는다. 상태 복원·hold 성공·engine replay는 미검증으로 남긴다.

## 검토용 후보 정책 — 확정값 아님

| 파라미터 | provisional-review-v1 |
| --- | ---: |
| shortGameReviewSeconds | 30 |
| maxGameDurationSeconds | 600 |
| abandonmentTailMinPieces | 5 |
| aiOnlyTailReviewSeconds | 60 |

위 숫자는 분포·사례를 검토하기 위한 단일 후보이며 사용자 채택이나 학습 승인이 아니다.
Full을 수행해도 `policyStatus=provisional_review_only`를 유지한다. 모델 결과로
기준을 조정하지 않는다. 별도 확정 전에는 dataset을 생성하지 않는다.

- 정상이고 duration < 30초이며, 한 Human의 종료 직전 연속 pieceIndex 5개 이상에서
  다른 action 없이 hard_drop만 기록되면 `EARLY_ABANDONMENT_SUSPECTED`로 review.
- duration > 600초는 `ABNORMAL_LONG_GAME` 제외 후보. 실제 버그라고 단정하지 않는다.
- 마지막 Human 원본 행 뒤의 AI 이벤트끼리 관측 시각 span > 60초면
  `AI_ONLY_CONTINUATION_SUSPECTED`로 review. 원본 순서가 실제 실행 순서임을 가정하지 않는다.
- 짧기만 하거나 hard_drop 비율만 높다는 이유로 포기를 확정하지 않는다.
- Human이 전혀 없는 게임은 `NO_HUMAN_DATA`로 제외 후보. 미완결/시각 누락·역전,
  혼합 규칙·source 오류·mode 불명확 등은 review다. 제외 조건이 함께 있으면
  exclude_candidate가 우선하지만 모든 사유는 보존한다.

목록은 `include_candidate`, `exclude_candidate`, `review`다. include_candidate도
구간 검증과 정책 승인을 통과한 학습 목록이 아니다. 하나의 Human 의심 패턴은
첫 보수적 정책에서 게임 전체에 적용하며 PVP 상대 데이터 감소도 함께 검토한다.

## 시간·identity·개인정보

- DB row: occurred_at의 timezone 포함 ISO 시각. app event: startedAt/endedAt/createdAt.
- ingested_at이나 마지막 placement 시각으로 게임 종료를 보간하지 않는다.
- Human createdAt과 AI/서버 시각을 빼서 실제 Human 이탈 시간으로 쓰지 않는다.
- observedSpanSeconds는 혼합 이벤트 시계의 관측 진단으로만 표시한다. duration과 다르다.
- 기존 Notebook의 streaming parser·identity 충돌 격리·구간 판정을 재사용한다.
  기존 index에 내부 `allValidByLine` metadata만 추가한다. 이전 report 형식·판정은 유지한다.
- nickname/token/원본 playerId·epoch·보드를 report에 복사하지 않는다.
  gameId/source line과 게임 내 playerNumber로 추적한다. unknown mode 원문은 내보내지 않는다.
- source SHA/bytes와 공통 Notebook SHA를 기록하고 실행 중 바뀌면 게시하지 않는다.
  기존 파일·symlink·hardlink·source alias 출력은 공통 경로 보호로 거부한다.

## 허용 파일과 산출물

- `scripts/ml/notebooks/human_game_quality_audit.ipynb`: 설명·worked example·단계별 감사
- `scripts/ml/tests/test_human_game_quality_notebook.py`: Notebook 정의를 직접 검사
- 기존 readiness Notebook: metadata index 한 필드 추가만 허용
- 이 명세·현재 AI 계획·공통/ML 안내·AI 문서 안내·행동 dataset 계약·PLAN/change-log·해당 run record
- report/실행본: ignored `data/ml-experiments/human-game-quality-audit/` 또는 임시 경로

새 parser `.py`, 학습기·dataset exporter·runtime·수집 코드·dependency는 추가하지 않는다.
단, 사용자 요청의 결과 시각화 보완으로 pandas 표·Matplotlib 그래프와
`environment-ml.yml`의 `matplotlib-base=3.10.8`만 추가한다. 감사 계산·분류·report는 바꾸지 않는다.
Source는 `data/datasets/tetris-ml-snapshots-backup-0908/raw/game-events.jsonl`이다.

## 환경과 실행

| 변수 | 기본값 |
| --- | --- |
| HUMAN_GAME_QUALITY_SOURCE | 위 repo-relative 원본 |
| HUMAN_GAME_QUALITY_RUN_MODE | smoke 또는 full, 기본 smoke |
| HUMAN_GAME_QUALITY_REPORT | /private/tmp/human-game-quality-smoke.json |
| HUMAN_GAME_QUALITY_POLICY | 미설정 시 위 후보 정책, 설정 시 정확한 네 키의 JSON |

정책 JSON의 bool·비유한/음수·0·알 수 없는 키·역전한 경계·2 미만/비정수 조각 수는 거부한다.
원본 전체 metadata scan 후 smoke 상세 cohort는 Unicode 순서 Human 첫 3게임과
있다면 Human 없는 첫 게임 1개다. Full은 모든 game을 상세 조사한다.

사용자 full 명령(저장소 루트, 기존 report가 있으면 새 파일명 사용):

```bash
mkdir -p data/ml-experiments/human-game-quality-audit
env -u HUMAN_GAME_QUALITY_POLICY \
IPYTHONDIR=/private/tmp/human-game-quality-ipython \
HUMAN_GAME_QUALITY_SOURCE=data/datasets/tetris-ml-snapshots-backup-0908/raw/game-events.jsonl \
HUMAN_GAME_QUALITY_RUN_MODE=full \
HUMAN_GAME_QUALITY_REPORT="$(pwd)/data/ml-experiments/human-game-quality-audit/full-report.json" \
conda run -n tetris-ml jupyter nbconvert \
  --to notebook --execute scripts/ml/notebooks/human_game_quality_audit.ipynb \
  --ExecutePreprocessor.timeout=600 \
  --output "$(pwd)/data/ml-experiments/human-game-quality-audit/executed-full.ipynb"
```

공통 parser는 정의 셀만 읽으며 readiness Notebook의 실제 감사 셀은 실행하지 않는다.
Source Notebook은 output/execution count를 비워 보관한다. 사용자는 executed-full을
읽으면 설명·검토 표·개별 근거를 함께 볼 수 있다. 중단은 Ctrl-C다.

## Report·검증·해석 gate

- reportSchemaVersion=1. smoke는 `human_game_quality_smoke_valid`, 유효한 full은
  `needs_quality_policy_review`. source 계약 오류가 있으면 `source_contract_invalid`다.
- fullCohortCovered는 full에서만 true. qualityReviewComplete는 전체 조사 범위를 뜻한다.
- 모델 채택용 policyDecisionEligible, 학습 데이터 승인용 dataDecisionEligible,
  canonicalResultEligible는 항상 false. modelFitCount=0, datasetExported=false.
- 게임 수 = 세 분류 수 합. 상세 Human 수는 선택한 source metadata와 일치하며
  full에서는 전체 Human 수와 일치해야 한다. 사유는 중복 가능하므로 합산 분모가 아니다.
- mode/난이도는 game 단위, 승패 표는 Human player 단위. 원본에 없는 승자는 unknown.
- duration 분포는 공통 helper를 쓰며 짝수 표본의 median은 아래쪽 중앙값이다.
- 검사: 짧은 정상 패배/연속 drop 경계, 장시간 경계, lifecycle/시각 누락·중복,
  source 중복·충돌, PVP 양쪽, AI tail 시계 분리, 정책/출력 보호, source 변경,
  결정성·smoke/full flag·Notebook ID/순서/빈 output.
- 실제 smoke 두 report의 byte 결정성, 기존 readiness smoke report 불변성과 공통
  검증 지침의 targeted → verify:ml → 필수 verify를 확인한다. full은 사용자가 실행한다.

Full을 해석한 다음 정책 수치와 제외 편향을 확인하고 별도 dataset 명세를 작성한다.
이 실험은 cutoff 최종 채택·raw 삭제·정제 dataset 생성·모델 학습·사이트 승격을 하지 않는다.

## Implement-smoke 결과 (2026-10-24)

- `human_game_quality_smoke_valid`: 4게임 / Human 139구간.
- include_candidate 3 / exclude_candidate 1 / review 0. 제외 후보는 Human 기록 없는 게임이며
  종료가 없어 duration을 추정하지 않았다. 27.93초 정상 Hard 경기는 포함 후보로 남았다.
- 최종 smoke run1/run2 bytes와 SHA-256 일치:
  `60a4f4947545eb27783ad159e0ce7145a2493198cb92c5aa278a47c8f84882a5`.
- 새 검사 17개, verify:ml Node 35/Python 148, 필수 verify Node 781 pass·기존 1 skip 통과.
- Source 불변, 두 executed Notebook error 0, source Notebook output 비움.
- 기존 readiness smoke SHA `257b4371…6ec26` 유지. 공통 내부 metadata 노출은 이전 report를 바꾸지 않았다.
- [실행 기록](../../runs/human-game-quality-audit-implement-smoke-2026-10-24.md).
  당시 Full은 미실행이었으며 후보 정책과 실제 학습 대상은 미확정이었다. 후속 상태는 아래를 따른다.

## 사용자 full 결과와 별도 정책 채택 (2026-10-24)

- 전체 246게임: include_candidate 213 / exclude_candidate 11 / review 22.
- 포함 후보 Human 10,516구간, 검토 Human 300구간이다. 11개 제외 후보에는 Human 기록이 없다.
- 검토는 조기 포기 의심 12(Hard), AI tail+미완결 7, 그 밖의 lifecycle 미확인 3이다. 의심을 확정 포기·버그로 승격하지 않는다.
- Full report SHA: `97388649259414fe2f5119e76ffa57922b3202f85c920540674f0fc494973ff4`.
- 246게임 분류/목록/구간 합계, 실행본 error 0, 당시 source 셀 일치·원본 SHA를 확인했다. Matplotlib 보완 뒤에는 별도 시각화 실행본을 만들고 원 report를 유지했다.
- 사용자는 213게임 사용·22게임 격리·11게임 Human 없음 제외를 명시적으로 승인했다.
  첫 [timing dataset](human-timing-dataset.md)에서 `quality-policy-v1`로 기록한다.
  이 감사 report의 당시 `provisional_review_only`, SHA, code lineage는 바꾸지 않는다.
