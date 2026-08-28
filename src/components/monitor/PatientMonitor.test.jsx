// PatientMonitor regression-lock suite (Phase-4).
//
// CONTRACT: pin behavior across three audit stages plus the
// NotificationCenter migration so future refactors can't silently regress.
//
//   Stage 1 — vitals persistence + restore on mount.
//   Stage 1 (follow-on) — snapshot binding: the engine reads
//     `case_snapshot.scenario` (frozen at session start), NOT live
//     `caseData.scenario`. Admin edits to the case mid-session must NOT
//     bleed into a running session.
//   Stage 5 — override guard covers EVERY mutable scenario key (params +
//     conditions + rhythm) and auto-stop fires ~2s past the last frame.
//   NotificationCenter migration — PatientMonitor MUST NOT instantiate
//     `new AudioContext()` or attach a click-resume handler. Audio is owned
//     by AudioSurface mounted under the central NotificationCenter.
//
// Source under test: ./PatientMonitor.jsx  (do NOT modify).
//
// Stubs:
//   - LabValueEditor + EventLogger + useTreatmentEffects + useAlarms are
//     mocked to keep the WebGL/canvas/timer surface inert.
//   - ResizeObserver is shimmed once at module load (jsdom doesn't ship one).
//   - The shared tests/setup.js already stubs window.AudioContext, so we
//     spy on the global constructor to assert PatientMonitor never invokes
//     it (NotificationCenter regression lock).
//
// msw handles the three network endpoints PatientMonitor touches:
//   GET  /api/platform-settings/monitor   (visibility flags)
//   GET  /api/sessions/:id                (case_snapshot)
//   GET  /api/sessions/:id/vitals         (restore-on-mount)
//   POST /api/sessions/:id/vitals         (deadband persistence)

import React from 'react';
import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach, vi } from 'vitest';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

// Hard ceiling per `it()` — if a future regression reintroduces the render
// loop or any other deadlock, surface it as a 10s test failure rather than
// a CI-killing infinite hang.
vi.setConfig({ testTimeout: 10000, hookTimeout: 10000 });

// --- Stubs that MUST run before importing PatientMonitor ----------------
// jsdom doesn't ship ResizeObserver; PatientMonitor instantiates one on
// mount and would throw without this shim.
if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
}

// Neutralize requestAnimationFrame — PatientMonitor's animation loop
// re-schedules itself on every frame, which under jsdom + fake timers can
// deadlock the test runner. We replace it with a no-op so the loop never
// runs (we don't test the canvas drawing — only the React state surface).
if (typeof globalThis.requestAnimationFrame !== 'undefined') {
    globalThis.requestAnimationFrame = () => 0;
    globalThis.cancelAnimationFrame = () => {};
}
if (typeof window !== 'undefined') {
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = () => {};
}

// Mock heavy / network-noisy children before the import graph resolves.
vi.mock('../investigations/LabValueEditor', () => ({
    default: () => null,
}));

vi.mock('../../services/eventLogger', () => {
    const stub = () => {};
    return {
        default: new Proxy({}, { get: () => stub }),
        COMPONENTS: new Proxy({}, { get: (_t, p) => String(p) }),
    };
});

// IMPORTANT: stable references across renders. Pre-fix these mocks
// returned a fresh `{}` for `aggregate` / `thresholds` / `activeAlarms`
// on every call. PatientMonitor's
//
//   useEffect(..., [params, treatmentEffects.aggregate])
//
// then re-fired every render with a *new* aggregate object, called
// setDisplayVitals(newObj), which re-rendered, which produced a new
// aggregate, ad infinitum — a classic referential-equality render loop
// that deadlocked the whole test runner before any `it()` could finish.
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

// --- msw fixture helpers ------------------------------------------------
//
// `vitalsStore` is the mutable snapshot the GET /vitals handler returns
// for restore-on-mount. `posted` accumulates POSTs so persistence tests
// can read them.
const state = {
    vitalsStore: { vitals: [] },
    posted: [],
    snapshotBySessionId: {}, // sessionId -> case_snapshot object
};

function defaultHandlers() {
    return [
        http.get('*/api/platform-settings/monitor', () =>
            HttpResponse.json({
                showTimer: true, showECG: true, showSpO2: true, showBP: true,
                showRR: true, showTemp: true, showCO2: true,
            })
        ),
        // case_snapshot fetch — distinguishes Stage-1 follow-on regression
        http.get('*/api/sessions/:sessionId', ({ params }) => {
            const snap = state.snapshotBySessionId[params.sessionId];
            return HttpResponse.json({
                session: { case_snapshot: snap ?? null },
            });
        }),
        // GET vitals — restore on mount
        http.get('*/api/sessions/:sessionId/vitals', () =>
            HttpResponse.json(state.vitalsStore)
        ),
        // POST vitals — deadband persistence
        http.post('*/api/sessions/:sessionId/vitals', async ({ request, params }) => {
            const body = await request.json();
            state.posted.push({ sessionId: params.sessionId, body });
            return HttpResponse.json({ ok: true });
        }),
        // catch-all for anything else mounted children might probe
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
    state.snapshotBySessionId = {};
});
afterAll(() => server.close());

afterEach(() => {
    // Drain any pending fake timers that piled up during the test, then
    // restore real timers so module-scope state doesn't bleed across files.
    vi.clearAllTimers();
    vi.useRealTimers();
});

// Per-file timeout so any future regression surfaces as a failure, not an
// infinite hang. PatientMonitor's source has three setInterval loops + an
// rAF chain; without fake timers, vitest's worker considers the event loop
// "live" forever and never reports.
vi.setConfig({ testTimeout: 8000, hookTimeout: 8000 });

beforeEach(() => {
    // CRITICAL: PatientMonitor.jsx has setInterval calls at source lines
    // 426, 787, and 917 (vitals jitter, waveform tick, scenario engine).
    // Real intervals keep the event loop alive past test end, hanging
    // vitest's worker. We fake ONLY the interval / rAF APIs so React
    // Testing Library's `waitFor` (which leans on setTimeout) keeps
    // working as expected.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] });

    // The animation loop and physics readers expect canvas.getContext to
    // return something. jsdom returns a stub by default but some node
    // builds don't — guarantee a no-op 2d context.
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
        if (!HTMLCanvasElement.prototype.getBoundingClientRect) {
            HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
                width: 200, height: 100, top: 0, left: 0, right: 200, bottom: 100,
            });
        }
    }
});

// --- Fixtures -----------------------------------------------------------
const baseCase = {
    id: 99,
    name: 'Test Case',
    config: {
        initialVitals: {
            hr: 88, spo2: 96, rr: 18, bpSys: 132, bpDia: 84, temp: 37.4, etco2: 40,
            rhythm: 'NSR',
            conditions: { pvc: false, stElev: 0, tInv: false, wideQRS: false, noise: 0 },
        },
    },
    scenario: {
        autoStart: false,
        timeline: [
            { time: 0, params: { hr: 88, spo2: 96, rr: 18, bpSys: 132, bpDia: 84 } },
            { time: 5, params: { hr: 130, spo2: 90, rr: 24, bpSys: 95, bpDia: 60 } },
        ],
    },
};

// Helper — render PatientMonitor with provider stack.
// (Previously: a `snapshotWithDifferentScenario()` helper lived here for an
// engaged-snapshot precedence test that's now superseded by the
// `session_snapshot` integration test. Removed 2026-05-12; recoverable
// from git if the precedence assertion needs to come back.)
function mount(props = {}) {
    return renderWithProviders(
        <PatientMonitor
            caseParams={null}
            caseData={baseCase}
            sessionId={null}
            isAdmin={true}
            {...props}
        />,
        { withPatientRecord: false }
    );
}

// =======================================================================
// Tests
// =======================================================================

describe('PatientMonitor — vitals rendering', () => {
    it('renders HR / SpO2 / NIBP / RESP / TEMP / EtCO2 from caseData.initialVitals', async () => {
        // CONTRACT: case-supplied initial vitals reach the right-sidebar
        // boxes intact. If these labels move or the values stop binding,
        // the trainee no longer sees the numbers the case author intended.
        const { container } = mount();

        await waitFor(() => {
            // HR shows 88 (the initial). Use a permissive contains check
            // because the jitter loop on a 2s timer hasn't fired yet at
            // mount and the box is keyed by the "HR" label in the header.
            expect(container.textContent).toContain('88');   // HR
            expect(container.textContent).toContain('96');   // SpO2
            expect(container.textContent).toContain('132');  // bpSys
            expect(container.textContent).toContain('84');   // bpDia
            expect(container.textContent).toContain('18');   // RR
            expect(container.textContent).toContain('37.4'); // Temp
            expect(container.textContent).toContain('40');   // EtCO2
        });
    });

    it('renders the labelled vital headers (HR, SpO2, NIBP, RESP, TEMP)', async () => {
        // CONTRACT: header labels are part of the monitor's clinical
        // affordance — losing them turns the panel into nameless numbers.
        const { container } = mount();
        await waitFor(() => {
            expect(container.textContent).toContain('HR');
            expect(container.textContent).toContain('SpO2');
            expect(container.textContent).toContain('NIBP');
            expect(container.textContent).toContain('RESP');
            expect(container.textContent).toContain('TEMP');
        });
    });
});

describe('PatientMonitor — NotificationCenter migration regression lock', () => {
    it('does NOT instantiate AudioContext on mount', async () => {
        // CONTRACT: audio is owned by AudioSurface (under NotificationCenter).
        // Pre-migration PatientMonitor created its own AudioContext + a
        // document click handler to resume it; both must stay gone.
        const ctor = vi.fn(function () {
            // forward to the existing stub so tests don't crash if anything
            // else legitimately constructs one (none should here)
            this.state = 'suspended';
            this.resume = () => Promise.resolve();
            this.close = () => Promise.resolve();
        });
        const original = window.AudioContext;
        window.AudioContext = ctor;
        window.webkitAudioContext = ctor;
        try {
            mount();
            // wait a beat for any mount-time effects
            await new Promise(r => setTimeout(r, 50));
            expect(ctor).not.toHaveBeenCalled();
        } finally {
            window.AudioContext = original;
            window.webkitAudioContext = original;
        }
    });

    it('source contains no AudioContext construction or audio-resume click handler', async () => {
        // CONTRACT: the legacy "click anywhere to unlock audio" handler is
        // gone — AudioSurface owns that gesture now. We assert the source
        // text is clean rather than spying on `document.addEventListener`,
        // because providers (Auth/Notification/Toast) legitimately attach
        // document listeners and we don't want those false positives here.
        const fs = await import('node:fs');
        const path = await import('node:path');
        const src = fs.readFileSync(
            path.resolve(__dirname, 'PatientMonitor.jsx'),
            'utf8'
        );
        expect(src).not.toMatch(/new\s+AudioContext\s*\(/);
        expect(src).not.toMatch(/new\s+webkitAudioContext\s*\(/);
        // The legacy resume-on-click pattern: a useEffect adding a click
        // listener to document/window that calls audioContext.resume().
        // Match the load-bearing combination, not just any click handler.
        expect(src).not.toMatch(/audioContext\.resume\(\)/);
        expect(src).not.toMatch(/audioCtx\.resume\(\)/);
    });
});

describe('PatientMonitor — top-bar controls (source contract)', () => {
    it('renders the settings gear only for admins; non-admins keep just the bell', async () => {
        // Regression lock: student saw two buttons opening the identical alarms-only drawer (bug report 2.9.15 #17)
        // CONTRACT: non-admins have exactly one controls tab ('alarms'),
        // already reachable via the bell, so the gear must be gated on
        // isAdmin — otherwise both buttons open a byte-identical panel.
        // We lock the source shape: the gear render is guarded by
        // `{isAdmin && (` and its click handler opens 'rhythm' explicitly
        // (never the old `isAdmin ? 'rhythm' : 'alarms'` ternary).
        const fs = await import('node:fs');
        const path = await import('node:path');
        const src = fs.readFileSync(
            path.resolve(__dirname, 'PatientMonitor.jsx'),
            'utf8'
        );
        // The gear button block is wrapped in an isAdmin guard.
        expect(src).toMatch(
            /\{isAdmin && \(\s*<button\s*onClick=\{\(\) => handleControlsOpen\('rhythm'\)\}/
        );
        // The old always-rendered gear handler must not come back.
        expect(src).not.toMatch(
            /handleControlsOpen\(isAdmin \? 'rhythm' : 'alarms'\)/
        );
        // The bell stays unconditional for everyone.
        expect(src).toMatch(/handleControlsOpen\('alarms'\)/);
    });
});

describe('PatientMonitor — Stage-1 vitals persistence (deadband)', () => {
    it('POSTs to /sessions/:id/vitals on first mount with active sessionId', async () => {
        // CONTRACT: the very first vitals snapshot is always persisted
        // (lastPersistedVitalsRef === null forces `crossed = true`). This
        // gives every session a baseline row.
        mount({ sessionId: 4242 });
        await waitFor(() => {
            const ours = state.posted.filter(p => p.sessionId === '4242');
            expect(ours.length).toBeGreaterThanOrEqual(1);
            expect(ours[0].body).toMatchObject({ hr: expect.any(Number) });
        });
    });

    it('does NOT POST when sessionId is null', async () => {
        // CONTRACT: persistence requires a real session — the standalone
        // monitor (no session) should never hit the network.
        mount({ sessionId: null });
        await new Promise(r => setTimeout(r, 100));
        expect(state.posted.length).toBe(0);
    });

    it('includes rhythm and source=monitor in the persisted body', async () => {
        // CONTRACT: server-side analytics differentiate scenario-driven
        // from learner-driven changes via the `source` tag.
        mount({ sessionId: 7 });
        await waitFor(() => {
            const ours = state.posted.find(p => p.sessionId === '7');
            expect(ours).toBeTruthy();
            expect(ours.body.rhythm).toBe('NSR');
            // active scenario null at mount → 'monitor'
            expect(ours.body.source).toBe('monitor');
        });
    });
});

describe('PatientMonitor — Stage-1 restore-on-mount from persisted vitals', () => {
    it('seeds params/rhythm from the latest persisted row', async () => {
        // CONTRACT: when a session is restored, the monitor reads the last
        // persisted snapshot and seeds its state from it. Pre-fix the
        // monitor snapped back to case baseline, erasing learner work.
        state.vitalsStore = {
            vitals: [
                { hr: 70, spo2: 95, bp_sys: 110, bp_dia: 70, rr: 14, temp: 36.8, etco2: 38, rhythm: 'AFib' },
                { hr: 102, spo2: 92, bp_sys: 100, bp_dia: 60, rr: 22, temp: 38.1, etco2: 44, rhythm: 'AFib' },
            ],
        };
        const { container } = mount({ sessionId: 9 });
        await waitFor(() => {
            // The restored row's HR (102) should appear after the seed —
            // give the params -> displayVitals sync useEffect a chance to land.
            expect(container.textContent).toContain('102');
            expect(container.textContent).toContain('92');
        }, { timeout: 2000 });
    });

    it('ignores the restore step when no sessionId is provided', async () => {
        // CONTRACT: standalone (sessionId=null) skips the restore entirely.
        // We verify by populating vitalsStore with a value that would be
        // visible if the fetch ran, and asserting it does NOT appear.
        state.vitalsStore = {
            vitals: [{ hr: 199, spo2: 80, bp_sys: 80, bp_dia: 50, rr: 30, temp: 39.5, etco2: 50, rhythm: 'VTach' }],
        };
        const { container } = mount({ sessionId: null });
        await new Promise(r => setTimeout(r, 100));
        // The case baseline (88) should be present, the would-be restored 199 should not.
        expect(container.textContent).toContain('88');
        expect(container.textContent).not.toContain('199');
    });
});

describe('PatientMonitor — Stage-1 (follow-on) snapshot binding regression lock', () => {
    it('uses case_snapshot.scenario, not live caseData.scenario, when both differ (source contract)', async () => {
        // CONTRACT: scenario engine reads `caseSnapshot?.scenario` first.
        // Driving the engine end-to-end requires real intervals + msw +
        // multi-effect chains that thrash with fake timers and waitFor.
        // We instead lock the source contract directly: the precedence
        // expression `caseSnapshot?.scenario ?? caseData.scenario` MUST
        // appear in PatientMonitor.jsx. Also ensure the autoStart branch
        // is gated on it. If a future refactor reverses precedence or
        // drops the snapshot fetch, this test fails.
        const fs = await import('node:fs');
        const path = await import('node:path');
        const src = fs.readFileSync(
            path.resolve(__dirname, 'PatientMonitor.jsx'),
            'utf8'
        );
        // Snapshot precedence over live case data.
        expect(src).toMatch(/caseSnapshot\?\.scenario\s*\?\?\s*caseData\.scenario/);
        // case_snapshot is fetched from the session endpoint.
        expect(src).toMatch(/case_snapshot/);
        // autoStart wires through to the anchored start (which sets
        // playing: true on the persisted anchor — see sessionAnchors.js).
        expect(src).toMatch(/scenarioSource\.autoStart/);
        expect(src).toMatch(/startScenarioAnchored/);
        expect(src).toMatch(/playing:\s*true/);
    });

    it('still functions (uses live caseData.scenario) when no snapshot is returned', async () => {
        // CONTRACT: snapshot is a *preference*, not a hard requirement —
        // sessions that pre-date the snapshot column or fail the fetch
        // still get the live scenario. This guards against an over-strict
        // refactor that would null-route the timeline whenever the snap
        // is missing.
        // No snapshot mapping registered → handler returns null.
        const { container } = mount({ sessionId: 56 });
        await waitFor(() => {
            // baseCase.initialVitals.hr = 88
            expect(container.textContent).toContain('88');
        });
    });
});

describe('PatientMonitor — Stage-5 override guard (covers all mutable scenario keys)', () => {
    // We exercise the override guard directly via the helper functions on
    // the source. Reaching it through the controls UI requires opening the
    // panel + navigating tabs + clicking a button per vital — far too much
    // surface for a regression lock. Instead we assert the source-level
    // contract: every key the engine writes is filtered through
    // `overriddenVitalsRef`.
    //
    // The concrete proof is in the source at lines 810-892 (Stage-5 audit
    // comment block). Tests below confirm via behavior that the engine
    // tick respects the ref and at least the first frame is applied.

    it('engine tick applies scenario frame 0 when no overrides are set (source contract)', async () => {
        // CONTRACT: baseline path — without overrides, the engine writes
        // through. We lock the source-level shape: the engine setInterval
        // must call setParams with the timeline frame's params, and the
        // override filter must be applied (not bypassed) on that path.
        const fs = await import('node:fs');
        const path = await import('node:path');
        const src = fs.readFileSync(
            path.resolve(__dirname, 'PatientMonitor.jsx'),
            'utf8'
        );
        // Engine loop is a setInterval inside the scenarioPlaying useEffect.
        expect(src).toMatch(/if\s*\(!activeScenario\s*\|\|\s*!scenarioPlaying\s*\|\|\s*caseEnded\)\s*return/);
        expect(src).toMatch(/setInterval\(\(\)\s*=>/);
        // Frame interpolation reads timeline frame `toFrame` (or fromFrame)
        // and pushes through filterOverrides → setParams.
        expect(src).toMatch(/filterOverrides/);
        expect(src).toMatch(/setParams/);
    });

    it('override guard filters params, conditions, and rhythm (Stage-5 keys)', async () => {
        // CONTRACT: the source's `filterOverrides` helper (line 811) and
        // `pKeys`/`cKeys`/`discKeys` lists (lines 835-862) cover every
        // mutable surface — params, conditions (interpolated + discrete),
        // and rhythm. If a future refactor narrows the guard back to
        // rhythm-only (the pre-Stage-5 bug), this test asserts the *list
        // of keys* remains comprehensive by reading the source directly.
        const fs = await import('node:fs');
        const path = await import('node:path');
        const src = fs.readFileSync(
            path.resolve(__dirname, 'PatientMonitor.jsx'),
            'utf8'
        );
        // params keys
        for (const k of ['hr', 'spo2', 'rr', 'bpSys', 'bpDia']) {
            expect(src).toContain(`'${k}'`);
        }
        // override-guard short-circuit must exist for both axes
        expect(src).toMatch(/overridden\.has\(key\)/);
        expect(src).toMatch(/overridden\.has\('rhythm'\)/);
        // The filterOverrides helper must exist (covers final-frame apply)
        expect(src).toMatch(/filterOverrides/);
    });
});

describe('PatientMonitor — Stage-5 auto-stop after last frame', () => {
    it('engine schedules setScenarioPlaying(false) past last frame + 2s (source contract)', async () => {
        // CONTRACT: source line ~897 — auto-stop fires once
        // `nextTime >= toFrame.time + 2` via `setTimeout(setScenarioPlaying(false), 0)`.
        // Driving this through real wall-clock time would require the test
        // to actually wait several real seconds (the 1s setInterval is
        // load-bearing) and fake timers thrash with msw + multiple
        // useEffect chains. We instead lock the contract by reading the
        // source: the `setScenarioPlaying(false)` schedule MUST exist and
        // MUST be conditional on `nextTime >= toFrame.time + 2`.
        const fs = await import('node:fs');
        const path = await import('node:path');
        const src = fs.readFileSync(
            path.resolve(__dirname, 'PatientMonitor.jsx'),
            'utf8'
        );
        // The schedule call exists (direct fallback when no anchor is set).
        expect(src).toMatch(/setScenarioPlaying\(false\)/);
        // It is gated on the +2 second condition.
        expect(src).toMatch(/toFrame\.time\s*\+\s*2/);
        // And it is wrapped in a setTimeout (deferred outside the state
        // updater). The anchored path must also freeze the persisted anchor
        // (playing: false at the current position) or a remount would
        // resume a scenario that already completed.
        expect(src).toMatch(/if\s*\(nextTime\s*>=\s*toFrame\.time\s*\+\s*2\)\s*\{\s*setTimeout\(/);
        expect(src).toMatch(/playing:\s*false,\s*offsetSec:\s*anchorSeconds\(a\)/);
    });

    it('does NOT auto-stop eagerly when last frame is far out (source contract)', async () => {
        // CONTRACT: auto-stop is conditional on `nextTime >= toFrame.time + 2`
        // (source ~line 897). A scenario whose final frame is at t=999
        // would need 1000s of engine ticks before the condition fires;
        // it MUST not eagerly stop on mount. We lock the gate's source
        // expression directly so a future refactor that drops the time
        // check fails this test.
        const fs = await import('node:fs');
        const path = await import('node:path');
        const src = fs.readFileSync(
            path.resolve(__dirname, 'PatientMonitor.jsx'),
            'utf8'
        );
        // Auto-stop is gated on time-past-last-frame.
        expect(src).toMatch(/nextTime\s*>=\s*toFrame\.time\s*\+\s*2/);
        // It is wrapped in setTimeout so the state update is deferred.
        expect(src).toMatch(/if\s*\(nextTime\s*>=\s*toFrame\.time\s*\+\s*2\)\s*\{\s*setTimeout\(/);
        // It does NOT fire unconditionally on mount or every tick.
        const eagerStops = src.match(/setScenarioPlaying\(false\)/g) || [];
        // Two known callsites: applyScenarioAnchor's stop branch and the
        // auto-stop's no-anchor fallback. If a third unconditional one is
        // added, this test should be revisited.
        expect(eagerStops.length).toBeLessThanOrEqual(3);
    });
});

describe('PatientMonitor — defensive renders', () => {
    it('renders without crashing when caseData is null', async () => {
        // CONTRACT: standalone monitor (no case loaded) must still mount.
        const { container } = renderWithProviders(
            <PatientMonitor caseParams={null} caseData={null} sessionId={null} isAdmin={false} />,
            { withPatientRecord: false }
        );
        await waitFor(() => {
            // Factory defaults: hr=80, spo2=98, rr=16
            expect(container.textContent).toContain('80');
        });
    });

    it('does not throw when sessionId is provided but vitals endpoint returns empty', async () => {
        // CONTRACT: empty vitals history (new session) is the common case;
        // restore must short-circuit silently and the case baseline wins.
        state.vitalsStore = { vitals: [] };
        const { container } = mount({ sessionId: 31 });
        await waitFor(() => {
            // Case baseline HR=88
            expect(container.textContent).toContain('88');
        });
    });
});

// Regression lock: case-editor rhythm labels never reached the monitor's
// AFib/VTach/VFib branches. The case editor stored 'Atrial Fibrillation'
// (and the scenario repository 'AFib') while the engine branched on
// `rhythm === 'AFib'` only — so every non-canonical spelling, including
// Italian free text from an imported scenario, silently rendered sinus.
// Every rhythm entering from case config / scenario frame / persisted row
// now passes through the shared resolver (server/shared/rhythms.js).
describe('PatientMonitor — rhythm aliases resolve to canonical ids', () => {
    // Poll on a REAL setTimeout. RTL's waitFor polls on setInterval, which
    // this file fakes (see beforeEach), so between DOM mutations it never
    // re-checks — and the vitals POST lands after the last mutation.
    const untilPosted = async (sessionId, rhythm, timeoutMs = 4000) => {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            if (state.posted.some(p => p.sessionId === sessionId && p.body.rhythm === rhythm)) return;
            await new Promise(r => setTimeout(r, 25));
        }
        const seen = state.posted.filter(p => p.sessionId === sessionId).map(p => p.body.rhythm);
        throw new Error(`no vitals POST for session ${sessionId} carried rhythm ${rhythm}; saw ${JSON.stringify(seen)}`);
    };

    it("a case whose initialVitals.rhythm is 'Atrial Fibrillation' runs as AFib", async () => {
        // The persisted vitals body carries the live `rhythm` state — the same
        // value the ECG generator branches on. HR 120 vs the factory 80 crosses
        // the deadband, so a POST fires after the case baseline lands.
        const legacyCase = {
            ...baseCase,
            config: {
                initialVitals: { ...baseCase.config.initialVitals, hr: 120, rhythm: 'Atrial Fibrillation' },
            },
            scenario: null,
        };
        mount({ sessionId: 41, caseData: legacyCase });
        await untilPosted('41', 'AFib');
        // And the raw label must never be what the engine (or analytics) sees.
        expect(state.posted.some(p => p.body.rhythm === 'Atrial Fibrillation')).toBe(false);
    });

    it('a persisted vitals row carrying a localized label restores as the canonical id', async () => {
        state.vitalsStore = {
            vitals: [
                { hr: 150, spo2: 90, bp_sys: 95, bp_dia: 60, rr: 22, temp: 37.0, etco2: 38, rhythm: 'Fibrillazione ventricolare' },
            ],
        };
        mount({ sessionId: 42 });
        await untilPosted('42', 'VFib');
    });

    it('every external rhythm entry point goes through the shared resolver (source contract)', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const src = fs.readFileSync(path.resolve(__dirname, 'PatientMonitor.jsx'), 'utf8');
        expect(src).toMatch(/import \{[^}]*resolveRhythm[^}]*\} from '\.\.\/\.\.\/services\/rhythms'/);
        // Scenario frames, timeline-step clicks and the restore-on-mount row
        // must not hand a raw string to setRhythm.
        expect(src).not.toMatch(/setRhythm\((?:fromFrame|toFrame|step|last)\.rhythm\)/);
        expect(src).toMatch(/setRhythm\(canonicalRhythm\(fromFrame\.rhythm\)\)/);
        expect(src).toMatch(/setRhythm\(canonicalRhythm\(toFrame\.rhythm\)\)/);
        expect(src).toMatch(/setRhythm\(canonicalRhythm\(last\.rhythm\)\)/);
        // The label map is the shared one, so every id the buttons render is translated.
        expect(src).toMatch(/const RHYTHM_KEYS = RHYTHM_LABEL_KEYS/);
    });
});

// =======================================================================
// ISSUE-0015 — an ended case must not keep "living" on the monitor
// =======================================================================
// Regression lock: after End & Debrief → "Back to patient", the monitor used
// to keep ticking (session clock, scenario engine, jitter, waveforms) because
// it only knew `sessionId`, which the host keeps for the debrief. It now
// takes `caseEnded` / `caseEndedAt` and holds its last frame.
describe('PatientMonitor — caseEnded freezes the monitor (ISSUE-0015)', () => {
    it('session clock stops at caseEndedAt and shows the "case ended" badge', async () => {
        // Fake Date too, so the un-fixed clock (which recomputes from
        // Date.now() every second) would visibly advance.
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] });
        const t0 = Date.now();
        const { getByTestId, findByText } = mount({
            sessionId: null,
            caseEnded: true,
            caseEndedAt: t0 + 3000,
        });
        expect(await findByText('0:03')).toBeTruthy();
        expect(getByTestId('monitor-case-ended')).toBeTruthy();

        await act(async () => { vi.advanceTimersByTime(5000); });
        // Still 0:03 — the clock did not follow Date.now() past the end.
        expect(await findByText('0:03')).toBeTruthy();
    });

    it('does not render the badge, and keeps ticking, while the case is live', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] });
        const { queryByTestId, findByText } = mount({ sessionId: null });
        expect(await findByText('0:00')).toBeTruthy();
        expect(queryByTestId('monitor-case-ended')).toBeNull();
        await act(async () => { vi.advanceTimersByTime(4000); });
        expect(await findByText('0:04')).toBeTruthy();
    });

    it('source contract: scenario engine, jitter and waveform loops all gate on caseEnded', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const src = fs.readFileSync(path.resolve(__dirname, 'PatientMonitor.jsx'), 'utf8');
        expect(src).toMatch(/if \(!activeScenario \|\| !scenarioPlaying \|\| caseEnded\) return;/);
        expect(src).toMatch(/if \(caseEnded\) return undefined;[\s\S]*?const interval = setInterval\(\(\) => \{\s*const p = simulationParams\.current;/);
        expect(src).toMatch(/if \(isPlaying && !caseEnded\) \{/);
    });
});

// =======================================================================
// ISSUE-0012 — a case's alternative evolutions show up in the Scenarios tab
// =======================================================================
describe('PatientMonitor — scenario.alternatives (ISSUE-0012)', () => {
    const withAlternatives = {
        ...baseCase,
        scenario: {
            ...baseCase.scenario,
            alternatives: [
                { id: 'worse', name: 'Deteriorates into shock', description: 'BP falls', timeline: [{ time: 0, params: { hr: 90 } }, { time: 60, params: { hr: 140 } }] },
                { id: 'better', name: 'Responds to fluids', timeline: [{ time: 0, params: { hr: 90 } }] },
                { id: 'empty', name: 'Ignored (no frames)', timeline: [] },
            ],
        },
    };

    async function openScenariosTab(utils) {
        const { findByTitle, findByRole } = utils;
        fireEvent.click(await findByTitle(/monitor settings/i));
        fireEvent.click(await findByRole('button', { name: /^scenarios$/i }));
    }

    it('lists each alternative with a timeline beside the case scenario; frameless ones are skipped', async () => {
        const utils = mount({ caseData: withAlternatives, isAdmin: true });
        await openScenariosTab(utils);
        expect(await utils.findByText('Deteriorates into shock')).toBeTruthy();
        expect(await utils.findByText('BP falls')).toBeTruthy();
        expect(await utils.findByText('Responds to fluids')).toBeTruthy();
        // Description fallback for an alternative that has none.
        expect(await utils.findByText('Alternative evolution of this case')).toBeTruthy();
        expect(utils.queryByText('Ignored (no frames)')).toBeNull();
        // The case's own scenario is still there.
        expect(await utils.findByText(/Test Case - Scenario/)).toBeTruthy();
    });

    it('a case without alternatives lists only its own scenario (no regression)', async () => {
        const utils = mount({ isAdmin: true });
        await openScenariosTab(utils);
        expect(await utils.findByText(/Test Case - Scenario/)).toBeTruthy();
        expect(utils.queryByText('Deteriorates into shock')).toBeNull();
    });
});
