// Regression lock: PatientRecordProvider's sync effect.
//
// CONTRACT: the record is synced once on mount, once per SYNC_INTERVAL, and
// once more on unmount IF something is unsynced. Recording clinical events is
// not itself a sync trigger.
//
// Pre-fix the effect was keyed on `record`, whose identity changes on every
// verb call, and it synced both on entry AND from its cleanup — so a single
// recorded action produced TWO network syncs (253 measured in one session).

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import React from 'react';

const { syncMock, loadMock } = vi.hoisted(() => ({
    syncMock: vi.fn(),
    loadMock: vi.fn(),
}));

vi.mock('./patientRecordSync', () => ({
    syncPatientRecord: (...args) => syncMock(...args),
    loadPatientRecord: (...args) => loadMock(...args),
}));

const { PatientRecordProvider, usePatientRecord } = await import('./PatientRecordContext.jsx');

// Stable identity — the init effect keys on patientInfo, so a fresh object
// literal per render would remount the record and confuse the count.
const PATIENT = { name: 'Test Patient', age: 54 };

function Recorder() {
    const { obtained, updateVitals } = usePatientRecord();
    return (
        <div>
            <button onClick={() => obtained('history', 'chest pain', 'patient')}>record</button>
            <button onClick={() => updateVitals({ hr: 88 })}>vitals</button>
        </div>
    );
}

const renderProvider = () => render(
    <PatientRecordProvider sessionId="s-1" caseId="c-1" patientInfo={PATIENT}>
        <Recorder />
    </PatientRecordProvider>,
);

beforeEach(() => {
    syncMock.mockReset();
    syncMock.mockResolvedValue({ success: true });
    loadMock.mockReset();
    loadMock.mockResolvedValue(null); // no existing record → create a new one
});
afterEach(cleanup);

describe('PatientRecordProvider sync', () => {
    it('syncs once on mount and not again for a burst of recorded events', async () => {
        renderProvider();
        await waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1));

        const button = screen.getByText('record');
        for (const _ of [1, 2, 3, 4, 5]) {
            act(() => { button.click(); });
        }
        act(() => { screen.getByText('vitals').click(); });

        // Give any stray effect re-run a chance to fire before asserting.
        await act(async () => { await Promise.resolve(); });
        // Pre-fix: 1 + 2 per change = 13.
        expect(syncMock).toHaveBeenCalledTimes(1);
    });

    it('flushes once on unmount when events were recorded since the last sync', async () => {
        const { unmount } = renderProvider();
        await waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1));

        act(() => { screen.getByText('record').click(); });
        unmount();

        await waitFor(() => expect(syncMock).toHaveBeenCalledTimes(2));
    });

    it('does not flush on unmount when nothing changed since the last sync', async () => {
        const { unmount } = renderProvider();
        await waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1));

        unmount();

        await act(async () => { await Promise.resolve(); });
        expect(syncMock).toHaveBeenCalledTimes(1);
    });

    it('keeps the record dirty when a sync fails, so the unmount flush still runs', async () => {
        syncMock.mockRejectedValueOnce(new Error('network down'));
        const { unmount } = renderProvider();
        await waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1));

        unmount();

        await waitFor(() => expect(syncMock).toHaveBeenCalledTimes(2));
    });
});

describe('PatientRecordProvider init', () => {
    // Regression lock: App builds `patientInfo` from the active case; before
    // the fix a fresh-but-equal object each parent render re-ran the init
    // effect, and each run was a GET /api/patient-record/:id that 404s until
    // the first sync — a measured ~180 requests/minute loop in a live session.
    it('a re-render with an equal-but-new patientInfo object does not reload the record', async () => {
        const { rerender } = render(
            <PatientRecordProvider sessionId="s-1" caseId="c-1" patientInfo={{ ...PATIENT }}>
                <Recorder />
            </PatientRecordProvider>,
        );
        await waitFor(() => expect(loadMock).toHaveBeenCalledTimes(1));

        rerender(
            <PatientRecordProvider sessionId="s-1" caseId="c-1" patientInfo={{ ...PATIENT }}>
                <Recorder />
            </PatientRecordProvider>,
        );
        rerender(
            <PatientRecordProvider sessionId="s-1" caseId="c-1" patientInfo={{ ...PATIENT }}>
                <Recorder />
            </PatientRecordProvider>,
        );
        // Give any wrongly re-armed effect a tick to fire before asserting.
        await act(() => Promise.resolve());
        expect(loadMock).toHaveBeenCalledTimes(1);
    });

    it('a new sessionId does reload', async () => {
        const { rerender } = render(
            <PatientRecordProvider sessionId="s-1" caseId="c-1" patientInfo={PATIENT}>
                <Recorder />
            </PatientRecordProvider>,
        );
        await waitFor(() => expect(loadMock).toHaveBeenCalledTimes(1));
        rerender(
            <PatientRecordProvider sessionId="s-2" caseId="c-1" patientInfo={PATIENT}>
                <Recorder />
            </PatientRecordProvider>,
        );
        await waitFor(() => expect(loadMock).toHaveBeenCalledTimes(2));
        expect(loadMock).toHaveBeenLastCalledWith('s-2');
    });
});
