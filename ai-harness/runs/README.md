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

Executed Notebook과 큰 JSON report는 repository가 아니라 `/private/tmp`에 둔다. 영구 근거가 필요할 때만 별도 canonical result를 사용자 승인으로 추가한다.
