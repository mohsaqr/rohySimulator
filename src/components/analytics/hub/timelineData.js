// timelineData.js — pure data-prep helpers for the AnalyticsHub Timeline tab.
//
// Aligns four per-session streams on one millisecond time axis:
//   chat turns   (/analytics/interactions/:id      — 'YYYY-MM-DD HH:MM:SS' UTC)
//   actions      (/analytics/learning-events/session/:id — ISO ms UTC)
//   emotion      (Oyon emotion-record windows — window_start/window_end ISO)
//   gaze         (same windows' gaze.zone_proportions + engagement.focus_score)
//
// Every function is pure (no React, no fetch) and defensive: malformed or
// missing rows are dropped, numbers are guarded so no NaN ever reaches the
// SVG layer, and empty inputs yield empty arrays (never undefined).

export const ZONE_ROWS = [
    ['top_left', 'top_center', 'top_right'],
    ['middle_left', 'middle_center', 'middle_right'],
    ['bottom_left', 'bottom_center', 'bottom_right'],
];

export const ZONE_KEYS = ZONE_ROWS.flat();

// Distinct soft colors per screen ninth — shared by the gaze strip, the
// legend, and the per-turn heatmap accents. (Emotion colors come from
// src/components/oyon/emotionLogShared.js — one source of truth.)
export const ZONE_COLORS = {
    top_left: '#38bdf8',
    top_center: '#818cf8',
    top_right: '#c084fc',
    middle_left: '#2dd4bf',
    middle_center: '#a3a3a3',
    middle_right: '#f472b6',
    bottom_left: '#a3e635',
    bottom_center: '#fbbf24',
    bottom_right: '#fb923c',
};

/**
 * Robust timestamp → epoch-milliseconds parser.
 * Accepts: finite numbers (passthrough), Date instances, ISO strings with or
 * without a zone suffix (zoneless is treated as UTC), and the SQLite
 * 'YYYY-MM-DD HH:MM:SS' form (treated as UTC, per the server contract).
 * Returns null for anything unparsable — never NaN.
 */
export function parseTsMs(ts) {
    if (typeof ts === 'number') return Number.isFinite(ts) ? ts : null;
    if (ts instanceof Date) {
        const v = ts.getTime();
        return Number.isFinite(v) ? v : null;
    }
    if (typeof ts !== 'string') return null;
    let s = ts.trim();
    if (!s) return null;
    // SQLite 'YYYY-MM-DD HH:MM:SS[.sss]' → ISO 'T' form.
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) {
        s = s.replace(' ', 'T');
    }
    // ISO datetime without an explicit zone → treat as UTC.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) {
        s += 'Z';
    }
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? ms : null;
}

function asArray(v) {
    return Array.isArray(v) ? v : [];
}

function finiteOrNull(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function textOf(v) {
    if (typeof v === 'string') return v;
    return v == null ? '' : String(v);
}

// ---- per-row normalizers (internal) ------------------------------------

function normInteraction(row) {
    if (!row || typeof row !== 'object') return null;
    const tMs = parseTsMs(row.timestamp);
    if (tMs == null) return null;
    const role = textOf(row.role).toLowerCase();
    return { id: row.id ?? null, role, tMs, content: textOf(row.content) };
}

function normEvent(row) {
    if (!row || typeof row !== 'object') return null;
    const tMs = parseTsMs(row.timestamp);
    if (tMs == null) return null;
    return {
        id: row.id ?? null,
        tMs,
        verb: textOf(row.verb),
        objectType: textOf(row.object_type),
        objectName: textOf(row.object_name),
        room: row.room != null && row.room !== '' ? textOf(row.room) : null,
        category: row.category != null && row.category !== '' ? textOf(row.category) : null,
        component: row.component != null && row.component !== '' ? textOf(row.component) : null,
    };
}

function normWindow(row) {
    if (!row || typeof row !== 'object') return null;
    const startMs = parseTsMs(row.window_start);
    if (startMs == null) return null;
    const endRaw = parseTsMs(row.window_end);
    const endMs = endRaw != null && endRaw >= startMs ? endRaw : startMs;
    const gaze = row.gaze && typeof row.gaze === 'object' ? row.gaze : null;
    const engagement = row.engagement && typeof row.engagement === 'object' ? row.engagement : null;
    const zones = gaze && gaze.zone_proportions && typeof gaze.zone_proportions === 'object'
        ? gaze.zone_proportions
        : null;
    const centroid = gaze && gaze.centroid && typeof gaze.centroid === 'object'
        ? { x: finiteOrNull(gaze.centroid.x), y: finiteOrNull(gaze.centroid.y) }
        : null;
    return {
        startMs,
        endMs,
        midMs: startMs + (endMs - startMs) / 2,
        dominant: row.dominant_emotion != null && row.dominant_emotion !== ''
            ? textOf(row.dominant_emotion) : null,
        valence: finiteOrNull(row.valence),
        arousal: finiteOrNull(row.arousal),
        confidence: finiteOrNull(row.confidence),
        room: row.room != null && row.room !== '' ? textOf(row.room) : null,
        focus: engagement ? finiteOrNull(engagement.focus_score) : null,
        zones,
        centroid,
        dispersion: gaze ? finiteOrNull(gaze.dispersion) : null,
    };
}

const byT = (a, b) => a.tMs - b.tMs;
const byStart = (a, b) => a.startMs - b.startMs;

// ---- public verbs -------------------------------------------------------

/**
 * Argmax over a zone_proportions object. Returns the winning zone key, or
 * null when the object is missing / has no finite positive value. Ties go
 * to the first key in ZONE_KEYS reading order.
 */
export function dominantZone(zoneProportions) {
    if (!zoneProportions || typeof zoneProportions !== 'object') return null;
    let bestKey = null;
    let bestVal = 0;
    ZONE_KEYS.forEach((key) => {
        const v = Number(zoneProportions[key]);
        if (Number.isFinite(v) && v > bestVal) {
            bestVal = v;
            bestKey = key;
        }
    });
    return bestKey;
}

/**
 * Sum + normalize zone proportions across a turn's windows into one 3×3
 * distribution (values sum to 1). Accepts normalized windows (with .zones)
 * or raw records (with .gaze.zone_proportions). Returns null when no
 * window contributed any gaze mass.
 */
export function foldZones(windowsOfTurn) {
    const totals = Object.fromEntries(ZONE_KEYS.map((k) => [k, 0]));
    let sum = 0;
    asArray(windowsOfTurn).forEach((w) => {
        const zp = (w && typeof w === 'object')
            ? (w.zones || (w.gaze && typeof w.gaze === 'object' ? w.gaze.zone_proportions : null))
            : null;
        if (!zp || typeof zp !== 'object') return;
        ZONE_KEYS.forEach((key) => {
            const v = Number(zp[key]);
            if (Number.isFinite(v) && v > 0) {
                totals[key] += v;
                sum += v;
            }
        });
    });
    if (sum <= 0) return null;
    return Object.fromEntries(ZONE_KEYS.map((k) => [k, totals[k] / sum]));
}

/**
 * Contiguous room bands over [t0, t1].
 * Room changes come from action events (a NAVIGATED event's object_name is
 * the room entered; any other event's `room` stamp counts too). When no
 * event carries room info, falls back to the windows' room stamps. The
 * first known room is extended back to t0; the last extends to t1.
 * Returns [{ startMs, endMs, room }] — [] when nothing is known.
 */
export function roomIntervals(events, windows, t0, t1) {
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return [];

    const eventPts = asArray(events)
        .map(normEvent)
        .filter(Boolean)
        .map((e) => {
            const room = (e.verb.toUpperCase() === 'NAVIGATED' && e.objectName)
                ? e.objectName
                : e.room;
            return room ? { tMs: e.tMs, room } : null;
        })
        .filter(Boolean);

    const pts = eventPts.length > 0
        ? eventPts
        : asArray(windows)
            .map(normWindow)
            .filter(Boolean)
            .filter((w) => w.room)
            .map((w) => ({ tMs: w.startMs, room: w.room }));

    if (pts.length === 0) return [];
    pts.sort(byT);

    // Compress consecutive duplicates into change points.
    const changes = pts.filter((p, i) => i === 0 || p.room !== pts[i - 1].room);

    const bands = changes
        .map((p, i) => ({
            startMs: i === 0 ? Math.min(t0, p.tMs) : p.tMs,
            endMs: i + 1 < changes.length ? changes[i + 1].tMs : Math.max(t1, p.tMs),
            room: p.room,
        }))
        .map((b) => ({
            startMs: Math.max(t0, b.startMs),
            endMs: Math.min(t1, b.endMs),
            room: b.room,
        }))
        .filter((b) => b.endMs > b.startMs);

    return bands;
}

/**
 * Slice a session into user turns. Turn i owns:
 *   prompt  — the i-th user message (chronological);
 *   reply   — assistant messages in [thisUser, nextUser) joined by blank lines;
 *   windows — emotion windows whose window_end falls in
 *             (previousUserMsg, thisUserMsg]  — a window ending exactly at a
 *             user message's timestamp belongs to the EARLIER turn (≤ rule);
 *             the last turn extends to Infinity.
 * Returns [{ turnIndex, promptMsg, replyText, windows }].
 */
export function turnSlices(interactions, windows) {
    const msgs = asArray(interactions).map(normInteraction).filter(Boolean).sort(byT);
    const users = msgs.filter((m) => m.role === 'user');
    const wins = asArray(windows).map(normWindow).filter(Boolean).sort(byStart);

    return users.map((u, i) => {
        const prevT = i > 0 ? users[i - 1].tMs : -Infinity;
        const nextT = i + 1 < users.length ? users[i + 1].tMs : Infinity;
        const upper = i === users.length - 1 ? Infinity : u.tMs;
        const replyText = msgs
            .filter((m) => m.role === 'assistant' && m.tMs >= u.tMs && m.tMs < nextT)
            .map((m) => m.content)
            .join('\n\n');
        return {
            turnIndex: i,
            promptMsg: u,
            replyText,
            windows: wins.filter((w) => w.endMs > prevT && w.endMs <= upper),
        };
    });
}

/**
 * Master model for the timeline SVG. Normalizes all four streams onto one
 * ms axis and computes the shared [t0, t1] span.
 *
 * Returns {
 *   t0, t1,            // ms span (null/null when there is no data at all)
 *   chatMarks:      [{ id, role, tMs, content, turnIndex|null }],  // sorted
 *   actionMarks:    [{ id, tMs, verb, objectType, objectName, room, category, component }],
 *   emotionWindows: [{ startMs, endMs, midMs, dominant, valence, arousal,
 *                      confidence, room, focus, zones, centroid, dispersion }],
 *   gazeSegs:       [{ startMs, endMs, zone, focus, zones, centroid }],
 *   roomBands:      [{ startMs, endMs, room }],
 * }
 */
export function buildTimelineModel({ interactions, events, windows } = {}) {
    const chatMarks = asArray(interactions)
        .map(normInteraction)
        .filter(Boolean)
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .sort(byT);

    // Stamp each user mark with its turn index (same chronological order
    // turnSlices uses) so a marker click can address its turn directly.
    let turn = -1;
    chatMarks.forEach((m) => {
        m.turnIndex = m.role === 'user' ? (turn += 1) : null;
    });

    const actionMarks = asArray(events).map(normEvent).filter(Boolean).sort(byT);
    const emotionWindows = asArray(windows).map(normWindow).filter(Boolean).sort(byStart);

    const gazeSegs = emotionWindows
        .filter((w) => w.zones && dominantZone(w.zones) != null)
        .map((w) => ({
            startMs: w.startMs,
            endMs: w.endMs,
            zone: dominantZone(w.zones),
            focus: w.focus,
            zones: w.zones,
            centroid: w.centroid,
        }));

    const times = [
        ...chatMarks.map((m) => m.tMs),
        ...actionMarks.map((a) => a.tMs),
        ...emotionWindows.map((w) => w.startMs),
        ...emotionWindows.map((w) => w.endMs),
    ];

    if (times.length === 0) {
        return {
            t0: null, t1: null,
            chatMarks: [], actionMarks: [], emotionWindows: [], gazeSegs: [], roomBands: [],
        };
    }

    const t0 = Math.min(...times);
    let t1 = Math.max(...times);
    if (t1 <= t0) t1 = t0 + 1000; // degenerate span → give the axis 1 s

    return {
        t0,
        t1,
        chatMarks,
        actionMarks,
        emotionWindows,
        gazeSegs,
        roomBands: roomIntervals(events, windows, t0, t1),
    };
}
