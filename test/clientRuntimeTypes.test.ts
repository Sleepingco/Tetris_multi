import type { InputAction } from "../src/client/game/runtime/input.ts";
import type { TetrisRuntime } from "../src/client/game/runtime/tetris.ts";

function verifyInputActionContract(runtime: TetrisRuntime): void {
    const moveLeft: InputAction = "move_left";
    runtime.enqueueInput(moveLeft);

    // @ts-expect-error unsupported actions must not enter the runtime queue.
    runtime.enqueueInput("delete_board");
}

void verifyInputActionContract;
