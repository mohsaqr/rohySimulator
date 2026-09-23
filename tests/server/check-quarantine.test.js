// The quarantine rules (scripts/check-quarantine.mjs), on synthetic sources.

import { describe, expect, it } from 'vitest';
import { MAX_AGE_DAYS, quarantineViolations } from '../../scripts/check-quarantine.mjs';

const NOW = Date.parse('2026-09-23T12:00:00Z');
const check = (text) => quarantineViolations([{ file: 'x.spec.js', text }], NOW);

const GOOD_PW = [
    '// QUARANTINED: 2026-09-20',
    '// PROVA-DEFECT: https://prova.lacarm.com/defects/12',
    "test('the phone rings @quarantine', async () => {});",
].join('\n');

describe('quarantineViolations', () => {
    it('accepts a dated quarantine that names its defect', () => {
        expect(check(GOOD_PW)).toEqual([]);
        expect(check(GOOD_PW.replace("test('", "test.describe('"))).toEqual([]);
        expect(check([
            '// QUARANTINED: 2026-09-20',
            '// PROVA-DEFECT: https://prova.lacarm.com/defects/12',
            "describeQuarantine('a flake', ({ it }) => {});",
        ].join('\n'))).toEqual([]);
    });

    it('ignores tests that are not quarantined', () => {
        expect(check("test('an ordinary test', () => {});\ndescribe('x', () => {});")).toEqual([]);
    });

    it('fails a quarantine without a PROVA-DEFECT line directly above', () => {
        const got = check("// QUARANTINED: 2026-09-20\n\ntest('flaky @quarantine', () => {});");
        expect(got.map((v) => v.problem)).toContain('no `// PROVA-DEFECT: <url>` on the line above');
        expect(check("describeQuarantine('a flake', () => {});").length).toBe(2);
    });

    it('fails a PROVA-DEFECT that is not a URL', () => {
        expect(check(GOOD_PW.replace('https://prova.lacarm.com/defects/12', 'PRV-12')).map((v) => v.problem))
            .toContain('no `// PROVA-DEFECT: <url>` on the line above');
    });

    it(`fails a quarantine older than ${MAX_AGE_DAYS} days, and one dated in the future`, () => {
        expect(check(GOOD_PW.replace('2026-09-20', '2026-08-24'))).toEqual([]); // 30 days: still allowed
        const stale = check(GOOD_PW.replace('2026-09-20', '2026-08-23'));
        expect(stale).toHaveLength(1);
        expect(stale[0].problem).toMatch(/31 days ago/);
        expect(check(GOOD_PW.replace('2026-09-20', '2026-10-01'))[0].problem).toMatch(/in the future/);
    });

    it('names the file, line and title', () => {
        const [v] = check(`\n\n${GOOD_PW.replace('https://prova.lacarm.com/defects/12', 'none')}`);
        expect(v).toMatchObject({ file: 'x.spec.js', line: 5, title: 'the phone rings @quarantine' });
    });
});
