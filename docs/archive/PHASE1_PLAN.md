# Phase 1 Plan

## 1. 목적

`ROADMAP.md`의 Phase 1은 싱글플레이 경계를 안정화하는 단계다.

핵심 목적은 두 가지다.

- `src/game/tetris.js`를 읽기 쉬운 orchestration 파일로 줄이기
- 엔진 판단 로직을 `src/core` 중심으로 더 명확히 모으기

이 단계는 멀티플레이로 가기 전 준비 작업이다.

멀티플레이를 붙일 때 가장 큰 문제가 되는 것은 렌더링이 아니라 다음 두 가지다.

- 상태가 어디서 바뀌는지 불분명한 구조
- 입력, 판정, 렌더가 한 파일에 섞인 구조

## 2. 현재 진단

지금 기준으로 좋은 점:

- `src/core/board.js`와 `src/core/step.js`가 이미 존재함
- `src/render/tetrisRender.js`로 렌더링 분리가 시작됨
- `src/game/input.js`, `src/game/actionExecution.js`, `src/game/stateFactory.js`처럼 역할 분리도 일부 진행됨

지금 기준으로 남은 문제:

- `src/game/tetris.js`에 아직 orchestration 이상의 책임이 남아 있음
- 상태 전이 규칙이 파일 여러 곳에 흩어질 가능성이 있음
- phase, score, spawn, hold, line clear 흐름이 아직 문서와 코드에서 완전히 고정되지 않음

## 3. Phase 1 완료 조건

아래 조건을 만족하면 Phase 1 완료로 본다.

- `src/game/tetris.js`는 루프, 연결, 호출 순서 중심으로 읽힌다.
- 엔진 판단은 `src/core` 또는 그에 준하는 순수 계층에서 이해할 수 있다.
- DOM 없이도 핵심 판정 로직을 테스트할 수 있다.
- 입력 -> 판정 -> 상태 변경 -> 렌더 흐름이 추적 가능하다.

## 4. 작업 단위

### Task 1. 상태 구조 문서화

목표:

- runtime과 engine이 공유하는 상태 shape를 먼저 고정한다.

정리 대상:

- `board`
- `activePiece`
- `pendingPiece`
- `pieceQueue`
- `bag`
- `holdPieceType`
- `holdUsedThisDrop`
- `inputQueue`
- `phase`
- `score`
- `lastActionWasRotation`
- `isTSpin`

산출물:

- 상태 필드 설명 문서 또는 코드 주석
- phase 값과 전이 규칙 표

검증:

- `createGameState`만 읽고도 기본 상태를 설명할 수 있어야 한다.

### Task 2. `tetris.js`의 책임 목록 명시

목표:

- 현재 `src/game/tetris.js`가 무엇을 담당하는지 먼저 분류한다.

분류 기준:

- runtime loop
- input drain
- gravity control
- piece lifecycle
- line clear sequencing
- game over handling
- UI binding

산출물:

- 함수별 책임 목록
- "남길 책임"과 "옮길 책임" 구분표

검증:

- 각 함수가 어느 계층 소속인지 한 줄로 설명 가능해야 한다.

### Task 3. line clear 흐름 분리

목표:

- 라인 클리어 전후 처리의 runtime sequencing을 별도 책임으로 정리한다.

현재 관심사:

- 줄 감지
- 이펙트 시작
- 점수 반영
- 보드 정리
- 다음 블록 스폰
- 중력 재개

권장 방향:

- 엔진은 "무슨 줄이 지워질지" 계산
- 런타임은 "언제 애니메이션하고 언제 재개할지" 결정

검증:

- line clear 유무와 애니메이션 타이밍을 따로 설명할 수 있어야 한다.

### Task 4. piece lifecycle 경계 고정

목표:

- spawn, hold, lock 흐름을 읽기 쉽게 고정한다.

정리 대상:

- 새 블록 스폰
- hold 사용 가능 조건
- hard drop 후 lock
- fall 실패 후 lock
- game over 조건

권장 방향:

- 가능한 상태 전이는 엔진 결과로 받는다.
- runtime은 그 결과를 실행하는 쪽으로만 남긴다.

검증:

- "한 턴이 시작해서 끝날 때까지"의 흐름을 함수 이름만으로 따라갈 수 있어야 한다.

### Task 5. action과 moveCause 용어 고정

목표:

- 입력 이름과 판정 원인 이름을 섞지 않도록 경계를 고정한다.

현재 action:

- `move_left`
- `move_right`
- `soft_drop`
- `rotate`
- `hard_drop`
- `hold`

현재 moveCause:

- `horizontal`
- `fall`
- `rotate`
- `hardDrop`
- `spawn`

할 일:

- action은 player intent
- moveCause는 engine 판정 문맥
- 두 용어의 목적과 매핑 규칙 문서화

검증:

- 네트워크 프로토콜에서 action을 그대로 보낼지, moveCause는 내부용인지 구분 가능해야 한다.

### Task 6. 최소 단위 테스트 시작

목표:

- DOM이 없는 상태에서도 핵심 규칙이 깨지지 않는지 확인한다.

우선 테스트 대상:

- `canPlacePiece`
- `lockPieceOnBoard`
- `clearFilledLines`
- `resolveMoveAttempt`

필수 케이스:

- 좌우 경계 충돌
- 바닥 충돌
- 기존 블록 충돌
- 회전 실패와 kick 성공
- fall 실패 시 lock
- spawn 실패 시 game over

검증:

- 브라우저를 띄우지 않고도 핵심 판정이 검증되어야 한다.

## 5. 권장 작업 순서

1. 상태 구조 문서화
2. `tetris.js` 책임 분류
3. action과 moveCause 용어 고정
4. piece lifecycle 경계 정리
5. line clear sequencing 분리
6. 최소 단위 테스트 추가

이 순서가 좋은 이유:

- 이름과 상태를 먼저 고정해야 리팩터링이 덜 흔들린다.
- 테스트는 뒤가 아니라 초반부터 붙여야 이후 분리가 안전해진다.

## 6. 파일 단위 가이드

### `src/game/tetris.js`

남기는 책임:

- 런타임 초기화
- loop 시작과 중지
- 모듈 연결
- 엔진 결과를 UI와 타이머에 반영

줄여야 할 책임:

- 게임 규칙 세부 판단
- 라인 클리어 규칙 상세
- piece lifecycle 세부 분기

### `src/core/step.js`

강화할 책임:

- move attempt 결과 계산
- 상태 전이 의도 계산
- 나중의 fixed tick 전환 기반 제공

### `src/core/board.js`

유지할 책임:

- 배치 가능 여부
- 보드 반영
- 라인 삭제

### `src/game/stateFactory.js`

강화할 책임:

- 상태 필드 계약의 기준점 역할

## 7. 예상 산출물

Phase 1이 끝날 때 생기면 좋은 결과물:

- 더 짧아진 `src/game/tetris.js`
- 상태 구조 설명 문서
- action/moveCause 규약 문서
- 엔진 단위 테스트 몇 개

## 8. 다음 단계 연결

Phase 1이 끝나야 Phase 2와 3이 쉬워진다.

- 상태 shape가 고정되어야 deterministic loop를 설계할 수 있다.
- action 의미가 고정되어야 multiplayer input protocol을 만들 수 있다.
- engine 경계가 선명해야 AI도 같은 입력 형식을 재사용할 수 있다.
