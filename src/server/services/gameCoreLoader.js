let gameCorePromise = null;

function loadGameCore() {
    if (!gameCorePromise) {
        gameCorePromise = Promise.all([
            import("../../client/game/core/step.js"),
            import("../../client/game/core/board.js"),
            import("../../client/game/core/piece.js"),
            import("../../client/game/core/attackState.js"),
            import("../../client/game/core/garbage.js"),
            import("../../client/game/core/tSpin.js"),
            import("../../client/game/state/blocks.js"),
            import("../../client/game/state/config.js"),
        ]).then(([
            stepCore,
            boardCore,
            pieceCore,
            attackStateCore,
            garbageCore,
            tSpinCore,
            blocksModule,
            configModule,
        ]) => ({
            resolveInputMoveIntent: stepCore.resolveInputMoveIntent,
            resolveMoveAttempt: stepCore.resolveMoveAttempt,
            resolveMoveIntent: stepCore.resolveMoveIntent,
            canPlacePiece: boardCore.canPlacePiece,
            createEmptyBoard: boardCore.createEmptyBoard,
            lockPieceOnBoard: boardCore.lockPieceOnBoard,
            clearFilledLines: boardCore.clearFilledLines,
            isPieceAboveTop: boardCore.isPieceAboveTop,
            createSpawnedPiece: pieceCore.createSpawnedPiece,
            getHardDropRow: pieceCore.getHardDropRow,
            resolveAttackState: attackStateCore.resolveAttackState,
            calculateGarbageAttack: garbageCore.calculateGarbageAttack,
            resolveGarbageCancel: garbageCore.resolveGarbageCancel,
            applyGarbageLines: garbageCore.applyGarbageLines,
            isTSpinLock: tSpinCore.isTSpinLock,
            BLOCKS: blocksModule.default,
            BOARD_ROWS: configModule.BOARD_ROWS,
            BOARD_COLS: configModule.BOARD_COLS,
            SPAWN_POSITION: configModule.SPAWN_POSITION,
            WALL_KICKS: configModule.WALL_KICKS,
        }));
    }

    return gameCorePromise;
}

module.exports = {
    loadGameCore,
};
