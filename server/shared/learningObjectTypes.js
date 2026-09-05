/**
 * Object types and components — the second and third columns of the learning
 * vocabulary — plus the per-object-type facets the analytics chain consults
 * BEFORE the verb.
 *
 * Moved here from src/services/eventLogger.js (the constants) and
 * src/components/analytics/tna/clinicalStates.js (the object overrides) so
 * that the server can read them: an ingest path that validates `object_type`,
 * and a sequence builder that resolves labels server-side, both need the
 * same table the client uses. Dual-imported like server/shared/time.js.
 *
 * Resolution order is object-first, matching the clinical-state chain that
 * has always been in place: an explicit `VERB:object_type` interpretation
 * wins, then the object type's facet, then the verb's. That is what makes a
 * generic `VIEWED` on a `patient_record` resolve to `assessing`, and a
 * generic `SEARCHED` on a `lab_test` to `investigating`, without a dedicated
 * verb for each.
 */

/** Lower-snake object types rohy's own emitters use. Keys are how code refers
 *  to them; values are what lands in `learning_events.object_type`. */
export const BASE_OBJECT_TYPES = Object.freeze({
    SESSION: 'session', CASE: 'case', LAB_TEST: 'lab_test', LAB_RESULT: 'lab_result',
    RADIOLOGY_ORDER: 'radiology_order', RADIOLOGY_RESULT: 'radiology_result',
    CHAT_MESSAGE: 'chat_message', VITAL_SIGN: 'vital_sign', ALARM: 'alarm',
    SETTING: 'setting', BUTTON: 'button', TAB: 'tab', MODAL: 'modal',
    DRAWER: 'drawer', PANEL: 'panel', SCENARIO: 'scenario', COMPONENT: 'component',
    PHYSICAL_EXAM: 'physical_exam', TREATMENT: 'treatment', MEDICATION: 'medication',
    IV_FLUID: 'iv_fluid', OXYGEN_THERAPY: 'oxygen_therapy',
    NURSING_INTERVENTION: 'nursing_intervention', EMOTION: 'emotion',
    // Patient-record reading (History / Meds / Allergies / past exam …) — a
    // dedicated type so record review resolves to `assessing`, not the
    // generic `component` → `navigating` bucket.
    PATIENT_RECORD: 'patient_record',
    // Debrief / discussant participation — distinct from bedside chat so it
    // resolves to `reflecting` instead of `communicating`.
    DEBRIEF: 'debrief', CLINICAL_NOTE: 'clinical_note',
    ROOM: 'room',
    // Auth rows are written server-side (auth-routes) — declared so the
    // ingest core recognises the type rather than treating it as free text.
    AUTH: 'auth',
    // Host-owned plugin object types. PluginRoom reports a plugin's own
    // failures against these; declaring them here means no plugin has to
    // carry a type for something the HOST does on its behalf.
    PLUGIN_STATE: 'plugin_state', PLUGIN_RENDER: 'plugin_render',
    PLUGIN_EVENT: 'plugin_event', PLUGIN_DOCUMENT: 'plugin_document',
    // Consultation with a supporting agent — distinct from patient chat so it
    // resolves to Consulting rather than Communicating.
    AGENT: 'agent', AGENT_MESSAGE: 'agent_message',
    // Investigations, generic order
    ORDER: 'order',
    // Monitoring
    VITAL_TREND: 'vital_trend', PATIENT_STATUS: 'patient_status',
    // Examination
    BODY_REGION: 'body_region',
    // Voice
    SPEECH: 'speech', AUDIO: 'audio',
    // Debrief surfaces
    TRANSCRIPT: 'transcript', QUESTIONNAIRE: 'questionnaire', QUESTIONNAIRE_ITEM: 'questionnaire_item',
    // Treatment drawer (opening it is treating intent)
    TREATMENT_DRAWER: 'treatment_drawer',
    // Lessons / didactic material
    COURSE: 'course', LECTURE: 'lecture', VIDEO: 'video',
    SURVEY: 'survey', SURVEY_ITEM: 'survey_item', QUESTION: 'question',
    // Onboarding / help
    TOUR: 'tour', FIRST_RUN: 'first_run', HELP_CENTER: 'help_center', HELP_ARTICLE: 'help_article',
    // Oyon
    CONSENT: 'consent', CAPTURE_SESSION: 'capture_session',
    // Authoring content kinds
    MONITOR_PRESET: 'monitor_preset', LAB_CATALOGUE: 'lab_catalogue',
    MEDICATION_CATALOGUE: 'medication_catalogue', AGENT_PERSONA: 'agent_persona',
    AGENT_TEMPLATE: 'agent_template',
    // Errors / system
    ENDPOINT: 'endpoint', FORM: 'form', FIELD: 'field', NOTIFICATION: 'notification',
    UNKNOWN: 'unknown',
});

/** PascalCase component names rohy's own emitters stamp on `component`. */
export const BASE_COMPONENTS = Object.freeze({
    CHAT_INTERFACE: 'ChatInterface', PATIENT_MONITOR: 'PatientMonitor',
    PATIENT_VISUAL: 'PatientVisual', ORDERS_DRAWER: 'OrdersDrawer',
    LAB_RESULTS_MODAL: 'LabResultsModal', CONFIG_PANEL: 'ConfigPanel',
    CASE_EDITOR: 'CaseEditor', SCENARIO_REPOSITORY: 'ScenarioRepository',
    LOGIN_PAGE: 'LoginPage', APP: 'App',
    MANIKIN_PANEL: 'ManikinPanel', AUSCULTATION_PANEL: 'AuscultationPanel',
    PATIENT_INFO_PANEL: 'PatientInfoPanel',
    MEDICATION_PANEL: 'MedicationPanel', TREATMENT_PANEL: 'TreatmentPanel',
    SESSION_LOG_VIEWER: 'SessionLogViewer', VITAL_TRENDS: 'VitalTrends',
    DISCUSSION_SCREEN: 'DiscussionScreen',
    PLUGIN_ROOM: 'PluginRoom', PLUGIN_AUTHOR: 'PluginAuthor',
});

/**
 * Per-object-type facets. `clinicalState` is the historical OBJECT_OVERRIDES
 * table verbatim — every key that was there is still there, including the
 * handful (`monitor`, `investigation`, `oxygen`, `nursing`, `discussion`,
 * `note`, `page`) that no rohy emitter declares but historical rows may carry.
 * `action`, `tnaMerge` and `pulseBucket` are set only where the object
 * changes the reading of the verb (a chat turn in the debrief is Debriefing,
 * anything on a patient_record is History, a bare SEARCHED on a lab_test is
 * ordering work); otherwise the verb's own facet applies.
 */
export const BASE_OBJECT_TYPE_FACETS = Object.freeze({
    vital_sign: { clinicalState: 'monitoring' },
    alarm: { clinicalState: 'monitoring' },
    monitor: { clinicalState: 'monitoring' },

    physical_exam: { clinicalState: 'examining' },
    body_region: { clinicalState: 'examining' },

    // An investigation object decides the ACTION too: a SEARCHED or
    // CANCELLED on a lab_test is ordering work, whatever the bare verb says.
    lab_test: { clinicalState: 'investigating', action: 'Ordering', tnaMerge: 'ORDERED_LAB' },
    investigation: { clinicalState: 'investigating', action: 'Ordering', tnaMerge: 'ORDERED_LAB' },
    radiology_order: { clinicalState: 'investigating', action: 'Ordering', tnaMerge: 'ORDERED_LAB' },
    lab_result: { clinicalState: 'assessing', action: 'Reading results' },
    radiology_result: { clinicalState: 'assessing', action: 'Reading results' },

    // Likewise a treatment object: a CANCELLED_ORDER on a medication is
    // treating, as CANCELLED_MEDICATION always was.
    medication: { clinicalState: 'treating', action: 'Treating', tnaMerge: 'TREATMENT' },
    treatment: { clinicalState: 'treating', action: 'Treating', tnaMerge: 'TREATMENT' },
    iv_fluid: { clinicalState: 'treating', action: 'Treating', tnaMerge: 'TREATMENT' },
    oxygen: { clinicalState: 'treating', action: 'Treating', tnaMerge: 'TREATMENT' },
    oxygen_therapy: { clinicalState: 'treating', action: 'Treating', tnaMerge: 'TREATMENT' },
    nursing: { clinicalState: 'treating', action: 'Treating', tnaMerge: 'TREATMENT' },
    nursing_intervention: { clinicalState: 'treating', action: 'Treating', tnaMerge: 'TREATMENT' },

    // Reading the patient record (History / Meds / Allergies / past exam) is
    // taking in information — assessing, not navigating.
    patient_record: { clinicalState: 'assessing', action: 'History' },

    chat_message: { clinicalState: 'communicating' },
    discussion: { clinicalState: 'communicating' },

    clinical_note: { clinicalState: 'documenting' },
    note: { clinicalState: 'documenting' },

    emotion: { clinicalState: 'reflecting' },
    debrief: { clinicalState: 'reflecting', action: 'Debriefing' },

    session: { clinicalState: 'regulating' },
    scenario: { clinicalState: 'regulating' },
    case: { clinicalState: 'regulating' },
    auth: { clinicalState: 'regulating' },

    drawer: { clinicalState: 'navigating' },
    panel: { clinicalState: 'navigating' },
    component: { clinicalState: 'navigating' },
    page: { clinicalState: 'navigating' },

    // --- Added with the facet registry ----------------------------------------
    agent: { clinicalState: 'communicating', action: 'Consulting' },
    agent_message: { clinicalState: 'communicating', action: 'Consulting' },
    order: { clinicalState: 'investigating', action: 'Ordering', tnaMerge: 'ORDERED_LAB' },
    vital_trend: { clinicalState: 'monitoring' },
    patient_status: { clinicalState: 'monitoring' },
    speech: { clinicalState: 'communicating' },
    audio: { clinicalState: 'communicating' },
    transcript: { clinicalState: 'reflecting', action: 'Debriefing' },
    questionnaire: { clinicalState: 'reflecting', action: 'Debriefing' },
    questionnaire_item: { clinicalState: 'reflecting', action: 'Debriefing' },
    treatment_drawer: { clinicalState: 'treating' },
    course: { clinicalState: 'studying', action: 'Studying' },
    lecture: { clinicalState: 'studying', action: 'Studying' },
    video: { clinicalState: 'studying', action: 'Studying' },
    survey: { clinicalState: 'studying', action: 'Studying' },
    survey_item: { clinicalState: 'studying', action: 'Studying' },
    question: { clinicalState: 'studying', action: 'Studying' },
    help_center: { clinicalState: 'studying', action: 'Studying' },
    help_article: { clinicalState: 'studying', action: 'Studying' },
    tour: { clinicalState: 'navigating' },
    first_run: { clinicalState: 'navigating' },
    consent: { clinicalState: 'regulating' },
    capture_session: { clinicalState: 'regulating' },
    monitor_preset: { clinicalState: 'regulating' },
    lab_catalogue: { clinicalState: 'regulating' },
    medication_catalogue: { clinicalState: 'regulating' },
    agent_persona: { clinicalState: 'regulating' },
    agent_template: { clinicalState: 'regulating' },
    endpoint: { clinicalState: 'navigating' },
    form: { clinicalState: 'navigating' },
    field: { clinicalState: 'navigating' },
    notification: { clinicalState: 'navigating' },
    unknown: { clinicalState: 'navigating' },
});
