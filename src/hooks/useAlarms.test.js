import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const notificationState = {
  notify: vi.fn(),
  resolve: vi.fn(),
  ack: vi.fn(),
  ackAll: vi.fn(),
  snooze: vi.fn(),
  snoozeAll: vi.fn(),
  active: [],
  snoozed: [],
  acked: [],
  prefs: {},
  setPrefs: vi.fn(),
};

vi.mock('../notifications/useNotifications', () => ({
  useNotifications: () => notificationState,
}));

vi.mock('../config/api', () => ({
  apiUrl: (path) => `/api${path}`,
}));

import { useAlarms } from './useAlarms';
import { SEVERITY } from '../notifications/types';

function okConfig(config = []) {
  return Promise.resolve(new Response(JSON.stringify({ config }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}

beforeEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
  Object.assign(notificationState, {
    notify: vi.fn(),
    resolve: vi.fn(),
    ack: vi.fn(),
    ackAll: vi.fn(),
    snooze: vi.fn(),
    snoozeAll: vi.fn(),
    active: [],
    snoozed: [],
    acked: [],
    prefs: {},
    setPrefs: vi.fn(),
  });
  global.fetch = vi.fn().mockResolvedValue(okConfig());
});

describe('useAlarms', () => {
  it('loads backend thresholds and notifies once on first threshold breach', async () => {
    renderHook(() => useAlarms({ hr: 130 }, 'session-1'));

    await waitFor(() => expect(notificationState.notify).toHaveBeenCalledTimes(1));
    expect(notificationState.notify.mock.calls[0][0]).toMatchObject({
      key: 'alarm:hr_high',
      severity: SEVERITY.WARNING,
      title: 'HR high',
      data: {
        vital: 'hr',
        thresholdType: 'high',
        thresholdValue: 120,
        actualValue: 130,
        sessionId: 'session-1',
      },
    });
  });

  it('uses custom backend thresholds and disabled flags', async () => {
    global.fetch = vi.fn().mockResolvedValue(okConfig([
      { vital_sign: 'hr', low_threshold: 40, high_threshold: 140, enabled: true },
      { vital_sign: 'spo2', low_threshold: 90, high_threshold: null, enabled: false },
    ]));

    renderHook(() => useAlarms({ hr: 130, spo2: 82 }, 'session-1'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(global.fetch.mock.calls[0][0]).toBe('/api/alarms/config');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notificationState.notify).not.toHaveBeenCalled();
  });

  it('classifies severe breaches as critical', async () => {
    renderHook(() => useAlarms({ spo2: 82, hr: 155 }, 'session-1'));

    await waitFor(() => expect(notificationState.notify).toHaveBeenCalledTimes(2));
    const severities = notificationState.notify.mock.calls.map(([payload]) => [payload.key, payload.severity]);
    expect(severities).toEqual(expect.arrayContaining([
      ['alarm:spo2_low', SEVERITY.CRITICAL],
      ['alarm:hr_high', SEVERITY.CRITICAL],
    ]));
  });

  it('does not resolve a recovered alarm until it has been acknowledged', async () => {
    const { rerender } = renderHook(({ vitals }) => useAlarms(vitals, 'session-1'), {
      initialProps: { vitals: { hr: 130 } },
    });

    await waitFor(() => expect(notificationState.notify).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender({ vitals: { hr: 90 } });
    });
    expect(notificationState.resolve).not.toHaveBeenCalled();

    notificationState.acked = ['alarm:hr_high'];
    await act(async () => {
      rerender({ vitals: { hr: 90 } });
    });

    await waitFor(() => expect(notificationState.resolve).toHaveBeenCalledWith('alarm:hr_high'));
  });

  it('derives active, snoozed, and silenced alarm lists from notification state', async () => {
    notificationState.active = [
      { source: 'clinical', key: 'alarm:hr_high' },
      { source: 'system', key: 'system:test' },
    ];
    notificationState.snoozed = [
      { key: 'alarm:spo2_low', until: Date.now() + 120_000 },
    ];
    notificationState.acked = ['alarm:hr_high'];

    const { result } = renderHook(() => useAlarms({ hr: 130, spo2: 97 }, 'session-1'));

    await waitFor(() => expect(result.current.activeAlarms).toEqual(['hr_high']));
    expect(result.current.snoozedAlarms[0]).toMatchObject({ key: 'spo2_low' });
    expect(result.current.silencedAlarms).toEqual([
      expect.objectContaining({ key: 'hr_high', vital: 'hr', kind: 'high' }),
    ]);
  });

  it('saves threshold configuration with bearer auth', async () => {
    window.localStorage.setItem('token', 'alarm-token');
    const { result } = renderHook(() => useAlarms({ hr: 80 }, 'session-1'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(global.fetch.mock.calls[0][0]).toBe('/api/alarms/config');
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer alarm-token');

    global.fetch.mockClear();
    await act(async () => {
      await result.current.saveConfig('user-1');
    });

    expect(global.fetch).toHaveBeenCalledTimes(7);
    const [, init] = global.fetch.mock.calls[0];
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer alarm-token',
      },
    });
    expect(JSON.parse(init.body)).toMatchObject({
      user_id: 'user-1',
      vital_sign: 'hr',
      high_threshold: 120,
      low_threshold: 50,
      enabled: true,
    });
  });

  // Audit #17: the 2s scheduled re-check tick is what catches a vital that
  // was normal at first render but breaches later. Without timer-based
  // tests, a refactor that drops the setInterval would silently break alarm
  // detection on slow-developing breaches.
  it('re-evaluates breaches on the periodic 2s tick (timer contract)', async () => {
    // Start with hr=80 (normal) — no breach, no notify expected. Wait for
    // the threshold-load fetch to settle (real timers) before swapping to
    // fake timers and exercising the periodic tick.
    const { rerender } = renderHook(({ vitals }) => useAlarms(vitals, 'session-1'), {
      initialProps: { vitals: { hr: 80 } },
    });
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    // Drain any pending microtasks so threshold-load resolves and
    // `thresholdsLoaded` flips to true before we freeze the clock.
    await new Promise((r) => setTimeout(r, 0));
    expect(notificationState.notify).not.toHaveBeenCalled();

    vi.useFakeTimers();
    try {
      // Move the vital into breach and let the 2s tick detect it.
      rerender({ vitals: { hr: 130 } });
      await vi.advanceTimersByTimeAsync(2100);
      expect(notificationState.notify).toHaveBeenCalled();
      const firstCall = notificationState.notify.mock.calls[0][0];
      expect(firstCall.key).toBe('alarm:hr_high');
    } finally {
      vi.useRealTimers();
    }
  });

  // Regression lock: fire-state refs were only OVERWRITTEN when the new
  // session had a sessionStorage entry — switching to a fresh session
  // carried the old session's fired keys forward and suppressed an
  // identical breach for up to the 5-minute refresh window (Codex
  // adversarial review of v2.9.21).
  it('re-fires for a new session with no stored fire-state (refs reset on session change)', async () => {
    window.sessionStorage.clear();
    const { rerender } = renderHook(({ sid }) => useAlarms({ hr: 130 }, sid), {
      initialProps: { sid: 'session-1' },
    });
    await waitFor(() => expect(notificationState.notify).toHaveBeenCalledTimes(1));

    // Same breach, brand-new session: must count as a first fire again.
    rerender({ sid: 'session-2' });
    await waitFor(() => expect(notificationState.notify).toHaveBeenCalledTimes(2));
    expect(notificationState.notify.mock.calls[1][0].data.sessionId).toBe('session-2');
  });

  // Regression lock: an unacknowledged alarm vanished on reload — the fire-state survived in sessionStorage but the center's memory-only active list did not, so the alarm stayed silent until the 5-minute refresh (QA 2026-10-04, PRV-28)
  describe('re-asserting alarms the center lost on reload', () => {
    const storedInput = {
      source: 'clinical', severity: SEVERITY.WARNING, key: 'alarm:spo2_low',
      title: 'SPO2 low', message: 'spo2 = 88 (limit ≥ 90)', requiresAck: true, ttlMs: 0,
      data: { vital: 'spo2', thresholdType: 'low', thresholdValue: 90, actualValue: 88, sessionId: 's-reload' },
    };
    const parkFireState = (sid = 's-reload', withInput = true) => {
      window.sessionStorage.setItem(`rohy_alarm_fire_state:${sid}`, JSON.stringify({
        keys: ['alarm:spo2_low'],
        fires: [['alarm:spo2_low', Date.now() - 30_000]],
        ...(withInput ? { inputs: [['alarm:spo2_low', storedInput]] } : {}),
      }));
    };
    beforeEach(() => window.sessionStorage.clear());

    it('puts a still-breaching alarm back after a reload, with the current reading', async () => {
      parkFireState();
      renderHook(() => useAlarms({ spo2: 89 }, 's-reload'));
      await waitFor(() => expect(notificationState.notify).toHaveBeenCalledTimes(1));
      expect(notificationState.notify.mock.calls[0][0]).toMatchObject({
        key: 'alarm:spo2_low',
        data: { actualValue: 89 },
      });
    });

    it('puts a latched alarm back with the reading it latched at, though the vital has recovered', async () => {
      parkFireState();
      renderHook(() => useAlarms({ spo2: 97 }, 's-reload'));
      await waitFor(() => expect(notificationState.notify).toHaveBeenCalledTimes(1));
      expect(notificationState.notify.mock.calls[0][0]).toMatchObject({
        key: 'alarm:spo2_low',
        data: { actualValue: 88 },
      });
    });

    it('stays quiet on a room switch, where the center still shows the alarm', async () => {
      parkFireState();
      notificationState.active = [{ key: 'alarm:spo2_low', source: 'clinical' }];
      renderHook(() => useAlarms({ spo2: 89 }, 's-reload'));
      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(notificationState.notify).not.toHaveBeenCalled();
    });

    it('does not re-assert an alarm the learner acknowledged or snoozed', async () => {
      parkFireState();
      notificationState.acked = ['alarm:spo2_low'];
      const first = renderHook(() => useAlarms({ spo2: 89 }, 's-reload'));
      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 20));
      first.unmount();

      notificationState.acked = [];
      notificationState.snoozed = [{ key: 'alarm:spo2_low', until: Date.now() + 60_000 }];
      renderHook(() => useAlarms({ spo2: 89 }, 's-reload'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(notificationState.notify).not.toHaveBeenCalled();
    });

    it('re-asserts once per mount however many checks run', async () => {
      parkFireState();
      const { rerender } = renderHook(({ v }) => useAlarms(v, 's-reload'), {
        initialProps: { v: { spo2: 89 } },
      });
      await waitFor(() => expect(notificationState.notify).toHaveBeenCalledTimes(1));
      await act(async () => { rerender({ v: { spo2: 88 } }); });
      await act(async () => { rerender({ v: { spo2: 87 } }); });
      expect(notificationState.notify).toHaveBeenCalledTimes(1);
    });

    it('forgets an old fire-state entry with no stored reading once its vital has recovered', async () => {
      parkFireState('s-old', false);
      renderHook(() => useAlarms({ spo2: 97 }, 's-old'));
      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(notificationState.notify).not.toHaveBeenCalled();
      const saved = JSON.parse(window.sessionStorage.getItem('rohy_alarm_fire_state:s-old'));
      expect(saved.keys).toEqual([]);
    });
  });

  // Regression lock: after End & Debrief a remount raised a live CRITICAL alarm next to the frozen monitor — the hook kept sampling once the case was over (QA 2026-10-04, PRV-28)
  it('raises nothing, and re-asserts nothing, while disabled', async () => {
    window.sessionStorage.setItem('rohy_alarm_fire_state:s-ended', JSON.stringify({
      keys: ['alarm:hr_high'], fires: [['alarm:hr_high', Date.now()]],
    }));
    const { rerender } = renderHook(({ enabled }) => useAlarms({ bpSys: 40, hr: 130 }, 's-ended', { enabled }), {
      initialProps: { enabled: false },
    });
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(notificationState.notify).not.toHaveBeenCalled();

    // Re-enabling (a new case) samples again.
    rerender({ enabled: true });
    await waitFor(() => expect(notificationState.notify).toHaveBeenCalled());
  });
});
