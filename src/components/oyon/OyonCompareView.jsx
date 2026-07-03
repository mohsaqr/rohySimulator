import React, { useMemo, useState } from 'react';
import { Download, GitCompare } from 'lucide-react';
import { compareRecords } from './compareAnalytics';
import { EmotionStrip, DistributionBars } from './EmotionStripCharts';
import { emotionColor, signed, pct, downloadText, exportFileName } from './emotionLogShared';

/*
 * Side-by-side comparison over the filtered server records — the Rohy port
 * of the <oyon-app> element's Analyze · Comparison tab
 * (OyonR/standalone/app/src/routes/analyze/comparison.tsx): per-group
 * capture timelines and dominant-emotion distributions, the element's
 * single-session time-slice mode (2–6 slices select), and an export button.
 * Rohy additions requested for the native port: a compare-by toggle
 * (student | session | case — the element compares sessions only) and a
 * per-entity summary table (window count, emotion-mix bar, mean
 * valence / arousal / focus / confidence). All numbers come from the pure
 * compareAnalytics() module (tested); this file is layout.
 */

const COMPARE_DIMENSIONS = [
   ['student', 'Student'],
   ['session', 'Session'],
   ['case', 'Case'],
];

// One timeline + one distribution card per group; past this the page turns
// into a scroll of near-identical charts, so charts cap while the entity
// table stays complete.
const CHART_CAP = 6;

export default function OyonCompareView({ records, loading }) {
   const [compareBy, setCompareBy] = useState('session');
   const [slices, setSlices] = useState(2);
   const cmp = useMemo(
      () => compareRecords(records, { by: compareBy, slices }),
      [records, compareBy, slices],
   );

   if (loading && cmp.totalWindows === 0) {
      return (
         <div className="rohy-admin-light rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            Loading comparison data…
         </div>
      );
   }

   if (cmp.totalWindows === 0) {
      return (
         <div className="rohy-admin-light rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-600">
            <GitCompare className="mx-auto mb-2 h-6 w-6 text-gray-400" />
            No windows in the current selection. Comparisons appear once emotion
            windows have been captured — run a capture (or widen the filters),
            then refresh.
         </div>
      );
   }

   const isSlices = cmp.mode === 'slices';
   const enough = cmp.groups.length >= 2;
   const chartGroups = cmp.groups.slice(0, CHART_CAP);

   return (
      <div className="rohy-admin-light space-y-5">
         {/* Compare-by toggle + slice select + export */}
         <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-gray-500">Compare by</span>
            {COMPARE_DIMENSIONS.map(([id, label]) => (
               <button
                  key={id}
                  onClick={() => setCompareBy(id)}
                  aria-pressed={compareBy === id}
                  className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
                     compareBy === id
                        ? 'border-teal-600/60 bg-teal-50 text-teal-700'
                        : 'border-gray-300 text-gray-800 hover:bg-gray-100'
                  }`}
               >
                  {label}
               </button>
            ))}
            {isSlices && (
               <label className="ml-2 flex items-center gap-1.5 text-xs text-gray-600">
                  Slices
                  <select
                     value={slices}
                     onChange={(e) => setSlices(Number(e.target.value))}
                     className="rounded border border-gray-300 bg-gray-100 px-2 py-1 text-xs text-gray-900"
                  >
                     {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
               </label>
            )}
            <button
               onClick={() => exportComparison(cmp)}
               disabled={!enough}
               className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-100 disabled:opacity-50"
            >
               <Download className="h-4 w-4" /> Export
            </button>
         </div>

         {/* Mode line — mirrors the element's header text */}
         <p className="text-xs text-gray-500">
            {isSlices ? (
               <>Single session — split into <span className="font-semibold text-gray-800">{cmp.groups.length}</span> time slice{cmp.groups.length === 1 ? '' : 's'}</>
            ) : (
               <>Comparing <span className="font-semibold text-gray-800">{cmp.groups.length}</span> {entityNoun(compareBy, cmp.groups.length)}</>
            )}
            {' '}· {cmp.totalWindows} window{cmp.totalWindows === 1 ? '' : 's'} total
         </p>

         {!enough ? (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-600">
               Not enough to compare — at least two {entityNoun(compareBy, 2)} (or two
               windows in one session) are needed. Try another compare-by dimension
               or widen the filters.
            </div>
         ) : (
            <>
               {/* Per-entity summary table */}
               <section className="rounded-lg border border-gray-200 bg-white p-4">
                  <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-800">
                     {isSlices ? 'Time slices' : `By ${compareBy}`}
                  </h3>
                  <div className="overflow-x-auto">
                     <table className="w-full text-left text-xs">
                        <thead>
                           <tr className="border-b border-gray-200 text-gray-500">
                              <th className="py-1.5 pr-3 font-semibold">{isSlices ? 'Slice' : capitalize(compareBy)}</th>
                              <th className="py-1.5 pr-3 font-semibold">Windows</th>
                              <th className="py-1.5 pr-3 font-semibold">Emotion mix</th>
                              <th className="py-1.5 pr-3 font-semibold">Dominant</th>
                              <th className="py-1.5 pr-3 font-semibold">Avg valence</th>
                              <th className="py-1.5 pr-3 font-semibold">Avg arousal</th>
                              <th className="py-1.5 pr-3 font-semibold">Avg focus</th>
                              <th className="py-1.5 pr-3 font-semibold">Avg confidence</th>
                           </tr>
                        </thead>
                        <tbody>
                           {cmp.groups.map((g) => (
                              <tr key={g.id} className="border-b border-gray-200 text-gray-800">
                                 <td className="max-w-48 truncate py-1.5 pr-3 font-semibold" title={g.label}>{g.label}</td>
                                 <td className="py-1.5 pr-3 tabular-nums">{g.stats.windowCount}</td>
                                 <td className="py-1.5 pr-3"><MixBar distribution={g.distribution} /></td>
                                 <td className="py-1.5 pr-3 capitalize">
                                    {g.stats.dominantEmotion ? (
                                       <span className="inline-flex items-center gap-1.5">
                                          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: emotionColor(g.stats.dominantEmotion) }} />
                                          {g.stats.dominantEmotion} {g.stats.dominantShare != null ? `(${pct(g.stats.dominantShare)})` : ''}
                                       </span>
                                    ) : '—'}
                                 </td>
                                 <td className="py-1.5 pr-3 tabular-nums">{signed(g.stats.meanValence)}</td>
                                 <td className="py-1.5 pr-3 tabular-nums">{signed(g.stats.meanArousal)}</td>
                                 <td className="py-1.5 pr-3 tabular-nums">{pct(g.stats.meanFocus)}</td>
                                 <td className="py-1.5 pr-3 tabular-nums">{pct(g.stats.meanConfidence)}</td>
                              </tr>
                           ))}
                        </tbody>
                     </table>
                  </div>
               </section>

               {/* Per-group capture timelines — the element's stacked timeline cards */}
               <section className="rounded-lg border border-gray-200 bg-white p-4">
                  <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-800">Capture timelines</h3>
                  <p className="mb-3 text-xs text-gray-500">
                     Dominant expression per window, per group — bar height is the
                     dominant probability, newest right.
                     {cmp.groups.length > CHART_CAP ? ` Showing the ${CHART_CAP} most recent groups; the table above lists all ${cmp.groups.length}.` : ''}
                  </p>
                  <div className="space-y-4">
                     {chartGroups.map((g) => (
                        <div key={`tl-${g.id}`}>
                           <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                              <span className="truncate font-semibold text-gray-800">{g.label}</span>
                              <span className="shrink-0 tabular-nums text-gray-500">{g.stats.windowCount} window{g.stats.windowCount === 1 ? '' : 's'}</span>
                           </div>
                           <EmotionStrip points={g.timeline} height={90} ariaLabel={`Emotion timeline — ${g.label}`} />
                        </div>
                     ))}
                  </div>
               </section>

               {/* Per-group emotion distributions */}
               <section className="rounded-lg border border-gray-200 bg-white p-4">
                  <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-800">Emotion distribution</h3>
                  <p className="mb-3 text-xs text-gray-500">Per-group dominant-expression counts.</p>
                  <div className="grid gap-4 lg:grid-cols-2">
                     {chartGroups.map((g) => (
                        <div key={`dist-${g.id}`} className="rounded-lg border border-gray-200 bg-white p-3">
                           <div className="mb-2 truncate text-xs font-semibold text-gray-800">{g.label}</div>
                           <DistributionBars rows={g.distribution} total={g.stats.windowCount} />
                        </div>
                     ))}
                  </div>
               </section>
            </>
         )}
      </div>
   );
}

// 100%-stacked dominant-emotion share bar for one group.
function MixBar({ distribution }) {
   const rows = Array.isArray(distribution) ? distribution : [];
   if (!rows.length) return <span className="text-gray-400">—</span>;
   return (
      <div className="flex h-3 w-40 min-w-28 overflow-hidden rounded bg-gray-100">
         {rows.map((d) => (
            <div
               key={d.emotion}
               className="h-full"
               style={{ width: `${(d.share * 100).toFixed(1)}%`, background: emotionColor(d.emotion) }}
               title={`${d.emotion} ${(d.share * 100).toFixed(0)}%`}
            />
         ))}
      </div>
   );
}

function entityNoun(by, n) {
   const noun = by === 'student' ? 'student' : by === 'case' ? 'case' : 'session';
   return n === 1 ? noun : `${noun}s`;
}

function capitalize(s) {
   return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function exportComparison(cmp) {
   const payload = {
      exported_at: new Date().toISOString(),
      compare_by: cmp.by,
      mode: cmp.mode,
      total_windows: cmp.totalWindows,
      groups: cmp.groups.map((g) => ({
         id: g.id,
         label: g.label,
         stats: g.stats,
         distribution: g.distribution,
      })),
      _note: 'Values are model estimates of facial expression; not direct measures of feelings.',
   };
   downloadText(JSON.stringify(payload, null, 2), exportFileName('oyon-comparison', 'json'), 'application/json');
}
