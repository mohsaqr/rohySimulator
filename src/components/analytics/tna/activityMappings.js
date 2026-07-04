// Activity mapping registry — the different ways a single activity event
// (a {verb, object_type} pair) can be labelled for the analytics screens.
//
// One event, several "lenses", coarse → fine:
//
//   clinical-state   10 reasoning-loop states (assessing, treating, …)   [clinicalStates.js]
//   clinical-action  concrete clinical actions (History, Examining, Ordering, Reading results, …)
//   medical-domain   broad domains (Assessment, Diagnostics, Therapeutics, …)
//   fine             human-readable per-action ("Ordered lab", "Read lab result", "Gave medication")
//   verb             the raw event verb (ORDERED_MEDICATION)
//   object           the raw object type (medication)
//   raw              literal verb:object (ORDERED_MEDICATION:medication)
//
// Every lens is a pure function of (verb, object_type); the same event
// therefore colours consistently across every activity screen once the
// dashboard maps its events through the selected lens. The tables below are
// the single source of truth — edit a label here and it changes everywhere.

import { resolveClinicalState } from './clinicalStates';

// The selector options, coarse → fine. `id` is the stored value; `label` is
// shown in the toolbar; `hint` is the one-liner under it.
export const ACTIVITY_MAPPINGS = [
    { id: 'clinical-state', label: 'Clinical state', hint: '10 reasoning states (assessing, treating…)' },
    { id: 'clinical-action', label: 'Clinical action', hint: 'History, Examining, Ordering, Reading results…' },
    { id: 'medical-domain', label: 'Medical domain', hint: 'Assessment, Diagnostics, Therapeutics…' },
    { id: 'fine', label: 'Fine-grained action', hint: 'Ordered lab, Read lab result, Gave medication…' },
    { id: 'verb', label: 'Clinical verb', hint: 'Raw event verb (ORDERED_MEDICATION)' },
    { id: 'object', label: 'Object type', hint: 'What was acted on (medication, lab_test)' },
    { id: 'raw', label: 'Raw verb:object', hint: 'Literal pair, no mapping (debug/QA)' },
];

export const ACTIVITY_MAPPING_IDS = ACTIVITY_MAPPINGS.map((m) => m.id);
export const DEFAULT_ACTIVITY_MAPPING = 'clinical-state';

// ---------------------------------------------------------------------------
// Level: clinical-action — concrete clinical activities. Keyed by verb, with a
// few (verb:object) overrides where the object changes intent (e.g. a message
// in the debrief room is Debriefing, not Communicating).
// ---------------------------------------------------------------------------
export const CLINICAL_ACTION_BY_VERB = {
    // History / record review
    VIEWED_HISTORY: 'History', VIEWED_PATIENT_SUMMARY: 'History', VIEWED_RECORDS: 'History',
    VIEWED_MEDICATIONS: 'History', VIEWED_ALLERGIES: 'History', VIEWED_PATIENT_INFO: 'History',
    // Examination
    PERFORMED_PHYSICAL_EXAM: 'Examining', OPENED_EXAM_PANEL: 'Examining', CLOSED_EXAM_PANEL: 'Examining',
    // Ordering investigations
    ORDERED_LAB: 'Ordering', ORDERED_IMAGING: 'Ordering', ORDERED_INVESTIGATION: 'Ordering',
    SEARCHED_LABS: 'Ordering', FILTERED_LABS: 'Ordering', CANCELLED_LAB: 'Ordering', CANCELLED_IMAGING: 'Ordering',
    // Reading results
    VIEWED_LAB_RESULT: 'Reading results', VIEWED_RADIOLOGY_RESULT: 'Reading results', LAB_RESULT_READY: 'Reading results',
    // Treating
    ORDERED_MEDICATION: 'Treating', ADMINISTERED_MEDICATION: 'Treating', CANCELLED_MEDICATION: 'Treating',
    ORDERED_TREATMENT: 'Treating', ORDERED_IV_FLUID: 'Treating', STARTED_OXYGEN: 'Treating',
    STOPPED_OXYGEN: 'Treating', ORDERED_NURSING: 'Treating', DISCONTINUED_TREATMENT: 'Treating',
    PERFORMED_INTERVENTION: 'Treating', CONTRAINDICATED_TREATMENT_ORDERED: 'Treating',
    EXPECTED_TREATMENT_GIVEN: 'Treating', EXPECTED_TREATMENT_MISSED: 'Treating',
    TREATMENT_EFFECT_STARTED: 'Treating', TREATMENT_EFFECT_PEAKED: 'Treating', TREATMENT_EFFECT_ENDED: 'Treating',
    // Monitoring
    ACKNOWLEDGED_ALARM: 'Monitoring', SILENCED_ALARM: 'Monitoring', ALARM_TRIGGERED: 'Monitoring',
    ADJUSTED_VITAL: 'Monitoring', VIEWED_TRENDS: 'Monitoring',
    // Communicating (patient chat)
    SENT_MESSAGE: 'Communicating', RECEIVED_MESSAGE: 'Communicating',
    COPIED_MESSAGE: 'Communicating', EDITED_MESSAGE: 'Communicating',
    // Debriefing / reflection
    EXPRESSED_EMOTION: 'Debriefing', SUBMITTED_DEBRIEF: 'Debriefing',
    // Documenting
    WROTE_NOTE: 'Documenting', SAVED_NOTE: 'Documenting', UPDATED_NOTE: 'Documenting',
    // Session / account / navigation control
    STARTED_SESSION: 'Session', RESUMED_SESSION: 'Session', ENDED_SESSION: 'Session',
    LOADED_CASE: 'Session', IDLE_TIMEOUT: 'Session', UNLOAD: 'Session',
    LOGGED_IN: 'Session', LOGGED_OUT: 'Session', FAILED_LOGIN: 'Session',
    STARTED_SCENARIO: 'Session', PAUSED_SCENARIO: 'Session', RESUMED_SCENARIO: 'Session',
    CHANGED_SETTING: 'Session', SAVED_SETTING: 'Session', RESET_SETTING: 'Session',
    NAVIGATED: 'Navigating', OPENED: 'Navigating', CLOSED: 'Navigating', SWITCHED_TAB: 'Navigating',
    CLICKED: 'Navigating', SELECTED: 'Navigating', SCROLLED: 'Navigating', TOGGLED: 'Navigating',
    EXPANDED: 'Navigating', COLLAPSED: 'Navigating', VIEWED: 'Navigating',
};

// Object-driven overrides for clinical-action (object beats verb, matching the
// clinical-state resolver's precedence): a chat turn in the debrief room is
// Debriefing; anything explicitly on a patient_record is History.
const CLINICAL_ACTION_BY_OBJECT = {
    debrief: 'Debriefing',
    patient_record: 'History',
    radiology_result: 'Reading results',
    lab_result: 'Reading results',
};

// ---------------------------------------------------------------------------
// Level: medical-domain — broad domains. Derived by coarsening clinical-action
// so the two levels never disagree (domain is always a superset of an action).
// ---------------------------------------------------------------------------
export const ACTION_TO_DOMAIN = {
    History: 'Assessment',
    Examining: 'Assessment',
    'Reading results': 'Assessment',
    Ordering: 'Diagnostics',
    Treating: 'Therapeutics',
    Monitoring: 'Monitoring',
    Communicating: 'Communication',
    Debriefing: 'Reflection',
    Documenting: 'Documentation',
    Session: 'Administration',
    Navigating: 'Administration',
};

// ---------------------------------------------------------------------------
// Level: fine — human-readable per-action label. Keyed by verb, with the same
// object-override mechanism for the handful of verbs whose meaning depends on
// the object (chat vs debrief message; record type).
// ---------------------------------------------------------------------------
export const FINE_LABEL_BY_VERB = {
    // Session / account
    STARTED_SESSION: 'Started session', RESUMED_SESSION: 'Resumed session', ENDED_SESSION: 'Ended session',
    LOADED_CASE: 'Loaded case', IDLE_TIMEOUT: 'Idle timeout', UNLOAD: 'Left session',
    LOGGED_IN: 'Logged in', LOGGED_OUT: 'Logged out', FAILED_LOGIN: 'Failed login',
    STARTED_SCENARIO: 'Started scenario', PAUSED_SCENARIO: 'Paused scenario', RESUMED_SCENARIO: 'Resumed scenario',
    // Record review
    VIEWED_HISTORY: 'Read history', VIEWED_MEDICATIONS: 'Read medications', VIEWED_ALLERGIES: 'Read allergies',
    VIEWED_PATIENT_SUMMARY: 'Read summary', VIEWED_RECORDS: 'Read records', VIEWED_PATIENT_INFO: 'Read patient info',
    // Labs
    ORDERED_LAB: 'Ordered lab', SEARCHED_LABS: 'Searched labs', FILTERED_LABS: 'Filtered labs',
    CANCELLED_LAB: 'Cancelled lab', VIEWED_LAB_RESULT: 'Read lab result', LAB_RESULT_READY: 'Lab result ready',
    EDITED_LAB_VALUE: 'Edited lab value',
    // Radiology
    ORDERED_IMAGING: 'Ordered radiology', CANCELLED_IMAGING: 'Cancelled radiology', VIEWED_RADIOLOGY_RESULT: 'Read radiology',
    // Treatment
    ORDERED_MEDICATION: 'Ordered medication', ADMINISTERED_MEDICATION: 'Gave medication',
    CANCELLED_MEDICATION: 'Cancelled medication', ORDERED_TREATMENT: 'Ordered treatment',
    ORDERED_IV_FLUID: 'Ordered IV fluid', STARTED_OXYGEN: 'Started oxygen', STOPPED_OXYGEN: 'Stopped oxygen',
    ORDERED_NURSING: 'Ordered nursing', DISCONTINUED_TREATMENT: 'Stopped treatment',
    PERFORMED_INTERVENTION: 'Performed intervention', CONTRAINDICATED_TREATMENT_ORDERED: 'Contraindicated order',
    EXPECTED_TREATMENT_GIVEN: 'Correct treatment', EXPECTED_TREATMENT_MISSED: 'Missed treatment',
    TREATMENT_EFFECT_STARTED: 'Effect onset', TREATMENT_EFFECT_PEAKED: 'Effect peak', TREATMENT_EFFECT_ENDED: 'Effect ended',
    // Examination
    PERFORMED_PHYSICAL_EXAM: 'Examined patient', OPENED_EXAM_PANEL: 'Opened exam', CLOSED_EXAM_PANEL: 'Closed exam',
    // Monitoring
    ACKNOWLEDGED_ALARM: 'Acknowledged alarm', SILENCED_ALARM: 'Snoozed alarm', ALARM_TRIGGERED: 'Alarm fired',
    ADJUSTED_VITAL: 'Adjusted vital', VIEWED_TRENDS: 'Viewed trends',
    // Communication
    SENT_MESSAGE: 'Messaged patient', RECEIVED_MESSAGE: 'Patient replied',
    COPIED_MESSAGE: 'Copied message', EDITED_MESSAGE: 'Edited message',
    // Reflection / documentation
    EXPRESSED_EMOTION: 'Emotion pulse', SUBMITTED_DEBRIEF: 'Submitted debrief',
    WROTE_NOTE: 'Wrote note', SAVED_NOTE: 'Saved note', UPDATED_NOTE: 'Updated note',
    // Navigation / settings
    NAVIGATED: 'Changed room', SWITCHED_TAB: 'Switched tab', CHANGED_SETTING: 'Changed setting',
    OPENED: 'Opened panel', CLOSED: 'Closed panel', CLICKED: 'Clicked',
};

const FINE_LABEL_BY_OBJECT = {
    debrief: null, // handled per-verb below (send vs receive)
};

// Special fine-grained labels for (verb:object) pairs the by-verb table can't
// disambiguate on its own.
const FINE_LABEL_BY_PAIR = {
    'SENT_MESSAGE:debrief': 'Asked in debrief',
    'RECEIVED_MESSAGE:debrief': 'Debrief reply',
};

/** Title-case an UPPER_SNAKE verb as a readable fallback ("FOO_BAR" → "Foo bar"). */
function humanizeVerb(verb) {
    if (!verb) return 'Unknown';
    const s = verb.toLowerCase().replace(/_/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/** clinical-action label for one event. */
export function clinicalAction(verb, objectType) {
    const o = objectType || '';
    if (o && CLINICAL_ACTION_BY_OBJECT[o]) return CLINICAL_ACTION_BY_OBJECT[o];
    const v = verb || '';
    return CLINICAL_ACTION_BY_VERB[v] || 'Other';
}

/** medical-domain label for one event (coarsening of clinical-action). */
export function medicalDomain(verb, objectType) {
    return ACTION_TO_DOMAIN[clinicalAction(verb, objectType)] || 'Administration';
}

/** fine-grained readable label for one event. */
export function fineLabel(verb, objectType) {
    const v = verb || '';
    const o = objectType || '';
    const pair = FINE_LABEL_BY_PAIR[`${v}:${o}`];
    if (pair) return pair;
    if (o && Object.prototype.hasOwnProperty.call(FINE_LABEL_BY_OBJECT, o) && FINE_LABEL_BY_OBJECT[o]) {
        return FINE_LABEL_BY_OBJECT[o];
    }
    return FINE_LABEL_BY_VERB[v] || humanizeVerb(v);
}

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
    const v = verb || '';
    const o = objectType || '';
    switch (mapping) {
        case 'clinical-action': return clinicalAction(v, o);
        case 'medical-domain': return medicalDomain(v, o);
        case 'fine': return fineLabel(v, o);
        case 'verb': return v || 'UNKNOWN';
        case 'object': return o || '(none)';
        case 'raw': return o ? `${v}:${o}` : (v || 'UNKNOWN');
        case 'clinical-state':
        default:
            return resolveClinicalState(v, o, customStateMap);
    }
}
