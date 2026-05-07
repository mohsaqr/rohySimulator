import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useTreatmentEffects } from './useTreatmentEffects';

vi.mock('../config/api', () => ({
  apiUrl: (path) => `/api${path}`,
}));

function okActiveTreatments(active_treatments = []) {
  return Promise.resolve({
    ok: true,
    json: async () => ({ active_treatments }),
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('token', 'effects-token');
  global.fetch = vi.fn().mockResolvedValue(okActiveTreatments());
  vi.useRealTimers();
});

describe('useTreatmentEffects', () => {
  it('fetches active treatments with bearer auth and exposes aggregate effects', async () => {
    global.fetch = vi.fn().mockResolvedValue(okActiveTreatments([
      {
        id: 1,
        treatment_order_id: 11,
        treatment_name: 'Oxygen',
        treatment_type: 'oxygen',
        started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
        onset_minutes: 1,
        peak_minutes: 2,
        duration_minutes: 20,
        peak_spo2_effect: 5,
      },
    ]));

    const { result } = renderHook(() => useTreatmentEffects('session-1', {
      pollInterval: 60_000,
      updateInterval: 10,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(global.fetch).toHaveBeenCalledWith('/api/sessions/session-1/active-effects', {
      headers: { Authorization: 'Bearer effects-token' },
    });

    await waitFor(() => expect(result.current.count).toBe(1));
    expect(result.current.aggregate.spo2).toBeGreaterThan(0);
    expect(result.current.effects[0]).toMatchObject({
      treatment_order_id: 11,
      treatment_type: 'oxygen',
    });
  });

  it('clears singleton engine state when disabled or missing a session', async () => {
    const { result, rerender } = renderHook(
      ({ sessionId, enabled }) => useTreatmentEffects(sessionId, { enabled }),
      { initialProps: { sessionId: null, enabled: true } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.count).toBe(0);
    expect(result.current.aggregate).toMatchObject({
      hr: 0,
      bp_sys: 0,
      bp_dia: 0,
      rr: 0,
      spo2: 0,
      temp: 0,
    });

    rerender({ sessionId: 'session-1', enabled: false });
    expect(result.current.count).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('surfaces backend errors without throwing', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'No access' }),
    });

    const { result } = renderHook(() => useTreatmentEffects('session-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('No access');
    expect(result.current.count).toBe(0);
  });

  it('manual refresh re-fetches treatments and sets loading during the request', async () => {
    let release;
    global.fetch = vi.fn()
      .mockResolvedValueOnce(okActiveTreatments())
      .mockReturnValueOnce(new Promise((resolve) => {
        release = () => resolve(okActiveTreatments());
      }));

    const { result } = renderHook(() => useTreatmentEffects('session-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.refresh();
    });

    expect(result.current.loading).toBe(true);
    await act(async () => {
      release();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('applies current aggregate effects through the hook API', async () => {
    global.fetch = vi.fn().mockResolvedValue(okActiveTreatments([
      {
        id: 1,
        treatment_order_id: 11,
        treatment_name: 'Beta blocker',
        treatment_type: 'medication',
        started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
        onset_minutes: 1,
        peak_minutes: 2,
        duration_minutes: 20,
        peak_hr_effect: -20,
      },
    ]));

    const { result } = renderHook(() => useTreatmentEffects('session-1', { updateInterval: 10 }));
    await waitFor(() => expect(result.current.count).toBe(1));

    const adjusted = result.current.applyToVitals({ hr: 80, spo2: 96 });
    expect(adjusted.hr).toBeLessThan(80);
    expect(adjusted.spo2).toBe(96);
    expect(result.current.hasSignificantEffects(5)).toBe(true);
  });
});
