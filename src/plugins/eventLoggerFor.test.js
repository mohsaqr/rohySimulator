// Regression lock: the ECG room re-logged OPENED_ECG_RECORDING on every render (~52/s) because its adapter built a new logger object per render (QA 2026-10-04, PRV-23)
//
// The vendored workstations memoise their logger on the prop's identity and
// key an "opened" effect on it, so an adapter that hands them a fresh
// `{ log }` each render re-fires that effect on every render — a loop that
// flooded learning_events and tripped the per-user limiter. PACS was fixed in
// beta.114; ECG and Pathology still built a new object. This locks all three:
// two renders with the same context must pass the SAME logger object.

import { describe, it, expect } from 'vitest';
import { eventLoggerFor } from './eventLoggerFor.js';
import ecg from './ecg/index.jsx';
import pathology from './pathology/index.jsx';
import pacs from './pacs/index.jsx';

const ctxFor = (log) => ({
    log,
    data: null,
    session: { id: 1, caseId: 1 },
    orders: [],
    patientCase: null,
});

const loggerProp = (props) => props.event_logger ?? props.eventLogger;

describe('eventLoggerFor', () => {
    it('returns the same wrapper for the same host logger', () => {
        const log = () => {};
        expect(eventLoggerFor(log)).toBe(eventLoggerFor(log));
        expect(eventLoggerFor(log).log).toBe(log);
    });

    it('returns a different wrapper for a different host logger', () => {
        expect(eventLoggerFor(() => {})).not.toBe(eventLoggerFor(() => {}));
    });

    it.each([
        ['ecg', ecg],
        ['pathology', pathology],
        ['pacs', pacs],
    ])('%s adapter passes a logger whose identity survives a re-render', (_name, plugin) => {
        const log = () => {};
        const ctx = ctxFor(log);
        const persist = { state: {}, save: () => {} };
        const first = loggerProp(plugin.props(ctx, persist));
        const second = loggerProp(plugin.props({ ...ctx }, persist));
        expect(first).toBeTruthy();
        expect(second).toBe(first);
    });
});
