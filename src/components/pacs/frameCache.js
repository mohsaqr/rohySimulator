/**
 * A bounded cache of decoded frames.
 *
 * The reason this exists, in numbers: one 512x512 slice held as Float32
 * real-world values is 1.05 MB. A routine chest CT is 300 slices, so decoding
 * the series eagerly and keeping it costs 314 MB — for one series, of one
 * study, in a browser tab that also has the rest of the host application in it.
 * Two series open and a laptop starts swapping; a phone tab is killed outright.
 *
 * So frames are decoded on demand and the N most recently used are kept. N is
 * expressed in BYTES rather than in frames, because a 1024x1024 mammogram and a
 * 256x256 MR slice differ sixteenfold and a frame count would be either
 * wasteful for one or fatal for the other.
 *
 * Eviction is least-recently-used, which suits the access pattern exactly: a
 * reader scrolls through a stack, so the frames just visited are the ones about
 * to be visited again.
 */

const DEFAULT_BUDGET_BYTES = 192 * 1024 * 1024;

export function createFrameCache({
    budgetBytes = DEFAULT_BUDGET_BYTES,
    // How big a cached value is. The default measures a decoded frame; a store
    // of raw instance bytes passes `(b) => b.byteLength` and reuses the same
    // eviction machinery rather than growing a second, untested LRU.
    sizeOf = (value) => value?.values?.byteLength ?? 0,
} = {}) {
    // A Map iterates in insertion order, which is what makes it an LRU: delete
    // and re-set on every hit, and the oldest key is always the first one.
    const entries = new Map();
    let used = 0;

    const evictTo = (limit) => {
        for (const key of entries.keys()) {
            if (used <= limit) break;
            used -= entries.get(key).bytes;
            entries.delete(key);
        }
    };

    return {
        /**
         * The decoded frame for `key`, decoding it via `decode()` on a miss.
         * `decode` is called at most once per miss and its result is measured,
         * so the budget reflects what is actually held.
         */
        get(key, decode) {
            if (entries.has(key)) {
                const hit = entries.get(key);
                entries.delete(key);
                entries.set(key, hit);
                return hit.frame;
            }
            const frame = decode();
            const bytes = sizeOf(frame);
            // A frame larger than the whole budget is returned to the caller
            // but not retained: it is inserted, then immediately evicted by the
            // sweep below. Showing the image matters; caching it is what the
            // budget is allowed to refuse.
            entries.set(key, { frame, bytes });
            used += bytes;
            evictTo(budgetBytes);
            return frame;
        },

        /** Insert or replace a value directly (for values produced asynchronously). */
        put(key, value) {
            if (entries.has(key)) {
                used -= entries.get(key).bytes;
                entries.delete(key);
            }
            const bytes = sizeOf(value);
            entries.set(key, { frame: value, bytes });
            used += bytes;
            evictTo(budgetBytes);
        },

        /** The cached value, refreshing its recency — or undefined. Never decodes. */
        read(key) {
            if (!entries.has(key)) return undefined;
            const hit = entries.get(key);
            entries.delete(key);
            entries.set(key, hit);
            return hit.frame;
        },

        has: (key) => entries.has(key),
        clear() { entries.clear(); used = 0; },
        /** Observable state, for tests and for a diagnostics panel. */
        stats: () => ({ frames: entries.size, bytes: used, budgetBytes }),
    };
}
