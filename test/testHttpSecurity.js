const test = require("node:test");
const assert = require("node:assert/strict");

const {
    CSP_INLINE_SCRIPT_HASHES,
    CSP_INLINE_STYLE_HASHES,
    createHttpSecurityHeaders,
} = require("../dist/server/server/httpSecurity.js");

test("CSP는 strict source와 검증된 inline hash만 허용한다", () => {
    const headers = createHttpSecurityHeaders({
        CSP_CONNECT_ORIGINS: "wss://game.example.com,https://api.example.com:8443,wss://game.example.com",
    });
    const policy = headers["Content-Security-Policy"];

    assert.equal(headers["Content-Security-Policy-Report-Only"], undefined);
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
    assert.equal(headers["X-Frame-Options"], "DENY");
    assert.equal(headers["Referrer-Policy"], "no-referrer");
    assert.match(policy, /^default-src 'none';/);
    assert.match(policy, /connect-src 'self' wss:\/\/game\.example\.com https:\/\/api\.example\.com:8443/);
    assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval|\*/);
    for (const hash of [...CSP_INLINE_SCRIPT_HASHES, ...CSP_INLINE_STYLE_HASHES]) {
        assert.match(policy, new RegExp(hash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
});

test("report-only와 enforce CSP header는 동시에 노출되지 않는다", () => {
    const headers = createHttpSecurityHeaders({ CSP_MODE: "report-only" });

    assert.equal(headers["Content-Security-Policy"], undefined);
    assert.match(headers["Content-Security-Policy-Report-Only"], /default-src 'none'/);
    assert.throws(
        () => createHttpSecurityHeaders({ CSP_MODE: "disabled" }),
        /CSP_MODE/,
    );
});

test("production의 malformed CSP connect origin은 fail closed한다", () => {
    for (const origin of [
        "not-a-url",
        "ftp://game.example.com",
        "wss://user:secret@game.example.com",
        "wss://game.example.com/socket.io",
        "wss://game.example.com?token=secret",
        "wss://game.example.com#fragment",
        "wss://*.example.com",
    ]) {
        assert.throws(
            () => createHttpSecurityHeaders({
                NODE_ENV: "production",
                CSP_CONNECT_ORIGINS: origin,
            }),
            /CSP_CONNECT_ORIGINS/,
            origin,
        );
    }
});
