import {
    getAuthoritativeSnapshotScope,
    resolveAuthoritativeSnapshotTarget,
} from "../runtime/authoritativeSnapshotRouting.js"

export function isMultiplayerDebugEnabled(search = "") {
    const normalizedSearch = search.startsWith("?") ? search : `?${search}`
    const params = new URLSearchParams(normalizedSearch)
    const debugValue = params.get("debug")

    return debugValue === "1" || debugValue === "true"
}

export function appendMultiplayerDebugParam(url, search = "") {
    if (!isMultiplayerDebugEnabled(search)) {
        return url
    }

    const sourceParams = new URLSearchParams(search.startsWith("?") ? search : `?${search}`)
    const targetUrl = new URL(url, "http://localhost")
    targetUrl.searchParams.set("debug", "1")
    if (sourceParams.get("authoritativeApply") === "opponent") {
        targetUrl.searchParams.set("authoritativeApply", "opponent")
    }

    return `${targetUrl.pathname}${targetUrl.search}`
}

export function createMultiplayerDebugModeLabel({
    debugEnabled = false,
    authoritativeApplyMode = "off",
} = {}) {
    const applyMode = debugEnabled && authoritativeApplyMode === "opponent"
        ? "opponent"
        : "off"

    return `Debug ${debugEnabled ? "on" : "off"} | Apply ${applyMode}`
}

export function createAuthoritativeRouteStatusLabel(routeResult, applyResult = null) {
    if (!routeResult?.ok) return "Route waiting"

    const target = routeResult.target ?? "unknown"
    const applied = applyResult?.applied ? "yes" : "no"
    const reason = applyResult?.reason ?? routeResult.reason ?? null
    const sequence = Number.isInteger(routeResult.updateSequence)
        ? routeResult.updateSequence
        : null
    const parts = [
        `Route ${target}`,
        `Applied ${applied}`,
    ]

    if (reason) {
        parts.push(reason)
    }

    if (sequence !== null) {
        parts.push(`Seq ${sequence}`)
    }

    return parts.join(" | ")
}

export function createAuthoritativeRouteStatusTracker() {
    let opponentAppliedCount = 0
    let localBlockedCount = 0
    let lastOpponentSequence = null
    let subscribeFailureReason = null

    function getLabel() {
        if (subscribeFailureReason) {
            return `Route subscribe failed | ${subscribeFailureReason}`
        }

        if (opponentAppliedCount === 0 && localBlockedCount === 0) {
            return "Route waiting"
        }

        const sequenceText = lastOpponentSequence === null
            ? "none"
            : String(lastOpponentSequence)

        return `Opponent applied ${opponentAppliedCount} | Local blocked ${localBlockedCount} | Last opponent seq ${sequenceText}`
    }

    function record(routeResult, applyResult = null) {
        if (routeResult?.target === "opponent" && applyResult?.applied) {
            opponentAppliedCount += 1
            lastOpponentSequence = Number.isInteger(routeResult.updateSequence)
                ? routeResult.updateSequence
                : lastOpponentSequence
        }

        if (routeResult?.target === "local" && applyResult?.reason === "TARGET_NOT_ALLOWED") {
            localBlockedCount += 1
        }

        return getLabel()
    }

    function recordSubscribeResult(result) {
        subscribeFailureReason = result?.ok
            ? null
            : result?.reason ?? "SUBSCRIBE_FAILED"

        return getLabel()
    }

    return {
        getLabel,
        record,
        recordSubscribeResult,
    }
}

export function createDebugAutoInputController({
    intervalMs = 700,
    runAction,
} = {}) {
    let timerId = null

    function start() {
        if (timerId !== null) return
        if (typeof runAction !== "function") return

        runAction()
        timerId = setInterval(runAction, intervalMs)
    }

    function stop() {
        if (timerId === null) return

        clearInterval(timerId)
        timerId = null
    }

    function toggle() {
        if (timerId === null) {
            start()
            return true
        }

        stop()
        return false
    }

    function isRunning() {
        return timerId !== null
    }

    return {
        start,
        stop,
        toggle,
        isRunning,
    }
}

export function createShadowSummaryDebugRow(summary) {
    return {
        debugType: "shadow_summary",
        health: summary?.shadowHealth ?? null,
        recentHealth: summary?.recentShadowHealth ?? null,
        overallHealth: summary?.overallShadowHealth ?? null,
        recentOverallHealth: summary?.recentOverallShadowHealth ?? null,
        dominantReason: summary?.dominantDesyncReason ?? null,
        dominantCount: summary?.dominantDesyncCount ?? 0,
        recentDominantReason: summary?.recentDominantDesyncReason ?? null,
        recentDominantCount: summary?.recentDominantDesyncCount ?? 0,
        actionableReason: summary?.dominantActionableDesyncReason ?? null,
        actionableCount: summary?.dominantActionableDesyncCount ?? 0,
        actionableTotal: summary?.actionableDesyncCount ?? 0,
        recentActionableReason: summary?.recentDominantActionableDesyncReason ?? null,
        recentActionableCount: summary?.recentDominantActionableDesyncCount ?? 0,
        recentActionableField: summary?.recentDominantActionableDesyncField ?? null,
        recentActionableFieldCount: summary?.recentDominantActionableDesyncFieldCount ?? 0,
        recentActionableTotal: summary?.recentActionableDesyncCount ?? 0,
        lastActionableReason: summary?.lastActionableDesyncReason ?? null,
        lastActionableSeverity: summary?.lastActionableDesyncSeverity ?? null,
        actionableField: summary?.dominantActionableDesyncField ?? null,
        actionableFieldCount: summary?.dominantActionableDesyncFieldCount ?? 0,
        lastActionableFields: formatDesyncFields(summary?.lastActionableDesyncFields),
        lastActionableTickDelta: summary?.lastActionableDesyncTickDelta ?? null,
        lastActionablePieceDelta: summary?.lastActionableDesyncPieceIndexDelta ?? null,
        lastInputAction: summary?.lastShadowInputAction ?? null,
        lastInputTick: summary?.lastShadowInputTick ?? null,
        lastInputPieceIndex: summary?.lastShadowInputPieceIndex ?? null,
        lastInputSequence: summary?.lastShadowInputSequence ?? null,
        inputToShadowTickDelta: summary?.lastShadowInputToShadowTickDelta ?? null,
        inputToClientSnapshotTickDelta: summary?.lastShadowInputToClientSnapshotTickDelta ?? null,
        clientSnapshotTick: summary?.lastClientSnapshotTick ?? null,
        shadowSnapshotTick: summary?.lastShadowSnapshotTick ?? null,
        snapshotToShadowTickDelta: summary?.lastClientSnapshotToShadowTickDelta ?? null,
        clientSnapshotPieceIndex: summary?.lastClientSnapshotPieceIndex ?? null,
        shadowSnapshotPieceIndex: summary?.lastShadowSnapshotPieceIndex ?? null,
        snapshotToShadowPieceIndexDelta: summary?.lastClientSnapshotToShadowPieceIndexDelta ?? null,
        snapshotPieceIndexDirection: summary?.lastClientSnapshotToShadowPieceIndexDirection ?? null,
        clientSnapshotPhase: summary?.lastClientSnapshotPhase ?? null,
        shadowSnapshotPhase: summary?.lastShadowSnapshotPhase ?? null,
        snapshotPhaseMismatch: summary?.lastClientSnapshotPhaseMismatch ?? null,
        clientFallIntervalMs: getNumberOrNull(summary?.lastClientSnapshotFallIntervalMs),
        shadowFallIntervalMs: getNumberOrNull(summary?.lastShadowSnapshotFallIntervalMs),
        snapshotFallIntervalDelta: getNumberOrNull(summary?.lastClientSnapshotToShadowFallIntervalDelta),
        clientCombo: getIntegerOrNull(summary?.lastClientSnapshotCombo),
        shadowCombo: getIntegerOrNull(summary?.lastShadowSnapshotCombo),
        snapshotComboDelta: getNumberOrNull(summary?.lastClientSnapshotToShadowComboDelta),
        clientBackToBack: getBooleanOrNull(summary?.lastClientSnapshotBackToBack),
        shadowBackToBack: getBooleanOrNull(summary?.lastShadowSnapshotBackToBack),
        snapshotBackToBackMismatch: getBooleanOrNull(summary?.lastClientSnapshotBackToBackMismatch),
        shadowPlacementLinesCleared: getIntegerOrNull(summary?.lastShadowPlacementLinesCleared),
        shadowPlacementRawAttackLines: getIntegerOrNull(summary?.lastShadowPlacementRawAttackLines),
        shadowPlacementAttackLines: getIntegerOrNull(summary?.lastShadowPlacementAttackLines),
        shadowPlacementCanceledGarbageLines: getIntegerOrNull(
            summary?.lastShadowPlacementCanceledGarbageLines,
        ),
        shadowPlacementIncomingGarbageLines: getIntegerOrNull(
            summary?.lastShadowPlacementIncomingGarbageLines,
        ),
        shadowPlacementAppliedGarbageLines: getIntegerOrNull(
            summary?.lastShadowPlacementAppliedGarbageLines,
        ),
        shadowPlacementScoreBefore: getNumberOrNull(summary?.lastShadowPlacementScoreBefore),
        shadowPlacementScoreAfter: getNumberOrNull(summary?.lastShadowPlacementScoreAfter),
        shadowPlacementScoreDelta: getNumberOrNull(summary?.lastShadowPlacementScoreDelta),
        shadowPlacementGameOver: getBooleanOrNull(summary?.lastShadowPlacementGameOver),
        placementResultMismatch: getBooleanOrNull(summary?.lastPlacementResultMismatch),
        placementResultMismatchFields: formatDesyncFields(summary?.lastPlacementResultMismatchFields),
        placementResultMismatchCount: getIntegerOrNull(summary?.placementResultMismatchCount) ?? 0,
        placementHealth: summary?.placementResultHealth ?? null,
        dominantPlacementResultMismatchField: summary?.dominantPlacementResultMismatchField ?? null,
        dominantPlacementResultMismatchFieldCount: getIntegerOrNull(
            summary?.dominantPlacementResultMismatchFieldCount,
        ) ?? 0,
        recentPlacementResultMismatchCount: getIntegerOrNull(
            summary?.recentPlacementResultMismatchCount,
        ) ?? 0,
        recentPlacementHealth: summary?.recentPlacementResultHealth ?? null,
        recentDominantPlacementResultMismatchField: summary?.recentDominantPlacementResultMismatchField ?? null,
        recentDominantPlacementResultMismatchFieldCount: getIntegerOrNull(
            summary?.recentDominantPlacementResultMismatchFieldCount,
        ) ?? 0,
        placementTickDelta: getIntegerOrNull(summary?.lastPlacementComparisonTickDelta),
        placementPieceIndexDelta: getIntegerOrNull(summary?.lastPlacementComparisonPieceIndexDelta),
        placementPieceAlignment: summary?.lastPlacementComparisonPieceAlignment ?? null,
        recentSamePiecePlacementMismatchCount: getIntegerOrNull(
            summary?.recentSamePiecePlacementMismatchCount,
        ) ?? 0,
        recentOutOfOrderPlacementMismatchCount: getIntegerOrNull(
            summary?.recentOutOfOrderPlacementMismatchCount,
        ) ?? 0,
        recentUnknownPiecePlacementMismatchCount: getIntegerOrNull(
            summary?.recentUnknownPiecePlacementMismatchCount,
        ) ?? 0,
        recentPlacementInvestigationHintCounts: formatCountMap(
            summary?.recentPlacementInvestigationHintCounts,
        ),
        recentDominantPlacementInvestigationHint: summary?.recentDominantPlacementInvestigationHint ?? null,
        recentDominantPlacementInvestigationHintCount: getIntegerOrNull(
            summary?.recentDominantPlacementInvestigationHintCount,
        ) ?? 0,
        recentMaxPlacementTickDelta: getIntegerOrNull(
            summary?.recentMaxAbsolutePlacementTickDelta,
        ) ?? 0,
        recentMaxPlacementPieceIndexDelta: getIntegerOrNull(
            summary?.recentMaxAbsolutePlacementPieceIndexDelta,
        ) ?? 0,
        recentPlacementDriftLevel: summary?.recentPlacementDriftLevel ?? null,
        recentPlacementAttentionLevel: summary?.recentPlacementAttentionLevel ?? null,
        skippedLineClearCompleteReason: summary?.lastSkippedShadowLineClearCompleteReason ?? null,
        skippedLineClearClientPieceIndex: getIntegerOrNull(
            summary?.lastSkippedShadowLineClearComplete?.clientPieceIndex,
        ),
        skippedLineClearShadowPieceIndex: getIntegerOrNull(
            summary?.lastSkippedShadowLineClearComplete?.shadowPieceIndex,
        ),
        skippedLineClearClientTick: getIntegerOrNull(
            summary?.lastSkippedShadowLineClearComplete?.clientTick,
        ),
        skippedLineClearShadowTick: getIntegerOrNull(
            summary?.lastSkippedShadowLineClearComplete?.shadowTick,
        ),
        clientPlacementAttackLines: getIntegerOrNull(summary?.lastClientPlacementAttackLines),
        placementAttackLinesDelta: getNumberOrNull(summary?.lastPlacementAttackLinesDelta),
        clientPlacementCanceledGarbageLines: getIntegerOrNull(
            summary?.lastClientPlacementCanceledGarbageLines,
        ),
        placementCanceledGarbageLinesDelta: getNumberOrNull(
            summary?.lastPlacementCanceledGarbageLinesDelta,
        ),
        clientPlacementScoreBefore: getNumberOrNull(summary?.lastClientPlacementScoreBefore),
        placementScoreBeforeDelta: getNumberOrNull(summary?.lastPlacementScoreBeforeDelta),
        clientPlacementScoreAfter: getNumberOrNull(summary?.lastClientPlacementScoreAfter),
        placementScoreAfterDelta: getNumberOrNull(summary?.lastPlacementScoreAfterDelta),
        clientPlacementScoreDelta: getNumberOrNull(summary?.lastClientPlacementScoreDelta),
        placementScoreDeltaDelta: getNumberOrNull(summary?.lastPlacementScoreDeltaDelta),
        clientPieceQueue: formatPieceQueue(summary?.lastClientSnapshotPieceQueue),
        shadowPieceQueue: formatPieceQueue(summary?.lastShadowSnapshotPieceQueue),
        clientHold: formatHoldState(
            summary?.lastClientSnapshotHoldPieceType,
            summary?.lastClientSnapshotHoldUsedThisDrop,
        ),
        shadowHold: formatHoldState(
            summary?.lastShadowSnapshotHoldPieceType,
            summary?.lastShadowSnapshotHoldUsedThisDrop,
        ),
        clientBoardChecksum: summary?.lastClientSnapshotBoardChecksum ?? null,
        shadowBoardChecksum: summary?.lastShadowSnapshotBoardChecksum ?? null,
        snapshotBoardMismatch: summary?.lastClientSnapshotBoardMismatch ?? null,
        boardDiffCells: summary?.lastClientSnapshotBoardDiffCellCount ?? 0,
        firstBoardDiff: formatBoardDiff(summary?.lastClientSnapshotFirstBoardDiff),
        activePieceTypeChanged: summary?.lastClientSnapshotActivePieceTypeChanged ?? null,
        activePieceRotationDelta: summary?.lastClientSnapshotActivePieceRotationDelta ?? null,
        activePieceRowDelta: summary?.lastClientSnapshotActivePieceRowDelta ?? null,
        activePieceColDelta: summary?.lastClientSnapshotActivePieceColDelta ?? null,
        nextHint: summary?.nextInvestigationHint ?? null,
        lastFields: formatDesyncFields(summary?.lastDesyncFields),
        lastReason: summary?.lastDesyncReason ?? null,
        lastSeverity: summary?.lastDesyncSeverity ?? null,
        total: summary?.desyncCount ?? 0,
        lastTickDelta: summary?.lastDesyncTickDelta ?? null,
        maxTickDelta: summary?.maxAbsoluteDesyncTickDelta ?? 0,
        lastPieceDelta: summary?.lastDesyncPieceIndexDelta ?? null,
        maxPieceDelta: summary?.maxAbsoluteDesyncPieceIndexDelta ?? 0,
        shadowTick: summary?.shadowTick ?? null,
        shadowPieceIndex: summary?.shadowPieceIndex ?? null,
    }
}

export function createShadowStateDebugRow(shadow, currentPlayerId = null) {
    return {
        ...createShadowSummaryDebugRow(shadow?.summary),
        ...createAuthoritativeSnapshotDebugRow(
            shadow?.lastAuthoritativeSnapshot,
            null,
            currentPlayerId,
        ),
    }
}

export function warnCriticalPlacementDebug(row, logWarn = console.warn, warningState = null) {
    if (row?.recentPlacementAttentionLevel !== "critical") {
        if (warningState) {
            warningState.lastCriticalPlacementWarningKey = null
        }
        return
    }
    if (typeof logWarn !== "function") return

    const warningPayload = {
        attention: row.recentPlacementAttentionLevel,
        driftLevel: row.recentPlacementDriftLevel ?? null,
        hint: row.recentDominantPlacementInvestigationHint ?? null,
        maxTickDelta: getIntegerOrNull(row.recentMaxPlacementTickDelta),
        maxPieceIndexDelta: getIntegerOrNull(row.recentMaxPlacementPieceIndexDelta),
    }
    const warningKey = JSON.stringify(warningPayload)

    if (warningState && warningState.lastCriticalPlacementWarningKey === warningKey) {
        return
    }

    if (warningState) {
        warningState.lastCriticalPlacementWarningKey = warningKey
    }

    logWarn("critical placement drift detected:", warningPayload)
}

export function createPlacementComparisonDebugRows(shadow) {
    if (!Array.isArray(shadow?.recentPlacementComparisonLog)) return []

    return shadow.recentPlacementComparisonLog.map((entry, index) => {
        return {
            debugType: "placement_comparison",
            index,
            recordedAt: Number.isFinite(entry?.recordedAt) ? entry.recordedAt : null,
            fields: formatDesyncFields(entry?.fields),
            fieldCount: Array.isArray(entry?.fields) ? entry.fields.length : 0,
            clientTick: getIntegerOrNull(entry?.clientTick),
            shadowTick: getIntegerOrNull(entry?.shadowTick),
            tickDelta: getIntegerOrNull(entry?.tickDelta),
            clientPieceIndex: getIntegerOrNull(entry?.clientPieceIndex),
            shadowPieceIndex: getIntegerOrNull(entry?.shadowPieceIndex),
            pieceIndexDelta: getIntegerOrNull(entry?.pieceIndexDelta),
            pieceAlignment: getPieceIndexDirection(entry?.pieceIndexDelta),
            investigationHint: getPlacementComparisonInvestigationHint(entry),
            ...createPlacementComparisonFieldRow(entry?.details, "attackLines"),
            ...createPlacementComparisonFieldRow(entry?.details, "canceledGarbageLines"),
            ...createPlacementComparisonFieldRow(entry?.details, "rawAttackLines"),
            ...createPlacementComparisonFieldRow(entry?.details, "appliedGarbageLines"),
            ...createPlacementComparisonFieldRow(entry?.details, "scoreBefore"),
            ...createPlacementComparisonFieldRow(entry?.details, "scoreAfter"),
            ...createPlacementComparisonFieldRow(entry?.details, "scoreDelta"),
        }
    })
}

export function createAuthoritativeSnapshotDebugRow(snapshot, delivery = null, currentPlayerId = null) {
    const snapshotPayload = snapshot?.snapshot ?? snapshot

    return {
        authoritativeDebugType: "authoritative_snapshot",
        authoritativeDelivery: delivery,
        authoritativeRoomId: snapshot?.roomId ?? null,
        authoritativePlayerId: snapshot?.playerId ?? null,
        authoritativeSource: snapshot?.source ?? null,
        authoritativeUpdateReason: snapshot?.updateReason ?? null,
        authoritativeUpdateSequence: getIntegerOrNull(snapshot?.updateSequence),
        authoritativePlayerScope: getAuthoritativeSnapshotScope(snapshot?.playerId, currentPlayerId),
        authoritativeCreatedAt: Number.isFinite(snapshot?.createdAt)
            ? snapshot.createdAt
            : null,
        authoritativeTick: getIntegerOrNull(snapshotPayload?.tick),
        authoritativePieceIndex: getIntegerOrNull(snapshotPayload?.pieceIndex),
        authoritativePhase: snapshotPayload?.phase ?? null,
        authoritativeFallIntervalMs: getNumberOrNull(snapshotPayload?.fallIntervalMs),
        authoritativeCombo: getIntegerOrNull(snapshotPayload?.combo),
        authoritativeBackToBack: getBooleanOrNull(snapshotPayload?.backToBack),
        authoritativeScore: Number.isFinite(snapshotPayload?.score)
            ? snapshotPayload.score
            : 0,
        authoritativeLines: Number.isInteger(snapshotPayload?.linesClearedTotal)
            ? snapshotPayload.linesClearedTotal
            : 0,
        authoritativeGarbageLines: getPendingGarbageLines(snapshotPayload?.pendingGarbageQueue),
        authoritativeActivePiece: formatActivePiece(snapshotPayload?.activePiece),
        authoritativePieceQueue: formatPieceQueue(snapshotPayload?.pieceQueue),
        authoritativeHold: formatHoldState(
            snapshotPayload?.holdPieceType,
            snapshotPayload?.holdUsedThisDrop,
        ),
        authoritativeBoardChecksum: createBoardChecksum(snapshotPayload?.board),
    }
}

export function attachAuthoritativeSnapshotUpdateDebug({
    debugEnabled,
    roomId,
    playerId,
    subscribeUpdate,
    unsubscribeUpdate,
    receiveUpdate,
    receiveSubscribeResult,
    receiveUnsubscribeResult,
    handleResolvedTarget,
    handleSubscribeResult,
    logTable = console.table,
    logWarn = console.warn,
} = {}) {
    if (!debugEnabled) return null
    if (typeof receiveUpdate !== "function") return null

    if (typeof subscribeUpdate === "function") {
        subscribeUpdate(roomId, playerId)
    }

    const detachUpdate = receiveUpdate((result) => {
        if (!result?.ok) {
            logWarn("authoritative snapshot update debug failed:", result?.reason)
            return
        }

        logTable(createAuthoritativeSnapshotDebugRow(result, "push", playerId))

        if (typeof handleResolvedTarget === "function") {
            handleResolvedTarget(resolveAuthoritativeSnapshotTarget(result, playerId))
        }
    })
    const detachSubscribeResult = typeof receiveSubscribeResult === "function"
        ? receiveSubscribeResult((result) => {
            if (typeof handleSubscribeResult === "function") {
                handleSubscribeResult(result)
            }
            if (!result?.ok) {
                logWarn("authoritative snapshot update subscribe failed:", result?.reason)
            }
        })
        : null
    const detachUnsubscribeResult = typeof receiveUnsubscribeResult === "function"
        ? receiveUnsubscribeResult((result) => {
            if (!result?.ok) {
                logWarn("authoritative snapshot update unsubscribe failed:", result?.reason)
            }
        })
        : null

    return () => {
        detachUpdate?.()
        detachSubscribeResult?.()
        detachUnsubscribeResult?.()

        if (typeof unsubscribeUpdate === "function") {
            unsubscribeUpdate(roomId, playerId)
        }
    }
}

function formatPieceQueue(pieceQueue) {
    if (!Array.isArray(pieceQueue)) return null

    return pieceQueue.join(",")
}

function formatHoldState(holdPieceType, holdUsedThisDrop) {
    if (holdPieceType === undefined && holdUsedThisDrop === undefined) {
        return null
    }

    if (holdPieceType === null && holdUsedThisDrop === null) {
        return null
    }

    return `${holdPieceType ?? "none"}:${holdUsedThisDrop ?? "unknown"}`
}

function formatBoardDiff(boardDiff) {
    if (!boardDiff) return null

    return `${boardDiff.row},${boardDiff.col}:${boardDiff.client ?? "null"}/${boardDiff.shadow ?? "null"}`
}

function formatDesyncFields(fields) {
    if (!Array.isArray(fields) || fields.length === 0) return null

    return fields.join(",")
}

function formatCountMap(counts) {
    if (!counts || typeof counts !== "object" || Array.isArray(counts)) return null

    const entries = Object.entries(counts)
        .filter(([, count]) => Number.isInteger(count) && count > 0)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))

    if (entries.length === 0) return null

    return entries.map(([key, count]) => `${key}:${count}`).join("|")
}

function formatActivePiece(piece) {
    if (!piece || typeof piece !== "object") return null
    if (typeof piece.pieceType !== "string") return null
    if (!Number.isInteger(piece.rotation) || !Number.isInteger(piece.row) || !Number.isInteger(piece.col)) {
        return null
    }

    return `${piece.pieceType}:${piece.rotation}@${piece.row},${piece.col}`
}

function createPlacementComparisonFieldRow(details, field) {
    const detail = details?.[field]
    const prefix = field

    return {
        [`${prefix}Client`]: getNumberOrNull(detail?.client),
        [`${prefix}Shadow`]: getNumberOrNull(detail?.shadow),
        [`${prefix}Delta`]: getNumberOrNull(detail?.delta),
    }
}

function getPendingGarbageLines(queue) {
    if (!Array.isArray(queue)) return 0

    return queue.reduce((total, garbage) => {
        return total + (Number.isInteger(garbage?.lines) ? garbage.lines : 0)
    }, 0)
}

function getIntegerOrNull(value) {
    return Number.isInteger(value) ? value : null
}

function getNumberOrNull(value) {
    return Number.isFinite(value) ? value : null
}

function getBooleanOrNull(value) {
    return typeof value === "boolean" ? value : null
}

function getPieceIndexDirection(pieceIndexDelta) {
    if (!Number.isInteger(pieceIndexDelta)) return null

    if (pieceIndexDelta > 0) return "client_ahead"
    if (pieceIndexDelta < 0) return "shadow_ahead"

    return "in_sync"
}

function getPlacementComparisonInvestigationHint(entry) {
    const pieceIndexDelta = getIntegerOrNull(entry?.pieceIndexDelta)
    if (pieceIndexDelta !== null && pieceIndexDelta !== 0) {
        return "CHECK_PLACEMENT_LOCK_SPAWN_ORDER"
    }

    const fields = Array.isArray(entry?.fields) ? entry.fields : []

    if (
        fields.includes("attackLines")
        || fields.includes("canceledGarbageLines")
        || fields.includes("incomingGarbageLines")
        || fields.includes("appliedGarbageLines")
        || fields.includes("rawAttackLines")
    ) {
        return "CHECK_PLACEMENT_GARBAGE_RESULT_FLOW"
    }

    if (
        fields.includes("combo")
        || fields.includes("backToBack")
        || fields.includes("isTSpin")
    ) {
        return "CHECK_PLACEMENT_ATTACK_RULE_FLOW"
    }

    if (fields.includes("linesCleared")) return "CHECK_PLACEMENT_LINE_CLEAR_RESULT_FLOW"
    if (
        fields.includes("scoreBefore")
        || fields.includes("scoreAfter")
        || fields.includes("scoreDelta")
    ) {
        return "CHECK_PLACEMENT_SCORE_RESULT_FLOW"
    }
    if (fields.includes("gameOver")) return "CHECK_PLACEMENT_GAME_OVER_FLOW"
    if (fields.length > 0) return "CHECK_PLACEMENT_RESULT_FLOW"

    return null
}

function createBoardChecksum(board) {
    if (!Array.isArray(board)) return null

    const serializedBoard = JSON.stringify(board)
    let hash = 5381

    for (let i = 0; i < serializedBoard.length; i++) {
        hash = ((hash << 5) + hash) ^ serializedBoard.charCodeAt(i)
        hash >>>= 0
    }

    return hash.toString(16).padStart(8, "0")
}
