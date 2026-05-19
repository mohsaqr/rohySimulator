// Regression lock for Bug 15 (18.5.2026 report): the `neurological` region
// (and poplitealLeft/Right) declared `specialTests` but omitted `special`
// from `examTypes` and had no `defaultFindings.special`. ExamTypeSelector
// renders the special-test chips off `specialTests` and fires exam type
// `special`, while PhysicalExamEditor only exposes a configurable field for
// entries in `examTypes`. The mismatch made the neuro special tests
// unconfigurable in the case config yet still clickable for the student —
// who then got the literal "Not examined" from getDefaultFinding().
//
// Invariant: any region with a non-empty `specialTests` MUST also list
// `special` in `examTypes` AND provide a real `defaultFindings.special`.

import { describe, it, expect } from 'vitest';
import { BODY_REGIONS, getDefaultFinding } from './examRegions.js';

describe('special-tests configurability invariant (Bug 15)', () => {
    it('every region with specialTests has a configurable special exam + real default', () => {
        const offenders = [];
        for (const [id, region] of Object.entries(BODY_REGIONS)) {
            const tests = region.specialTests || [];
            if (tests.length === 0) continue;
            const hasSpecialType = (region.examTypes || []).includes('special');
            const def = getDefaultFinding(id, 'special');
            if (!hasSpecialType || def === 'Not examined') {
                offenders.push(
                    `${id}: special in examTypes=${hasSpecialType}, ` +
                    `default=${def === 'Not examined' ? '"Not examined"' : 'ok'}`
                );
            }
        }
        expect(offenders, `regions breaking the special-tests invariant:\n${offenders.join('\n')}`)
            .toEqual([]);
    });

    it('the specifically reported regions resolve to a clinical default, not "Not examined"', () => {
        for (const id of ['neurological', 'poplitealLeft', 'poplitealRight']) {
            expect(BODY_REGIONS[id]).toBeTruthy();
            expect(BODY_REGIONS[id].examTypes).toContain('special');
            const finding = getDefaultFinding(id, 'special');
            expect(finding).not.toBe('Not examined');
            expect(finding.length).toBeGreaterThan(20);
        }
    });

    it('neurological special default actually covers the listed signs', () => {
        const finding = getDefaultFinding('neurological', 'special');
        for (const sign of ['Romberg', 'Pronator drift', 'Babinski', 'Hoffmann', 'Lhermitte', 'Kernig', 'Brudzinski']) {
            expect(finding, `missing "${sign}" in neuro special default`).toContain(sign);
        }
    });
});
