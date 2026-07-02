// Tests for TransitionMiniCard — the compact TNA (arc network + centrality)
// card added to the Gaze tab, and its pure buildTransitionGraph helper.

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import TransitionMiniCard, { buildTransitionGraph } from './TransitionMiniCard.jsx';

describe('buildTransitionGraph', () => {
    it('builds nodes + directed edges with throughput from dynajs weights', () => {
        const seqs = [['A', 'B', 'A'], ['A', 'B', 'C']];
        const g = buildTransitionGraph(seqs, ['A', 'B', 'C']);

        expect(g.labels).toEqual(['A', 'B', 'C']);
        expect(g.nodes.map((n) => n.label)).toEqual(['A', 'B', 'C']);
        // A→B twice, B→A once, B→C once.
        const edge = (from, to) => g.edges.find((e) => g.nodes[e.from].label === from && g.nodes[e.to].label === to);
        expect(edge('A', 'B').weight).toBe(2);
        expect(edge('B', 'A').weight).toBe(1);
        expect(edge('B', 'C').weight).toBe(1);
        expect(g.maxEdge).toBe(2);
        // B carries the most traffic (in 2 + out 2).
        const b = g.nodes.find((n) => n.label === 'B');
        expect(b.throughput).toBe(4);
    });

    it('derives labels when none are given and drops too-short sequences', () => {
        const g = buildTransitionGraph([['X', 'Y'], ['Z']], null);
        expect(g.labels).toEqual(['X', 'Y']); // Z-only sequence dropped
        expect(g.nodes).toHaveLength(2);
    });

    it('returns an empty graph for no usable sequences', () => {
        const g = buildTransitionGraph([['solo']], null);
        expect(g.nodes).toEqual([]);
        expect(g.edges).toEqual([]);
        expect(g.model).toBeNull();
    });
});

describe('TransitionMiniCard', () => {
    const seqs = [['Patient', 'Chat', 'Patient'], ['Vitals', 'ECG', 'Chat']];

    it('renders the network, title and a centrality panel with measure toggles', () => {
        render(<TransitionMiniCard title="Gaze target transitions" sequences={seqs} />);
        expect(screen.getByText('Gaze target transitions')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Transition network' })).toBeInTheDocument();
        expect(screen.getByText(/Centrality/)).toBeInTheDocument();
        // Measure pills present and switchable.
        expect(screen.getByRole('button', { name: 'InStrength' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Betweenness' }));
        expect(screen.getByRole('button', { name: 'Betweenness' })).toBeInTheDocument();
    });

    it('shows the empty hint when there is no movement to model', () => {
        render(<TransitionMiniCard title="Empty" sequences={[['solo']]} />);
        expect(screen.getByText(/Not enough movement/i)).toBeInTheDocument();
        expect(screen.queryByRole('img', { name: 'Transition network' })).not.toBeInTheDocument();
    });

    it('honors a colorFor mapping for node/label coloring', () => {
        const colorFor = (l) => (l === 'Patient' ? '#123456' : null);
        const { container } = render(
            <TransitionMiniCard title="c" sequences={seqs} colorFor={colorFor} />,
        );
        const svg = within(container).getByRole('img', { name: 'Transition network' });
        // At least one node circle carries the custom fill.
        expect(svg.querySelector('circle[fill="#123456"]')).toBeTruthy();
    });
});
