// Pure engagement/attention analytics over the hydrated emotion-record rows —
// everything the Attention view shows: aggregate summary chips, the
// emotion × attention cross-tab, and the chronological per-window series
// behind the single-session focus timeline / attention-lapse strip.
//
// Ported from chatoyon-plus src/lib/analytics/engagement.mjs (summary +
// cross-tab) and the series leg of its affect.ts; adaptations: operates
// directly on Rohy's emotion-record rows, which arrive NEWEST-FIRST from
// /addons/oyon/emotion-records — reversed here into chronological order the
// same way serverWindows.recordsToWindows does.
//
// Deliberately does NOT go through serverWindows.recordToWindow: its
// `finite()` coerces a SQL-NULL missing_face_ratio to 0 (`Number(null) === 0`),
// which would silently break the null semantics below.
//
// Null semantics throughout (mirrors gazeAnalytics.js): a metric absent from
// a window contributes NOTHING to a mean — null ≠ 0. A genuine 0 (e.g. an
// off_screen_ratio of 0) still counts.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function mean(values) {
   const nums = values.filter(isNum);
   if (nums.length === 0) return null;
   return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function parseTime(value) {
   return Date.parse(String(value ?? ''));
}

/**
 * Everything the Attention view needs, from one pool of emotion-record rows.
 *
 * @param {Array<object>} records — hydrated rows from the emotion-records API,
 *    newest-first (each row carries `engagement` object|null, `gaze`
 *    object|null, `dominant_emotion`, `session_id`, `window_start`,
 *    `missing_face_ratio`, …).
 * @returns {{
 *    summary: {
 *       windows: number,
 *       sessions: number,
 *       engagementWindows: number,
 *       avgFocus: number|null,
 *       avgEyeOpenness: number|null,
 *       avgBlinkHz: number|null,
 *       avgOffScreen: number|null,
 *       avgCalibrationQuality: number|null,
 *       avgMissingFace: number|null,
 *    },
 *    byEmotion: Array<{
 *       emotion: string,
 *       windows: number,
 *       avgFocus: number|null,
 *       avgBlinkHz: number|null,
 *       avgEyeOpenness: number|null,
 *       avgOffScreen: number|null,
 *    }>,
 *    series: Array<{
 *       t: number,
 *       focus: number|null,
 *       eyeOpenness: number|null,
 *       offScreen: number|null,
 *       missingFace: number|null,
 *    }>,
 * }}
 *    `summary` means are computed only over the windows that carry the field.
 *    `byEmotion` has one row per dominant emotion present (window count
 *    includes engagement-less windows), sorted by windows desc then name.
 *    `series` is chronological; `t` is ms since the first window_start.
 */
export function engagementAnalytics(records) {
   // The API delivers newest-first; reverse a copy → chronological.
   const rows = Array.isArray(records) ? records : [];
   const windows = rows.slice().reverse();

   const sessionIds = new Set();
   for (const w of windows) {
      if (w?.session_id != null) sessionIds.add(String(w.session_id));
   }

   const summary = {
      windows: windows.length,
      sessions: sessionIds.size,
      engagementWindows: windows.filter((w) => w?.engagement && typeof w.engagement === 'object').length,
      avgFocus: mean(windows.map((w) => w?.engagement?.focus_score)),
      avgEyeOpenness: mean(windows.map((w) => w?.engagement?.eye_openness_mean)),
      avgBlinkHz: mean(windows.map((w) => w?.engagement?.blink_rate_hz)),
      avgOffScreen: mean(windows.map((w) => w?.gaze?.off_screen_ratio)),
      avgCalibrationQuality: mean(windows.map((w) => w?.gaze?.calibration_quality)),
      avgMissingFace: mean(windows.map((w) => w?.missing_face_ratio)),
   };

   // Emotion × attention cross-tab — the scientifically interesting view
   // ("focus drops and off-screen rises while frustrated"). One bucket per
   // dominant emotion; the window count includes engagement-less windows but
   // each mean only sees the windows that carry that metric.
   const byEmotionMap = new Map();
   for (const w of windows) {
      const emotion = w?.dominant_emotion;
      if (!emotion) continue;
      const bucket = byEmotionMap.get(emotion) ?? { count: 0, focus: [], blink: [], eye: [], off: [] };
      bucket.count += 1;
      bucket.focus.push(w.engagement?.focus_score);
      bucket.blink.push(w.engagement?.blink_rate_hz);
      bucket.eye.push(w.engagement?.eye_openness_mean);
      bucket.off.push(w.gaze?.off_screen_ratio);
      byEmotionMap.set(emotion, bucket);
   }
   const byEmotion = [...byEmotionMap.entries()]
      .map(([emotion, b]) => ({
         emotion,
         windows: b.count,
         avgFocus: mean(b.focus),
         avgBlinkHz: mean(b.blink),
         avgEyeOpenness: mean(b.eye),
         avgOffScreen: mean(b.off),
      }))
      .sort((a, b) => b.windows - a.windows || a.emotion.localeCompare(b.emotion));

   // Per-window timeline. Only temporally meaningful when the pool is ONE
   // session (concatenating sessions would draw a fake line) — the view gates
   // on that; the math is the same either way.
   const start = parseTime(windows[0]?.window_start);
   const series = windows.map((w) => {
      const t = parseTime(w?.window_start);
      return {
         t: Number.isFinite(start) && Number.isFinite(t) ? t - start : 0,
         focus: isNum(w?.engagement?.focus_score) ? w.engagement.focus_score : null,
         eyeOpenness: isNum(w?.engagement?.eye_openness_mean) ? w.engagement.eye_openness_mean : null,
         offScreen: isNum(w?.gaze?.off_screen_ratio) ? w.gaze.off_screen_ratio : null,
         missingFace: isNum(w?.missing_face_ratio) ? w.missing_face_ratio : null,
      };
   });

   return { summary, byEmotion, series };
}

// ── Engagement-view helpers — port of the <oyon-app> element's Analyze ·
// Engagement summary (OyonR/standalone/app/src/routes/analyze/engagement.tsx).
// The element's other three means (focus / blink / openness) already come out
// of engagementAnalytics().summary above; these cover the two element-only
// pieces the Attention view does not surface.

/**
 * Mean per-window gaze entropy (engagement.gaze_entropy) over the windows
 * that carry it — the element's "Mean entropy" chip.
 * @param {Array<object>} records hydrated emotion-record rows
 * @returns {number|null} null when no window carries the field
 */
export function meanGazeEntropy(records) {
   const rows = Array.isArray(records) ? records : [];
   return mean(rows.map((r) => r?.engagement?.gaze_entropy));
}

/**
 * Quality tone for a mean focus score — the element's Metric thresholds:
 * > 0.6 good, > 0.4 borderline, otherwise poor.
 * @param {number|null|undefined} v mean focus 0…1
 * @returns {'ok'|'warn'|'bad'|null} null when focus was not measured
 */
export function focusTone(v) {
   if (!isNum(v)) return null;
   if (v > 0.6) return 'ok';
   if (v > 0.4) return 'warn';
   return 'bad';
}
