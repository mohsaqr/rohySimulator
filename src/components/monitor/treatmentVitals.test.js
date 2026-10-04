import { describe, it, expect } from 'vitest';
import { withTreatmentEffects } from './treatmentVitals.js';

const base = { hr: 110, spo2: 94, rr: 22, bpSys: 150, bpDia: 90, temp: 37.2, etco2: 34 };

describe('withTreatmentEffects', () => {
    it('adds the aggregate to every channel', () => {
        expect(withTreatmentEffects(base, { hr: -10, bp_sys: -20, bp_dia: -10, rr: -8, spo2: -4, temp: -0.5, etco2: 2 }))
            .toEqual({ hr: 100, spo2: 90, rr: 14, bpSys: 130, bpDia: 80, temp: 36.7, etco2: 36 });
    });

    it('clamps to physiological bounds', () => {
        const out = withTreatmentEffects(base, { hr: -500, spo2: 50, rr: -100, bp_sys: -500, bp_dia: -500 });
        expect(out).toMatchObject({ hr: 20, spo2: 100, rr: 4, bpSys: 40, bpDia: 20 });
    });

    it('is the identity with no aggregate, and defaults a missing EtCO2', () => {
        expect(withTreatmentEffects(base, null)).toEqual(base);
        expect(withTreatmentEffects({ ...base, etco2: undefined }, {}).etco2).toBe(38);
    });
});
