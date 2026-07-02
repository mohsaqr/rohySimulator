// Contract tests for the record→EmotionWindow mapper feeding the v2 Analyze
// dashboards (el.setWindows). Pins the projection so a DB column rename or a
// hydrateRecord change can't silently blank the dashboards.

import { describe, it, expect } from 'vitest';
import { recordToWindow, recordsToWindows } from './serverWindows.js';

const DB_RECORD = {
    id: 7,
    tenant_id: 't1',
    session_id: 42,
    user_id: 3,
    username: 'student',
    case_id: 5,
    record_id: 'r-abc',
    window_start: '2026-07-02T08:00:00.000Z',
    window_end: '2026-07-02T08:00:10.000Z',
    duration_ms: 10000,
    expected_samples: 20,
    dominant_emotion: 'neutral',
    probabilities: { neutral: 0.8, happy: 0.2 },
    valence: 0.12,
    arousal: -0.05,
    confidence: 0.74,
    entropy: 0.5,
    valid_frames: 18,
    missing_face_ratio: 0.1,
    quality: { blur: 0.1 },
    model_name: 'enet_b0_8_va_mtl',
    model_version: '1',
    model_profile: 'hse-emotion-mtl',
    dynamics: { rmssd_valence: 0.02 },
    gaze: { zones: { center_center: 0.9 }, n_points: 120 },
    engagement: { on_task_share: 0.8 },
    // DB-only noise that must not leak through
    emotion_probabilities_json: '{"neutral":0.8}',
    consent_version: 'oyon-consent-v1',
};

describe('recordToWindow', () => {
    it('projects every EmotionWindow field, ids stringified', () => {
        const w = recordToWindow(DB_RECORD);
        expect(w.session_id).toBe('42');
        expect(w.user_id).toBe('3');
        expect(w.case_id).toBe('5');
        expect(w.window_start).toBe(DB_RECORD.window_start);
        expect(w.dominant_emotion).toBe('neutral');
        expect(w.probabilities).toEqual({ neutral: 0.8, happy: 0.2 });
        expect(w.valence).toBe(0.12);
        expect(w.confidence).toBe(0.74);
        expect(w.valid_frames).toBe(18);
        expect(w.quality).toEqual({ blur: 0.1 });
        expect(w.gaze).toEqual({ zones: { center_center: 0.9 }, n_points: 120 });
        expect(w.engagement).toEqual({ on_task_share: 0.8 });
        expect(w).not.toHaveProperty('emotion_probabilities_json');
    });

    it('degrades pre-0028 rows to null gaze/engagement and defaults the required numbers', () => {
        const w = recordToWindow({ window_start: 'a', window_end: 'b' });
        expect(w.gaze).toBeNull();
        expect(w.engagement).toBeNull();
        expect(w.confidence).toBe(0);
        expect(w.valid_frames).toBe(0);
        expect(w.dominant_emotion).toBeNull();
    });
});

describe('recordsToWindows', () => {
    it('reverses newest-first API order into a chronological pool', () => {
        const newest = { ...DB_RECORD, window_start: '2026-07-02T09:00:00.000Z' };
        const oldest = { ...DB_RECORD, window_start: '2026-07-02T08:00:00.000Z' };
        const pool = recordsToWindows([newest, oldest]);
        expect(pool[0].window_start).toBe(oldest.window_start);
        expect(pool[1].window_start).toBe(newest.window_start);
    });

    it('tolerates non-array input', () => {
        expect(recordsToWindows(undefined)).toEqual([]);
    });
});
