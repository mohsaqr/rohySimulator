import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { apiUrl } from '../config/api';
import { useNotifications } from '../notifications/useNotifications';
import { SOURCES, SEVERITY, AUDIO_PATTERNS } from '../notifications/types';

// Default thresholds — used until the backend config loads. Kept identical
// to the historical values so existing user expectations don't shift.
const DEFAULT_THRESHOLDS = {
    hr:    { low: 50, high: 120, enabled: true },
    spo2:  { low: 90, high: null, enabled: true },
    bpSys: { low: 90, high: 180, enabled: true },
    bpDia: { low: 50, high: 110, enabled: true },
    rr:    { low: 8,  high: 30,  enabled: true },
    temp:  { low: 36, high: 38.5, enabled: true },
    etco2: { low: 30, high: 50,  enabled: true },
};

// Choose severity per breach. Severe out-of-range = critical, edge =
// warning. The exact bands are deliberately conservative; admins can
// shift them per-vital later. Critical maps to URGENT audio pattern via
// the default-pattern table in the center.
function pickSeverity(vital, value) {
    if (vital === 'spo2' && value < 85) return SEVERITY.CRITICAL;
    if (vital === 'hr' && (value < 35 || value > 150)) return SEVERITY.CRITICAL;
    if (vital === 'bpSys' && (value < 70 || value > 200)) return SEVERITY.CRITICAL;
    if (vital === 'rr' && (value < 5 || value > 40)) return SEVERITY.CRITICAL;
    if (vital === 'temp' && (value < 34 || value > 40)) return SEVERITY.CRITICAL;
    return SEVERITY.WARNING;
}

// useAlarms is now a thin producer: every 2s it samples vitals, computes
// breaches, and reports them to the central NotificationCenter. Acknowledge,
// snooze, mute, history, audio, backend logging — all of that lives in the
// center now. This hook only owns "is this vital out of range?".
export const useAlarms = (vitals, sessionId) => {
    const { notify, resolve, ack, ackAll, snooze, snoozeAll, active, snoozed, prefs, setPrefs } = useNotifications();

    const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS);
    const [thresholdsLoaded, setThresholdsLoaded] = useState(false);
    const lastFireRef = useRef(new Map()); // alarmKey → ts of last *transition* fire
    const activeKeysRef = useRef(new Set()); // alarmKeys currently alive (for resolve detection)

    // Load user thresholds from backend; merge over defaults.
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const token = localStorage.getItem('token');
                const res = await fetch(apiUrl('/alarms/config/'), {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                });
                if (!res.ok) {
                    if (!cancelled) setThresholdsLoaded(true);
                    return;
                }
                const data = await res.json();
                if (cancelled) return;
                if (Array.isArray(data?.config) && data.config.length > 0) {
                    const next = { ...DEFAULT_THRESHOLDS };
                    data.config.forEach(cfg => {
                        next[cfg.vital_sign] = {
                            low: cfg.low_threshold,
                            high: cfg.high_threshold,
                            enabled: Boolean(cfg.enabled),
                        };
                    });
                    setThresholds(next);
                }
                setThresholdsLoaded(true);
            } catch {
                if (!cancelled) setThresholdsLoaded(true);
            }
        };
        load();
        return () => { cancelled = true; };
    }, []);

    // The check loop. Runs every 2s and on every vitals/threshold change.
    // Only fires notify() on *transitions* (normal→breach or breach→breach
    // after dedup window) and *resolve()*s on breach→normal — fixes the
    // legacy 5-second-spam logging behaviour.
    const check = useCallback(() => {
        if (!vitals || !thresholdsLoaded) return;
        const now = Date.now();
        const seen = new Set();

        Object.entries(vitals).forEach(([vital, value]) => {
            const t = thresholds[vital];
            if (!t || !t.enabled) return;

            const num = parseFloat(value);
            if (isNaN(num)) return;

            let breached = false;
            let kind = '';
            let bound = 0;
            if (t.low !== null && num < t.low)  { breached = true; kind = 'low';  bound = t.low; }
            if (t.high !== null && num > t.high) { breached = true; kind = 'high'; bound = t.high; }
            if (!breached) return;

            const key = `alarm:${vital}_${kind}`;
            seen.add(key);

            const severity = pickSeverity(vital, num);
            const audioPattern = severity === SEVERITY.CRITICAL ? AUDIO_PATTERNS.URGENT : AUDIO_PATTERNS.BEEP;

            // Only re-notify the center if this is a brand-new breach OR if it's
            // been long enough since the last fire that we want to refresh the
            // banner (5 minutes — matches typical clinical alarm refresh).
            const last = lastFireRef.current.get(key) || 0;
            const ageMs = now - last;
            const isFirstFire = !activeKeysRef.current.has(key);
            const isPeriodicRefresh = ageMs > 5 * 60 * 1000;
            if (isFirstFire || isPeriodicRefresh) {
                notify({
                    source: SOURCES.CLINICAL,
                    severity,
                    key,
                    title: `${vital.toUpperCase()} ${kind === 'low' ? 'low' : 'high'}`,
                    message: `${vital} = ${num} (limit ${kind === 'low' ? '≥' : '≤'} ${bound})`,
                    audioPattern,
                    requiresAck: true,
                    ttlMs: 0,
                    data: {
                        vital,
                        thresholdType: kind,
                        thresholdValue: bound,
                        actualValue: num,
                        sessionId, // BackendSurface uses this when posting to /alarms/log
                    },
                });
                lastFireRef.current.set(key, now);
                activeKeysRef.current.add(key);
            }
        });

        // Resolve any previously-active alarm whose condition cleared.
        for (const key of Array.from(activeKeysRef.current)) {
            if (!seen.has(key)) {
                resolve(key);
                activeKeysRef.current.delete(key);
                lastFireRef.current.delete(key);
            }
        }
    }, [vitals, thresholds, thresholdsLoaded, notify, resolve, sessionId]);

    useEffect(() => {
        check();
        const t = setInterval(check, 2000);
        return () => clearInterval(t);
    }, [check]);

    // Selectors that mirror the legacy hook's public shape so PatientMonitor's
    // alarm tab continues to render unchanged. activeAlarms is now derived
    // from the center's active list filtered to source=clinical.
    const activeAlarms = useMemo(() => {
        return active
            .filter(n => n.source === SOURCES.CLINICAL)
            .map(n => n.key.replace(/^alarm:/, ''));
    }, [active]);

    // Tick every 30s so the "Returns in N min" countdown updates without
    // calling Date.now() at render time (React purity rule). The center's
    // snoozed list only reports raw `until`, so we compute remaining here.
    const [nowTick, setNowTick] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNowTick(Date.now()), 30000);
        return () => clearInterval(t);
    }, []);

    const snoozedAlarms = useMemo(() => {
        return snoozed
            .filter(s => s.key.startsWith('alarm:'))
            .map(s => ({
                key: s.key.replace(/^alarm:/, ''),
                until: new Date(s.until).toISOString(),
                remaining: Math.max(0, Math.ceil((s.until - nowTick) / 60000)),
            }));
    }, [snoozed, nowTick]);

    const alarmHistory = useMemo(() => {
        // Keep this simple — the full notification history is available via
        // useNotifications().history; this projection is for the alarm tab.
        return [];
    }, []);

    // Save thresholds to backend (per-vital).
    const saveConfig = useCallback(async (userId = null) => {
        try {
            const token = localStorage.getItem('token');
            await Promise.all(Object.entries(thresholds).map(([vital, cfg]) =>
                fetch(apiUrl('/alarms/config'), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({
                        user_id: userId,
                        vital_sign: vital,
                        high_threshold: cfg.high,
                        low_threshold: cfg.low,
                        enabled: cfg.enabled,
                    }),
                })
            ));
        } catch (e) {
            console.error('Failed to save alarm config:', e);
        }
    }, [thresholds]);

    const updateThreshold = useCallback((vital, low, high, enabled) => {
        setThresholds(prev => ({ ...prev, [vital]: { low, high, enabled } }));
    }, []);

    return {
        thresholds,
        setThresholds,
        activeAlarms,
        alarmHistory,
        snoozedAlarms,
        // Mute mirrors the audio surface mute pref now (persisted by the center).
        isMuted: prefs.audioMuted,
        setIsMuted: (val) => setPrefs({ audioMuted: typeof val === 'function' ? val(prefs.audioMuted) : val }),
        snoozeDuration: prefs.snoozeDuration,
        setSnoozeDuration: (mins) => setPrefs({ snoozeDuration: mins }),
        // Lifecycle actions delegate to the center so they affect every surface.
        acknowledgeAlarm: (alarmKey) => ack(`alarm:${alarmKey}`),
        acknowledgeAll: () => ackAll(),
        snoozeAlarm: (alarmKey, mins) => snooze(`alarm:${alarmKey}`, mins),
        snoozeAll: (mins) => snoozeAll(mins),
        updateThreshold,
        saveConfig,
        resetToDefaults: () => setThresholds(DEFAULT_THRESHOLDS),
    };
};
