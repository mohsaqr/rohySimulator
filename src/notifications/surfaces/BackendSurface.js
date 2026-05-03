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

export default function BackendSurface({ sessionId, userId, caseId }) {
    const { subscribe, prefs } = useNotifications();
    const queueRef = useRef([]);
    const flushTimerRef = useRef(null);

    const flush = useCallback((immediate = false) => {
        if (queueRef.current.length === 0) return;
        const batch = queueRef.current;
        queueRef.current = [];

        const clinical = batch.filter(n => n.source === SOURCES.CLINICAL);
        const telemetry = batch.filter(n => n.source !== SOURCES.CLINICAL);

        if (clinical.length > 0) sendClinical(clinical);
        if (telemetry.length > 0) sendTelemetry(telemetry, immediate);
    }, []);

    useEffect(() => {
        const unsub = subscribe((evt) => {
            if (evt.type !== 'notify') return;
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

async function sendClinical(events) {
    const token = AuthService.getToken();
    if (!token) return;
    // /api/alarms/log accepts one event per call. Fire them in parallel.
    await Promise.all(events.map(n => {
        const body = {
            session_id: n.sessionId || null,
            vital_sign: n.data?.vital || n.key,
            threshold_type: n.data?.thresholdType || null,
            threshold_value: n.data?.thresholdValue ?? null,
            actual_value: n.data?.actualValue ?? null,
        };
        return fetch(apiUrl('/alarms/log'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        }).catch(() => { /* network error — drop, do not requeue */ });
    }));
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
