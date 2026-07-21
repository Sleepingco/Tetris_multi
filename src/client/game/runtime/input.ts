// =============================
// 키보드 입력 매핑
// DOM 키보드 이벤트를 게임 액션으로 정규화한다.
// =============================

export const INPUT_ACTION = {
        MOVE_LEFT: "move_left",
        MOVE_RIGHT: "move_right",
        SOFT_DROP: "soft_drop",
        ROTATE: "rotate",
        HARD_DROP: "hard_drop",
        HOLD: "hold",
} as const

export type InputAction = typeof INPUT_ACTION[keyof typeof INPUT_ACTION];

const NON_REPEATABLE_ACTIONS = new Set<InputAction>([
        INPUT_ACTION.HOLD,
        INPUT_ACTION.HARD_DROP,
        INPUT_ACTION.ROTATE,
])

const PREVENT_DEFAULT_KEYS = new Set([
        "ArrowRight",
        "ArrowLeft",
        "ArrowDown",
        "ArrowUp",
        " ",
])

/**
  * 브라우저 키보드 이벤트를 게임 액션으로 변환한다.
  *
  * @param {KeyboardEvent} event - 브라우저 키보드 이벤트
  * @returns {string|null} 정규화된 액션, 무시할 키면 null
  */
function mapKeyboardEventToAction(event: KeyboardEvent): InputAction | null {
        if (event.code === "KeyC" || event.key?.toLowerCase() === "c") return INPUT_ACTION.HOLD
        if (event.key === "ArrowRight") return INPUT_ACTION.MOVE_RIGHT
        if (event.key === "ArrowLeft") return INPUT_ACTION.MOVE_LEFT
        if (event.key === "ArrowDown") return INPUT_ACTION.SOFT_DROP
        if (event.key === "ArrowUp") return INPUT_ACTION.ROTATE
        if (event.code === "Space" || event.key === " ") return INPUT_ACTION.HARD_DROP
        return null
}

/**
  * 전역 키보드 핸들러를 등록하고, 해제 함수를 반환한다.
  * - 홀드, 하드 드롭, 회전은 키 반복 입력을 무시한다.
  * - 방향키와 스페이스는 브라우저 기본 스크롤 동작을 막는다.
  *
  * @param {Object} params - 입력 연결에 필요한 콜백들
  * @param {Function} params.enqueueAction - 정규화된 액션을 큐에 넣는 함수
  * @param {Function} params.onUserInteract - 첫 사용자 상호작용 부수효과용 선택 콜백
  * @returns {Function} 등록한 리스너를 제거하는 정리 함수
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
