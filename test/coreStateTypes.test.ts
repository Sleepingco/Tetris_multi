/**
 * board 판정 함수가 실제로 배치할 수 있는 조각 타입만 받도록 제한하는 컴파일 테스트다.
 *
 * 준비: 비어 있음을 나타낼 수 있는 `PieceState`와 실제 조각만 나타내는
 * `PlaceablePieceState`를 각각 만든다.
 * 실행: 두 상태를 `canPlacePiece`와 `lockPieceOnBoard`에 전달해 본다.
 * 검증: 실제 조각은 허용하고, 빈 조각 sentinel은 `@ts-expect-error` 위치에서 거부해야 한다.
 *
 * 런타임 조건문보다 앞선 타입 경계에서 "조각이 없는 상태를 board에 고정하는 실수"를 막는 계약이다.
 */
import type { Board, canPlacePiece, lockPieceOnBoard } from "../src/client/game/core/board.ts";
import type { PieceState, PlaceablePieceState } from "../src/client/game/core/piece.ts";
import type { BlockDefinitions } from "../src/client/game/state/blocks.ts";

function verifyPlacementContracts(
    canPlace: typeof canPlacePiece,
    lockPiece: typeof lockPieceOnBoard,
    board: Board,
    blocks: BlockDefinitions,
): void {
    const placeablePiece: PlaceablePieceState = {
        pieceType: "tree",
        rotation: 0,
        row: 0,
        col: 3,
    };
    const emptyPiece: PieceState = {
        pieceType: "",
        rotation: 0,
        row: 0,
        col: 3,
    };

    canPlace(board, placeablePiece, blocks);
    lockPiece(board, placeablePiece, blocks);

    // @ts-expect-error empty sentinel pieces are not placeable.
    canPlace(board, emptyPiece, blocks);
    // @ts-expect-error empty sentinel pieces cannot be locked.
    lockPiece(board, emptyPiece, blocks);
}

void verifyPlacementContracts;
