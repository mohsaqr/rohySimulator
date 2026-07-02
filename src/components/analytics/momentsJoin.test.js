// Unit tests for the clinical-moment join. Locks the coverage contract
// (start inclusive, end exclusive, same session), the gaze-target argmax +
// zone fallback, and the never-fabricate rule (no window → nulls; null
// valence stays null, never 0).

import { describe, it, expect } from 'vitest';
import {
    parseTimestampMs,
    gazeTargetFromGaze,
    momentFields,
    findCoveringWindow,
    joinMoments,
} from './momentsJoin';

// One 10s seed-shaped window: 08:00:00.000 → 08:00:10.000 UTC, session 6.
function makeWindow(overrides = {}) {
    return {
        session_id: 6,
        window_start: '2026-07-02T08:00:00.000Z',
        window_end: '2026-07-02T08:00:10.000Z',
        dominant_emotion: 'happy',
        valence: 0.4,
        arousal: 0.3,
        engagement_json: JSON.stringify({ focus_score: 0.6, blink_count: 3 }),
        gaze_json: JSON.stringify({
            zone_proportions: { middle_center: 0.5, top_center: 0.3, middle_left: 0.2 },
            aoi_dwell_ms: { patient_face: 3000, ecg_trace: 2500, vitals_values: 1500, chat_panel: 2000 },
        }),
        ...overrides,
    };
}

function makeEvent(overrides = {}) {
    return {
        id: 1,
        session_id: 6,
        timestamp: '2026-07-02T08:00:05.000Z',
        verb: 'VIEWED',
        object_name: 'ECG',
        ...overrides,
    };
}

describe('parseTimestampMs', () => {
    it('parses ISO UTC strings', () => {
        expect(parseTimestampMs('2026-07-02T08:00:00.000Z')).toBe(Date.UTC(2026, 6, 2, 8, 0, 0));
    });

    it('passes epoch numbers through and rejects garbage as null', () => {
        expect(parseTimestampMs(1234567890)).toBe(1234567890);
        expect(parseTimestampMs('not a date')).toBeNull();
        expect(parseTimestampMs(null)).toBeNull();
        expect(parseTimestampMs(undefined)).toBeNull();
        expect(parseTimestampMs('')).toBeNull();
    });
});

describe('joinMoments — coverage contract', () => {
    it('enriches an event inside a window', () => {
        const [row] = joinMoments([makeEvent()], [makeWindow()]);
        expect(row.emotion).toBe('happy');
        expect(row.valence).toBe(0.4);
        expect(row.arousal).toBe(0.3);
        expect(row.focus).toBe(0.6);
        // aoi_dwell_ms argmax = patient_face (3000) → screenAois label
        expect(row.gaze_target).toBe('Patient');
        // original event fields survive the copy
        expect(row.verb).toBe('VIEWED');
    });

    it('yields all nulls when no window covers the event (capture off)', () => {
        const event = makeEvent({ timestamp: '2026-07-02T09:00:00.000Z' });
        const [row] = joinMoments([event], [makeWindow()]);
        expect(row.emotion).toBeNull();
        expect(row.valence).toBeNull();
        expect(row.arousal).toBeNull();
        expect(row.focus).toBeNull();
        expect(row.gaze_target).toBeNull();
    });

    it('window_start is inclusive', () => {
        const event = makeEvent({ timestamp: '2026-07-02T08:00:00.000Z' });
        const [row] = joinMoments([event], [makeWindow()]);
        expect(row.emotion).toBe('happy');
    });

    it('window_end is exclusive', () => {
        const event = makeEvent({ timestamp: '2026-07-02T08:00:10.000Z' });
        const [row] = joinMoments([event], [makeWindow()]);
        expect(row.emotion).toBeNull();
        expect(row.valence).toBeNull();
    });

    it('never matches a window from another session', () => {
        const event = makeEvent({ session_id: 7 });
        const [row] = joinMoments([event], [makeWindow({ session_id: 6 })]);
        expect(row.emotion).toBeNull();
    });

    it('matches session ids across string/number representations', () => {
        const event = makeEvent({ session_id: '6' });
        const [row] = joinMoments([event], [makeWindow({ session_id: 6 })]);
        expect(row.emotion).toBe('happy');
    });

    it('does not mutate the input events', () => {
        const event = makeEvent();
        joinMoments([event], [makeWindow()]);
        expect(event.emotion).toBeUndefined();
        expect(event.valence).toBeUndefined();
    });
});

describe('gaze_target resolution', () => {
    it('argmax of aoi_dwell_ms wins, labelled via screenAois', () => {
        const gaze = { aoi_dwell_ms: { ecg_trace: 9000, patient_face: 100 } };
        expect(gazeTargetFromGaze(gaze)).toBe('ECG');
    });

    it('unknown AOI ids pass through capitalized', () => {
        const gaze = { aoi_dwell_ms: { future_widget: 5000 } };
        expect(gazeTargetFromGaze(gaze)).toBe('Future_widget');
    });

    it('merges target ids that differ only by case before the argmax', () => {
        // "Chat"+"chat" (two capture eras) sum to 5000 and beat ecg_trace's 4000.
        const gaze = { aoi_dwell_ms: { Chat: 2000, ecg_trace: 4000, chat: 3000 } };
        expect(gazeTargetFromGaze(gaze)).toBe('Chat');
    });

    it('ties break by first-seen key order (deterministic)', () => {
        const gaze = { aoi_dwell_ms: { chat_panel: 3000, patient_face: 3000 } };
        expect(gazeTargetFromGaze(gaze)).toBe('Chat');
    });

    it('empty aoi_dwell_ms falls back to the dominant zone', () => {
        const gaze = {
            aoi_dwell_ms: {},
            zone_proportions: { middle_center: 0.2, top_left: 0.7, bottom_right: 0.1 },
        };
        expect(gazeTargetFromGaze(gaze)).toBe('Top-left');
    });

    it('missing aoi_dwell_ms falls back to the dominant zone', () => {
        const gaze = { zone_proportions: { middle_center: 0.9, top_center: 0.1 } };
        expect(gazeTargetFromGaze(gaze)).toBe('Center');
    });

    it('all-zero dwell is treated as no AOI signal → zone fallback', () => {
        const gaze = {
            aoi_dwell_ms: { patient_face: 0, ecg_trace: 0 },
            zone_proportions: { middle_left: 0.8, middle_center: 0.2 },
        };
        expect(gazeTargetFromGaze(gaze)).toBe('Left');
    });

    it('normalizes legacy coarse zone labels', () => {
        expect(gazeTargetFromGaze({ zone_proportions: { center: 1 } })).toBe('Center');
        expect(gazeTargetFromGaze({ zone_proportions: { down: 1 } })).toBe('Bottom');
    });

    it('no usable gaze at all → null', () => {
        expect(gazeTargetFromGaze(null)).toBeNull();
        expect(gazeTargetFromGaze({})).toBeNull();
        expect(gazeTargetFromGaze({ aoi_dwell_ms: {}, zone_proportions: {} })).toBeNull();
        expect(gazeTargetFromGaze('not json {')).toBeNull();
    });

    it('accepts gaze_json as a JSON string (raw SQLite row)', () => {
        const gaze = JSON.stringify({ aoi_dwell_ms: { vitals_values: 4000 } });
        expect(gazeTargetFromGaze(gaze)).toBe('Vitals');
    });
});

describe('null preservation — never fabricate values', () => {
    it('null valence stays null even when the window matches', () => {
        const window = makeWindow({ valence: null });
        const [row] = joinMoments([makeEvent()], [window]);
        expect(row.valence).toBeNull();
        expect(row.emotion).toBe('happy'); // the rest of the window still applies
    });

    it('missing focus_score stays null (not 0)', () => {
        const window = makeWindow({ engagement_json: JSON.stringify({ blink_count: 3 }) });
        const [row] = joinMoments([makeEvent()], [window]);
        expect(row.focus).toBeNull();
    });

    it('null engagement_json / gaze_json stay null', () => {
        const window = makeWindow({ engagement_json: null, gaze_json: null });
        const [row] = joinMoments([makeEvent()], [window]);
        expect(row.focus).toBeNull();
        expect(row.gaze_target).toBeNull();
    });

    it('momentFields(null) is the all-null moment', () => {
        expect(momentFields(null)).toEqual({
            emotion: null, valence: null, arousal: null, focus: null, gaze_target: null,
        });
    });

    it('event with unparseable timestamp gets the all-null moment', () => {
        const [row] = joinMoments([makeEvent({ timestamp: 'garbage' })], [makeWindow()]);
        expect(row.emotion).toBeNull();
    });
});

describe('findCoveringWindow', () => {
    it('returns the covering window row itself', () => {
        const w = makeWindow();
        expect(findCoveringWindow([w], 6, '2026-07-02T08:00:03.000Z')).toBe(w);
    });

    it('returns null outside coverage or for another session', () => {
        const w = makeWindow();
        expect(findCoveringWindow([w], 6, '2026-07-02T08:00:10.000Z')).toBeNull();
        expect(findCoveringWindow([w], 99, '2026-07-02T08:00:03.000Z')).toBeNull();
        expect(findCoveringWindow([w], null, '2026-07-02T08:00:03.000Z')).toBeNull();
    });

    it('drops windows with unparseable bounds instead of matching them', () => {
        const w = makeWindow({ window_start: 'bad', window_end: 'worse' });
        expect(findCoveringWindow([w], 6, '2026-07-02T08:00:03.000Z')).toBeNull();
    });

    it('picks the right window among several in one session', () => {
        const w1 = makeWindow();
        const w2 = makeWindow({
            window_start: '2026-07-02T08:01:00.000Z',
            window_end: '2026-07-02T08:01:10.000Z',
            dominant_emotion: 'neutral',
        });
        expect(findCoveringWindow([w2, w1], 6, '2026-07-02T08:01:05.000Z')).toBe(w2);
    });
});
