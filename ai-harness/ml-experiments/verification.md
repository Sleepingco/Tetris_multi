# ML Experiment Verification

## 공통 preflight

- 현재 worktree, branch와 HEAD
- 기존 dirty/untracked 파일
- 허용 변경 파일
- Source와 dataset 경로
- 환경 버전

## `implement-smoke` gate

Notebook 또는 테스트를 변경했다면 다음을 수행한다.

1. 개발 중 변경에 맞는 targeted Python test로 확인한다.
2. 최종 상태에서 `npm run verify:ml`과 `bash scripts/verify.sh`를 실행한다. 전자는 Node/Python parity, 후자는 type/build/artifact/compiled test를 검증한다.
3. 위 suite에 포함된 targeted test와 `git diff --check`는 같은 최종 상태에서 별도로 중복 실행하지 않는다. 실패 분석이나 추가 변경이 있으면 관련 검증을 다시 실행한다.
4. Source Notebook output과 execution count가 비어 있는지 확인한다.
5. 기존 canonical result와 허용 밖 파일이 불변인지 확인한다.

정확한 실행 명령은 [ML 스크립트](../../scripts/verify-ml.sh)와 [기본 스크립트](../../scripts/verify.sh)를 기준으로 한다. 필수 검증이 실패하거나 미실행이면 완료로 보고하지 않는다.

Smoke 확인:

- Error와 traceback 0
- Leakage 0
- Fit과 score가 finite
- Expected count invariant 통과
- `runMode: smoke`
- `fullCohortCovered: false`
- `policyDecisionEligible: false`
- `canonicalResultEligible: false`
- Source checksum 불변

Full metric과 full 결정성은 `implement-smoke` 완료 조건이 아니다.

## `run-full` gate

- 구현 이후 Notebook·dataset checksum 불변
- 명세의 전체 validation cohort 사용
- `runMode: full`
- `fullCohortCovered: true`
- `policyDecisionEligible: true`
- `canonicalResultEligible: false`
- Leakage 0
- Convergence 확인
- Error와 traceback 0
- Source checksum 불변
- Report SHA-256 기록

두 번 실행은 다음 경우에만 요구한다.

- Pair, weight, scaler, estimator, sorting 또는 report 계산 코드 변경
- Freeze 후보
- 이전 실행과 비결정성 의심

`canonicalResultEligible: true`는 freeze audit에서 요구한 반복 실행과 canonical 보존까지 통과한 경우에만 사용할 수 있다.

데이터만 추가되고 검증된 계산 경로가 같으면 첫 평가는 한 번 실행한다.

## `analyze-result` gate

- Report의 input checksum이 실제 dataset과 일치
- Train/validation gameId 교집합 0
- Validation이 fit에 포함되지 않음
- Variant 외 고정 조건이 동일
- Primary와 diagnostic metric이 구분됨
- Worst case와 sample size가 함께 보고됨
- Smoke 결과를 성능 근거로 사용하지 않음

## 문서만 변경한 경우

- 링크 존재
- Code fence 짝
- trailing whitespace
- `git diff --check`

전체 테스트는 생략할 수 있으며 생략 이유를 보고한다.
테스트가 직접 읽는 실험 명세의 경로·계약을 바꾸면 해당 계약 테스트를 추가 실행한다. 과거 실행 기록을 이번 검증 결과로 사용하지 않는다.
