import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Smile } from 'lucide-react';
import EdgeBundling from '../analytics/charts/EdgeBundling';
import { affectAnalytics } from './affectAnalytics';
import { buildCoEmotionNetwork } from './coEmotionNetwork';
import { EmotionStrip, DistributionBars } from './EmotionStripCharts';
import { emotionColor, pct } from './emotionLogShared';

/*
 * Affect deep-dive over the filtered server records — the Rohy port of the
 * <oyon-app> element's Analyze · Affect tab
 * (OyonR/standalone/app/src/routes/analyze/affect.tsx): KPI chips (windows,
 * latest state, latest quality, analyzed-with-dynamics, affect speed,
 * instability), the capture-timeline strip (dominant emotion per window),
 * the valence × arousal affect plane with a fading trail, the
 * dominant-emotion distribution, and the dynamics timeline (affect speed +
 * instability). All numbers come from the pure affectAnalytics() module
 * (tested); this file is layout + the inline SVG charts, matching the
 * trends/gaze visual idiom.
 */

// Element dynamics colors (legacy drawDynamics) — both read fine on dark.
const SPEED_COLOR = '#db2777';
const INSTABILITY_COLOR = '#d97706';

// The element's AffectPad draws every stored window; SVG (unlike its canvas)
// pays per-node, so the trail keeps the newest windows only.
const PLANE_CAP = 200;

export default function OyonAffectView({ records, loading }) {
   const { t } = useTranslation('oyon');
   const { summary, timeline, plane, distribution, dynamics } = useMemo(
      () => affectAnalytics(records),
      [records],
   );
   const coEmotion = useMemo(() => buildCoEmotionNetwork(records), [records]);

   if (loading && summary.windows === 0) {
      return (
         <div className="rohy-admin-light rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            {t('affect_loading')}
         </div>
      );
   }

   if (summary.windows === 0) {
      return (
         <div className="rohy-admin-light rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-600">
            <Smile className="mx-auto mb-2 h-6 w-6 text-gray-400" />
            {t('affect_empty')}
         </div>
      );
   }

   return (
      <div className="rohy-admin-light space-y-5">
         {/* KPI chips — the element's summary row */}
         <div className="flex flex-wrap gap-2">
            <Stat label={t('stat_windows')} value={String(summary.windows)} />
            <Stat label={t('stat_latest_state')} value={summary.latestState ?? '—'} accent capitalizeValue />
            <Stat
               label={t('stat_latest_quality')}
               value={pct(summary.latestQuality)}
               hint={t('hint_latest_quality')}
            />
            <Stat label={t('stat_analyzed')} value={String(summary.analyzedWindows)} hint={t('hint_analyzed')} />
            <Stat
               label={t('stat_affect_speed')}
               value={fmtNum(summary.affectSpeed)}
               hint={t('hint_affect_speed')}
            />
            <Stat
               label={t('stat_instability')}
               value={fmtNum(summary.instability)}
               hint={t('hint_instability')}
            />
         </div>

         {/* Capture timeline */}
         <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-800">{t('section_capture_timeline')}</h3>
            <p className="mb-3 text-xs text-gray-500">{t('capture_timeline_hint')}</p>
            <EmotionStrip points={timeline} height={150} ariaLabel={t('section_capture_timeline')} />
         </section>

         {/* Affect plane */}
         <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-800">{t('section_affect_plane')}</h3>
            <p className="mb-3 text-xs text-gray-500">
               {plane.length > PLANE_CAP
                  ? t('affect_plane_hint_capped', { cap: PLANE_CAP, total: plane.length })
                  : t('affect_plane_hint')}
            </p>
            <AffectPlane points={plane} t={t} />
         </section>

         {/* Emotion distribution */}
         <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-800">{t('section_emotion_distribution')}</h3>
            <p className="mb-3 text-xs text-gray-500">{t('emotion_distribution_hint')}</p>
            <DistributionBars rows={distribution} total={summary.windows} />
         </section>

         {/* Co-occurring emotions — a cooccur-style network (site = person):
             two emotions are linked when the same people showed both, edge
             weight = number of people sharing the pair (pure
             coEmotionNetwork module). */}
         <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-800">{t('section_co_emotions')}</h3>
            <div className="mb-3 grid gap-2 sm:grid-cols-3">
               <MiniMetric label={t('metric_model_channels')} value={coEmotion.stats.modelChannelCount || '—'} />
               <MiniMetric label={t('metric_dominant_labels')} value={coEmotion.stats.observedDominantCount || '—'} />
               <MiniMetric label={t('metric_linked_pairs')} value={coEmotion.stats.edgeCount || 0} />
            </div>
            {coEmotion.stats.reason ? (
               <p className="text-sm text-gray-500">
                  {coEmotion.stats.reason === 'no-emotions'
                     ? t('co_emotions_none')
                     : t('co_emotions_single')}
               </p>
            ) : (
               <EdgeBundling
                  nodes={coEmotion.nodes}
                  edges={coEmotion.edges}
                  height={520}
                  colorFor={emotionColor}
               />
            )}
         </section>

         {/* Dynamics timeline */}
         <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-800">{t('section_dynamics_timeline')}</h3>
            <p className="mb-3 text-xs text-gray-500">{t('dynamics_timeline_hint')}</p>
            <DynamicsChart dynamics={dynamics} t={t} />
            <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-gray-500">
               <LegendItem label={t('stat_affect_speed')} color={SPEED_COLOR} />
               <LegendItem label={t('stat_instability')} color={INSTABILITY_COLOR} />
            </div>
         </section>
      </div>
   );
}

function MiniMetric({ label, value }) {
   return (
      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
         <div className="text-[11px] font-medium text-gray-500">{label}</div>
         <div className="text-lg font-semibold tabular-nums text-gray-900">{value}</div>
      </div>
   );
}

function Stat({ label, value, hint, accent, capitalizeValue }) {
   return (
      <div
         title={hint}
         className={`rounded-lg border px-3 py-2 ${accent ? 'border-teal-300 bg-teal-50' : 'border-gray-200 bg-white'}`}
      >
         <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
         <div className={`text-base font-bold tabular-nums ${capitalizeValue ? 'capitalize' : ''} ${accent ? 'text-teal-700' : 'text-gray-900'}`}>{value}</div>
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

// The element's formatNumber: adaptive precision, '—' for non-finite.
function fmtNum(v) {
   if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
   const abs = Math.abs(v);
   if (abs >= 100) return v.toFixed(0);
   if (abs >= 10) return v.toFixed(1);
   return v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clampAffect = (v) => Math.max(-1, Math.min(1, v));

// SVG port of the element's AffectPad canvas: cross grid, axis labels,
// fading trail, latest halo dot. Per-point <title> tooltips add the emotion
// and circumplex quadrant.
function AffectPlane({ points, t }) {
   const all = Array.isArray(points) ? points : [];
   const trail = all.slice(Math.max(0, all.length - PLANE_CAP));
   if (trail.length === 0) {
      return (
         <p className="text-sm text-gray-500">{t('plane_no_samples_va')}</p>
      );
   }
   const S = 320;
   const toX = (v) => ((clampAffect(v) + 1) / 2) * S;
   const toY = (a) => ((1 - clampAffect(a)) / 2) * S;
   const path = trail
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.v).toFixed(1)} ${toY(p.a).toFixed(1)}`)
      .join(' ');
   const last = trail[trail.length - 1];
   return (
      <svg
         viewBox={`0 0 ${S} ${S}`}
         width={S}
         height={S}
         className="mx-auto block h-auto max-w-full rounded border border-gray-200 bg-gray-100"
         role="img"
         aria-label={t('aria_valence_arousal_plane')}
      >
         {/* Cross grid */}
         <line x1={S / 2} x2={S / 2} y1={0} y2={S} stroke="#d1d5db" strokeWidth={1} />
         <line x1={0} x2={S} y1={S / 2} y2={S / 2} stroke="#d1d5db" strokeWidth={1} />
         {/* Axis labels */}
         <text x={S / 2} y={12} textAnchor="middle" fontSize={10} fill="#6b7280">{t('plane_high_arousal')}</text>
         <text x={S / 2} y={S - 5} textAnchor="middle" fontSize={10} fill="#6b7280">{t('plane_low_arousal')}</text>
         <text x={5} y={S / 2 - 5} textAnchor="start" fontSize={10} fill="#6b7280">{t('plane_negative')}</text>
         <text x={S - 5} y={S / 2 - 5} textAnchor="end" fontSize={10} fill="#6b7280">{t('plane_positive')}</text>
         {/* Trail line */}
         <path d={path} fill="none" stroke="#0f766e" strokeWidth={1.5} opacity={0.35} strokeLinejoin="round" />
         {/* Trail dots — older = smaller + dimmer */}
         {trail.map((p, i) => {
            const fade = (i + 1) / trail.length;
            return (
               <circle
                  key={i}
                  cx={toX(p.v)}
                  cy={toY(p.a)}
                  r={2 + fade * 4}
                  fill="#0f766e"
                  opacity={0.15 + fade * 0.85}
               >
                  <title>
                     {t('plane_point_tooltip', {
                        emotion: p.emotion,
                        valence: isNum(p.v) ? p.v.toFixed(2) : '—',
                        arousal: isNum(p.a) ? p.a.toFixed(2) : '—',
                        quadrant: p.quadrant ?? '—',
                     })}
                  </title>
               </circle>
            );
         })}
         {/* Latest dot with halo */}
         <circle cx={toX(last.v)} cy={toY(last.a)} r={10} fill="rgba(168,85,247,0.35)" />
         <circle cx={toX(last.v)} cy={toY(last.a)} r={5} fill="#0f766e" />
      </svg>
   );
}

// Two-series 0..1 line chart (SVG) — port of legacy drawDynamics: affect
// speed + instability per window, both clamped into the unit interval; a
// null breaks the pen so underivable windows show as gaps.
function DynamicsChart({ dynamics, t }) {
   const rows = Array.isArray(dynamics) ? dynamics : [];
   const hasData = rows.some((d) => isNum(d.speed) || isNum(d.instability));
   if (!hasData) {
      return <p className="text-sm text-gray-500">{t('dynamics_none')}</p>;
   }
   const W = 600;
   const H = 170;
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

   const series = [
      { key: 'speed', color: SPEED_COLOR },
      { key: 'instability', color: INSTABILITY_COLOR },
   ];

   return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={t('section_dynamics_timeline')}>
         {[0, 0.5, 1].map((tick) => (
            <g key={tick}>
               <line x1={padL} x2={W - padR} y1={y(tick)} y2={y(tick)} stroke="#d1d5db" strokeWidth={0.5} />
               <text x={padL - 4} y={y(tick) + 3} textAnchor="end" fontSize={9} fill="#6b7280" className="tabular-nums">
                  {tick.toFixed(1)}
               </text>
            </g>
         ))}
         {series.map((s) => (
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
