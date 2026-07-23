/**
 * game event 한 건을 append-only JSONL 파일에 쓰는 유일한 파일 I/O 경계다.
 *
 * 각 줄은 독립 JSON object이므로 이후 exporter가 큰 로그를 줄 단위로 읽을 수 있다.
 * 이 계층은 payload 의미를 검증하지 않으며, `logService`가 검증한 값만 넘긴다는 계약을
 * 따른다.
 */

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

/**
 * 대상 디렉터리를 만든 뒤 JSON object와 줄바꿈을 한 번 append한다.
 * 기존 파일을 덮어쓰지 않으며, 쓰기 실패는 호출자인 `logService`가 결과로 변환한다.
 */
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
