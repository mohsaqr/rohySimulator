// Activity mapping registry — the different ways a single activity event
// (a {verb, object_type} pair) can be labelled for the analytics screens.
//
// One event, several "lenses", coarse → fine:
//
//   clinical-state   11 reasoning-loop states (assessing, treating, …)   [clinicalStates.js]
//   clinical-action  concrete clinical actions (History, Examining, Ordering, Reading results, …)
//   medical-domain   broad domains (Assessment, Diagnostics, Therapeutics, …)
//   fine             human-readable per-action ("Ordered lab", "Read lab result", "Gave medication")
//   verb             the raw event verb (ORDERED_MEDICATION)
//   object           the raw object type (medication)
//   raw              literal verb:object (ORDERED_MEDICATION:medication)
//
// Every lens is a pure function of (verb, object_type); the same event
// therefore colours consistently across every activity screen once the
// dashboard maps its events through the selected lens. The single source of
// truth is the verb's facet row in server/shared/learningVerbs.js (or a
// plugin's manifest) — edit a label there and it changes everywhere,
// server-side sequences included.

// The tables that used to live here (CLINICAL_ACTION_BY_VERB,
// ACTION_TO_DOMAIN, FINE_LABEL_BY_VERB and the lens functions) are now derived
// from the verb registry's facets in server/shared/eventFacets.js, so the
// server's sequence builder and these dashboards label a row identically.
// They are re-exported under their old names; this module keeps the
// presentation metadata for the lens selector.
import {
    LENSES,
    CLINICAL_ACTION_BY_VERB,
    ACTION_TO_DOMAIN,
    FINE_LABEL_BY_VERB,
    clinicalAction,
    medicalDomain,
    fineLabel,
    activityLabel,
} from '../../../../server/shared/eventFacets.js';

export {
    CLINICAL_ACTION_BY_VERB, ACTION_TO_DOMAIN, FINE_LABEL_BY_VERB,
    clinicalAction, medicalDomain, fineLabel,
};

// The selector options, coarse → fine. `id` is the stored value; `label` is
// shown in the toolbar; `hint` is the one-liner under it.
export const ACTIVITY_MAPPINGS = [
    { id: 'clinical-state', label: 'Clinical state', hint: '11 reasoning states (assessing, treating…)' },
    { id: 'clinical-action', label: 'Clinical action', hint: 'History, Examining, Ordering, Reading results…' },
    { id: 'medical-domain', label: 'Medical domain', hint: 'Assessment, Diagnostics, Therapeutics…' },
    { id: 'fine', label: 'Fine-grained action', hint: 'Ordered lab, Read lab result, Gave medication…' },
    { id: 'verb', label: 'Clinical verb', hint: 'Raw event verb (ORDERED_MEDICATION)' },
    { id: 'object', label: 'Object type', hint: 'What was acted on (medication, lab_test)' },
    { id: 'raw', label: 'Raw verb:object', hint: 'Literal pair, no mapping (debug/QA)' },
];

export const ACTIVITY_MAPPING_IDS = ACTIVITY_MAPPINGS.map((m) => m.id);
export const DEFAULT_ACTIVITY_MAPPING = 'clinical-state';

/**
 * Resolve one activity event to a label under the chosen mapping lens.
 *
 * @param {string} verb        upper-snake verb, e.g. 'ORDERED_MEDICATION'
 * @param {string} objectType  lower-snake object type, e.g. 'medication'
 * @param {string} mapping     one of ACTIVITY_MAPPING_IDS
 * @param {Record<string,string>} [customStateMap] optional custom clinical-state
 *                             override map (only used by the clinical-state lens)
 * @returns {string} the label for this event under the mapping
 */
export function resolveActivityLabel(verb, objectType, mapping = DEFAULT_ACTIVITY_MAPPING, customStateMap) {
    return activityLabel(verb, objectType, mapping, customStateMap);
}

// The selector ids and the shared resolver's lens ids are the same list; a
// lens added to one without the other would be selectable but unlabelled.
if (ACTIVITY_MAPPING_IDS.join(',') !== LENSES.join(',')) {
    throw new Error(`activityMappings: selector ids (${ACTIVITY_MAPPING_IDS.join(',')}) differ from eventFacets LENSES (${LENSES.join(',')})`);
}
