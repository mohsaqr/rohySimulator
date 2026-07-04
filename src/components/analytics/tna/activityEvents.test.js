// Pure-function contract for activityEvents.js — the /learning-events/all →
// carmdash-chart mappers used by TnaDashboardV2's Activity tab.
import { describe, expect, it } from 'vitest';
import {
    eventState, eventStateLabels, filterEvents, toDailyStateSeries, toMatrixEvents,
} from './activityEvents';

const ev = (over = {}) => ({
    timestamp: '2026-06-01T10:00:00.000Z',
    user_id: 1,
    username: 'amina',
    verb: 'ORDERED_LAB',
    object_type: 'lab_test',
    case_id: 'c1',
    ...over,
});

describe('eventState — clinicalStates resolution chain', () => {
    it('explicit verb:object pair wins (VIEWED:lab_result → assessing, not navigating)', () => {
        expect(eventState({ verb: 'VIEWED', object_type: 'lab_result' })).toBe('assessing');
    });

    it('object override fires when no explicit pair matches', () => {
        // CLICKED falls back to navigating, but object_type medication overrides.
        expect(eventState({ verb: 'CLICKED', object_type: 'medication' })).toBe('treating');
    });

    it('verb fallback fires when the object type is unknown', () => {
        expect(eventState({ verb: 'ORDERED_LAB', object_type: 'mystery_widget' })).toBe('investigating');
    });

    it('unknown verb+object yields the visible literal; bare unknown verb stays the verb', () => {
        expect(eventState({ verb: 'ZAPPED', object_type: 'widget' })).toBe('ZAPPED_widget');
        expect(eventState({ verb: 'ZAPPED' })).toBe('ZAPPED');
    });

    it('tolerates missing fields', () => {
        expect(eventState({})).toBe('navigating');
        expect(eventState(undefined)).toBe('navigating');
    });
});

describe('filterEvents', () => {
    const rows = [
        ev({ case_id: 'c1', user_id: 1, timestamp: '2026-06-01T10:00:00.000Z' }),
        ev({ case_id: 'c2', user_id: 2, timestamp: '2026-06-03T10:00:00.000Z' }),
        ev({ case_id: 'c1', user_id: 2, timestamp: '2026-06-05 08:30:00' }), // sqlite format
    ];

    it('passes everything through with empty filters', () => {
        expect(filterEvents(rows, {})).toHaveLength(3);
        expect(filterEvents(rows)).toHaveLength(3);
    });

    it('filters by case and user with loose string/number matching', () => {
        expect(filterEvents(rows, { caseId: 'c1' })).toHaveLength(2);
        expect(filterEvents(rows, { userId: '2' })).toHaveLength(2);
        expect(filterEvents(rows, { caseId: 'c1', userId: '2' })).toHaveLength(1);
    });

    it('filters by course membership from comma-separated course ids', () => {
        const courseRows = [
            ev({ id: 1, course_ids: '1,2' }),
            ev({ id: 2, course_ids: '3' }),
            ev({ id: 3, course_ids: null }),
        ];
        expect(filterEvents(courseRows, { courseId: '2' }).map((r) => r.id)).toEqual([1]);
    });

    it('date bounds are inclusive on the ISO day, including sqlite timestamps', () => {
        expect(filterEvents(rows, { startDate: '2026-06-03' })).toHaveLength(2);
        expect(filterEvents(rows, { endDate: '2026-06-03' })).toHaveLength(2);
        expect(filterEvents(rows, { startDate: '2026-06-05', endDate: '2026-06-05' })).toHaveLength(1);
    });

    it('drops unparseable timestamps only when a date filter is active', () => {
        const bad = ev({ timestamp: 'not-a-date' });
        expect(filterEvents([bad], {})).toHaveLength(1);
        expect(filterEvents([bad], { startDate: '2026-01-01' })).toHaveLength(0);
    });

    it('handles null/undefined input', () => {
        expect(filterEvents(null, {})).toEqual([]);
        expect(filterEvents(undefined)).toEqual([]);
    });
});

describe('toDailyStateSeries (adaptive granularity)', () => {
    it('buckets by ISO day when the span covers 3+ days, sorting states by total desc', () => {
        const rows = [
            ev({ timestamp: '2026-06-01T09:00:00.000Z' }),             // investigating
            ev({ timestamp: '2026-06-01T10:00:00.000Z' }),             // investigating
            ev({ timestamp: '2026-06-03T10:00:00.000Z' }),             // investigating
            ev({ timestamp: '2026-06-05T11:00:00.000Z', verb: 'SENT_MESSAGE', object_type: 'chat_message' }), // communicating
        ];
        const { series, xLabels, granularity } = toDailyStateSeries(rows);

        expect(granularity).toBe('day');
        expect(xLabels).toEqual(['06-01', '06-03', '06-05']); // only days with events, sorted
        expect(series.map((s) => s.label)).toEqual(['investigating', 'communicating']);
        expect(series[0].x).toEqual([0, 1, 2]);
        expect(series[0].y).toEqual([2, 1, 0]);
        expect(series[1].y).toEqual([0, 0, 1]); // zero-filled where absent
    });

    it('drops to hour buckets on a short span, filling quiet hours with 0', () => {
        const rows = [
            ev({ timestamp: '2026-07-02T08:10:00.000Z' }),
            ev({ timestamp: '2026-07-02T08:40:00.000Z' }),
            ev({ timestamp: '2026-07-02T11:05:00.000Z' }),
            // sqlite-style row on the same day parses the same way
            ev({ timestamp: '2026-07-02 12:30:00' }),
        ];
        const { series, xLabels, granularity } = toDailyStateSeries(rows);

        expect(granularity).toBe('hour');
        expect(xLabels).toEqual(['08:00', '09:00', '10:00', '11:00', '12:00']); // gap hours filled
        expect(series[0].y).toEqual([2, 0, 0, 1, 1]);
    });

    it('drops to 5-minute bins when everything sits inside 1-2 hours', () => {
        const rows = [
            ev({ timestamp: '2026-07-02T08:01:00.000Z' }),
            ev({ timestamp: '2026-07-02T08:03:00.000Z' }),
            ev({ timestamp: '2026-07-02T08:17:00.000Z' }),
        ];
        const { series, xLabels, granularity } = toDailyStateSeries(rows);

        expect(granularity).toBe('5min');
        expect(xLabels).toEqual(['08:00', '08:05', '08:10', '08:15']);
        expect(series[0].y).toEqual([2, 0, 0, 1]);
    });

    it('drops rows without a parseable timestamp and handles empty input', () => {
        const emptyShape = { series: [], xLabels: [], granularity: '5min' };
        expect(toDailyStateSeries([ev({ timestamp: null })])).toEqual(emptyShape);
        expect(toDailyStateSeries([])).toEqual(emptyShape);
        expect(toDailyStateSeries(null)).toEqual(emptyShape);
    });
});

describe('toMatrixEvents', () => {
    it('maps to {ts, student, state} with username → "user N" fallback', () => {
        const rows = [
            ev({ username: 'amina' }),
            ev({ username: null, user_id: 7 }),
            ev({ username: '', user_id: null }),
        ];
        const out = toMatrixEvents(rows);
        expect(out).toHaveLength(3);
        expect(out[0]).toEqual({
            ts: new Date('2026-06-01T10:00:00.000Z').getTime(),
            student: 'amina',
            state: 'investigating',
        });
        expect(out[1].student).toBe('user 7');
        expect(out[2].student).toBe('unknown');
    });

    it('drops rows with unparseable timestamps', () => {
        expect(toMatrixEvents([ev({ timestamp: 'nope' }), ev()])).toHaveLength(1);
        expect(toMatrixEvents(null)).toEqual([]);
    });
});

describe('eventStateLabels', () => {
    it('returns the sorted unique state list (the createColorMap input)', () => {
        const rows = [
            ev(), // investigating
            ev({ verb: 'SENT_MESSAGE', object_type: 'chat_message' }), // communicating
            ev(), // investigating again
        ];
        expect(eventStateLabels(rows)).toEqual(['communicating', 'investigating']);
        expect(eventStateLabels([])).toEqual([]);
    });
});
