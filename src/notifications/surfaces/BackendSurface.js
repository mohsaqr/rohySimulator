import { useCallback, useEffect, useRef } from 'react';
import { useNotifications } from '../useNotifications';
import { SURFACES, SOURCES } from '../types';
import { AuthService } from '../../services/authService';
import { apiPost, apiPut } from '../../services/apiClient';
import { apiUrl } from '../../config/api';

// Backend surface batches notifications and POSTs them. Two endpoints today:
//  - clinical alarms → /api/alarms/log (one row per fire transition)
//  - telemetry events → /api/learning-events/batch (batched xAPI events)
// Notifications routed to BACKEND surface land here; everything else is
// already filtered out by the routing layer.
//
// Re-queue on failure is bounded so a backend outage can't grow the queue
// without limit (fixes the unbounded re-queue in the legacy EventLogger).
const MAX_QUEUE = 500;

// Track the most recent alarm_event id per notification key so that an
// `ack` event from the center can mark the corresponding row's
// acknowledged_at server-side. The map shape is { key → lastInsertedId }.
// Periodic re-fires (5-min refresh in useAlarms) overwrite the entry so
// the most recent fire is the one stamped acknowledged — matching the
// clinical truth that the user acked at *this* moment, not earlier fires
// that were still active when the user finally noticed.
//
// pendingAcksRef holds keys that were acked before /alarms/log returned —
// once the id arrives, we fire the PUT immediately.

export default function BackendSurface({ sessionId, userId, caseId }) {
    const { subscribe, prefs } = useNotifications();
    const queueRef = useRef([]);
    const flushTimerRef = useRef(null);
    const keyToAlarmIdRef = useRef(new Map());
    const pendingAcksRef = useRef(new Set());

    const flush = useCallback((immediate = false) => {
        if (queueRef.current.length === 0) return;
        const batch = queueRef.current;
        queueRef.current = [];

        const clinical = batch.filter(n => n.source === SOURCES.CLINICAL);
        const telemetry = batch.filter(n => n.source !== SOURCES.CLINICAL);

        if (clinical.length > 0) sendClinical(clinical, keyToAlarmIdRef.current, pendingAcksRef.current);
        if (telemetry.length > 0) sendTelemetry(telemetry, immediate);
    }, []);

    useEffect(() => {
        const unsub = subscribe((evt) => {
            if (evt.type === 'notify') {
                const n = evt.notification;
                if (!n.routedSurfaces?.includes(SURFACES.BACKEND)) return;
                queueRef.current.push({
                    ...n,
                    sessionId: n.data?.sessionId ?? sessionId,
                    userId,
                    caseId,
                    queuedAt: Date.now(),
                });
                if (queueRef.current.length > MAX_QUEUE) {
                    queueRef.current.splice(0, queueRef.current.length - MAX_QUEUE);
                }
                // Session-end events drain the queue immediately so logout /
                // close-without-page-nav doesn't lose the ENDED_SESSION row.
                // Without this, the queue waits for the periodic interval and
                // can be discarded if the surface unmounts first (e.g. auth
                // state change re-keys NotificationProvider).
                if (n.data?.verb === 'ENDED_SESSION') {
                    flush(true);
                    return;
                }

                if (queueRef.current.length >= prefs.telemetryBatchSize) {
                    flush();
                }
                return;
            }

            if (evt.type === 'ack') {
                // Stamp acknowledged_at server-side for the most recent row of
                // this key. If the POST hasn't returned yet, queue and retry
                // when sendClinical fires the keyToAlarmIdRef set.
                const id = keyToAlarmIdRef.current.get(evt.key);
                if (id != null) {
                    sendAck(id);
                } else {
                    pendingAcksRef.current.add(evt.key);
                }
                return;
            }

            if (evt.type === 'resolve') {
                // Vital normalised — the next breach is a new event, so drop
                // the stale id mapping (otherwise an ack on the next breach
                // would stamp the previous breach's row).
                keyToAlarmIdRef.current.delete(evt.key);
                pendingAcksRef.current.delete(evt.key);
                return;
            }
        });
        return unsub;
    }, [subscribe, sessionId, userId, caseId, prefs.telemetryBatchSize, flush]);

    // Periodic flush.
    useEffect(() => {
        flushTimerRef.current = setInterval(() => {
            if (queueRef.current.length > 0) flush();
        }, prefs.telemetryFlushIntervalMs);
        return () => {
            clearInterval(flushTimerRef.current);
            flushTimerRef.current = null;
            // Drain on unmount — auth state changes (logout) re-key the
            // NotificationProvider, unmounting this surface before the
            // periodic timer fires. Without this, the last batch is lost.
            if (queueRef.current.length > 0) flush(true);
        };
    }, [prefs.telemetryFlushIntervalMs, flush]);

    // Flush on hide / unload — sendBeacon for telemetry, fire-and-forget POST
    // for clinical (since beacon doesn't carry auth headers reliably).
    useEffect(() => {
        const flushOnHide = () => flush(true);
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') flushOnHide();
        };
        window.addEventListener('beforeunload', flushOnHide);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.removeEventListener('beforeunload', flushOnHide);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [flush]);

    return null;
}

// Audit #20: backend persistence is best-effort; the audit asked for
// failure-to-log clinical alarms to be observable. We keep a small,
// bounded telemetry record (counters + last-N failures with vital +
// reason) that the diagnostic bar / ops dashboards can read. Failures
// still don't surface in the clinical UI — that would create a second
// alarm noise channel — but they're now visible in diagnostics so a
// systematic outage shows up as "alarm log: 247 failures since boot"
// rather than appearing nowhere.

const _backendTelemetry = {
    alarmLogFailures: 0,
    alarmAckFailures: 0,
    telemetryFailures: 0,
    recentFailures: [],   // ring buffer of { kind, at, vital, reason }
};
const RECENT_FAILURES_CAP = 20;

function recordFailure(kind, detail) {
    if (kind === 'alarm-log') _backendTelemetry.alarmLogFailures++;
    else if (kind === 'alarm-ack') _backendTelemetry.alarmAckFailures++;
    else if (kind === 'telemetry') _backendTelemetry.telemetryFailures++;
    _backendTelemetry.recentFailures.push({ kind, at: Date.now(), ...detail });
    if (_backendTelemetry.recentFailures.length > RECENT_FAILURES_CAP) {
        _backendTelemetry.recentFailures.shift();
    }
    if (typeof window !== 'undefined') {
        try { window.dispatchEvent(new CustomEvent('rohy:backend-telemetry')); }
        catch { /* CustomEvent may be polyfilled; ignore */ }
    }
}

export function getBackendTelemetry() {
    return {
        alarmLogFailures: _backendTelemetry.alarmLogFailures,
        alarmAckFailures: _backendTelemetry.alarmAckFailures,
        telemetryFailures: _backendTelemetry.telemetryFailures,
        recentFailures: [..._backendTelemetry.recentFailures],
    };
}

// Test-only — drops the in-memory state so a fresh test starts at zero.
export function _resetBackendTelemetryForTest() {
    _backendTelemetry.alarmLogFailures = 0;
    _backendTelemetry.alarmAckFailures = 0;
    _backendTelemetry.telemetryFailures = 0;
    _backendTelemetry.recentFailures.length = 0;
}

async function sendClinical(events, keyToAlarmId, pendingAcks) {
    if (!AuthService.getToken()) return;
    // /api/alarms/log accepts one event per call. Fire them in parallel.
    await Promise.all(events.map(async (n) => {
        const body = {
            session_id: n.sessionId || null,
            vital_sign: n.data?.vital || n.key,
            threshold_type: n.data?.thresholdType || null,
            threshold_value: n.data?.thresholdValue ?? null,
            actual_value: n.data?.actualValue ?? null,
        };
        try {
            const data = await apiPost('/alarms/log', body);
            const id = data?.id;
            if (id == null) return;
            keyToAlarmId.set(n.key, id);
            // If the user acked before the POST returned, fire the PUT now.
            if (pendingAcks.has(n.key)) {
                pendingAcks.delete(n.key);
                sendAck(id);
            }
        } catch (err) {
            recordFailure('alarm-log', {
                vital: body.vital_sign,
                reason: err?.message || 'network error',
                status: err?.status || 0,
            });
        }
    }));
}

function sendAck(alarmEventId) {
    if (!AuthService.getToken()) return;
    apiPut(`/alarms/${alarmEventId}/acknowledge`).catch((err) => {
        recordFailure('alarm-ack', {
            alarmEventId,
            reason: err?.message || 'network error',
            status: err?.status || 0,
        });
    });
}

// learning_events.severity is constrained to DEBUG/INFO/ACTION/IMPORTANT/CRITICAL.
// NotificationCenter uses lowercase debug/info/success/warning/error/critical.
// Map them so a fresh-CREATE'd schema (CHECK enforced) doesn't reject the row.
const NOTIFY_TO_XAPI_SEVERITY = {
    debug:    'DEBUG',
    info:     'INFO',
    success:  'INFO',
    warning:  'IMPORTANT',
    error:    'IMPORTANT',
    critical: 'CRITICAL',
};

// Map notification source/severity to a verb that lives in LEARNING_VERBS
// on the server. Producers that pass `data.verb` always win (EventLogger sets
// these correctly already); this default only fires for un-typed notifications.
function defaultVerbFor(n) {
    if (n.severity === 'critical' || n.severity === 'error') return 'ERROR_OCCURRED';
    if (n.severity === 'warning') return 'VIEWED'; // generic non-clinical surface event
    return 'VIEWED';
}


function sendTelemetry(events, immediate) {
    // Trinity (user_id, case_id) is server-derived from session_id —
    // we deliberately do not send them. The server reads the sessions
    // row and ignores any client values. See PLAN_LOGGING.md Phase 1.
    const payload = {
        events: events.map(n => {
            const v = n.data?.vitals || null;
            return {
                timestamp: new Date(n.createdAt).toISOString(),
                session_id: n.sessionId || null,
                verb: n.data?.verb || defaultVerbFor(n),
                object_type: n.data?.objectType || 'notification',
                severity: NOTIFY_TO_XAPI_SEVERITY[n.severity] || 'INFO',
                category: n.data?.category || 'NAVIGATION',
                object_id: n.data?.objectId || null,
                object_name: n.data?.objectName || n.title || null,
                component: n.data?.component || null,
                parent_component: n.data?.parentComponent || null,
                result: n.data?.result || n.message || null,
                duration_ms: n.data?.durationMs || null,
                context: n.data?.context || null,
                // Active in-session room (chat | examination | lab |
                // radiology | consultant). Server persists into the
                // dedicated learning_events.room column (migration
                // 0021). Null when no room is active (settings,
                // persona editor, pre-login).
                room: n.data?.room || null,
                message_content: n.data?.messageContent || null,
                message_role: n.data?.messageRole || null,
                // Wide vitals snapshot — null when no monitor has reported
                // (pre-session events, bare API users).
                vital_hr:     v?.hr     ?? null,
                vital_spo2:   v?.spo2   ?? null,
                vital_bp_sys: v?.bp_sys ?? null,
                vital_bp_dia: v?.bp_dia ?? null,
                vital_rr:     v?.rr     ?? null,
                vital_temp:   v?.temp   ?? null,
                vital_etco2:  v?.etco2  ?? null,
                vital_rhythm: v?.rhythm ?? null,
            };
        }),
    };

    if (immediate && navigator.sendBeacon) {
        // sendBeacon doesn't carry custom headers reliably; the route
        // accepts beacon traffic without auth specifically for unload paths.
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        const queued = navigator.sendBeacon(apiUrl('/learning-events/batch'), blob);
        if (queued) return;
        // sendBeacon returns false when the user-agent's queue is full or
        // the payload exceeds the implementation cap (~64KB per spec).
        // Fall back to a keepalive fetch so the last batch on
        // logout/unload isn't dropped silently. Codex round-3 finding 3.
        try {
            fetch(apiUrl('/learning-events/batch'), {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
                keepalive: true,
                credentials: 'include',
            }).catch(() => { /* best-effort */ });
        } catch { /* no-op */ }
        return;
    }

    apiPost('/learning-events/batch', payload).then((resp) => {
        if (resp && resp.dropped > 0) {
            // Surface drops so misconfigured tabs / replay bugs are not silent.
             
            console.warn('[telemetry] server dropped events', resp.dropped_reasons || {});
        }
    }).catch((err) => {
        recordFailure('telemetry', {
            count: events.length,
            reason: err?.message || 'network error',
            status: err?.status || 0,
        });
    });
}
