import { useEffect, useState, useRef } from "react";
import type { InputAction, InputController } from "../runtime/input.ts";

const buttons: [InputAction, string, string][] = [
    ["move_left", "왼쪽 이동", "←"], ["move_right", "오른쪽 이동", "→"],
    ["soft_drop", "소프트 드롭", "↓"], ["rotate", "시계 회전", "↻"],
    ["rotate_ccw", "반시계 회전", "↺"], ["hard_drop", "하드 드롭", "DROP"], ["hold", "홀드", "HOLD"],
];

/** 공유 입력 경계에 pointer별 press/release를 전달한다. gameplay 상태는 소유하지 않는다. */
export function TouchControls({ controller }: { controller: InputController | null }) {
    const [visible, setVisible] = useState(() => window.matchMedia?.("(any-pointer: coarse)").matches ?? false);
    const pointers = useRef(new Map<number, InputAction>());
    const releasePointer = (id: number) => {
        controller?.release(`pointer:${id}`);
        pointers.current.delete(id);
        setPressed(Object.fromEntries([...pointers.current.values()].map(action => [action, true])));
    };
    const [pressed, setPressed] = useState<Record<string, boolean>>({});
    useEffect(() => {
        const reset = () => { controller?.reset(); pointers.current.clear(); setPressed({}); };
        const visibility = () => { if (document.hidden) reset(); };
        window.addEventListener("blur", reset);
        document.addEventListener("visibilitychange", visibility);
        return () => { reset(); window.removeEventListener("blur", reset); document.removeEventListener("visibilitychange", visibility); };
    }, [controller]);
    return <section className="touch-controls" aria-label="터치 조작">
        <button type="button" className="touch-controls-toggle" aria-expanded={visible} aria-controls="touchControlButtons"
            onClick={() => { controller?.reset(); pointers.current.clear(); setPressed({}); setVisible(value => !value); }}>터치 조작 표시</button>
        <div id="touchControlButtons" className="touch-controls-buttons" hidden={!visible}>
            {buttons.map(([action, label, symbol]) => <button key={action} type="button" aria-label={label}
                aria-pressed={!!pressed[action]} disabled={!controller}
                onPointerDown={event => {
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    pointers.current.set(event.pointerId, action);
                    controller?.press(`pointer:${event.pointerId}`, action);
                    setPressed(value => ({ ...value, [action]: true }));
                }}
                onPointerUp={event => releasePointer(event.pointerId)}
                onPointerCancel={event => releasePointer(event.pointerId)}
                onLostPointerCapture={event => releasePointer(event.pointerId)}
                onClick={event => {
                    if (event.detail === 0) { controller?.press(`accessible:${action}`, action); controller?.release(`accessible:${action}`); }
                }}>{symbol}</button>)}
        </div>
    </section>;
}
