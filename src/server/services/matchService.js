const matches = new Map();
const BAG_PIECES = ["bar", "eleft", "eright", "ess", "square", "tree", "zee"];
const INITIAL_BAG_CHUNK_COUNT = 3;

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

    const match = {
        roomId: room.roomId,
        status: room.status || "playing",
        players: room.players.map((player) => ({
            playerId: player.playerId,
            inputLog: [],
            bagChunks: createInitialBagChunks(),
        })),
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

    player.inputLog.push({
        playerId,
        action: input.action,
        tick: input.tick ?? null,
        pieceIndex: input.pieceIndex ?? null,
        sequence: player.inputLog.length + 1,
        receivedAt: Date.now(),
    });

    return createSuccess(match);
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

    return createSuccess(match, { bagChunk });
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

function resetMatches() {
    matches.clear();
}

module.exports = {
    appendPlayerBagChunk,
    createMatch,
    getMatchState,
    recordInput,
    resetMatches,
};
