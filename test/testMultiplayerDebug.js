const test = require("node:test");
const assert = require("node:assert/strict");

async function loadDebugHelpers() {
    return import("../src/client/game/debug/multiplayerDebug.js");
}

test("isMultiplayerDebugEnabled는 debug=1 또는 debug=true에서만 활성화한다", async () => {
    const { isMultiplayerDebugEnabled } = await loadDebugHelpers();

    assert.equal(isMultiplayerDebugEnabled("?debug=1"), true);
    assert.equal(isMultiplayerDebugEnabled("?debug=true"), true);
    assert.equal(isMultiplayerDebugEnabled("?roomId=ABCD1234&debug=1"), true);
    assert.equal(isMultiplayerDebugEnabled("?debug=0"), false);
    assert.equal(isMultiplayerDebugEnabled(""), false);
});

test("appendMultiplayerDebugParam은 로비 debug 플래그를 게임 URL로 전달한다", async () => {
    const { appendMultiplayerDebugParam } = await loadDebugHelpers();

    assert.equal(
        appendMultiplayerDebugParam("/pages/tetrisMulti.html?roomId=ABCD1234", "?debug=1"),
        "/pages/tetrisMulti.html?roomId=ABCD1234&debug=1",
    );
    assert.equal(
        appendMultiplayerDebugParam("/pages/tetrisMulti.html?roomId=ABCD1234", "?debug=true"),
        "/pages/tetrisMulti.html?roomId=ABCD1234&debug=1",
    );
    assert.equal(
        appendMultiplayerDebugParam("/pages/tetrisMulti.html?roomId=ABCD1234", ""),
        "/pages/tetrisMulti.html?roomId=ABCD1234",
    );
});

test("appendMultiplayerDebugParam은 authoritativeApply=opponent 실험 플래그도 게임 URL로 전달한다", async () => {
    const { appendMultiplayerDebugParam } = await loadDebugHelpers();

    assert.equal(
        appendMultiplayerDebugParam(
            "/pages/tetrisMulti.html?roomId=ABCD1234",
            "?debug=1&authoritativeApply=opponent&resetPlayer=1",
        ),
        "/pages/tetrisMulti.html?roomId=ABCD1234&debug=1&authoritativeApply=opponent",
    );
});

test("createMultiplayerDebugModeLabel은 debug panel에 표시할 현재 mode 텍스트를 만든다", async () => {
    const { createMultiplayerDebugModeLabel } = await loadDebugHelpers();

    assert.equal(
        createMultiplayerDebugModeLabel({
            debugEnabled: true,
            authoritativeApplyMode: "opponent",
        }),
        "Debug on | Apply opponent",
    );
    assert.equal(
        createMultiplayerDebugModeLabel({
            debugEnabled: true,
            authoritativeApplyMode: "off",
        }),
        "Debug on | Apply off",
    );
    assert.equal(
        createMultiplayerDebugModeLabel({
            debugEnabled: false,
            authoritativeApplyMode: "opponent",
        }),
        "Debug off | Apply off",
    );
});

test("createAuthoritativeRouteStatusLabel은 마지막 server snapshot route 상태를 표시한다", async () => {
    const { createAuthoritativeRouteStatusLabel } = await loadDebugHelpers();

    assert.equal(
        createAuthoritativeRouteStatusLabel(
            {
                ok: true,
                target: "opponent",
                updateSequence: 12,
            },
            {
                applied: true,
                reason: null,
            },
        ),
        "Route opponent | Applied yes | Seq 12",
    );
    assert.equal(
        createAuthoritativeRouteStatusLabel(
            {
                ok: true,
                target: "local",
                updateSequence: 13,
            },
            {
                applied: false,
                reason: "TARGET_NOT_ALLOWED",
            },
        ),
        "Route local | Applied no | TARGET_NOT_ALLOWED | Seq 13",
    );
    assert.equal(createAuthoritativeRouteStatusLabel(null, null), "Route waiting");
});

test("createAuthoritativeRouteStatusTracker는 opponent 적용 성공이 local 차단에 가려지지 않게 누적 표시한다", async () => {
    const { createAuthoritativeRouteStatusTracker } = await loadDebugHelpers();
    const tracker = createAuthoritativeRouteStatusTracker();

    assert.equal(tracker.getLabel(), "Route waiting");

    assert.equal(
        tracker.record(
            {
                ok: true,
                target: "opponent",
                updateSequence: 20,
            },
            {
                applied: true,
                reason: null,
            },
        ),
        "Opponent applied 1 | Local blocked 0 | Last opponent seq 20",
    );

    assert.equal(
        tracker.record(
            {
                ok: true,
                target: "local",
                updateSequence: 20,
            },
            {
                applied: false,
                reason: "TARGET_NOT_ALLOWED",
            },
        ),
        "Opponent applied 1 | Local blocked 1 | Last opponent seq 20",
    );
});

test("createAuthoritativeRouteStatusTracker는 구독 실패 사유를 표시한다", async () => {
    const { createAuthoritativeRouteStatusTracker } = await loadDebugHelpers();
    const tracker = createAuthoritativeRouteStatusTracker();

    assert.equal(
        tracker.recordSubscribeResult({ ok: false, reason: "NOT_AUTHORIZED" }),
        "Route subscribe failed | NOT_AUTHORIZED",
    );
});

test("createDebugAutoInputController는 start/stop 동안만 runAction을 반복 실행한다", async () => {
    const { createDebugAutoInputController } = await loadDebugHelpers();
    let runCount = 0;
    const controller = createDebugAutoInputController({
        intervalMs: 5,
        runAction() {
            runCount++;
        },
    });

    assert.equal(controller.isRunning(), false);
    controller.start();
    assert.equal(controller.isRunning(), true);

    await new Promise(resolve => setTimeout(resolve, 18));
    controller.stop();
    const stoppedAt = runCount;

    await new Promise(resolve => setTimeout(resolve, 18));
    assert.equal(controller.isRunning(), false);
    assert.ok(stoppedAt > 0);
    assert.equal(runCount, stoppedAt);
});

test("createShadowSummaryDebugRow는 shadow summary 핵심 진단값을 콘솔용 row로 변환한다", async () => {
    const { createShadowSummaryDebugRow } = await loadDebugHelpers();

    const row = createShadowSummaryDebugRow({
        shadowHealth: "needs_attention",
        recentShadowHealth: "info_only",
        overallShadowHealth: "needs_attention",
        recentOverallShadowHealth: "needs_attention",
        dominantDesyncReason: "PIECE_INDEX_MISMATCH",
        dominantDesyncCount: 4,
        recentDominantDesyncReason: "LINE_CLEAR_ANIMATION_SNAPSHOT",
        recentDominantDesyncCount: 2,
        dominantActionableDesyncReason: "SCORE_MISMATCH",
        dominantActionableDesyncCount: 3,
        dominantActionableDesyncField: "score",
        dominantActionableDesyncFieldCount: 4,
        actionableDesyncCount: 5,
        recentDominantActionableDesyncReason: null,
        recentDominantActionableDesyncCount: 0,
        recentDominantActionableDesyncField: "activePiece",
        recentDominantActionableDesyncFieldCount: 2,
        recentActionableDesyncCount: 0,
        lastActionableDesyncReason: "GARBAGE_MISMATCH",
        lastActionableDesyncSeverity: "medium",
        lastActionableDesyncFields: ["pendingGarbageLines", "board"],
        lastActionableDesyncTickDelta: 1,
        lastActionableDesyncPieceIndexDelta: 0,
        lastShadowInputAction: "hard_drop",
        lastShadowInputTick: 118,
        lastShadowInputPieceIndex: 8,
        lastShadowInputSequence: 12,
        lastShadowInputToShadowTickDelta: -2,
        lastShadowInputToClientSnapshotTickDelta: 22,
        lastClientSnapshotTick: 140,
        lastShadowSnapshotTick: 120,
        lastClientSnapshotToShadowTickDelta: 20,
        lastClientSnapshotPieceIndex: 9,
        lastShadowSnapshotPieceIndex: 8,
        lastClientSnapshotToShadowPieceIndexDelta: 1,
        lastClientSnapshotToShadowPieceIndexDirection: "client_ahead",
        lastClientSnapshotPhase: "lineClearing",
        lastShadowSnapshotPhase: "playing",
        lastClientSnapshotPhaseMismatch: true,
        lastClientSnapshotFallIntervalMs: 700,
        lastShadowSnapshotFallIntervalMs: 800,
        lastClientSnapshotToShadowFallIntervalDelta: -100,
        lastClientSnapshotCombo: 2,
        lastShadowSnapshotCombo: 1,
        lastClientSnapshotToShadowComboDelta: 1,
        lastClientSnapshotBackToBack: false,
        lastShadowSnapshotBackToBack: true,
        lastClientSnapshotBackToBackMismatch: true,
        lastShadowPlacementLinesCleared: 4,
        lastShadowPlacementRawAttackLines: 4,
        lastShadowPlacementAttackLines: 2,
        lastShadowPlacementCanceledGarbageLines: 2,
        lastShadowPlacementIncomingGarbageLines: 2,
        lastShadowPlacementAppliedGarbageLines: 0,
        lastShadowPlacementScoreBefore: 10,
        lastShadowPlacementScoreAfter: 40,
        lastShadowPlacementScoreDelta: 30,
        lastShadowPlacementGameOver: false,
        lastPlacementResultMismatch: true,
        lastPlacementResultMismatchFields: ["attackLines", "canceledGarbageLines"],
        placementResultMismatchCount: 2,
        placementResultHealth: "needs_attention",
        placementResultMismatchFieldCounts: {
            attackLines: 2,
            canceledGarbageLines: 1,
        },
        dominantPlacementResultMismatchField: "attackLines",
        dominantPlacementResultMismatchFieldCount: 2,
        recentPlacementResultMismatchCount: 1,
        recentPlacementResultMismatchFieldCounts: {
            canceledGarbageLines: 1,
        },
        recentPlacementResultHealth: "needs_attention",
        recentDominantPlacementResultMismatchField: "canceledGarbageLines",
        recentDominantPlacementResultMismatchFieldCount: 1,
        lastPlacementComparisonTickDelta: 10,
        lastPlacementComparisonPieceIndexDelta: 2,
        lastPlacementComparisonPieceAlignment: "client_ahead",
        recentSamePiecePlacementMismatchCount: 1,
        recentOutOfOrderPlacementMismatchCount: 2,
        recentUnknownPiecePlacementMismatchCount: 0,
        recentPlacementInvestigationHintCounts: {
            CHECK_PLACEMENT_LOCK_SPAWN_ORDER: 2,
            CHECK_PLACEMENT_GARBAGE_RESULT_FLOW: 1,
        },
        recentDominantPlacementInvestigationHint: "CHECK_PLACEMENT_LOCK_SPAWN_ORDER",
        recentDominantPlacementInvestigationHintCount: 2,
        recentMaxAbsolutePlacementTickDelta: 10,
        recentMaxAbsolutePlacementPieceIndexDelta: 2,
        recentPlacementDriftLevel: "major_order_drift",
        recentPlacementAttentionLevel: "critical",
        lastSkippedShadowLineClearComplete: {
            reason: "PIECE_INDEX_MISMATCH",
            clientPieceIndex: 9,
            shadowPieceIndex: 8,
            clientTick: 140,
            shadowTick: 120,
        },
        lastSkippedShadowLineClearCompleteReason: "PIECE_INDEX_MISMATCH",
        lastClientPlacementAttackLines: 4,
        lastPlacementAttackLinesDelta: 2,
        lastClientPlacementCanceledGarbageLines: 0,
        lastPlacementCanceledGarbageLinesDelta: -2,
        lastClientPlacementScoreBefore: 20,
        lastPlacementScoreBeforeDelta: 10,
        lastClientPlacementScoreAfter: 60,
        lastPlacementScoreAfterDelta: 20,
        lastClientPlacementScoreDelta: 40,
        lastPlacementScoreDeltaDelta: 10,
        lastClientSnapshotPieceQueue: ["zee", "tree"],
        lastShadowSnapshotPieceQueue: ["bar", "tree"],
        lastClientSnapshotHoldPieceType: "bar",
        lastShadowSnapshotHoldPieceType: "square",
        lastClientSnapshotHoldUsedThisDrop: false,
        lastShadowSnapshotHoldUsedThisDrop: true,
        lastClientSnapshotBoardChecksum: "client-board-1",
        lastShadowSnapshotBoardChecksum: "shadow-board-1",
        lastClientSnapshotBoardMismatch: true,
        lastClientSnapshotBoardDiffCellCount: 2,
        lastClientSnapshotFirstBoardDiff: {
            row: 18,
            col: 4,
            client: "bar",
            shadow: null,
        },
        lastClientSnapshotActivePieceTypeChanged: true,
        lastClientSnapshotActivePieceRotationDelta: 1,
        lastClientSnapshotActivePieceRowDelta: 2,
        lastClientSnapshotActivePieceColDelta: -1,
        nextInvestigationHint: "CHECK_BOARD_LINE_CLEAR_GARBAGE_FLOW",
        lastDesyncFields: ["activePiece"],
        lastDesyncReason: "ACTIVE_PIECE_OFFSET",
        lastDesyncSeverity: "low",
        desyncCount: 7,
        lastDesyncTickDelta: 2,
        maxAbsoluteDesyncTickDelta: 6,
        lastDesyncPieceIndexDelta: 1,
        maxAbsoluteDesyncPieceIndexDelta: 3,
        shadowTick: 120,
        shadowPieceIndex: 8,
    });

    assert.deepEqual(row, {
        debugType: "shadow_summary",
        health: "needs_attention",
        recentHealth: "info_only",
        overallHealth: "needs_attention",
        recentOverallHealth: "needs_attention",
        dominantReason: "PIECE_INDEX_MISMATCH",
        dominantCount: 4,
        recentDominantReason: "LINE_CLEAR_ANIMATION_SNAPSHOT",
        recentDominantCount: 2,
        actionableReason: "SCORE_MISMATCH",
        actionableCount: 3,
        actionableField: "score",
        actionableFieldCount: 4,
        actionableTotal: 5,
        recentActionableReason: null,
        recentActionableCount: 0,
        recentActionableField: "activePiece",
        recentActionableFieldCount: 2,
        recentActionableTotal: 0,
        lastActionableReason: "GARBAGE_MISMATCH",
        lastActionableSeverity: "medium",
        lastActionableFields: "pendingGarbageLines,board",
        lastActionableTickDelta: 1,
        lastActionablePieceDelta: 0,
        lastInputAction: "hard_drop",
        lastInputTick: 118,
        lastInputPieceIndex: 8,
        lastInputSequence: 12,
        inputToShadowTickDelta: -2,
        inputToClientSnapshotTickDelta: 22,
        clientSnapshotTick: 140,
        shadowSnapshotTick: 120,
        snapshotToShadowTickDelta: 20,
        clientSnapshotPieceIndex: 9,
        shadowSnapshotPieceIndex: 8,
        snapshotToShadowPieceIndexDelta: 1,
        snapshotPieceIndexDirection: "client_ahead",
        clientSnapshotPhase: "lineClearing",
        shadowSnapshotPhase: "playing",
        snapshotPhaseMismatch: true,
        clientFallIntervalMs: 700,
        shadowFallIntervalMs: 800,
        snapshotFallIntervalDelta: -100,
        clientCombo: 2,
        shadowCombo: 1,
        snapshotComboDelta: 1,
        clientBackToBack: false,
        shadowBackToBack: true,
        snapshotBackToBackMismatch: true,
        shadowPlacementLinesCleared: 4,
        shadowPlacementRawAttackLines: 4,
        shadowPlacementAttackLines: 2,
        shadowPlacementCanceledGarbageLines: 2,
        shadowPlacementIncomingGarbageLines: 2,
        shadowPlacementAppliedGarbageLines: 0,
        shadowPlacementScoreBefore: 10,
        shadowPlacementScoreAfter: 40,
        shadowPlacementScoreDelta: 30,
        shadowPlacementGameOver: false,
        placementResultMismatch: true,
        placementResultMismatchFields: "attackLines,canceledGarbageLines",
        placementResultMismatchCount: 2,
        placementHealth: "needs_attention",
        dominantPlacementResultMismatchField: "attackLines",
        dominantPlacementResultMismatchFieldCount: 2,
        recentPlacementResultMismatchCount: 1,
        recentPlacementHealth: "needs_attention",
        recentDominantPlacementResultMismatchField: "canceledGarbageLines",
        recentDominantPlacementResultMismatchFieldCount: 1,
        placementTickDelta: 10,
        placementPieceIndexDelta: 2,
        placementPieceAlignment: "client_ahead",
        recentSamePiecePlacementMismatchCount: 1,
        recentOutOfOrderPlacementMismatchCount: 2,
        recentUnknownPiecePlacementMismatchCount: 0,
        recentPlacementInvestigationHintCounts: "CHECK_PLACEMENT_GARBAGE_RESULT_FLOW:1|CHECK_PLACEMENT_LOCK_SPAWN_ORDER:2",
        recentDominantPlacementInvestigationHint: "CHECK_PLACEMENT_LOCK_SPAWN_ORDER",
        recentDominantPlacementInvestigationHintCount: 2,
        recentMaxPlacementTickDelta: 10,
        recentMaxPlacementPieceIndexDelta: 2,
        recentPlacementDriftLevel: "major_order_drift",
        recentPlacementAttentionLevel: "critical",
        skippedLineClearCompleteReason: "PIECE_INDEX_MISMATCH",
        skippedLineClearClientPieceIndex: 9,
        skippedLineClearShadowPieceIndex: 8,
        skippedLineClearClientTick: 140,
        skippedLineClearShadowTick: 120,
        clientPlacementAttackLines: 4,
        placementAttackLinesDelta: 2,
        clientPlacementCanceledGarbageLines: 0,
        placementCanceledGarbageLinesDelta: -2,
        clientPlacementScoreBefore: 20,
        placementScoreBeforeDelta: 10,
        clientPlacementScoreAfter: 60,
        placementScoreAfterDelta: 20,
        clientPlacementScoreDelta: 40,
        placementScoreDeltaDelta: 10,
        clientPieceQueue: "zee,tree",
        shadowPieceQueue: "bar,tree",
        clientHold: "bar:false",
        shadowHold: "square:true",
        clientBoardChecksum: "client-board-1",
        shadowBoardChecksum: "shadow-board-1",
        snapshotBoardMismatch: true,
        boardDiffCells: 2,
        firstBoardDiff: "18,4:bar/null",
        activePieceTypeChanged: true,
        activePieceRotationDelta: 1,
        activePieceRowDelta: 2,
        activePieceColDelta: -1,
        nextHint: "CHECK_BOARD_LINE_CLEAR_GARBAGE_FLOW",
        lastFields: "activePiece",
        lastReason: "ACTIVE_PIECE_OFFSET",
        lastSeverity: "low",
        total: 7,
        lastTickDelta: 2,
        maxTickDelta: 6,
        lastPieceDelta: 1,
        maxPieceDelta: 3,
        shadowTick: 120,
        shadowPieceIndex: 8,
    });
});

test("createShadowSummaryDebugRow는 summary가 없으면 기본 row를 반환한다", async () => {
    const { createShadowSummaryDebugRow } = await loadDebugHelpers();

    assert.deepEqual(createShadowSummaryDebugRow(null), {
        debugType: "shadow_summary",
        health: null,
        recentHealth: null,
        overallHealth: null,
        recentOverallHealth: null,
        dominantReason: null,
        dominantCount: 0,
        recentDominantReason: null,
        recentDominantCount: 0,
        actionableReason: null,
        actionableCount: 0,
        actionableField: null,
        actionableFieldCount: 0,
        actionableTotal: 0,
        recentActionableReason: null,
        recentActionableCount: 0,
        recentActionableField: null,
        recentActionableFieldCount: 0,
        recentActionableTotal: 0,
        lastActionableReason: null,
        lastActionableSeverity: null,
        lastActionableFields: null,
        lastActionableTickDelta: null,
        lastActionablePieceDelta: null,
        lastInputAction: null,
        lastInputTick: null,
        lastInputPieceIndex: null,
        lastInputSequence: null,
        inputToShadowTickDelta: null,
        inputToClientSnapshotTickDelta: null,
        clientSnapshotTick: null,
        shadowSnapshotTick: null,
        snapshotToShadowTickDelta: null,
        clientSnapshotPieceIndex: null,
        shadowSnapshotPieceIndex: null,
        snapshotToShadowPieceIndexDelta: null,
        snapshotPieceIndexDirection: null,
        clientSnapshotPhase: null,
        shadowSnapshotPhase: null,
        snapshotPhaseMismatch: null,
        clientFallIntervalMs: null,
        shadowFallIntervalMs: null,
        snapshotFallIntervalDelta: null,
        clientCombo: null,
        shadowCombo: null,
        snapshotComboDelta: null,
        clientBackToBack: null,
        shadowBackToBack: null,
        snapshotBackToBackMismatch: null,
        shadowPlacementLinesCleared: null,
        shadowPlacementRawAttackLines: null,
        shadowPlacementAttackLines: null,
        shadowPlacementCanceledGarbageLines: null,
        shadowPlacementIncomingGarbageLines: null,
        shadowPlacementAppliedGarbageLines: null,
        shadowPlacementScoreBefore: null,
        shadowPlacementScoreAfter: null,
        shadowPlacementScoreDelta: null,
        shadowPlacementGameOver: null,
        placementResultMismatch: null,
        placementResultMismatchFields: null,
        placementResultMismatchCount: 0,
        placementHealth: null,
        dominantPlacementResultMismatchField: null,
        dominantPlacementResultMismatchFieldCount: 0,
        recentPlacementResultMismatchCount: 0,
        recentPlacementHealth: null,
        recentDominantPlacementResultMismatchField: null,
        recentDominantPlacementResultMismatchFieldCount: 0,
        placementTickDelta: null,
        placementPieceIndexDelta: null,
        placementPieceAlignment: null,
        recentSamePiecePlacementMismatchCount: 0,
        recentOutOfOrderPlacementMismatchCount: 0,
        recentUnknownPiecePlacementMismatchCount: 0,
        recentPlacementInvestigationHintCounts: null,
        recentDominantPlacementInvestigationHint: null,
        recentDominantPlacementInvestigationHintCount: 0,
        recentMaxPlacementTickDelta: 0,
        recentMaxPlacementPieceIndexDelta: 0,
        recentPlacementDriftLevel: null,
        recentPlacementAttentionLevel: null,
        skippedLineClearCompleteReason: null,
        skippedLineClearClientPieceIndex: null,
        skippedLineClearShadowPieceIndex: null,
        skippedLineClearClientTick: null,
        skippedLineClearShadowTick: null,
        clientPlacementAttackLines: null,
        placementAttackLinesDelta: null,
        clientPlacementCanceledGarbageLines: null,
        placementCanceledGarbageLinesDelta: null,
        clientPlacementScoreBefore: null,
        placementScoreBeforeDelta: null,
        clientPlacementScoreAfter: null,
        placementScoreAfterDelta: null,
        clientPlacementScoreDelta: null,
        placementScoreDeltaDelta: null,
        clientPieceQueue: null,
        shadowPieceQueue: null,
        clientHold: null,
        shadowHold: null,
        clientBoardChecksum: null,
        shadowBoardChecksum: null,
        snapshotBoardMismatch: null,
        boardDiffCells: 0,
        firstBoardDiff: null,
        activePieceTypeChanged: null,
        activePieceRotationDelta: null,
        activePieceRowDelta: null,
        activePieceColDelta: null,
        nextHint: null,
        lastFields: null,
        lastReason: null,
        lastSeverity: null,
        total: 0,
        lastTickDelta: null,
        maxTickDelta: 0,
        lastPieceDelta: null,
        maxPieceDelta: 0,
        shadowTick: null,
        shadowPieceIndex: null,
    });
});

test("createShadowStateDebugRow는 authoritative snapshot 후보를 현재 player 기준 row로 포함한다", async () => {
    const { createShadowStateDebugRow } = await loadDebugHelpers();

    const row = createShadowStateDebugRow({
        summary: {
            shadowHealth: "stable",
            shadowTick: 30,
            shadowPieceIndex: 8,
        },
        lastAuthoritativeSnapshot: {
            ok: true,
            roomId: "DEBUG_SHADOW_ROOM",
            playerId: "debug-shadow-player",
            source: "server_shadow",
            snapshot: {
                board: [[null, "tree"]],
                activePiece: { pieceType: "tree", rotation: 1, row: 3, col: 4 },
                pieceQueue: ["bar", "square"],
                holdPieceType: "zee",
                holdUsedThisDrop: false,
                score: 1200,
                linesClearedTotal: 6,
                phase: "playing",
                fallIntervalMs: 800,
                combo: 2,
                backToBack: true,
                pendingGarbageQueue: [{ lines: 2, holeCol: 4 }],
                tick: 30,
                pieceIndex: 8,
            },
            reason: null,
        },
    }, "debug-shadow-player");

    assert.equal(row.health, "stable");
    assert.equal(row.authoritativeDebugType, "authoritative_snapshot");
    assert.equal(row.authoritativeRoomId, "DEBUG_SHADOW_ROOM");
    assert.equal(row.authoritativePlayerId, "debug-shadow-player");
    assert.equal(row.authoritativePlayerScope, "local");
    assert.equal(row.authoritativeTick, 30);
    assert.equal(row.authoritativePieceIndex, 8);
    assert.equal(row.authoritativePhase, "playing");
    assert.equal(row.authoritativeFallIntervalMs, 800);
    assert.equal(row.authoritativeCombo, 2);
    assert.equal(row.authoritativeBackToBack, true);
    assert.equal(row.authoritativeScore, 1200);
    assert.equal(row.authoritativeLines, 6);
    assert.equal(row.authoritativeGarbageLines, 2);
    assert.equal(row.authoritativeActivePiece, "tree:1@3,4");
    assert.equal(row.authoritativePieceQueue, "bar,square");
    assert.equal(row.authoritativeHold, "zee:false");
    assert.equal(typeof row.authoritativeBoardChecksum, "string");
});

test("createShadowStateDebugRow는 shadow가 없으면 authoritative 필드를 기본값으로 반환한다", async () => {
    const { createShadowStateDebugRow } = await loadDebugHelpers();

    const row = createShadowStateDebugRow(null);

    assert.equal(row.health, null);
    assert.equal(row.authoritativeDebugType, "authoritative_snapshot");
    assert.equal(row.authoritativeTick, null);
    assert.equal(row.authoritativePieceIndex, null);
    assert.equal(row.authoritativePhase, null);
    assert.equal(row.authoritativeScore, 0);
    assert.equal(row.authoritativeLines, 0);
    assert.equal(row.authoritativeGarbageLines, 0);
    assert.equal(row.authoritativeActivePiece, null);
    assert.equal(row.authoritativePieceQueue, null);
    assert.equal(row.authoritativeHold, null);
    assert.equal(row.authoritativeBoardChecksum, null);
});

test("warnCriticalPlacementDebug는 critical placement drift만 warning으로 기록한다", async () => {
    const { warnCriticalPlacementDebug } = await loadDebugHelpers();
    const warnings = [];
    const row = {
        recentPlacementAttentionLevel: "critical",
        recentPlacementDriftLevel: "major_order_drift",
        recentDominantPlacementInvestigationHint: "CHECK_PLACEMENT_LOCK_SPAWN_ORDER",
        recentMaxPlacementTickDelta: 10,
        recentMaxPlacementPieceIndexDelta: 2,
    };

    warnCriticalPlacementDebug(row, (...args) => {
        warnings.push(args);
    });
    warnCriticalPlacementDebug({
        recentPlacementAttentionLevel: "needs_attention",
    }, (...args) => {
        warnings.push(args);
    });

    assert.deepEqual(warnings, [
        [
            "critical placement drift detected:",
            {
                attention: "critical",
                driftLevel: "major_order_drift",
                hint: "CHECK_PLACEMENT_LOCK_SPAWN_ORDER",
                maxTickDelta: 10,
                maxPieceIndexDelta: 2,
            },
        ],
    ]);
});

test("warnCriticalPlacementDebug는 같은 critical signature를 반복 warning하지 않는다", async () => {
    const { warnCriticalPlacementDebug } = await loadDebugHelpers();
    const warnings = [];
    const warningState = {};
    const row = {
        recentPlacementAttentionLevel: "critical",
        recentPlacementDriftLevel: "major_order_drift",
        recentDominantPlacementInvestigationHint: "CHECK_PLACEMENT_LOCK_SPAWN_ORDER",
        recentMaxPlacementTickDelta: 10,
        recentMaxPlacementPieceIndexDelta: 2,
    };
    const changedRow = {
        ...row,
        recentMaxPlacementPieceIndexDelta: 3,
    };

    warnCriticalPlacementDebug(row, (...args) => {
        warnings.push(args);
    }, warningState);
    warnCriticalPlacementDebug(row, (...args) => {
        warnings.push(args);
    }, warningState);
    warnCriticalPlacementDebug(changedRow, (...args) => {
        warnings.push(args);
    }, warningState);

    assert.equal(warnings.length, 2);
    assert.deepEqual(warnings[0][1], {
        attention: "critical",
        driftLevel: "major_order_drift",
        hint: "CHECK_PLACEMENT_LOCK_SPAWN_ORDER",
        maxTickDelta: 10,
        maxPieceIndexDelta: 2,
    });
    assert.deepEqual(warnings[1][1], {
        attention: "critical",
        driftLevel: "major_order_drift",
        hint: "CHECK_PLACEMENT_LOCK_SPAWN_ORDER",
        maxTickDelta: 10,
        maxPieceIndexDelta: 3,
    });
});

test("warnCriticalPlacementDebug는 non-critical 상태 이후 같은 critical signature를 다시 warning한다", async () => {
    const { warnCriticalPlacementDebug } = await loadDebugHelpers();
    const warnings = [];
    const warningState = {};
    const row = {
        recentPlacementAttentionLevel: "critical",
        recentPlacementDriftLevel: "major_order_drift",
        recentDominantPlacementInvestigationHint: "CHECK_PLACEMENT_LOCK_SPAWN_ORDER",
        recentMaxPlacementTickDelta: 10,
        recentMaxPlacementPieceIndexDelta: 2,
    };

    warnCriticalPlacementDebug(row, (...args) => {
        warnings.push(args);
    }, warningState);
    warnCriticalPlacementDebug({
        recentPlacementAttentionLevel: "stable",
    }, (...args) => {
        warnings.push(args);
    }, warningState);
    warnCriticalPlacementDebug(row, (...args) => {
        warnings.push(args);
    }, warningState);

    assert.equal(warnings.length, 2);
    assert.deepEqual(warnings[0][1], warnings[1][1]);
});

test("createPlacementComparisonDebugRows는 최근 placement comparison log를 콘솔용 rows로 변환한다", async () => {
    const { createPlacementComparisonDebugRows } = await loadDebugHelpers();

    const rows = createPlacementComparisonDebugRows({
        recentPlacementComparisonLog: [
            {
                fields: [
                    "attackLines",
                    "canceledGarbageLines",
                    "scoreBefore",
                    "scoreAfter",
                    "scoreDelta",
                ],
                recordedAt: 1783000000000,
                clientTick: 120,
                shadowTick: 118,
                tickDelta: 2,
                clientPieceIndex: 8,
                shadowPieceIndex: 7,
                pieceIndexDelta: 1,
                details: {
                    attackLines: {
                        client: 4,
                        shadow: 2,
                        delta: 2,
                    },
                    canceledGarbageLines: {
                        client: 0,
                        shadow: 2,
                        delta: -2,
                    },
                    scoreBefore: {
                        client: 20,
                        shadow: 10,
                        delta: 10,
                    },
                    scoreAfter: {
                        client: 60,
                        shadow: 40,
                        delta: 20,
                    },
                    scoreDelta: {
                        client: 40,
                        shadow: 30,
                        delta: 10,
                    },
                },
            },
            {
                fields: ["scoreAfter", "scoreDelta"],
                recordedAt: 1783000000100,
                clientTick: 130,
                shadowTick: 128,
                tickDelta: 2,
                clientPieceIndex: 9,
                shadowPieceIndex: 9,
                pieceIndexDelta: 0,
                details: {
                    scoreAfter: {
                        client: 25,
                        shadow: 20,
                        delta: 5,
                    },
                    scoreDelta: {
                        client: 15,
                        shadow: 10,
                        delta: 5,
                    },
                },
            },
        ],
    });

    assert.deepEqual(rows, [
        {
            debugType: "placement_comparison",
            index: 0,
            recordedAt: 1783000000000,
            fields: "attackLines,canceledGarbageLines,scoreBefore,scoreAfter,scoreDelta",
            fieldCount: 5,
            clientTick: 120,
            shadowTick: 118,
            tickDelta: 2,
            clientPieceIndex: 8,
            shadowPieceIndex: 7,
            pieceIndexDelta: 1,
            pieceAlignment: "client_ahead",
            investigationHint: "CHECK_PLACEMENT_LOCK_SPAWN_ORDER",
            attackLinesClient: 4,
            attackLinesShadow: 2,
            attackLinesDelta: 2,
            canceledGarbageLinesClient: 0,
            canceledGarbageLinesShadow: 2,
            canceledGarbageLinesDelta: -2,
            rawAttackLinesClient: null,
            rawAttackLinesShadow: null,
            rawAttackLinesDelta: null,
            appliedGarbageLinesClient: null,
            appliedGarbageLinesShadow: null,
            appliedGarbageLinesDelta: null,
            scoreBeforeClient: 20,
            scoreBeforeShadow: 10,
            scoreBeforeDelta: 10,
            scoreAfterClient: 60,
            scoreAfterShadow: 40,
            scoreAfterDelta: 20,
            scoreDeltaClient: 40,
            scoreDeltaShadow: 30,
            scoreDeltaDelta: 10,
        },
        {
            debugType: "placement_comparison",
            index: 1,
            recordedAt: 1783000000100,
            fields: "scoreAfter,scoreDelta",
            fieldCount: 2,
            clientTick: 130,
            shadowTick: 128,
            tickDelta: 2,
            clientPieceIndex: 9,
            shadowPieceIndex: 9,
            pieceIndexDelta: 0,
            pieceAlignment: "in_sync",
            investigationHint: "CHECK_PLACEMENT_SCORE_RESULT_FLOW",
            attackLinesClient: null,
            attackLinesShadow: null,
            attackLinesDelta: null,
            canceledGarbageLinesClient: null,
            canceledGarbageLinesShadow: null,
            canceledGarbageLinesDelta: null,
            rawAttackLinesClient: null,
            rawAttackLinesShadow: null,
            rawAttackLinesDelta: null,
            appliedGarbageLinesClient: null,
            appliedGarbageLinesShadow: null,
            appliedGarbageLinesDelta: null,
            scoreBeforeClient: null,
            scoreBeforeShadow: null,
            scoreBeforeDelta: null,
            scoreAfterClient: 25,
            scoreAfterShadow: 20,
            scoreAfterDelta: 5,
            scoreDeltaClient: 15,
            scoreDeltaShadow: 10,
            scoreDeltaDelta: 5,
        },
    ]);
});

test("createPlacementComparisonDebugRows는 log가 없으면 빈 배열을 반환한다", async () => {
    const { createPlacementComparisonDebugRows } = await loadDebugHelpers();

    assert.deepEqual(createPlacementComparisonDebugRows(null), []);
    assert.deepEqual(createPlacementComparisonDebugRows({ recentPlacementComparisonLog: null }), []);
});

test("createAuthoritativeSnapshotDebugRow는 snapshot 결과를 콘솔용 row로 변환한다", async () => {
    const { createAuthoritativeSnapshotDebugRow } = await loadDebugHelpers();

    const row = createAuthoritativeSnapshotDebugRow({
        board: [[null, "bar"]],
        activePiece: { pieceType: "bar", rotation: 1, row: 5, col: 3 },
        pieceQueue: ["tree", "square"],
        holdPieceType: null,
        holdUsedThisDrop: false,
        score: 900,
        linesClearedTotal: 4,
        phase: "playing",
        fallIntervalMs: 750,
        combo: 3,
        backToBack: true,
        pendingGarbageQueue: [
            { lines: 2, holeCol: 4 },
            { lines: 1, holeCol: 7 },
        ],
        tick: 42,
        pieceIndex: 9,
    });

    assert.equal(row.authoritativeDebugType, "authoritative_snapshot");
    assert.equal(row.authoritativeTick, 42);
    assert.equal(row.authoritativePieceIndex, 9);
    assert.equal(row.authoritativePhase, "playing");
    assert.equal(row.authoritativeFallIntervalMs, 750);
    assert.equal(row.authoritativeCombo, 3);
    assert.equal(row.authoritativeBackToBack, true);
    assert.equal(row.authoritativeScore, 900);
    assert.equal(row.authoritativeLines, 4);
    assert.equal(row.authoritativeGarbageLines, 3);
    assert.equal(row.authoritativeActivePiece, "bar:1@5,3");
    assert.equal(row.authoritativePieceQueue, "tree,square");
    assert.equal(row.authoritativeHold, "none:false");
    assert.equal(typeof row.authoritativeBoardChecksum, "string");
});

test("createAuthoritativeSnapshotDebugRow는 snapshot 응답 메타데이터를 콘솔용 row에 포함한다", async () => {
    const { createAuthoritativeSnapshotDebugRow } = await loadDebugHelpers();

    const row = createAuthoritativeSnapshotDebugRow(
        {
            ok: true,
            roomId: "DEBUG_ROOM001",
            playerId: "debug-player",
            source: "server_shadow",
            updateReason: "input",
            updateSequence: 7,
            createdAt: 1783000000000,
            snapshot: {
                board: [[null, "bar"]],
                activePiece: { pieceType: "bar", rotation: 1, row: 5, col: 3 },
                pieceQueue: ["tree", "square"],
                holdPieceType: null,
                holdUsedThisDrop: false,
                score: 900,
                linesClearedTotal: 4,
                phase: "playing",
                fallIntervalMs: 750,
                combo: 3,
                backToBack: true,
                pendingGarbageQueue: [{ lines: 2, holeCol: 4 }],
                tick: 42,
                pieceIndex: 9,
            },
            reason: null,
        },
        "request",
    );

    assert.equal(row.authoritativeDebugType, "authoritative_snapshot");
    assert.equal(row.authoritativeDelivery, "request");
    assert.equal(row.authoritativeRoomId, "DEBUG_ROOM001");
    assert.equal(row.authoritativePlayerId, "debug-player");
    assert.equal(row.authoritativeSource, "server_shadow");
    assert.equal(row.authoritativeUpdateReason, "input");
    assert.equal(row.authoritativeUpdateSequence, 7);
    assert.equal(row.authoritativeCreatedAt, 1783000000000);
    assert.equal(row.authoritativeTick, 42);
    assert.equal(row.authoritativePieceIndex, 9);
    assert.equal(row.authoritativeFallIntervalMs, 750);
    assert.equal(row.authoritativeCombo, 3);
    assert.equal(row.authoritativeBackToBack, true);
    assert.equal(row.authoritativeGarbageLines, 2);
});

test("createAuthoritativeSnapshotDebugRow는 snapshot이 없으면 기본값을 반환한다", async () => {
    const { createAuthoritativeSnapshotDebugRow } = await loadDebugHelpers();

    assert.deepEqual(createAuthoritativeSnapshotDebugRow(null), {
        authoritativeDebugType: "authoritative_snapshot",
        authoritativeDelivery: null,
        authoritativeRoomId: null,
        authoritativePlayerId: null,
        authoritativeSource: null,
        authoritativeUpdateReason: null,
        authoritativeUpdateSequence: null,
        authoritativePlayerScope: null,
        authoritativeCreatedAt: null,
        authoritativeTick: null,
        authoritativePieceIndex: null,
        authoritativePhase: null,
        authoritativeFallIntervalMs: null,
        authoritativeCombo: null,
        authoritativeBackToBack: null,
        authoritativeScore: 0,
        authoritativeLines: 0,
        authoritativeGarbageLines: 0,
        authoritativeActivePiece: null,
        authoritativePieceQueue: null,
        authoritativeHold: null,
        authoritativeBoardChecksum: null,
    });
});

test("attachAuthoritativeSnapshotUpdateDebug는 push update를 console table row로 기록한다", async () => {
    const { attachAuthoritativeSnapshotUpdateDebug } = await loadDebugHelpers();
    const tableRows = [];
    const resolvedTargets = [];
    let registeredHandler = null;
    let detachCalled = false;
    const subscriptions = [];
    const unsubscriptions = [];

    const detach = attachAuthoritativeSnapshotUpdateDebug({
        debugEnabled: true,
        roomId: "DEBUG_PUSH_ROOM",
        playerId: "debug-push-player",
        subscribeUpdate(roomId, playerId) {
            subscriptions.push({ roomId, playerId });
        },
        unsubscribeUpdate(roomId, playerId) {
            unsubscriptions.push({ roomId, playerId });
        },
        receiveUpdate(handler) {
            registeredHandler = handler;

            return () => {
                detachCalled = true;
            };
        },
        logTable(row) {
            tableRows.push(row);
        },
        handleResolvedTarget(result) {
            resolvedTargets.push(result);
        },
    });

    assert.equal(typeof registeredHandler, "function");
    assert.deepEqual(subscriptions, [
        {
            roomId: "DEBUG_PUSH_ROOM",
            playerId: "debug-push-player",
        },
    ]);

    registeredHandler({
        ok: true,
        roomId: "DEBUG_PUSH_ROOM",
        playerId: "debug-push-player",
        source: "server_shadow",
        updateReason: "subscribe_initial",
        updateSequence: 3,
        createdAt: 1783000000001,
        snapshot: {
            board: [[null, "tree"]],
            activePiece: { pieceType: "tree", rotation: 0, row: 2, col: 4 },
            pieceQueue: ["bar"],
            holdPieceType: null,
            holdUsedThisDrop: false,
            score: 100,
            linesClearedTotal: 1,
            phase: "playing",
            pendingGarbageQueue: [],
            tick: 5,
            pieceIndex: 2,
        },
        reason: null,
    });

    assert.equal(tableRows.length, 1);
    assert.equal(tableRows[0].authoritativeDelivery, "push");
    assert.equal(tableRows[0].authoritativeUpdateReason, "subscribe_initial");
    assert.equal(tableRows[0].authoritativeUpdateSequence, 3);
    assert.equal(tableRows[0].authoritativePlayerScope, "local");
    assert.equal(tableRows[0].authoritativeRoomId, "DEBUG_PUSH_ROOM");
    assert.equal(tableRows[0].authoritativePlayerId, "debug-push-player");
    assert.equal(tableRows[0].authoritativeTick, 5);
    assert.deepEqual(resolvedTargets, [
        {
            ok: true,
            target: "local",
            roomId: "DEBUG_PUSH_ROOM",
            playerId: "debug-push-player",
            snapshot: {
                board: [[null, "tree"]],
                activePiece: { pieceType: "tree", rotation: 0, row: 2, col: 4 },
                pieceQueue: ["bar"],
                holdPieceType: null,
                holdUsedThisDrop: false,
                score: 100,
                linesClearedTotal: 1,
                phase: "playing",
                pendingGarbageQueue: [],
                tick: 5,
                pieceIndex: 2,
            },
            updateReason: "subscribe_initial",
            updateSequence: 3,
            reason: null,
        },
    ]);

    detach();

    assert.equal(detachCalled, true);
    assert.deepEqual(unsubscriptions, [
        {
            roomId: "DEBUG_PUSH_ROOM",
            playerId: "debug-push-player",
        },
    ]);
});

test("createAuthoritativeSnapshotDebugRow는 현재 playerId 기준으로 local/opponent를 구분한다", async () => {
    const { createAuthoritativeSnapshotDebugRow } = await loadDebugHelpers();

    const localRow = createAuthoritativeSnapshotDebugRow(
        {
            ok: true,
            roomId: "DEBUG_SCOPE_ROOM",
            playerId: "scope-local-player",
            source: "server_shadow",
            snapshot: {
                board: [],
            },
            reason: null,
        },
        "push",
        "scope-local-player",
    );
    const opponentRow = createAuthoritativeSnapshotDebugRow(
        {
            ok: true,
            roomId: "DEBUG_SCOPE_ROOM",
            playerId: "scope-opponent-player",
            source: "server_shadow",
            snapshot: {
                board: [],
            },
            reason: null,
        },
        "push",
        "scope-local-player",
    );

    assert.equal(localRow.authoritativePlayerScope, "local");
    assert.equal(opponentRow.authoritativePlayerScope, "opponent");
});

test("attachAuthoritativeSnapshotUpdateDebug는 구독 결과 실패를 warning으로 기록하고 해제한다", async () => {
    const { attachAuthoritativeSnapshotUpdateDebug } = await loadDebugHelpers();
    const warnings = [];
    const subscribeResults = [];
    let subscribeResultHandler = null;
    let unsubscribeResultHandler = null;
    let detachSubscribeResultCalled = false;
    let detachUnsubscribeResultCalled = false;

    const detach = attachAuthoritativeSnapshotUpdateDebug({
        debugEnabled: true,
        roomId: "DEBUG_SUBSCRIBE_ROOM",
        playerId: "debug-subscribe-player",
        subscribeUpdate() {},
        unsubscribeUpdate() {},
        receiveUpdate() {
            return () => {};
        },
        receiveSubscribeResult(handler) {
            subscribeResultHandler = handler;

            return () => {
                detachSubscribeResultCalled = true;
            };
        },
        receiveUnsubscribeResult(handler) {
            unsubscribeResultHandler = handler;

            return () => {
                detachUnsubscribeResultCalled = true;
            };
        },
        logWarn(...args) {
            warnings.push(args);
        },
        handleSubscribeResult(result) {
            subscribeResults.push(result);
        },
    });

    assert.equal(typeof subscribeResultHandler, "function");
    assert.equal(typeof unsubscribeResultHandler, "function");

    subscribeResultHandler({ ok: false, reason: "NOT_AUTHORIZED" });
    unsubscribeResultHandler({ ok: false, reason: "ROOM_NOT_FOUND" });

    assert.deepEqual(warnings, [
        ["authoritative snapshot update subscribe failed:", "NOT_AUTHORIZED"],
        ["authoritative snapshot update unsubscribe failed:", "ROOM_NOT_FOUND"],
    ]);
    assert.deepEqual(subscribeResults, [
        { ok: false, reason: "NOT_AUTHORIZED" },
    ]);

    detach();

    assert.equal(detachSubscribeResultCalled, true);
    assert.equal(detachUnsubscribeResultCalled, true);
});

test("attachAuthoritativeSnapshotUpdateDebug는 debug가 꺼져 있으면 구독하지 않는다", async () => {
    const { attachAuthoritativeSnapshotUpdateDebug } = await loadDebugHelpers();
    let subscribeCount = 0;

    const detach = attachAuthoritativeSnapshotUpdateDebug({
        debugEnabled: false,
        receiveUpdate() {
            subscribeCount++;
        },
    });

    assert.equal(detach, null);
    assert.equal(subscribeCount, 0);
});
