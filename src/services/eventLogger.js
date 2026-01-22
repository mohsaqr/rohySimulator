/**
 * EventLogger Service - Comprehensive Learning Analytics Tracker
 *
 * Implements xAPI-style event logging for all user interactions.
 * Events are batched and sent to the backend for storage and analysis.
 *
 * Features:
 * - Severity levels (DEBUG, INFO, ACTION, IMPORTANT, CRITICAL)
 * - Event categories for filtering and analysis
 * - Performance timing metrics
 * - Detailed context capture
 */

import { AuthService } from './authService';
import { apiUrl } from '../config/api';

// Severity levels for events
export const SEVERITY = {
    DEBUG: 'DEBUG',       // Development/debugging info
    INFO: 'INFO',         // Informational, passive events
    ACTION: 'ACTION',     // User-initiated actions
    IMPORTANT: 'IMPORTANT', // Significant clinical/learning actions
    CRITICAL: 'CRITICAL'  // Critical events needing attention
};

// Event categories for grouping and analysis
export const CATEGORIES = {
    SESSION: 'SESSION',
    NAVIGATION: 'NAVIGATION',
    CLINICAL: 'CLINICAL',
    COMMUNICATION: 'COMMUNICATION',
    MONITORING: 'MONITORING',
    CONFIGURATION: 'CONFIGURATION',
    ASSESSMENT: 'ASSESSMENT',
    ERROR: 'ERROR'
};

// Standard xAPI-style verbs for learning analytics
export const VERBS = {
    // Session lifecycle
    STARTED_SESSION: 'STARTED_SESSION',
    ENDED_SESSION: 'ENDED_SESSION',
    RESUMED_SESSION: 'RESUMED_SESSION',
    IDLE_TIMEOUT: 'IDLE_TIMEOUT',

    // Navigation/UI
    VIEWED: 'VIEWED',
    OPENED: 'OPENED',
    CLOSED: 'CLOSED',
    NAVIGATED: 'NAVIGATED',
    SWITCHED_TAB: 'SWITCHED_TAB',
    SCROLLED: 'SCROLLED',

    // Interactions
    CLICKED: 'CLICKED',
    SELECTED: 'SELECTED',
    DESELECTED: 'DESELECTED',
    TOGGLED: 'TOGGLED',
    EXPANDED: 'EXPANDED',
    COLLAPSED: 'COLLAPSED',

    // Lab/Investigation actions
    ORDERED_LAB: 'ORDERED_LAB',
    CANCELLED_LAB: 'CANCELLED_LAB',
    VIEWED_LAB_RESULT: 'VIEWED_LAB_RESULT',
    SEARCHED_LABS: 'SEARCHED_LABS',
    FILTERED_LABS: 'FILTERED_LABS',
    LAB_RESULT_READY: 'LAB_RESULT_READY',

    // Treatment/Medication actions
    ORDERED_MEDICATION: 'ORDERED_MEDICATION',
    ADMINISTERED_MEDICATION: 'ADMINISTERED_MEDICATION',
    CANCELLED_MEDICATION: 'CANCELLED_MEDICATION',
    ORDERED_TREATMENT: 'ORDERED_TREATMENT',
    PERFORMED_INTERVENTION: 'PERFORMED_INTERVENTION',

    // Physical Examination
    PERFORMED_PHYSICAL_EXAM: 'PERFORMED_PHYSICAL_EXAM',
    OPENED_EXAM_PANEL: 'OPENED_EXAM_PANEL',
    CLOSED_EXAM_PANEL: 'CLOSED_EXAM_PANEL',

    // Chat/Communication
    SENT_MESSAGE: 'SENT_MESSAGE',
    RECEIVED_MESSAGE: 'RECEIVED_MESSAGE',
    COPIED_MESSAGE: 'COPIED_MESSAGE',
    EDITED_MESSAGE: 'EDITED_MESSAGE',

    // Monitor/Vitals
    ADJUSTED_VITAL: 'ADJUSTED_VITAL',
    ACKNOWLEDGED_ALARM: 'ACKNOWLEDGED_ALARM',
    SILENCED_ALARM: 'SILENCED_ALARM',
    ALARM_TRIGGERED: 'ALARM_TRIGGERED',
    VIEWED_TRENDS: 'VIEWED_TRENDS',

    // Patient Information
    VIEWED_PATIENT_SUMMARY: 'VIEWED_PATIENT_SUMMARY',
    VIEWED_HISTORY: 'VIEWED_HISTORY',
    VIEWED_MEDICATIONS: 'VIEWED_MEDICATIONS',
    VIEWED_ALLERGIES: 'VIEWED_ALLERGIES',

    // Settings
    CHANGED_SETTING: 'CHANGED_SETTING',
    SAVED_SETTING: 'SAVED_SETTING',
    RESET_SETTING: 'RESET_SETTING',

    // Case actions
    LOADED_CASE: 'LOADED_CASE',
    VIEWED_PATIENT_INFO: 'VIEWED_PATIENT_INFO',
    VIEWED_RECORDS: 'VIEWED_RECORDS',
    SAVED_CASE: 'SAVED_CASE',
    EXPORTED_CASE: 'EXPORTED_CASE',

    // Scenario
    STARTED_SCENARIO: 'STARTED_SCENARIO',
    PAUSED_SCENARIO: 'PAUSED_SCENARIO',
    RESUMED_SCENARIO: 'RESUMED_SCENARIO',
    COMPLETED_SCENARIO: 'COMPLETED_SCENARIO',
    RESET_SCENARIO: 'RESET_SCENARIO',

    // Assessment
    SUBMITTED: 'SUBMITTED',
    ANSWERED: 'ANSWERED',
    ATTEMPTED: 'ATTEMPTED',
    CORRECT_ANSWER: 'CORRECT_ANSWER',
    INCORRECT_ANSWER: 'INCORRECT_ANSWER',

    // Errors and issues
    ERROR_OCCURRED: 'ERROR_OCCURRED',
    API_ERROR: 'API_ERROR',
    VALIDATION_ERROR: 'VALIDATION_ERROR'
};

// Verb metadata for severity and category
const VERB_METADATA = {
    // Session
    STARTED_SESSION: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.SESSION },
    ENDED_SESSION: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.SESSION },
    RESUMED_SESSION: { severity: SEVERITY.INFO, category: CATEGORIES.SESSION },
    IDLE_TIMEOUT: { severity: SEVERITY.INFO, category: CATEGORIES.SESSION },

    // Navigation
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

    // Clinical - Labs
    ORDERED_LAB: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.CLINICAL },
    CANCELLED_LAB: { severity: SEVERITY.ACTION, category: CATEGORIES.CLINICAL },
    VIEWED_LAB_RESULT: { severity: SEVERITY.ACTION, category: CATEGORIES.CLINICAL },
    SEARCHED_LABS: { severity: SEVERITY.DEBUG, category: CATEGORIES.CLINICAL },
    FILTERED_LABS: { severity: SEVERITY.DEBUG, category: CATEGORIES.CLINICAL },
    LAB_RESULT_READY: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },

    // Clinical - Treatment
    ORDERED_MEDICATION: { severity: SEVERITY.CRITICAL, category: CATEGORIES.CLINICAL },
    ADMINISTERED_MEDICATION: { severity: SEVERITY.CRITICAL, category: CATEGORIES.CLINICAL },
    CANCELLED_MEDICATION: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.CLINICAL },
    ORDERED_TREATMENT: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.CLINICAL },
    PERFORMED_INTERVENTION: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.CLINICAL },

    // Physical Examination
    PERFORMED_PHYSICAL_EXAM: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.CLINICAL },
    OPENED_EXAM_PANEL: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    CLOSED_EXAM_PANEL: { severity: SEVERITY.DEBUG, category: CATEGORIES.CLINICAL },

    // Communication
    SENT_MESSAGE: { severity: SEVERITY.ACTION, category: CATEGORIES.COMMUNICATION },
    RECEIVED_MESSAGE: { severity: SEVERITY.INFO, category: CATEGORIES.COMMUNICATION },
    COPIED_MESSAGE: { severity: SEVERITY.DEBUG, category: CATEGORIES.COMMUNICATION },

    // Monitoring
    ADJUSTED_VITAL: { severity: SEVERITY.ACTION, category: CATEGORIES.MONITORING },
    ACKNOWLEDGED_ALARM: { severity: SEVERITY.ACTION, category: CATEGORIES.MONITORING },
    SILENCED_ALARM: { severity: SEVERITY.ACTION, category: CATEGORIES.MONITORING },
    ALARM_TRIGGERED: { severity: SEVERITY.CRITICAL, category: CATEGORIES.MONITORING },
    VIEWED_TRENDS: { severity: SEVERITY.INFO, category: CATEGORIES.MONITORING },

    // Patient Info
    VIEWED_PATIENT_SUMMARY: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    VIEWED_HISTORY: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    VIEWED_MEDICATIONS: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    VIEWED_ALLERGIES: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },

    // Settings
    CHANGED_SETTING: { severity: SEVERITY.INFO, category: CATEGORIES.CONFIGURATION },
    SAVED_SETTING: { severity: SEVERITY.INFO, category: CATEGORIES.CONFIGURATION },
    RESET_SETTING: { severity: SEVERITY.INFO, category: CATEGORIES.CONFIGURATION },

    // Case/Scenario
    LOADED_CASE: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.SESSION },
    VIEWED_PATIENT_INFO: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    VIEWED_RECORDS: { severity: SEVERITY.INFO, category: CATEGORIES.CLINICAL },
    SAVED_CASE: { severity: SEVERITY.ACTION, category: CATEGORIES.CONFIGURATION },
    EXPORTED_CASE: { severity: SEVERITY.ACTION, category: CATEGORIES.CONFIGURATION },
    STARTED_SCENARIO: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.SESSION },
    PAUSED_SCENARIO: { severity: SEVERITY.INFO, category: CATEGORIES.SESSION },
    RESUMED_SCENARIO: { severity: SEVERITY.INFO, category: CATEGORIES.SESSION },
    COMPLETED_SCENARIO: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.ASSESSMENT },
    RESET_SCENARIO: { severity: SEVERITY.INFO, category: CATEGORIES.SESSION },

    // Assessment
    SUBMITTED: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.ASSESSMENT },
    ANSWERED: { severity: SEVERITY.ACTION, category: CATEGORIES.ASSESSMENT },
    ATTEMPTED: { severity: SEVERITY.INFO, category: CATEGORIES.ASSESSMENT },
    CORRECT_ANSWER: { severity: SEVERITY.IMPORTANT, category: CATEGORIES.ASSESSMENT },
    INCORRECT_ANSWER: { severity: SEVERITY.INFO, category: CATEGORIES.ASSESSMENT },

    // Errors
    ERROR_OCCURRED: { severity: SEVERITY.CRITICAL, category: CATEGORIES.ERROR },
    API_ERROR: { severity: SEVERITY.CRITICAL, category: CATEGORIES.ERROR },
    VALIDATION_ERROR: { severity: SEVERITY.ACTION, category: CATEGORIES.ERROR }
};

// Object types for categorization
export const OBJECT_TYPES = {
    SESSION: 'session',
    CASE: 'case',
    LAB_TEST: 'lab_test',
    LAB_RESULT: 'lab_result',
    CHAT_MESSAGE: 'chat_message',
    VITAL_SIGN: 'vital_sign',
    ALARM: 'alarm',
    SETTING: 'setting',
    BUTTON: 'button',
    TAB: 'tab',
    MODAL: 'modal',
    DRAWER: 'drawer',
    PANEL: 'panel',
    SCENARIO: 'scenario',
    COMPONENT: 'component',
    PHYSICAL_EXAM: 'physical_exam'
};

// Component names for tracking
export const COMPONENTS = {
    CHAT_INTERFACE: 'ChatInterface',
    PATIENT_MONITOR: 'PatientMonitor',
    PATIENT_VISUAL: 'PatientVisual',
    ORDERS_DRAWER: 'OrdersDrawer',
    LAB_RESULTS_MODAL: 'LabResultsModal',
    CONFIG_PANEL: 'ConfigPanel',
    CASE_EDITOR: 'CaseEditor',
    SCENARIO_REPOSITORY: 'ScenarioRepository',
    LOGIN_PAGE: 'LoginPage',
    APP: 'App',
    MANIKIN_PANEL: 'ManikinPanel',
    AUSCULTATION_PANEL: 'AuscultationPanel',
    INVESTIGATION_PANEL: 'InvestigationPanel',
    PATIENT_INFO_PANEL: 'PatientInfoPanel',
    MEDICATION_PANEL: 'MedicationPanel',
    TREATMENT_PANEL: 'TreatmentPanel',
    SESSION_LOG_VIEWER: 'SessionLogViewer',
    VITAL_TRENDS: 'VitalTrends'
};

// Helper to get verb metadata
const getVerbMetadata = (verb) => {
    return VERB_METADATA[verb] || { severity: SEVERITY.INFO, category: CATEGORIES.NAVIGATION };
};

class EventLoggerService {
    constructor() {
        this.eventQueue = [];
        this.sessionId = null;
        this.userId = null;
        this.caseId = null;
        this.batchSize = 10;
        this.flushInterval = 5000; // 5 seconds
        this.flushTimer = null;
        this.isEnabled = true;
        this.minimumSeverity = SEVERITY.DEBUG; // Log all by default
        this.performanceMarks = new Map(); // For timing events
        this.eventCounts = new Map(); // Track event counts for analytics

        // Start periodic flush
        this.startPeriodicFlush();

        // Flush on page unload
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', () => this.flush(true));
            window.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    this.flush(true);
                }
            });
        }
    }

    /**
     * Set minimum severity level for logging
     */
    setMinimumSeverity(severity) {
        this.minimumSeverity = severity;
    }

    /**
     * Check if a severity level should be logged
     */
    shouldLog(severity) {
        const levels = [SEVERITY.DEBUG, SEVERITY.INFO, SEVERITY.ACTION, SEVERITY.IMPORTANT, SEVERITY.CRITICAL];
        const minIndex = levels.indexOf(this.minimumSeverity);
        const eventIndex = levels.indexOf(severity);
        return eventIndex >= minIndex;
    }

    /**
     * Set the current session context
     */
    setContext({ sessionId, userId, caseId }) {
        if (sessionId !== undefined) this.sessionId = sessionId;
        if (userId !== undefined) this.userId = userId;
        if (caseId !== undefined) this.caseId = caseId;
    }

    /**
     * Clear the current context
     */
    clearContext() {
        this.sessionId = null;
        this.caseId = null;
        // Keep userId as user may still be logged in
    }

    /**
     * Enable or disable logging
     */
    setEnabled(enabled) {
        this.isEnabled = enabled;
    }

    /**
     * Start a performance timing mark
     */
    startTiming(markName) {
        this.performanceMarks.set(markName, performance.now());
    }

    /**
     * End a performance timing mark and return duration
     */
    endTiming(markName) {
        const startTime = this.performanceMarks.get(markName);
        if (startTime) {
            this.performanceMarks.delete(markName);
            return Math.round(performance.now() - startTime);
        }
        return null;
    }

    /**
     * Log a learning event
     *
     * @param {string} verb - The action verb (from VERBS)
     * @param {string} objectType - Type of object being acted upon (from OBJECT_TYPES)
     * @param {object} options - Additional event options
     * @param {string} options.objectId - Unique identifier for the object
     * @param {string} options.objectName - Human-readable name
     * @param {string} options.component - Component where action occurred
     * @param {string} options.parentComponent - Parent component if nested
     * @param {string} options.result - Result of the action
     * @param {number} options.durationMs - Duration in milliseconds
     * @param {object} options.context - Additional context data
     * @param {string} options.messageContent - Chat message content (for chat events)
     * @param {string} options.messageRole - Chat message role (user/assistant)
     * @param {string} options.severity - Override automatic severity
     * @param {string} options.category - Override automatic category
     * @param {string} options.timingMark - End timing mark and include duration
     */
    log(verb, objectType, options = {}) {
        if (!this.isEnabled) return;

        // Get metadata for verb
        const metadata = getVerbMetadata(verb);
        const severity = options.severity || metadata.severity;
        const category = options.category || metadata.category;

        // Check if this severity should be logged
        if (!this.shouldLog(severity)) return;

        // Handle timing mark if provided
        let durationMs = options.durationMs;
        if (options.timingMark) {
            durationMs = this.endTiming(options.timingMark) || durationMs;
        }

        // Track event counts
        const countKey = `${verb}:${objectType}`;
        this.eventCounts.set(countKey, (this.eventCounts.get(countKey) || 0) + 1);

        const event = {
            timestamp: new Date().toISOString(),
            session_id: this.sessionId,
            user_id: this.userId,
            case_id: this.caseId,
            verb,
            object_type: objectType,
            severity,
            category,
            object_id: options.objectId || null,
            object_name: options.objectName || null,
            component: options.component || null,
            parent_component: options.parentComponent || null,
            result: options.result || null,
            duration_ms: durationMs || null,
            context: options.context || null,
            message_content: options.messageContent || null,
            message_role: options.messageRole || null
        };

        this.eventQueue.push(event);

        // Flush if batch size reached
        if (this.eventQueue.length >= this.batchSize) {
            this.flush();
        }

        // Log to console in development with color coding
        if (process.env.NODE_ENV === 'development') {
            const colors = {
                DEBUG: '\x1b[90m',    // Gray
                INFO: '\x1b[36m',     // Cyan
                ACTION: '\x1b[34m',   // Blue
                IMPORTANT: '\x1b[33m', // Yellow
                CRITICAL: '\x1b[31m'  // Red
            };
            const color = colors[severity] || '';
            const reset = '\x1b[0m';
            console.log(`${color}[EventLogger:${severity}]${reset}`, verb, objectType, options.objectName || options.objectId || '', durationMs ? `(${durationMs}ms)` : '');
        }

        return event;
    }

    /**
     * Get event counts for analytics
     */
    getEventCounts() {
        return Object.fromEntries(this.eventCounts);
    }

    /**
     * Reset event counts
     */
    resetEventCounts() {
        this.eventCounts.clear();
    }

    /**
     * Convenience methods for common events
     */

    // Session events
    sessionStarted(sessionId, caseId, caseName) {
        this.setContext({ sessionId, caseId });
        this.log(VERBS.STARTED_SESSION, OBJECT_TYPES.SESSION, {
            objectId: String(sessionId),
            objectName: caseName,
            component: COMPONENTS.APP
        });
    }

    sessionEnded(duration) {
        this.log(VERBS.ENDED_SESSION, OBJECT_TYPES.SESSION, {
            objectId: String(this.sessionId),
            durationMs: duration,
            component: COMPONENTS.APP
        });
        this.flush(true); // Immediate flush
        this.clearContext();
    }

    sessionResumed(sessionId, caseId, caseName) {
        this.setContext({ sessionId, caseId });
        this.log(VERBS.RESUMED_SESSION, OBJECT_TYPES.SESSION, {
            objectId: String(sessionId),
            objectName: caseName,
            component: COMPONENTS.APP
        });
    }

    // Case events
    caseLoaded(caseId, caseName) {
        this.log(VERBS.LOADED_CASE, OBJECT_TYPES.CASE, {
            objectId: String(caseId),
            objectName: caseName,
            component: COMPONENTS.CONFIG_PANEL
        });
    }

    // UI events
    componentOpened(componentName, objectName = null) {
        this.log(VERBS.OPENED, OBJECT_TYPES.COMPONENT, {
            objectId: componentName,
            objectName: objectName || componentName,
            component: componentName
        });
    }

    componentClosed(componentName, objectName = null) {
        this.log(VERBS.CLOSED, OBJECT_TYPES.COMPONENT, {
            objectId: componentName,
            objectName: objectName || componentName,
            component: componentName
        });
    }

    tabSwitched(tabName, componentName) {
        this.log(VERBS.SWITCHED_TAB, OBJECT_TYPES.TAB, {
            objectId: tabName,
            objectName: tabName,
            component: componentName
        });
    }

    buttonClicked(buttonName, componentName, context = null) {
        this.log(VERBS.CLICKED, OBJECT_TYPES.BUTTON, {
            objectId: buttonName,
            objectName: buttonName,
            component: componentName,
            context
        });
    }

    modalOpened(modalName, componentName) {
        this.log(VERBS.OPENED, OBJECT_TYPES.MODAL, {
            objectId: modalName,
            objectName: modalName,
            component: componentName
        });
    }

    modalClosed(modalName, componentName) {
        this.log(VERBS.CLOSED, OBJECT_TYPES.MODAL, {
            objectId: modalName,
            objectName: modalName,
            component: componentName
        });
    }

    drawerOpened(drawerName) {
        this.log(VERBS.OPENED, OBJECT_TYPES.DRAWER, {
            objectId: drawerName,
            objectName: drawerName
        });
    }

    drawerClosed(drawerName) {
        this.log(VERBS.CLOSED, OBJECT_TYPES.DRAWER, {
            objectId: drawerName,
            objectName: drawerName
        });
    }

    // Lab events
    labOrdered(labId, labName, componentName) {
        this.log(VERBS.ORDERED_LAB, OBJECT_TYPES.LAB_TEST, {
            objectId: String(labId),
            objectName: labName,
            component: componentName
        });
    }

    labResultViewed(labId, labName, result, componentName) {
        this.log(VERBS.VIEWED_LAB_RESULT, OBJECT_TYPES.LAB_RESULT, {
            objectId: String(labId),
            objectName: labName,
            result: result,
            component: componentName
        });
    }

    labSearched(searchTerm, resultsCount, componentName) {
        this.log(VERBS.SEARCHED_LABS, OBJECT_TYPES.LAB_TEST, {
            objectName: searchTerm,
            result: `${resultsCount} results`,
            component: componentName
        });
    }

    labFiltered(filterType, filterValue, componentName) {
        this.log(VERBS.FILTERED_LABS, OBJECT_TYPES.LAB_TEST, {
            objectId: filterType,
            objectName: filterValue,
            component: componentName
        });
    }

    // Chat events
    messageSent(content, componentName) {
        this.log(VERBS.SENT_MESSAGE, OBJECT_TYPES.CHAT_MESSAGE, {
            component: componentName,
            messageContent: content,
            messageRole: 'user'
        });
    }

    messageReceived(content, componentName) {
        this.log(VERBS.RECEIVED_MESSAGE, OBJECT_TYPES.CHAT_MESSAGE, {
            component: componentName,
            messageContent: content,
            messageRole: 'assistant'
        });
    }

    messageCopied(componentName) {
        this.log(VERBS.COPIED_MESSAGE, OBJECT_TYPES.CHAT_MESSAGE, {
            component: componentName
        });
    }

    // Vital/Monitor events
    vitalAdjusted(vitalSign, oldValue, newValue, componentName) {
        this.log(VERBS.ADJUSTED_VITAL, OBJECT_TYPES.VITAL_SIGN, {
            objectId: vitalSign,
            objectName: vitalSign,
            component: componentName,
            context: { oldValue, newValue }
        });
    }

    alarmAcknowledged(alarmType, componentName) {
        this.log(VERBS.ACKNOWLEDGED_ALARM, OBJECT_TYPES.ALARM, {
            objectId: alarmType,
            objectName: alarmType,
            component: componentName
        });
    }

    alarmSilenced(alarmType, componentName) {
        this.log(VERBS.SILENCED_ALARM, OBJECT_TYPES.ALARM, {
            objectId: alarmType,
            objectName: alarmType,
            component: componentName
        });
    }

    // Settings events
    settingChanged(settingName, oldValue, newValue, componentName) {
        this.log(VERBS.CHANGED_SETTING, OBJECT_TYPES.SETTING, {
            objectId: settingName,
            objectName: settingName,
            component: componentName,
            context: { oldValue, newValue }
        });
    }

    // Scenario events
    scenarioStarted(scenarioName, componentName) {
        this.log(VERBS.STARTED_SCENARIO, OBJECT_TYPES.SCENARIO, {
            objectName: scenarioName,
            component: componentName
        });
    }

    scenarioPaused(scenarioName, componentName) {
        this.log(VERBS.PAUSED_SCENARIO, OBJECT_TYPES.SCENARIO, {
            objectName: scenarioName,
            component: componentName
        });
    }

    scenarioResumed(scenarioName, componentName) {
        this.log(VERBS.RESUMED_SCENARIO, OBJECT_TYPES.SCENARIO, {
            objectName: scenarioName,
            component: componentName
        });
    }

    scenarioCompleted(scenarioName, componentName, durationMs = null) {
        this.log(VERBS.COMPLETED_SCENARIO, OBJECT_TYPES.SCENARIO, {
            objectName: scenarioName,
            component: componentName,
            durationMs
        });
    }

    // Error events
    errorOccurred(errorType, errorMessage, componentName, context = null) {
        this.log(VERBS.ERROR_OCCURRED, OBJECT_TYPES.COMPONENT, {
            objectId: errorType,
            objectName: errorType,
            result: errorMessage,
            component: componentName,
            context,
            severity: SEVERITY.CRITICAL
        });
    }

    apiError(endpoint, statusCode, errorMessage, componentName) {
        this.log(VERBS.API_ERROR, OBJECT_TYPES.COMPONENT, {
            objectId: endpoint,
            objectName: `${statusCode}: ${endpoint}`,
            result: errorMessage,
            component: componentName,
            context: { endpoint, statusCode },
            severity: SEVERITY.CRITICAL
        });
    }

    // Lab panel events
    labPanelOpened(componentName) {
        this.startTiming('labPanel');
        this.log(VERBS.OPENED, OBJECT_TYPES.PANEL, {
            objectId: 'investigation_panel',
            objectName: 'Investigation Panel',
            component: componentName
        });
    }

    labPanelClosed(componentName) {
        this.log(VERBS.CLOSED, OBJECT_TYPES.PANEL, {
            objectId: 'investigation_panel',
            objectName: 'Investigation Panel',
            component: componentName,
            timingMark: 'labPanel'
        });
    }

    labResultReady(labId, labName, componentName, isAbnormal = false) {
        this.log(VERBS.LAB_RESULT_READY, OBJECT_TYPES.LAB_RESULT, {
            objectId: String(labId),
            objectName: labName,
            component: componentName,
            context: { isAbnormal },
            severity: isAbnormal ? SEVERITY.IMPORTANT : SEVERITY.INFO
        });
    }

    // Treatment/Medication events
    medicationOrdered(medicationId, medicationName, dose, route, componentName) {
        this.log(VERBS.ORDERED_MEDICATION, OBJECT_TYPES.COMPONENT, {
            objectId: String(medicationId),
            objectName: medicationName,
            component: componentName,
            context: { dose, route }
        });
    }

    treatmentOrdered(treatmentId, treatmentName, componentName, context = null) {
        this.log(VERBS.ORDERED_TREATMENT, OBJECT_TYPES.COMPONENT, {
            objectId: String(treatmentId),
            objectName: treatmentName,
            component: componentName,
            context
        });
    }

    interventionPerformed(interventionName, componentName, result = null) {
        this.log(VERBS.PERFORMED_INTERVENTION, OBJECT_TYPES.COMPONENT, {
            objectName: interventionName,
            component: componentName,
            result
        });
    }

    // Alarm events
    alarmTriggered(alarmType, vitalSign, value, threshold, componentName) {
        this.log(VERBS.ALARM_TRIGGERED, OBJECT_TYPES.ALARM, {
            objectId: alarmType,
            objectName: `${vitalSign} Alarm`,
            component: componentName,
            context: { vitalSign, value, threshold },
            severity: SEVERITY.CRITICAL
        });
    }

    // Patient info events
    patientSummaryViewed(componentName) {
        this.log(VERBS.VIEWED_PATIENT_SUMMARY, OBJECT_TYPES.COMPONENT, {
            objectName: 'Patient Summary',
            component: componentName
        });
    }

    patientHistoryViewed(componentName) {
        this.log(VERBS.VIEWED_HISTORY, OBJECT_TYPES.COMPONENT, {
            objectName: 'Patient History',
            component: componentName
        });
    }

    patientMedicationsViewed(componentName) {
        this.log(VERBS.VIEWED_MEDICATIONS, OBJECT_TYPES.COMPONENT, {
            objectName: 'Patient Medications',
            component: componentName
        });
    }

    patientAllergiesViewed(componentName) {
        this.log(VERBS.VIEWED_ALLERGIES, OBJECT_TYPES.COMPONENT, {
            objectName: 'Patient Allergies',
            component: componentName
        });
    }

    // View mode changes
    viewModeChanged(oldMode, newMode, componentName) {
        this.log(VERBS.SWITCHED_TAB, OBJECT_TYPES.COMPONENT, {
            objectId: newMode,
            objectName: `View Mode: ${newMode}`,
            component: componentName,
            context: { oldMode, newMode }
        });
    }

    // Group expansion
    groupExpanded(groupName, componentName) {
        this.log(VERBS.EXPANDED, OBJECT_TYPES.COMPONENT, {
            objectId: groupName,
            objectName: groupName,
            component: componentName
        });
    }

    groupCollapsed(groupName, componentName) {
        this.log(VERBS.COLLAPSED, OBJECT_TYPES.COMPONENT, {
            objectId: groupName,
            objectName: groupName,
            component: componentName
        });
    }

    // Physical Examination events
    examPanelOpened() {
        this.startTiming('examPanel');
        this.log(VERBS.OPENED_EXAM_PANEL, OBJECT_TYPES.PANEL, {
            objectId: 'manikin_panel',
            objectName: 'Physical Examination Panel',
            component: COMPONENTS.MANIKIN_PANEL
        });
    }

    examPanelClosed() {
        this.log(VERBS.CLOSED_EXAM_PANEL, OBJECT_TYPES.PANEL, {
            objectId: 'manikin_panel',
            objectName: 'Physical Examination Panel',
            component: COMPONENTS.MANIKIN_PANEL,
            timingMark: 'examPanel'
        });
    }

    physicalExamPerformed(region, examType, finding, context = null) {
        this.log(VERBS.PERFORMED_PHYSICAL_EXAM, OBJECT_TYPES.PHYSICAL_EXAM, {
            objectId: `${region}:${examType}`,
            objectName: `${examType} - ${region}`,
            component: COMPONENTS.MANIKIN_PANEL,
            result: finding,
            context
        });
    }

    auscultationPerformed(location, soundType, finding, audioPlayed = false, audioUrl = null) {
        this.log(VERBS.PERFORMED_PHYSICAL_EXAM, OBJECT_TYPES.PHYSICAL_EXAM, {
            objectId: `auscultation:${location}`,
            objectName: `Auscultation - ${location}`,
            component: COMPONENTS.AUSCULTATION_PANEL,
            result: finding,
            context: { soundType, audioPlayed, audioUrl }
        });
    }

    /**
     * Start periodic flush timer
     */
    startPeriodicFlush() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
        }
        this.flushTimer = setInterval(() => {
            if (this.eventQueue.length > 0) {
                this.flush();
            }
        }, this.flushInterval);
    }

    /**
     * Flush events to backend
     */
    async flush(immediate = false) {
        if (this.eventQueue.length === 0) return;

        const events = [...this.eventQueue];
        this.eventQueue = [];

        try {
            const token = AuthService.getToken();
            const headers = {
                'Content-Type': 'application/json'
            };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            // Use sendBeacon for immediate flush (page unload)
            if (immediate && navigator.sendBeacon) {
                const blob = new Blob([JSON.stringify({ events })], { type: 'application/json' });
                navigator.sendBeacon(apiUrl('/learning-events/batch'), blob);
                return;
            }

            const response = await fetch(apiUrl('/learning-events/batch'), {
                method: 'POST',
                headers,
                body: JSON.stringify({ events })
            });

            if (!response.ok) {
                // Re-queue events on failure
                this.eventQueue = [...events, ...this.eventQueue];
                console.warn('[EventLogger] Failed to flush events:', response.status);
            }
        } catch (error) {
            // Re-queue events on error
            this.eventQueue = [...events, ...this.eventQueue];
            console.warn('[EventLogger] Error flushing events:', error);
        }
    }

    /**
     * Get queue status for debugging
     */
    getStatus() {
        return {
            queueLength: this.eventQueue.length,
            sessionId: this.sessionId,
            userId: this.userId,
            caseId: this.caseId,
            isEnabled: this.isEnabled
        };
    }
}

// Singleton instance
const EventLogger = new EventLoggerService();

export default EventLogger;
