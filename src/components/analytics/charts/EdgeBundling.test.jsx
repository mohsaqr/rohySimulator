// Smoke test — EdgeBundling renders one bundled path per edge, one circle
// per leaf (with radial label), and click-locks a node's highlight.

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EdgeBundling from './EdgeBundling';

const NODES = [
    { id: 'root', parent: '' },
    { id: 'g1', parent: 'root', label: 'Group 1' },
    { id: 'g2', parent: 'root', label: 'Group 2' },
    { id: 'a', parent: 'g1', label: 'Alpha', group: 'g1' },
    { id: 'b', parent: 'g1', label: 'Beta', group: 'g1' },
    { id: 'c', parent: 'g2', label: 'Gamma', group: 'g2' },
    { id: 'd', parent: 'g2', label: 'Delta', group: 'g2' },
];
const EDGES = [
    { source: 'a', target: 'c' },
    { source: 'b', target: 'd' },
    { source: 'a', target: 'd' },
];

describe('EdgeBundling', () => {
    it('renders one path per edge and one node circle per leaf', () => {
        const { container } = render(
            <EdgeBundling nodes={NODES} edges={EDGES} height={400} title="Bundles" />);
        const paths = container.querySelectorAll('[data-testid="edge-bundling-edges"] path');
        expect(paths).toHaveLength(3);
        paths.forEach((p) => expect(p.getAttribute('d')).toMatch(/^M/));
        expect(container.querySelectorAll('[data-testid="edge-bundling-nodes"] circle')).toHaveLength(4);
        expect(screen.getByText('Alpha')).toBeInTheDocument();
    });

    it('keeps the light label colours by default and honours labelColor/mutedColor overrides', () => {
        const light = render(
            <EdgeBundling nodes={NODES} edges={EDGES} height={400} subtitle="sub" />);
        expect(light.container.querySelector('[data-testid="edge-bundling"] text').getAttribute('fill'))
            .toBe('#1a1a2e');
        light.unmount();

        const { container } = render(
            <EdgeBundling
                nodes={NODES} edges={EDGES} height={400} subtitle="sub"
                labelColor="#d4d4d4" mutedColor="#737373"
            />);
        expect(container.querySelector('[data-testid="edge-bundling"] text').getAttribute('fill'))
            .toBe('#d4d4d4');
    });

    it('click-locking a node highlights its edges and dims the rest', () => {
        const { container } = render(<EdgeBundling nodes={NODES} edges={EDGES} height={400} />);
        fireEvent.click(container.querySelector('[data-testid="bundle-node-a"]'));
        const opacities = [...container.querySelectorAll('[data-testid="edge-bundling-edges"] path')]
            .map((p) => Number(p.getAttribute('opacity')));
        // Edges a→c and a→d highlighted, b→d dimmed.
        expect(opacities.filter((o) => o === 0.9)).toHaveLength(2);
        expect(opacities.filter((o) => o === 0.05)).toHaveLength(1);
    });
});
