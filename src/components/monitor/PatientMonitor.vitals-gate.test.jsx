// PatientMonitor — phantom-vitals regression locks (UI test review 2.9.108).
//
// Kept separate from PatientMonitor.test.jsx (which owns the Stage-1/5 audit
// contract) because these lock a single defect with its own fixtures:
//
//   #8  Phantom "healthy patient" rows. The monitor mounts holding
//       FACTORY_DEFAULTS (HR 80 / SpO2 98 / 120/80 / 37.0 / EtCO2 38) and
//       only learns the patient's real vitals when the case-load effect
//       runs. The persist effect used to fire on mount, before that — and
//       because the component remounts on every room switch, a 24 s STEMI
//       session ended up with 4 fabricated rows out of 9. The restore path
//       could then adopt a phantom as the session baseline, and nothing
//       downstream ever repaired temp/EtCO2 (the scenario engine
//       interpolates only hr/spo2/rr/bpSys/bpDia).
//
//   #24 The NIBP box printed a hardcoded "14:02" as if it were a clock.
//
// Source under test: ./PatientMonitor.jsx (do NOT modify from here).

import React from 'react';
import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

vi.setConfig({ testTimeout: 10000, hookTimeout: 10000 });

// --- Stubs that MUST run before importing PatientMonitor ------------------
if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
}
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
if (typeof window !== 'undefined') {
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = () => {};
}

vi.mock('../investigations/LabValueEditor', () => ({ default: () => null }));

vi.mock('../../services/eventLogger', () => {
    const stub = () => {};
    return {
        default: new Proxy({}, { get: () => stub }),
        COMPONENTS: new Proxy({}, { get: (_t, p) => String(p) }),
    };
});

// Stable references — a fresh `{}` per call re-fires PatientMonitor's
// `[params, treatmentEffects.aggregate]` effect forever (see finding #19).
const STABLE_TREATMENT_EFFECTS = Object.freeze({
    effects: Object.freeze([]),
    aggregate: Object.freeze({}),
    count: 0,
    loading: false,
    error: null,
    refresh: () => {},
});
const STABLE_ALARMS = Object.freeze({
    activeAlarms: Object.freeze([]),
    thresholds: Object.freeze({}),
    setThresholds: () => {},
    acknowledgeAlarm: () => {},
    acknowledgeAll: () => {},
    snoozeAlarm: () => {},
    muted: false,
    toggleMute: () => {},
});
vi.mock('../../hooks/useTreatmentEffects', () => ({
    useTreatmentEffects: () => STABLE_TREATMENT_EFFECTS,
}));
vi.mock('../../hooks/useAlarms', () => ({
    useAlarms: () => STABLE_ALARMS,
}));

import PatientMonitor from './PatientMonitor.jsx';
import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';

// The factory baseline the monitor mounts with — the exact shape of a
// phantom row.
const FACTORY_ROW = {
    hr: 80, spo2: 98, rr: 16, bp_sys: 120, bp_dia: 80, temp: 37.0, etco2: 38,
    rhythm: 'NSR',
};

const state = {
    vitalsStore: { vitals: [] },
    posted: [],
};

function defaultHandlers() {
    return [
        http.get('*/api/platform-settings/monitor', () =>
            HttpResponse.json({
                showTimer: true, showECG: true, showSpO2: true, showBP: true,
                showRR: true, showTemp: true, showCO2: true,
            })
        ),
        http.get('*/api/sessions/:sessionId', () =>
            HttpResponse.json({ session: { case_snapshot: null } })
        ),
        http.get('*/api/sessions/:sessionId/vitals', () =>
            HttpResponse.json(state.vitalsStore)
        ),
        http.post('*/api/sessions/:sessionId/vitals', async ({ request }) => {
            state.posted.push(await request.json());
            return HttpResponse.json({ ok: true });
        }),
        http.get('*/api/*', () => HttpResponse.json({})),
        http.post('*/api/*', () => HttpResponse.json({})),
    ];
}

const server = setupServer(...defaultHandlers());
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
    server.resetHandlers(...defaultHandlers());
    state.vitalsStore = { vitals: [] };
    state.posted = [];
    vi.clearAllTimers();
    vi.useRealTimers();
});
afterAll(() => server.close());

beforeEach(() => {
    // A leftover monitor snapshot in localStorage is the OTHER thing the
    // component mounts with; clear it so `params` starts at FACTORY_DEFAULTS
    // and the phantom under test is unambiguous.
    window.localStorage.removeItem('rohy_monitor_settings');
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    if (typeof HTMLCanvasElement !== 'undefined') {
        HTMLCanvasElement.prototype.getContext = function getContext() {
            return {
                clearRect: () => {}, beginPath: () => {}, moveTo: () => {},
                lineTo: () => {}, stroke: () => {}, fillRect: () => {},
                fillText: () => {}, setLineDash: () => {},
                strokeStyle: '', fillStyle: '', lineWidth: 0,
                font: '', textAlign: '', lineJoin: '',
            };
        };
    }
});

// A case whose vitals differ from FACTORY_DEFAULTS on every channel, so a
// persisted row can be attributed to exactly one of the two sources.
const sickCase = {
    id: 501,
    name: 'Inferior STEMI',
    config: {
        initialVitals: {
            hr: 118, spo2: 91, rr: 26, bpSys: 88, bpDia: 54, temp: 36.2, etco2: 31,
            rhythm: 'NSR',
            conditions: { pvc: false, stElev: 3, tInv: false, wideQRS: false, noise: 0 },
        },
    },
};

function mount(props = {}) {
    return renderWithProviders(
        <PatientMonitor
            caseParams={null}
            caseData={sickCase}
            sessionId={null}
            isAdmin={true}
            {...props}
        />,
        { withPatientRecord: false }
    );
}

const isFactoryRow = (body) =>
    body.hr === FACTORY_ROW.hr
    && body.spo2 === FACTORY_ROW.spo2
    && body.rr === FACTORY_ROW.rr
    && body.bp_sys === FACTORY_ROW.bp_sys
    && body.bp_dia === FACTORY_ROW.bp_dia;

describe('PatientMonitor — #8 vitals persist gate', () => {
    // Regression lock: nothing may be written to /sessions/:id/vitals until
    // the case snapshot has actually been applied. Against the un-fixed
    // component the very first POST carries HR 80 / SpO2 98 — the factory
    // defaults — because `lastPersistedVitalsRef.current === null` forces
    // the mount render to persist whatever `params` happens to hold.
    it('never persists the factory-default row, and the first row is the case baseline', async () => {
        mount({ sessionId: 3131 });

        await waitFor(() => expect(state.posted.length).toBeGreaterThanOrEqual(1));

        expect(state.posted.some(isFactoryRow)).toBe(false);
        expect(state.posted[0].hr).toBe(118);
        expect(state.posted[0].spo2).toBe(91);
        // temp / EtCO2 are the two channels the scenario engine never
        // repairs, so a phantom there would follow the whole session.
        expect(state.posted[0].temp).toBeCloseTo(36.2, 5);
        expect(state.posted[0].etco2).toBe(31);
    });

    // Regression lock: the gate must not become a mute button — the real
    // baseline row still has to be written.
    it('still writes exactly one baseline row for a fresh session', async () => {
        mount({ sessionId: 3132 });
        await waitFor(() => expect(state.posted.length).toBe(1));
    });
});

describe('PatientMonitor — #8 restore refuses phantom rows', () => {
    // Regression lock: sessions recorded before the gate landed still carry
    // phantom rows. Adopting the newest one re-infects the session. Against
    // the un-fixed component the monitor renders the phantom's HR 80.
    it('restores the newest REAL row when a phantom row is the most recent', async () => {
        state.vitalsStore = {
            vitals: [
                { hr: 111, spo2: 93, bp_sys: 145, bp_dia: 95, rr: 28, temp: 38.4, etco2: 44, rhythm: 'NSR' },
                { ...FACTORY_ROW },
            ],
        };
        const { container } = mount({ sessionId: 3133 });

        await waitFor(() => {
            expect(container.textContent).toContain('111');
            expect(container.textContent).toContain('93');
        }, { timeout: 3000 });
    });

    // Companion invariant (NOT a regression lock — it also passes against
    // the un-fixed component, where the case-load effect happens to land
    // after the restore): when EVERY persisted row is a phantom there is
    // nothing to restore, so the case baseline must stand.
    it('restores nothing when every persisted row is a phantom', async () => {
        state.vitalsStore = { vitals: [{ ...FACTORY_ROW }, { ...FACTORY_ROW }] };
        const { container } = mount({ sessionId: 3134 });

        await waitFor(() => expect(container.textContent).toContain('118'));
        // 91 is the case's SpO2; 98 would be the phantom's.
        expect(container.textContent).toContain('91');
    });
});

describe('PatientMonitor — #24 no fake NIBP clock', () => {
    // Regression lock: the NIBP box printed a literal "14:02" that never
    // moved and belonged to no clock in the system.
    it('source carries no hardcoded 14:02 timestamp', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const src = fs.readFileSync(path.resolve(__dirname, 'PatientMonitor.jsx'), 'utf8');
        expect(src).not.toContain('14:02');
    });

    it('does not render 14:02 anywhere on the panel', async () => {
        const { container } = mount({ sessionId: null });
        await waitFor(() => expect(container.textContent).toContain('118'));
        expect(container.textContent).not.toContain('14:02');
    });
});
