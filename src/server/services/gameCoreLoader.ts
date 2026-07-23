// client의 DOM 없는 순수 game core를 서버에서도 그대로 사용한다.
// 동일한 충돌·lock·garbage 규칙을 공유해 client prediction과 authoritative 판정의 중복 구현을 피한다.
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

/**
 * 여러 server 경로가 같은 core module 묶음을 재사용하도록 최초 import Promise를 캐시한다.
 * 동시에 호출되어도 module을 다시 조립하지 않으며 실패도 같은 Promise 계보로 전달된다.
 */
export function loadGameCore(): Promise<GameCore> {
    if (!gameCorePromise) {
        gameCorePromise = createGameCore();
    }

    return gameCorePromise;
}
