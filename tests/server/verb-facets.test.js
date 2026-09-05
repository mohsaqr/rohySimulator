// The verb registry's facet rows: complete, in-enum, and internally
// consistent. This is the contract every analytics consumer relies on when it
// derives its map from the registry instead of keeping its own.
import { describe, it, expect } from 'vitest';
import {
    BASE_VERB_FACETS, BASE_LEARNING_VERBS, LEARNING_VERBS, VERB_FACETS, VERB_METADATA,
    VERB_ALIASES, SERVER_ONLY_VERBS, normalizeVerb, normalizeEvent, verbWithAliases,
    resolveEventMetadata, SEVERITY, CATEGORIES,
} from '../../server/shared/learningVerbs.js';
import {
    SEVERITIES, CATEGORIES as CATEGORY_VALUES, CLINICAL_STATES, CLINICAL_ACTIONS, MEDICAL_DOMAINS,
    TNA_BUCKETS, PULSE_BUCKETS, EMITTERS, REQUIRED_FACETS,
    ACTION_TO_DOMAIN, ACTION_TO_PULSE, STATE_TO_TNA, STATE_TO_ACTION,
    completeFacets, validateFacets, humanizeVerb,
} from '../../server/shared/learningVerbFacets.js';
import { PLUGIN_MANIFESTS } from '../../server/shared/plugins/manifests.generated.js';

describe('facet enums', () => {
    it('the SEVERITY / CATEGORIES constants agree with the enum arrays', () => {
        expect(Object.values(SEVERITY)).toEqual(SEVERITIES);
        expect(Object.values(CATEGORIES)).toEqual(CATEGORY_VALUES);
    });

    it('the derivation tables are total over their domains', () => {
        for (const action of CLINICAL_ACTIONS) {
            expect(MEDICAL_DOMAINS, `${action} → domain`).toContain(ACTION_TO_DOMAIN[action]);
            expect(PULSE_BUCKETS, `${action} → pulse`).toContain(ACTION_TO_PULSE[action]);
        }
        for (const state of CLINICAL_STATES) {
            expect(CLINICAL_ACTIONS, `${state} → action`).toContain(STATE_TO_ACTION[state]);
            const tna = STATE_TO_TNA[state];
            expect(tna === null || TNA_BUCKETS.includes(tna), `${state} → tna ${tna}`).toBe(true);
        }
    });

    it('studying is a clinical state, so lessons rows have a bucket', () => {
        expect(CLINICAL_STATES).toContain('studying');
        expect(CLINICAL_STATES).toHaveLength(11);
    });
});

describe('BASE_VERB_FACETS', () => {
    it('is the whitelist: BASE_LEARNING_VERBS are exactly its keys', () => {
        expect([...BASE_LEARNING_VERBS].sort()).toEqual(Object.keys(BASE_VERB_FACETS).sort());
    });

    it('every base row declares the required facets and every value is in its enum', () => {
        for (const [verb, f] of Object.entries(BASE_VERB_FACETS)) {
            for (const field of REQUIRED_FACETS) expect(f[field], `${verb}.${field}`).toBeDefined();
            expect(SEVERITIES, `${verb}.severity`).toContain(f.severity);
            expect(CATEGORY_VALUES, `${verb}.category`).toContain(f.category);
            expect(CLINICAL_STATES, `${verb}.clinicalState`).toContain(f.clinicalState);
            expect(CLINICAL_ACTIONS, `${verb}.action`).toContain(f.action);
            expect(MEDICAL_DOMAINS, `${verb}.domain`).toContain(f.domain);
            expect(f.tnaMerge === null || TNA_BUCKETS.includes(f.tnaMerge), `${verb}.tnaMerge=${f.tnaMerge}`).toBe(true);
            expect(PULSE_BUCKETS, `${verb}.pulseBucket`).toContain(f.pulseBucket);
            expect(EMITTERS, `${verb}.emitter`).toContain(f.emitter);
            expect(typeof f.label === 'string' && f.label.length > 0, `${verb}.label`).toBe(true);
            expect(Object.isFrozen(f), `${verb} row is frozen`).toBe(true);
        }
    });

    it('domain is always the coarsening of action (the two lenses cannot disagree)', () => {
        for (const [verb, f] of Object.entries(BASE_VERB_FACETS)) {
            expect(f.domain, verb).toBe(ACTION_TO_DOMAIN[f.action]);
        }
    });

    it('a planned verb says what would emit it', () => {
        const planned = Object.entries(BASE_VERB_FACETS).filter(([, f]) => f.emitter === 'planned');
        expect(planned.length).toBeGreaterThan(0);
        for (const [verb, f] of planned) expect(f.emitterNote, verb).toMatch(/\S/);
    });

    it('server-only verbs are exactly the rows that say so, and include the auth trio', () => {
        expect(SERVER_ONLY_VERBS).toEqual(expect.arrayContaining(['LOGGED_IN', 'LOGGED_OUT', 'FAILED_LOGIN']));
        for (const verb of SERVER_ONLY_VERBS) expect(BASE_VERB_FACETS[verb].emitter).toBe('server');
    });

    it('the two verbs that used to have no metadata row now do', () => {
        expect(VERB_METADATA.SCROLLED).toEqual({ severity: 'DEBUG', category: 'NAVIGATION' });
        expect(VERB_METADATA.EDITED_MESSAGE).toEqual({ severity: 'DEBUG', category: 'COMMUNICATION' });
    });
});

describe('the folded registry (plugins included)', () => {
    it('every plugin verb has a completed, in-enum facet row', () => {
        const declared = PLUGIN_MANIFESTS.flatMap((m) => Object.keys(m.vocabulary.verbs));
        expect(declared.length).toBeGreaterThan(0);
        for (const verb of declared) {
            const f = VERB_FACETS[verb];
            expect(f, verb).toBeTruthy();
            expect(CLINICAL_STATES).toContain(f.clinicalState);
            expect(CLINICAL_ACTIONS).toContain(f.action);
            expect(MEDICAL_DOMAINS).toContain(f.domain);
            expect(PULSE_BUCKETS).toContain(f.pulseBucket);
            // A package verb is the plugin's to emit — or declared with a
            // note saying what surface would (RPS-1 R36); never rohy's.
            expect(['plugin', 'planned']).toContain(f.emitter);
            if (f.emitter === 'planned') expect(f.emitterNote, verb).toMatch(/\S/);
        }
    });

    it('LEARNING_VERBS has no duplicates and equals the facet keys', () => {
        expect(LEARNING_VERBS.length).toBe(new Set(LEARNING_VERBS).size);
        expect([...LEARNING_VERBS].sort()).toEqual(Object.keys(VERB_FACETS).sort());
    });
});

describe('aliases', () => {
    it('every alias points at a canonical verb, no alias is itself canonical, no cycles', () => {
        for (const [old, alias] of Object.entries(VERB_ALIASES)) {
            expect(LEARNING_VERBS, `${old} → ${alias.to}`).toContain(alias.to);
            expect(LEARNING_VERBS, `${old} must not also be canonical`).not.toContain(old);
            expect(VERB_ALIASES, `${alias.to} must not itself be aliased`).not.toHaveProperty(alias.to);
            expect(alias.since, `${old}.since`).toMatch(/\S/);
        }
    });

    it('normalizeVerb is total and idempotent', () => {
        expect(normalizeVerb('NOT_A_VERB')).toBe('NOT_A_VERB');
        expect(normalizeVerb(undefined)).toBeUndefined();
        for (const verb of LEARNING_VERBS) expect(normalizeVerb(normalizeVerb(verb))).toBe(normalizeVerb(verb));
    });

    it('normalizeEvent leaves a canonical row untouched', () => {
        const row = { verb: 'ORDERED_LAB', object_type: 'lab_test', object_id: 'cbc' };
        expect(normalizeEvent(row)).toEqual(row);
    });

    it('normalizeEvent reads a historical row as the canonical one, never overwriting what the row carries', () => {
        expect(normalizeEvent({ verb: 'VIEWED_HISTORY', object_type: 'patient_record' }))
            .toEqual({ verb: 'VIEWED_RECORD', object_type: 'patient_record', object_id: 'history' });
        expect(normalizeEvent({ verb: 'ORDERED_IV_FLUID', object_type: 'component' }))
            .toEqual({ verb: 'ORDERED_TREATMENT', object_type: 'iv_fluid' });
        // A row that already names its object type / id keeps it.
        expect(normalizeEvent({ verb: 'ORDERED_IV_FLUID', object_type: 'iv_fluid', object_id: 'ns' }))
            .toEqual({ verb: 'ORDERED_TREATMENT', object_type: 'iv_fluid', object_id: 'ns' });
        expect(normalizeEvent({ verb: 'CORRECT_ANSWER', object_type: 'question', result: 'kept' }))
            .toEqual({ verb: 'ANSWERED', object_type: 'question', result: 'kept' });
        expect(normalizeEvent({ verb: 'CORRECT_ANSWER', object_type: 'question' }).result).toBe('correct');
    });

    it('every historical treatment/record verb is aliased, none is still canonical', () => {
        for (const old of ['ORDERED_MEDICATION', 'ADMINISTERED_MEDICATION', 'VIEWED_LAB_RESULT', 'VIEWED_HISTORY',
            'ALARM_TRIGGERED', 'STT_RESULT', 'ERROR_OCCURRED', 'CORRECT_ANSWER', 'UNLOAD']) {
            expect(VERB_ALIASES[old], old).toBeTruthy();
            expect(LEARNING_VERBS).not.toContain(old);
        }
        expect(verbWithAliases('ORDERED_TREATMENT').sort()).toEqual(
            ['ORDERED_IV_FLUID', 'ORDERED_MEDICATION', 'ORDERED_NURSING', 'ORDERED_TREATMENT', 'STARTED_OXYGEN'],
        );
    });

    it('verbWithAliases always starts with the canonical verb', () => {
        expect(verbWithAliases('ORDERED_LAB')[0]).toBe('ORDERED_LAB');
    });
});

describe('completeFacets / validateFacets', () => {
    it('fills the derived fields from state and action', () => {
        const f = completeFacets('X', { severity: 'INFO', category: 'CLINICAL', clinicalState: 'investigating', emitter: 'client' });
        expect(f.action).toBe('Ordering');
        expect(f.label).toBe('X');
        expect(f.domain).toBe('Diagnostics');
        expect(f.tnaMerge).toBe('ORDERED_LAB');
        expect(f.pulseBucket).toBe('Investigations');
    });

    it('an explicit null tnaMerge survives completion (drop-from-sequences is a value)', () => {
        const f = completeFacets('X', { severity: 'INFO', category: 'SESSION', clinicalState: 'navigating', emitter: 'client', tnaMerge: null });
        expect(f.tnaMerge).toBeNull();
    });

    it('rejects an out-of-enum value naming the verb and field', () => {
        const bad = completeFacets('BAD', { severity: 'URGENT', category: 'CLINICAL', clinicalState: 'treating', emitter: 'client' });
        expect(() => validateFacets('BAD', bad)).toThrow(/BAD declares severity 'URGENT'/);
        const planned = completeFacets('P', { severity: 'INFO', category: 'CLINICAL', clinicalState: 'treating', emitter: 'planned' });
        expect(() => validateFacets('P', planned)).toThrow(/emitterNote/);
    });

    it('humanizeVerb title-cases an UPPER_SNAKE verb', () => {
        expect(humanizeVerb('SOME_NEW_VERB')).toBe('Some new verb');
        expect(humanizeVerb('')).toBe('Unknown');
    });
});

describe('resolveEventMetadata', () => {
    it('derives from the registry and honours an in-enum override', () => {
        expect(resolveEventMetadata('ORDERED_LAB')).toEqual({ ok: true, severity: 'IMPORTANT', category: 'CLINICAL' });
        expect(resolveEventMetadata('ORDERED_LAB', { severity: 'DEBUG' })).toEqual({ ok: true, severity: 'DEBUG', category: 'CLINICAL' });
    });

    it('reports an out-of-enum override rather than coercing it', () => {
        expect(resolveEventMetadata('ORDERED_LAB', { severity: 'URGENT' })).toEqual({ ok: false, field: 'severity', value: 'URGENT' });
        expect(resolveEventMetadata('ORDERED_LAB', { category: 'MISC' })).toEqual({ ok: false, field: 'category', value: 'MISC' });
    });

    it('consults severityByObjectType when the row declares one', () => {
        const f = completeFacets('X', {
            severity: 'IMPORTANT', category: 'CLINICAL', clinicalState: 'treating', emitter: 'client',
            severityByObjectType: { medication: 'CRITICAL' },
        });
        expect(f.severityByObjectType.medication).toBe('CRITICAL');
        // ORDERED_TREATMENT folds the old ORDERED_MEDICATION: a drug order
        // stays CRITICAL by object type, every other kind is IMPORTANT.
        expect(resolveEventMetadata('ORDERED_TREATMENT', {}, 'medication').severity).toBe('CRITICAL');
        expect(resolveEventMetadata('ORDERED_TREATMENT', {}, 'iv_fluid').severity).toBe('IMPORTANT');
        expect(resolveEventMetadata('ORDERED_TREATMENT').severity).toBe('IMPORTANT');
        // Through the alias, with no object type given, the alias's own
        // object type is NOT applied by resolveEventMetadata (the row is
        // stored with whatever the client sent) — callers pass object_type.
        expect(resolveEventMetadata('ORDERED_MEDICATION', {}, 'medication').severity).toBe('CRITICAL');
    });

    it('falls back to INFO/NAVIGATION for an unregistered verb', () => {
        expect(resolveEventMetadata('NOT_A_VERB')).toEqual({ ok: true, severity: 'INFO', category: 'NAVIGATION' });
    });
});
