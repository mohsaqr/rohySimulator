import { describe, expect, it } from 'vitest';
import { centralities, clusterSequences, maxWeight, prune } from './tnaUtils';

// Audit #16: client-analytics-tna flagged that tnaUtils edge cases (cluster,
// prune, max weight, centrality) are untested. Lock the contract for each
// against:
//   - empty input (no rows / no labels)
//   - single-element input
//   - thresholds at the boundary
//   - degenerate weights (all zero / all equal)

describe('tnaUtils.maxWeight', () => {
    it('returns 0 for an empty matrix', () => {
        expect(maxWeight([])).toBe(0);
    });

    it('returns 0 when every cell is zero', () => {
        expect(maxWeight([[0, 0], [0, 0]])).toBe(0);
    });

    it('finds the max even when it is in the last cell', () => {
        expect(maxWeight([[0, 1], [2, 3]])).toBe(3);
    });

    it('does not consider negative values (max stays >= 0)', () => {
        // The function initialises max=0, so negative values never become
        // the running max. Locks that behaviour — flipping it would change
        // edge-rendering thresholds in the dashboard.
        expect(maxWeight([[-5, -1], [-2, -3]])).toBe(0);
    });
});

describe('tnaUtils.prune', () => {
    function model(weights, labels = weights.map((_, i) => `n${i}`)) {
        return { labels, weights, inits: new Float64Array(labels.length) };
    }

    it('zeroes any weight strictly below the threshold', () => {
        const m = model([[0, 1, 0.4], [2, 0.5, 3]]);
        const out = prune(m, 1);
        expect(out.weights).toEqual([[0, 1, 0], [2, 0, 3]]);
    });

    it('threshold equality: weight === threshold is KEPT (>=, not >)', () => {
        const m = model([[0, 0.3], [0, 0]]);
        const out = prune(m, 0.3);
        expect(out.weights[0][1]).toBe(0.3);
    });

    it('threshold of 0 keeps every weight unchanged', () => {
        const m = model([[0.1, 0.2], [0, 0.5]]);
        const out = prune(m, 0);
        expect(out.weights).toEqual([[0.1, 0.2], [0, 0.5]]);
    });

    it('preserves labels and inits unchanged', () => {
        const m = model([[1]], ['onlyOne']);
        const out = prune(m, 0.5);
        expect(out.labels).toEqual(['onlyOne']);
        expect(out.inits).toBe(m.inits); // same reference, not copied
    });
});

describe('tnaUtils.centralities', () => {
    it('returns empty array for an empty model', () => {
        const out = centralities({ labels: [], weights: [] });
        expect(out).toEqual([]);
    });

    it('computes in/out strength as the row/column sum', () => {
        const out = centralities({
            labels: ['a', 'b'],
            weights: [
                [0.0, 0.5],  // a → b: 0.5
                [0.2, 0.3],  // b → a: 0.2, b → b: 0.3
            ],
        });
        // Sort by inStrength desc: a's inStrength = 0.2, b's = 0.5+0.3=0.8.
        // So b should come first.
        expect(out[0].label).toBe('b');
        expect(out[0].inStrength).toBe(0.8);
        expect(out[0].outStrength).toBe(0.5); // 0.2 + 0.3
        expect(out[1].label).toBe('a');
        expect(out[1].inStrength).toBe(0.2);
        expect(out[1].outStrength).toBe(0.5);
    });

    it('rounds to 3 decimal places (locked precision)', () => {
        const out = centralities({
            labels: ['a'],
            weights: [[0.123456789]],
        });
        expect(out[0].inStrength).toBe(0.123);
        expect(out[0].outStrength).toBe(0.123);
    });
});

describe('tnaUtils.clusterSequences', () => {
    it('with users <= k, returns one cluster per user (early-out)', () => {
        const out = clusterSequences(
            { 'user-a': ['x'], 'user-b': ['y'] },
            ['x', 'y'],
            5,
        );
        expect(out).toHaveLength(2);
        expect(out[0].userIds).toEqual(['user-a']);
        expect(out[1].userIds).toEqual(['user-b']);
    });

    it('returns empty array when input is empty', () => {
        const out = clusterSequences({}, ['x'], 3);
        expect(out).toEqual([]);
    });
});
