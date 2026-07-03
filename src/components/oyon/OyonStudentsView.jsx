import React, { useMemo } from 'react';
import {
   emotionColor, pct, signed, fix2, signedColor, fmtTime, qualityVerdict,
} from './emotionLogShared';
import { studentAggregates } from './recordAggregates';

/*
 * Students data view — the per-student aggregate table extracted from
 * OyonLearningAnalyticsTab, made presentational over a hydrated
 * emotion-record `records` prop. The old tab consumed the server's
 * /analytics/students rollup; standalone, the same per-student aggregates
 * (sessions, cases, windows, top dominant estimate, mean valence / arousal /
 * confidence, quality verdict, time range) are computed CLIENT-SIDE from the
 * passed window records — the pure rollup lives in recordAggregates.js.
 */

export default function OyonStudentsView({ records }) {
   const students = useMemo(() => studentAggregates(records), [records]);
   if (!students.length) return <Empty msg="No students match the current filters." />;
   return (
      <div className="rohy-admin-light max-h-[70vh] overflow-auto rounded-lg border border-gray-200">
         <table className="min-w-[1040px] w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white shadow-lg text-gray-600 text-xs uppercase">
               <tr>
                  <th className="text-left px-3 py-2">Student</th>
                  <th className="text-left px-3 py-2">Role</th>
                  <th className="text-right px-3 py-2">Sessions</th>
                  <th className="text-right px-3 py-2">Cases</th>
                  <th className="text-right px-3 py-2">Windows</th>
                  <th className="text-left px-3 py-2">Top estimate</th>
                  <th className="text-right px-3 py-2">Mean valence</th>
                  <th className="text-right px-3 py-2">Mean arousal</th>
                  <th className="text-right px-3 py-2">Mean confidence</th>
                  <th className="text-left px-3 py-2">Quality</th>
                  <th className="text-left px-3 py-2">Range</th>
               </tr>
            </thead>
            <tbody>
               {students.map((s, i) => {
                  const q = qualityVerdict(s);
                  return (
                     <tr key={`${s.user_id ?? 'anon'}-${i}`} className="border-t border-gray-200 hover:bg-gray-50">
                        <td className="px-3 py-1.5">
                           <span className="font-semibold text-gray-900">{s.username || s.student_label}</span>
                           {s.user_id ? null : <span className="ml-1 text-xs text-gray-500">(anonymised)</span>}
                        </td>
                        <td className="px-3 py-1.5 text-gray-600">{s.user_role || '—'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{s.sessions_count}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{s.cases_count}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{s.window_count}</td>
                        <td className="px-3 py-1.5 capitalize">
                           <span className="inline-flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full" style={{ background: emotionColor(s.top_dominant_estimate) }} />
                              {s.top_dominant_estimate || '—'}
                           </span>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: signedColor(s.mean_valence) }}>{signed(s.mean_valence)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fix2(s.mean_arousal)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{pct(s.mean_confidence)}</td>
                        <td className="px-3 py-1.5">
                           <QualityBadge verdict={q} />
                        </td>
                        <td className="px-3 py-1.5 text-xs text-gray-600">
                           {fmtTime(s.first_window)} → {fmtTime(s.last_window)}
                        </td>
                     </tr>
                  );
               })}
            </tbody>
         </table>
      </div>
   );
}

function QualityBadge({ verdict }) {
   const colors = {
      green: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40',
      amber: 'bg-amber-900/30 text-amber-300 border-amber-700/40',
      red:   'bg-red-900/30 text-red-300 border-red-700/40',
   };
   return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs ${colors[verdict.level]}`}>
         {verdict.label}
      </span>
   );
}

function Empty({ msg }) {
   return (
      <div className="rohy-admin-light rounded-md border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
         {msg}
      </div>
   );
}
