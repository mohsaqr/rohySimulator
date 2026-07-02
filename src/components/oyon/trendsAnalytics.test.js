// Contract tests for the pure trends analytics (port of chatoyon's trends.mjs
// dailyMeans + activityHeatmap, adapted to Rohy's flat emotion-record rows).
//
// Timestamps are built with the LOCAL Date constructor and serialized via
// toISOString(), so the local getters inside trendsAnalytics recover the
// intended day/hour/weekday in any timezone the suite runs in.

import { describe, it, expect } from 'vitest';
import { trendsAnalytics, localParts } from './trendsAnalytics.js';

// Local-clock ISO stamp: iso(2026, 6, 15, 14, 30) = June 15 2026, 14:30 local.
function iso(year, month, day, hour = 12, minute = 0) {
    return new Date(year, month - 1, day, hour, minute).toISOString();
}

function record({
    start = iso(2026, 6, 15, 14, 30),
    session = 's1',
    valence = 0.4,
    arousal = 0.2,
    emotion = 'neutral',
    room = 'chat',
} = {}) {
    return {
        window_start: start,
        session_id: session,
        valence,
        arousal,
        dominant_emotion: emotion,
        room,
        case_id: 'c1',
        case_title_snapshot: 'Chest pain',
        username: 'student',
    };
}

// 2026-06-15 is a Monday, 2026-06-16 a Tuesday, 2026-06-21 a Sunday
// (hand-checked: new Date(2026, 5, 15).getDay() === 1).
const MON = { y: 2026, m: 6, d: 15 };
const TUE = { y: 2026, m: 6, d: 16 };
const SUN = { y: 2026, m: 6, d: 21 };

describe('localParts', () => {
    it('reads day/hour/weekday from the local clock', () => {
        const p = localParts(iso(MON.y, MON.m, MON.d, 14, 30));
        expect(p).toEqual({ day: '2026-06-15', hour: 14, weekday: 1 });
    });

    it('is null for missing or unparsable timestamps', () => {
        expect(localParts(undefined)).toBeNull();
        expect(localParts('')).toBeNull();
        expect(localParts('not-a-date')).toBeNull();
    });
});

describe('trendsAnalytics — daily means', () => {
    it('buckets by local calendar day and returns chronological order from newest-first input', () => {
        // Newest-first, as the API serves them.
        const a = trendsAnalytics([
            record({ start: iso(TUE.y, TUE.m, TUE.d, 9, 5), session: 's2', valence: -0.2, arousal: 0.6 }),
            record({ start: iso(MON.y, MON.m, MON.d, 15, 0), session: 's1', valence: 0.6, arousal: 0.0 }),
            record({ start: iso(MON.y, MON.m, MON.d, 14, 30), session: 's1', valence: 0.2, arousal: 0.4 }),
        ]);
        expect(a.daily.map((d) => d.day)).toEqual(['2026-06-15', '2026-06-16']);
        expect(a.daily[0].windows).toBe(2);
        expect(a.daily[0].sessions).toBe(1);
        expect(a.daily[0].avgValence).toBeCloseTo(0.4, 10);
        expect(a.daily[0].avgArousal).toBeCloseTo(0.2, 10);
        expect(a.daily[1].windows).toBe(1);
        expect(a.daily[1].avgValence).toBeCloseTo(-0.2, 10);
    });

    it('keeps records on either side of local midnight in separate days', () => {
        const a = trendsAnalytics([
            record({ start: iso(TUE.y, TUE.m, TUE.d, 0, 5) }),
            record({ start: iso(MON.y, MON.m, MON.d, 23, 55) }),
        ]);
        expect(a.daily.map((d) => d.day)).toEqual(['2026-06-15', '2026-06-16']);
        expect(a.daily.map((d) => d.windows)).toEqual([1, 1]);
    });

    it('means skip null affect — null, never 0, when a day has no values', () => {
        const a = trendsAnalytics([
            record({ start: iso(MON.y, MON.m, MON.d, 10, 0), valence: null, arousal: null }),
            record({ start: iso(MON.y, MON.m, MON.d, 11, 0), valence: 0.5, arousal: null }),
            record({ start: iso(TUE.y, TUE.m, TUE.d, 10, 0), valence: null, arousal: null }),
        ]);
        // Day 1: mean over the single non-null valence, arousal has none.
        expect(a.daily[0].avgValence).toBeCloseTo(0.5, 10);
        expect(a.daily[0].avgArousal).toBeNull();
        // Day 2: nothing measured at all.
        expect(a.daily[1].avgValence).toBeNull();
        expect(a.daily[1].avgArousal).toBeNull();
        // Summary means also skip nulls.
        expect(a.summary.avgValence).toBeCloseTo(0.5, 10);
        expect(a.summary.avgArousal).toBeNull();
    });

    it('picks the modal dominant emotion per day', () => {
        const a = trendsAnalytics([
            record({ start: iso(MON.y, MON.m, MON.d, 10, 0), emotion: 'happy' }),
            record({ start: iso(MON.y, MON.m, MON.d, 11, 0), emotion: 'happy' }),
            record({ start: iso(MON.y, MON.m, MON.d, 12, 0), emotion: 'sad' }),
            record({ start: iso(TUE.y, TUE.m, TUE.d, 10, 0), emotion: null }),
        ]);
        expect(a.daily[0].dominantEmotion).toBe('happy');
        expect(a.daily[1].dominantEmotion).toBeNull();
    });
});

describe('trendsAnalytics — summary', () => {
    it('counts windows, distinct sessions, active days, and the day span', () => {
        const a = trendsAnalytics([
            record({ start: iso(SUN.y, SUN.m, SUN.d, 23, 45), session: 's3' }),
            record({ start: iso(TUE.y, TUE.m, TUE.d, 9, 5), session: 's2' }),
            record({ start: iso(MON.y, MON.m, MON.d, 14, 30), session: 's1' }),
            record({ start: iso(MON.y, MON.m, MON.d, 15, 0), session: 's1' }),
        ]);
        expect(a.summary.windows).toBe(4);
        expect(a.summary.sessions).toBe(3);
        expect(a.summary.daysActive).toBe(3);
        expect(a.summary.firstDay).toBe('2026-06-15');
        expect(a.summary.lastDay).toBe('2026-06-21');
    });

    it('still counts records with a broken timestamp in windows/sessions, but not on the calendar', () => {
        const a = trendsAnalytics([
            record({ start: iso(MON.y, MON.m, MON.d, 14, 30), session: 's1' }),
            record({ start: 'not-a-date', session: 's2' }),
        ]);
        expect(a.summary.windows).toBe(2);
        expect(a.summary.sessions).toBe(2);
        expect(a.summary.daysActive).toBe(1);
        expect(a.heatmap.total).toBe(1);
    });
});

describe('trendsAnalytics — activity heatmap', () => {
    it('places records at [Mon-first weekday][local hour] — hand-checked cells', () => {
        const a = trendsAnalytics([
            record({ start: iso(MON.y, MON.m, MON.d, 14, 30) }), // Monday 14:xx
            record({ start: iso(MON.y, MON.m, MON.d, 14, 55) }), // Monday 14:xx
            record({ start: iso(SUN.y, SUN.m, SUN.d, 23, 45) }), // Sunday 23:xx
        ]);
        expect(a.heatmap.grid).toHaveLength(7);
        expect(a.heatmap.grid[0]).toHaveLength(24);
        expect(a.heatmap.grid[0][14]).toBe(2); // row 0 = Monday, hour 14
        expect(a.heatmap.grid[6][23]).toBe(1); // row 6 = Sunday, hour 23
        expect(a.heatmap.max).toBe(2);
        expect(a.heatmap.total).toBe(3);
        // Every other cell is untouched.
        const sum = a.heatmap.grid.flat().reduce((x, y) => x + y, 0);
        expect(sum).toBe(3);
    });
});

describe('trendsAnalytics — by room', () => {
    it('breaks down valence per room, largest first, with (unknown) fallback', () => {
        const a = trendsAnalytics([
            record({ room: 'chat', valence: 0.2 }),
            record({ room: 'chat', valence: 0.6 }),
            record({ room: 'examination', valence: -0.4 }),
            record({ room: null, valence: null }),
        ]);
        expect(a.byRoom.map((r) => r.room)).toEqual(['chat', 'examination', '(unknown)']);
        expect(a.byRoom[0].windows).toBe(2);
        expect(a.byRoom[0].avgValence).toBeCloseTo(0.4, 10);
        expect(a.byRoom[1].avgValence).toBeCloseTo(-0.4, 10);
        expect(a.byRoom[2].avgValence).toBeNull();
    });
});

describe('trendsAnalytics — empty input', () => {
    it('returns zeroed/null shapes, never NaN', () => {
        for (const input of [[], undefined, null]) {
            const a = trendsAnalytics(input);
            expect(a.summary).toEqual({
                windows: 0,
                sessions: 0,
                daysActive: 0,
                firstDay: null,
                lastDay: null,
                avgValence: null,
                avgArousal: null,
            });
            expect(a.daily).toEqual([]);
            expect(a.heatmap.max).toBe(0);
            expect(a.heatmap.total).toBe(0);
            expect(a.heatmap.grid.flat().every((v) => v === 0)).toBe(true);
            expect(a.byRoom).toEqual([]);
        }
    });
});
