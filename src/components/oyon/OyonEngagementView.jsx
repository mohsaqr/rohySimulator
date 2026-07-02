import React, { useMemo } from 'react';
import { Gauge } from 'lucide-react';
import { engagementAnalytics, meanGazeEntropy, focusTone } from './engagementAnalytics';
import { fix2 } from './emotionLogShared';

/*
 * Engagement over the filtered server records — the Rohy port of the
 * <oyon-app> element's Analyze · Engagement tab
 * (OyonR/standalone/app/src/routes/analyze/engagement.tsx): the summary
 * chips (windows, mean focus with the element's good/borderline/poor tones,
 * mean blink rate, mean eye openness, mean gaze entropy) and the
 * focus + eye-openness timeline over the whole filtered pool.
 *
 * Deliberately NOT here (OyonAttentionView already owns them, and they are
 * not part of the element's Engagement tab either): the attention-lapse
 * strip (off-screen / no-face), the emotion × attention cross-tab, and the
 * off-screen / calibration chips. The one overlap kept by design: when the
 * pool is a single session this timeline matches Attention's focus
 * timeline — that duplication is the element's own layout, and unlike
 * Attention the chart here also renders for multi-session pools (with a
 * concatenation caveat instead of hiding).
 */

const FOCUS_COLOR = '#a855f7';
const EYE_COLOR = '#0891b2';

const TONE_STYLES = {
   ok:   { box: 'border-emerald-600/50 bg-emerald-950/40', text: 'text-emerald-200' },
   warn: { box: 'border-amber-600/50 bg-amber-950/40',     text: 'text-amber-200' },
   bad:  { box: 'border-red-600/50 bg-red-950/40',         text: 'text-red-200' },
};

export default function OyonEngagementView({ records, loading }) {
   const { summary, series } = useMemo(() => engagementAnalytics(records), [records]);
   const avgEntropy = useMemo(() => meanGazeEntropy(records), [records]);
   const tone = focusTone(summary.avgFocus);

   if (loading && summary.windows === 0) {
      return (
         <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            Loading engagement data…
         </div>
      );
   }

   if (summary.engagementWindows === 0) {
      return (
         <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-600">
            <Gauge className="mx-auto mb-2 h-6 w-6 text-gray-400" />
            No engagement data in the current selection. Engagement arrives with
            windows captured by the v2 pill (mediapipe engine, on by default) —
            run a capture, then refresh.
         </div>
      );
   }

   const withEngagement = series.filter((p) => p.focus != null || p.eyeOpenness != null).length;

   return (
      <div className="space-y-5">
         {/* Summary chips — the element's Metric row */}
         <div className="flex flex-wrap gap-2">
            <Stat label="Windows" value={String(summary.windows)} />
            <Stat label="Engagement windows" value={`${summary.engagementWindows} / ${summary.windows}`} />
            <Stat
               label="Mean focus"
               value={fix2(summary.avgFocus)}
               tone={tone}
               hint={tone === null
                  ? 'No focus data in these windows.'
                  : `0–1 focus score; ${tone === 'ok' ? 'good (> 0.6)' : tone === 'warn' ? 'borderline (0.4–0.6)' : 'poor (≤ 0.4)'}.`}
            />
            <Stat
               label="Mean blink"
               value={Number.isFinite(summary.avgBlinkHz) ? `${summary.avgBlinkHz.toFixed(2)} Hz` : '—'}
            />
            <Stat label="Mean openness" value={fix2(summary.avgEyeOpenness)} hint="Mean eye-openness (0–1) over the windows that carry it." />
            <Stat label="Mean entropy" value={fix2(avgEntropy)} hint="Mean gaze entropy — higher means gaze scattered over more of the screen." />
         </div>

         {/* Focus & openness over time — the element's EngagementTimeline */}
         <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-800">Focus &amp; openness over time</h3>
            <p className="mb-3 text-xs text-gray-500">
               Per-window focus score and eye openness (0–1). Gaps mean no engagement
               block for that window.
               {summary.sessions > 1 && (
                  <> Windows from {summary.sessions} sessions are concatenated
                  chronologically — filter to a single session for a true timeline
                  (the Attention tab adds the lapse strip there).</>
               )}
            </p>
            <EngagementTimeline series={series} />
            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
               <LegendItem label="Focus" color={FOCUS_COLOR} />
               <LegendItem label="Eye openness" color={EYE_COLOR} />
               <span className="ml-auto tabular-nums">{withEngagement}/{summary.windows} windows with engagement</span>
            </div>
         </section>
      </div>
   );
}

function Stat({ label, value, hint, tone }) {
   const style = tone ? TONE_STYLES[tone] : null;
   return (
      <div
         title={hint}
         className={`rounded-lg border px-3 py-2 ${style ? style.box : 'border-gray-200 bg-white'}`}
      >
         <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
         <div className={`text-base font-bold tabular-nums ${style ? style.text : 'text-gray-900'}`}>{value}</div>
      </div>
   );
}

function LegendItem({ label, color }) {
   return (
      <span className="inline-flex items-center gap-1">
         <span className="inline-block h-0.5 w-4 rounded-full" style={{ background: color }} />
         {label}
      </span>
   );
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Two-series 0..1 line chart (SVG) — port of the element's
// EngagementTimeline canvas: focus + eye openness share one axis; a null
// breaks the pen so sensing gaps show as gaps, never interpolated lines.
function EngagementTimeline({ series }) {
   const rows = Array.isArray(series) ? series : [];
   const usable = rows.filter((p) => isNum(p.focus) || isNum(p.eyeOpenness));
   if (usable.length === 0) {
      return <p className="text-sm text-gray-500">No engagement data in these windows.</p>;
   }
   const W = 600;
   const H = 190;
   const padL = 30;
   const padR = 10;
   const padT = 10;
   const padB = 14;
   const n = Math.max(1, rows.length);
   const x = (i) => padL + (n <= 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
   const y = (v) => padT + (1 - Math.max(0, Math.min(1, v))) * (H - padT - padB);

   const pathFor = (key) => {
      let d = '';
      let pen = false;
      rows.forEach((row, i) => {
         const v = row[key];
         if (!isNum(v)) {
            pen = false;
            return;
         }
         d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
         pen = true;
      });
      return d.trim();
   };

   const lines = [
      { key: 'focus', color: FOCUS_COLOR },
      { key: 'eyeOpenness', color: EYE_COLOR },
   ];

   return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Engagement timeline">
         {[0, 0.5, 1].map((t) => (
            <g key={t}>
               <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#d1d5db" strokeWidth={0.5} />
               <text x={padL - 4} y={y(t) + 3} textAnchor="end" fontSize={9} fill="#6b7280" className="tabular-nums">
                  {t.toFixed(1)}
               </text>
            </g>
         ))}
         {lines.map((s) => (
            <g key={s.key}>
               <path d={pathFor(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
               {rows.map((row, i) => (isNum(row[s.key])
                  ? <circle key={i} cx={x(i)} cy={y(row[s.key])} r={2} fill={s.color} />
                  : null))}
            </g>
         ))}
      </svg>
   );
}
