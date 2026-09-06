import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Download } from 'lucide-react';
import { apiFetch } from '../../services/apiClient';
import {
   emotionColor, pct, fmtTime, exportRecordsCsv, exportRecordsJson,
} from './emotionLogShared';

/*
 * Sessions data view — the session list with drill-in extracted from
 * OyonLearningAnalyticsTab, made presentational over a hydrated
 * emotion-record `records` prop. Grouping by session is client-side; the
 * drill-in still fetches the full session detail from
 * /addons/oyon/analytics/session/{id} (loading + error states), rendering
 * the per-window emotion strip (SessionTimeline) and the valence SVG line
 * (ValenceLine). CSV / JSON export covers the passed records.
 */

export default function OyonSessionsView({ records }) {
   const { t } = useTranslation('oyon');
   const rows = useMemo(() => (Array.isArray(records) ? records : []), [records]);
   const [selectedSessionId, setSelectedSessionId] = useState(null);
   const [sessionDetail, setSessionDetail] = useState(null);
   // Guards the async drill-in: only the LATEST requested session may write
   // sessionDetail (fast click-through must not resurrect a stale response).
   const requestedIdRef = useRef(null);

   // Group records by session for the picker.
   const grouped = useMemo(() => {
      const m = new Map();
      for (const r of rows) {
         const key = String(r.session_id || 'unknown');
         if (!m.has(key)) {
            m.set(key, {
               session_id: r.session_id,
               student_label: r.username || r.student_name_snapshot || r.user_id || t('unknown_student'),
               case_label: r.case_title_snapshot
                  || (r.case_id ? t('case_fallback', { id: r.case_id }) : t('unknown_case')),
               windows: [],
            });
         }
         m.get(key).windows.push(r);
      }
      return Array.from(m.values());
   }, [rows, t]);

   const openSession = async (sessionId) => {
      if (selectedSessionId === sessionId) {
         // Toggle closed.
         requestedIdRef.current = null;
         setSelectedSessionId(null);
         setSessionDetail(null);
         return;
      }
      requestedIdRef.current = sessionId;
      setSelectedSessionId(sessionId);
      setSessionDetail(null);
      try {
         const detail = await apiFetch(`/addons/oyon/analytics/session/${sessionId}`);
         if (requestedIdRef.current === sessionId) setSessionDetail(detail);
      } catch (e) {
         if (requestedIdRef.current === sessionId) {
            setSessionDetail({ error: e?.message || t('session_detail_failed') });
         }
      }
   };

   return (
      <div className="rohy-admin-light space-y-3">
         <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-600">
               {t('sessions_summary', { windows: rows.length, sessions: grouped.length })}
            </span>
            <span className="ml-auto inline-flex gap-2">
               <button
                  onClick={() => exportRecordsCsv(rows, 'oyon-sessions')}
                  disabled={!rows.length}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-gray-300 text-gray-900 hover:bg-gray-100 text-sm disabled:opacity-50"
               >
                  <Download className="w-4 h-4" /> {t('export_csv')}
               </button>
               <button
                  onClick={() => exportRecordsJson(rows, 'oyon-sessions')}
                  disabled={!rows.length}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-gray-300 text-gray-900 hover:bg-gray-100 text-sm disabled:opacity-50"
               >
                  <Download className="w-4 h-4" /> {t('export_json')}
               </button>
            </span>
         </div>

         {!grouped.length && <Empty msg={t('sessions_empty')} />}

         <div className="grid gap-2">
            {grouped.map(g => (
               <div key={g.session_id} className="rounded-lg border border-gray-200 bg-white">
                  <button
                     onClick={() => openSession(g.session_id)}
                     className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-gray-50"
                  >
                     <ChevronRight className={`w-4 h-4 transition-transform ${selectedSessionId === g.session_id ? 'rotate-90' : ''}`} />
                     <span className="font-semibold text-gray-900">{t('session_label', { id: g.session_id })}</span>
                     <span className="text-gray-600">·</span>
                     <span className="text-gray-800">{g.student_label}</span>
                     <span className="text-gray-600">·</span>
                     <span className="text-gray-800">{g.case_label}</span>
                     <span className="ml-auto text-xs text-gray-500">{t('session_window_count', { count: g.windows.length })}</span>
                  </button>
                  {selectedSessionId === g.session_id && (
                     <div className="border-t border-gray-200 p-3">
                        {sessionDetail?.error && <div className="text-sm text-red-300">{sessionDetail.error}</div>}
                        {!sessionDetail && <div className="text-sm text-gray-500">{t('loading')}</div>}
                        {sessionDetail && !sessionDetail.error && <SessionTimeline detail={sessionDetail} t={t} />}
                     </div>
                  )}
               </div>
            ))}
         </div>
      </div>
   );
}

function SessionTimeline({ detail, t }) {
   const windows = detail.oyon_windows || [];
   if (!windows.length) return <div className="text-sm text-gray-500">{t('session_no_windows')}</div>;

   const startMs = Math.min(
      ...windows.map(w => Date.parse(w.window_start + (w.window_start.endsWith('Z') ? '' : 'Z'))).filter(Number.isFinite)
   );
   const endMs = Math.max(
      ...windows.map(w => Date.parse(w.window_end + (w.window_end.endsWith('Z') ? '' : 'Z'))).filter(Number.isFinite)
   );
   const totalMs = Math.max(1, endMs - startMs);

   return (
      <div className="space-y-2">
         <div className="text-xs text-gray-600 mb-1">{t('session_dominant_per_window')}</div>
         <div className="relative h-6 rounded bg-gray-100 overflow-hidden">
            {windows.map((w, i) => {
               const a = Math.max(0, (Date.parse(w.window_start + 'Z') - startMs) / totalMs);
               const b = Math.max(a + 0.005, (Date.parse(w.window_end + 'Z') - startMs) / totalMs);
               return (
                  <div
                     key={i}
                     className="absolute top-0 bottom-0"
                     style={{
                        left: `${a * 100}%`,
                        width: `${(b - a) * 100}%`,
                        background: emotionColor(w.dominant_emotion),
                        opacity: Number.isFinite(w.confidence) ? Math.max(0.3, w.confidence) : 0.5,
                     }}
                     title={t('session_window_tooltip', {
                        time: fmtTime(w.window_start),
                        emotion: w.dominant_emotion || '—',
                        confidence: pct(w.confidence),
                        missing: pct(w.missing_face_ratio),
                     })}
                  />
               );
            })}
         </div>

         <div className="text-xs text-gray-600 mt-3 mb-1">{t('session_valence_estimate')}</div>
         <ValenceLine windows={windows} startMs={startMs} totalMs={totalMs} t={t} />

         <div className="text-[11px] text-gray-500 italic mt-3 leading-snug">
            {t('session_note')}
         </div>
      </div>
   );
}

function ValenceLine({ windows, startMs, totalMs, t }) {
   const W = 800, H = 60, PAD = 4;
   const points = windows
      .filter(w => Number.isFinite(w.valence))
      .map(w => {
         const ts = Date.parse(w.window_start + 'Z');
         const x = PAD + ((ts - startMs) / totalMs) * (W - 2 * PAD);
         const y = PAD + (1 - (Math.max(-1, Math.min(1, w.valence)) + 1) / 2) * (H - 2 * PAD);
         return `${x.toFixed(1)},${y.toFixed(1)}`;
      });
   return (
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-12 rounded bg-gray-100">
         <line x1={PAD} y1={H/2} x2={W-PAD} y2={H/2} stroke="#d1d5db" strokeDasharray="3 3" />
         {points.length >= 2 && (
            <polyline fill="none" stroke="#0f766e" strokeWidth="2" points={points.join(' ')} />
         )}
         {!points.length && (
            <text x={W/2} y={H/2 + 4} fontSize="10" fill="#6b7280" textAnchor="middle">{t('session_no_valence')}</text>
         )}
      </svg>
   );
}

function Empty({ msg }) {
   return (
      <div className="rohy-admin-light rounded-md border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
         {msg}
      </div>
   );
}
