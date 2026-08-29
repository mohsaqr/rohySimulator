import { describe, it, expect } from 'vitest';
import {
    timeOnTask, eventTimeMs, compareEventTime, sequenceGroupKey,
    DEFAULT_IDLE_CAP_MINUTES, IDLE_CAP_OPTIONS,
} from './activityTime.js';
import { eventsToSequences } from './activityEvents.js';

const T0 = Date.UTC(2026, 5, 1, 10, 0, 0); // 2026-06-01T10:00:00Z
const at = (min, extra = {}) => ({ timestamp: new Date(T0 + min * 60_000).toISOString(), ...extra });

// One user, one session, four clicks: gaps 1, 12, 3 minutes.
// cap 5 → 1 + 5 + 3 = 9 active; span = 16.
const SESSION = [
    at(0, { id: 1, session_id: 7, user_id: 1, username: 'amina' }),
    at(1, { id: 2, session_id: 7, user_id: 1, username: 'amina' }),
    at(13, { id: 3, session_id: 7, user_id: 1, username: 'amina' }),
    at(16, { id: 4, session_id: 7, user_id: 1, username: 'amina' }),
];

describe('timeOnTask — the formula', () => {
    it('sums gaps capped at the idle threshold and gives the last event no credit (hand-computed)', () => {
        const r = timeOnTask(SESSION, { idleCapMinutes: 5 });
        expect(r.sessions).toBe(1);
        expect(r.users).toBe(1);
        expect(r.activeMinutes).toBe(9);
        expect(r.sessionMinutes).toBe(16);
        expect(r.perSession).toEqual([expect.objectContaining({
            session_id: 7, user_id: 1, username: 'amina', events: 4, activeMinutes: 9, sessionMinutes: 16,
        })]);
        expect(r.perUser).toEqual([expect.objectContaining({
            user_id: 1, username: 'amina', sessions: 1, events: 4, activeMinutes: 9, sessionMinutes: 16, medianActivePerSession: 9,
        })]);
    });

    it('defaults to a 5-minute cap and exposes the selectable options', () => {
        expect(DEFAULT_IDLE_CAP_MINUTES).toBe(5);
        expect(IDLE_CAP_OPTIONS).toContain(5);
        expect(timeOnTask(SESSION).idleCapMinutes).toBe(5);
    });

    it('a single-event session has zero active and zero span but still counts', () => {
        const r = timeOnTask([at(0, { session_id: 1, user_id: 1 })]);
        expect(r).toMatchObject({ sessions: 1, activeMinutes: 0, sessionMinutes: 0 });
    });

    it('groups like TNA: by session, falling back to the user when session_id is absent', () => {
        const rows = [
            at(0, { session_id: 1, user_id: 1 }), at(2, { session_id: 1, user_id: 1 }),
            at(0, { session_id: 2, user_id: 1 }), at(3, { session_id: 2, user_id: 1 }),
            at(0, { user_id: 2 }), at(4, { user_id: 2 }),
        ];
        const r = timeOnTask(rows);
        expect(r.sessions).toBe(3);
        expect(r.users).toBe(2);
        expect(r.perUser.find((u) => u.user_id === 1)).toMatchObject({ sessions: 2, activeMinutes: 5, medianActivePerSession: 2.5 });
        expect(r.perUser.find((u) => u.user_id === 2)).toMatchObject({ sessions: 1, activeMinutes: 4 });
        expect(sequenceGroupKey({ session_id: 9 })).toBe('s:9');
        expect(sequenceGroupKey({ user_id: 3 })).toBe('s:u3');
        expect(sequenceGroupKey({ session_id: 9, user_id: 3 }, 'actor')).toBe('u:3');
    });

    it('rejects a non-positive cap loudly', () => {
        expect(() => timeOnTask(SESSION, { idleCapMinutes: 0 })).toThrow(RangeError);
        expect(() => timeOnTask(SESSION, { idleCapMinutes: 'x' })).toThrow(RangeError);
    });

    it('tolerates empty input and rows without timestamps', () => {
        expect(timeOnTask([])).toMatchObject({ sessions: 0, users: 0, activeMinutes: 0, sessionMinutes: 0, perSession: [], perUser: [] });
        expect(timeOnTask(null).sessions).toBe(0);
        const r = timeOnTask([{ session_id: 1, user_id: 1 }, at(0, { session_id: 1, user_id: 1 }), at(2, { session_id: 1, user_id: 1 })]);
        expect(r.perSession[0]).toMatchObject({ events: 3, activeMinutes: 2 });
    });
});

describe('timeOnTask — invariants', () => {
    const rows = [
        ...SESSION,
        at(0, { id: 5, session_id: 8, user_id: 2, username: 'omar' }),
        at(40, { id: 6, session_id: 8, user_id: 2, username: 'omar' }),
        at(41, { id: 7, session_id: 8, user_id: 2, username: 'omar' }),
    ];

    it('active time never exceeds the session span', () => {
        for (const cap of IDLE_CAP_OPTIONS) {
            for (const s of timeOnTask(rows, { idleCapMinutes: cap }).perSession) {
                expect(s.activeMinutes).toBeLessThanOrEqual(s.sessionMinutes);
            }
        }
    });

    it('is monotone non-decreasing in the cap', () => {
        const totals = IDLE_CAP_OPTIONS.map((cap) => timeOnTask(rows, { idleCapMinutes: cap }).activeMinutes);
        for (let i = 1; i < totals.length; i++) expect(totals[i]).toBeGreaterThanOrEqual(totals[i - 1]);
        // With a cap beyond every gap, active equals the span.
        expect(timeOnTask(rows, { idleCapMinutes: 1000 }).activeMinutes).toBe(timeOnTask(rows).sessionMinutes);
    });

    it('is invariant to input order', () => {
        const shuffled = [...rows].reverse();
        expect(timeOnTask(shuffled)).toEqual(timeOnTask(rows));
    });

    it('the cohort total is the sum of the per-user rows', () => {
        const r = timeOnTask(rows);
        const sum = r.perUser.reduce((s, u) => s + u.activeMinutes, 0);
        expect(Math.round(sum)).toBe(r.activeMinutes);
    });
});

describe('eventTimeMs / compareEventTime — mixed timestamp formats', () => {
    it("pins sqlite's zone-less CURRENT_TIMESTAMP to UTC so it agrees with the client's ISO form", () => {
        expect(eventTimeMs('2026-06-01 10:00:00')).toBe(eventTimeMs('2026-06-01T10:00:00.000Z'));
        expect(eventTimeMs('2026-06-01 10:00:00.5')).toBe(T0 + 500);
        expect(eventTimeMs(null)).toBeNull();
        expect(eventTimeMs('not a date')).toBeNull();
        expect(eventTimeMs(T0)).toBe(T0);
        expect(eventTimeMs(new Date(T0))).toBe(T0);
    });

    // Regression lock: eventsToSequences sorted by STRING, and 'T' > ' ', so a
    // server-stamped row ('2026-06-01 10:05:00') sorted BEFORE a client row
    // ('2026-06-01T10:00:00.000Z') from five minutes earlier — reordering the
    // sequence and producing negative gaps in time-on-task.
    it('mixed formats sort chronologically, not lexically, and give the same time-on-task as uniform ones', () => {
        const mixed = [
            { id: 1, session_id: 1, user_id: 1, verb: 'A', object_type: 'x', timestamp: '2026-06-01T10:00:00.000Z' },
            { id: 2, session_id: 1, user_id: 1, verb: 'B', object_type: 'x', timestamp: '2026-06-01 10:05:00' },
            { id: 3, session_id: 1, user_id: 1, verb: 'C', object_type: 'x', timestamp: '2026-06-01T10:07:00.000Z' },
        ];
        const uniform = mixed.map((e) => ({ ...e, timestamp: new Date(eventTimeMs(e.timestamp)).toISOString() }));
        expect([...mixed].sort(compareEventTime).map((e) => e.verb)).toEqual(['A', 'B', 'C']);
        // String order would have been B, A, C:
        expect([...mixed].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1)).map((e) => e.verb)).toEqual(['B', 'A', 'C']);
        expect(timeOnTask(mixed)).toEqual(timeOnTask(uniform));
        expect(timeOnTask(mixed).activeMinutes).toBe(7);
        expect(eventsToSequences(mixed, { labelOf: (e) => e.verb })).toEqual([['A', 'B', 'C']]);
    });

    it('breaks timestamp ties by id and puts unparseable timestamps last', () => {
        const rows = [
            { id: 2, timestamp: '2026-06-01T10:00:00.000Z' },
            { id: 1, timestamp: '2026-06-01T10:00:00.000Z' },
            { id: 0, timestamp: 'garbage' },
        ];
        expect([...rows].sort(compareEventTime).map((r) => r.id)).toEqual([1, 2, 0]);
    });
});
