// Pure helpers turning /learning-events/all rows into the inputs the
// carmdash-style activity charts need (StackedAreaChart + DayHourMatrix
// in src/components/analytics/charts/).
//
// Every event is mapped to the SAME clinical state the dashboard's
// 'combined' sequence mode resolves (clinicalStates.js chain: explicit
// verb:object pair → object override → verb fallback → literal), so the
// activity charts share state names — and therefore palette colors — with
// the Network / Process Map tabs.

import { resolveClinicalState } from './clinicalStates';

/**
 * Resolve one learning-event row to a clinical state.
 * @param {{verb?:string, object_type?:string}} event
 * @returns {string} clinical state (or the literal `verb_object` / verb
 *   fallback when no rule matches — same contract as the combined mode)
 */
export function eventState(event) {
    return resolveClinicalState(event?.verb, event?.object_type);
}

/**
 * ISO day key ('YYYY-MM-DD') for an event timestamp. Handles both ISO
 * strings and sqlite 'YYYY-MM-DD HH:MM:SS' rows without a Date round-trip;
 * anything unparseable returns null so callers can drop the row.
 * @param {string|number} timestamp
 * @returns {string|null}
 */
function dayKey(timestamp) {
    if (timestamp == null || timestamp === '') return null;
    if (typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2}/.test(timestamp)) {
        return timestamp.slice(0, 10);
    }
    const d = new Date(timestamp);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Client-side filter matching the dashboard's effective filter bar. The
 * /learning-events/all endpoint only takes `limit`, so case/user/date
 * narrowing happens here. Date bounds compare on the ISO day (inclusive),
 * matching the date-only <input type="date"> values.
 *
 * @param {object[]} events rows from /learning-events/all
 * @param {{courseId?:string, caseId?:string, userId?:string, startDate?:string, endDate?:string}} filters
 * @returns {object[]} the surviving rows (original order preserved)
 */
export function filterEvents(events, { courseId = '', caseId = '', userId = '', startDate = '', endDate = '', room = '' } = {}) {
    return (events ?? []).filter((e) => {
        if (!e) return false;
        if (courseId) {
            const ids = Array.isArray(e.course_ids)
                ? e.course_ids
                : String(e.course_ids ?? '').split(',').map((v) => v.trim()).filter(Boolean);
            if (!ids.map(String).includes(String(courseId))) return false;
        }
        if (caseId && String(e.case_id ?? '') !== String(caseId)) return false;
        if (userId && String(e.user_id ?? '') !== String(userId)) return false;
        if (room && String(e.room ?? '') !== String(room)) return false;
        if (startDate || endDate) {
            const day = dayKey(e.timestamp);
            if (!day) return false;
            if (startDate && day < startDate) return false;
            if (endDate && day > endDate) return false;
        }
        return true;
    });
}

/**
 * The set of rooms actually present in a batch of events, as
 * {id, label, count} rows sorted by count desc — feeds the Room filter
 * dropdown so it only offers rooms that have data. Rows with no room
 * (`data.room` null — pre-session events) are grouped under id ''.
 * @param {object[]} events rows from /learning-events/all
 * @returns {{id:string, count:number}[]}
 */
export function eventRoomCounts(events) {
    const counts = new Map();
    for (const e of events ?? []) {
        if (!e) continue;
        const id = e.room == null ? '' : String(e.room);
        counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => b.count - a.count);
}

/**
 * Group events into per-actor sequences of labels — the client-side analogue
 * of the server's /analytics/tna-sequences, so the Network/Process/Clusters
 * screens can build from the SAME filtered rows the Activity charts use (one
 * filtered dataset, every screen agrees).
 *
 * @param {object[]} events already-filtered rows
 * @param {{groupBy?:'actor-session'|'actor', labelOf:(e:object)=>string}} opts
 *        groupBy 'actor-session' = one sequence per session (default),
 *        'actor' = one sequence per student across their sessions.
 * @returns {string[][]} label sequences (order = chronological within a group)
 */
export function eventsToSequences(events, { groupBy = 'actor-session', labelOf } = {}) {
    const toLabel = labelOf || eventState;
    const groups = new Map();
    for (const e of events ?? []) {
        if (!e) continue;
        const key = groupBy === 'actor'
            ? `u:${e.user_id ?? 'unknown'}`
            : `s:${e.session_id ?? `u${e.user_id ?? 'unknown'}`}`;
        let arr = groups.get(key);
        if (!arr) { arr = []; groups.set(key, arr); }
        arr.push(e);
    }
    const seqs = [];
    for (const arr of groups.values()) {
        arr.sort((a, b) => {
            const ta = a.timestamp ?? '';
            const tb = b.timestamp ?? '';
            return ta < tb ? -1 : ta > tb ? 1 : 0;
        });
        seqs.push(arr.map((e) => toLabel(e)).filter((v) => v != null && v !== ''));
    }
    return seqs;
}

/**
 * Hour key ('YYYY-MM-DD HH') for an event timestamp — same string-based
 * (UTC wall-clock) convention as dayKey so both bucketings agree.
 * @param {string|number} timestamp
 * @returns {string|null}
 */
function hourKey(timestamp) {
    if (timestamp == null || timestamp === '') return null;
    if (typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}/.test(timestamp)) {
        return `${timestamp.slice(0, 10)} ${timestamp.slice(11, 13)}`;
    }
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return null;
    const iso = d.toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 13)}`;
}

/** 5-minute key ('YYYY-MM-DD HH:M0') for an event timestamp. */
function fiveMinKey(timestamp) {
    const h = hourKey(timestamp);
    if (!h) return null;
    const raw = typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(timestamp)
        ? timestamp
        : new Date(timestamp).toISOString();
    const minute = parseInt(raw.slice(14, 16), 10);
    return `${h}:${String(Math.floor(minute / 5) * 5).padStart(2, '0')}`;
}

/** Every bucket key from first to last inclusive (fills quiet gaps with 0). */
function bucketRange(firstKey, lastKey, stepMs) {
    const toMs = (k) => Date.parse(`${k.slice(0, 10)}T${k.slice(11, 13)}:${k.length > 13 ? k.slice(14, 16) : '00'}:00Z`);
    const fromMs = (t) => {
        const iso = new Date(t).toISOString();
        return stepMs >= 3_600_000
            ? `${iso.slice(0, 10)} ${iso.slice(11, 13)}`
            : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
    };
    const keys = [];
    for (let t = toMs(firstKey); t <= toMs(lastKey); t += stepMs) keys.push(fromMs(t));
    return keys;
}

/**
 * Bucket events by time × clinical state for StackedAreaChart, with
 * ADAPTIVE granularity: spans of 3+ distinct days bucket by ISO day
 * ('MM-DD' labels); shorter spans — a single simulator session is usually
 * one afternoon — bucket by hour ('HH:00', day-prefixed when two days are
 * in play) with quiet hours 0-filled so the area stays continuous. A
 * one-x-point "daily" chart draws nothing, which is why day-only
 * bucketing looked empty on single-day data.
 *
 * Every series carries a y value (0-filled) for every bucket so the
 * stacked baselines stay aligned. Series are sorted by total desc; events
 * without a parseable timestamp are dropped.
 *
 * @param {object[]} events rows from /learning-events/all
 * @returns {{series:{label:string,x:number[],y:number[]}[], xLabels:string[],
 *   granularity:'day'|'hour'|'5min'}} x = bucket index into xLabels
 */
export function toDailyStateSeries(events, labelOf = eventState) {
    const rows = (events ?? []).filter((e) => e && dayKey(e.timestamp));
    const daySet = new Set(rows.map((e) => dayKey(e.timestamp)));
    let granularity = daySet.size >= 3 ? 'day' : 'hour';
    if (granularity === 'hour') {
        // A single short session collapses into 1-2 hour buckets — too few
        // x points for an area chart. Drop to 5-minute bins.
        const hourSet = new Set(rows.map((e) => hourKey(e.timestamp)).filter(Boolean));
        if (hourSet.size < 3) granularity = '5min';
    }
    const keyOf = granularity === 'day' ? ((e) => dayKey(e.timestamp))
        : granularity === 'hour' ? ((e) => hourKey(e.timestamp))
            : ((e) => fiveMinKey(e.timestamp));

    const byState = new Map(); // state → Map(bucket → count)
    const bucketSet = new Set();
    rows.forEach((e) => {
        const bucket = keyOf(e);
        if (!bucket) return;
        bucketSet.add(bucket);
        const state = labelOf(e);
        let buckets = byState.get(state);
        if (!buckets) { buckets = new Map(); byState.set(state, buckets); }
        buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    });

    let buckets = [...bucketSet].sort();
    if (granularity !== 'day' && buckets.length > 1) {
        buckets = bucketRange(buckets[0], buckets[buckets.length - 1],
            granularity === 'hour' ? 3_600_000 : 300_000);
    }
    const bucketIndex = new Map(buckets.map((b, i) => [b, i]));
    const x = buckets.map((_, i) => i);

    const series = [...byState.entries()]
        .map(([label, counts]) => {
            const y = buckets.map(() => 0);
            counts.forEach((count, bucket) => {
                const i = bucketIndex.get(bucket);
                if (i != null) y[i] = count;
            });
            return { label, x, y, total: [...counts.values()].reduce((s, c) => s + c, 0) };
        })
        .sort((a, b) => b.total - a.total)
        .map(({ label, x: sx, y }) => ({ label, x: sx, y }));

    // Labels: 'MM-DD' per day; 'HH:00' / 'HH:MM' within one day, day-prefixed
    // when the short span crosses midnight.
    const timeLabel = (b) => (granularity === 'hour' ? `${b.slice(11)}:00` : b.slice(11));
    const xLabels = granularity === 'day'
        ? buckets.map((d) => d.slice(5))
        : buckets.map((b) => (daySet.size > 1 ? `${b.slice(5, 10)} ${timeLabel(b)}` : timeLabel(b)));

    return { series, xLabels, granularity };
}

/**
 * Shape events for DayHourMatrix: ms timestamp, display student, state.
 * Student is the username, falling back to 'user <id>'; rows without a
 * parseable timestamp are dropped (the matrix requires ts > 0).
 *
 * @param {object[]} events rows from /learning-events/all
 * @returns {{ts:number, student:string, state:string}[]}
 */
export function toMatrixEvents(events, labelOf = eventState) {
    return (events ?? [])
        .map((e) => {
            if (!e) return null;
            const ts = new Date(e.timestamp).getTime();
            if (!(ts > 0)) return null;
            const student = e.username || (e.user_id != null ? `user ${e.user_id}` : 'unknown');
            return { ts, student, state: labelOf(e) };
        })
        .filter((e) => e !== null);
}

/**
 * Sorted unique clinical states over a set of events — the label list the
 * dashboard feeds createColorMap so activity charts share tab colors.
 * @param {object[]} events rows from /learning-events/all
 * @returns {string[]}
 */
export function eventStateLabels(events, labelOf = eventState) {
    const set = new Set((events ?? []).filter(Boolean).map((e) => labelOf(e)));
    return [...set].sort();
}
