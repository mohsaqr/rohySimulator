/**
 * Every change an author can make to a case, as pure document transitions.
 *
 * These lived inline in the editor as JSX callbacks, which made them untestable
 * by construction: `node --test` cannot load a `.jsx` at all, so a decision left
 * in a component is a decision nothing checks. They are the transitions most
 * worth checking — "replacing the imaging must not discard the report" is the
 * kind of rule that breaks silently and is noticed weeks later by an author who
 * lost an afternoon's writing.
 *
 * Every function is `(doc, …) -> doc`, total, and returns a NEW document. A
 * study is addressed by its CATALOGUE id, never by the worklist entry's own id,
 * because that is how an author thinks about it and because the entry may not
 * exist yet — a case says nothing about a study until the author changes it.
 */

import { SOURCE_KIND, SUBSTITUTION_SCOPE, entryForStudy, readDocument } from './caseDocument.js';

/** The verbs. Also the ids `studyActions()` returns and the editor renders. */
export const ACTION = Object.freeze({
    OPEN: 'open',
    CHANGE: 'change',
    REPLACE: 'replace',
    WIRE: 'wire',
    ADD_FINDING: 'addFinding',
    EDIT: 'edit',
    REMOVE_IMAGING: 'removeImaging',
    REVERT: 'revert',
});

/** The worklist entry for a catalogue study, or null when the case is silent. */
export function entryOf(doc, studyId) {
    return readDocument(doc).worklist.find((e) => e.studyId === studyId) ?? null;
}

const withWorklist = (doc, worklist) => ({ ...readDocument(doc), worklist });

const mapEntry = (doc, studyId, fn) => {
    const document = readDocument(doc);
    return withWorklist(document, document.worklist.map(
        (e) => (e.studyId === studyId ? fn(e) : e),
    ));
};

/**
 * Start saying something about a study, seeded from its normal example.
 *
 * A no-op when the case already has an entry: clicking "change" on an
 * already-changed study must not reset it to the normal baseline and throw away
 * the findings, which is what a naive re-seed would do.
 */
export function changeStudy(doc, { studyId, name = '', normalEntry = null }) {
    const document = readDocument(doc);
    if (document.worklist.some((e) => e.studyId === studyId)) return document;
    return withWorklist(document, [
        ...document.worklist,
        entryForStudy({ id: studyId, name }, { normalEntry }),
    ]);
}

/**
 * Stop saying anything about a study.
 *
 * The learner gets the archive's normal example again, by omission — which is
 * the whole model. Destructive: the findings and report go with it, so callers
 * must offer undo.
 */
export function revertStudy(doc, studyId) {
    const document = readDocument(doc);
    return withWorklist(document, document.worklist.filter((e) => e.studyId !== studyId));
}

/**
 * Point a study at different imaging.
 *
 * Materialises the entry first when the case was silent, so "replace this
 * study" is ONE gesture from an untouched card rather than change-then-replace.
 *
 * Everything the author wrote survives: description, accession, availability,
 * report, rubric and the findings. Only `baseline` moves. A substitution may be
 * left naming a series the new imaging does not have — `documentIssues()`
 * reports that as an error rather than this function guessing a new target,
 * because silently repointing a finding at a different series is worse than
 * saying it is broken.
 */
export function wireBaseline(doc, studyId, archiveEntryId, { name = '', normalEntry = null } = {}) {
    const seeded = changeStudy(doc, { studyId, name, normalEntry });
    return mapEntry(seeded, studyId, (e) => ({
        ...e,
        baseline: archiveEntryId
            ? { kind: SOURCE_KIND.ARCHIVE, ref: archiveEntryId }
            : { kind: SOURCE_KIND.NONE, ref: null },
    }));
}

/**
 * Unwire the imaging, keeping the entry.
 *
 * Distinct from `revertStudy`: the case still says something about this study —
 * its findings and report survive — it just has no images yet. That is an
 * unfinished state, not a shippable one, and `documentIssues()` correctly
 * reports it as an error until something is wired back.
 */
export function unwireBaseline(doc, studyId) {
    return mapEntry(doc, studyId, (e) => ({
        ...e,
        baseline: { kind: SOURCE_KIND.NONE, ref: null },
    }));
}

/** Change a study's own fields: description, accession, availability, report. */
export function patchStudy(doc, studyId, patch) {
    return mapEntry(doc, studyId, (e) => ({ ...e, ...patch }));
}

/** A new, empty finding, targeted at the baseline's first series by default. */
export function addFinding(doc, studyId, { baselineEntry = null } = {}) {
    return mapEntry(doc, studyId, (e) => ({
        ...e,
        substitutions: [...e.substitutions, {
            // Counted, not timestamped: a time-based id collides across a fast
            // double-click and is not reproducible in a fixture.
            id: nextFindingId(e.substitutions),
            label: '',
            scope: SUBSTITUTION_SCOPE.SERIES,
            targetSeriesKey: baselineEntry?.series?.[0]?.key ?? null,
            source: { kind: SOURCE_KIND.NONE, ref: null },
            range: null,
            geometry: null,
        }],
    }));
}

function nextFindingId(substitutions) {
    const taken = new Set(substitutions.map((s) => s.id));
    let n = substitutions.length + 1;
    while (taken.has(`sub_${n}`)) n += 1;
    return `sub_${n}`;
}

export function patchFinding(doc, studyId, subId, patch) {
    return mapEntry(doc, studyId, (e) => ({
        ...e,
        substitutions: e.substitutions.map((s) => (s.id === subId ? { ...s, ...patch } : s)),
    }));
}

export function removeFinding(doc, studyId, subId) {
    return mapEntry(doc, studyId, (e) => ({
        ...e,
        substitutions: e.substitutions.filter((s) => s.id !== subId),
    }));
}

/**
 * What the undo banner should say, as data rather than JSX.
 *
 * Returned as `{ key, fallback }` so a host's `t()` can translate it and a test
 * can assert on the key. Actions that are not destructive return null: offering
 * undo for something nothing was lost to is noise.
 */
export function undoLabelFor(action, { name = 'this study' } = {}) {
    switch (action) {
        case ACTION.REVERT:
            return {
                key: 'radoyon_undo_reverted',
                fallback: `“${name}” is normal again — its findings and report were discarded.`,
            };
        case ACTION.REPLACE:
            return { key: 'radoyon_undo_replaced', fallback: 'Imaging changed.' };
        case ACTION.REMOVE_IMAGING:
            return { key: 'radoyon_undo_unwired', fallback: 'Imaging removed from this study.' };
        case 'removeFinding':
            return { key: 'radoyon_undo_removed_finding', fallback: 'Finding removed.' };
        default:
            return null;
    }
}
