function createPublicPlayerDto(player) {
    return {
        playerId: player.playerId,
        nickname: player.nickname,
        playerType: player.playerType,
    }
}

function createRoomPublicDto(room) {
    if (!room) return null

    const dto = {}
    const scalarFields = [
        "roomId",
        "mode",
        "aiDifficulty",
        "aiPolicy",
        "hostPlayerId",
        "status",
        "createdAt",
    ]
    scalarFields.forEach((field) => {
        if (Object.hasOwn(room, field)) dto[field] = room[field]
    })
    if (Object.hasOwn(room, "players")) {
        dto.players = Array.isArray(room.players)
            ? room.players.map(createPublicPlayerDto)
            : []
    }

    return dto
}

function createPublicRoomResult(result) {
    return {
        ...result,
        room: createRoomPublicDto(result?.room),
    }
}

module.exports = {
    createPublicRoomResult,
    createRoomPublicDto,
}
