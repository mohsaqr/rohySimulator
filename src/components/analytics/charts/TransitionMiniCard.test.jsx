// Tests for TransitionMiniCard — the compact dynajs/LAILA TNA card added to
// the Gaze tab, and its pure buildTransitionModel helper.

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import TransitionMiniCard, { buildTransitionModel } from './TransitionMiniCard.jsx';

describe('buildTransitionModel', () => {
    it('builds a dynajs frequency TNA model with directed transition counts', () => {
        const seqs = [['A', 'B', 'A'], ['A', 'B', 'C']];
        const analysis = buildTransitionModel(seqs, ['A', 'B', 'C']);

        expect(analysis.labels).toEqual(['A', 'B', 'C']);
        expect(analysis.model.labels).toEqual(['A', 'B', 'C']);
        // A→B twice, B→A once, B→C once.
        expect(analysis.model.weights.get(0, 1)).toBe(2);
        expect(analysis.model.weights.get(1, 0)).toBe(1);
        expect(analysis.model.weights.get(1, 2)).toBe(1);
        expect(analysis.centralityData.labels).toEqual(['A', 'B', 'C']);
        expect(analysis.centralityData.measures.InStrength[1]).toBe(2);
    });

    it('derives labels when none are given and drops too-short sequences', () => {
        const analysis = buildTransitionModel([['X', 'Y'], ['Z']], null);
        expect(analysis.labels).toEqual(['X', 'Y']); // Z-only sequence dropped
        expect(analysis.model.labels).toEqual(['X', 'Y']);
    });

    it('returns no model for no usable sequences', () => {
        const analysis = buildTransitionModel([['solo']], null);
        expect(analysis.sequences).toEqual([]);
        expect(analysis.model).toBeNull();
        expect(analysis.centralityData).toBeNull();
    });
});

describe('TransitionMiniCard', () => {
    const seqs = [['Patient', 'Chat', 'Patient'], ['Vitals', 'ECG', 'Chat']];

    it('renders the network, title and a centrality panel with measure toggles', () => {
        render(<TransitionMiniCard title="Gaze target transitions" sequences={seqs} />);
        expect(screen.getByText('Gaze target transitions')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Transition network' })).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Transition heatmap' })).toBeInTheDocument();
        expect(screen.getByText('TNA Network')).toBeInTheDocument();
        expect(screen.getByText('Transition Heatmap')).toBeInTheDocument();
        expect(screen.getByText('Centrality')).toBeInTheDocument();
        expect(screen.queryByText(/dynajs model/i)).not.toBeInTheDocument();
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
        const graph = within(container).getByRole('img', { name: 'Transition network' });
        // At least one node circle carries the custom fill.
        expect(graph.querySelector('circle[fill="#123456"]')).toBeTruthy();
    });
});
