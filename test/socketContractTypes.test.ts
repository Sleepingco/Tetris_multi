import type {
    ClientToServerParsedPayload,
    ClientToServerWirePayload,
    ServerToClientWirePayload,
} from "../src/shared/socketContractTypes";

const roomId = "ABCDEF12";
const roomRequest: ClientToServerWirePayload<"room:join"> = { roomId };
const parsedChat: ClientToServerParsedPayload<"global:chat"> = { text: "hello" };
const bagResult: ServerToClientWirePayload<"game:bag:result"> = {
    ok: false,
    room: null,
    reason: "BAG_QUEUE_SUFFICIENT",
};

void roomRequest;
void parsedChat;
void bagResult;

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
