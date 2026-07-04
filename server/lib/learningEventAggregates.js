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
//              treated as inclusive of that whole day (< next day).
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
    if (startDate) {
        clauses.push(`${col('timestamp')} >= ?`);
        params.push(startDate);
    }
    if (endDate) {
        if (isDateOnly(endDate)) {
            clauses.push(`${col('timestamp')} < date(?, '+1 day')`);
        } else {
            clauses.push(`${col('timestamp')} <= ?`);
        }
        params.push(endDate);
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

// GET /analytics/timeline-series contract — top 10 verbs by total,
// remainder folded into a synthetic 'OTHER' series.
async function timelineSeries(dbAdapter, filter) {
    const { where, params } = filter;
    const rows = await dbAdapter.all(
        `SELECT date(timestamp) AS day, verb, COUNT(*) AS n
           FROM learning_events ${where}
          GROUP BY day, verb ORDER BY day, verb`,
        params
    );
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
    const verbs = await dbAdapter.all(
        `SELECT verb AS label, COUNT(*) AS count
           FROM learning_events ${where}
          GROUP BY verb ORDER BY count DESC`,
        params
    );
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

// Verb-merge map for TNA sequence construction. Lifted verbatim from the
// admin route so both scopes collapse the same way. `null` means "drop
// this event from the sequence" (system/config noise).
const TNA_VERB_MERGE_MAP = {
    // Navigation
    'VIEWED': 'NAVIGATION',
    'OPENED': 'NAVIGATION',
    'CLOSED': 'NAVIGATION',
    'NAVIGATED': 'NAVIGATION',
    'SWITCHED_TAB': 'NAVIGATION',
    'CLICKED': 'NAVIGATION',
    'SELECTED': 'NAVIGATION',
    'DESELECTED': 'NAVIGATION',
    'TOGGLED': 'NAVIGATION',
    'EXPANDED': 'NAVIGATION',
    'COLLAPSED': 'NAVIGATION',
    'SCROLLED': 'NAVIGATION',
    // Lab/Investigation
    'ORDERED_LAB': 'ORDERED_LAB',
    'SEARCHED_LABS': 'ORDERED_LAB',
    'FILTERED_LABS': 'ORDERED_LAB',
    'CANCELLED_LAB': 'ORDERED_LAB',
    // Lab results
    'VIEWED_LAB_RESULT': 'VIEWED_LAB_RESULT',
    'LAB_RESULT_READY': 'VIEWED_LAB_RESULT',
    // Treatment
    'ORDERED_MEDICATION': 'TREATMENT',
    'ADMINISTERED_MEDICATION': 'TREATMENT',
    'CANCELLED_MEDICATION': 'TREATMENT',
    'ORDERED_TREATMENT': 'TREATMENT',
    'PERFORMED_INTERVENTION': 'TREATMENT',
    'ORDERED_IV_FLUID': 'TREATMENT',
    'STARTED_OXYGEN': 'TREATMENT',
    'STOPPED_OXYGEN': 'TREATMENT',
    'ORDERED_NURSING': 'TREATMENT',
    'DISCONTINUED_TREATMENT': 'TREATMENT',
    'CONTRAINDICATED_TREATMENT_ORDERED': 'TREATMENT',
    'EXPECTED_TREATMENT_GIVEN': 'TREATMENT',
    'EXPECTED_TREATMENT_MISSED': 'TREATMENT',
    // Examination
    'PERFORMED_PHYSICAL_EXAM': 'EXAMINATION',
    'OPENED_EXAM_PANEL': 'EXAMINATION',
    'CLOSED_EXAM_PANEL': 'EXAMINATION',
    // Communication
    'SENT_MESSAGE': 'SENT_MESSAGE',
    'RECEIVED_MESSAGE': 'RECEIVED_MESSAGE',
    'COPIED_MESSAGE': 'SENT_MESSAGE',
    'EDITED_MESSAGE': 'SENT_MESSAGE',
    // Monitoring
    'ADJUSTED_VITAL': 'MONITORING',
    'VIEWED_TRENDS': 'MONITORING',
    // Alarm response
    'ACKNOWLEDGED_ALARM': 'ALARM_RESPONSE',
    'SILENCED_ALARM': 'ALARM_RESPONSE',
    'ALARM_TRIGGERED': 'ALARM_RESPONSE',
    // Patient records
    'VIEWED_PATIENT_SUMMARY': 'REVIEWED_RECORDS',
    'VIEWED_HISTORY': 'REVIEWED_RECORDS',
    'VIEWED_MEDICATIONS': 'REVIEWED_RECORDS',
    'VIEWED_ALLERGIES': 'REVIEWED_RECORDS',
    'VIEWED_PATIENT_INFO': 'REVIEWED_RECORDS',
    'VIEWED_RECORDS': 'REVIEWED_RECORDS',
    // System/config verbs excluded (mapped to null)
    'STARTED_SESSION': null,
    'ENDED_SESSION': null,
    'RESUMED_SESSION': null,
    'IDLE_TIMEOUT': null,
    'CHANGED_SETTING': null,
    'SAVED_SETTING': null,
    'RESET_SETTING': null,
    'LOADED_CASE': null,
    'STARTED_SCENARIO': null,
    'PAUSED_SCENARIO': null,
    'RESUMED_SCENARIO': null,
    'SUBMITTED': null,
    'ANSWERED': null,
    'ATTEMPTED': null,
    'TREATMENT_EFFECT_STARTED': null,
    'TREATMENT_EFFECT_PEAKED': null,
    'TREATMENT_EFFECT_ENDED': null,
};

// GET /analytics/tna-sequences contract. Pipeline (order matters):
//   1. SELECT rows (filtered) joined to cases for the title.
//   2. Optional verb-merge via TNA_VERB_MERGE_MAP (null ⇒ drop event).
//   3. Rare-verb collapsing: verbs under minVerbPct become 'OTHER'.
//   4. Group into sequences by actor or actor::session.
//   5. Min-length filter.
//   6. P95 chunking so one runaway tab can't blow up the distance matrix.
//
// `filter` must have been built with alias 'le.' (joined query).
async function tnaSequences(dbAdapter, filter, {
    minLen = 2,
    minVerbPct = 0.05,
    skipMerges = false,
    grouping = 'actor-session',
} = {}) {
    const rows = await dbAdapter.all(
        `SELECT le.user_id, le.session_id, le.verb, le.object_type, le.timestamp,
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
        let v = row.verb;
        if (!skipMerges && Object.prototype.hasOwnProperty.call(TNA_VERB_MERGE_MAP, v)) {
            v = TNA_VERB_MERGE_MAP[v];
            if (v === null) continue;
        }
        merged.push({ ...row, verb: v });
    }

    // 2. Rare-verb collapsing.
    const verbCounts = Object.create(null);
    for (const m of merged) verbCounts[m.verb] = (verbCounts[m.verb] || 0) + 1;
    const totalEvents = merged.length;
    const rareVerbs = new Set();
    if (minVerbPct > 0 && totalEvents > 0) {
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
            uniqueVerbs: [...uniqueVerbs].sort(),
            uniqueObjectTypes: [...uniqueObjectTypes].sort(),
            caseTitle,
            dateRange,
        },
    };
}

export {
    buildEventFilter,
    summary,
    dailyCounts,
    hourlyCounts,
    timelineSeries,
    stats,
    topResources,
    tnaSequences,
    TNA_VERB_MERGE_MAP,
};
