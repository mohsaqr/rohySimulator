// Regression lock for Bug 2 (16.5.2026 report): posterior body-map regions
// upperBack / lowerBack / buttocks resolved to nothing, so the exam panel
// showed "Unknown region selected" and the raw key instead of the canonical
// region. The body map (src/utils/defaultRegions.js) keys these regions
// differently from BODY_REGIONS; the alias entries reconcile them.

import { describe, it, expect } from 'vitest';
import defaultRegions from '../utils/defaultRegions.js';
import {
    BODY_REGIONS,
    getDefaultFinding,
    getExamTypesForRegion,
    getRegionsByView,
} from './examRegions.js';

describe('exam regions ↔ body map id reconciliation (Bug 2)', () => {
    it('every posterior body-map region id resolves to a real exam region', () => {
        const mapIds = new Set();
        for (const sex of ['male', 'female']) {
            for (const id of Object.keys(defaultRegions.posterior[sex])) mapIds.add(id);
        }
        // These three were the broken ones in the report.
        for (const id of ['upperBack', 'lowerBack', 'buttocks']) {
            expect(mapIds.has(id)).toBe(true);
            const region = BODY_REGIONS[id];
            expect(region, `BODY_REGIONS["${id}"] must exist`).toBeTruthy();
            expect(region.name).toBeTruthy();
            expect(region.name).not.toBe(id); // never show the raw key
            expect(getExamTypesForRegion(id).length).toBeGreaterThan(0);
        }
        // Full sweep: no posterior map id may be unresolved.
        for (const id of mapIds) {
            expect(BODY_REGIONS[id], `unmapped posterior region "${id}"`).toBeTruthy();
        }
    });

    it('aliased regions carry real default findings', () => {
        expect(getDefaultFinding('lowerBack', 'inspection')).not.toBe('Not examined');
        expect(getDefaultFinding('upperBack', 'palpation')).not.toBe('Not examined');
        expect(getDefaultFinding('buttocks', 'inspection')).not.toBe('Not examined');
    });

    it('alias entries do not double-count in view-derived region lists', () => {
        const posterior = getRegionsByView('posterior');
        const ids = posterior.map((r) => r.id);
        // Canonical ids present, alias keys excluded.
        expect(ids).toContain('backLower');
        expect(ids).not.toContain('lowerBack');
        expect(ids).not.toContain('buttocks');
        expect(new Set(ids).size).toBe(ids.length); // no duplicates
    });
});
