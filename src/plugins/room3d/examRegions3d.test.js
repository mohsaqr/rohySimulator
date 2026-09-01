import { describe, it, expect } from 'vitest';
import { SUPINE_REGIONS_3D } from './examRegions3d.js';
import { BODY_REGIONS } from '../../data/examRegions';

describe('SUPINE_REGIONS_3D', () => {
    it('uses only real BODY_REGIONS ids, without duplicates', () => {
        const ids = SUPINE_REGIONS_3D.map((region) => region.id);
        expect(new Set(ids).size).toBe(ids.length);
        ids.forEach((id) => expect(BODY_REGIONS[id], id).toBeDefined());
    });

    it('respects the supine orientation: the patient\'s left is +x', () => {
        SUPINE_REGIONS_3D.filter((region) => region.id.endsWith('Left'))
            .forEach((region) => expect(region.center[0], region.id).toBeGreaterThan(0));
        SUPINE_REGIONS_3D.filter((region) => region.id.endsWith('Right'))
            .forEach((region) => expect(region.center[0], region.id).toBeLessThan(0));
    });

    it('keeps every collider on the bed footprint with positive sizes', () => {
        SUPINE_REGIONS_3D.forEach((region) => {
            expect(region.size.every((v) => v > 0), region.id).toBe(true);
            expect(Math.abs(region.center[0]), region.id).toBeLessThan(1.1);
            expect(region.center[1], region.id).toBeGreaterThan(1.1);
            expect(region.center[1], region.id).toBeLessThan(2.0);
            expect(region.center[2], region.id).toBeGreaterThan(-2.3);
            expect(region.center[2], region.id).toBeLessThan(2.4);
        });
    });
});
