# Codebase Cleanup Goal Prompt

## 권장 실행 설정

- 모델: GPT-5.6 Sol
- 추론 수준: High
- 대안: 실행 시간과 사용량보다 최대 안전성을 우선하면 Extra High(`xhigh`)
- subagent: read-only caller 조사와 테스트 검토에는 GPT-5.6 Terra / Medium 사용 가능

GPT-5.6 Sol / High를 기본으로 권장한다. 이 작업은 계획이 이미 구체적이지만 runtime, Socket.IO, garbage ownership, 테스트와 문서를 함께 추적해야 하므로 Terra보다 Sol이 적합하다. Max/Ultra는 이 범위에는 과하고, Medium은 Phase 2~4의 경계 검토에 다소 낮다.

## Goal 입력문

아래 코드 블록의 내용만 Goal 입력란에 붙여 넣는다.

```text
docs/codebase-cleanup-plan.md를 단일 실행 기준으로 삼아 코드베이스 정리 작업을 끝까지 구현하라.

먼저 AGENTS.md, PLAN.md, docs/codebase-cleanup-plan.md와 필요한 ai-harness 작업 지침을 읽고 현재 코드·테스트·Git 상태를 확인하라. Ponytail full/YAGNI 기준을 적용하되, 삭제 전에는 반드시 rg로 모든 production caller와 sibling path를 추적하라.

목표:
- 계획서의 Phase 0부터 Phase 5까지 순서대로 수행한다.
- 각 phase는 한 가지 이유만 가진 작은 변경으로 유지한다.
- 실제 사용되지 않는 legacy/dead path만 삭제하고 기존 gameplay 동작을 보존한다.
- 각 검증 gate를 통과한 뒤에만 다음 phase로 진행한다.

필수 경계:
- core/state/runtime/render/ui/entry 책임과 server authoritative ownership을 유지한다.
- clientSequence, lastProcessedClientSequence, pending-input 보호, mutation FIFO, snapshot correction을 유지한다.
- server pendingGarbageQueue, pendingGarbageLines DTO, core/garbage.js를 유지한다.
- trust-boundary validation, chat 보안, 오류 처리, 접근성, JSONL log/validator/repository, JS/Python parity 경로를 약화하지 않는다.
- 새 dependency, 새 abstraction, compatibility layer, full snapshot 최적화, 프레임워크 migration, 새 기능을 추가하지 않는다.
- Optional CLI parser 전환과 현재 보류 항목은 구현하지 않는다.

실행 규칙:
- 기존 미커밋 변경은 사용자 작업으로 보고 보존한다. cleanup과 무관한 파일은 수정하지 않는다.
- 독립적인 caller 조사·테스트 검토는 subagent로 병렬화할 수 있지만, 같은 파일을 여러 agent가 동시에 수정하지 않게 한다.
- Phase 4는 현재 production replay/export consumer와 바로 다음 승인 작업을 확인한다. 구체적인 소비자가 없으면 server inputLog를 제거하고, 있으면 유지한 이유를 보고한다.
- Phase 5는 앞선 삭제 후 남은 완전히 동일한 setup만 기존 fixture/test.beforeEach로 축소한다. 범용 fixture framework나 option-heavy helper는 만들지 않는다.
- 변경된 현재 계약은 active 문서에 반영하되 change-log, 과거 Q&A, archive는 다시 쓰지 않는다.
- 계획서에 적힌 명령을 실제로 실행한다. 실패하면 원인을 고치고 재실행하며, 실패 또는 미검증 상태에서 다음 phase로 넘어가거나 완료라고 보고하지 않는다.
- Git commit, push, merge, branch 삭제는 수행하지 않는다. 최종 diff를 phase별 commit 후보로 정리한다.

중단하고 사용자 판단을 요청할 조건:
- production caller가 발견되어 삭제가 실제 동작을 바꾼다.
- 계획 범위를 넘어선 protocol/schema/architecture 변경이 필요하다.
- 기존 사용자 변경과 충돌해 안전하게 보존할 수 없다.
- 같은 검증 실패가 반복되고 계획 범위 안에서 해결할 수 없다.

완료 조건:
- docs/codebase-cleanup-plan.md의 필수 Phase와 전체 완료 조건을 모두 충족한다.
- bash scripts/verify.sh와 요구된 PVP/PVE/rollback E2E가 통과한다.
- rollback E2E는 최종 상태에서 5회 반복 통과한다.
- 삭제 대상의 production caller가 없고 dependency 수가 변하지 않는다.
- 최종 응답에 phase별 변경, 삭제·보존 경계, 실행한 검증과 결과, 건너뛴 조건부 항목, 남은 위험, git diff 통계를 보고한다.
```

## 사용 메모

- Goal을 시작한 뒤에는 같은 task에서 상태를 확인하고 제약을 추가한다.
- 독립된 다른 작업을 동시에 실행한다면 같은 checkout을 쓰지 않는다.
- 문서보다 긴 지시를 Goal 본문에 반복하지 않는다. 계획 문서가 상세 범위와 검증의 단일 기준이다.
