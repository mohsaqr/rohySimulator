// History parity: every verb that existed before the facet registry still
// MEANS what it meant.
//
// tests/fixtures/verb-maps-v1.json is a snapshot of the five hand-written
// analytics maps as they were at v3.0.0-beta.9. Since then verbs have been
// renamed and folded (ORDERED_MEDICATION → ORDERED_TREATMENT/medication,
// VIEWED_HISTORY → VIEWED_RECORD/history, …) and every consumer derives from
// one facet row. Historical rows are never rewritten; they are read through
// VERB_ALIASES. This test proves that reading an OLD verb through the alias
// map yields the same clinical state, action and TNA target the old maps
// gave it — so the rename is a rename, not a reinterpretation of history.
//
// A deliberate change of meaning is listed in INTENDED, with the reason, and
// is the only kind of difference allowed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    OBJECT_OVERRIDES, DEFAULT_INTERPRETATIONS, ACTION_TO_DOMAIN,
    resolveClinicalState, clinicalAction, fineLabel, tnaMergeTarget,
} from '../../server/shared/eventFacets.js';
import { VERB_METADATA, VERB_ALIASES, LEARNING_VERBS, normalizeEvent, resolveEventMetadata } from '../../server/shared/learningVerbs.js';

const fixture = JSON.parse(readFileSync(
    path.join(import.meta.dirname, '..', 'fixtures', 'verb-maps-v1.json'), 'utf8',
));

// The one verb the old maps carried that no producer ever emitted and no row
// ever held: it was in two analytics maps and in no vocabulary.
const NEVER_A_VERB = new Set(['ORDERED_INVESTIGATION']);

// A TNA bucket that was renamed along with the verbs it collects.
const TNA_BUCKET_ALIASES = { VIEWED_LAB_RESULT: 'VIEWED_RESULT' };

// Meaning changes made ON PURPOSE with the rename, each with its reason.
const INTENDED = {
    tnaMerge: {
        // A scored order used to enter the TNA network twice — once as the
        // order (TREATMENT) and once as the judgement about it. The judgement
        // rows now stay out of sequences; the order itself is still merged.
        CONTRAINDICATED_TREATMENT_ORDERED: null,
        EXPECTED_TREATMENT_GIVEN: null,
        EXPECTED_TREATMENT_MISSED: null,
    },
    clinicalState: {},
    action: {},
    severity: {
        // ANSWERED carries the outcome in `result`; severity no longer
        // encodes correctness (CORRECT_ANSWER was IMPORTANT, INCORRECT INFO).
        CORRECT_ANSWER: 'INFO',
        // Radoyon 0.4 (vocabulary v2) grades its own acts the way rohy grades
        // the equivalent core ones: a measurement and a full-stack review are
        // deliberate acts (ACTION, like ORDERED_LAB), and filing a report is
        // the committed opinion (IMPORTANT, like SUBMITTED_DEBRIEF). The
        // package owns its vocabulary; these are its 0.4 decisions.
        MEASURED_DISTANCE: 'ACTION',
        MEASURED_REGION: 'ACTION',
        REVIEWED_SERIES: 'ACTION',
        SUBMITTED_REPORT: 'IMPORTANT',
    },
    category: {
        // A flagged contraindication is a judgement about an order, like the
        // expected-treatment verbs beside it: ASSESSMENT, not CLINICAL.
        CONTRAINDICATED_TREATMENT_ORDERED: 'ASSESSMENT',
        // Searching and filtering are UI moves; the object type (lab_test)
        // says what was searched and still resolves to `investigating`.
        SEARCHED_LABS: 'NAVIGATION',
        FILTERED_LABS: 'NAVIGATION',
    },
};

const oldVerbs = Object.keys(fixture.verbMetadata).filter((v) => !NEVER_A_VERB.has(v));

describe('every pre-registry verb keeps its meaning when read through the alias map', () => {
    it.each(oldVerbs)('%s', (old) => {
        const alias = VERB_ALIASES[old];
        const row = normalizeEvent({ verb: old, object_type: '' });
        const objectType = row.object_type || '';

        // 1. It is either still canonical, or aliased to something canonical.
        expect(alias ? LEARNING_VERBS.includes(alias.to) : LEARNING_VERBS.includes(old), 'reachable').toBe(true);

        // 2. severity / category as persisted for a new row of the same act.
        const meta = resolveEventMetadata(old, {}, objectType || undefined);
        const v1 = fixture.verbMetadata[old];
        expect(meta.category, 'category').toBe(INTENDED.category[old] ?? v1.category);
        expect(meta.severity, 'severity').toBe(INTENDED.severity[old] ?? v1.severity);

        // 3. clinical state (the old verb fallback).
        if (old in fixture.verbFallbacks) {
            expect(resolveClinicalState(old, ''), 'clinical state').toBe(INTENDED.clinicalState[old] ?? fixture.verbFallbacks[old]);
        }
        // 4. clinical action.
        if (old in fixture.clinicalActionByVerb) {
            expect(clinicalAction(old, ''), 'clinical action').toBe(INTENDED.action[old] ?? fixture.clinicalActionByVerb[old]);
        }
        // 5. fine label — same words for the same act.
        if (old in fixture.fineLabelByVerb) {
            expect(fineLabel(old, ''), 'fine label').toBe(fixture.fineLabelByVerb[old]);
        }
        // 6. TNA merge target.
        if (old in fixture.tnaVerbMergeMap) {
            const expected = old in INTENDED.tnaMerge
                ? INTENDED.tnaMerge[old]
                : (TNA_BUCKET_ALIASES[fixture.tnaVerbMergeMap[old]] ?? fixture.tnaVerbMergeMap[old]);
            expect(tnaMergeTarget(old), 'tna merge').toBe(expected);
        }
    });
});

describe('the object-first chain is unchanged', () => {
    it('object type → state covers every v1 override with the same state', () => {
        for (const [type, state] of Object.entries(fixture.objectOverrides)) {
            expect(OBJECT_OVERRIDES[type], type).toBe(state);
        }
    });
    it('verb:object interpretations are unchanged', () => {
        for (const [pair, state] of Object.entries(fixture.defaultInterpretations)) {
            expect(DEFAULT_INTERPRETATIONS[pair], pair).toBe(state);
        }
    });
    it('action → domain is unchanged for every v1 action', () => {
        for (const [action, domain] of Object.entries(fixture.actionToDomain)) {
            expect(ACTION_TO_DOMAIN[action], action).toBe(domain);
        }
    });
});

describe('the registry only grew', () => {
    it('every plugin verb the v1 maps knew is still registered', () => {
        for (const verb of fixture.learningVerbs) {
            if (VERB_ALIASES[verb]) continue;
            expect(LEARNING_VERBS, verb).toContain(verb);
        }
    });
    it('severity/category are present for every registered verb', () => {
        for (const verb of LEARNING_VERBS) expect(VERB_METADATA[verb], verb).toBeTruthy();
    });
});
