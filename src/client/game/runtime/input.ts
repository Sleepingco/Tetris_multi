// =============================
// 키보드 입력 매핑
// 브라우저마다 표현이 다른 key 값을 게임이 이해하는 InputAction으로 정규화한다.
// 여기서는 board를 움직이지 않고 action을 runtime queue에 전달하는 입력 경계만 담당한다.
// =============================

import type { InputAction } from "../state/stateFactory.ts";

export type { InputAction };

export const INPUT_ACTION = {
    MOVE_LEFT: "move_left",
    MOVE_RIGHT: "move_right",
    SOFT_DROP: "soft_drop",
    ROTATE: "rotate",
    HARD_DROP: "hard_drop",
    HOLD: "hold",
    ROTATE_CCW: "rotate_ccw",
} as const satisfies Record<string, InputAction>

const NON_REPEATABLE_ACTIONS = new Set<InputAction>([
    INPUT_ACTION.HOLD,
    INPUT_ACTION.HARD_DROP,
    INPUT_ACTION.ROTATE,
    INPUT_ACTION.ROTATE_CCW,
])

const PREVENT_DEFAULT_KEYS = new Set([
    "ArrowRight",
    "ArrowLeft",
    "ArrowDown",
    "ArrowUp",
    " ",
])

/**
  * `key`와 `code`를 함께 확인해 브라우저 키보드 이벤트를 게임 action으로 바꾼다.
  * 게임과 무관한 키는 null로 돌려보내 호출자가 그대로 무시하게 한다.
  */
function mapKeyboardEventToAction(event: KeyboardEvent): InputAction | null {
    if (event.code === "KeyC" || event.key?.toLowerCase() === "c") return INPUT_ACTION.HOLD
    if (event.key === "ArrowRight") return INPUT_ACTION.MOVE_RIGHT
    if (event.key === "ArrowLeft") return INPUT_ACTION.MOVE_LEFT
    if (event.key === "ArrowDown") return INPUT_ACTION.SOFT_DROP
    if (event.code === "KeyX" || event.key?.toLowerCase() === "x" || event.key === "ArrowUp") return INPUT_ACTION.ROTATE
    if (event.code === "Space" || event.key === " ") return INPUT_ACTION.HARD_DROP
    if (event.code === "KeyZ" || event.key?.toLowerCase() === "z") return INPUT_ACTION.ROTATE_CCW
    return null
}

/**
  * document에 키보드 listener를 연결하고 같은 listener를 제거하는 cleanup 함수를 반환한다.
  * - 홀드, 하드 드롭, 회전은 키 반복 입력을 무시한다.
  * - 방향키와 스페이스는 브라우저 기본 스크롤 동작을 막는다.
  * - 실제 적용 가능 여부와 처리 순서는 `enqueueAction` 이후 runtime이 결정한다.
  *
  * 페이지 unmount 시 반환한 함수를 호출해야 중복 listener와 메모리 누수를 막을 수 있다.
  */
export function attachKeyboardInput({
    enqueueAction,
    onUserInteract,
}: {
    enqueueAction: ((action: InputAction) => unknown) | null | undefined;
    onUserInteract?: (() => void) | null;
}): () => void {
    if (typeof enqueueAction !== "function") return () => { }

    const onKeydown = (event: KeyboardEvent) => {
        if (typeof onUserInteract === "function") onUserInteract()

        const action = mapKeyboardEventToAction(event)
        if (!action) return

        if (event.repeat && NON_REPEATABLE_ACTIONS.has(action)) return
        if (PREVENT_DEFAULT_KEYS.has(event.key) || event.code === "Space") event.preventDefault()

        enqueueAction(action)
    }

    document.addEventListener("keydown", onKeydown)
    return () => {
        document.removeEventListener("keydown", onKeydown)
    }
}
