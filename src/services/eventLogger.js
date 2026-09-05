/**
 * EventLogger Service - Comprehensive Learning Analytics Tracker
 *
 * The convenience methods below (sessionStarted, treatmentOrdered, …) are the
 * host's emitters, one per learner act. Internally, every event
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
// The vocabulary lives in server/shared/ so the SERVER validates the same
// verbs, object types and components the client emits, and every plugin's
// contribution arrives through the generated manifests (foldManifests THROWS
// on a collision instead of letting a spread silently overwrite one — see
// docs/design/plugin-standard.md). Re-exported here because ~40 call sites
// import them from this module; the definitions, not the exports, moved.
import {
    SEVERITY, CATEGORIES, VERBS, VERB_METADATA, VERB_FACETS, DEFAULT_VERB_METADATA, normalizeVerb,
} from '../../server/shared/learningVerbs.js';
import { OBJECT_TYPES, COMPONENTS } from '../../server/shared/eventFacets.js';

export { SEVERITY, CATEGORIES, VERBS, OBJECT_TYPES, COMPONENTS };

// Map xAPI severity strings → notification severity.
const SEV_MAP = {
    DEBUG: 'debug',
    INFO: 'info',
    ACTION: 'info',
    IMPORTANT: 'warning',
    CRITICAL: 'critical',
};



const getVerbMetadata = (verb) => VERB_METADATA[normalizeVerb(verb)] || DEFAULT_VERB_METADATA;

// Throw on an undeclared verb in dev and test; keep the row in production.
const STRICT_VERBS = (() => {
    try { return Boolean(import.meta.env?.DEV) || import.meta.env?.MODE === 'test'; } catch { return false; }
})();

class EventLoggerService {
    constructor() {
        this.sessionId = null;
        this.userId = null;
        this.caseId = null;
        // Room context. Set by App.jsx whenever the bottom RoomNavigator
        // changes the active room. Every subsequent log() call stamps
        // this onto data.room so the analytics layer can answer "what
        // was the learner doing in the Laboratory room?" without
        // joining against a separate navigation table.
        this.room = null;
        this.isEnabled = true;
        this.minimumSeverity = SEVERITY.DEBUG;
        this.performanceMarks = new Map();
        this.eventCounts = new Map();
        this.preCenterBuffer = []; // events logged before NotificationCenter mounted
        this.preCenterCap = 1000;
        // Current physiology snapshot. PatientMonitor updates this on every
        // displayVitals change; log() copies it into every emitted event so
        // each action row carries vitals AT THAT MOMENT (wide schema).
        this.currentVitals = null;
    }

    setCurrentVitals(v) {
        // Accepts snake_case or camelCase keys, normalises to snake_case
        // matching the migration column names.
        if (!v || typeof v !== 'object') { this.currentVitals = null; return; }
        this.currentVitals = {
            hr: v.hr ?? null,
            spo2: v.spo2 ?? null,
            bp_sys: v.bp_sys ?? v.bpSys ?? null,
            bp_dia: v.bp_dia ?? v.bpDia ?? null,
            rr: v.rr ?? null,
            temp: v.temp ?? null,
            etco2: v.etco2 ?? null,
            rhythm: v.rhythm ?? null,
        };
    }

    setMinimumSeverity(s) { this.minimumSeverity = s; }
    shouldLog(severity) {
        const order = [SEVERITY.DEBUG, SEVERITY.INFO, SEVERITY.ACTION, SEVERITY.IMPORTANT, SEVERITY.CRITICAL];
        return order.indexOf(severity) >= order.indexOf(this.minimumSeverity);
    }

    setContext({ sessionId, userId, caseId, room }) {
        if (sessionId !== undefined) this.sessionId = sessionId;
        if (userId !== undefined) this.userId = userId;
        if (caseId !== undefined) this.caseId = caseId;
        if (room !== undefined) this.room = room;
    }
    clearContext() { this.sessionId = null; this.caseId = null; this.room = null; }
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
        // An undeclared verb costs a whole row at ingest (the registry is a
        // hard whitelist there). In dev/test that is a bug to fix now, so it
        // throws; in production the click is kept as UNDECLARED_VERB with the
        // attempt in context — never dropped. Historical names are fine: the
        // server reads them through the alias map.
        if (typeof verb !== 'string' || !VERB_FACETS[normalizeVerb(verb)]) {
            const attempted = typeof verb === 'string' ? verb : String(verb);
            if (STRICT_VERBS) {
                throw new Error(`EventLogger: '${attempted}' is not in the verb registry. Declare it in server/shared/learningVerbs.js (or the plugin manifest) before emitting it.`);
            }
            options = { ...options, context: { ...(options.context || {}), attempted_verb: attempted, attempted_object_type: objectType ?? null } };
            verb = VERBS.UNDECLARED_VERB;
            objectType = OBJECT_TYPES.UNKNOWN;
        }
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
            // Stamp the singleton's trinity into data.* so BackendSurface
            // picks them up regardless of React-prop staleness on its
            // BackendSurfaceBridge. The bridge only re-renders on auth-context
            // change, so without this, sessionId/caseId stay null in the
            // queued event even though the singleton has the right values.
            // Server still re-derives user_id/case_id from session_id, so
            // these fields are advisory — but session_id needs to be right.
            data: {
                verb, objectType,
                // Both the xAPI severity AND the xAPI category ride in data.*.
                // The top-level `severity` above is the NOTIFICATION severity
                // (lowercase, drives DND/threshold routing) and mapping it back
                // is lossy — ACTION collapses into 'info' and returns as INFO.
                // The server persists learning_events.severity, so it gets the
                // unmapped value rather than a round-tripped approximation.
                severity,
                category,
                sessionId: this.sessionId,
                userId: this.userId,
                caseId: this.caseId,
                // Active room when this event fired. Set by App.jsx via
                // setContext({ room }) on every RoomNavigator change.
                // Null means "no in-session room" (login screen,
                // settings, persona editor, etc.). A plugin's narrowed
                // logger stamps its own id per event, which is what lets a
                // plugin editor open from the settings page still attribute
                // its rows to the plugin.
                room: options.room ?? this.room,
                // Plugin attribution (RPS-1 §14.3, migration 0055): set only
                // by the narrowed plugin logger.
                pluginId: options.pluginId ?? null,
                pluginVersion: options.pluginVersion ?? null,
                objectId: options.objectId || null,
                objectName: options.objectName || null,
                component: options.component || null,
                parentComponent: options.parentComponent || null,
                durationMs: durationMs || null,
                context: options.context || null,
                messageContent: options.messageContent || null,
                messageRole: options.messageRole || null,
                result: options.result || null,
                // Physiology snapshot at the moment of action. Wide schema —
                // each vital is its own field so the server can map directly
                // to its column. Null when no monitor has registered vitals.
                vitals: this.currentVitals ? { ...this.currentVitals } : null,
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
            room: this.room,
            isEnabled: this.isEnabled,
            preCenterBuffered: this.preCenterBuffer.length,
        };
    }

    // Called by App.jsx whenever the bottom RoomNavigator switches the
    // active room. Stamps the new room into the singleton so every
    // subsequent log() carries it, and emits one NAVIGATED event marking
    // the transition itself (from-room → to-room) so the analytics
    // layer can compute room durations and traversal paths without
    // joining against application state.
    roomChanged(toRoom) {
        const fromRoom = this.room;
        this.setContext({ room: toRoom });
        this.log(VERBS.NAVIGATED, OBJECT_TYPES.ROOM, {
            objectId: String(toRoom),
            objectName: toRoom,
            component: COMPONENTS.APP,
            context: { fromRoom, toRoom },
        });
    }

    // ---- convenience methods (preserved API) ----
    sessionStarted(sessionId, caseId, caseName) {
        this.setContext({ sessionId, caseId });
        this.log(VERBS.STARTED_SESSION, OBJECT_TYPES.SESSION, { objectId: String(sessionId), objectName: caseName, component: COMPONENTS.APP });
    }
    sessionEnded(duration, reason = 'explicit') {
        // Emitted BEFORE clearContext so the row still carries the session.
        // Context is NOT cleared here any more: App.jsx tears the session
        // down itself, and the debrief that follows an explicit end still
        // belongs to this session (its rows need the id).
        this.log(VERBS.ENDED_SESSION, OBJECT_TYPES.SESSION, {
            objectId: String(this.sessionId ?? ''), durationMs: duration ?? null, result: reason,
            component: COMPONENTS.APP, context: { reason },
        });
    }
    sessionResumed(sessionId, caseId, caseName) {
        this.setContext({ sessionId, caseId });
        this.log(VERBS.RESUMED_SESSION, OBJECT_TYPES.SESSION, { objectId: String(sessionId), objectName: caseName, component: COMPONENTS.APP });
    }
    focusLost() { this.log(VERBS.LOST_FOCUS, OBJECT_TYPES.COMPONENT, { objectId: COMPONENTS.APP, objectName: 'Window blur', component: COMPONENTS.APP }); }
    focusResumed() { this.log(VERBS.RESUMED_FOCUS, OBJECT_TYPES.COMPONENT, { objectId: COMPONENTS.APP, objectName: 'Window focus', component: COMPONENTS.APP }); }
    unload() { this.log(VERBS.UNLOADED_APP, OBJECT_TYPES.SESSION, { objectId: String(this.sessionId || ''), objectName: 'Window unload', component: COMPONENTS.APP }); }
    caseLoaded(caseId, caseName) {
        // Re-stamp the singleton so subsequent events on the client carry
        // the new caseId in EventLogger.getStatus(). The server is now
        // authoritative for the row-level trinity (PLAN_LOGGING.md Phase 1)
        // but consumers reading getStatus() directly need fresh state.
        this.setContext({ caseId });
        this.log(VERBS.LOADED_CASE, OBJECT_TYPES.CASE, { objectId: String(caseId), objectName: caseName, component: COMPONENTS.CONFIG_PANEL });
    }
    componentOpened(c, n = null) { this.log(VERBS.OPENED, OBJECT_TYPES.COMPONENT, { objectId: c, objectName: n || c, component: c }); }
    componentClosed(c, n = null) { this.log(VERBS.CLOSED, OBJECT_TYPES.COMPONENT, { objectId: c, objectName: n || c, component: c }); }
    tabSwitched(t, c, ctx = null) { this.log(VERBS.SWITCHED_TAB, OBJECT_TYPES.TAB, { objectId: t, objectName: t, component: c, context: ctx }); }
    buttonClicked(b, c, ctx = null) { this.log(VERBS.CLICKED, OBJECT_TYPES.BUTTON, { objectId: b, objectName: b, component: c, context: ctx }); }
    modalOpened(m, c) { this.log(VERBS.OPENED, OBJECT_TYPES.MODAL, { objectId: m, objectName: m, component: c }); }
    modalClosed(m, c) { this.log(VERBS.CLOSED, OBJECT_TYPES.MODAL, { objectId: m, objectName: m, component: c }); }
    drawerOpened(d) { this.log(VERBS.OPENED, OBJECT_TYPES.DRAWER, { objectId: d, objectName: d }); }
    drawerClosed(d) { this.log(VERBS.CLOSED, OBJECT_TYPES.DRAWER, { objectId: d, objectName: d }); }
    // Orders are written by the SERVER (orders-routes) — a client copy would
    // double-count. Result reads: object_type says lab vs radiology.
    resultViewed(id, name, result, c, objectType = OBJECT_TYPES.LAB_RESULT) { this.log(VERBS.VIEWED_RESULT, objectType, { objectId: String(id), objectName: name, result, component: c }); }
    resultReleased(id, name, c, { abnormal = false, objectType = OBJECT_TYPES.LAB_RESULT } = {}) { this.log(VERBS.RELEASED_RESULT, objectType, { objectId: String(id), objectName: name, component: c, context: { isAbnormal: abnormal, actor: 'system' }, severity: abnormal ? SEVERITY.IMPORTANT : SEVERITY.INFO }); }
    // Bare UI verbs: the object type carries the meaning (lab_test → investigating).
    searched(objectType, term, count, c, ctx = null) { this.log(VERBS.SEARCHED, objectType, { objectName: term, result: `${count} results`, component: c, context: ctx }); }
    filtered(objectType, filterId, value, c) { this.log(VERBS.FILTERED, objectType, { objectId: filterId, objectName: value, component: c }); }
    sorted(objectType, key, direction, c) { this.log(VERBS.SORTED, objectType, { objectId: key, objectName: key, result: direction, component: c }); }
    toggled(objectType, id, name, selected, c) { this.log(VERBS.TOGGLED, objectType, { objectId: id, objectName: name, result: selected ? 'selected' : 'deselected', component: c }); }
    messageSent(content, c, extra = {}) { this.log(VERBS.SENT_MESSAGE, OBJECT_TYPES.CHAT_MESSAGE, { component: c, messageContent: content, messageRole: 'user', ...extra }); }
    messageReceived(content, c, extra = {}) { this.log(VERBS.RECEIVED_MESSAGE, OBJECT_TYPES.CHAT_MESSAGE, { component: c, messageContent: content, messageRole: 'assistant', ...extra }); }
    messageCopied(c) { this.log(VERBS.COPIED_MESSAGE, OBJECT_TYPES.CHAT_MESSAGE, { component: c }); }
    sttResult({ finalLength = 0, interimLength = 0, isFinal = false, lang = null } = {}) {
        this.log(VERBS.RECOGNIZED_SPEECH, OBJECT_TYPES.SPEECH, {
            objectId: 'speech_recognition',
            objectName: 'Speech recognition result',
            component: 'VoiceService',
            context: { finalLength, interimLength, isFinal, lang },
        });
    }
    sttError(message, ctx = null) {
        this.log(VERBS.FAILED_SPEECH_RECOGNITION, OBJECT_TYPES.SPEECH, {
            objectId: 'speech_recognition',
            objectName: 'Speech recognition error',
            result: message || 'speech recognition error',
            component: 'VoiceService',
            context: ctx,
        });
    }
    ttsPlayed(ctx = null) {
        this.log(VERBS.PLAYED_TTS, OBJECT_TYPES.AUDIO, {
            objectId: 'tts_audio',
            objectName: 'TTS audio played',
            component: 'VoiceService',
            context: ctx,
        });
    }
    emotionExpressed(e, c) { this.log(VERBS.EXPRESSED_EMOTION, OBJECT_TYPES.EMOTION, { objectName: e, component: c, context: { emotion: e } }); }
    vitalAdjusted(v, oldV, newV, c, ctx = null) { this.log(VERBS.ADJUSTED_VITAL, OBJECT_TYPES.VITAL_SIGN, { objectId: v, objectName: v, component: c, result: String(newV), context: { oldValue: oldV, newValue: newV, ...(ctx || {}) } }); }
    alarmAcknowledged(t, c) { this.log(VERBS.ACKNOWLEDGED_ALARM, OBJECT_TYPES.ALARM, { objectId: t, objectName: t, component: c }); }
    alarmSilenced(t, c) { this.log(VERBS.SILENCED_ALARM, OBJECT_TYPES.ALARM, { objectId: t, objectName: t, component: c }); }
    settingChanged(name, oldV, newV, c) { this.log(VERBS.CHANGED_SETTING, OBJECT_TYPES.SETTING, { objectId: name, objectName: name, component: c, context: { oldValue: oldV, newValue: newV } }); }
    scenarioStarted(name, c) { this.log(VERBS.STARTED_SCENARIO, OBJECT_TYPES.SCENARIO, { objectName: name, component: c }); }
    scenarioPaused(name, c) { this.log(VERBS.PAUSED_SCENARIO, OBJECT_TYPES.SCENARIO, { objectName: name, component: c }); }
    scenarioResumed(name, c) { this.log(VERBS.RESUMED_SCENARIO, OBJECT_TYPES.SCENARIO, { objectName: name, component: c }); }
    scenarioCompleted(name, c, dur = null) { this.log(VERBS.COMPLETED_SCENARIO, OBJECT_TYPES.SCENARIO, { objectName: name, component: c, durationMs: dur }); }
    errorOccurred(t, msg, c, ctx = null) { this.log(VERBS.RAISED_ERROR, OBJECT_TYPES.COMPONENT, { objectId: t, objectName: t, result: msg, component: c, context: ctx, severity: SEVERITY.CRITICAL }); }
    apiError(ep, code, msg, c) { this.log(VERBS.FAILED_REQUEST, OBJECT_TYPES.ENDPOINT, { objectId: ep, objectName: `${code}: ${ep}`, result: msg, component: c, context: { endpoint: ep, statusCode: code }, severity: SEVERITY.CRITICAL }); }
    validationFailed(form, field, msg, c) { this.log(VERBS.FAILED_VALIDATION, OBJECT_TYPES.FORM, { objectId: form, objectName: field ? `${form}.${field}` : form, result: msg, component: c }); }
    // A bracketed panel visit: the open starts a timing mark, the close carries the dwell.
    panelOpened(objectType, id, name, c) { this.startTiming(`panel:${id}`); this.log(VERBS.OPENED, objectType, { objectId: id, objectName: name, component: c }); }
    panelClosed(objectType, id, name, c) { this.log(VERBS.CLOSED, objectType, { objectId: id, objectName: name, component: c, timingMark: `panel:${id}` }); }
    // Treatment / medication actions carry a real clinical object_type so the
    // activity resolver lands them in `treating` — NOT `component`, which the
    // clinical-state map overrides to `navigating` (the old bug that painted
    // every ordered drug as a UI navigation event).
    // One verb per treatment act; `objectType` says what kind (medication,
    // iv_fluid, oxygen_therapy, nursing_intervention, treatment). The registry
    // keeps a drug order CRITICAL by object type, so callers pass the kind
    // rather than picking a verb.
    treatmentOrdered(id, name, c, ctx = null, objectType = OBJECT_TYPES.TREATMENT, result = null) { this.log(VERBS.ORDERED_TREATMENT, objectType, { objectId: String(id), objectName: name, component: c, context: ctx, result }); }
    treatmentAdministered(id, name, c, ctx = null, objectType = OBJECT_TYPES.TREATMENT) { this.log(VERBS.ADMINISTERED_TREATMENT, objectType, { objectId: String(id), objectName: name, component: c, context: ctx }); }
    treatmentDiscontinued(id, name, c, reason = null, objectType = OBJECT_TYPES.TREATMENT) { this.log(VERBS.DISCONTINUED_TREATMENT, objectType, { objectId: String(id), objectName: name, component: c, context: { reason } }); }
    treatmentEffectObserved(id, name, phase, effects, c) { this.log(VERBS.OBSERVED_TREATMENT_EFFECT, OBJECT_TYPES.TREATMENT, { objectId: String(id), objectName: name, result: phase, component: c, context: { ...(effects || {}), actor: 'system' } }); }
    contraindicationFlagged(id, name, fb, c, objectType = OBJECT_TYPES.MEDICATION) { this.log(VERBS.FLAGGED_CONTRAINDICATION, objectType, { objectId: String(id), objectName: name, component: c, context: { feedback: fb } }); }
    expectedTreatmentMet(id, name, points, c) { this.log(VERBS.MET_EXPECTED_TREATMENT, OBJECT_TYPES.TREATMENT, { objectId: String(id), objectName: name, component: c, context: { points } }); }
    expectedTreatmentMissed(name, fb, c) { this.log(VERBS.MISSED_EXPECTED_TREATMENT, OBJECT_TYPES.TREATMENT, { objectName: name, component: c, context: { feedback: fb } }); }
    alarmTriggered(t, vital, value, threshold, c, ctx = null) { this.log(VERBS.TRIGGERED_ALARM, OBJECT_TYPES.ALARM, { objectId: t, objectName: `${vital} Alarm`, component: c, context: { vitalSign: vital, value, threshold, actor: 'system', ...(ctx || {}) } }); }
    // Reading the patient record. One verb; object_id names the tab, so
    // History/Meds/Notes/Memory all land in `assessing` and the fine lens
    // labels them from the tab id.
    recordViewed(tabId, label, c) { this.log(VERBS.VIEWED_RECORD, OBJECT_TYPES.PATIENT_RECORD, { objectId: tabId, objectName: label || tabId, component: c }); }
    // Debrief / discussant turns. object_type `debrief` resolves to
    // `reflecting`, keeping post-case discussion distinct from bedside chat.
    debriefMessageSent(content, c, extra = {}) { this.log(VERBS.SENT_MESSAGE, OBJECT_TYPES.DEBRIEF, { component: c, messageContent: content, messageRole: 'user', ...extra }); }
    debriefMessageReceived(content, c, extra = {}) { this.log(VERBS.RECEIVED_MESSAGE, OBJECT_TYPES.DEBRIEF, { component: c, messageContent: content, messageRole: 'assistant', ...extra }); }
    groupExpanded(g, c) { this.log(VERBS.EXPANDED, OBJECT_TYPES.COMPONENT, { objectId: g, objectName: g, component: c }); }
    groupCollapsed(g, c) { this.log(VERBS.COLLAPSED, OBJECT_TYPES.COMPONENT, { objectId: g, objectName: g, component: c }); }
    examPanelOpened() { this.startTiming('examPanel'); this.log(VERBS.OPENED_EXAM_PANEL, OBJECT_TYPES.PANEL, { objectId: 'manikin_panel', objectName: 'Physical Examination Panel', component: COMPONENTS.MANIKIN_PANEL }); }
    examPanelClosed() { this.log(VERBS.CLOSED_EXAM_PANEL, OBJECT_TYPES.PANEL, { objectId: 'manikin_panel', objectName: 'Physical Examination Panel', component: COMPONENTS.MANIKIN_PANEL, timingMark: 'examPanel' }); }
    physicalExamPerformed(region, type, finding, ctx = null) { this.log(VERBS.PERFORMED_PHYSICAL_EXAM, OBJECT_TYPES.PHYSICAL_EXAM, { objectId: `${region}:${type}`, objectName: `${type} - ${region}`, component: COMPONENTS.MANIKIN_PANEL, result: finding, context: ctx }); }
    auscultationPerformed(loc, type, finding, played = false, url = null) { this.log(VERBS.PERFORMED_PHYSICAL_EXAM, OBJECT_TYPES.PHYSICAL_EXAM, { objectId: `auscultation:${loc}`, objectName: `Auscultation - ${loc}`, component: COMPONENTS.AUSCULTATION_PANEL, result: finding, context: { soundType: type, audioPlayed: played, audioUrl: url } }); }

    // Consultation with a supporting agent (page → arrive → talk).
    agentPaged(agentType, name, c, ctx = null) { this.log(VERBS.PAGED_AGENT, OBJECT_TYPES.AGENT, { objectId: agentType, objectName: name, component: c, context: ctx }); }
    agentArrived(agentType, name, c, ctx = null) { this.log(VERBS.ARRIVED_AGENT, OBJECT_TYPES.AGENT, { objectId: agentType, objectName: name, component: c, context: { actor: 'system', ...(ctx || {}) } }); }
    agentMessageSent(agentType, name, content, c) { this.log(VERBS.SENT_MESSAGE, OBJECT_TYPES.AGENT_MESSAGE, { objectId: agentType, objectName: name, component: c, messageContent: content, messageRole: 'user' }); }
    agentMessageReceived(agentType, name, content, c) { this.log(VERBS.RECEIVED_MESSAGE, OBJECT_TYPES.AGENT_MESSAGE, { objectId: agentType, objectName: name, component: c, messageContent: content, messageRole: 'assistant' }); }
    // Documentation. The note TEXT is never logged — only its shape.
    noteSaved(id, name, mode, shape, c) { this.log(VERBS.SAVED_NOTE, OBJECT_TYPES.CLINICAL_NOTE, { objectId: id, objectName: name, result: mode, component: c, context: shape }); }
    debriefSubmitted(sessionId, ctx, c) { this.log(VERBS.SUBMITTED_DEBRIEF, OBJECT_TYPES.DEBRIEF, { objectId: String(sessionId), objectName: 'Debrief', component: c, context: ctx }); }
    // Scenario control.
    scenarioReset(name, c) { this.log(VERBS.RESET_SCENARIO, OBJECT_TYPES.SCENARIO, { objectName: name, component: c }); }
    scenarioStepJumped(scenarioId, index, label, ctx, c) { this.log(VERBS.JUMPED_SCENARIO_STEP, OBJECT_TYPES.SCENARIO, { objectId: `${scenarioId}:${index}`, objectName: label, component: c, context: ctx }); }
    trendViewed(vital, c) { this.startTiming(`trend:${vital}`); this.log(VERBS.VIEWED_TREND, OBJECT_TYPES.VITAL_TREND, { objectId: vital, objectName: vital, component: c }); }
    // Authored content (cases, catalogues, personas, presets…). `objectType`
    // names the kind; `result` created|updated for saves.
    contentSaved(objectType, id, name, c, result = 'updated') { this.log(VERBS.SAVED_CONTENT, objectType, { objectId: String(id), objectName: name, component: c, result }); }
    contentExported(objectType, id, name, c) { this.log(VERBS.EXPORTED_CONTENT, objectType, { objectId: String(id), objectName: name, component: c }); }
    contentImported(objectType, id, name, c) { this.log(VERBS.IMPORTED_CONTENT, objectType, { objectId: String(id), objectName: name, component: c }); }
    contentDuplicated(objectType, id, name, c) { this.log(VERBS.DUPLICATED_CONTENT, objectType, { objectId: String(id), objectName: name, component: c }); }
    contentDeleted(objectType, id, name, c) { this.log(VERBS.DELETED_CONTENT, objectType, { objectId: String(id), objectName: name, component: c }); }
    // Onboarding / help.
    tourStarted(tourId, c) { this.log(VERBS.STARTED_TOUR, OBJECT_TYPES.TOUR, { objectId: tourId, objectName: tourId, component: c }); }
    tourStepAdvanced(tourId, stepId, index, c) { this.log(VERBS.ADVANCED_TOUR_STEP, OBJECT_TYPES.TOUR, { objectId: `${tourId}:${stepId}`, objectName: stepId, component: c, context: { index } }); }
    tourEnded(tourId, result, c) { this.log(VERBS.ENDED_TOUR, OBJECT_TYPES.TOUR, { objectId: tourId, objectName: tourId, result, component: c }); }
    // Oyon consent / capture — metadata about consent, never a sample taken under it.
    consentRecorded(version, result, c) { this.log(VERBS.RECORDED_CONSENT, OBJECT_TYPES.CONSENT, { objectId: String(version), objectName: `Consent v${version}`, result, component: c }); }
    captureStarted(ctx, c) { this.log(VERBS.STARTED_CAPTURE, OBJECT_TYPES.CAPTURE_SESSION, { objectId: String(this.sessionId || ''), component: c, context: ctx }); }
    captureStopped(result, c) { this.log(VERBS.STOPPED_CAPTURE, OBJECT_TYPES.CAPTURE_SESSION, { objectId: String(this.sessionId || ''), result, component: c }); }
    // Assessment items.
    answered(objectType, id, name, result, ctx, c) { this.log(VERBS.ANSWERED, objectType, { objectId: id, objectName: name, result, component: c, context: ctx }); }
    submitted(objectType, id, name, ctx, c) { this.log(VERBS.SUBMITTED, objectType, { objectId: id, objectName: name, component: c, context: ctx }); }
}

const EventLogger = new EventLoggerService();

export function registerWindowLifecycleLogging(target = globalThis.window) {
    if (!target?.addEventListener) return () => {};
    const onBlur = () => EventLogger.focusLost();
    const onFocus = () => EventLogger.focusResumed();
    const onBeforeUnload = () => EventLogger.unload();
    target.addEventListener('blur', onBlur);
    target.addEventListener('focus', onFocus);
    target.addEventListener('beforeunload', onBeforeUnload);
    return () => {
        target.removeEventListener('blur', onBlur);
        target.removeEventListener('focus', onFocus);
        target.removeEventListener('beforeunload', onBeforeUnload);
    };
}

export default EventLogger;
