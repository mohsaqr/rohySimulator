// Tests for src/notifications/surfaces/AudioSurface.jsx — the single Web Audio
// path for the NotificationCenter. Until v2.9.53 this surface had no tests at
// all, because tests/setup.js's AudioContext stub has no createOscillator() and
// so the surface threw on mount. This file supplies its own instrumented
// AudioContext instead of widening the global stub.
//
// CONTRACT (locked from src/notifications/surfaces/AudioSurface.jsx +
//           src/notifications/routing.js):
//   - CLINICAL/CRITICAL routes to [AUDIO, HISTORY, BACKEND] with the URGENT
//     pattern (defaults.js), so a critical vital breach sounds the oscillator.
//   - prefs.audioMuted is applied UNCONDITIONALLY in routeNotification
//     (routing.js:62) — unlike DND / minSeverity / mutedSources, it is NOT
//     bypassed by critical clinical. Muting audio is therefore meant to
//     silence even a life-threatening alarm; that is the documented intent of
//     the horn button on the Alarm System panel.
//   - ack()/resolve() remove the notification from `active`, which is the
//     other way audio stops.

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import { useNotifications } from '../useNotifications';
import { SOURCES, SEVERITY } from '../types';
import AudioSurface from './AudioSurface.jsx';

vi.mock('../../services/authService', () => ({
    AuthService: {
        getToken: () => null,
        verifyToken: vi.fn(async () => null),
    },
}));

const server = setupServer(
    http.get('*/api/notification-prefs', () => HttpResponse.json({ prefs: {} })),
    http.put('*/api/notification-prefs', () => HttpResponse.json({ ok: true })),
    http.get('*/api/*', () => HttpResponse.json({})),
    http.post('*/api/*', () => HttpResponse.json({})),
);

// --- Instrumented Web Audio -------------------------------------------------
// Records every oscillator the surface builds so a test can ask "is anything
// audible right now?" — i.e. an oscillator that was started and never stopped.
const built = [];

class InstrumentedAudioContext {
    constructor() {
        this.state = 'running';
        this.currentTime = 0;
        this.destination = {};
    }
    createOscillator() {
        const osc = {
            type: '',
            frequency: { setValueAtTime: () => {} },
            started: false,
            stopped: false,
            start() { this.started = true; },
            stop() { this.stopped = true; },
            connect: () => {},
            disconnect: () => {},
        };
        built.push(osc);
        return osc;
    }
    createGain() {
        return {
            gain: { setValueAtTime: () => {} },
            connect: () => {},
            disconnect: () => {},
        };
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
}

// Install before AudioSurface's lazy getCtx() runs (it runs on mount, not at
// import), so the surface's module-level singleton is our instrumented one.
window.AudioContext = InstrumentedAudioContext;
window.webkitAudioContext = InstrumentedAudioContext;

const isSounding = () => built.some(o => o.started && !o.stopped);

beforeEach(() => {
    built.length = 0;
    server.listen({ onUnhandledRequest: 'bypass' });
});
afterEach(() => {
    server.resetHandlers();
    server.close();
});

function Probe({ onReady }) {
    const ctx = useNotifications();
    useEffect(() => {
        if (typeof onReady === 'function') onReady(ctx);
    });
    return <div data-testid="probe" data-active={ctx.active.length} />;
}

function mountSurface() {
    const ref = { current: null };
    renderWithProviders(
        <>
            <Probe onReady={(c) => { ref.current = c; }} />
            <AudioSurface />
        </>,
        { withToast: false, withVoice: false },
    );
    return ref;
}

function soundCriticalAlarm(ref) {
    act(() => {
        ref.current.notify({
            source: SOURCES.CLINICAL,
            severity: SEVERITY.CRITICAL,
            key: 'spo2-low',
            message: 'SPO2 low (spo2 = 89, limit > 90)',
        });
    });
}

describe('AudioSurface — sounding a critical alarm', () => {
    it('starts an oscillator for a CLINICAL/CRITICAL notification', () => {
        const ref = mountSurface();
        expect(isSounding()).toBe(false);
        soundCriticalAlarm(ref);
        expect(isSounding()).toBe(true);
    });

    // Control: proves isSounding() can observe silence, so a failure of the
    // mute test below is a real defect and not a blind harness.
    it('stops when the alarm is acknowledged (ack removes it from active)', () => {
        const ref = mountSurface();
        soundCriticalAlarm(ref);
        expect(isSounding()).toBe(true);
        act(() => { ref.current.ack('spo2-low'); });
        expect(isSounding()).toBe(false);
    });
});

describe('AudioSurface — the horn button (prefs.audioMuted)', () => {
    // Regression lock: muting audio while an alarm is ALREADY sounding did not
    // silence it. routeNotification() ran once at notify() time and froze its
    // result onto notification.routedSurfaces; AudioSurface filtered on that
    // frozen array, so a later audioMuted flip never reached an active alarm.
    // Reported as bug 6 of the 2.9.37 report ("the alarm sound cannot be turned
    // off by clicking the horn button on Alarm system").
    it('silences an already-sounding alarm when audio is muted mid-alarm', () => {
        const ref = mountSurface();
        soundCriticalAlarm(ref);
        expect(isSounding()).toBe(true);

        act(() => { ref.current.setPrefs({ audioMuted: true }); });

        expect(isSounding()).toBe(false);
    });

    it('resumes the still-active alarm when audio is unmuted again', () => {
        const ref = mountSurface();
        soundCriticalAlarm(ref);
        act(() => { ref.current.setPrefs({ audioMuted: true }); });
        expect(isSounding()).toBe(false);

        act(() => { ref.current.setPrefs({ audioMuted: false }); });

        // The breach never resolved, so unmuting must page again.
        expect(isSounding()).toBe(true);
    });

    it('never sounds an alarm that arrives while already muted', () => {
        const ref = mountSurface();
        act(() => { ref.current.setPrefs({ audioMuted: true }); });
        soundCriticalAlarm(ref);
        expect(isSounding()).toBe(false);
    });
});
