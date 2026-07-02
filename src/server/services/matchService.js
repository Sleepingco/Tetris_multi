const matches = new Map();
const shadowLoopTimers = new Map();
const BAG_PIECES = ["bar", "eleft", "eright", "ess", "square", "tree", "zee"];
const INITIAL_BAG_CHUNK_COUNT = 3;
const MAX_DESYNC_LOG_SIZE = 50;
const MAX_PLACEMENT_COMPARISON_LOG_SIZE = 50;
const RECENT_DESYNC_WINDOW_SIZE = 10;
const SHADOW_LOOP_INTERVAL_MS = 500;
const AUTHORITATIVE_SNAPSHOT_SOURCE = "server_shadow";
const PLACEMENT_RESULT_FIELDS = Object.freeze([
    "linesCleared",
    "isTSpin",
    "combo",
    "backToBack",
    "rawAttackLines",
    "attackLines",
    "canceledGarbageLines",
    "incomingGarbageLines",
    "appliedGarbageLines",
    "scoreBefore",
    "scoreAfter",
    "scoreDelta",
    "gameOver",
]);
const {
    createInitialShadowState,
    createShadowSnapshot,
    stepAuthoritativeState,
} = require("./shadowGameEngine.js");
const {
    createAuthoritativeSnapshot,
} = require("../validators/gameSnapshotValidator.js");

function createSuccess(match, extra = {}) {
    return {
        ok: true,
        match,
        reason: null,
        ...extra,
    };
}

function createFailure(reason) {
    return {
        ok: false,
        match: null,
        reason,
    };
}

function createMatch(room) {
    if (!room) {
        return createFailure("ROOM_REQUIRED");
    }

    if (!room.roomId) {
        return createFailure("ROOM_ID_REQUIRED");
    }

    if (!Array.isArray(room.players)) {
        return createFailure("ROOM_PLAYERS_REQUIRED");
    }

    const matchPlayers = room.players.map((player) => {
        const bagChunks = createInitialBagChunks();
        const shadowState = createInitialShadowState({ bagChunks });

        return {
            playerId: player.playerId,
            inputLog: [],
            bagChunks,
            shadowState,
            shadowTick: shadowState.tick,
            shadowPieceIndex: shadowState.pieceIndex,
            shadowInputLog: [],
            lastClientSnapshot: null,
            lastShadowSnapshot: createShadowSnapshot(shadowState),
            lastClientPlacementResult: null,
            lastPlacementComparison: null,
            placementComparisonLog: [],
            lastSkippedShadowLineClearComplete: null,
            desyncLog: [],
        };
    });

    const match = {
        roomId: room.roomId,
        status: room.status || "playing",
        players: matchPlayers,
        createdAt: Date.now(),
    };

    matches.set(room.roomId, match);

    return createSuccess(match);
}

function getMatchState(roomId) {
    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    return createSuccess(match);
}

function recordInput(roomId, playerId, input) {
    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    const player = match.players.find((matchPlayer) => {
        return matchPlayer.playerId === playerId;
    });

    if (!player) {
        return createFailure("PLAYER_NOT_FOUND");
    }

    if (!input || typeof input.action !== "string") {
        return createFailure("INVALID_INPUT");
    }

    const inputEntry = {
        playerId,
        action: input.action,
        tick: input.tick ?? null,
        pieceIndex: input.pieceIndex ?? null,
        sequence: player.inputLog.length + 1,
        receivedAt: Date.now(),
    };

    player.inputLog.push(inputEntry);
    player.shadowInputLog.push({ ...inputEntry });
    applyShadowInput(player, inputEntry);

    return createSuccess(match);
}

function advanceShadowMatch(roomId, tickCount = 1) {
    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    const safeTickCount = Number.isInteger(tickCount) && tickCount > 0
        ? tickCount
        : 1;

    for (let tickIndex = 0; tickIndex < safeTickCount; tickIndex++) {
        match.players.forEach((player) => {
            applyShadowGravity(player);
        });
    }

    return createSuccess(match);
}

function startShadowMatchLoop(roomId, intervalMs = SHADOW_LOOP_INTERVAL_MS, onAdvance = null) {
    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    if (shadowLoopTimers.has(roomId)) {
        return createSuccess(match);
    }

    const safeIntervalMs = Number.isInteger(intervalMs) && intervalMs > 0
        ? intervalMs
        : SHADOW_LOOP_INTERVAL_MS;
    const timer = setInterval(() => {
        const result = advanceShadowMatch(roomId);

        if (!result.ok) {
            stopShadowMatchLoop(roomId);
            return;
        }

        if (typeof onAdvance === "function") {
            onAdvance(result);
        }
    }, safeIntervalMs);

    timer.unref?.();
    shadowLoopTimers.set(roomId, timer);

    return createSuccess(match);
}

function stopShadowMatchLoop(roomId) {
    const timer = shadowLoopTimers.get(roomId);

    if (timer) {
        clearInterval(timer);
        shadowLoopTimers.delete(roomId);
    }

    const match = matches.get(roomId);
    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    return createSuccess(match);
}

function deleteMatch(roomId) {
    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    const timer = shadowLoopTimers.get(roomId);
    if (timer) {
        clearInterval(timer);
        shadowLoopTimers.delete(roomId);
    }

    matches.delete(roomId);

    return createSuccess(match);
}

function recordClientSnapshot(roomId, playerId, snapshot) {
    const playerResult = findMatchPlayer(roomId, playerId);

    if (!playerResult.ok) {
        return createFailure(playerResult.reason);
    }

    const { match, player } = playerResult;
    player.lastClientSnapshot = cloneSnapshot(snapshot);

    if (player.lastShadowSnapshot) {
        const fields = findDesyncedFields(player.lastClientSnapshot, player.lastShadowSnapshot);

        if (fields.length > 0) {
            const classification = classifyDesync(player.lastClientSnapshot, player.lastShadowSnapshot, fields);

            player.desyncLog.push({
                playerId,
                fields,
                severity: classification.severity,
                primaryReason: classification.primaryReason,
                details: createDesyncDetails(player.lastClientSnapshot, player.lastShadowSnapshot, fields),
                clientTick: player.lastClientSnapshot?.tick ?? null,
                shadowTick: player.lastShadowSnapshot?.tick ?? null,
                clientPieceIndex: player.lastClientSnapshot?.pieceIndex ?? null,
                shadowPieceIndex: player.lastShadowSnapshot?.pieceIndex ?? null,
                detectedAt: Date.now(),
            });
            trimDesyncLog(player);
        }
    }

    return createSuccess(match);
}

function recordShadowSnapshot(roomId, playerId, snapshot) {
    const playerResult = findMatchPlayer(roomId, playerId);

    if (!playerResult.ok) {
        return createFailure(playerResult.reason);
    }

    const { match, player } = playerResult;
    player.lastShadowSnapshot = cloneSnapshot(snapshot);
    player.shadowTick = Number.isInteger(snapshot?.tick) ? snapshot.tick : player.shadowTick;
    player.shadowPieceIndex = Number.isInteger(snapshot?.pieceIndex)
        ? snapshot.pieceIndex
        : player.shadowPieceIndex;

    return createSuccess(match);
}

function recordClientPlacementDecision(roomId, playerId, log) {
    const playerResult = findMatchPlayer(roomId, playerId);

    if (!playerResult.ok) {
        return createFailure(playerResult.reason);
    }

    const { match, player } = playerResult;
    const clientPlacementResult = log?.placementResult;
    if (!clientPlacementResult || typeof clientPlacementResult !== "object" || Array.isArray(clientPlacementResult)) {
        return createFailure("PLACEMENT_RESULT_REQUIRED");
    }

    completeShadowLineClearBeforePlacementComparison(player, log);
    const shadowSnapshot = player.lastShadowSnapshot ?? player.shadowState ?? null;
    const shadowPlacementResult = shadowSnapshot?.lastPlacementResult
        ?? null;
    const placementComparison = createPlacementResultComparison(
        clientPlacementResult,
        shadowPlacementResult,
    );

    player.lastClientPlacementResult = cloneSnapshot(clientPlacementResult);
    player.lastPlacementComparison = placementComparison;
    recordPlacementComparison(
        player,
        placementComparison,
        createPlacementComparisonMetadata(log, shadowSnapshot),
    );

    return createSuccess(match, {
        placementComparison: cloneSnapshot(placementComparison),
    });
}

function completeShadowLineClearBeforePlacementComparison(player, log) {
    if (player.shadowState?.phase !== "lineClearing") return;
    if (!Number.isInteger(log?.placementResult?.linesCleared) || log.placementResult.linesCleared <= 0) return;
    if (Number.isInteger(log?.pieceIndex) && log.pieceIndex !== player.shadowState.pieceIndex) {
        player.lastSkippedShadowLineClearComplete = {
            reason: "PIECE_INDEX_MISMATCH",
            clientPieceIndex: log.pieceIndex,
            shadowPieceIndex: player.shadowState.pieceIndex,
            clientTick: Number.isInteger(log.tick) ? log.tick : null,
            shadowTick: player.shadowTick,
        };
        return;
    }

    player.shadowState = stepAuthoritativeState(player.shadowState, {
        type: "line_clear_complete",
        tick: player.shadowTick + 1,
    });
    player.shadowTick = player.shadowState.tick;
    player.shadowPieceIndex = player.shadowState.pieceIndex;
    player.lastShadowSnapshot = createShadowSnapshot(player.shadowState);
    player.lastSkippedShadowLineClearComplete = null;
}

function recordPlacementComparison(player, placementComparison, metadata = {}) {
    if (!Array.isArray(placementComparison?.fields) || placementComparison.fields.length === 0) {
        return;
    }

    player.placementComparisonLog.push({
        fields: [...placementComparison.fields],
        details: cloneSnapshot(placementComparison.details),
        ...metadata,
        recordedAt: Date.now(),
    });

    if (player.placementComparisonLog.length > MAX_PLACEMENT_COMPARISON_LOG_SIZE) {
        player.placementComparisonLog.shift();
    }
}

function createPlacementComparisonMetadata(log, shadowSnapshot) {
    const clientTick = getSnapshotTick(log);
    const shadowTick = getSnapshotTick(shadowSnapshot);
    const clientPieceIndex = getSnapshotPieceIndex(log);
    const shadowPieceIndex = getSnapshotPieceIndex(shadowSnapshot);

    return {
        clientTick,
        shadowTick,
        tickDelta: getSnapshotToShadowTickDelta(clientTick, shadowTick),
        clientPieceIndex,
        shadowPieceIndex,
        pieceIndexDelta: getSnapshotToShadowPieceIndexDelta(clientPieceIndex, shadowPieceIndex),
    };
}

function clonePlacementComparisonLog(placementComparisonLog) {
    return placementComparisonLog.map(entry => ({
        ...entry,
        fields: [...entry.fields],
        details: cloneSnapshot(entry.details),
    }));
}

function getPlayerShadowState(roomId, playerId) {
    const playerResult = findMatchPlayer(roomId, playerId);

    if (!playerResult.ok) {
        return {
            ok: false,
            shadow: null,
            reason: playerResult.reason,
        };
    }

    const { match, player } = playerResult;
    const shadowState = cloneSnapshot(player.shadowState);
    const lastClientSnapshot = cloneSnapshot(player.lastClientSnapshot);
    const lastShadowSnapshot = cloneSnapshot(player.lastShadowSnapshot);
    const lastAuthoritativeSnapshot = createAuthoritativeSnapshot(lastShadowSnapshot ?? shadowState);
    const desyncLog = player.desyncLog.map(entry => ({
        ...entry,
        fields: [...entry.fields],
        details: cloneSnapshot(entry.details),
    }));
    const placementComparisonLog = clonePlacementComparisonLog(player.placementComparisonLog);

    return {
        ok: true,
        shadow: {
            roomId: match.roomId,
            playerId: player.playerId,
            summary: createShadowSummary(match, player, lastShadowSnapshot ?? shadowState, desyncLog),
            shadowState,
            shadowTick: player.shadowTick,
            shadowPieceIndex: player.shadowPieceIndex,
            shadowInputLog: player.shadowInputLog.map(input => ({ ...input })),
            lastClientSnapshot,
            lastShadowSnapshot,
            lastAuthoritativeSnapshot,
            lastClientPlacementResult: cloneSnapshot(player.lastClientPlacementResult),
            lastPlacementComparison: cloneSnapshot(player.lastPlacementComparison),
            placementComparisonLog,
            recentPlacementComparisonLog: placementComparisonLog.slice(-RECENT_DESYNC_WINDOW_SIZE),
            desyncLog,
        },
        reason: null,
    };
}

function getPlayerAuthoritativeSnapshot(roomId, playerId) {
    const playerResult = findMatchPlayer(roomId, playerId);

    if (!playerResult.ok) {
        return {
            ok: false,
            roomId,
            playerId,
            source: AUTHORITATIVE_SNAPSHOT_SOURCE,
            snapshot: null,
            createdAt: Date.now(),
            reason: playerResult.reason,
        };
    }

    const { player } = playerResult;
    const shadowSnapshot = player.lastShadowSnapshot ?? player.shadowState;

    return {
        ok: true,
        roomId,
        playerId: player.playerId,
        source: AUTHORITATIVE_SNAPSHOT_SOURCE,
        snapshot: createAuthoritativeSnapshot(shadowSnapshot),
        createdAt: Date.now(),
        reason: null,
    };
}

function appendPlayerBagChunk(roomId, playerId) {
    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    const player = match.players.find((matchPlayer) => {
        return matchPlayer.playerId === playerId;
    });

    if (!player) {
        return createFailure("PLAYER_NOT_FOUND");
    }

    const bagChunk = createBagChunk();
    player.bagChunks.push(bagChunk);
    appendShadowBagChunk(player, bagChunk);

    return createSuccess(match, { bagChunk });
}

function recordGarbageAttack(roomId, fromPlayerId, targetPlayerId, garbage) {
    const match = matches.get(roomId);

    if (!match) {
        return createFailure("MATCH_NOT_FOUND");
    }

    const fromPlayer = match.players.find((matchPlayer) => {
        return matchPlayer.playerId === fromPlayerId;
    });

    if (!fromPlayer) {
        return createFailure("PLAYER_NOT_FOUND");
    }

    const targetPlayer = match.players.find((matchPlayer) => {
        return matchPlayer.playerId === targetPlayerId;
    });

    if (!targetPlayer) {
        return createFailure("TARGET_PLAYER_NOT_FOUND");
    }

    if (!Number.isInteger(garbage?.lines) || garbage.lines <= 0 || garbage.lines > 12) {
        return createFailure("INVALID_GARBAGE_LINES");
    }

    applyShadowGarbage(targetPlayer, garbage);

    return createSuccess(match, {
        garbage: {
            fromPlayerId,
            targetPlayerId,
            lines: garbage.lines,
            holeCol: Number.isInteger(garbage.holeCol) ? garbage.holeCol : null,
        },
    });
}

function createBagChunk() {
    const chunk = [...BAG_PIECES];

    for (let i = chunk.length - 1; i > 0; i--) {
        const randomIndex = Math.floor(Math.random() * (i + 1));
        const currentPiece = chunk[i];
        chunk[i] = chunk[randomIndex];
        chunk[randomIndex] = currentPiece;
    }

    return chunk;
}

function createInitialBagChunks(count = INITIAL_BAG_CHUNK_COUNT) {
    return Array.from({ length: count }, () => createBagChunk());
}

function applyShadowInput(player, inputEntry) {
    if (!player.shadowState) return;

    player.shadowState = stepAuthoritativeState(player.shadowState, {
        type: "input",
        action: inputEntry.action,
        tick: inputEntry.tick,
        pieceIndex: inputEntry.pieceIndex,
    });
    player.shadowTick = player.shadowState.tick;
    player.shadowPieceIndex = player.shadowState.pieceIndex;
    player.lastShadowSnapshot = createShadowSnapshot(player.shadowState);
}

function applyShadowGravity(player) {
    if (!player.shadowState) return;

    player.shadowState = stepAuthoritativeState(player.shadowState, {
        type: "gravity",
        tick: player.shadowTick + 1,
    });
    player.shadowTick = player.shadowState.tick;
    player.shadowPieceIndex = player.shadowState.pieceIndex;
    player.lastShadowSnapshot = createShadowSnapshot(player.shadowState);
}

function appendShadowBagChunk(player, bagChunk) {
    if (!player.shadowState || !Array.isArray(bagChunk)) return;

    player.shadowState.serverBagQueue.push(...bagChunk);
    player.lastShadowSnapshot = createShadowSnapshot(player.shadowState);
}

function applyShadowGarbage(player, garbage) {
    if (!player.shadowState) return;

    player.shadowState = stepAuthoritativeState(player.shadowState, {
        type: "garbage",
        lines: garbage.lines,
        holeCol: garbage.holeCol,
    });
    player.shadowTick = player.shadowState.tick;
    player.shadowPieceIndex = player.shadowState.pieceIndex;
    player.lastShadowSnapshot = createShadowSnapshot(player.shadowState);
}

function createShadowSummary(match, player, snapshot, desyncLog) {
    const lastDesync = desyncLog.at(-1) ?? null;
    const lastShadowInput = player.shadowInputLog.at(-1) ?? null;
    const lastClientSnapshotTick = getSnapshotTick(player.lastClientSnapshot);
    const lastShadowSnapshotTick = getSnapshotTick(player.lastShadowSnapshot);
    const lastClientSnapshotPieceIndex = getSnapshotPieceIndex(player.lastClientSnapshot);
    const lastShadowSnapshotPieceIndex = getSnapshotPieceIndex(player.lastShadowSnapshot);
    const lastClientSnapshotPhase = getSnapshotPhase(player.lastClientSnapshot);
    const lastShadowSnapshotPhase = getSnapshotPhase(player.lastShadowSnapshot);
    const lastClientSnapshotBoardChecksum = createBoardChecksum(player.lastClientSnapshot?.board);
    const lastShadowSnapshotBoardChecksum = createBoardChecksum(player.lastShadowSnapshot?.board);
    const lastClientSnapshotBoardDiff = createBoardDiffSummary(
        player.lastClientSnapshot?.board,
        player.lastShadowSnapshot?.board,
    );
    const lastClientSnapshotActivePieceDiff = createActivePieceDiffSummary(
        player.lastClientSnapshot?.activePiece,
        player.lastShadowSnapshot?.activePiece,
    );
    const lastClientSnapshotToShadowPieceIndexDelta = getSnapshotToShadowPieceIndexDelta(
        lastClientSnapshotPieceIndex,
        lastShadowSnapshotPieceIndex,
    );
    const desyncReasonCounts = countDesyncReasons(desyncLog);
    const dominantDesync = getDominantDesyncReason(desyncReasonCounts);
    const actionableDesyncLog = desyncLog.filter(isActionableDesync);
    const lastActionableDesync = actionableDesyncLog.at(-1) ?? null;
    const actionableDesyncReasonCounts = countDesyncReasons(actionableDesyncLog);
    const actionableDesyncFieldCounts = countDesyncFields(actionableDesyncLog);
    const dominantActionableDesync = getDominantDesyncReason(actionableDesyncReasonCounts);
    const dominantActionableDesyncField = getDominantDesyncField(actionableDesyncFieldCounts);
    const recentDesyncLog = desyncLog.slice(-RECENT_DESYNC_WINDOW_SIZE);
    const recentActionableDesyncLog = recentDesyncLog.filter(isActionableDesync);
    const recentDesyncReasonCounts = countDesyncReasons(recentDesyncLog);
    const recentDominantDesync = getDominantDesyncReason(recentDesyncReasonCounts);
    const recentActionableDesyncReasonCounts = countDesyncReasons(recentActionableDesyncLog);
    const recentActionableDesyncFieldCounts = countDesyncFields(recentActionableDesyncLog);
    const recentDominantActionableDesync = getDominantDesyncReason(recentActionableDesyncReasonCounts);
    const recentDominantActionableDesyncField = getDominantDesyncField(recentActionableDesyncFieldCounts);
    const lastDesyncTickDelta = getDesyncTickDelta(lastDesync);
    const maxAbsoluteDesyncTickDelta = getMaxAbsoluteDesyncTickDelta(desyncLog);
    const lastDesyncPieceIndexDelta = getDesyncPieceIndexDelta(lastDesync);
    const maxAbsoluteDesyncPieceIndexDelta = getMaxAbsoluteDesyncPieceIndexDelta(desyncLog);
    const lastActionableDesyncTickDelta = getDesyncTickDelta(lastActionableDesync);
    const lastActionableDesyncPieceIndexDelta = getDesyncPieceIndexDelta(lastActionableDesync);
    const placementComparisonLog = player.placementComparisonLog ?? [];
    const lastPlacementComparisonLog = placementComparisonLog.at(-1) ?? null;
    const placementResultMismatchFieldCounts = countDesyncFields(placementComparisonLog);
    const dominantPlacementResultMismatchField = getDominantDesyncField(
        placementResultMismatchFieldCounts,
    );
    const recentPlacementComparisonLog = placementComparisonLog.slice(-RECENT_DESYNC_WINDOW_SIZE);
    const recentPlacementComparisonAlignmentCounts = countPlacementComparisonAlignment(
        recentPlacementComparisonLog,
    );
    const recentPlacementInvestigationHintCounts = countPlacementInvestigationHints(
        recentPlacementComparisonLog,
    );
    const recentDominantPlacementInvestigationHint = getDominantPlacementInvestigationHint(
        recentPlacementInvestigationHintCounts,
    );
    const recentMaxAbsolutePlacementTickDelta = getMaxAbsoluteDesyncTickDelta(
        recentPlacementComparisonLog,
    );
    const recentMaxAbsolutePlacementPieceIndexDelta = getMaxAbsoluteDesyncPieceIndexDelta(
        recentPlacementComparisonLog,
    );
    const recentPlacementDriftLevel = getPlacementDriftLevel(
        recentPlacementComparisonAlignmentCounts,
        recentMaxAbsolutePlacementPieceIndexDelta,
    );
    const recentPlacementAttentionLevel = getPlacementAttentionLevel(recentPlacementDriftLevel);
    const recentPlacementResultMismatchFieldCounts = countDesyncFields(recentPlacementComparisonLog);
    const recentDominantPlacementResultMismatchField = getDominantDesyncField(
        recentPlacementResultMismatchFieldCounts,
    );
    const shadowHealth = getShadowHealth(desyncLog, actionableDesyncLog);
    const recentShadowHealth = getShadowHealth(recentDesyncLog, recentActionableDesyncLog);
    const placementResultHealth = getPlacementResultHealth(placementComparisonLog);
    const recentPlacementResultHealth = getPlacementResultHealth(recentPlacementComparisonLog);

    return {
        roomId: match.roomId,
        playerId: player.playerId,
        shadowTick: player.shadowTick,
        shadowPieceIndex: player.shadowPieceIndex,
        phase: snapshot?.phase ?? null,
        score: snapshot?.score ?? 0,
        linesClearedTotal: snapshot?.linesClearedTotal ?? 0,
        pendingGarbageLines: getPendingGarbageLines(snapshot?.pendingGarbageQueue),
        activePiece: cloneSnapshot(snapshot?.activePiece),
        lastShadowPlacementLinesCleared: getPlacementNumber(snapshot?.lastPlacementResult, "linesCleared"),
        lastShadowPlacementRawAttackLines: getPlacementNumber(snapshot?.lastPlacementResult, "rawAttackLines"),
        lastShadowPlacementAttackLines: getPlacementNumber(snapshot?.lastPlacementResult, "attackLines"),
        lastShadowPlacementCanceledGarbageLines: getPlacementNumber(
            snapshot?.lastPlacementResult,
            "canceledGarbageLines",
        ),
        lastShadowPlacementIncomingGarbageLines: getPlacementNumber(
            snapshot?.lastPlacementResult,
            "incomingGarbageLines",
        ),
        lastShadowPlacementAppliedGarbageLines: getPlacementNumber(
            snapshot?.lastPlacementResult,
            "appliedGarbageLines",
        ),
        lastShadowPlacementScoreBefore: getPlacementNumber(snapshot?.lastPlacementResult, "scoreBefore"),
        lastShadowPlacementScoreAfter: getPlacementNumber(snapshot?.lastPlacementResult, "scoreAfter"),
        lastShadowPlacementScoreDelta: getPlacementNumber(snapshot?.lastPlacementResult, "scoreDelta"),
        lastShadowPlacementGameOver: getPlacementBoolean(snapshot?.lastPlacementResult, "gameOver"),
        lastPlacementResultMismatch: getPlacementComparisonMismatch(player.lastPlacementComparison),
        lastPlacementResultMismatchFields: getPlacementComparisonFields(player.lastPlacementComparison),
        placementResultMismatchCount: placementComparisonLog.length,
        placementResultHealth,
        placementResultMismatchFieldCounts,
        dominantPlacementResultMismatchField: dominantPlacementResultMismatchField.field,
        dominantPlacementResultMismatchFieldCount: dominantPlacementResultMismatchField.count,
        recentPlacementResultMismatchCount: recentPlacementComparisonLog.length,
        recentPlacementResultHealth,
        recentPlacementResultMismatchFieldCounts,
        recentDominantPlacementResultMismatchField: recentDominantPlacementResultMismatchField.field,
        recentDominantPlacementResultMismatchFieldCount: recentDominantPlacementResultMismatchField.count,
        lastPlacementComparisonTickDelta: getDesyncTickDelta(lastPlacementComparisonLog),
        lastPlacementComparisonPieceIndexDelta: getDesyncPieceIndexDelta(lastPlacementComparisonLog),
        lastPlacementComparisonPieceAlignment: getPieceIndexDirection(
            getDesyncPieceIndexDelta(lastPlacementComparisonLog),
        ),
        recentSamePiecePlacementMismatchCount: recentPlacementComparisonAlignmentCounts.samePiece,
        recentOutOfOrderPlacementMismatchCount: recentPlacementComparisonAlignmentCounts.outOfOrder,
        recentUnknownPiecePlacementMismatchCount: recentPlacementComparisonAlignmentCounts.unknown,
        recentPlacementInvestigationHintCounts,
        recentDominantPlacementInvestigationHint: recentDominantPlacementInvestigationHint.hint,
        recentDominantPlacementInvestigationHintCount: recentDominantPlacementInvestigationHint.count,
        recentMaxAbsolutePlacementTickDelta,
        recentMaxAbsolutePlacementPieceIndexDelta,
        recentPlacementDriftLevel,
        recentPlacementAttentionLevel,
        lastSkippedShadowLineClearComplete: cloneSnapshot(player.lastSkippedShadowLineClearComplete),
        lastSkippedShadowLineClearCompleteReason: player.lastSkippedShadowLineClearComplete?.reason ?? null,
        lastClientPlacementAttackLines: getPlacementNumber(player.lastClientPlacementResult, "attackLines"),
        lastPlacementAttackLinesDelta: getPlacementDetailDelta(
            player.lastPlacementComparison,
            "attackLines",
        ),
        lastClientPlacementCanceledGarbageLines: getPlacementNumber(
            player.lastClientPlacementResult,
            "canceledGarbageLines",
        ),
        lastPlacementCanceledGarbageLinesDelta: getPlacementDetailDelta(
            player.lastPlacementComparison,
            "canceledGarbageLines",
        ),
        lastClientPlacementScoreBefore: getPlacementNumber(player.lastClientPlacementResult, "scoreBefore"),
        lastPlacementScoreBeforeDelta: getPlacementDetailDelta(
            player.lastPlacementComparison,
            "scoreBefore",
        ),
        lastClientPlacementScoreAfter: getPlacementNumber(player.lastClientPlacementResult, "scoreAfter"),
        lastPlacementScoreAfterDelta: getPlacementDetailDelta(
            player.lastPlacementComparison,
            "scoreAfter",
        ),
        lastClientPlacementScoreDelta: getPlacementNumber(player.lastClientPlacementResult, "scoreDelta"),
        lastPlacementScoreDeltaDelta: getPlacementDetailDelta(
            player.lastPlacementComparison,
            "scoreDelta",
        ),
        shadowHealth,
        recentShadowHealth,
        overallShadowHealth: getOverallShadowHealth(shadowHealth, placementResultHealth),
        recentOverallShadowHealth: getOverallShadowHealth(
            recentShadowHealth,
            recentPlacementResultHealth,
        ),
        desyncCount: desyncLog.length,
        desyncReasonCounts,
        dominantDesyncReason: dominantDesync.reason,
        dominantDesyncCount: dominantDesync.count,
        recentDesyncCount: recentDesyncLog.length,
        recentDesyncReasonCounts,
        recentDominantDesyncReason: recentDominantDesync.reason,
        recentDominantDesyncCount: recentDominantDesync.count,
        actionableDesyncCount: actionableDesyncLog.length,
        actionableDesyncReasonCounts,
        actionableDesyncFieldCounts,
        dominantActionableDesyncReason: dominantActionableDesync.reason,
        dominantActionableDesyncCount: dominantActionableDesync.count,
        dominantActionableDesyncField: dominantActionableDesyncField.field,
        dominantActionableDesyncFieldCount: dominantActionableDesyncField.count,
        recentActionableDesyncCount: recentActionableDesyncLog.length,
        recentActionableDesyncReasonCounts,
        recentActionableDesyncFieldCounts,
        recentDominantActionableDesyncReason: recentDominantActionableDesync.reason,
        recentDominantActionableDesyncCount: recentDominantActionableDesync.count,
        recentDominantActionableDesyncField: recentDominantActionableDesyncField.field,
        recentDominantActionableDesyncFieldCount: recentDominantActionableDesyncField.count,
        lastShadowInputAction: typeof lastShadowInput?.action === "string" ? lastShadowInput.action : null,
        lastShadowInputTick: Number.isInteger(lastShadowInput?.tick) ? lastShadowInput.tick : null,
        lastShadowInputPieceIndex: Number.isInteger(lastShadowInput?.pieceIndex)
            ? lastShadowInput.pieceIndex
            : null,
        lastShadowInputSequence: Number.isInteger(lastShadowInput?.sequence)
            ? lastShadowInput.sequence
            : null,
        lastShadowInputToShadowTickDelta: getInputToShadowTickDelta(lastShadowInput, player),
        lastShadowInputToClientSnapshotTickDelta: getInputToClientSnapshotTickDelta(
            lastShadowInput,
            lastClientSnapshotTick,
        ),
        lastClientSnapshotTick,
        lastShadowSnapshotTick,
        lastClientSnapshotToShadowTickDelta: getSnapshotToShadowTickDelta(
            lastClientSnapshotTick,
            lastShadowSnapshotTick,
        ),
        lastClientSnapshotPieceIndex,
        lastShadowSnapshotPieceIndex,
        lastClientSnapshotToShadowPieceIndexDelta,
        lastClientSnapshotToShadowPieceIndexDirection: getPieceIndexDirection(
            lastClientSnapshotToShadowPieceIndexDelta,
        ),
        lastClientSnapshotPhase,
        lastShadowSnapshotPhase,
        lastClientSnapshotPhaseMismatch: getSnapshotPhaseMismatch(
            lastClientSnapshotPhase,
            lastShadowSnapshotPhase,
        ),
        lastClientSnapshotFallIntervalMs: getSnapshotFallIntervalMs(player.lastClientSnapshot),
        lastShadowSnapshotFallIntervalMs: getSnapshotFallIntervalMs(player.lastShadowSnapshot),
        lastClientSnapshotToShadowFallIntervalDelta: getNumberDelta(
            player.lastClientSnapshot?.fallIntervalMs,
            player.lastShadowSnapshot?.fallIntervalMs,
        ),
        lastClientSnapshotCombo: getSnapshotCombo(player.lastClientSnapshot),
        lastShadowSnapshotCombo: getSnapshotCombo(player.lastShadowSnapshot),
        lastClientSnapshotToShadowComboDelta: getNumberDelta(
            player.lastClientSnapshot?.combo,
            player.lastShadowSnapshot?.combo,
        ),
        lastClientSnapshotBackToBack: getSnapshotBackToBack(player.lastClientSnapshot),
        lastShadowSnapshotBackToBack: getSnapshotBackToBack(player.lastShadowSnapshot),
        lastClientSnapshotBackToBackMismatch: getSnapshotBackToBackMismatch(
            player.lastClientSnapshot,
            player.lastShadowSnapshot,
        ),
        lastClientSnapshotPieceQueue: cloneSnapshot(player.lastClientSnapshot?.pieceQueue),
        lastShadowSnapshotPieceQueue: cloneSnapshot(player.lastShadowSnapshot?.pieceQueue),
        lastClientSnapshotHoldPieceType: player.lastClientSnapshot?.holdPieceType ?? null,
        lastShadowSnapshotHoldPieceType: player.lastShadowSnapshot?.holdPieceType ?? null,
        lastClientSnapshotHoldUsedThisDrop: getSnapshotHoldUsedThisDrop(player.lastClientSnapshot),
        lastShadowSnapshotHoldUsedThisDrop: getSnapshotHoldUsedThisDrop(player.lastShadowSnapshot),
        lastClientSnapshotBoardChecksum,
        lastShadowSnapshotBoardChecksum,
        lastClientSnapshotBoardMismatch: getSnapshotBoardMismatch(
            lastClientSnapshotBoardChecksum,
            lastShadowSnapshotBoardChecksum,
        ),
        lastClientSnapshotBoardDiffCellCount: lastClientSnapshotBoardDiff.diffCellCount,
        lastClientSnapshotFirstBoardDiff: lastClientSnapshotBoardDiff.firstDiff,
        lastClientSnapshotActivePieceTypeChanged: lastClientSnapshotActivePieceDiff.typeChanged,
        lastClientSnapshotActivePieceRotationDelta: lastClientSnapshotActivePieceDiff.rotationDelta,
        lastClientSnapshotActivePieceRowDelta: lastClientSnapshotActivePieceDiff.rowDelta,
        lastClientSnapshotActivePieceColDelta: lastClientSnapshotActivePieceDiff.colDelta,
        lastActionableDesync,
        lastActionableDesyncSeverity: lastActionableDesync?.severity ?? null,
        lastActionableDesyncReason: lastActionableDesync?.primaryReason ?? null,
        lastActionableDesyncFields: getDesyncFields(lastActionableDesync),
        nextInvestigationHint: getNextInvestigationHint(
            lastActionableDesync,
            lastPlacementComparisonLog ?? player.lastPlacementComparison,
        ),
        lastActionableDesyncTickDelta,
        lastActionableDesyncPieceIndexDelta,
        lastDesyncTickDelta,
        maxAbsoluteDesyncTickDelta,
        lastDesyncPieceIndexDelta,
        maxAbsoluteDesyncPieceIndexDelta,
        lastDesync,
        lastDesyncSeverity: lastDesync?.severity ?? null,
        lastDesyncReason: lastDesync?.primaryReason ?? null,
        lastDesyncFields: getDesyncFields(lastDesync),
    };
}

function getSnapshotTick(snapshot) {
    return Number.isInteger(snapshot?.tick) ? snapshot.tick : null;
}

function getSnapshotPieceIndex(snapshot) {
    return Number.isInteger(snapshot?.pieceIndex) ? snapshot.pieceIndex : null;
}

function getSnapshotPhase(snapshot) {
    return typeof snapshot?.phase === "string" ? snapshot.phase : null;
}

function getSnapshotFallIntervalMs(snapshot) {
    return Number.isFinite(snapshot?.fallIntervalMs) ? snapshot.fallIntervalMs : null;
}

function getPlacementNumber(placementResult, field) {
    return Number.isFinite(placementResult?.[field]) ? placementResult[field] : null;
}

function getPlacementBoolean(placementResult, field) {
    return typeof placementResult?.[field] === "boolean" ? placementResult[field] : null;
}

function getPlacementComparisonMismatch(comparison) {
    if (!comparison) return null;

    return comparison.fields.length > 0;
}

function getPlacementComparisonFields(comparison) {
    if (!comparison) return null;

    return [...comparison.fields];
}

function getPlacementDetailDelta(comparison, field) {
    const delta = comparison?.details?.[field]?.delta;
    return Number.isFinite(delta) ? delta : null;
}

function getSnapshotCombo(snapshot) {
    return Number.isInteger(snapshot?.combo) ? snapshot.combo : null;
}

function getSnapshotBackToBack(snapshot) {
    return typeof snapshot?.backToBack === "boolean" ? snapshot.backToBack : null;
}

function getSnapshotBackToBackMismatch(clientSnapshot, shadowSnapshot) {
    const clientBackToBack = getSnapshotBackToBack(clientSnapshot);
    const shadowBackToBack = getSnapshotBackToBack(shadowSnapshot);
    if (clientBackToBack === null || shadowBackToBack === null) {
        return null;
    }

    return clientBackToBack !== shadowBackToBack;
}

function getSnapshotHoldUsedThisDrop(snapshot) {
    if (!snapshot || typeof snapshot.holdUsedThisDrop !== "boolean") {
        return null;
    }

    return snapshot.holdUsedThisDrop;
}

function getDesyncFields(desync) {
    if (!Array.isArray(desync?.fields)) {
        return null;
    }

    return [...desync.fields];
}

function getNextInvestigationHint(desync, placementComparison = null) {
    const reason = desync?.primaryReason;

    if (reason === "PIECE_QUEUE_MISMATCH") {
        return "CHECK_QUEUE_FLOW";
    }

    if (reason === "HOLD_STATE_MISMATCH") {
        return "CHECK_HOLD_FLOW";
    }

    if (reason === "BOARD_MISMATCH") {
        return "CHECK_BOARD_LINE_CLEAR_GARBAGE_FLOW";
    }

    if (reason === "GARBAGE_MISMATCH") {
        return "CHECK_GARBAGE_QUEUE_CANCEL_FLOW";
    }

    if (reason === "LINE_CLEAR_MISMATCH") {
        return "CHECK_LINE_CLEAR_FLOW";
    }

    if (reason === "PIECE_INDEX_MISMATCH") {
        return "CHECK_LOCK_SPAWN_TIMING";
    }

    if (reason === "PHASE_MISMATCH") {
        return "CHECK_PHASE_TRANSITION";
    }

    if (reason === "FALL_INTERVAL_MISMATCH") {
        return "CHECK_LEVEL_SPEED_FLOW";
    }

    if (reason === "ATTACK_STATE_MISMATCH") {
        return "CHECK_ATTACK_STATE_FLOW";
    }

    if (reason === "SCORE_MISMATCH") {
        return "CHECK_SCORE_RULES";
    }

    if (reason === "ACTIVE_PIECE_OFFSET") {
        return getActivePieceInvestigationHint(desync);
    }

    if (!reason) {
        return getPlacementInvestigationHint(placementComparison);
    }

    return "CHECK_STATE_TRANSITION";
}

function getPlacementInvestigationHint(placementComparison) {
    const fields = getPlacementComparisonFields(placementComparison);
    if (!fields) {
        return null;
    }

    const pieceIndexDelta = getDesyncPieceIndexDelta(placementComparison);
    if (pieceIndexDelta !== null && pieceIndexDelta !== 0) {
        return "CHECK_PLACEMENT_LOCK_SPAWN_ORDER";
    }

    if (
        fields.includes("attackLines")
        || fields.includes("canceledGarbageLines")
        || fields.includes("incomingGarbageLines")
        || fields.includes("appliedGarbageLines")
        || fields.includes("rawAttackLines")
    ) {
        return "CHECK_PLACEMENT_GARBAGE_RESULT_FLOW";
    }

    if (
        fields.includes("combo")
        || fields.includes("backToBack")
        || fields.includes("isTSpin")
    ) {
        return "CHECK_PLACEMENT_ATTACK_RULE_FLOW";
    }

    if (fields.includes("linesCleared")) {
        return "CHECK_PLACEMENT_LINE_CLEAR_RESULT_FLOW";
    }

    if (
        fields.includes("scoreBefore")
        || fields.includes("scoreAfter")
        || fields.includes("scoreDelta")
    ) {
        return "CHECK_PLACEMENT_SCORE_RESULT_FLOW";
    }

    if (fields.includes("gameOver")) {
        return "CHECK_PLACEMENT_GAME_OVER_FLOW";
    }

    return "CHECK_PLACEMENT_RESULT_FLOW";
}

function getActivePieceInvestigationHint(desync) {
    const diff = createActivePieceDiffSummary(
        desync?.details?.activePiece?.client,
        desync?.details?.activePiece?.shadow,
    );

    if (diff.typeChanged) {
        return "CHECK_QUEUE_HOLD_SPAWN_FLOW";
    }

    if (diff.rotationDelta !== null && diff.rotationDelta !== 0) {
        return "CHECK_ROTATION_WALL_KICK_FLOW";
    }

    const hasRowOffset = diff.rowDelta !== null && diff.rowDelta !== 0;
    const hasColOffset = diff.colDelta !== null && diff.colDelta !== 0;
    if (hasRowOffset || hasColOffset) {
        return "CHECK_INPUT_GRAVITY_POSITION_ORDER";
    }

    return "CHECK_INPUT_ROTATION_GRAVITY_ORDER";
}

function createBoardChecksum(board) {
    if (!Array.isArray(board)) return null;

    const serializedBoard = JSON.stringify(board);
    let hash = 5381;

    for (let i = 0; i < serializedBoard.length; i++) {
        hash = ((hash << 5) + hash) ^ serializedBoard.charCodeAt(i);
        hash >>>= 0;
    }

    return hash.toString(16).padStart(8, "0");
}

function createBoardDiffSummary(clientBoard, shadowBoard) {
    if (!Array.isArray(clientBoard) || !Array.isArray(shadowBoard)) {
        return {
            diffCellCount: 0,
            firstDiff: null,
        };
    }

    const rowCount = Math.max(clientBoard.length, shadowBoard.length);
    let diffCellCount = 0;
    let firstDiff = null;

    for (let row = 0; row < rowCount; row++) {
        const clientRow = Array.isArray(clientBoard[row]) ? clientBoard[row] : [];
        const shadowRow = Array.isArray(shadowBoard[row]) ? shadowBoard[row] : [];
        const colCount = Math.max(clientRow.length, shadowRow.length);

        for (let col = 0; col < colCount; col++) {
            const client = clientRow[col] ?? null;
            const shadow = shadowRow[col] ?? null;

            if (isSameValue(client, shadow)) continue;

            diffCellCount++;
            if (!firstDiff) {
                firstDiff = {
                    row,
                    col,
                    client,
                    shadow,
                };
            }
        }
    }

    return {
        diffCellCount,
        firstDiff,
    };
}

function createActivePieceDiffSummary(clientPiece, shadowPiece) {
    return {
        typeChanged: getPieceTypeChanged(clientPiece, shadowPiece),
        rotationDelta: getNumberDelta(clientPiece?.rotation, shadowPiece?.rotation),
        rowDelta: getNumberDelta(clientPiece?.row, shadowPiece?.row),
        colDelta: getNumberDelta(clientPiece?.col, shadowPiece?.col),
    };
}

function getPieceTypeChanged(clientPiece, shadowPiece) {
    if (typeof clientPiece?.pieceType !== "string" || typeof shadowPiece?.pieceType !== "string") {
        return null;
    }

    return clientPiece.pieceType !== shadowPiece.pieceType;
}

function getNumberDelta(clientValue, shadowValue) {
    if (!Number.isFinite(clientValue) || !Number.isFinite(shadowValue)) {
        return null;
    }

    return clientValue - shadowValue;
}

function getSnapshotToShadowTickDelta(clientTick, shadowTick) {
    if (!Number.isInteger(clientTick) || !Number.isInteger(shadowTick)) {
        return null;
    }

    return clientTick - shadowTick;
}

function getSnapshotToShadowPieceIndexDelta(clientPieceIndex, shadowPieceIndex) {
    if (!Number.isInteger(clientPieceIndex) || !Number.isInteger(shadowPieceIndex)) {
        return null;
    }

    return clientPieceIndex - shadowPieceIndex;
}

function getPieceIndexDirection(pieceIndexDelta) {
    if (!Number.isInteger(pieceIndexDelta)) {
        return null;
    }

    if (pieceIndexDelta > 0) {
        return "client_ahead";
    }

    if (pieceIndexDelta < 0) {
        return "shadow_ahead";
    }

    return "in_sync";
}

function getSnapshotPhaseMismatch(clientPhase, shadowPhase) {
    if (clientPhase === null || shadowPhase === null) {
        return null;
    }

    return clientPhase !== shadowPhase;
}

function getSnapshotBoardMismatch(clientBoardChecksum, shadowBoardChecksum) {
    if (clientBoardChecksum === null || shadowBoardChecksum === null) {
        return null;
    }

    return clientBoardChecksum !== shadowBoardChecksum;
}

function getShadowHealth(desyncLog, actionableDesyncLog) {
    if (actionableDesyncLog.length > 0) {
        return "needs_attention";
    }

    if (desyncLog.length > 0) {
        return "info_only";
    }

    return "stable";
}

function getPlacementResultHealth(placementComparisonLog) {
    return placementComparisonLog.length > 0 ? "needs_attention" : "stable";
}

function countPlacementComparisonAlignment(placementComparisonLog) {
    return placementComparisonLog.reduce((counts, entry) => {
        const pieceIndexDelta = getDesyncPieceIndexDelta(entry);

        if (pieceIndexDelta === null) {
            counts.unknown += 1;
            return counts;
        }

        if (pieceIndexDelta === 0) {
            counts.samePiece += 1;
            return counts;
        }

        counts.outOfOrder += 1;
        return counts;
    }, {
        samePiece: 0,
        outOfOrder: 0,
        unknown: 0,
    });
}

function countPlacementInvestigationHints(placementComparisonLog) {
    return placementComparisonLog.reduce((counts, entry) => {
        const hint = getPlacementInvestigationHint(entry);
        if (!hint) {
            return counts;
        }

        counts[hint] = (counts[hint] ?? 0) + 1;
        return counts;
    }, {});
}

function getDominantPlacementInvestigationHint(hintCounts) {
    return Object.entries(hintCounts).reduce((dominant, [hint, count]) => {
        if (count <= dominant.count) return dominant;

        return {
            hint,
            count,
        };
    }, {
        hint: null,
        count: 0,
    });
}

function getPlacementDriftLevel(alignmentCounts, maxAbsolutePieceIndexDelta) {
    const samePieceCount = alignmentCounts?.samePiece ?? 0;
    const outOfOrderCount = alignmentCounts?.outOfOrder ?? 0;
    const unknownCount = alignmentCounts?.unknown ?? 0;

    if (samePieceCount + outOfOrderCount + unknownCount === 0) {
        return "none";
    }

    if (outOfOrderCount > 0) {
        return maxAbsolutePieceIndexDelta >= 2
            ? "major_order_drift"
            : "minor_order_drift";
    }

    if (samePieceCount > 0) {
        return "same_piece_mismatch";
    }

    return "unknown";
}

function getPlacementAttentionLevel(driftLevel) {
    if (driftLevel === "none") {
        return "stable";
    }

    if (driftLevel === "major_order_drift") {
        return "critical";
    }

    return "needs_attention";
}

function getOverallShadowHealth(shadowHealth, placementResultHealth) {
    if (shadowHealth === "needs_attention" || placementResultHealth === "needs_attention") {
        return "needs_attention";
    }

    if (shadowHealth === "info_only" || placementResultHealth === "info_only") {
        return "info_only";
    }

    return "stable";
}

function getInputToShadowTickDelta(input, player) {
    if (!Number.isInteger(input?.tick) || !Number.isInteger(player?.shadowTick)) {
        return null;
    }

    return input.tick - player.shadowTick;
}

function getInputToClientSnapshotTickDelta(input, clientSnapshotTick) {
    if (!Number.isInteger(input?.tick) || !Number.isInteger(clientSnapshotTick)) {
        return null;
    }

    return clientSnapshotTick - input.tick;
}

function isActionableDesync(entry) {
    return entry?.severity !== "info";
}

function countDesyncReasons(desyncLog) {
    return desyncLog.reduce((counts, entry) => {
        const reason = entry.primaryReason ?? "UNKNOWN";
        counts[reason] = (counts[reason] ?? 0) + 1;

        return counts;
    }, {});
}

function countDesyncFields(desyncLog) {
    return desyncLog.reduce((counts, entry) => {
        if (!Array.isArray(entry?.fields)) {
            return counts;
        }

        entry.fields.forEach((field) => {
            counts[field] = (counts[field] ?? 0) + 1;
        });

        return counts;
    }, {});
}

function getDesyncTickDelta(desync) {
    if (!Number.isInteger(desync?.clientTick) || !Number.isInteger(desync?.shadowTick)) {
        return null;
    }

    return desync.clientTick - desync.shadowTick;
}

function getMaxAbsoluteDesyncTickDelta(desyncLog) {
    return desyncLog.reduce((maxDelta, entry) => {
        const tickDelta = getDesyncTickDelta(entry);
        if (tickDelta === null) return maxDelta;

        return Math.max(maxDelta, Math.abs(tickDelta));
    }, 0);
}

function getDesyncPieceIndexDelta(desync) {
    if (
        !Number.isInteger(desync?.clientPieceIndex)
        || !Number.isInteger(desync?.shadowPieceIndex)
    ) {
        return null;
    }

    return desync.clientPieceIndex - desync.shadowPieceIndex;
}

function getMaxAbsoluteDesyncPieceIndexDelta(desyncLog) {
    return desyncLog.reduce((maxDelta, entry) => {
        const pieceIndexDelta = getDesyncPieceIndexDelta(entry);
        if (pieceIndexDelta === null) return maxDelta;

        return Math.max(maxDelta, Math.abs(pieceIndexDelta));
    }, 0);
}

function getDominantDesyncReason(desyncReasonCounts) {
    return Object.entries(desyncReasonCounts).reduce((dominant, [reason, count]) => {
        if (count <= dominant.count) return dominant;

        return {
            reason,
            count,
        };
    }, {
        reason: null,
        count: 0,
    });
}

function getDominantDesyncField(desyncFieldCounts) {
    return Object.entries(desyncFieldCounts).reduce((dominant, [field, count]) => {
        if (count <= dominant.count) return dominant;

        return {
            field,
            count,
        };
    }, {
        field: null,
        count: 0,
    });
}

function trimDesyncLog(player) {
    if (player.desyncLog.length <= MAX_DESYNC_LOG_SIZE) return;

    player.desyncLog.splice(0, player.desyncLog.length - MAX_DESYNC_LOG_SIZE);
}

function findMatchPlayer(roomId, playerId) {
    const match = matches.get(roomId);

    if (!match) {
        return {
            ok: false,
            reason: "MATCH_NOT_FOUND",
        };
    }

    const player = match.players.find((matchPlayer) => {
        return matchPlayer.playerId === playerId;
    });

    if (!player) {
        return {
            ok: false,
            reason: "PLAYER_NOT_FOUND",
        };
    }

    return {
        ok: true,
        match,
        player,
    };
}

function cloneSnapshot(snapshot) {
    if (!snapshot) return null;

    return JSON.parse(JSON.stringify(snapshot));
}

function findDesyncedFields(clientSnapshot, shadowSnapshot) {
    const fields = [];

    if (!isSameValue(clientSnapshot?.pieceIndex, shadowSnapshot?.pieceIndex)) {
        fields.push("pieceIndex");
    }

    if (!isSameValue(clientSnapshot?.phase, shadowSnapshot?.phase)) {
        fields.push("phase");
    }

    if (!isSameValue(clientSnapshot?.fallIntervalMs, shadowSnapshot?.fallIntervalMs)) {
        fields.push("fallIntervalMs");
    }

    if (!isSameValue(clientSnapshot?.combo, shadowSnapshot?.combo)) {
        fields.push("combo");
    }

    if (!isSameValue(clientSnapshot?.backToBack, shadowSnapshot?.backToBack)) {
        fields.push("backToBack");
    }

    if (!isSameValue(clientSnapshot?.score, shadowSnapshot?.score)) {
        fields.push("score");
    }

    if (!isSameValue(clientSnapshot?.linesClearedTotal, shadowSnapshot?.linesClearedTotal)) {
        fields.push("linesClearedTotal");
    }

    if (!isSameValue(
        getPendingGarbageLines(clientSnapshot?.pendingGarbageQueue),
        getPendingGarbageLines(shadowSnapshot?.pendingGarbageQueue),
    )) {
        fields.push("pendingGarbageLines");
    }

    if (!isSameValue(clientSnapshot?.pieceQueue, shadowSnapshot?.pieceQueue)) {
        fields.push("pieceQueue");
    }

    if (!isSameValue(clientSnapshot?.holdPieceType, shadowSnapshot?.holdPieceType)) {
        fields.push("holdPieceType");
    }

    if (!isSameValue(clientSnapshot?.holdUsedThisDrop, shadowSnapshot?.holdUsedThisDrop)) {
        fields.push("holdUsedThisDrop");
    }

    if (!isSameValue(clientSnapshot?.activePiece, shadowSnapshot?.activePiece)) {
        fields.push("activePiece");
    }

    if (!isSameValue(clientSnapshot?.board, shadowSnapshot?.board)) {
        fields.push("board");
    }

    return fields;
}

function classifyDesync(clientSnapshot, shadowSnapshot, fields) {
    if (clientSnapshot?.phase === "gameOver" || shadowSnapshot?.phase === "gameOver") {
        return {
            severity: "info",
            primaryReason: "POST_GAME_SNAPSHOT",
        };
    }

    if (clientSnapshot?.phase === "lineClearing" || shadowSnapshot?.phase === "lineClearing") {
        return {
            severity: "info",
            primaryReason: "LINE_CLEAR_ANIMATION_SNAPSHOT",
        };
    }

    if (fields.includes("pieceIndex")) {
        return {
            severity: "high",
            primaryReason: "PIECE_INDEX_MISMATCH",
        };
    }

    if (fields.includes("phase")) {
        return {
            severity: "high",
            primaryReason: "PHASE_MISMATCH",
        };
    }

    if (fields.includes("fallIntervalMs")) {
        return {
            severity: "medium",
            primaryReason: "FALL_INTERVAL_MISMATCH",
        };
    }

    if (fields.includes("combo") || fields.includes("backToBack")) {
        return {
            severity: "medium",
            primaryReason: "ATTACK_STATE_MISMATCH",
        };
    }

    if (fields.includes("pieceQueue")) {
        return {
            severity: "high",
            primaryReason: "PIECE_QUEUE_MISMATCH",
        };
    }

    if (fields.includes("holdPieceType") || fields.includes("holdUsedThisDrop")) {
        return {
            severity: "high",
            primaryReason: "HOLD_STATE_MISMATCH",
        };
    }

    if (fields.includes("board")) {
        return {
            severity: "medium",
            primaryReason: "BOARD_MISMATCH",
        };
    }

    if (fields.includes("pendingGarbageLines")) {
        return {
            severity: "medium",
            primaryReason: "GARBAGE_MISMATCH",
        };
    }

    if (fields.includes("linesClearedTotal")) {
        return {
            severity: "medium",
            primaryReason: "LINE_CLEAR_MISMATCH",
        };
    }

    if (fields.includes("score") && fields.includes("activePiece")) {
        return {
            severity: "medium",
            primaryReason: "SCORE_AND_ACTIVE_PIECE_MISMATCH",
        };
    }

    if (fields.includes("score")) {
        return {
            severity: "medium",
            primaryReason: "SCORE_MISMATCH",
        };
    }

    if (fields.length === 1 && fields.includes("activePiece")) {
        return {
            severity: "low",
            primaryReason: "ACTIVE_PIECE_OFFSET",
        };
    }

    return {
        severity: "medium",
        primaryReason: "STATE_MISMATCH",
    };
}

function createDesyncDetails(clientSnapshot, shadowSnapshot, fields) {
    const details = {};

    if (fields.includes("pieceIndex")) {
        details.pieceIndex = createNumericDetail(clientSnapshot?.pieceIndex, shadowSnapshot?.pieceIndex);
    }

    if (fields.includes("phase")) {
        details.phase = {
            client: clientSnapshot?.phase ?? null,
            shadow: shadowSnapshot?.phase ?? null,
        };
    }

    if (fields.includes("score")) {
        details.score = createNumericDetail(clientSnapshot?.score, shadowSnapshot?.score);
    }

    if (fields.includes("fallIntervalMs")) {
        details.fallIntervalMs = createNumericDetail(
            clientSnapshot?.fallIntervalMs,
            shadowSnapshot?.fallIntervalMs,
        );
    }

    if (fields.includes("combo")) {
        details.combo = createNumericDetail(clientSnapshot?.combo, shadowSnapshot?.combo);
    }

    if (fields.includes("backToBack")) {
        details.backToBack = {
            client: typeof clientSnapshot?.backToBack === "boolean" ? clientSnapshot.backToBack : null,
            shadow: typeof shadowSnapshot?.backToBack === "boolean" ? shadowSnapshot.backToBack : null,
        };
    }

    if (fields.includes("linesClearedTotal")) {
        details.linesClearedTotal = createNumericDetail(
            clientSnapshot?.linesClearedTotal,
            shadowSnapshot?.linesClearedTotal,
        );
    }

    if (fields.includes("pendingGarbageLines")) {
        details.pendingGarbageLines = createNumericDetail(
            getPendingGarbageLines(clientSnapshot?.pendingGarbageQueue),
            getPendingGarbageLines(shadowSnapshot?.pendingGarbageQueue),
        );
    }

    if (fields.includes("pieceQueue")) {
        details.pieceQueue = {
            client: cloneSnapshot(clientSnapshot?.pieceQueue),
            shadow: cloneSnapshot(shadowSnapshot?.pieceQueue),
        };
    }

    if (fields.includes("holdPieceType")) {
        details.holdPieceType = {
            client: clientSnapshot?.holdPieceType ?? null,
            shadow: shadowSnapshot?.holdPieceType ?? null,
        };
    }

    if (fields.includes("holdUsedThisDrop")) {
        details.holdUsedThisDrop = {
            client: Boolean(clientSnapshot?.holdUsedThisDrop),
            shadow: Boolean(shadowSnapshot?.holdUsedThisDrop),
        };
    }

    if (fields.includes("activePiece")) {
        details.activePiece = {
            client: cloneSnapshot(clientSnapshot?.activePiece),
            shadow: cloneSnapshot(shadowSnapshot?.activePiece),
        };
    }

    if (fields.includes("board")) {
        details.board = {
            client: cloneSnapshot(clientSnapshot?.board),
            shadow: cloneSnapshot(shadowSnapshot?.board),
        };
    }

    return details;
}

function createNumericDetail(clientValue, shadowValue) {
    const client = Number.isFinite(clientValue) ? clientValue : null;
    const shadow = Number.isFinite(shadowValue) ? shadowValue : null;

    return {
        client,
        shadow,
        delta: Number.isFinite(client) && Number.isFinite(shadow)
            ? client - shadow
            : null,
    };
}

function createPlacementResultComparison(clientPlacementResult, shadowPlacementResult) {
    const client = clonePlacementResult(clientPlacementResult);
    const shadow = clonePlacementResult(shadowPlacementResult);
    const fields = PLACEMENT_RESULT_FIELDS.filter((field) => {
        return !isSameValue(client[field], shadow[field]);
    });
    const details = fields.reduce((result, field) => {
        result[field] = createPlacementDetail(client[field], shadow[field]);
        return result;
    }, {});

    return {
        fields,
        details,
        client,
        shadow,
    };
}

function clonePlacementResult(placementResult) {
    return PLACEMENT_RESULT_FIELDS.reduce((result, field) => {
        if (placementResult && field in placementResult) {
            result[field] = cloneJsonValue(placementResult[field]);
        } else {
            result[field] = null;
        }

        return result;
    }, {});
}

function cloneJsonValue(value) {
    if (value === undefined || value === null) {
        return null;
    }

    return JSON.parse(JSON.stringify(value));
}

function createPlacementDetail(clientValue, shadowValue) {
    if (Number.isFinite(clientValue) || Number.isFinite(shadowValue)) {
        return createNumericDetail(clientValue, shadowValue);
    }

    return {
        client: clientValue ?? null,
        shadow: shadowValue ?? null,
    };
}

function getPendingGarbageLines(pendingGarbageQueue) {
    if (!Array.isArray(pendingGarbageQueue)) return 0;

    return pendingGarbageQueue.reduce((total, garbage) => {
        return total + (Number.isInteger(garbage?.lines) && garbage.lines > 0 ? garbage.lines : 0);
    }, 0);
}

function isSameValue(left, right) {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function resetMatches() {
    shadowLoopTimers.forEach((timer) => {
        clearInterval(timer);
    });
    shadowLoopTimers.clear();
    matches.clear();
}

module.exports = {
    advanceShadowMatch,
    appendPlayerBagChunk,
    createMatch,
    deleteMatch,
    getPlayerAuthoritativeSnapshot,
    getPlayerShadowState,
    getMatchState,
    recordClientPlacementDecision,
    recordClientSnapshot,
    recordGarbageAttack,
    recordInput,
    recordShadowSnapshot,
    resetMatches,
    startShadowMatchLoop,
    stopShadowMatchLoop,
};
