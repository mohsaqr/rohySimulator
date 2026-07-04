// Clinical-state resolver — the simulator-domain analogue of LAILA's
// 12 educational learning states (learning/progressing/engaged/…). Where
// LAILA's space is shaped by "what type of LMS object did the student
// touch", ours is shaped by "what part of the clinical reasoning loop
// is the trainee in".
//
// Ten states, each a verb in clinical-encounter language:
//
//   assessing     — taking in patient information (record review, history,
//                   lab results once they're back)
//   examining     — physical exam findings, body-region interactions
//   investigating — ordering labs / imaging / studies
//   treating      — ordering / administering meds, fluids, oxygen, nursing
//   communicating — chat with the patient, family, consultant agents
//   documenting   — writing clinical notes / progress notes / debrief notes
//   monitoring    — watching vitals, adjusting monitor, acknowledging alarms
//   regulating    — session control (start/end/resume), case loading,
//                   scenario stepping
//   reflecting    — emotional pulse, debrief, post-case discussion
//   navigating    — opening drawers / tabs / panels (intent-neutral UI moves)
//
// Resolution chain (matches LAILA's contract):
//   1. explicit `verb:object_type` map  →
//   2. object_type override             →
//   3. verb fallback                    →
//   4. literal `verb_object_type` (so unknown combos are visible in the UI
//      and can be folded into the maps when curated).
//
// Adding a new event source:
//   - if it ships a fresh verb, add a row to VERB_FALLBACKS
//   - if a new object_type comes in, add a row to OBJECT_OVERRIDES
//   - if a verb:object combo would otherwise resolve wrong, add an
//     explicit entry to DEFAULT_INTERPRETATIONS

export const CLINICAL_STATES = [
    'assessing',
    'examining',
    'investigating',
    'treating',
    'communicating',
    'documenting',
    'monitoring',
    'regulating',
    'reflecting',
    'navigating',
];

// Verb-default fallback: fires when no explicit pair or object override hits.
export const VERB_FALLBACKS = {
    // Sessions / case lifecycle
    STARTED_SESSION: 'regulating',
    RESUMED_SESSION: 'regulating',
    ENDED_SESSION: 'regulating',
    PAUSED_SCENARIO: 'regulating',
    RESUMED_SCENARIO: 'regulating',
    STARTED_SCENARIO: 'regulating',
    LOADED_CASE: 'regulating',
    IDLE_TIMEOUT: 'regulating',
    // Authentication (auth-routes writes these straight into learning_events).
    // They're account/session control, not clinical work → regulating, so they
    // stop rendering as raw `LOGGED_IN_auth` / `LOGGED_OUT_auth` literals.
    LOGGED_IN: 'regulating',
    LOGGED_OUT: 'regulating',
    FAILED_LOGIN: 'regulating',

    // Documentation
    WROTE_NOTE: 'documenting',
    SAVED_NOTE: 'documenting',
    UPDATED_NOTE: 'documenting',

    // Monitoring
    ADJUSTED_VITAL: 'monitoring',
    VIEWED_TRENDS: 'monitoring',
    ACKNOWLEDGED_ALARM: 'monitoring',
    SILENCED_ALARM: 'monitoring',
    ALARM_TRIGGERED: 'monitoring',

    // Investigations
    ORDERED_LAB: 'investigating',
    SEARCHED_LABS: 'investigating',
    FILTERED_LABS: 'investigating',
    CANCELLED_LAB: 'investigating',
    ORDERED_IMAGING: 'investigating',
    ORDERED_INVESTIGATION: 'investigating',
    VIEWED_LAB_RESULT: 'assessing',
    LAB_RESULT_READY: 'assessing',
    VIEWED_RADIOLOGY_RESULT: 'assessing',

    // Treatment
    ORDERED_MEDICATION: 'treating',
    ADMINISTERED_MEDICATION: 'treating',
    CANCELLED_MEDICATION: 'treating',
    ORDERED_TREATMENT: 'treating',
    ORDERED_IV_FLUID: 'treating',
    STARTED_OXYGEN: 'treating',
    STOPPED_OXYGEN: 'treating',
    ORDERED_NURSING: 'treating',
    DISCONTINUED_TREATMENT: 'treating',
    PERFORMED_INTERVENTION: 'treating',
    EXPECTED_TREATMENT_GIVEN: 'treating',
    EXPECTED_TREATMENT_MISSED: 'treating',
    CONTRAINDICATED_TREATMENT_ORDERED: 'treating',

    // Examination
    PERFORMED_PHYSICAL_EXAM: 'examining',
    OPENED_EXAM_PANEL: 'examining',
    CLOSED_EXAM_PANEL: 'examining',

    // Communication
    SENT_MESSAGE: 'communicating',
    RECEIVED_MESSAGE: 'communicating',
    COPIED_MESSAGE: 'communicating',
    EDITED_MESSAGE: 'communicating',

    // Patient record review (assess)
    VIEWED_PATIENT_SUMMARY: 'assessing',
    VIEWED_HISTORY: 'assessing',
    VIEWED_MEDICATIONS: 'assessing',
    VIEWED_ALLERGIES: 'assessing',
    VIEWED_PATIENT_INFO: 'assessing',
    VIEWED_RECORDS: 'assessing',

    // Reflection
    EXPRESSED_EMOTION: 'reflecting',
    SUBMITTED_DEBRIEF: 'reflecting',

    // Navigation (catch-all UI)
    OPENED: 'navigating',
    CLOSED: 'navigating',
    VIEWED: 'navigating',
    NAVIGATED: 'navigating',
    SWITCHED_TAB: 'navigating',
    CLICKED: 'navigating',
    SELECTED: 'navigating',
    DESELECTED: 'navigating',
    TOGGLED: 'navigating',
    EXPANDED: 'navigating',
    COLLAPSED: 'navigating',
    SCROLLED: 'navigating',

    // Settings / configuration — folded into regulating since they shape
    // the run, not the clinical work itself.
    CHANGED_SETTING: 'regulating',
    SAVED_SETTING: 'regulating',
    RESET_SETTING: 'regulating',
};

// Object-type forced interpretations (override verb default).
export const OBJECT_OVERRIDES = {
    vital_sign: 'monitoring',
    alarm: 'monitoring',
    monitor: 'monitoring',

    physical_exam: 'examining',
    body_region: 'examining',

    lab_test: 'investigating',
    investigation: 'investigating',
    radiology_order: 'investigating',
    lab_result: 'assessing',
    radiology_result: 'assessing',

    medication: 'treating',
    treatment: 'treating',
    iv_fluid: 'treating',
    oxygen: 'treating',
    oxygen_therapy: 'treating',
    nursing: 'treating',
    nursing_intervention: 'treating',

    // Reading the patient record (History / Meds / Allergies / past exam) is
    // taking in information — assessing, not navigating.
    patient_record: 'assessing',

    chat_message: 'communicating',
    discussion: 'communicating',

    clinical_note: 'documenting',
    note: 'documenting',

    emotion: 'reflecting',
    debrief: 'reflecting',

    session: 'regulating',
    scenario: 'regulating',
    case: 'regulating',
    auth: 'regulating',

    drawer: 'navigating',
    panel: 'navigating',
    component: 'navigating',
    page: 'navigating',
};

// Explicit verb:object pairs that need to override the chain.
export const DEFAULT_INTERPRETATIONS = {
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
};

/**
 * Resolve a single (verb, object_type) pair to a clinical state.
 *
 * @param {string} verb        upper-snake event verb, e.g. 'ORDERED_LAB'
 * @param {string} objectType  lower-snake type, e.g. 'lab_test'
 * @param {Record<string,string>} customMap optional user override map keyed
 *                                          by 'VERB:object_type' from the
 *                                          settings tab; falls back to defaults.
 * @returns {string} one of CLINICAL_STATES, or `${verb}_${objectType}` if no rule matches.
 */
export function resolveClinicalState(verb, objectType, customMap) {
    const v = verb || '';
    const o = objectType || '';
    const key = `${v}:${o}`;
    const lookup = customMap && customMap[key] ? customMap : DEFAULT_INTERPRETATIONS;
    if (lookup[key]) return lookup[key];
    if (o && OBJECT_OVERRIDES[o]) return OBJECT_OVERRIDES[o];
    if (v && VERB_FALLBACKS[v]) return VERB_FALLBACKS[v];
    return o ? `${v}_${o}` : v || 'navigating';
}
