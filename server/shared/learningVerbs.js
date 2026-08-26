/**
 * The learning-event verb registry — one source of truth, used by every ingest path.
 *
 * Two things live here, and they belong together: the WHITELIST (which verbs
 * exist) and the METADATA (what severity/category each verb carries). The
 * metadata map used to live client-side in src/services/eventLogger.js, which
 * meant the server had no way to fill `learning_events.severity` / `.category`
 * except by believing whatever the client posted — and it did not believe it,
 * it simply dropped both columns. Every row landed NULL. Moving the map under
 * server/shared/ lets the server DERIVE the metadata from the verb, the same
 * way it derives (user_id, case_id) from session_id.
 *
 * This lived inline in analytics-routes.js as a single array that the
 * single-event route validated against and the batch route ignored, and it
 * contained no plugin verbs at all. The result was that whether an event was
 * validated depended on which endpoint the client happened to call, and a
 * plugin's events were accepted only because the client batches. Extracting it
 * here makes the two paths share one list and makes the invariant testable
 * without booting the server.
 */
import { PLUGIN_MANIFESTS } from '../shared/plugins/manifests.generated.js';
// `CATEGORIES` in pluginRegistry is the ARRAY of legal values (it validates
// manifests); the object of named constants below is what callers write
// against. Aliased so the two never get confused at a use site.
import { foldManifests, SEVERITIES, CATEGORIES as CATEGORY_VALUES } from './pluginRegistry.js';

export const BASE_LEARNING_VERBS = [
    // Session lifecycle
    'STARTED_SESSION', 'ENDED_SESSION', 'RESUMED_SESSION', 'IDLE_TIMEOUT', 'UNLOAD',
    // Navigation
    'VIEWED', 'OPENED', 'CLOSED', 'NAVIGATED', 'SWITCHED_TAB',
    'SCROLLED', 'LOST_FOCUS', 'RESUMED_FOCUS',
    // Interactions
    'CLICKED', 'SELECTED', 'DESELECTED', 'TOGGLED', 'EXPANDED', 'COLLAPSED',
    // Lab/Investigation actions
    'ORDERED_LAB', 'CANCELLED_LAB', 'VIEWED_LAB_RESULT', 'SEARCHED_LABS',
    'FILTERED_LABS', 'LAB_RESULT_READY',
    // Radiology / imaging actions
    'ORDERED_IMAGING', 'CANCELLED_IMAGING', 'VIEWED_RADIOLOGY_RESULT',
    // Medication/treatment actions
    'ORDERED_MEDICATION', 'ADMINISTERED_MEDICATION', 'CANCELLED_MEDICATION',
    'ORDERED_TREATMENT', 'PERFORMED_INTERVENTION', 'ORDERED_IV_FLUID',
    'STARTED_OXYGEN', 'STOPPED_OXYGEN', 'ORDERED_NURSING',
    'DISCONTINUED_TREATMENT', 'TREATMENT_EFFECT_STARTED',
    'TREATMENT_EFFECT_PEAKED', 'TREATMENT_EFFECT_ENDED',
    'CONTRAINDICATED_TREATMENT_ORDERED', 'EXPECTED_TREATMENT_GIVEN',
    'EXPECTED_TREATMENT_MISSED',
    // Physical examination
    'PERFORMED_PHYSICAL_EXAM', 'OPENED_EXAM_PANEL', 'CLOSED_EXAM_PANEL',
    // Chat interactions
    'SENT_MESSAGE', 'RECEIVED_MESSAGE', 'COPIED_MESSAGE',
    'EDITED_MESSAGE', 'STT_RESULT', 'STT_ERROR', 'TTS_PLAYED',
    // Monitor interactions
    'ADJUSTED_VITAL', 'ACKNOWLEDGED_ALARM', 'SILENCED_ALARM',
    'ALARM_TRIGGERED', 'VIEWED_TRENDS',
    // Instructor / case authoring
    'EDITED_LAB_VALUE',
    // Patient record
    'VIEWED_PATIENT_SUMMARY', 'VIEWED_HISTORY', 'VIEWED_MEDICATIONS',
    'VIEWED_ALLERGIES',
    // Documentation / debrief
    'WROTE_NOTE', 'SAVED_NOTE', 'UPDATED_NOTE', 'SUBMITTED_DEBRIEF',
    // Settings
    'CHANGED_SETTING', 'SAVED_SETTING', 'RESET_SETTING',
    // Case interactions
    'LOADED_CASE', 'VIEWED_PATIENT_INFO', 'VIEWED_RECORDS',
    'SAVED_CASE', 'EXPORTED_CASE',
    // Scenario interactions
    'STARTED_SCENARIO', 'PAUSED_SCENARIO', 'RESUMED_SCENARIO',
    'COMPLETED_SCENARIO', 'RESET_SCENARIO',
    // Submissions
    'SUBMITTED', 'ANSWERED', 'ATTEMPTED', 'CORRECT_ANSWER',
    'INCORRECT_ANSWER',
    // Emotion
    'EXPRESSED_EMOTION',
    // Errors
    'ERROR_OCCURRED', 'API_ERROR', 'VALIDATION_ERROR'
];

/** Base verbs plus every registered plugin's declared vocabulary (RPS-1). */
export const LEARNING_VERBS = [
    ...BASE_LEARNING_VERBS,
    ...PLUGIN_MANIFESTS.flatMap((m) => Object.keys(m.vocabulary?.verbs ?? {})),
];

// --- Verb metadata -------------------------------------------------------
//
// severity/category are columns on learning_events with CHECK constraints
// (migrations/0001_initial.sql:225-226), so an unknown value doesn't degrade
// gracefully — it fails the INSERT. Everything below is pinned to those two
// enums, and resolveEventMetadata() is the only way a route should produce a
// value for either column.

/** xAPI severity of an event. Mirrors the learning_events CHECK constraint. */
export const SEVERITY = {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    ACTION: 'ACTION',
    IMPORTANT: 'IMPORTANT',
    CRITICAL: 'CRITICAL',
};

/** Coarse activity bucket. Mirrors the learning_events CHECK constraint. */
export const CATEGORIES = {
    SESSION: 'SESSION',
    NAVIGATION: 'NAVIGATION',
    CLINICAL: 'CLINICAL',
    COMMUNICATION: 'COMMUNICATION',
    MONITORING: 'MONITORING',
    CONFIGURATION: 'CONFIGURATION',
    ASSESSMENT: 'ASSESSMENT',
    ERROR: 'ERROR',
};

const BASE_VERB_METADATA = {
    STARTED_SESSION: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.SESSION },
    ENDED_SESSION: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.SESSION },
    RESUMED_SESSION: { severity: SEVERITY.INFO, category: CATEGORIES.SESSION },
    IDLE_TIMEOUT: { severity: SEVERITY.INFO, category: CATEGORIES.SESSION },
    UNLOAD: { severity: SEVERITY.INFO, category: CATEGORIES.SESSION },
    VIEWED: { severity: SEVERITY.DEBUG, category: CATEGORIES.NAVIGATION },
    OPENED: { severity: SEVERITY.INFO, category: CATEGORIES.NAVIGATION },
    CLOSED: { severity: SEVERITY.DEBUG, category: CATEGORIES.NAVIGATION },
    NAVIGATED: { severity: SEVERITY.DEBUG, category: CATEGORIES.NAVIGATION },
    SWITCHED_TAB: { severity: SEVERITY.DEBUG, category: CATEGORIES.NAVIGATION },
    LOST_FOCUS: { severity: SEVERITY.DEBUG, category: CATEGORIES.NAVIGATION },
    RESUMED_FOCUS: { severity: SEVERITY.DEBUG, category: CATEGORIES.NAVIGATION },
    CLICKED: { severity: SEVERITY.DEBUG, category: CATEGORIES.NAVIGATION },
    SELECTED: { severity: SEVERITY.DEBUG, category: CATEGORIES.NAVIGATION },
    DESELECTED: { severity: SEVERITY.DEBUG, category: CATEGORIES.NAVIGATION },
    TOGGLED: { severity: SEVERITY.DEBUG, category: CATEGORIES.NAVIGATION },
    EXPANDED: { severity: SEVERITY.DEBUG, category: CATEGORIES.NAVIGATION },
    COLLAPSED: { severity: SEVERITY.DEBUG, category: CATEGORIES.NAVIGATION },
    ORDERED_LAB: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.CLINICAL },
    CANCELLED_LAB: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    VIEWED_LAB_RESULT: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    SEARCHED_LABS: { severity: SEVERITY.DEBUG, category: CATEGORIES.CLINICAL },
    FILTERED_LABS: { severity: SEVERITY.DEBUG, category: CATEGORIES.CLINICAL },
    LAB_RESULT_READY: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    ORDERED_IMAGING: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.CLINICAL },
    CANCELLED_IMAGING: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    VIEWED_RADIOLOGY_RESULT: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    ORDERED_MEDICATION: { severity: SEVERITY.CRITICAL, category: CATEGORIES.CLINICAL },
    ADMINISTERED_MEDICATION: { severity: SEVERITY.CRITICAL, category: CATEGORIES.CLINICAL },
    CANCELLED_MEDICATION: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.CLINICAL },
    ORDERED_TREATMENT: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.CLINICAL },
    PERFORMED_INTERVENTION: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.CLINICAL },
    ORDERED_IV_FLUID: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.CLINICAL },
    STARTED_OXYGEN: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.CLINICAL },
    STOPPED_OXYGEN: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    ORDERED_NURSING: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    DISCONTINUED_TREATMENT: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.CLINICAL },
    TREATMENT_EFFECT_STARTED: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    TREATMENT_EFFECT_PEAKED: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    TREATMENT_EFFECT_ENDED: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    CONTRAINDICATED_TREATMENT_ORDERED: { severity: SEVERITY.CRITICAL, category: CATEGORIES.CLINICAL },
    EXPECTED_TREATMENT_GIVEN: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.ASSESSMENT },
    EXPECTED_TREATMENT_MISSED: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.ASSESSMENT },
    PERFORMED_PHYSICAL_EXAM: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.CLINICAL },
    OPENED_EXAM_PANEL: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    CLOSED_EXAM_PANEL: { severity: SEVERITY.DEBUG, category: CATEGORIES.CLINICAL },
    SENT_MESSAGE: { severity: SEVERITY.INFO, category: CATEGORIES.COMMUNICATION },
    RECEIVED_MESSAGE: { severity: SEVERITY.INFO, category: CATEGORIES.COMMUNICATION },
    COPIED_MESSAGE: { severity: SEVERITY.DEBUG, category: CATEGORIES.COMMUNICATION },
    STT_RESULT: { severity: SEVERITY.DEBUG, category: CATEGORIES.COMMUNICATION },
    STT_ERROR: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.ERROR },
    TTS_PLAYED: { severity: SEVERITY.DEBUG, category: CATEGORIES.COMMUNICATION },
    ADJUSTED_VITAL: { severity: SEVERITY.INFO, category: CATEGORIES.MONITORING },
    ACKNOWLEDGED_ALARM: { severity: SEVERITY.INFO, category: CATEGORIES.MONITORING },
    SILENCED_ALARM: { severity: SEVERITY.INFO, category: CATEGORIES.MONITORING },
    ALARM_TRIGGERED: { severity: SEVERITY.CRITICAL, category: CATEGORIES.MONITORING },
    VIEWED_TRENDS: { severity: SEVERITY.INFO, category: CATEGORIES.MONITORING },
    EDITED_LAB_VALUE: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.CLINICAL },
    VIEWED_PATIENT_SUMMARY: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    VIEWED_HISTORY: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    VIEWED_MEDICATIONS: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    VIEWED_ALLERGIES: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    WROTE_NOTE: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    SAVED_NOTE: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    UPDATED_NOTE: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    SUBMITTED_DEBRIEF: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.ASSESSMENT },
    CHANGED_SETTING: { severity: SEVERITY.INFO, category: CATEGORIES.CONFIGURATION },
    SAVED_SETTING: { severity: SEVERITY.INFO, category: CATEGORIES.CONFIGURATION },
    RESET_SETTING: { severity: SEVERITY.INFO, category: CATEGORIES.CONFIGURATION },
    LOADED_CASE: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.SESSION },
    VIEWED_PATIENT_INFO: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    VIEWED_RECORDS: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    SAVED_CASE: { severity: SEVERITY.INFO, category: CATEGORIES.CONFIGURATION },
    EXPORTED_CASE: { severity: SEVERITY.INFO, category: CATEGORIES.CONFIGURATION },
    STARTED_SCENARIO: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.SESSION },
    PAUSED_SCENARIO: { severity: SEVERITY.INFO, category: CATEGORIES.SESSION },
    RESUMED_SCENARIO: { severity: SEVERITY.INFO, category: CATEGORIES.SESSION },
    COMPLETED_SCENARIO: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.ASSESSMENT },
    RESET_SCENARIO: { severity: SEVERITY.INFO, category: CATEGORIES.SESSION },
    SUBMITTED: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.ASSESSMENT },
    ANSWERED: { severity: SEVERITY.INFO, category: CATEGORIES.ASSESSMENT },
    ATTEMPTED: { severity: SEVERITY.INFO, category: CATEGORIES.ASSESSMENT },
    CORRECT_ANSWER: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.ASSESSMENT },
    INCORRECT_ANSWER: { severity: SEVERITY.INFO, category: CATEGORIES.ASSESSMENT },
    EXPRESSED_EMOTION: { severity: SEVERITY.INFO, category: CATEGORIES.COMMUNICATION },
    ERROR_OCCURRED: { severity: SEVERITY.CRITICAL, category: CATEGORIES.ERROR },
    API_ERROR: { severity: SEVERITY.CRITICAL, category: CATEGORIES.ERROR },
    VALIDATION_ERROR: { severity: SEVERITY.INFO, category: CATEGORIES.ERROR },
};

/**
 * Base metadata plus every registered plugin's declared verb metadata (RPS-1).
 * A plugin manifest's `vocabulary.verbs` entries ARE metadata rows — that is
 * why validateManifest requires each one to carry a legal severity/category.
 */
export const VERB_METADATA = foldManifests(PLUGIN_MANIFESTS, {
    verbMetadata: BASE_VERB_METADATA,
}).verbMetadata;

/** Used when a verb carries no metadata row (a plugin verb predating its manifest entry). */
export const DEFAULT_VERB_METADATA = {
    severity: SEVERITY.INFO,
    category: CATEGORIES.NAVIGATION,
};

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
 * @param {string} verb
 * @param {{severity?: string, category?: string}} supplied client-supplied overrides
 * @returns {{ok: true, severity: string, category: string}
 *          |{ok: false, field: 'severity'|'category', value: unknown}}
 */
export function resolveEventMetadata(verb, supplied = {}) {
    const { severity, category } = supplied || {};
    if (severity != null && !SEVERITIES.includes(severity)) {
        return { ok: false, field: 'severity', value: severity };
    }
    if (category != null && !CATEGORY_VALUES.includes(category)) {
        return { ok: false, field: 'category', value: category };
    }
    const meta = VERB_METADATA[verb] || DEFAULT_VERB_METADATA;
    return {
        ok: true,
        severity: severity ?? meta.severity,
        category: category ?? meta.category,
    };
}

export default LEARNING_VERBS;
