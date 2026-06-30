## 초기 학습 데이터 기준

### 포함
- 정상 종료된 게임
- game_start, placement_decision, game_over가 모두 존재하는 gameId
- winnerPlayerId와 playerId가 같은 placement_decision
- pieceIndex >= 5
- boardBefore/boardAfter/selectedPlacement가 유효한 로그

### 제외
- disconnect 또는 leave로 끝난 게임
- game_over가 없는 게임
- 테스트용 playerId
- schemaVersion 불일치
- board 크기 불일치
- pieceIndex 누락

### 보류
- loser의 placement_decision
- gameOver 직전 placement
- 비정상적으로 짧은 게임