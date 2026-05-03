import { SOURCES, SEVERITY, SURFACES, severityRank } from './types';
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
export function routeNotification(notification, prefs, transient) {
    const { source, severity, key } = notification;
    const isCriticalClinical = source === SOURCES.CLINICAL && severity === SEVERITY.CRITICAL;

    // Acked: explicit user action on this exact key. Honor it regardless of
    // severity — if the clinician acks a critical alarm, they have seen it
    // and the producer will re-fire only when the vital recovers and breaches
    // again (resolve() is called by useAlarms when the value normalises).
    if (transient.acked.has(key)) {
        return [];
    }

    // Snoozed: user-initiated suppression with explicit expiry. Same logic
    // as ack — explicit + bounded, so even critical clinical respects it.
    const snoozeUntil = transient.snoozed.get(key);
    if (snoozeUntil && Date.now() < snoozeUntil) {
        return [];
    }

    // Blanket rules below — clinical critical bypasses these so a user who
    // turned on DND or muted the clinical source still gets paged on a
    // life-threatening vital.

    // DND / paused.
    const now = Date.now();
    const isPaused = prefs.dnd || (prefs.pausedUntil && now < prefs.pausedUntil);
    if (isPaused && !isCriticalClinical) {
        return [];
    }

    // Severity threshold.
    if (severityRank(severity) < severityRank(prefs.minSeverity) && !isCriticalClinical) {
        return [];
    }

    // Source mute.
    if (prefs.mutedSources.includes(source) && !isCriticalClinical) {
        return [];
    }

    // Compute base surface list.
    const explicit = notification.surfaces;
    const fromMatrix = DEFAULT_ROUTING[`${source}/${severity}`] || [];
    let surfaces = explicit && explicit.length > 0 ? [...explicit] : [...fromMatrix];

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
