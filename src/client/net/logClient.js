import {
    getServerConnection,
    sendPlacementDecisionLogEvent,
} from "./roomClient.js"

export function sendPlacementDecisionLog(roomId, playerId, log) {
    try {
        sendPlacementDecisionLogEvent(roomId, log)
    } catch (error) {
        console.warn("placement_decision log send failed:", error)
    }
}

export function onPlacementDecisionLogResult(handler) {
    getServerConnection().on("game:log:result", handler)

    return () => {
        getServerConnection().off("game:log:result", handler)
    }
}
