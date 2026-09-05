// Regression lock: the learning-event verb whitelist and the two ingest paths.
//
// Before RPS-1, `LEARNING_VERBS` was a hardcoded array inside
// analytics-routes.js that contained ZERO plugin verbs, and:
//   - POST /learning-events       validated against it  -> plugin event = 400
//   - POST /learning-events/batch validated only presence -> same event = 200
// So whether an event was validated at all depended on which endpoint the
// client happened to use, and the pathology room's events survived only
// because EventLogger batches. Both paths now share one registry.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LEARNING_VERBS, BASE_LEARNING_VERBS } from '../../server/shared/learningVerbs.js';
import { PLUGIN_MANIFESTS } from '../../server/shared/plugins/manifests.generated.js';

const ROUTES = readFileSync(
    path.join(import.meta.dirname, '..', '..', 'server', 'routes', 'analytics-routes.js'),
    'utf8',
);
const INGEST = readFileSync(
    path.join(import.meta.dirname, '..', '..', 'server', 'lib', 'learningEventIngest.js'),
    'utf8',
);

describe('learning verb whitelist', () => {
    it('accepts every verb a registered plugin declares', () => {
        const declared = PLUGIN_MANIFESTS.flatMap((m) => Object.keys(m.vocabulary.verbs));
        expect(declared.length).toBeGreaterThan(0);
        declared.forEach((verb) => expect(LEARNING_VERBS).toContain(verb));
    });

    it('still accepts rohy\'s own base verbs', () => {
        expect(LEARNING_VERBS).toEqual(expect.arrayContaining(BASE_LEARNING_VERBS));
    });

    it('contains no duplicates, so a plugin cannot shadow a base verb unnoticed', () => {
        expect(LEARNING_VERBS.length).toBe(new Set(LEARNING_VERBS).size);
    });
});

describe('both ingest paths validate', () => {
    // Source-level, in the same spirit as src/storage/registry.test.js: the
    // property being locked is "neither handler stopped checking", which is
    // invisible to a request-level test that only ever sends valid verbs.
    // Both handlers now delegate to ONE core (server/lib/learningEventIngest.js);
    // the lock is that both still go through it, and that it still checks.
    it('the single-event and batch handlers both go through ingestEvents()', () => {
        const calls = ROUTES.match(/await ingestEvents\(\{/g) ?? [];
        expect(calls.length).toBeGreaterThanOrEqual(2);
        expect(ROUTES).not.toContain('INSERT INTO learning_events (');
    });

    it('the core checks LEARNING_VERBS and reports an unknown verb as its own reason', () => {
        expect(INGEST).toContain('LEARNING_VERBS.includes(verb)');
        expect(INGEST).toContain("'unknown_verb'");
        expect(INGEST).toContain('INSERT INTO learning_events_rejected');
    });
});
