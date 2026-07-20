# Tetris Multi

Vanilla JS, Express, Socket.IO 기반으로 싱글플레이 엔진을 정리하고 멀티플레이와 AI 상대까지 확장하는 학습용 Tetris 프로젝트다.

## Current Status

- 싱글플레이 런타임은 배열 기반 board state와 module script 진입점으로 동작한다.
- 멀티플레이 MVP는 `server authoritative state + authoritative snapshot + server garbage/gameOver` 흐름으로 main에 들어와 있다.
- 서버는 player별 `authoritativeState`를 기준으로 input, gravity tick, lock, garbage, game over를 처리한다.
- 상대 보드는 `game:authoritative:snapshot`을 기준으로 표시하고, 내 보드는 조작감을 위해 client prediction을 유지하면서 제한된 correction만 적용한다.
- `src/client/game/core/boardMetrics.js`에 휴리스틱 AI와 향후 ML feature 재사용을 위한 순수 board metric 함수가 구현되어 있다.
- `test/testBoardMetrics.js`가 empty board, line count, hole, bumpiness, height, mutation 방지를 검증한다.
- 런타임 변경은 `npm test` 전체 회귀 테스트로 검증한다.

## AI Direction

현재 AI 우선순위는 ML 학습이 아니라 휴리스틱 PVE AI 상대와 플레이 로그 축적이다.

다음 구현 순서는 다음 기준으로 고정한다.

1. `placementGenerator`
2. `simulatePlacement`
3. `heuristicEvaluator`
4. PVE AI Player

PVE AI는 추천 코치가 아니라 실제 게임에 참여하는 AI 상대다. 사용자 행동 분석, PVE AI 선택 비교, LLM 코칭 리포트는 PVE AI와 로그/지표가 준비된 뒤 검토한다.

Python AI 서버, 강화학습, LLM 코칭은 현재 구현 대상이 아니다. 먼저 JavaScript 순수 함수와 Node 테스트로 배치 생성, 시뮬레이션, 평가를 고정한다.

### 실험적 선택 모방 AI 체험

기본 PVE 상대는 계속 휴리스틱 AI다. 학습 결과를 직접 확인하려면 서버를 실행한 뒤
멀티플레이 로비에서 `AI PVE` → `내 선택 모방 AI (실험)`을 선택한다. 게임 화면은
실제로 적용된 정책을 `실험 AI · 동작 중` 또는 `실험 AI · 휴리스틱 전환`으로
표시한다.

이 기능은 125게임의 placement 선택을 학습한 V4 후보 모델을 사용하는 opt-in
데모다. 더 강한 AI나 사용자를 완전히 복제한 AI라는 의미는 아니며, 모델을 읽거나
검증하지 못하면 게임을 중단하지 않고 기존 휴리스틱 정책으로 전환한다.

## boardMetrics 위치

`boardMetrics`는 현재 `src/client/game/core`에 있다. 이유는 현재 보드 표현과 core 판정 함수가 이 경계에 있고, DOM 없이 실행되는 순수 함수라서 Node 테스트와 AI 평가에서 바로 재사용할 수 있기 때문이다.

나중에 서버, 클라이언트, AI 모듈이 같은 metric을 더 넓게 공유해야 하면 `shared` 계층으로 옮길 수 있다. 지금은 불필요한 구조 이동보다 현재 core 경계 안에서 순수성과 테스트를 유지하는 것이 우선이다.

## Key Docs

- [PLAN.md](PLAN.md)
- [docs/heuristic-ai-design.md](docs/heuristic-ai-design.md)
- [docs/README.md](docs/README.md)
- [docs/game-log-dataset-policy.md](docs/game-log-dataset-policy.md)
- [change-log.md](change-log.md)
