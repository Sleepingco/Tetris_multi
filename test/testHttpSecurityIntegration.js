/**
 * 실제 compiled production 서버의 모든 응답 경로에 보안 header가 붙는지 확인하는 통합 테스트다.
 *
 * 준비: 비어 있는 local port를 구하고 별도 Node process로 `dist/server/app.js`를 실행한다.
 * 실행: HTML, asset, 404/416/304, Socket.IO client와 polling GET/POST를 실제 HTTP로 요청한다.
 * 검증: 응답 종류와 성공 여부에 관계없이 CSP와 공통 header가 유지되고,
 * 허용 origin만 CORS 응답을 받으며 종료 시 child process가 정상 정리되어야 한다.
 *
 * 단위 테스트가 header 객체만 본다면, 이 테스트는 Express·static·Socket.IO를 통과한 최종 응답을 본다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { get } = require("node:http");
const { createServer } = require("node:net");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ALLOWED_ORIGIN = "https://allowed.example.com";

/**
 * 운영체제에 port 0을 요청해 현재 비어 있는 임시 port를 얻는다.
 * 고정 port를 사용하지 않아 개발 서버나 병렬 테스트와의 충돌 가능성을 줄인다.
 */
async function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            server.close(error => error ? reject(error) : resolve(address.port));
        });
    });
}

/**
 * child process의 listen 완료 시점이 비동기이므로 짧게 재시도한다.
 * 단순 sleep 하나보다 빠르게 준비 완료를 감지하고, 마지막 연결 오류도 보존한다.
 */
async function waitForHttp(url) {
    let lastError;
    for (let attempt = 0; attempt < 60; attempt += 1) {
        try {
            const response = await fetch(url);
            if (response.ok) return response;
            lastError = new Error(`HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw lastError;
}

function assertSecurityHeaders(response, mode) {
    const header = name => typeof response.headers.get === "function"
        ? response.headers.get(name)
        : response.headers[name];
    const enforcePolicy = header("content-security-policy") ?? null;
    const reportOnlyPolicy = header("content-security-policy-report-only") ?? null;
    assert.equal(enforcePolicy === null, mode === "report-only");
    assert.equal(reportOnlyPolicy === null, mode === "enforce");
    assert.match((mode === "enforce" ? enforcePolicy : reportOnlyPolicy) || "", /default-src 'none'/);
    assert.equal(header("x-content-type-options"), "nosniff");
    assert.equal(header("x-frame-options"), "DENY");
    assert.equal(header("referrer-policy"), "no-referrer");
    assert.equal(header("x-powered-by") ?? null, null);
}

async function rawGet(url, headers) {
    return new Promise((resolve, reject) => {
        get(url, { headers }, response => {
            response.resume();
            response.once("end", () => resolve({
                status: response.statusCode,
                headers: response.headers,
            }));
        }).once("error", reject);
    });
}

for (const mode of ["enforce", "report-only"]) test(`compiled server는 ${mode} CSP 하나만 모든 응답에 적용한다`, {
    timeout: 30_000,
}, async () => {
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const application = spawn(process.execPath, ["dist/server/app.js"], {
        cwd: ROOT,
        env: {
            NODE_ENV: "production",
            GAME_EVENT_STORAGE: "jsonl",
            PORT: String(port),
            SOCKET_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
            CSP_CONNECT_ORIGINS: `ws://127.0.0.1:${port}`,
            CSP_MODE: mode,
        },
        stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    application.stdout.on("data", chunk => { output += chunk; });
    application.stderr.on("data", chunk => { output += chunk; });

    try {
        const rootResponse = await waitForHttp(`${baseUrl}/`);
        assertSecurityHeaders(rootResponse, mode);
        const rootHtml = await rootResponse.text();
        const modulePath = rootHtml.match(/<script type="module"[^>]+src="([^"]+)"/)?.[1];
        assert.ok(modulePath);

        const assetResponse = await fetch(new URL(modulePath, baseUrl));
        assert.equal(assetResponse.status, 200);
        assertSecurityHeaders(assetResponse, mode);
        const directoryResponse = await fetch(`${baseUrl}/pages`, { redirect: "manual" });
        assert.equal(directoryResponse.status, 404);
        assertSecurityHeaders(directoryResponse, mode);
        const rangeResponse = await fetch(new URL(modulePath, baseUrl), {
            headers: { Range: "bytes=999999999-" },
        });
        assert.equal(rangeResponse.status, 416);
        assertSecurityHeaders(rangeResponse, mode);
        const etag = assetResponse.headers.get("etag");
        assert.ok(etag);
        const cachedResponse = await rawGet(new URL(modulePath, baseUrl), {
            "If-None-Match": etag,
        });
        assert.equal(cachedResponse.status, 304);
        assertSecurityHeaders(cachedResponse, mode);

        const missingResponse = await fetch(`${baseUrl}/missing-goal11a`);
        assert.equal(missingResponse.status, 404);
        assertSecurityHeaders(missingResponse, mode);

        const socketClientResponse = await fetch(`${baseUrl}/socket.io/socket.io.js`, {
            headers: { Origin: ALLOWED_ORIGIN },
        });
        assert.equal(socketClientResponse.status, 200);
        assert.match(socketClientResponse.headers.get("content-type") || "", /javascript/);
        assertSecurityHeaders(socketClientResponse, mode);
        const socketMapResponse = await fetch(`${baseUrl}/socket.io/socket.io.js.map`, {
            headers: { Origin: ALLOWED_ORIGIN },
        });
        assert.equal(socketMapResponse.status, 200);
        assert.match(socketMapResponse.headers.get("content-type") || "", /json/);
        assertSecurityHeaders(socketMapResponse, mode);

        const pollingUrl = `${baseUrl}/socket.io/?EIO=4&transport=polling`;
        const pollingGet = await fetch(pollingUrl, { headers: { Origin: ALLOWED_ORIGIN } });
        assert.equal(pollingGet.status, 200);
        assert.equal(pollingGet.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
        assertSecurityHeaders(pollingGet, mode);
        const openPacket = await pollingGet.text();
        const sessionId = JSON.parse(openPacket.slice(1)).sid;
        assert.equal(typeof sessionId, "string");
        const pollingPost = await fetch(`${pollingUrl}&sid=${encodeURIComponent(sessionId)}`, {
            method: "POST",
            headers: {
                Origin: ALLOWED_ORIGIN,
                "Content-Type": "text/plain;charset=UTF-8",
            },
            body: "40",
        });
        assert.equal(pollingPost.status, 200);
        assert.equal(pollingPost.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
        assertSecurityHeaders(pollingPost, mode);

        const rejectedOrigin = await fetch(pollingUrl, {
            headers: { Origin: "https://evil.example.com" },
        });
        assert.equal(rejectedOrigin.status, 400);
        assert.equal(rejectedOrigin.headers.get("access-control-allow-origin"), null);
        assertSecurityHeaders(rejectedOrigin, mode);
        const rejectedPost = await fetch(`${pollingUrl}&sid=${encodeURIComponent(sessionId)}`, {
            method: "POST",
            headers: { Origin: "https://evil.example.com" },
            body: "2",
        });
        assert.equal(rejectedPost.status, 400);
        assertSecurityHeaders(rejectedPost, mode);
    } finally {
        if (application.exitCode === null) {
            application.kill("SIGTERM");
            await new Promise(resolve => application.once("exit", resolve));
        }
        assert.equal(application.exitCode, 0, output);
        assert.equal(application.signalCode, null, output);
    }
});
