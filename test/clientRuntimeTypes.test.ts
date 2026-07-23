/**
 * 클라이언트 runtime과 Socket.IO 전송 함수가 같은 입력 action 계약을 쓰는지 컴파일 단계에서 확인한다.
 *
 * 준비: 실제 구현에서 `InputAction`, `TetrisRuntime`, `sendGameInput` 타입을 가져온다.
 * 실행: 허용된 호출과 의도적으로 잘못된 호출을 함수 본문에 함께 작성한다.
 * 검증: 정상 호출은 컴파일되어야 하고, `@ts-expect-error` 다음 줄은 반드시 타입 오류가 나야 한다.
 *
 * 이 함수들을 실제로 실행하지 않는 이유는 값의 동작이 아니라 타입 경계를 검사하기 때문이다.
 * 마지막의 `void` 표현식은 함수가 사용되었다고 표시해 미사용 선언 오류만 피한다.
 */
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
