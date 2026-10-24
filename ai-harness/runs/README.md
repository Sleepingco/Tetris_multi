# AI Harness Run Records

이 디렉터리는 필요한 경우 실험·검증 실행 증거를 남기는 곳이다. Run record는 공통 계약이나 실험 명세를 대체하지 않는다.

권장 이름:

```text
<experiment-id>-<mode>-YYYY-MM-DD.md
```

최소 기록:

- Worktree, branch와 검증 대상 commit
- MODE와 experiment 파일
- 입력 dataset과 checksum
- 실행 명령
- 통과·실패·미실행 검증
- 생성된 report 경로와 SHA-256
- Source 불변성
- 다음 gate

Executed Notebook과 큰 JSON report는 실행 중 `/private/tmp`를 사용할 수 있다.
장기 근거는 프로젝트의 ignored `data/ml-experiments/<experiment-id>/` 등에 보존하고
위치·checksum을 기록한다. `/private/tmp`를 유일한 보관본으로 사용하지 않는다.
Git에 canonical result를 추가하는 것은 별도 결정이다.
