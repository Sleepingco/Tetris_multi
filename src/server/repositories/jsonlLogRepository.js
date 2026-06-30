const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_GAME_EVENTS_LOG_PATH = path.join(
    process.cwd(),
    "data",
    "logs",
    "game-events.jsonl",
);

async function appendJsonLine(log, options = {}) {
    const filePath = options.filePath || DEFAULT_GAME_EVENTS_LOG_PATH;
    const directoryPath = path.dirname(filePath);
    const jsonLine = `${JSON.stringify(log)}\n`;

    await fs.mkdir(directoryPath, { recursive: true });
    await fs.appendFile(filePath, jsonLine, "utf8");
}

module.exports = {
    DEFAULT_GAME_EVENTS_LOG_PATH,
    appendJsonLine,
};
