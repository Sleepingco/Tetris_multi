// =============================
// 페이지 공용 테마 상태
// 최종 테마의 원천은 `<html data-theme>`이고 localStorage는 다음 방문을 위한 사용자 선택 저장소다.
// 버튼 문구와 aria 상태를 같은 값에서 파생해 화면과 접근성 상태가 어긋나지 않게 한다.
// =============================

/**
 * 저장된 사용자 선택을 우선 적용하고, 없으면 운영체제 dark mode 설정을 사용한다.
 * document와 선택적인 토글 버튼을 함께 갱신하며 최종 적용한 theme을 반환한다.
 */
export function applySavedTheme(themeToggleBtn: Element | null): string {
    const saved = localStorage.getItem("theme");
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
    const theme = saved || (prefersDark ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
    syncThemeToggle(themeToggleBtn, theme);
    return theme;
}

/**
 * 현재 document theme을 light/dark 사이에서 전환하고 다음 방문을 위해 저장한다.
 * Canvas 색상은 CSS 계산값을 사용하므로 게임 페이지 호출자는 전환 뒤 board를 다시 렌더한다.
 */
export function toggleTheme(themeToggleBtn: Element | null): string {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    syncThemeToggle(themeToggleBtn, next);
    return next;
}

// 버튼 동기화는 위 두 공개 진입점이 공유하는 작은 DOM helper다.
function syncThemeToggle(themeToggleBtn: Element | null, theme: string): void {
    if (!themeToggleBtn) return;
    themeToggleBtn.textContent = theme === "dark" ? "라이트 모드" : "다크 모드";
    themeToggleBtn.setAttribute("aria-pressed", String(theme === "dark"));
}
