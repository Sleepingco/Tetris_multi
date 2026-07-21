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
