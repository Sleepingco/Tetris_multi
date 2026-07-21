/**
 * room/player별 authoritative mutation을 enqueue 순서대로 실행한다.
 * - 다른 player key는 독립적인 Promise tail을 사용한다.
 * - 실패한 mutation은 호출자에게 전달하되 다음 mutation 실행은 막지 않는다.
 *
 * @returns {{enqueueAuthoritativePlayerMutation: Function}} mutation queue API
 */
export type AuthoritativePlayerMutationQueue = {
    enqueueAuthoritativePlayerMutation<T>(
        roomId: string,
        playerId: string,
        mutation: () => T | PromiseLike<T>,
    ): Promise<T>;
};

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
        const nextTail = mutationResult.then(
            () => undefined,
            () => undefined,
        );

        mutationTails.set(mutationKey, nextTail);
        nextTail.then(() => {
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
