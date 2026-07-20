export function applySavedTheme(themeToggleBtn: Element | null): string {
    const saved = localStorage.getItem("theme");
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
    const theme = saved || (prefersDark ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
    syncThemeToggle(themeToggleBtn, theme);
    return theme;
}

export function toggleTheme(themeToggleBtn: Element | null): string {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    syncThemeToggle(themeToggleBtn, next);
    return next;
}

function syncThemeToggle(themeToggleBtn: Element | null, theme: string): void {
    if (!themeToggleBtn) return;
    themeToggleBtn.textContent = theme === "dark" ? "라이트 모드" : "다크 모드";
    themeToggleBtn.setAttribute("aria-pressed", String(theme === "dark"));
}
