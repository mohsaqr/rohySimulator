// Unit tests for server/lib/learningEventAggregates.js.
//
// These exercise the pure transformation logic (filter construction,
// grid densification, top-10/OTHER folding, the TNA merge → rare →
// group → p95 pipeline) against a fake dbAdapter so they're fast and
// deterministic. The end-to-end SQL contract is separately locked by
// tests/server/analytics-tna.test.js (real server, real SQLite); this
// file guards the JS the cohort scope newly depends on.

import { describe, it, expect } from 'vitest';
import {
    buildEventFilter,
    summary,
    hourlyCounts,
    timelineSeries,
    stats,
    topResources,
    tnaSequences,
    TNA_VERB_MERGE_MAP,
} from '../../server/lib/learningEventAggregates.js';

// Fake dbAdapter: routes by a discriminating substring of the SQL so
// the multi-query helpers (stats) get the right canned rows.
function fakeDb(routes) {
    const pick = (sql) => {
        for (const [needle, rows] of routes) {
            if (sql.includes(needle)) return rows;
        }
        return [];
    };
    return {
        all: async (sql) => pick(sql),
        get: async (sql) => pick(sql)[0],
    };
}

describe('buildEventFilter', () => {
    it('tenant-only baseline', () => {
        const f = buildEventFilter({ tenantId: 7 });
        expect(f.where).toBe('WHERE tenant_id = ?');
        expect(f.params).toEqual([7]);
    });

    it('orders clauses tenant→case→user→session→member→start→end and parameterises every value', () => {
        const f = buildEventFilter({
            tenantId: 1, caseId: 2, userId: 3, sessionId: 4,
            startDate: '2026-05-01T00:00:00Z', endDate: '2026-05-09T00:00:00Z',
        });
        expect(f.where).toBe(
            'WHERE tenant_id = ? AND case_id = ? AND user_id = ? AND session_id = ? '
            + 'AND timestamp >= ? AND timestamp <= ?'
        );
        expect(f.params).toEqual([1, 2, 3, 4, '2026-05-01T00:00:00Z', '2026-05-09T00:00:00Z']);
    });

    it('date-only end_date is treated as inclusive of the whole calendar day', () => {
        const f = buildEventFilter({ tenantId: 1, endDate: '2026-05-01' });
        expect(f.where).toContain("timestamp < date(?, '+1 day')");
        expect(f.params).toEqual([1, '2026-05-01']);
    });

    it('memberIds builds an IN list of ? markers (never values inline)', () => {
        const f = buildEventFilter({ tenantId: 1, memberIds: [10, 11, 12] });
        expect(f.where).toBe('WHERE tenant_id = ? AND user_id IN (?,?,?)');
        expect(f.params).toEqual([1, 10, 11, 12]);
    });

    it('empty memberIds yields 1=0 so an empty cohort matches no rows (not the whole tenant)', () => {
        const f = buildEventFilter({ tenantId: 1, memberIds: [] });
        expect(f.where).toBe('WHERE tenant_id = ? AND 1 = 0');
        expect(f.params).toEqual([1]);
    });

    it('alias prefixes every column (joined-query form)', () => {
        const f = buildEventFilter({ tenantId: 1, userId: 9, alias: 'le.' });
        expect(f.where).toBe('WHERE le.tenant_id = ? AND le.user_id = ?');
    });
});

describe('summary', () => {
    it('computes avgPerUser as round(total / uniqueUsers)', async () => {
        const db = fakeDb([['COUNT(*) AS totalActivities',
            [{ totalActivities: 10, uniqueUsers: 3, uniqueSessions: 4 }]]]);
        const out = await summary(db, buildEventFilter({ tenantId: 1 }));
        expect(out).toEqual({
            totalActivities: 10, uniqueUsers: 3, uniqueSessions: 4, avgPerUser: 3,
        });
    });

    it('avgPerUser is 0 when there are no users (no divide-by-zero)', async () => {
        const db = fakeDb([['COUNT(*) AS totalActivities',
            [{ totalActivities: 0, uniqueUsers: 0, uniqueSessions: 0 }]]]);
        const out = await summary(db, buildEventFilter({ tenantId: 1 }));
        expect(out.avgPerUser).toBe(0);
    });
});

describe('hourlyCounts', () => {
    it('expands sparse rows into a dense 7×24 grid with zeros', async () => {
        const db = fakeDb([['strftime', [
            { dow: 0, hour: 0, n: 5 },
            { dow: 6, hour: 23, n: 2 },
        ]]]);
        const { hourly } = await hourlyCounts(db, buildEventFilter({ tenantId: 1 }));
        expect(hourly).toHaveLength(7 * 24);
        expect(hourly[0]).toEqual({ dow: 0, hour: 0, count: 5 });
        expect(hourly[167]).toEqual({ dow: 6, hour: 23, count: 2 });
        expect(hourly[1]).toEqual({ dow: 0, hour: 1, count: 0 });
    });
});

describe('timelineSeries', () => {
    it('returns empty shape on no rows', async () => {
        const out = await timelineSeries(fakeDb([]), buildEventFilter({ tenantId: 1 }));
        expect(out).toEqual({ days: [], verbs: [], series: {} });
    });

    it('keeps top 10 verbs and folds the 11th+ into OTHER, one count per day', async () => {
        const rows = [];
        // 11 distinct verbs on day 1; V0 is busiest, V10 is rarest.
        for (let v = 0; v < 11; v++) {
            rows.push({ day: '2026-05-01', verb: `V${v}`, n: 11 - v });
        }
        rows.push({ day: '2026-05-02', verb: 'V0', n: 4 });
        const db = fakeDb([['date(timestamp) AS day, verb', rows]]);
        const { days, verbs, series } = await timelineSeries(db, buildEventFilter({ tenantId: 1 }));
        expect(days).toEqual(['2026-05-01', '2026-05-02']);
        expect(verbs).toContain('OTHER');
        expect(verbs).toHaveLength(11); // 10 top + OTHER
        expect(verbs).not.toContain('V10'); // rarest, folded
        expect(series.V0).toEqual([11, 4]);
        expect(series.OTHER).toEqual([1, 0]); // V10's single day-1 count
    });
});

describe('stats', () => {
    it('returns verb + objectType frequency arrays from the two queries', async () => {
        const db = fakeDb([
            ['verb AS label', [{ label: 'OPENED', count: 9 }]],
            ['object_type AS label', [{ label: 'component', count: 9 }]],
        ]);
        const out = await stats(db, buildEventFilter({ tenantId: 1 }));
        expect(out.verbs).toEqual([{ label: 'OPENED', count: 9 }]);
        expect(out.objectTypes).toEqual([{ label: 'component', count: 9 }]);
    });
});

describe('topResources', () => {
    it('caps the limit at 100 and appends it as the last param', async () => {
        let seenParams;
        const db = {
            all: async (_sql, params) => { seenParams = params; return [{ object_type: 'lab', object_name: 'CBC', n: 3 }]; },
        };
        const filter = buildEventFilter({ tenantId: 1 });
        const out = await topResources(db, filter, 9999);
        expect(out.resources).toEqual([{ object_type: 'lab', object_name: 'CBC', n: 3 }]);
        expect(seenParams[seenParams.length - 1]).toBe(100); // capped
        expect(filter.params).toEqual([1]); // original filter not mutated
    });
});

describe('TNA_VERB_MERGE_MAP', () => {
    it('includes CLICKED→NAVIGATION (the verb the partial-read nearly dropped)', () => {
        expect(TNA_VERB_MERGE_MAP.CLICKED).toBe('NAVIGATION');
    });
    it('maps system/config noise verbs to null (dropped from sequences)', () => {
        expect(TNA_VERB_MERGE_MAP.STARTED_SESSION).toBeNull();
        expect(TNA_VERB_MERGE_MAP.CHANGED_SETTING).toBeNull();
    });
});

describe('tnaSequences', () => {
    const ev = (user_id, session_id, verb, object_type, timestamp) =>
        ({ user_id, session_id, verb, object_type, timestamp, case_title: 'Sepsis Drill' });

    it('returns the empty contract when there are no rows', async () => {
        const out = await tnaSequences(fakeDb([]), buildEventFilter({ tenantId: 1, alias: 'le.' }));
        expect(out.sequences).toEqual([]);
        expect(out.objectTypeSequences).toEqual([]);
        expect(out.metadata.totalSequences).toBe(0);
        expect(out.metadata.groupBy).toBe('actor-session');
    });

    it('actor-session grouping splits one user across sessions; merge map collapses verbs', async () => {
        const rows = [
            ev(1, 100, 'STARTED_SESSION', 'session', '2026-05-01T09:00:00Z'), // → null, dropped
            ev(1, 100, 'OPENED', 'component', '2026-05-01T09:01:00Z'),         // → NAVIGATION
            ev(1, 100, 'CLICKED', 'button', '2026-05-01T09:02:00Z'),           // → NAVIGATION
            ev(1, 100, 'ORDERED_LAB', 'lab_test', '2026-05-01T09:03:00Z'),     // → ORDERED_LAB
            ev(1, 200, 'OPENED', 'component', '2026-05-01T10:00:00Z'),
            ev(1, 200, 'SENT_MESSAGE', 'chat', '2026-05-01T10:01:00Z'),
        ];
        const db = fakeDb([['FROM learning_events le', rows]]);
        const out = await tnaSequences(db, buildEventFilter({ tenantId: 1, alias: 'le.' }), {
            minLen: 2, minVerbPct: 0, skipMerges: false, grouping: 'actor-session',
        });
        // session 100 → [NAVIGATION, NAVIGATION, ORDERED_LAB]; session 200 → [NAVIGATION, SENT_MESSAGE]
        expect(out.metadata.totalSequences).toBe(2);
        expect(out.metadata.totalEvents).toBe(5); // STARTED_SESSION dropped by null-map
        expect(out.sequences).toContainEqual(['NAVIGATION', 'NAVIGATION', 'ORDERED_LAB']);
        expect(out.metadata.caseTitle).toBe('Sepsis Drill');
        expect(out.metadata.uniqueVerbs).toContain('NAVIGATION');
    });

    it('skipMerges keeps raw verbs; actor grouping concatenates a user across sessions', async () => {
        const rows = [
            ev(1, 100, 'OPENED', 'c', '2026-05-01T09:00:00Z'),
            ev(1, 200, 'CLICKED', 'b', '2026-05-01T10:00:00Z'),
        ];
        const db = fakeDb([['FROM learning_events le', rows]]);
        const out = await tnaSequences(db, buildEventFilter({ tenantId: 1, alias: 'le.' }), {
            minLen: 2, minVerbPct: 0, skipMerges: true, grouping: 'actor',
        });
        expect(out.metadata.totalSequences).toBe(1);
        expect(out.sequences[0]).toEqual(['OPENED', 'CLICKED']); // not merged
    });

    it('drops sequences shorter than minLen', async () => {
        const rows = [ev(1, 100, 'OPENED', 'c', '2026-05-01T09:00:00Z')];
        const db = fakeDb([['FROM learning_events le', rows]]);
        const out = await tnaSequences(db, buildEventFilter({ tenantId: 1, alias: 'le.' }), {
            minLen: 2, minVerbPct: 0, skipMerges: true, grouping: 'actor-session',
        });
        expect(out.metadata.totalSequences).toBe(0);
    });
});
