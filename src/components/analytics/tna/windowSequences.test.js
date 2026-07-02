// Tests for windowSequences — the location (room) and gaze-target sequence
// builders behind the Locations / Gaze targets TNA sources.

import { describe, it, expect } from 'vitest';
import { recordsToRoomSequences, recordsToGazeTargetSequences } from './windowSequences';

// Rows arrive NEWEST-FIRST from the API; ts() makes window_start values.
const ts = (sec) => `2026-07-02T08:00:${String(sec).padStart(2, '0')}.000Z`;

const rec = (over = {}) => ({
    session_id: 's1',
    username: 'alice',
    window_start: ts(0),
    ...over,
});

describe('recordsToRoomSequences', () => {
    it('builds a chronological room sequence with runs collapsed and labels mapped', () => {
        const rows = [ // newest-first
            rec({ window_start: ts(40), room: 'consultant' }),
            rec({ window_start: ts(30), room: 'lab' }),
            rec({ window_start: ts(20), room: 'lab' }),      // run → collapsed
            rec({ window_start: ts(10), room: 'chat' }),
            rec({ window_start: ts(0), room: 'chat' }),
        ];
        const { sequences, labels } = recordsToRoomSequences(rows);
        expect(sequences).toEqual([['Patient (main)', 'Lab', 'Discussant']]);
        expect(labels).toEqual(['Session s1 · alice']);
    });

    it('skips windows without a room and drops sessions with fewer than 2 states', () => {
        const rows = [
            rec({ window_start: ts(20), room: null }),
            rec({ window_start: ts(10), room: 'chat' }),
            rec({ window_start: ts(0), room: 'chat' }),
        ];
        expect(recordsToRoomSequences(rows).sequences).toEqual([]);
        expect(recordsToRoomSequences([]).sequences).toEqual([]);
        expect(recordsToRoomSequences(null).sequences).toEqual([]);
    });

    it('keeps sessions separate and orders them by earliest window', () => {
        const rows = [
            rec({ session_id: 'late', window_start: ts(50), room: 'lab' }),
            rec({ session_id: 'late', window_start: ts(40), room: 'chat' }),
            rec({ session_id: 'early', window_start: ts(10), room: 'radiology' }),
            rec({ session_id: 'early', window_start: ts(0), room: 'examination' }),
        ];
        const { sequences } = recordsToRoomSequences(rows);
        expect(sequences).toEqual([
            ['Examination', 'Radiology'],
            ['Patient (main)', 'Lab'],
        ]);
    });

    it('capitalizes unknown rooms instead of dropping them', () => {
        const rows = [
            rec({ window_start: ts(10), room: 'holodeck' }),
            rec({ window_start: ts(0), room: 'chat' }),
        ];
        expect(recordsToRoomSequences(rows).sequences).toEqual([['Patient (main)', 'Holodeck']]);
    });
});

describe('recordsToGazeTargetSequences', () => {
    const gaze = (dwell, zones) => ({ aoi_dwell_ms: dwell, zone_proportions: zones });

    it('uses the dominant AOI target per window with readable labels, collapsing runs', () => {
        const rows = [ // newest-first
            rec({ window_start: ts(30), gaze: gaze({ ecg: 900, chat: 100 }) }),
            rec({ window_start: ts(20), gaze: gaze({ patient_face: 800 }) }),
            rec({ window_start: ts(10), gaze: gaze({ Patient_face: 700 }) }), // case-insensitive run
            rec({ window_start: ts(0), gaze: gaze({ vitals: 500, ecg: 100 }) }),
        ];
        const { sequences } = recordsToGazeTargetSequences(rows);
        expect(sequences).toEqual([['Vitals', 'Patient', 'ECG']]);
    });

    it('falls back to the dominant screen zone when no AOI dwell exists', () => {
        const rows = [
            rec({ window_start: ts(10), gaze: gaze(null, { top_left: 0.7, middle_center: 0.3 }) }),
            rec({ window_start: ts(0), gaze: gaze({ ecg: 400 }) }),
        ];
        expect(recordsToGazeTargetSequences(rows).sequences).toEqual([['ECG', 'Top-left']]);
    });

    it('skips windows with neither AOI dwell nor zones', () => {
        const rows = [
            rec({ window_start: ts(20), gaze: null }),
            rec({ window_start: ts(10), gaze: gaze({ chat: 300 }) }),
            rec({ window_start: ts(0), gaze: gaze({ vitals: 300 }) }),
        ];
        expect(recordsToGazeTargetSequences(rows).sequences).toEqual([['Vitals', 'Chat']]);
    });
});
