import { createGameState } from "./stateFactory.ts"
import type { Board } from "../core/board.ts";
import type { PieceState } from "../core/piece.ts";
import type { PieceType } from "./blocks.ts";
import type {
        CreateGameStateOptions,
        GamePhase,
        GameState,
        QueuedInput,
} from "./stateFactory.ts";

export type SerializedGameState = {
        score: number;
        lines: number;
        fallIntervalMs: number;
        board: Board | null;
        pieceQueue: PieceType[];
        bag: PieceType[];
        holdPieceType: PieceType | null;
        holdUsedThisDrop: boolean;
        activePiece: PieceState | null;
        pendingPiece: PieceState | null;
        inputQueue: QueuedInput[];
        phase: GamePhase;
        lastActionWasRotation: boolean;
        isTSpin: boolean;
        combo: number;
        backToBack: boolean;
};

// =============================
// 상태 스냅샷 보조 함수
// 변경 가능한 gameState와 외부로 전달할 snapshot 사이에 복사 경계를 만든다.
// board·piece와 queue 배열 자체는 복사한다. inputQueue 항목 객체는 공유하므로 읽기 전용으로 다룬다.
// =============================

/**
  * board의 바깥 배열과 각 row를 복사한다.
  * cell은 문자열 또는 null이라 이 깊이까지만 복사하면 원본과 안전하게 분리된다.
  */
function cloneBoard(board: Board | null | undefined): Board | null {
        if (!Array.isArray(board)) return null
        return board.map(row => [...row])
}

/**
  * 조각의 gameplay 필드만 새 객체로 복사해 참조 공유를 끊는다.
  */
function clonePiece(piece: PieceState | null | undefined): PieceState | null {
        if (!piece) return null
        return {
                pieceType: piece.pieceType,
                rotation: piece.rotation,
                row: piece.row,
                col: piece.col,
        }
}

/**
  * 변경 가능한 gameState를 plain-object snapshot으로 복사한다.
  * 이름은 serialize지만 문자열로 바꾸지는 않는다. tick, pieceIndex, serverBagQueue 같은 실행 정보는
  * runtime 소유이므로 여기 포함하지 않고 `createTetrisRuntime.getSnapshot`이 필요한 값만 덧붙인다.
  * board·piece와 queue 배열은 새로 만들지만 inputQueue 안의 항목 객체는 공유한다.
  */
export function serializeGameState(gameState: GameState): SerializedGameState {
        return {
                score: gameState.score,
                lines: gameState.lines,
                fallIntervalMs: gameState.fallIntervalMs,
                board: cloneBoard(gameState.board),
                pieceQueue: [...gameState.pieceQueue],
                bag: [...gameState.bag],
                holdPieceType: gameState.holdPieceType,
                holdUsedThisDrop: gameState.holdUsedThisDrop,
                activePiece: clonePiece(gameState.activePiece),
                pendingPiece: clonePiece(gameState.pendingPiece),
                inputQueue: [...gameState.inputQueue],
                phase: gameState.phase,
                lastActionWasRotation: gameState.lastActionWasRotation,
                isTSpin: gameState.isTSpin,
                combo: gameState.combo,
                backToBack: gameState.backToBack,
        }
}

/**
  * partial snapshot을 새 gameState에 복사하고, 빠진 값은 factory 기본값으로 채운다.
  * board·piece와 queue 배열은 공유하지 않는다. inputQueue 항목 객체는 공유하므로
  * snapshot 소비자는 해당 항목을 읽기 전용으로 다뤄야 한다.
  */
export function deserializeGameState(
        snapshot: Partial<SerializedGameState>,
        defaults: CreateGameStateOptions,
): GameState {
        const gameState = createGameState(defaults)

        gameState.score = snapshot.score ?? gameState.score
        gameState.lines = snapshot.lines ?? gameState.lines
        gameState.fallIntervalMs = snapshot.fallIntervalMs ?? gameState.fallIntervalMs
        gameState.board = cloneBoard(snapshot.board)
        gameState.pieceQueue = Array.isArray(snapshot.pieceQueue) ? [...snapshot.pieceQueue] : []
        gameState.bag = Array.isArray(snapshot.bag) ? [...snapshot.bag] : []
        gameState.holdPieceType = snapshot.holdPieceType ?? null
        gameState.holdUsedThisDrop = Boolean(snapshot.holdUsedThisDrop)
        gameState.activePiece = clonePiece(snapshot.activePiece) ?? gameState.activePiece
        gameState.pendingPiece = clonePiece(snapshot.pendingPiece)
        gameState.inputQueue = Array.isArray(snapshot.inputQueue) ? [...snapshot.inputQueue] : []
        gameState.phase = snapshot.phase ?? gameState.phase
        gameState.lastActionWasRotation = Boolean(snapshot.lastActionWasRotation)
        gameState.isTSpin = Boolean(snapshot.isTSpin)
        gameState.combo = typeof snapshot.combo === "number" && Number.isInteger(snapshot.combo)
                ? snapshot.combo
                : gameState.combo
        gameState.backToBack = Boolean(snapshot.backToBack)

        return gameState
}
