// Smoke test — StackedAreaChart renders one area layer per series (fill +
// top edge line) and a legend entry per series.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StackedAreaChart from './StackedAreaChart';

const SERIES = [
    { label: 'Alpha', x: [0, 1, 2], y: [1, 2, 3] },
    { label: 'Beta', x: [0, 1, 2], y: [4, 5, 6] },
];

describe('StackedAreaChart', () => {
    it('renders one area layer per series with a closed fill path and a top line', () => {
        const { container } = render(
            <StackedAreaChart series={SERIES} title="Stacked" xLabel="t" yLabel="n" />);
        const layers = container.querySelectorAll('[data-testid^="area-layer-"]');
        expect(layers).toHaveLength(2);
        layers.forEach((layer) => {
            const paths = layer.querySelectorAll('path');
            expect(paths).toHaveLength(2);
            expect(paths[0].getAttribute('d')).toMatch(/Z$/); // closed area
            expect(paths[1].getAttribute('fill')).toBe('none'); // top edge line
        });
        expect(screen.getByText('Alpha')).toBeInTheDocument();
        expect(screen.getByText('Beta')).toBeInTheDocument();
    });
});
