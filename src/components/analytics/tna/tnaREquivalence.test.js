import { describe, expect, it } from 'vitest';
import { centralities, ftna, summary, tna } from 'dynajs';

const labels = ['A', 'B', 'C'];
const sequences = [
    ['A', 'B', 'C'],
    ['A', 'C', 'C'],
    ['B', 'C', 'A'],
];

function to2D(matrix) {
    return labels.map((_, i) => labels.map((__, j) => matrix.get(i, j)));
}

describe('TNA R-equivalence reference fixture', () => {
    it('matches the reference transition-count matrix used by R TNA workflows', () => {
        const model = ftna(sequences, { labels });
        expect(model.labels).toEqual(labels);
        expect(to2D(model.weights)).toEqual([
            [0, 1, 1],
            [0, 0, 2],
            [1, 0, 1],
        ]);
    });

    it('matches row-normalized relative transition probabilities', () => {
        const model = tna(sequences, { labels });
        expect(to2D(model.weights)).toEqual([
            [0, 0.5, 0.5],
            [0, 0, 1],
            [0.5, 0, 0.5],
        ]);
        expect(Array.from(model.inits)).toEqual([2 / 3, 1 / 3, 0]);
    });

    it('matches centrality semantics with self-loops excluded by default', () => {
        const model = tna(sequences, { labels });
        const result = centralities(model);
        expect(Array.from(result.measures.InStrength)).toEqual([0.5, 0.5, 1.5]);
        expect(Array.from(result.measures.OutStrength)).toEqual([1, 1, 0.5]);
    });

    it('matches density and edge-count definitions including self-loops', () => {
        const model = tna(sequences, { labels });
        const s = summary(model);
        expect(s.nEdges).toBe(5);
        expect(s.density).toBeCloseTo(5 / 9, 12);
        expect(s.hasSelfLoops).toBe(true);
    });
});
