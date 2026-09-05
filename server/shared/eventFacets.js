/**
 * Event facets — the ONE resolver every analytics consumer calls.
 *
 * Every map this module exports is DERIVED from the verb registry
 * (learningVerbs.js), the object-type table (learningObjectTypes.js) and the
 * plugin manifests. Nothing here is hand-maintained per verb; the exported
 * map names match the literals they replaced so the consumers' imports and
 * tests read the same.
 *
 * Consumers and what they take:
 *   server/lib/learningEventAggregates.js  TNA_MERGE_MAP / tnaMergeTarget
 *   server/routes/cohorts-routes.js        pulseBucket
 *   src/components/analytics/tna/clinicalStates.js    resolveClinicalState + the three state maps
 *   src/components/analytics/tna/activityMappings.js  the lens functions
 *   src/components/analytics/tna/windowSequences.js   room labels (via rooms.js)
 *   src/services/eventLogger.js            OBJECT_TYPES / COMPONENTS
 *
 * Resolution chain for a (verb, object_type) pair, unchanged from the
 * original clinicalStates.js contract and applied to EVERY lens now:
 *   1. explicit `VERB:object_type` interpretation (custom map, then default)
 *   2. the object type's facet
 *   3. the verb's facet
 *   4. a visible literal fallback, so an unregistered pair shows up in the UI
 *      and can be curated — never a silent default bucket for a REGISTERED verb
 *      (tests/server/event-facets.test.js asserts that).
 *
 * Dual-imported (client + server), like server/shared/time.js.
 */
import { PLUGIN_MANIFESTS } from './plugins/manifests.generated.js';
import { foldManifests } from './pluginRegistry.js';
import {
    VERB_FACETS, LEARNING_VERBS, VERBS, normalizeVerb, normalizeEvent, verbWithAliases,
    verbFacets as registryVerbFacets,
} from './learningVerbs.js';
import { BASE_OBJECT_TYPES, BASE_COMPONENTS, BASE_OBJECT_TYPE_FACETS } from './learningObjectTypes.js';
import { ACTION_TO_DOMAIN, ACTION_TO_PULSE, CLINICAL_STATES, humanizeVerb } from './learningVerbFacets.js';
import { ROOMS, roomLabel, roomLabelKey } from './rooms.js';

export { ROOMS, roomLabel, roomLabelKey, normalizeVerb, normalizeEvent, verbWithAliases, LEARNING_VERBS, VERBS, VERB_FACETS, CLINICAL_STATES, ACTION_TO_DOMAIN };

// Explicit verb:object pairs that override the object-first chain. Pair-keyed
// by nature (the meaning lives in the COMBINATION), so this is the one table
// that stays literal; plugin manifests fold their own `states.interpretations`
// into it.
const BASE_INTERPRETATIONS = Object.freeze({
    // Patient record reviewing — verb is generic VIEWED, but the object
    // tells us the trainee is assessing, not navigating.
    'VIEWED:patient_record': 'assessing',
    'VIEWED:history': 'assessing',
    'VIEWED:medications': 'assessing',
    'VIEWED:allergies': 'assessing',
    'VIEWED:lab_result': 'assessing',
    'VIEWED:radiology_result': 'assessing',
    'VIEWED:vital_trend': 'monitoring',

    // Acknowledging an alarm is monitoring even though OPENED is generic UI.
    'OPENED:alarm': 'monitoring',
    'OPENED:monitor': 'monitoring',

    // Opening exam panel = examining intent, not just navigation.
    'OPENED:body_region': 'examining',
    'OPENED:physical_exam': 'examining',

    // Opening orders / treatment drawer = the trainee is about to treat.
    'OPENED:treatment_drawer': 'treating',
    'OPENED:medication_picker': 'treating',
});

// Fine-grained labels for (verb:object) pairs the per-verb label cannot
// disambiguate on its own.
const FINE_LABEL_BY_PAIR = Object.freeze({
    'SENT_MESSAGE:debrief': 'Asked in debrief',
    'RECEIVED_MESSAGE:debrief': 'Debrief reply',
    'SENT_MESSAGE:agent_message': 'Messaged consultant',
    'RECEIVED_MESSAGE:agent_message': 'Consultant replied',
    'VIEWED_RESULT:lab_result': 'Read lab result',
    'VIEWED_RESULT:radiology_result': 'Read radiology',
    'ORDERED_TREATMENT:medication': 'Ordered medication',
    'ORDERED_TREATMENT:iv_fluid': 'Ordered IV fluid',
    'ORDERED_TREATMENT:oxygen_therapy': 'Started oxygen',
    'ORDERED_TREATMENT:nursing_intervention': 'Ordered nursing',
    'ADMINISTERED_TREATMENT:medication': 'Gave medication',
    'ADMINISTERED_TREATMENT:treatment': 'Performed intervention',
    'RELEASED_RESULT:lab_result': 'Lab result ready',
    'RELEASED_RESULT:radiology_result': 'Radiology result ready',
    'DISCONTINUED_TREATMENT:oxygen_therapy': 'Stopped oxygen',
    'CANCELLED_ORDER:lab_test': 'Cancelled lab',
    'CANCELLED_ORDER:radiology_order': 'Cancelled radiology',
    'CANCELLED_ORDER:medication': 'Cancelled medication',
    'SEARCHED:lab_test': 'Searched labs',
    'FILTERED:lab_test': 'Filtered labs',
    'SAVED_CONTENT:case': 'Saved case',
    'EXPORTED_CONTENT:case': 'Exported case',
});

// Fine-grained labels keyed on (verb:object_id) — for the one verb whose
// meaning lives in the record TAB (VIEWED_RECORD). Keyed without the object
// type on purpose: a historical VIEWED_HISTORY row read through the alias map
// carries the tab id but may carry any object type.
const FINE_LABEL_BY_OBJECT_ID = Object.freeze({
    'VIEWED_RECORD:summary': 'Read summary',
    'VIEWED_RECORD:history': 'Read history',
    'VIEWED_RECORD:medications': 'Read medications',
    'VIEWED_RECORD:allergies': 'Read allergies',
    'VIEWED_RECORD:info': 'Read patient info',
    'VIEWED_RECORD:records': 'Read records',
    'VIEWED_RECORD:physical': 'Read past exam',
    'VIEWED_RECORD:procedures': 'Read procedures',
    'VIEWED_RECORD:notes': 'Read notes',
    'VIEWED_RECORD:memory': 'Read memory',
    'VIEWED_RECORD:case_summary': 'Read case summary',
});

// Fine-grained labels keyed on (verb:result), for acts a former verb split
// by outcome (correct/incorrect, onset/peak/offset, created/updated).
const FINE_LABEL_BY_RESULT = Object.freeze({
    'ANSWERED:correct': 'Correct answer',
    'ANSWERED:incorrect': 'Incorrect answer',
    'OBSERVED_TREATMENT_EFFECT:onset': 'Effect onset',
    'OBSERVED_TREATMENT_EFFECT:peak': 'Effect peak',
    'OBSERVED_TREATMENT_EFFECT:offset': 'Effect ended',
    'SAVED_NOTE:created': 'Wrote note',
    'SAVED_NOTE:updated': 'Updated note',
    'CHANGED_SETTING:saved': 'Saved setting',
    'CHANGED_SETTING:reset': 'Reset setting',
    'TOGGLED:selected': 'Selected',
    'TOGGLED:deselected': 'Deselected',
});

const FOLD = foldManifests(PLUGIN_MANIFESTS, {
    objectTypes: BASE_OBJECT_TYPES,
    components: BASE_COMPONENTS,
    objectOverrides: Object.fromEntries(
        Object.entries(BASE_OBJECT_TYPE_FACETS).map(([type, f]) => [type, f.clinicalState]),
    ),
    interpretations: BASE_INTERPRETATIONS,
});

/** Lower-snake object types, rohy's plus every plugin's. */
export const OBJECT_TYPES = Object.freeze(FOLD.objectTypes);
/** PascalCase component names, rohy's plus every plugin's. */
export const COMPONENTS = Object.freeze(FOLD.components);

/**
 * Per-object-type facets, plugins included. A plugin's `states.objectOverrides`
 * contributes the clinical state; action and pulse bucket are set only where
 * rohy's own table says the object changes the reading of the verb.
 */
export const OBJECT_TYPE_FACETS = Object.freeze(Object.fromEntries(
    Object.entries(FOLD.objectOverrides).map(([type, clinicalState]) => [
        type,
        Object.freeze({ ...(BASE_OBJECT_TYPE_FACETS[type] || {}), clinicalState }),
    ]),
));

// --- The derived maps, under the names their literals had -------------------

/** verb → clinical state (the old BASE_VERB_FALLBACKS + plugin fold). */
export const VERB_FALLBACKS = Object.freeze(Object.fromEntries(
    Object.entries(VERB_FACETS).map(([verb, f]) => [verb, f.clinicalState]),
));
/** object type → clinical state (the old BASE_OBJECT_OVERRIDES + plugin fold). */
export const OBJECT_OVERRIDES = Object.freeze(Object.fromEntries(
    Object.entries(OBJECT_TYPE_FACETS).map(([type, f]) => [type, f.clinicalState]),
));
/** 'VERB:object_type' → clinical state, plugin interpretations folded in. */
export const DEFAULT_INTERPRETATIONS = Object.freeze(FOLD.interpretations);
/** verb → clinical action (the old CLINICAL_ACTION_BY_VERB). */
export const CLINICAL_ACTION_BY_VERB = Object.freeze(Object.fromEntries(
    Object.entries(VERB_FACETS).map(([verb, f]) => [verb, f.action]),
));
/** object type → clinical action, only where the object decides. */
export const CLINICAL_ACTION_BY_OBJECT = Object.freeze(Object.fromEntries(
    Object.entries(OBJECT_TYPE_FACETS).filter(([, f]) => f.action).map(([type, f]) => [type, f.action]),
));
/** verb → fine-grained label (the old FINE_LABEL_BY_VERB). */
export const FINE_LABEL_BY_VERB = Object.freeze(Object.fromEntries(
    Object.entries(VERB_FACETS).map(([verb, f]) => [verb, f.label]),
));
/** verb → TNA merge target or null (the old TNA_VERB_MERGE_MAP, now total). */
export const TNA_MERGE_MAP = Object.freeze(Object.fromEntries(
    Object.entries(VERB_FACETS).map(([verb, f]) => [verb, f.tnaMerge]),
));

// --- Resolvers ----------------------------------------------------------------

/**
 * Resolve a (verb, object_type) pair to a clinical state.
 *
 * @param {string} verb        upper-snake event verb, e.g. 'ORDERED_LAB'
 * @param {string} objectType  lower-snake type, e.g. 'lab_test'
 * @param {Record<string,string>} [customMap] user override map keyed by
 *        'VERB:object_type' (the settings tab); falls back to the defaults.
 * @returns {string} one of CLINICAL_STATES, or `${verb}_${objectType}` when
 *          nothing matches — visible on purpose.
 */
export function resolveClinicalState(verb, objectType, customMap) {
    const row = normalizeEvent({ verb: verb || '', object_type: objectType || '' });
    const v = row.verb;
    const o = row.object_type || '';
    const key = `${v}:${o}`;
    const lookup = customMap && customMap[key] ? customMap : DEFAULT_INTERPRETATIONS;
    if (lookup[key]) return lookup[key];
    if (o && OBJECT_OVERRIDES[o]) return OBJECT_OVERRIDES[o];
    if (v && VERB_FALLBACKS[v]) return VERB_FALLBACKS[v];
    return o ? `${v}_${o}` : v || 'navigating';
}

/** clinical-action label for one event (object beats verb, then 'Other'). */
export function clinicalAction(verb, objectType) {
    const row = normalizeEvent({ verb: verb || '', object_type: objectType || '' });
    const o = row.object_type || '';
    if (o && CLINICAL_ACTION_BY_OBJECT[o]) return CLINICAL_ACTION_BY_OBJECT[o];
    return CLINICAL_ACTION_BY_VERB[row.verb] || 'Other';
}

/** medical-domain label for one event (coarsening of clinical-action). */
export function medicalDomain(verb, objectType) {
    return ACTION_TO_DOMAIN[clinicalAction(verb, objectType)] || 'Administration';
}

/**
 * Fine-grained readable label for one event. Alias-aware: a historical
 * `VIEWED_HISTORY` row reads as `VIEWED_RECORD` with object_id `history` and
 * labels "Read history", exactly as a new row would.
 * @param {string} verb
 * @param {string} [objectType]
 * @param {{objectId?: string, result?: string}|string} [extra]  object_id, or {objectId, result}
 */
export function fineLabel(verb, objectType, extra) {
    const given = typeof extra === 'string' ? { objectId: extra } : (extra || {});
    const row = normalizeEvent({
        verb: verb || '', object_type: objectType || '', object_id: given.objectId, result: given.result,
    });
    const v = row.verb;
    const o = row.object_type || '';
    const byId = row.object_id ? FINE_LABEL_BY_OBJECT_ID[`${v}:${row.object_id}`] : undefined;
    if (byId) return byId;
    const byResult = row.result ? FINE_LABEL_BY_RESULT[`${v}:${row.result}`] : undefined;
    if (byResult) return byResult;
    const pair = FINE_LABEL_BY_PAIR[`${v}:${o}`];
    if (pair) return pair;
    return FINE_LABEL_BY_VERB[v] || humanizeVerb(v);
}

/** The activity lenses, coarse → fine. Presentation metadata lives in the client. */
export const LENSES = Object.freeze([
    'clinical-state', 'clinical-action', 'medical-domain', 'fine', 'verb', 'object', 'raw',
]);

/**
 * One label for one event under one lens — the single function both the
 * server sequence builder and the client dashboards use, so the same row
 * labels identically wherever it is drawn.
 *
 * @param {string} verb
 * @param {string} objectType
 * @param {string} [lens='clinical-state']  one of LENSES
 * @param {Record<string,string>} [customStateMap]  clinical-state overrides
 * @param {{objectId?: string, result?: string}} [extra]  for the fine lens
 * @returns {string}
 */
export function activityLabel(verb, objectType, lens = 'clinical-state', customStateMap, extra) {
    const v = verb || '';
    const o = objectType || '';
    switch (lens) {
        case 'clinical-action': return clinicalAction(v, o);
        case 'medical-domain': return medicalDomain(v, o);
        case 'fine': return fineLabel(v, o, extra);
        case 'verb': return normalizeVerb(v) || 'UNKNOWN';
        case 'object': return o || '(none)';
        case 'raw': return o ? `${normalizeVerb(v)}:${o}` : (normalizeVerb(v) || 'UNKNOWN');
        case 'clinical-state':
        default:
            return resolveClinicalState(v, o, customStateMap);
    }
}

/**
 * TNA merge target for an event: a bucket name, null to drop the event from
 * sequences, or undefined for a verb the registry has never heard of (the
 * caller decides — the sequence builder passes it through raw so it stays
 * visible). Object-first like every other lens: a SEARCHED on a lab_test is
 * ordering work and a CANCELLED_ORDER on a medication is treatment, as the
 * verbs they replaced always were. A verb that drops from sequences (null)
 * stays dropped whatever the object.
 * @param {string} verb
 * @param {string} [objectType]
 * @returns {string|null|undefined}
 */
export function tnaMergeTarget(verb, objectType) {
    const row = normalizeEvent({ verb: verb || '', object_type: objectType || '' });
    const v = row.verb;
    if (!Object.prototype.hasOwnProperty.call(TNA_MERGE_MAP, v)) return undefined;
    const own = TNA_MERGE_MAP[v];
    const o = row.object_type || '';
    if (own === null) return null;
    const byObject = o ? OBJECT_TYPE_FACETS[o]?.tnaMerge : undefined;
    return byObject || own;
}

/**
 * Course-pulse bucket for an event. Object-first like every other lens.
 * @param {string} verb
 * @param {string} [objectType]
 * @returns {string|null} null for an unregistered verb
 */
export function pulseBucket(verb, objectType) {
    const o = objectType || '';
    const objectFacet = o ? OBJECT_TYPE_FACETS[o] : null;
    if (objectFacet?.pulseBucket) return objectFacet.pulseBucket;
    if (objectFacet?.action && ACTION_TO_PULSE[objectFacet.action]) return ACTION_TO_PULSE[objectFacet.action];
    const facets = registryVerbFacets(verb);
    return facets ? facets.pulseBucket : null;
}

/** Full facet row for a verb (alias-aware), or null. */
export const verbFacets = registryVerbFacets;
