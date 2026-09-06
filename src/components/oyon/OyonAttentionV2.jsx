import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
   Activity, AlertTriangle, BarChart3, Download, Eye, Gauge, ScanEye, Timer, Users,
} from 'lucide-react';
import { engagementAnalytics } from './engagementAnalytics';
import { emotionColor } from './emotionLogShared';

// Explicit key map: CSV field name → catalogue key for its column header.
// The exported CSV keeps the raw field names in every language.
const CROSS_TAB_COLUMNS = [
   ['emotion', 'col_emotion'],
   ['windows', 'col_windows'],
   ['avgFocus', 'col_focus'],
   ['avgBlinkHz', 'col_blink'],
   ['avgEyeOpenness', 'col_eye_openness'],
   ['avgOffScreen', 'col_off_screen'],
];

// Focus-signal verdict → catalogue key (enum-style lookup, literal keys).
const FOCUS_LABEL_KEYS = {
   none: 'focus_label_none',
   strong: 'focus_label_strong',
   borderline: 'focus_label_borderline',
   low: 'focus_label_low',
};

// Signal-quality rows: catalogue key + the summary field it reads.
const QUALITY_ROW_KEYS = [
   'quality_engagement_coverage',
   'quality_calibration_quality',
   'quality_missing_face',
   'quality_off_screen_gaze',
];

export default function OyonAttentionV2({ records, loading }) {
   const { t } = useTranslation('oyon');
   const analytics = useMemo(() => engagementAnalytics(records), [records]);
   const { summary, byEmotion, series } = analytics;
   const hasWindows = summary.windows > 0;

   if (loading && !hasWindows) {
      return <EmptyState text={t('attention_v2_loading')} />;
   }

   if (!loading && summary.engagementWindows === 0) {
      return (
         <EmptyState
            icon={<Eye className="h-6 w-6" />}
            text={t('attention_v2_empty_text')}
            detail={t('attention_v2_empty_detail')}
         />
      );
   }

   return (
      <div className="rohy-admin-light space-y-4">
         <section className="rounded-md border border-gray-200 bg-white p-3 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3 border-b border-gray-100 pb-3">
               <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-gray-700">{t('attention_v2_title')}</h2>
                  <p className="mt-1 text-xs text-gray-500">{t('attention_v2_subtitle')}</p>
               </div>
               <button
                  onClick={() => downloadCsv(byEmotion)}
                  disabled={byEmotion.length === 0}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
               >
                  <Download className="h-4 w-4" />
                  {t('export_csv')}
               </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
               <MetricCard icon={<Users className="h-5 w-5" />} label={t('metric_sessions')} value={summary.sessions} detail={t('metric_windows_detail', { count: summary.windows })} accent="cyan" />
               <MetricCard icon={<Activity className="h-5 w-5" />} label={t('metric_engagement_windows')} value={`${summary.engagementWindows} / ${summary.windows}`} detail={t('metric_engagement_windows_detail')} accent="green" />
               <MetricCard icon={<Gauge className="h-5 w-5" />} label={t('metric_avg_focus')} value={pct(summary.avgFocus)} detail={t(FOCUS_LABEL_KEYS[focusBand(summary.avgFocus)])} accent="teal" />
               <MetricCard icon={<Eye className="h-5 w-5" />} label={t('metric_eye_openness')} value={pct(summary.avgEyeOpenness)} detail={t('metric_eye_openness_detail')} accent="cyan" />
               <MetricCard icon={<Timer className="h-5 w-5" />} label={t('metric_blink_rate')} value={hz(summary.avgBlinkHz)} detail={t('metric_blink_rate_detail')} accent="amber" />
               <MetricCard icon={<ScanEye className="h-5 w-5" />} label={t('metric_off_screen')} value={pct(summary.avgOffScreen)} detail={t('metric_off_screen_detail')} accent="rose" />
               <MetricCard icon={<BarChart3 className="h-5 w-5" />} label={t('metric_calibration')} value={pct(summary.avgCalibrationQuality)} detail={t('metric_calibration_detail')} accent="green" />
               <MetricCard icon={<AlertTriangle className="h-5 w-5" />} label={t('metric_no_face')} value={pct(summary.avgMissingFace)} detail={t('metric_no_face_detail')} accent="slate" />
            </div>
         </section>

         <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title={t('panel_focus_eye')}>
               <FocusOverview points={series} t={t} />
            </Panel>
            <Panel title={t('panel_attention_lapses')}>
               <LapseOverview points={series} t={t} />
            </Panel>
            <Panel title={t('panel_attention_by_emotion')}>
               <EmotionAttentionTable rows={byEmotion} t={t} />
            </Panel>
            <Panel title={t('panel_signal_quality')}>
               <QualityPanel summary={summary} t={t} />
            </Panel>
         </div>
      </div>
   );
}

function MetricCard({ icon, label, value, detail, accent = 'cyan' }) {
   const colors = {
      cyan: 'from-cyan-50 to-white text-cyan-700 ring-cyan-100',
      green: 'from-emerald-50 to-white text-emerald-700 ring-emerald-100',
      amber: 'from-amber-50 to-white text-amber-700 ring-amber-100',
      teal: 'from-teal-50 to-white text-teal-700 ring-teal-100',
      rose: 'from-rose-50 to-white text-rose-700 ring-rose-100',
      slate: 'from-slate-50 to-white text-slate-700 ring-slate-100',
   };
   return (
      <div className="group relative overflow-hidden rounded-md border border-gray-200 bg-gradient-to-br from-white to-gray-50 px-4 py-3 shadow-sm">
         <div className="flex items-start gap-3">
            <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-md bg-gradient-to-br ring-1 ${colors[accent] || colors.cyan}`}>
               {icon}
            </div>
            <div className="min-w-0">
               <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">{label}</div>
               <div className="mt-1 text-2xl font-semibold leading-none tabular-nums text-gray-950">{value}</div>
               <div className="mt-1 truncate text-xs font-medium text-gray-500">{detail}</div>
            </div>
         </div>
         <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-gray-900/5 group-hover:bg-gray-900/10" />
      </div>
   );
}

function Panel({ title, children }) {
   return (
      <section className="rounded-md border border-gray-200 bg-white shadow-sm">
         <div className="flex min-h-11 items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
         </div>
         <div className="min-h-[260px] p-4">{children}</div>
      </section>
   );
}

function FocusOverview({ points, t }) {
   const usable = points.filter((p) => isNum(p.focus) || isNum(p.eyeOpenness));
   if (usable.length < 2) {
      return <EmptyPanelText>{t('attention_v2_not_enough_line')}</EmptyPanelText>;
   }
   return (
      <div className="space-y-3">
         <LineChart
            ariaLabel={t('aria_attention_timeline')}
            series={[
               { name: t('legend_focus'), color: '#0f766e', values: points.map((p) => p.focus) },
               { name: t('legend_eye_openness'), color: '#0891b2', values: points.map((p) => p.eyeOpenness) },
            ]}
         />
         <div className="flex flex-wrap gap-3 text-xs text-gray-500">
            <LegendItem label={t('legend_focus')} color="#0f766e" />
            <LegendItem label={t('legend_eye_openness')} color="#0891b2" />
         </div>
      </div>
   );
}

function LapseOverview({ points, t }) {
   const hasData = points.some((p) => isNum(p.offScreen) || isNum(p.missingFace));
   if (!hasData) return <EmptyPanelText>{t('attention_v2_no_lapse_signal')}</EmptyPanelText>;
   return (
      <div className="space-y-5">
         <LapseStrip label={t('lapse_off_screen')} kind="off_screen" values={points.map((p) => p.offScreen)} color="248, 113, 113" t={t} />
         <LapseStrip label={t('lapse_no_face')} kind="no_face" values={points.map((p) => p.missingFace)} color="245, 158, 11" t={t} />
      </div>
   );
}

function EmotionAttentionTable({ rows, t }) {
   if (!rows.length) return <EmptyPanelText>{t('attention_no_emotion_windows')}</EmptyPanelText>;
   return (
      <div className="overflow-x-auto">
         <table className="w-full text-left text-xs">
            <thead>
               <tr className="border-b border-gray-200 text-gray-500">
                  {CROSS_TAB_COLUMNS.map(([key, labelKey]) => (
                     <th key={key} className="py-2 pr-3 font-semibold whitespace-nowrap">{t(labelKey)}</th>
                  ))}
               </tr>
            </thead>
            <tbody>
               {rows.map((r) => (
                  <tr key={r.emotion} className="border-b border-gray-100 text-gray-800">
                     <td className="py-2 pr-3 font-semibold capitalize">
                        <span className="inline-flex items-center gap-2">
                           <span className="h-2.5 w-2.5 rounded-sm" style={{ background: emotionColor(r.emotion) }} />
                           {r.emotion}
                        </span>
                     </td>
                     <td className="py-2 pr-3 tabular-nums">{r.windows}</td>
                     <td className="py-2 pr-3"><BarValue value={r.avgFocus} /></td>
                     <td className="py-2 pr-3 tabular-nums">{hz(r.avgBlinkHz)}</td>
                     <td className="py-2 pr-3"><BarValue value={r.avgEyeOpenness} /></td>
                     <td className="py-2 pr-3"><BarValue value={r.avgOffScreen} tone="rose" /></td>
                  </tr>
               ))}
            </tbody>
         </table>
      </div>
   );
}

function QualityPanel({ summary, t }) {
   const values = [
      ratio(summary.engagementWindows, summary.windows),
      summary.avgCalibrationQuality,
      summary.avgMissingFace,
      summary.avgOffScreen,
   ];
   const rows = QUALITY_ROW_KEYS.map((labelKey, i) => [labelKey, values[i]]);
   return (
      <div className="space-y-4">
         {rows.map(([labelKey, value]) => (
            <div key={labelKey}>
               <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-gray-700">{t(labelKey)}</span>
                  <span className="tabular-nums text-gray-500">{pct(value)}</span>
               </div>
               <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-cyan-600" style={{ width: `${Math.max(0, Math.min(1, value || 0)) * 100}%` }} />
               </div>
            </div>
         ))}
      </div>
   );
}

function LineChart({ series, ariaLabel, height = 210 }) {
   const W = 640;
   const H = height;
   const padL = 34;
   const padR = 12;
   const padT = 12;
   const padB = 16;
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
               <line x1={padL} x2={W - padR} y1={y(tick)} y2={y(tick)} stroke="#e5e7eb" />
               <text x={padL - 5} y={y(tick) + 3} textAnchor="end" fontSize={10} fill="#6b7280">{tick.toFixed(1)}</text>
            </g>
         ))}
         {series.map((s) => (
            <path key={s.name} d={pathFor(s.values)} fill="none" stroke={s.color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
         ))}
      </svg>
   );
}

function LapseStrip({ label, kind, values, color, t }) {
   return (
      <div>
         <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-gray-700">{label}</span>
            <span className="text-gray-500">{pct(mean(values))}</span>
         </div>
         <div className="flex h-8 gap-px overflow-hidden rounded-md bg-gray-100">
            {values.map((v, i) => {
               const r = isNum(v) ? Math.max(0, Math.min(1, v)) : 0;
               return (
                  <div
                     key={i}
                     className="h-full flex-1"
                     style={{ background: r > 0 ? `rgba(${color}, ${(0.15 + 0.85 * r).toFixed(2)})` : '#f3f4f6' }}
                     title={t('lapse_tooltip', { index: i + 1, percent: (r * 100).toFixed(0), kind })}
                  />
               );
            })}
         </div>
      </div>
   );
}

function BarValue({ value, tone = 'cyan' }) {
   const v = isNum(value) ? Math.max(0, Math.min(1, value)) : null;
   const color = tone === 'rose' ? 'bg-rose-500' : 'bg-cyan-600';
   return (
      <div className="flex min-w-24 items-center gap-2">
         <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
            {v != null && <div className={`h-full rounded-full ${color}`} style={{ width: `${v * 100}%` }} />}
         </div>
         <span className="w-9 text-right tabular-nums text-gray-600">{pct(value)}</span>
      </div>
   );
}

function LegendItem({ label, color }) {
   return (
      <span className="inline-flex items-center gap-1">
         <span className="h-0.5 w-5 rounded-full" style={{ background: color }} />
         {label}
      </span>
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

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (values) => {
   const nums = values.filter(isNum);
   return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
};
const ratio = (a, b) => (Number(b) > 0 ? Number(a) / Number(b) : null);
const pct = (v) => (isNum(v) ? `${(v * 100).toFixed(0)}%` : '—');
const hz = (v) => (isNum(v) ? `${v.toFixed(2)} Hz` : '—');
const focusBand = (v) => {
   if (!isNum(v)) return 'none';
   if (v > 0.6) return 'strong';
   if (v > 0.4) return 'borderline';
   return 'low';
};

function downloadCsv(rows) {
   const header = CROSS_TAB_COLUMNS.map(([key]) => key);
   const escape = (v) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
   };
   const body = rows.map((r) => header.map((k) => escape(r[k])).join(','));
   const blob = new Blob([[header.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' });
   const url = URL.createObjectURL(blob);
   const a = document.createElement('a');
   a.href = url;
   a.download = `attention-2-${new Date().toISOString().slice(0, 10)}.csv`;
   document.body.appendChild(a);
   a.click();
   a.remove();
   URL.revokeObjectURL(url);
}
