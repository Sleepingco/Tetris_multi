import type { PieceType } from "../state/blocks.ts";

// =============================
// 움직이는 조각 보조 계산
// board에 고정되기 전 조각의 스폰 상태와 하드 드롭 도착 row를 계산한다.
// 두 함수 모두 전달받은 상태를 변경하지 않는다.
// =============================

export type EmptyPieceState = {
    pieceType: "";
    rotation: number;
    row: number;
    col: number;
};

export type PlaceablePieceState = {
    pieceType: PieceType;
    rotation: number;
    row: number;
    col: number;
};

export type PieceState = EmptyPieceState | PlaceablePieceState;

/**
  * 새 턴에 사용할 독립적인 조각 객체를 만든다.
  * 모든 조각은 설정된 스폰 좌표와 기본 회전 0에서 시작한다.
  */
export function createSpawnedPiece(
    pieceType: PieceType,
    spawnRow: number,
    spawnCol: number,
): PlaceablePieceState {
    return {
        pieceType,
        row: spawnRow,
        col: spawnCol,
        rotation: 0,
    };
}

/**
  * 조각을 한 줄씩 가상으로 내려 보며 마지막으로 배치 가능한 row를 찾는다.
  * 실제 piece나 board를 바꾸지 않고, 호출자가 주입한 `canPlaceAt`으로 충돌 규칙을 재사용한다.
  * 런타임의 hard drop, ghost piece, AI 도달 가능 배치 계산이 같은 결과를 공유한다.
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
