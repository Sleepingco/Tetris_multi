import type { InputAction } from "../src/client/game/runtime/input.ts";
import type { TetrisRuntime } from "../src/client/game/runtime/tetris.ts";

type SendGameInput = typeof import("../src/client/net/roomClient.ts").sendGameInput;

function verifyInputActionContract(runtime: TetrisRuntime): void {
    const moveLeft: InputAction = "move_left";
    runtime.enqueueInput(moveLeft);

    // @ts-expect-error unsupported actions must not enter the runtime queue.
    runtime.enqueueInput("delete_board");
}

void verifyInputActionContract;

function verifyGameInputContract(sendGameInput: SendGameInput): void {
    sendGameInput("ABCDEF12", "player", "hold", 1, 1, 1);
    sendGameInput("ABCDEF12", "player", "move_left", 1, 1, 1, {
        pieceType: "bar",
        rotation: 0,
        col: 2,
    });

    // @ts-expect-error game:input rejects unknown actions.
    sendGameInput("ABCDEF12", "player", "delete_board", 1, 1, 1);
    // @ts-expect-error non-hold game:input requires expectedTransform.
    sendGameInput("ABCDEF12", "player", "move_left", 1, 1, 1);
    // @ts-expect-error game:input tick is numeric.
    sendGameInput("ABCDEF12", "player", "hold", "1", 1, 1);
}

void verifyGameInputContract;
