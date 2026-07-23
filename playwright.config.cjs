/**
 * 실제 브라우저에서 page shell, Socket.IO와 server authoritative 흐름을 함께 검증한다.
 *
 * 실행 모드:
 * - 기본: production build를 `npm start`로 5510에서 실행한다.
 * - `PLAYWRIGHT_VITE_DEV=1`: backend 5500과 Vite 5173을 따로 실행한다.
 * - `PLAYWRIGHT_EXTERNAL_SERVER=1`: 이미 실행 중인 서버를 사용하고 새 프로세스를 만들지 않는다.
 *
 * room과 JSONL 경로를 한 테스트 프로세스가 공유하므로 worker는 1개로 고정한다.
 */
const { defineConfig, devices } = require("@playwright/test");
const path = require("node:path");

const viteDev = process.env.PLAYWRIGHT_VITE_DEV === "1";
const externalServer = process.env.PLAYWRIGHT_EXTERNAL_SERVER === "1";
const baseURL = viteDev ? "http://127.0.0.1:5173" : "http://127.0.0.1:5510";
const gameEventsLogPath = path.join(
    __dirname,
    "test-results",
    "e2e-game-events.jsonl",
);

module.exports = defineConfig({
    testDir: "./e2e",
    timeout: 30_000,
    expect: {
        timeout: 8_000,
    },
    workers: 1,
    retries: 0,
    outputDir: "test-results",
    use: {
        baseURL,
        // 성공할 때는 버리고, 실패한 경우에만 브라우저 동작 기록을 남겨 원인 추적 비용을 줄인다.
        trace: "retain-on-failure",
    },
    projects: [
        {
            name: "chromium",
            use: {
                ...devices["Desktop Chrome"],
                viewport: { width: 1600, height: 900 },
            },
        },
    ],
    webServer: externalServer
        ? undefined
        : viteDev
        ? [
            // Vite 모드에서는 Socket.IO backend와 client dev server의 준비 상태를 각각 기다린다.
            {
                command: "npm run dev:server",
                url: "http://127.0.0.1:5500/socket.io/socket.io.js",
                env: {
                    ...process.env,
                    PORT: "5500",
                    GAME_EVENTS_LOG_PATH: gameEventsLogPath,
                    SOCKET_RATE_LIMIT_PROFILE: "test",
                },
                reuseExistingServer: false,
                timeout: 15_000,
                stdout: "ignore",
                stderr: "pipe",
            },
            {
                command: "npm run dev",
                url: baseURL,
                reuseExistingServer: false,
                timeout: 15_000,
                stdout: "ignore",
                stderr: "pipe",
            },
        ]
        : {
            // 기본 E2E는 실제 배포와 같은 compiled server가 client artifact까지 제공한다.
            command: "npm start",
            url: baseURL,
            env: {
                ...process.env,
                PORT: "5510",
                GAME_EVENTS_LOG_PATH: gameEventsLogPath,
                SOCKET_RATE_LIMIT_PROFILE: "test",
                CSP_CONNECT_ORIGINS: "ws://127.0.0.1:5510",
            },
            reuseExistingServer: false,
            timeout: 15_000,
            stdout: "ignore",
            stderr: "pipe",
        },
});
