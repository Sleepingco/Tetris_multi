const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_GAME_EVENTS_LOG_PATH = path.join(
    process.cwd(),
    "data",
    "logs",
    "game-events.jsonl",
);

function resolveGameEventsLogPath(env = process.env) {
    const configuredPath = env.GAME_EVENTS_LOG_PATH?.trim();
    return configuredPath
        ? path.resolve(configuredPath)
        : DEFAULT_GAME_EVENTS_LOG_PATH;
}

async function appendJsonLine(log, options = {}) {
    const filePath = options.filePath || resolveGameEventsLogPath(options.env);
    const directoryPath = path.dirname(filePath);
    const jsonLine = `${JSON.stringify(log)}\n`;

    await fs.mkdir(directoryPath, { recursive: true });
    await fs.appendFile(filePath, jsonLine, "utf8");
}

module.exports = {
    DEFAULT_GAME_EVENTS_LOG_PATH,
    appendJsonLine,
    resolveGameEventsLogPath,
};
