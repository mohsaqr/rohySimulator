// Contract tests for the pure gaze analytics (port of chatoyon's gaze.mjs
// suite, adapted: agent→patient AOI, page→room stamp).

import { describe, it, expect } from 'vitest';
import {
    gazeAnalytics, patientGazeRatio, aggregateZones, dominantZoneOf,
    topZonesText, hasGaze, windowZones, aoiBreakdown, normalizeAoiDwell,
    perRoomZoneStudentWeights,
} from './gazeAnalytics.js';

function gazeWindow({
    end = '2026-07-02T08:00:10.000Z',
    session = 's1',
    room = 'chat',
    username = undefined,
    nPoints = 100,
    zones = { middle_center: 0.7, top_center: 0.3 },
    centroid = { x: 0.05, y: -0.1 },
    patientDwell = 4000,
    aoiDwell = undefined, // full aoi_dwell_ms map override (null → field absent-ish)
    duration = 10000,
    offScreen = 0.05,
    dispersion = 0.12,
} = {}) {
    return {
        session_id: session,
        window_end: end,
        room,
        username,
        dominant_emotion: 'neutral',
        gaze: {
            n_points: nPoints,
            zone_proportions: zones,
            centroid,
            dispersion,
            off_screen_ratio: offScreen,
            duration_ms: duration,
            aoi_dwell_ms: aoiDwell !== undefined
                ? aoiDwell
                : (patientDwell == null ? {} : { patient_face: patientDwell }),
        },
        engagement: { focus_score: 0.8, gaze_entropy: 0.4 },
    };
}

describe('patientGazeRatio', () => {
    it('is dwell/duration clamped to [0,1]', () => {
        expect(patientGazeRatio(gazeWindow({ patientDwell: 4000 }))).toBeCloseTo(0.4, 10);
        expect(patientGazeRatio(gazeWindow({ patientDwell: 20000 }))).toBe(1);
    });

    it('is null (not 0) when the AOI was not active — no patient on screen ≠ not looking', () => {
        expect(patientGazeRatio(gazeWindow({ patientDwell: null }))).toBeNull();
        expect(patientGazeRatio({ gaze: { duration_ms: 10000 } })).toBeNull();
        expect(patientGazeRatio({})).toBeNull();
    });
});

describe('zone helpers', () => {
    it('windowZones falls back from gaze to engagement', () => {
        expect(windowZones({ engagement: { gaze_zone_proportions: { top_left: 1 } } })).toEqual({ top_left: 1 });
        expect(windowZones({})).toBeNull();
    });

    it('hasGaze requires tracked points', () => {
        expect(hasGaze(gazeWindow())).toBe(true);
        expect(hasGaze(gazeWindow({ nPoints: 0 }))).toBe(false);
        expect(hasGaze({})).toBe(false);
    });

    it('aggregateZones weights by n_points', () => {
        const heavy = gazeWindow({ nPoints: 300, zones: { middle_center: 1 } });
        const light = gazeWindow({ nPoints: 100, zones: { top_left: 1 } });
        const agg = aggregateZones([heavy, light]);
        expect(agg.middle_center).toBeCloseTo(0.75, 10);
        expect(agg.top_left).toBeCloseTo(0.25, 10);
    });

    it('dominantZoneOf and topZonesText', () => {
        const zones = { middle_center: 0.7, top_center: 0.3 };
        expect(dominantZoneOf(zones)).toBe('middle_center');
        expect(topZonesText(zones)).toBe('middle_center 70% | top_center 30%');
        expect(dominantZoneOf(null)).toBeNull();
    });
});

describe('normalizeAoiDwell — case-insensitive target merge', () => {
    it('canonicalizes ids and sums colliding dwell, preserving first-seen order', () => {
        const merged = normalizeAoiDwell({ Chat: 2000, ecg: 500, chat_panel: 3000 });
        expect([...merged.entries()]).toEqual([['chat_panel', 5000], ['ecg_trace', 500]]);
    });

    it('skips non-numeric dwell, clamps negatives to 0, tolerates junk input', () => {
        expect([...normalizeAoiDwell({ chat: 'bad', ECG: -100, ecg_trace: 700 })]).toEqual([['ecg_trace', 700]]);
        expect(normalizeAoiDwell(null).size).toBe(0);
        expect(normalizeAoiDwell(undefined).size).toBe(0);
        expect(normalizeAoiDwell('nope').size).toBe(0);
    });
});

describe('patientGazeRatio — casing drift on the patient AOI key', () => {
    it('matches Patient_Face / PATIENT_FACE casings and sums them', () => {
        expect(patientGazeRatio(gazeWindow({ aoiDwell: { Patient_Face: 4000 } }))).toBeCloseTo(0.4, 10);
        expect(patientGazeRatio(gazeWindow({ aoiDwell: { Patient_Face: 2000, patient_face: 2000 } }))).toBeCloseTo(0.4, 10);
    });
});

describe('aoiBreakdown — per-target attention', () => {
    it('sums dwell per AOI id, shares over the CARRYING windows only, sorted by dwell', () => {
        const pool = [
            gazeWindow({ aoiDwell: { patient_face: 4000, ecg_trace: 2000 } }),
            gazeWindow({ aoiDwell: { ecg_trace: 6000, vitals_values: 1000 } }),
            gazeWindow({ aoiDwell: {} }),   // no targets on screen that window
            gazeWindow({ aoiDwell: null }), // field missing entirely
        ];
        const aois = aoiBreakdown(pool);
        expect(aois.map((a) => a.id)).toEqual(['ecg_trace', 'patient_face', 'vitals_values']);
        const ecg = aois[0];
        expect(ecg.label).toBe('ECG');
        expect(ecg.dwellMs).toBe(8000);
        expect(ecg.share).toBeCloseTo(8000 / 20000, 10); // two carrying windows × 10 s
        expect(ecg.windows).toBe(2);
        const patient = aois[1];
        expect(patient.label).toBe('Patient');
        expect(patient.share).toBeCloseTo(0.4, 10);       // 4000 / 10000, NOT diluted by w2-w4
        expect(patient.windows).toBe(1);
        expect(aois[2]).toEqual({ id: 'vitals_values', label: 'Vitals', dwellMs: 1000, share: 0.1, windows: 1 });
    });

    it('falls back to the capitalized id as label and skips non-numeric dwell', () => {
        const aois = aoiBreakdown([
            gazeWindow({ aoiDwell: { mystery_widget: 3000, ecg_trace: 'bad' } }),
        ]);
        expect(aois).toEqual([
            { id: 'mystery_widget', label: 'Mystery_widget', dwellMs: 3000, share: 0.3, windows: 1 },
        ]);
    });

    it('merges short and publisher target ids ("Chat"/"chat_panel") into one canonical target', () => {
        const aois = aoiBreakdown([
            // Both eras in the SAME window: dwell sums, the window counts once.
            gazeWindow({ aoiDwell: { Chat: 2000, chat_panel: 3000 } }),
            gazeWindow({ aoiDwell: { chat: 1000 } }),
        ]);
        expect(aois).toEqual([
            { id: 'chat_panel', label: 'Chat', dwellMs: 6000, share: 6000 / 20000, windows: 2 },
        ]);
    });

    it('keeps the ECG acronym label when merging "ECG"/"ecg_trace"', () => {
        const aois = aoiBreakdown([
            gazeWindow({ aoiDwell: { ECG: 4000 } }),
            gazeWindow({ aoiDwell: { ecg_trace: 2000 } }),
        ]);
        expect(aois).toEqual([
            { id: 'ecg_trace', label: 'ECG', dwellMs: 6000, share: 0.3, windows: 2 },
        ]);
    });

    it('leaves share null (not Infinity/NaN) when the carrying windows lack duration_ms', () => {
        const aois = aoiBreakdown([
            gazeWindow({ aoiDwell: { chat_panel: 5000 }, duration: null }),
        ]);
        expect(aois).toEqual([
            { id: 'chat_panel', label: 'Chat', dwellMs: 5000, share: null, windows: 1 },
        ]);
    });

    it('handles an empty pool', () => {
        expect(aoiBreakdown([])).toEqual([]);
    });
});

describe('perRoomZoneStudentWeights — "where they look, per screen"', () => {
    it('groups by room sorted by window count desc, null room → unassigned', () => {
        const rows = perRoomZoneStudentWeights([
            gazeWindow({ room: 'chat', username: 'alice' }),
            gazeWindow({ room: 'chat', username: 'bob' }),
            gazeWindow({ room: 'consultant', username: 'alice' }),
            gazeWindow({ room: null, username: 'alice' }),
        ]);
        expect(rows.map((r) => [r.room, r.windows])).toEqual([
            ['chat', 2], ['consultant', 1], ['unassigned', 1],
        ]);
    });

    it('normalizes room zone weights to sum 1 even when proportions do not', () => {
        // Raw zones sum to 0.75 (rest off-screen) → shares re-scale to 1.
        const [row] = perRoomZoneStudentWeights([
            gazeWindow({ username: 'alice', zones: { middle_center: 0.5, top_left: 0.25 } }),
        ]);
        expect(row.zoneWeights.middle_center).toBeCloseTo(2 / 3, 10);
        expect(row.zoneWeights.top_left).toBeCloseTo(1 / 3, 10);
        const total = Object.values(row.zoneWeights).reduce((a, b) => a + b, 0);
        expect(total).toBeCloseTo(1, 10);
    });

    it('weights the room aggregate by n_points, like aggregateZones', () => {
        const [row] = perRoomZoneStudentWeights([
            gazeWindow({ username: 'alice', nPoints: 300, zones: { middle_center: 1 } }),
            gazeWindow({ username: 'bob', nPoints: 100, zones: { top_left: 1 } }),
        ]);
        expect(row.zoneWeights.middle_center).toBeCloseTo(0.75, 10);
        expect(row.zoneWeights.top_left).toBeCloseTo(0.25, 10);
    });

    it('carries per-student normalized zone shares, most-active student first', () => {
        const [row] = perRoomZoneStudentWeights([
            gazeWindow({ username: 'bob', zones: { top_left: 0.5 } }),
            gazeWindow({ username: 'alice', zones: { middle_center: 1 } }),
            gazeWindow({ username: 'alice', zones: { middle_center: 0.5, top_center: 0.5 } }),
        ]);
        expect(row.students.map((s) => [s.student, s.windows])).toEqual([
            ['alice', 2], ['bob', 1],
        ]);
        const alice = row.students[0];
        expect(alice.zones.middle_center).toBeCloseTo(0.75, 10);
        expect(alice.zones.top_center).toBeCloseTo(0.25, 10);
        // bob's 0.5 top_left normalizes to 1 within his own gaze.
        expect(row.students[1].zones).toEqual({ top_left: 1 });
    });

    it('buckets windows without a username as (unknown)', () => {
        const [row] = perRoomZoneStudentWeights([gazeWindow({})]);
        expect(row.students).toHaveLength(1);
        expect(row.students[0].student).toBe('(unknown)');
    });

    it('skips windows without gaze or zones — a room with none is absent', () => {
        const rows = perRoomZoneStudentWeights([
            gazeWindow({ room: 'chat', username: 'alice' }),
            { room: 'lab', username: 'alice', gaze: { n_points: 0 } },           // no gaze
            { room: 'lab', username: 'alice', gaze: { n_points: 50 } },          // no zones
        ]);
        expect(rows.map((r) => r.room)).toEqual(['chat']);
    });

    it('handles empty / junk pools', () => {
        expect(perRoomZoneStudentWeights([])).toEqual([]);
        expect(perRoomZoneStudentWeights(null)).toEqual([]);
    });
});

describe('gazeAnalytics', () => {
    it('summarizes the pool: counts, dominant zone, patient-gaze share', () => {
        const pool = [
            gazeWindow({ end: '2026-07-02T08:00:10.000Z', patientDwell: 4000 }),
            gazeWindow({ end: '2026-07-02T08:00:20.000Z', patientDwell: 6000 }),
            gazeWindow({ end: '2026-07-02T08:00:30.000Z', patientDwell: null }), // AOI inactive
            { window_end: 'x', gaze: { n_points: 0 } },                          // no gaze
        ];
        const a = gazeAnalytics(pool);
        expect(a.summary.windowCount).toBe(4);
        expect(a.summary.gazeWindowCount).toBe(3);
        expect(a.summary.totalPoints).toBe(300);
        expect(a.summary.dominantZone).toBe('middle_center');
        expect(a.summary.avgPatientGaze).toBeCloseTo(0.5, 10); // mean(0.4, 0.6)
        expect(a.summary.patientGazeWindows).toBe(2);
    });

    it('produces newest-first centroids and log rows with the room stamp', () => {
        const a = gazeAnalytics([
            gazeWindow({ end: '2026-07-02T08:00:10.000Z', room: 'chat' }),
            gazeWindow({ end: '2026-07-02T08:00:20.000Z', room: 'examination' }),
        ]);
        expect(a.log[0].ts).toBe('2026-07-02T08:00:20.000Z');
        expect(a.log[0].room).toBe('examination');
        expect(a.log[0].patient_gaze).toBeCloseTo(0.4, 10);
        expect(a.centroids).toHaveLength(2);
        expect(a.centroids[0]).toEqual({ x: 0.05, y: -0.1, n: 100 });
    });

    it('breaks down by room, largest first, with (unknown) fallback', () => {
        const a = gazeAnalytics([
            gazeWindow({ room: 'chat' }),
            gazeWindow({ room: 'chat' }),
            gazeWindow({ room: null }),
        ]);
        expect(a.byRoom[0].room).toBe('chat');
        expect(a.byRoom[0].windows).toBe(2);
        expect(a.byRoom[1].room).toBe('(unknown)');
        expect(a.byRoom[0].avgPatientGaze).toBeCloseTo(0.4, 10);
    });

    it('exposes the pool-wide per-AOI breakdown as `aois`', () => {
        const a = gazeAnalytics([
            gazeWindow({ aoiDwell: { patient_face: 4000, ecg_trace: 2000 } }),
            gazeWindow({ aoiDwell: { ecg_trace: 6000 } }),
        ]);
        expect(a.aois.map((x) => x.id)).toEqual(['ecg_trace', 'patient_face']);
        expect(a.aois[0].share).toBeCloseTo(0.4, 10);
        expect(a.aois[1].label).toBe('Patient');
    });

    it('answers "patient, ECG or vitals?" PER ROOM via byRoom[].aois', () => {
        const a = gazeAnalytics([
            gazeWindow({ room: 'chat', aoiDwell: { patient_face: 4000, ecg_trace: 2000 } }),
            gazeWindow({ room: 'chat', aoiDwell: { patient_face: 6000, vitals_values: 3000 } }),
            gazeWindow({ room: 'examination', aoiDwell: { patient_face: 1000 } }),
        ]);
        const chat = a.byRoom.find((r) => r.room === 'chat');
        expect(chat.aois.map((x) => x.id)).toEqual(['patient_face', 'vitals_values', 'ecg_trace']);
        expect(chat.aois[0].share).toBeCloseTo(0.5, 10);  // (4000+6000) / 20000
        expect(chat.aois[1].share).toBeCloseTo(0.3, 10);  // 3000 / 10000 — one carrying window
        expect(chat.aois[2].share).toBeCloseTo(0.2, 10);  // 2000 / 10000
        const exam = a.byRoom.find((r) => r.room === 'examination');
        expect(exam.aois).toEqual([
            { id: 'patient_face', label: 'Patient', dwellMs: 1000, share: 0.1, windows: 1 },
        ]);
    });

    it('merges two-era casing in BOTH the pool-wide aois and the room × target matrix', () => {
        const a = gazeAnalytics([
            gazeWindow({ room: 'chat', aoiDwell: { Patient: 4000, Vitals: 1000 } }),
            gazeWindow({ room: 'chat', aoiDwell: { patient: 6000 } }),
            gazeWindow({ room: 'examination', aoiDwell: { patient: 2000, Patient: 1000 } }),
        ]);
        // Pool-wide: one row per canonical target, dwell summed across eras.
        expect(a.aois.map((x) => x.id)).toEqual(['patient_face', 'vitals_values']);
        expect(a.aois[0]).toMatchObject({ id: 'patient_face', label: 'Patient', dwellMs: 13000, windows: 3 });
        expect(a.aois[0].share).toBeCloseTo(13000 / 30000, 10);
        expect(a.aois[1]).toMatchObject({ id: 'vitals_values', label: 'Vitals', dwellMs: 1000, windows: 1 });
        // Per-room matrix rows merge the same way — no duplicate columns.
        const chat = a.byRoom.find((r) => r.room === 'chat');
        expect(chat.aois.map((x) => x.id)).toEqual(['patient_face', 'vitals_values']);
        expect(chat.aois[0]).toMatchObject({ id: 'patient_face', dwellMs: 10000, windows: 2 });
        expect(chat.aois[0].share).toBeCloseTo(0.5, 10);
        const exam = a.byRoom.find((r) => r.room === 'examination');
        expect(exam.aois).toEqual([
            { id: 'patient_face', label: 'Patient', dwellMs: 3000, share: 0.3, windows: 1 },
        ]);
    });

    it('caps the log and reports truncation', () => {
        const pool = Array.from({ length: 5 }, (_, i) =>
            gazeWindow({ end: `2026-07-02T08:00:0${i}.000Z` }));
        const a = gazeAnalytics(pool, { logCap: 3 });
        expect(a.log).toHaveLength(3);
        expect(a.truncatedLog).toBe(true);
    });

    it('handles an empty pool', () => {
        const a = gazeAnalytics([]);
        expect(a.summary.gazeWindowCount).toBe(0);
        expect(a.summary.avgPatientGaze).toBeNull();
        expect(a.zones).toEqual({});
        expect(a.aois).toEqual([]);
        expect(a.byRoom).toEqual([]);
    });
});
