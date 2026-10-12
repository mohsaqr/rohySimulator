// One-at-a-time work per key, in this process.
//
// A route that checks "does this already exist?" and then inserts lets two
// identical requests arriving together both pass the check — the duplicate
// orders and findings of the stability run (rc.47). Where the check cannot
// live inside the INSERT itself, the route runs check and write under a lock
// on what makes the row unique (session + item). The server is one process, so
// an in-process lock covers every request it serves.

const tails = new Map();

/**
 * Run `work` after every earlier call with the same key has settled. Resolves
 * or rejects with `work`'s own result. Keys are released when their queue
 * empties, so the map holds only keys with work in flight.
 */
export function withKeyedLock(key, work) {
    const previous = tails.get(key) || Promise.resolve();
    const result = previous.then(() => work());
    const tail = result.then(() => {}, () => {});
    tails.set(key, tail);
    tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
}

/** Test seam: how many keys have work queued or running. */
export const _heldKeyCount = () => tails.size;
