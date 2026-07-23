// PVE room과 match가 공유하는 실행 설정이다. AI 판단 자체는 pveAiPlayerService가 담당한다.
export const AI_DIFFICULTY = Object.freeze({
    NORMAL: "normal",
    HARD: "hard",
} as const);

export type AiDifficulty = typeof AI_DIFFICULTY[keyof typeof AI_DIFFICULTY];

export const DEFAULT_AI_DIFFICULTY = AI_DIFFICULTY.NORMAL;

export const AI_POLICY = Object.freeze({
    HEURISTIC: "heuristic",
    PLACEMENT_V4: "placement_v4",
} as const);

export type AiPolicy = typeof AI_POLICY[keyof typeof AI_POLICY];

export const DEFAULT_AI_POLICY = AI_POLICY.HEURISTIC;

export const AI_EXECUTION_PROFILES = Object.freeze({
    [AI_DIFFICULTY.NORMAL]: Object.freeze({
        terminalSoftDropSteps: 5,
    }),
    [AI_DIFFICULTY.HARD]: Object.freeze({
        terminalSoftDropSteps: 0,
    }),
} satisfies Record<AiDifficulty, { terminalSoftDropSteps: number }>);

export function isValidAiDifficulty(value: unknown): value is AiDifficulty {
    return typeof value === "string" && Object.hasOwn(AI_EXECUTION_PROFILES, value);
}

export function isValidAiPolicy(value: unknown): value is AiPolicy {
    return value === AI_POLICY.HEURISTIC || value === AI_POLICY.PLACEMENT_V4;
}
