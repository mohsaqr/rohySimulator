// Time on task from learning events — the idle-capped estimator.
//
// Rohy cannot observe what a learner does between two clicks. The standard
// clickstream estimator (Kovanović, Gašević, Dawson, Joksimović, Baker &
// Hatala, 2015, "Penetrating the black box of time-on-task estimation") is
// therefore: sort a session's events, sum the gaps between consecutive
// events, and cap every gap at an idle threshold — a gap longer than the cap
// is credited as `cap` minutes (the learner was there for at least that long,
// then walked away). The last event of a session earns nothing: there is no
// following click to bound it, and inventing one would inflate every session
// by a constant.
//
// The dashboard used to show `max(timestamp) − min(timestamp)` over ALL
// filtered events as "Minutes". For one session that IS the span; for a
// cohort it is the calendar distance between the first and last event in the
// database — 147,585 min (102 days) on a local DB — which is why this module
// exists. `sessions.duration` is not a substitute: most sessions are never
// explicitly ended, so `end_time` is NULL and `duration` is NULL or stale.
//
// Grouping follows TNA exactly (`eventsToSequences`): one sequence per
// `session_id`, falling back to the user when an event carries no session.
// `sequenceGroupKey` is exported so both keep using ONE rule.
//
// Every function here is pure and takes plain event rows; nothing reads
// React state, so the server could run the same arithmetic.

import { timeMs, compareTime } from '../../../../server/shared/time.js';

export const DEFAULT_IDLE_CAP_MINUTES = 5;
export const IDLE_CAP_OPTIONS = [2, 5, 10, 30];

/**
 * Event timestamp → epoch milliseconds, or null.
 *
 * The rule this module used to own alone now lives in `server/shared/time.js`
 * (RPS-1 §17), because it was needed in ten more places than this one: every
 * other analytics table parsed timestamps naively and rendered server-stamped
 * rows at the viewer's UTC offset. Re-exported under the original name so the
 * TNA call sites and their tests keep reading as they did.
 *
 * @param {string|number|Date|null|undefined} value
 * @returns {number|null}
 */
export const eventTimeMs = timeMs;

/**
 * Chronological comparator — see `compareTime` in server/shared/time.js.
 *
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
export const compareEventTime = compareTime;

/**
 * The TNA grouping rule: a session is `s:<session_id>`; an event with no
 * session belongs to a per-user pseudo-session. `groupBy = 'actor'` collapses
 * everything a user did into one sequence.
 *
 * @param {object} event
 * @param {'actor-session'|'actor'} [groupBy]
 * @returns {string}
 */
export function sequenceGroupKey(event, groupBy = 'actor-session') {
    return groupBy === 'actor'
        ? `u:${event?.user_id ?? 'unknown'}`
        : `s:${event?.session_id ?? `u${event?.user_id ?? 'unknown'}`}`;
}

function median(values) {
    const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return 0;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function round1(x) {
    return Math.round(x * 10) / 10;
}

/**
 * Idle-capped time on task, per session, per user, and in total.
 *
 * @param {object[]} events                 learning-event rows (any order)
 * @param {object}   [options]
 * @param {number}   [options.idleCapMinutes=5]  a gap longer than this counts as this
 * @param {'actor-session'|'actor'} [options.groupBy='actor-session']
 * @returns {{
 *   idleCapMinutes: number,
 *   activeMinutes: number,        // Σ capped gaps, all sessions
 *   sessionMinutes: number,       // Σ (last − first), all sessions
 *   sessions: number,
 *   users: number,
 *   medianActivePerSession: number,
 *   medianSessionMinutes: number,
 *   perSession: Array<{ key, session_id, user_id, username, events, activeMinutes, sessionMinutes, firstMs, lastMs }>,
 *   perUser:    Array<{ user_id, username, sessions, events, activeMinutes, sessionMinutes, medianActivePerSession }>
 * }}
 * One row per session / per user. Minutes are rounded to 0.1 in the rows and
 * to whole minutes in the totals. Events without a parseable timestamp are
 * ignored for timing but still counted.
 */
export function timeOnTask(events, { idleCapMinutes = DEFAULT_IDLE_CAP_MINUTES, groupBy = 'actor-session' } = {}) {
    const cap = Number(idleCapMinutes);
    if (!Number.isFinite(cap) || cap <= 0) throw new RangeError(`idleCapMinutes must be a positive number, got ${idleCapMinutes}`);
    const capMs = cap * 60_000;

    const groups = new Map();
    for (const e of events ?? []) {
        if (!e) continue;
        const key = sequenceGroupKey(e, groupBy);
        let g = groups.get(key);
        if (!g) { g = { key, rows: [] }; groups.set(key, g); }
        g.rows.push(e);
    }

    const perSession = [];
    for (const { key, rows } of groups.values()) {
        rows.sort(compareEventTime);
        const times = rows.map((e) => eventTimeMs(e.timestamp)).filter((t) => t != null);
        let activeMs = 0;
        // A plain loop over adjacent pairs: the gap is a function of two
        // neighbours, which reduce()/map() only express with index juggling.
        for (let i = 1; i < times.length; i++) {
            const gap = times[i] - times[i - 1];
            if (gap > 0) activeMs += Math.min(gap, capMs);
        }
        const firstMs = times.length ? times[0] : null;
        const lastMs = times.length ? times[times.length - 1] : null;
        const spanMs = firstMs != null ? lastMs - firstMs : 0;
        const head = rows[0];
        perSession.push({
            key,
            session_id: head.session_id ?? null,
            user_id: head.user_id ?? null,
            username: rows.find((e) => e.username)?.username ?? null,
            events: rows.length,
            activeMinutes: round1(activeMs / 60_000),
            sessionMinutes: round1(spanMs / 60_000),
            firstMs,
            lastMs,
        });
    }
    perSession.sort((a, b) => (a.firstMs ?? Infinity) - (b.firstMs ?? Infinity) || String(a.key).localeCompare(String(b.key)));

    const byUser = new Map();
    for (const s of perSession) {
        const uid = s.user_id ?? 'unknown';
        let u = byUser.get(uid);
        if (!u) {
            u = { user_id: s.user_id ?? null, username: s.username, sessions: 0, events: 0, activeMinutes: 0, sessionMinutes: 0, actives: [] };
            byUser.set(uid, u);
        }
        u.sessions += 1;
        u.events += s.events;
        u.activeMinutes += s.activeMinutes;
        u.sessionMinutes += s.sessionMinutes;
        u.actives.push(s.activeMinutes);
        if (!u.username && s.username) u.username = s.username;
    }
    const perUser = [...byUser.values()]
        .map(({ actives, ...u }) => ({
            ...u,
            activeMinutes: round1(u.activeMinutes),
            sessionMinutes: round1(u.sessionMinutes),
            medianActivePerSession: round1(median(actives)),
        }))
        .sort((a, b) => b.activeMinutes - a.activeMinutes || String(a.username ?? a.user_id).localeCompare(String(b.username ?? b.user_id)));

    const activeMinutes = perSession.reduce((s, r) => s + r.activeMinutes, 0);
    const sessionMinutes = perSession.reduce((s, r) => s + r.sessionMinutes, 0);
    return {
        idleCapMinutes: cap,
        activeMinutes: Math.round(activeMinutes),
        sessionMinutes: Math.round(sessionMinutes),
        sessions: perSession.length,
        users: perUser.length,
        medianActivePerSession: round1(median(perSession.map((r) => r.activeMinutes))),
        medianSessionMinutes: round1(median(perSession.map((r) => r.sessionMinutes))),
        perSession,
        perUser,
    };
}
