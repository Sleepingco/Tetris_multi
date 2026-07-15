const { defineConfig, devices } = require("@playwright/test");
const path = require("node:path");

const baseURL = "http://127.0.0.1:5510";
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
    webServer: {
        command: "npm start",
        url: baseURL,
        env: {
            ...process.env,
            PORT: "5510",
            GAME_EVENTS_LOG_PATH: gameEventsLogPath,
        },
        reuseExistingServer: false,
        timeout: 15_000,
        stdout: "ignore",
        stderr: "pipe",
    },
});
