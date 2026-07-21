import * as fs from "node:fs/promises";
import * as path from "node:path";

export const DEFAULT_GAME_EVENTS_LOG_PATH = path.join(
    process.cwd(),
    "data",
    "logs",
    "game-events.jsonl",
);

export function resolveGameEventsLogPath(env: NodeJS.ProcessEnv = process.env): string {
    const configuredPath = env.GAME_EVENTS_LOG_PATH?.trim();
    return configuredPath
        ? path.resolve(configuredPath)
        : DEFAULT_GAME_EVENTS_LOG_PATH;
}

export async function appendJsonLine(
    log: unknown,
    options: { filePath?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
    const filePath = options.filePath || resolveGameEventsLogPath(options.env);
    const directoryPath = path.dirname(filePath);
    const jsonLine = `${JSON.stringify(log)}\n`;

    await fs.mkdir(directoryPath, { recursive: true });
    await fs.appendFile(filePath, jsonLine, "utf8");
}
