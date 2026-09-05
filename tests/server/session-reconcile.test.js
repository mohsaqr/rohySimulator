// Reconciliation between the encounter record (patient_record_events) and
// the analytics stream (learning_events), per session.
import { describe, it, expect } from 'vitest';
import { reconcileSession, RECORD_VERB_EXPECTATIONS } from '../../server/lib/sessionReconcile.js';
import { LEARNING_VERBS } from '../../server/shared/learningVerbs.js';

describe('reconcileSession', () => {
    it('every expected learning verb is registered', () => {
        for (const verbs of Object.values(RECORD_VERB_EXPECTATIONS)) {
            for (const v of verbs) expect(LEARNING_VERBS, v).toContain(v);
        }
    });

    it('is complete when every record verb has a counterpart', () => {
        const out = reconcileSession(
            [{ verb: 'PERFORMED_PHYSICAL_EXAM' }, { verb: 'PERFORMED_PHYSICAL_EXAM' }, { verb: 'ORDERED_LAB' }, { verb: 'ADMINISTERED_MEDICATION' }],
            [{ verb: 'EXAMINED' }, { verb: 'EXAMINED' }, { verb: 'ORDERED' }, { verb: 'ADMINISTERED' }],
        );
        expect(out.complete).toBe(true);
        expect(out.byVerb.EXAMINED).toMatchObject({ record: 2, learning: 2, missing: 0 });
        // A historical alias (ADMINISTERED_MEDICATION) counts as its canonical verb.
        expect(out.byVerb.ADMINISTERED).toMatchObject({ record: 1, learning: 1, missing: 0 });
    });

    it('reports the missing counterparts per verb', () => {
        const out = reconcileSession([{ verb: 'PERFORMED_PHYSICAL_EXAM' }], [{ verb: 'EXAMINED' }, { verb: 'EXAMINED' }, { verb: 'NOTED' }]);
        expect(out.complete).toBe(false);
        expect(out.byVerb.EXAMINED.missing).toBe(1);
        expect(out.byVerb.NOTED.missing).toBe(1);
        expect(out.missingTotal).toBe(2);
    });

    it('surfaces a record verb outside the eight rather than ignoring it', () => {
        const out = reconcileSession([], [{ verb: 'WEIRD' }]);
        expect(out.byVerb.WEIRD).toMatchObject({ record: 1, missing: 1, expects: [] });
        expect(out.complete).toBe(false);
    });

    it('an empty session is complete', () => {
        expect(reconcileSession([], []).complete).toBe(true);
    });
});
