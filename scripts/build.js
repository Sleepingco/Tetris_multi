/**
 * source tree를 실행 가능한 `dist/` 구조로 만드는 최소 빌드 조율 스크립트다.
 *
 * 전체 빌드:
 * Vite로 네 client page 생성 → TypeScript server compile → runtime asset와 SQL migration 복사
 *
 * `--server` 빌드:
 * 기존 `dist/client`는 유지 → `dist/server`만 다시 compile
 *
 * 게임 규칙이나 번들 내용을 직접 만들지 않고, 이미 설치된 Vite와 TypeScript 실행 순서만
 * 고정한다. 인자를 하나만 허용해 CI나 테스트의 오타가 조용히 다른 빌드를 만들지 못하게 한다.
 */
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

/**
 * node_modules에 설치된 도구를 현재 Node 실행 파일로 직접 실행한다.
 *
 * shell 문자열을 만들지 않으므로 인자 quoting을 shell에 맡기지 않고, 도구의 출력과
 * 실패 코드는 현재 빌드 프로세스에 그대로 전달된다.
 */
function runTool(packageName, relativeBin, args) {
    execFileSync(
        process.execPath,
        [path.join(ROOT, "node_modules", packageName, relativeBin), ...args],
        { cwd: ROOT, stdio: "inherit" },
    );
}

/**
 * 선택한 빌드 범위를 먼저 비운 뒤 client/server artifact와 런타임 파일을 순서대로 만든다.
 *
 * TypeScript compiler는 JSON asset을 복사하지 않는다. 그래서 V4 model asset은 명시적으로
 * 복사하고, client core output을 Node가 ES module로 읽도록 client package.json도 함께 둔다.
 */
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
        path.join(ROOT, "src", "server", "db", "migrations"),
        path.join(SERVER_ROOT, "server", "db", "migrations"),
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
