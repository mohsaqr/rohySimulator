// RPS-1 plugin standard — contract tests.
//
// These lock the two properties that make the standard worth having:
//   1. a collision is LOUD (the old raw spread silently overwrote)
//   2. a plugin gates itself, and being unavailable excludes it quietly
//      rather than taking rohy down
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    foldManifests, mergeNamespace, validateManifest, CLINICAL_STATES, roleAllows, ROLE_RANKS,
} from '../../server/shared/pluginRegistry.js';
import { PLUGIN_MANIFESTS } from '../../server/shared/plugins/manifests.generated.js';
import { VERBS, OBJECT_TYPES } from '../../src/services/eventLogger.js';
import { VERB_FALLBACKS, resolveClinicalState } from '../../src/components/analytics/tna/clinicalStates.js';
import { resolveRemoteRefs, createPluginContext } from '../../src/plugins/context.js';

const validManifest = (over = {}) => ({
    id: 'demo',
    room: { key: 'demo', labelKey: 'room_demo', icon: 'Microscope', accent: 'teal', order: 60 },
    vocabulary: { verbs: { DID_A_THING: { severity: 'INFO', category: 'CLINICAL' } }, objectTypes: { THING: 'thing' } },
    states: { verbFallbacks: { DID_A_THING: 'assessing' } },
    ...over,
});

describe('manifest validation', () => {
    it('accepts a well-formed manifest', () => {
        expect(() => validateManifest(validManifest())).not.toThrow();
    });

    it('rejects an id that is not also the room key, so one id identifies the plugin everywhere', () => {
        const bad = validManifest({ room: { ...validManifest().room, key: 'something_else' } });
        expect(() => validateManifest(bad)).toThrow(/must match/);
    });

    it('rejects a verb with no severity/category, which would throw at emit time', () => {
        const bad = validManifest({ vocabulary: { verbs: { DID_A_THING: {} } } });
        expect(() => validateManifest(bad)).toThrow(/severity/);
    });

    it('rejects a verb mapped to a state that does not exist', () => {
        const bad = validManifest({ states: { verbFallbacks: { DID_A_THING: 'vibing' } } });
        expect(() => validateManifest(bad)).toThrow(/not a clinical state/);
    });

    it('rejects an unknown capability rather than silently granting nothing', () => {
        expect(() => validateManifest(validManifest({ capabilities: ['root'] }))).toThrow(/unknown capability/);
    });

    // The five below were found by an adversarial review pass. Each was
    // ACCEPTED by the first version of validateManifest, and each fails
    // somewhere far from the manifest — which is the whole problem.
    it('rejects a plugin claiming a core room key', () => {
        // Core rooms are matched earlier in App.jsx's render chain, so such a
        // plugin renders a duplicate navigator tab and can never mount.
        ['chat', 'lab', 'radiology', 'examination', 'consultant'].forEach((key) => {
            const bad = validManifest({ id: key, room: { ...validManifest().room, key } });
            expect(() => validateManifest(bad)).toThrow(/core rohy room/);
        });
    });

    it('rejects a severity or category outside the learning_events CHECK constraints', () => {
        // sqlite rejects the INSERT and the event is lost with nothing raised.
        expect(() => validateManifest(validManifest({
            vocabulary: { verbs: { DID_A_THING: { severity: 'URGENT', category: 'CLINICAL' } } },
        }))).toThrow(/only accepts DEBUG/);
        expect(() => validateManifest(validManifest({
            vocabulary: { verbs: { DID_A_THING: { severity: 'INFO', category: 'VIBES' } } },
        }))).toThrow(/only accepts SESSION/);
    });

    it('rejects a verb with no state mapping at all', () => {
        // Unmapped verbs silently pollute every TNA model with a literal
        // `${verb}_${objectType}` bucket nobody declared.
        expect(() => validateManifest(validManifest({ states: {} }))).toThrow(/no verbFallback/);
    });

    // Ownership: mergeNamespace catches OVERWRITING an existing key, but not
    // CLAIMING an unclaimed one that belongs to rohy semantically.
    it('rejects a plugin interpreting an event pair built from vocabulary it does not own', () => {
        expect(() => validateManifest(validManifest({
            states: { verbFallbacks: { DID_A_THING: 'assessing' }, interpretations: { 'ORDERED_LAB:lab_test': 'reflecting' } },
        }))).toThrow(/involves neither its own verbs nor its own object types/);
    });

    it('rejects a plugin overriding a core object_type', () => {
        expect(() => validateManifest(validManifest({
            states: { verbFallbacks: { DID_A_THING: 'assessing' }, objectOverrides: { lab_test: 'reflecting' } },
        }))).toThrow(/which it does not declare/);
    });
});

describe('collision safety', () => {
    // Regression lock: rohy used to merge plugin vocabulary with a raw spread
    // (`{...BASE_VERBS, ...PATHOLOGY_VERBS}`), so a future rohy verb colliding
    // with a plugin verb was silently overwritten and existing analytics rows
    // quietly changed meaning. A spread cannot be made safe by a comment.
    it('throws when a plugin verb collides with a rohy verb', () => {
        expect(() => mergeNamespace({ VIEWED: 'VIEWED' }, { VIEWED: 'VIEWED' }, { label: 'VERBS', source: 'demo' }))
            .toThrow(/collides with rohy's VERBS: VIEWED/);
    });

    it('throws when two plugins collide with each other, not just with rohy', () => {
        const a = validManifest({ id: 'a', room: { ...validManifest().room, key: 'a' } });
        const b = validManifest({ id: 'b', room: { ...validManifest().room, key: 'b' } });
        expect(() => foldManifests([a, b])).toThrow(/Plugin 'b' collides/);
    });

    it('does not mutate the base maps it is given', () => {
        const base = { verbs: { VIEWED: 'VIEWED' } };
        const frozen = { ...base.verbs };
        foldManifests([validManifest()], base);
        expect(base.verbs).toEqual(frozen);
    });
});

describe('the installed plugins, as rohy actually merges them', () => {
    it('every plugin verb reaches the merged eventLogger vocabulary', () => {
        const declared = PLUGIN_MANIFESTS.flatMap((m) => Object.keys(m.vocabulary.verbs));
        expect(declared.length).toBeGreaterThan(0);
        declared.forEach((verb) => expect(VERBS[verb]).toBe(verb));
    });

    it('rohy base verbs survive the merge', () => {
        expect(VERBS.STARTED_SESSION).toBe('STARTED_SESSION');
        expect(OBJECT_TYPES).toBeTruthy();
    });

    // The whole reason plugin rows land in learning_events rather than a table
    // of their own: they have to be analysable next to a lab order.
    it('every plugin verb resolves to a real clinical state, never a literal bucket', () => {
        PLUGIN_MANIFESTS.forEach((m) => {
            Object.keys(m.vocabulary.verbs).forEach((verb) => {
                expect(CLINICAL_STATES).toContain(VERB_FALLBACKS[verb]);
                const objectType = Object.values(m.vocabulary.objectTypes)[0];
                expect(resolveClinicalState(verb, objectType)).not.toBe(`${verb}_${objectType}`);
            });
        });
    });
});

describe('availability actually gates the navigator', () => {
    // Regression lock: `enabledPlugins` was originally passed to exactly ONE of
    // App.jsx's five <RoomNavigator> mounts — the one nested inside PluginRoom.
    // Since the prop defaults to null ("no opinion, show everything"), the gate
    // only applied once the learner was already inside the plugin room, which
    // is precisely backwards: from chat/exam/lab/radiology/consultant a case
    // with no pathology material still advertised a Pathology tab.
    //
    // Source-level, in the same spirit as src/storage/registry.test.js: the
    // property is "no mount forgot the prop", which a render test of a single
    // mount cannot see.
    const APP = readFileSync(path.join(import.meta.dirname, '..', '..', 'src', 'App.jsx'), 'utf8');

    // Counted PER MOUNT rather than by counting the two strings in the whole
    // file. A bare occurrence count says "the prop appears as often as the
    // component does", which is true of a file that passes it to something
    // else entirely — and became false the moment InvestigationsScreen started
    // taking the same list to offer the crossing into the PACS room. The
    // property being locked is that each <RoomNavigator …/> carries it.
    it('every RoomNavigator mount in App.jsx passes enabledPlugins', () => {
        const mounts = APP.split('<RoomNavigator').slice(1)
            .map((tail) => tail.slice(0, tail.indexOf('/>')));
        expect(mounts.length).toBeGreaterThan(0);
        const ungated = mounts.filter((props) => !props.includes('enabledPlugins={enabledPlugins}'));
        expect(ungated).toEqual([]);
    });

    it('a declined plugin room does not mount, rather than rendering its own empty state', () => {
        expect(APP).toMatch(/enabledPlugins\.includes\(currentRoom\)\s*\n?\s*\?\s*pluginRegistry\.get\(currentRoom\)/);
    });
});

describe('the two registries cannot drift apart', () => {
    // Regression lock: the generator selected directories containing
    // manifest.js while runtime discovery globbed index.jsx. A manifest-only
    // folder became a server whitelist + navigation entry with nothing to
    // mount; an index-only folder mounted client-side while the server
    // rejected every event it emitted.
    const GEN = readFileSync(path.join(import.meta.dirname, '..', '..', 'scripts', 'gen-plugin-manifests.mjs'), 'utf8');

    it('the generator requires BOTH manifest.js and index.jsx', () => {
        expect(GEN).toContain("'manifest.js'");
        expect(GEN).toContain("'index.jsx'");
    });

    it('plugins:check is a build gate, not an optional script', () => {
        const pkg = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', '..', 'package.json'), 'utf8'));
        expect(pkg.scripts.prebuild).toContain('plugins:check');
    });

    it('every generated manifest still validates under the current rules', () => {
        PLUGIN_MANIFESTS.forEach((m) => expect(() => validateManifest(m)).not.toThrow());
    });
});

describe('capability adapters cannot be subverted by the plugin', () => {
    it('a plugin cannot overwrite its own notify attribution', async () => {
        const { createPluginContext } = await import('../../src/plugins/context.js');
        const seen = [];
        const ctx = createPluginContext({
            manifest: { id: 'demo', capabilities: ['notify'] },
            session: { id: 1 },
            notify: (n) => seen.push(n),
        });
        ctx.capabilities.notify({ source: 'monitor', message: 'spoofed' });
        expect(seen[0].source).toBe('plugin:demo');
    });

    it('an ungranted capability is absent rather than a broken stub', async () => {
        const { createPluginContext } = await import('../../src/plugins/context.js');
        const ctx = createPluginContext({
            manifest: { id: 'demo', capabilities: ['llm'] },
            session: { id: 1 },
        });
        expect(ctx.capabilities.llm).toBeUndefined();
    });
});

// --- the authoring slot (RPS-1 §11) --------------------------------------
//
// A room is where a learner USES a plugin's material; an authoring surface is
// where someone MAKES it. The two have opposite gates, which is why authoring
// is its own slot rather than a second mode of the room.

describe('the authoring slot', () => {
    const withAuthoring = (authoring) => validManifest({ authoring });

    it('accepts a well-formed authoring block', () => {
        expect(() => validateManifest(withAuthoring({ labelKey: 'x', minRole: 'educator' }))).not.toThrow();
    });

    it('is entirely optional — most plugins have no editor', () => {
        expect(() => validateManifest(validManifest())).not.toThrow();
        expect(validManifest().authoring).toBeUndefined();
    });

    it('REQUIRES minRole rather than inheriting one', () => {
        // Authoring writes the material every learner is then assessed
        // against. Silently inheriting the room's 'student' would be the most
        // consequential possible default to get wrong, so it must be stated.
        expect(() => validateManifest(withAuthoring({ labelKey: 'x' }))).toThrow(/must state who may open it/);
    });

    it('rejects an authoring gate weaker than the room it edits', () => {
        const bad = withAuthoring({ labelKey: 'x', minRole: 'guest' });
        expect(() => validateManifest({ ...bad, minRole: 'educator' }))
            .toThrow(/cannot be easier to reach than reading it/);
    });

    it('rejects a role that is not a rohy role', () => {
        expect(() => validateManifest(withAuthoring({ labelKey: 'x', minRole: 'teacher' })))
            .toThrow(/not a rohy role/);
        expect(() => validateManifest(validManifest({ minRole: 'superuser' })))
            .toThrow(/not a rohy role/);
    });

    it('rejects an authoring block with no label, which would render blank', () => {
        expect(() => validateManifest(withAuthoring({ minRole: 'educator' }))).toThrow(/labelKey/);
    });
});

describe('roleAllows', () => {
    it('is the shared gate for both surfaces', () => {
        expect(roleAllows('educator', 'educator')).toBe(true);
        expect(roleAllows('admin', 'educator')).toBe(true);
        expect(roleAllows('student', 'educator')).toBe(false);
        expect(roleAllows('guest', 'student')).toBe(false);
    });

    it("treats the legacy 'user' role as 'student', as normalizeRole does", () => {
        expect(roleAllows('user', 'student')).toBe(true);
    });

    it('treats an absent minRole as open, and an unknown role as guest', () => {
        expect(roleAllows('guest', undefined)).toBe(true);
        expect(roleAllows('wizard', 'student')).toBe(false);
    });

    it('agrees with the server ROLE_RANKS it duplicates', () => {
        // The shared module cannot import server/middleware/auth.js — the
        // client loads it too — so the ranks are copied. This is the check
        // that keeps the copy honest.
        const auth = readFileSync(path.resolve('server/middleware/auth.js'), 'utf8');
        const block = auth.slice(auth.indexOf('ROLE_RANKS = Object.freeze({'));
        Object.entries(ROLE_RANKS).forEach(([role, rank]) => {
            expect(block).toMatch(new RegExp(`${role}:\\s*${rank}`));
        });
    });
});

describe('the shipped pathology manifest', () => {
    it('declares an authoring surface gated above its room', () => {
        const pathology = PLUGIN_MANIFESTS.find((m) => m.id === 'pathology');
        expect(pathology.authoring).toBeDefined();
        expect(roleAllows(pathology.minRole, pathology.authoring.minRole)).toBe(false);
        expect(roleAllows('educator', pathology.authoring.minRole)).toBe(true);
    });
});

describe("the 'remote' capability", () => {
    const remoteManifest = (over = {}) => validManifest({
        capabilities: ['remote'],
        remote: { paths: ['/tiles'], contentTypes: ['image/jpeg'] },
        ...over,
    });

    it('accepts a well-formed declaration', () => {
        expect(() => validateManifest(remoteManifest())).not.toThrow();
    });

    it('refuses a manifest that names its own origin', () => {
        // The whole security property of the proxy is that a host is operator
        // configuration. A manifest is written by whoever ships the plugin, so
        // letting it pick the host would hand host selection to the plugin.
        expect(() => validateManifest(remoteManifest({
            remote: { origin: 'https://evil.example', paths: ['/tiles'], contentTypes: ['image/jpeg'] },
        }))).toThrow(/may not choose a host/);
    });

    it('refuses a capability with no declaration, and a declaration with no capability', () => {
        expect(() => validateManifest(validManifest({ capabilities: ['remote'] })))
            .toThrow(/declares no 'remote' block/);
        expect(() => validateManifest(validManifest({
            capabilities: [], remote: { paths: ['/tiles'], contentTypes: ['image/jpeg'] },
        }))).toThrow(/does not request the 'remote' capability/);
    });

    it('refuses an unbounded proxy', () => {
        expect(() => validateManifest(remoteManifest({
            remote: { paths: [], contentTypes: ['image/jpeg'] },
        }))).toThrow(/open relay/);
        expect(() => validateManifest(remoteManifest({
            remote: { paths: ['/tiles'], contentTypes: [] },
        }))).toThrow(/text\/html/);
    });

    it('refuses a path prefix carrying traversal or a parameter', () => {
        ['/tiles/..', '/tiles/:id', 'tiles', '/tiles/'].forEach((prefix) => {
            expect(() => validateManifest(remoteManifest({
                remote: { paths: [prefix], contentTypes: ['image/jpeg'] },
            }))).toThrow(/literal/);
        });
    });
});

describe('remote: reference resolution', () => {
    it('rewrites a remote: string to the plugin proxy mount', () => {
        expect(resolveRemoteRefs('remote:tiles/s1.dzi', 'pathology'))
            .toBe('/api/plugins/pathology/tiles/s1.dzi');
    });

    it('leaves a plain path alone, so remote is an option and not a migration', () => {
        expect(resolveRemoteRefs('/slides/local.dzi', 'pathology')).toBe('/slides/local.dzi');
    });

    it('walks the whole case rather than a list of known URL fields', () => {
        // The host does not know which of a plugin's keys hold URLs, and would
        // be wrong about it after the plugin's next release.
        const out = resolveRemoteRefs({
            slides: [{ id: 's1', dzi: 'remote:tiles/a.dzi' }],
            specimens: [{ plates: [{ src: 'remote:gross/p.jpg' }] }],
            zoom: 40, examMode: false, key: null,
        }, 'pathology');
        expect(out.slides[0].dzi).toBe('/api/plugins/pathology/tiles/a.dzi');
        expect(out.specimens[0].plates[0].src).toBe('/api/plugins/pathology/gross/p.jpg');
        expect(out).toMatchObject({ zoom: 40, examMode: false, key: null });
    });

    it('encodes per segment so a filename cannot smuggle a separator', () => {
        expect(resolveRemoteRefs('remote:tiles/a b/c%2fd.jpg', 'p'))
            .toBe('/api/plugins/p/tiles/a%20b/c%252fd.jpg');
    });

    it('only resolves for a plugin that requested the capability', () => {
        const withCap = createPluginContext({
            manifest: { id: 'p', capabilities: ['remote'] },
            caseConfig: { p: { dzi: 'remote:tiles/a.dzi' } },
        });
        const without = createPluginContext({
            manifest: { id: 'p', capabilities: [] },
            caseConfig: { p: { dzi: 'remote:tiles/a.dzi' } },
        });
        expect(withCap.data.dzi).toBe('/api/plugins/p/tiles/a.dzi');
        // Left verbatim: a plugin that never asked cannot be handed a proxy URL
        // by a case config, and the string stays visibly unresolved rather than
        // silently becoming a path that would 404.
        expect(without.data.dzi).toBe('remote:tiles/a.dzi');
    });
});
