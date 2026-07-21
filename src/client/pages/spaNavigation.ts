export const SPA_NAVIGATION_EVENT = "tetris:navigation";

const SPA_PATHS = new Set([
    "/",
    "/pages/index.html",
    "/pages/multiLobby.html",
    "/pages/tetrisSingle.html",
    "/pages/tetrisMulti.html",
]);
const routeExitHandlers = new Set<(nextUrl: URL) => void>();

export function isSpaPath(pathname: string): boolean {
    return SPA_PATHS.has(pathname);
}

export function registerRouteExit(handler: (nextUrl: URL) => void): () => void {
    routeExitHandlers.add(handler);
    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        routeExitHandlers.delete(handler);
    };
}

export function leaveCurrentRoute(nextUrl: URL): void {
    [...routeExitHandlers].forEach(handler => handler(nextUrl));
}

export function navigate(target: string, { replace = false } = {}): void {
    const nextUrl = new URL(target, window.location.href);
    if (nextUrl.origin !== window.location.origin || !isSpaPath(nextUrl.pathname)) {
        window.location.assign(nextUrl.href);
        return;
    }
    if (nextUrl.href === window.location.href) return;

    leaveCurrentRoute(nextUrl);
    window.history[replace ? "replaceState" : "pushState"](null, "", nextUrl);
    window.dispatchEvent(new Event(SPA_NAVIGATION_EVENT));
}
