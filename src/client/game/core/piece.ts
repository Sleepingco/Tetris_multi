import type { PieceType } from "../state/blocks.ts";

export type PieceState = {
    pieceType: PieceType | "";
    rotation: number;
    row: number;
    col: number;
};

/**
  * 스폰 위치 기준으로 회전이 초기화된 새 조각 상태를 만든다.
  *
  * @param {string} pieceType - 생성할 조각 타입
  * @param {number} spawnRow - 기본 스폰 행
  * @param {number} spawnCol - 기본 스폰 열
  * @returns {{pieceType: string, rotation: number, row: number, col: number}} 스폰용 조각 상태
  */
export function createSpawnedPiece(
    pieceType: PieceType,
    spawnRow: number,
    spawnCol: number,
): PieceState {
    return {
        pieceType,
        row: spawnRow,
        col: spawnCol,
        rotation: 0,
    };
}

/**
  * 현재 조각이 아래로 내려갈 수 있는 마지막 row를 계산한다.
  *
  * @param {{pieceType: string, rotation: number, row: number, col: number}} piece - 기준 조각 상태
  * @param {(row: number) => boolean} canPlaceAt - 특정 row 배치 가능 여부를 반환하는 함수
  * @returns {number} 마지막으로 배치 가능한 row
  */
export function getHardDropRow(
    piece: Pick<PieceState, "row"> | null | undefined,
    canPlaceAt: ((row: number) => boolean) | null | undefined,
): number {
    const currentRow = piece?.row ?? 0;
    if (typeof canPlaceAt !== "function") return currentRow;

    let nextRow = currentRow;
    while (canPlaceAt(nextRow + 1)) {
        nextRow++;
    }

    return nextRow;
}
