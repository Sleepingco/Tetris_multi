const AI_DIFFICULTY = Object.freeze({
    NORMAL: "normal",
    HARD: "hard",
});

const DEFAULT_AI_DIFFICULTY = AI_DIFFICULTY.NORMAL;

const AI_POLICY = Object.freeze({
    HEURISTIC: "heuristic",
    PLACEMENT_V4: "placement_v4",
});

const DEFAULT_AI_POLICY = AI_POLICY.HEURISTIC;

const AI_EXECUTION_PROFILES = Object.freeze({
    [AI_DIFFICULTY.NORMAL]: Object.freeze({
        terminalSoftDropSteps: 5,
    }),
    [AI_DIFFICULTY.HARD]: Object.freeze({
        terminalSoftDropSteps: 0,
    }),
});

function isValidAiDifficulty(value) {
    return Object.hasOwn(AI_EXECUTION_PROFILES, value);
}

function isValidAiPolicy(value) {
    return Object.values(AI_POLICY).includes(value);
}

module.exports = {
    AI_DIFFICULTY,
    AI_EXECUTION_PROFILES,
    AI_POLICY,
    DEFAULT_AI_DIFFICULTY,
    DEFAULT_AI_POLICY,
    isValidAiDifficulty,
    isValidAiPolicy,
};
