// RPS-1 1.6 gates on the SHIPPED manifests (R33, R34, R36).
//
// `validateManifest` accepts a v1 vocabulary so a test can build one; the
// generator refuses to ship one. This test is the same refusal, run against
// the generated file every suite run — so the repository cannot carry a
// plugin whose rows would be labelled by a guess, whose components are not
// namespaced, or whose vocabulary lists verbs nothing produces.
import { describe, it, expect } from 'vitest';
import { PLUGIN_MANIFESTS } from '../../server/shared/plugins/manifests.generated.js';
import {
    assertShippedManifest, validateManifest, MANIFEST_FACET_FIELDS, SHIPPED_VOCABULARY_VERSION,
} from '../../server/shared/pluginRegistry.js';
import '../../server/shared/learningVerbs.js';
import { checkPluginEmissions, helperVerbMap } from '../../scripts/check-plugin-emissions.mjs';

describe('R33/R34: every shipped manifest declares a v2 vocabulary with a component prefix', () => {
    it('no v1 manifest remains', () => {
        for (const m of PLUGIN_MANIFESTS) {
            expect(m.vocabulary.version, m.id).toBe(SHIPPED_VOCABULARY_VERSION);
            expect(typeof m.vocabulary.componentPrefix, m.id).toBe('string');
            expect(() => assertShippedManifest(validateManifest(m))).not.toThrow();
        }
    });

    it('every verb row carries the five declared facets (nothing derived by the host)', () => {
        for (const m of PLUGIN_MANIFESTS) {
            for (const [verb, meta] of Object.entries(m.vocabulary.verbs)) {
                for (const field of MANIFEST_FACET_FIELDS) expect(meta[field], `${m.id}:${verb}.${field}`).toBeTruthy();
            }
        }
    });

    it('the gate refuses a v1 vocabulary and a missing prefix, and names the rule', () => {
        const base = PLUGIN_MANIFESTS.find((m) => m.id === 'room3d');
        expect(() => assertShippedManifest({ ...base, vocabulary: { ...base.vocabulary, version: 1 } })).toThrow(/R33/);
        const { componentPrefix: _p, ...noPrefix } = base.vocabulary;
        expect(() => assertShippedManifest({ ...base, vocabulary: noPrefix })).toThrow(/R34/);
    });
});

describe('R36: every declared plugin verb is emitted, server-only, or planned with a note', () => {
    const result = checkPluginEmissions(PLUGIN_MANIFESTS);

    it('no plugin declares a verb nothing produces', () => {
        const missing = result.plugins.flatMap((p) => p.missing.map((v) => `${p.id}:${v}`));
        expect(missing).toEqual([]);
        expect(result.ok).toBe(true);
    });

    it('planned verbs are listed with a note, and the list only shrinks', () => {
        const planned = result.plugins.flatMap((p) => p.planned.map((x) => ({ id: p.id, ...x })));
        // eslint-disable-next-line no-console
        console.log(`plugin verbs planned (no surface yet): ${planned.map((x) => `${x.id}:${x.verb} — ${x.note}`).join('\n  ')}`);
        for (const x of planned) expect(x.note, `${x.id}:${x.verb}`).toMatch(/\S/);
        // Ratchet: ecg 3 (hint, explanation, submit) + pathology 3 (diagnosis
        // pair, second opinion). Lower it when one is wired; never raise it.
        expect(planned.length).toBeLessThanOrEqual(6);
    });

    it('each plugin emits most of what it declares', () => {
        for (const p of result.plugins) {
            expect(p.emitted.length, p.id).toBeGreaterThanOrEqual(p.declared - p.planned.length - p.serverOnly.length);
        }
    });

    it('the helper map reads a logger factory, including a kind-map helper', () => {
        const src = `
export function createLogger(logger) {
    const emit = () => {};
    return {
        emit,
        aThing: (x) => emit(VERBS.DID_A, 'thing', { x }),
        drawn: (a) => emit(
            VERB_BY_KIND[a.kind] ?? VERBS.DREW,
            'thing',
        ),
    };
}
const VERB_BY_KIND = { line: 'MEASURED', frame: 'COUNTED' };
`;
        const map = helperVerbMap(src, new Set(['DID_A', 'DREW', 'MEASURED', 'COUNTED', 'UNUSED']));
        expect(map.get('aThing')).toEqual(['DID_A']);
        expect(new Set(map.get('drawn'))).toEqual(new Set(['DREW', 'MEASURED', 'COUNTED']));
        expect(map.has('emit')).toBe(false);
    });
});
