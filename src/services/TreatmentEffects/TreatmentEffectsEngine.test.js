import { describe, expect, it, vi } from 'vitest';
import { TreatmentEffectsEngine } from './TreatmentEffectsEngine';

describe('TreatmentEffectsEngine', () => {
  it('preserves treatment_type for summary grouping', () => {
    vi.setSystemTime(new Date('2026-05-06T12:00:00Z'));
    const engine = new TreatmentEffectsEngine();
    engine.setActiveTreatments([
      {
        id: 1,
        treatment_order_id: 11,
        treatment_name: 'Salbutamol',
        treatment_type: 'medication',
        started_at: '2026-05-06T11:55:00Z',
        onset_minutes: 1,
        peak_minutes: 2,
        duration_minutes: 20,
        peak_hr_effect: 8,
      },
      {
        id: 2,
        treatment_order_id: 12,
        treatment_name: 'Oxygen',
        treatment_type: 'oxygen',
        started_at: '2026-05-06T11:55:00Z',
        onset_minutes: 1,
        peak_minutes: 2,
        duration_minutes: 20,
        peak_spo2_effect: 5,
      },
    ]);

    const summary = engine.getSummary();

    expect(summary.count).toBe(2);
    expect(summary.byType).toMatchObject({
      medications: 1,
      oxygen: 1,
      iv_fluids: 0,
      nursing: 0,
    });

    vi.useRealTimers();
  });

  it('clamps effects when applying aggregate changes to vitals', () => {
    vi.setSystemTime(new Date('2026-05-06T12:00:00Z'));
    const engine = new TreatmentEffectsEngine();
    engine.setActiveTreatments([
      {
        id: 1,
        treatment_order_id: 11,
        treatment_name: 'High flow oxygen',
        treatment_type: 'oxygen',
        started_at: '2026-05-06T11:55:00Z',
        onset_minutes: 1,
        peak_minutes: 2,
        duration_minutes: 20,
        peak_spo2_effect: 80,
        peak_hr_effect: -300,
      },
    ]);

    expect(engine.applyEffectsToVitals({ hr: 90, spo2: 70 })).toMatchObject({
      hr: 20,
      spo2: 100,
    });

    vi.useRealTimers();
  });
});
