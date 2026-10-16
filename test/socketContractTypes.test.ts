/**
 * Zod socket schema에서 유도된 event별 payload 타입을 컴파일 단계에서 고정한다.
 *
 * 준비: client→server wire 입력, 검증 후 parsed 입력, server→client wire 출력 타입을 가져온다.
 * 실행: room/chat/bag/input event의 정상 payload와 의도적으로 잘못된 payload를 선언한다.
 * 검증: 정상 payload는 컴파일되고, 필수 필드 누락·알 수 없는 action·잘못된 조합은
 * `@ts-expect-error`가 가리키는 곳에서 반드시 거부되어야 한다.
 *
 * 특히 `hold`는 좌표 예측값 없이 보낼 수 있지만 이동 action은 `expectedTransform`이 필요하다.
 */
import type {
    ClientToServerParsedPayload,
    ClientToServerWirePayload,
    ServerToClientWirePayload,
    ServerToClientParsedPayload,
} from "../src/shared/socketContractTypes";

const roomId = "ABCDEF12";
const roomRequest: ClientToServerWirePayload<"room:join"> = { roomId };
const parsedChat: ClientToServerParsedPayload<"global:chat"> = { text: "hello" };
const bagResult: ServerToClientWirePayload<"game:bag:result"> = {
    ok: false,
    room: null,
    reason: "BAG_QUEUE_SUFFICIENT",
};
const holdInput: ClientToServerWirePayload<"game:input"> = {
    roomId,
    action: "hold",
    tick: 1,
    pieceIndex: 1,
    clientSequence: 1,
};
const moveInput: ClientToServerWirePayload<"game:input"> = {
    roomId,
    action: "move_left",
    tick: 1,
    pieceIndex: 1,
    clientSequence: 1,
    expectedTransform: { pieceType: "bar", rotation: 0, col: 2 },
};

void roomRequest;
void parsedChat;
void bagResult;
void holdInput;
void moveInput;

// @ts-expect-error room:join requires roomId.
const invalidRoomRequest: ClientToServerWirePayload<"room:join"> = {};
const invalidAction: ClientToServerWirePayload<"game:input"> = {
    roomId,
    // @ts-expect-error game:input action is an enum.
    action: "delete_board",
    tick: 1,
    pieceIndex: 1,
    clientSequence: 1,
};

void invalidRoomRequest;
void invalidAction;

// @ts-expect-error non-hold input requires expectedTransform.
const invalidMoveInput: ClientToServerWirePayload<"game:input"> = {
    roomId,
    action: "move_left",
    tick: 1,
    pieceIndex: 1,
    clientSequence: 1,
};

void invalidMoveInput;

type CombatEffectContract = NonNullable<ServerToClientParsedPayload<"game:authoritative:snapshot">["combatEffect"]>;
const combatEffectContract: CombatEffectContract = {
    id: "event", gameId: "00000000-0000-4000-8000-000000000003", pieceIndex: 1,
    targetPlayerId: null, sentLines: 0, canceledLines: 2, appliedLines: 0,
    linesCleared: 2, isTSpin: false, combo: 0, backToBackBonus: false,
};
// @ts-expect-error 전송량은 숫자 계약이다.
const invalidCombatAmount: CombatEffectContract = { ...combatEffectContract, sentLines: "2" };
// @ts-expect-error 확정 전투 결과에는 필수 필드가 모두 필요하다.
const incompleteCombatEffect: CombatEffectContract = { id: "event" };
void invalidCombatAmount;
void incompleteCombatEffect;
