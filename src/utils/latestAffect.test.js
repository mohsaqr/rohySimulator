// latestAffect: the module-level live-affect store (Plan A).
import { describe, it, expect, beforeEach } from 'vitest';
import {
    publishAffectSample,
    publishAffectWindows,
    getAffectSnapshot,
    clearAffect,
    subscribeAffect,
} from './latestAffect.js';

const sample = (over = {}) => ({ dominant: 'happy', confidence: 0.9, anxiousIndex: 0.1, ts: 123, ...over });

describe('latestAffect store', () => {
    beforeEach(() => clearAffect());

    it('starts empty and clears back to empty', () => {
        expect(getAffectSnapshot()).toBeNull();
        publishAffectSample(sample());
        clearAffect();
        expect(getAffectSnapshot()).toBeNull();
    });

    it('stores the latest sample and stamps updatedAt from it', () => {
        publishAffectSample(sample({ ts: 111 }));
        publishAffectSample(sample({ ts: 222, dominant: 'sad' }));
        const snap = getAffectSnapshot();
        expect(snap.sample.dominant).toBe('sad');
        expect(snap.updatedAt).toBe(222);
    });

    it('ignores samples without a finite timestamp or non-objects', () => {
        publishAffectSample(sample({ ts: NaN }));
        publishAffectSample('nope');
        publishAffectSample(null);
        expect(getAffectSnapshot()).toBeNull();
    });

    it('keeps the sample when windows arrive, and caps the window buffer', () => {
        publishAffectSample(sample());
        publishAffectWindows(Array.from({ length: 20 }, (_, i) => ({ i })));
        const snap = getAffectSnapshot();
        expect(snap.sample.dominant).toBe('happy');
        expect(snap.windows).toHaveLength(12); // MAX_WINDOWS
        expect(snap.windows[11]).toEqual({ i: 19 }); // newest kept
    });

    it('ignores empty or non-array window publishes', () => {
        publishAffectWindows([]);
        publishAffectWindows('windows');
        expect(getAffectSnapshot()).toBeNull();
    });

    it('notifies subscribers on publish and clear, and unsubscribes cleanly', () => {
        const seen = [];
        const unsub = subscribeAffect(s => seen.push(s));
        publishAffectSample(sample());
        clearAffect();
        expect(seen).toHaveLength(2);
        expect(seen[1]).toBeNull();
        unsub();
        publishAffectSample(sample());
        expect(seen).toHaveLength(2);
    });

    it('survives a throwing subscriber', () => {
        subscribeAffect(() => { throw new Error('boom'); });
        const seen = [];
        subscribeAffect(s => seen.push(s));
        expect(() => publishAffectSample(sample())).not.toThrow();
        expect(seen).toHaveLength(1);
    });
});
