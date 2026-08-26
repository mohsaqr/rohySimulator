/**
 * The learning-event verb whitelist — one registry, used by every ingest path.
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

export default LEARNING_VERBS;
