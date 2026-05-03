/**
 * EventLogger Service - Comprehensive Learning Analytics Tracker
 *
 * The 130+ xAPI-style convenience methods (sessionStarted, labOrdered, etc.)
 * are preserved for backwards compatibility. Internally, every event now
 * routes through the central NotificationCenter as a telemetry-source
 * notification — which means DND, severity threshold, batching, retries,
 * and the unbounded-requeue fix all happen in one place.
 *
 * If the center isn't mounted yet (very early boot before App renders),
 * events are buffered and replayed once the center registers itself via
 * setExternalApi().
 */

import { getExternalApi } from '../notifications/externalApi';
import { SOURCES } from '../notifications/types';

export const SEVERITY = {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    ACTION: 'ACTION',
    IMPORTANT: 'IMPORTANT',
    CRITICAL: 'CRITICAL',
};

// Map xAPI severity strings → notification severity.
const SEV_MAP = {
    DEBUG: 'debug',
    INFO: 'info',
    ACTION: 'info',
    IMPORTANT: 'warning',
    CRITICAL: 'critical',
};

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

export const VERBS = {
    STARTED_SESSION: 'STARTED_SESSION', ENDED_SESSION: 'ENDED_SESSION',
    RESUMED_SESSION: 'RESUMED_SESSION', IDLE_TIMEOUT: 'IDLE_TIMEOUT',
    VIEWED: 'VIEWED', OPENED: 'OPENED', CLOSED: 'CLOSED', NAVIGATED: 'NAVIGATED',
    SWITCHED_TAB: 'SWITCHED_TAB', SCROLLED: 'SCROLLED',
    CLICKED: 'CLICKED', SELECTED: 'SELECTED', DESELECTED: 'DESELECTED',
    TOGGLED: 'TOGGLED', EXPANDED: 'EXPANDED', COLLAPSED: 'COLLAPSED',
    ORDERED_LAB: 'ORDERED_LAB', CANCELLED_LAB: 'CANCELLED_LAB',
    VIEWED_LAB_RESULT: 'VIEWED_LAB_RESULT', SEARCHED_LABS: 'SEARCHED_LABS',
    FILTERED_LABS: 'FILTERED_LABS', LAB_RESULT_READY: 'LAB_RESULT_READY',
    ORDERED_MEDICATION: 'ORDERED_MEDICATION', ADMINISTERED_MEDICATION: 'ADMINISTERED_MEDICATION',
    CANCELLED_MEDICATION: 'CANCELLED_MEDICATION', ORDERED_TREATMENT: 'ORDERED_TREATMENT',
    PERFORMED_INTERVENTION: 'PERFORMED_INTERVENTION', ORDERED_IV_FLUID: 'ORDERED_IV_FLUID',
    STARTED_OXYGEN: 'STARTED_OXYGEN', STOPPED_OXYGEN: 'STOPPED_OXYGEN',
    ORDERED_NURSING: 'ORDERED_NURSING', DISCONTINUED_TREATMENT: 'DISCONTINUED_TREATMENT',
    TREATMENT_EFFECT_STARTED: 'TREATMENT_EFFECT_STARTED', TREATMENT_EFFECT_PEAKED: 'TREATMENT_EFFECT_PEAKED',
    TREATMENT_EFFECT_ENDED: 'TREATMENT_EFFECT_ENDED',
    CONTRAINDICATED_TREATMENT_ORDERED: 'CONTRAINDICATED_TREATMENT_ORDERED',
    EXPECTED_TREATMENT_GIVEN: 'EXPECTED_TREATMENT_GIVEN',
    EXPECTED_TREATMENT_MISSED: 'EXPECTED_TREATMENT_MISSED',
    PERFORMED_PHYSICAL_EXAM: 'PERFORMED_PHYSICAL_EXAM',
    OPENED_EXAM_PANEL: 'OPENED_EXAM_PANEL', CLOSED_EXAM_PANEL: 'CLOSED_EXAM_PANEL',
    SENT_MESSAGE: 'SENT_MESSAGE', RECEIVED_MESSAGE: 'RECEIVED_MESSAGE',
    COPIED_MESSAGE: 'COPIED_MESSAGE', EDITED_MESSAGE: 'EDITED_MESSAGE',
    ADJUSTED_VITAL: 'ADJUSTED_VITAL', ACKNOWLEDGED_ALARM: 'ACKNOWLEDGED_ALARM',
    SILENCED_ALARM: 'SILENCED_ALARM', ALARM_TRIGGERED: 'ALARM_TRIGGERED',
    VIEWED_TRENDS: 'VIEWED_TRENDS',
    VIEWED_PATIENT_SUMMARY: 'VIEWED_PATIENT_SUMMARY', VIEWED_HISTORY: 'VIEWED_HISTORY',
    VIEWED_MEDICATIONS: 'VIEWED_MEDICATIONS', VIEWED_ALLERGIES: 'VIEWED_ALLERGIES',
    CHANGED_SETTING: 'CHANGED_SETTING', SAVED_SETTING: 'SAVED_SETTING',
    RESET_SETTING: 'RESET_SETTING',
    LOADED_CASE: 'LOADED_CASE', VIEWED_PATIENT_INFO: 'VIEWED_PATIENT_INFO',
    VIEWED_RECORDS: 'VIEWED_RECORDS', SAVED_CASE: 'SAVED_CASE', EXPORTED_CASE: 'EXPORTED_CASE',
    STARTED_SCENARIO: 'STARTED_SCENARIO', PAUSED_SCENARIO: 'PAUSED_SCENARIO',
    RESUMED_SCENARIO: 'RESUMED_SCENARIO', COMPLETED_SCENARIO: 'COMPLETED_SCENARIO',
    RESET_SCENARIO: 'RESET_SCENARIO',
    SUBMITTED: 'SUBMITTED', ANSWERED: 'ANSWERED', ATTEMPTED: 'ATTEMPTED',
    CORRECT_ANSWER: 'CORRECT_ANSWER', INCORRECT_ANSWER: 'INCORRECT_ANSWER',
    EXPRESSED_EMOTION: 'EXPRESSED_EMOTION',
    ERROR_OCCURRED: 'ERROR_OCCURRED', API_ERROR: 'API_ERROR', VALIDATION_ERROR: 'VALIDATION_ERROR',
};

const VERB_METADATA = {
    STARTED_SESSION: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.SESSION },
    ENDED_SESSION: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.SESSION },
    RESUMED_SESSION: { severity: SEVERITY.INFO, category: CATEGORIES.SESSION },
    IDLE_TIMEOUT: { severity: SEVERITY.INFO, category: CATEGORIES.SESSION },
    VIEWED: { severity: SEVERITY.DEBUG, category: CATEGORIES.NAVIGATION },
    OPENED: { severity: SEVERITY.INFO, category: CATEGORIES.NAVIGATION },
    CLOSED: { severity: SEVERITY.DEBUG, category: CATEGORIES.NAVIGATION },
    NAVIGATED: { severity: SEVERITY.DEBUG, category: CATEGORIES.NAVIGATION },
    SWITCHED_TAB: { severity: SEVERITY.DEBUG, category: CATEGORIES.NAVIGATION },
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
    ADJUSTED_VITAL: { severity: SEVERITY.INFO, category: CATEGORIES.MONITORING },
    ACKNOWLEDGED_ALARM: { severity: SEVERITY.INFO, category: CATEGORIES.MONITORING },
    SILENCED_ALARM: { severity: SEVERITY.INFO, category: CATEGORIES.MONITORING },
    ALARM_TRIGGERED: { severity: SEVERITY.CRITICAL, category: CATEGORIES.MONITORING },
    VIEWED_TRENDS: { severity: SEVERITY.INFO, category: CATEGORIES.MONITORING },
    VIEWED_PATIENT_SUMMARY: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    VIEWED_HISTORY: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    VIEWED_MEDICATIONS: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    VIEWED_ALLERGIES: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
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

export const OBJECT_TYPES = {
    SESSION: 'session', CASE: 'case', LAB_TEST: 'lab_test', LAB_RESULT: 'lab_result',
    CHAT_MESSAGE: 'chat_message', VITAL_SIGN: 'vital_sign', ALARM: 'alarm',
    SETTING: 'setting', BUTTON: 'button', TAB: 'tab', MODAL: 'modal',
    DRAWER: 'drawer', PANEL: 'panel', SCENARIO: 'scenario', COMPONENT: 'component',
    PHYSICAL_EXAM: 'physical_exam', TREATMENT: 'treatment', MEDICATION: 'medication',
    IV_FLUID: 'iv_fluid', OXYGEN_THERAPY: 'oxygen_therapy',
    NURSING_INTERVENTION: 'nursing_intervention', EMOTION: 'emotion',
};

export const COMPONENTS = {
    CHAT_INTERFACE: 'ChatInterface', PATIENT_MONITOR: 'PatientMonitor',
    PATIENT_VISUAL: 'PatientVisual', ORDERS_DRAWER: 'OrdersDrawer',
    LAB_RESULTS_MODAL: 'LabResultsModal', CONFIG_PANEL: 'ConfigPanel',
    CASE_EDITOR: 'CaseEditor', SCENARIO_REPOSITORY: 'ScenarioRepository',
    LOGIN_PAGE: 'LoginPage', APP: 'App',
    MANIKIN_PANEL: 'ManikinPanel', AUSCULTATION_PANEL: 'AuscultationPanel',
    INVESTIGATION_PANEL: 'InvestigationPanel', PATIENT_INFO_PANEL: 'PatientInfoPanel',
    MEDICATION_PANEL: 'MedicationPanel', TREATMENT_PANEL: 'TreatmentPanel',
    SESSION_LOG_VIEWER: 'SessionLogViewer', VITAL_TRENDS: 'VitalTrends',
};

const getVerbMetadata = (verb) => VERB_METADATA[verb] || { severity: SEVERITY.INFO, category: CATEGORIES.NAVIGATION };

class EventLoggerService {
    constructor() {
        this.sessionId = null;
        this.userId = null;
        this.caseId = null;
        this.isEnabled = true;
        this.minimumSeverity = SEVERITY.DEBUG;
        this.performanceMarks = new Map();
        this.eventCounts = new Map();
        this.preCenterBuffer = []; // events logged before NotificationCenter mounted
        this.preCenterCap = 1000;
    }

    setMinimumSeverity(s) { this.minimumSeverity = s; }
    shouldLog(severity) {
        const order = [SEVERITY.DEBUG, SEVERITY.INFO, SEVERITY.ACTION, SEVERITY.IMPORTANT, SEVERITY.CRITICAL];
        return order.indexOf(severity) >= order.indexOf(this.minimumSeverity);
    }

    setContext({ sessionId, userId, caseId }) {
        if (sessionId !== undefined) this.sessionId = sessionId;
        if (userId !== undefined) this.userId = userId;
        if (caseId !== undefined) this.caseId = caseId;
    }
    clearContext() { this.sessionId = null; this.caseId = null; }
    setEnabled(enabled) { this.isEnabled = enabled; }

    startTiming(mark) { this.performanceMarks.set(mark, performance.now()); }
    endTiming(mark) {
        const start = this.performanceMarks.get(mark);
        if (start === undefined) return null;
        this.performanceMarks.delete(mark);
        return Math.round(performance.now() - start);
    }

    log(verb, objectType, options = {}) {
        if (!this.isEnabled) return null;
        const meta = getVerbMetadata(verb);
        const severity = options.severity || meta.severity;
        const category = options.category || meta.category;
        if (!this.shouldLog(severity)) return null;

        let durationMs = options.durationMs;
        if (options.timingMark) {
            const t = this.endTiming(options.timingMark);
            if (t !== null) durationMs = t;
        }

        const countKey = `${verb}:${objectType}`;
        this.eventCounts.set(countKey, (this.eventCounts.get(countKey) || 0) + 1);

        const payload = {
            source: SOURCES.TELEMETRY,
            severity: SEV_MAP[severity] || 'info',
            key: `telemetry:${verb}:${objectType}:${options.objectId || ''}`,
            title: options.objectName || verb,
            message: options.result || '',
            data: {
                verb, objectType,
                category, // xAPI category preserved on the wire
                objectId: options.objectId || null,
                objectName: options.objectName || null,
                component: options.component || null,
                parentComponent: options.parentComponent || null,
                durationMs: durationMs || null,
                context: options.context || null,
                messageContent: options.messageContent || null,
                messageRole: options.messageRole || null,
                result: options.result || null,
            },
        };

        const api = getExternalApi();
        if (api) {
            // Replay any buffered events first, then this one.
            if (this.preCenterBuffer.length > 0) {
                const buf = this.preCenterBuffer;
                this.preCenterBuffer = [];
                buf.forEach(p => api.notify(p));
            }
            api.notify(payload);
        } else {
            this.preCenterBuffer.push(payload);
            if (this.preCenterBuffer.length > this.preCenterCap) {
                this.preCenterBuffer.splice(0, this.preCenterBuffer.length - this.preCenterCap);
            }
        }

        return payload;
    }

    getEventCounts() { return Object.fromEntries(this.eventCounts); }
    resetEventCounts() { this.eventCounts.clear(); }
    getStatus() {
        return {
            sessionId: this.sessionId,
            userId: this.userId,
            caseId: this.caseId,
            isEnabled: this.isEnabled,
            preCenterBuffered: this.preCenterBuffer.length,
        };
    }

    // ---- convenience methods (preserved API) ----
    sessionStarted(sessionId, caseId, caseName) {
        this.setContext({ sessionId, caseId });
        this.log(VERBS.STARTED_SESSION, OBJECT_TYPES.SESSION, { objectId: String(sessionId), objectName: caseName, component: COMPONENTS.APP });
    }
    sessionEnded(duration) {
        this.log(VERBS.ENDED_SESSION, OBJECT_TYPES.SESSION, { objectId: String(this.sessionId), durationMs: duration, component: COMPONENTS.APP });
        this.clearContext();
    }
    sessionResumed(sessionId, caseId, caseName) {
        this.setContext({ sessionId, caseId });
        this.log(VERBS.RESUMED_SESSION, OBJECT_TYPES.SESSION, { objectId: String(sessionId), objectName: caseName, component: COMPONENTS.APP });
    }
    caseLoaded(caseId, caseName) {
        this.log(VERBS.LOADED_CASE, OBJECT_TYPES.CASE, { objectId: String(caseId), objectName: caseName, component: COMPONENTS.CONFIG_PANEL });
    }
    componentOpened(c, n = null) { this.log(VERBS.OPENED, OBJECT_TYPES.COMPONENT, { objectId: c, objectName: n || c, component: c }); }
    componentClosed(c, n = null) { this.log(VERBS.CLOSED, OBJECT_TYPES.COMPONENT, { objectId: c, objectName: n || c, component: c }); }
    tabSwitched(t, c) { this.log(VERBS.SWITCHED_TAB, OBJECT_TYPES.TAB, { objectId: t, objectName: t, component: c }); }
    buttonClicked(b, c, ctx = null) { this.log(VERBS.CLICKED, OBJECT_TYPES.BUTTON, { objectId: b, objectName: b, component: c, context: ctx }); }
    modalOpened(m, c) { this.log(VERBS.OPENED, OBJECT_TYPES.MODAL, { objectId: m, objectName: m, component: c }); }
    modalClosed(m, c) { this.log(VERBS.CLOSED, OBJECT_TYPES.MODAL, { objectId: m, objectName: m, component: c }); }
    drawerOpened(d) { this.log(VERBS.OPENED, OBJECT_TYPES.DRAWER, { objectId: d, objectName: d }); }
    drawerClosed(d) { this.log(VERBS.CLOSED, OBJECT_TYPES.DRAWER, { objectId: d, objectName: d }); }
    labOrdered(id, name, c) { this.log(VERBS.ORDERED_LAB, OBJECT_TYPES.LAB_TEST, { objectId: String(id), objectName: name, component: c }); }
    labResultViewed(id, name, result, c) { this.log(VERBS.VIEWED_LAB_RESULT, OBJECT_TYPES.LAB_RESULT, { objectId: String(id), objectName: name, result, component: c }); }
    labSearched(term, count, c) { this.log(VERBS.SEARCHED_LABS, OBJECT_TYPES.LAB_TEST, { objectName: term, result: `${count} results`, component: c }); }
    labFiltered(t, v, c) { this.log(VERBS.FILTERED_LABS, OBJECT_TYPES.LAB_TEST, { objectId: t, objectName: v, component: c }); }
    messageSent(content, c) { this.log(VERBS.SENT_MESSAGE, OBJECT_TYPES.CHAT_MESSAGE, { component: c, messageContent: content, messageRole: 'user' }); }
    messageReceived(content, c) { this.log(VERBS.RECEIVED_MESSAGE, OBJECT_TYPES.CHAT_MESSAGE, { component: c, messageContent: content, messageRole: 'assistant' }); }
    messageCopied(c) { this.log(VERBS.COPIED_MESSAGE, OBJECT_TYPES.CHAT_MESSAGE, { component: c }); }
    emotionExpressed(e, c) { this.log(VERBS.EXPRESSED_EMOTION, OBJECT_TYPES.EMOTION, { objectName: e, component: c, context: { emotion: e } }); }
    vitalAdjusted(v, oldV, newV, c) { this.log(VERBS.ADJUSTED_VITAL, OBJECT_TYPES.VITAL_SIGN, { objectId: v, objectName: v, component: c, context: { oldValue: oldV, newValue: newV } }); }
    alarmAcknowledged(t, c) { this.log(VERBS.ACKNOWLEDGED_ALARM, OBJECT_TYPES.ALARM, { objectId: t, objectName: t, component: c }); }
    alarmSilenced(t, c) { this.log(VERBS.SILENCED_ALARM, OBJECT_TYPES.ALARM, { objectId: t, objectName: t, component: c }); }
    settingChanged(name, oldV, newV, c) { this.log(VERBS.CHANGED_SETTING, OBJECT_TYPES.SETTING, { objectId: name, objectName: name, component: c, context: { oldValue: oldV, newValue: newV } }); }
    scenarioStarted(name, c) { this.log(VERBS.STARTED_SCENARIO, OBJECT_TYPES.SCENARIO, { objectName: name, component: c }); }
    scenarioPaused(name, c) { this.log(VERBS.PAUSED_SCENARIO, OBJECT_TYPES.SCENARIO, { objectName: name, component: c }); }
    scenarioResumed(name, c) { this.log(VERBS.RESUMED_SCENARIO, OBJECT_TYPES.SCENARIO, { objectName: name, component: c }); }
    scenarioCompleted(name, c, dur = null) { this.log(VERBS.COMPLETED_SCENARIO, OBJECT_TYPES.SCENARIO, { objectName: name, component: c, durationMs: dur }); }
    errorOccurred(t, msg, c, ctx = null) { this.log(VERBS.ERROR_OCCURRED, OBJECT_TYPES.COMPONENT, { objectId: t, objectName: t, result: msg, component: c, context: ctx, severity: SEVERITY.CRITICAL }); }
    apiError(ep, code, msg, c) { this.log(VERBS.API_ERROR, OBJECT_TYPES.COMPONENT, { objectId: ep, objectName: `${code}: ${ep}`, result: msg, component: c, context: { endpoint: ep, statusCode: code }, severity: SEVERITY.CRITICAL }); }
    labPanelOpened(c) { this.startTiming('labPanel'); this.log(VERBS.OPENED, OBJECT_TYPES.PANEL, { objectId: 'investigation_panel', objectName: 'Investigation Panel', component: c }); }
    labPanelClosed(c) { this.log(VERBS.CLOSED, OBJECT_TYPES.PANEL, { objectId: 'investigation_panel', objectName: 'Investigation Panel', component: c, timingMark: 'labPanel' }); }
    labResultReady(id, name, c, abnormal = false) { this.log(VERBS.LAB_RESULT_READY, OBJECT_TYPES.LAB_RESULT, { objectId: String(id), objectName: name, component: c, context: { isAbnormal: abnormal }, severity: abnormal ? SEVERITY.IMPORTANT : SEVERITY.INFO }); }
    medicationOrdered(id, name, dose, route, c) { this.log(VERBS.ORDERED_MEDICATION, OBJECT_TYPES.COMPONENT, { objectId: String(id), objectName: name, component: c, context: { dose, route } }); }
    treatmentOrdered(id, name, c, ctx = null) { this.log(VERBS.ORDERED_TREATMENT, OBJECT_TYPES.COMPONENT, { objectId: String(id), objectName: name, component: c, context: ctx }); }
    interventionPerformed(name, c, result = null) { this.log(VERBS.PERFORMED_INTERVENTION, OBJECT_TYPES.COMPONENT, { objectName: name, component: c, result }); }
    ivFluidOrdered(id, name, rate, c) { this.log(VERBS.ORDERED_IV_FLUID, OBJECT_TYPES.COMPONENT, { objectId: String(id), objectName: name, component: c, context: { rate } }); }
    oxygenStarted(id, type, flow, c) { this.log(VERBS.STARTED_OXYGEN, OBJECT_TYPES.COMPONENT, { objectId: String(id), objectName: type, component: c, context: { flowRate: flow } }); }
    oxygenStopped(id, type, c) { this.log(VERBS.STOPPED_OXYGEN, OBJECT_TYPES.COMPONENT, { objectId: String(id), objectName: type, component: c }); }
    nursingOrdered(id, name, c) { this.log(VERBS.ORDERED_NURSING, OBJECT_TYPES.COMPONENT, { objectId: String(id), objectName: name, component: c }); }
    treatmentDiscontinued(id, name, c, reason = null) { this.log(VERBS.DISCONTINUED_TREATMENT, OBJECT_TYPES.COMPONENT, { objectId: String(id), objectName: name, component: c, context: { reason } }); }
    treatmentEffectStarted(name, effects, c) { this.log(VERBS.TREATMENT_EFFECT_STARTED, OBJECT_TYPES.COMPONENT, { objectName: name, component: c, context: effects }); }
    treatmentEffectPeaked(name, effects, c) { this.log(VERBS.TREATMENT_EFFECT_PEAKED, OBJECT_TYPES.COMPONENT, { objectName: name, component: c, context: effects }); }
    treatmentEffectEnded(name, c) { this.log(VERBS.TREATMENT_EFFECT_ENDED, OBJECT_TYPES.COMPONENT, { objectName: name, component: c }); }
    contraindicatedTreatmentOrdered(id, name, fb, c) { this.log(VERBS.CONTRAINDICATED_TREATMENT_ORDERED, OBJECT_TYPES.COMPONENT, { objectId: String(id), objectName: name, component: c, context: { feedback: fb }, severity: SEVERITY.CRITICAL }); }
    expectedTreatmentGiven(name, points, c) { this.log(VERBS.EXPECTED_TREATMENT_GIVEN, OBJECT_TYPES.COMPONENT, { objectName: name, component: c, context: { points } }); }
    expectedTreatmentMissed(name, fb, c) { this.log(VERBS.EXPECTED_TREATMENT_MISSED, OBJECT_TYPES.COMPONENT, { objectName: name, component: c, context: { feedback: fb } }); }
    alarmTriggered(t, vital, value, threshold, c) { this.log(VERBS.ALARM_TRIGGERED, OBJECT_TYPES.ALARM, { objectId: t, objectName: `${vital} Alarm`, component: c, context: { vitalSign: vital, value, threshold }, severity: SEVERITY.CRITICAL }); }
    patientSummaryViewed(c) { this.log(VERBS.VIEWED_PATIENT_SUMMARY, OBJECT_TYPES.COMPONENT, { objectName: 'Patient Summary', component: c }); }
    patientHistoryViewed(c) { this.log(VERBS.VIEWED_HISTORY, OBJECT_TYPES.COMPONENT, { objectName: 'Patient History', component: c }); }
    patientMedicationsViewed(c) { this.log(VERBS.VIEWED_MEDICATIONS, OBJECT_TYPES.COMPONENT, { objectName: 'Patient Medications', component: c }); }
    patientAllergiesViewed(c) { this.log(VERBS.VIEWED_ALLERGIES, OBJECT_TYPES.COMPONENT, { objectName: 'Patient Allergies', component: c }); }
    viewModeChanged(oldM, newM, c) { this.log(VERBS.SWITCHED_TAB, OBJECT_TYPES.COMPONENT, { objectId: newM, objectName: `View Mode: ${newM}`, component: c, context: { oldMode: oldM, newMode: newM } }); }
    groupExpanded(g, c) { this.log(VERBS.EXPANDED, OBJECT_TYPES.COMPONENT, { objectId: g, objectName: g, component: c }); }
    groupCollapsed(g, c) { this.log(VERBS.COLLAPSED, OBJECT_TYPES.COMPONENT, { objectId: g, objectName: g, component: c }); }
    examPanelOpened() { this.startTiming('examPanel'); this.log(VERBS.OPENED_EXAM_PANEL, OBJECT_TYPES.PANEL, { objectId: 'manikin_panel', objectName: 'Physical Examination Panel', component: COMPONENTS.MANIKIN_PANEL }); }
    examPanelClosed() { this.log(VERBS.CLOSED_EXAM_PANEL, OBJECT_TYPES.PANEL, { objectId: 'manikin_panel', objectName: 'Physical Examination Panel', component: COMPONENTS.MANIKIN_PANEL, timingMark: 'examPanel' }); }
    physicalExamPerformed(region, type, finding, ctx = null) { this.log(VERBS.PERFORMED_PHYSICAL_EXAM, OBJECT_TYPES.PHYSICAL_EXAM, { objectId: `${region}:${type}`, objectName: `${type} - ${region}`, component: COMPONENTS.MANIKIN_PANEL, result: finding, context: ctx }); }
    auscultationPerformed(loc, type, finding, played = false, url = null) { this.log(VERBS.PERFORMED_PHYSICAL_EXAM, OBJECT_TYPES.PHYSICAL_EXAM, { objectId: `auscultation:${loc}`, objectName: `Auscultation - ${loc}`, component: COMPONENTS.AUSCULTATION_PANEL, result: finding, context: { soundType: type, audioPlayed: played, audioUrl: url } }); }

    // Legacy stubs preserved so callers don't break.
    flush() { /* batching is now BackendSurface's job */ }
    startPeriodicFlush() { /* same */ }
}

const EventLogger = new EventLoggerService();
export default EventLogger;
