const test = require("node:test");
const assert = require("node:assert/strict");
const { readdir, readFile } = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIST_ROOT = path.join(ROOT, "dist");
const SERVER_ROOT = path.join(DIST_ROOT, "server");

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

test("clean build는 허용된 production artifact와 실행 가능한 shared core만 만든다", async () => {
    const topLevel = (await readdir(DIST_ROOT)).sort();
    assert.deepEqual(topLevel, ["client", "server"]);

    const allFiles = await listFiles(DIST_ROOT);
    assert.deepEqual(
        allFiles.filter(file => /(?:^|\/)(?:test|tests|e2e|fixtures?)(?:\/|$)/i.test(file)),
        [],
    );
    assert.deepEqual(
        allFiles.filter(file => /(?:\.d)?\.ts$|\.map$|(?:^|\/)\.env(?:\.|$)/i.test(file)),
        [],
    );

    const serverFiles = await listFiles(SERVER_ROOT);
    const allowedServerArtifact = file => {
        return file === "app.js"
            || file === "client/package.json"
            || file === "shared/socketContracts.mjs"
            || file === "server/assets/placement-v4-125g-experimental-model.json"
            || /^server\/(?:repositories|services|sockets|validators)\/.+\.js$/.test(file)
            || file === "server/init.js"
            || file === "server/socketSecurity.js"
            || /^client\/game\/(?:ai|core|state)\/.+\.js$/.test(file);
    };
    assert.deepEqual(serverFiles.filter(file => !allowedServerArtifact(file)), []);

    const sourceManifest = await readFile(
        path.join(ROOT, "src", "client", "package.json"),
        "utf8",
    );
    const outputManifest = await readFile(
        path.join(SERVER_ROOT, "client", "package.json"),
        "utf8",
    );
    assert.equal(outputManifest, sourceManifest);

    const { loadGameCore } = require(
        path.join(SERVER_ROOT, "server", "services", "gameCoreLoader.js")
    );
    const core = await loadGameCore();
    assert.equal(core.BLOCKS.default, undefined);
    assert.equal(core.BLOCKS.tree.length, 4);

    const {
        createMatch,
        resetMatches,
    } = require(path.join(SERVER_ROOT, "server", "services", "matchService.js"));
    const { createPveAiPlayerService } = require(
        path.join(SERVER_ROOT, "server", "services", "pveAiPlayerService.js")
    );
    resetMatches();
    createMatch({
        roomId: "V4ARTF01",
        mode: "pve",
        aiDifficulty: "normal",
        aiPolicy: "placement_v4",
        status: "playing",
        players: [
            { playerId: "human", playerType: "human" },
            { playerId: "ai", playerType: "heuristic_ai" },
        ],
    });
    const decision = await createPveAiPlayerService().processAiStep(
        "V4ARTF01",
        "ai",
        core,
    );
    assert.equal(decision.reason, "AI_PLAN_CREATED");
    assert.equal(decision.decision.policyUsed, "placement_v4");
    assert.equal(decision.decision.fallbackReason, null);
});
