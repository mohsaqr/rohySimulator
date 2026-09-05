/**
 * Rohy Plugin Standard (RPS-1) — the shared half.
 *
 * This file is imported by BOTH the client and the server, so it lives under
 * server/shared/ per the rule in CLAUDE.md: the Docker runtime stage copies
 * server/ but not src/, so server code importing from src/ works locally and
 * crashes in the image.
 *
 * It is DATA ONLY. No React, no DOM, no lucide icons — a manifest describes a
 * plugin, it does not implement one. The runtime half (component, mount
 * lifecycle, availability gate) lives in src/plugins/registry.js.
 *
 * What a manifest buys, and why each field exists:
 *
 *   id          the plugin's single identity — room key, verb namespace,
 *               case-config key, audit id and API mount path are all derived
 *               from it. One identity, never four that can drift apart.
 *   room        how the plugin appears in the bottom RoomNavigator. `icon` and
 *               `accent` are STRINGS resolved against static allowlists on the
 *               client: a manifest cannot carry a React component (this module
 *               is server-importable), and Tailwind cannot JIT a class name it
 *               never sees as a literal. `order` sorts it among the core rooms
 *               (chat 10 … consultant 90). `presentation` is 'replace'
 *               (default: the room takes the chat layout's place) or
 *               'overlay' (drawn over the chat layout, which stays mounted
 *               and inert — for a room that is a second view of the live
 *               session and needs its physiology and conversation running).
 *   vocabulary  the xAPI verbs / object types the plugin emits. The SERVER
 *               needs this to validate POST /learning-events, which is the
 *               whole reason a manifest exists instead of a plain JS object
 *               registered at import time.
 *   states      how those verbs resolve to TNA clinical states, so plugin rows
 *               are analysable instead of falling through to a literal bucket.
 *   capabilities what the host must GRANT. A capability is a narrowed adapter
 *               the host builds — never a reference to a host singleton. See
 *               src/plugins/context.js for why that distinction is load-bearing.
 */

import { validateSettingsSchema } from './pluginSettings.js';

// The enums a manifest is validated against live in learningVerbFacets.js
// (so the registry, the ingest path and every analytics consumer read ONE
// list). Re-exported here because this module is the one plugins and tests
// have always imported them from.
import {
    CLINICAL_STATES, SEVERITIES, CATEGORIES, completeFacets, validateFacets,
} from './learningVerbFacets.js';

export { CLINICAL_STATES, SEVERITIES, CATEGORIES };

// 'orders' is the session's INVESTIGATION ORDERS, narrowed. A plugin room that
// shows the result of something the learner ordered in a core room (PACS shows
// the images for a study ordered in Radiology) otherwise has to reach for
// rohy's order API itself, from inside a package that is meant to be portable.
// The host builds the adapter instead — the same rule every other capability
// follows — so the plugin sees `{imaging: [...]}` and never an endpoint.
//
// 'case' is the session's frozen case snapshot, whole. Most plugins want a
// slice of the case config under their own id (`ctx.data`); a plugin that IS
// a view of the patient — a bed with the case's patient in it — needs the
// patient, and a copy of the same fields under a plugin key would be a second
// source of truth. Read-only data on `ctx.patientCase`, never a setter.
//
// 'conversation' is the session's ONE patient conversation, narrowed to
// `{send(text, meta), messages, loading}`: a plugin can speak into the same
// thread the chat room writes and read what was said, but the persona, the
// model call, persistence and the voice all stay with the host. This is the
// deliberate opposite of the 'llm' grant, which is refused precisely because
// it would write into the patient transcript — here, writing into the patient
// transcript is the point.
//
// 'drawer' opens the host's orders drawer on a tab (`openDrawer('records')`),
// so a plugin's chart or IV pole can lead to the real records / treatments
// surfaces instead of re-implementing them.
// 'vitals' is the live physiology snapshot as a read-only getter — what a
// room that mirrors the monitor's signal needs, without a reference to the
// EventLogger singleton whose field used to carry it.
export const CAPABILITIES = ['llm', 'uploads', 'notify', 'persist', 'remote', 'orders', 'case', 'conversation', 'drawer', 'vitals'];

/**
 * A plugin's remote-content declaration (`manifest.remote`), which is what the
 * 'remote' capability grants: rohy mounts a read-only proxy at
 * `/api/plugins/<id>/…` and the plugin's case config addresses it as
 * `remote:<path>`.
 *
 * The ORIGIN is deliberately absent from this declaration. It is operator
 * configuration (`ROHY_PLUGIN_ORIGINS`), never manifest or case data, because
 * the same mistake has already been made once in this codebase: the LLM proxy
 * accepted a client-supplied `endpoint` and that was an SSRF and key-exfil hole
 * (see proxy-routes.js). A case author can choose a PATH; only an operator can
 * choose a HOST.
 *
 * @typedef  {object}   PluginRemote
 * @property {string[]} paths         path prefixes the proxy will serve, each
 *                                    beginning with '/' (e.g. ['/tiles'])
 * @property {string[]} contentTypes  MIME types the upstream may return; any
 *                                    other response is refused as a 502
 */


/** Mirrors ROLE_RANKS in server/middleware/auth.js. Duplicated rather than
 *  imported because this module is loaded by the CLIENT too, and auth.js
 *  pulls in server-only middleware. If the ranks there change, change these —
 *  a contract test asserts the two agree. */
export const ROLE_RANKS = { guest: 0, student: 1, reviewer: 2, educator: 3, admin: 4 };

/** Room keys rohy owns. A plugin claiming one produces a duplicate navigator
 *  tab and a plugin that can never mount, since the core rooms are matched
 *  earlier in App.jsx's render chain. */
export const CORE_ROOM_KEYS = ['chat', 'examination', 'lab', 'radiology', 'consultant'];

/** How a plugin room is presented by the host; see validateManifest. */
export const ROOM_PRESENTATIONS = ['replace', 'overlay'];


const REQUIRED = ['id', 'room', 'vocabulary'];

function validateRole(role, id, field) {
    if (role === undefined) return;
    if (!Object.prototype.hasOwnProperty.call(ROLE_RANKS, role)) {
        throw new Error(
            `Plugin '${id}' declares ${field} '${role}', which is not a rohy role `
            + `(${Object.keys(ROLE_RANKS).join(', ')})`
        );
    }
}

/**
 * May this role open that surface?
 *
 * Exported because `minRole` was declared by the standard from day one and
 * enforced NOWHERE — a decorative field that reads like a guarantee. Adding a
 * second one for authoring without a shared check would have doubled the
 * problem instead of solving it.
 *
 * @param {string|undefined} role      the viewer's role
 * @param {string|undefined} required  the surface's minRole; undefined means open
 * @returns {boolean}
 */
export function roleAllows(role, required) {
    if (required === undefined) return true;
    const have = ROLE_RANKS[role === 'user' ? 'student' : role] ?? ROLE_RANKS.guest;
    return have >= (ROLE_RANKS[required] ?? 0);
}

/**
 * Merge a plugin namespace into a host one, THROWING on any collision.
 *
 * This is the single most important function in the standard. The pathology
 * package shipped `mergePathologyStates()` for exactly this and rohy's wiring
 * bypassed it with a raw spread — so a future rohy verb colliding with a
 * plugin verb would have been silently overwritten, and the analytics rows
 * for one of them would quietly change meaning. A spread cannot be made safe
 * by a comment; it has to be made impossible.
 */
export function mergeNamespace(base, additions, { label, source }) {
    const collisions = Object.keys(additions || {}).filter((k) => k in (base || {}));
    if (collisions.length > 0) {
        throw new Error(
            `Plugin '${source}' collides with rohy's ${label}: ${collisions.join(', ')}. `
            + `Rename the plugin's key — a silent overwrite would change what existing rows mean.`
        );
    }
    return { ...base, ...additions };
}

/** Validate a manifest at registration time rather than at first render. */
export function validateManifest(manifest) {
    REQUIRED.forEach((field) => {
        if (!manifest || manifest[field] === undefined) {
            throw new Error(`Plugin manifest is missing required field '${field}'`);
        }
    });
    if (!/^[a-z][a-z0-9_]*$/.test(manifest.id)) {
        throw new Error(`Plugin id '${manifest.id}' must be lower_snake_case — it becomes a room key and a URL segment`);
    }
    if (manifest.room.key !== manifest.id) {
        throw new Error(`Plugin '${manifest.id}' declares room.key '${manifest.room.key}' — they must match, so one id identifies the plugin everywhere`);
    }
    if (CORE_ROOM_KEYS.includes(manifest.id)) {
        throw new Error(`Plugin id '${manifest.id}' is a core rohy room — it would render a duplicate navigator tab and could never mount`);
    }
    // `room.presentation` decides whether the host REPLACES the chat layout
    // with the room (default) or draws the room OVER it with the chat
    // mounted and inert beneath ('overlay' — for a room that is a second
    // view of the live session: physiology and conversation keep running
    // underneath). A misspelling here would fail open into the wrong mode,
    // so it is validated like the room key.
    if (manifest.room.presentation !== undefined && !ROOM_PRESENTATIONS.includes(manifest.room.presentation)) {
        throw new Error(`Plugin '${manifest.id}' declares room.presentation '${manifest.room.presentation}'; it must be one of ${ROOM_PRESENTATIONS.join(', ')} or absent`);
    }
    const verbs = manifest.vocabulary.verbs || {};
    // R35: `coreVerbs` names rohy verbs the plugin emits on its own behalf
    // (a room that performs a physical exam emits PERFORMED_PHYSICAL_EXAM).
    // They must exist, and must not also be declared as the plugin's own.
    const coreVerbs = manifest.vocabulary.coreVerbs || [];
    if (!Array.isArray(coreVerbs)) {
        throw new Error(`Plugin '${manifest.id}' vocabulary.coreVerbs must be an array of rohy verb names`);
    }
    coreVerbs.forEach((verb) => {
        if (!BASE_VERB_NAMES.has(verb)) {
            throw new Error(`Plugin '${manifest.id}' lists '${verb}' under vocabulary.coreVerbs, but rohy has no such core verb`);
        }
        if (verb in (manifest.vocabulary.verbs || {})) {
            throw new Error(`Plugin '${manifest.id}' declares '${verb}' both as its own verb and as a core verb`);
        }
    });
    // `componentPrefix`: PascalCase, and every declared component value starts
    // with it (R34 — enforced as a gate once every vendored package carries
    // one; until then a manifest that declares a prefix is held to it).
    const prefix = manifest.vocabulary.componentPrefix;
    if (prefix !== undefined) {
        if (typeof prefix !== 'string' || !/^[A-Z][A-Za-z0-9]{2,}$/.test(prefix)) {
            throw new Error(`Plugin '${manifest.id}' vocabulary.componentPrefix must be PascalCase (got '${prefix}')`);
        }
        Object.values(manifest.vocabulary.components || {}).forEach((name) => {
            if (typeof name !== 'string' || !name.startsWith(prefix)) {
                throw new Error(`Plugin '${manifest.id}' component '${name}' does not start with its componentPrefix '${prefix}'`);
            }
        });
    }

    const states = manifest.states || {};
    const fallbacks = states.verbFallbacks || {};
    Object.entries(verbs).forEach(([verb, meta]) => {
        if (!meta || !meta.severity || !meta.category) {
            throw new Error(`Plugin '${manifest.id}' verb ${verb} has no severity/category — it would throw at emit time`);
        }
        // Not cosmetic: these are CHECK constraints on learning_events. A verb
        // declaring severity 'URGENT' is accepted everywhere in JS and then
        // silently dropped by sqlite at INSERT — the worst possible failure
        // for an analytics event, because nothing surfaces the loss.
        if (!SEVERITIES.includes(meta.severity)) {
            throw new Error(`Plugin '${manifest.id}' verb ${verb} declares severity '${meta.severity}'; learning_events only accepts ${SEVERITIES.join(', ')}`);
        }
        if (!CATEGORIES.includes(meta.category)) {
            throw new Error(`Plugin '${manifest.id}' verb ${verb} declares category '${meta.category}'; learning_events only accepts ${CATEGORIES.join(', ')}`);
        }
        // A v2 row carries its state on the verb; a v1 vocabulary says it in
        // states.verbFallbacks. Either is the mapping — but there must be one.
        const state = fallbacks[verb] ?? meta.clinicalState;
        // A verb with NO mapping does not error anywhere — it falls through to
        // resolveClinicalState's literal `${verb}_${objectType}` bucket and
        // quietly pollutes every TNA model with a state nobody declared.
        if (state === undefined) {
            throw new Error(`Plugin '${manifest.id}' verb ${verb} has no verbFallback — it would resolve to a literal TNA bucket instead of a clinical state`);
        }
        if (!CLINICAL_STATES.includes(state)) {
            throw new Error(`Plugin '${manifest.id}' verb ${verb} maps to '${state}', which is not a clinical state`);
        }
        // R35: a plugin may not re-declare a core verb as its own — it would
        // redefine that verb's facets for the whole host.
        if (BASE_VERB_NAMES.has(verb)) {
            throw new Error(`Plugin '${manifest.id}' declares '${verb}', which is a rohy core verb; list it under vocabulary.coreVerbs instead`);
        }
        // Facets (RPS-1 R33). A v2 vocabulary declares the full row; a v1
        // vocabulary — every vendored package before its upstream ships
        // facets — derives action/label/domain/tnaMerge/pulseBucket from the
        // state it already declares, so its rows label correctly in every
        // lens today instead of falling to 'Other'. Either way the completed
        // row must validate, so a plugin cannot invent a lens value.
        validateFacets(verb, manifestVerbFacets(manifest, verb), `plugin '${manifest.id}'`);
    });

    // Ownership. mergeNamespace catches a plugin OVERWRITING an existing key,
    // but it cannot catch a plugin CLAIMING an unclaimed one that semantically
    // belongs to rohy: `DEFAULT_INTERPRETATIONS` has no 'ORDERED_LAB:lab_test'
    // row today, so a plugin could add one and silently reclassify a core
    // clinical event as 'reflecting' in every TNA model. A plugin may only
    // make claims about its own vocabulary.
    const ownVerbs = new Set(Object.keys(verbs));
    const ownTypes = new Set(Object.values(manifest.vocabulary.objectTypes || {}));
    Object.keys(states.objectOverrides || {}).forEach((type) => {
        if (!ownTypes.has(type)) {
            throw new Error(`Plugin '${manifest.id}' overrides object_type '${type}', which it does not declare`);
        }
    });
    Object.keys(states.interpretations || {}).forEach((pair) => {
        const [verb, objectType] = pair.split(':');
        if (!ownVerbs.has(verb) && !ownTypes.has(objectType)) {
            throw new Error(`Plugin '${manifest.id}' interprets '${pair}', which involves neither its own verbs nor its own object types`);
        }
    });
    // Remote content (§ the 'remote' capability). The declaration and the
    // capability must agree in both directions: a manifest that describes a
    // proxy it never requested is a review hazard, and a capability with no
    // declaration would mount a proxy that serves nothing.
    const caps = manifest.capabilities || [];
    const remote = manifest.remote;
    if (remote && !caps.includes('remote')) {
        throw new Error(`Plugin '${manifest.id}' declares 'remote' content but does not request the 'remote' capability`);
    }
    if (caps.includes('remote') && !remote) {
        throw new Error(`Plugin '${manifest.id}' requests the 'remote' capability but declares no 'remote' block saying which paths and content types it needs`);
    }
    if (remote) {
        if (remote.origin !== undefined) {
            throw new Error(`Plugin '${manifest.id}' declares remote.origin. A manifest may not choose a host — the origin comes from ROHY_PLUGIN_ORIGINS, so an operator decides what rohy's server will talk to`);
        }
        if (!Array.isArray(remote.paths) || remote.paths.length === 0) {
            throw new Error(`Plugin '${manifest.id}' declares 'remote' with no paths — an unbounded proxy onto the configured origin is not a capability, it is an open relay`);
        }
        remote.paths.forEach((prefix) => {
            if (typeof prefix !== 'string' || !/^\/[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/.test(prefix)) {
                throw new Error(`Plugin '${manifest.id}' remote path '${prefix}' must be a literal '/lower-kebab' prefix — no parameters, no traversal, no trailing slash`);
            }
        });
        if (!Array.isArray(remote.contentTypes) || remote.contentTypes.length === 0) {
            throw new Error(`Plugin '${manifest.id}' declares 'remote' with no contentTypes — without an allowlist the proxy would happily relay text/html from the configured origin`);
        }
        remote.contentTypes.forEach((type) => {
            if (typeof type !== 'string' || !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(type)) {
                throw new Error(`Plugin '${manifest.id}' remote contentType '${type}' is not a bare 'type/subtype'`);
            }
        });
    }

    // The editor's library (§7a.1). Optional — absent means pathology's
    // original shape, so the plugin that predates this declaration is
    // unaffected. Validated strictly because every field here fails OPEN in a
    // different, quiet way: a mistyped `collection` makes every catalog look
    // malformed (502), a missing `refFields` disables the remote-only check
    // that keeps host addresses out of portable cases, and a typo'd
    // `learnerKeys` would hand a learner the whole author-facing library.
    if (manifest.catalog !== undefined) {
        const catalog = manifest.catalog;
        const id = manifest.id;
        if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
            throw new Error(`Plugin '${id}' declares 'catalog' that is not an object`);
        }
        if (!remote) {
            throw new Error(`Plugin '${id}' declares a 'catalog' but no 'remote' block — the catalog is relayed from the content origin, and without one there is nowhere to relay it from`);
        }
        const unknown = Object.keys(catalog).find((key) => !['collection', 'refFields', 'learnerKeys'].includes(key));
        if (unknown) {
            throw new Error(`Plugin '${id}' catalog declares unknown field '${unknown}' — only collection, refFields and learnerKeys are defined`);
        }
        const isKey = (k) => typeof k === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k);
        if (catalog.collection !== undefined && !isKey(catalog.collection)) {
            throw new Error(`Plugin '${id}' catalog.collection must be a plain property name, e.g. 'entries'`);
        }
        if (catalog.refFields !== undefined
            && !(Array.isArray(catalog.refFields) && catalog.refFields.length > 0 && catalog.refFields.every(isKey))) {
            throw new Error(`Plugin '${id}' catalog.refFields must be a non-empty array of plain property names`);
        }
        if (catalog.learnerKeys !== undefined
            && !(Array.isArray(catalog.learnerKeys) && catalog.learnerKeys.length > 0 && catalog.learnerKeys.every(isKey))) {
            throw new Error(`Plugin '${id}' catalog.learnerKeys must be a non-empty array of plain property names — it is an allowlist of what a learner may read, so an empty or malformed one must fail loudly rather than default to everything`);
        }
    }

    // The document cap (§11a.1). Optional — absent means the default. Checked
    // because a typo here fails OPEN: a manifest saying `maxbytes` or '128kb'
    // would silently keep the default and the author would meet a rejection
    // the manifest appears to have prevented.
    if (manifest.document !== undefined) {
        const doc = manifest.document;
        if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
            throw new Error(`Plugin '${manifest.id}' declares 'document' that is not an object`);
        }
        const unknown = Object.keys(doc).find((key) => key !== 'maxBytes' && key !== 'learnerOmit');
        if (unknown) {
            throw new Error(`Plugin '${manifest.id}' document declares unknown field '${unknown}' — only maxBytes and learnerOmit are defined`);
        }
        if (doc.maxBytes !== undefined && !(Number.isInteger(doc.maxBytes) && doc.maxBytes > 0)) {
            throw new Error(`Plugin '${manifest.id}' document.maxBytes must be a positive integer number of bytes`);
        }
        // Dotted paths the host strips for roles below reviewer (§11a.4). A
        // typo here fails OPEN — the answer key ships — so the shape is strict.
        if (doc.learnerOmit !== undefined) {
            const ok = Array.isArray(doc.learnerOmit) && doc.learnerOmit.length > 0
                && doc.learnerOmit.every((p) => typeof p === 'string' && /^[A-Za-z0-9_$]+(\.[A-Za-z0-9_$]+)*$/.test(p));
            if (!ok) {
                throw new Error(`Plugin '${manifest.id}' document.learnerOmit must be a non-empty array of dotted paths like 'rubric' or 'manifest.answers'`);
            }
        }
    }

    // The settings slot (RPS-1 1.4, §11c). Optional. Validated here rather
    // than at first render because a malformed schema is a manifest defect and
    // the standard's discipline is that manifests fail at `plugins:gen` time,
    // before any code runs.
    validateSettingsSchema(manifest.settings, manifest.id);

    caps.forEach((cap) => {
        if (!CAPABILITIES.includes(cap)) {
            throw new Error(`Plugin '${manifest.id}' requests unknown capability '${cap}'`);
        }
    });

    validateRole(manifest.minRole, manifest.id, 'minRole');

    // --- the authoring slot (optional) ------------------------------------
    //
    // A plugin's room is where a learner USES its material. An authoring
    // surface is where someone MAKES that material, and the two have opposite
    // gates: the room declines a case with no data, the editor exists
    // precisely when there is none yet. So authoring is its own slot rather
    // than a second mode of the room.
    if (manifest.authoring !== undefined) {
        const authoring = manifest.authoring;
        if (!authoring || typeof authoring !== 'object') {
            throw new Error(`Plugin '${manifest.id}' declares 'authoring' that is not an object`);
        }
        if (!authoring.labelKey) {
            throw new Error(`Plugin '${manifest.id}' authoring has no labelKey — its entry would render blank`);
        }
        // REQUIRED, not defaulted. Authoring writes the material every learner
        // is then assessed against; silently inheriting a student-level
        // default would be the most consequential possible default to get
        // wrong, so the manifest has to say it out loud.
        if (authoring.minRole === undefined) {
            throw new Error(
                `Plugin '${manifest.id}' authoring has no minRole. Authoring writes the material learners are `
                + `assessed against, so the manifest must state who may open it rather than inheriting a default.`
            );
        }
        validateRole(authoring.minRole, manifest.id, 'authoring.minRole');
        // A surface that edits the case cannot be easier to reach than the
        // surface that merely reads it.
        const roomRank = ROLE_RANKS[manifest.minRole ?? 'student'];
        if (ROLE_RANKS[authoring.minRole] < roomRank) {
            throw new Error(
                `Plugin '${manifest.id}' authoring.minRole '${authoring.minRole}' is weaker than its room minRole `
                + `'${manifest.minRole ?? 'student'}' — editing a case cannot be easier to reach than reading it`
            );
        }
    }

    return manifest;
}

/** Stable key order, so two manifests compare by content. */
export function canonicalManifest(value) {
    if (Array.isArray(value)) return value.map(canonicalManifest);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonicalManifest(value[k])]));
    }
    return value;
}

/** JSON of the canonical form — what `npm run plugins:gen` writes and what the runtime guard compares. */
export function canonicalJson(manifest) {
    return JSON.stringify(canonicalManifest(manifest));
}

/**
 * The first path at which two manifests differ, or null when they are the
 * same. Used by the runtime drift guard to name WHAT drifted: the old guard
 * compared verb NAMES only, so a changed severity, state or object type
 * mounted silently while the server persisted the old value.
 */
export function firstDifference(a, b, path = '') {
    if (a === b) return null;
    const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
    const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
    if (ta !== tb) return path || '(root)';
    if (ta === 'array') {
        if (a.length !== b.length) return `${path}.length`;
        for (let i = 0; i < a.length; i++) {
            const d = firstDifference(a[i], b[i], `${path}[${i}]`);
            if (d) return d;
        }
        return null;
    }
    if (ta === 'object') {
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const k of [...keys].sort()) {
            const d = firstDifference(a[k], b[k], path ? `${path}.${k}` : k);
            if (d) return d;
        }
        return null;
    }
    return path || '(root)';
}

/** Which facet fields a v2 vocabulary must declare on every verb. */
export const MANIFEST_FACET_FIELDS = ['severity', 'category', 'clinicalState', 'action', 'label'];

/** The vocabulary contract version every SHIPPED manifest must declare (RPS-1 1.6). */
export const SHIPPED_VOCABULARY_VERSION = 2;

/**
 * The gates a manifest must pass to SHIP in rohy, over and above being valid.
 *
 * `validateManifest` accepts a v1 vocabulary because a test, or a package
 * mid-migration, may still build one. The generator (`npm run plugins:gen`,
 * and `plugins:check` in prebuild and CI) runs this on every manifest under
 * src/plugins/ instead, so the repository cannot carry a plugin whose rows
 * would be labelled by a guess:
 *
 *   R33  `vocabulary.version >= 2` — every verb declares its full facet row
 *        (validateManifest has already checked each row against the enums)
 *   R34  `vocabulary.componentPrefix` is declared, so every component name is
 *        namespaced (validateManifest has already checked the values)
 *   R35  `coreVerbs` ⊂ rohy's base verbs (validateManifest)
 *   R36  every verb is emitted, server-only, or planned with a note — checked
 *        by scripts/check-plugin-emissions.mjs, which needs the source tree
 *
 * @param {object} manifest  a manifest validateManifest has accepted
 * @returns {object} the same manifest
 */
export function assertShippedManifest(manifest) {
    const version = manifest.vocabulary?.version ?? 1;
    if (version < SHIPPED_VOCABULARY_VERSION) {
        throw new Error(`Plugin '${manifest.id}' declares vocabulary.version ${version}; a shipped plugin must declare ${SHIPPED_VOCABULARY_VERSION} with a full facet row per verb (RPS-1 R33)`);
    }
    if (typeof manifest.vocabulary?.componentPrefix !== 'string') {
        throw new Error(`Plugin '${manifest.id}' declares no vocabulary.componentPrefix; a shipped plugin namespaces its components (RPS-1 R34)`);
    }
    return manifest;
}

/**
 * The completed facet row for one manifest verb.
 *
 * `vocabulary.version` gates how much the manifest must say. v1 (the default,
 * and every vendored package until its upstream ships facets) declares
 * severity/category on the verb and a clinical state in `states.verbFallbacks`;
 * the rest derives. v2 must declare the full row (R33) — a missing field is an
 * error, not a default — because a plugin that says nothing about its lens
 * labels is a plugin whose rows will be mislabelled by whoever guessed.
 */
export function manifestVerbFacets(manifest, verb) {
    const meta = manifest.vocabulary?.verbs?.[verb] || {};
    const version = manifest.vocabulary?.version ?? 1;
    if (version >= 2) {
        MANIFEST_FACET_FIELDS.forEach((field) => {
            if (meta[field] === undefined) {
                throw new Error(`Plugin '${manifest.id}' verb ${verb} declares vocabulary.version ${version} but has no '${field}' facet`);
            }
        });
    }
    const clinicalState = meta.clinicalState ?? manifest.states?.verbFallbacks?.[verb];
    return completeFacets(verb, { ...meta, clinicalState, emitter: meta.emitter ?? 'plugin' });
}

/** Verbs the HOST emits on a plugin's behalf and therefore stamps with that plugin's id. */
export const HOST_DELEGABLE_VERBS = Object.freeze([
    'RAISED_ERROR', 'UNDECLARED_VERB', 'OPENED_PLUGIN_EDITOR', 'EDITED_PLUGIN_DOCUMENT', 'SAVED_PLUGIN_DOCUMENT',
    'PERFORMED_PHYSICAL_EXAM', 'SENT_MESSAGE', 'RECEIVED_MESSAGE', 'CLICKED', 'OPENED', 'CLOSED', 'VIEWED',
]);

const PLUGIN_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * May this plugin claim this verb? Attribution is metadata, so a bad claim is
 * reported for STRIPPING — the caller inserts the row without it — never for
 * dropping the learner's action over a provenance label.
 *
 * @param {string} pluginId
 * @param {string|null|undefined} pluginVersion  the client's claim
 * @param {string} verb  canonical verb
 * @param {object[]} [manifests=PLUGIN_MANIFESTS_REF]  injectable for tests
 * @returns {{ok:true, pluginId:string, pluginVersion:string|null, versionMismatch:boolean}
 *          |{ok:false, reason:'unknown_plugin'|'plugin_verb_mismatch'}}
 */
export function resolvePluginAttribution(pluginId, pluginVersion, verb, manifests = PLUGIN_MANIFESTS_REF) {
    if (typeof pluginId !== 'string' || !PLUGIN_ID_RE.test(pluginId)) return { ok: false, reason: 'unknown_plugin' };
    const manifest = manifests.find((m) => m.id === pluginId);
    if (!manifest) return { ok: false, reason: 'unknown_plugin' };
    const own = manifest.vocabulary?.verbs || {};
    const core = manifest.vocabulary?.coreVerbs || [];
    if (!(verb in own) && !core.includes(verb) && !HOST_DELEGABLE_VERBS.includes(verb)) {
        return { ok: false, reason: 'plugin_verb_mismatch' };
    }
    // A version the host does not ship is unverifiable: stored as NULL and
    // counted, never as the client's word.
    const shipped = manifest.version ?? null;
    const versionMismatch = pluginVersion != null && String(pluginVersion) !== String(shipped);
    return { ok: true, pluginId, pluginVersion: versionMismatch ? null : (pluginVersion == null ? null : String(pluginVersion)), versionMismatch };
}

// The generated manifests are imported lazily by name to keep this module
// free of a hard dependency on the generated file for the tests that build
// manifests of their own; `setPluginManifests` is how the registry learns
// what is installed.
let PLUGIN_MANIFESTS_REF = [];
export function setPluginManifests(list) { PLUGIN_MANIFESTS_REF = Array.isArray(list) ? list : []; }

// The core verb names, registered by learningVerbs.js at load (this module
// cannot import it — learningVerbs imports THIS module). Empty until then,
// which only matters for a test that validates a manifest before the
// registry loads; foldManifests is always called by learningVerbs after.
let BASE_VERB_NAMES = new Set();
export function setCoreVerbNames(names) { BASE_VERB_NAMES = new Set(names || []); }

/**
 * Fold a list of manifests into the merged vocabulary/state maps rohy uses.
 * Every merge goes through mergeNamespace, so two plugins that collide with
 * each other fail exactly as loudly as one colliding with rohy.
 */
export function foldManifests(manifests, base = {}) {
    const out = {
        verbs: { ...(base.verbs || {}) },
        verbMetadata: { ...(base.verbMetadata || {}) },
        verbFacets: { ...(base.verbFacets || {}) },
        objectTypes: { ...(base.objectTypes || {}) },
        components: { ...(base.components || {}) },
        verbFallbacks: { ...(base.verbFallbacks || {}) },
        objectOverrides: { ...(base.objectOverrides || {}) },
        interpretations: { ...(base.interpretations || {}) },
    };
    manifests.forEach((m) => {
        validateManifest(m);
        const v = m.vocabulary || {};
        const s = m.states || {};
        const src = m.id;
        const verbNames = Object.fromEntries(Object.keys(v.verbs || {}).map((k) => [k, k]));
        out.verbs = mergeNamespace(out.verbs, verbNames, { label: 'VERBS', source: src });
        out.verbMetadata = mergeNamespace(out.verbMetadata, v.verbs || {}, { label: 'VERB_METADATA', source: src });
        const facets = Object.fromEntries(Object.keys(v.verbs || {}).map((verb) => [verb, manifestVerbFacets(m, verb)]));
        out.verbFacets = mergeNamespace(out.verbFacets, facets, { label: 'VERB_FACETS', source: src });
        out.objectTypes = mergeNamespace(out.objectTypes, v.objectTypes || {}, { label: 'OBJECT_TYPES', source: src });
        out.components = mergeNamespace(out.components, v.components || {}, { label: 'COMPONENTS', source: src });
        out.verbFallbacks = mergeNamespace(out.verbFallbacks, s.verbFallbacks || {}, { label: 'VERB_FALLBACKS', source: src });
        out.objectOverrides = mergeNamespace(out.objectOverrides, s.objectOverrides || {}, { label: 'OBJECT_OVERRIDES', source: src });
        out.interpretations = mergeNamespace(out.interpretations, s.interpretations || {}, { label: 'DEFAULT_INTERPRETATIONS', source: src });
    });
    return out;
}
