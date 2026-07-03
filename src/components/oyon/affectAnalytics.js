import { canonicalEmotionLabel } from './emotionVocabulary';

// Pure affect analytics over the hydrated emotion-record rows — everything the
// Affect view shows: the KPI summary chips, the capture-timeline strip, the
// valence × arousal plane trail, the dominant-emotion distribution, and the
// dynamics (affect speed / instability) series.
//
// Ported from the <oyon-app> element's Analyze · Affect route
// (OyonR/standalone/app/src/routes/analyze/affect.tsx) and the pieces it
// composes: legacy/dashboard.js summarizeKpis / drawDistribution /
// drawDynamics / enrichWindows, charts/EmotionTimeline.tsx and
// charts/AffectPad.tsx. Adaptations: operates directly on Rohy's
// emotion-record rows, which arrive NEWEST-FIRST from
// /addons/oyon/emotion-records — reversed here into chronological order the
// same way engagementAnalytics does — and, like the element's enrichWindows,
// computes fallback dynamics client-side (a faithful port of OyonR
// src/analytics/DynamicalFeatures.js) when a record carries no stored
// dynamics blob.
//
// Null semantics (mirrors gazeAnalytics.js / engagementAnalytics.js): a
// metric absent from a window contributes NOTHING — null ≠ 0. The one
// deliberate deviation from the element: latest quality is null (— in the
// chip) when missing_face_ratio is null, where the legacy summarizeKpis
// coerced null to 0 (i.e. "100% quality"), hiding absent data.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function clamp01(v) {
   if (!isNum(v)) return 0;
   return Math.max(0, Math.min(1, v));
}

/**
 * Circumplex quadrant of a (valence, arousal) pair — port of OyonR's
 * phaseQuadrant (src/analytics/DynamicalFeatures.js).
 * @param {number|null|undefined} valence −1…+1
 * @param {number|null|undefined} arousal −1…+1
 * @returns {'positive-activated'|'positive-calm'|'negative-activated'|'negative-calm'|null}
 */
export function quadrantOf(valence, arousal) {
   if (!isNum(valence) || !isNum(arousal)) return null;
   if (valence >= 0 && arousal >= 0) return 'positive-activated';
   if (valence >= 0) return 'positive-calm';
   if (arousal >= 0) return 'negative-activated';
   return 'negative-calm';
}

/**
 * Probability of the dominant emotion in a window — the element's
 * EmotionTimeline bar height. Max over the probabilities blob when present;
 * Rohy adaptation: falls back to the stored scalar `confidence` (the
 * aggregator's mean top-probability) before giving up with 0.
 * @param {object} record hydrated emotion-record row
 * @returns {number} 0…1
 */
export function dominantProbability(record) {
   const probs = record?.probabilities;
   if (probs && typeof probs === 'object') {
      const vals = Object.values(probs).filter(isNum);
      if (vals.length) return Math.max(...vals);
   }
   return isNum(record?.confidence) ? record.confidence : 0;
}

/** Canonical state label: trimmed lowercase dominant_emotion, else the
 *  element's 'insufficient' bucket. */
export function stateOf(record) {
   const d = record?.dominant_emotion;
   return typeof d === 'string' && d.trim() ? canonicalEmotionLabel(d) : 'insufficient';
}

// ── Fallback dynamics — port of OyonR src/analytics/DynamicalFeatures.js ──
// (only the signals the Affect view consumes: affect_speed,
// instability_score, phase_quadrant).

function deltaSeconds(previousIso, currentIso) {
   if (!previousIso || !currentIso) return null;
   const previous = Date.parse(previousIso);
   const current = Date.parse(currentIso);
   if (!Number.isFinite(previous) || !Number.isFinite(current) || current <= previous) return null;
   return (current - previous) / 1000;
}

function slope(previous, current, seconds) {
   if (!isNum(previous) || !isNum(current) || !isNum(seconds) || seconds <= 0) return null;
   return (current - previous) / seconds;
}

function volatility(values) {
   const valid = values.filter(isNum);
   if (valid.length < 2) return null;
   const m = valid.reduce((sum, v) => sum + v, 0) / valid.length;
   const variance = valid.reduce((sum, v) => sum + (v - m) ** 2, 0) / valid.length;
   return Math.sqrt(variance);
}

function instabilityScore({ affectSpeed, affectVolatility, entropy, missingFaceRatio, labelChanged }) {
   const parts = [
      clamp01((affectSpeed || 0) / 0.2),
      clamp01((affectVolatility || 0) / 0.5),
      clamp01((entropy || 0) / 3),
      clamp01(missingFaceRatio || 0),
      labelChanged ? 0.2 : 0,
   ];
   return parts.reduce((sum, v) => sum + v, 0) / parts.length;
}

/**
 * Client-side dynamics for one window when the DB row has no stored blob —
 * same math as OyonR's computeDynamicalFeatures, restricted to the fields
 * the Affect view reads.
 * @param {object} window chronological record
 * @param {object|null} previous the record before it (same pool)
 * @returns {{affect_speed: number|null, instability_score: number, phase_quadrant: string|null}}
 */
export function fallbackDynamics(window, previous = null) {
   const dt = deltaSeconds(previous?.window_end, window?.window_end);
   const valenceVelocity = slope(previous?.valence, window?.valence, dt);
   const arousalVelocity = slope(previous?.arousal, window?.arousal, dt);
   const affectSpeed = isNum(valenceVelocity) && isNum(arousalVelocity)
      ? Math.hypot(valenceVelocity, arousalVelocity)
      : null;
   const transitionFrom = previous?.dominant_emotion || null;
   const transitionTo = window?.dominant_emotion || null;
   const labelChanged = Boolean(transitionFrom && transitionTo && transitionFrom !== transitionTo);
   const affectVolatility = volatility([
      previous?.valence, window?.valence,
      previous?.arousal, window?.arousal,
   ]);
   return {
      affect_speed: isNum(affectSpeed) ? affectSpeed : null,
      instability_score: instabilityScore({
         affectSpeed,
         affectVolatility,
         entropy: window?.entropy,
         missingFaceRatio: window?.missing_face_ratio,
         labelChanged,
      }),
      phase_quadrant: quadrantOf(window?.valence, window?.arousal),
   };
}

/**
 * Everything the Affect view needs, from one pool of emotion-record rows.
 *
 * @param {Array<object>} records hydrated rows from the emotion-records API,
 *    newest-first (fields read: dominant_emotion, probabilities, confidence,
 *    valence, arousal, entropy, missing_face_ratio, dynamics, window_end).
 * @returns {{
 *    summary: {
 *       windows: number,
 *       latestState: string|null,
 *       latestQuality: number|null,
 *       analyzedWindows: number,
 *       affectSpeed: number|null,
 *       instability: number|null,
 *    },
 *    timeline: Array<{emotion: string, prob: number}>,
 *    plane: Array<{v: number, a: number, emotion: string, quadrant: string}>,
 *    distribution: Array<{emotion: string, count: number}>,
 *    dynamics: Array<{speed: number|null, instability: number|null}>,
 * }}
 *    All series are chronological. `distribution` is the top 10 dominant
 *    emotions by window count, descending (ties alphabetical). `plane` keeps
 *    only windows with finite valence AND arousal.
 */
export function affectAnalytics(records) {
   // The API delivers newest-first; reverse a copy → chronological.
   const rows = Array.isArray(records) ? records : [];
   const windows = rows.slice().reverse();

   // Stored dynamics blob when present, element-style fallback otherwise.
   const dynamicsBlobs = windows.map((w, i) => {
      const stored = w?.dynamics;
      if (stored && typeof stored === 'object') return stored;
      return fallbackDynamics(w, i > 0 ? windows[i - 1] : null);
   });

   const latest = windows[windows.length - 1] ?? null;
   const latestDynamics = dynamicsBlobs[dynamicsBlobs.length - 1] ?? null;

   const summary = {
      windows: windows.length,
      latestState: latest ? stateOf(latest) : null,
      latestQuality: latest && isNum(latest.missing_face_ratio) ? 1 - latest.missing_face_ratio : null,
      analyzedWindows: dynamicsBlobs.filter((d) => d && typeof d === 'object').length,
      affectSpeed: isNum(latestDynamics?.affect_speed) ? latestDynamics.affect_speed : null,
      instability: isNum(latestDynamics?.instability_score) ? latestDynamics.instability_score : null,
   };

   const timeline = windows.map((w) => ({
      emotion: stateOf(w),
      prob: clamp01(dominantProbability(w)),
   }));

   const plane = windows
      .map((w) => ({ v: w?.valence, a: w?.arousal, emotion: stateOf(w) }))
      .filter((p) => isNum(p.v) && isNum(p.a))
      .map((p) => ({ ...p, quadrant: quadrantOf(p.v, p.a) }));

   const counts = new Map();
   for (const t of timeline) counts.set(t.emotion, (counts.get(t.emotion) ?? 0) + 1);
   const distribution = [...counts.entries()]
      .map(([emotion, count]) => ({ emotion, count }))
      .sort((a, b) => b.count - a.count || a.emotion.localeCompare(b.emotion))
      .slice(0, 10);

   const dynamics = dynamicsBlobs.map((d) => ({
      speed: isNum(d?.affect_speed) ? d.affect_speed : null,
      instability: isNum(d?.instability_score) ? d.instability_score : null,
   }));

   return { summary, timeline, plane, distribution, dynamics };
}
