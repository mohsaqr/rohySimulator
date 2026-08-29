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

export const DEFAULT_IDLE_CAP_MINUTES = 5;
export const IDLE_CAP_OPTIONS = [2, 5, 10, 30];

const SQLITE_TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;

/**
 * Event timestamp → epoch milliseconds, or null.
 *
 * Two formats coexist in `learning_events.timestamp`: the client's ISO string
 * (`2026-05-05T06:51:11.552Z`) and sqlite's `CURRENT_TIMESTAMP` fallback
 * (`2026-05-06 15:07:52`), which is UTC but carries no zone marker. V8 parses
 * the latter as LOCAL time, so it must be pinned to UTC before comparison —
 * otherwise a server-stamped row lands hours away from the client-stamped
 * rows around it and gaps go negative.
 *
 * @param {string|number|Date|null|undefined} value
 * @returns {number|null}
 */
export function eventTimeMs(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    const s = String(value).trim();
    const t = new Date(SQLITE_TS.test(s) ? `${s.replace(' ', 'T')}Z` : s).getTime();
    return Number.isFinite(t) ? t : null;
}

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

/** Chronological comparator: numeric time, then id, then stable. */
export function compareEventTime(a, b) {
    const ta = eventTimeMs(a?.timestamp);
    const tb = eventTimeMs(b?.timestamp);
    if (ta != null && tb != null && ta !== tb) return ta - tb;
    if (ta == null && tb != null) return 1;
    if (ta != null && tb == null) return -1;
    if (ta == null && tb == null) {
        const sa = String(a?.timestamp ?? '');
        const sb = String(b?.timestamp ?? '');
        if (sa !== sb) return sa < sb ? -1 : 1;
    }
    const ia = Number(a?.id);
    const ib = Number(b?.id);
    if (Number.isFinite(ia) && Number.isFinite(ib)) return ia - ib;
    return 0;
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
