import {
    onPlacementDecisionLogResult as onValidatedPlacementDecisionLogResult,
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
    return onValidatedPlacementDecisionLogResult(handler)
}
