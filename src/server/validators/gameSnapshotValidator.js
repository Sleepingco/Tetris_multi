const VALID_PHASES = new Set(["playing", "lineClearing", "gameOver"]);
const AUTHORITATIVE_SNAPSHOT_FIELDS = Object.freeze([
    "board",
    "activePiece",
    "pieceQueue",
    "holdPieceType",
    "holdUsedThisDrop",
    "score",
    "linesClearedTotal",
    "phase",
    "fallIntervalMs",
    "combo",
    "backToBack",
    "pendingGarbageQueue",
    "tick",
    "pieceIndex",
]);

function createSuccess(snapshot) {
    return {
        ok: true,
        snapshot,
        reason: null,
    };
}

function createFailure(reason) {
    return {
        ok: false,
        snapshot: null,
        reason,
    };
}

function validateGameSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
        return createFailure("SNAPSHOT_REQUIRED");
    }

    if (!Array.isArray(snapshot.board)) {
        return createFailure("BOARD_REQUIRED");
    }

    if ("activePiece" in snapshot && !isValidPiece(snapshot.activePiece)) {
        return createFailure("INVALID_ACTIVE_PIECE");
    }

    if ("score" in snapshot && !Number.isFinite(snapshot.score)) {
        return createFailure("INVALID_SCORE");
    }

    if ("linesClearedTotal" in snapshot && !Number.isInteger(snapshot.linesClearedTotal)) {
        return createFailure("INVALID_LINES_CLEARED_TOTAL");
    }

    if ("phase" in snapshot && !VALID_PHASES.has(snapshot.phase)) {
        return createFailure("INVALID_PHASE");
    }

    if ("fallIntervalMs" in snapshot && !Number.isFinite(snapshot.fallIntervalMs)) {
        return createFailure("INVALID_FALL_INTERVAL");
    }

    if ("tick" in snapshot && !Number.isInteger(snapshot.tick)) {
        return createFailure("INVALID_TICK");
    }

    if ("pieceIndex" in snapshot && !Number.isInteger(snapshot.pieceIndex)) {
        return createFailure("INVALID_PIECE_INDEX");
    }

    if ("holdUsedThisDrop" in snapshot && typeof snapshot.holdUsedThisDrop !== "boolean") {
        return createFailure("INVALID_HOLD_USED_THIS_DROP");
    }

    if ("holdPieceType" in snapshot && !isNullableString(snapshot.holdPieceType)) {
        return createFailure("INVALID_HOLD_PIECE_TYPE");
    }

    if ("pieceQueue" in snapshot && !Array.isArray(snapshot.pieceQueue)) {
        return createFailure("INVALID_PIECE_QUEUE");
    }

    if ("combo" in snapshot && !Number.isInteger(snapshot.combo)) {
        return createFailure("INVALID_COMBO");
    }

    if ("backToBack" in snapshot && typeof snapshot.backToBack !== "boolean") {
        return createFailure("INVALID_BACK_TO_BACK");
    }

    if ("pendingGarbageQueue" in snapshot && !isValidPendingGarbageQueue(snapshot.pendingGarbageQueue)) {
        return createFailure("INVALID_PENDING_GARBAGE_QUEUE");
    }

    return createSuccess(snapshot);
}

function createAuthoritativeSnapshot(source) {
    return AUTHORITATIVE_SNAPSHOT_FIELDS.reduce((snapshot, field) => {
        snapshot[field] = cloneSnapshotValue(source?.[field]);
        return snapshot;
    }, {});
}

function isValidPiece(piece) {
    if (!piece || typeof piece !== "object" || Array.isArray(piece)) {
        return false;
    }

    return typeof piece.pieceType === "string"
        && Number.isInteger(piece.rotation)
        && Number.isInteger(piece.row)
        && Number.isInteger(piece.col);
}

function isValidPendingGarbageQueue(queue) {
    if (!Array.isArray(queue)) return false;

    return queue.every((garbage) => {
        return garbage
            && typeof garbage === "object"
            && !Array.isArray(garbage)
            && Number.isInteger(garbage.lines)
            && garbage.lines > 0
            && (garbage.holeCol === null || Number.isInteger(garbage.holeCol));
    });
}

function isNullableString(value) {
    return value === null || typeof value === "string";
}

function cloneSnapshotValue(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

module.exports = {
    AUTHORITATIVE_SNAPSHOT_FIELDS,
    createAuthoritativeSnapshot,
    validateGameSnapshot,
};
