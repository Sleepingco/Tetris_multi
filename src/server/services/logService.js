const { appendJsonLine } = require("../repositories/jsonlLogRepository.js");
const {
    validateGameEventLog,
    validatePlacementDecisionLog,
} = require("../validators/gameLogValidator.js");

const defaultRepository = {
    append: appendJsonLine,
};

function createSuccess(log) {
    return {
        ok: true,
        log,
        reason: null,
    };
}

function createFailure(reason) {
    return {
        ok: false,
        log: null,
        reason,
    };
}

async function savePlacementDecisionLog(log, options = {}) {
    return saveLog(log, {
        ...options,
        validate: options.validate || validatePlacementDecisionLog,
        warningLabel: "placement_decision",
    });
}

async function saveGameEventLog(log, options = {}) {
    return saveLog(log, {
        ...options,
        validate: options.validate || validateGameEventLog,
        warningLabel: log?.eventType || "game_event",
    });
}

async function saveLog(log, options = {}) {
    const validate = options.validate;
    const repository = options.repository || defaultRepository;
    const warn = options.warn || console.warn;
    const validationResult = validate(log);

    if (!validationResult.ok) {
        return createFailure(validationResult.reason);
    }

    try {
        await repository.append(validationResult.log);
        return createSuccess(validationResult.log);
    } catch (error) {
        warn(`[logService] ${options.warningLabel} 저장 실패: ${error.message}`);
        return createFailure("LOG_WRITE_FAILED");
    }
}

module.exports = {
    saveGameEventLog,
    savePlacementDecisionLog,
};
