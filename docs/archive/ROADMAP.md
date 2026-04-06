# Tetris Multi Roadmap

## 1. 문서 목적

이 문서는 앞으로의 설계 방향과 구현 순서를 한 문서로 정리한 로드맵이다.

목표는 단순히 테트리스를 완성하는 것이 아니라, 다음 조건을 만족하는 코드베이스를 만드는 것이다.

- 읽기 쉬운 구조
- DOM에 덜 묶인 엔진
- 멀티플레이를 견딜 수 있는 결정론적 흐름
- 테스트 가능한 핵심 로직
- 실제 배포와 운영이 가능한 구성

현재 프로젝트의 큰 방향은 이미 잡혀 있다.

- 싱글플레이 런타임은 구현되어 있음
- 엔진 분리가 진행 중임
- 다음 우선순위는 멀티플레이임
- AI 상대는 그 이후 단계임

## 2. 현재 상태 정리

현재 코드베이스는 이미 의미 있는 분리를 시작했다.

- `src/game/tetris.js`: 싱글플레이 런타임 조율
- `src/core/board.js`: 보드와 충돌 관련 로직
- `src/core/step.js`: 이동 판정과 intent 계산
- `src/render/tetrisRender.js`: 캔버스 렌더링
- `src/net/chat.js`: 소켓 통신 실험
- `src/app.js`: Node + Express + Socket.IO 서버 진입점

좋은 방향이지만 아직 남아 있는 문제가 있다.

- 런타임 조율과 게임 규칙이 완전히 분리되지 않음
- 멀티플레이 이벤트 계약이 문서화되지 않음
- 빌드, 테스트, 운영 스크립트가 정리되지 않음

## 3. 설계 원칙

앞으로의 작업은 아래 원칙을 유지한다.

### 3.1 엔진은 가능한 한 순수하게 유지

핵심 게임 규칙은 아래 요소에 의존하지 않아야 한다.

- DOM
- canvas
- timer
- socket event
- browser global

상태 전이를 결정하는 함수는 엔진 계층에 둔다.

### 3.2 렌더러는 교체 가능한 계층으로 유지

렌더러는 상태를 받아서 그리는 역할만 해야 한다.

렌더러가 결정하면 안 되는 것:

- 충돌 판정
- 라인 클리어 규칙
- 점수 계산
- 멀티플레이 동기화 규칙

### 3.3 멀티플레이는 상태 동기화 문제로 다룸

멀티플레이는 화면을 보내는 작업이 아니다.

주고받아야 하는 것은 다음과 같다.

- room 상태
- player 입력
- authoritative tick 또는 snapshot
- match lifecycle event

### 3.4 결정론적 루프를 지향

장기적으로는 다음 조건을 만족하는 구조로 간다.

- fixed tick
- seeded piece generation
- replay 가능한 입력 로그
- 같은 입력이면 같은 결과

이 조건은 다음 기능의 기반이 된다.

- 멀티플레이 공정성
- desync 진단
- replay
- AI 시뮬레이션

### 3.5 리팩터링 중에도 항상 플레이 가능 상태 유지

한 번에 전체를 갈아엎지 않는다.

항상 작은 단위로 진행한다.

- 책임 하나를 분리
- 기존 동작 유지
- 검증
- 다음 경계로 이동

## 4. 목표 아키텍처

프로젝트는 아래 구조로 수렴하는 것이 좋다.

```text
Client UI / Pages
  index.html / multiLobby.html / tetrisSingle.html / tetrisMulti.html
          |
          v
Runtime Layer
  input queue / timers / local session state / orchestration
          |
          v
Engine Layer
  board / piece / collision / step / scoring / garbage / match rules
          |
          +--> Renderer Layer
          |     canvas draw / preview / hold / animation
          |
          +--> Network Adapter
          |     encode input / decode snapshot / room events
          |
          +--> Persistence / Replay
                seed / input log / match result
```

### 4.1 클라이언트 책임

클라이언트는 다음 역할을 맡는다.

- 입력 수집
- 렌더링
- 로컬 UX 상태 관리
- 서버로 입력 전달
- authoritative 상태 반영

### 4.2 서버 책임

서버는 다음 역할을 맡는다.

- room 생성과 입장
- matchmaking
- match 시작 데이터 배포
- 접속 종료와 재접속 처리
- 멀티플레이 진행의 authoritative 기준 제공
- 결과 확정

멀티플레이 운영을 생각하면 서버 authoritative 모델이 기본 방향이다.

## 5. 권장 기술 방향

### 5.1 프런트엔드

현재 단계의 권장 조합:

- 바닐라 JavaScript
- Vite

이유:

- 엔진 학습과 구조 설계가 이 프로젝트의 핵심임
- 지금 프레임워크 전환을 하면 멀티플레이 일정이 느려짐
- Vite는 구조를 바꾸지 않고 빌드와 배포를 정리해 줌

### 5.2 백엔드

현재 단계의 권장 조합:

- Node.js
- Express 또는 Fastify
- Socket.IO

이유:

- 현재 서버 방향과 가장 자연스럽게 이어짐
- 프런트와 같은 언어로 반복 속도가 빠름
- 1대1 또는 소규모 room 기반 게임에는 충분히 실용적임

### 5.3 테스트와 품질

권장 추가 항목:

- Vitest: 엔진 단위 테스트
- Playwright: 나중의 브라우저 흐름 테스트
- ESLint: 정적 검사

## 6. 단계별 실행 계획

### Phase 1. 싱글플레이 경계 안정화

목표:

- 싱글플레이 로직을 읽고 테스트하기 쉽게 만든다.

작업:

- `src/game/tetris.js`의 책임 밀도를 낮춘다.
- 런타임 조율과 엔진 판단을 더 분리한다.
- `src/core`에서 DOM, timer 의존을 제거한다.
- game state shape를 한 곳에서 명확히 정의한다.
- action 이름과 moveCause를 정리한다.

완료 기준:

- runtime -> engine -> renderer 흐름이 명확하다.
- 엔진 동작을 `src/core`만 읽고도 이해할 수 있다.

### Phase 2. 결정론적 루프 정리

목표:

- 같은 seed와 같은 입력이면 같은 결과가 나오게 만든다.

작업:

- seeded piece generation 도입
- fixed tick 흐름 명시
- 입력을 tick 기반 queue로 다룸
- score, line clear, spawn, hold, game over 전이 고립
- replay 로그가 가능하도록 구조 정리

완료 기준:

- 로컬 replay가 가능해진다.
- desync를 추적할 기반이 생긴다.

### Phase 3. 멀티플레이 프로토콜 정의

목표:

- 지금의 socket 실험을 정식 이벤트 계약으로 바꾼다.

초기 이벤트 범주:

- room create/join/leave
- matchmaking start/cancel
- match start
- player input
- state snapshot
- garbage attack
- pause/resume/abort
- match result

예시 이벤트 이름:

```text
room:create
room:join
match:start
game:input
game:snapshot
game:garbage
match:finish
```

완료 기준:

- 모든 멀티플레이 동작에 event contract가 있다.
- 클라이언트와 서버가 payload를 추측하지 않아도 된다.

### Phase 4. 멀티플레이 MVP 구현

목표:

- 안정적으로 동작하는 1대1 대전 완성

범위:

- 두 플레이어 한 room
- ready flow
- 동기화된 match start
- server-authoritative game progression
- garbage line 교환
- 승패 판정
- 재접속 정책 정의

MVP에서 제외:

- spectator
- ranking
- tournament flow
- rollback netcode

완료 기준:

- 브라우저 두 개로 한 판을 끝까지 진행할 수 있다.
- desync 또는 disconnect 시 동작이 예측 가능하다.

### Phase 5. 배포와 운영 기초 정리

목표:

- 로컬 장난감이 아니라 실제 서비스처럼 실행 가능하게 만든다.

작업:

- 환경 변수 정의
- production start/build script 추가
- dev/prod 설정 분리
- 기본 에러 로깅 추가
- room cleanup 정책 추가
- health check endpoint 추가
- 배포 절차 문서화

최소 운영 체크리스트:

- 재현 가능한 설치
- 재현 가능한 빌드
- production start command
- port 설정
- 정적 파일 제공 전략
- 서버 재시작 전략

### Phase 6. AI 상대 추가

목표:

- 엔진 순수성을 깨지 않고 AI를 붙인다.

원칙:

- AI는 DOM이 아니라 game state를 읽는다.
- AI 출력은 사람 입력과 같은 action format을 사용한다.
- AI 구현은 교체 가능해야 한다.

권장 순서:

1. heuristic AI
2. 탐색 기반 placement evaluation
3. offline simulation harness
4. 이후 필요하면 ML 실험

## 7. 우선 리팩터링 대상

### Priority A. `src/game/tetris.js` 축소

목표:

- `tetris.js`를 규칙 파일이 아니라 orchestration 파일로 만든다.

분리 후보:

- loop와 timer 제어
- action dispatch
- line clear runtime sequencing
- piece spawn/hold flow
- UI coordination

### Priority B. 상태 구조 고정

다음 상태 항목의 계약을 분명히 유지한다.

- board
- activePiece
- pendingPiece
- pieceQueue
- holdPieceType
- score
- phase
- inputQueue
- multiplayer session state

### Priority C. 멀티플레이 프로토콜 문서 선행

코드보다 먼저 아래 항목을 문서로 고정한다.

- event 이름
- payload shape
- 누가 진실의 원천인지
- tick 정책
- resync 전략

## 8. 주요 리스크와 트레이드오프

### 8.1 지금 프런트 프레임워크를 크게 도입하는 경우

리스크:

- 엔진 설계의 강점이 UI 추상화 뒤로 가려질 수 있음
- 멀티플레이 전에 마이그레이션 비용이 커짐

판단:

- 지금은 전체 프레임워크 전환보다 구조 정리가 우선

### 8.2 클라이언트 authoritative 멀티플레이

리스크:

- 빠르게 붙일 수는 있음
- 치팅과 desync에 약함
- 운영 단계로 가기 어려움

판단:

- 실험용으로는 가능
- 운영 경로로는 비추천

### 8.3 너무 이른 최적화

리스크:

- dirty cell 최적화나 고급 동기화가 핵심 정확도를 가릴 수 있음

판단:

- 정확도 먼저
- 결정론 그 다음
- 최적화는 그 이후

## 9. 성공 기준

이 프로젝트는 아래 조건을 만족하면 성공으로 본다.

- 싱글플레이 엔진이 읽기 쉽고 테스트 가능하다.
- 멀티플레이가 명확한 authoritative 모델 위에서 동작한다.
- 배포와 실행 절차가 문서화되어 있다.
- 이후 AI가 같은 엔진을 재사용할 수 있다.

## 10. 바로 다음 액션

가장 먼저 추천하는 순서는 다음과 같다.

1. `package.json`에 실제 의존성과 dev/build/start script 정리
2. `src/game/tetris.js`를 orchestration 중심으로 더 축소
3. 멀티플레이 event payload 문서를 별도 파일로 추가
4. seed 기반 piece queue와 tick 정책 정리
5. `src/core` 기준 엔진 단위 테스트 시작

이 순서는 플레이 가능 상태를 유지하면서 멀티플레이와 운영 준비로 자연스럽게 이어진다.
