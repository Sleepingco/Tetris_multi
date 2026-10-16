const EFFECTS_KEY = "tetrisReducedEffects";

export function loadReducedEffects(): boolean {
    const saved = localStorage.getItem(EFFECTS_KEY);
    return saved === null
        ? typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
        : saved === "true";
}

/** 저장 설정이 없을 때 OS의 모션 설정을 따르고, 버튼과 runtime 설정을 함께 갱신한다. */
export function initEffectToggle(
    button: HTMLButtonElement | null,
    onChange: (reduced: boolean) => void,
): () => void {
    if (!button) return () => {};
    const media = typeof matchMedia === "function"
        ? matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    function update(): void {
        const reduced = loadReducedEffects();
        button!.setAttribute("aria-pressed", String(reduced));
        onChange(reduced);
    }
    function toggle(): void {
        localStorage.setItem(EFFECTS_KEY, String(!loadReducedEffects()));
        update();
    }
    update();
    button.addEventListener("click", toggle);
    media?.addEventListener("change", update);
    return () => {
        button.removeEventListener("click", toggle);
        media?.removeEventListener("change", update);
    };
}
