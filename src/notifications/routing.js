import { SOURCES, SEVERITY, SURFACES, severityRank, normalizeSource } from './types';
import { DEFAULT_ROUTING } from './defaults';

// Route a notification through the user's prefs + transient state (snooze, ack)
// to a final list of surfaces. Returns [] if the notification is fully suppressed.
//
// Mute hierarchy (in order):
//  1. acked key → suppress until producer calls resolve(key). User-explicit
//     and key-specific, so it always wins, even for clinical critical (the
//     clinician saw the alarm and chose to silence it; we trust them).
//  2. snoozed key → same: explicit, key-specific, expires automatically.
//  3. global DND / paused → blanket rule; clinical critical still escapes.
//  4. severity below minSeverity → blanket; clinical critical escapes.
//  5. source in mutedSources → blanket; clinical critical escapes.
//  6. apply per-surface mutes (audioMuted, bannerMuted, consoleMuted).
//
// BACKEND is the one surface the blanket mutes (3-5) do NOT strip. It is not
// something the user sees or hears — it is persistence (learning events /
// alarm log), and "be quieter" is not "stop recording what I did". Before
// this split, the minSeverity gate at step 4 ran BEFORE the routing matrix
// was ever consulted, so with the default minSeverity of INFO every DEBUG
// telemetry verb (NAVIGATED, CLICKED, SWITCHED_TAB, …) was dropped and the
// `telemetry/debug → [BACKEND]` row in defaults.js was dead code — the whole
// navigation layer was missing from the TNA analyses.
// Steps 1-2 (ack / snooze) still suppress everything: they are explicit,
// key-specific user actions on one alarm, not a global volume setting.
export function routeNotification(notification, prefs, transient) {
    const { source, severity, key } = notification;
    const isCriticalClinical = source === SOURCES.CLINICAL && severity === SEVERITY.CRITICAL;

    // Base surface list: the producer's explicit list wins, else the matrix.
    // Computed up front so the blanket mutes below can still return the
    // persistence surface after stripping every user-facing one.
    const explicit = notification.surfaces;
    const matrixSource = normalizeSource(source);
    const fromMatrix = DEFAULT_ROUTING[`${matrixSource}/${severity}`] || [];
    let surfaces = explicit && explicit.length > 0 ? [...explicit] : [...fromMatrix];
    const persistedOnly = surfaces.includes(SURFACES.BACKEND) ? [SURFACES.BACKEND] : [];

    // Acked: explicit user action on this exact key. Honor it regardless of
    // severity — if the clinician acks a critical alarm, they have seen it
    // and the producer will re-fire only when the vital recovers and breaches
    // again (resolve() is called by useAlarms when the value normalises).
    // "Stop shouting at me" is not "stop recording": an acked alarm that
    // re-fires five minutes later is a clinical fact the record must hold.
    // Persistence survives ack and snooze exactly as it survives DND, the
    // threshold and the source mutes below.
    if (transient.acked.has(key)) {
        return persistedOnly;
    }

    // Snoozed: user-initiated suppression with explicit expiry. Same logic
    // as ack — explicit + bounded, so even critical clinical respects it.
    const snoozeUntil = transient.snoozed.get(key);
    if (snoozeUntil && Date.now() < snoozeUntil) {
        return persistedOnly;
    }

    // Blanket rules below — clinical critical bypasses these so a user who
    // turned on DND or muted the clinical source still gets paged on a
    // life-threatening vital. Everything else falls back to persistence only.

    // DND / paused.
    const now = Date.now();
    const isPaused = prefs.dnd || (prefs.pausedUntil && now < prefs.pausedUntil);
    if (isPaused && !isCriticalClinical) {
        return persistedOnly;
    }

    // Severity threshold.
    if (severityRank(severity) < severityRank(prefs.minSeverity) && !isCriticalClinical) {
        return persistedOnly;
    }

    // Source mute.
    if (prefs.mutedSources.includes(matrixSource) && !isCriticalClinical) {
        return persistedOnly;
    }

    // Strip muted surfaces.
    if (prefs.audioMuted) surfaces = surfaces.filter(s => s !== SURFACES.AUDIO);
    if (prefs.bannerMuted) surfaces = surfaces.filter(s => s !== SURFACES.BANNER);
    if (prefs.consoleMuted) surfaces = surfaces.filter(s => s !== SURFACES.CONSOLE);

    return surfaces;
}

// Produce a stable dedup/transient key from a notification. Caller can
// supply `key` explicitly; otherwise we derive one from source + a hash
// of the message so identical messages coalesce.
export function deriveKey(notification) {
    if (notification.key) return notification.key;
    const msg = notification.message || notification.title || '';
    return `${notification.source}:${hashString(msg)}`;
}

function hashString(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h) ^ str.charCodeAt(i);
    }
    // 32-bit unsigned hex; short enough to read in logs
    return (h >>> 0).toString(36);
}
