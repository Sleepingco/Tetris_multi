/**
 * source와 개발 의존성이 없는 production release가 실제로 실행되는지 검증한다.
 *
 * 임시 디렉터리에 dist와 package 파일만 복사하고 production dependency를 설치한 뒤,
 * PVP/PVE service probe와 HTTP 서버를 실행해 보안 header·정적 artifact·V4 model을 확인한다.
 * 성공과 실패 모두 finally에서 child process를 종료하고 임시 release 디렉터리를 삭제한다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawn, spawnSync } = require("node:child_process");
const { createServer } = require("node:net");
const { cp, mkdtemp, readFile, readdir, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MODEL_SHA256 = "ff64b0d3e4cd9eb6c6d7920f2cbe961f1d70e4c90ccc69a5d9ab8bcd410cb33d";
const ALLOWED_ORIGIN = "http://127.0.0.1:5500";

function assertSecurityHeaders(response) {
    assert.match(response.headers.get("content-security-policy") || "", /default-src 'none'/);
    assert.equal(response.headers.get("content-security-policy-report-only"), null);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("x-powered-by"), null);
}

async function listFiles(directory, prefix = "") {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relativePath = path.posix.join(prefix, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listFiles(path.join(directory, entry.name), relativePath));
        } else {
            files.push(relativePath);
        }
    }
    return files.sort();
}

async function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            server.close(error => {
                if (error) reject(error);
                else resolve(address.port);
            });
        });
    });
}

async function waitForHttp(url, options = {}) {
    let lastError;
    for (let attempt = 0; attempt < 60; attempt += 1) {
        try {
            const response = await fetch(url, options);
            if (response.ok) return response;
            lastError = new Error(`HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw lastError || new Error(`Timed out waiting for ${url}`);
}

function createInstallEnvironment() {
    const environment = {};
    for (const key of ["HOME", "PATH", "TMPDIR", "npm_config_cache", "npm_config_registry"]) {
        if (process.env[key]) environment[key] = process.env[key];
    }
    return environment;
}

test("production dependencies만 있는 source-less release가 HTTP, PVP/PVE와 V4를 실행한다", {
    timeout: 120_000,
}, async () => {
    const releaseRoot = await mkdtemp(path.join(os.tmpdir(), "tetris-goal8c-release-"));
    let application = null;
    let applicationOutput = "";
    try {
        await cp(path.join(ROOT, "dist"), path.join(releaseRoot, "dist"), { recursive: true });
        await cp(path.join(ROOT, "package.json"), path.join(releaseRoot, "package.json"));
        await cp(path.join(ROOT, "package-lock.json"), path.join(releaseRoot, "package-lock.json"));

        const npmExecPath = process.env.npm_execpath;
        assert.equal(typeof npmExecPath, "string");
        execFileSync(
            process.execPath,
            [npmExecPath, "ci", "--omit=dev", "--ignore-scripts"],
            {
                cwd: releaseRoot,
                env: createInstallEnvironment(),
                stdio: "pipe",
            },
        );

        const releaseEntries = (await readdir(releaseRoot)).sort();
        assert.deepEqual(releaseEntries, ["dist", "node_modules", "package-lock.json", "package.json"]);
        for (const directory of ["src", "test", "test-artifact", "scripts", "e2e"]) {
            assert.equal(releaseEntries.includes(directory), false);
        }
        for (const dependencyPath of [
            "typescript",
            "vite",
            "@playwright/test",
            "@types/node",
            "@types/react",
            "@types/react-dom",
        ]) {
            const result = spawnSync(process.execPath, ["-e", `require.resolve(${JSON.stringify(dependencyPath)})`], {
                cwd: releaseRoot,
                env: {},
                encoding: "utf8",
            });
            assert.notEqual(result.status, 0, `${dependencyPath} must not be installed`);
        }

        const releaseFiles = await listFiles(path.join(releaseRoot, "dist"));
        assert.deepEqual(
            releaseFiles.filter(file => /(?:\.d)?\.tsx?$|\.map$|(?:^|\/)\.env(?:\.|$)/i.test(file)),
            [],
        );
        assert.deepEqual(
            releaseFiles.filter(file => /(?:^|\/)(?:test|tests|e2e|fixtures?)(?:\/|$)/i.test(file)),
            [],
        );

        const serviceProbe = `
            const rooms = require("./dist/server/server/services/roomService.js");
            const matches = require("./dist/server/server/services/matchService.js");
            const { loadGameCore } = require("./dist/server/server/services/gameCoreLoader.js");
            const { createPveAiPlayerService } = require("./dist/server/server/services/pveAiPlayerService.js");
            (async () => {
                const pvpRoom = rooms.createRoom(
                    { playerId: "pvp-host", nickname: "Host" },
                    { generateRoomId: () => "PVPREL01" },
                );
                rooms.joinRoom("PVPREL01", { playerId: "pvp-guest", nickname: "Guest" });
                const pvpStarted = rooms.startGame("PVPREL01", "pvp-host");
                const pvpMatch = matches.createMatch(pvpStarted.room);
                const core = await loadGameCore();
                const pvpInput = matches.applyAuthoritativeInputToMatchPlayerState(
                    "PVPREL01", "pvp-host",
                    { action: "move_left", tick: 0, pieceIndex: 1, clientSequence: 1 },
                    core,
                );

                const pveRoom = rooms.createRoom(
                    { playerId: "pve-host", nickname: "Host" },
                    { mode: "pve", aiPolicy: "placement_v4", generateRoomId: () => "PVEREL01" },
                );
                const pveStarted = rooms.startGame("PVEREL01", "pve-host");
                const pveMatch = matches.createMatch(pveStarted.room);
                const aiPlayer = pveMatch.match.players.find(player => player.playerType === "heuristic_ai");
                const pveDecision = await createPveAiPlayerService().processAiStep(
                    "PVEREL01", aiPlayer.playerId, core,
                );
                console.log(JSON.stringify({
                    pvp: pvpRoom.ok && pvpStarted.ok && pvpMatch.ok && pvpInput.ok,
                    pve: pveRoom.ok && pveStarted.ok && pveMatch.ok,
                    reason: pveDecision.reason,
                    policyUsed: pveDecision.decision?.policyUsed,
                    fallbackReason: pveDecision.decision?.fallbackReason,
                    modelSha256: pveDecision.decision?.modelSha256,
                }));
            })().catch(error => { console.error(error); process.exit(1); });
        `;
        const probeResult = spawnSync(process.execPath, ["-e", serviceProbe], {
            cwd: releaseRoot,
            env: { NODE_ENV: "production" },
            encoding: "utf8",
        });
        assert.equal(probeResult.status, 0, probeResult.stderr);
        const probe = JSON.parse(probeResult.stdout.trim());
        assert.deepEqual(probe, {
            pvp: true,
            pve: true,
            reason: "AI_PLAN_CREATED",
            policyUsed: "placement_v4",
            fallbackReason: null,
            modelSha256: MODEL_SHA256,
        });

        const port = await getFreePort();
        application = spawn(process.execPath, ["dist/server/app.js"], {
            cwd: releaseRoot,
            env: {
                NODE_ENV: "production",
                GAME_EVENT_STORAGE: "jsonl",
                PORT: String(port),
                SOCKET_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
                CSP_CONNECT_ORIGINS: "wss://socket.example.com",
            },
            stdio: ["ignore", "pipe", "pipe"],
        });
        application.stdout.on("data", chunk => { applicationOutput += chunk; });
        application.stderr.on("data", chunk => { applicationOutput += chunk; });

        const rootResponse = await waitForHttp(`http://127.0.0.1:${port}/`);
        assertSecurityHeaders(rootResponse);
        const rootHtml = await rootResponse.text();
        assert.match(rootHtml, /<div id="indexRoot"><\/div>/);
        const modulePath = rootHtml.match(/<script type="module"[^>]+src="([^"]+)"/)?.[1];
        assert.ok(modulePath);
        const socketResponse = await waitForHttp(
            `http://127.0.0.1:${port}/socket.io/socket.io.js`,
            { headers: { Origin: ALLOWED_ORIGIN } },
        );
        assert.match(socketResponse.headers.get("content-type") || "", /javascript/);
        assertSecurityHeaders(socketResponse);

        const sourceResponse = await fetch(`http://127.0.0.1:${port}/pages/index.tsx`);
        const sourceMapResponse = await fetch(`http://127.0.0.1:${port}${modulePath}.map`);
        assert.equal(sourceResponse.status, 404);
        assert.equal(sourceMapResponse.status, 404);
        assertSecurityHeaders(sourceResponse);
        assertSecurityHeaders(sourceMapResponse);

        const socketMapResponse = await fetch(
            `http://127.0.0.1:${port}/socket.io/socket.io.js.map`,
            { headers: { Origin: ALLOWED_ORIGIN } },
        );
        assert.equal(socketMapResponse.status, 200);
        assert.match(socketMapResponse.headers.get("content-type") || "", /json/);
        assertSecurityHeaders(socketMapResponse);

        const packageJson = JSON.parse(await readFile(path.join(releaseRoot, "package.json"), "utf8"));
        assert.equal(packageJson.main, "dist/server/app.js");
    } finally {
        if (application && application.exitCode === null) {
            application.kill("SIGTERM");
            await new Promise(resolve => application.once("exit", resolve));
        }
        await rm(releaseRoot, { recursive: true, force: true });
    }
});
