// Shared learning_events aggregation helpers.
//
// WHY this module exists: the analytics dashboard (TnaDashboardV2) needs
// the SAME aggregations served at two different authorization scopes —
// the admin firehose (/api/analytics/*, requireAdmin, tenant-global) and
// the teacher's own-cohort views (/api/cohorts/:id/analytics/*, behind
// loadOwnedCohort() + a live-member id set). Rather than duplicate the
// SQL + the TNA sequence pipeline (verb-merge → rare-collapse → group →
// p95-chunk) in both places, both call these functions. The return
// shapes are the literal contract the SVG chart components expect — do
// not change a key here without updating the charts AND the equivalence
// test in tests/server/learning-event-aggregates.test.js.
//
// SECURITY: buildEventFilter() never interpolates a request value. Every
// caller-supplied value goes through the params array as a `?`
// placeholder. The only interpolated tokens are (a) the column `alias`
// (a server-passed constant like 'le.'), and (b) the `?,?,?` placeholder
// string for the member IN-list (markers only, never values). This file
// is allowlisted in tests/server/sql-injection-guard.test.js on exactly
// that basis.

import { TNA_MERGE_MAP, normalizeVerb, tnaMergeTarget, activityLabel, LENSES } from '../shared/eventFacets.js';
import { toIsoZ } from '../shared/time.js';

function isDateOnly(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Pure WHERE-clause builder over learning_events. The request-bound
// wrapper (analytics-routes buildLearningEventWhere) and the cohort
// routes both map their inputs into this one shape.
//
//   tenantId   (required) — always scoped.
//   caseId     filter by le.case_id
//   userId     filter by le.user_id (single student)
//   sessionId  filter by le.session_id (per-session deep dive — NEW;
//              the admin path never set this before)
//   courseId   filter by active course enrolment (cohort_members)
//   memberIds  array → le.user_id IN (...). [] means "no members" and
//              yields 1=0 so an empty cohort returns zero rows instead
//              of (wrongly) the whole tenant.
//   startDate / endDate — timestamp window; a date-only endDate is
//              treated as inclusive of that whole day (< next day). A full
//              instant is normalised to the contract shape (RPS-1 §17) so a
//              bound like '2026-05-01T09:00:00Z' compares correctly against
//              stored '…T09:00:00.000Z' rows.
//   room       filter by le.room (a core room key or a plugin id)
//   alias      table alias prefix, e.g. 'le.' for joined queries.
function buildEventFilter({
    tenantId,
    caseId,
    userId,
    sessionId,
    courseId,
    memberIds,
    startDate,
    endDate,
    room,
    alias = '',
} = {}) {
    const prefix = alias ? (alias.endsWith('.') ? alias : `${alias}.`) : '';
    const col = (name) => `${prefix}${name}`;
    const clauses = [`${col('tenant_id')} = ?`];
    const params = [tenantId];

    if (caseId) {
        clauses.push(`${col('case_id')} = ?`);
        params.push(caseId);
    }
    if (userId) {
        clauses.push(`${col('user_id')} = ?`);
        params.push(userId);
    }
    if (sessionId) {
        clauses.push(`${col('session_id')} = ?`);
        params.push(sessionId);
    }
    if (courseId) {
        clauses.push(`EXISTS (
            SELECT 1
              FROM cohort_members cm
              JOIN cohorts co ON co.id = cm.cohort_id
             WHERE cm.user_id = ${col('user_id')}
               AND cm.cohort_id = ?
               AND cm.deleted_at IS NULL
               AND co.deleted_at IS NULL
               AND co.tenant_id = ?
        )`);
        params.push(courseId, tenantId);
    }
    if (Array.isArray(memberIds)) {
        if (memberIds.length === 0) {
            // Empty cohort → match nothing. Without this an absent IN
            // clause would silently widen to the whole tenant.
            clauses.push('1 = 0');
        } else {
            const markers = memberIds.map(() => '?').join(',');
            clauses.push(`${col('user_id')} IN (${markers})`);
            params.push(...memberIds);
        }
    }
    if (room) {
        clauses.push(`${col('room')} = ?`);
        params.push(String(room));
    }
    if (startDate) {
        clauses.push(`${col('timestamp')} >= ?`);
        params.push(isDateOnly(startDate) ? startDate : (toIsoZ(startDate) ?? startDate));
    }
    if (endDate) {
        if (isDateOnly(endDate)) {
            clauses.push(`${col('timestamp')} < date(?, '+1 day')`);
            params.push(endDate);
        } else {
            clauses.push(`${col('timestamp')} <= ?`);
            params.push(toIsoZ(endDate) ?? endDate);
        }
    }

    return { where: `WHERE ${clauses.join(' AND ')}`, params };
}

// GET /analytics/summary contract.
async function summary(dbAdapter, filter) {
    const { where, params } = filter;
    const row = await dbAdapter.get(
        `SELECT COUNT(*) AS totalActivities,
                COUNT(DISTINCT user_id) AS uniqueUsers,
                COUNT(DISTINCT session_id) AS uniqueSessions
           FROM learning_events ${where}`,
        params
    );
    const total = row?.totalActivities || 0;
    const users = row?.uniqueUsers || 0;
    return {
        totalActivities: total,
        uniqueUsers: users,
        uniqueSessions: row?.uniqueSessions || 0,
        avgPerUser: users > 0 ? Math.round(total / users) : 0,
    };
}

// GET /analytics/daily-counts contract.
async function dailyCounts(dbAdapter, filter) {
    const { where, params } = filter;
    const rows = await dbAdapter.all(
        `SELECT date(timestamp) AS day, COUNT(*) AS n
           FROM learning_events ${where}
          GROUP BY day ORDER BY day`,
        params
    );
    return { daily: rows.map((r) => ({ date: r.day, count: r.n })) };
}

// GET /analytics/hourly-counts contract — dense 7×24 grid; SQLite
// strftime('%w') is 0(Sun)..6(Sat), same as JS Date.getDay().
async function hourlyCounts(dbAdapter, filter) {
    const { where, params } = filter;
    const rows = await dbAdapter.all(
        `SELECT CAST(strftime('%w', timestamp) AS INTEGER) AS dow,
                CAST(strftime('%H', timestamp) AS INTEGER) AS hour,
                COUNT(*) AS n
           FROM learning_events ${where}
          GROUP BY dow, hour ORDER BY dow, hour`,
        params
    );
    const observed = new Map();
    for (const r of rows) {
        if (Number.isInteger(r.dow) && Number.isInteger(r.hour)) {
            observed.set(`${r.dow}:${r.hour}`, r.n);
        }
    }
    const grid = [];
    for (let dow = 0; dow < 7; dow++) {
        for (let hour = 0; hour < 24; hour++) {
            grid.push({ dow, hour, count: observed.get(`${dow}:${hour}`) || 0 });
        }
    }
    return { hourly: grid };
}

/**
 * Fold grouped rows whose verb is a historical alias into the canonical
 * verb's row, summing the count. Done in JS after the GROUP BY rather than
 * as a CASE inside it: a generated CASE in GROUP BY defeats
 * idx_learning_events_verb and grows with every alias, while a post-merge
 * over a few hundred grouped rows is free.
 *
 * @param {Array<object>} rows   grouped rows
 * @param {string} verbKey       the field holding the verb ('verb' or 'label')
 * @param {string} countKey      the field holding the count ('n' or 'count')
 * @param {string[]} [alsoKey]   extra fields forming the group (e.g. ['day'])
 */
function mergeByCanonicalVerb(rows, verbKey, countKey, alsoKey = []) {
    const merged = new Map();
    for (const r of rows) {
        const canonical = normalizeVerb(r[verbKey]);
        const key = [canonical, ...alsoKey.map((k) => r[k])].join('\u0000');
        const existing = merged.get(key);
        if (existing) existing[countKey] += r[countKey];
        else merged.set(key, { ...r, [verbKey]: canonical });
    }
    return [...merged.values()];
}

// GET /analytics/timeline-series contract — top 10 verbs by total,
// remainder folded into a synthetic 'OTHER' series.
async function timelineSeries(dbAdapter, filter) {
    const { where, params } = filter;
    const rows = mergeByCanonicalVerb(await dbAdapter.all(
        `SELECT date(timestamp) AS day, verb, COUNT(*) AS n
           FROM learning_events ${where}
          GROUP BY day, verb ORDER BY day, verb`,
        params
    ), 'verb', 'n', ['day']);
    if (!rows.length) return { days: [], verbs: [], series: {} };

    const dayIdx = new Map();
    const days = [];
    const verbTotals = new Map();
    for (const r of rows) {
        if (!dayIdx.has(r.day)) {
            dayIdx.set(r.day, days.length);
            days.push(r.day);
        }
        verbTotals.set(r.verb, (verbTotals.get(r.verb) || 0) + r.n);
    }

    const TOP = 10;
    const sortedVerbs = [...verbTotals.entries()].sort((a, b) => b[1] - a[1]);
    const topVerbs = new Set(sortedVerbs.slice(0, TOP).map(([v]) => v));
    const verbs = [...topVerbs];
    if (sortedVerbs.length > TOP) verbs.push('OTHER');

    const series = {};
    for (const v of verbs) series[v] = Array(days.length).fill(0);
    for (const r of rows) {
        const i = dayIdx.get(r.day);
        const bucket = topVerbs.has(r.verb) ? r.verb : 'OTHER';
        if (series[bucket]) series[bucket][i] += r.n;
    }
    return { days, verbs, series };
}

// GET /analytics/stats contract — verb + object_type frequency.
async function stats(dbAdapter, filter) {
    const { where, params } = filter;
    const verbs = mergeByCanonicalVerb(await dbAdapter.all(
        `SELECT verb AS label, COUNT(*) AS count
           FROM learning_events ${where}
          GROUP BY verb ORDER BY count DESC`,
        params
    ) || [], 'label', 'count').sort((a, b) => b.count - a.count);
    const objectTypes = await dbAdapter.all(
        `SELECT object_type AS label, COUNT(*) AS count
           FROM learning_events ${where}
          GROUP BY object_type ORDER BY count DESC`,
        params
    );
    return { verbs: verbs || [], objectTypes: objectTypes || [] };
}

// GET /analytics/top-resources contract.
async function topResources(dbAdapter, filter, limit = 10) {
    const params = [...filter.params];
    const capped = Math.min(parseInt(limit, 10) || 10, 100);
    params.push(capped);
    const rows = await dbAdapter.all(
        `SELECT object_type, object_name, COUNT(*) AS n
           FROM learning_events
          ${filter.where}
            AND object_name IS NOT NULL AND object_name != ''
          GROUP BY object_type, object_name ORDER BY n DESC LIMIT ?`,
        params
    );
    return { resources: rows || [] };
}

// Verb-merge map for TNA sequence construction, derived from the verb
// registry's `tnaMerge` facet (server/shared/eventFacets.js) so plugin verbs
// merge like rohy's own instead of surviving as rare singletons that the
// minVerbPct pass then collapses to 'OTHER'. `null` means "drop this event
// from the sequence" (session control, config, heartbeats). Exported under
// the name of the literal it replaced.
const TNA_VERB_MERGE_MAP = TNA_MERGE_MAP;

// GET /analytics/tna-sequences contract. Pipeline (order matters):
//   1. SELECT rows (filtered) joined to cases for the title.
//   2. Optional verb-merge via TNA_VERB_MERGE_MAP (null ⇒ drop event).
//   3. Rare-verb collapsing: verbs under minVerbPct become 'OTHER'.
//   4. Group into sequences by actor or actor::session.
//   5. Min-length filter.
//   6. P95 chunking so one runaway tab can't blow up the distance matrix.
//
// `filter` must have been built with alias 'le.' (joined query).
//
// `lens` selects how each row is LABELLED before grouping:
//   'tna'            (default) the historical merge map + rare-verb collapse —
//                    byte-identical to the pre-lens behaviour
//   any LENSES value  the shared activity resolver (server/shared/eventFacets.js)
//                    — the SAME function the client dashboards label with, so
//                    a cohort report and the admin dashboard agree. A curated
//                    lens has no long tail, so the rare-verb collapse is skipped.
async function tnaSequences(dbAdapter, filter, {
    minLen = 2,
    minVerbPct = 0.05,
    skipMerges = false,
    grouping = 'actor-session',
    lens = 'tna',
} = {}) {
    const useLens = lens !== 'tna' && LENSES.includes(lens);
    const rows = await dbAdapter.all(
        `SELECT le.user_id, le.session_id, le.verb, le.object_type, le.object_id, le.result, le.timestamp,
                c.name AS case_title
           FROM learning_events le
           LEFT JOIN cases c ON c.id = le.case_id AND c.tenant_id = le.tenant_id
           ${filter.where}
          ORDER BY le.user_id ASC, le.session_id ASC, le.timestamp ASC, le.id ASC
          LIMIT 50000`,
        filter.params
    );

    const emptyResult = {
        sequences: [],
        objectTypeSequences: [],
        metadata: {
            totalSequences: 0,
            totalEvents: 0,
            groupBy: grouping,
            uniqueVerbs: [],
            uniqueObjectTypes: [],
            caseTitle: null,
            dateRange: null,
        },
    };
    if (!rows || rows.length === 0) return emptyResult;

    // 1. Apply verb merge unless skipped. Null mapping ⇒ drop event.
    const merged = [];
    for (const row of rows) {
        if (useLens) {
            merged.push({ ...row, verb: activityLabel(row.verb, row.object_type, lens, undefined, { objectId: row.object_id, result: row.result }) });
            continue;
        }
        // Historical verb strings are read as their canonical name; a verb
        // the registry has never heard of passes through raw so it stays
        // visible rather than vanishing. The object type can refine a bare
        // UI verb's target (a SEARCHED on a lab_test is ordering work).
        let v = normalizeVerb(row.verb);
        if (!skipMerges) {
            const target = tnaMergeTarget(row.verb, row.object_type);
            if (target !== undefined) {
                if (target === null) continue;
                v = target;
            }
        }
        merged.push({ ...row, verb: v });
    }

    // 2. Rare-verb collapsing (the 'tna' lens only).
    const verbCounts = Object.create(null);
    for (const m of merged) verbCounts[m.verb] = (verbCounts[m.verb] || 0) + 1;
    const totalEvents = merged.length;
    const rareVerbs = new Set();
    if (!useLens && minVerbPct > 0 && totalEvents > 0) {
        for (const [v, count] of Object.entries(verbCounts)) {
            if (count / totalEvents < minVerbPct) rareVerbs.add(v);
        }
    }

    // 3. Group into sequences. Null session falls back to actor.
    const seqMap = Object.create(null);
    const objMap = Object.create(null);
    for (const m of merged) {
        const key = grouping === 'actor-session' && m.session_id
            ? `${m.user_id}::${m.session_id}`
            : String(m.user_id);
        if (!seqMap[key]) { seqMap[key] = []; objMap[key] = []; }
        seqMap[key].push(rareVerbs.has(m.verb) ? 'OTHER' : m.verb);
        objMap[key].push(m.object_type || '');
    }

    // 4. Min-length filter.
    const rawSeqs = [];
    const rawObjSeqs = [];
    for (const key of Object.keys(seqMap)) {
        if (seqMap[key].length >= minLen) {
            rawSeqs.push(seqMap[key]);
            rawObjSeqs.push(objMap[key]);
        }
    }

    // 5. P95 chunking. cap = max(p95, 2×minLen).
    const sequences = [];
    const objectTypeSequences = [];
    if (rawSeqs.length > 0) {
        const lens = rawSeqs.map((s) => s.length).sort((a, b) => a - b);
        const p95Idx = Math.floor(lens.length * 0.95);
        const p95 = lens[Math.min(p95Idx, lens.length - 1)];
        const maxLen = Math.max(p95, minLen * 2);

        for (let i = 0; i < rawSeqs.length; i++) {
            if (rawSeqs[i].length <= maxLen) {
                sequences.push(rawSeqs[i]);
                objectTypeSequences.push(rawObjSeqs[i]);
            } else {
                for (let s = 0; s < rawSeqs[i].length; s += maxLen) {
                    const chunk = rawSeqs[i].slice(s, s + maxLen);
                    const objChunk = rawObjSeqs[i].slice(s, s + maxLen);
                    if (chunk.length >= minLen) {
                        sequences.push(chunk);
                        objectTypeSequences.push(objChunk);
                    }
                }
            }
        }
    }

    // 6. Metadata.
    const uniqueVerbs = new Set();
    const uniqueObjectTypes = new Set();
    for (let i = 0; i < sequences.length; i++) {
        for (const v of sequences[i]) uniqueVerbs.add(v);
        for (const o of objectTypeSequences[i]) if (o) uniqueObjectTypes.add(o);
    }
    const caseTitle = rows.find((r) => r.case_title)?.case_title || null;
    const dateRange = rows.length
        ? { start: rows[0].timestamp, end: rows[rows.length - 1].timestamp }
        : null;

    return {
        sequences,
        objectTypeSequences,
        metadata: {
            totalSequences: sequences.length,
            totalEvents,
            groupBy: grouping,
            lens,
            uniqueVerbs: [...uniqueVerbs].sort(),
            uniqueObjectTypes: [...uniqueObjectTypes].sort(),
            caseTitle,
            dateRange,
        },
    };
}

export {
    buildEventFilter,
    mergeByCanonicalVerb,
    summary,
    dailyCounts,
    hourlyCounts,
    timelineSeries,
    stats,
    topResources,
    tnaSequences,
    TNA_VERB_MERGE_MAP,
};
