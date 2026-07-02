// Pure longitudinal trends over the raw /addons/oyon/emotion-records rows —
// everything the Trends view shows: an aggregate summary, one affect point per
// calendar day (daily means), a "when do they engage" weekday × hour activity
// heatmap, and a per-room valence breakdown.
//
// Ported from chatoyon-plus src/lib/analytics/trends.mjs (dailyMeans +
// activityHeatmap); adaptations: the input is Rohy's flat emotion-record rows
// (window_start ISO string, valence/arousal number|null, dominant_emotion,
// session_id, room) rather than chatoyon's pre-aggregated per-session trend
// points, and the heatmap rows are Mon..Sun (not Sun-first).
//
// Timezone semantics (mirrors trends.mjs): day / hour / weekday are read in
// the runtime's LOCAL timezone via Date getters (getFullYear/getHours/getDay),
// matching what the chart axis labels imply. The day key is a local
// 'YYYY-MM-DD' string — consumers must format it by splitting the string, not
// by constructing a Date from it (new Date('YYYY-MM-DD') parses as UTC and
// can shift the label a day; see chatoyon's TrendsTab shortDay).
//
// Null-vs-0 semantics (mirrors gazeAnalytics.js): a mean over zero non-null
// values is null, never 0 — "no affect measured" ≠ "neutral affect".

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Mean of the finite numbers in `values`, or null when there are none.
 * @param {Array<number|null|undefined>} values
 * @returns {number|null}
 */
function mean(values) {
    const nums = values.filter(isNum);
    if (nums.length === 0) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Local-clock calendar parts of a record's window_start.
 * @param {string|undefined} iso ISO timestamp (as stored in window_start)
 * @returns {{day: string, hour: number, weekday: number}|null} day is local
 *   'YYYY-MM-DD'; hour 0-23; weekday 0 = Sunday (raw getDay()). Null when the
 *   timestamp is missing or unparsable.
 */
export function localParts(iso) {
    if (typeof iso !== 'string' || !iso) return null;
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return null;
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { day, hour: d.getHours(), weekday: d.getDay() };
}

/**
 * The most frequent non-empty string in `values` (first-seen wins ties).
 * @param {Array<string|null|undefined>} values
 * @returns {string|null}
 */
function modal(values) {
    const counts = new Map();
    for (const v of values) {
        if (typeof v === 'string' && v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    let best = null;
    let bestCount = 0;
    for (const [label, count] of counts) {
        if (count > bestCount) {
            best = label;
            bestCount = count;
        }
    }
    return best;
}

/**
 * Count of distinct non-null session ids among `records`.
 * @param {Array<{session_id?: string|number|null}>} records
 * @returns {number}
 */
function sessionCount(records) {
    const ids = new Set();
    for (const r of records) {
        if (r?.session_id != null) ids.add(String(r.session_id));
    }
    return ids.size;
}

/**
 * @typedef {Object} TrendsSummary
 * @property {number} windows       total records in the pool
 * @property {number} sessions     distinct session_id count
 * @property {number} daysActive   distinct local calendar days with records
 * @property {string|null} firstDay earliest local 'YYYY-MM-DD' (null when empty)
 * @property {string|null} lastDay  latest local 'YYYY-MM-DD' (null when empty)
 * @property {number|null} avgValence mean valence over non-null values
 * @property {number|null} avgArousal mean arousal over non-null values
 */

/**
 * @typedef {Object} DailyTrendPoint
 * @property {string} day          local 'YYYY-MM-DD'
 * @property {number} windows      records that day
 * @property {number} sessions    distinct sessions that day
 * @property {number|null} avgValence mean over the day's non-null valences
 * @property {number|null} avgArousal mean over the day's non-null arousals
 * @property {string|null} dominantEmotion modal dominant_emotion that day
 */

/**
 * Everything the Trends view needs, from one pool of emotion-record rows.
 * Input order does not matter (the API serves newest-first; `daily` is always
 * returned chronological). Records with a missing/unparsable window_start
 * still count toward summary.windows/sessions and the affect means, but
 * cannot be placed on the calendar (daily/heatmap skip them).
 *
 * @param {Array<Object>} records emotion-record rows — the fields read are
 *   window_start (ISO string), valence (number|null), arousal (number|null),
 *   dominant_emotion (string|null), session_id, room (string|null).
 * @returns {{
 *   summary: TrendsSummary,
 *   daily: DailyTrendPoint[],
 *   heatmap: { grid: number[][], max: number, total: number },
 *   byRoom: Array<{room: string, windows: number, avgValence: number|null}>,
 * }} heatmap.grid is 7×24 counts with rows Mon..Sun (grid[0] = Monday) and
 *   columns hour-of-day 0-23; max is the largest cell; total is the number of
 *   records placed on the grid. byRoom is sorted by window count descending,
 *   with roomless records under '(unknown)'.
 */
export function trendsAnalytics(records) {
    const pool = Array.isArray(records) ? records : [];

    // --- calendar-day buckets + weekday × hour heatmap in one pass ---------
    /** @type {Map<string, Array<Object>>} */
    const byDay = new Map();
    const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let max = 0;
    let total = 0;
    for (const r of pool) {
        const parts = localParts(r?.window_start);
        if (!parts) continue;
        const bucket = byDay.get(parts.day);
        if (bucket) bucket.push(r);
        else byDay.set(parts.day, [r]);
        // Mon-first row: getDay() has 0 = Sunday, so rotate by one.
        const row = (parts.weekday + 6) % 7;
        grid[row][parts.hour] += 1;
        total += 1;
        if (grid[row][parts.hour] > max) max = grid[row][parts.hour];
    }

    // Local 'YYYY-MM-DD' keys sort lexicographically == chronologically.
    const daily = [...byDay.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([day, rs]) => ({
            day,
            windows: rs.length,
            sessions: sessionCount(rs),
            avgValence: mean(rs.map((r) => r.valence)),
            avgArousal: mean(rs.map((r) => r.arousal)),
            dominantEmotion: modal(rs.map((r) => r.dominant_emotion)),
        }));

    const summary = {
        windows: pool.length,
        sessions: sessionCount(pool),
        daysActive: daily.length,
        firstDay: daily.length ? daily[0].day : null,
        lastDay: daily.length ? daily[daily.length - 1].day : null,
        avgValence: mean(pool.map((r) => r?.valence)),
        avgArousal: mean(pool.map((r) => r?.arousal)),
    };

    // --- per-room valence breakdown ----------------------------------------
    const rooms = new Map();
    for (const r of pool) {
        const room = typeof r?.room === 'string' && r.room ? r.room : '(unknown)';
        const bucket = rooms.get(room);
        if (bucket) bucket.push(r);
        else rooms.set(room, [r]);
    }
    const byRoom = [...rooms.entries()]
        .map(([room, rs]) => ({
            room,
            windows: rs.length,
            avgValence: mean(rs.map((r) => r.valence)),
        }))
        .sort((a, b) => b.windows - a.windows);

    return { summary, daily, heatmap: { grid, max, total }, byRoom };
}
