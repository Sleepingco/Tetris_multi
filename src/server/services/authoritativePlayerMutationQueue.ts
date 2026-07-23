/**
 * 같은 room/player의 authoritative state 변경을 도착 순서대로 실행하는 계약이다.
 * socket input과 gravity tick이 이 queue를 공유해야 같은 조각을 동시에 변경하지 않는다.
 */
export type AuthoritativePlayerMutationQueue = {
    enqueueAuthoritativePlayerMutation<T>(
        roomId: string,
        playerId: string,
        mutation: () => T | PromiseLike<T>,
    ): Promise<T>;
};

/**
 * room/player별 Promise tail을 사용하는 작은 mutation queue를 만든다.
 * - 같은 key는 FIFO로 실행하고, 다른 player key는 서로 기다리지 않는다.
 * - mutation 실패는 해당 호출자에게 그대로 전달하지만 다음 tail은 계속 진행한다.
 * - 마지막 tail이 끝나면 Map entry를 지워 완료된 player 상태를 보관하지 않는다.
 */
export function createAuthoritativePlayerMutationQueue(): AuthoritativePlayerMutationQueue {
    const mutationTails = new Map<string, Promise<void>>();

    function enqueueAuthoritativePlayerMutation<T>(
        roomId: string,
        playerId: string,
        mutation: () => T | PromiseLike<T>,
    ): Promise<T> {
        if (typeof mutation !== "function") {
            return Promise.reject(new TypeError("mutation must be a function"));
        }

        const mutationKey = JSON.stringify([roomId, playerId]);
        const previousTail = mutationTails.get(mutationKey) || Promise.resolve();
        const mutationResult = previousTail.then(() => mutation());
        // queue 진행용 tail만 성공 상태로 바꾸고, 호출자에게 돌려주는 mutationResult는 실패를 보존한다.
        const nextTail = mutationResult.then(
            () => undefined,
            () => undefined,
        );

        mutationTails.set(mutationKey, nextTail);
        nextTail.then(() => {
            // 더 늦게 enqueue된 tail이 있으면 그 entry를 잘못 지우지 않는다.
            if (mutationTails.get(mutationKey) === nextTail) {
                mutationTails.delete(mutationKey);
            }
        });

        return mutationResult;
    }

    return {
        enqueueAuthoritativePlayerMutation,
    };
}
