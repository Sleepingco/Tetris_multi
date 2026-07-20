# ML Experiment Verification

## 공통 preflight

- 현재 worktree, branch와 HEAD
- 기존 dirty/untracked 파일
- 허용 변경 파일
- Source와 dataset 경로
- 환경 버전

## `implement-smoke` gate

Notebook 또는 테스트를 변경했다면 다음을 수행한다.

1. 새 targeted Python test
2. `npm run verify:ml`
3. `bash scripts/verify.sh`
4. `git diff --check`
5. trailing whitespace 검사
6. Source Notebook output이 비어 있는지 확인
7. 기존 canonical result와 허용 밖 파일이 불변인지 확인

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
