import { describe, it, expect } from 'vitest';
import { withKeyedLock, _heldKeyCount } from '../../server/lib/keyedLock.js';

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

describe('withKeyedLock', () => {
    it('runs work on one key one at a time, other keys alongside, and forgets a key when idle', async () => {
        const trace = [];
        const job = (key, label, ms) => withKeyedLock(key, async () => { trace.push(`+${label}`); await tick(ms); trace.push(`-${label}`); return label; });
        const results = await Promise.all([job('a', 'a1', 30), job('a', 'a2', 1), job('b', 'b1', 5)]);
        expect(results).toEqual(['a1', 'a2', 'b1']);
        expect(trace.indexOf('+a2')).toBeGreaterThan(trace.indexOf('-a1'));
        expect(trace.indexOf('+b1')).toBeLessThan(trace.indexOf('-a1'));
        await tick(0);
        expect(_heldKeyCount()).toBe(0);
    });

    it('passes a failure to its caller and still runs the next work on the key', async () => {
        const failing = withKeyedLock('c', async () => { throw new Error('boom'); });
        const next = withKeyedLock('c', async () => 'ran');
        await expect(failing).rejects.toThrow('boom');
        await expect(next).resolves.toBe('ran');
    });
});
