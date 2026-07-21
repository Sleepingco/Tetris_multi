const INLINE_SCRIPT_HASHES = Object.freeze([
    "'sha256-dD0UYyHj6Sta8gSAF02VM8IfeQR0k7L4ZYIYWQgUBm0='",
]);

const INLINE_STYLE_HASHES = Object.freeze([
    "'sha256-8WMI54/fYjLyQ+V0ZVpxKy2ddoWYIfTvf6INokq2xEo='",
    "'sha256-isAGgst8p0POY9YHnzg/K0CpLsdJtzLOcjeCXqEi6Q4='",
    "'sha256-IsVLBKuEy1m/EXcXkJQYt/4Hss2umZ0wV/cKhk8GzBs='",
]);

const CONNECT_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);

export const CSP_INLINE_SCRIPT_HASHES = INLINE_SCRIPT_HASHES;
export const CSP_INLINE_STYLE_HASHES = INLINE_STYLE_HASHES;

function readConnectOrigins(environment: NodeJS.ProcessEnv): string[] {
    const configured = environment.CSP_CONNECT_ORIGINS
        ?.split(",")
        .map(origin => origin.trim())
        .filter(Boolean) || [];

    return [...new Set(configured.map(origin => {
        let parsed: URL;
        try {
            parsed = new URL(origin);
        } catch {
            throw new Error("CSP_CONNECT_ORIGINS must contain valid origins");
        }
        if (
            !CONNECT_PROTOCOLS.has(parsed.protocol)
            || parsed.username
            || parsed.password
            || parsed.pathname !== "/"
            || parsed.search
            || parsed.hash
            || parsed.origin === "null"
            || parsed.hostname.includes("*")
        ) {
            throw new Error("CSP_CONNECT_ORIGINS must contain origin-only HTTP or WebSocket URLs");
        }
        return parsed.origin;
    }))];
}

export function createHttpSecurityHeaders(
    environment: NodeJS.ProcessEnv = process.env,
): Readonly<Record<string, string>> {
    const mode = environment.CSP_MODE || "enforce";
    if (mode !== "enforce" && mode !== "report-only") {
        throw new Error("CSP_MODE must be enforce or report-only");
    }

    const connectOrigins = readConnectOrigins(environment);
    const policy = [
        "default-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        `script-src 'self' ${INLINE_SCRIPT_HASHES.join(" ")}`,
        "script-src-attr 'none'",
        `style-src 'self' ${INLINE_STYLE_HASHES.join(" ")}`,
        "style-src-attr 'none'",
        "img-src 'self' data:",
        "font-src 'none'",
        "media-src 'self'",
        `connect-src 'self'${connectOrigins.length ? ` ${connectOrigins.join(" ")}` : ""}`,
        "worker-src 'none'",
    ].join("; ");

    return Object.freeze({
        [mode === "report-only"
            ? "Content-Security-Policy-Report-Only"
            : "Content-Security-Policy"]: policy,
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
    });
}
