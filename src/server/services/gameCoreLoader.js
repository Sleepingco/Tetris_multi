let gameCorePromise = null;

function loadGameCore() {
    if (!gameCorePromise) {
        gameCorePromise = Promise.all([
            import("../../client/game/core/step.js"),
            import("../../client/game/core/board.js"),
            import("../../client/game/state/blocks.js"),
            import("../../client/game/state/config.js"),
        ]).then(([stepCore, boardCore, blocksModule, configModule]) => ({
            resolveInputMoveIntent: stepCore.resolveInputMoveIntent,
            resolveMoveAttempt: stepCore.resolveMoveAttempt,
            resolveMoveIntent: stepCore.resolveMoveIntent,
            canPlacePiece: boardCore.canPlacePiece,
            createEmptyBoard: boardCore.createEmptyBoard,
            BLOCKS: blocksModule.default,
            WALL_KICKS: configModule.WALL_KICKS,
        }));
    }

    return gameCorePromise;
}

module.exports = {
    loadGameCore,
};
