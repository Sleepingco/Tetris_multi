import { BUFFER_GAMEPLAY_LOG_CONTEXT } from "../client/game/state/config.js";
export { BUFFER_GAMEPLAY_LOG_CONTEXT };
export const LEGACY_GAMEPLAY_RULES_VERSION = "legacy20-v1";
export const BUFFER_GAMEPLAY_RULES_VERSION = "buffer20-v1";
export type GameplayRulesVersion = typeof LEGACY_GAMEPLAY_RULES_VERSION | typeof BUFFER_GAMEPLAY_RULES_VERSION;

const LEGACY_CONTEXT = Object.freeze({
    gameplayRulesVersion: LEGACY_GAMEPLAY_RULES_VERSION,
    coordinateSystem: "internal_top_origin" as const,
    geometry: Object.freeze({ rows: 20, cols: 10, hiddenRows: 0, visibleRows: 20 }),
});


/** 경기/receipt의 서버 소유 규칙 식별자에서 로그 문맥을 얻는다. */
export function getGameplayLogContext(version: GameplayRulesVersion) {
    if (version === BUFFER_GAMEPLAY_RULES_VERSION) return BUFFER_GAMEPLAY_LOG_CONTEXT;
    if (version === LEGACY_GAMEPLAY_RULES_VERSION) return LEGACY_CONTEXT;
    throw new Error("UNSUPPORTED_GAMEPLAY_RULES_VERSION");
}
