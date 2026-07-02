// Unit tests for the Case Insights math. Locks the pre/post overlap
// contract (half-open ranges, boundary window counts on both sides), the
// never-fabricate rule (empty side → nulls, null valence never coerced to
// 0, delta null unless both sides speak), the first-seen modal tie break,
// and the tidy (case, verb) summary shape with deterministic ordering.
//
// All fixtures are hand-computed — no snapshots.

import { describe, it, expect } from 'vitest';
import { triggerReaction, actionAffectSummary } from './caseInsights';

// The trigger fires at 08:01:00.000Z in every fixture.
const T = '2026-07-02T08:01:00.000Z';
const T_MS = Date.UTC(2026, 6, 2, 8, 1, 0);

// A 10s window offset from the trigger: start = T + startOffsetMs.
function makeWindow(startOffsetMs, overrides = {}) {
    return {
        session_id: 6,
        window_start: new Date(T_MS + startOffsetMs).toISOString(),
        window_end: new Date(T_MS + startOffsetMs + 10000).toISOString(),
        dominant_emotion: 'neutral',
        valence: 0.2,
        arousal: 0.1,
        gaze_json: JSON.stringify({
            aoi_dwell_ms: { vitals_values: 5000 },
            zone_proportions: { middle_center: 1 },
        }),
        ...overrides,
    };
}

describe('triggerReaction — pre/post overlap contract', () => {
    it('splits windows into pre and post around the trigger', () => {
        const windows = [
            makeWindow(-20000, { valence: -0.4, dominant_emotion: 'fear' }),   // pre only
            makeWindow(-10000, { valence: -0.2, dominant_emotion: 'fear' }),   // pre, ends exactly at T
            makeWindow(10000, { valence: 0.3, dominant_emotion: 'happy' }),    // post only
        ];
        const r = triggerReaction(windows, 6, T);
        expect(r.pre.windows).toBe(2);
        expect(r.pre.valence_mean).toBeCloseTo(-0.3, 10);
        expect(r.pre.emotion_dominant).toBe('fear');
        expect(r.post.windows).toBe(1);
        expect(r.post.valence_mean).toBeCloseTo(0.3, 10);
        expect(r.post.emotion_dominant).toBe('happy');
        expect(r.delta_valence).toBeCloseTo(0.6, 10);
    });

    it('counts a window straddling the trigger boundary on BOTH sides', () => {
        // 08:00:55 → 08:01:05 crosses T = 08:01:00.
        const straddler = makeWindow(-5000, { valence: 0.5 });
        const r = triggerReaction([straddler], 6, T);
        expect(r.pre.windows).toBe(1);
        expect(r.post.windows).toBe(1);
        expect(r.pre.valence_mean).toBeCloseTo(0.5, 10);
        expect(r.post.valence_mean).toBeCloseTo(0.5, 10);
        expect(r.delta_valence).toBeCloseTo(0, 10);
    });

    it('half-open edges: a window ending exactly at range start is out, starting exactly at range end is out', () => {
        // Ends exactly at T - 30000 → outside the pre range [T-30s, T).
        const tooEarly = makeWindow(-40000);
        // Starts exactly at T + 30000 → outside the post range [T, T+30s).
        const tooLate = makeWindow(30000);
        const r = triggerReaction([tooEarly, tooLate], 6, T);
        expect(r.pre.windows).toBe(0);
        expect(r.post.windows).toBe(0);
    });

    it('empty pre side → all-null pre, null delta, post still summarized', () => {
        const r = triggerReaction([makeWindow(5000, { valence: 0.4 })], 6, T);
        expect(r.pre).toEqual({
            valence_mean: null,
            gaze_dominant: null,
            emotion_dominant: null,
            windows: 0,
        });
        expect(r.post.windows).toBe(1);
        expect(r.post.valence_mean).toBeCloseTo(0.4, 10);
        expect(r.delta_valence).toBeNull();
    });

    it('all-null valence stays null (never coerced to 0), other fields still speak', () => {
        const windows = [
            makeWindow(-15000, { valence: null }),
            makeWindow(5000, { valence: null }),
        ];
        const r = triggerReaction(windows, 6, T);
        expect(r.pre.windows).toBe(1);
        expect(r.post.windows).toBe(1);
        expect(r.pre.valence_mean).toBeNull();
        expect(r.post.valence_mean).toBeNull();
        expect(r.delta_valence).toBeNull();
        expect(r.pre.emotion_dominant).toBe('neutral');
        expect(r.pre.gaze_dominant).toBe('Vitals'); // aoiLabel('vitals_values')
    });

    it('modal tie breaks FIRST-SEEN (locked)', () => {
        const windows = [
            makeWindow(-25000, { dominant_emotion: 'sad' }),
            makeWindow(-15000, { dominant_emotion: 'happy' }),
            // 1 sad vs 1 happy in pre → tie → first-seen 'sad' wins.
        ];
        const r = triggerReaction(windows, 6, T);
        expect(r.pre.emotion_dominant).toBe('sad');
    });

    it('ignores other sessions (string-compared ids) and unparseable windows', () => {
        const windows = [
            makeWindow(-10000, { session_id: 7 }),
            makeWindow(-10000, { window_start: 'garbage' }),
        ];
        const r = triggerReaction(windows, 6, T);
        expect(r.pre.windows).toBe(0);
        expect(r.post.windows).toBe(0);
        // Same session id as number vs string still matches.
        const r2 = triggerReaction([makeWindow(-10000, { session_id: '6' })], 6, T);
        expect(r2.pre.windows).toBe(1);
    });

    it('null session or unparseable trigger timestamp → the empty reaction', () => {
        const windows = [makeWindow(-10000)];
        const empty = {
            pre: { valence_mean: null, gaze_dominant: null, emotion_dominant: null, windows: 0 },
            post: { valence_mean: null, gaze_dominant: null, emotion_dominant: null, windows: 0 },
            delta_valence: null,
        };
        expect(triggerReaction(windows, null, T)).toEqual(empty);
        expect(triggerReaction(windows, 6, 'not a date')).toEqual(empty);
        expect(triggerReaction(windows, 6, null)).toEqual(empty);
    });

    it('honors custom preMs/postMs', () => {
        const far = makeWindow(-50000, { valence: -0.6 }); // 50s before
        expect(triggerReaction([far], 6, T).pre.windows).toBe(0);
        const wide = triggerReaction([far], 6, T, { preMs: 60000 });
        expect(wide.pre.windows).toBe(1);
        expect(wide.pre.valence_mean).toBeCloseTo(-0.6, 10);
    });
});

// Enriched moment row in the /learning-events/moments shape.
function makeMoment(overrides = {}) {
    return {
        case_id: 1,
        case_title: 'Asthma',
        verb: 'VIEWED',
        emotion: 'neutral',
        valence: 0.2,
        focus: 0.5,
        gaze_target: 'Vitals values',
        ...overrides,
    };
}

describe('actionAffectSummary — tidy (case, verb) rollup', () => {
    it('groups by (case_id, verb) and aggregates', () => {
        const rows = [
            makeMoment({ valence: 0.1, focus: 0.4 }),
            makeMoment({ valence: 0.3, focus: 0.6 }),
            makeMoment({ verb: 'ORDERED', valence: -0.5, emotion: 'fear', gaze_target: 'Chat panel', focus: 0.2 }),
        ];
        const summary = actionAffectSummary(rows);
        expect(summary).toHaveLength(2);
        const viewed = summary.find((r) => r.verb === 'VIEWED');
        expect(viewed).toEqual({
            case_id: 1,
            case_title: 'Asthma',
            verb: 'VIEWED',
            n: 2,
            emotion_dominant: 'neutral',
            valence_mean: expect.closeTo(0.2, 10),
            gaze_dominant: 'Vitals values',
            focus_mean: expect.closeTo(0.5, 10),
        });
        const ordered = summary.find((r) => r.verb === 'ORDERED');
        expect(ordered.n).toBe(1);
        expect(ordered.emotion_dominant).toBe('fear');
        expect(ordered.gaze_dominant).toBe('Chat panel');
    });

    it('null-enriched rows still count toward n but are skipped in aggregates', () => {
        const rows = [
            makeMoment({ valence: 0.4, focus: 0.8, emotion: 'happy', gaze_target: 'ECG trace' }),
            makeMoment({ valence: null, focus: null, emotion: null, gaze_target: null }),
            makeMoment({ valence: null, focus: null, emotion: null, gaze_target: null }),
        ];
        const [row] = actionAffectSummary(rows);
        expect(row.n).toBe(3);                      // row count never drops
        expect(row.valence_mean).toBeCloseTo(0.4, 10); // mean over the ONE non-null
        expect(row.focus_mean).toBeCloseTo(0.8, 10);
        expect(row.emotion_dominant).toBe('happy');
        expect(row.gaze_dominant).toBe('ECG trace');
    });

    it('fully unenriched group → n kept, all aggregates null (never 0)', () => {
        const rows = [
            makeMoment({ valence: null, focus: null, emotion: null, gaze_target: null }),
            makeMoment({ valence: null, focus: null, emotion: null, gaze_target: null }),
        ];
        const [row] = actionAffectSummary(rows);
        expect(row.n).toBe(2);
        expect(row.valence_mean).toBeNull();
        expect(row.focus_mean).toBeNull();
        expect(row.emotion_dominant).toBeNull();
        expect(row.gaze_dominant).toBeNull();
    });

    it('modal tie breaks FIRST-SEEN (locked)', () => {
        const rows = [
            makeMoment({ emotion: 'sad', gaze_target: 'Chat panel' }),
            makeMoment({ emotion: 'happy', gaze_target: 'ECG trace' }),
        ];
        const [row] = actionAffectSummary(rows);
        expect(row.emotion_dominant).toBe('sad');
        expect(row.gaze_dominant).toBe('Chat panel');
    });

    it('same verb in different cases stays split; missing case_title backfills from a later row', () => {
        const rows = [
            makeMoment({ case_id: 1, case_title: null }),
            makeMoment({ case_id: 1, case_title: 'Asthma' }),
            makeMoment({ case_id: 2, case_title: 'Sepsis' }),
        ];
        const summary = actionAffectSummary(rows);
        expect(summary).toHaveLength(2);
        expect(summary.map((r) => r.case_title)).toEqual(['Asthma', 'Sepsis']);
        expect(summary[0].n).toBe(2);
    });

    it('deterministic ordering: case_title asc, then n desc, then verb asc', () => {
        const rows = [
            makeMoment({ case_id: 2, case_title: 'Sepsis', verb: 'VIEWED' }),
            makeMoment({ case_id: 1, case_title: 'Asthma', verb: 'ORDERED' }),
            makeMoment({ case_id: 1, case_title: 'Asthma', verb: 'VIEWED' }),
            makeMoment({ case_id: 1, case_title: 'Asthma', verb: 'VIEWED' }),
            makeMoment({ case_id: 1, case_title: 'Asthma', verb: 'ACKNOWLEDGED' }),
        ];
        const summary = actionAffectSummary(rows);
        expect(summary.map((r) => [r.case_title, r.verb, r.n])).toEqual([
            ['Asthma', 'VIEWED', 2],
            ['Asthma', 'ACKNOWLEDGED', 1], // n tie with ORDERED → verb asc
            ['Asthma', 'ORDERED', 1],
            ['Sepsis', 'VIEWED', 1],
        ]);
    });

    it('empty or non-array input → empty tidy array', () => {
        expect(actionAffectSummary([])).toEqual([]);
        expect(actionAffectSummary(null)).toEqual([]);
        expect(actionAffectSummary(undefined)).toEqual([]);
    });
});
