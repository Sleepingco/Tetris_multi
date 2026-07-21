## 초기 학습 데이터 기준

현재 우선순위는 ML 학습이 아니라 휴리스틱 PVE AI와 로그 축적이다.
로그 정책은 나중에 ML 데이터셋으로 확장할 수 있게 정리하되, 지금 단계에서는 `placement_decision`과 board metric 기반 비교가 안정적으로 남는지를 먼저 본다.

`src/client/game/core/boardMetrics.ts`는 이미 구현된 순수 metric 계층이다.
현재 위치는 core board 표현과 같은 경계에 있어 DOM, runtime, socket 없이 Node 테스트로 검증할 수 있기 때문이다.
서버 AI, 클라이언트 분석, 별도 학습 파이프라인이 같은 metric을 더 넓게 공유해야 하는 시점에는 `shared` 계층으로 이동할 수 있다.

PVE AI는 추천 코치가 아니라 실제 상대다.
코칭 리포트 데이터는 PVE AI가 선택한 배치와 사용자의 배치를 비교할 수 있을 만큼 로그가 쌓인 뒤에 다룬다.

후순위:
- Python AI 서버
- 강화학습
- LLM 코칭 리포트

구현된 휴리스틱 PVE 기반 순서:
1. `placementGenerator`
2. `simulatePlacement`
3. `heuristicEvaluator`
4. PVE AI Player

## placement_decision schema

새로 생성하는 human/heuristic AI 배치 로그는 `schemaVersion: 2`를 사용한다.
기존 JSONL에 저장된 `schemaVersion: 1` 로그는 validator가 legacy 로그로 계속 허용하지만,
ML 데이터셋 생성 시에는 필수 feature가 없는 v1 로그를 별도 migration 또는 제외 대상으로 다룬다.

v2 공통 필드:
- `source`: `human` 또는 `heuristic_ai`
- `modelType`: human은 `null`, heuristic AI는 `heuristic`
- `boardBefore`, `boardAfter`, `activePiece`, `nextQueue`, `holdPiece`, `selectedPlacement`
- `placementResult.linesCleared`, `placementResult.scoreDelta`, `placementResult.gameOver`
- `metricsBefore`, `metricsAfter`
- `evaluation.score`, `evaluation.reason`, `evaluation.candidateCount`

Human 로그는 같은 `boardBefore`와 조각으로 heuristic evaluator를 실행해 `aiComparison`도 저장한다.
`betterBy`는 `heuristicScore - userScore`이며 양수일수록 heuristic 선택의 점수가 높다.
`samePlacement`는 piece type, rotation, row, col이 모두 같은지 나타낸다.

분석 실패는 게임 진행을 막지 않는다. 이 경우 runtime은 v1 legacy 로그로 fallback하며,
feature-ready v2 데이터셋에서는 해당 행을 제외한다.

### 포함
- 정상 종료된 게임
- game_start, placement_decision, game_over가 모두 존재하는 gameId
- pieceIndex >= 5
- boardBefore/boardAfter/selectedPlacement가 유효한 로그

Exporter의 기본 선택 정책은 `winner-only`이며 기존처럼 `winnerPlayerId`와
`playerId`가 같은 placement만 사용한다. Human 행동 데이터처럼 완료된 게임의
승자와 패자를 모두 분석할 때는 `--selection-policy all-completed`를 사용한다.
두 정책 모두 `finishType: normal`인 완료 게임만 허용한다.

`--source`는 `all`, `human`, `heuristic_ai` 중 하나를 받으며 기본값은 `all`이다.
Human 로그의 `aiDifficulty`는 같은 gameId의 heuristic AI 로그에서 추론한다.
한 gameId에 `normal`과 `hard`가 함께 있으면 해당 human placement는
`AMBIGUOUS_AI_DIFFICULTY`로 제외한다. Human 로그에 이미 명시된 난이도와
같은 게임에서 추론한 AI 난이도가 달라도 같은 reason으로 제외한다.

Dataset sample의 `metadata`에는 모델 feature와 분리된 게임 결과 문맥을 둔다.
- `isWinner`
- `winnerPlayerId`
- `finishType`

### 제외
- disconnect 또는 leave로 끝난 게임
- game_over가 없는 게임
- 테스트용 playerId
- schemaVersion 불일치
- board 크기 불일치
- pieceIndex 누락

### 보류
- gameOver 직전 placement
- 비정상적으로 짧은 게임
