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
});
