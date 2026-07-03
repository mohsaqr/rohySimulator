import React, { useMemo } from 'react';
import { Activity, GitBranch, Smile, Sparkles } from 'lucide-react';
import EdgeBundling from '../analytics/charts/EdgeBundling';
import { affectAnalytics } from './affectAnalytics';
import { buildCoEmotionNetwork, EMOTION_FAMILIES } from './coEmotionNetwork';
import { emotionColor, pct } from './emotionLogShared';
import { OYON_EMOTION_LABELS, observedDominantLabels, probabilityChannelLabels } from './emotionVocabulary';

const PLANE_CAP = 200;

export default function OyonAffectV2({ records, loading }) {
   const analytics = useMemo(() => affectAnalytics(records), [records]);
   const coEmotion = useMemo(() => buildCoEmotionNetwork(records), [records]);
   const modelChannels = useMemo(() => probabilityChannelLabels(records), [records]);
   const observedLabels = useMemo(() => observedDominantLabels(records), [records]);

   const { summary, plane, distribution, dynamics, timeline } = analytics;
   const fullDistribution = useMemo(() => {
      const counts = new Map(distribution.map((r) => [r.emotion, r.count]));
      return OYON_EMOTION_LABELS.map((emotion) => ({ emotion, count: counts.get(emotion) ?? 0 }));
   }, [distribution]);
   const fullCoEmotion = useMemo(() => fullEmotionNetwork(coEmotion.edges), [coEmotion.edges]);

   if (loading && summary.windows === 0) return <EmptyState text="Loading affect data..." />;

   if (summary.windows === 0) {
      return (
         <EmptyState
            icon={<Smile className="h-6 w-6" />}
            text="No affect windows in the current selection."
            detail="Affect appears once Oyon emotion windows have been captured."
         />
      );
   }

   return (
      <div className="rohy-admin-light space-y-3">
         <section className="rounded-md border border-gray-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-3 border-b border-gray-100 pb-2">
               <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-gray-700">Affect 2</h2>
               </div>
               <div className="flex flex-wrap justify-end gap-2">
                  <HeaderChip icon={<Activity className="h-4 w-4" />} label="Windows" value={summary.windows} />
                  <HeaderChip icon={<Sparkles className="h-4 w-4" />} label="Dominant" value={`${observedLabels.length}/8`} />
                  <HeaderChip icon={<GitBranch className="h-4 w-4" />} label="Links" value={coEmotion.stats.edgeCount || 0} />
               </div>
            </div>
            <div className="grid grid-cols-1 gap-2 text-xs text-gray-500 sm:grid-cols-3">
               <InlineFact label="Model channels" value={modelChannels.length || OYON_EMOTION_LABELS.length} />
               <InlineFact label="Latest state" value={summary.latestState ?? '—'} capitalize />
               <InlineFact label="Latest quality" value={pct(summary.latestQuality)} />
            </div>
         </section>

         <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
            <Panel title="8-Emotion Co-occurrence Map">
               <EdgeBundling
                  nodes={fullCoEmotion.nodes}
                  edges={fullCoEmotion.edges}
                  height={340}
                  labelPad={46}
                  nodeRadius={6}
                  colorFor={emotionColor}
               />
            </Panel>
            <Panel title="Emotion Heat Strip">
               <EmotionHeatStrip timeline={timeline} rows={fullDistribution} total={summary.windows} />
            </Panel>
         </div>

         <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-2">
            <Panel title="Affect Plane">
               <AffectPlane points={plane} />
            </Panel>
            <Panel title="Dynamics & Arousal-Valence Mix">
               <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.25fr_1fr]">
                  <DynamicsChart dynamics={dynamics} />
                  <QuadrantMix points={plane} />
               </div>
            </Panel>
         </div>

      </div>
   );
}

function HeaderChip({ icon, label, value }) {
   return (
      <div className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-gray-700">
         {icon}
         <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">{label}</div>
            <div className="text-sm font-semibold tabular-nums text-gray-950">{value}</div>
         </div>
      </div>
   );
}

function Panel({ title, children }) {
   return (
      <section className="flex h-full min-w-0 flex-col rounded-md border border-gray-200 bg-white shadow-sm">
         <div className="flex min-h-10 items-center justify-between gap-3 border-b border-gray-100 px-3 py-2">
            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
         </div>
         <div className="min-w-0 flex-1 p-3">{children}</div>
      </section>
   );
}

function InlineFact({ label, value, capitalize = false }) {
   return (
      <div className="flex items-center justify-between rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
         <span className="font-medium text-gray-500">{label}</span>
         <span className={`font-semibold tabular-nums text-gray-900 ${capitalize ? 'capitalize' : ''}`}>{value}</span>
      </div>
   );
}

function EmotionHeatStrip({ timeline, rows, total }) {
   const buckets = useMemo(() => bucketEmotionTimeline(timeline, 32), [timeline]);
   const max = Math.max(...rows.map((r) => r.count), 1);
   const sum = Number(total) > 0 ? Number(total) : rows.reduce((n, r) => n + r.count, 0);
   return (
      <div className="space-y-3">
         <div className="overflow-x-auto">
            <div className="min-w-[360px] space-y-1.5">
               {OYON_EMOTION_LABELS.map((emotion) => (
                  <div key={emotion} className="grid grid-cols-[72px_1fr] items-center gap-2">
                     <div className="truncate text-xs font-semibold capitalize text-gray-700">{emotion}</div>
                     <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${buckets.length || 1}, minmax(6px, 1fr))` }}>
                        {(buckets.length ? buckets : [{ counts: new Map(), maxProb: new Map() }]).map((bucket, i) => {
                           const count = bucket.counts.get(emotion) ?? 0;
                           const prob = bucket.maxProb.get(emotion) ?? 0;
                           const size = count > 0 ? 6 + Math.min(10, count * 2 + prob * 6) : 5;
                           return (
                              <span
                                 key={i}
                                 className="mx-auto block rounded-full"
                                 style={{
                                    width: size,
                                    height: size,
                                    background: count > 0 ? emotionColor(emotion) : '#e5e7eb',
                                    opacity: count > 0 ? Math.max(0.42, Math.min(1, 0.35 + prob)) : 0.65,
                                 }}
                                 title={`${emotion} · bucket ${i + 1}: ${count} window${count === 1 ? '' : 's'}`}
                              />
                           );
                        })}
                     </div>
                  </div>
               ))}
            </div>
         </div>
         <div className="border-t border-gray-100 pt-2">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Totals</div>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
         {rows.map((r) => {
            const share = sum > 0 ? r.count / sum : 0;
            const intensity = r.count > 0 ? 1 : 0.28;
            return (
               <div key={r.emotion} className="rounded-md border border-gray-200 bg-gradient-to-br from-white to-gray-50 px-2 py-1.5">
                  <div className="mb-1 flex items-center justify-between gap-2">
                     <div className="flex min-w-0 items-center gap-1.5">
                        <span className="h-3 w-3 rounded-sm" style={{ background: emotionColor(r.emotion), opacity: intensity }} />
                        <span className="truncate text-xs font-semibold capitalize text-gray-900">{r.emotion}</span>
                     </div>
                     <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${r.count > 0 ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'}`}>
                        {r.count}
                     </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                     <div
                        className="h-full rounded-full"
                        style={{
                           width: `${max > 0 ? (r.count / max) * 100 : 0}%`,
                           background: emotionColor(r.emotion),
                           opacity: intensity,
                        }}
                     />
                  </div>
                  <div className="mt-1 text-[10px] leading-none text-gray-500">{share > 0 ? `${(share * 100).toFixed(1)}%` : '0%'}</div>
               </div>
            );
         })}
            </div>
         </div>
      </div>
   );
}

function bucketEmotionTimeline(timeline, targetBuckets) {
   const points = Array.isArray(timeline) ? timeline : [];
   if (!points.length) return [];
   const bucketCount = Math.max(1, Math.min(targetBuckets, points.length));
   const buckets = Array.from({ length: bucketCount }, () => ({ counts: new Map(), maxProb: new Map() }));
   points.forEach((point, index) => {
      const bucketIndex = Math.min(bucketCount - 1, Math.floor((index / points.length) * bucketCount));
      const bucket = buckets[bucketIndex];
      const emotion = point?.emotion;
      if (!emotion) return;
      bucket.counts.set(emotion, (bucket.counts.get(emotion) ?? 0) + 1);
      bucket.maxProb.set(emotion, Math.max(bucket.maxProb.get(emotion) ?? 0, Number(point?.prob) || 0));
   });
   return buckets;
}

function fullEmotionNetwork(edges) {
   const familyOf = (emotion) => EMOTION_FAMILIES[emotion] ?? 'other';
   const families = [...new Set(OYON_EMOTION_LABELS.map(familyOf))];
   return {
      nodes: [
         { id: 'root', parent: '', label: '' },
         ...families.map((family) => ({ id: `family_${family}`, parent: 'root', label: family })),
         ...OYON_EMOTION_LABELS.map((emotion) => ({
            id: emotion,
            parent: `family_${familyOf(emotion)}`,
            label: emotion,
            group: emotion,
         })),
      ],
      edges: Array.isArray(edges) ? edges : [],
   };
}

function AffectPlane({ points }) {
   const all = Array.isArray(points) ? points : [];
   const trail = all.slice(Math.max(0, all.length - PLANE_CAP));
   if (trail.length === 0) return <EmptyPanelText>No valence/arousal samples in these windows.</EmptyPanelText>;
   const S = 260;
   const toX = (v) => ((clampAffect(v) + 1) / 2) * S;
   const toY = (a) => ((1 - clampAffect(a)) / 2) * S;
   const path = trail.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.v).toFixed(1)} ${toY(p.a).toFixed(1)}`).join(' ');
   const last = trail[trail.length - 1];
   return (
      <svg viewBox={`0 0 ${S} ${S}`} className="mx-auto block h-auto w-full max-w-[330px] rounded-md border border-gray-200 bg-gray-50" role="img" aria-label="Affect 2 valence-arousal plane">
         <line x1={S / 2} x2={S / 2} y1={0} y2={S} stroke="#d1d5db" />
         <line x1={0} x2={S} y1={S / 2} y2={S / 2} stroke="#d1d5db" />
         <text x={S / 2} y={14} textAnchor="middle" fontSize={10} fill="#6b7280">high arousal</text>
         <text x={S / 2} y={S - 6} textAnchor="middle" fontSize={10} fill="#6b7280">low arousal</text>
         <text x={6} y={S / 2 - 6} fontSize={10} fill="#6b7280">negative</text>
         <text x={S - 6} y={S / 2 - 6} textAnchor="end" fontSize={10} fill="#6b7280">positive</text>
         <path d={path} fill="none" stroke="#0f766e" strokeWidth={1.5} opacity={0.32} strokeLinejoin="round" />
         {trail.map((p, i) => {
            const t = (i + 1) / trail.length;
            return (
               <circle key={i} cx={toX(p.v)} cy={toY(p.a)} r={2 + t * 4} fill={emotionColor(p.emotion)} opacity={0.2 + t * 0.8}>
                  <title>{`${p.emotion} · v ${fmtNum(p.v)} · a ${fmtNum(p.a)} · ${p.quadrant ?? '—'}`}</title>
               </circle>
            );
         })}
         <circle cx={toX(last.v)} cy={toY(last.a)} r={11} fill="rgba(124,58,237,0.25)" />
         <circle cx={toX(last.v)} cy={toY(last.a)} r={5.5} fill={emotionColor(last.emotion)} />
      </svg>
   );
}

function QuadrantMix({ points }) {
   const rows = Array.isArray(points) ? points : [];
   const counts = rows.reduce((acc, p) => {
      const key = p?.quadrant || 'unknown';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
   }, {});
   const total = rows.length;
   const items = [
      { key: 'positive-activated', label: 'Positive · active', color: '#10b981' },
      { key: 'positive-calm', label: 'Positive · calm', color: '#0891b2' },
      { key: 'negative-activated', label: 'Negative · active', color: '#d97706' },
      { key: 'negative-calm', label: 'Negative · calm', color: '#3b82f6' },
   ].map((item) => ({ ...item, count: counts[item.key] ?? 0 }));

   if (!total) return <EmptyPanelText>No valence/arousal samples in these windows.</EmptyPanelText>;

   return (
      <div className="grid grid-cols-1 gap-2">
         {items.map((item) => {
            const share = item.count / total;
            return (
               <div key={item.key} className="rounded-md border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                     <span className="min-w-0 truncate text-xs font-semibold text-gray-800">{item.label}</span>
                     <span className="text-xs font-semibold tabular-nums text-gray-900">{item.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                     <div
                        className="h-full rounded-full"
                        style={{ width: `${(share * 100).toFixed(1)}%`, background: item.color }}
                     />
                  </div>
                  <div className="mt-1 text-[10px] leading-none text-gray-500">{(share * 100).toFixed(1)}%</div>
               </div>
            );
         })}
      </div>
   );
}

function DynamicsChart({ dynamics }) {
   const rows = Array.isArray(dynamics) ? dynamics : [];
   const hasData = rows.some((d) => isNum(d.speed) || isNum(d.instability));
   if (!hasData) return <EmptyPanelText>No dynamics yet. This needs at least two consecutive windows with valence/arousal.</EmptyPanelText>;
   const W = 640;
   const H = 170;
   const padL = 34;
   const padR = 12;
   const padT = 12;
   const padB = 16;
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
      { key: 'speed', label: 'Affect speed', color: '#db2777' },
      { key: 'instability', label: 'Instability', color: '#d97706' },
   ];
   return (
      <div>
         <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Affect 2 dynamics timeline">
            {[0, 0.5, 1].map((t) => (
               <g key={t}>
                  <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#e5e7eb" />
                  <text x={padL - 5} y={y(t) + 3} textAnchor="end" fontSize={10} fill="#6b7280">{t.toFixed(1)}</text>
               </g>
            ))}
            {series.map((s) => <path key={s.key} d={pathFor(s.key)} fill="none" stroke={s.color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />)}
         </svg>
         <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
            {series.map((s) => (
               <span key={s.key} className="inline-flex items-center gap-1">
                  <span className="h-0.5 w-5 rounded-full" style={{ background: s.color }} />
                  {s.label}
               </span>
            ))}
         </div>
      </div>
   );
}

function EmptyPanelText({ children }) {
   return <div className="py-16 text-center text-sm text-gray-500">{children}</div>;
}

function EmptyState({ icon, text, detail }) {
   return (
      <div className="rohy-admin-light rounded-md border border-gray-200 bg-white p-8 text-center text-sm text-gray-600 shadow-sm">
         {icon && <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-md bg-gray-50 text-gray-400">{icon}</div>}
         <div className="font-medium text-gray-800">{text}</div>
         {detail && <div className="mt-1 text-xs text-gray-500">{detail}</div>}
      </div>
   );
}

function fmtNum(v) {
   if (!isNum(v)) return '—';
   const abs = Math.abs(v);
   if (abs >= 100) return v.toFixed(0);
   if (abs >= 10) return v.toFixed(1);
   return v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clampAffect = (v) => Math.max(-1, Math.min(1, v));
