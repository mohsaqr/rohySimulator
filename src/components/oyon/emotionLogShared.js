// Shared formatting + styling helpers for Oyon analytics surfaces.
// Used by OyonLearningAnalyticsTab. Pulled out of the deleted
// EmotionLogsTable.jsx so we keep one source of colour + format truth.

import { OYON_EMOTION_LABELS, canonicalEmotionLabel } from './emotionVocabulary';

// 500/600-level palette — the old 300/400 pastels were tuned for the dark
// theme and washed out as text/lines on the white analytics surface.
export function emotionColor(label) {
   const k = canonicalEmotionLabel(label);
   if (k === 'happy') return '#10b981';
   if (k === 'sad') return '#3b82f6';
   if (k === 'anger') return '#ef4444';
   if (k === 'fear') return '#d97706';
   if (k === 'surprise') return '#c026d3';
   if (k === 'disgust') return '#65a30d';
   if (k === 'contempt') return '#f43f5e';
   if (k === 'neutral') return '#0891b2';
   return '#6b7280';
}

export const ALL_DOMINANT_LABELS = OYON_EMOTION_LABELS;

export function pct(v) {
   return Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—';
}

// Signed valence string with explicit + on positives so educators don't
// misread a +0.04 as a 0.04. Always estimate framing.
export function signed(v) {
   if (!Number.isFinite(v)) return '—';
   return (v >= 0 ? '+' : '') + v.toFixed(2);
}

export function fix2(v) {
   return Number.isFinite(v) ? v.toFixed(2) : '—';
}

export function signedColor(v) {
   if (!Number.isFinite(v)) return '#6b7280';
   return v >= 0 ? '#059669' : '#2563eb';
}

export function fmtTime(ts) {
   if (!ts) return '—';
   const d = new Date(ts);
   if (Number.isNaN(d.getTime())) return String(ts);
   return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
}

// Quality verdict for a per-student rollup. Surfaces uncertainty before the
// educator reads the values — high missingness or low confidence means the
// model didn't have a strong signal, full stop. Returns one of:
//   { level: 'green' | 'amber' | 'red', label: string }
export function qualityVerdict({ mean_confidence, mean_missing_face_ratio }) {
   const conf = Number(mean_confidence);
   const miss = Number(mean_missing_face_ratio);
   if (Number.isFinite(conf) && conf < 0.3) return { level: 'red', label: 'low signal' };
   if (Number.isFinite(miss) && miss > 0.4) return { level: 'red', label: 'face often missing' };
   if (Number.isFinite(conf) && conf < 0.5) return { level: 'amber', label: 'borderline confidence' };
   if (Number.isFinite(miss) && miss > 0.2) return { level: 'amber', label: 'partial face tracking' };
   return { level: 'green', label: 'good signal' };
}

// ──────────────────────────────────────────────────────────────────────
// Export helpers — CSV/JSON download of hydrated emotion-record rows.
// Shared by the Windows and Sessions data views.
// ──────────────────────────────────────────────────────────────────────

export const RECORD_CSV_HEADERS = [
   'window_start', 'window_end', 'session_id', 'user_id', 'username', 'user_role',
   'student_name_snapshot', 'case_id', 'case_title_snapshot', 'case_category_snapshot',
   'dominant_expression_estimate', 'confidence', 'valence_estimate', 'arousal_estimate',
   'entropy', 'valid_frames', 'missing_face_ratio',
   'model_name', 'model_version', 'capture_mode', 'capture_status',
   'consent_version', 'consent_recorded_at',
];

export function csvCell(v) {
   if (v == null) return '';
   const s = String(v);
   if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
   return s;
}

/** Pure CSV builder over hydrated emotion-record rows — one row per window,
 *  RECORD_CSV_HEADERS order. Kept pure (no DOM) so it stays testable. */
export function buildRecordsCsv(records) {
   const rows = (records || []).map(r => [
      r.window_start, r.window_end, r.session_id, r.user_id ?? '', r.username ?? '', r.user_role ?? '',
      r.student_name_snapshot ?? '', r.case_id ?? '', r.case_title_snapshot ?? '', r.case_category_snapshot ?? '',
      r.dominant_emotion ?? '', r.confidence ?? '', r.valence ?? '', r.arousal ?? '',
      r.entropy ?? '', r.valid_frames ?? '', r.missing_face_ratio ?? '',
      r.model_name ?? '', r.model_version ?? '', r.capture_mode ?? '', r.capture_status ?? '',
      r.consent_version ?? '', r.consent_recorded_at ?? '',
   ].map(csvCell).join(','));
   return [RECORD_CSV_HEADERS.join(','), ...rows].join('\n');
}

export function exportFileName(base, ext) {
   const date = new Date().toISOString().split('T')[0];
   return `${base}-${date}.${ext}`;
}

export function downloadText(text, filename, mime) {
   const blob = new Blob([text], { type: mime });
   const url = URL.createObjectURL(blob);
   const a = document.createElement('a');
   a.href = url;
   a.download = filename;
   document.body.appendChild(a);
   a.click();
   a.remove();
   URL.revokeObjectURL(url);
}

export function exportRecordsCsv(records, base = 'oyon-windows') {
   downloadText(buildRecordsCsv(records), exportFileName(base, 'csv'), 'text/csv');
}

export function exportRecordsJson(records, base = 'oyon-windows', filters = null) {
   const payload = {
      exported_at: new Date().toISOString(),
      filters,
      windows: records,
      _note: 'Values are model estimates of facial expression; not direct measures of feelings.',
   };
   downloadText(JSON.stringify(payload, null, 2), exportFileName(base, 'json'), 'application/json');
}
