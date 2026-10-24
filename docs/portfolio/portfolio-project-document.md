# Tetris Multi & Placement AI Lab

> 작성 기준일: 2026-07-24
> 근거 범위: 현재 저장소의 소스 코드, 설정, 테스트, `change-log.md`, Git 이력, AI/ML 및 migration 실행 기록
> 작성 원칙: 구현 사실과 문서에 남은 검증 결과만 사용하고, 확인되지 않은 운영 사실은 별도로 표시했다.

## 프로젝트 기본 정보

| 항목 | 내용 |
| --- | --- |
| 프로젝트명 | Tetris Multi & Placement AI Lab |
| 프로젝트 기간 | 주요 개발 활동 40일 |
| 기간 근거 | 2025-10-20부터 2026-07-24까지 Git 커밋이 존재하는 고유 날짜를 합산했다. 장기간의 중간 공백은 제외했으며, 2025-03-13의 최초 저장소 생성 커밋 1일은 주요 작업 기간에 포함하지 않았다. |
| 프로젝트 인원 | 개인 |
| 담당 역할 | `[직접 작성]` |
| 프로젝트 목적 | 배열 기반 Tetris 엔진을 직접 구현하고, 이를 싱글플레이에서 server-authoritative PVP/PVE로 확장하면서 상태 소유권, 실시간 동기화, 테스트, 보안, 데이터 수집과 placement AI 평가까지 한 프로젝트 안에서 학습하고 검증하는 것 |
| GitHub | `[직접 작성]` |

### 개발 활동 구간

| 구간 | 확인된 활동일 | 주요 작업 |
| --- | ---: | --- |
| 2025-10-20 ~ 2026-01-09 | 6일 | 배열 기반 상태 전환, 판정·렌더 구조 정리와 주석 보완 |
| 2026-02-24 ~ 2026-04-06 | 5일 | 입력 queue, Canvas renderer, runtime·state·entry 모듈 분리 |
| 2026-05-04 ~ 2026-06-25 | 9일 | Node/Socket.IO 서버, room·match·채팅과 멀티플레이 기반 구현 |
| 2026-07-01 ~ 2026-07-24 | 20일 | server-authoritative PVP/PVE, AI·ML, React/TypeScript, 보안, Docker·CI와 PostgreSQL |
| **합계** | **40일** | 공백 기간을 제외한 Git 활동일 기준 |

### 현재 확인 가능한 범위

- 현재 애플리케이션은 싱글플레이, 2인 PVP, 휴리스틱 PVE, 사용자 선택형 experimental placement V4 PVE를 제공한다.
- 프론트엔드는 Vite multi-page와 page-local React shell을 사용하고, 게임 실행과 그리기는 TypeScript Canvas runtime이 담당한다.
- 멀티플레이의 최종 상태는 단일 Node.js 프로세스의 메모리에 있는 server-authoritative match state가 소유한다.
- room, match, session, rate limit은 메모리에 저장한다. 분석 이벤트는 `GAME_EVENT_STORAGE` 설정에 따라 JSONL 또는 PostgreSQL 중 하나에만 기록한다. 개발 기본값은 JSONL이며 production에서는 저장 방식을 명시해야 한다.
- PostgreSQL schema, migration, runtime repository, JSONL importer와 production-like 검증은 구현됐지만 실제 production DB 활성화와 운영 JSONL import는 수행하지 않았다.
- Docker image와 GitHub Actions workflow는 확인되지만 공개 서비스 배포 URL, cloud provider, 실제 운영 트래픽은 확인되지 않는다.
- 최신 Goal 9D 기록에서 `bash scripts/verify.sh`는 Node 테스트 643 pass·1 skip, PostgreSQL integration 8/8, production Chromium 36/36을 통과했다. 최종 main의 GitHub Actions 네 job도 모두 green이다.

---

# 1. 프로젝트 개요

## 1.1 프로젝트 목적

이 프로젝트는 브라우저 Tetris를 만드는 데서 시작해, 같은 게임 규칙을 싱글플레이와 실시간 멀티플레이, PVE AI, 분석 데이터 생성에 재사용할 수 있는 구조로 발전시키는 것을 목표로 했다.

초기 DOM 중심 구현에서는 화면 요소가 상태 저장소 역할까지 맡고 있었다. 이후 보드를 2차원 배열로 옮기고, 충돌·고정·라인 삭제·공격 판정을 DOM과 분리했다. 이 순수 게임 규칙을 기준으로 Canvas renderer, 입력 runtime, Socket.IO 서버, 휴리스틱 AI와 데이터셋 생성 경로를 단계적으로 연결했다.

프로젝트의 핵심 목표는 다음 세 가지다.

1. 조작감이 필요한 로컬 게임과 서버가 최종 상태를 결정하는 멀티플레이를 함께 구현한다.
2. 사람과 AI가 같은 게임 규칙과 authoritative input 경로를 사용하게 한다.
3. 플레이 로그를 단순 저장에 그치지 않고, 재현 가능한 데이터셋·평가·Python parity 경로로 연결한다.

## 1.2 해결하려는 문제

### DOM과 게임 상태의 결합

화면 요소를 직접 읽고 수정하는 방식은 충돌 판정, 테스트, Canvas 전환, 서버 재사용이 어렵다. 현재 구현은 `board`, `activePiece`, `pieceQueue` 같은 배열·객체 상태를 원천으로 두고 renderer는 결과만 소비한다.

### 멀티플레이 상태 불일치

클라이언트가 보드, 공격, 게임 종료를 직접 확정하면 두 브라우저의 상태가 달라질 수 있다. 현재는 서버가 입력, 중력, lock, line clear, garbage, top-out과 승패를 계산하고 authoritative snapshot을 전송한다.

### 서버 보정 때문에 발생하는 조작 롤백

모든 서버 snapshot을 즉시 덮어쓰면 빠르게 이동하거나 회전한 조각이 이전 위치로 돌아갈 수 있다. 이 프로젝트는 로컬 prediction을 유지하면서 `clientSequence`, `lastProcessedClientSequence`, pending input, `pieceIndex`, board mismatch를 기준으로 보정 시점을 제한한다.

### AI와 사람의 서로 다른 실행 규칙

AI가 최종 좌표를 보드에 직접 넣으면 사람의 이동·회전·wall kick·lock 규칙과 달라질 수 있다. 현재 휴리스틱 AI와 experimental V4 AI는 reachable placement를 고른 뒤 `move_left`, `rotate`, `soft_drop`, `hard_drop` 입력을 사람과 같은 서버 경로로 실행한다.

### ML 실험의 재현성과 평가 누수

placement 후보가 한 decision 안에서 여러 row로 펼쳐지므로 임의 row split은 같은 게임의 정보가 train과 validation에 함께 들어갈 수 있다. 데이터셋은 `gameId` 기준으로 분리하고, LOGO와 temporal holdout, source checksum, deterministic ordering, Node↔Python parity를 사용한다.

## 1.3 핵심 기능

- 배열 기반 Tetris 규칙: 이동, SRS 계열 wall kick, 회전, soft/hard drop, hold, ghost, 7-bag, line clear, T-Spin, combo, back-to-back
- React HUD와 Canvas renderer를 사용하는 싱글플레이
- 방 생성·참가·퇴장·재시작, host 권한, global/room 채팅을 제공하는 2인 PVP
- 서버가 input, gravity, lock, garbage와 game over를 확정하는 server-authoritative multiplayer
- session token rotation, reconnect sync, duplicate tab 차단, disconnect grace
- reachable placement를 탐색하고 보드 지표로 평가하는 휴리스틱 PVE
- 사람의 placement 선택을 모방하는 experimental V4 PVE와 휴리스틱 fallback
- placement/game event single-sink(JSONL/PostgreSQL), 결정론적 dataset exporter, ranker 평가, JavaScript↔Python parity
- canonical event identity, PostgreSQL migration·멱등 저장, JSONL streaming importer와 completeness report
- theme, lobby/game sound, line-clear presentation
- CSP, exact Origin allowlist, rate limit, DTO whitelist, payload validation
- clean production artifact, multi-stage Docker, GitHub Actions CI

## 1.4 사용 시나리오

### 싱글플레이

사용자는 첫 화면에서 싱글 게임으로 이동한다. React page가 HUD와 lifecycle을 준비하고 Canvas runtime이 키보드 입력, 게임 상태, 중력, 판정과 렌더링을 처리한다.

### PVP

두 사용자가 각각 서버 발급 session으로 연결한다. 한 사용자가 방을 만들고 다른 사용자가 8자리 room code로 참가한다. host가 게임을 시작하면 서버가 player별 bag과 authoritative state를 생성한다. 각 브라우저는 자기 입력을 즉시 로컬에 반영하고 서버에도 전송한다. 서버가 입력을 다시 판정해 양쪽에 snapshot을 보내며 공격과 승패도 서버가 확정한다.

### PVE

사용자는 Normal/Hard 난이도와 heuristic/experimental V4 정책을 선택해 PVE 방을 만든다. 서버 ticker가 사람의 중력과 AI action cadence를 함께 진행한다. AI는 placement를 계획한 뒤 사람과 같은 authoritative input을 순서대로 실행한다.

### 분석·ML

서버는 검증을 통과하고 실제 authoritative placement가 commit된 decision만 선택된 단일 sink에 저장한다. 기본 JSONL 경로에서는 exporter가 원본 로그를 수정하지 않고 후보 placement를 다시 생성해 dataset을 만든다. PostgreSQL 경로에서는 allowlist projector가 이벤트를 canonical envelope로 바꾸고 멱등 identity/hash를 기준으로 append한다. Python 실험은 JavaScript가 만든 feature와 canonical order를 입력으로 사용하고, checksum과 parity 검증 뒤 결과를 요약한다.

## 1.5 프로젝트 특징

- 게임 규칙을 DOM과 네트워크에서 분리해 브라우저와 서버가 같은 core를 사용한다.
- server-authoritative 구조지만 자기 보드는 client prediction을 사용해 입력 반응성을 유지한다.
- AI를 별도 치트 경로로 만들지 않고 실제 입력 executor로 실행한다.
- 학습 모델의 한계를 숨기지 않고 휴리스틱을 기본값으로 유지한다.
- 기능 마이그레이션을 Goal 단위로 나누고 각 단계의 검증, 남은 위험과 rollback 순서를 기록했다.
- 로컬 실행만 확인하는 데서 끝내지 않고 source-less artifact, Docker read-only runtime, browser E2E까지 검증 범위를 확장했다.
- 실시간 room 상태와 분석 이벤트의 수명 주기를 분리하고, JSONL/PostgreSQL을 runtime dual-write 없이 명시적인 single-sink로 선택한다.

---

# 2. 기술 스택 분석

## 2.1 Language

### TypeScript / TSX

| 항목 | 분석 |
| --- | --- |
| 역할 | client game core/runtime/render/UI/network, React page, server service/socket/repository/validator의 주 언어다. |
| 사용 이유 | migration 기록상 JavaScript 동작을 보존하면서 client, server, test를 별도 strict `tsconfig`로 단계적으로 전환했다. shared socket schema에서 파생한 타입으로 C2S/S2C payload를 연결한다. |
| 대표 대안과 비교 | JavaScript보다 상태와 event payload의 구조를 컴파일 단계에서 확인할 수 있지만, build 설정과 type boundary 관리가 추가된다. Rust/WASM보다 기존 웹 코드와의 점진 전환 비용이 낮다. |
| 현재 규모에서의 적절성 | 게임 상태, Socket event, AI dataset처럼 구조가 큰 객체가 많아 타입 검사가 실제 회귀 방지에 기여한다. client/server를 한 저장소에서 관리하는 현재 구조와 맞는다. |
| 고려할 점 | compile-time type은 네트워크 입력을 검증하지 못하므로 Zod runtime validation이 별도로 필요하다. client/server/test 설정이 갈라져 있어 새 경로를 추가할 때 include와 module resolution을 확인해야 한다. |
| 확장 방향 | 테스트·도구까지 TypeScript 완료가 필요하면 보류된 Goal 8D 범위에서 진행할 수 있다. protocol은 계속 runtime schema와 type derivation을 함께 유지하는 편이 안전하다. |

### JavaScript / MJS / CommonJS

| 항목 | 분석 |
| --- | --- |
| 역할 | Node 테스트, E2E, build/export/train script와 runtime 공유용 `socketContracts.mjs`에 남아 있다. |
| 사용 이유 | 기존 테스트·도구를 한 번에 바꾸지 않고 production runtime migration을 우선한 결과다. `scripts/build.js`는 Node 표준 API만으로 Vite와 TypeScript compiler를 실행한다. |
| 대표 대안과 비교 | 전부 TypeScript로 통일하면 타입 일관성은 높아지지만 migration diff와 tool bootstrap이 커진다. 현재 혼합 구조는 점진 전환에는 유리하지만 module system 이해가 필요하다. |
| 현재 규모에서의 적절성 | production source는 TypeScript로 정리하면서 안정된 테스트·스크립트는 유지해 기능 회귀 위험을 줄였다. |
| 고려할 점 | `.mjs`, CommonJS test, compiled CommonJS 경계가 공존하므로 import extension과 package scope를 잘못 바꾸면 runtime 오류가 날 수 있다. |
| 확장 방향 | 실제 유지보수 비용이 확인될 때만 test/tooling을 TypeScript로 옮기고, 단순 스크립트는 JavaScript로 남겨도 된다. |

### Python

| 항목 | 분석 |
| --- | --- |
| 역할 | placement pairwise 학습, scikit-learn reference, temporal holdout, report summarization, reference inference와 parity 검사에 사용한다. production gameplay server에는 포함되지 않는다. |
| 사용 이유 | NumPy·SciPy·scikit-learn·pandas·Notebook 기반 실험과 reference optimizer를 사용하기 위해 별도 Conda 환경을 구성했다. 게임 규칙과 feature 생성은 JavaScript를 원천으로 유지한다. |
| 대표 대안과 비교 | JavaScript만 사용하면 runtime과 언어가 하나지만 ML 도구와 수치 검증 선택지가 좁다. Python은 ML 생태계가 강한 대신 Node와 feature/parity 계약이 필요하다. |
| 현재 규모에서의 적절성 | Python을 별도 서비스로 운영하지 않고 offline 실험에만 사용해 운영 복잡도를 늘리지 않았다. |
| 고려할 점 | Conda full 실행은 시간이 길고 별도 환경이 필요하다. JS와 Python이 같은 게임 규칙을 각각 재구현하지 않도록 feature bundle과 checksum을 기준으로 유지해야 한다. |
| 확장 방향 | 모델이 실제 online inference 요구를 갖기 전까지 offline 도구로 유지한다. 서비스화가 필요해질 때만 별도 Python service, model registry, versioned inference contract를 검토한다. |

### HTML / CSS

| 항목 | 분석 |
| --- | --- |
| 역할 | 네 개의 Vite page mount, Canvas·HUD layout, theme와 responsive style을 담당한다. |
| 사용 이유 | 페이지 shell과 접근성 있는 기본 control은 브라우저 기본 요소를 사용하고, 게임 보드만 Canvas로 분리했다. |
| 대표 대안과 비교 | 모든 화면을 Canvas로 만들면 게임 장면은 통일되지만 form, button, live status와 접근성이 어려워진다. CSS-in-JS보다 정적 CSS는 dependency와 runtime 비용이 적다. |
| 현재 규모에서의 적절성 | page 수가 네 개이고 공통 component 중복이 아직 제한적이라 page-local TSX와 CSS만으로 관리 가능하다. |
| 고려할 점 | desktop keyboard·Chromium 중심 검증이므로 mobile input, 작은 viewport, 다른 browser의 layout은 추가 확인이 필요하다. |
| 확장 방향 | 실제 중복이 늘면 공통 component/style token을 추출하고, 모바일 조작 UI와 접근성 점검을 별도 작업으로 추가할 수 있다. |

## 2.2 Framework와 UI

### React 19.2.7 / React DOM

| 항목 | 분석 |
| --- | --- |
| 역할 | index, lobby, single, multiplayer의 page shell, form, HUD, overlay와 lifecycle cleanup을 담당한다. Canvas 내부 게임 상태는 소유하지 않는다. |
| 사용 이유 | migration Goal은 DOM 직접 갱신이 늘어난 page/HUD 상태만 React로 옮기고, 이미 검증된 game core/runtime/renderer는 보존했다. |
| 대표 대안과 비교 | Vanilla DOM보다 상태 기반 UI와 lifecycle 정리가 쉽지만 bundle과 hook lifecycle 이해가 필요하다. Vue/Svelte도 가능하지만 저장소에는 사용 근거가 없다. |
| 현재 규모에서의 적절성 | 네 page가 독립적으로 mount되므로 router/context 같은 전역 구조 없이 필요한 화면에만 React를 적용했다. |
| 고려할 점 | StrictMode에서 effect가 다시 실행돼도 Socket subscription, sound와 runtime이 중복되지 않도록 disposer와 idempotent `destroy()`가 필요하다. |
| 확장 방향 | page 간 공유 상태와 routing 요구가 실제로 커질 때만 SPA 또는 공통 component 계층을 다시 검토한다. Goal 7A의 SPA 실험은 현재 보류됐다. |

### Canvas 2D API

| 항목 | 분석 |
| --- | --- |
| 역할 | local/remote board, active piece, ghost, line-clear fragment animation을 그린다. |
| 사용 이유 | 20×10 격자를 매 tick DOM node로 조작하던 구조를 상태 기반 draw로 바꾸고 renderer를 게임 규칙에서 분리했다. |
| 대표 대안과 비교 | DOM grid보다 반복 draw와 보드 복제가 단순하지만 개별 cell의 기본 접근성과 DOM inspection은 떨어진다. WebGL보다 현재 2D 규모에 필요한 코드가 적다. |
| 현재 규모에서의 적절성 | 작은 2D board와 preview를 그리는 데 충분하며 외부 rendering library가 필요하지 않다. |
| 고려할 점 | device pixel ratio, resize, non-Chromium rendering과 화면 판독 접근성은 추가 검증이 필요하다. |
| 확장 방향 | 성능 측정 없이 WebGL로 바꿀 필요는 없다. 고해상도·모바일 문제가 실제로 확인되면 scale 처리부터 보강하는 편이 현실적이다. |

## 2.3 Server와 실시간 통신

### Node.js 24.18.0

| 항목 | 분석 |
| --- | --- |
| 역할 | HTTP server, Socket.IO, server-authoritative ticker, JSONL/PostgreSQL event I/O, build/test/export/import script를 실행한다. |
| 사용 이유 | client와 game core를 같은 TypeScript/JavaScript 생태계에서 공유하고, `node:test`, crypto, fs, fetch 같은 내장 기능을 사용한다. 버전은 `.nvmrc`와 `engines`로 고정했다. |
| 대표 대안과 비교 | Java/Spring이나 Go보다 현재 웹 코드 공유가 쉽지만 CPU-bound 대규모 시뮬레이션은 event loop 부하를 고려해야 한다. |
| 현재 규모에서의 적절성 | 2인 room과 100ms ticker를 단일 프로세스로 운영하는 MVP에는 구조가 단순하다. |
| 고려할 점 | room/match/session이 process memory라 restart와 multi-instance에서 상태가 사라지거나 나뉜다. |
| 확장 방향 | 동시 room 부하가 확인되면 worker 분리, shared store, Socket.IO adapter와 session affinity를 함께 설계해야 한다. |

### Express 5.2.1

| 항목 | 분석 |
| --- | --- |
| 역할 | production 정적 파일 제공, root route, 404/오류 응답과 security header 적용을 담당한다. REST business API는 없다. |
| 사용 이유 | 기존 Socket.IO HTTP server 경계를 유지하면서 compiled client artifact를 제공하는 얇은 역할에 사용한다. |
| 대표 대안과 비교 | Node `http`만 사용하면 dependency는 줄지만 static/error middleware를 직접 작성해야 한다. NestJS보다 현재 endpoint 수에 필요한 구조가 훨씬 작다. |
| 현재 규모에서의 적절성 | 정적 파일과 Socket.IO 조립만 필요한 현재 server에 충분하다. |
| 고려할 점 | reverse proxy, HTTPS, HSTS, trusted proxy 설정은 공개 배포 환경에서 별도 검토해야 한다. |
| 확장 방향 | 인증·DB·REST endpoint가 크게 늘기 전에는 Express를 유지하고 sockets/services/validators/repositories 경계를 확장하는 편이 작다. |

### Socket.IO 4.8.3

| 항목 | 분석 |
| --- | --- |
| 역할 | session handshake, room lifecycle, chat, game input/result, bag, authoritative snapshot, match finish와 reconnect transport를 담당한다. |
| 사용 이유 | room broadcast, reconnect와 event 기반 protocol이 필요한 실시간 2인 게임에 적용했다. |
| 대표 대안과 비교 | raw WebSocket보다 room과 reconnect 기능이 제공되지만 protocol overhead와 library 의존성이 있다. HTTP polling만으로는 100ms snapshot과 입력 반응을 다루기 어렵다. |
| 현재 규모에서의 적절성 | 2인 room event를 직접 구현하는 비용을 줄이고 server-authoritative 흐름에 집중할 수 있다. |
| 고려할 점 | 자동 reconnect 중 stale send buffer, duplicate tab, Origin, payload size, per-event rate limit을 별도로 통제해야 한다. 현재 코드는 disconnect 때 send buffer를 비우고 session generation을 검사한다. |
| 확장 방향 | 다중 instance가 필요하면 sticky session과 shared adapter를 함께 도입해야 하며, snapshot 빈도와 payload를 먼저 측정해야 한다. |

### Zod 4.4.3

| 항목 | 분석 |
| --- | --- |
| 역할 | handshake, C2S/S2C event payload, public room DTO와 authoritative snapshot의 runtime schema를 정의한다. TypeScript event type은 schema에서 파생한다. |
| 사용 이유 | 네트워크 경계에서는 TypeScript type만으로 실제 payload를 검증할 수 없기 때문이다. strict object와 enum/range/length를 사용한다. |
| 대표 대안과 비교 | 수동 validator보다 schema 중복이 줄고 type 추론이 가능하지만 bundle과 schema 실행 비용이 있다. JSON Schema/Ajv보다 TypeScript 코드와 가까운 형태다. |
| 현재 규모에서의 적절성 | event 수와 snapshot 중첩 구조가 커진 현재 단계에서 수동 검증보다 유지보수가 쉽다. |
| 고려할 점 | CSP report-only에서 Zod의 eval probe가 확인돼 `z.config({ jitless: true })`를 사용한다. schema가 gameplay 의미까지 대신하지 않도록 ownership/service 검사는 별도로 유지한다. |
| 확장 방향 | protocol versioning이 필요해지면 schema version과 compatibility policy를 추가하되, client/server가 같은 schema 파일을 계속 공유하는 것이 좋다. |

## 2.4 Build Tool

### Vite 8.1.5

| 항목 | 분석 |
| --- | --- |
| 역할 | 네 HTML entry의 development server, `/socket.io` proxy, production client bundle과 hashed asset 생성을 담당한다. |
| 사용 이유 | 기존 multi-page 경로를 유지하면서 React/TypeScript build를 추가하기 위해 `appType: "mpa"`와 네 input을 사용한다. |
| 대표 대안과 비교 | Webpack보다 설정이 작고 development startup이 단순하다. Next.js 같은 full-stack framework보다 기존 Express/Socket.IO와 Canvas runtime을 덜 변경한다. |
| 현재 규모에서의 적절성 | router 없이 네 page만 빌드하며 source map을 production artifact에서 제외하는 요구를 충족한다. |
| 고려할 점 | 개발 server와 Express/Socket.IO server를 별도로 실행해야 한다. HTML의 Socket.IO script는 Vite bundle 대상이 아니어서 build warning이 남지만 artifact에서 정상 제공된다. |
| 확장 방향 | SPA 요구가 실제로 생길 때 routing을 별도 결정한다. 현재는 MPA가 lifecycle과 rollback 범위를 더 명확하게 유지한다. |

### TypeScript Compiler + `scripts/build.js`

| 항목 | 분석 |
| --- | --- |
| 역할 | client/server/test typecheck를 분리하고, server CommonJS artifact와 server가 재사용하는 game core/AI artifact를 `dist/server`에 만든다. model asset과 package scope 파일도 복사한다. |
| 사용 이유 | `npm start`가 source나 devDependency 없이 compiled artifact만 실행하도록 경계를 고정하기 위해 사용한다. |
| 대표 대안과 비교 | ts-node/tsx로 source를 직접 실행하면 개발은 간단하지만 production이 compiler와 source에 의존한다. bundler로 server 전체를 묶는 것보다 현재 import 구조를 보존한다. |
| 현재 규모에서의 적절성 | 45줄 안팎의 build script로 필요한 clean build와 asset 복사를 처리하며 추가 build framework가 필요하지 않다. |
| 고려할 점 | 새 server runtime asset이나 공유 module을 추가하면 artifact allowlist와 release test도 함께 갱신해야 한다. |
| 확장 방향 | artifact 단계가 실제로 더 복잡해질 때만 task runner나 bundler를 검토한다. |

## 2.5 Test와 분석 도구

### `node:test`

| 항목 | 분석 |
| --- | --- |
| 역할 | core, runtime, service, Socket handler, security, dataset, ranker와 artifact 회귀 테스트를 실행한다. |
| 사용 이유 | Node 내장 test runner로 별도 unit test framework 없이 production과 가까운 환경을 유지한다. |
| 대표 대안과 비교 | Jest/Vitest보다 matcher·mock 편의는 적지만 dependency와 설정이 작다. |
| 현재 규모에서의 적절성 | 최신 Goal 9D 기록에서 644개 중 643 pass·1 skip으로 core부터 PostgreSQL runtime 경계까지 빠르게 검증했다. 실제 PostgreSQL이 필요한 검증은 별도 `test:db`로 분리했다. |
| 고려할 점 | DOM mock과 browser 동작은 별도 helper 또는 Playwright가 필요하다. 테스트가 compiled artifact를 대상으로 실행된다는 경계를 유지해야 한다. |
| 확장 방향 | coverage나 property test가 실제 품질 질문에 필요할 때만 추가한다. |

### Playwright 1.61.1

| 항목 | 분석 |
| --- | --- |
| 역할 | navigation, React lifecycle, Canvas input 결과, 2-context PVP, PVE, session/reconnect, rollback, CSP를 Chromium에서 검증한다. |
| 사용 이유 | 단위 테스트만으로 확인하기 어려운 실제 Socket.IO, Canvas, BFCache와 두 브라우저 상호작용을 검증하기 위해 사용한다. |
| 대표 대안과 비교 | Cypress보다 multi-context와 browser automation을 직접 다루기 쉽지만 설치와 실행 시간이 크다. 수동 테스트보다 반복 가능하다. |
| 현재 규모에서의 적절성 | 핵심 사용자 흐름 36개 production E2E와 Vite-dev lifecycle gate로 배포 경계를 확인한다. |
| 고려할 점 | 현재 project 설정은 Chromium 하나와 worker 1개다. 자연 중력과 runner scheduling을 동시에 의존하던 PVE T-Spin E2E는 제거하고 core·authoritative·runtime의 결정론적 테스트로 옮겼다. WebKit/Firefox는 확인되지 않았다. |
| 확장 방향 | 공개 배포 전 다른 browser와 mobile viewport, latency/jitter 시나리오를 우선 추가하는 것이 현실적이다. |

### Jupyter / NumPy / SciPy / scikit-learn / pandas

| 항목 | 분석 |
| --- | --- |
| 역할 | pairwise model의 reference 학습, LOGO·temporal holdout 분석, 표 형태 검토와 실행 Notebook에 사용한다. 정확한 버전은 `environment-ml.yml`에 고정돼 있다. |
| 사용 이유 | offline 수치 실험, optimizer 비교와 재현 가능한 보고서를 만들기 위해 사용한다. |
| 대표 대안과 비교 | 직접 수치 최적화만 구현하면 dependency는 줄지만 reference 검증과 분석 생산성이 낮다. 반대로 대형 ML framework는 현재 선형 ranker에 과하다. |
| 현재 규모에서의 적절성 | 16개 feature의 pairwise linear ranker와 holdout 분석에 충분하다. deep learning framework를 추가하지 않았다. |
| 고려할 점 | Notebook 전체 실행은 느리고 출력이 크다. full run과 결과 분석을 분리하고 compact summarizer로 핵심 수치만 읽는다. |
| 확장 방향 | 모델 복잡도가 실제로 필요해질 때만 별도 experiment tracking이나 model registry를 검토한다. |

## 2.6 Database, Cloud, Deployment

### Database

#### PostgreSQL 17.10 / `pg` 8.22.0

| 항목 | 분석 |
| --- | --- |
| 역할 | `game_start`, `placement_decision`, `game_over` 분석 이벤트를 `tetris_analytics.game_events`에 append한다. raw SQL migration, schema checksum, canonical identity/hash, idempotent duplicate/conflict 판정, JSONL import와 completeness 검증을 제공한다. |
| 사용 이유 | container 수명과 gameplay event 보존을 분리하고, 중복·완전성·용량을 SQL로 점검해야 한다는 요구가 생겨 Goal 9A~9D로 도입했다. room/match/session의 실시간 상태 저장 용도는 아니다. |
| 대표 대안과 비교 | JSONL은 single writer와 offline batch 분석이 단순하지만 index, 동시 접근, 중앙 조회와 retention 운영이 어렵다. PostgreSQL은 제약·transaction·JSONB·index를 제공하지만 migration, credential, TLS, backup과 운영 책임이 추가된다. Redis는 실시간 ephemeral state에는 후보가 될 수 있지만 이 append-only 분석 원본의 관계형 제약과 장기 보존 목적을 바로 대체하지 않는다. |
| 현재 규모에서의 적절성 | 이벤트 종류가 세 개이고 append/read audit가 중심이라 ORM 없이 `pg`와 parameterized raw SQL로 경계를 명확히 유지할 수 있다. pool 4, in-flight 16으로 현재 단일 process 규모를 넘는 무제한 queue를 만들지 않았다. |
| 고려할 점 | non-loopback 연결은 CA와 hostname 검증이 필수다. runtime/migration/maintenance role을 분리하고 runtime role에는 UPDATE·DELETE·DDL 권한을 주지 않는다. 같은 identity의 다른 payload는 덮어쓰지 않고 conflict로 처리한다. |
| 확장 방향 | 먼저 OCI 기준선 배포와 managed PostgreSQL provider·TLS·backup/restore를 검증한 뒤 별도 승인으로 import와 single-sink cutover를 수행한다. room recovery나 multi-instance는 별도의 shared state/ownership 설계가 필요하다. |

#### Process memory와 JSONL

- room, match, player session, ticker와 rate limit은 계속 `Map` 기반 process memory에 있다.
- JSONL은 local/development의 기본 분석 sink이며 PostgreSQL과 runtime dual-write하지 않는다.
- production은 `GAME_EVENT_STORAGE=jsonl|postgres`를 명시해야 한다. PostgreSQL을 선택하면 JSONL writer와 writable log volume을 사용하지 않는다.
- JSONL 원본은 importer가 stream/readline으로 읽고 canonical projection 뒤 PostgreSQL에 멱등 import한다. production 데이터 import는 확인되지 않았다.

### Cloud

- 특정 cloud provider 사용: 확인되지 않음.
- cloud-managed database, object storage, registry, load balancer 사용: 확인되지 않음.
- GitHub-hosted Actions runner 사용 기록은 있으나 이는 애플리케이션 cloud 배포를 의미하지 않는다.

### Docker

| 항목 | 분석 |
| --- | --- |
| 역할 | build, production dependency, runtime을 분리한 production image를 만든다. |
| 사용 이유 | source·test·dev tool을 제외하고 동일한 Node/runtime artifact를 재현하기 위해 도입했다. |
| 대표 대안과 비교 | 직접 VM에 npm install하는 방식보다 재현성과 격리가 높지만 image build·registry 운영이 추가된다. |
| 현재 규모에서의 적절성 | 같은 image를 JSONL volume 모드와 PostgreSQL single-sink 모드로 검증한다. production-like PostgreSQL gate에서는 source-less·read-only app image와 외부 DB network 경계를 사용한다. |
| 고려할 점 | non-root `node` user, read-only root, exact base digest, healthcheck와 SIGTERM을 유지한다. JSONL mode만 `/app/data/logs` volume이 필요하며 PostgreSQL mode는 DB secret/CA를 image 밖에서 주입해야 한다. |
| 확장 방향 | OCI VM preflight 뒤 registry digest, reverse proxy/TLS, JSONL backup과 rollback을 먼저 고정한다. PostgreSQL provisioning/cutover는 별도 승인으로 분리한다. Kubernetes는 다중 instance 필요가 확인되기 전에는 필요하지 않다. |

### GitHub Actions

| 항목 | 분석 |
| --- | --- |
| 역할 | PR/main에서 Fast gate, Chromium PVP/PVE, production container smoke, PostgreSQL event storage를 실행한다. |
| 사용 이유 | 로컬 환경뿐 아니라 clean Ubuntu runner에서 install/build/test/browser/container 경계를 재현하기 위해 추가했다. |
| 대표 대안과 비교 | 다른 CI도 가능하지만 저장소와 PR check 연결이 단순하다. 로컬 script만 사용하는 것보다 회귀 발견이 빠르지만 runner 시간과 flaky E2E 관리가 필요하다. |
| 현재 규모에서의 적절성 | 네 job으로 type/build/unit/release, browser, Docker, 실제 PostgreSQL migration/runtime/import 책임을 나눴다. DB job은 PostgreSQL 17.10 image digest를 고정하고 private-CA TLS, role separation과 backup/restore까지 점검한다. |
| 고려할 점 | branch protection은 확인되지 않았고 ML parity는 required CI에서 제외됐다. CI의 DB는 합성 데이터이며 managed production provider와 실제 운영 데이터는 검증하지 않는다. |
| 확장 방향 | 공개 배포가 정해지면 OCI preflight와 HTTPS 기준선을 별도 gate로 수행하고, CD·registry publish는 rollback과 secret 관리가 정해진 뒤 추가한다. |

---

# 3. 프로젝트 아키텍처

## 3.1 전체 구조

이 프로젝트는 하나의 저장소와 하나의 Node server를 사용하는 모듈형 monolith에 가깝다. 브라우저는 네 개의 독립 Vite page를 사용하지만 game core와 runtime module을 공유한다. 서버는 HTTP와 Socket.IO를 한 process에서 실행하고 room/match/session 상태도 process memory에서 관리한다.

```text
Browser
├─ React page shell
│  ├─ 화면 상태, form, HUD, overlay
│  └─ lifecycle / cleanup
├─ Canvas game runtime
│  ├─ local game state
│  ├─ input queue / prediction
│  └─ renderer
└─ roomClient Socket adapter
        │
        │ Socket.IO + shared Zod contract
        ▼
Node.js HTTP / Socket.IO Server
├─ socket handlers
│  ├─ session / event validation
│  ├─ ownership / rate limit
│  └─ response / broadcast
├─ domain services
│  ├─ roomService
│  ├─ matchService
│  ├─ authoritativeTickerService
│  ├─ playerSessionService
│  └─ pveAiPlayerService
├─ shared game core
│  ├─ movement / collision / line clear
│  ├─ T-Spin / combo / B2B / garbage
│  └─ placement / board metrics
├─ event storage boundary
│  ├─ allowlist projector / canonical identity
│  ├─ JSONL repository
│  └─ PostgreSQL repository / migration
└─ graceful shutdown
   └─ reject writes → stop producers → drain → pool → Socket/HTTP
        │
        ▼
JSONL exporter/importer / evaluator / Python parity & experiments
```

## 3.2 계층 구조

```text
Presentation
React pages + Canvas renderer
        ↓
Client orchestration
Tetris runtime + multiplayer session + roomClient
        ↓
Transport boundary
Socket.IO handlers + shared Zod schemas
        ↓
Application/domain services
Room / Match / Session / Ticker / PVE AI / Event projection
        ↓
Pure domain logic
Board / Step / Piece / Attack / Garbage / T-Spin / Metrics
        ↓
Persistence boundary
In-memory Map + selected single event sink(JSONL or PostgreSQL)
```

이 구조에서 일반적인 REST Controller는 없다. Socket handler가 transport/controller 역할을 하고, service가 상태 전이와 orchestration을 담당한다. room/match용 영속 DAO는 없고 분석 이벤트에만 JSONL/PostgreSQL repository 경계가 있다.

## 3.3 컴포넌트 구조

### Client

- `index.tsx`: nickname, single/multi 진입, theme/sound
- `multiLobby.tsx`: session 준비, 방 생성/참가/PVE 설정, 채팅, room 상태
- `tetrisSingle.tsx`: local runtime lifecycle과 React HUD
- `tetrisMulti.tsx`: multiplayer session, local/remote runtime display, result/terminal overlay
- `multiplayerGameSession.ts`: network event와 두 runtime을 연결하고 cleanup을 한 경계로 묶는다.
- `tetris.ts`: 입력 queue, local state 전이, Canvas draw, snapshot apply, placement log context를 조율한다.
- `displayBridge.ts`: runtime 내부 상태 중 HUD에 필요한 값만 immutable snapshot으로 React에 노출한다.

### Server

- `sockets/index.ts`: handshake/session 인증 후 chat과 multiplayer handler를 조합한다.
- `multiplayerHandlers.ts`: event validation, rate/ownership 검사, service 호출과 emit을 처리한다.
- `roomService.ts`: room lifecycle과 membership의 단일 진실 원천이다.
- `matchService.ts`: player별 bag, authoritative state, input sequence와 snapshot을 관리한다.
- `authoritativeTickerService.ts`: 100ms room ticker, 500ms gravity, AI cadence, presentation delay와 finish를 조율한다.
- `playerSessionService.ts`: token digest, generation, active socket, expiry와 rotation을 관리한다.
- `pveAiPlayerService.ts`: heuristic/V4 decision과 input execution plan을 관리한다.
- `gameEventProjector.ts`: 검증된 raw log에서 저장 허용 필드만 canonical event로 투영하고 trust level을 구분한다.
- `runtimeEventStorage.ts`: JSONL/PostgreSQL single-sink 선택, bounded retry·in-flight·drain을 관리한다.
- `postgresEventRepository.ts`: parameterized append와 inserted/duplicate/conflict 판정을 담당한다.
- `serverShutdown.ts`: 새 write 차단부터 producer, drain, pool, Socket/HTTP까지 종료 순서를 한 번만 실행한다.

## 3.4 요청 흐름

### 방 생성

```text
React lobby
→ roomClient.requestCreateRoom()
→ Socket.IO room:create
→ session active 여부 + lifecycle rate limit
→ Zod payload validation
→ roomService.createRoom()
→ public DTO 변환
→ room:result
→ React room 화면 갱신
```

### 게임 입력

```text
Keyboard
→ local runtime enqueue/process
→ local prediction 성공 결과
→ game:input(clientSequence, pieceIndex, expectedTransform)
→ active session / rate / Zod / room ownership 검사
→ player별 authoritative mutation queue
→ matchService.applyAuthoritativeInput...
→ shared game core 판정
→ input result + authoritative snapshot
→ 내 보드: pending ack와 drift 정책에 따라 제한 보정
→ 상대 보드: authoritative snapshot full apply
```

### 게임 종료

```text
authoritative input 또는 gravity
→ top-out / gameOver
→ finishAuthoritativeMatch()
→ roomService.finishGame()
→ ticker stop + match cleanup
→ game_over를 선택된 event sink에 저장
→ match:finish broadcast
→ 양쪽 React overlay / lobby return
```

## 3.5 데이터 흐름

### 게임 상태

```text
Input
→ pending piece
→ pure move/lock result
→ authoritativeState mutation
→ serialized snapshot DTO
→ Socket.IO
→ client runtime / Canvas / HUD
```

### Garbage

```text
Server lock result
→ lines / T-Spin / combo / B2B attack 계산
→ 내 pending garbage와 cancel
→ 남은 attack을 상대 pending queue에 추가
→ 상대 snapshot.pendingGarbageLines
→ 다음 lock 시 authoritative board에 적용
```

### Placement 분석 데이터

```text
Authoritative placement commit
→ validated placement_decision
→ runtime single-sink 선택
   ├─ JSONL append → streaming exporter
   └─ allowlist projection → canonical identity/hash → PostgreSQL append
→ 필요 시 JSONL streaming importer로 PostgreSQL backfill
→ completeness/duplicate/conflict report
→ exporter
→ reachable candidates 재생성
→ feature/dataset JSONL + manifest
→ gameId split / LOGO / temporal holdout
→ JS ranker ↔ Python reference parity
→ compact summary / decision record
```

### 상태의 단일 진실 원천

| 의미 | 원천 상태 |
| --- | --- |
| 싱글 gameplay | client `gameState` |
| PVP/PVE 최종 gameplay | server `authoritativeState` |
| room membership/host/status | `roomService`의 room map |
| match/bag/player gameplay | `matchService`의 match map |
| session credential 상태 | `playerSessionService` |
| React HUD | runtime display snapshot의 파생 상태 |
| 상대 board | server authoritative snapshot |
| 분석 event identity | `identity-v1` canonical tuple과 SHA-256 |
| 분석 저장 원본 | 실행 시 선택한 단일 sink(JSONL 또는 PostgreSQL `game_events`) |

---

# 4. 디렉토리 구조

```text
Tetris_multi/
├─ src/
│  ├─ app.ts
│  ├─ client/
│  │  ├─ pages/
│  │  ├─ styles/
│  │  ├─ net/
│  │  └─ game/
│  │     ├─ core/
│  │     ├─ state/
│  │     ├─ runtime/
│  │     ├─ render/
│  │     ├─ entry/
│  │     ├─ ui/
│  │     └─ ai/
│  │        ├─ heuristic/
│  │        ├─ dataset/
│  │        └─ ml/
│  ├─ server/
│  │  ├─ db/
│  │  │  └─ migrations/
│  │  ├─ sockets/
│  │  ├─ services/
│  │  ├─ validators/
│  │  ├─ repositories/
│  │  └─ assets/
│  └─ shared/
├─ test/
├─ test-integration/
├─ e2e/
├─ test-artifact/
├─ scripts/
│  └─ ml/
│     ├─ notebooks/
│     └─ tests/
│        └─ fixtures/
├─ ai-harness/
├─ migration-harness/
├─ docs/
├─ Dockerfile
└─ .github/workflows/ci.yml
```

| 경로 | 역할 | 책임 분리 이유와 유지보수 장점 |
| --- | --- | --- |
| `src/app.ts` | compiled server entry | 실행 진입점을 한 줄로 유지해 server assembly와 분리한다. |
| `src/client/pages` | 네 HTML/React page entry | page별 UI와 lifecycle을 국소화하고 SPA 전역 상태를 만들지 않는다. |
| `src/client/game/core` | DOM 없는 순수 게임 판정 | client/server/AI가 재사용하고 입력·보드 규칙을 빠르게 단위 테스트할 수 있다. |
| `src/client/game/state` | blocks, config, queue, state 생성·직렬화 | 규칙 상수와 mutable runtime orchestration을 분리한다. |
| `src/client/game/runtime` | 입력, tick, sound, snapshot correction, display bridge | core 결과를 타이머·UI·네트워크 부수효과와 연결한다. |
| `src/client/game/render` | Canvas와 preview 렌더 | 게임 규칙 변경 없이 표현을 교체하거나 테스트할 수 있다. |
| `src/client/game/entry` | DOM 조회, theme, multiplayer session 조립 | page와 재사용 module 사이의 bootstrap/cleanup 경계를 둔다. |
| `src/client/game/ui` | runtime이 사용하는 DOM/renderer adapter | runtime이 구체 React component를 직접 알지 않게 한다. |
| `src/client/game/ai/heuristic` | reachable placement, simulation, heuristic 평가 | AI 판단을 server I/O와 분리해 결정론적으로 테스트한다. |
| `src/client/game/ai/dataset` | log→candidate sample, feature, grouping, ranking 평가 | gameplay 코드와 offline dataset 계약을 분리한다. |
| `src/client/game/ai/ml` | pairwise ranker, V4 scorer와 PVE adapter | experimental model을 기본 heuristic 정책과 분리하고 fallback을 둔다. |
| `src/client/net` | browser Socket.IO adapter와 log client | React/runtime이 raw event 이름, auth credential과 schema parse를 반복하지 않는다. |
| `src/server/sockets` | Socket event 입구 | transport 검증과 domain service를 분리한다. |
| `src/server/services` | room/match/session/ticker/PVE/log orchestration | 상태 소유권을 기능별로 나눠 socket handler의 비대화를 줄인다. |
| `src/server/validators` | game log trust boundary | 저장 전에 size, schema, private field와 값 범위를 확인한다. |
| `src/server/db` | canonical event, PostgreSQL 연결, migration/import CLI | database-specific identity·연결·schema 변경을 gameplay service에서 분리한다. |
| `src/server/db/migrations` | checksum으로 추적하는 raw SQL migration | schema 변경 순서와 제약을 코드와 함께 versioning하고 재실행을 검증한다. |
| `src/server/repositories` | JSONL/PostgreSQL append | 저장 매체 I/O를 projection/service에서 분리하고 test repository를 주입할 수 있다. |
| `src/shared` | Socket runtime schema와 파생 type | client/server protocol 정의가 갈라지는 것을 줄인다. |
| `test` | compiled Node unit/integration/type contract | 게임 규칙과 server boundary를 빠르게 회귀 검증한다. |
| `test-integration` | 실제 PostgreSQL schema/repository 검증 | mock으로 확인할 수 없는 SQL constraint, migration, TLS와 role 권한을 별도 환경에서 검증한다. |
| `e2e` | Chromium user flow | 실제 두 context, Socket.IO, Canvas, React lifecycle을 검증한다. |
| `test-artifact` | clean build와 source-less release | 개발 환경에 우연히 의존하는 production build를 막는다. |
| `scripts/ml/tests` | parity, Notebook contract, summarizer | offline ML 결과와 안전한 파일 처리를 검증한다. |
| `scripts` | build, export, evaluation, training, DB/production smoke, summary | 반복 실행을 명령으로 고정하고 수작업 차이를 줄인다. |
| `ai-harness` | 작업 방식과 ML experiment contract | 긴 프롬프트 반복을 줄이고 implement-smoke/full/analyze 단계를 분리한다. |
| `migration-harness` | Goal 범위, 선행조건, 검증, rollback | 큰 기술 전환을 작은 merge gate로 제한한다. |

---

# 5. 주요 기능

## 5.1 배열 기반 Tetris 엔진

### 기능 설명

20×10 2차원 배열을 board의 원천으로 두고 조각 상태를 `pieceType`, `rotation`, `row`, `col`로 관리한다. 충돌, lock, line clear, top-out은 DOM을 읽지 않는 순수 함수가 판정한다.

### 동작 과정

1. 입력을 `resolveInputMoveIntent()`가 이동/회전 intent로 바꾼다.
2. runtime이 `pendingPiece`를 만들고 `resolveMoveAttempt()`에 전달한다.
3. core가 board와 block offset으로 배치 가능 여부를 계산한다.
4. 성공하면 active piece를 확정하고, 하강 실패나 hard drop이면 lock intent를 만든다.
5. lock 뒤 line clear, score, attack 상태를 갱신하고 다음 piece를 spawn한다.
6. renderer가 확정된 board와 active/ghost piece를 Canvas에 그린다.

### 사용 기술과 고려 사항

- TypeScript, Canvas 2D, `node:test`
- core는 DOM과 timer를 참조하지 않는다.
- 원본 board mutation 여부를 테스트한다.
- wall kick, 화면 위 spawn, line clear 후 top-out 같은 경계 조건을 별도 pure function으로 검증한다.

## 5.2 싱글플레이

### 기능 설명

로컬 runtime이 키보드 입력, 중력, score, hold, next queue와 game over를 소유한다. React는 HUD를 구독하고 Canvas가 board를 그린다.

### 동작 과정

1. `tetrisSingle.tsx`가 Canvas/preview element를 runtime에 전달한다.
2. runtime이 state와 input loop를 초기화한다.
3. 키보드 event를 normalized action으로 바꾸고 tick queue에 넣는다.
4. runtime은 input을 먼저 처리하고 누적된 gravity를 적용한다.
5. display 값이 바뀔 때만 bridge가 React HUD subscriber를 알린다.
6. pagehide/unmount에서 keyboard, timer, sound와 runtime을 idempotent하게 정리한다.

### 고려 사항

- React rerender가 board draw를 소유하지 않게 했다.
- StrictMode lifecycle에서 중복 runtime과 listener가 남지 않게 cleanup을 테스트했다.
- Canvas의 실제 cell 변화와 score를 Playwright로 검증한다.

## 5.3 멀티 로비와 채팅

### 기능 설명

PVP/PVE 방 생성, 8자리 코드 참가, host 시작, 퇴장, 재동기화, global/room 채팅을 제공한다.

### 동작 과정

1. session이 준비되면 UI mutation이 활성화된다.
2. room 요청은 active session, lifecycle rate limit, Zod schema를 통과해야 한다.
3. `roomService`가 membership, host와 status를 변경한다.
4. server는 private field를 제거한 room DTO만 broadcast한다.
5. room이 `playing`이 되면 두 client가 multiplayer page로 이동한다.

### 고려 사항

- player 하나는 room 하나에만 속할 수 있다.
- playing room은 일반 `room:leave`를 거부하고 명시적 `game:leave`를 사용한다.
- 채팅은 200자 제한, plain text JSX, 초당 1회 rate limit을 적용한다.

## 5.4 Server-authoritative PVP

### 기능 설명

서버가 player별 board, active piece, queue, score, attack state와 game over를 최종 확정한다. client가 보내는 것은 행동 의도와 동기화 metadata다.

### 동작 과정

1. 게임 시작 시 server가 match와 player별 초기 7-bag chunk를 생성한다.
2. client는 성공한 local action만 `clientSequence`, `pieceIndex`, `expectedTransform`과 함께 전송한다.
3. server handler가 session, rate, schema, room ownership을 검사한다.
4. 같은 player의 input과 gravity를 mutation queue에서 FIFO로 처리한다.
5. shared core가 이동·lock을 계산하고 match state를 갱신한다.
6. server가 input result와 authoritative snapshot을 양쪽에 보낸다.
7. top-out 시 server가 winner/loser를 확정하고 match를 정리한다.

### 고려 사항

- client의 playerId/nickname은 권한 근거로 사용하지 않는다.
- 중복·역순 sequence와 stale piece index를 state mutation 전에 거부한다.
- 내부 오류도 terminal acknowledgement를 반환해 client pending input이 영구 대기하지 않게 한다.

## 5.5 Client prediction과 snapshot correction

### 기능 설명

내 입력은 client에서 먼저 반영해 반응성을 유지하고, server snapshot은 mismatch가 의미 있는 경우에만 full apply한다. 상대 board는 server snapshot을 그대로 적용한다.

### 동작 과정

1. local action 성공 후 server input을 보낸다.
2. acknowledgement 전 input은 `pendingServerInputs`에 남는다.
3. pending input이 있으면 일반 own snapshot correction을 보류한다.
4. ack 뒤 deferred snapshot의 sequence와 piece index를 다시 평가한다.
5. gameOver, garbage 적용, 큰 piece gap, settled board mismatch는 즉시 보정한다.
6. 1-piece gap은 같은 방향으로 750ms 유지될 때만 보정한다.

### 고려 사항

- active piece의 row/rotation 차이를 매번 보정하면 정상 prediction이 되감기므로 settled board 중심으로 판단한다.
- `expectedTransform`으로 lock 직전 server/client 위치 차이를 감지한다.
- rollback E2E는 한 번 되감겼다가 다시 수렴하는 경우도 실패하도록 연속 snapshot fingerprint를 본다.

## 5.6 공격 규칙과 line-clear presentation

### 기능 설명

line clear 수, T-Spin, combo와 back-to-back으로 garbage attack을 계산하고, incoming garbage와 먼저 상쇄한다. server가 계산한 line clear는 별도 presentation effect로 상대 화면에도 표시한다.

### 동작 과정

1. lock 결과에서 T-Spin과 filled row를 판정한다.
2. `resolveAttackState()`가 combo/B2B 상태를 갱신한다.
3. `calculateGarbageAttack()`이 raw attack을 만든다.
4. pending garbage와 FIFO로 cancel한다.
5. 남은 공격은 상대 player의 pending queue에 추가한다.
6. line clear row와 `boardBeforeClear`를 포함한 effect를 snapshot에 붙인다.

### 고려 사항

- renderer는 effect를 표현하지만 공격 규칙은 core/server에 있다.
- line clear presentation 중 gameplay state나 gravity를 임의로 바꾸지 않는다.
- player별 gravity timing을 분리해 한쪽 lock/animation이 다른 쪽 진행을 막지 않게 했다.

## 5.7 Session 보안과 reconnect

### 기능 설명

server가 UUID playerId와 256-bit opaque token을 발급한다. browser는 versioned credential을 `sessionStorage`에 저장하고 reconnect 때 token과 generation을 회전한다.

### 동작 과정

1. credential이 없으면 신규 session을 발급하고 token digest만 server memory에 저장한다.
2. resume은 playerId+token을 검증하고 새 token/generation으로 회전한다.
3. newest socket wins 정책으로 이전 socket을 끊는다.
4. transport disconnect 후 30초 동안 room/match 복귀를 기다린다.
5. reconnect 시 lobby는 room sync, game은 game join과 최신 snapshot을 요청한다.
6. grace 만료 시 waiting membership 또는 playing match를 정리한다.

### 고려 사항

- token 원문은 private `session:ready`와 browser storage에만 존재한다.
- public DTO, URL, DOM, console, assertion failure에서 token이 노출되지 않게 검사한다.
- sessionStorage는 XSS에 노출될 수 있어 CSP가 함께 필요하지만, 공개 계정 인증 시스템을 구현한 것은 아니다.

## 5.8 휴리스틱 PVE

### 기능 설명

현재 조각이 실제 입력으로 도달 가능한 모든 placement를 탐색하고, line clear·height·holes·bumpiness 지표로 점수를 계산해 하나를 선택한다.

### 동작 과정

1. BFS 형태의 reachable planner가 move/rotate/soft drop 상태를 탐색한다.
2. 각 상태에서 hard drop 가능한 최종 placement를 생성한다.
3. placement simulation으로 boardAfter와 line clear/game over를 계산한다.
4. board metrics와 고정 weight로 후보를 정렬한다.
5. 선택한 후보의 planned action을 server ticker가 하나씩 실행한다.
6. 실제 성공한 action만 AI inputSequence log에 기록한다.

### 고려 사항

- 단순 좌표 열거가 아니라 wall kick과 tuck을 포함한 reachable 후보만 사용한다.
- AI decision과 board 원본을 mutate하지 않는지 테스트한다.
- Normal은 hard drop 전 soft drop을 일부 보여주고 Hard는 더 빠르게 실행하지만 판단 규칙의 원천은 같다.

## 5.9 Experimental placement V4 PVE

### 기능 설명

125게임 human placement dataset으로 만든 pairwise linear candidate를 사용자 선택형 PVE에 연결했다. 강한 gameplay AI가 아니라 사람의 placement 선택을 모방하는 실험 기능이다.

### 머신러닝 문제 정의 (Pairwise Ranking Formulation)

- **문제 정의**: 한 placement decision 시점에 도달 가능한 $K$개의 Reachable 후보 중 사람이 선택한 단 하나의 정답 배치($x^+$)가 선택되지 않은 나머지($x^-$)보다 높은 점수를 얻도록 학습하는 **Pairwise Learning-to-Rank** 구조다.
- **피처 표준화(Standardization)**: 학습 데이터셋 전체 후보군을 기준으로 16개 피처의 평균($\mu$)과 표준편차($\sigma$)를 사전 계산한 scaler를 적용한다.
- **학습 단위 및 목적 함수(Loss Function)**:
  $$\Delta x = \text{standardize}(x^+) - \text{standardize}(x^-)$$
  $$\mathcal{L} = \sum_{\text{pairs}} w_{\text{pair}} \cdot \log(1 + e^{-w^T \Delta x}) + \frac{\lambda}{2} \|w\|_2^2$$
- **Decision 가중치 정규화**: 한 수(decision)에서 나오는 후보 개수($K$)가 보드 상황마다 다르므로, 특정 decision의 페어 수가 전체 손실을 지배하지 않도록 **한 decision 내 모든 pair 가중치 합을 1로 정규화**($w_{\text{pair}} = \frac{1}{K-1}$)했다.
- **절편(Intercept) 제외**: 단일 decision 내 순위 비교는 상대적 점수 차이로만 결정되므로 공통 상수인 intercept는 학습하지 않고 feature weight만 최적화한다.

### 피처 엔지니어링 및 설계 근거 (16 Feature Schema)

| 피처명 | 설명 | 설계 근거 (Rationale) |
| --- | --- | --- |
| `candidateResult.linesCleared` | 후보 배치 즉시 완성되는 라인 수 (0~4) | 즉각적인 보상 및 위기 탈출 기여도 |
| `candidateResult.gameOver` | 배치 후 즉시 게임 오버 발생 여부 (0 또는 1) | 치명적인 패배 수 즉시 배제 |
| `metricDelta.aggregateHeight` | 전체 10개 열의 높이 합 변화량 | 보드 전체 누적 부하 억제 |
| `metricDelta.maxHeight` | 보드 최고 높이 변화량 | Top-out 위험 마진 관리 |
| `metricDelta.holes` | 새로 생성/해소된 빈 공간(구멍) 수 변화량 | 테트리스 생존에 가장 치명적인 지표 |
| `metricDelta.bumpiness` | 인접 열 간 높이 단차 합($\sum \|h_i - h_{i+1}\|$) 변화량 | 보드 표면 평탄도 유지 |
| `metricDelta.columnHeights[0~9]` | 0번~9번 열 각각의 높이 변화량 (10개) | 벽면 및 중앙부의 국소적 지형 변화 반영 |

- **Delta(변화량) 피처 설계 이유**: 절대적 보드 높이나 구멍 수는 게임 진행에 따라 계속 누적되는 상태값이므로, "지금 놓는 한 수가 보드 형상에 어떤 물리적 변화를 가했는가"를 정규화하여 학습해야 임의의 보드 상황에 일반화될 수 있기 때문이다.

### 물리적 표현 표현 클러스터링 (Occupied-cell Physical Class)

- **Alias Placement 문제**: 테트리스는 회전 중심이나 이동/tuck 경로가 달라도 최종 보드 격자 4칸($\text{coords}$)을 점유하는 물리적 결과가 완전히 동일한 경우가 빈번하다.
- **V4 Representation 개선**: 물리적으로 점유하는 셀 위치가 동일한 후보들을 **단일 Physical Class로 묶어(Clustering)** 점수를 평가하고, 클래스 내에서는 canonical tie-break(최소 조작/최단 경로)로 대표 배치를 선택해 점수 왜곡과 불필요한 확률 분산을 방지했다.

### 동작 과정

1. heuristic ranking 경로로 reachable candidate와 16개 delta feature를 생성한다.
2. V4 scorer가 occupied-cell physical class로 alias candidate를 묶는다.
3. game-over가 아닌 class가 하나라도 있으면 game-over class는 무조건 제외한다.
4. 학습된 가중치 벡터 $w$와 표준화된 feature의 내적으로 linear score를 계산한다.
5. 동점 발생 시 canonical tie-break(linesCleared 내림차순 → height/hole 최소화 → 결정론적 키)로 최종 배치를 결정한다.
6. 선택 결과의 planned action은 사람과 동일한 authoritative AI executor가 틱 단위로 실행한다.
7. 모델 파일 부재, SHA-256 불일치, 비정상 점수(NaN/Inf) 발생 시 즉시 휴리스틱 정책으로 안전하게 fallback한다.

### 오프라인 평가와 온플레이 성능 간 불일치 (Evaluation Analysis)

| 평가 환경 | 지표 | 휴리스틱(Baseline) | V4(Pairwise Linear) | 결과 분석 |
| --- | --- | ---: | ---: | --- |
| **Offline Validation** | Top-1 Accuracy | - | **62.4%** | 사람의 단일 수 선택 재현율 유의미 |
| | Top-3 Accuracy | - | **88.1%** | 상위 후보 추천 품질 확보 |
| | MRR (Mean Reciprocal Rank) | - | **0.76** | 사람 정답 배치가 최상위권에 랭크 |
| **Online Gameplay** | 30×500 Horizon Survival | **30/30 (100%)** | **27/30 (90%)** | 3개 스트림에서 조기 Top-out 발생 |
| (30 stream × 500 placements) | 평균 발생 구멍(Holes) | **낮음 (안정적)** | **높음 (누적됨)** | 미세한 구멍 생성 수가 장기적으로 누적 |

- **분포 불일치(Distribution Shift / Compounding Error)**: 오프라인에서는 인간이 만들어 놓은 안정적인 보드 상태에서의 한 수(Single-step)를 예측하므로 Top-1 지표가 높았으나, AI가 자신의 예측 결과를 누적하여 플레이하는 온라인 환경에서는 작은 비최적 수(Suboptimal placement)가 구멍을 누적시켜 결국 장기 생존력이 저하되는 현상이 발생했다.
- **정책적 의사결정**: 이 평가 결과를 숨기지 않고, 기본 PVE는 검증된 휴리스틱을 유지하며 V4는 사용자가 선택할 수 있는 `Experimental AI` 옵션과 명확한 fallback 증거 로그로 분리했다.

## 5.10 분석 이벤트와 JSONL 데이터셋

### 기능 설명

`game_start`, `placement_decision`, `game_over`를 분석 이벤트로 만들고, JSONL을 선택한 환경에서는 한 줄 JSON으로 저장한다. placement log에서 모든 reachable candidate를 다시 만들어 ranking dataset으로 변환한다.

### 데이터셋 파이프라인 및 정제 규칙

1. **로그 수집 신뢰 경계(Trust Boundary)**:
   - 클라이언트 조작 로그를 그대로 신뢰하지 않고, 서버의 권위적 입력 처리가 실제로 확정(Commit)된 시점의 유효한 `placement_decision`만 수집한다.
   - 단일 이벤트 페이로드는 256 KiB로 제한하고, Schema Version과 필드 허용목록(Allowlist)을 엄격히 검증한다.
2. **후보군 결정론적 재생성(Candidate Regeneration)**:
   - 원본 로그에는 선택된 배치만 기록해 용량을 최적화하고, 데이터셋 빌더가 동일한 보드 상태와 난수 시드로부터 도달 가능한 전체 후보군(Average 20~35개)을 결정론적으로 재생성한다.
3. **Data Leakage 방지 (Group Split & Temporal Holdout)**:
   - 샘플 단위(Row-level) 무작위 분할 시 같은 게임의 유사한 보드 상태가 Train과 Validation에 섞여 과적합이 발생한다.
   - 따라서 **`gameId` 단위의 엄격한 Group Split**을 적용하고, 최근 25개 게임은 **Temporal Holdout**으로 격리하여 시간 흐름에 따른 일반화 성능을 검증했다.
4. **JavaScript ↔ Python Parity 프로토콜**:
   - JavaScript(Node.js)의 feature 추출/정규화 및 랭커 구현과 Python의 참조 구현 간의 부동소수점 오차를 $10^{-6}$ 허용오차 내에서 일치하도록 테스트 계약(`placement_pairwise_parity.py`)을 자동화했다.

### 고려 사항

- test/E2E log 경로와 production log를 분리한다.
- export 전후 source checksum을 비교해 원본 불변성을 확인한다.
- JSONL은 local/development의 기본 분석 경로이며 PostgreSQL mode와 동시에 쓰지 않는다.

## 5.11 PostgreSQL canonical event storage와 JSONL import

### 기능 설명

선택된 production runtime에서 분석 이벤트를 PostgreSQL에 멱등하게 저장한다. 기존 JSONL은 streaming importer로 옮길 수 있지만 원본을 수정하지 않으며, 실제 production import는 아직 수행하지 않았다.

### 동작 과정

1. `gameEventProjector`가 raw log를 다시 검증하고 event별 allowlist만 새 객체로 복사한다.
2. lifecycle은 `server_authoritative`, human placement는 `client_reported`, heuristic placement는 `server_authoritative`로 trust level을 기록한다.
3. canonical serializer가 key 순서를 고정하고 비정상 JSON 값, NUL, 잘못된 surrogate, getter, cycle과 256 KiB 초과 envelope를 거부한다.
4. identity tuple로 `event_id`, immutable envelope로 `event_sha256`을 계산한다.
5. repository가 parameterized SQL로 insert한다. 같은 ID와 같은 hash는 duplicate 성공, 같은 identity와 다른 내용은 conflict 실패다.
6. retry 가능한 연결 오류만 최대 3회·총 약 2.7초 안에서 재시도한다. pool은 4, process in-flight는 16으로 제한한다.
7. 종료 시 새 write를 차단하고 event producer를 멈춘 뒤 최대 3초 drain, pool close, Socket.IO/HTTP close 순서로 정리한다. 전체 종료 상한은 8초다.
8. importer는 JSONL을 줄 단위로 읽고 같은 projection/identity 경로를 재사용해 dry-run, 멱등 재실행과 completeness reason을 보고한다.

### 고려 사항

- `GAME_EVENT_STORAGE=jsonl|postgres`는 single-sink 선택이다. 장애 시 다른 저장소로 조용히 fallback하거나 dual-write하지 않는다.
- 분석 저장 실패가 gameplay를 중단시키지는 않는다. 대신 실패 이벤트가 유실될 수 있고 불완전 경기는 학습 export에서 제외한다.
- non-loopback PostgreSQL은 `verify-full` TLS, CA와 DNS hostname 검증을 요구한다.
- runtime role은 append/readiness에 필요한 최소 권한만 갖고 retention delete는 maintenance role로 분리한다.
- retention 자동 삭제, managed provider, 실제 production credential·backup·restore와 운영 import는 추가 확인이 필요하다.

## 5.12 Build, 보안과 운영 경계

### 기능 설명

production은 compiled server와 hashed client artifact만 실행한다. HTTP/Socket boundary에는 CSP, Origin allowlist, rate limit, payload validation과 private DTO 차단을 적용한다.

### 동작 과정

1. Vite가 네 page를 빌드하고 TypeScript compiler가 server/shared core를 compile한다.
2. artifact test가 source, source map, test, dev tool이 없는지 검사한다.
3. Express는 security header를 정상/오류 응답에 적용한다.
4. production Socket.IO는 `SOCKET_ALLOWED_ORIGINS` 없이는 시작하지 않는다.
5. Docker runtime은 non-root, read-only root로 실행한다. JSONL mode에서만 log volume을 두고 PostgreSQL mode에서는 writable JSONL mount가 없는지 검사한다.
6. GitHub Actions가 Fast, Browser, Docker, PostgreSQL 네 job을 실행한다.

### 고려 사항

- TLS/HSTS와 reverse proxy는 실제 배포 환경이 정해지지 않아 구현 범위가 아니다.
- healthcheck는 내부 상태나 credential을 노출하지 않고 `/`만 확인한다.
- dependency patch는 direct dependency를 늘리지 않고 lockfile의 호환 가능한 transitive version만 갱신했다.
- PostgreSQL production-like gate는 합성 이벤트와 test DB를 사용하며 실제 서비스 활성화를 의미하지 않는다.

---

# 6. 기술적 의사결정

## 6.1 DOM이 아니라 배열을 게임 상태로 사용

- 근거: `board.ts`, `stateFactory.ts`, change-log의 2025-10-20 전환 기록
- 선택 이유: 충돌·lock·line clear가 화면 구조와 무관해야 Canvas, server와 AI가 같은 규칙을 사용할 수 있다.
- 장점: pure test, snapshot 직렬화, server 재사용, renderer 교체가 가능하다.
- 단점: 배열 상태와 화면의 동기화 계층을 직접 구현해야 한다.
- 판단: 이 선택이 이후 server-authoritative와 placement dataset의 전제 역할을 했다.

## 6.2 Core / Runtime / Render 분리

- core는 계산 결과만 반환하고 runtime은 timer, input, state transition을 조율하며 render는 그리기만 한다.
- 모든 것을 하나의 runtime 파일에 두는 것보다 호출 경계가 늘지만, server와 AI가 DOM 없이 core를 재사용할 수 있다.
- 현재 `tetris.ts`는 여전히 큰 orchestration 파일이지만, 재현된 문제 없이 미래 확장을 이유로 추가 manager를 만들지는 않았다.

## 6.3 Client-authoritative relay에서 server-authoritative로 전환

- client snapshot relay 방식은 잘못된 보드나 승패를 server가 그대로 전달할 위험이 있었다.
- server가 input, gravity, lock, attack과 game over를 계산하도록 바꿨다.
- 장점: final state의 원천이 하나이고 PVP/PVE rule parity가 높다.
- 단점: server CPU/메모리와 snapshot traffic이 증가하고 prediction correction이 필요하다.
- 현재 2인 MVP에서 일관성 문제를 해결하는 데 적절한 trade-off였다.

## 6.4 Local prediction을 유지하고 제한적으로 correction

- server round trip마다 입력 결과를 기다리면 조작감이 나빠지므로 자기 board는 먼저 반영한다.
- 모든 snapshot을 덮지 않고 ack되지 않은 input, sequence, piece index와 settled board를 기준으로 보정한다.
- 완전한 rollback netcode는 아니다. 알려진 stale snapshot rollback 경로를 막는 범위다.

## 6.5 Player별 mutation queue와 gravity timing

- 같은 player의 Socket input과 ticker gravity가 동시에 state를 바꾸는 race를 막기 위해 FIFO queue를 공유한다.
- room 전체 global queue가 아니라 player별 queue라 한 player의 오류나 지연이 다른 player 진행을 막지 않는다.
- 분산 lock이나 actor framework는 현재 단일 process/2인 room에 필요하지 않아 도입하지 않았다.

## 6.6 React는 shell/HUD만 소유

- React state에 board, bag, raw snapshot과 credential을 다시 저장하면 runtime/server 원천과 중복된다.
- display bridge가 score, lines, hold, next, pending garbage와 phase만 노출한다.
- 장점: Canvas runtime을 보존하고 React lifecycle만 검증할 수 있다.
- 단점: React와 external store bridge 사이 계약이 필요하다.

## 6.7 MPA 유지, SPA 보류

- 네 page entry를 Vite MPA로 빌드한다.
- SPA는 sound continuity와 route 전환에 장점이 있지만 Socket/session/runtime cleanup과 BFCache 회귀 범위를 키웠다.
- Goal 7A 문서는 SPA를 보류하고 현재 page lifecycle을 안정화하는 선택을 기록한다.

## 6.8 공유 Zod schema에서 TypeScript event type 파생

- client/server가 따로 interface를 작성하면 wire contract가 어긋날 수 있다.
- 실제 runtime validation과 compile-time type을 같은 schema map에서 만든다.
- ownership과 business rule은 schema에 섞지 않고 socket/service에서 별도로 검사한다.

## 6.9 실시간 상태는 memory, 분석 이벤트는 single-sink

- room/match/session은 짧은 수명의 실시간 상태이고 분석 이벤트는 장기 보존 대상이라 같은 저장 전략을 적용하지 않았다.
- 실시간 상태는 계속 process memory에 둬 단일 instance MVP의 mutation 순서를 단순하게 유지했다. PostgreSQL은 세 종류의 append-only 분석 이벤트에만 사용한다.
- JSONL과 PostgreSQL을 동시에 쓰면 한쪽 성공·한쪽 실패의 의미와 재처리가 복잡해지므로 runtime은 strict single-sink를 선택한다.
- PostgreSQL 장애를 JSONL 성공으로 숨기지 않고 bounded best-effort 실패로 관찰한다. gameplay는 계속되지만 불완전 경기를 학습 데이터에서 제외한다.
- identity tuple의 SHA-256과 immutable envelope hash를 나눠 같은 이벤트의 재전송은 멱등 성공으로, 같은 identity의 내용 변경은 conflict로 처리한다.
- ORM보다 raw SQL과 `pg`를 선택해 두 migration과 한 append table의 제약·권한·쿼리를 직접 검증했다. 현재 규모에서는 추가 추상화보다 계약이 명확하다.

## 6.10 AI도 authoritative input 경로 사용

- 최종 placement를 직접 적용하는 legacy API를 제거했다.
- 사람과 AI가 같은 move/rotate/drop, lock, attack, game-over side effect를 공유한다.
- AI 실행 속도는 cadence/profile로 조절하되 게임 규칙은 별도로 만들지 않는다.

## 6.11 Heuristic 기본값, V4는 opt-in과 fallback

- V4는 human imitation 목적의 후보이며 gameplay benchmark에서 heuristic을 대체할 근거가 없었다.
- 모델이 존재한다고 바로 production default로 올리지 않고, SHA/schema/finite score를 검증하고 오류 시 heuristic으로 돌아간다.
- 이는 ML 결과를 기능 홍보보다 평가 계약으로 다룬 결정이다.

## 6.12 JavaScript를 게임/feature 원천, Python을 reference로 사용

- Python이 Tetris 규칙을 다시 구현하지 않는다.
- JavaScript가 candidate order와 16개 raw feature를 export하고 Python은 scaler/optimizer/rank를 비교한다.
- 두 언어 중복 구현보다 bundle과 parity tolerance를 관리하는 편이 현재 실험에 적합했다.

## 6.13 Goal과 하네스로 마이그레이션 범위 제한

- Vite, session 보안, Zod, server build, React, TypeScript, CSP, Docker, CI를 한 번에 바꾸지 않았다.
- Goal마다 base commit, precondition, 변경 범위, 자동/수동 검증, 남은 위험과 rollback을 기록했다.
- 에이전트 실행도 긴 자유형 지시보다 현재 Goal 파일 하나와 정해진 gate를 읽게 했다.

---

# 7. 유지보수 및 확장성

## 7.1 유지보수 측면에서 고려한 부분

- 게임 판정을 pure function으로 만들어 UI와 server 수정의 영향을 줄였다.
- room, match, session, ticker의 상태 소유자를 분리했다.
- raw Socket event를 page/runtime에서 직접 다루지 않고 `roomClient` adapter에 모았다.
- public room DTO는 whitelist mapper를 사용해 내부 field 추가가 자동 노출로 이어지지 않게 했다.
- lifecycle object의 `destroy()`와 disposer는 중복 호출에 안전하게 만들었다.
- production artifact와 source-less release를 별도 테스트해 개발 환경 의존을 막았다.
- canonical projector와 raw SQL migration을 gameplay service 밖에 둬 저장소 변경이 입력 판정으로 번지지 않게 했다.
- server shutdown 순서를 함수 하나로 고정해 write reject, producer stop, drain, pool close와 network close의 누락을 막았다.
- migration run 기록에 rollback 순서를 남겨 단계별 변경을 되돌릴 수 있게 했다.

## 7.2 코드 재사용성

- `core`는 single runtime, authoritative server와 AI simulation에서 재사용된다.
- board metrics는 heuristic, dataset feature와 experimental model adapter가 공유한다.
- reachability planner의 결과는 heuristic decision, V4 decision과 dataset builder가 함께 사용한다.
- shared Zod contract는 browser와 server event boundary를 함께 정의한다.
- display bridge는 single/multiplayer HUD가 runtime을 같은 방식으로 구독하게 한다.
- canonical projection은 runtime PostgreSQL append와 JSONL importer가 공유해 online/offline 변환 의미가 갈라지지 않게 한다.

## 7.3 현재 확장 가능한 지점

- 새 AI policy는 PVE decision adapter와 fallback evidence 경계에 추가할 수 있다.
- 새 game log event는 validator, projector, identity tuple, SQL constraint와 completeness 계약을 함께 versioning해 추가할 수 있다.
- event storage는 runtime selector 뒤에 JSONL/PostgreSQL repository가 있어 실행 환경별 single-sink를 교체할 수 있다.
- room/match persistence는 현재 event DB와 별개로 service API와 ownership을 보존하면서 설계할 여지가 있다.
- page UI가 커지면 실제 중복을 기준으로 React component를 추출할 수 있다.
- Socket schema와 DTO가 중앙화돼 protocol versioning을 시작할 위치가 분명하다.

## 7.4 현재 확장의 한계

- memory map은 multi-instance와 restart recovery를 지원하지 않는다.
- full snapshot 전송은 동시 room이 커지면 직렬화와 bandwidth 비용이 증가한다.
- 단일 Node event loop에서 많은 AI search와 ticker가 동시에 실행될 때 성능 검증이 없다.
- JSONL에는 index/query/concurrent writer 전략이 없고 PostgreSQL도 아직 production provider·운영 retention 자동화가 확인되지 않았다.
- PostgreSQL 저장은 gameplay state recovery나 multi-instance room 공유를 해결하지 않는다.
- Chromium desktop 중심이라 browser/device 범위가 좁다.

## 7.5 실제 서비스로 확장할 때의 순서

1. OCI VM의 OS, 자원, Docker, port, reverse proxy/TLS, DNS, firewall와 기존 JSONL backup 경로를 read-only로 확인한다.
2. JSONL 기반 app과 HTTPS 기준선을 먼저 배포하고 rollback·observability를 검증한다.
3. managed PostgreSQL provider, CA/hostname TLS, role/secret, backup/restore와 비용을 검증한다.
4. 승인된 JSONL import와 completeness 확인 뒤 `GAME_EVENT_STORAGE=postgres` single-sink로 전환한다.
5. multi-instance 요구가 생기면 별도로 Socket.IO adapter, sticky session과 shared ephemeral store를 설계한다.
6. snapshot bandwidth가 병목이면 input ack와 snapshot coalescing을 분리한다.

---

# 8. 향후 개선점

## 우선순위 1: OCI 기준선 배포와 운영 경계 확인

- 현재 네 CI job은 green이지만 실제 cloud/OCI 배포는 확인되지 않았다.
- 먼저 read-only preflight로 OS/architecture, RAM·swap·disk, Docker/Compose, port, reverse proxy/TLS, DNS, firewall와 기존 JSONL backup 경로를 확인한다.
- 그 결과와 rollback 계획을 검토한 뒤 JSONL 기반 app+HTTPS를 기준선으로 배포한다.
- branch protection과 CD는 공개 운영 방식과 secret/rollback이 정해진 뒤 연결한다.

## 우선순위 2: 네트워크 회귀 범위 확대

- latency, jitter, packet loss, pending input 중 reconnect를 대상으로 prediction/correction E2E를 추가한다.
- key repeat soft drop, natural lock, garbage/line clear/game over가 겹치는 경계를 검증한다.
- WebKit/Firefox와 mobile viewport를 추가한다.

## 우선순위 3: Snapshot 전송 최적화

- 현재 input 성공마다 full snapshot을 보내는 구조를 먼저 계측한다.
- 병목이 확인되면 sender ack는 매 input 전송하고 일반 movement snapshot은 100ms 단위로 coalescing한다.
- lock, garbage, presentation effect, game over와 correction snapshot은 즉시 전송해야 한다.
- event loss 없이 마지막 state를 보내는 회귀 테스트가 선행돼야 한다.

## 우선순위 4: PostgreSQL production 활성화

- 구현과 합성 production-like 검증은 끝났지만 managed provider, 실제 CA/credential, backup/restore와 latency/cost는 확인되지 않았다.
- provider와 role을 준비한 뒤 migration을 두 번 실행해 apply/skip을 확인하고, 실제 JSONL import는 checksum·completeness report와 rollback을 승인받은 경우에만 수행한다.
- cutover는 `GAME_EVENT_STORAGE=postgres` 단일 sink로 진행하며 JSONL runtime dual-write나 silent fallback을 추가하지 않는다.
- room/session 복구와 multi-instance는 event database와 별도 문제로 다룬다.

## 우선순위 5: Retention과 관찰 가능성

- PostgreSQL raw event 보존 목표 90일, 용량 경고 70%, 비상 기준 85%는 runbook에 있으나 자동 삭제는 구현하지 않았다.
- 먼저 table/index size, write failure, conflict, in-flight reject와 incomplete game 수를 수집하고 maintenance role의 dry-run 결과를 운영자가 검토하게 한다.
- 실제 삭제는 backup·completeness와 승인 절차가 확인된 뒤 수행한다.
- JSONL fallback 운영 시에는 rotation, 압축, volume backup과 disk usage alert가 여전히 필요하다.

## 우선순위 6: 사용자 경험과 접근성

- 모바일/touch control, 반응형 board scaling과 실제 device test를 추가한다.
- Canvas board를 보완할 live text 상태, keyboard focus 흐름과 screen reader 점검을 수행한다.
- match ready 상태, 방 목록/quick match, 결과 화면은 실제 사용자 흐름 우선순위가 정해질 때 구현한다.

## 우선순위 7: AI/ML 후속 개선

- V4를 gameplay default로 바꾸지 않는다.
- 새 실험은 “human imitation 개선”과 “장기 생존/공격 성능 개선” 중 목적을 먼저 분리한다.
- 새 holdout cohort와 고정 benchmark 없이 feature/estimator를 반복 변경하지 않는다.
- LLM coaching은 원본 로그 전체가 아니라 검증된 요약 통계와 주요 decision 차이를 입력으로 사용한다.

## 우선순위 8: 코드 구조

- `tetris.ts`와 `multiplayerHandlers.ts`는 큰 파일이지만 단순 크기만으로 나누지 않는다.
- 변경이 자주 충돌하거나 독립 테스트가 어려운 실제 책임부터 작은 단위로 추출한다.
- 단일 구현 interface, manager, factory를 미래 확장만으로 추가하지 않는다.

---

# 9. 프로젝트를 통해 배운 점

## 9.1 상태의 원천을 먼저 정해야 구조가 단순해진다

초기 DOM 중심 구조를 배열 상태로 바꾸면서 화면은 상태를 보여주는 소비자가 됐다. 멀티플레이에서는 같은 원칙을 server authoritative state까지 확장했다. UI, client prediction, server state가 모두 같은 의미의 값을 소유하면 동기화 문제가 생기므로 각 값의 원천과 파생값을 먼저 정하는 것이 중요하다는 점을 확인했다.

## 9.2 실시간 게임은 서버 권위만으로 끝나지 않는다

서버를 최종 원천으로 바꾸면 일관성은 높아지지만, 입력 반응성과 correction 문제가 새로 생긴다. `clientSequence`, acknowledgement, expected transform, player별 mutation queue와 보정 정책을 함께 설계해야 실제 조작감과 일관성을 동시에 얻을 수 있었다.

## 9.3 순수 게임 규칙은 테스트와 AI의 공통 기반이 된다

collision, lock, line clear, T-Spin, garbage와 board metrics를 DOM 없이 만들었기 때문에 server와 AI가 같은 규칙을 재사용할 수 있었다. 단순한 “코드 정리”가 아니라 새로운 실행 환경을 추가할 수 있는 경계라는 점을 배웠다.

## 9.4 AI의 평가 목표와 게임 성능은 다를 수 있다

V4는 human placement imitation metric에서 의미가 있었지만 30×500 gameplay screening에서 heuristic을 대체할 근거가 없었다. offline rank metric이 좋아도 장기 생존, holes와 공격 성능이 좋아진다고 볼 수 없으며, 모델의 목적과 production 정책을 분리해야 한다.

## 9.5 데이터 파이프라인도 제품 코드처럼 계약이 필요하다

gameId split, checksum, canonical order, schema version, atomic write와 JavaScript↔Python parity가 없으면 실험 결과를 다시 설명하기 어렵다. Notebook 결과만 남기는 것보다 입력과 출력의 불변 조건을 코드와 테스트로 고정하는 경험을 했다.

## 9.6 점진적 마이그레이션은 완료 조건과 rollback이 핵심이다

Vite, React, TypeScript, session 보안, Zod, CSP, Docker와 CI를 한 번에 바꾸지 않고 Goal로 나눴다. 각 단계에서 현재 기능을 다시 검증하고, 다음 단계로 자동 진행하지 않으며, 되돌릴 commit 순서를 남기는 방식이 큰 변경의 위험을 줄였다.

## 9.7 AI agent를 사용할수록 사람의 범위 설정과 중단 판단이 중요하다

server-authoritative 작업 중 특정 목표가 없는 “진행해”라는 지시를 전달하고 자리를 비웠을 때, agent가 과도한 실험 단계를 확장해 시간과 token을 크게 사용한 경험이 있었다. 이를 통해 agent는 완벽한 자율 실행자가 아니며, 사람이 현재 Goal, 금지 범위, full-run 승인 지점과 종료 조건을 명시해야 한다는 점을 배웠다.

## 9.8 Lead session과 implementation session을 분리하는 방법을 익혔다

리드 역할의 세션은 코드와 문서를 읽고 작은 Goal, 검증 명령과 중단 지점을 작성했다. 구현 역할의 세션은 그 prompt와 현재 Goal 파일만 받아 변경하고 merge gate에서 멈추게 했다. read-only caller 조사나 독립 검토만 subagent로 제한해, 한 세션이 설계·구현·검증·다음 작업까지 무한히 확장하지 않도록 했다.

## 9.9 큰 ML 결과는 LLM에 그대로 넣지 않아도 된다

초기에는 agent가 full report와 Notebook 내용을 모두 읽어 분석하게 했지만, 로컬과 외부 model 사이의 전송 및 고급 model 처리 시간이 길었다. 이후 Python summarizer를 만들어 고정 계약, 핵심 수치, checksum과 decision status만 compact JSON/Markdown으로 만들었다. 이 방식으로 LLM 입력 token과 분석 시간을 줄이고, 원본 report는 검증 증거로 보존했다.

## 9.10 영속성은 저장 코드보다 실패와 종료 의미가 더 중요하다

PostgreSQL append 자체뿐 아니라 duplicate와 conflict의 차이, DB-down일 때 gameplay를 계속할지, 종료 중인 write를 어디까지 기다릴지, retention delete 권한을 누가 가질지를 함께 결정해야 했다. canonical identity, single-sink, bounded retry, drain과 role separation을 구현하면서 저장 기술 선택은 운영 실패 의미를 정하는 작업이라는 점을 배웠다.

---

# 10. 트러블 슈팅

> 이 절은 저장소의 change-log/run 기록과 사용자가 제공한 개발 경험을 함께 정리했다. 개인 역할·협업 경험·회고 항목은 별도로 작성하지 않았다.

## 10.1 빠른 입력 뒤 자기 보드가 이전 위치로 돌아가는 문제

### 문제

PVP에서 이동·회전 후 lock 직전에 server snapshot이 적용되며 자기 조각이나 board가 이전 상태로 돌아가는 현상이 간헐적으로 발생했다.

### 원인

- client는 입력을 로컬에 먼저 적용했지만 server snapshot에는 아직 그 입력이 반영되지 않을 수 있었다.
- input과 gravity가 같은 player state를 서로 다른 타이밍에 변경했다.
- 모든 own snapshot을 즉시 덮으면 정상 prediction도 stale state로 되감겼다.

### 해결 과정

1. input마다 단조 증가하는 `clientSequence`를 부여했다.
2. server가 `lastProcessedClientSequence`를 acknowledgement로 내려주게 했다.
3. ack 전 입력이 있으면 own full correction을 보류하고 snapshot을 deferred 상태로 관리했다.
4. 최신 ack보다 오래된 snapshot은 폐기했다.
5. `expectedTransform`과 `pieceIndex`로 lock 직전 divergence를 검출했다.
6. input과 gravity를 player별 FIFO mutation queue에서 처리했다.
7. client/server의 first-grounded gravity와 lock timing을 맞췄다.
8. 두 browser context에서 실제 outgoing input과 연속 board fingerprint를 확인하는 rollback E2E를 만들었다.

### 결과

2026-07-16 이후 알려진 재현 경로에서는 rollback이 다시 관찰되지 않았고, rollback E2E 반복 검증이 통과했다. 다만 latency/jitter, key repeat와 reconnect가 겹치는 조합은 별도 미검증 위험으로 남겼다.

### 배운 점

server-authoritative라는 구조 이름만으로 동기화 문제가 해결되지는 않는다. 입력 처리 완료 경계와 local prediction을 명시적으로 모델링해야 한다.

## 10.2 Agent에게 모호한 지시를 전달해 작업 범위가 과도하게 커진 문제

### 문제

server-authoritative 단계에서 Goal 기능을 이용해 작업을 진행하던 중, 특정 목적과 종료 조건이 없는 “진행해”라는 prompt를 잘못 전달하고 자리를 비웠다. Agent는 필요 이상으로 많은 실험 단계와 문서를 만들었고 token과 시간이 과도하게 사용됐다.

### 원인

- 현재 Goal, 허용된 파일, full experiment 승인 여부와 중단 지점이 prompt에 없었다.
- agent의 진행을 중간에 감시하거나 merge gate에서 멈추게 하는 제약이 부족했다.
- 설계, 구현, 실험과 다음 단계가 한 세션에 연결돼 있었다.

### 해결 과정

1. `ai-harness`와 `migration-harness`에 작업 범위, 읽기 순서와 금지사항을 기록했다.
2. 한 번에 현재 Goal 파일 하나만 읽게 했다.
3. 구현은 smoke까지만 수행하고 긴 full run은 사용자 승인 뒤 별도 mode로 실행하게 했다.
4. 작업 종료를 merge gate로 고정하고 다음 Goal, push, merge를 자동 수행하지 않게 했다.
5. 리드 세션이 prompt와 검증 기준을 만들고 구현 세션이 그 범위만 수행하도록 역할을 나눴다.

### 결과

이후 Vite/React/TypeScript/CSP/Docker/CI와 placement ML 실험은 작은 Goal과 실행 기록으로 분리됐다. 각 단계에 검증 결과, 남은 위험과 rollback이 남아 작업 범위를 다시 확인할 수 있게 됐다.

### 배운 점

Agent의 성능보다 먼저 필요한 것은 좋은 작업 계약이다. “계속 진행”보다 현재 목표, 하지 않을 것, 승인 gate와 멈출 조건을 적는 것이 비용과 품질에 더 큰 영향을 준다.

## 10.3 Lead session, implementation session과 subagent 역할이 섞이는 문제

### 문제

한 agent가 설계, caller 조사, 구현, 장시간 실행, review와 다음 계획까지 모두 맡으면 context가 커지고 범위가 쉽게 확장됐다. 여러 agent가 같은 파일을 동시에 수정할 위험도 있었다.

### 원인

- 조사와 변경 권한의 구분이 없었다.
- 리드의 판단과 구현자의 실행 결과가 같은 긴 대화 안에 섞였다.
- subagent 사용 목적과 수정 파일 경계가 불명확했다.

### 해결 과정

1. 리드 세션은 실제 코드와 Git 상태를 읽고 Goal prompt, acceptance criteria와 rollback을 작성했다.
2. 구현 세션은 지정된 Goal과 필요한 harness만 읽고 코드·테스트 변경에 집중했다.
3. subagent는 read-only caller 조사나 독립 테스트 검토처럼 결과를 합칠 수 있는 작업에만 사용했다.
4. 같은 파일을 여러 agent가 동시에 수정하지 않게 했다.
5. 구현 뒤 별도 review gate에서 회귀와 범위 위반을 확인했다.

### 결과

작업별 책임과 종료 시점이 명확해졌고, migration run 문서로 실제 변경과 검증을 추적할 수 있게 됐다.

### 배운 점

Agent 수를 늘리는 것이 곧 병렬 효율은 아니다. 독립적인 조사만 병렬화하고, 상태를 바꾸는 구현은 명확한 owner와 작은 범위를 갖게 해야 한다.

## 10.4 ML full report를 Agent가 모두 읽느라 분석이 느려진 문제

### 문제

Notebook full run 결과와 큰 JSON report를 매번 Agent가 처음부터 읽고 해석하게 하자, 외부 model과의 통신과 긴 context 처리로 시간이 오래 걸렸다. 고급 model일수록 응답 대기 시간이 더 길었다.

### 원인

- 원본 report에는 판단에 필요한 핵심 수치 외에도 candidate/fold별 상세 데이터가 많았다.
- full 실행, contract 검증, 수치 요약과 정책 판단이 한 prompt에 섞였다.
- 같은 불변 조건을 매 실험마다 자연어로 다시 설명했다.

### 해결 과정

1. full run과 analyze-result mode를 분리했다.
2. `summarize_placement_temporal_report.py`, `summarize_placement_v4_development_fit.py` 같은 summarizer를 작성했다.
3. summarizer가 checksum, cohort, leakage, finite metric, 주요 score와 decision status를 다시 검증하게 했다.
4. compact JSON/Markdown만 Agent 입력으로 사용하고 원본 report와 executed Notebook은 로컬 evidence로 보존했다.
5. 동일 입력에서 summary byte가 같은지 테스트했다.

### 결과

LLM에 전달하는 token과 분석 시간을 줄였고, 긴 원본을 읽지 않아도 검증 실패와 정책 판단에 필요한 수치를 확인할 수 있게 됐다.

### 배운 점

LLM context를 늘리는 대신 프로그램이 먼저 계산·검증·요약해야 한다. 모델은 원본 수치 집계보다 이미 검증된 결과의 의미와 trade-off를 설명하는 데 사용하는 편이 효율적이다.

## 10.5 Human imitation metric과 실제 gameplay 성능이 달랐던 문제

### 문제

V4 pairwise model은 human placement imitation 평가에서는 채택 근거가 있었지만, PVE에서 heuristic보다 나은 게임 성능을 보장하지 않았다.

### 원인

- 모델 목적은 사람이 선택한 placement ranking을 모방하는 것이었다.
- long-horizon survival, holes, height와 attack은 학습 목표와 직접 같지 않았다.
- alias placement 표현이 raw candidate metric 해석을 왜곡할 수 있어 occupied-cell physical class 정리가 필요했다.

### 해결 과정

1. V0/V4 representation을 temporal holdout에서 비교했다.
2. V4 occupied-cell physical class를 채택하되 production 승격과 분리했다.
3. 고정된 30 stream×500 placement paired gameplay benchmark를 실행했다.
4. horizon survival과 holes/height/attack을 함께 확인했다.
5. V4는 experimental imitation option으로만 연결하고 heuristic fallback을 유지했다.

### 결과

V4는 세 stream에서만 500 placement 전에 game over됐고 secondary board 지표도 heuristic보다 약했다. 기본 PVE 정책은 heuristic으로 유지하고 V4는 명시적 experimental 기능으로 제한했다.

### 배운 점

좋은 offline metric은 정의한 목표에만 유효하다. 서비스 정책을 바꾸려면 실제 사용 시나리오와 가까운 별도 평가가 필요하다.

## 10.6 Docker 검증 script에서 zsh 예약 변수로 PATH가 사라진 문제

### 문제

Goal 11D의 로컬 Docker 재현 중 loop 변수 이름으로 `path`를 사용하자 zsh의 특수 배열 `path`가 덮어써져 `docker` 명령을 찾지 못했다. cleanup trap도 실행되지 않아 container와 volume이 남고 다음 실행에서 port 충돌이 발생했다.

### 원인

- shell별 특수 변수 차이를 고려하지 않은 일반적인 변수명을 사용했다.
- cleanup도 같은 PATH에 의존했다.

### 해결 과정

1. 해당 Goal에서 만든 container와 volume만 정확히 식별해 제거했다.
2. workflow와 동일하게 bash로 script를 재실행했다.
3. CI 변수 이름과 shell을 명시하고 health, read-only, HTTP, CSP, SIGTERM 검증을 다시 수행했다.

### 결과

Docker smoke 전체 계약이 통과했고 GitHub Actions의 container job도 성공했다.

### 배운 점

로컬 shell과 CI shell의 차이도 재현성 범위에 포함된다. 넓은 시스템 변수 이름을 재사용하지 않고, cleanup target을 명시적으로 제한해야 한다.

## 10.7 PostgreSQL CI에서 정상적인 late commit을 데이터 불일치로 오판한 문제

### 문제

첫 hosted PostgreSQL job은 PVP/PVE와 첫 shutdown까지 성공했지만 exit code 1로 종료됐다. 종료 전 row snapshot과 재시작 뒤 snapshot의 event 수가 달랐다.

### 원인

event producer가 살아 있고 best-effort write가 in-flight인 상태에서 비교 기준 snapshot을 먼저 만들었다. 이후 shutdown drain에서 정상 commit된 event가 추가되면서, 코드가 정상적인 late commit을 restart 불일치로 판정했다.

### 해결 과정

1. 첫 PVP/PVE 직후 application producer를 먼저 중단했다.
2. 새 write 차단과 in-flight drain을 완료한 뒤 row count, privacy, duplicate와 snapshot을 측정했다.
3. 그 snapshot을 기준으로 backup/restore와 restart 동일성을 검증했다.
4. shutdown 결과도 exit 0, exit 1, exit 137, unexpected exit, OOMKilled와 남은 pool connection으로 구분하고 민감한 값 대신 안전 코드만 출력했다.

### 결과

최종 hosted PostgreSQL job은 event 26건, privacy 위반 0, duplicate ID 0, shutdown 뒤 pool connection 0과 restart/backup/restore 동일성을 확인하며 통과했다. 같은 main revision에서 네 CI job이 모두 green이 됐다.

### 배운 점

비동기 저장 검증에서는 측정 값보다 먼저 “어느 시점부터 상태가 고정됐는가”를 정의해야 한다. 종료 시점의 불변성을 확인하려면 producer 중단과 drain이 snapshot보다 앞서야 한다.

---

# 11. 포트폴리오 개선 제안

| 우선순위 | 제안 | 이유 |
| --- | --- | --- |
| ★★★★★ 매우 추천 | PVP 입력→server authoritative state→snapshot→prediction correction 시퀀스 다이어그램 | 이 프로젝트에서 가장 설명 가치가 높은 기술적 판단이다. 단순 구조도보다 rollback 해결을 한눈에 보여준다. |
| ★★★★★ 매우 추천 | 두 브라우저 PVP 화면 캡처 또는 20~30초 영상 | room 생성, 동시 board, garbage, match finish가 실제로 연결됐다는 증거가 된다. |
| ★★★★★ 매우 추천 | rollback 전후 비교 자료 | 증상 영상 또는 board fingerprint/log 일부와 sequence/ack 해결 흐름을 함께 제시하면 트러블 슈팅 설명력이 높다. |
| ★★★★★ 매우 추천 | AI benchmark 표/차트 | “ML을 붙였다”보다 V4를 기본값으로 올리지 않은 판단을 수치로 보여주는 편이 설득력이 높다. |
| ★★★★★ 매우 추천 | GitHub Actions 4-job 성공 화면과 검증 범위 | Fast, Browser, Docker, PostgreSQL을 어떤 실패 경계로 나눴는지 설명할 수 있다. |
| ★★★★★ 매우 추천 | PostgreSQL event lifecycle 다이어그램 | raw log→allowlist projector→canonical identity/hash→single-sink append→import/completeness와 shutdown drain을 한 장으로 보여준다. |
| ★★★★ 추천 | 아키텍처 전환 타임라인 | DOM state → Canvas/core 분리 → Socket room → server authoritative → PVE/ML → React/TypeScript/Docker/CI 순서를 6단계로 압축한다. |
| ★★★★ 추천 | session/reconnect 보안 표 | 위협, 대응, 남은 한계를 `token rotation / newest socket wins / CSP / in-memory limit`로 정리한다. |
| ★★★★ 추천 | 데이터 파이프라인 다이어그램 | JSONL/PostgreSQL 저장 경계에서 dataset, LOGO/temporal holdout, parity, summary까지 이어지는 흐름은 일반 게임 프로젝트와 구분되는 부분이다. |
| ★★★★ 추천 | Experimental V4 UI badge와 fallback 화면 | 모델을 과장하지 않고 정책과 provenance를 노출한 점을 보여준다. |
| ★★★★ 추천 | README 첫 화면에 “확인된 것/확인되지 않은 것” 요약 | Docker와 CI가 있다고 실제 cloud 배포까지 했다고 오해하지 않게 한다. |
| ★★★ 있으면 좋음 | 디렉토리 전체 트리 대신 핵심 12개 module만 강조한 그림 | 현재 파일 수가 많아 전체 tree는 면접관이 읽기 어렵다. |
| ★★★ 있으면 좋음 | 테스트 피라미드 표 | pure core, service/socket integration, browser E2E, artifact/release, Python parity를 층으로 구분한다. |
| ★★★ 있으면 좋음 | source-less Docker image 검증 캡처 | source와 dev tool이 없는 production 경계를 시각적으로 보강한다. |
| ★★★ 있으면 좋음 | 1분 시연 순서 | Single input → PVP room → PVE policy → CI/benchmark 순으로 준비하면 설명이 흔들리지 않는다. |

## 강조하면 좋은 기술

1. server-authoritative state와 client prediction을 함께 다룬 과정
2. 사람과 AI의 authoritative input 경로 통합
3. pure game core가 server/test/AI로 재사용된 구조
4. ML 모델을 production default로 올리지 않은 평가 기반 판단
5. migration/experiment harness로 Agent 작업 범위를 통제한 경험
6. source-less artifact, CSP, session rotation, Docker와 CI까지 연결한 release 경계
7. canonical event identity, PostgreSQL 멱등 저장과 graceful shutdown을 운영 실패 의미까지 설계한 경험

## 줄이거나 삭제하면 좋은 내용

- 기능 이름만 길게 나열한 설명
- “AI 기반”, “확장 가능한”, “실무 수준”처럼 근거 없이 넓은 표현
- 사용하지 않은 Redis, Kubernetes와 특정 cloud provider를 현재 기술 스택처럼 적는 내용
- PostgreSQL이 room/match 상태까지 영속화하거나 production에서 이미 활성화됐다는 표현
- V4가 heuristic보다 강하거나 사용자를 완전히 복제한다는 표현
- 50개 면접 질문 전체를 공개 포트폴리오 본문에 넣는 구성: 별도 면접 준비 문서로 두는 편이 읽기 좋다.

## 추가 확인이 필요한 항목

- 실제 GitHub URL
- 담당 역할의 본인 표현
- 공개 배포 여부와 URL
- branch protection의 required check 설정
- 실제 사용자 수·트래픽·운영 기간
- 프로젝트 화면 캡처와 데모 영상
- 개인 협업 경험과 회고

---

# 12. 근거 파일

| 주제 | 주요 근거 |
| --- | --- |
| 실행·기술 스택 | `package.json`, `.nvmrc`, `vite.config.mjs`, `tsconfig.*.json` |
| 전체 상태 | `README.md`, `PLAN.md`, `change-log.md` |
| client 구조 | `src/client/pages`, `src/client/game`, `src/client/net` |
| server 구조 | `src/server/init.ts`, `src/server/sockets`, `src/server/services` |
| protocol·보안 | `src/shared/socketContracts.mjs`, `src/server/socketSecurity.ts`, `src/server/httpSecurity.ts` |
| 저장 경계 | `src/server/services/runtimeEventStorage.ts`, `src/server/services/gameEventProjector.ts`, `src/server/repositories`, `src/server/db` |
| PostgreSQL 운영 | `docs/operations/database/database-event-storage-blueprint.md`, `docs/operations/deployment/postgres-production-runbook.md`, `migration-harness/runs/goal-09a-*`~`goal-09d-*` |
| AI/ML | `src/client/game/ai`, `scripts/ml`, `docs/placement-*`, `ai-harness/runs` |
| test | `test`, `test-integration`, `e2e`, `test-artifact`, `scripts/ml/tests` |
| Docker·CI | `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`, `scripts/run-postgres-tests.js`, `scripts/verify-postgres-production.sh` |
| migration 과정 | `migration-harness/goals`, `migration-harness/runs`, `docs/operations/history/goal-11-security-docker-ci-history.md` |

---

# 13. 면접 예상 질문

> 공개 포트폴리오에는 핵심 질문만 선별하고, 이 절은 면접 준비용으로 사용하는 편이 좋다.

## 프로젝트 개요

### Q1. 이 프로젝트를 한 문장으로 설명한다면 무엇인가요?

1. **질문**: 이 프로젝트를 한 문장으로 설명한다면 무엇인가요?
2. **면접관이 질문하는 이유**: 기능 목록이 아니라 개발자가 해결한 핵심 문제를 이해하고 있는지 확인하려는 질문이다.
3. **모범 답변**: 배열 기반 Tetris core를 싱글플레이에서 server-authoritative PVP/PVE까지 확장하고, 같은 규칙을 Canvas runtime, 서버, 휴리스틱 AI와 placement 데이터 분석에 재사용한 개인 프로젝트입니다. 특히 실시간 입력의 반응성과 서버 상태 일관성을 함께 다룬 것이 핵심입니다.
4. **추가 꼬리 질문**: 가장 중요한 기술적 문제 하나만 고른다면 무엇인가요?
5. **꼬리 질문에 대한 답변**: 서버 snapshot이 로컬 입력을 되감는 own-board rollback 문제입니다. 서버 권위를 유지하면서 `clientSequence`, acknowledgement와 제한적 correction으로 조작감을 보존해야 했기 때문입니다.

### Q2. 일반적인 Tetris 구현과 무엇이 다른가요?

1. **질문**: 일반적인 Tetris 구현과 무엇이 다른가요?
2. **면접관이 질문하는 이유**: 프로젝트의 차별점을 과장 없이 설명할 수 있는지 본다.
3. **모범 답변**: 게임 화면만 구현한 것이 아니라 규칙을 DOM에서 분리해 서버가 같은 core를 실행하도록 만들었습니다. 여기에 client prediction, reconnect session, authoritative PVE, placement 분석, Node↔Python parity와 PostgreSQL event storage까지 연결했습니다. 다만 production DB를 활성화한 상용 서비스나 강한 gameplay AI라고 주장하지는 않습니다.
4. **추가 꼬리 질문**: 포트폴리오에서 가장 먼저 보여줄 화면은 무엇인가요?
5. **꼬리 질문에 대한 답변**: 두 브라우저 PVP 화면과 input→server→snapshot 흐름을 함께 보여주겠습니다. 이 화면이 핵심 구조와 rollback 해결을 가장 직접적으로 설명합니다.

### Q3. 프로젝트 기간을 어떻게 산정했나요?

1. **질문**: 프로젝트 기간을 어떻게 산정했나요?
2. **면접관이 질문하는 이유**: 문서의 숫자가 실제 근거에 기반하는지 확인한다.
3. **모범 답변**: 최초 커밋부터 마지막 커밋까지의 달력 기간은 중간 공백이 길어 실제 작업량을 잘 보여주지 못했습니다. 그래서 상세 작업이 확인되는 2025-10-20부터 2026-07-24까지 커밋이 존재하는 고유 날짜를 합산해 주요 개발 활동 40일로 적었습니다. 2025-03-13의 최초 저장소 생성 커밋은 별도로 남기고 작업일에서는 제외했습니다.
4. **추가 꼬리 질문**: 커밋 수를 개발 성과로 사용했나요?
5. **꼬리 질문에 대한 답변**: 아닙니다. 커밋 개수가 아니라 커밋이 존재하는 고유 날짜만 기간 산정 근거로 사용했습니다. 커밋하지 않고 작업한 날짜는 확인할 수 있으므로 정확한 투입 공수라고 주장하지 않고, Git에서 확인 가능한 개발 활동일이라고 설명합니다.

## 기술 스택

### Q4. 왜 JavaScript 프로젝트를 TypeScript로 마이그레이션했나요?

1. **질문**: 왜 JavaScript 프로젝트를 TypeScript로 마이그레이션했나요?
2. **면접관이 질문하는 이유**: 유행을 따라 도입했는지, 실제 문제를 해결했는지 확인한다.
3. **모범 답변**: 멀티플레이가 추가되면서 board snapshot, room DTO, session과 AI dataset처럼 중첩 객체 계약이 커졌습니다. compile-time type으로 consumer mismatch를 줄일 필요가 있었고, client/server/test를 별도 strict 설정으로 나눠 동작을 보존하며 단계적으로 전환했습니다.
4. **추가 꼬리 질문**: TypeScript만 있으면 Zod가 필요 없지 않나요?
5. **꼬리 질문에 대한 답변**: TypeScript는 compile 뒤 사라지므로 browser에서 들어온 실제 payload를 보장하지 못합니다. 네트워크 trust boundary에는 Zod runtime validation이 필요하고, 타입은 그 schema에서 파생했습니다.

### Q5. 왜 React가 게임 상태 전체를 소유하지 않나요?

1. **질문**: 왜 React가 게임 상태 전체를 소유하지 않나요?
2. **면접관이 질문하는 이유**: framework와 domain runtime의 경계를 의식했는지 본다.
3. **모범 답변**: 이미 tick/input/Canvas 중심 runtime이 검증돼 있었고 16ms 입력 처리마다 board 전체를 React state로 옮길 이유가 없었습니다. React는 form, HUD, overlay와 lifecycle만 맡고, runtime이 gameplay state를 소유합니다. HUD에는 display bridge가 좁은 파생 snapshot만 제공합니다.
4. **추가 꼬리 질문**: 이 구조의 단점은 무엇인가요?
5. **꼬리 질문에 대한 답변**: React 외부 store와 runtime lifecycle을 직접 관리해야 합니다. 그래서 `subscribeDisplay()`, immutable snapshot과 idempotent `destroy()` 계약을 테스트했습니다.

### Q6. 왜 Express와 Socket.IO를 유지했나요?

1. **질문**: 왜 NestJS 같은 framework로 바꾸지 않고 Express와 Socket.IO를 유지했나요?
2. **면접관이 질문하는 이유**: 규모에 맞는 기술 선택을 했는지 확인한다.
3. **모범 답변**: 현재 HTTP 역할은 정적 artifact, 보안 header와 오류 응답 정도이고 핵심은 Socket event입니다. sockets/services/validators/repositories 경계로 책임을 나누면 현재 요구를 처리할 수 있어 더 큰 framework를 추가할 근거가 없었습니다.
4. **추가 꼬리 질문**: 언제 NestJS를 고려할 수 있나요?
5. **꼬리 질문에 대한 답변**: 인증, REST API, DB transaction, 여러 팀의 module ownership과 dependency injection 요구가 실제로 커져 현재 구조보다 framework가 복잡도를 줄일 때입니다.

### Q7. 왜 raw WebSocket 대신 Socket.IO를 썼나요?

1. **질문**: 왜 raw WebSocket 대신 Socket.IO를 썼나요?
2. **면접관이 질문하는 이유**: library가 제공하는 기능과 비용을 알고 있는지 본다.
3. **모범 답변**: 2인 room broadcast, reconnect와 event 기반 protocol을 직접 만들지 않고 game state 문제에 집중할 수 있었습니다. 대신 자동 reconnect send buffer, Origin, payload size와 session ownership은 명시적으로 통제했습니다.
4. **추가 꼬리 질문**: Socket.IO의 단점은 무엇인가요?
5. **꼬리 질문에 대한 답변**: raw WebSocket보다 protocol overhead와 library dependency가 있고, multi-instance에서는 adapter와 sticky session을 함께 설계해야 합니다.

### Q8. Python은 production에서 어떤 역할을 하나요?

1. **질문**: Python은 production에서 어떤 역할을 하나요?
2. **면접관이 질문하는 이유**: 기술 스택을 부풀리지 않고 runtime과 offline 도구를 구분하는지 본다.
3. **모범 답변**: production gameplay에는 Python이 없습니다. Python은 placement ranker의 reference 학습, temporal holdout, Notebook과 parity 분석에만 사용합니다. 게임 규칙과 raw feature는 JavaScript가 원천입니다.
4. **추가 꼬리 질문**: 왜 Python service로 분리하지 않았나요?
5. **꼬리 질문에 대한 답변**: online inference 요구가 없고 현재 model은 작은 linear scorer라 JavaScript로 실행할 수 있습니다. 별도 service는 latency와 운영 복잡도만 늘립니다.

## 아키텍처

### Q9. 이 프로젝트의 아키텍처를 어떤 형태라고 설명하겠습니까?

1. **질문**: 이 프로젝트의 아키텍처를 어떤 형태라고 설명하겠습니까?
2. **면접관이 질문하는 이유**: 구조를 이름만 붙이지 않고 실제 경계로 설명할 수 있는지 본다.
3. **모범 답변**: 하나의 Node process와 저장소를 사용하는 모듈형 monolith입니다. browser는 Vite MPA이고 server는 Socket handler, domain service, pure game core와 event repository로 나뉩니다. room/match는 memory에 있고 분석 이벤트만 JSONL 또는 PostgreSQL single-sink에 저장합니다.
4. **추가 꼬리 질문**: monolith의 장점은 무엇이었나요?
5. **꼬리 질문에 대한 답변**: game core와 Socket service를 같은 codebase에서 직접 공유하고, 배포·테스트 경계를 한 artifact로 유지할 수 있었습니다.

### Q10. Core, runtime, renderer는 어떻게 구분했나요?

1. **질문**: Core, runtime, renderer는 어떻게 구분했나요?
2. **면접관이 질문하는 이유**: 책임 분리가 실질적인지 확인한다.
3. **모범 답변**: core는 board와 piece를 받아 move/lock/attack 결과를 계산하고 DOM이나 timer를 사용하지 않습니다. runtime은 input queue, tick, state transition과 부수효과를 조율합니다. renderer는 받은 board와 piece를 Canvas에 그립니다.
4. **추가 꼬리 질문**: line-clear animation은 어디에 속하나요?
5. **꼬리 질문에 대한 답변**: 어떤 row가 지워지고 공격이 얼마인지는 core/server가 결정합니다. fragment 위치와 진행률처럼 표시용 계산은 renderer에 둡니다.

### Q11. `roomService`와 `matchService`를 왜 분리했나요?

1. **질문**: `roomService`와 `matchService`를 왜 분리했나요?
2. **면접관이 질문하는 이유**: domain state의 수명과 소유권을 이해하는지 본다.
3. **모범 답변**: room은 membership, host, waiting/playing/finished lifecycle을 소유합니다. match는 게임이 시작된 뒤 player별 bag과 authoritative gameplay state를 소유합니다. lobby로 돌아가도 room을 재사용할 수 있어 수명이 다릅니다.
4. **추가 꼬리 질문**: session은 왜 room에 저장하지 않나요?
5. **꼬리 질문에 대한 답변**: session credential과 room membership은 의미와 만료가 다릅니다. room은 membership의 단일 원천이고 session에는 token digest, generation과 active socket만 둡니다.

### Q12. `authoritativeTickerService`가 필요한 이유는 무엇인가요?

1. **질문**: `authoritativeTickerService`가 필요한 이유는 무엇인가요?
2. **면접관이 질문하는 이유**: 실시간 상태 진행을 handler에서 분리한 이유를 확인한다.
3. **모범 답변**: Socket input이 없어도 gravity와 AI action은 진행돼야 합니다. ticker service가 room별 100ms loop, player별 500ms gravity, AI cadence, presentation delay와 match finish를 조율합니다.
4. **추가 꼬리 질문**: 왜 player별 timing인가요?
5. **꼬리 질문에 대한 답변**: 한 player의 spawn, hold, lock이나 line clear가 다른 player의 gravity accumulator를 초기화하면 불공정하고 race가 생기기 때문입니다.

### Q13. 왜 player별 mutation queue를 만들었나요?

1. **질문**: 왜 player별 mutation queue를 만들었나요?
2. **면접관이 질문하는 이유**: race condition과 concurrency 경계를 이해하는지 본다.
3. **모범 답변**: 같은 player의 input과 gravity가 동시에 authoritative state를 변경하지 않게 FIFO로 직렬화했습니다. 서로 다른 player는 독립 queue라 한쪽의 지연이나 예외가 다른 쪽을 막지 않습니다.
4. **추가 꼬리 질문**: mutex library를 사용하지 않은 이유는 무엇인가요?
5. **꼬리 질문에 대한 답변**: 단일 Node process에서 player key별 Promise chain이면 필요한 순서를 보장할 수 있었습니다. 분산 lock이 필요한 구조가 아니었습니다.

## 데이터 흐름

### Q14. 키 입력 하나가 서버 상태에 반영되는 과정을 설명해 주세요.

1. **질문**: 키 입력 하나가 서버 상태에 반영되는 과정을 설명해 주세요.
2. **면접관이 질문하는 이유**: end-to-end 흐름을 실제 함수 경계로 이해하는지 본다.
3. **모범 답변**: keyboard event를 normalized action으로 바꾸고 local tick queue에서 먼저 처리합니다. local 적용이 성공하면 `clientSequence`, `pieceIndex`, `expectedTransform`과 함께 `game:input`을 보냅니다. server가 session/rate/schema/ownership을 검사한 뒤 player queue에서 shared core를 실행하고 result와 snapshot을 emit합니다.
4. **추가 꼬리 질문**: local 적용에 실패한 입력도 서버에 보내나요?
5. **꼬리 질문에 대한 답변**: 보내지 않습니다. 벽에 막힌 이동처럼 local runtime에서 적용되지 않은 action은 server traffic과 불필요한 divergence를 만들지 않게 제외합니다.

### Q15. 내 보드와 상대 보드는 snapshot을 다르게 처리하나요?

1. **질문**: 내 보드와 상대 보드는 snapshot을 다르게 처리하나요?
2. **면접관이 질문하는 이유**: prediction 모델을 이해하는지 확인한다.
3. **모범 답변**: 상대 보드는 client가 예측할 입력이 없으므로 authoritative snapshot을 full apply합니다. 내 보드는 입력 반응성을 위해 local prediction을 우선하고 game over, garbage apply, 큰 piece gap이나 settled board mismatch 같은 경우만 correction합니다.
4. **추가 꼬리 질문**: active piece 위치가 다르면 왜 바로 보정하지 않나요?
5. **꼬리 질문에 대한 답변**: network delay 중에는 local active piece가 server보다 앞서는 것이 정상입니다. 매번 덮으면 입력이 되감기므로 active transform보다 acknowledgement와 settled board를 중심으로 봅니다.

### Q16. Garbage 데이터는 어떤 흐름으로 처리되나요?

1. **질문**: Garbage 데이터는 어떤 흐름으로 처리되나요?
2. **면접관이 질문하는 이유**: gameplay rule과 네트워크 state의 연결을 확인한다.
3. **모범 답변**: server lock 결과가 lines, T-Spin, combo와 B2B로 raw attack을 계산합니다. 내 pending garbage와 먼저 상쇄하고 남은 공격을 상대 authoritative pending queue에 추가합니다. client에는 표시용 `pendingGarbageLines`를 내려주고 실제 board 적용은 server lock 경로가 합니다.
4. **추가 꼬리 질문**: client가 garbage attack 수를 보내지 않는 이유는 무엇인가요?
5. **꼬리 질문에 대한 답변**: 공격량은 승패에 영향을 주는 게임 규칙이라 client 값을 신뢰하면 조작과 불일치가 생깁니다. server lock 결과만 원천으로 사용합니다.

### Q17. Placement log가 dataset이 되는 과정을 설명해 주세요.

1. **질문**: Placement log가 dataset이 되는 과정을 설명해 주세요.
2. **면접관이 질문하는 이유**: 수집 데이터와 학습 sample 사이의 계약을 이해하는지 본다.
3. **모범 답변**: authoritative placement commit을 확인한 뒤 boardBefore, 선택 placement, 결과와 lineage를 선택된 sink에 저장합니다. dataset 경로에서는 JSONL exporter가 같은 시작 상태에서 reachable 후보를 다시 생성하고 각 후보의 metric delta와 label을 만듭니다. decision을 gameId/playerId/pieceIndex로 묶고 gameId 기준으로 split합니다. PostgreSQL import도 같은 projector와 identity를 재사용합니다.
4. **추가 꼬리 질문**: 왜 candidate row를 random split하지 않았나요?
5. **꼬리 질문에 대한 답변**: 같은 decision과 game의 후보가 train과 validation에 나뉘면 board 문맥이 누수됩니다. 그래서 game 단위 split과 LOGO/temporal holdout을 사용했습니다.

## 디렉토리 구조

### Q18. `src/client/game/core`를 `shared`에 두지 않은 이유는 무엇인가요?

1. **질문**: server도 쓰는 game core가 왜 `src/shared`가 아니라 client 아래에 있나요?
2. **면접관이 질문하는 이유**: 현재 구조의 역사와 한계를 솔직히 설명하는지 본다.
3. **모범 답변**: client Tetris 엔진에서 출발해 pure core를 분리한 뒤 server가 compile artifact로 재사용한 구조입니다. 현재는 DOM-free라 실질적으로 공유되지만, 경로 이동 자체가 gameplay value를 만들지 않아 migration 중에는 보존했습니다.
4. **추가 꼬리 질문**: 언제 `shared`로 옮길 건가요?
5. **꼬리 질문에 대한 답변**: import ownership이 반복적으로 혼란을 만들거나 server/client가 동등한 소비자가 돼 경로가 유지보수 문제로 확인될 때 별도 refactor로 옮기겠습니다.

### Q19. `entry`, `runtime`, `ui`가 모두 필요한가요?

1. **질문**: `entry`, `runtime`, `ui`가 모두 필요한가요?
2. **면접관이 질문하는 이유**: 과도한 분리인지 의미 있는 경계인지 묻는다.
3. **모범 답변**: `entry`는 page bootstrap과 session cleanup, `runtime`은 tick/input/state orchestration, `ui`는 Canvas/DOM renderer 호출 adapter를 담당합니다. 단순 전달 wrapper는 만들지 않았고 lifecycle이나 부수효과가 있는 경계만 남겼습니다.
4. **추가 꼬리 질문**: 더 합칠 수 있는 부분은 없나요?
5. **꼬리 질문에 대한 답변**: 실제 중복이나 탐색 비용이 확인되면 얇은 파일은 합칠 수 있습니다. 지금은 `multiplayerGameSession`이 network disposer를 한 곳에 모으는 실질 책임이 있어 유지합니다.

### Q20. `test`, `e2e`, `test-artifact`, `scripts/ml/tests`를 왜 나눴나요?

1. **질문**: 테스트 디렉토리가 여러 개인 이유는 무엇인가요?
2. **면접관이 질문하는 이유**: 테스트 종류별 목적과 비용을 이해하는지 본다.
3. **모범 답변**: `test`는 빠른 compiled Node 회귀, `e2e`는 실제 browser/Socket/Canvas, `test-artifact`는 source 없는 production 경계, `scripts/ml/tests`는 ML parity와 summarizer 계약을 담당합니다. 한 runner로 섞으면 환경과 실패 원인이 불명확해집니다.
4. **추가 꼬리 질문**: CI에서 Python test를 왜 required로 돌리지 않나요?
5. **꼬리 질문에 대한 답변**: Conda 설치 비용과 별도 action 공급망 검토가 필요해 현재 required CI에서는 제외했습니다. ML 변경 때는 `verify:ml`로 별도 실행합니다.

## 주요 기능

### Q21. SRS 계열 wall kick은 어떻게 구현했나요?

1. **질문**: 회전 충돌 시 wall kick은 어떻게 처리하나요?
2. **면접관이 질문하는 이유**: 게임 규칙의 구체적 경계 처리를 확인한다.
3. **모범 답변**: 회전한 `pendingPiece`가 충돌하면 piece 종류와 `from→to` rotation key로 kick offset 목록을 순서대로 검사합니다. 처음 배치 가능한 offset을 결과로 사용하고 모두 실패하면 기존 active state로 retry합니다.
4. **추가 꼬리 질문**: renderer가 kick을 판단하나요?
5. **꼬리 질문에 대한 답변**: 아닙니다. `step.ts`의 pure move resolution이 판단하고 renderer는 확정 위치만 그립니다.

### Q22. 7-bag은 client와 server 중 누가 소유하나요?

1. **질문**: 멀티플레이 조각 공급은 누가 소유하나요?
2. **면접관이 질문하는 이유**: 랜덤성과 authoritative state 경계를 확인한다.
3. **모범 답변**: 싱글은 local queue가 소유하고 멀티는 server가 player별 bag chunk를 만듭니다. match state에 bag chunk와 flattened queue를 두고 client는 받은 queue를 표시·예측에 사용합니다.
4. **추가 꼬리 질문**: 완전 deterministic seed를 쓰지 않은 이유는 무엇인가요?
5. **꼬리 질문에 대한 답변**: 현재 MVP는 server bag으로 공정한 공급과 복구를 충분히 검증할 수 있었습니다. server/client 완전 replay는 아직 구현되지 않았고 필요 없이 복잡도를 올리지 않았습니다.

### Q23. AI가 실제로 도달 가능한 placement만 고르는 방법은 무엇인가요?

1. **질문**: AI가 좌표만 계산하지 않고 reachable placement를 어떻게 보장하나요?
2. **면접관이 질문하는 이유**: simulation과 실제 실행의 차이를 이해하는지 본다.
3. **모범 답변**: 현재 active piece에서 move_left/right, rotate, soft_drop을 정해진 순서로 탐색하고 state key로 중복을 제거합니다. 각 도달 상태에서 hard drop placement와 action path를 저장합니다. 선택한 action을 authoritative core에 replay하는 테스트도 있습니다.
4. **추가 꼬리 질문**: 이 방식의 비용은 어느 정도인가요?
5. **꼬리 질문에 대한 답변**: 20×10 board와 한 조각 상태 공간에서는 현재 100ms AI cadence에 사용할 수 있었습니다. 동시 room이 커지면 profile이 필요하지만 아직 병목 근거는 없습니다.

### Q24. Normal과 Hard AI의 차이는 무엇인가요?

1. **질문**: PVE 난이도는 판단 quality가 다른가요?
2. **면접관이 질문하는 이유**: UI 이름과 실제 코드 의미가 일치하는지 확인한다.
3. **모범 답변**: 현재 heuristic 평가 함수 자체는 공유합니다. Normal은 terminal hard drop 전에 최대 5회의 soft drop을 보여주고 Hard는 더 빠르게 terminal action을 실행합니다. 즉 주 차이는 action cadence와 표현이며 별도 강한 search depth를 주장하지 않습니다.
4. **추가 꼬리 질문**: 더 명확한 난이도를 만들려면 어떻게 하겠습니까?
5. **꼬리 질문에 대한 답변**: heuristic weight, lookahead 또는 의도적 suboptimal choice를 평가 계약과 함께 분리해야 합니다. UI 이름만 바꾸지 않고 실제 승률·생존 지표로 검증하겠습니다.

### Q25. Experimental V4가 실패하면 게임은 어떻게 되나요?

1. **질문**: V4 model 파일이나 inference에 문제가 생기면 어떻게 되나요?
2. **면접관이 질문하는 이유**: ML failure가 product availability에 미치는 영향을 고려했는지 본다.
3. **모범 답변**: model file을 읽고 SHA-256, schema, scaler와 finite score를 검증합니다. 누락·손상·adapter/scorer 오류가 있으면 기존 heuristic decision으로 fallback하고 policy requested/used, fallback reason과 model hash를 evidence로 남깁니다.
4. **추가 꼬리 질문**: silent fallback의 단점은 무엇인가요?
5. **꼬리 질문에 대한 답변**: 사용자가 experimental 기능이 실제로 실행되지 않았다는 사실을 모를 수 있습니다. 그래서 UI/runtime policy event와 game log에 실제 policy와 fallback reason을 노출합니다.

### Q26. line-clear presentation과 game state를 왜 분리했나요?

1. **질문**: 상대 line-clear animation을 snapshot에 어떻게 넣었나요?
2. **면접관이 질문하는 이유**: 일회성 UI effect와 authoritative state를 구분하는지 본다.
3. **모범 답변**: server lock 결과에서 row와 `boardBeforeClear`를 가진 presentation effect를 만들되 authoritative board는 이미 line clear 후 상태입니다. client는 effect를 렌더링하지만 gameplay state나 gravity를 다시 변경하지 않습니다.
4. **추가 꼬리 질문**: snapshot coalescing을 하면 어떤 위험이 있나요?
5. **꼬리 질문에 대한 답변**: 일반 snapshot에 섞어 마지막 값만 남기면 일회성 effect가 사라질 수 있습니다. 최적화 시 effect/lock/gameOver는 즉시 전송하거나 별도 event semantics를 보존해야 합니다.

## 기술적 의사결정

### Q27. 왜 client-authoritative snapshot relay를 버렸나요?

1. **질문**: 초기 client snapshot relay 구조를 server-authoritative로 바꾼 이유는 무엇인가요?
2. **면접관이 질문하는 이유**: 아키텍처 전환의 실제 문제와 비용을 설명할 수 있는지 본다.
3. **모범 답변**: client가 만든 board와 game over를 server가 중계하면 잘못된 payload나 client 차이로 승패와 공격이 달라질 수 있었습니다. server가 input과 gravity를 같은 core로 실행해 final state를 하나로 만들었습니다.
4. **추가 꼬리 질문**: 전환 비용은 무엇이었나요?
5. **꼬리 질문에 대한 답변**: server에 player state, bag, ticker와 game core load 경로가 필요해졌고, client prediction과 correction 문제도 새로 해결해야 했습니다.

### Q28. 왜 모든 server snapshot을 즉시 적용하지 않았나요?

1. **질문**: server가 권위라면 snapshot을 항상 덮는 것이 맞지 않나요?
2. **면접관이 질문하는 이유**: consistency와 responsiveness의 trade-off를 이해하는지 본다.
3. **모범 답변**: server snapshot은 network delay만큼 과거 상태일 수 있습니다. 자기 board에 매번 적용하면 정상적인 최신 입력이 되감깁니다. final authority는 유지하되 ack와 settled state 기준으로 correction 시점을 제한했습니다.
4. **추가 꼬리 질문**: 그러면 client가 계속 틀린 상태로 남을 수 있지 않나요?
5. **꼬리 질문에 대한 답변**: game over, garbage 적용, 2 이상 piece gap, persistent 1-piece gap과 settled board mismatch는 correction합니다. convergence를 E2E에서 연속 snapshot으로 확인합니다.

### Q29. 왜 MPA를 유지하고 SPA를 보류했나요?

1. **질문**: React를 도입했는데 왜 SPA로 전환하지 않았나요?
2. **면접관이 질문하는 이유**: framework 도입과 routing을 자동으로 묶지 않았는지 본다.
3. **모범 답변**: 현재 page는 index, lobby, single, multiplayer로 수명 경계가 명확합니다. SPA 전환은 sound continuity에는 장점이 있지만 Socket subscription, runtime cleanup, BFCache와 reconnect 범위를 키웠습니다. Goal 7A에서 비용이 이득보다 크다고 보고 보류했습니다.
4. **추가 꼬리 질문**: SPA 재개 조건은 무엇인가요?
5. **꼬리 질문에 대한 답변**: route 간 공유 UI/상태가 늘고 full reload가 실제 UX 문제로 확인되며, lifecycle test와 rollback 계획을 마련했을 때입니다.

### Q30. 왜 PostgreSQL에는 분석 이벤트만 저장하나요?

1. **질문**: PostgreSQL을 도입했는데 왜 room, session과 match state는 여전히 memory에 있나요?
2. **면접관이 질문하는 이유**: 데이터의 수명과 접근 특성에 따라 저장 기술을 구분했는지 본다.
3. **모범 답변**: PostgreSQL 도입 목적은 container 수명과 분석 이벤트 보존을 분리하고 중복·완전성을 SQL로 확인하는 것이었습니다. room과 match는 100ms ticker와 player별 mutation 순서가 중요한 짧은 수명의 상태라 현재 단일 instance에서는 memory가 단순합니다. event DB를 넣었다고 실시간 상태 문제까지 해결됐다고 보지 않았습니다.
4. **추가 꼬리 질문**: DB가 있는데도 남는 가장 큰 한계는 무엇인가요?
5. **꼬리 질문에 대한 답변**: server restart 시 session과 진행 중 room/match가 사라지고 multi-instance state를 공유할 수 없습니다. 필요해지면 match ownership, Socket.IO adapter와 shared ephemeral store를 별도로 설계해야 합니다.

### Q31. 왜 V4를 default AI로 올리지 않았나요?

1. **질문**: ML model까지 만들었는데 왜 heuristic을 기본값으로 유지했나요?
2. **면접관이 질문하는 이유**: ML 결과를 비판적으로 해석하는지 본다.
3. **모범 답변**: V4는 human placement imitation 목표에서는 의미가 있었지만 30×500 gameplay benchmark에서 세 stream만 먼저 game over됐고 holes와 height도 더 나빴습니다. imitation과 gameplay strength가 다르므로 experimental option으로만 유지했습니다.
4. **추가 꼬리 질문**: V4 실험은 실패였나요?
5. **꼬리 질문에 대한 답변**: 목표에 따라 다릅니다. human 선택 모방과 재현 가능한 inference 경로는 유효했지만 gameplay replacement 후보로는 준비되지 않았다는 결론입니다.

### Q32. 왜 하네스와 Goal 문서를 코드 저장소에 넣었나요?

1. **질문**: `ai-harness`와 `migration-harness`가 필요한 이유는 무엇인가요?
2. **면접관이 질문하는 이유**: Agent 사용이 단순 자동 생성인지 engineering process인지 확인한다.
3. **모범 답변**: 긴 prompt마다 규칙이 달라지고 agent가 다음 단계까지 확장하는 문제가 있었습니다. 현재 Goal, 선행조건, 금지 범위, 검증과 rollback을 저장소에 versioning해 사람과 agent가 같은 계약을 읽게 했습니다.
4. **추가 꼬리 질문**: 문서가 너무 많아지는 문제는 없나요?
5. **꼬리 질문에 대한 답변**: 있습니다. 그래서 현재 Goal 파일 하나만 읽고, 완료된 실험은 archive하며 동적 상태는 `PLAN.md`와 run 기록에만 둡니다.

## 유지보수

### Q33. 상태의 단일 진실 원천을 어떻게 유지했나요?

1. **질문**: 동일한 상태가 client, React, server에 중복되지 않나요?
2. **면접관이 질문하는 이유**: distributed UI에서 state ownership을 이해하는지 본다.
3. **모범 답변**: PVP/PVE final gameplay는 server authoritative state, room membership은 room service, credential은 session service가 원천입니다. React에는 raw board나 token을 저장하지 않고 runtime의 HUD 파생값만 둡니다. client prediction은 임시 표현이지 final source가 아닙니다.
4. **추가 꼬리 질문**: `pendingGarbageLines`는 중복 상태 아닌가요?
5. **꼬리 질문에 대한 답변**: server pending queue가 원천이고 client scalar는 표시용 파생값입니다. 실제 garbage board 적용은 server만 합니다.

### Q34. 큰 파일인 `tetris.ts`를 왜 더 쪼개지 않았나요?

1. **질문**: `tetris.ts`가 큰데 리팩토링이 덜 된 것 아닌가요?
2. **면접관이 질문하는 이유**: 파일 크기와 책임 분리를 구분하는지 본다.
3. **모범 답변**: 큰 orchestration 파일이라는 한계는 인정합니다. 다만 단순 길이 때문에 manager/interface를 추가하지 않고, pure rule, input, sound, snapshot correction, display bridge처럼 독립 책임과 테스트가 확인된 부분부터 분리했습니다.
4. **추가 꼬리 질문**: 다음에 무엇을 분리하겠습니까?
5. **꼬리 질문에 대한 답변**: 변경 충돌이나 독립 테스트 곤란이 반복되는 lock/placement-log orchestration부터 검토하겠습니다. 재현된 유지보수 비용이 기준입니다.

### Q35. Public DTO mapper가 왜 필요한가요?

1. **질문**: room object를 그대로 emit하지 않고 DTO를 만드는 이유는 무엇인가요?
2. **면접관이 질문하는 이유**: 정보 노출과 내부 모델 결합을 고려했는지 본다.
3. **모범 답변**: 내부 room/session에 field가 추가됐을 때 token digest, generation이나 socketId가 자동 노출되면 안 됩니다. whitelist mapper가 public player/room field만 복사하고 모든 room result/broadcast에 공통 적용됩니다.
4. **추가 꼬리 질문**: TypeScript private type만으로 충분하지 않나요?
5. **꼬리 질문에 대한 답변**: runtime object 직렬화에는 type이 강제되지 않습니다. 실제 DTO mapping과 Zod S2C schema가 필요합니다.

## 확장성

### Q36. 동시 사용자가 늘면 가장 먼저 병목이 될 부분은 어디인가요?

1. **질문**: 이 구조에서 scale bottleneck은 무엇이라고 보나요?
2. **면접관이 질문하는 이유**: 현재 한계와 개선 순서를 현실적으로 보는지 확인한다.
3. **모범 답변**: 입력 성공마다 full board snapshot을 serialize/broadcast하고, 각 room ticker와 AI search가 단일 Node process에서 실행되는 부분입니다. 다만 실제 부하 측정은 없어 추정만으로 최적화하지 않았습니다.
4. **추가 꼬리 질문**: 첫 최적화는 무엇인가요?
5. **꼬리 질문에 대한 답변**: profile 뒤 일반 movement snapshot을 trailing coalescing하고 input ack는 작게 유지하겠습니다. lock, garbage, effect와 game over는 즉시 전송합니다.

### Q37. 다중 서버 instance로 확장하려면 무엇이 필요한가요?

1. **질문**: 서버를 두 대로 늘리면 현재 코드가 동작하나요?
2. **면접관이 질문하는 이유**: in-memory state와 WebSocket routing 한계를 이해하는지 본다.
3. **모범 답변**: 그대로는 동작하지 않습니다. room/match/session map이 instance별로 나뉩니다. Socket.IO sticky session 또는 session affinity, shared adapter와 상태 저장소, match ownership 정책을 함께 설계해야 합니다.
4. **추가 꼬리 질문**: PostgreSQL 하나면 충분한가요?
5. **꼬리 질문에 대한 답변**: 전적·계정에는 적합하지만 100ms realtime room fan-out과 ephemeral session까지 모두 해결하지는 않습니다. Redis 계열 shared adapter나 match process ownership을 별도로 판단해야 합니다.

### Q38. JSONL 로그는 어느 시점까지 적절한가요?

1. **질문**: JSONL을 계속 사용할 수 있는 한계는 어디인가요?
2. **면접관이 질문하는 이유**: 단순 저장 방식의 trade-off를 이해하는지 본다.
3. **모범 답변**: single writer, local 개발과 batch export에는 여전히 적절합니다. 중앙 query, index, 동시 접근, retention과 container 수명 밖 보존이 필요해져 PostgreSQL 경로를 추가했습니다. runtime에서는 둘을 동시에 쓰지 않고 환경별 single-sink로 선택합니다.
4. **추가 꼬리 질문**: production PostgreSQL로 전환할 때 어떤 단계를 거치겠습니까?
5. **꼬리 질문에 대한 답변**: provider/TLS/role/backup을 먼저 검증하고 migration을 재실행한 뒤, JSONL import의 checksum과 completeness를 확인합니다. 별도 승인 후 PostgreSQL single-sink로 cutover하고 JSONL은 명시적 rollback 경로로 보존합니다.

## 보안

### Q39. client가 playerId를 조작하면 다른 사용자를 제어할 수 있나요?

1. **질문**: Socket payload의 playerId를 바꾸면 어떻게 되나요?
2. **면접관이 질문하는 이유**: 인증과 payload identity를 구분했는지 본다.
3. **모범 답변**: mutation identity는 payload가 아니라 인증된 active socket session에서 파생합니다. room ownership도 server membership으로 다시 확인합니다. legacy playerId-only 권한 경로는 제거했습니다.
4. **추가 꼬리 질문**: AI player에게 input을 보낼 수 있나요?
5. **꼬리 질문에 대한 답변**: human session과 room의 human membership을 확인해 AI player state를 client가 직접 제어하지 못하게 합니다.

### Q40. Session token을 어떻게 저장하고 회전하나요?

1. **질문**: session credential 설계를 설명해 주세요.
2. **면접관이 질문하는 이유**: replay, duplicate tab과 storage risk를 이해하는지 본다.
3. **모범 답변**: server가 256-bit opaque token을 발급하고 SHA-256 digest만 memory에 저장합니다. browser는 versioned sessionStorage credential을 보관하며 resume마다 token과 generation을 회전합니다. newest socket wins로 이전 socket을 끊습니다.
4. **추가 꼬리 질문**: sessionStorage는 안전한가요?
5. **꼬리 질문에 대한 답변**: HttpOnly cookie보다 XSS에 취약합니다. 현재는 CSP와 token 비노출을 보강했지만, 공개 계정 인증으로 확장할 때 cookie/CSRF/TLS를 포함해 다시 설계해야 합니다.

### Q41. CSP는 어떻게 적용했고 어떤 문제가 있었나요?

1. **질문**: CSP를 적용한 방식과 검증 과정을 설명해 주세요.
2. **면접관이 질문하는 이유**: header를 추가하는 데서 끝나지 않고 실제 violation을 다뤘는지 본다.
3. **모범 답변**: `default-src 'none'`에서 필요한 source만 열고 먼저 report-only로 browser violation을 수집한 뒤 enforce로 전환했습니다. theme pre-paint inline script는 `unsafe-inline` 대신 SHA-256 hash를 사용했고 Zod eval probe는 jitless 설정으로 막았습니다.
4. **추가 꼬리 질문**: HSTS가 없는 이유는 무엇인가요?
5. **꼬리 질문에 대한 답변**: 실제 HTTPS termination과 공개 hostname이 정해지지 않았기 때문입니다. HSTS는 reverse proxy/TLS 배포와 함께 결정해야 합니다.

### Q42. Rate limit은 어떤 기준으로 나눴나요?

1. **질문**: Socket rate limit을 하나의 공통 bucket으로 만들지 않은 이유는 무엇인가요?
2. **면접관이 질문하는 이유**: abuse 경로별 특성을 고려했는지 본다.
3. **모범 답변**: 신규 session, invalid resume, lifecycle, input, bag, chat, placement log의 비용과 정상 빈도가 다릅니다. 독립 in-memory bucket을 사용하고 production/test profile을 분리했습니다.
4. **추가 꼬리 질문**: 분산 환경에서도 안전한가요?
5. **꼬리 질문에 대한 답변**: 아닙니다. process-local limiter라 여러 instance에서는 우회될 수 있습니다. 공개 scale-out 전에 shared limiter와 trusted proxy 정책이 필요합니다.

## 테스트

### Q43. 테스트 전략을 어떻게 구성했나요?

1. **질문**: 이 프로젝트의 테스트 전략을 설명해 주세요.
2. **면접관이 질문하는 이유**: test 수가 아니라 각 계층의 품질 질문을 이해하는지 본다.
3. **모범 답변**: pure core와 service는 `node:test`, 실제 Socket/Canvas/React는 Playwright, compiled artifact와 source-less release는 별도 artifact test, ML은 Python unittest와 Node↔Python parity로 나눴습니다.
4. **추가 꼬리 질문**: 가장 가치가 높았던 테스트는 무엇인가요?
5. **꼬리 질문에 대한 답변**: 두 context rollback E2E입니다. 단순 함수 결과가 아니라 실제 outgoing input, 양쪽 board convergence와 재롤백 부재를 검증했습니다.

### Q44. Canvas 게임을 E2E에서 어떻게 검증했나요?

1. **질문**: DOM text가 아닌 Canvas 동작을 어떻게 테스트했나요?
2. **면접관이 질문하는 이유**: 화면 테스트가 실제 결과를 관찰하는지 확인한다.
3. **모범 답변**: test 전용 고정 RNG와 Playwright clock으로 조건을 통제하고, 키 호출 성공이 아니라 Canvas pixel/cell 좌표, score, authoritative snapshot과 board fingerprint 변화를 확인했습니다.
4. **추가 꼬리 질문**: screenshot diff를 쓰지 않은 이유는 무엇인가요?
5. **꼬리 질문에 대한 답변**: 현재 핵심은 스타일 전체보다 cell 위치와 game state입니다. pixel 전체 diff보다 의미 있는 board fingerprint와 좌표가 flake와 원인 분석에 유리했습니다.

### Q45. Production artifact를 왜 별도로 테스트하나요?

1. **질문**: unit/E2E가 있는데 artifact test가 추가로 필요한 이유는 무엇인가요?
2. **면접관이 질문하는 이유**: build와 runtime 경계를 이해하는지 본다.
3. **모범 답변**: source에서는 통과해도 compiled import extension, model asset 복사, source map 노출이나 devDependency 의존으로 production이 실패할 수 있습니다. clean build allowlist와 source-less release에서 HTTP/PVP/PVE/V4를 직접 실행합니다.
4. **추가 꼬리 질문**: `npm start`가 build를 자동으로 하지 않는 이유는 무엇인가요?
5. **꼬리 질문에 대한 답변**: release artifact가 미리 검증됐다는 경계를 유지하기 위해서입니다. startup 때 build하면 dev tool과 source에 암묵적으로 의존하고 배포 재현성이 낮아집니다.

### Q46. 현재 테스트의 한계는 무엇인가요?

1. **질문**: 테스트가 많아도 놓치는 부분은 무엇인가요?
2. **면접관이 질문하는 이유**: 검증 결과를 과신하지 않는지 본다.
3. **모범 답변**: Playwright는 Chromium desktop과 worker 1 중심입니다. packet loss, 높은 latency, WebKit/Firefox, mobile device, 장시간 soak와 실제 외부 TLS/reverse proxy는 확인되지 않았습니다. PostgreSQL도 local/hosted 합성 환경은 검증했지만 managed provider와 운영 데이터는 확인하지 않았습니다.
4. **추가 꼬리 질문**: 다음 테스트 하나만 추가한다면 무엇인가요?
5. **꼬리 질문에 대한 답변**: pending input 중 transport reconnect와 jitter를 결합한 PVP convergence 테스트를 우선하겠습니다.

## 향후 개선점

### Q47. 지금 가장 먼저 개선할 부분은 무엇인가요?

1. **질문**: 새 기능이 아니라 현재 구조에서 가장 먼저 할 일은 무엇인가요?
2. **면접관이 질문하는 이유**: 우선순위 판단과 운영 감각을 확인한다.
3. **모범 답변**: 네 CI job은 green이므로 다음은 OCI read-only preflight와 JSONL 기반 HTTPS 기준선 배포입니다. PostgreSQL provisioning, 실제 JSONL import와 cutover는 각각 별도 승인으로 분리하겠습니다.
4. **추가 꼬리 질문**: 왜 PostgreSQL부터 바로 켜지 않나요?
5. **꼬리 질문에 대한 답변**: 합성 Docker gate와 실제 provider 운영은 다릅니다. 먼저 app·network·TLS·rollback 기준선을 만들고, DB credential·CA·backup/restore와 import 완전성을 확인해야 장애 원인을 분리할 수 있습니다.

### Q48. LLM coaching을 붙인다면 어떻게 시작하겠나요?

1. **질문**: 향후 LLM coaching 기능을 어떻게 설계하겠나요?
2. **면접관이 질문하는 이유**: LLM을 어디에 사용하고 어디에는 사용하지 않을지 판단하는지 본다.
3. **모범 답변**: LLM이 placement를 결정하게 하지 않고, 현재 log와 heuristic/model 비교에서 만든 요약 통계와 주요 실수 장면을 자연어로 설명하게 하겠습니다. 입력 schema, 개인정보, cost와 fallback을 먼저 정해야 합니다.
4. **추가 꼬리 질문**: 원본 게임 로그를 그대로 넣지 않는 이유는 무엇인가요?
5. **꼬리 질문에 대한 답변**: token과 처리 시간이 커지고 일관된 계산을 LLM에 맡기게 됩니다. 프로그램이 지표를 계산·검증하고 LLM은 설명에 집중하는 편이 재현성과 비용에 유리합니다.

## 트러블 슈팅

### Q49. Own-board rollback의 root cause는 무엇이었나요?

1. **질문**: rollback 문제의 root cause를 한 문장으로 설명해 주세요.
2. **면접관이 질문하는 이유**: 증상과 원인을 구분하는지 본다.
3. **모범 답변**: local prediction보다 늦은 authoritative snapshot을 input 처리 완료 경계 없이 own board에 적용해 최신 입력을 과거 상태로 덮은 것이 핵심이었습니다. 여기에 input/gravity timing 차이가 divergence를 키웠습니다.
4. **추가 꼬리 질문**: 한 군데 guard만 추가하면 되지 않았나요?
5. **꼬리 질문에 대한 답변**: snapshot guard만으로는 server 처리 순서와 lock timing이 어긋난 상태가 남습니다. sequence ack, expected transform, player queue와 gravity alignment를 같은 흐름에서 고쳤습니다.

### Q50. Agent가 과도하게 작업한 경험에서 무엇을 바꿨나요?

1. **질문**: AI agent 사용 중 가장 큰 실패 경험은 무엇인가요?
2. **면접관이 질문하는 이유**: 도구를 비판적으로 사용하고 process를 개선했는지 본다.
3. **모범 답변**: server-authoritative 작업에 목적 없는 “진행해” prompt를 보내고 자리를 비워 agent가 과도한 실험 단계를 확장한 경험입니다. 이후 current Goal 하나, 금지 범위, full-run 승인과 merge gate를 문서화했습니다.
4. **추가 꼬리 질문**: Agent를 덜 쓰는 것이 답 아닌가요?
5. **꼬리 질문에 대한 답변**: 사용량보다 역할이 문제였습니다. 반복 조사와 구현은 활용하되, 목표 정의·중단·정책 판단은 사람이 소유하도록 바꿨습니다.

### Q51. ML 분석 시간을 어떻게 줄였나요?

1. **질문**: 큰 ML report를 처리하는 시간을 어떻게 줄였나요?
2. **면접관이 질문하는 이유**: LLM 비용과 데이터 처리의 역할 분담을 이해하는지 본다.
3. **모범 답변**: Agent에게 raw report 전체를 읽히는 대신 Python summarizer가 checksum, cohort, leakage, finite metric과 핵심 결과를 재검증해 compact JSON/Markdown을 만들게 했습니다. full run과 analyze mode도 분리했습니다.
4. **추가 꼬리 질문**: 요약 과정에서 정보가 손실될 위험은 없나요?
5. **꼬리 질문에 대한 답변**: 있습니다. 그래서 요약은 정책 판단에 필요한 고정 계약만 담고 원본 report와 Notebook hash를 evidence로 보존합니다. 새로운 질문이 생기면 원본을 선택적으로 봅니다.

### Q52. Docker 검증에서 발생한 shell 문제를 어떻게 해결했나요?

1. **질문**: Docker CI 준비 중 기억에 남는 운영 문제는 무엇인가요?
2. **면접관이 질문하는 이유**: 작은 환경 차이를 추적하고 안전하게 정리했는지 본다.
3. **모범 답변**: zsh에서 `path`라는 loop 변수를 써 특수 PATH 배열을 덮어썼고 cleanup trap도 `docker`를 못 찾아 container가 남았습니다. 해당 Goal 자원만 식별해 제거하고 CI와 같은 bash로 재실행했습니다.
4. **추가 꼬리 질문**: 이후 어떤 규칙을 적용했나요?
5. **꼬리 질문에 대한 답변**: system option과 충돌할 일반 변수명을 피하고, shell을 명시하며, cleanup target은 run ID 기반 이름으로 좁히고 broad delete를 사용하지 않습니다.

### Q53. PostgreSQL event identity를 어떻게 정의했나요?

1. **질문**: 이벤트의 중복과 충돌을 어떤 기준으로 구분하나요?
2. **면접관이 질문하는 이유**: 멱등성이라는 용어보다 실제 identity 계약을 설명할 수 있는지 본다.
3. **모범 답변**: lifecycle은 event type과 gameId, placement는 event type·gameId·playerId·pieceIndex를 `identity-v1` tuple로 사용해 `event_id`를 만듭니다. 전체 immutable envelope에는 별도 `event_sha256`을 계산합니다. 같은 ID와 같은 hash는 재전송된 duplicate이고, 같은 identity인데 hash가 다르면 기존 row를 덮지 않고 conflict로 실패합니다.
4. **추가 꼬리 질문**: DB의 unique key만으로 충분하지 않나요?
5. **꼬리 질문에 대한 답변**: unique key는 중복 insert를 막지만 같은 논리 이벤트의 내용이 바뀐 것을 정상 duplicate와 구분하지 못합니다. envelope hash가 있어야 silent overwrite나 payload drift를 감지할 수 있습니다.

### Q54. 왜 PostgreSQL과 JSONL을 dual-write하지 않았나요?

1. **질문**: migration 안전성을 위해 두 저장소에 동시에 쓰는 편이 낫지 않나요?
2. **면접관이 질문하는 이유**: 분산 저장의 부분 실패 의미를 고려했는지 본다.
3. **모범 답변**: 현재 runtime은 transaction으로 묶을 수 없는 두 sink를 함께 쓰면 한쪽만 성공했을 때 어떤 결과를 정답으로 볼지와 재처리 책임이 커집니다. 그래서 환경별 single-sink를 명시하고 JSONL backfill은 별도 streaming importer로 분리했습니다.
4. **추가 꼬리 질문**: PostgreSQL 장애 시 JSONL로 fallback하지 않는 이유는 무엇인가요?
5. **꼬리 질문에 대한 답변**: silent fallback은 운영자가 PostgreSQL이 정상이라고 오해하게 만들고 데이터 위치가 나뉩니다. 실패를 metric과 안전한 log로 관찰하고 gameplay는 계속하되 해당 경기는 incomplete로 처리합니다.

### Q55. PostgreSQL write 실패가 게임을 종료시키지 않는 이유는 무엇인가요?

1. **질문**: 분석 저장에 실패해도 gameplay를 계속하는 정책은 데이터 유실을 허용하는 것 아닌가요?
2. **면접관이 질문하는 이유**: 핵심 기능과 부가 수집 경계의 우선순위를 판단했는지 본다.
3. **모범 답변**: 이 DB는 승패와 board의 원천이 아니라 분석 이벤트 sink입니다. DB 장애로 실시간 게임까지 중단시키는 비용이 더 크다고 판단해 최대 3회·약 2.7초 안에서만 재시도하고 gameplay를 계속합니다. 대신 누락 가능성을 숨기지 않고 incomplete game을 학습 export에서 제외합니다.
4. **추가 꼬리 질문**: 전적 DB라면 같은 정책을 쓰겠습니까?
5. **꼬리 질문에 대한 답변**: 아닙니다. 사용자에게 약속한 전적이나 결제처럼 business consistency가 필요한 데이터는 transaction, durable queue와 사용자 응답 의미를 다시 설계해야 합니다.

### Q56. Graceful shutdown 순서가 왜 중요한가요?

1. **질문**: 서버 종료 시 `reject writes → stop producers → drain → close pool → close Socket/HTTP` 순서를 택한 이유는 무엇인가요?
2. **면접관이 질문하는 이유**: 비동기 자원 수명과 데이터 손실 경계를 이해하는지 본다.
3. **모범 답변**: producer가 계속 이벤트를 만들면 drain이 끝나지 않고, pool을 먼저 닫으면 이미 accepted된 write가 실패합니다. 새 write를 막고 producer를 정지한 뒤 in-flight를 기다려야 snapshot과 종료 결과의 기준 시점이 생깁니다. 이후 DB pool과 network를 닫습니다.
4. **추가 꼬리 질문**: drain이 끝나지 않으면 어떻게 하나요?
5. **꼬리 질문에 대한 답변**: event drain은 3초, 전체 shutdown은 8초로 제한합니다. 무한 대기하지 않고 종료 outcome과 남은 connection을 안전 코드로 구분해 관찰합니다.

### Q57. PostgreSQL CI의 late commit 문제에서 무엇을 배웠나요?

1. **질문**: 첫 hosted PostgreSQL job이 마지막에 실패한 원인은 무엇이었나요?
2. **면접관이 질문하는 이유**: 실패를 단순 flake로 넘기지 않고 시간 순서로 분석했는지 본다.
3. **모범 답변**: producer가 살아 있고 write가 in-flight인 상태에서 row snapshot을 만든 뒤 shutdown drain을 실행했습니다. drain 중 정상 commit된 row 때문에 restart snapshot이 커졌고 코드가 이를 불일치로 오판했습니다. producer stop과 drain을 snapshot보다 앞으로 옮겨 기준 시점을 고정했습니다.
4. **추가 꼬리 질문**: 단순히 equality assertion을 느슨하게 하면 되지 않았나요?
5. **꼬리 질문에 대한 답변**: 그러면 실제 restart나 backup/restore 데이터 손실도 놓칠 수 있습니다. assertion을 약화하지 않고 측정 순서를 시스템 수명 주기에 맞춘 것이 핵심입니다.
