/**
 * 검증된 game event만 JSONL 저장소로 보내는 application service다.
 *
 * 호출자는 client나 AI가 만든 object를 넘길 수 있지만, repository에는 validator가
 * 성공으로 반환한 log만 전달한다. 로그 I/O 실패는 관찰 가능하게 warning/result로
 * 돌려주되 이미 진행 중인 gameplay를 예외로 중단시키지 않는다.
 */

import { appendJsonLine } from "../repositories/jsonlLogRepository.js";
import {
    validateGameEventLog,
    validatePlacementDecisionLog,
} from "../validators/gameLogValidator.js";
import type {
    LogValidationResult,
    ValidatedLog,
} from "../validators/gameLogValidator.js";

export type LogSaveResult = {
    ok: true;
    log: ValidatedLog;
    reason: null;
} | {
    ok: false;
    log: null;
    reason: string;
};
type LogRepository = { append(log: ValidatedLog): Promise<void> };
type SaveOptions = {
    repository?: LogRepository;
    validate?: (log: unknown) => LogValidationResult;
    warn?: (message: string) => void;
    warningLabel?: string;
};

const defaultRepository = {
    append: appendJsonLine,
};

function createSuccess(log: ValidatedLog): LogSaveResult {
    return {
        ok: true,
        log,
        reason: null,
    };
}

function createFailure(reason: string): LogSaveResult {
    return {
        ok: false,
        log: null,
        reason,
    };
}

export async function savePlacementDecisionLog(
    log: unknown,
    options: SaveOptions = {},
): Promise<LogSaveResult> {
    return saveLog(log, {
        ...options,
        validate: options.validate || validatePlacementDecisionLog,
        warningLabel: "placement_decision",
    });
}

export async function saveGameEventLog(
    log: unknown,
    options: SaveOptions = {},
): Promise<LogSaveResult> {
    return saveLog(log, {
        ...options,
        validate: options.validate || validateGameEventLog,
        warningLabel: typeof log === "object" && log !== null && "eventType" in log
            && typeof log.eventType === "string"
            ? log.eventType
            : "game_event",
    });
}

/**
 * 신뢰 경계 검증을 먼저 실행하고 성공한 payload 한 건만 append한다.
 * validation 실패와 disk write 실패를 모두 `{ok:false, reason}`으로 바꿔 호출자가
 * gameplay 성공 여부와 로그 저장 성공 여부를 별도로 다룰 수 있게 한다.
 */
async function saveLog(log: unknown, options: SaveOptions): Promise<LogSaveResult> {
    const validate = options.validate;
    const repository = options.repository || defaultRepository;
    const warn = options.warn || console.warn;
    if (!validate) return createFailure("LOG_VALIDATOR_REQUIRED");
    const validationResult = validate(log);

    if (!validationResult.ok) {
        return createFailure(validationResult.reason);
    }

    try {
        await repository.append(validationResult.log);
        return createSuccess(validationResult.log);
    } catch (error) {
        const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
        warn(`[logService] ${options.warningLabel} 저장 실패: ${message}`);
        return createFailure("LOG_WRITE_FAILED");
    }
}
