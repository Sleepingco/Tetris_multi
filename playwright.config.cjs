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
