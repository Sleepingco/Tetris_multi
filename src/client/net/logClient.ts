/**
 * gameplay runtime과 roomClient의 분석 로그 channel 사이에 둔 작은 어댑터다.
 *
 * placement log는 학습·분석용 부수효과이므로 전송 예외가 실제 게임 진행을 중단시키면 안 된다.
 * 반대로 서버 응답은 roomClient의 공유 schema 검증을 이미 통과한 값만 그대로 전달한다.
 */
import {
    onPlacementDecisionLogResult as onValidatedPlacementDecisionLogResult,
    sendPlacementDecisionLogEvent,
} from "./roomClient.ts"
import type { ServerToClientParsedPayload } from "../../shared/socketContractTypes.d.ts"

/**
 * placement decision을 서버로 보내되 동기 예외는 경고로만 남긴다.
 *
 * playerId는 기존 호출 계약을 유지하기 위한 인자다. 실제 저장 주체는 client 값이 아니라
 * 서버가 인증한 session의 playerId와 room membership으로 다시 결정한다.
 */
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

/**
 * 서버의 검증·저장 결과를 구독하고, 반환된 함수로 같은 listener를 해제한다.
 */
export function onPlacementDecisionLogResult(
    handler: (result: ServerToClientParsedPayload<"game:log:result">) => void,
): () => void {
    return onValidatedPlacementDecisionLogResult(handler)
}
