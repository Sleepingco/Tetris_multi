import type { PieceType } from "./blocks.ts";
import type { GameState } from "./stateFactory.ts";

// =============================
// 조각 큐 상태 유틸리티
// `gameState.bag`은 아직 뽑지 않은 7-bag, `gameState.pieceQueue`는 스폰과 preview 대기열이다.
// 두 배열을 직접 변경하며, 주입받은 rng 덕분에 테스트와 결정론적 실행에서 같은 순서를 재현할 수 있다.
// =============================

/**
  * bag이 비면 모든 조각을 한 번씩 넣어 Fisher-Yates 방식으로 섞고 하나를 꺼낸다.
  * 한 bag 안에서는 각 조각이 정확히 한 번 나오며 `gameState.bag`을 직접 변경한다.
  */
export function pickRandomPiece(
    gameState: GameState,
    pieceTypes: readonly PieceType[],
    rng: () => number,
): PieceType {
    if (pieceTypes.length === 0) {
        throw new TypeError("pieceTypes must not be empty");
    }
    if (!gameState.bag || gameState.bag.length === 0) {
        gameState.bag = [...pieceTypes];
        for (let i = gameState.bag.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [gameState.bag[i], gameState.bag[j]] = [gameState.bag[j], gameState.bag[i]];
        }
    }
    const pieceType = gameState.bag.pop();
    if (pieceType === undefined) {
        throw new Error("piece bag must not be empty");
    }
    return pieceType;
}

/**
  * 지금 스폰할 한 조각과 화면에 보여 줄 preview 수만큼 queue를 채운다.
  * 부족한 조각만 bag에서 가져오므로 이미 정해진 queue 순서는 유지된다.
  */
export function ensureQueueFilled(
    gameState: GameState,
    nextQueueSize: number,
    pieceTypes: readonly PieceType[],
    rng: () => number,
): void {
    // nextQueueSize는 화면 preview 개수이고, +1은 지금 스폰할 조각 몫이다.
    while (gameState.pieceQueue.length < nextQueueSize + 1) {
        gameState.pieceQueue.push(pickRandomPiece(gameState, pieceTypes, rng));
    }
}

/**
  * queue 맨 앞 조각을 현재 턴에 넘기고, 빠진 자리를 다시 채운다.
  * 호출 뒤에도 `pieceQueue`에는 다음 스폰 한 개와 preview 조각들이 준비되어 있다.
  */
export function takeNextFromQueue(
    gameState: GameState,
    nextQueueSize: number,
    pieceTypes: readonly PieceType[],
    rng: () => number,
): PieceType {
    ensureQueueFilled(gameState, nextQueueSize, pieceTypes, rng);
    const nextType = gameState.pieceQueue.shift();
    ensureQueueFilled(gameState, nextQueueSize, pieceTypes, rng);
    if (nextType === undefined) {
        throw new Error("piece queue must not be empty");
    }
    return nextType;
}
