/**
  * 스폰 위치 기준으로 회전이 초기화된 새 조각 상태를 만든다.
  *
  * @param {string} pieceType - 생성할 조각 타입
  * @param {number} spawnRow - 기본 스폰 행
  * @param {number} spawnCol - 기본 스폰 열
  * @returns {{pieceType: string, rotation: number, row: number, col: number}} 스폰용 조각 상태
  */
export function createSpawnedPiece(pieceType, spawnRow, spawnCol) {
    return {
        pieceType,
        row: spawnRow,
        col: spawnCol,
        rotation: 0,
    };
}
