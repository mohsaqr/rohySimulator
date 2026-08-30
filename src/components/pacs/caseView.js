/**
 * What the editor may offer for a given study — the judgement, without the JSX.
 *
 * Which controls appear on which card was a chain of ternaries inside a
 * component, which meant "the buttons I asked for are missing" could only ever
 * be found by a person looking at a screen. Here it is a function over a
 * `caseCatalogue()` row, and a test pins the exact set for every state.
 */

import { ACTION } from './caseActions.js';
import { SOURCE_KIND } from './caseDocument.js';
import { resolveEntry } from './caseDocument.js';

/**
 * The actions available for one catalogue row, in the order they should appear.
 *
 * `open` is always first and always present — even an unbacked study can be
 * opened, to be told plainly what is missing.
 *
 * @param {object} row a row from `caseCatalogue()`
 * @returns {string[]} action ids from `ACTION`
 */
/**
 * The default rule for turning a `remote:` reference into a fetchable URL.
 *
 * Lives here, not in a component, so it can be tested — and so the components
 * stop carrying the demo host's URL scheme. A host that serves the archive from
 * somewhere else passes its own `resolveRef`; rohy's, for instance, resolves
 * onto `/api/plugins/pacs/dicom/…`.
 */
export function defaultResolveRef(ref) {
    return String(ref ?? '').replace(/^remote:/, '/');
}

export function studyActions(row) {
    const actions = [ACTION.OPEN];
    const changed = row?.state === 'changed';
    const hasBaseline = Boolean(row?.wiredEntryId);

    if (changed) {
        // A changed study with no imaging needs WIRE, not REPLACE: there is
        // nothing to replace, and offering the word would describe the document
        // wrongly.
        actions.push(hasBaseline ? ACTION.REPLACE : ACTION.WIRE);
        actions.push(ACTION.ADD_FINDING, ACTION.EDIT);
        if (hasBaseline) actions.push(ACTION.REMOVE_IMAGING);
        actions.push(ACTION.REVERT);
        return actions;
    }

    if (row?.backed) {
        // Untouched and backed. REPLACE is offered directly rather than behind
        // CHANGE, because "replace this study" in one gesture is the whole point
        // — it materialises the entry on the way through.
        actions.push(ACTION.CHANGE, ACTION.REPLACE);
        return actions;
    }

    // Untouched, and the archive has nothing for it.
    actions.push(ACTION.WIRE);
    return actions;
}

/**
 * The series an author should see when they open a study, each labelled by
 * where it came from.
 *
 * Built from declared metadata — no pixels are fetched to decide what the rail
 * shows. `origin` is what lets the rail mark a series as replaced or spliced;
 * it is deliberately NOT read from the learner-facing projection, which must
 * never carry authoring vocabulary.
 *
 * @returns {Array<{key, description, plane, instances, ref, url, geometry,
 *   origin: 'baseline'|'substitution'|'spliced', splices}>}
 */
export function previewSeries(row, { archive, resolveRef = (r) => r } = {}) {
    if (!row?.entry) {
        const entry = row?.normalEntry;
        if (!entry) return [];
        return entry.series.map((s) => ({
            ...s,
            url: resolveRef(s.ref),
            origin: 'baseline',
            splices: [],
        }));
    }

    // resolveEntry takes the baseline's SERIES, not the archive. Passing the
    // archive silently resolved against an empty baseline, which turned every
    // substitution into a series of its own — and named it after the finding,
    // which is exactly the spoiler the anti-spoiler rule exists to prevent.
    const baseline = row.wiredEntry
        ?? ((archive?.entries ?? []).find((e) => e.id === row.entry.baseline?.ref) ?? null);
    const resolved = resolveEntry(row.entry, { baselineSeries: baseline?.series ?? [] });
    return resolved.series.map((s) => ({
        ...s,
        url: resolveRef(s.ref),
        origin: s.origin ?? 'baseline',
        splices: s.splices ?? [],
    }));
}

/** The archive entry a study's card should be pictured by. */
export function pictureOf(row) {
    return row?.wiredEntry ?? row?.normalEntry ?? null;
}

export { ACTION, SOURCE_KIND };
