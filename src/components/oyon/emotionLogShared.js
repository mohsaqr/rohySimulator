// Shared formatting + styling helpers for Oyon analytics surfaces.
// Used by OyonLearningAnalyticsTab. Pulled out of the deleted
// EmotionLogsTable.jsx so we keep one source of colour + format truth.

export function emotionColor(label) {
   const k = String(label || '').toLowerCase();
   if (k === 'happy' || k === 'joy' || k === 'happiness') return '#34d399';
   if (k === 'sad' || k === 'sadness') return '#60a5fa';
   if (k === 'angry' || k === 'anger') return '#f87171';
   if (k === 'fear') return '#fbbf24';
   if (k === 'surprise') return '#e879f9';
   if (k === 'disgust') return '#a3e635';
   if (k === 'contempt') return '#fda4af';
   if (k === 'neutral') return '#22d3ee';
   return '#737373';
}

export const ALL_DOMINANT_LABELS = [
   'happy', 'sad', 'angry', 'fear', 'surprise', 'disgust', 'contempt', 'neutral',
];

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
   if (!Number.isFinite(v)) return '#737373';
   return v >= 0 ? '#34d399' : '#60a5fa';
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
