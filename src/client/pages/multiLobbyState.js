export function resolveFailedRoomResultEffect(result, requestType) {
    const reason = result?.reason || "ROOM_ERROR";
    const shouldClearRoom = requestType === "sync"
        || (requestType === "join" && reason === "ROOM_NOT_FOUND");

    return {
        shouldClearRoom,
        message: requestType === "sync" ? null : reason,
    };
}

export function shouldResetPlayerSession(search = "") {
    const normalizedSearch = search.startsWith("?") ? search : `?${search}`;
    const params = new URLSearchParams(normalizedSearch);

    return params.get("resetPlayer") === "1";
}
