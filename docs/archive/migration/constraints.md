# Migration Constraints

이 문서는 모든 마이그레이션 Goal에 적용되는 불변조건을 정의한다. 현재 브랜치나 일시적인 테스트 결과는 기록하지 않는다.

## 기능 불변조건

명시적으로 허용된 기능 변화가 아니면 다음 동작을 보존한다.

- 싱글 이동, 회전, soft drop, hard drop, hold, next queue
- 점수, line clear, game over와 Canvas 렌더링
- PVP의 create → join → start → play → finish → lobby 흐름
- PVE AI gameplay와 난이도 흐름
- server authoritative input, ticker, snapshot, garbage, correction 흐름
- placement decision log, JSONL dataset과 Python parity 검증 경로
- 기존 주요 URL, Socket.IO client와 정적 asset 경로

각 Goal은 허용되는 기능 또는 프로토콜 변화를 Goal 파일에 명시해야 한다. 적혀 있지 않은 변화가 필요해지면 구현을 멈추고 보고한다.

## 아키텍처 불변조건

- `client/game/core`는 DOM과 네트워크에 의존하지 않는 순수 판정을 유지한다.
- runtime은 입력, timer와 상태 전이 순서를 조율한다.
- render 계층은 상태를 표시하며 게임 규칙을 결정하지 않는다.
- React는 화면과 생명주기를 담당하고 게임 상태의 새로운 수정 원천이 되지 않는다.
- 같은 의미의 상태를 runtime, React와 서버에 각각 수정 가능한 값으로 중복 저장하지 않는다.
- 멀티플레이의 최종 진실 원천은 server authoritative state다.
- Goal 9B가 main에 반영되기 전 분석 로그의 현재 영속 경로는 JSONL이다. Goal 9를 실행하더라도 PostgreSQL을 실시간 room/game state의 원천으로 사용하지 않는다.
- Redis, Next.js, NestJS, Redux, Zustand, Tailwind는 별도 Goal과 근거 없이 추가하지 않는다.

## 보안 불변조건

- `playerId`, `roomId`, nickname과 client snapshot을 신원 증명으로 신뢰하지 않는다.
- 인증과 인가는 자료형 검증과 분리한다. Zod 통과는 권한 증명이 아니다.
- session/reconnect token과 비밀값을 URL, 로그, public payload와 오류 메시지에 노출하지 않는다.
- token은 CSPRNG로 생성하고 충분한 entropy, 만료, 회전, 폐기와 replay/동시 reconnect 정책을 정의한다.
- Socket.IO handshake에서 token 전달 위치, allowed origin과 server-side 저장·비교 방식을 명시한다.
- 상태를 바꾸는 모든 Socket event에서 player/socket 소유권을 검증한다.
- 로그, dataset과 오류 응답에는 token과 인증정보 redaction을 적용한다.
- 외부 payload는 서비스 호출 전에 크기, enum, 숫자 범위와 unknown key 정책을 검증한다.
- event rate, input queue와 문자열 길이에 상한을 둔다.
- 보안상 프로토콜 변경이 필요하면 이전/이후 계약, 호환성 영향과 rollback을 기록한다.

## 데이터 불변조건

- schema와 feature version을 명시한다.
- dataset lineage, split 정책과 재현 가능한 seed를 보존한다.
- Goal 9A~9D의 현재 하위 Goal과 merge gate를 승인받기 전에는 JSONL 분석 경로를 임의로 대체하거나 제거하지 않는다.
- DB 쓰기가 authoritative tick이나 input 처리의 성공 조건이 되지 않게 한다.
- Goal 9A~9D는 environment별 JSONL/PostgreSQL 단일 sink를 사용하며 runtime dual-write와 조용한 fallback을 금지한다.
- event identity, immutable event hash, conflict, retry allowlist, timeout, privacy projection과 shutdown 정책을 DB 활성화 전에 정의한다.
- production storage mode는 명시해야 하며 best-effort event loss는 Goal 9B 구현 전에 사용자가 승인한다. strict lossless 요구에서는 durable outbox 설계 없이 진행하지 않는다.
- PostgreSQL row는 append-only로 취급하고 code rollback 과정에서 자동 삭제하지 않는다.

## 버전과 의존성 제약

- Goal이 요구하는 Node 버전을 preflight에서 확인한다. Node 24 전환은 Goal 1에서 수행한다.
- npm과 `package-lock.json`을 유지한다.
- 새 패키지는 stable 여부, Node 호환성, peer dependency, breaking change와 lockfile 영향을 확인한 뒤 추가한다.
- `latest`를 근거 없이 사용하거나 전역 패키지에 의존하지 않는다.
- root `"type": "module"`은 CommonJS server/test 전환 계획 없이 추가하지 않는다.
- 보안 advisory를 숫자 0으로 만들기 위한 무조건적인 major upgrade를 금지한다. 잔여 위험을 근거와 함께 기록한다.
- Goal 2의 session/reconnect 보안이 main에 반영되기 전에는 public Internet deployment를 금지한다. Goal 1 결과는 local/controlled preview에서만 검증한다.

## Git과 작업 범위 제약

- 한 Goal은 반드시 하나의 전용 브랜치를 사용한다.
- 별도 worktree는 그 전용 브랜치를 독립 checkout할 때 사용한다.
- 의존 관계가 있는 migration Goal은 병렬 실행하지 않는다. ML 등 무관한 작업을 병렬 수행할 때만 별도 worktree를 사용한다.
- clean worktree와 선행 Goal의 main 반영을 확인하기 전에는 구현하지 않는다.
- 사용자 변경을 임의로 reset, checkout, stash, 삭제하지 않는다.
- main 직접 수정, force-push, destructive reset, push, merge와 브랜치 삭제는 명시적 승인 없이 수행하지 않는다.
- 기능, 구조, 보안, 스타일 변경을 한 커밋에 섞지 않는다.
- 현재 Goal 밖의 파일 변경이 필요하면 범위를 확장하지 말고 이유와 선택지를 보고한다.
- 다음 Goal을 자동으로 시작하지 않는다.

## 제한적 예외

사용자가 승인한 현재 Goal에 명시된 프레임워크와 의존성 도입은 `AGENTS.md`의 프레임워크 임의 추가 금지에 대한 제한적 예외다.

이 예외는 다음 권한을 포함하지 않는다.

- 게임 규칙이나 상태 소유권 변경
- 검증 생략
- Git history 재작성
- push, merge 또는 브랜치 삭제
- 미래 Goal 선행 구현
