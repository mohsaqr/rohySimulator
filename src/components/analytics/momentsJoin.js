// momentsJoin — the pure "clinical moment" join.
//
// A clinical moment is a learning_events row enriched with the emotion /
// valence / arousal / focus / gaze from the oyon_emotion_records sensing
// window COVERING its timestamp (window_start <= t < window_end, same
// session). When no window covers the event (capture off, consent absent,
// gap between windows) every enrichment field is null — we NEVER fabricate
// a reading.
//
// Pure ESM, no DOM, no React — imported by both the MomentsTable client
// surface and the server route GET /learning-events/moments (the server is
// "type": "module", so it requires no CJS mirror; there is exactly one
// copy of this logic).
//
// Privacy invariant: this module only ever reads the AGGREGATE gaze fields
// (zone_proportions, aoi_dwell_ms) — never any raw (x, y) point stream.

import { aoiLabel } from '../oyon/screenAois.js';
import { normalizeAoiDwell } from '../oyon/gazeAnalytics.js';

/** Enrichment fields attached to every event, all-null when no window covers it. */
const NULL_MOMENT = Object.freeze({
    emotion: null,
    valence: null,
    arousal: null,
    focus: null,
    gaze_target: null,
});

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Parse a timestamp into epoch milliseconds.
 *
 * Accepts epoch-ms numbers, Date instances, and ISO / SQLite-style strings
 * (`Date` handles both `2026-07-02T08:00:00.000Z` and `2026-07-02 08:00:00`).
 * Returns null (never NaN) when the value is missing or unparseable, so
 * callers can gate on `== null` without NaN surprises.
 *
 * @param {number|string|Date|null|undefined} ts
 * @returns {number|null} epoch milliseconds, or null when invalid
 */
export function parseTimestampMs(ts) {
    if (ts == null || ts === '') return null;
    if (ts instanceof Date) {
        const ms = ts.getTime();
        return Number.isNaN(ms) ? null : ms;
    }
    if (typeof ts === 'number') return Number.isFinite(ts) ? ts : null;
    if (typeof ts === 'string') {
        const ms = new Date(ts).getTime();
        return Number.isNaN(ms) ? null : ms;
    }
    return null;
}

/** Parse a JSON-string-or-object column (SQLite rows carry strings, hydrated
 *  client rows carry objects). Returns null on missing/invalid JSON. */
function parseJsonField(value) {
    if (value == null) return null;
    if (typeof value === 'object') return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch {
            return null;
        }
    }
    return null;
}

/** Argmax over an object's finite positive numeric values.
 *  Ties break by first-seen key order (stable, deterministic). */
function argmaxKey(obj) {
    if (!obj || typeof obj !== 'object') return null;
    let bestKey = null;
    let bestValue = -Infinity;
    for (const [key, raw] of Object.entries(obj)) {
        const v = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(v) || v <= 0) continue;
        if (v > bestValue) {
            bestValue = v;
            bestKey = key;
        }
    }
    return bestKey;
}

/**
 * Resolve WHAT the trainee was gazing toward during a window.
 *
 * Primary: argmax of gaze.aoi_dwell_ms — with target ids merged
 * case-insensitively first (normalizeAoiDwell: "Chat"/"chat" are the same
 * target from two capture eras) — labelled via screenAois metadata (unknown
 * AOI ids get a nicely-capitalized fallback). Fallback when aoi_dwell_ms is
 * missing / empty / all-zero: the dominant zone key from
 * gaze.zone_proportions. Null when neither carries a usable signal.
 *
 * @param {object|string|null} gaze  gaze_json (parsed object or JSON string)
 * @returns {string|null}
 */
export function gazeTargetFromGaze(gaze) {
    const g = parseJsonField(gaze);
    if (!g) return null;
    const aoiKey = argmaxKey(Object.fromEntries(normalizeAoiDwell(g.aoi_dwell_ms)));
    if (aoiKey != null) return aoiLabel(aoiKey);
    const zoneKey = argmaxKey(g.zone_proportions);
    return zoneKey != null ? zoneKey : null;
}

/**
 * The five enrichment fields from one sensing window (or the all-null
 * moment when the window is absent). Null numeric columns stay null —
 * never coerced to 0.
 *
 * @param {object|null|undefined} window  oyon_emotion_records row
 * @returns {{emotion: string|null, valence: number|null, arousal: number|null,
 *            focus: number|null, gaze_target: string|null}}
 */
export function momentFields(window) {
    if (!window) return { ...NULL_MOMENT };
    const engagement = parseJsonField(window.engagement_json);
    const focus = engagement && isFiniteNumber(engagement.focus_score)
        ? engagement.focus_score
        : null;
    return {
        emotion: window.dominant_emotion ?? null,
        valence: isFiniteNumber(window.valence) ? window.valence : null,
        arousal: isFiniteNumber(window.arousal) ? window.arousal : null,
        focus,
        gaze_target: gazeTargetFromGaze(window.gaze_json),
    };
}

/** Group + sort windows by session for repeated covering-window lookups.
 *  Windows with unparseable bounds are dropped (they can't cover anything). */
function indexWindowsBySession(windows) {
    const bySession = new Map();
    for (const w of Array.isArray(windows) ? windows : []) {
        if (w == null || w.session_id == null) continue;
        const startMs = parseTimestampMs(w.window_start);
        const endMs = parseTimestampMs(w.window_end);
        if (startMs == null || endMs == null) continue;
        const key = String(w.session_id);
        if (!bySession.has(key)) bySession.set(key, []);
        bySession.get(key).push({ startMs, endMs, window: w });
    }
    for (const list of bySession.values()) list.sort((a, b) => a.startMs - b.startMs);
    return bySession;
}

/**
 * The sensing window covering a timestamp within one session, or null.
 * Coverage contract: window_start <= t < window_end (start inclusive,
 * end exclusive) AND same session_id (compared as strings).
 *
 * @param {Array<object>} windows  oyon_emotion_records rows (any order)
 * @param {string|number} sessionId
 * @param {number|string|Date} timestamp  event timestamp
 * @returns {object|null} the covering window row, or null
 */
export function findCoveringWindow(windows, sessionId, timestamp) {
    if (sessionId == null) return null;
    const tMs = parseTimestampMs(timestamp);
    if (tMs == null) return null;
    const list = indexWindowsBySession(windows).get(String(sessionId));
    if (!list) return null;
    const hit = list.find((e) => e.startMs <= tMs && tMs < e.endMs);
    return hit ? hit.window : null;
}

/**
 * Join learning events to their covering sensing windows.
 *
 * Returns a NEW array (inputs untouched): each event copied with the five
 * enrichment fields attached — `emotion`, `valence`, `arousal`, `focus`,
 * `gaze_target` — all null when no window covers the event's timestamp in
 * its session. Events with a missing session_id or an unparseable
 * timestamp get the all-null moment.
 *
 * @param {Array<object>} events   learning_events rows (need session_id + timestamp)
 * @param {Array<object>} windows  oyon_emotion_records rows (need session_id,
 *   window_start, window_end, dominant_emotion, valence, arousal,
 *   engagement_json, gaze_json)
 * @returns {Array<object>} enriched copies of the events, same order
 */
export function joinMoments(events, windows) {
    const bySession = indexWindowsBySession(windows);
    return (Array.isArray(events) ? events : []).map((event) => {
        const tMs = parseTimestampMs(event?.timestamp);
        const list = event?.session_id != null ? bySession.get(String(event.session_id)) : null;
        const hit = (tMs != null && list)
            ? list.find((e) => e.startMs <= tMs && tMs < e.endMs)
            : null;
        return { ...event, ...momentFields(hit ? hit.window : null) };
    });
}
