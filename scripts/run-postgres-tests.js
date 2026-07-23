/**
 * Goal 9B 전용 loopback PostgreSQL container 하나를 만들고 실제 DB test를 실행한다.
 *
 * 외부 TEST_DATABASE_URL/DATABASE_URL은 사용하지 않는다. container와 volume 이름에
 * goal9b prefix와 random suffix를 붙이고 finally에서 자신이 만든 resource만 정리한다.
 */
const { execFileSync, spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { chmod, mkdtemp, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const POSTGRES_IMAGE =
    "postgres:17.10-alpine3.24@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";

function docker(args, options = {}) {
    return execFileSync("docker", args, {
        cwd: ROOT,
        encoding: "utf8",
        stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    });
}

function createCertificates(directory) {
    const caKey = path.join(directory, "ca.key");
    const caCertificate = path.join(directory, "ca.crt");
    const serverKey = path.join(directory, "server.key");
    const serverRequest = path.join(directory, "server.csr");
    const serverCertificate = path.join(directory, "server.crt");
    const serverExtensions = path.join(directory, "server.ext");

    execFileSync("openssl", [
        "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes",
        "-days", "2", "-subj", "/CN=Tetris Goal 9B Test CA",
        "-keyout", caKey, "-out", caCertificate,
    ], { stdio: "ignore" });
    execFileSync("openssl", [
        "req", "-newkey", "rsa:2048", "-sha256", "-nodes",
        "-subj", "/CN=localhost",
        "-keyout", serverKey, "-out", serverRequest,
    ], { stdio: "ignore" });
    return writeFile(
        serverExtensions,
        "subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n",
        "utf8",
    ).then(() => {
        execFileSync("openssl", [
            "x509", "-req", "-sha256", "-days", "2",
            "-in", serverRequest,
            "-CA", caCertificate,
            "-CAkey", caKey,
            "-CAcreateserial",
            "-extfile", serverExtensions,
            "-out", serverCertificate,
        ], { stdio: "ignore" });
        return Promise.all([
            chmod(caKey, 0o600),
            chmod(serverKey, 0o600),
        ]);
    });
}

function waitForPostgres(containerName) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const ready = spawnSync("docker", [
            "exec", containerName, "sh", "-c",
            "test \"$(cat /proc/1/comm)\" = postgres "
                + "&& pg_isready --username postgres --dbname postgres",
        ], { stdio: "ignore" });
        if (ready.status === 0) return;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
    throw new Error("GOAL9B_POSTGRES_START_TIMEOUT");
}

function createTestEnvironment(port, certificateDirectory, password, containerName) {
    const environment = { ...process.env };
    for (const name of [
        "DATABASE_URL",
        "MIGRATION_DATABASE_URL",
        "TEST_DATABASE_URL",
        "PGAPPNAME",
        "PGBINARY",
        "PGCHANNELBINDING",
        "PGCLIENTENCODING",
        "PGCLIENT_ENCODING",
        "PGCONNECT_TIMEOUT",
        "PGDATABASE",
        "PGGSSLIB",
        "PGHOST",
        "PGHOSTADDR",
        "PGKRBSRVNAME",
        "PGOPTIONS",
        "PGPASSWORD",
        "PGPASSFILE",
        "PGPASS_NO_DEESCAPE",
        "PGPORT",
        "PGREPLICATION",
        "PGREQUIREPEER",
        "PGSERVICE",
        "PGSERVICEFILE",
        "PGSSLCERT",
        "PGSSLCRL",
        "PGSSLCRLDIR",
        "PGSSLKEY",
        "PGSSLMAXPROTOCOLVERSION",
        "PGSSLMINPROTOCOLVERSION",
        "PGSSLMODE",
        "PGSSLNEGOTIATION",
        "PGSSLROOTCERT",
        "PGTARGETSESSIONATTRS",
        "PGUSER",
        "NODE_TLS_REJECT_UNAUTHORIZED",
    ]) {
        delete environment[name];
    }
    const plainUrl = new URL(
        `postgresql://127.0.0.1:${port}/postgres?sslmode=disable`,
    );
    plainUrl.username = "postgres";
    plainUrl.password = password;
    const tlsUrl = new URL(
        `postgresql://localhost:${port}/postgres?sslmode=verify-full`,
    );
    tlsUrl.username = "postgres";
    tlsUrl.password = password;
    environment.GOAL9B_TEST_PLAIN_URL = plainUrl.toString();
    environment.GOAL9B_TEST_TLS_URL = tlsUrl.toString();
    environment.GOAL9B_TEST_CA_PATH = path.join(certificateDirectory, "ca.crt");
    environment.GOAL9B_TEST_CONTAINER = containerName;
    return environment;
}

async function main() {
    const suffix = randomBytes(6).toString("hex");
    const containerName = `tetris-goal9b-postgres-${suffix}`;
    const volumeName = `tetris-goal9b-postgres-data-${suffix}`;
    const password = randomBytes(32).toString("base64url");
    const certificateDirectory = await mkdtemp(
        path.join(os.tmpdir(), "tetris-goal9b-certificates-"),
    );
    let containerCreated = false;
    let volumeCreated = false;

    console.log(`[test:db] container=${containerName}`);
    console.log(`[test:db] volume=${volumeName}`);
    console.log("[test:db] PostgreSQL=17.10");

    try {
        docker(["version"], { stdio: "ignore" });
        await createCertificates(certificateDirectory);
        if (
            spawnSync(
                "docker",
                ["container", "inspect", containerName],
                { stdio: "ignore" },
            ).status === 0
            || spawnSync(
                "docker",
                ["volume", "inspect", volumeName],
                { stdio: "ignore" },
            ).status === 0
        ) {
            throw new Error("GOAL9B_DOCKER_RESOURCE_COLLISION");
        }
        docker([
            "volume", "create",
            "--label", "com.sleepingco.tetris.scope=goal9b-test",
            volumeName,
        ], { stdio: "ignore" });
        volumeCreated = true;

        docker([
            "run", "--detach",
            "--name", containerName,
            "--label", "com.sleepingco.tetris.scope=goal9b-test",
            "--publish", "127.0.0.1::5432",
            "--env", "POSTGRES_HOST_AUTH_METHOD=trust",
            "--volume", `${volumeName}:/var/lib/postgresql/data`,
            "--mount", `type=bind,src=${certificateDirectory},dst=/goal9b-host-certs,readonly`,
            "--entrypoint", "/bin/sh",
            POSTGRES_IMAGE,
            "-c",
            [
                "set -eu",
                "mkdir -p /goal9b-certs",
                "cp /goal9b-host-certs/server.crt /goal9b-certs/server.crt",
                "cp /goal9b-host-certs/server.key /goal9b-certs/server.key",
                "chown postgres:postgres /goal9b-certs/server.crt /goal9b-certs/server.key",
                "chmod 600 /goal9b-certs/server.key",
                "exec docker-entrypoint.sh postgres -c ssl=on "
                    + "-c ssl_cert_file=/goal9b-certs/server.crt "
                    + "-c ssl_key_file=/goal9b-certs/server.key",
            ].join("; "),
        ], { stdio: "ignore" });
        containerCreated = true;
        waitForPostgres(containerName);

        const portOutput = docker(["port", containerName, "5432/tcp"]).trim();
        const port = Number(portOutput.slice(portOutput.lastIndexOf(":") + 1));
        if (!Number.isInteger(port) || port <= 0) {
            throw new Error("GOAL9B_POSTGRES_PORT_INVALID");
        }

        const result = spawnSync(
            process.execPath,
            ["--test", path.join(ROOT, "test-integration", "postgresSchemaRepository.js")],
            {
                cwd: ROOT,
                env: createTestEnvironment(
                    port,
                    certificateDirectory,
                    password,
                    containerName,
                ),
                stdio: "inherit",
            },
        );
        if (result.status !== 0) {
            throw new Error(`GOAL9B_POSTGRES_TEST_FAILED_${result.status ?? "SIGNAL"}`);
        }
    } catch (error) {
        if (containerCreated) {
            try {
                const logs = docker(["logs", "--tail", "80", containerName]);
                process.stderr.write(logs);
            } catch {
                // The original failure remains authoritative.
            }
        }
        throw error;
    } finally {
        if (containerCreated) {
            spawnSync("docker", ["rm", "--force", containerName], { stdio: "ignore" });
        }
        if (volumeCreated) {
            spawnSync("docker", ["volume", "rm", volumeName], { stdio: "ignore" });
        }
        await rm(certificateDirectory, { recursive: true, force: true });
        const remainingContainer = spawnSync(
            "docker",
            ["container", "inspect", containerName],
            { stdio: "ignore" },
        );
        const remainingVolume = spawnSync(
            "docker",
            ["volume", "inspect", volumeName],
            { stdio: "ignore" },
        );
        if (remainingContainer.status === 0 || remainingVolume.status === 0) {
            throw new Error("GOAL9B_DOCKER_CLEANUP_FAILED");
        }
        console.log("[test:db] cleanup=complete");
    }
}

main().catch(error => {
    const code = error instanceof Error && /^[A-Z0-9_-]+$/.test(error.message)
        ? error.message
        : "GOAL9B_POSTGRES_TEST_FAILED";
    console.error(code);
    process.exitCode = 1;
});
