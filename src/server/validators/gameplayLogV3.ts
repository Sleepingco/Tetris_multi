import BLOCKS from "../../client/game/state/blocks.js";
import { BUFFER_GAMEPLAY_LOG_CONTEXT } from "../../shared/gameplayLogContext.js";

type RecordValue = Record<string, unknown>;
function isRecord(value: unknown): value is RecordValue {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Raw log와 canonical payload가 같은 v3 좌표·관찰 의미를 사용하도록 검사한다. */
export function isValidGameplayLogV3(payload: RecordValue, eventType: string): boolean {
    const context = BUFFER_GAMEPLAY_LOG_CONTEXT;
    const geometry = payload.geometry;
    if (payload.gameplayRulesVersion !== context.gameplayRulesVersion
        || payload.coordinateSystem !== context.coordinateSystem || !isRecord(geometry)
        || Object.keys(geometry).length !== 4
        || Object.entries(context.geometry).some(([key, value]) => geometry[key] !== value)) return false;

    if (eventType !== "placement_decision") {
        return eventType === "game_start" || (eventType === "game_over"
            && typeof payload.reason === "string"
            && ["lock_out", "top_out", "block_out", "disconnect_timeout", "ai_no_legal_placement", "ai_decision_failed"].includes(payload.reason));
    }
    if (!((payload.source === "human" && payload.modelType === null)
        || (payload.source === "heuristic_ai" && payload.modelType === "heuristic"))
        || !validBoard(payload.boardBefore) || !validBoard(payload.boardAfter)
        || !validPiece(payload.activePiece) || !validPiece(payload.selectedPlacement)
        || !Array.isArray(payload.nextQueue) || !payload.nextQueue.every(validPieceType)
        || (payload.holdPiece !== null && !validPieceType(payload.holdPiece))
        || !isRecord(payload.placementResult) || !isRecord(payload.observation)) return false;
    const result = payload.placementResult;
    const observation = payload.observation;
    if (typeof result.linesCleared !== "number" || !Number.isInteger(result.linesCleared) || result.linesCleared < 0 || result.linesCleared > 4
        || typeof result.scoreDelta !== "number" || !Number.isFinite(result.scoreDelta)
        || typeof result.tSpinType !== "string" || !["none", "mini", "full"].includes(result.tSpinType)
        || (result.tSpinType === "mini" && result.linesCleared > 2)
        || (result.tSpinType === "full" && result.linesCleared > 3)
        || result.isTSpin !== (result.tSpinType !== "none")) return false;
    const terminal = observation.terminalOutcome;
    if ((result.gameOverReason ?? null) !== terminal || result.gameOver !== (terminal !== null)) return false;
    if (observation.stage === "lock_commit") {
        const placement = payload.selectedPlacement as RecordValue;
        return terminal === "lock_out" && observation.nextSpawnOutcome === "not_evaluated"
            && result.linesCleared === 0
            && ["attackLines", "rawAttackLines", "canceledGarbageLines", "appliedGarbageLines"].every(key => result[key] === 0)
            && (placement.cells as { row: number }[]).every(cell => cell.row < 20);
    }
    if (observation.stage === "post_line_clear") {
        return payload.source === "human" && terminal === null
            && observation.nextSpawnOutcome === "not_evaluated"
            && result.canceledGarbageLines === 0 && result.appliedGarbageLines === 0;
    }
    if (observation.stage !== "post_garbage_spawn" || payload.source !== "heuristic_ai") return false;
    return (terminal === null && observation.nextSpawnOutcome === "clear")
        || (terminal === "block_out" && observation.nextSpawnOutcome === "blocked")
        || (terminal === "top_out" && observation.nextSpawnOutcome === "not_evaluated");
}

function validPieceType(value: unknown): value is keyof typeof BLOCKS {
    return typeof value === "string" && Object.hasOwn(BLOCKS, value);
}

function validBoard(value: unknown): boolean {
    return Array.isArray(value) && value.length === 40 && value.every(row =>
        Array.isArray(row) && row.length === 10 && row.every(cell =>
            cell === null || cell === "garbage" || validPieceType(cell)));
}

function validPiece(value: unknown): boolean {
    if (!isRecord(value) || !validPieceType(value.pieceType)
        || typeof value.rotation !== "number" || !Number.isInteger(value.rotation) || value.rotation < 0 || value.rotation > 3
        || typeof value.row !== "number" || !Number.isSafeInteger(value.row)
        || typeof value.col !== "number" || !Number.isSafeInteger(value.col)
        || !Array.isArray(value.cells) || value.cells.length !== 4) return false;
    const offsets = BLOCKS[value.pieceType][value.rotation];
    const { row, col } = value;
    const expected = offsets.map(([x, y]) => `${row + y}:${col + x}`).sort();
    if (!value.cells.every(cell => isRecord(cell) && typeof cell.row === "number" && typeof cell.col === "number"
        && Number.isInteger(cell.row) && Number.isInteger(cell.col)
        && cell.row >= 0 && cell.row < 40 && cell.col >= 0 && cell.col < 10)) return false;
    return value.cells.map(cell => `${cell.row}:${cell.col}`).sort().every((cell, index) => cell === expected[index]);
}
