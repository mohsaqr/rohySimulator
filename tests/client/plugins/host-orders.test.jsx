/**
 * Regression lock: the 'orders' capability — the host's narrowed view of what
 * the learner ordered this session.
 *
 * This is the seam the PACS room was missing (v2.9.128: "pacs is nowhere
 * accessible, you don't see its results in the case"). The rule the standard
 * asks of every capability applies here too: the host builds a NARROWED
 * ADAPTER, so a vendored package never learns a rohy endpoint and never
 * receives a column it has no business reading — `result_data` on a radiology
 * order carries the case author's configured findings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../../src/services/apiClient', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../../../src/services/apiClient';
import { useHostOrders, ordersAreWanted } from '../../../src/plugins/hostOrders.js';
import { registry } from '../../../src/plugins/index.js';

/** One row exactly as GET /sessions/:id/radiology-orders returns it. */
const ROW = {
    id: 42,
    study_id: 900,
    ordered_at: '2026-08-30T10:00:00Z',
    available_at: '2026-08-30T10:05:00Z',
    viewed_at: null,
    test_name: 'Chest X-Ray (PA/Lateral)',
    modality: 'X-Ray',
    image_url: 'https://example.test/spoiler.png',
    result_data: '{"findings":"Dense right lower lobe consolidation"}',
    turnaround_minutes: 5,
    is_ready: 1,
    minutes_remaining: 0,
};

describe('useHostOrders', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => { vi.useRealTimers(); });

    it('narrows the order row: no report text, no image url, no viewed flag', async () => {
        apiFetch.mockResolvedValue({ orders: [ROW] });
        const { result } = renderHook(() => useHostOrders('s1'));

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(apiFetch).toHaveBeenCalledWith('/sessions/s1/radiology-orders');
        expect(result.current.imaging).toEqual([{
            id: 42,
            studyName: 'Chest X-Ray (PA/Lateral)',
            modality: 'X-Ray',
            orderedAt: '2026-08-30T10:00:00Z',
            availableAt: '2026-08-30T10:05:00Z',
            ready: true,
            minutesRemaining: 0,
        }]);
        const serialised = JSON.stringify(result.current);
        expect(serialised).not.toContain('consolidation');
        expect(serialised).not.toContain('spoiler.png');
    });

    it('makes no request without a session', () => {
        renderHook(() => useHostOrders(null));
        expect(apiFetch).not.toHaveBeenCalled();
    });

    it('a failed fetch is empty, never a throw — availability runs through this', async () => {
        apiFetch.mockRejectedValue(new Error('offline'));
        const { result } = renderHook(() => useHostOrders('s1'));
        await waitFor(() => expect(apiFetch).toHaveBeenCalled());
        expect(result.current.imaging).toEqual([]);
        expect(result.current.loaded).toBe(false);
    });

    it('orders belong to the session they were fetched for', async () => {
        apiFetch.mockResolvedValue({ orders: [ROW] });
        const { result, rerender } = renderHook(({ id }) => useHostOrders(id), {
            initialProps: { id: 's1' },
        });
        await waitFor(() => expect(result.current.imaging).toHaveLength(1));

        // A new session must not inherit the previous one's worklist for the
        // poll interval it takes the first fetch to land — a plugin room would
        // otherwise be available on the strength of a study ordered in a
        // session the learner has left.
        apiFetch.mockImplementation(() => new Promise(() => {}));
        rerender({ id: 's2' });
        expect(result.current.imaging).toEqual([]);
        expect(result.current.loaded).toBe(false);
    });

    it('an unchanged poll does not churn identity', async () => {
        apiFetch.mockResolvedValue({ orders: [ROW] });
        const { result } = renderHook(() => useHostOrders('s1'));
        await waitFor(() => expect(result.current.loaded).toBe(true));
        const first = result.current;

        await vi.advanceTimersByTimeAsync(16000);
        await waitFor(() => expect(apiFetch.mock.calls.length).toBeGreaterThan(1));
        // Identity is a dependency of the plugin context and of every worklist
        // built from it; a fresh array every fifteen seconds would re-render a
        // room in which nothing changed.
        expect(result.current).toBe(first);
    });
});

describe('ordersAreWanted', () => {
    it('is true only because an INSTALLED plugin asks — deleting it stops the fetch', () => {
        expect(ordersAreWanted()).toBe(true);
        expect(registry.get('pacs').manifest.capabilities).toContain('orders');

        // Peaceful exclusion covers the host's fetches too: with no plugin
        // requesting orders, no request is made at all.
        const all = vi.spyOn(registry, 'all').mockReturnValue([
            { manifest: { id: 'pathology', capabilities: ['persist', 'remote'] } },
        ]);
        expect(ordersAreWanted()).toBe(false);
        all.mockRestore();
    });
});
