import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ApiError, apiFetch, apiPost } from '../services/apiClient';
import { useNotifications } from '../notifications/useNotifications';
import { SOURCES, SEVERITY, AUDIO_PATTERNS } from '../notifications/types';
import EventLogger, { COMPONENTS } from '../services/eventLogger';

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
// `enabled: false` stops the hook producing anything: an ended case's monitor
// is frozen and End & Debrief has already acknowledged every alarm, so a
// breach sampled after that point is not a clinical event (QA 2026-10-04,
// PRV-28 — a remount after the end raised a live CRITICAL alarm beside a
// frozen monitor showing normal values).
export const useAlarms = (vitals, sessionId, { enabled = true } = {}) => {
    const { notify, resolve, ack, ackAll, snooze, snoozeAll, active, snoozed, acked, prefs, setPrefs } = useNotifications();

    const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS);
    const [thresholdsLoaded, setThresholdsLoaded] = useState(false);
    const lastFireRef = useRef(new Map()); // alarmKey → ts of last *transition* fire
    const activeKeysRef = useRef(new Set()); // alarmKeys currently alive (for resolve detection)
    const lastInputRef = useRef(new Map()); // alarmKey → the notify() input of its last fire
    // Keys restored from storage at mount that have not yet been checked
    // against the center (see the re-assert pass in check()). Only restored
    // keys qualify, each at most once: a key fired during THIS mount was
    // handed to the center by this mount, so its absence there means the
    // learner or the center removed it, not that a page was lost.
    const pendingReassertRef = useRef(new Set());
    // The center's live alarm keys, read by check() without making `active`
    // a dependency of the 2 s loop.
    const centerKeysRef = useRef(new Set());
    const snoozedKeysRef = useRef(new Set());

    // The hook unmounts with PatientMonitor on every room switch. Without
    // persistence the refs above reset, every still-breaching vital counts
    // as a "first fire" again, and the alarm audio replays each time the
    // learner returns to the patient room. Fire-state is parked per session
    // in sessionStorage (per-tab, gone when the tab closes) and restored on
    // mount so only genuinely new breaches fire.
    const fireStateKey = sessionId != null ? `rohy_alarm_fire_state:${sessionId}` : null;
    useEffect(() => {
        // Restore this session's fire-state — or RESET when there is none.
        // Without the reset branch, switching sessions inside a mounted
        // component carried the previous session's fired-keys forward, and
        // an identical breach in the new session was silently suppressed
        // for up to the 5-minute refresh window.
        let restored = false;
        if (fireStateKey) {
            try {
                const raw = sessionStorage.getItem(fireStateKey);
                if (raw) {
                    const { keys, fires, inputs } = JSON.parse(raw);
                    activeKeysRef.current = new Set(Array.isArray(keys) ? keys : []);
                    lastFireRef.current = new Map(Array.isArray(fires) ? fires : []);
                    lastInputRef.current = new Map(Array.isArray(inputs) ? inputs : []);
                    restored = true;
                }
            } catch { /* corrupt entry — fall back to fresh state */ }
        }
        if (!restored) {
            activeKeysRef.current = new Set();
            lastFireRef.current = new Map();
            lastInputRef.current = new Map();
        }
        pendingReassertRef.current = new Set(activeKeysRef.current);
    }, [fireStateKey]);
    const persistFireState = useCallback(() => {
        if (!fireStateKey) return;
        try {
            sessionStorage.setItem(fireStateKey, JSON.stringify({
                keys: Array.from(activeKeysRef.current),
                fires: Array.from(lastFireRef.current.entries()),
                inputs: Array.from(lastInputRef.current.entries()),
            }));
        } catch { /* storage blocked — worst case is one re-fire after remount */ }
    }, [fireStateKey]);

    // Load user thresholds from backend; merge over defaults.
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const data = await apiFetch('/alarms/config');
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
            } catch (err) {
                if (cancelled) return;
                if (!(err instanceof ApiError)) {
                    console.warn('[useAlarms] threshold load failed:', err.message);
                }
                setThresholdsLoaded(true);
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
        if (!enabled || !vitals || !thresholdsLoaded) return;
        const now = Date.now();
        const seen = new Set();
        const breachInputs = new Map(); // alarmKey → notify() input for this sample
        const firedNow = new Set();
        let fireStateDirty = false;

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
            const input = {
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
            };
            breachInputs.set(key, input);
            if (isFirstFire || isPeriodicRefresh) {
                notify(input);
                lastInputRef.current.set(key, input);
                firedNow.add(key);
                // The FIRING is a learning event too — with the room and the
                // vitals snapshot EventLogger stamps — not only an alarm_events
                // row. TRIGGERED_ALARM had no producer before this line.
                EventLogger.alarmTriggered(
                    `${vital}_${kind}`, vital, num, bound, COMPONENTS.PATIENT_MONITOR,
                    { refresh: !isFirstFire, thresholdType: kind },
                );
                lastFireRef.current.set(key, now);
                activeKeysRef.current.add(key);
                fireStateDirty = true;
            }
        });

        // Latching behavior: a fired alarm stays in the center's `active`
        // list until the clinician acks, even after the vital recovers.
        // This matches real bedside-monitor convention — a brief transient
        // (HR=121 for one sample then back to 100) is information the user
        // needs to see, not noise to hide. Without this, the alarm flashed
        // up and vanished within 2 seconds, leaving the clinician unsure
        // whether they imagined it.
        //
        // We only call resolve() once the user has acked AND the vital has
        // recovered — that combination clears the acked state in the center
        // so the next breach can re-arm the alarm cleanly.
        const ackedSet = new Set(acked);

        // Re-assert what the center lost (QA 2026-10-04, PRV-28). The fire-
        // state above survives a reload (sessionStorage), but the center's
        // `active` list is memory only — so after a reload every alarm that
        // was still sounding counted as "already fired" and the learner got
        // no banner, no bell count and no audio until the 5-minute refresh,
        // while the vital sat below its limit. An alarm this hook still
        // holds live, that the center no longer shows and the learner has
        // neither acked nor snoozed, is put back — with the current reading
        // if the vital is still out of range, or the reading it latched at.
        // A room switch keeps the center (it lives above the rooms), so this
        // never fires there. The re-asserted alarm logs a fresh
        // alarm_events row, as the 5-minute refresh does: the row id that
        // an ack would have stamped was lost with the page.
        for (const key of Array.from(pendingReassertRef.current)) {
            pendingReassertRef.current.delete(key);
            if (firedNow.has(key) || !activeKeysRef.current.has(key)) continue;
            if (centerKeysRef.current.has(key) || ackedSet.has(key) || snoozedKeysRef.current.has(key)) continue;
            const input = breachInputs.get(key) ?? lastInputRef.current.get(key);
            if (!input) {
                // Fire-state written before inputs were kept, for a vital
                // that has since recovered: nothing faithful to show. Forget
                // it so its next breach fires fresh.
                activeKeysRef.current.delete(key);
                lastFireRef.current.delete(key);
                fireStateDirty = true;
                continue;
            }
            notify(input);
        }

        for (const key of Array.from(activeKeysRef.current)) {
            if (seen.has(key)) continue;
            if (!ackedSet.has(key)) continue; // latched, waiting for ack
            resolve(key);
            activeKeysRef.current.delete(key);
            lastFireRef.current.delete(key);
            lastInputRef.current.delete(key);
            fireStateDirty = true;
        }
        if (fireStateDirty) persistFireState();
    }, [enabled, vitals, thresholds, thresholdsLoaded, notify, resolve, sessionId, acked, persistFireState]);

    // Mirrors for check()'s re-assert pass. Declared BEFORE the loop effect
    // so, on mount, the center's state is in the refs when check() first runs.
    useEffect(() => {
        centerKeysRef.current = new Set(active.map(n => n.key));
    }, [active]);
    useEffect(() => {
        snoozedKeysRef.current = new Set(snoozed.map(s => s.key));
    }, [snoozed]);

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

    // Vitals that are still out of range BUT have been silenced via ack.
    // Without this list, an acked alarm vanishes from the UI entirely while
    // the underlying vital may remain critically abnormal — the only signal
    // is the live vital number itself. Surfacing them as a small pill in the
    // alarm tab keeps the clinician aware of what's currently silenced.
    const silencedAlarms = useMemo(() => {
        if (!vitals) return [];
        const ackedSet = new Set(acked);
        const out = [];
        Object.entries(vitals).forEach(([vital, value]) => {
            const t = thresholds[vital];
            if (!t || !t.enabled) return;
            const num = parseFloat(value);
            if (isNaN(num)) return;
            let kind = '';
            let bound = 0;
            if (t.low !== null && num < t.low)  { kind = 'low';  bound = t.low; }
            else if (t.high !== null && num > t.high) { kind = 'high'; bound = t.high; }
            else return;
            const fullKey = `alarm:${vital}_${kind}`;
            if (!ackedSet.has(fullKey)) return;
            out.push({
                key: `${vital}_${kind}`,
                vital,
                value: num,
                threshold: bound,
                kind,
            });
        });
        return out;
    }, [vitals, thresholds, acked]);

    // Save thresholds to backend (per-vital).
    const saveConfig = useCallback(async (userId = null) => {
        try {
            await Promise.all(Object.entries(thresholds).map(([vital, cfg]) =>
                apiPost('/alarms/config', {
                    user_id: userId,
                    vital_sign: vital,
                    high_threshold: cfg.high,
                    low_threshold: cfg.low,
                    enabled: cfg.enabled,
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
        snoozedAlarms,
        silencedAlarms,
        // Convenience: clear ack on a key so the alarm can re-fire even if
        // the vital hasn't crossed back through normal yet (clinician
        // changed their mind after acking).
        unsilenceAlarm: (alarmKey) => resolve(`alarm:${alarmKey}`),
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
