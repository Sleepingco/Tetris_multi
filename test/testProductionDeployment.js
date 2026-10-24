const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const workflow = fs.readFileSync(path.resolve(__dirname, "../.github/workflows/deploy-production.yml"), "utf8");
const remoteScript = workflow.split("          # DEPLOY_REMOTE_BEGIN\n")[1]
    .split("          # DEPLOY_REMOTE_END")[0].split("\n")
    .map(line => line.startsWith("          ") ? line.slice(10) : line).join("\n");

function fixture({ version = 3, fault = "", compatible = false, target = 3 } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tetris-deploy-test-"));
    for (const dir of ["bin", "secrets", "repository"]) fs.mkdirSync(path.join(root, dir));
    fs.writeFileSync(path.join(root, "secrets/production.env"), "APP_IMAGE_TAG=bbbbbbb\nDATABASE_URL=PRIVATE_TEST_CREDENTIAL\n");
    fs.writeFileSync(path.join(root, "repository/compose.production.yml"), "name: tetris\n");
    fs.writeFileSync(path.join(root, "repository/Caddyfile"), "example.test {\n reverse_proxy app:5500\n handle /stats/* { reverse_proxy umami:3000 }\n}\n");
    const state = { before: "bbbbbbb", candidate: "aaaaaaa", active: "bbbbbbb", running: true,
        commit: "a".repeat(40), artifact: "c".repeat(64), rollbackSha: "d".repeat(64),
        images: { aaaaaaa: target, bbbbbbb: version, ddddddd: target }, version, fault,
        migrations: 0, maintenance: false, commands: [] };
    const script = path.join(root, "workflow-remote.sh");
    fs.writeFileSync(script, remoteScript.replace("root=/srv/tetris", 'root="$TETRIS_DEPLOY_ROOT"'));
    const stateFile = path.join(root, "fake.json");
    fs.writeFileSync(stateFile, JSON.stringify(state));
    for (const command of ["sudo", "curl", "sleep", "flock", "sha256sum"]) {
        const file = path.join(root, "bin", command);
        fs.writeFileSync(file, `#!${process.execPath} --\n${fs.readFileSync(path.join(__dirname, "fixtures/deployment/command.txt"), "utf8")}`);
        fs.chmodSync(file, 0o700);
    }
    fs.writeFileSync(path.join(root, "bin/timeout"), '#!/bin/bash\nshift\nexec "$@"\n', { mode: 0o700 });
    const env = { ...process.env, TETRIS_DEPLOY_ROOT: root, DEPLOY_TEST_STATE: stateFile,
        PATH: path.join(root, "bin") + ":" + process.env.PATH, RELEASE_COMMIT: state.commit,
        RELEASE_SHA: state.candidate, ARTIFACT_SHA256: state.artifact, DEPLOY_ID: "123-1",
        ROLLBACK_IMAGE_TAG: compatible ? "ddddddd" : "", ROLLBACK_ARTIFACT_SHA256: compatible ? state.rollbackSha : "" };
    const journal = path.join(root, "deployments/aaaaaaa-123-1");
    return { root, env, journal,
        state: () => JSON.parse(fs.readFileSync(stateFile, "utf8")),
        update(values) { fs.writeFileSync(stateFile, JSON.stringify({ ...this.state(), ...values })); },
        run(operation) {
            const result = spawnSync("bash", [script, operation], { env, encoding: "utf8", timeout: 30_000 });
            assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_TEST_CREDENTIAL/);
            return result;
        },
        status: () => fs.readFileSync(path.join(journal, "status"), "utf8").trim(),
        close: () => fs.rmSync(root, { recursive: true, force: true }),
    };
}

for (const version of [2, 3]) {
    test(`CD workflow schema ${version}→3: restore 검증, rollback boot, candidate 순서로 완료한다`, () => {
        const f = fixture({ version, compatible: version === 2 });
        try {
            let result = f.run("deploy");
            assert.equal(result.status, 0, result.stderr);
            assert.equal(f.status(), "complete");
            assert.equal(f.state().version, 3);
            assert.equal(f.state().active, "aaaaaaa");
            assert.equal(f.state().maintenance, false);
            assert.equal(f.state().migrations, 2);
            const commands = f.state().commands.map(args => args.join(" "));
            assert.ok(commands.findIndex(c => c.includes("pg_restore") && c.includes("--dbname")) < commands.findIndex(c => c.includes("compose") && c.includes("stop")));
            assert.equal(commands.filter(c => c.includes("compose") && c.includes("--force-recreate")).length, 2);

        } finally { f.close(); }
    });
}

for (const [options, expectedActive, expectedVersion, status] of [
    [{ version: 2 }, "bbbbbbb", 2, "preflight"],
    [{ target: 2 }, "bbbbbbb", 3, "preflight"],
    [{ fault: "active" }, "bbbbbbb", 3, "failed_preflight"],
    [{ fault: "restore" }, "bbbbbbb", 3, "failed_preflight"],
    [{ fault: "gate" }, "bbbbbbb", 3, "rolled_back"],
    [{ fault: "storage" }, "bbbbbbb", 3, "rolled_back"],
    [{ version: 2, compatible: true, fault: "migration-before" }, "bbbbbbb", 2, "rolled_back"],
    [{ version: 2, compatible: true, fault: "migration-after" }, "ddddddd", 3, "rolled_back"],
    [{ version: 2, compatible: true, fault: "candidate" }, "ddddddd", 3, "rolled_back"],
    [{ version: 2, compatible: true, fault: "rollback" }, "ddddddd", 3, "manual_recovery_required"],
]) {
    test(`CD 실패 격리: ${JSON.stringify(options)}`, () => {
        const f = fixture(options);
        try {
            const result = f.run("deploy");
            assert.notEqual(result.status, 0, result.stdout);
            assert.equal(f.state().active, expectedActive);
            assert.equal(f.state().version, expectedVersion);
            if (status !== "preflight") assert.equal(f.status(), status, result.stderr);
            assert.equal(f.state().maintenance, status === "manual_recovery_required");
            if (["preflight", "failed_preflight"].includes(status)) assert.equal(f.state().migrations, 0);
        } finally { f.close(); }
    });
}

