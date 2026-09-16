// @vitest-environment node
//
// The numbers on the Text and Voice analytics tabs. Tests the FORMULAS against
// reference values, not just that functions return objects:
//   - quantiles are checked against R's quantile(type = 7);
//   - the cohort summary is checked on a case where pooling every window and
//     summarising per learner give different answers;
//   - voice metrics are checked to ignore turns Oyon marked insufficient;
//   - invariants: row order of the input never changes the output.

import { describe, it, expect } from 'vitest';
import {
    quantile, median, summarize, perLearnerSummary, mergePauseHistograms, share, OKABE_ITO,
} from './signalStats.js';
import { textAnalytics, cpmOf, revisionBurstShareOf, mergePauseLocations, hasEditSeries } from './textAnalytics.js';
import { voiceAnalytics, insufficientReasons } from './voiceAnalytics.js';

const TOL = 1e-9;

// ── fixtures ───────────────────────────────────────────────────────────────

function typing({ user, session = `${user}-s1`, caseId = 1, cpm = 120, revision = 0.1, submitted = true,
    pasted = 0, latency = 800, pauses = { lt_500_ms: 4, '500_to_1000_ms': 1, '1000_to_2000_ms': 0, '2000_to_5000_ms': 0, gte_5000_ms: 0 },
    start = '2026-09-16T10:00:00.000Z' } = {}) {
    return {
        modality: 'typing', user_id: user, student_name_snapshot: `Learner ${user}`,
        session_id: session, case_id: caseId, case_title_snapshot: `Case ${caseId}`, window_start: start,
        payload: {
            chars_per_min_active: cpm, chars_per_min: cpm / 2, revision_ratio: revision,
            submitted, abandoned: !submitted, pasted_graphemes: pasted, first_input_latency_ms: latency,
            burst_count: 3, correction_count: 1, pause_histogram: pauses,
        },
    };
}

function voice({ user, session = `${user}-s1`, caseId = 1, speech = 0.6, duration = 4000, pitch = 180,
    pausesCount = 2, insufficient = false, reasons = [], start = '2026-09-16T10:00:00.000Z',
    pauses = { lt_500_ms: 2, '500_to_1000_ms': 1, '1000_to_2000_ms': 0, '2000_to_5000_ms': 0, gte_5000_ms: 0 } } = {}) {
    return {
        modality: 'voice', user_id: user, student_name_snapshot: `Learner ${user}`,
        session_id: session, case_id: caseId, case_title_snapshot: `Case ${caseId}`, window_start: start,
        payload: {
            speech_ratio: speech, turn_duration_ms: duration, pitch_median_hz: pitch,
            internal_pause_count: pausesCount, insufficient_data: insufficient, insufficient_reasons: reasons,
            pause_histogram: pauses,
        },
    };
}

// Deterministic shuffle (no Math.random) — a fixed permutation.
const permute = (xs) => xs.map((x, i) => [((i * 7) + 3) % xs.length, x]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);

// ── quantiles against R ─────────────────────────────────────────────────────

describe('quantile (R type 7)', () => {
    it('matches R on an even sample: quantile(c(1,2,3,4), c(.25,.5,.75)) = 1.75, 2.5, 3.25', () => {
        expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 12);
        expect(quantile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 12);
        expect(quantile([1, 2, 3, 4], 0.75)).toBeCloseTo(3.25, 12);
    });

    it('matches R on an unsorted odd sample: 1.75, 3.10, 6.35', () => {
        const y = [3.1, 0.2, 7.7, 5.0, 2.4, 9.9, 1.1];
        expect(Math.abs(quantile(y, 0.25) - 1.75)).toBeLessThan(TOL);
        expect(Math.abs(quantile(y, 0.5) - 3.1)).toBeLessThan(TOL);
        expect(Math.abs(quantile(y, 0.75) - 6.35)).toBeLessThan(TOL);
    });

    it('returns null for an empty sample instead of inventing a number', () => {
        expect(quantile([], 0.5)).toBeNull();
        expect(median([null, undefined, Number.NaN, Infinity])).toBeNull();
    });

    it('ignores non-finite values', () => {
        expect(median([1, Number.NaN, 3, null, Infinity])).toBe(2);
    });

    it('refuses a q outside [0, 1]', () => {
        expect(() => quantile([1, 2], 1.5)).toThrow(RangeError);
    });

    it('summarize reports n with the median and quartiles', () => {
        expect(summarize([1, 2, 3, 4])).toEqual({ n: 4, median: 2.5, q1: 1.75, q3: 3.25 });
    });
});

// ── one vote per learner ───────────────────────────────────────────────────

describe('perLearnerSummary gives every learner one vote', () => {
    // R: median(c(100,100,100,100,100,300,200)) = 100, but
    //    median(c(median(rep(100,5)), 300, 200)) = 200.
    const episodes = [
        ...Array.from({ length: 5 }, (_, i) => typing({ user: 'A', session: `A-${i}`, cpm: 100 })),
        typing({ user: 'B', cpm: 300 }),
        typing({ user: 'C', cpm: 200 }),
    ];

    it('is not dominated by the most prolific learner', () => {
        const pooled = median(episodes.map(cpmOf));
        const cohort = perLearnerSummary(episodes, cpmOf);
        expect(pooled).toBe(100);
        expect(cohort.median).toBe(200);
        // n counts learners, not windows.
        expect(cohort.n).toBe(3);
    });
});

// ── text ──────────────────────────────────────────────────────────────────

describe('textAnalytics', () => {
    const windows = [
        typing({ user: 'A', cpm: 100, revision: 0.1, submitted: true, start: '2026-09-16T09:00:00.000Z' }),
        typing({ user: 'A', cpm: 140, revision: 0.3, submitted: false, pasted: 20, start: '2026-09-16T09:05:00.000Z' }),
        typing({ user: 'B', session: 'B-s1', caseId: 2, cpm: 200, revision: 0.0, submitted: true, start: '2026-09-16T11:00:00.000Z' }),
        // Other modalities in the same feed must be ignored.
        voice({ user: 'A' }),
        { modality: 'typing', user_id: 'Z', payload: null },
    ];
    const t = textAnalytics(windows);

    it('counts only typing episodes that carry metrics', () => {
        expect(t.summary.episodes).toBe(3);
        expect(t.summary.learners).toBe(2);
        expect(t.summary.cases).toBe(2);
    });

    it('computes the cohort speed as a median of per-learner medians', () => {
        // A: median(100, 140) = 120; B: 200 → median(120, 200) = 160.
        expect(t.summary.cpm.median).toBe(160);
        expect(t.summary.cpm.n).toBe(2);
    });

    it('reports shares over episodes', () => {
        expect(t.summary.submittedShare).toBeCloseTo(2 / 3, 12);
        expect(t.summary.abandonedShare).toBeCloseTo(1 / 3, 12);
        expect(t.summary.pasteShare).toBeCloseTo(1 / 3, 12);
    });

    it('breaks down by learner, sorted by name', () => {
        expect(t.byLearner.map((r) => r.learner)).toEqual(['Learner A', 'Learner B']);
        const a = t.byLearner[0];
        expect(a.episodes).toBe(2);
        expect(a.cpm.median).toBe(120);
        expect(a.revisionRatio.median).toBeCloseTo(0.2, 12);
        expect(a.abandonedShare).toBe(0.5);
    });

    it('breaks down by case, counting distinct learners', () => {
        expect(t.byCase.map((r) => [r.case, r.learners, r.episodes])).toEqual([['Case 1', 1, 2], ['Case 2', 1, 1]]);
    });

    it('lists sessions newest first', () => {
        expect(t.bySession.map((r) => r.sessionId)).toEqual(['B-s1', 'A-s1']);
    });

    it('pools the pause histogram in axis order', () => {
        expect(t.pauses.total).toBe(15);
        expect(t.pauses.buckets.map((b) => b.count)).toEqual([12, 3, 0, 0, 0]);
        expect(t.pauses.buckets[0].share).toBeCloseTo(12 / 15, 12);
    });

    it('does not depend on the order rows arrive in', () => {
        const shuffled = textAnalytics(permute(windows));
        expect(shuffled).toEqual(t);
    });

    it('is empty rather than fabricated when there is no typing', () => {
        const empty = textAnalytics([voice({ user: 'A' })]);
        expect(empty.summary.episodes).toBe(0);
        expect(empty.summary.cpm).toEqual({ n: 0, median: null, q1: null, q3: null });
        expect(empty.summary.submittedShare).toBeNull();
        expect(empty.byLearner).toEqual([]);
    });
});

// ── voice ─────────────────────────────────────────────────────────────────

describe('hasEditSeries', () => {
    const w = (typing) => ({ modality: 'typing', payload: typing });
    it('is true only when an episode kept positioned edits or intervals', () => {
        expect(hasEditSeries(w({ revision_locations: [{ t: 1, offset: 0, op: 'insert' }] }))).toBe(true);
        expect(hasEditSeries(w({ inter_event_intervals_ms: [120] }))).toBe(true);
        expect(hasEditSeries(w({ chars_per_min: 100, revision_locations: [] }))).toBe(false);
        expect(hasEditSeries(w(null))).toBe(false);
        expect(hasEditSeries({})).toBe(false);
    });
});

describe('typing-v3 cohort figures', () => {
    const v3 = (user, { p, r, product, locations }) => {
        const w = typing({ user });
        Object.assign(w.payload, { p_burst_count: p, r_burst_count: r, product_ratio: product, pause_location_counts: locations });
        return w;
    };

    it('revision-burst share is r / (p + r), and null when there were no bursts', () => {
        expect(revisionBurstShareOf(v3('a', { p: 3, r: 1 }))).toBeCloseTo(0.25, 12);
        expect(revisionBurstShareOf(v3('a', { p: 0, r: 0 }))).toBeNull();
        expect(revisionBurstShareOf(typing({ user: 'a' }))).toBeNull();
    });

    it('product ratio and revision-burst share give each learner one vote', () => {
        // a: product 0.9, 0.7 → 0.8; b: 0.5 → cohort median(0.8, 0.5) = 0.65.
        // a: R share 0.25, 0.75 → 0.5; b: 0 → cohort 0.25.
        const rows = [
            v3('a', { p: 3, r: 1, product: 0.9 }), v3('a', { p: 1, r: 3, product: 0.7 }),
            v3('b', { p: 2, r: 0, product: 0.5 }),
        ];
        const { summary } = textAnalytics(rows);
        expect(summary.productRatio.median).toBeCloseTo(0.65, 12);
        expect(summary.revisionBurstShare.median).toBeCloseTo(0.25, 12);
    });

    it('pools pause locations and counts episodes that did not measure them, not as zeros', () => {
        const rows = [
            v3('a', { p: 1, r: 0, locations: { mid_word: 2, word_boundary: 6, sentence_boundary: 2, paragraph_boundary: 0 } }),
            v3('b', { p: 1, r: 0, locations: { mid_word: 0, word_boundary: 0, sentence_boundary: 0, paragraph_boundary: 0 } }),
            typing({ user: 'c' }),
        ];
        const loc = mergePauseLocations(rows);
        expect(loc.total).toBe(10);
        expect(loc.measured).toBe(2);
        expect(loc.unmeasured).toBe(1);
        expect(loc.buckets.map((b) => b.count)).toEqual([2, 6, 2, 0]);
        expect(loc.buckets.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1, 12);
    });
});

describe('voiceAnalytics', () => {
    const windows = [
        voice({ user: 'A', speech: 0.6, duration: 4000, pitch: 180 }),
        voice({ user: 'A', speech: 0.8, duration: 6000, pitch: 200 }),
        // Insufficient: a real 0 speech ratio that must NOT drag A's median down.
        voice({ user: 'A', speech: 0, duration: 300, pitch: null, insufficient: true,
            reasons: ['insufficient_analyzable_speech', 'poor_vad_coverage'] }),
        voice({ user: 'B', session: 'B-s1', speech: 0.4, duration: 2000, pitch: 120 }),
        voice({ user: 'B', session: 'B-s1', insufficient: true, reasons: ['insufficient_analyzable_speech'] }),
        typing({ user: 'A' }),
    ];
    const v = voiceAnalytics(windows);

    it('counts every turn but measures only analysable ones', () => {
        expect(v.summary.turns).toBe(5);
        expect(v.summary.analysableTurns).toBe(3);
        expect(v.summary.insufficientShare).toBeCloseTo(2 / 5, 12);
    });

    it('keeps insufficient turns out of the metrics', () => {
        // A over analysable turns only: median(0.6, 0.8) = 0.7 (not median(0.6, 0.8, 0) = 0.6).
        const a = v.byLearner.find((r) => r.learner === 'Learner A');
        expect(a.speechRatio.median).toBeCloseTo(0.7, 12);
        expect(a.speechRatio.n).toBe(2);
        expect(a.turns).toBe(3);
        expect(a.analysableTurns).toBe(2);
    });

    it('computes cohort speech ratio as a median of per-learner medians', () => {
        // A = 0.7, B = 0.4 → median = 0.55.
        expect(v.summary.speechRatio.median).toBeCloseTo(0.55, 12);
        expect(v.summary.speechRatio.n).toBe(2);
    });

    it('reports why turns were insufficient, most common first', () => {
        expect(insufficientReasons(voiceTurnsOnly(windows))).toEqual([
            { reason: 'insufficient_analyzable_speech', count: 2 },
            { reason: 'poor_vad_coverage', count: 1 },
        ]);
        expect(v.insufficientReasons).toEqual(insufficientReasons(voiceTurnsOnly(windows)));
    });

    it('pools pauses from analysable turns only', () => {
        expect(v.pauses.total).toBe(9);
    });

    it('does not depend on the order rows arrive in', () => {
        expect(voiceAnalytics(permute(windows))).toEqual(v);
    });
});

function voiceTurnsOnly(ws) { return ws.filter((w) => w.modality === 'voice'); }

// ── pause histograms and small helpers ────────────────────────────────────

describe('mergePauseHistograms', () => {
    it('skips a histogram with unknown bucket keys instead of mis-binning it', () => {
        const merged = mergePauseHistograms([
            { lt_500_ms: 2, '500_to_1000_ms': 0, '1000_to_2000_ms': 0, '2000_to_5000_ms': 0, gte_5000_ms: 1 },
            { lt_300_ms: 9 },          // a tenant with custom thresholds
            null,
        ]);
        expect(merged.total).toBe(3);
        expect(merged.skipped).toBe(1);
    });

    it('shares sum to 1 when there is data', () => {
        const merged = mergePauseHistograms([{ lt_500_ms: 1, '500_to_1000_ms': 2, '1000_to_2000_ms': 3, '2000_to_5000_ms': 4, gte_5000_ms: 5 }]);
        const sum = merged.buckets.reduce((acc, b) => acc + b.share, 0);
        expect(Math.abs(sum - 1)).toBeLessThan(TOL);
    });
});

describe('small helpers', () => {
    it('share is null for an empty list', () => {
        expect(share([], () => true)).toBeNull();
    });

    it('uses the Okabe-Ito palette', () => {
        expect(OKABE_ITO[0]).toBe('#E69F00');
        expect(OKABE_ITO).toHaveLength(9);
    });
});
