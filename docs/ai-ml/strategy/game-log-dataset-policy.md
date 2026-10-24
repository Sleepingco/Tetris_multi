# 로그와 dataset 정책 안내

현재 게임은 buffer20-v1·40×10과 schema v3를 사용한다. 저장·관찰 문맥은
[게임 규칙 기록](../../gameplay/top-out-buffer-zone-plan.md)과 실제 validator/projector를 따른다.
기존 placement exporter/builder는 v3/40행 경기를 거부한다.

- 기존 20행 배치 모방: 아래의 legacy 정책과 [placement 평가 계약](../contracts/placement-ml-evaluation-contract.md)
- 새 행동·시간·hold: [Human 조작 dataset 설계](../contracts/human-action-dataset.md)
- 현재 작업 순서: [AI 계획](ai-plan.md), 과거 흐름: [실험 목차](../../archive/ai-ml/README.md)

정상 종료·초기 5개 조각 제외는 아래 placement 정책이다. 새 조작 dataset에
자동 적용하지 않는다. 신규 raw와 기존 bundle은 원본 그대로 보존한다.

## 초기 학습 데이터 기준 — legacy 20행 placement

이하 내용은 기존 v1/v2 배치 분석의 설계 배경과 필터다. "현재"·"나중" 표현은
당시 기준이며 v3 수집·새 학습의 상태나 실행 지시로 사용하지 않는다.

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
