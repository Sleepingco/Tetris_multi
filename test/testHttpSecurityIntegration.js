const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { get } = require("node:http");
const { createServer } = require("node:net");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ALLOWED_ORIGIN = "https://allowed.example.com";

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

function assertSecurityHeaders(response) {
    const header = name => typeof response.headers.get === "function"
        ? response.headers.get(name)
        : response.headers[name];
    assert.match(header("content-security-policy") || "", /default-src 'none'/);
    assert.equal(header("content-security-policy-report-only") ?? null, null);
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

test("compiled server는 HTML, asset, 404, 304와 Socket.IO HTTP에 security header를 적용한다", {
    timeout: 30_000,
}, async () => {
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const application = spawn(process.execPath, ["dist/server/app.js"], {
        cwd: ROOT,
        env: {
            NODE_ENV: "production",
            PORT: String(port),
            SOCKET_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
            CSP_CONNECT_ORIGINS: `ws://127.0.0.1:${port}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    application.stdout.on("data", chunk => { output += chunk; });
    application.stderr.on("data", chunk => { output += chunk; });

    try {
        const rootResponse = await waitForHttp(`${baseUrl}/`);
        assertSecurityHeaders(rootResponse);
        const rootHtml = await rootResponse.text();
        const modulePath = rootHtml.match(/<script type="module"[^>]+src="([^"]+)"/)?.[1];
        assert.ok(modulePath);

        const assetResponse = await fetch(new URL(modulePath, baseUrl));
        assert.equal(assetResponse.status, 200);
        assertSecurityHeaders(assetResponse);
        const etag = assetResponse.headers.get("etag");
        assert.ok(etag);
        const cachedResponse = await rawGet(new URL(modulePath, baseUrl), {
            "If-None-Match": etag,
        });
        assert.equal(cachedResponse.status, 304);
        assertSecurityHeaders(cachedResponse);

        const missingResponse = await fetch(`${baseUrl}/missing-goal11a`);
        assert.equal(missingResponse.status, 404);
        assertSecurityHeaders(missingResponse);

        const socketClientResponse = await fetch(`${baseUrl}/socket.io/socket.io.js`, {
            headers: { Origin: ALLOWED_ORIGIN },
        });
        assert.equal(socketClientResponse.status, 200);
        assert.match(socketClientResponse.headers.get("content-type") || "", /javascript/);
        assertSecurityHeaders(socketClientResponse);
        const socketMapResponse = await fetch(`${baseUrl}/socket.io/socket.io.js.map`, {
            headers: { Origin: ALLOWED_ORIGIN },
        });
        assert.equal(socketMapResponse.status, 200);
        assert.match(socketMapResponse.headers.get("content-type") || "", /json/);
        assertSecurityHeaders(socketMapResponse);

        const pollingUrl = `${baseUrl}/socket.io/?EIO=4&transport=polling`;
        const pollingGet = await fetch(pollingUrl, { headers: { Origin: ALLOWED_ORIGIN } });
        assert.equal(pollingGet.status, 200);
        assert.equal(pollingGet.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
        assertSecurityHeaders(pollingGet);
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
        assertSecurityHeaders(pollingPost);

        const rejectedOrigin = await fetch(pollingUrl, {
            headers: { Origin: "https://evil.example.com" },
        });
        assert.equal(rejectedOrigin.status, 400);
        assert.equal(rejectedOrigin.headers.get("access-control-allow-origin"), null);
        assertSecurityHeaders(rejectedOrigin);
        const rejectedPost = await fetch(`${pollingUrl}&sid=${encodeURIComponent(sessionId)}`, {
            method: "POST",
            headers: { Origin: "https://evil.example.com" },
            body: "2",
        });
        assert.equal(rejectedPost.status, 400);
        assertSecurityHeaders(rejectedPost);
    } finally {
        if (application.exitCode === null) {
            application.kill("SIGTERM");
            await new Promise(resolve => application.once("exit", resolve));
        }
        assert.equal(application.exitCode === 0 || application.signalCode === "SIGTERM", true, output);
    }
});
