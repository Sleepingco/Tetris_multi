import {
    onPlacementDecisionLogResult as onValidatedPlacementDecisionLogResult,
    sendPlacementDecisionLogEvent,
} from "./roomClient.ts"
import type { ServerToClientParsedPayload } from "../../shared/socketContractTypes.d.ts"

export function sendPlacementDecisionLog(
    roomId: string,
    _playerId: string,
    log: unknown,
): void {
    try {
        sendPlacementDecisionLogEvent(roomId, log)
    } catch (error) {
        console.warn("placement_decision log send failed:", error)
    }
}

export function onPlacementDecisionLogResult(
    handler: (result: ServerToClientParsedPayload<"game:log:result">) => void,
): () => void {
    return onValidatedPlacementDecisionLogResult(handler)
}
