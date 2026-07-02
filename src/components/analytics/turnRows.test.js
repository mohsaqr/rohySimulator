// Tests for the per-turn builder ported from chatoyon-plus rows.ts.
// Locks the lead-up window attribution ((prev, this]), last-turn trailing
// ownership, reply concatenation, transition counts, and null means.

import { describe, it, expect } from 'vitest';
import { turnRowsFrom, dominantZone } from './turnRows';

const iso = (s) => `2026-07-02T${s}.000Z`;

function msg(id, role, content, t, extra = {}) {
    return { id, session_id: 6, role, content, timestamp: iso(t), username: 'alice', case_name: 'Chest pain', ...extra };
}
function win(t, { emotion = 'neutral', valence = 0.1, arousal = 0.2, focus = 0.5, zones = { middle_center: 0.8, top_center: 0.2 } } = {}) {
    return {
        session_id: 6,
        window_end: iso(t),
        dominant_emotion: emotion,
        valence,
        arousal,
        engagement_json: JSON.stringify({ focus_score: focus }),
        gaze_json: JSON.stringify({ zone_proportions: zones }),
    };
}

describe('turnRowsFrom', () => {
    it('one row per user message; reply is the assistant text that followed', () => {
        const rows = turnRowsFrom([
            msg(1, 'user', 'hello', '08:00:00'),
            msg(2, 'assistant', 'hi there', '08:00:05'),
            msg(3, 'user', 'chest pain?', '08:01:00'),
            msg(4, 'assistant', 'since morning', '08:01:05'),
        ], []);
        expect(rows).toHaveLength(2);
        // Newest first
        expect(rows[0].turnIndex).toBe(2);
        expect(rows[0].prompt).toBe('chest pain?');
        expect(rows[0].reply).toBe('since morning');
        expect(rows[1].turnIndex).toBe(1);
        expect(rows[1].reply).toBe('hi there');
    });

    it('windows are attributed to the lead-up (prev, this]; last turn owns trailing', () => {
        const rows = turnRowsFrom([
            msg(1, 'user', 'q1', '08:01:00'),
            msg(2, 'assistant', 'a1', '08:01:05'),
            msg(3, 'user', 'q2', '08:02:00'),
        ], [
            win('08:00:30', { emotion: 'happy' }),   // before q1 → turn 1
            win('08:01:00', { emotion: 'happy' }),   // exactly AT q1 (inclusive) → turn 1
            win('08:01:30', { emotion: 'sad' }),     // between q1 and q2 → turn 2
            win('08:03:00', { emotion: 'sad' }),     // after last turn → turn 2 (trailing)
        ]);
        const turn1 = rows.find((r) => r.turnIndex === 1);
        const turn2 = rows.find((r) => r.turnIndex === 2);
        expect(turn1.windowCount).toBe(2);
        expect(turn1.emotion_dominant).toBe('happy');
        expect(turn2.windowCount).toBe(2);
        expect(turn2.emotion_dominant).toBe('sad');
    });

    it('no windows → null aggregates, zero counts', () => {
        const [row] = turnRowsFrom([msg(1, 'user', 'q', '08:00:00')], []);
        expect(row.valence).toBeNull();
        expect(row.arousal).toBeNull();
        expect(row.focus).toBeNull();
        expect(row.emotion_dominant).toBeNull();
        expect(row.gaze_dominant).toBeNull();
        expect(row.windowCount).toBe(0);
        expect(row.gaze_transitions).toBe(0);
        expect(row.emotion_transitions).toBe(0);
    });

    it('means skip nulls, never coerce to 0', () => {
        const [row] = turnRowsFrom([msg(1, 'user', 'q', '08:02:00')], [
            win('08:00:10', { valence: 0.4 }),
            win('08:00:20', { valence: null }),
        ]);
        expect(row.valence).toBeCloseTo(0.4);
        expect(row.windowCount).toBe(2);
    });

    it('counts emotion and gaze transitions across the turn windows', () => {
        const [row] = turnRowsFrom([msg(1, 'user', 'q', '08:02:00')], [
            win('08:00:10', { emotion: 'neutral', zones: { middle_center: 1 } }),
            win('08:00:20', { emotion: 'happy', zones: { top_left: 1 } }),
            win('08:00:30', { emotion: 'happy', zones: { middle_center: 1 } }),
        ]);
        expect(row.emotion_transitions).toBe(1);
        expect(row.gaze_transitions).toBe(2);
        expect(row.emotion_top[0]).toEqual({ label: 'happy', pct: 2 / 3 });
    });

    it('normalizes gaze zones across windows and keeps top 3', () => {
        const [row] = turnRowsFrom([msg(1, 'user', 'q', '08:02:00')], [
            win('08:00:10', { zones: { middle_center: 0.5, top_center: 0.3, middle_left: 0.1, top_left: 0.1 } }),
        ]);
        expect(row.gaze_dominant).toBe('middle_center');
        expect(row.gaze_top).toHaveLength(3);
        const total = Object.values(row.gaze_zones).reduce((a, b) => a + b, 0);
        expect(total).toBeCloseTo(1);
    });

    it('sessions never mix', () => {
        const rows = turnRowsFrom(
            [msg(1, 'user', 'q', '08:01:00'), { ...msg(2, 'user', 'other', '08:01:00'), session_id: 7 }],
            [win('08:00:30', { emotion: 'happy' })], // session 6 only
        );
        const s7 = rows.find((r) => String(r.session_id) === '7');
        expect(s7.windowCount).toBe(0);
        expect(s7.emotion_dominant).toBeNull();
    });
});

describe('dominantZone', () => {
    it('argmax; null on empty/invalid', () => {
        expect(dominantZone({ a: 0.2, b: 0.7 })).toBe('b');
        expect(dominantZone({})).toBeNull();
        expect(dominantZone(null)).toBeNull();
    });
});
