import React from 'react';
import { emotionColor } from './emotionLogShared';

/*
 * Shared dark-theme chart primitives for the Affect and Compare views —
 * hand-rolled inline SVG/div ports of the <oyon-app> element's
 * EmotionTimeline (charts/EmotionTimeline.tsx: per-window dominant-emotion
 * bar strip) and legacy drawDistribution (legacy/dashboard.js: horizontal
 * count bars), restyled to the white-card visual language the other Oyon
 * views use. No chart dependency, matching the gaze/trends idiom.
 */

// Same cap as the element's EmotionTimeline: only the newest 60 windows fit
// legibly in one strip.
const STRIP_CAP = 60;

/**
 * Horizontal strip plot — one bar per window, color = dominant emotion,
 * height ∝ dominant probability, newest on the right. The strip does not
 * interpolate between windows; capture gaps stay gaps (research-grade
 * honesty, same stance as the element).
 */
export function EmotionStrip({ points, height = 120, ariaLabel = 'Emotion timeline' }) {
   const all = Array.isArray(points) ? points : [];
   if (all.length === 0) {
      return <p className="text-sm text-gray-500">No windows yet.</p>;
   }
   const W = 600;
   const H = height;
   const padX = 6;
   const padTop = 18;
   const padBottom = 4;
   const slice = all.slice(Math.max(0, all.length - STRIP_CAP));
   const n = slice.length;
   const gap = 2;
   const barW = Math.max(2, ((W - padX * 2) - gap * (n - 1)) / n);
   const usableH = H - padTop - padBottom;
   const last = slice[n - 1];
   return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
         <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="#d1d5db" strokeWidth={1} />
         {slice.map((p, i) => {
            const h = Math.max(3, p.prob * usableH);
            return (
               <rect
                  key={i}
                  x={padX + i * (barW + gap)}
                  y={H - padBottom - h}
                  width={barW}
                  height={h}
                  fill={emotionColor(p.emotion)}
                  opacity={0.85}
               >
                  <title>{`window ${all.length - n + i + 1}: ${p.emotion} · ${(p.prob * 100).toFixed(0)}%`}</title>
               </rect>
            );
         })}
         <text x={padX} y={11} fontSize={9} fill="#6b7280">
            {`${n} window${n === 1 ? '' : 's'}${all.length > n ? ` (newest of ${all.length})` : ''}`}
         </text>
         <text x={W - padX} y={11} fontSize={9} fill="#6b7280" textAnchor="end">
            {`latest: ${last.emotion} · ${(last.prob * 100).toFixed(0)}%`}
         </text>
      </svg>
   );
}

/**
 * Horizontal count bars, one row per dominant emotion (rows arrive sorted
 * descending from the analytics), color-keyed like the element's
 * drawDistribution. `total` (optional) feeds the share in the tooltip.
 */
export function DistributionBars({ rows, total }) {
   const list = Array.isArray(rows) ? rows : [];
   if (list.length === 0) {
      return <p className="text-sm text-gray-500">No distribution.</p>;
   }
   const max = Math.max(...list.map((r) => r.count), 1);
   const sum = Number.isFinite(total) && total > 0
      ? total
      : list.reduce((n, r) => n + r.count, 0);
   return (
      <div className="space-y-2">
         {list.map((r) => (
            <div
               key={r.emotion}
               className="flex items-center gap-3"
               title={`${r.emotion}: ${r.count} window${r.count === 1 ? '' : 's'} (${sum ? ((r.count / sum) * 100).toFixed(1) : '0.0'}%)`}
            >
               <span className="w-24 shrink-0 truncate text-xs font-semibold capitalize text-gray-800">{r.emotion}</span>
               <div className="h-3 flex-1 overflow-hidden rounded bg-gray-100">
                  <div
                     className="h-full rounded"
                     style={{ width: `${((r.count / max) * 100).toFixed(1)}%`, background: emotionColor(r.emotion) }}
                  />
               </div>
               <span className="w-14 shrink-0 text-right text-xs tabular-nums text-gray-600">{r.count}</span>
            </div>
         ))}
      </div>
   );
}
