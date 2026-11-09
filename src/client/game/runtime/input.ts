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
} as const satisfies Record<string, InputAction>;

export type InputController = ReturnType<typeof createInputController>;
const horizontal = (action: InputAction) => action === "move_left" || action === "move_right";

/** 키보드와 터치의 눌림을 함께 관리하며 지연된 반복 입력은 몰아서 재생하지 않는다. */
export function createInputController({ enqueueAction, onUserInteract, isActive = () => true }: {
    enqueueAction: (action: InputAction) => unknown;
    onUserInteract?: (() => void) | null;
    isActive?: () => boolean;
}) {
    const held = new Map<string, InputAction>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let direction: InputAction | null = null;
    let horizontalAt = 0;
    let softDropAt = 0;
    let destroyed = false;
    const emittedAt: number[] = [];
    function emit(action: InputAction) {
        const now = performance.now();
        while (emittedAt.length && emittedAt[0] <= now - 1000) emittedAt.shift();
        if (emittedAt.length >= 55) return;
        emittedAt.push(now);
        enqueueAction(action);
    }
    function reset() {
        held.clear();
        direction = null;
        if (timer !== null) clearTimeout(timer);
        timer = null;
    }
    function repeat() {
        timer = null;
        if (destroyed || !isActive()) {
            reset();
            return;
        }
        const now = performance.now();
        if (direction && now >= horizontalAt) {
            emit(direction);
            horizontalAt = now + 60;
        }
        if ([...held.values()].includes("soft_drop") && now >= softDropAt) {
            emit("soft_drop");
            softDropAt = now + 60;
        }
        if (direction || [...held.values()].includes("soft_drop")) timer = setTimeout(repeat, 10);
    }
    function press(source: string, action: InputAction) {
        if (destroyed || held.has(source) || !isActive()) return;
        onUserInteract?.();
        held.set(source, action);
        emit(action);
        if (horizontal(action)) {
            direction = action;
            horizontalAt = performance.now() + 180;
        }
        if (action === "soft_drop") softDropAt = performance.now() + 60;
        if (timer === null && (horizontal(action) || action === "soft_drop")) timer = setTimeout(repeat, 10);
    }
    function release(source: string) {
        const action = held.get(source);
        held.delete(source);
        if (action && horizontal(action)) {
            const next = [...held.values()].reverse().find(horizontal) ?? null;
            if (next !== direction) {
                direction = next;
                horizontalAt = performance.now() + 180;
            }
        }
        if (!held.size) reset();
    }
    return {
        press, release, reset,
        destroy() {
            reset();
            destroyed = true;
        },
    };
}

function mapKeyboardEventToAction(event: KeyboardEvent): InputAction | null {
    if (event.code === "KeyC" || event.key?.toLowerCase() === "c") return "hold";
    if (event.key === "ArrowRight") return "move_right";
    if (event.key === "ArrowLeft") return "move_left";
    if (event.key === "ArrowDown") return "soft_drop";
    if (event.code === "KeyX" || event.key?.toLowerCase() === "x" || event.key === "ArrowUp") return "rotate";
    if (event.code === "Space" || event.key === " ") return "hard_drop";
    if (event.code === "KeyZ" || event.key?.toLowerCase() === "z") return "rotate_ccw";
    return null;
}

/** listener와 모든 held 입력을 cleanup한다. 입력창과 버튼의 기본 키 조작은 보존한다. */
export function attachKeyboardInput({ enqueueAction, onUserInteract, controller }: {
    enqueueAction: ((action: InputAction) => unknown) | null | undefined;
    onUserInteract?: (() => void) | null;
    controller?: InputController;
}): () => void {
    if (!enqueueAction) return () => {};
    const input = controller ?? createInputController({ enqueueAction, onUserInteract });
    const interactive = (target: EventTarget | null) => typeof Element !== "undefined" && target instanceof Element && !!target.closest("input,textarea,select,button,a,summary,[contenteditable]:not([contenteditable=false])");
    const onFocus = (event: FocusEvent) => { if (interactive(event.target)) input.reset(); };
    const onKeydown = (event: KeyboardEvent) => {
        if (event.metaKey || event.ctrlKey || event.altKey || ["Meta", "Control", "Alt"].includes(event.key)) {
            input.reset();
            return;
        }
        const target = event.target;
        if (typeof Element !== "undefined" && target instanceof Element
            && (target.closest("input,textarea,select,[contenteditable]:not([contenteditable=false])")
                || (interactive(target) && (event.key === " " || event.code === "Space")))) return;
        const action = mapKeyboardEventToAction(event);
        if (!action) return;
        event.preventDefault();
        if (!event.repeat) input.press(`key:${event.code || event.key}`, action);
    };
    const onKeyup = (event: KeyboardEvent) => input.release(`key:${event.code || event.key}`);
    const reset = () => input.reset();
    const visibility = () => { if (document.hidden) reset(); };
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("keyup", onKeyup);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", reset);
    window.addEventListener("pagehide", reset);
    return () => {
        document.removeEventListener("keydown", onKeydown);
        document.removeEventListener("keyup", onKeyup);
        document.removeEventListener("focusin", onFocus);
        document.removeEventListener("visibilitychange", visibility);
        window.removeEventListener("blur", reset);
        window.removeEventListener("pagehide", reset);
        input.destroy();
    };
}
