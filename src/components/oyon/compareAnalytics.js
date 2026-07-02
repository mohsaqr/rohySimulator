// Pure comparison analytics over the hydrated emotion-record rows —
// everything the Compare view shows: entity grouping (student | session |
// case), per-group summary stats, per-group dominant-emotion distributions,
// and per-group capture-timeline points.
//
// Ported from the <oyon-app> element's Analyze · Comparison route
// (OyonR/standalone/app/src/routes/analyze/comparison.tsx + lib/sessions.ts
// summarizeSessions + lib/analyzeWindows.ts). The element compares sessions
// only, in two modes:
//   1. multi-session — one timeline + distribution per session, newest first;
//   2. split-within-session — a single session is split by time into 2–6
//      slices ("first half vs second half" drift analysis).
// Both modes are preserved here. Rohy adaptation: the grouping key is
// selectable (compare-by student | session | case), and the per-group stats
// add mean valence / arousal / focus alongside the element's window count,
// dominant emotion + share and mean confidence.
//
// Null semantics (mirrors gazeAnalytics.js): a metric absent from a window
// contributes NOTHING to a mean — null ≠ 0.

import { dominantProbability, stateOf } from './affectAnalytics';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function mean(values) {
   const nums = values.filter(isNum);
   if (nums.length === 0) return null;
   return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function lastTime(windows) {
   const t = Date.parse(String(windows[windows.length - 1]?.window_start ?? ''));
   return Number.isFinite(t) ? t : 0;
}

/**
 * Grouping key of one record for a compare-by dimension.
 * @param {object} record hydrated emotion-record row
 * @param {'student'|'session'|'case'} by
 * @returns {string} never empty — unknowable keys fall back to '(unknown)'
 */
export function entityKeyOf(record, by) {
   if (by === 'student') {
      return record?.username
         || record?.student_name_snapshot
         || (record?.user_id != null ? `user ${record.user_id}` : '(unknown)');
   }
   if (by === 'case') {
      return record?.case_title_snapshot
         || (record?.case_id != null ? `case ${record.case_id}` : '(unknown)');
   }
   return record?.session_id != null ? String(record.session_id) : '(unknown)';
}

/**
 * Split a chronological window array into up to `parts` contiguous time
 * slices — port of the element's splitInto (ceil-sized slices; trailing
 * slices may be shorter; empty slices are dropped).
 * @param {Array<object>} windows chronological
 * @param {number} parts
 * @returns {Array<Array<object>>}
 */
export function splitIntoSlices(windows, parts) {
   const ws = Array.isArray(windows) ? windows : [];
   if (!ws.length) return [];
   const p = Math.floor(Number(parts));
   if (!Number.isFinite(p) || p <= 1 || ws.length <= 1) return [ws.slice()];
   const size = Math.ceil(ws.length / p);
   const slices = [];
   for (let i = 0; i < p; i += 1) {
      const slice = ws.slice(i * size, (i + 1) * size);
      if (slice.length) slices.push(slice);
   }
   return slices;
}

/**
 * Summary stats for one group of windows — the element's summarizeOne
 * (SessionSummary) plus mean valence / arousal.
 * @param {Array<object>} windows
 * @returns {{
 *    windowCount: number,
 *    dominantEmotion: string|null,
 *    dominantShare: number|null,
 *    meanValence: number|null,
 *    meanArousal: number|null,
 *    meanFocus: number|null,
 *    meanConfidence: number|null,
 * }}
 */
export function groupStats(windows) {
   const ws = Array.isArray(windows) ? windows : [];
   const counts = new Map();
   for (const w of ws) {
      const s = stateOf(w);
      counts.set(s, (counts.get(s) ?? 0) + 1);
   }
   const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? null;
   return {
      windowCount: ws.length,
      dominantEmotion: top ? top[0] : null,
      dominantShare: top && ws.length ? top[1] / ws.length : null,
      meanValence: mean(ws.map((w) => w?.valence)),
      meanArousal: mean(ws.map((w) => w?.arousal)),
      meanFocus: mean(ws.map((w) => w?.engagement?.focus_score)),
      meanConfidence: mean(ws.map((w) => w?.confidence)),
   };
}

/**
 * Dominant-emotion distribution of one group, descending by count.
 * @param {Array<object>} windows
 * @returns {Array<{emotion: string, count: number, share: number}>}
 */
export function distributionOf(windows) {
   const ws = Array.isArray(windows) ? windows : [];
   const counts = new Map();
   for (const w of ws) {
      const s = stateOf(w);
      counts.set(s, (counts.get(s) ?? 0) + 1);
   }
   return [...counts.entries()]
      .map(([emotion, count]) => ({ emotion, count, share: ws.length ? count / ws.length : 0 }))
      .sort((a, b) => b.count - a.count || a.emotion.localeCompare(b.emotion));
}

/**
 * Everything the Compare view needs, from one pool of emotion-record rows.
 *
 * @param {Array<object>} records hydrated rows, newest-first.
 * @param {{by?: 'student'|'session'|'case', slices?: number}} [options]
 *    `slices` (element range 2–6, clamped) only matters in slice mode.
 * @returns {{
 *    mode: 'entities'|'slices',
 *    by: string,
 *    totalWindows: number,
 *    groups: Array<{
 *       id: string,
 *       label: string,
 *       windows: Array<object>,
 *       stats: ReturnType<typeof groupStats>,
 *       distribution: ReturnType<typeof distributionOf>,
 *       timeline: Array<{emotion: string, prob: number}>,
 *    }>,
 * }}
 *    Entity mode sorts groups newest-activity-first (the element's recency
 *    order). Slice mode fires — as in the element — when comparing by
 *    session and only ONE session is present with 2+ windows.
 */
export function compareRecords(records, { by = 'session', slices = 2 } = {}) {
   const rows = Array.isArray(records) ? records : [];
   // The API delivers newest-first; reverse a copy → chronological.
   const windows = rows.slice().reverse();

   const byKey = new Map();
   for (const w of windows) {
      const key = entityKeyOf(w, by);
      const bucket = byKey.get(key);
      if (bucket) bucket.push(w);
      else byKey.set(key, [w]);
   }

   let mode = 'entities';
   let rawGroups;
   if (by === 'session' && byKey.size === 1 && windows.length > 1) {
      // Element behavior: one session splits into 2–6 time slices.
      mode = 'slices';
      const [id, ws] = [...byKey.entries()][0];
      const clamped = Math.min(6, Math.max(2, Math.floor(Number(slices)) || 2));
      const parts = splitIntoSlices(ws, clamped);
      rawGroups = parts.map((sliceWs, i) => ({
         id: `${id}#${i + 1}`,
         label: `${id} · slice ${i + 1}/${parts.length}`,
         windows: sliceWs,
      }));
   } else {
      rawGroups = [...byKey.entries()]
         .map(([id, ws]) => ({ id, label: id, windows: ws }))
         .sort((a, b) => lastTime(b.windows) - lastTime(a.windows));
   }

   const groups = rawGroups.map((g) => ({
      ...g,
      stats: groupStats(g.windows),
      distribution: distributionOf(g.windows),
      timeline: g.windows.map((w) => ({
         emotion: stateOf(w),
         prob: Math.max(0, Math.min(1, dominantProbability(w))),
      })),
   }));

   return { mode, by, totalWindows: windows.length, groups };
}
