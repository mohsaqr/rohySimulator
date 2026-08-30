/**
 * The host contract: what a host needs to know about a stored case document.
 *
 * A host that embeds this package stores one opaque JSON document per case and
 * has to answer four questions about it without understanding pathology:
 *
 *   1. Is there any material here?      -> caseDocumentIsServable()
 *   2. What should I tell the author?   -> caseDocumentIssues()
 *   3. What do I print on the card?     -> caseDocumentSummary()
 *   4. Will it fit / where does bulk    -> caseDocumentBytes(), findRemoteRefs()
 *      content point?
 *
 * WHY THESE LIVE HERE AND NOT IN THE HOST'S ADAPTER. The adapter's job is to
 * rename things. The moment it also decides *what counts as an error* or *what
 * counts as material*, two hosts embedding this package answer the same
 * question differently, and a case that is publishable in one is not in the
 * other. The judgement is the package's; the policy is the host's.
 *
 * WHICH IS WHY THERE IS NO SIZE LIMIT AND NO URL PREFIX IN THIS FILE. A host
 * caps documents at whatever its transport allows and mounts remote content
 * wherever it likes; this module reports the size and the references and takes
 * no view. Nothing here — nothing anywhere under src/ — may learn the name of
 * a particular host, which is the property `tests/portability.test.js` exists
 * to defend.
 *
 * Every function is pure, total, and browser-free: they run under `node --test`
 * and could run on a server. None of them throws on malformed input, because a
 * host calls them on whatever is in its database. A gate that throws is a room
 * that takes the host down.
 */

import { canonicalJSONStringify } from './caseCore/canonicalJson.js';
import { toStudioDocument, studioIssues, studioReaderCase } from './caseStudioModel.js';
import { REMOTE_SCHEME } from './remoteRef.js';

// `remoteRef.js` OWNS this — it is that module's whole subject. Re-exported
// here rather than declared again because `index.js` star-exports both, and two
// SEPARATE declarations of one name across star exports are *ambiguous* per the
// ES spec: the name is dropped from the namespace and
// `import { REMOTE_SCHEME } from 'pathoyon'` is a hard link error
// ("conflicting star exports"). Re-exporting the same binding is not ambiguous,
// so both spellings keep working and there is one declaration.
export { REMOTE_SCHEME };

/**
 * Normalise whatever a host stored into `{ manifest, rubric }`, or null.
 *
 * Accepts the three shapes that legitimately reach a host: the canonical pair,
 * a bare canonical manifest, and the legacy flat case that predates the schema.
 * `null` means "no material" — and a host must not invent the key, because an
 * invented empty document is exactly what lights a room onto nothing.
 *
 * @param {*} stored
 * @returns {{manifest: object, rubric: object}|null}
 */
export function readCaseDocument(stored) {
    if (stored === null || stored === undefined) return null;
    if (typeof stored !== 'object' || Array.isArray(stored)) return null;
    // An empty object is a key someone created and never filled. Treated as
    // absent rather than migrated into a blank case, so "saved but empty" and
    // "never authored" behave identically for the host.
    if (Object.keys(stored).length === 0) return null;
    try {
        return toStudioDocument(stored);
    } catch {
        // Unreadable material is not a crash. The host still gets `null` here
        // and the real explanation from caseDocumentIssues(), which reports
        // the failure as an issue rather than as an exception.
        return null;
    }
}

/**
 * The room's evidence, as the learner would receive it.
 *
 * Protected material — the rubric, expected answers, ROI geometry — is absent
 * by construction: this is the published projection, not a filtered copy of
 * the author's document.
 *
 * @param {*} stored
 * @param {string} [activityId]  which activity to project; defaults to the first
 * @returns {object|null} the viewer case, or null when there is nothing to show
 */
export function learnerCase(stored, activityId = undefined) {
    const document = readCaseDocument(stored);
    if (!document) return null;
    try {
        return activityId === undefined
            ? studioReaderCase(document)
            : studioReaderCase(document, activityId);
    } catch {
        return null;
    }
}

/**
 * Does this document give a learner anything to look at?
 *
 * This is the question a host's availability gate must ask. Not "is the key
 * present" — a saved-but-empty document has a key and nothing behind it, and a
 * room that opens onto its own empty state is the failure the gate exists to
 * prevent.
 *
 * Material means a slide with a resolvable source OR a gross photograph. Either
 * alone is a case worth opening: a specimen photographed but not yet sectioned
 * is a normal teaching case, not a broken one.
 *
 * @param {*} stored
 * @returns {boolean}
 */
export function caseDocumentIsServable(stored) {
    const viewer = learnerCase(stored);
    if (!viewer) return false;
    const hasSlide = (viewer.slides ?? []).some((slide) => typeof slide?.dzi === 'string' && slide.dzi !== '');
    const hasPhotograph = (viewer.specimens ?? []).some((specimen) => (specimen?.images ?? [])
        .some((image) => typeof image?.src === 'string' && image.src !== ''));
    return hasSlide || hasPhotograph;
}

/**
 * The document's problems, in the two levels a host UI can render.
 *
 * `forPublication` defaults to true because the question a host actually asks
 * is "may this go in front of learners?". A host must still SAVE a document
 * that has errors — a half-finished case is the normal state of an unfinished
 * one — and refuse only to mark it available.
 *
 * @param {*} stored
 * @param {object} [options]
 * @param {boolean} [options.forPublication=true]
 * @returns {Array<{level: 'error'|'warning', message: string, path: string, code: string}>}
 */
export function caseDocumentIssues(stored, { forPublication = true } = {}) {
    if (stored === null || stored === undefined) return [];
    let document;
    try {
        document = toStudioDocument(stored);
    } catch (error) {
        return [{
            level: 'error',
            path: '$',
            code: 'unreadable_document',
            message: `This case material could not be read: ${error?.message ?? String(error)}`,
        }];
    }
    const issues = studioIssues(document, { forPublication }).map((issue) => ({
        level: issue.severity === 'error' ? 'error' : 'warning',
        path: issue.path ?? '$',
        code: issue.code ?? 'unknown',
        message: issue.message ?? '',
    }));

    // The two halves of this contract must agree on every document.
    //
    // Schema validation names the common case itself (`empty_case`: no slide
    // and no gross photograph). This catches the rest — a case that HAS a slide
    // whose asset resolves to no source, say, which validation may accept and
    // the gate still refuses because a learner would open an empty canvas.
    //
    // Publication is the question "may learners see this?", so the answer has
    // to be the same one the gate gives.
    if (forPublication && !caseDocumentIsServable(stored)
        && !issues.some((issue) => issue.level === 'error')) {
        return [...issues, {
            level: 'error',
            path: '$.slides',
            code: 'no_material',
            message: 'This case has nothing for a learner to look at yet. Add a slide or a gross photograph.',
        }];
    }
    return issues;
}

/**
 * A one-line description of what the document holds.
 *
 * `labelKey` names the sentence rather than writing it: the host owns
 * translation, and a package that returned "3 slides" would be shipping
 * English into every locale. `count` is what goes in the plural slot.
 *
 * @param {*} stored
 * @returns {{count: number, slides: number, photographs: number, labelKey: string}}
 */
export function caseDocumentSummary(stored) {
    const viewer = learnerCase(stored);
    const slides = (viewer?.slides ?? []).filter((slide) => typeof slide?.dzi === 'string' && slide.dzi !== '').length;
    const photographs = (viewer?.specimens ?? []).reduce((total, specimen) => total + (specimen?.images ?? [])
        .filter((image) => typeof image?.src === 'string' && image.src !== '').length, 0);
    const labelKey = slides > 0 && photographs > 0 ? 'pathology_summary_mixed'
        : slides > 0 ? 'pathology_summary_slides'
            : photographs > 0 ? 'pathology_summary_photographs'
                : 'pathology_summary_empty';
    return { count: slides + photographs, slides, photographs, labelKey };
}

/**
 * The document's serialised size in bytes, as a host would store it.
 *
 * Canonical serialisation, so the number does not drift with key order — a
 * host comparing against a cap must get the same answer twice for the same
 * document. The cap itself is the host's to choose.
 *
 * @param {*} stored
 * @returns {number}
 */
export function caseDocumentBytes(stored) {
    if (stored === null || stored === undefined) return 0;
    try {
        return new TextEncoder().encode(canonicalJSONStringify(stored)).length;
    } catch {
        // Not canonicalisable (a cycle, a BigInt). Fall back to a plain
        // measurement rather than reporting zero, which would read as "fits".
        try {
            return new TextEncoder().encode(JSON.stringify(stored)).length;
        } catch {
            return Number.POSITIVE_INFINITY;
        }
    }
}

/**
 * Every `remote:` reference in the document, with the path that holds it.
 *
 * A host that proxies remote content checks these against whatever prefixes it
 * allows, and can point the author at the exact field. The walk is generic
 * rather than a list of known fields: which keys hold sources is the package's
 * business and would be wrong in the host after the next release.
 *
 * @param {*} stored
 * @param {string} [scheme]
 * @returns {Array<{path: string, ref: string}>}
 */
export function findRemoteRefs(stored, scheme = REMOTE_SCHEME) {
    const found = [];
    const seen = new Set();
    const walk = (value, path) => {
        if (typeof value === 'string') {
            if (value.startsWith(scheme)) found.push({ path, ref: value });
            return;
        }
        if (!value || typeof value !== 'object') return;
        // A host document is parsed JSON and should be a tree, but it may have
        // been handed to us by code that reused a node. Guarding here keeps a
        // shared reference from becoming an infinite walk.
        if (seen.has(value)) return;
        seen.add(value);
        if (Array.isArray(value)) {
            value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
            return;
        }
        Object.entries(value).forEach(([key, entry]) => walk(entry, `${path}.${key}`));
    };
    walk(stored, '$');
    return found;
}
