import { canonicalEmotionLabel } from './emotionVocabulary';

// Pure client-side rollups over hydrated /addons/oyon/emotion-records rows —
// the aggregation logic behind the standalone data views (OyonWindowsView's
// quality filter, OyonStudentsView's per-student table, OyonCasesView's
// per-case table). Extracted from OyonLearningAnalyticsTab, which pushed the
// same shapes to the server (/analytics/students, /analytics/cases,
// min_confidence / max_missing_face_ratio query filters); standalone, the
// views compute them from the records they are handed. No DOM, no React.

function meanOf(values) {
   // NULLs are skipped (like SQL AVG) — never coerced to 0.
   const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v));
   if (!nums.length) return null;
   return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Client-side quality filter over hydrated emotion-record rows. Constraints
 *  only bite when moved off their permissive default; a record without the
 *  needed numeric field fails an ACTIVE numeric constraint (mirrors the old
 *  server-side min_confidence / max_missing_face_ratio semantics). */
export function filterRecords(records, { minConfidence, maxMissingFace, dominant }) {
   return (Array.isArray(records) ? records : []).filter(r => {
      if (minConfidence > 0) {
         const conf = Number(r.confidence);
         if (!Number.isFinite(conf) || conf < minConfidence) return false;
      }
      if (maxMissingFace < 1) {
         const miss = Number(r.missing_face_ratio);
         if (!Number.isFinite(miss) || miss > maxMissingFace) return false;
      }
      if (dominant.length > 0) {
         const label = canonicalEmotionLabel(r.dominant_emotion);
         if (!dominant.includes(label)) return false;
      }
      return true;
   });
}

/** Group hydrated window records into per-student rollups (the shape the old
 *  server /analytics/students endpoint returned), sorted by window count. */
export function studentAggregates(records) {
   const byStudent = new Map();
   for (const r of Array.isArray(records) ? records : []) {
      const key = r.user_id != null
         ? `u:${r.user_id}`
         : `anon:${r.username || r.student_name_snapshot || 'unknown'}`;
      let g = byStudent.get(key);
      if (!g) {
         g = {
            user_id: r.user_id ?? null,
            username: r.username || null,
            student_label: r.student_name_snapshot || r.username || 'anonymised',
            user_role: r.user_role || r.student_role_snapshot || null,
            sessions: new Set(),
            cases: new Set(),
            dominantCounts: new Map(),
            windows: [],
         };
         byStudent.set(key, g);
      }
      if (r.session_id != null) g.sessions.add(String(r.session_id));
      if (r.case_id != null) g.cases.add(String(r.case_id));
      if (r.dominant_emotion) {
         const d = canonicalEmotionLabel(r.dominant_emotion);
         g.dominantCounts.set(d, (g.dominantCounts.get(d) ?? 0) + 1);
      }
      g.windows.push(r);
   }
   return [...byStudent.values()]
      .map(g => {
         let top = null;
         let topCount = 0;
         for (const [label, count] of g.dominantCounts) {
            if (count > topCount) { top = label; topCount = count; }
         }
         const starts = g.windows.map(w => w.window_start).filter(Boolean).sort();
         return {
            user_id: g.user_id,
            username: g.username,
            student_label: g.student_label,
            user_role: g.user_role,
            sessions_count: g.sessions.size,
            cases_count: g.cases.size,
            window_count: g.windows.length,
            top_dominant_estimate: top,
            mean_valence: meanOf(g.windows.map(w => w.valence)),
            mean_arousal: meanOf(g.windows.map(w => w.arousal)),
            mean_confidence: meanOf(g.windows.map(w => w.confidence)),
            mean_missing_face_ratio: meanOf(g.windows.map(w => w.missing_face_ratio)),
            first_window: starts[0] ?? null,
            last_window: starts[starts.length - 1] ?? null,
         };
      })
      .sort((a, b) => b.window_count - a.window_count);
}

/** Group hydrated window records into per-case rollups (the shape the old
 *  server /analytics/cases endpoint returned), sorted by window count. */
export function caseAggregates(records) {
   const byCase = new Map();
   for (const r of Array.isArray(records) ? records : []) {
      const key = r.case_id != null ? `c:${r.case_id}` : `t:${r.case_title_snapshot || 'unknown'}`;
      let g = byCase.get(key);
      if (!g) {
         g = {
            case_id: r.case_id ?? null,
            case_title: r.case_title_snapshot || null,
            case_category: r.case_category_snapshot || null,
            students: new Set(),
            sessions: new Set(),
            dist: {},
            windows: [],
         };
         byCase.set(key, g);
      }
      const studentKey = r.user_id != null
         ? `u:${r.user_id}`
         : `anon:${r.username || r.student_name_snapshot || 'unknown'}`;
      g.students.add(studentKey);
      if (r.session_id != null) g.sessions.add(String(r.session_id));
      if (r.dominant_emotion) {
         const d = canonicalEmotionLabel(r.dominant_emotion);
         g.dist[d] = (g.dist[d] ?? 0) + 1;
      }
      g.windows.push(r);
   }
   return [...byCase.values()]
      .map(g => ({
         case_id: g.case_id,
         case_title: g.case_title,
         case_category: g.case_category,
         students_count: g.students.size,
         sessions_count: g.sessions.size,
         window_count: g.windows.length,
         dominant_estimate_distribution: g.dist,
         mean_valence: meanOf(g.windows.map(w => w.valence)),
         mean_confidence: meanOf(g.windows.map(w => w.confidence)),
      }))
      .sort((a, b) => b.window_count - a.window_count);
}
