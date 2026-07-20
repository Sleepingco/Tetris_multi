const { execFileSync } = require("node:child_process");
const { cp, mkdir, rm } = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIST_ROOT = path.join(ROOT, "dist");
const SERVER_ROOT = path.join(DIST_ROOT, "server");
const serverOnly = process.argv[2] === "--server";

if (process.argv.length > (serverOnly ? 3 : 2)) {
    throw new Error("Usage: node scripts/build.js [--server]");
}

function runTool(packageName, relativeBin, args) {
    execFileSync(
        process.execPath,
        [path.join(ROOT, "node_modules", packageName, relativeBin), ...args],
        { cwd: ROOT, stdio: "inherit" },
    );
}

async function build() {
    await rm(serverOnly ? SERVER_ROOT : DIST_ROOT, { recursive: true, force: true });

    if (!serverOnly) {
        runTool("vite", "bin/vite.js", ["build"]);
    }
    runTool("typescript", "bin/tsc", ["-p", "tsconfig.server.build.json"]);

    await mkdir(path.join(SERVER_ROOT, "server"), { recursive: true });
    await cp(
        path.join(ROOT, "src", "server", "assets"),
        path.join(SERVER_ROOT, "server", "assets"),
        { recursive: true },
    );
    await cp(
        path.join(ROOT, "src", "client", "package.json"),
        path.join(SERVER_ROOT, "client", "package.json"),
    );
}

build().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
