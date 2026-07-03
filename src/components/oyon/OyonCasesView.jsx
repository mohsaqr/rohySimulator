import React, { useMemo } from 'react';
import { emotionColor, pct, signed, signedColor } from './emotionLogShared';
import { caseAggregates } from './recordAggregates';

/*
 * Cases data view — the per-case table (+ dominant-estimate distribution
 * bar) extracted from OyonLearningAnalyticsTab, made presentational over a
 * hydrated emotion-record `records` prop. The old tab consumed the server's
 * /analytics/cases rollup; standalone, the same per-case aggregates
 * (students, sessions, windows, dominant-estimate distribution, mean
 * valence, mean confidence) are computed CLIENT-SIDE from the passed window
 * records — the pure rollup lives in recordAggregates.js.
 */

export default function OyonCasesView({ records }) {
   const cases = useMemo(() => caseAggregates(records), [records]);
   if (!cases.length) return <Empty msg="No cases match the current filters." />;
   return (
      <div className="rohy-admin-light max-h-[70vh] overflow-auto rounded-lg border border-gray-200">
         <table className="min-w-[920px] w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white shadow-lg text-gray-600 text-xs uppercase">
               <tr>
                  <th className="text-left px-3 py-2">Case</th>
                  <th className="text-left px-3 py-2">Category</th>
                  <th className="text-right px-3 py-2">Students</th>
                  <th className="text-right px-3 py-2">Sessions</th>
                  <th className="text-right px-3 py-2">Windows</th>
                  <th className="text-left px-3 py-2">Distribution of estimates</th>
                  <th className="text-right px-3 py-2">Mean valence</th>
                  <th className="text-right px-3 py-2">Mean confidence</th>
               </tr>
            </thead>
            <tbody>
               {cases.map((c, i) => (
                  <tr key={`${c.case_id ?? 'null'}-${i}`} className="border-t border-gray-200 hover:bg-gray-50">
                     <td className="px-3 py-1.5">
                        <span className="font-semibold text-gray-900">{c.case_title || (c.case_id ? `case ${c.case_id}` : 'unknown case')}</span>
                     </td>
                     <td className="px-3 py-1.5 text-gray-600">{c.case_category || '—'}</td>
                     <td className="px-3 py-1.5 text-right tabular-nums">{c.students_count}</td>
                     <td className="px-3 py-1.5 text-right tabular-nums">{c.sessions_count}</td>
                     <td className="px-3 py-1.5 text-right tabular-nums">{c.window_count}</td>
                     <td className="px-3 py-1.5"><DistBar dist={c.dominant_estimate_distribution} /></td>
                     <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: signedColor(c.mean_valence) }}>{signed(c.mean_valence)}</td>
                     <td className="px-3 py-1.5 text-right tabular-nums">{pct(c.mean_confidence)}</td>
                  </tr>
               ))}
            </tbody>
         </table>
      </div>
   );
}

function DistBar({ dist }) {
   const entries = Object.entries(dist || {});
   const total = entries.reduce((a, [, v]) => a + Number(v), 0);
   if (!total) return <span className="text-gray-500">—</span>;
   return (
      <div className="flex h-2.5 w-40 rounded overflow-hidden bg-gray-100">
         {entries.map(([label, v]) => (
            <div
               key={label}
               style={{ width: `${(Number(v) / total) * 100}%`, background: emotionColor(label) }}
               title={`${label}: ${v}`}
            />
         ))}
      </div>
   );
}

function Empty({ msg }) {
   return (
      <div className="rohy-admin-light rounded-md border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
         {msg}
      </div>
   );
}
