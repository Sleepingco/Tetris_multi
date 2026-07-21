import type { PieceType } from "./blocks.ts";
import type { GameState } from "./stateFactory.ts";

// =============================
// 조각 큐 상태 유틸리티
// 7-bag 랜덤화와 next queue 유지를 담당한다.
// =============================

/**
  * 셔플된 bag 시스템을 사용해 다음 조각 타입을 반환한다.
  * - bag이 비면 다시 채우고 섞는다.
  *
  * @param {Object} gameState - 변경 가능한 게임 상태 객체
  * @param {string[]} pieceTypes - 사용 가능한 조각 타입 목록
  * @param {Function} rng - 테스트와 멀티플레이 결정론을 위해 주입할 난수 함수
  * @returns {string} 다음 조각 타입
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
  * 현재 스폰과 미리보기에 필요한 만큼 큐 길이를 유지한다.
  *
  * @param {Object} gameState - 변경 가능한 게임 상태 객체
  * @param {number} nextQueueSize - 화면에 보여줄 다음 조각 개수
  * @param {string[]} pieceTypes - 사용 가능한 조각 타입 목록
  * @param {Function} rng - 테스트와 멀티플레이 결정론을 위해 주입할 난수 함수
  * @returns {void}
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
  * 큐에서 다음 스폰 조각을 꺼내고, 미리보기 버퍼가 유지되도록 다시 채운다.
  *
  * @param {Object} gameState - 변경 가능한 게임 상태 객체
  * @param {number} nextQueueSize - 화면에 보여줄 다음 조각 개수
  * @param {string[]} pieceTypes - 사용 가능한 조각 타입 목록
  * @param {Function} rng - 테스트와 멀티플레이 결정론을 위해 주입할 난수 함수
  * @returns {string} 지금 스폰할 조각 타입
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
