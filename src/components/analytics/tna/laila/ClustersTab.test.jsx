// Regression lock: the Clusters tab must fail honestly.
//
// CONTRACT: a throw anywhere in the clustering computation renders an error,
// never the spinner. Pre-fix the catch set `result` back to null — the very
// same value that means "still computing" — so any exception (a dissimilarity
// dynajs refuses, a degenerate k, a bad label set) left "Computing clusters…"
// turning forever with nothing in the console and no way to tell.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import React from 'react';

const { clusterDataMock } = vi.hoisted(() => ({ clusterDataMock: vi.fn() }));

vi.mock('dynajs', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, clusterData: (...args) => clusterDataMock(...args) };
});

const { ClustersTab } = await import('./ClustersTab.jsx');
const { clusterData: realClusterData } = await vi.importActual('dynajs');

const props = {
    sequences: [['a', 'b', 'a'], ['b', 'a', 'b']],
    labels: ['a', 'b'],
    k: 2,
    onKChange: () => {},
};

beforeEach(() => {
    clusterDataMock.mockReset();
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
    cleanup();
});

// The computation runs behind a 50 ms setTimeout so the spinner can paint.
const settle = async () => { await act(async () => { vi.advanceTimersByTime(100); }); };

describe('ClustersTab failure handling', () => {
    it('renders the error, not an eternal spinner, when clustering throws', async () => {
        clusterDataMock.mockImplementation(() => { throw new Error('unsupported dissimilarity'); });

        render(<ClustersTab {...props} />);
        expect(screen.getByText('Computing clusters')).toBeTruthy();

        await settle();

        expect(screen.getByText('Clusters error')).toBeTruthy();
        expect(screen.getByText('unsupported dissimilarity')).toBeTruthy();
        expect(screen.queryByText('Computing clusters')).toBeNull();
    });

    it('clears the error when a later computation succeeds', async () => {
        clusterDataMock.mockImplementationOnce(() => { throw new Error('transient'); });
        const { rerender } = render(<ClustersTab {...props} />);
        await settle();
        expect(screen.getByText('Clusters error')).toBeTruthy();

        clusterDataMock.mockImplementation(() => ({
            assignments: [1, 2],
            sizes: [1, 1],
            silhouette: 0.6,
        }));
        rerender(<ClustersTab {...props} k={3} />);
        await settle();

        expect(screen.queryByText('Clusters error')).toBeNull();
        expect(screen.getByText('Clusters found')).toBeTruthy();
    });
});


describe('ClustersTab available sequence count', () => {
    it.each([{ sequences: [] }, { sequences: [['a', 'b', 'a']] }])('shows a minimum-data message for $sequences', async ({ sequences }) => {
        render(<ClustersTab {...props} sequences={sequences} k={3} />);
        await settle();
        expect(screen.getByText('At least two sequences are needed for clustering.')).toBeTruthy();
        expect(screen.queryByText('Computing clusters')).toBeNull();
        expect(screen.queryByText('Clusters error')).toBeNull();
        expect(clusterDataMock).not.toHaveBeenCalled();
    });

    it.each([2, 3, 8])('clusters two real sequences with requested k=%s and keeps the count control valid', async (requestedK) => {
        clusterDataMock.mockImplementation(realClusterData);
        render(<ClustersTab {...props} k={requestedK} />);
        await settle();
        expect(clusterDataMock).toHaveBeenCalledWith(props.sequences, 2, expect.any(Object));
        expect(screen.getByText('Clusters found')).toBeTruthy();
        expect(screen.queryByText('Clusters error')).toBeNull();
        const count = screen.getByRole('spinbutton');
        expect(count.value).toBe('2');
        expect(count.max).toBe('2');
    });

    it('recovers when a narrow filter gains enough sequences', async () => {
        clusterDataMock.mockImplementation(realClusterData);
        const { rerender } = render(<ClustersTab {...props} sequences={props.sequences.slice(0, 1)} k={3} />);
        await settle();
        expect(screen.getByText('At least two sequences are needed for clustering.')).toBeTruthy();
        rerender(<ClustersTab {...props} k={3} />);
        await settle();
        expect(screen.queryByText('At least two sequences are needed for clustering.')).toBeNull();
        expect(screen.getByText('Clusters found')).toBeTruthy();
        expect(screen.getByRole('spinbutton').value).toBe('2');
    });
});
