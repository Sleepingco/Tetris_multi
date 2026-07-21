const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { readdir, readFile } = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIST_ROOT = path.join(ROOT, "dist");
const SERVER_ROOT = path.join(DIST_ROOT, "server");
const CLIENT_RUNTIME_SOURCE_ROOTS = [
    "src/client/game/ai",
    "src/client/game/entry",
    "src/client/game/render",
    "src/client/game/runtime",
    "src/client/game/ui",
    "src/client/net",
];
const PLACEMENT_V4_MODEL_PATH = "server/assets/placement-v4-125g-experimental-model.json";
const PLACEMENT_V4_MODEL_SHA256 = "ff64b0d3e4cd9eb6c6d7920f2cbe961f1d70e4c90ccc69a5d9ab8bcd410cb33d";

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
        allFiles.filter(file => /(?:\.d)?\.tsx?$|\.map$|(?:^|\/)\.env(?:\.|$)/i.test(file)),
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

    const sourceServerJavaScript = (await listFiles(path.join(ROOT, "src", "server")))
        .filter(file => file.endsWith(".js"));
    assert.deepEqual(sourceServerJavaScript, []);

    const compiledJavaScript = serverFiles.filter(file => file.endsWith(".js"));
    for (const relativePath of compiledJavaScript) {
        const source = await readFile(path.join(SERVER_ROOT, relativePath), "utf8");
        assert.doesNotMatch(source, /(?:from\s+|require\(|import\()["'][^"']+\.ts["']/);
        assert.doesNotMatch(source, /sourceMappingURL/);
    }

    const remainingClientRuntimeJavaScript = [];
    for (const sourceRoot of CLIENT_RUNTIME_SOURCE_ROOTS) {
        const sourceFiles = await listFiles(path.join(ROOT, sourceRoot));
        remainingClientRuntimeJavaScript.push(
            ...sourceFiles
                .filter(file => file.endsWith(".js"))
                .map(file => path.posix.join(sourceRoot, file)),
        );
    }
    assert.deepEqual(remainingClientRuntimeJavaScript, []);

    const compiledLoaderSource = await readFile(
        path.join(SERVER_ROOT, "server", "services", "gameCoreLoader.js"),
        "utf8",
    );
    const compiledPveSource = await readFile(
        path.join(SERVER_ROOT, "server", "services", "pveAiPlayerService.js"),
        "utf8",
    );
    assert.doesNotMatch(compiledLoaderSource, /client\/game\/.+\.ts["']/);
    assert.doesNotMatch(compiledPveSource, /client\/game\/.+\.ts["']/);
    assert.match(compiledLoaderSource, /client\/game\/core\/step\.js/);
    assert.match(compiledPveSource, /client\/game\/ai\/ml\/placementV4PveDecisionAdapter\.js/);

    const sourceManifest = await readFile(
        path.join(ROOT, "src", "client", "package.json"),
        "utf8",
    );
    const outputManifest = await readFile(
        path.join(SERVER_ROOT, "client", "package.json"),
        "utf8",
    );
    assert.equal(outputManifest, sourceManifest);

    const sourceModel = await readFile(path.join(ROOT, "src", "server", "assets", path.basename(PLACEMENT_V4_MODEL_PATH)));
    const outputModel = await readFile(path.join(SERVER_ROOT, PLACEMENT_V4_MODEL_PATH));
    assert.equal(outputModel.equals(sourceModel), true);
    assert.equal(createHash("sha256").update(sourceModel).digest("hex"), PLACEMENT_V4_MODEL_SHA256);
    assert.equal(createHash("sha256").update(outputModel).digest("hex"), PLACEMENT_V4_MODEL_SHA256);

    const { loadGameCore } = require(
        path.join(SERVER_ROOT, "server", "services", "gameCoreLoader.js")
    );
    const core = await loadGameCore();
    assert.equal(core.BLOCKS.default, undefined);
    assert.equal(core.BLOCKS.tree.length, 4);

    const board = core.createEmptyBoard(20, 10);
    const activePiece = core.createSpawnedPiece("tree", -1, 3);
    const inputIntent = core.resolveInputMoveIntent("move_left");
    const pendingPiece = {
        ...activePiece,
        row: activePiece.row + inputIntent.rowDelta,
        col: activePiece.col + inputIntent.colDelta,
    };
    const moveOutcome = core.resolveMoveAttempt({
        board,
        activePiece,
        pendingPiece,
        moveCause: inputIntent.moveType,
        blocks: core.BLOCKS,
        wallKicks: core.WALL_KICKS,
    });
    assert.equal(board.flat().every(cell => cell === null), true);
    assert.deepEqual(moveOutcome, {
        status: "ok",
        moveCause: "horizontal",
        active: { pieceType: "tree", rotation: 0, row: -1, col: 2 },
        pending: { pieceType: "tree", rotation: 0, row: -1, col: 2 },
    });

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
    assert.equal(decision.decision.modelSha256, PLACEMENT_V4_MODEL_SHA256);

    const stackTraceResult = spawnSync(
        process.execPath,
        [
            "-e",
            `const { createAuthoritativePlayerMutationQueue } = require(${JSON.stringify(
                path.join(SERVER_ROOT, "server", "services", "authoritativePlayerMutationQueue.js"),
            )}); createAuthoritativePlayerMutationQueue().enqueueAuthoritativePlayerMutation(process.argv[1], process.argv[2], "not-a-function").catch(error => { throw error; });`,
            "sentinel-token-value",
            "sentinel-session-value",
        ],
        {
            cwd: ROOT,
            encoding: "utf8",
            env: {},
        },
    );
    assert.notEqual(stackTraceResult.status, 0);
    assert.match(stackTraceResult.stderr, /mutation must be a function/);
    assert.match(
        stackTraceResult.stderr,
        /dist\/server\/server\/services\/authoritativePlayerMutationQueue\.js/,
    );
    assert.doesNotMatch(stackTraceResult.stderr, /src\/server|\.ts:\d|source-map/i);
    assert.doesNotMatch(stackTraceResult.stderr, /sentinel-token-value|sentinel-session-value/);
});
