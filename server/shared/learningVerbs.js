/**
 * The learning-event verb registry — one source of truth, used by every ingest
 * path and every analytics consumer.
 *
 * One row per verb, and the row carries EVERYTHING rohy knows about the verb:
 * the two persisted columns (severity, category — CHECK constraints on
 * learning_events), the clinical state, the clinical-action / medical-domain /
 * fine-grained labels the activity lenses show, the TNA merge target, the
 * cohort pulse bucket, and who emits it. `BASE_LEARNING_VERBS` is derived from
 * the keys, so the whitelist and the metadata cannot drift apart the way the
 * two hand-maintained lists in this file used to (SCROLLED and EDITED_MESSAGE
 * were whitelisted for months with no metadata row).
 *
 * History, briefly: the metadata map used to live client-side in
 * src/services/eventLogger.js, so the server dropped severity/category and
 * every row landed NULL; then it moved here as a (severity, category) map;
 * now it is the full facet row, because five analytics consumers each kept a
 * private verb→label table and disagreed with each other. See
 * server/shared/learningVerbFacets.js for the enums and the argument.
 *
 * Plugin verbs arrive through the generated manifests and are folded in by
 * foldManifests, which throws on a collision rather than letting a spread
 * silently redefine a verb (RPS-1 R11).
 */
import { PLUGIN_MANIFESTS } from '../shared/plugins/manifests.generated.js';
import { foldManifests, setPluginManifests, setCoreVerbNames } from './pluginRegistry.js';
import {
    SEVERITIES, CATEGORIES as CATEGORY_VALUES, completeFacets, validateFacets,
} from './learningVerbFacets.js';

/** xAPI severity of an event. Mirrors the learning_events CHECK constraint. */
export const SEVERITY = Object.freeze({
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    ACTION: 'ACTION',
    IMPORTANT: 'IMPORTANT',
    CRITICAL: 'CRITICAL',
});

/** Coarse activity bucket. Mirrors the learning_events CHECK constraint. */
export const CATEGORIES = Object.freeze({
    SESSION: 'SESSION',
    NAVIGATION: 'NAVIGATION',
    CLINICAL: 'CLINICAL',
    COMMUNICATION: 'COMMUNICATION',
    MONITORING: 'MONITORING',
    CONFIGURATION: 'CONFIGURATION',
    ASSESSMENT: 'ASSESSMENT',
    ERROR: 'ERROR',
});

const { DEBUG, INFO, IMPORTANT, CRITICAL } = SEVERITY;
const {
    SESSION, NAVIGATION, CLINICAL, COMMUNICATION, MONITORING, CONFIGURATION, ASSESSMENT, ERROR,
} = CATEGORIES;

/**
 * Compact row builder. Positional for the five facets every row declares;
 * `extra` for the derived ones a row overrides (`tnaMerge`, `pulseBucket`,
 * `domain`, `severityByObjectType`) and for `emitterNote`.
 */
const row = (severity, category, clinicalState, action, label, emitter, extra = {}) => ({
    severity, category, clinicalState, action, label, emitter, ...extra,
});

// A `planned` emitter is a verb whose UI does not exist yet, or whose helper
// exists with no caller. The note says where the emitter would live, so the
// coverage test can print a to-do list rather than a bare count.
const planned = (note) => ({ emitter: 'planned', emitterNote: note });

/**
 * rohy's own verbs. Grouped as the vocabulary is grouped; the ORDER here is
 * cosmetic (`BASE_LEARNING_VERBS` is sorted by insertion, which tests treat as
 * a set). Facet values for verbs that pre-date this table are byte-identical
 * to the five maps they replaced — tests/server/derived-maps-parity.test.js
 * pins that against tests/fixtures/verb-maps-v1.json.
 */
export const BASE_VERB_FACETS = Object.freeze(Object.fromEntries(Object.entries({
    // --- Session lifecycle ---------------------------------------------------
    STARTED_SESSION: row(IMPORTANT, SESSION, 'regulating', 'Session', 'Started session', 'client'),
    ENDED_SESSION: row(IMPORTANT, SESSION, 'regulating', 'Session', 'Ended session', 'client'),
    RESUMED_SESSION: row(INFO, SESSION, 'regulating', 'Session', 'Resumed session', 'client'),
    TIMED_OUT_SESSION: row(INFO, SESSION, 'regulating', 'Session', 'Idle timeout', 'planned',
        planned('no idle-timeout emitter; App.jsx session-expiry cleanup should emit it')),
    UNLOADED_APP: row(INFO, SESSION, 'regulating', 'Session', 'Left session', 'client', { tnaMerge: null }),
    LOADED_CASE: row(IMPORTANT, SESSION, 'regulating', 'Session', 'Loaded case', 'client'),
    // Written by auth-routes directly; a client may never emit these.
    LOGGED_IN: row(INFO, SESSION, 'regulating', 'Session', 'Logged in', 'server'),
    LOGGED_OUT: row(INFO, SESSION, 'regulating', 'Session', 'Logged out', 'server'),
    FAILED_LOGIN: row(IMPORTANT, SESSION, 'regulating', 'Session', 'Failed login', 'server'),

    // --- Navigation / generic UI --------------------------------------------
    // Bare verbs: object_type carries the meaning (a VIEWED on a
    // patient_record is assessing; a SEARCHED on a lab_test is investigating).
    VIEWED: row(DEBUG, NAVIGATION, 'navigating', 'Navigating', 'Viewed', 'client'),
    OPENED: row(INFO, NAVIGATION, 'navigating', 'Navigating', 'Opened panel', 'client'),
    CLOSED: row(DEBUG, NAVIGATION, 'navigating', 'Navigating', 'Closed panel', 'client'),
    NAVIGATED: row(DEBUG, NAVIGATION, 'navigating', 'Navigating', 'Changed room', 'client'),
    SWITCHED_TAB: row(DEBUG, NAVIGATION, 'navigating', 'Navigating', 'Switched tab', 'client'),
    SCROLLED: row(DEBUG, NAVIGATION, 'navigating', 'Navigating', 'Scrolled', 'planned',
        planned('no scroll emitter; long lists (investigations, treatments) should emit it throttled')),
    LOST_FOCUS: row(DEBUG, NAVIGATION, 'navigating', 'Navigating', 'Lost focus', 'client', { tnaMerge: null }),
    RESUMED_FOCUS: row(DEBUG, NAVIGATION, 'navigating', 'Navigating', 'Resumed focus', 'client', { tnaMerge: null }),
    CLICKED: row(DEBUG, NAVIGATION, 'navigating', 'Navigating', 'Clicked', 'client'),
    TOGGLED: row(DEBUG, NAVIGATION, 'navigating', 'Navigating', 'Toggled', 'client'),
    EXPANDED: row(DEBUG, NAVIGATION, 'navigating', 'Navigating', 'Expanded', 'client'),
    COLLAPSED: row(DEBUG, NAVIGATION, 'navigating', 'Navigating', 'Collapsed', 'client'),
    SEARCHED: row(DEBUG, NAVIGATION, 'navigating', 'Navigating', 'Searched', 'client'),
    FILTERED: row(DEBUG, NAVIGATION, 'navigating', 'Navigating', 'Filtered', 'client'),
    SORTED: row(DEBUG, NAVIGATION, 'navigating', 'Navigating', 'Sorted', 'planned',
        planned('sortable tables should emit it')),
    NOTIFIED: row(DEBUG, NAVIGATION, 'navigating', 'Navigating', 'Notified', 'client', { tnaMerge: null }),

    // --- Investigations ------------------------------------------------------
    ORDERED_LAB: row(IMPORTANT, CLINICAL, 'investigating', 'Ordering', 'Ordered lab', 'server'),
    ORDERED_IMAGING: row(IMPORTANT, CLINICAL, 'investigating', 'Ordering', 'Ordered radiology', 'server'),
    CANCELLED_ORDER: row(INFO, CLINICAL, 'investigating', 'Ordering', 'Cancelled order', 'planned',
        { severityByObjectType: { medication: IMPORTANT }, ...planned('no cancel-order UI exists') }),
    VIEWED_RESULT: row(INFO, CLINICAL, 'assessing', 'Reading results', 'Read result', 'server',
        { tnaMerge: 'VIEWED_RESULT' }),
    RELEASED_RESULT: row(INFO, CLINICAL, 'assessing', 'Reading results', 'Result released', 'client', { tnaMerge: 'VIEWED_RESULT' }),
    EDITED_LAB_VALUE: row(IMPORTANT, CLINICAL, 'investigating', 'Ordering', 'Edited lab value', 'server', { tnaMerge: null }),

    // --- Treatment -----------------------------------------------------------
    // One verb per act; object_type says what kind (medication, iv_fluid,
    // oxygen_therapy, nursing_intervention, treatment). A drug order keeps the
    // CRITICAL severity ORDERED_MEDICATION carried, by object type.
    ORDERED_TREATMENT: row(IMPORTANT, CLINICAL, 'treating', 'Treating', 'Ordered treatment', 'client',
        { severityByObjectType: { medication: CRITICAL, nursing_intervention: INFO } }),
    ADMINISTERED_TREATMENT: row(IMPORTANT, CLINICAL, 'treating', 'Treating', 'Gave treatment', 'client',
        { severityByObjectType: { medication: CRITICAL } }),
    DISCONTINUED_TREATMENT: row(IMPORTANT, CLINICAL, 'treating', 'Treating', 'Stopped treatment', 'client',
        { severityByObjectType: { oxygen_therapy: INFO } }),
    OBSERVED_TREATMENT_EFFECT: row(INFO, CLINICAL, 'treating', 'Treating', 'Treatment effect', 'client', { tnaMerge: null }),
    FLAGGED_CONTRAINDICATION: row(CRITICAL, ASSESSMENT, 'treating', 'Treating', 'Contraindicated order', 'client', { tnaMerge: null }),
    MET_EXPECTED_TREATMENT: row(IMPORTANT, ASSESSMENT, 'treating', 'Treating', 'Correct treatment', 'client', { tnaMerge: null }),
    MISSED_EXPECTED_TREATMENT: row(IMPORTANT, ASSESSMENT, 'treating', 'Treating', 'Missed treatment', 'planned',
        { tnaMerge: null, ...planned('no server emitter at session end for unmet expected treatments') }),

    // --- Examination ---------------------------------------------------------
    PERFORMED_PHYSICAL_EXAM: row(IMPORTANT, CLINICAL, 'examining', 'Examining', 'Examined patient', 'client'),
    OPENED_EXAM_PANEL: row(INFO, CLINICAL, 'examining', 'Examining', 'Opened exam', 'client'),
    CLOSED_EXAM_PANEL: row(DEBUG, CLINICAL, 'examining', 'Examining', 'Closed exam', 'client'),

    // --- Patient record ------------------------------------------------------
    // One verb; object_id names the tab (summary, history, medications,
    // allergies, physical, procedures, notes, records, memory, case_summary).
    VIEWED_RECORD: row(INFO, CLINICAL, 'assessing', 'History', 'Read record', 'client'),
    RECORDED_HISTORY: row(INFO, CLINICAL, 'assessing', 'History', 'Recorded history', 'client'),

    // --- Communication -------------------------------------------------------
    SENT_MESSAGE: row(INFO, COMMUNICATION, 'communicating', 'Communicating', 'Messaged patient', 'client'),
    RECEIVED_MESSAGE: row(INFO, COMMUNICATION, 'communicating', 'Communicating', 'Patient replied', 'client',
        { tnaMerge: 'RECEIVED_MESSAGE' }),
    COPIED_MESSAGE: row(DEBUG, COMMUNICATION, 'communicating', 'Communicating', 'Copied message', 'planned',
        planned('messageCopied() has no caller')),
    EDITED_MESSAGE: row(DEBUG, COMMUNICATION, 'communicating', 'Communicating', 'Edited message', 'planned',
        planned('no message-edit UI exists')),
    PAGED_AGENT: row(IMPORTANT, COMMUNICATION, 'communicating', 'Consulting', 'Paged consultant', 'client', { tnaMerge: 'CONSULTED_AGENT' }),
    ARRIVED_AGENT: row(INFO, COMMUNICATION, 'communicating', 'Consulting', 'Consultant arrived', 'client', { tnaMerge: 'CONSULTED_AGENT' }),
    RECOGNIZED_SPEECH: row(DEBUG, COMMUNICATION, 'communicating', 'Communicating', 'Speech recognised', 'client', { tnaMerge: null }),
    FAILED_SPEECH_RECOGNITION: row(IMPORTANT, ERROR, 'communicating', 'Communicating', 'Speech recognition failed', 'client', { tnaMerge: null }),
    PLAYED_TTS: row(DEBUG, COMMUNICATION, 'communicating', 'Communicating', 'Played speech', 'client', { tnaMerge: null }),
    EXPRESSED_EMOTION: row(INFO, COMMUNICATION, 'reflecting', 'Debriefing', 'Emotion pulse', 'client', { tnaMerge: null }),

    // --- Monitoring ----------------------------------------------------------
    ADJUSTED_VITAL: row(INFO, MONITORING, 'monitoring', 'Monitoring', 'Adjusted vital', 'client'),
    VIEWED_TREND: row(INFO, MONITORING, 'monitoring', 'Monitoring', 'Viewed trends', 'planned',
        planned('VitalTrends render should emit it')),
    TRIGGERED_ALARM: row(CRITICAL, MONITORING, 'monitoring', 'Monitoring', 'Alarm fired', 'client', { tnaMerge: 'ALARM_RESPONSE' }),
    ACKNOWLEDGED_ALARM: row(INFO, MONITORING, 'monitoring', 'Monitoring', 'Acknowledged alarm', 'client',
        { tnaMerge: 'ALARM_RESPONSE' }),
    SILENCED_ALARM: row(INFO, MONITORING, 'monitoring', 'Monitoring', 'Snoozed alarm', 'client',
        { tnaMerge: 'ALARM_RESPONSE' }),

    // --- Documentation / debrief --------------------------------------------
    SAVED_NOTE: row(INFO, CLINICAL, 'documenting', 'Documenting', 'Saved note', 'client'),
    SUBMITTED_DEBRIEF: row(IMPORTANT, ASSESSMENT, 'reflecting', 'Debriefing', 'Submitted debrief', 'client'),

    // --- Configuration / authoring ------------------------------------------
    CHANGED_SETTING: row(INFO, CONFIGURATION, 'regulating', 'Session', 'Changed setting', 'server'),
    SAVED_CONTENT: row(INFO, CONFIGURATION, 'regulating', 'Session', 'Saved content', 'client'),
    EXPORTED_CONTENT: row(INFO, CONFIGURATION, 'regulating', 'Session', 'Exported content', 'client'),
    IMPORTED_CONTENT: row(INFO, CONFIGURATION, 'regulating', 'Session', 'Imported content', 'planned',
        planned('case / catalogue imports emit nothing')),
    DUPLICATED_CONTENT: row(INFO, CONFIGURATION, 'regulating', 'Session', 'Duplicated content', 'client'),
    DELETED_CONTENT: row(INFO, CONFIGURATION, 'regulating', 'Session', 'Deleted content', 'planned',
        planned('content deletes emit nothing')),
    OPENED_PLUGIN_EDITOR: row(INFO, CONFIGURATION, 'regulating', 'Session', 'Opened plugin editor', 'client', { tnaMerge: null }),
    EDITED_PLUGIN_DOCUMENT: row(INFO, CONFIGURATION, 'regulating', 'Session', 'Edited plugin document', 'client', { tnaMerge: null }),
    SAVED_PLUGIN_DOCUMENT: row(IMPORTANT, CONFIGURATION, 'regulating', 'Session', 'Saved plugin document', 'client', { tnaMerge: null }),

    // --- Scenario ------------------------------------------------------------
    STARTED_SCENARIO: row(IMPORTANT, SESSION, 'regulating', 'Session', 'Started scenario', 'client'),
    PAUSED_SCENARIO: row(INFO, SESSION, 'regulating', 'Session', 'Paused scenario', 'client'),
    RESUMED_SCENARIO: row(INFO, SESSION, 'regulating', 'Session', 'Resumed scenario', 'client'),
    COMPLETED_SCENARIO: row(IMPORTANT, ASSESSMENT, 'regulating', 'Session', 'Completed scenario', 'client'),
    RESET_SCENARIO: row(INFO, SESSION, 'regulating', 'Session', 'Reset scenario', 'planned',
        planned('no emitter')),
    JUMPED_SCENARIO_STEP: row(INFO, SESSION, 'regulating', 'Session', 'Jumped scenario step', 'client'),

    // --- Assessment / submissions -------------------------------------------
    SUBMITTED: row(IMPORTANT, ASSESSMENT, 'studying', 'Studying', 'Submitted', 'client', { tnaMerge: null }),
    ANSWERED: row(INFO, ASSESSMENT, 'studying', 'Studying', 'Answered', 'client', { tnaMerge: null }),
    ATTEMPTED: row(INFO, ASSESSMENT, 'studying', 'Studying', 'Attempted', 'planned',
        { tnaMerge: null, ...planned('no emitter') }),

    // --- Lessons / media -----------------------------------------------------
    ENROLLED_COURSE: row(IMPORTANT, SESSION, 'studying', 'Studying', 'Enrolled in course', 'planned',
        { tnaMerge: null, ...planned('lessons enrol action should emit it') }),
    OPENED_VIDEO: row(DEBUG, ASSESSMENT, 'studying', 'Studying', 'Opened video', 'client'),
    PLAYED_VIDEO: row(INFO, ASSESSMENT, 'studying', 'Studying', 'Played video', 'client'),
    PAUSED_VIDEO: row(DEBUG, ASSESSMENT, 'studying', 'Studying', 'Paused video', 'client'),
    SEEKED_VIDEO: row(DEBUG, ASSESSMENT, 'studying', 'Studying', 'Seeked video', 'client'),
    CHANGED_VIDEO_SPEED: row(DEBUG, ASSESSMENT, 'studying', 'Studying', 'Changed video speed', 'client'),
    PROGRESSED_VIDEO: row(DEBUG, ASSESSMENT, 'studying', 'Studying', 'Video progress', 'client', { tnaMerge: null }),
    COMPLETED_VIDEO: row(IMPORTANT, ASSESSMENT, 'studying', 'Studying', 'Completed video', 'client'),
    CLOSED_VIDEO: row(DEBUG, ASSESSMENT, 'studying', 'Studying', 'Closed video', 'client'),

    // --- Onboarding / help ---------------------------------------------------
    STARTED_TOUR: row(INFO, NAVIGATION, 'navigating', 'Navigating', 'Started tour', 'client', { tnaMerge: null }),
    ADVANCED_TOUR_STEP: row(DEBUG, NAVIGATION, 'navigating', 'Navigating', 'Advanced tour step', 'client', { tnaMerge: null }),
    ENDED_TOUR: row(INFO, NAVIGATION, 'navigating', 'Navigating', 'Ended tour', 'client', { tnaMerge: null }),

    // --- Oyon consent / capture --------------------------------------------
    RECORDED_CONSENT: row(INFO, SESSION, 'regulating', 'Session', 'Recorded consent', 'client'),
    STARTED_CAPTURE: row(DEBUG, SESSION, 'regulating', 'Session', 'Started capture', 'client'),
    STOPPED_CAPTURE: row(DEBUG, SESSION, 'regulating', 'Session', 'Stopped capture', 'client'),

    // --- Errors --------------------------------------------------------------
    RAISED_ERROR: row(CRITICAL, ERROR, 'navigating', 'Navigating', 'Error', 'client', { tnaMerge: null }),
    FAILED_REQUEST: row(CRITICAL, ERROR, 'navigating', 'Navigating', 'Request failed', 'planned',
        { tnaMerge: null, ...planned('apiError() has no caller; apiClient should emit it') }),
    FAILED_VALIDATION: row(INFO, ERROR, 'navigating', 'Navigating', 'Validation failed', 'planned',
        { tnaMerge: null, ...planned('no emitter') }),
    // A client tried to emit a verb the registry does not know. The row is
    // kept (never discard a click), the attempted verb rides in context.
    UNDECLARED_VERB: row(IMPORTANT, ERROR, 'navigating', 'Navigating', 'Undeclared verb', 'client', { tnaMerge: null }),
}).map(([verb, partial]) => [verb, validateFacets(verb, completeFacets(verb, partial))])));

/** rohy's own verbs — the whitelist IS the facet table's key set. */
export const BASE_LEARNING_VERBS = Object.freeze(Object.keys(BASE_VERB_FACETS));

/** Verbs only the server may write. A client posting one is forging. */
export const SERVER_ONLY_VERBS = Object.freeze(
    BASE_LEARNING_VERBS.filter((verb) => BASE_VERB_FACETS[verb].emitter === 'server'),
);

// --- Aliases ---------------------------------------------------------------
//
// Historical rows are never rewritten. When a verb is renamed or folded into
// another, the OLD name goes here with how to read it as the canonical one,
// and every consumer normalises at read time. Populated by the rename phase;
// empty means "no verb has been renamed yet".
//
//   { OLD_VERB: { to: 'CANONICAL', objectType?, objectId?, result?, since } }
//
// `objectType` / `objectId` / `result` are defaults applied ONLY when the
// historical row's own value is null or the generic placeholder — never over
// a value the row already carries.

const V2 = '3.0.0-beta.10';
const alias = (to, extra = {}) => Object.freeze({ to, since: V2, ...extra });

/** @type {Readonly<Record<string, {to: string, objectType?: string, objectId?: string, result?: string, since: string}>>} */
export const VERB_ALIASES = Object.freeze({
    // Session
    IDLE_TIMEOUT: alias('TIMED_OUT_SESSION'),
    UNLOAD: alias('UNLOADED_APP'),
    // Selection is one act with a sign
    SELECTED: alias('TOGGLED', { result: 'selected' }),
    DESELECTED: alias('TOGGLED', { result: 'deselected' }),
    // Investigations: the object type carries lab vs imaging
    CANCELLED_LAB: alias('CANCELLED_ORDER', { objectType: 'lab_test' }),
    CANCELLED_IMAGING: alias('CANCELLED_ORDER', { objectType: 'radiology_order' }),
    CANCELLED_MEDICATION: alias('CANCELLED_ORDER', { objectType: 'medication' }),
    SEARCHED_LABS: alias('SEARCHED', { objectType: 'lab_test' }),
    FILTERED_LABS: alias('FILTERED', { objectType: 'lab_test' }),
    VIEWED_LAB_RESULT: alias('VIEWED_RESULT', { objectType: 'lab_result' }),
    VIEWED_RADIOLOGY_RESULT: alias('VIEWED_RESULT', { objectType: 'radiology_result' }),
    LAB_RESULT_READY: alias('RELEASED_RESULT', { objectType: 'lab_result' }),
    // Treatment: one verb per act, object type per kind
    ORDERED_MEDICATION: alias('ORDERED_TREATMENT', { objectType: 'medication' }),
    ORDERED_IV_FLUID: alias('ORDERED_TREATMENT', { objectType: 'iv_fluid' }),
    STARTED_OXYGEN: alias('ORDERED_TREATMENT', { objectType: 'oxygen_therapy' }),
    ORDERED_NURSING: alias('ORDERED_TREATMENT', { objectType: 'nursing_intervention' }),
    ADMINISTERED_MEDICATION: alias('ADMINISTERED_TREATMENT', { objectType: 'medication' }),
    PERFORMED_INTERVENTION: alias('ADMINISTERED_TREATMENT', { objectType: 'treatment' }),
    STOPPED_OXYGEN: alias('DISCONTINUED_TREATMENT', { objectType: 'oxygen_therapy' }),
    TREATMENT_EFFECT_STARTED: alias('OBSERVED_TREATMENT_EFFECT', { result: 'onset' }),
    TREATMENT_EFFECT_PEAKED: alias('OBSERVED_TREATMENT_EFFECT', { result: 'peak' }),
    TREATMENT_EFFECT_ENDED: alias('OBSERVED_TREATMENT_EFFECT', { result: 'offset' }),
    CONTRAINDICATED_TREATMENT_ORDERED: alias('FLAGGED_CONTRAINDICATION'),
    EXPECTED_TREATMENT_GIVEN: alias('MET_EXPECTED_TREATMENT'),
    EXPECTED_TREATMENT_MISSED: alias('MISSED_EXPECTED_TREATMENT'),
    // Patient record: one verb, object_id names the tab
    VIEWED_PATIENT_SUMMARY: alias('VIEWED_RECORD', { objectId: 'summary' }),
    VIEWED_HISTORY: alias('VIEWED_RECORD', { objectId: 'history' }),
    VIEWED_MEDICATIONS: alias('VIEWED_RECORD', { objectId: 'medications' }),
    VIEWED_ALLERGIES: alias('VIEWED_RECORD', { objectId: 'allergies' }),
    VIEWED_PATIENT_INFO: alias('VIEWED_RECORD', { objectId: 'info' }),
    VIEWED_RECORDS: alias('VIEWED_RECORD', { objectId: 'records' }),
    // Communication
    STT_RESULT: alias('RECOGNIZED_SPEECH'),
    STT_ERROR: alias('FAILED_SPEECH_RECOGNITION'),
    TTS_PLAYED: alias('PLAYED_TTS'),
    // Monitoring
    VIEWED_TRENDS: alias('VIEWED_TREND'),
    ALARM_TRIGGERED: alias('TRIGGERED_ALARM'),
    // Documentation
    WROTE_NOTE: alias('SAVED_NOTE', { result: 'created' }),
    UPDATED_NOTE: alias('SAVED_NOTE', { result: 'updated' }),
    // Settings / content
    SAVED_SETTING: alias('CHANGED_SETTING', { result: 'saved' }),
    RESET_SETTING: alias('CHANGED_SETTING', { result: 'reset' }),
    SAVED_CASE: alias('SAVED_CONTENT', { objectType: 'case' }),
    EXPORTED_CASE: alias('EXPORTED_CONTENT', { objectType: 'case' }),
    // Assessment
    CORRECT_ANSWER: alias('ANSWERED', { result: 'correct' }),
    INCORRECT_ANSWER: alias('ANSWERED', { result: 'incorrect' }),
    // Errors
    ERROR_OCCURRED: alias('RAISED_ERROR'),
    API_ERROR: alias('FAILED_REQUEST'),
    VALIDATION_ERROR: alias('FAILED_VALIDATION'),
});

const GENERIC_OBJECT_TYPES = new Set(['component', 'panel', 'treatment']);

/**
 * Canonical name for a verb. Total and idempotent: an unknown verb passes
 * through unchanged (it is quarantined at ingest, never dropped here).
 * @param {string} verb
 * @returns {string}
 */
export function normalizeVerb(verb) {
    const alias = VERB_ALIASES[verb];
    return alias ? alias.to : verb;
}

/**
 * A row as v2 would have written it: canonical verb plus any object/result
 * defaults the alias supplies for fields the historical row left generic.
 * @param {{verb: string, object_type?: string, object_id?: string, result?: string}} event
 * @returns {object} a shallow copy with the normalised fields
 */
export function normalizeEvent(event) {
    const alias = VERB_ALIASES[event?.verb];
    if (!alias) return event;
    const out = { ...event, verb: alias.to };
    if (alias.objectType && (!out.object_type || GENERIC_OBJECT_TYPES.has(out.object_type))) {
        out.object_type = alias.objectType;
    }
    if (alias.objectId && !out.object_id) out.object_id = alias.objectId;
    if (alias.result && !out.result) out.result = alias.result;
    return out;
}

/**
 * A canonical verb plus every historical alias of it — for an index-usable
 * `verb IN (...)` predicate.
 * @param {string} canonical
 * @returns {string[]}
 */
export function verbWithAliases(canonical) {
    const aliases = Object.entries(VERB_ALIASES)
        .filter(([, alias]) => alias.to === canonical)
        .map(([old]) => old);
    return [canonical, ...aliases];
}

// --- The fold ---------------------------------------------------------------

// The attribution check in pluginRegistry needs the installed manifests; this
// module is the one place that folds them, so it registers them too.
setCoreVerbNames(BASE_LEARNING_VERBS);
setPluginManifests(PLUGIN_MANIFESTS);

const FOLDED = foldManifests(PLUGIN_MANIFESTS, {
    verbs: Object.fromEntries(BASE_LEARNING_VERBS.map((v) => [v, v])),
    verbFacets: BASE_VERB_FACETS,
});

/** Base verbs plus every registered plugin's declared vocabulary (RPS-1). */
export const LEARNING_VERBS = Object.freeze(Object.keys(FOLDED.verbs));

/** Verb → itself, for `VERBS.ORDERED_LAB`-style references. */
export const VERBS = Object.freeze(FOLDED.verbs);

/** Every verb's completed facet row, plugins included. */
export const VERB_FACETS = Object.freeze(FOLDED.verbFacets);

/**
 * (severity, category) per verb — the two persisted columns, as a view over
 * VERB_FACETS so the ingest path's contract is unchanged.
 */
export const VERB_METADATA = Object.freeze(Object.fromEntries(
    Object.entries(VERB_FACETS).map(([verb, f]) => [verb, Object.freeze({ severity: f.severity, category: f.category })]),
));

/** Used when a verb carries no facet row (only reachable for an unregistered verb). */
export const DEFAULT_VERB_METADATA = Object.freeze({
    severity: SEVERITY.INFO,
    category: CATEGORIES.NAVIGATION,
});

/**
 * The facet row for a verb, alias-aware. Unregistered verbs get null so a
 * consumer can choose its own fallback explicitly.
 * @param {string} verb
 * @returns {Readonly<object>|null}
 */
export function verbFacets(verb) {
    return VERB_FACETS[normalizeVerb(verb)] ?? null;
}

/**
 * Resolve the (severity, category) to persist for one event.
 *
 * The verb's registry row is the default; a caller-supplied value overrides it,
 * because some overrides are genuinely information the server cannot derive
 * (LAB_RESULT_READY is IMPORTANT when the result is abnormal and INFO when it
 * is not — same verb, different severity). What a caller may NOT do is invent a
 * value outside the enum: that would fail the CHECK constraint at INSERT time
 * and take the whole event down with it, so it is reported rather than coerced.
 *
 * `objectType` lets a verb whose severity depends on WHAT was acted on
 * (`severityByObjectType`) resolve without the caller knowing the rule.
 *
 * @param {string} verb
 * @param {{severity?: string, category?: string}} [supplied] client-supplied overrides
 * @param {string} [objectType]
 * @returns {{ok: true, severity: string, category: string}
 *          |{ok: false, field: 'severity'|'category', value: unknown}}
 */
export function resolveEventMetadata(verb, supplied = {}, objectType = undefined) {
    const { severity, category } = supplied || {};
    if (severity != null && !SEVERITIES.includes(severity)) {
        return { ok: false, field: 'severity', value: severity };
    }
    if (category != null && !CATEGORY_VALUES.includes(category)) {
        return { ok: false, field: 'category', value: category };
    }
    const facets = verbFacets(verb);
    const meta = facets || DEFAULT_VERB_METADATA;
    const byObject = facets?.severityByObjectType && objectType
        ? facets.severityByObjectType[objectType]
        : undefined;
    return {
        ok: true,
        severity: severity ?? byObject ?? meta.severity,
        category: category ?? meta.category,
    };
}

export default LEARNING_VERBS;
