/**
 * HTTP 보안 header 설정이 production에서 fail-closed로 동작하는지 검증한다.
 *
 * 준비: CSP mode와 허용할 websocket/HTTPS origin을 환경 설정 형태로 전달한다.
 * 실행: `createHttpSecurityHeaders`가 만든 header map을 읽는다.
 * 검증: enforce/report-only 중 하나만 활성화되고, 고정된 source/hash와 기본 보안 header가
 * 포함되며, credential·path·wildcard가 섞인 잘못된 origin은 서버 시작 전에 거부되어야 한다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createHttpSecurityHeaders,
} = require("../dist/server/server/httpSecurity.js");

test("CSP는 strict source와 검증된 inline hash만 허용한다", () => {
    const headers = createHttpSecurityHeaders({
        CSP_CONNECT_ORIGINS: "wss://game.example.com,https://api.example.com:8443,wss://game.example.com",
    });
    const policy = headers["Content-Security-Policy"];
    const expectedPolicy = [
        "default-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "script-src 'self' https://cloud.umami.is 'sha256-dD0UYyHj6Sta8gSAF02VM8IfeQR0k7L4ZYIYWQgUBm0='",
        "script-src-attr 'none'",
        "style-src 'self' 'sha256-8WMI54/fYjLyQ+V0ZVpxKy2ddoWYIfTvf6INokq2xEo=' 'sha256-isAGgst8p0POY9YHnzg/K0CpLsdJtzLOcjeCXqEi6Q4=' 'sha256-IsVLBKuEy1m/EXcXkJQYt/4Hss2umZ0wV/cKhk8GzBs='",
        "style-src-attr 'none'",
        "img-src 'self' data:",
        "font-src 'none'",
        "media-src 'self'",
        "connect-src 'self' https://cloud.umami.is https://gateway.umami.is wss://game.example.com https://api.example.com:8443",
        "worker-src 'none'",
    ].join("; ");

    assert.equal(headers["Content-Security-Policy-Report-Only"], undefined);
    assert.equal(policy, expectedPolicy);
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
    assert.equal(headers["X-Frame-Options"], "DENY");
    assert.equal(headers["Referrer-Policy"], "no-referrer");
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
