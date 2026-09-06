import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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

const FOCUS_COLOR = '#0f766e';
const EYE_COLOR = '#0891b2';

// Explicit key map: the CSV field order is the table's column order, and the
// header of each column is a literal catalogue key (never t(variable-derived
// prose)). The CSV keeps the raw field names — a downloaded file must not
// change shape with the reader's UI language.
const CROSS_TAB_COLUMNS = [
   ['emotion', 'col_emotion'],
   ['windows', 'col_windows'],
   ['avgFocus', 'col_focus'],
   ['avgBlinkHz', 'col_blink_hz'],
   ['avgEyeOpenness', 'col_eye_openness'],
   ['avgOffScreen', 'col_off_screen'],
];

export default function OyonAttentionView({ records, loading }) {
   const { t } = useTranslation('oyon');
   const analytics = useMemo(() => engagementAnalytics(records), [records]);
   const { summary, byEmotion, series } = analytics;
   const singleSession = summary.sessions === 1;

   if (loading && summary.windows === 0) {
      return (
         <div className="rohy-admin-light rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            {t('engagement_loading')}
         </div>
      );
   }

   if (!loading && summary.engagementWindows === 0) {
      return (
         <div className="rohy-admin-light rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-600">
            <Eye className="mx-auto mb-2 h-6 w-6 text-gray-400" />
            {t('engagement_empty')}
         </div>
      );
   }

   return (
      <div className="rohy-admin-light space-y-5">
         {/* Quality + headline attention stat chips */}
         <div className="flex flex-wrap gap-2">
            <Stat label={t('stat_sessions')} value={String(summary.sessions)} />
            <Stat label={t('stat_engagement_windows')} value={`${summary.engagementWindows} / ${summary.windows}`} />
            <Stat label={t('stat_avg_focus')} value={pctOrDash(summary.avgFocus)} accent />
            <Stat label={t('stat_eye_openness')} value={pctOrDash(summary.avgEyeOpenness)} />
            <Stat
               label={t('stat_blink_rate')}
               value={Number.isFinite(summary.avgBlinkHz) ? `${summary.avgBlinkHz.toFixed(2)} Hz` : '—'}
            />
            <Stat label={t('stat_off_screen')} value={pctOrDash(summary.avgOffScreen)} hint={t('hint_off_screen')} />
            <Stat
               label={t('stat_calibration')}
               value={pctOrDash(summary.avgCalibrationQuality)}
               hint={t('hint_calibration', { value: pctOrDash(summary.avgMissingFace) })}
            />
         </div>

         {/* How attention moved — only meaningful for a single session */}
         <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-800">{t('section_engagement_over_time')}</h3>
            <p className="mb-3 text-xs text-gray-500">{t('engagement_over_time_hint')}</p>
            {singleSession ? (
               <div className="space-y-3">
                  <FocusTimeline points={series} t={t} />
                  <AttentionLapseStrip points={series} t={t} />
               </div>
            ) : (
               <p className="text-sm text-gray-500">{t('attention_single_session_only')}</p>
            )}
         </section>

         {/* The cross-tab: how attention covaries with emotion */}
         <section className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
               <div>
                  <h3 className="text-sm font-bold uppercase tracking-wide text-gray-800">{t('section_attention_by_emotion')}</h3>
                  <p className="text-xs text-gray-500">{t('attention_by_emotion_hint')}</p>
               </div>
               <button
                  onClick={() => downloadCsv(byEmotion)}
                  disabled={byEmotion.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-100 disabled:opacity-50"
               >
                  <Download className="h-4 w-4" /> {t('export_csv')}
               </button>
            </div>
            {byEmotion.length === 0 ? (
               <p className="text-sm text-gray-500">{t('attention_no_emotion_windows')}</p>
            ) : (
               <table className="w-full text-left text-xs">
                  <thead>
                     <tr className="border-b border-gray-200 text-gray-500">
                        {CROSS_TAB_COLUMNS.map(([key, labelKey]) => (
                           <th key={key} className="py-1.5 pr-3 font-semibold whitespace-nowrap">{t(labelKey)}</th>
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
         className={`rounded-lg border px-3 py-2 ${accent ? 'border-teal-600/50 bg-teal-50' : 'border-gray-200 bg-white'}`}
      >
         <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
         <div className={`text-base font-bold tabular-nums ${accent ? 'text-teal-700' : 'text-gray-900'}`}>{value}</div>
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
function FocusTimeline({ points, t }) {
   const usable = points.filter((p) => isNum(p.focus) || isNum(p.eyeOpenness));
   if (usable.length < 2) {
      return <p className="text-sm text-gray-500">{t('attention_not_enough_timeline')}</p>;
   }
   const series = [
      { name: t('legend_focus'), color: FOCUS_COLOR, values: points.map((p) => p.focus) },
      { name: t('legend_eye_openness'), color: EYE_COLOR, values: points.map((p) => p.eyeOpenness) },
   ];
   return (
      <div className="space-y-1">
         <LineChart series={series} ariaLabel={t('aria_focus_timeline')} />
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
function LineChart({ series, ariaLabel, height = 150 }) {
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
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
         {[0, 0.5, 1].map((tick) => (
            <g key={tick}>
               <line x1={padL} x2={W - padR} y1={y(tick)} y2={y(tick)} stroke="#d1d5db" strokeWidth={0.5} />
               <text x={padL - 4} y={y(tick) + 3} textAnchor="end" fontSize={9} fill="#6b7280" className="tabular-nums">
                  {tick.toFixed(1)}
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
function AttentionLapseStrip({ points, t }) {
   const hasData = points.some((p) => isNum(p.offScreen) || isNum(p.missingFace));
   if (!hasData) return <p className="text-sm text-gray-500">{t('lapse_none')}</p>;
   const rows = [
      { label: t('lapse_off_screen'), kind: 'off_screen', key: 'offScreen' },
      { label: t('lapse_no_face'), kind: 'no_face', key: 'missingFace' },
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
                           title={t('lapse_tooltip', {
                              index: i + 1,
                              percent: (r * 100).toFixed(0),
                              kind: row.kind,
                           })}
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
