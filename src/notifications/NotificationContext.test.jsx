// Tests for src/notifications/NotificationContext.jsx — the central
// NotificationCenter. Phase 4 lock-in for the routing/mute/persistence pipeline
// that replaced four parallel notification systems.
//
// CONTRACT (locked from src/notifications/NotificationContext.jsx +
//           src/notifications/routing.js + src/notifications/persistence.js):
//   - useNotifications() exposes the producer API: notify, resolve, ack, ackAll,
//     snooze, snoozeAll, dismiss, clearTransient, plus state snapshots
//     (active, history, snoozed, acked) and prefs/setPrefs/subscribe.
//   - Routing matrix in DEFAULT_ROUTING maps `${source}/${severity}` to surfaces.
//     Producers can override with `surfaces` on the input.
//   - Mute hierarchy (in order, applied by routeNotification):
//        acked → snoozed → DND/paused → minSeverity → mutedSources →
//        per-surface mutes (audioMuted, bannerMuted, consoleMuted).
//     Clinical+critical bypasses every blanket rule (DND/severity/source) but
//     still respects explicit ack/snooze.
//   - ack(key) is idempotent: a Set is the persistence shape, so adding the
//     same key twice leaves the set with one entry.
//   - clearTransient(reason) zeroes out active + acked + snoozed and
//     dispatches { type: 'transient-cleared', reason } to subscribers
//     (Stage-3 audit fix: acks are session-scoped, not user-scoped).
//   - Prefs persist to localStorage on every setPrefs (savePrefsSync inside
//     setPrefsState callback). Remote PUT is fire-and-forget; failure is
//     non-fatal.
//   - History always records, even when finalSurfaces is empty (silenced
//     notifications remain auditable). HISTORY_CAP = 200.
//
// SPEC DIVERGENCE (documented for future work, NOT tested here because the
// behavior does not exist in the source as of this writing):
//   - "Pre-mount buffer (1000 cap) replaying on first center-bound call":
//     externalApi.js is currently a plain getter/setter with no buffer. There
//     is nothing to lock. A test would invent behavior. Leaving a single
//     guard test below that pins externalApi's *current* shape so a future
//     buffer addition triggers an explicit update of this file.
//
// Provider stack: NotificationProvider depends on AuthProvider (it calls
// useAuth() to derive a per-user storage scope). renderWithProviders mounts
// both. AuthService.verifyToken() returns null without a token, so userId
// stays null → storage is keyed under `:anon`.

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import renderWithProviders from '../../tests/utils/renderWithProviders.jsx';
import { useNotifications } from './useNotifications';
import { SOURCES, SEVERITY, SURFACES } from './types';
import { DEFAULT_PREFS } from './defaults';
import * as externalApi from './externalApi';

// --- AuthService is fired by AuthProvider on mount. Stub it so tests don't
// need to mock the network for `/api/auth/verify`.
vi.mock('../services/authService', () => ({
    AuthService: {
        getToken: () => null,
        verifyToken: vi.fn(async () => null),
    },
}));

// --- msw: the provider tries to load remote prefs once on mount via
// loadPrefsRemote() (only fires when a token exists — our mock returns null
// so the fetch never happens). We still set up msw so any stray request is
// caught loudly instead of throwing CORS at us.
const server = setupServer(
    http.get('*/api/notification-prefs', () => HttpResponse.json({ prefs: {} })),
    http.put('*/api/notification-prefs', () => HttpResponse.json({ ok: true })),
    http.get('*/api/*', () => HttpResponse.json({})),
    http.post('*/api/*', () => HttpResponse.json({})),
);

beforeEach(() => {
    server.listen({ onUnhandledRequest: 'bypass' });
});
afterEach(() => {
    server.resetHandlers();
    server.close();
});

// --- Probe: read the live context value and surface methods to the test
// via a captured ref. Mounted as a sibling, inside the same provider tree.
function CenterProbe({ onReady }) {
    const ctx = useNotifications();
    useEffect(() => {
        if (typeof onReady === 'function') onReady(ctx);
    });
    return (
        <div
            data-testid="center-probe"
            data-active-count={ctx.active.length}
            data-history-count={ctx.history.length}
            data-acked-count={ctx.acked.length}
            data-snoozed-count={ctx.snoozed.length}
            data-dnd={String(!!ctx.prefs.dnd)}
            data-min-severity={ctx.prefs.minSeverity}
        />
    );
}

function mountCenter() {
    const ref = { current: null };
    renderWithProviders(<CenterProbe onReady={(c) => { ref.current = c; }} />, {
        withToast: false,
        withVoice: false,
    });
    return ref;
}

describe('NotificationProvider — defaults', () => {
    it('exposes DEFAULT_PREFS shape via useNotifications().prefs', () => {
        const ref = mountCenter();
        const prefs = ref.current.prefs;
        // Every DEFAULT_PREFS key must round-trip through the provider.
        for (const key of Object.keys(DEFAULT_PREFS)) {
            expect(prefs).toHaveProperty(key);
        }
        expect(prefs.dnd).toBe(DEFAULT_PREFS.dnd);
        expect(prefs.minSeverity).toBe(DEFAULT_PREFS.minSeverity);
        expect(prefs.audioMuted).toBe(DEFAULT_PREFS.audioMuted);
    });

    it('exposes the full producer + lifecycle API', () => {
        const ref = mountCenter();
        const ctx = ref.current;
        // Producer + lifecycle methods.
        for (const method of [
            'notify', 'resolve', 'ack', 'ackAll', 'snooze', 'snoozeAll',
            'dismiss', 'clearTransient', 'pause', 'resume',
            'setPrefs', 'subscribe',
        ]) {
            expect(typeof ctx[method]).toBe('function');
        }
        // State snapshots are arrays.
        expect(Array.isArray(ctx.active)).toBe(true);
        expect(Array.isArray(ctx.history)).toBe(true);
        expect(Array.isArray(ctx.snoozed)).toBe(true);
        expect(Array.isArray(ctx.acked)).toBe(true);
    });
});

describe('NotificationProvider — routing', () => {
    it('routes user/success to the TOAST surface (DEFAULT_ROUTING)', () => {
        const ref = mountCenter();
        const sub = vi.fn();
        let unsubscribe;
        act(() => { unsubscribe = ref.current.subscribe(sub); });

        let id;
        act(() => {
            id = ref.current.notify({
                source: SOURCES.USER,
                severity: SEVERITY.SUCCESS,
                message: 'Saved',
            });
        });
        expect(id).toBeTruthy();
        expect(sub).toHaveBeenCalledTimes(1);
        const event = sub.mock.calls[0][0];
        expect(event.type).toBe('notify');
        expect(event.notification.routedSurfaces).toContain(SURFACES.TOAST);
        // No clinical/audio routing for user/success.
        expect(event.notification.routedSurfaces).not.toContain(SURFACES.AUDIO);
        unsubscribe?.();
    });

    it('routes clinical/critical to AUDIO + HISTORY + BACKEND surfaces', () => {
        const ref = mountCenter();
        const sub = vi.fn();
        act(() => { ref.current.subscribe(sub); });

        act(() => {
            ref.current.notify({
                source: SOURCES.CLINICAL,
                severity: SEVERITY.CRITICAL,
                message: 'V-tach',
                key: 'alarm:v-tach',
            });
        });
        const ev = sub.mock.calls[0][0];
        expect(ev.notification.routedSurfaces).toEqual(
            expect.arrayContaining([SURFACES.AUDIO, SURFACES.HISTORY, SURFACES.BACKEND])
        );
    });

    it('honors explicit `surfaces` override on the input over DEFAULT_ROUTING', () => {
        const ref = mountCenter();
        const sub = vi.fn();
        act(() => { ref.current.subscribe(sub); });
        act(() => {
            ref.current.notify({
                source: SOURCES.USER,
                severity: SEVERITY.INFO,
                message: 'Custom',
                surfaces: [SURFACES.HISTORY, SURFACES.CONSOLE],
            });
        });
        const ev = sub.mock.calls[0][0];
        expect(ev.notification.routedSurfaces).toEqual(
            expect.arrayContaining([SURFACES.HISTORY, SURFACES.CONSOLE])
        );
        expect(ev.notification.routedSurfaces).not.toContain(SURFACES.TOAST);
    });
});

describe('NotificationProvider — ack semantics', () => {
    it('ack() is idempotent: calling it twice with the same key keeps the set at size 1', () => {
        const ref = mountCenter();
        // Seed an active notification so ack has something to drop.
        act(() => {
            ref.current.notify({
                source: SOURCES.CLINICAL,
                severity: SEVERITY.WARNING,
                message: 'High HR',
                key: 'alarm:hr_high',
            });
        });
        act(() => { ref.current.ack('alarm:hr_high'); });
        act(() => { ref.current.ack('alarm:hr_high'); });
        // After two acks the same key, the acked snapshot still contains it once.
        const acked = ref.current.acked;
        expect(acked.filter(k => k === 'alarm:hr_high').length).toBe(1);
        // localStorage persistence reflects exactly one entry.
        const raw = window.localStorage.getItem('rohy_notification_acked:anon');
        expect(JSON.parse(raw)).toEqual(['alarm:hr_high']);
    });

    it('clearTransient(reason) clears acked + snoozed + active and notifies subscribers', () => {
        const ref = mountCenter();
        const sub = vi.fn();
        act(() => { ref.current.subscribe(sub); });

        // Seed some transient state.
        act(() => {
            ref.current.notify({
                source: SOURCES.CLINICAL,
                severity: SEVERITY.WARNING,
                message: 'A',
                key: 'k:a',
            });
            ref.current.notify({
                source: SOURCES.CLINICAL,
                severity: SEVERITY.WARNING,
                message: 'B',
                key: 'k:b',
            });
        });
        act(() => {
            ref.current.ack('k:a');
            ref.current.snooze('k:b', 5);
        });
        expect(ref.current.acked).toContain('k:a');
        expect(ref.current.snoozed.length).toBe(1);

        sub.mockClear();
        act(() => { ref.current.clearTransient('session-change'); });

        expect(ref.current.acked).toEqual([]);
        expect(ref.current.snoozed).toEqual([]);
        expect(ref.current.active).toEqual([]);
        // Subscribers see the transient-cleared signal.
        const types = sub.mock.calls.map(c => c[0].type);
        expect(types).toContain('transient-cleared');
        const evt = sub.mock.calls.find(c => c[0].type === 'transient-cleared')[0];
        expect(evt.reason).toBe('session-change');

        // Persistence files cleared too.
        const rawAcked = window.localStorage.getItem('rohy_notification_acked:anon');
        const rawSnoozed = window.localStorage.getItem('rohy_notification_snoozed:anon');
        // Either null (untouched) or an empty array/object after clear.
        if (rawAcked !== null) expect(JSON.parse(rawAcked)).toEqual([]);
        if (rawSnoozed !== null) expect(JSON.parse(rawSnoozed)).toEqual({});
    });
});

describe('NotificationProvider — mute hierarchy', () => {
    it('DND silences non-critical (routedSurfaces is []) but lets clinical/critical through', () => {
        const ref = mountCenter();
        const sub = vi.fn();
        act(() => { ref.current.subscribe(sub); });
        act(() => { ref.current.setPrefs({ dnd: true }); });

        act(() => {
            ref.current.notify({
                source: SOURCES.SYSTEM,
                severity: SEVERITY.WARNING,
                message: 'Non-critical',
                key: 'sys:nc',
            });
        });
        // Subscriber only fires when finalSurfaces.length > 0 → no call yet.
        expect(sub).not.toHaveBeenCalled();
        // History still records the silenced event (audit trail).
        expect(ref.current.history.some(h => h.key === 'sys:nc')).toBe(true);

        // Clinical critical breaks through.
        act(() => {
            ref.current.notify({
                source: SOURCES.CLINICAL,
                severity: SEVERITY.CRITICAL,
                message: 'V-fib',
                key: 'alarm:v-fib',
            });
        });
        expect(sub).toHaveBeenCalledTimes(1);
        expect(sub.mock.calls[0][0].notification.routedSurfaces.length).toBeGreaterThan(0);
    });

    it('minSeverity=warning filters info, but warning and above pass', () => {
        const ref = mountCenter();
        const sub = vi.fn();
        act(() => { ref.current.subscribe(sub); });
        act(() => { ref.current.setPrefs({ minSeverity: SEVERITY.WARNING }); });

        act(() => {
            ref.current.notify({
                source: SOURCES.SYSTEM,
                severity: SEVERITY.INFO,
                message: 'Info-noise',
                key: 'sys:info',
            });
        });
        expect(sub).not.toHaveBeenCalled();

        act(() => {
            ref.current.notify({
                source: SOURCES.SYSTEM,
                severity: SEVERITY.WARNING,
                message: 'Warn-louder',
                key: 'sys:warn',
            });
        });
        expect(sub).toHaveBeenCalledTimes(1);
    });

    it('source mute (mutedSources=[alarm-source]) blocks that source for non-critical', () => {
        // The notification system uses SOURCES.* — there is no "alarm" source.
        // Mute SYSTEM and verify a system/error gets dropped while
        // clinical/critical still escapes (per routeNotification logic).
        const ref = mountCenter();
        const sub = vi.fn();
        act(() => { ref.current.subscribe(sub); });
        act(() => { ref.current.setPrefs({ mutedSources: [SOURCES.SYSTEM] }); });

        act(() => {
            ref.current.notify({
                source: SOURCES.SYSTEM,
                severity: SEVERITY.ERROR,
                message: 'Muted-system',
                key: 'sys:muted',
            });
        });
        expect(sub).not.toHaveBeenCalled();

        act(() => {
            ref.current.notify({
                source: SOURCES.CLINICAL,
                severity: SEVERITY.CRITICAL,
                message: 'Crit-passes',
                key: 'alarm:crit',
            });
        });
        expect(sub).toHaveBeenCalledTimes(1);
    });

    it('audioMuted strips the AUDIO surface from routed surfaces', () => {
        const ref = mountCenter();
        const sub = vi.fn();
        act(() => { ref.current.subscribe(sub); });
        act(() => { ref.current.setPrefs({ audioMuted: true }); });

        act(() => {
            ref.current.notify({
                source: SOURCES.CLINICAL,
                severity: SEVERITY.WARNING,
                message: 'Quiet alarm',
                key: 'alarm:quiet',
            });
        });
        // Subscriber still fires (AUDIO is stripped, but HISTORY + BACKEND remain).
        expect(sub).toHaveBeenCalledTimes(1);
        expect(sub.mock.calls[0][0].notification.routedSurfaces).not.toContain(SURFACES.AUDIO);
        expect(sub.mock.calls[0][0].notification.routedSurfaces).toEqual(
            expect.arrayContaining([SURFACES.HISTORY, SURFACES.BACKEND])
        );
    });
});

describe('NotificationProvider — persistence', () => {
    it('setPrefs writes the merged prefs to localStorage under the per-user key', () => {
        const ref = mountCenter();
        act(() => { ref.current.setPrefs({ minSeverity: SEVERITY.WARNING, audioMuted: true }); });
        const raw = window.localStorage.getItem('rohy_notification_prefs:anon');
        expect(raw).toBeTruthy();
        const parsed = JSON.parse(raw);
        expect(parsed.minSeverity).toBe(SEVERITY.WARNING);
        expect(parsed.audioMuted).toBe(true);
        // Other defaults survived the merge.
        expect(parsed.snoozeDuration).toBe(DEFAULT_PREFS.snoozeDuration);
    });

    it('ack persists into rohy_notification_acked:anon as a JSON array', () => {
        const ref = mountCenter();
        act(() => {
            ref.current.notify({
                source: SOURCES.CLINICAL,
                severity: SEVERITY.WARNING,
                message: 'persist-ack',
                key: 'alarm:persist',
            });
        });
        act(() => { ref.current.ack('alarm:persist'); });
        const raw = window.localStorage.getItem('rohy_notification_acked:anon');
        expect(JSON.parse(raw)).toEqual(['alarm:persist']);
    });
});

describe('NotificationProvider — externalApi shape (pre-mount buffer placeholder)', () => {
    it('externalApi.js exposes only setExternalApi/getExternalApi today (no pre-mount buffer)', () => {
        // CONTRACT divergence note: The Phase-4 spec describes a 1000-entry
        // pre-mount buffer with replay-on-first-call. That feature is NOT in
        // the source as of this writing — externalApi.js is a plain
        // getter/setter. This test pins the *current* surface so a future
        // buffer addition forces an explicit update of this file.
        expect(typeof externalApi.setExternalApi).toBe('function');
        expect(typeof externalApi.getExternalApi).toBe('function');
        // Initially null.
        externalApi.setExternalApi(null);
        expect(externalApi.getExternalApi()).toBeNull();
        // Round-trips.
        const fake = { notify: () => 'id-1' };
        externalApi.setExternalApi(fake);
        expect(externalApi.getExternalApi()).toBe(fake);
        // Cleanup so other tests start from null.
        externalApi.setExternalApi(null);
    });
});

describe('NotificationProvider — history buffer', () => {
    it('records every notify() call into history regardless of surface routing', () => {
        const ref = mountCenter();
        // DND on → routedSurfaces will be [] for non-critical, but history still records.
        act(() => { ref.current.setPrefs({ dnd: true }); });
        act(() => {
            ref.current.notify({
                source: SOURCES.SYSTEM,
                severity: SEVERITY.INFO,
                message: 'silenced-but-audited',
                key: 'sys:silenced',
            });
        });
        const found = ref.current.history.find(h => h.key === 'sys:silenced');
        expect(found).toBeTruthy();
        expect(found.message).toBe('silenced-but-audited');
    });
});
