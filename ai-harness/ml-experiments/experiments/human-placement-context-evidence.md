# ML Experiment: 사람 배치 기록의 상태·규칙 근거 점검

## 질문과 범위

- Experiment ID: `human-placement-context-evidence`, MODE: `implement-smoke`.
- Lifecycle: `sample_analyzed`. 사용자 실제 작은 표본 실행·결과 해석을 완료했다. 전체 데이터·상태 복원·모델 학습 완료가 아니다.
- 질문: **같은 Train 표본 3개에 관측 시점·규칙·행동 상태 복원에 필요한 어떤 근거가 남아 있는가?**
- [이전 연결 점검](human-placement-action-link-readiness.md)과 [계약](../../../docs/ai-ml/contracts/human-placement-action-link.md)을 재사용한다. 새 모델 비교·학습 실험이 아니라 기록 근거 감사다.
- Source·manifest·품질·split·player binding·sourceLine 118015/118021/118023은 이전 점검과 같다. Validation/Test·새 수집·DB·live log를 사용하지 않는다.
- Notebook 하나만 추가한다. 별도 Python/테스트·게임 규칙·replay runner·패키지를 만들지 않는다.

## 확인할 근거와 한계

1. 규칙 버전·관측 단계·build marker의 명시 여부를 확인한다. 필드가 있어도 실제 과거 빌드와 연결됐다고 자동 승인하지 않는다. 20행/스키마 번호/날짜만으로 규칙 버전을 추정하지 않는다.
2. 기록된 시도열의 순서·시간 범위·동시각 간격과 입력별 전후 상태/outcome 필드 유무를 집계한다. 시간은 처리 시도 기록이며 tick→ms 환산이나 반응시간 해석을 하지 않는다.
3. Envelope occurred_at과 마지막 입력 createdAt의 수치 차이는 별도 진단이다. 서로 같은 clock이라는 증명이나 ingest latency/첫 판단 대기시간으로 해석하지 않는다. ingested_at은 시간 계산에 사용하지 않는다.
4. 같은 player·연속 pieceIndex인 선택 표본에서 이전 boardAfter와 다음 boardBefore의 셀 차이를 비교한다. 같아도 전체 중간 상태가 불변이거나 replay 가능하다는 뜻은 아니다. 다르면 사건 원인을 단정하지 않는다.
5. 같은 pieceType/rotation인 active/selected 기록의 pivot-relative 셀 집합이 일치하는지 비교한다. 이는 저장 표현의 내부 일관성이지 core geometry·SRS·충돌/도달 가능성 검증이 아니다. Rotation이 다르면 미비교로 둔다.

이전/결과 보드·최종 배치·마지막 입력 여부는 사후 진단 전용이다. 학습 feature나 다음 행동 정답 보정에 사용하지 않는다.

## 실행 계약

- Source: `scripts/ml/notebooks/human_placement_context_evidence.ipynb`.
- 이전 연결 Notebook의 `definitions` 셀만 SHA로 고정해 재사용한다. 실행 셀·사용자 출력은 실행하지 않으며 기존 Notebook을 수정하지 않는다.
- 기본 모두 실행은 가상 Smoke·내부 assert·pandas/Matplotlib만 수행한다. 실제 파일을 읽는 점검은 `RUN_CONTEXT_SAMPLE=False`를 별도로 켠다.
- 실제 runner는 기존 `run_train_sample()`로 source/품질/Train 연결을 재확인한 후 지정 raw 3개만 파싱한다. Source 전후 checksum을 재검증한다. 전체 raw bytes 읽기는 checksum용이며 다른 game payload는 파싱하지 않는다.
- `HUMAN_CONTEXT_SMOKE_REPORT`, `HUMAN_CONTEXT_SAMPLE_REPORT`로 새 JSON 경로를 지정할 수 있다. 기본은 메모리 결과이며 기존 결과·source alias·symlink/hardlink를 덮어쓰지 않는다.
- 실제 출력은 해당 실험의 ignored `data/ml-experiments/` 또는 임시 경로만 허용한다. 환경변수 설정은 Full/학습 승인이 아니다.
- Full cohort·실제 replay·dataset 생성·모델 학습·runtime은 미구현이며 명시적으로 차단한다.

## Gate·검증

- 결과는 `context_evidence_audit_complete`, `runMode=smoke`, `auditScope=synthetic/train_sample`, modelFitCount 0, replayExecuted false, fullCohortCovered/policyDecisionEligible/canonicalResultEligible false다.
- Presence와 검증 상태를 구분한다. Replay readiness/상태 조건부 학습 준비를 이 감사만으로 true로 만들지 않는다.
- 내부 assert: marker 누락·잘못된 marker, 수치 시간/clock 제한, malformed 상태/보드 격리, actor/piece 불연속의 비교 차단, 동일/차이 보드, rotation별 offset 일치/불일치/미비교, 입력 불변·가상 결정성·실제 기본 off·출력 보호.
- 새 code의 headless 가상 Smoke, 기존 `npm run verify:ml`과 `bash scripts/verify.sh`, source output/ID·문서 검사로 검증한다. 기존 사용자 실행본의 형식 gate 실패를 보존해 별도로 보고한다.
- 이번 요청은 코드 작성이다. 실제 새 근거 감사·Full·replay·학습은 자동 실행하지 않는다. 다음은 사용자의 작은 표본 실행 결과를 해석하는 단계다.

## 허용 변경과 보존

새 Notebook·이 명세·현재 계획/안내/PLAN/change-log만 필요한 만큼 수정한다. 기존 Notebook·원본·dataset/report·runtime·테스트/의존성은 변경하지 않는다.
Commit/push/merge는 하지 않는다. Rollback은 새 코드/문서·참조 변경만 되돌리는 범위이며 운영 데이터 삭제는 없다.

## 구현·검증 — 2026-11-02

- Notebook 19개 cell: 이전 연결 정의를 고정 SHA로 재사용하고 marker·시간·snapshot 경계·저장 offset의 근거를 독립적으로 표시한다. 기존 Notebook/원본/report·게임 core는 수정하지 않았다.
- 내부 검사 네 묶음: snapshot/actor 경계·차이, offset 비교/marker와 build binding의 구분, 시간/잘못된 입력/불변/결정성, 독점 출력 보호를 확인했다. 실제 파일 open을 막은 기본 모두 실행도 통과했다.
- 가상 headless 2회: 각각 오류 0·그래프 1개, report byte-identical. SHA `0e9f71b3fe0a4198bc04c505c34100e717c0bf3c7e63e30cd7a505adb0203a3f`.
- 필수 verify: Node 793 pass·기존 1 skip·0 fail. 현재 ML: Node 35 pass·Python 213/220, 기존 사용자 실행 Notebook의 output/count·Full 설정 5 fail·2 error를 보존했다. 격리된 Git HEAD 원본 Python 회귀 220/220과 새 Notebook 내부/headless 검증을 구분한다.
- 새 실제 점검 함수·Full·replay·fit·dataset 출판·runtime·stage/commit은 실행하지 않았다. 구현 맥락을 확인하기 위해 기존 지정 raw 세 줄의 필드만 읽었으며 새로운 실제 결과 report는 생성하지 않았다.
- 사용자 실행: Notebook 4절의 `RUN_CONTEXT_SAMPLE=True`로 바꾸고 설정 → 실행 → 결과를 실행한다. 저장하려면 아직 존재하지 않는 `SAMPLE_OUTPUT` JSON 경로를 지정한다. 기본 None이면 메모리 결과만 표시한다.

## 사용자 표본 결과·사용 범위 결정 — 2026-11-02

- 저장된 Notebook의 `train_sample` 출력에서 원본 3개·격리 0·같은 actor의 연속 배치 경계 2개를 확인했다. 실행 오류는 없었다. 이 해석에서 점검/학습을 재실행하지 않았다.
- 두 boundary는 저장 snapshot이 같아 changedCells 0이다. 입력 순서 끊김/시간 역전 0, 마지막 기록 행동은 세 구간 모두 hard_drop이다. 같은 rotation 표본 두 개는 저장 offset이 일치하며 한 개는 회전이 달라 미비교다.
- 세 표본 모두 명시된 ruleset/stage/build marker와 입력별 전후 상태/outcome이 없다. 이는 전 원본의 결측률이나 재현 불가능 판정이 아니다. 수치상 이벤트 시각/tick과 마지막 입력이 같아도 공유 clock·action별 보드 상태의 증명은 아니다.
- 사용자 실행 결과는 Notebook에 보존돼 있다. 별도 새 JSON을 만들거나 source 출력을 지우지 않았다. 과거 가상 SHA를 실제 사용자 결과 SHA로 제시하지 않는다.
- 결론은 부분 기록의 내부 일관성 확인과 상태/규칙 근거의 한계 확정이다. [offline-use-v1](../../../docs/ai-ml/contracts/human-placement-action-link.md#9-기존-로그의-학습-사용-범위--offline-use-v1)에 따라 과제별 view 구성으로 진행한다. 같은 결측 감사·전체 replay·새 수집을 선행 반복하지 않는다.
- 다음 명세는 [오프라인 view 구성](human-placement-action-offline-views.md)이다. 이번에는 사용 범위·명세만 정했으며 새 Notebook·dataset·모델 학습·runtime·commit은 하지 않았다.
