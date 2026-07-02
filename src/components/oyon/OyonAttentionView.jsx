import React, { useMemo } from 'react';
import { Download, Eye } from 'lucide-react';
import { engagementAnalytics } from './engagementAnalytics';
import { emotionColor } from './emotionLogShared';

/*
 * Attention & engagement deep-dive over the filtered server records — the
 * Rohy port of chatoyon-plus's Attention tab: aggregate stat chips
 * (sessions, focus, eye openness, blink rate, off-screen, calibration with
 * a no-face hint), the emotion × attention cross-tab with CSV export, and —
 * when the records span exactly ONE session — the focus timeline + the
 * attention-lapse strip. All numbers come from the pure engagementAnalytics()
 * module (tested); this file is layout + the inline SVG charts.
 */

const FOCUS_COLOR = '#a855f7';
const EYE_COLOR = '#0891b2';

const CROSS_TAB_COLUMNS = [
   ['emotion', 'Emotion'],
   ['windows', 'Windows'],
   ['avgFocus', 'Focus'],
   ['avgBlinkHz', 'Blink (Hz)'],
   ['avgEyeOpenness', 'Eye openness'],
   ['avgOffScreen', 'Off-screen'],
];

export default function OyonAttentionView({ records, loading }) {
   const analytics = useMemo(() => engagementAnalytics(records), [records]);
   const { summary, byEmotion, series } = analytics;
   const singleSession = summary.sessions === 1;

   if (loading && summary.windows === 0) {
      return (
         <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            Loading engagement data…
         </div>
      );
   }

   if (!loading && summary.engagementWindows === 0) {
      return (
         <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-600">
            <Eye className="mx-auto mb-2 h-6 w-6 text-gray-400" />
            No engagement data in the current selection. Engagement arrives with
            windows captured by the v2 pill (mediapipe engine, on by default) —
            run a capture, then refresh.
         </div>
      );
   }

   return (
      <div className="space-y-5">
         {/* Quality + headline attention stat chips */}
         <div className="flex flex-wrap gap-2">
            <Stat label="Sessions" value={String(summary.sessions)} />
            <Stat label="Engagement windows" value={`${summary.engagementWindows} / ${summary.windows}`} />
            <Stat label="Avg focus" value={pctOrDash(summary.avgFocus)} accent />
            <Stat label="Eye openness" value={pctOrDash(summary.avgEyeOpenness)} />
            <Stat
               label="Blink rate"
               value={Number.isFinite(summary.avgBlinkHz) ? `${summary.avgBlinkHz.toFixed(2)} Hz` : '—'}
            />
            <Stat label="Off-screen" value={pctOrDash(summary.avgOffScreen)} hint="Share of tracked gaze pointing away from the screen." />
            <Stat
               label="Calibration"
               value={pctOrDash(summary.avgCalibrationQuality)}
               hint={`No-face: ${pctOrDash(summary.avgMissingFace)} of window time had no detectable face.`}
            />
         </div>

         {/* How attention moved — only meaningful for a single session */}
         <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-800">Engagement over time</h3>
            <p className="mb-3 text-xs text-gray-500">
               Focus + eye openness per window, and the attention-lapse strip (off-screen / no face).
            </p>
            {singleSession ? (
               <div className="space-y-3">
                  <FocusTimeline points={series} />
                  <AttentionLapseStrip points={series} />
               </div>
            ) : (
               <p className="text-sm text-gray-500">Filter to a single session to see the focus timeline.</p>
            )}
         </section>

         {/* The cross-tab: how attention covaries with emotion */}
         <section className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
               <div>
                  <h3 className="text-sm font-bold uppercase tracking-wide text-gray-800">Attention by emotion</h3>
                  <p className="text-xs text-gray-500">
                     Mean attention signals across the windows each emotion labels.
                  </p>
               </div>
               <button
                  onClick={() => downloadCsv(byEmotion)}
                  disabled={byEmotion.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-100 disabled:opacity-50"
               >
                  <Download className="h-4 w-4" /> CSV
               </button>
            </div>
            {byEmotion.length === 0 ? (
               <p className="text-sm text-gray-500">No emotion-labeled windows yet.</p>
            ) : (
               <table className="w-full text-left text-xs">
                  <thead>
                     <tr className="border-b border-gray-200 text-gray-500">
                        {CROSS_TAB_COLUMNS.map(([key, label]) => (
                           <th key={key} className="py-1.5 pr-3 font-semibold whitespace-nowrap">{label}</th>
                        ))}
                     </tr>
                  </thead>
                  <tbody>
                     {byEmotion.map((r) => (
                        <tr key={r.emotion} className="border-b border-gray-200 text-gray-800">
                           <td className="py-1.5 pr-3 font-semibold capitalize">
                              <span className="inline-flex items-center gap-1.5">
                                 <span
                                    className="inline-block h-2.5 w-2.5 rounded-sm"
                                    style={{ background: emotionColor(r.emotion) }}
                                 />
                                 {r.emotion}
                              </span>
                           </td>
                           <td className="py-1.5 pr-3 tabular-nums">{r.windows}</td>
                           <td className="py-1.5 pr-3 tabular-nums">{pctOrDash(r.avgFocus)}</td>
                           <td className="py-1.5 pr-3 tabular-nums">{fixOrDash(r.avgBlinkHz)}</td>
                           <td className="py-1.5 pr-3 tabular-nums">{pctOrDash(r.avgEyeOpenness)}</td>
                           <td className="py-1.5 pr-3 tabular-nums">{pctOrDash(r.avgOffScreen)}</td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            )}
         </section>
      </div>
   );
}

function Stat({ label, value, hint, accent }) {
   return (
      <div
         title={hint}
         className={`rounded-lg border px-3 py-2 ${accent ? 'border-purple-600/50 bg-purple-950/40' : 'border-gray-200 bg-white'}`}
      >
         <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
         <div className={`text-base font-bold tabular-nums ${accent ? 'text-purple-200' : 'text-gray-900'}`}>{value}</div>
      </div>
   );
}

// ── Inline SVG charts — ports of chatoyon's FocusTimeline / ────────────────
// AttentionLapseStrip (charts.tsx), restyled for the dark neutral palette.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Focus + eye-openness over one session's windows (both natural 0..1, so
// they share a y-axis). Dense — no per-point labels; nulls break the line at
// sensing gaps. Blink rate is a different scale (Hz) and stays in the chips
// and cross-tab to keep this axis honest.
function FocusTimeline({ points }) {
   const usable = points.filter((p) => isNum(p.focus) || isNum(p.eyeOpenness));
   if (usable.length < 2) {
      return <p className="text-sm text-gray-500">Not enough engagement data for a timeline.</p>;
   }
   const series = [
      { name: 'Focus', color: FOCUS_COLOR, values: points.map((p) => p.focus) },
      { name: 'Eye openness', color: EYE_COLOR, values: points.map((p) => p.eyeOpenness) },
   ];
   return (
      <div className="space-y-1">
         <LineChart series={series} />
         <div className="flex flex-wrap gap-3 px-1 text-[11px] text-gray-500">
            {series.map((s) => (
               <span key={s.name} className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-3 rounded-sm" style={{ background: s.color }} /> {s.name}
               </span>
            ))}
         </div>
      </div>
   );
}

// Multi-series 0..1 line chart with y gridlines; a null breaks the pen so
// sensing gaps show as gaps, never interpolated lines.
function LineChart({ series, height = 150 }) {
   const W = 600;
   const H = height;
   const padL = 30;
   const padR = 10;
   const padT = 10;
   const padB = 14;
   const n = Math.max(1, ...series.map((s) => s.values.length));
   const x = (i) => padL + (n <= 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
   const y = (v) => padT + (1 - v) * (H - padT - padB);

   const pathFor = (values) => {
      let d = '';
      let pen = false;
      values.forEach((v, i) => {
         if (!isNum(v)) {
            pen = false;
            return;
         }
         d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
         pen = true;
      });
      return d.trim();
   };

   return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Focus timeline">
         {[0, 0.5, 1].map((t) => (
            <g key={t}>
               <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#d1d5db" strokeWidth={0.5} />
               <text x={padL - 4} y={y(t) + 3} textAnchor="end" fontSize={9} fill="#6b7280" className="tabular-nums">
                  {t.toFixed(1)}
               </text>
            </g>
         ))}
         {series.map((s) => (
            <g key={s.name}>
               <path d={pathFor(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
               {s.values.map((v, i) => (isNum(v) ? <circle key={i} cx={x(i)} cy={y(v)} r={2} fill={s.color} /> : null))}
            </g>
         ))}
      </svg>
   );
}

// A ribbon over the window index where gaze went off-screen or a face was
// missing. Cell intensity ∝ ratio, so dark red bands mark attention lapses
// (look-aways, leaving frame).
function AttentionLapseStrip({ points }) {
   const hasData = points.some((p) => isNum(p.offScreen) || isNum(p.missingFace));
   if (!hasData) return <p className="text-sm text-gray-500">No attention-lapse data.</p>;
   const rows = [
      { label: 'Off-screen', key: 'offScreen' },
      { label: 'No face', key: 'missingFace' },
   ];
   return (
      <div className="space-y-1">
         {rows.map((row) => (
            <div key={row.key} className="flex items-center gap-2">
               <span className="w-16 shrink-0 text-[10px] text-gray-500">{row.label}</span>
               <div className="flex h-3.5 flex-1 gap-px overflow-hidden rounded-sm">
                  {points.map((p, i) => {
                     const v = p[row.key];
                     const r = isNum(v) ? Math.min(1, Math.max(0, v)) : 0;
                     return (
                        <div
                           key={i}
                           className="h-full flex-1"
                           style={{ background: r > 0 ? `rgba(248, 113, 113, ${(0.15 + 0.85 * r).toFixed(2)})` : '#f3f4f6' }}
                           title={`window ${i + 1}: ${(r * 100).toFixed(0)}% ${row.label.toLowerCase()}`}
                        />
                     );
                  })}
               </div>
            </div>
         ))}
      </div>
   );
}

function pctOrDash(v) {
   return typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : '—';
}

function fixOrDash(v) {
   return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '—';
}

function downloadCsv(rows) {
   const header = CROSS_TAB_COLUMNS.map(([key]) => key);
   const escape = (v) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
   };
   const lines = [
      header.join(','),
      ...rows.map((row) => header.map((key) => escape(row[key])).join(',')),
   ];
   const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
   const url = URL.createObjectURL(blob);
   const a = document.createElement('a');
   a.href = url;
   a.download = 'oyon-attention-by-emotion.csv';
   a.click();
   URL.revokeObjectURL(url);
}
