import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import {
   emotionColor, ALL_DOMINANT_LABELS, pct, signed, fix2, signedColor, fmtTime,
   exportRecordsCsv, exportRecordsJson,
} from './emotionLogShared';
import { filterRecords } from './recordAggregates';

/*
 * Windows data view — the per-window table extracted from
 * OyonLearningAnalyticsTab, made presentational over a hydrated
 * emotion-record `records` prop. The old tab pushed quality filtering to the
 * server; standalone, the same controls live at the top of this view and
 * filter the passed records CLIENT-SIDE (filterRecords in
 * recordAggregates.js): min-confidence slider, max-missing-face slider, and
 * a dominant-emotion multi-select. CSV / JSON export covers the FILTERED
 * rows.
 */

export default function OyonWindowsView({ records, loading }) {
   const rows = useMemo(() => (Array.isArray(records) ? records : []), [records]);
   const [expandedId, setExpandedId] = useState(null);
   const [minConfidence, setMinConfidence] = useState(0);
   const [maxMissingFace, setMaxMissingFace] = useState(1);
   const [dominant, setDominant] = useState([]);

   const toggleDominant = (label) => setDominant(prev => (
      prev.includes(label) ? prev.filter(d => d !== label) : [...prev, label]
   ));

   const filtered = useMemo(
      () => filterRecords(rows, { minConfidence, maxMissingFace, dominant }),
      [rows, minConfidence, maxMissingFace, dominant]
   );
   const appliedQuality = {
      min_confidence: minConfidence,
      max_missing_face_ratio: maxMissingFace,
      dominant,
   };

   if (loading && !rows.length) {
      return <Empty msg="Loading windows…" />;
   }

   return (
      <div className="space-y-2">
         <div className="rounded-lg border border-gray-200 bg-white p-3 grid gap-3 md:grid-cols-3">
            <FormRow label="Min confidence" hint={`${(minConfidence * 100).toFixed(0)}%`}>
               <input
                  type="range"
                  min={0} max={1} step={0.05}
                  value={minConfidence}
                  aria-label="Min confidence"
                  onChange={e => setMinConfidence(Number(e.target.value))}
                  className="w-full"
               />
            </FormRow>
            <FormRow label="Max missing-face" hint={`${(maxMissingFace * 100).toFixed(0)}%`}>
               <input
                  type="range"
                  min={0} max={1} step={0.05}
                  value={maxMissingFace}
                  aria-label="Max missing-face"
                  onChange={e => setMaxMissingFace(Number(e.target.value))}
                  className="w-full"
               />
            </FormRow>
            {/* NOT a <label>: wrapping the pill buttons in a label would make
                the first button the label's implicit control and swallow the
                whole label text into its accessible name. */}
            <div className="block">
               <span className="block text-xs font-semibold text-gray-600 mb-1">
                  Estimated dominant<span className="text-gray-500 font-normal"> · Multi-select</span>
               </span>
               <div className="flex flex-wrap gap-1">
                  {ALL_DOMINANT_LABELS.map(l => (
                     <button
                        key={l}
                        onClick={() => toggleDominant(l)}
                        className={`px-2 py-0.5 rounded-full text-xs border capitalize ${
                           dominant.includes(l)
                              ? 'border-transparent text-white'
                              : 'border-gray-300 text-gray-600 hover:border-gray-400'
                        }`}
                        style={dominant.includes(l) ? { background: emotionColor(l) } : {}}
                     >
                        {l}
                     </button>
                  ))}
               </div>
            </div>
         </div>

         <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-600">
               {filtered.length} of {rows.length} window{rows.length === 1 ? '' : 's'}
            </span>
            <span className="ml-auto inline-flex gap-2">
               <button
                  onClick={() => exportRecordsCsv(filtered, 'oyon-windows')}
                  disabled={!filtered.length}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-gray-300 text-gray-900 hover:bg-gray-100 text-sm disabled:opacity-50"
               >
                  <Download className="w-4 h-4" /> CSV
               </button>
               <button
                  onClick={() => exportRecordsJson(filtered, 'oyon-windows', appliedQuality)}
                  disabled={!filtered.length}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-gray-300 text-gray-900 hover:bg-gray-100 text-sm disabled:opacity-50"
               >
                  <Download className="w-4 h-4" /> JSON
               </button>
            </span>
         </div>

         {!filtered.length ? (
            <Empty msg="No windows match the current quality filters." />
         ) : (
            <div className="max-h-[70vh] overflow-auto rounded-lg border border-gray-200">
               <table className="min-w-[1280px] w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-white shadow-lg text-gray-600 uppercase">
                     <tr>
                        <th className="text-left px-2 py-2">Time</th>
                        <th className="text-left px-2 py-2">User</th>
                        <th className="text-left px-2 py-2">Role</th>
                        <th className="text-left px-2 py-2">Case</th>
                        <th className="text-right px-2 py-2">Session</th>
                        <th className="text-left px-2 py-2">Dominant (estimate)</th>
                        <th className="text-right px-2 py-2">Conf</th>
                        <th className="text-right px-2 py-2">Valence</th>
                        <th className="text-right px-2 py-2">Arousal</th>
                        <th className="text-right px-2 py-2">Entropy</th>
                        <th className="text-right px-2 py-2">Frames</th>
                        <th className="text-right px-2 py-2">Miss %</th>
                        <th className="text-left px-2 py-2">Model</th>
                        <th className="text-left px-2 py-2">Consent</th>
                        <th className="px-2 py-2"></th>
                     </tr>
                  </thead>
                  <tbody>
                     {filtered.map(r => {
                        const isOpen = expandedId === r.id;
                        return (
                           <React.Fragment key={r.id}>
                              <tr className="border-t border-gray-200 hover:bg-gray-50">
                                 <td className="px-2 py-1.5 tabular-nums whitespace-nowrap text-gray-800">{fmtTime(r.window_start)}</td>
                                 <td className="px-2 py-1.5">{r.username || r.student_name_snapshot || (r.user_id != null ? `#${r.user_id}` : 'anonymised')}</td>
                                 <td className="px-2 py-1.5 text-gray-600">{r.user_role || r.student_role_snapshot || '—'}</td>
                                 <td className="px-2 py-1.5">{r.case_title_snapshot || (r.case_id ? `case ${r.case_id}` : '—')}</td>
                                 <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{r.session_id || '—'}</td>
                                 <td className="px-2 py-1.5 capitalize">
                                    <span className="inline-flex items-center gap-1.5">
                                       <span className="h-2 w-2 rounded-full" style={{ background: emotionColor(r.dominant_emotion) }} />
                                       {r.dominant_emotion || '—'}
                                    </span>
                                 </td>
                                 <td className="px-2 py-1.5 text-right tabular-nums">{pct(r.confidence)}</td>
                                 <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: signedColor(r.valence) }}>{signed(r.valence)}</td>
                                 <td className="px-2 py-1.5 text-right tabular-nums">{fix2(r.arousal)}</td>
                                 <td className="px-2 py-1.5 text-right tabular-nums">{fix2(r.entropy)}</td>
                                 <td className="px-2 py-1.5 text-right tabular-nums">{r.valid_frames ?? '—'}</td>
                                 <td className="px-2 py-1.5 text-right tabular-nums">{pct(r.missing_face_ratio)}</td>
                                 <td className="px-2 py-1.5 text-gray-600 text-[11px] whitespace-nowrap">{r.model_name || '—'}{r.model_version ? ` ${r.model_version}` : ''}</td>
                                 <td className="px-2 py-1.5 text-gray-600 text-[11px] whitespace-nowrap" title={r.consent_recorded_at || ''}>{r.consent_version || '—'}</td>
                                 <td className="px-2 py-1.5">
                                    <button
                                       onClick={() => setExpandedId(isOpen ? null : r.id)}
                                       className="px-2 py-0.5 rounded border border-gray-300 text-gray-800 hover:bg-gray-100 text-[11px]"
                                    >
                                       {isOpen ? 'hide' : 'detail'}
                                    </button>
                                 </td>
                              </tr>
                              {isOpen && (
                                 <tr className="bg-white">
                                    <td colSpan={15} className="px-3 py-3">
                                       <WindowDetail record={r} />
                                    </td>
                                 </tr>
                              )}
                           </React.Fragment>
                        );
                     })}
                  </tbody>
               </table>
            </div>
         )}
      </div>
   );
}

function WindowDetail({ record }) {
   const probs = record.probabilities && typeof record.probabilities === 'object' ? record.probabilities : null;
   const quality = record.quality && typeof record.quality === 'object' ? record.quality : null;
   const probEntries = probs ? Object.entries(probs).sort((a, b) => Number(b[1]) - Number(a[1])) : [];
   return (
      <div className="grid gap-4 md:grid-cols-2">
         <div>
            <div className="text-xs uppercase tracking-wide text-gray-600 mb-2">Probability map (estimates)</div>
            {probEntries.length === 0 && <div className="text-sm text-gray-500">no probabilities recorded for this window</div>}
            {probEntries.map(([label, p]) => {
               const pNum = Number(p);
               return (
                  <div key={label} className="flex items-center gap-2 mb-1">
                     <span className="w-20 text-xs capitalize text-gray-800">{label}</span>
                     <div className="flex-1 h-2 rounded bg-gray-100 overflow-hidden">
                        <div style={{ width: `${Math.max(0, Math.min(1, pNum)) * 100}%`, background: emotionColor(label) }} className="h-full" />
                     </div>
                     <span className="w-12 text-right text-[11px] tabular-nums text-gray-800">{(pNum * 100).toFixed(1)}%</span>
                  </div>
               );
            })}
         </div>
         <div>
            <div className="text-xs uppercase tracking-wide text-gray-600 mb-2">Quality + raw record</div>
            <pre className="text-[11px] bg-gray-100 border border-gray-200 rounded p-2 max-h-64 overflow-auto text-gray-800">
{JSON.stringify({
   window: { start: record.window_start, end: record.window_end },
   capture: { mode: record.capture_mode, status: record.capture_status, valid_frames: record.valid_frames, missing_face_ratio: record.missing_face_ratio },
   model: { name: record.model_name, version: record.model_version },
   consent: { version: record.consent_version, recorded_at: record.consent_recorded_at, student_can_view: !!record.student_can_view, admin_can_view: !!record.admin_can_view, educator_can_view: !!record.educator_can_view },
   quality,
}, null, 2)}
            </pre>
         </div>
      </div>
   );
}

function FormRow({ label, hint, children }) {
   return (
      <label className="block">
         <span className="block text-xs font-semibold text-gray-600 mb-1">
            {label}{hint ? <span className="text-gray-500 font-normal"> · {hint}</span> : null}
         </span>
         {children}
      </label>
   );
}

function Empty({ msg }) {
   return (
      <div className="rounded-md border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
         {msg}
      </div>
   );
}
