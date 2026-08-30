// Referential-stability locks for useTreatmentEffects.
//
// Split out of useTreatmentEffects.test.js (which owns the fetch/error/
// session-swap contract) because this file pins one narrow property: the
// IDENTITY of the returned `aggregate` object, not its values.
//
// Why identity matters — UI test review 2.9.108, finding #19:
//   PatientMonitor keeps displayVitals in sync with an effect keyed on
//   `[params, treatmentEffects.aggregate]`. The hook recalculates every
//   `updateInterval` (1 s in the monitor) and used to publish a brand-new
//   aggregate object each time, even with zero active treatments. The
//   monitor's sync effect therefore re-fired at 1 Hz and reset displayVitals
//   to the flat baseline, wiping the 2 s jitter loop: 98.9 % of sampled
//   monitor frames were pinned to the baseline and the digits looked frozen.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useTreatmentEffects } from './useTreatmentEffects';

vi.mock('../config/api', () => ({
  apiUrl: (path) => `/api${path}`,
}));

function okActiveTreatments(active_treatments = []) {
  return new Response(JSON.stringify({ active_treatments }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function oxygenTreatment() {
  return {
    id: 1,
    treatment_order_id: 11,
    treatment_name: 'Oxygen',
    treatment_type: 'oxygen',
    started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    onset_minutes: 1,
    peak_minutes: 2,
    duration_minutes: 20,
    // Continuous → strength pinned at 1.0, so the only thing that could
    // change the aggregate between ticks is a real treatment change.
    is_continuous: true,
    peak_spo2_effect: 5,
  };
}

const tick = (ms) => new Promise(resolve => setTimeout(resolve, ms));

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('token', 'effects-token');
  global.fetch = vi.fn().mockResolvedValue(okActiveTreatments());
  vi.useRealTimers();
});

describe('useTreatmentEffects — aggregate identity', () => {
  // Regression lock: with zero active treatments the recalculation timer
  // must not mint a new `aggregate` object on every tick. Against the
  // un-fixed hook (`setEffects(calculated)` unconditionally) the identity
  // changes ~10x over this window and this assertion fails.
  it('keeps one aggregate identity across many ticks when there are no treatments', async () => {
    const { result } = renderHook(() => useTreatmentEffects('session-1', {
      pollInterval: 60_000,
      updateInterval: 10,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    const first = result.current.aggregate;
    expect(first).toMatchObject({ hr: 0, bp_sys: 0, bp_dia: 0, rr: 0, spo2: 0, temp: 0 });

    // ~12 recalculation ticks at updateInterval = 10 ms.
    await tick(120);

    expect(result.current.count).toBe(0);
    expect(result.current.aggregate).toBe(first);
    // The exported treatments array is stable for the same reason.
    expect(result.current.effects).toHaveLength(0);
  });

  // Regression lock: stability must not become staleness — a treatment
  // landing on the next poll has to publish a NEW aggregate identity, or
  // the monitor would never pick the effect up.
  it('publishes a new aggregate identity when a treatment lands', async () => {
    // Poll interval long enough that the only refetch is the explicit
    // refresh() below — otherwise the "idle" reading races the poll.
    global.fetch = vi.fn().mockResolvedValue(okActiveTreatments());

    const { result } = renderHook(() => useTreatmentEffects('session-1', {
      pollInterval: 60_000,
      updateInterval: 10,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    const idle = result.current.aggregate;
    expect(idle.spo2).toBe(0);

    global.fetch = vi.fn().mockResolvedValue(okActiveTreatments([oxygenTreatment()]));
    await act(async () => { result.current.refresh(); });

    await waitFor(() => expect(result.current.count).toBe(1));
    await waitFor(() => expect(result.current.aggregate.spo2).toBeGreaterThan(0));
    expect(result.current.aggregate).not.toBe(idle);

    // …and once the (continuous, at-peak) treatment stops changing, the
    // identity settles again rather than churning at the tick rate.
    const settled = result.current.aggregate;
    await tick(80);
    expect(result.current.aggregate).toBe(settled);
  });
});
