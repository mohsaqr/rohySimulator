// Regression lock: the order form previewed the base effect whatever dose was typed, while administration scaled it — and the client then scaled it a second time (QA 2026-10-04, PRV-37)
import { describe, it, expect } from 'vitest';
import { doseMultiplierFor } from '../../server/shared/treatmentDose.js';

const morphine = { dose_dependent: 1, base_dose: 2, max_effect_multiplier: 2.0 };

describe('doseMultiplierFor', () => {
    it('scales by dose over base dose', () => {
        expect(doseMultiplierFor(morphine, 2)).toBe(1);
        expect(doseMultiplierFor(morphine, 1)).toBe(0.5);
        expect(doseMultiplierFor(morphine, '3')).toBe(1.5);
    });

    it('caps at max_effect_multiplier, defaulting to 2', () => {
        expect(doseMultiplierFor(morphine, 10)).toBe(2);
        expect(doseMultiplierFor({ dose_dependent: 1, base_dose: 2 }, 10)).toBe(2);
        expect(doseMultiplierFor({ ...morphine, max_effect_multiplier: 3 }, 10)).toBe(3);
    });

    it('is 1 for a dose-independent effect, or a missing / invalid dose or base', () => {
        expect(doseMultiplierFor({ ...morphine, dose_dependent: 0 }, 8)).toBe(1);
        expect(doseMultiplierFor(morphine, '')).toBe(1);
        expect(doseMultiplierFor(morphine, 'abc')).toBe(1);
        expect(doseMultiplierFor(morphine, -2)).toBe(1);
        expect(doseMultiplierFor({ ...morphine, base_dose: 0 }, 4)).toBe(1);
        expect(doseMultiplierFor(null, 4)).toBe(1);
    });

    it('is monotone non-decreasing in dose up to the cap', () => {
        const doses = [0.5, 1, 1.5, 2, 3, 4, 8];
        const ms = doses.map((d) => doseMultiplierFor(morphine, d));
        ms.slice(1).forEach((m, i) => expect(m).toBeGreaterThanOrEqual(ms[i]));
    });
});
