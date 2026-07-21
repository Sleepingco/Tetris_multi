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
