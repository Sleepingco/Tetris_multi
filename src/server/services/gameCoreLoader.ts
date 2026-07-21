let gameCorePromise: Promise<GameCore> | null = null;

function createGameCore() {
    return Promise.all([
        import("../../client/game/core/step.ts"),
        import("../../client/game/core/board.ts"),
        import("../../client/game/core/piece.ts"),
        import("../../client/game/core/attackState.ts"),
        import("../../client/game/core/garbage.ts"),
        import("../../client/game/core/tSpin.ts"),
        import("../../client/game/state/blocks.ts"),
        import("../../client/game/state/config.ts"),
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

export type GameCore = Awaited<ReturnType<typeof createGameCore>>;

export function loadGameCore(): Promise<GameCore> {
    if (!gameCorePromise) {
        gameCorePromise = createGameCore();
    }

    return gameCorePromise;
}
