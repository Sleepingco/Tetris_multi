# agents.md — Tetris Multi & AI Learning Project

## 🎯 프로젝트 개요

싱글플레이와 server authoritative PVP/PVE, 규칙 기반 AI, placement 로그·평가·Python parity가 구현되어 있다.
기술 마이그레이션은 종료했으며 기존 gameplay와 데이터 파이프라인을 보존하면서 현재 요구를 개선한다.
LLM은 추후 분석 결과를 설명하는 보조 코칭 계층으로 검토하며 게임 판단의 원천으로 사용하지 않는다.
현재 구현 상태와 다음 작업은 [PLAN.md](PLAN.md), 실제 코드·테스트·Git을 기준으로 확인한다.

## 🛠 기술 스택과 실행

- Node.js + Express + Socket.IO, server authoritative multiplayer
- Vite multi-page + page-local React·TypeScript shell + TypeScript Canvas runtime
- Node 기준은 [.nvmrc](.nvmrc), 명령의 원천은 [package.json](package.json)이다.
- `npm run build` 후 `npm start`: `src/app.ts` → compiled `dist/server/app.js`
- `npm test`: server build 후 `node --test`. 변경 후 기본 검증은 `bash scripts/verify.sh`다.
- 실시간 room/match 상태는 process memory, local 분석은 JSONL, production event 저장은 명시적 PostgreSQL single-sink를 사용한다.

## 🧰 AI Harness 사용 규칙

- 공통 규칙은 이 파일을 따른다. 구조적인 작업은 [AI Harness 안내](ai-harness/README.md)에서 현재 요청의 모드만 선택한다.
- 단순 설명은 관련 코드와 설명 지침만 읽는다. 모든 작업 모드·과거 기록을 한꺼번에 읽지 않는다.
- 학습 중심 요청에는 [teaching guide](ai-harness/guides/teaching-style.md)를 추가한다.

| 요청 | 작업 지침 |
| --- | --- |
| 설명·문서화 | [documentation](ai-harness/tasks/documentation.md) |
| 기능 구현 | [implementation](ai-harness/tasks/implementation.md) |
| 점진적 리팩토링 | [refactor](ai-harness/tasks/refactor.md) |
| 버그 분석 | [bug-analysis](ai-harness/tasks/bug-analysis.md) |
| 변경 리뷰 | [review](ai-harness/tasks/review.md) |
| 규칙 기반 AI·feature·데이터 평가 | [ai-analysis](ai-harness/tasks/ai-analysis.md) |

반복 placement ML 실험은 [ML 안내](ai-harness/ml-experiments/README.md)에 따라 공통 계약, 현재 MODE의 절차·검증, 실험 명세 하나만 읽는다.
기본 MODE는 `implement-smoke`다. 긴 full 평가는 사용자가 실행하거나 `run-full`을 명시적으로 승인했을 때만 수행한다.
Report 해석은 `analyze-result`, 동결 감사는 `freeze-audit`로 구분한다. MODE나 환경변수를 설정하는 행위 자체는 승인이 아니다.
현재 branch·HEAD·dirty 파일·날짜·game count·checksum은 실행 시 확인한다. 다음 실험·재학습·runtime 통합을 자동 시작하지 않는다.

## 과거 마이그레이션 기록

[마이그레이션 archive](docs/archive/migration/README.md)는 종료된 작업의 계획과 검증 증거다.
현재 작업의 실행 지침으로 적용하지 않으며, 과거 설계나 이력을 조사할 때 필요한 문서만 읽는다.
보류 Goal은 당시 미실행 기록이다. 새로운 기술 전환은 현재 요구와 코드에 맞춰 별도로 계획한다.

## 🧱 모듈 책임

| 실제 경로 | 책임 |
| --- | --- |
| `src/app.ts`, `src/server/init.ts` | Express·HTTP·Socket.IO 서버 조립 |
| `src/client/game/core`, `state` | DOM·네트워크 없는 순수 판정과 게임 상태 |
| `src/client/game/runtime`, `entry` | 입력·timer·상태 전이 순서와 세션 연결 |
| `src/client/game/render`, `ui` | Canvas·HUD 표현. 표시용 계산은 가능하나 게임 규칙은 결정하지 않음 |
| `src/client/pages` | 네 page-local React shell과 page lifecycle |
| `src/client/net` | 브라우저 Socket.IO 메시지·동기화 어댑터 |
| `src/server/sockets` | 검증·라우팅·서비스 호출. 게임 규칙 자체를 만들지 않음 |
| `src/server/services/roomService.ts` | 방 생성·참가·퇴장·시작·종료·로비 복귀 |
| `src/server/services/matchService.ts` | server bag과 authoritative player state |
| `src/server/services/authoritativeTickerService.ts` | room gravity와 snapshot lifecycle |
| `src/server/validators`, `repositories` | 외부 입력 검증과 저장소 경계 |

문서와 제안은 실제 구조를 기준으로 작성한다. 파일 위치와 caller는 변경 전에 다시 확인한다.

## 🤖 학습과 협업

- 사용자가 직접 구현하겠다고 하면 코드 작성을 멈추고 개념·설계 순서·힌트·검증 기준을 제공한다.
- 구현을 요청하면 허용된 범위의 작업을 진행하면서 변경 이유와 확인 방법을 설명한다.
- 설명은 왜 → 무엇 → 어떻게 순서로, 쉬운 한국어와 필요한 작은 예제·도식을 사용한다.
- 논리 단계를 생략하거나 과도하게 단순화하지 않는다. 추측과 확인한 사실을 구분한다.
- 학습용 예제와 단계별 안내의 세부 형식은 teaching guide를 따른다.

## ⚙️ 코딩 컨벤션

- client는 ESM, server는 TypeScript를 CommonJS로 컴파일하는 현재 경계를 유지한다. 기존 CommonJS 테스트와 shared `.mjs` 경로를 임의로 전환하지 않는다.
- 들여쓰기 4칸, 세미콜론, `const` 우선과 필요한 `let`, `var` 금지.
- 코드 식별자는 영어, 함수명은 `camelCase`, DOM 클래스는 `kebab-case`를 사용한다.
- 이름으로 충분히 설명되는 getter/setter·지역 변수에는 불필요한 주석을 붙이지 않는다.
- 복잡하거나 외부에서 호출되는 함수·부작용 함수에는 필요한 입력·출력·역할을 docstring으로 설명한다.
- 설명 주석은 한국어 또는 영어로 일관되게 쓰고 한 블록 안에서 혼용하지 않는다.

## 🧭 설계 원칙

1. 현재 요구를 가장 단순하게 해결한다. 미래 확장을 위한 helper·manager·service를 미리 만들지 않는다.
2. 복잡한 조건에 의미를 부여하거나 명확한 경계를 만드는 helper는 허용하지만 단순 전달 래퍼는 지양한다.
3. 같은 의미의 상태를 여러 곳에 각각 수정 가능한 원천으로 저장하지 않는다. 파생값·캐시는 계산 원천과 동기화 규칙이 분명해야 한다.
4. 멀티플레이의 최종 판정은 서버가 소유한다. 클라이언트 prediction·보정과 서버 상태를 독립적인 최종 원천으로 만들지 않는다.
5. 충돌·고정·줄 삭제·점수·공격은 core와 실행 흐름에서 결정하고 render는 결과를 표시한다.
6. React는 HUD와 page lifecycle을 담당하고 Canvas runtime의 게임 상태를 중복 소유하지 않는다.
7. 공용 component·hook·context는 실제 중복이나 명확한 필요가 있을 때 도입한다.
8. Express + Socket.IO와 현재 계층을 유지한다. 새 프레임워크는 사용자 요청 범위와 복잡도 감소 근거가 있을 때 별도 변경으로 검토한다.

## 🔧 변경 원칙

- 변경 전에 이유·영향 파일·검증 방법을 설명하고 필요한 caller·test·config를 함께 확인한다.
- 한 변경은 하나의 이유를 갖는다. 기능·구조·스타일 정리는 가능하면 분리하되 기능에 필요한 최소 정리는 함께 할 수 있다.
- 전체 파일 교체를 피하고 모듈별 작은 변경으로 플레이 가능한 checkpoint를 유지한다.
- 프레임워크 도입은 기능 수정 중간에 섞지 않는다. 도입 이유·영향·rollback·검증 기준을 먼저 정한다.
- 새 패키지는 Node 호환성·안정 버전·breaking change·lockfile 영향을 확인한다. 근거 없는 major upgrade를 하지 않는다.
- Git 상태와 사용자 변경을 먼저 확인한다. 사용자 파일을 임의로 reset·stash·checkout·삭제하지 않는다.
- 변경이 충돌하면 보존할 내용을 보고한다. 해결 가능한 환경 문제는 승인된 범위에서 해결하고 범위 확장이 필요한 경우 설명한다.
- 사용자 지시에 포함된 권한은 유지한다. push·merge·배포·브랜치 삭제·파괴적인 Git 작업을 임의로 추가하지 않는다.
- 작업 완료 뒤 다음 기능·실험·기술 전환을 자동 시작하지 않는다.

## 🧪 디버깅 원칙

- 수정 전에 기대 동작·실제 동작·원인 가설과 최소 재현 입력·순서를 정리한다.
- 상태 로그·호출 흐름·조건 분기를 확인한다. 원인을 설명할 수 없는 수정은 피한다.
- 버그 수정은 원래 재현과 관련 회귀 동작으로 확인한다.

## 보안과 데이터 경계

- payload의 자료형 검증과 인증·인가를 구분한다. playerId·roomId·nickname·client snapshot을 신원 증명으로 신뢰하지 않는다.
- 상태 변경 Socket event는 player/socket 소유권을 확인한다. 입력 크기·빈도·queue 상한을 유지한다.
- session token·credential·개인정보를 URL·로그·public payload·오류·dataset에 노출하지 않는다.
- DB는 분석 event 저장소이며 실시간 room/match 상태의 원천이 아니다. DB await가 authoritative input/ticker의 critical section을 막지 않게 한다.
- storage mode별 단일 sink, bounded retry·timeout·in-flight·shutdown과 명시적 실패 보고를 유지한다. 조용한 fallback·dual-write를 추가하지 않는다.
- schema·feature version, dataset lineage·split·seed를 보존한다. source dataset과 canonical 산출물을 임의로 덮어쓰지 않는다.
- 운영 DB row·volume·로그를 rollback 과정에서 삭제하지 않는다. 배포·backup·restore 기준은 [운영 runbook](docs/operations/deployment/postgres-production-runbook.md)을 따른다.

## 실행 검증과 완료 보고

- 런타임 코드·테스트·빌드 또는 실행 동작을 변경하면 완료 전에 `bash scripts/verify.sh`를 실행한다.
- 관련 브라우저·DB·ML 검증은 변경 범위에 맞춰 추가한다. 필수 검증을 생략하거나 같은 검증을 근거 없이 반복하지 않는다.
- 문서만 변경하면 전체 테스트를 생략할 수 있다. `git diff --check`, 변경 문서의 링크·경로·코드 블록을 확인하고 테스트가 읽는 문서 계약도 보존한다.
- 필수 검증 실패·미실행 상태는 완료가 아니다. 환경 문제와 코드 실패를 구분하고 통과·실패·미검증을 보고한다.
- 완료 보고에는 변경 이유·결과·검증·남은 위험과 필요한 rollback을 포함한다. 변경 이력은 `change-log.md`, 현재 상태는 `PLAN.md`에 기록한다.
