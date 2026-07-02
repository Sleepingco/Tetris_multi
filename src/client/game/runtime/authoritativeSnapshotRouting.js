export function getAuthoritativeSnapshotScope(snapshotPlayerId, currentPlayerId) {
    if (!snapshotPlayerId || !currentPlayerId) return null

    return snapshotPlayerId === currentPlayerId
        ? "local"
        : "opponent"
}

export function getAuthoritativeSnapshotApplyMode(search = "") {
    const normalizedSearch = search.startsWith("?") ? search : `?${search}`
    const params = new URLSearchParams(normalizedSearch)

    return params.get("authoritativeApply") === "opponent"
        ? "opponent"
        : "off"
}

export function shouldApplyClientSnapshotCorrection(authoritativeApplyMode) {
    return authoritativeApplyMode !== "opponent"
}

export function shouldApplyOpponentInputPrediction(authoritativeApplyMode) {
    return authoritativeApplyMode !== "opponent"
}

export function shouldAutoStartOpponentRuntime(authoritativeApplyMode) {
    return authoritativeApplyMode !== "opponent"
}

export function shouldApplyOpponentGarbagePrediction(authoritativeApplyMode) {
    return authoritativeApplyMode !== "opponent"
}

export function shouldApplyOpponentBagPrediction(authoritativeApplyMode) {
    return authoritativeApplyMode !== "opponent"
}

export function resolveAuthoritativeSnapshotTarget(result, currentPlayerId) {
    const baseResult = {
        ok: false,
        target: null,
        roomId: result?.roomId ?? null,
        playerId: result?.playerId ?? null,
        snapshot: null,
        updateReason: result?.updateReason ?? null,
        updateSequence: Number.isInteger(result?.updateSequence)
            ? result.updateSequence
            : null,
        reason: result?.reason ?? null,
    }

    if (!result?.ok) {
        return {
            ...baseResult,
            reason: result?.reason ?? "AUTHORITATIVE_SNAPSHOT_FAILED",
        }
    }

    if (!result.playerId || !currentPlayerId) {
        return {
            ...baseResult,
            reason: "PLAYER_ID_REQUIRED",
        }
    }

    if (!result.snapshot) {
        return {
            ...baseResult,
            reason: "SNAPSHOT_REQUIRED",
        }
    }

    return {
        ...baseResult,
        ok: true,
        target: getAuthoritativeSnapshotScope(result.playerId, currentPlayerId),
        snapshot: result.snapshot,
        reason: null,
    }
}

export function applyResolvedAuthoritativeSnapshotTarget(result, targets = {}, options = {}) {
    const baseResult = {
        ok: false,
        applied: false,
        target: result?.target ?? null,
        roomId: result?.roomId ?? null,
        playerId: result?.playerId ?? null,
        updateReason: result?.updateReason ?? null,
        updateSequence: Number.isInteger(result?.updateSequence)
            ? result.updateSequence
            : null,
        reason: result?.reason ?? null,
    }

    if (!result?.ok) {
        return {
            ...baseResult,
            reason: result?.reason ?? "AUTHORITATIVE_SNAPSHOT_TARGET_FAILED",
        }
    }

    if (!result.snapshot) {
        return {
            ...baseResult,
            reason: "SNAPSHOT_REQUIRED",
        }
    }

    const allowedTargets = Array.isArray(options.allowedTargets)
        ? options.allowedTargets
        : ["local", "opponent"]
    if (!allowedTargets.includes(result.target)) {
        return {
            ...baseResult,
            reason: "TARGET_NOT_ALLOWED",
        }
    }

    const targetGame = result.target === "local"
        ? targets.localGame
        : result.target === "opponent"
            ? targets.opponentGame
            : null

    if (typeof targetGame?.applySnapshot !== "function") {
        return {
            ...baseResult,
            reason: "TARGET_RUNTIME_NOT_FOUND",
        }
    }

    targetGame.applySnapshot(result.snapshot)

    return {
        ...baseResult,
        ok: true,
        applied: true,
        reason: null,
    }
}
