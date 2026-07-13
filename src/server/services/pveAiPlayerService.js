const {
    applyAuthoritativePlacementToMatchPlayerState: defaultApplyPlacement,
    ensurePlayerBagQueue: defaultEnsurePlayerBagQueue,
    getAuthoritativePlayerSnapshot: defaultGetPlayerSnapshot,
    getMatchState: defaultGetMatchState,
    markAuthoritativePlayerGameOver: defaultMarkPlayerGameOver,
} = require("./matchService.js");
const {
    savePlacementDecisionLog: defaultSavePlacementDecisionLog,
} = require("./logService.js");

let heuristicAiPromise = null;

function loadHeuristicAi() {
    if (!heuristicAiPromise) {
        heuristicAiPromise = Promise.all([
            import("../../client/game/ai/heuristic/heuristicEvaluator.js"),
            import("../../client/game/core/boardMetrics.js"),
        ]).then(([heuristicEvaluator, boardMetrics]) => ({
            ...heuristicEvaluator,
            getBoardMetrics: boardMetrics.getBoardMetrics,
        }));
    }
    return heuristicAiPromise;
}

function createPveAiPlayerService(dependencies = {}) {
    const loadAi = dependencies.loadHeuristicAi || loadHeuristicAi;
    const getMatchState = dependencies.getMatchState || defaultGetMatchState;
    const getPlayerSnapshot = dependencies.getPlayerSnapshot || defaultGetPlayerSnapshot;
    const applyPlacement = dependencies.applyPlacement || defaultApplyPlacement;
    const ensurePlayerBagQueue = dependencies.ensurePlayerBagQueue || defaultEnsurePlayerBagQueue;
    const markPlayerGameOver = dependencies.markPlayerGameOver || defaultMarkPlayerGameOver;
    const savePlacementDecisionLog = dependencies.savePlacementDecisionLog
        || defaultSavePlacementDecisionLog;

    async function processAiTurn(roomId, playerId, gameCore) {
        try {
            const ai = await loadAi();
            const queueResult = ensurePlayerBagQueue(roomId, playerId);
            if (!queueResult.ok) {
                return createFailure(queueResult.reason);
            }

            const matchResult = getMatchState(roomId);
            if (!matchResult.ok || !matchResult.match) {
                return createFailure(matchResult.reason || "MATCH_NOT_FOUND");
            }
            const player = matchResult.match.players.find(matchPlayer => {
                return matchPlayer.playerId === playerId;
            });
            if (!player || player.playerType !== "heuristic_ai") {
                return createFailure("AI_PLAYER_NOT_FOUND");
            }
            if (player.authoritativeState?.phase !== "playing") {
                return {
                    ok: true,
                    skipped: true,
                    reason: "AI_NOT_PLAYING",
                };
            }

            const snapshotResult = getPlayerSnapshot(roomId, playerId);
            if (!snapshotResult.ok || !snapshotResult.snapshot) {
                return createFailure(snapshotResult.reason || "AUTHORITATIVE_STATE_NOT_FOUND");
            }
            const stateBefore = snapshotResult.snapshot;
            if (player.lastDecisionPieceIndex === stateBefore.pieceIndex) {
                return {
                    ok: true,
                    skipped: true,
                    reason: "AI_PIECE_ALREADY_DECIDED",
                };
            }

            const decision = ai.getHeuristicDecision(createDecisionState(stateBefore));
            if (!decision.ok) {
                markPlayerGameOver(roomId, playerId, decision.errorCode || "AI_DECISION_FAILED");
                return {
                    ok: false,
                    skipped: false,
                    reason: decision.errorCode || "AI_DECISION_FAILED",
                    gameOver: true,
                    decision,
                };
            }

            const applyResult = applyPlacement(roomId, playerId, {
                pieceIndex: stateBefore.pieceIndex,
                placement: decision.selectedPlacement,
            }, gameCore);
            if (!applyResult.ok) {
                return createFailure(applyResult.reason, { decision });
            }

            player.lastDecisionPieceIndex = stateBefore.pieceIndex;
            const stateAfter = getPlayerSnapshot(roomId, playerId).snapshot;
            const placementResult = applyResult.gameplayResult.placementResult;
            const log = createPlacementDecisionLog({
                match: matchResult.match,
                playerId,
                stateBefore,
                stateAfter,
                decision,
                placementResult,
                gameCore,
                getBoardMetrics: ai.getBoardMetrics,
            });
            let logResult;
            try {
                logResult = await savePlacementDecisionLog(log);
            } catch (error) {
                logResult = {
                    ok: false,
                    log: null,
                    reason: "LOG_WRITE_FAILED",
                    message: error.message,
                };
            }

            return {
                ok: true,
                skipped: false,
                reason: null,
                gameOver: Boolean(placementResult.gameOver),
                gameplayResult: applyResult.gameplayResult,
                placementResult,
                decision,
                log,
                logResult,
            };
        } catch (error) {
            markPlayerGameOver(roomId, playerId, "AI_DECISION_FAILED");
            return createFailure("AI_DECISION_FAILED", {
                gameOver: true,
                message: error.message,
            });
        }
    }

    return {
        processAiTurn,
    };
}

function createDecisionState(state) {
    return {
        board: state.board,
        activePiece: state.activePiece,
        nextQueue: [...state.pieceQueue],
        holdPiece: state.holdPieceType,
        score: state.score,
        lines: state.lines,
        phase: state.phase,
        tick: state.currentTick,
        pieceIndex: state.pieceIndex,
        gameOver: Boolean(state.gameOver),
    };
}

function createPieceLog(piece, blocks) {
    const offsets = blocks?.[piece?.pieceType]?.[piece?.rotation] || [];
    return {
        ...piece,
        cells: offsets.map(([offsetX, offsetY]) => ({
            row: piece.row + offsetY,
            col: piece.col + offsetX,
        })),
    };
}

function createPlacementDecisionLog({
    match,
    playerId,
    stateBefore,
    stateAfter,
    decision,
    placementResult,
    gameCore,
    getBoardMetrics,
}) {
    return {
        eventType: "placement_decision",
        schemaVersion: 2,
        mode: "pve",
        gameId: `${match.roomId}-${match.createdAt}`,
        roomId: match.roomId,
        playerId,
        source: "heuristic_ai",
        modelType: "heuristic",
        tick: stateBefore.currentTick,
        pieceIndex: stateBefore.pieceIndex,
        createdAt: Date.now(),
        boardBefore: stateBefore.board,
        boardAfter: stateAfter.board,
        activePiece: createPieceLog(stateBefore.activePiece, gameCore.BLOCKS),
        nextQueue: [...stateBefore.pieceQueue],
        holdPiece: stateBefore.holdPieceType,
        inputSequence: [],
        selectedPlacement: decision.selectedPlacement,
        placementResult,
        metricsBefore: getBoardMetrics(stateBefore.board),
        metricsAfter: getBoardMetrics(stateAfter.board),
        evaluation: {
            score: decision.score,
            reason: decision.reason,
            candidateCount: decision.candidateCount,
        },
    };
}

function createFailure(reason, extra = {}) {
    return {
        ok: false,
        skipped: false,
        reason,
        gameOver: false,
        ...extra,
    };
}

module.exports = {
    createPveAiPlayerService,
};
