# Migration Run Records

완료한 Goal의 일시적인 실행 증거를 이 폴더에 남긴다.

파일 이름:

```text
goal-<번호>-YYYY-MM-DD.md
```

필수 항목:

- Goal과 목적
- 기준 main SHA
- branch와 검증 대상 commit 목록
- Node/npm 및 주요 dependency 버전
- 변경 파일과 의도된 기능 변화
- 실행한 명령과 실제 결과
- 수동 검증
- 실패 또는 미실행 범위
- 보안·데이터 영향
- 남은 위험
- rollback
- merge gate 상태

실행 기록 파일은 자기 자신의 commit SHA나 아직 생성되지 않은 main merge SHA를 기록하지 않는다. 최종 branch HEAD와 main 반영 SHA는 완료 보고와 다음 Goal preflight에서 Git으로 확인한다.

이 기록은 `PLAN.md`를 대체하지 않는다. 진행 중인 상태는 `PLAN.md`, 완료된 변경 사실은 `change-log.md`에서 관리한다.
