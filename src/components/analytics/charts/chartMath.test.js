// Locks the hand-rolled d3-equivalent algorithms in chartMath.js against
// hand-computed expectations: monotone-cubic path shape (endpoints + the
// Fritsch–Carlson no-overshoot guarantee), the carmdash last→first stack
// baselines, the radial cluster layout, LCA edge routing, the curveBundle
// degenerate chord, the Lehmer jitter sequence, Day×Hour bucketing, and
// WCAG relative luminance.

import { describe, it, expect } from 'vitest';
import {
    bucketDayHour,
    bundlePath,
    clusterLayout,
    hexLuminance,
    lcaPath,
    lehmerJitter,
    monotonePath,
    stackSeries,
} from './chartMath';

/** All coordinate pairs appearing in an SVG path string. */
const pathPoints = (d) => {
    const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    return Array.from({ length: nums.length / 2 }, (_, i) => ({ x: nums[2 * i], y: nums[2 * i + 1] }));
};

describe('monotonePath', () => {
    const points = [
        { x: 0, y: 0 },
        { x: 10, y: 2 },
        { x: 20, y: 10 },
        { x: 30, y: 11 },
    ];

    it('starts at the first point and ends at the last point', () => {
        const pts = pathPoints(monotonePath(points));
        expect(pts[0]).toEqual({ x: 0, y: 0 });
        expect(pts[pts.length - 1]).toEqual({ x: 30, y: 11 });
        expect(monotonePath(points).startsWith('M0,0C')).toBe(true);
    });

    it('never overshoots the data range on monotone data (Fritsch–Carlson)', () => {
        const pts = pathPoints(monotonePath(points));
        pts.forEach((p) => {
            expect(p.y).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeLessThanOrEqual(11);
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.x).toBeLessThanOrEqual(30);
        });
    });

    it('degenerates to a straight segment for two points and empty for none', () => {
        expect(monotonePath([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toBe('M1,2L3,4');
        expect(monotonePath([])).toBe('');
    });
});

describe('stackSeries', () => {
    it('matches hand-computed baselines for 2 series × 3 xs (last series on the axis)', () => {
        const series = [
            { label: 'A', x: [0, 1, 2], y: [1, 2, 3] },
            { label: 'B', x: [0, 1, 2], y: [4, 5, 6] },
        ];
        const layers = stackSeries(series, [0, 1, 2]);
        // Last series (B) sits on the x-axis…
        expect(layers[1]).toEqual([
            { x: 0, y0: 0, y1: 4 },
            { x: 1, y0: 0, y1: 5 },
            { x: 2, y0: 0, y1: 6 },
        ]);
        // …and the first series (A) stacks on top of it.
        expect(layers[0]).toEqual([
            { x: 0, y0: 4, y1: 5 },
            { x: 1, y0: 5, y1: 7 },
            { x: 2, y0: 6, y1: 9 },
        ]);
    });

    it('treats an x missing from a series as 0', () => {
        const series = [
            { label: 'A', x: [0, 1, 2], y: [1, 2, 3] },
            { label: 'B', x: [0, 2], y: [4, 6] },
        ];
        const layers = stackSeries(series, [0, 1, 2]);
        expect(layers[1][1]).toEqual({ x: 1, y0: 0, y1: 0 });
        expect(layers[0][1]).toEqual({ x: 1, y0: 0, y1: 2 });
    });
});

describe('clusterLayout + lcaPath', () => {
    const nodes = [
        { id: 'root', parent: '' },
        { id: 'g1', parent: 'root' },
        { id: 'g2', parent: 'root' },
        { id: 'a', parent: 'g1' },
        { id: 'b', parent: 'g1' },
        { id: 'c', parent: 'g2' },
        { id: 'd', parent: 'g2' },
    ];

    it('spaces the 4 leaves evenly on [0,360) at the leaf radius', () => {
        const { leaves } = clusterLayout(nodes, 100);
        expect(leaves.map((l) => l.id)).toEqual(['a', 'b', 'c', 'd']);
        expect(leaves.map((l) => l.angleDeg)).toEqual([0, 90, 180, 270]);
        leaves.forEach((l) => expect(l.radius).toBe(100));
    });

    it('places internal nodes at the mean of their children with depth-proportional radius', () => {
        const { byId } = clusterLayout(nodes, 100);
        expect(byId.get('g1').angleDeg).toBe(45);   // mean(0, 90)
        expect(byId.get('g2').angleDeg).toBe(225);  // mean(180, 270)
        expect(byId.get('root').angleDeg).toBe(135); // mean(45, 225)
        expect(byId.get('root').radius).toBe(0);
        expect(byId.get('g1').radius).toBe(50);      // depth 1 of 2
    });

    it('routes lcaPath up to the LCA then down (LCA once)', () => {
        const { byId } = clusterLayout(nodes, 100);
        expect(lcaPath(byId, 'a', 'c')).toEqual(['a', 'g1', 'root', 'g2', 'c']);
        expect(lcaPath(byId, 'a', 'b')).toEqual(['a', 'g1', 'b']);
    });
});

describe('bundlePath', () => {
    it('renders a straight chord for 2 nodes at beta=1', () => {
        const d = bundlePath([
            { angleDeg: 0, radius: 100 },
            { angleDeg: 90, radius: 100 },
        ], 1);
        // (sin0·100, −cos0·100) = (0,−100); (sin90·100, −cos90·100) = (100,0)
        expect(d).toBe('M0,-100L100,0');
    });
});

describe('lehmerJitter', () => {
    it('reproduces the Park–Miller sequence for seed 42', () => {
        const rand = lehmerJitter(42);
        const s1 = (42 * 16807) % 2147483647;
        const s2 = (s1 * 16807) % 2147483647;
        expect(rand()).toBeCloseTo(s1 / 2147483647, 12);
        expect(rand()).toBeCloseTo(s2 / 2147483647, 12);
    });
});

describe('bucketDayHour', () => {
    it('buckets a Tuesday 14:00 event into grid[2][14] with per-student counts', () => {
        const tue14 = new Date(2026, 0, 6, 14, 0).getTime(); // Tue 6 Jan 2026
        expect(new Date(tue14).getDay()).toBe(2); // sanity: really a Tuesday
        const { grid, maxTotalCell, maxStudent } = bucketDayHour([
            { ts: tue14, student: 's1', state: 'read' },
            { ts: tue14 + 60_000, student: 's1', state: 'read' },
            { ts: tue14, student: 's2', state: 'write' },
        ]);
        expect(grid[2][14]).toEqual([
            { student: 's1', count: 2, states: { read: 2 } },
            { student: 's2', count: 1, states: { write: 1 } },
        ]);
        expect(grid[2][13]).toEqual([]);
        expect(grid[3][14]).toEqual([]);
        expect(maxTotalCell).toBe(3);
        expect(maxStudent).toBe(2);
    });
});

describe('hexLuminance', () => {
    it('is ≈0 for black and ≈1 for white', () => {
        expect(hexLuminance('#000000')).toBeCloseTo(0, 5);
        expect(hexLuminance('#ffffff')).toBeCloseTo(1, 5);
    });
});
