export const INPUT_ACTION = {
    MOVE_LEFT: "move_left",
    MOVE_RIGHT: "move_right",
    SOFT_DROP: "soft_drop",
    ROTATE: "rotate",
    HARD_DROP: "hard_drop",
    HOLD: "hold",
}

const NON_REPEATABLE_ACTIONS = new Set([
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

function mapKeyboardEventToAction(event) {
    if (event.code === "KeyC" || event.key?.toLowerCase() === "c") return INPUT_ACTION.HOLD
    if (event.key === "ArrowRight") return INPUT_ACTION.MOVE_RIGHT
    if (event.key === "ArrowLeft") return INPUT_ACTION.MOVE_LEFT
    if (event.key === "ArrowDown") return INPUT_ACTION.SOFT_DROP
    if (event.key === "ArrowUp") return INPUT_ACTION.ROTATE
    if (event.code === "Space" || event.key === " ") return INPUT_ACTION.HARD_DROP
    return null
}

export function attachKeyboardInput({ enqueueAction, onUserInteract }) {
    if (typeof enqueueAction !== "function") return () => { }

    const onKeydown = (event) => {
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

