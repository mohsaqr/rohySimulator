import React, { useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import { trendsAnalytics } from './trendsAnalytics';

/*
 * Longitudinal trends over the filtered server records — the Rohy port of
 * chatoyon-plus's Trends tab: stat chips (days active, windows, sessions,
 * avg affect), a daily-mean "Affect over time" multi-line chart, a
 * weekday × hour "Activity heatmap" (when do learners engage), and a compact
 * per-room valence table. All numbers come from the pure trendsAnalytics()
 * module (tested); this file is layout. SVG charts are hand-rolled inline —
 * no chart dependency, matching the gaze view's idiom.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const VALENCE_COLOR = '#a855f7'; // purple, the oyon accent
const AROUSAL_COLOR = '#f59e0b'; // amber, contrasts on the dark theme

export default function OyonTrendsView({ records, loading }) {
   const { summary, daily, heatmap, byRoom } = useMemo(
      () => trendsAnalytics(records),
      [records],
   );

   if (loading && summary.windows === 0) {
      return (
         <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            Loading trends…
         </div>
      );
   }

   if (summary.windows === 0) {
      return (
         <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-600">
            <TrendingUp className="mx-auto mb-2 h-6 w-6 text-gray-400" />
            No windows in the current selection. Trends appear once emotion
            windows have been captured — run a capture (or widen the filters),
            then refresh.
         </div>
      );
   }

   const daySpan = summary.firstDay && summary.lastDay && summary.firstDay !== summary.lastDay
      ? `${shortDay(summary.firstDay)} – ${shortDay(summary.lastDay)}`
      : summary.firstDay
         ? shortDay(summary.firstDay)
         : undefined;

   return (
      <div className="space-y-5">
         {/* Aggregate stat chips */}
         <div className="flex flex-wrap gap-2">
            <Stat label="Days active" value={String(summary.daysActive)} hint={daySpan} />
            <Stat label="Windows" value={String(summary.windows)} />
            <Stat label="Sessions" value={String(summary.sessions)} />
            <Stat
               label="Avg valence"
               value={signedOrDash(summary.avgValence)}
               hint="Mean valence over all windows with a measured value (−1 negative … +1 positive)."
               accent
            />
            <Stat
               label="Avg arousal"
               value={signedOrDash(summary.avgArousal)}
               hint="Mean arousal over all windows with a measured value (−1 calm … +1 activated)."
            />
         </div>

         {/* Affect over time */}
         <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-800">Affect over time</h3>
            <p className="mb-3 text-xs text-gray-500">
               Daily mean valence &amp; arousal (−1…+1). Gaps mark days where a
               dimension was not measured.
            </p>
            <TrendChart
               series={[
                  { name: 'valence', color: VALENCE_COLOR, values: daily.map((d) => d.avgValence) },
                  { name: 'arousal', color: AROUSAL_COLOR, values: daily.map((d) => d.avgArousal) },
               ]}
               xLabels={daily.map((d) => shortDay(d.day))}
            />
            <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-gray-500">
               <LegendItem label="valence" color={VALENCE_COLOR} />
               <LegendItem label="arousal" color={AROUSAL_COLOR} />
            </div>
         </section>

         {/* Activity heatmap */}
         <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-800">Activity heatmap</h3>
            <p className="mb-3 text-xs text-gray-500">
               When windows are captured — weekday × hour of day, cell intensity ∝ count.
            </p>
            <ActivityHeatmap grid={heatmap.grid} max={heatmap.max} />
         </section>

         {/* Per-room valence */}
         <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-800">Valence by room</h3>
            {byRoom.length === 0 ? (
               <p className="text-sm text-gray-500">No room-stamped windows yet.</p>
            ) : (
               <table className="w-full text-left text-xs">
                  <thead>
                     <tr className="border-b border-gray-200 text-gray-500">
                        <th className="py-1.5 pr-3 font-semibold">Room</th>
                        <th className="py-1.5 pr-3 font-semibold">Windows</th>
                        <th className="py-1.5 pr-3 font-semibold">Avg valence</th>
                     </tr>
                  </thead>
                  <tbody>
                     {byRoom.map((r) => (
                        <tr key={r.room} className="border-b border-gray-200 text-gray-800">
                           <td className="py-1.5 pr-3 font-semibold">{r.room}</td>
                           <td className="py-1.5 pr-3 tabular-nums">{r.windows}</td>
                           <td className="py-1.5 pr-3 tabular-nums">{signedOrDash(r.avgValence)}</td>
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

function LegendItem({ label, color }) {
   return (
      <span className="inline-flex items-center gap-1 capitalize">
         <span className="inline-block h-0.5 w-4 rounded-full" style={{ background: color }} />
         {label}
      </span>
   );
}

// Port of chatoyon's TrendChart, fixed to the affect domain [-1, 1] with a
// dashed zero line. Nulls break the line at unmeasured days; single-day
// pools render a centered dot.
function TrendChart({ series, xLabels }) {
   const W = 600;
   const H = 170;
   const padL = 30;
   const padR = 10;
   const padT = 10;
   const padB = 22;
   const n = Math.max(1, ...series.map((s) => s.values.length));
   const x = (i) => padL + (n <= 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
   const y = (v) => padT + (1 - (v + 1) / 2) * (H - padT - padB); // v in [-1, 1]

   const pathFor = (values) => {
      let d = '';
      let pen = false;
      values.forEach((v, i) => {
         if (v == null || !Number.isFinite(v)) {
            pen = false;
            return;
         }
         d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
         pen = true;
      });
      return d.trim();
   };

   const labelStep = Math.max(1, Math.ceil(n / 6)); // ~6 x labels max

   return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Daily affect trend">
         {[-1, 0, 1].map((t) => (
            <g key={t}>
               <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#d1d5db" strokeWidth={0.5} />
               <text x={padL - 4} y={y(t) + 3} textAnchor="end" fontSize={9} fill="#6b7280" className="tabular-nums">
                  {t.toFixed(1)}
               </text>
            </g>
         ))}
         {/* zero line — the neutral-affect axis */}
         <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="#9ca3af" strokeDasharray="4 4" />
         {series.map((s) => (
            <g key={s.name}>
               <path d={pathFor(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
               {s.values.map((v, i) => (v != null && Number.isFinite(v) ? (
                  <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={s.color}>
                     <title>{`${xLabels[i]} · ${s.name} ${v.toFixed(2)}`}</title>
                  </circle>
               ) : null))}
            </g>
         ))}
         {xLabels.map((lbl, i) => (i % labelStep === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={9} fill="#6b7280">
               {lbl}
            </text>
         ) : null))}
      </svg>
   );
}

// Port of chatoyon's ActivityHeatmap as one SVG: 7 Mon..Sun rows × 24 hour
// columns, cell intensity ∝ count/max, per-cell <title> tooltips.
function ActivityHeatmap({ grid, max }) {
   if (!grid.length || max <= 0) {
      return <p className="text-sm text-gray-500">No timestamped windows in range.</p>;
   }
   const CELL = 20;
   const GAP = 2;
   const LABEL_W = 34;
   const LABEL_H = 14;
   const W = LABEL_W + 24 * (CELL + GAP);
   const H = 7 * (CELL + GAP) + LABEL_H;
   const hourLabels = [0, 6, 12, 18, 23];
   return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Activity heatmap">
         {grid.map((row, wd) => (
            <g key={wd}>
               <text
                  x={LABEL_W - 6}
                  y={wd * (CELL + GAP) + CELL / 2 + 3.5}
                  textAnchor="end"
                  fontSize={10}
                  fill="#6b7280"
               >
                  {WEEKDAYS[wd]}
               </text>
               {row.map((v, hr) => (
                  <rect
                     key={hr}
                     x={LABEL_W + hr * (CELL + GAP)}
                     y={wd * (CELL + GAP)}
                     width={CELL}
                     height={CELL}
                     rx={3}
                     fill={v > 0 ? `rgba(168, 85, 247, ${(0.15 + 0.85 * (v / max)).toFixed(3)})` : '#f3f4f6'}
                  >
                     <title>{`${WEEKDAYS[wd]} ${String(hr).padStart(2, '0')}:00 — ${v} window${v === 1 ? '' : 's'}`}</title>
                  </rect>
               ))}
            </g>
         ))}
         {hourLabels.map((hr) => (
            <text
               key={hr}
               x={LABEL_W + hr * (CELL + GAP) + CELL / 2}
               y={H - 3}
               textAnchor="middle"
               fontSize={9}
               fill="#6b7280"
            >
               {String(hr).padStart(2, '0')}
            </text>
         ))}
      </svg>
   );
}

// "2026-06-01" → "Jun 1" by splitting the string — never via new Date(day),
// which parses as UTC and can shift the label a day (see trendsAnalytics.js).
function shortDay(day) {
   const [, m, d] = String(day).split('-').map(Number);
   const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
   return `${months[m] ?? m} ${d}`;
}

function signedOrDash(v) {
   if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
   return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}
