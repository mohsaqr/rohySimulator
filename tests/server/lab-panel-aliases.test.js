// Regression lock: the 'cbc' search alias expanded to bare 'WBC'/'RBC', and
// the lab search is a substring match — so "CSF WBC Count" and "CSF RBC
// Count" matched and cerebrospinal-fluid tests were seeded into the CBC
// panel. The aliases now carry unambiguous full names; this test replays the
// substring match against the real lab database and asserts no CSF test can
// ride along on the CBC or sepsis panels.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SEARCH_ALIASES } from '../../src/data/labPanelTemplates.js';

const labDb = JSON.parse(
    readFileSync(resolve(process.cwd(), 'server/data/lab_database.json'), 'utf8'),
);

function substringMatches(term) {
    const q = term.toLowerCase();
    return labDb.filter((t) => t.test_name.toLowerCase().includes(q));
}

describe('SEARCH_ALIASES panel expansion vs the real lab database', () => {
    it.each(['cbc', 'sepsis'])('the %s alias terms match no CSF test', (alias) => {
        const matched = SEARCH_ALIASES[alias].flatMap(substringMatches);
        const csf = matched.filter((t) => t.test_name.startsWith('CSF'));
        expect(csf.map((t) => t.test_name)).toEqual([]);
    });

    it('the cbc alias still reaches the real CBC tests', () => {
        const names = new Set(
            SEARCH_ALIASES.cbc.flatMap(substringMatches).map((t) => t.test_name),
        );
        expect(names).toContain('White Blood Cell Count (WBC)');
        expect(names).toContain('Red Blood Cell Count (RBC)');
        expect(names).toContain('Platelet Count');
    });
});
