import { useCallback, useEffect, useRef } from 'react';
import { useNotifications } from '../useNotifications';
import { SURFACES, SOURCES } from '../types';
import { AuthService } from '../../services/authService';
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

async function sendClinical(events, keyToAlarmId, pendingAcks) {
    const token = AuthService.getToken();
    if (!token) return;
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
            const res = await fetch(apiUrl('/alarms/log'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });
            if (!res.ok) return;
            const data = await res.json().catch(() => null);
            const id = data?.id;
            if (id == null) return;
            keyToAlarmId.set(n.key, id);
            // If the user acked before the POST returned, fire the PUT now.
            if (pendingAcks.has(n.key)) {
                pendingAcks.delete(n.key);
                sendAck(id);
            }
        } catch {
            // Network error — drop. Do not re-queue (bounded behavior).
        }
    }));
}

function sendAck(alarmEventId) {
    const token = AuthService.getToken();
    if (!token) return;
    fetch(apiUrl(`/alarms/${alarmEventId}/acknowledge`), {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
    }).catch(() => { /* drop; ack stamp is best-effort audit */ });
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
    const token = AuthService.getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const payload = {
        events: events.map(n => ({
            timestamp: new Date(n.createdAt).toISOString(),
            session_id: n.sessionId || null,
            user_id: n.userId || null,
            case_id: n.caseId || null,
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
            message_content: n.data?.messageContent || null,
            message_role: n.data?.messageRole || null,
        })),
    };

    if (immediate && navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon(apiUrl('/learning-events/batch'), blob);
        return;
    }

    fetch(apiUrl('/learning-events/batch'), {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    }).catch(() => { /* drop; loss is acceptable for telemetry */ });
}
