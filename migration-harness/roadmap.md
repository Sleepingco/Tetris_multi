# Migration Roadmap

이 문서는 Goal의 순서와 의존 관계만 관리한다. 구현 상세는 현재 Goal 파일 하나에서 관리한다.

| Goal | 목적 | 선행 Goal | 권장 브랜치 |
| --- | --- | --- | --- |
| [0](goals/00-baseline.md) | 최신 main 위에 안정화 기준선 재구성 | 없음 | `codex/stabilize-migration-baseline-v2` |
| [1](goals/01-vite-typescript-foundation.md) | Vite multi-page build와 TypeScript 공존 기반 | 0 | `codex/migrate-vite-typescript-foundation-v2` |
| [2](goals/02-player-session-security.md) | player session/reconnect 소유권 보안 | 1 | `codex/secure-player-session` |
| [3](goals/03-socket-contract-zod.md) | typed Socket contract와 Zod payload 검증 | 2 | `codex/type-socket-contracts` |
| [4](goals/04-server-typescript-build.md) | server TypeScript build와 shared core 출력 구조 | 3 | `codex/add-server-typescript-build` |
| [5](goals/05-react-shell.md) | React index/lobby shell | 4 | `codex/migrate-react-shell` |
| [6](goals/06-react-single.md) | runtime display bridge와 single React | 5 | `codex/migrate-react-single` |
| [7](goals/07-react-multiplayer.md) | multiplayer/PVE React | 6 | `codex/migrate-react-multiplayer` |
| [8A](goals/08a-typescript-core-state.md) | production core/state TypeScript 전환 | 7 | `codex/migrate-typescript-core-state` |
| [8B](goals/08b-typescript-client-runtime.md) | production client runtime/render/net/AI TypeScript 전환 | 8A | `codex/migrate-typescript-client-runtime` |
| [8C](goals/08c-typescript-server.md) | production server TypeScript와 compiled artifact 경계 완성 | 8B | `codex/migrate-typescript-server` |
| [8D](goals/08d-typescript-tests-tooling.md) | test/e2e/scripts 선택적 TypeScript 정리 | 8C, 선택 | `codex/cleanup-typescript-tests-tooling` |
| [9](goals/09-postgres-shadow.md) | PostgreSQL append-only shadow storage | 8C | `codex/add-postgres-event-shadow` |
| [10](goals/10-storage-cutover.md) | DB/JSONL 호환 export와 점진적 전환 | 9 | `codex/cutover-event-storage` |
| [11A](goals/11a-csp-headers.md) | CSP와 security headers | 10 | `codex/harden-csp-headers` |
| [11B](goals/11b-dependency-hardening.md) | dependency audit와 보안 업데이트 | 11A | `codex/harden-dependencies` |
| [11C](goals/11c-production-docker.md) | production Docker image | 11B | `codex/add-production-docker` |
| [11D](goals/11d-ci.md) | Node/DB/browser CI gate | 11C | `codex/add-migration-ci` |

## 보류된 선택 실험

| Goal | 목적 | 상태 | 보존 브랜치 |
| --- | --- | --- | --- |
| [7A](goals/07a-react-spa.md) | 단일 React SPA shell과 기존 URL 호환 | 보류, Goal 8 선행조건 아님 | `codex/migrate-react-spa` |

## 상세 Goal 문서 정책

- 모든 Goal은 `goals/`에 범위 계약 문서를 둔다.
- 실행 전 현재 Goal 파일만 읽고 실제 코드 기준으로 예상 영향 파일, 버전과 검증 명령을 재확인한다.
- Goal 파일이 없거나 현재 코드와 맞지 않으면 구현 전에 명세를 갱신하고 사용자 검토를 받는다.
- 이전 Goal에서 미래 Goal 구현을 선행하지 않는다.
- 목표가 달라지면 roadmap과 관련 Goal 파일을 문서 변경으로 먼저 갱신한다.
- Goal 7A는 현재 제품 요구보다 route/session lifecycle 복잡도가 커서 선택 실험으로 보류한다. 재개 조건과 발견된 문제는 Goal 파일을 따른다.
- [Goal 8](goals/08-typescript-completion.md)은 실행 Goal이 아니라 8A~8D 분할 정책의 인덱스다.
- production 전환은 `8A core/state → 8B client runtime/render/net/AI → 8C server/artifact` 순서로 각각 main에 반영한다.
- 8D test/e2e/scripts 정리는 선택 Goal이다. 8C main 반영 뒤 실행할 수 있지만 Goal 9의 선행조건은 아니다.
- rename을 수행한 Goal은 아직 JavaScript인 consumer를 포함해 해당 파일을 참조하는 모든 source import/require 경로를 함께 갱신한다.
- Goal 11은 하나의 큰 branch가 아니라 11A~11D의 독립 Goal로 수행한다.

## 변하지 않는 방향

- build/type 기반을 먼저 안정화한다.
- 신원과 재접속 보안을 React보다 먼저 해결한다.
- runtime 계약을 만든 뒤 React 화면을 이동한다.
- 현재 네 React page entry와 full-document navigation을 유지한다. SPA는 구체적인 사용자 요구가 생겼을 때만 다시 검토한다.
- first-party TypeScript 전환은 기능 변화와 분리한다.
- PostgreSQL은 shadow storage로 시작하고 JSONL parity 이후 점진적으로 전환한다.
- production hardening은 기능 마이그레이션이 안정된 뒤 수행한다.
