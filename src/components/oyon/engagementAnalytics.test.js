// Contract tests for the pure engagement analytics (port of chatoyon's
// engagement.mjs summary/cross-tab + the affect.ts series leg). Records are
// fed NEWEST-FIRST, exactly as the emotion-records API delivers them.

import { describe, it, expect } from 'vitest';
import { engagementAnalytics } from './engagementAnalytics.js';

function rec({
   session = 's1',
   start = '2026-07-02T08:00:00.000Z',
   end = '2026-07-02T08:00:10.000Z',
   emotion = 'neutral',
   engagement = { focus_score: 0.8, blink_rate_hz: 0.3, eye_openness_mean: 0.7 },
   gaze = { off_screen_ratio: 0.1, calibration_quality: 0.9 },
   missingFace = 0.05,
} = {}) {
   return {
      session_id: session,
      window_start: start,
      window_end: end,
      dominant_emotion: emotion,
      engagement,
      gaze,
      missing_face_ratio: missingFace,
      room: 'chat',
   };
}

describe('engagementAnalytics summary', () => {
   it('counts windows, distinct sessions, and engagement-bearing windows', () => {
      const a = engagementAnalytics([
         rec({ session: 's2', start: '2026-07-02T08:00:20.000Z' }), // newest
         rec({ session: 's1', start: '2026-07-02T08:00:10.000Z', engagement: null, gaze: null }),
         rec({ session: 's1', start: '2026-07-02T08:00:00.000Z' }), // oldest
      ]);
      expect(a.summary.windows).toBe(3);
      expect(a.summary.sessions).toBe(2);
      expect(a.summary.engagementWindows).toBe(2);
   });

   it('does not count a null session_id as a session', () => {
      const a = engagementAnalytics([rec({ session: 's1' }), rec({ session: null })]);
      expect(a.summary.sessions).toBe(1);
   });

   it('means run only over windows that carry the field — null ≠ 0', () => {
      const a = engagementAnalytics([
         rec({
            start: '2026-07-02T08:00:20.000Z',
            engagement: { focus_score: 0.8, blink_rate_hz: 0.4, eye_openness_mean: 0.9 },
            gaze: { off_screen_ratio: 0, calibration_quality: 1 },
            missingFace: 0,
         }),
         // Middle window has NO engagement/gaze blocks and no face ratio — it
         // must contribute nothing (not zeros) to every mean.
         rec({ start: '2026-07-02T08:00:10.000Z', engagement: null, gaze: null, missingFace: null }),
         rec({
            start: '2026-07-02T08:00:00.000Z',
            engagement: { focus_score: 0.6, blink_rate_hz: 0.2, eye_openness_mean: 0.5 },
            gaze: { off_screen_ratio: 0.2, calibration_quality: 0.8 },
            missingFace: 0.1,
         }),
      ]);
      expect(a.summary.avgFocus).toBeCloseTo(0.7, 10); // mean(0.6, 0.8), NOT /3
      expect(a.summary.avgBlinkHz).toBeCloseTo(0.3, 10);
      expect(a.summary.avgEyeOpenness).toBeCloseTo(0.7, 10);
      expect(a.summary.avgOffScreen).toBeCloseTo(0.1, 10); // a real 0 counts
      expect(a.summary.avgCalibrationQuality).toBeCloseTo(0.9, 10);
      expect(a.summary.avgMissingFace).toBeCloseTo(0.05, 10);
   });

   it('a genuine focus of 0 counts; all-absent metrics are null', () => {
      const a = engagementAnalytics([
         rec({ engagement: { focus_score: 0 }, gaze: null, missingFace: null }),
         rec({ engagement: null, gaze: null, missingFace: null }),
      ]);
      expect(a.summary.avgFocus).toBe(0);
      expect(a.summary.avgBlinkHz).toBeNull();
      expect(a.summary.avgEyeOpenness).toBeNull();
      expect(a.summary.avgOffScreen).toBeNull();
      expect(a.summary.avgCalibrationQuality).toBeNull();
      expect(a.summary.avgMissingFace).toBeNull();
   });
});

describe('engagementAnalytics byEmotion cross-tab', () => {
   it('hand-checked means per emotion; window counts include engagement-less windows', () => {
      const a = engagementAnalytics([
         rec({ emotion: 'happy', engagement: null, gaze: null }), // counts, contributes nothing
         rec({
            emotion: 'sad',
            engagement: { focus_score: 0.2, blink_rate_hz: 0.5, eye_openness_mean: 0.4 },
            gaze: { off_screen_ratio: 0.6 },
         }),
         rec({
            emotion: 'happy',
            engagement: { focus_score: 0.8, blink_rate_hz: 0.2, eye_openness_mean: 0.9 },
            gaze: { off_screen_ratio: 0.1 },
         }),
         rec({
            emotion: 'happy',
            engagement: { focus_score: 0.6, blink_rate_hz: 0.4, eye_openness_mean: 0.7 },
            gaze: { off_screen_ratio: 0.3 },
         }),
         rec({ emotion: null }), // no dominant emotion → no bucket
      ]);
      expect(a.byEmotion).toHaveLength(2);

      const happy = a.byEmotion[0];
      expect(happy.emotion).toBe('happy');
      expect(happy.windows).toBe(3);
      expect(happy.avgFocus).toBeCloseTo(0.7, 10); // mean(0.8, 0.6)
      expect(happy.avgBlinkHz).toBeCloseTo(0.3, 10);
      expect(happy.avgEyeOpenness).toBeCloseTo(0.8, 10);
      expect(happy.avgOffScreen).toBeCloseTo(0.2, 10);

      const sad = a.byEmotion[1];
      expect(sad.emotion).toBe('sad');
      expect(sad.windows).toBe(1);
      expect(sad.avgFocus).toBeCloseTo(0.2, 10);
      expect(sad.avgOffScreen).toBeCloseTo(0.6, 10);
   });

   it('sorts by window count desc, then emotion name for determinism', () => {
      const a = engagementAnalytics([
         rec({ emotion: 'sad' }),
         rec({ emotion: 'angry' }),
         rec({ emotion: 'neutral' }),
         rec({ emotion: 'neutral' }),
      ]);
      expect(a.byEmotion.map((r) => r.emotion)).toEqual(['neutral', 'angry', 'sad']);
   });
});

describe('engagementAnalytics series', () => {
   it('is chronological with t = ms since first window, from newest-first records', () => {
      const a = engagementAnalytics([
         rec({ start: '2026-07-02T08:00:20.000Z', engagement: { focus_score: 0.9 } }), // newest
         rec({ start: '2026-07-02T08:00:10.000Z', engagement: { focus_score: 0.5 } }),
         rec({ start: '2026-07-02T08:00:00.000Z', engagement: { focus_score: 0.1 } }), // oldest
      ]);
      expect(a.series.map((p) => p.t)).toEqual([0, 10000, 20000]);
      expect(a.series.map((p) => p.focus)).toEqual([0.1, 0.5, 0.9]);
   });

   it('carries nulls (line breaks) where a window lacks a metric', () => {
      const a = engagementAnalytics([
         rec({
            start: '2026-07-02T08:00:10.000Z',
            engagement: null,
            gaze: null,
            missingFace: null,
         }),
         rec({
            start: '2026-07-02T08:00:00.000Z',
            engagement: { focus_score: 0.7, eye_openness_mean: 0.6 },
            gaze: { off_screen_ratio: 0.2 },
            missingFace: 0.1,
         }),
      ]);
      expect(a.series[0]).toEqual({ t: 0, focus: 0.7, eyeOpenness: 0.6, offScreen: 0.2, missingFace: 0.1 });
      expect(a.series[1]).toEqual({ t: 10000, focus: null, eyeOpenness: null, offScreen: null, missingFace: null });
   });

   it('falls back to t = 0 when window_start is unparsable', () => {
      const a = engagementAnalytics([rec({ start: 'not-a-date' })]);
      expect(a.series[0].t).toBe(0);
   });
});

describe('engagementAnalytics empty input', () => {
   it('handles [] and undefined', () => {
      for (const input of [[], undefined]) {
         const a = engagementAnalytics(input);
         expect(a.summary.windows).toBe(0);
         expect(a.summary.sessions).toBe(0);
         expect(a.summary.engagementWindows).toBe(0);
         expect(a.summary.avgFocus).toBeNull();
         expect(a.summary.avgMissingFace).toBeNull();
         expect(a.byEmotion).toEqual([]);
         expect(a.series).toEqual([]);
      }
   });
});
