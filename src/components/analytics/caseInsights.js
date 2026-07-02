// caseInsights — pure Case Insights math.
//
// Two verbs, both side-effect free and DOM-free (imported by the
// CaseInsightsPanel client surface AND the server route
// GET /api/analytics/case-insights — one copy of the logic, same as
// momentsJoin.js):
//
//   triggerReaction(windows, sessionId, triggerTs, opts)
//     How the trainee's affect moved around one critical moment (a fired
//     scenario event or a vitals alarm): aggregates the sensing windows
//     overlapping the 30s before vs the 30s after the trigger.
//
//   actionAffectSummary(moments)
//     One tidy row per (case_id, verb) over already-enriched clinical
//     moment rows (the /learning-events/moments shape).
//
// Never-fabricate rule (inherited from momentsJoin): a side with no
// windows yields nulls, null valence is NEVER coerced to 0, and rows with
// null enrichment still count toward n (the action happened; the sensor
// was just off).
//
// Privacy invariant: consumes only the stored AGGREGATE gaze fields via
// gazeTargetFromGaze — never any raw (x, y) point stream.

import { parseTimestampMs, gazeTargetFromGaze } from './momentsJoin.js';

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/** Mean over the finite numbers in `values`; null when there are none. */
function meanOrNull(values) {
    const usable = values.filter(isFiniteNumber);
    if (usable.length === 0) return null;
    return usable.reduce((sum, v) => sum + v, 0) / usable.length;
}

/** Modal (most frequent) non-null value. Ties break by FIRST-SEEN order —
 *  deterministic, locked by test. Null when no non-null values exist. */
function modalOrNull(values) {
    const counts = new Map();
    for (const v of values) {
        if (v == null) continue;
        counts.set(v, (counts.get(v) || 0) + 1);
    }
    let best = null;
    let bestCount = 0;
    for (const [value, count] of counts) {
        if (count > bestCount) {
            best = value;
            bestCount = count;
        }
    }
    return best;
}

/** All-null side summary (no windows overlapped the range). */
const NULL_SIDE = Object.freeze({
    valence_mean: null,
    gaze_dominant: null,
    emotion_dominant: null,
    windows: 0,
});

/** Aggregate one side (a list of window rows) into the side summary. */
function summarizeSide(windowRows) {
    if (windowRows.length === 0) return { ...NULL_SIDE };
    return {
        valence_mean: meanOrNull(windowRows.map((w) => w.valence)),
        gaze_dominant: modalOrNull(windowRows.map((w) => gazeTargetFromGaze(w.gaze_json))),
        emotion_dominant: modalOrNull(windowRows.map((w) => w.dominant_emotion ?? null)),
        windows: windowRows.length,
    };
}

/**
 * Affect movement around one trigger timestamp.
 *
 * Pre side: windows overlapping [triggerTs - preMs, triggerTs).
 * Post side: windows overlapping [triggerTs, triggerTs + postMs).
 * Overlap means any intersection with the half-open range (a window
 * straddling the trigger counts on BOTH sides). Only windows of
 * `sessionId` participate (ids compared as strings, same contract as
 * findCoveringWindow).
 *
 * @param {Array<object>} windows  oyon_emotion_records rows (need
 *   session_id, window_start, window_end, valence, dominant_emotion, gaze_json)
 * @param {string|number} sessionId
 * @param {number|string|Date} triggerTs
 * @param {{preMs?: number, postMs?: number}} [opts]
 * @returns {{pre: {valence_mean: number|null, gaze_dominant: string|null,
 *            emotion_dominant: string|null, windows: number},
 *            post: {valence_mean: number|null, gaze_dominant: string|null,
 *            emotion_dominant: string|null, windows: number},
 *            delta_valence: number|null}}
 *   delta_valence is post minus pre, null unless BOTH sides have a
 *   valence mean. A side with no overlapping windows is the all-null side.
 */
export function triggerReaction(windows, sessionId, triggerTs, { preMs = 30000, postMs = 30000 } = {}) {
    const tMs = parseTimestampMs(triggerTs);
    const empty = { pre: { ...NULL_SIDE }, post: { ...NULL_SIDE }, delta_valence: null };
    if (tMs == null || sessionId == null) return empty;

    const sessionKey = String(sessionId);
    const bounded = (Array.isArray(windows) ? windows : [])
        .filter((w) => w != null && w.session_id != null && String(w.session_id) === sessionKey)
        .map((w) => ({
            startMs: parseTimestampMs(w.window_start),
            endMs: parseTimestampMs(w.window_end),
            window: w,
        }))
        .filter((e) => e.startMs != null && e.endMs != null);

    // Half-open range overlap: [a, b) ∩ [startMs, endMs) non-empty.
    const overlapping = (a, b) => bounded
        .filter((e) => e.startMs < b && e.endMs > a)
        .map((e) => e.window);

    const pre = summarizeSide(overlapping(tMs - preMs, tMs));
    const post = summarizeSide(overlapping(tMs, tMs + postMs));
    const delta_valence = (pre.valence_mean != null && post.valence_mean != null)
        ? post.valence_mean - pre.valence_mean
        : null;
    return { pre, post, delta_valence };
}

/**
 * Action–affect summary: one tidy row per (case_id, verb) over
 * already-enriched clinical moment rows (the exact shape the
 * /learning-events/moments endpoint returns — emotion / valence / focus /
 * gaze_target may each be null when no sensing window covered the action).
 *
 * n counts EVERY moment in the group; the affect aggregates skip nulls
 * (and are null when the whole group is unenriched). Modal ties break
 * first-seen. Ordering is deterministic: case_title ascending (nulls
 * last), then n descending, then verb ascending.
 *
 * @param {Array<object>} moments  enriched moment rows (need case_id,
 *   case_title, verb, emotion, valence, focus, gaze_target)
 * @returns {Array<{case_id: *, case_title: string|null, verb: string|null,
 *   n: number, emotion_dominant: string|null, valence_mean: number|null,
 *   gaze_dominant: string|null, focus_mean: number|null}>}
 */
export function actionAffectSummary(moments) {
    const groups = new Map();
    for (const row of Array.isArray(moments) ? moments : []) {
        if (row == null) continue;
        const key = `${String(row.case_id)}\u0000${String(row.verb)}`;
        if (!groups.has(key)) {
            groups.set(key, {
                case_id: row.case_id ?? null,
                case_title: row.case_title ?? null,
                verb: row.verb ?? null,
                rows: [],
            });
        }
        const group = groups.get(key);
        if (group.case_title == null && row.case_title != null) group.case_title = row.case_title;
        group.rows.push(row);
    }

    const summary = [...groups.values()].map((g) => ({
        case_id: g.case_id,
        case_title: g.case_title,
        verb: g.verb,
        n: g.rows.length,
        emotion_dominant: modalOrNull(g.rows.map((r) => r.emotion ?? null)),
        valence_mean: meanOrNull(g.rows.map((r) => r.valence)),
        gaze_dominant: modalOrNull(g.rows.map((r) => r.gaze_target ?? null)),
        focus_mean: meanOrNull(g.rows.map((r) => r.focus)),
    }));

    summary.sort((a, b) => {
        if (a.case_title !== b.case_title) {
            if (a.case_title == null) return 1;
            if (b.case_title == null) return -1;
            const byTitle = String(a.case_title).localeCompare(String(b.case_title));
            if (byTitle !== 0) return byTitle;
        }
        if (a.n !== b.n) return b.n - a.n;
        return String(a.verb ?? '').localeCompare(String(b.verb ?? ''));
    });
    return summary;
}
