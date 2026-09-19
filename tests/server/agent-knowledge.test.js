// The knowledge axis: what each persona is given about the case.
//
// Mirrors tests/server/specialties.test.js, because agentKnowledge.js mirrors
// specialties.js: frozen constants, a field allow-list, and a normalize()
// that returns {value, errors} so a caller that persists can refuse.

import { describe, expect, it } from 'vitest';
import {
    KNOWLEDGE_SCOPES,
    KNOWLEDGE_TYPES,
    LEGACY_SCOPE_BY_CONTEXT_FILTER,
    defaultKnowledgeFor,
    normalizeKnowledge,
    scopeAtLeast,
    serverBuildsSituation,
} from '../../server/shared/agentKnowledge.js';

describe('the scope ladder', () => {
    it('is ordered from knowing nothing to knowing the whole chart', () => {
        expect(KNOWLEDGE_SCOPES).toEqual(['none', 'handover', 'summary', 'history', 'chart']);
    });

    it('is frozen, along with every shipped default', () => {
        expect(Object.isFrozen(KNOWLEDGE_SCOPES)).toBe(true);
        expect(Object.isFrozen(KNOWLEDGE_TYPES)).toBe(true);
        expect(Object.isFrozen(LEGACY_SCOPE_BY_CONTEXT_FILTER)).toBe(true);
        for (const type of KNOWLEDGE_TYPES) {
            expect(Object.isFrozen(defaultKnowledgeFor(type))).toBe(true);
        }
    });

    it('compares scopes by rank, and reads an unknown scope as narrow', () => {
        expect(scopeAtLeast('chart', 'history')).toBe(true);
        expect(scopeAtLeast('history', 'history')).toBe(true);
        expect(scopeAtLeast('summary', 'history')).toBe(false);
        expect(scopeAtLeast('none', 'handover')).toBe(false);
        // Fail narrow, not wide: a typo must not widen what an agent knows.
        expect(scopeAtLeast('bogus', 'none')).toBe(false);
        expect(scopeAtLeast('chart', 'bogus')).toBe(false);
    });

    it('names the two scopes the SERVER assembles', () => {
        // The trust boundary: for these the route drops the client's text and
        // builds the block itself, so a tampered browser cannot widen what the
        // agent knows.
        expect(serverBuildsSituation('none')).toBe(true);
        expect(serverBuildsSituation('handover')).toBe(true);
        expect(serverBuildsSituation('summary')).toBe(false);
        expect(serverBuildsSituation('chart')).toBe(false);
        expect(serverBuildsSituation(undefined)).toBe(false);
    });
});

describe('the shipped defaults', () => {
    it('gives no persona the answer key', () => {
        // The single most important invariant here. Every type ships with
        // answerKey false; holding the expected diagnosis is something an
        // educator turns on, per case, deliberately.
        for (const type of KNOWLEDGE_TYPES) {
            expect(defaultKnowledgeFor(type).answerKey).toBe(false);
        }
    });

    it('ships each persona the scope its role implies', () => {
        expect(defaultKnowledgeFor('nurse')).toEqual({ scope: 'chart', answerKey: false, record: true });
        expect(defaultKnowledgeFor('consultant')).toEqual({ scope: 'chart', answerKey: false, record: true });
        expect(defaultKnowledgeFor('relative')).toEqual({ scope: 'history', answerKey: false, record: false });
        expect(defaultKnowledgeFor('discussant')).toEqual({ scope: 'summary', answerKey: false, record: true });
    });

    it('gives every on-call specialist the `none` scope', () => {
        // `none` IS what a specialist already did: the route drops the client
        // situation and specialistBrief.js builds a findings-only brief.
        // config.disclosure remains their findings sub-gate on top of it.
        for (const type of ['pathologist', 'cardiologist', 'radiologist', 'laboratorian']) {
            expect(defaultKnowledgeFor(type)).toEqual({ scope: 'none', answerKey: false, record: false });
        }
    });

    it('withholds the encounter record from anyone who should not have it', () => {
        expect(defaultKnowledgeFor('relative').record).toBe(false);
        expect(defaultKnowledgeFor('cardiologist').record).toBe(false);
    });

    it('reads an unknown type as knowing nothing', () => {
        // Safe direction for a mistake: a type added later is private until
        // somebody decides otherwise.
        expect(defaultKnowledgeFor('invented')).toEqual({ scope: 'none', answerKey: false, record: false });
        expect(defaultKnowledgeFor(undefined)).toEqual({ scope: 'none', answerKey: false, record: false });
        expect(defaultKnowledgeFor('constructor')).toEqual({ scope: 'none', answerKey: false, record: false });
        expect(defaultKnowledgeFor('__proto__')).toEqual({ scope: 'none', answerKey: false, record: false });
    });

    it('does not list the patient, whose prompt is built by another path', () => {
        expect(KNOWLEDGE_TYPES).not.toContain('patient');
    });
});

describe('normalizeKnowledge', () => {
    it('returns the type default when nothing is stored', () => {
        const { value, errors } = normalizeKnowledge({ agentType: 'nurse' });
        expect(value).toEqual({ scope: 'chart', answerKey: false, record: true });
        expect(errors).toEqual([]);
        expect(normalizeKnowledge({ agentType: 'nurse', knowledge: null }).value).toEqual(value);
    });

    it('falls back to the legacy context_filter column for an unmigrated agent', () => {
        // Each mapping reproduces the sections the old value emitted, so an
        // agent nobody has migrated keeps exactly the behaviour it had.
        expect(normalizeKnowledge({ agentType: 'nurse', contextFilter: 'minimal' }).value.scope).toBe('none');
        expect(normalizeKnowledge({ agentType: 'nurse', contextFilter: 'vitals' }).value.scope).toBe('summary');
        expect(normalizeKnowledge({ agentType: 'nurse', contextFilter: 'history' }).value.scope).toBe('history');
        expect(normalizeKnowledge({ agentType: 'nurse', contextFilter: 'full' }).value.scope).toBe('chart');
    });

    it('preserves the answer key for a legacy `full` agent', () => {
        // Regression lock. `full` was the rung that carried the answer key,
        // and an install that has not been backfilled must not be silently
        // narrowed — nor silently widened.
        expect(normalizeKnowledge({ agentType: 'consultant', contextFilter: 'full' }).value.answerKey).toBe(true);
        expect(normalizeKnowledge({ agentType: 'consultant', contextFilter: 'history' }).value.answerKey).toBe(false);
    });

    it('ignores an unrecognised context_filter and keeps the type default', () => {
        expect(normalizeKnowledge({ agentType: 'discussant', contextFilter: 'sideways' }).value)
            .toEqual({ scope: 'summary', answerKey: false, record: true });
    });

    it('lets a stored knowledge block outrank the legacy column', () => {
        const { value } = normalizeKnowledge({
            agentType: 'consultant',
            contextFilter: 'full',
            knowledge: { scope: 'none' },
        });
        // The stored scope wins, and the fields it does not name keep the TYPE
        // default rather than the legacy reading — so choosing a scope cannot
        // hand somebody the answer key as a side effect.
        expect(value).toEqual({ scope: 'none', answerKey: false, record: true });
    });

    it('merges a partial block over the default', () => {
        expect(normalizeKnowledge({ agentType: 'nurse', knowledge: { scope: 'handover' } }).value)
            .toEqual({ scope: 'handover', answerKey: false, record: true });
        expect(normalizeKnowledge({ agentType: 'nurse', knowledge: { record: false } }).value)
            .toEqual({ scope: 'chart', answerKey: false, record: false });
    });

    it('accepts every scope in the ladder', () => {
        for (const scope of KNOWLEDGE_SCOPES) {
            const { value, errors } = normalizeKnowledge({ agentType: 'nurse', knowledge: { scope } });
            expect(errors).toEqual([]);
            expect(value.scope).toBe(scope);
        }
    });

    it('reports one error per bad field and still applies the good ones', () => {
        const { value, errors } = normalizeKnowledge({
            agentType: 'nurse',
            knowledge: { scope: 'everything', answerKey: 'yes', record: false },
        });
        expect(errors).toHaveLength(2);
        expect(errors[0]).toMatch(/scope must be one of/);
        expect(errors[1]).toMatch(/answerKey must be a boolean/);
        expect(value.scope).toBe('chart');       // the default survived
        expect(value.record).toBe(false);        // the valid field applied
    });

    it('rejects an unknown field rather than ignoring it', () => {
        // A typo in a case config must surface. A stored setting that never
        // fires is worse than no setting — the lesson of requireInterpretation.
        const { errors } = normalizeKnowledge({ agentType: 'nurse', knowledge: { scop: 'chart' } });
        expect(errors).toEqual(['unknown knowledge field: scop']);
    });

    it('rejects a non-object', () => {
        expect(normalizeKnowledge({ agentType: 'nurse', knowledge: 'chart' }).errors)
            .toEqual(['knowledge must be an object']);
        expect(normalizeKnowledge({ agentType: 'nurse', knowledge: ['chart'] }).errors)
            .toEqual(['knowledge must be an object']);
    });

    it('never mutates the shared default', () => {
        const before = { ...defaultKnowledgeFor('nurse') };
        const { value } = normalizeKnowledge({ agentType: 'nurse', knowledge: { scope: 'none' } });
        value.scope = 'chart';
        value.record = false;
        expect(defaultKnowledgeFor('nurse')).toEqual(before);
    });

    it('survives being called with nothing at all', () => {
        const { value, errors } = normalizeKnowledge();
        expect(errors).toEqual([]);
        expect(value).toEqual({ scope: 'none', answerKey: false, record: false });
    });
});
