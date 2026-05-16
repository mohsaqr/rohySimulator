import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
   LineChart, Users, Calendar, Filter, Download, RefreshCw, X,
   AlertTriangle, ChevronLeft, ChevronRight, Info, Sliders,
} from 'lucide-react';
import { apiFetch, ApiError } from '../../services/apiClient';
import { roleLabel } from '../../constants/roleLabels';
import {
   emotionColor, ALL_DOMINANT_LABELS, pct, signed, fix2, signedColor,
   fmtTime, qualityVerdict,
} from '../oyon/emotionLogShared';

// View pills.
const VIEWS = [
   { id: 'windows',  label: 'Windows', icon: LineChart },
   { id: 'students', label: 'Students', icon: Users },
   { id: 'cases',    label: 'Cases',    icon: Calendar },
   { id: 'sessions', label: 'Sessions', icon: Calendar },
];

const DEFAULT_FILTERS = {
   q: '',
   from: '',
   to: '',
   dominant: [],          // multi-select
   role: '',
   case_id: '',
   user_id: '',
   session_id: '',
   min_confidence: 0,
   max_missing_face_ratio: 1,
};

const PAGE_SIZE = 200;

export default function OyonLearningAnalyticsTab() {
   const [view, setView] = useState('windows');
   const [filters, setFilters] = useState(DEFAULT_FILTERS);
   const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);
   const [loading, setLoading] = useState(false);
   const [error, setError] = useState(null);
   const [students, setStudents] = useState([]);
   const [cases, setCases] = useState([]);
   const [sessions, setSessions] = useState([]); // populated from /emotion-records
   const [sessionsTotal, setSessionsTotal] = useState(0);
   const [recordsOffset, setRecordsOffset] = useState(0);
   const [selectedSessionId, setSelectedSessionId] = useState(null);
   const [sessionDetail, setSessionDetail] = useState(null);

   const queryString = useMemo(() => filtersToQuery(appliedFilters), [appliedFilters]);
   const recordsQueryString = useMemo(
      () => withPagination(queryString, recordsOffset, PAGE_SIZE),
      [queryString, recordsOffset]
   );

   const load = useCallback(async () => {
      setLoading(true);
      setError(null);
      try {
         const [s, c, recs] = await Promise.all([
            apiFetch(`/addons/oyon/analytics/students?${queryString}`),
            apiFetch(`/addons/oyon/analytics/cases?${queryString}`),
            apiFetch(`/addons/oyon/emotion-records?${recordsQueryString}`),
         ]);
         setStudents(s?.students || []);
         setCases(c?.cases || []);
         setSessions(recs?.records || []);
         setSessionsTotal(recs?.total || 0);
      } catch (e) {
         if (e instanceof ApiError && e.status === 403) {
            setError('disabled');
         } else if (e instanceof ApiError && (e.code === 'OYON_DISABLED' || e.code === 'OYON_IMPORT_FAILED')) {
            // Server-side disabled stub — surface the exact reason from the
            // 503 body instead of "Could not load analytics".
            setError({ kind: 'serverDisabled', code: e.code, message: e.message });
         } else {
            setError(e?.message || 'Could not load analytics');
         }
         setStudents([]); setCases([]); setSessions([]); setSessionsTotal(0);
      } finally {
         setLoading(false);
      }
   }, [queryString, recordsQueryString]);

   useEffect(() => { load(); }, [load]);

   const apply = () => {
      setRecordsOffset(0);
      setAppliedFilters(filters);
   };
   const reset = () => {
      setRecordsOffset(0);
      setFilters(DEFAULT_FILTERS);
      setAppliedFilters(DEFAULT_FILTERS);
   };
   const pageRecords = (offset) => setRecordsOffset(Math.max(0, offset));

   const openSession = async (sessionId) => {
      setSelectedSessionId(sessionId);
      setSessionDetail(null);
      try {
         const detail = await apiFetch(`/addons/oyon/analytics/session/${sessionId}`);
         setSessionDetail(detail);
      } catch (e) {
         setSessionDetail({ error: e?.message || 'Could not load session detail' });
      }
   };

   if (error === 'disabled') {
      return <DisabledByTenant />;
   }
   if (error && typeof error === 'object' && error.kind === 'serverDisabled') {
      return <DisabledOnServer code={error.code} message={error.message} />;
   }

   return (
      <div className="space-y-5 p-6 max-w-6xl">
         <Intro />

         <div className="flex flex-wrap items-center gap-2">
            {VIEWS.map(v => {
               const Icon = v.icon;
               return (
                  <button
                     key={v.id}
                     onClick={() => setView(v.id)}
                     className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold border ${
                        view === v.id
                           ? 'bg-purple-700 text-white border-purple-500'
                           : 'bg-neutral-900 text-neutral-300 border-neutral-700 hover:bg-neutral-800'
                     }`}
                  >
                     <Icon className="w-4 h-4" /> {v.label}
                  </button>
               );
            })}
            <button
               onClick={load}
               disabled={loading}
               className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
               title="Refresh"
            >
               <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
               {loading ? 'Loading…' : 'Refresh'}
            </button>
         </div>

         <FilterBar filters={filters} onChange={setFilters} onApply={apply} onReset={reset} />

         {error && error !== 'disabled' && (
            <div className="rounded-md border border-red-500/30 bg-red-950/40 px-3 py-2 text-sm text-red-200">
               {error}
            </div>
         )}

         {view === 'windows'  && (
            <WindowsView
               records={sessions}
               total={sessionsTotal}
               offset={recordsOffset}
               pageSize={PAGE_SIZE}
               onPage={pageRecords}
               appliedFilters={appliedFilters}
            />
         )}
         {view === 'students' && <StudentsView students={students} onPickUser={(id) => setFilters(f => ({ ...f, user_id: String(id) }))} />}
         {view === 'cases'    && <CasesView    cases={cases}     onPickCase={(id) => setFilters(f => ({ ...f, case_id: String(id) }))} />}
         {view === 'sessions' && (
            <SessionsView
               sessions={sessions}
               total={sessionsTotal}
               selectedSessionId={selectedSessionId}
               sessionDetail={sessionDetail}
               onOpenSession={openSession}
               offset={recordsOffset}
               pageSize={PAGE_SIZE}
               onPage={pageRecords}
               appliedFilters={appliedFilters}
            />
         )}
      </div>
   );
}

function Intro() {
   return (
      <div className="space-y-2">
         <div className="flex items-center gap-2">
            <LineChart className="w-6 h-6 text-purple-400" />
            <h2 className="text-xl font-bold">Oyon — Learning Analytics</h2>
         </div>
         <div className="rounded-md border border-purple-900/30 bg-purple-950/20 px-3 py-2 text-xs text-purple-100/80 flex gap-2">
            <Info className="w-4 h-4 text-purple-300 mt-0.5 shrink-0" />
            <span>
               This view shows <strong>estimated facial-expression signals</strong> the Oyon model produced
               while students worked through cases — not feelings. Always read alongside the
               confidence and missing-face quality flags.
            </span>
         </div>
      </div>
   );
}

function DisabledByTenant() {
   return (
      <div className="p-6 max-w-3xl">
         <div className="rounded-md border border-neutral-800 bg-neutral-950/40 p-6 text-center text-sm text-neutral-400">
            <AlertTriangle className="w-5 h-5 mx-auto mb-2 text-amber-400" />
            Oyon analytics is disabled for your role in this tenant. An admin can enable it
            in Settings → Oyon — Emotion Capture.
         </div>
      </div>
   );
}

// Rendered when the server returns the OYON_DISABLED / OYON_IMPORT_FAILED
// stub. Shows the operator-actionable message from the 503 body so the
// fix is surfaced in the UI instead of buried in a server log.
function DisabledOnServer({ code, message }) {
   const isImportFail = code === 'OYON_IMPORT_FAILED';
   return (
      <div className="p-6 max-w-3xl">
         <div className="rounded-md border border-amber-700/40 bg-amber-950/20 p-5 text-sm">
            <div className="flex items-start gap-3">
               <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
               <div className="space-y-2">
                  <p className="font-semibold text-amber-200">
                     {isImportFail
                        ? 'Oyon analytics — module failed to load'
                        : 'Oyon analytics — disabled on this server'}
                  </p>
                  <p className="text-amber-100/80 whitespace-pre-line">{message}</p>
                  <p className="text-xs text-amber-100/60 pt-1">
                     After fixing the issue and restarting rohy, refresh this page.
                     Reason code: <code className="text-amber-100/80">{code}</code>
                  </p>
               </div>
            </div>
         </div>
      </div>
   );
}

function FilterBar({ filters, onChange, onApply, onReset }) {
   const setF = (k, v) => onChange(prev => ({ ...prev, [k]: v }));
   const toggleDominant = (label) => onChange(prev => ({
      ...prev,
      dominant: prev.dominant.includes(label) ? prev.dominant.filter(d => d !== label) : [...prev.dominant, label],
   }));
   return (
      <details className="rounded-lg border border-neutral-800 bg-neutral-950/40 group" open>
         <summary className="cursor-pointer select-none flex items-center gap-2 px-3 py-2 text-sm font-semibold text-neutral-200">
            <Filter className="w-4 h-4 text-neutral-400" /> Filters
         </summary>
         <div className="p-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <FormRow label="Search">
               <input
                  type="text"
                  value={filters.q}
                  onChange={e => setF('q', e.target.value)}
                  placeholder="username, student name, case title"
                  className="w-full px-2 py-1.5 rounded bg-neutral-900 border border-neutral-700 text-sm text-neutral-100"
               />
            </FormRow>
            <FormRow label="From (window_start)">
               <input
                  type="date"
                  value={filters.from}
                  onChange={e => setF('from', e.target.value)}
                  className="w-full px-2 py-1.5 rounded bg-neutral-900 border border-neutral-700 text-sm text-neutral-100"
               />
            </FormRow>
            <FormRow label="To (window_start)">
               <input
                  type="date"
                  value={filters.to}
                  onChange={e => setF('to', e.target.value)}
                  className="w-full px-2 py-1.5 rounded bg-neutral-900 border border-neutral-700 text-sm text-neutral-100"
               />
            </FormRow>
            <FormRow label="Estimated dominant" hint="Multi-select">
               <div className="flex flex-wrap gap-1">
                  {ALL_DOMINANT_LABELS.map(l => (
                     <button
                        key={l}
                        onClick={() => toggleDominant(l)}
                        className={`px-2 py-0.5 rounded-full text-xs border capitalize ${
                           filters.dominant.includes(l)
                              ? 'border-transparent text-white'
                              : 'border-neutral-700 text-neutral-400 hover:border-neutral-500'
                        }`}
                        style={filters.dominant.includes(l) ? { background: emotionColor(l) } : {}}
                     >
                        {l}
                     </button>
                  ))}
               </div>
            </FormRow>
            <FormRow label="Role">
               <select
                  value={filters.role}
                  onChange={e => setF('role', e.target.value)}
                  className="w-full px-2 py-1.5 rounded bg-neutral-900 border border-neutral-700 text-sm text-neutral-100"
               >
                  <option value="">All</option>
                  <option value="student">{roleLabel('student')}</option>
                  <option value="reviewer">{roleLabel('reviewer')}</option>
                  <option value="educator">{roleLabel('educator')}</option>
                  <option value="admin">{roleLabel('admin')}</option>
               </select>
            </FormRow>
            <FormRow label="Min confidence" hint={`${(filters.min_confidence * 100).toFixed(0)}%`}>
               <input
                  type="range"
                  min={0} max={1} step={0.05}
                  value={filters.min_confidence}
                  onChange={e => setF('min_confidence', Number(e.target.value))}
                  className="w-full"
               />
            </FormRow>
            <FormRow label="Max missing-face" hint={`${(filters.max_missing_face_ratio * 100).toFixed(0)}%`}>
               <input
                  type="range"
                  min={0} max={1} step={0.05}
                  value={filters.max_missing_face_ratio}
                  onChange={e => setF('max_missing_face_ratio', Number(e.target.value))}
                  className="w-full"
               />
            </FormRow>
            <FormRow label="Session ID">
               <input
                  type="text"
                  value={filters.session_id}
                  onChange={e => setF('session_id', e.target.value)}
                  className="w-full px-2 py-1.5 rounded bg-neutral-900 border border-neutral-700 text-sm text-neutral-100"
               />
            </FormRow>
            <FormRow label="Case ID">
               <input
                  type="text"
                  value={filters.case_id}
                  onChange={e => setF('case_id', e.target.value)}
                  className="w-full px-2 py-1.5 rounded bg-neutral-900 border border-neutral-700 text-sm text-neutral-100"
               />
            </FormRow>
            <FormRow label="User ID">
               <input
                  type="text"
                  value={filters.user_id}
                  onChange={e => setF('user_id', e.target.value)}
                  className="w-full px-2 py-1.5 rounded bg-neutral-900 border border-neutral-700 text-sm text-neutral-100"
               />
            </FormRow>
         </div>
         <div className="px-3 pb-3 flex gap-2">
            <button
               onClick={onApply}
               className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-purple-700 hover:bg-purple-600 text-white text-sm font-semibold"
            >
               <Sliders className="w-4 h-4" /> Apply
            </button>
            <button
               onClick={onReset}
               className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:bg-neutral-800 text-sm"
            >
               <X className="w-4 h-4" /> Reset
            </button>
         </div>
      </details>
   );
}

function FormRow({ label, hint, children }) {
   return (
      <label className="block">
         <span className="block text-xs font-semibold text-neutral-400 mb-1">
            {label}{hint ? <span className="text-neutral-500 font-normal"> · {hint}</span> : null}
         </span>
         {children}
      </label>
   );
}

function WindowsView({ records, total, offset, pageSize, onPage, appliedFilters }) {
   const [expandedId, setExpandedId] = useState(null);
   if (!records.length) {
      return (
         <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
               <span className="text-xs text-neutral-400">
                  {pageRangeLabel(offset, records.length, total)} window{total === 1 ? '' : 's'}
               </span>
               <PaginationControls offset={offset} count={records.length} total={total} pageSize={pageSize} onPage={onPage} />
            </div>
            <Empty msg="No windows match the current filters." />
         </div>
      );
   }
   return (
      <div className="space-y-2">
         <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-400">
               {pageRangeLabel(offset, records.length, total)} window{total === 1 ? '' : 's'}
            </span>
            <PaginationControls offset={offset} count={records.length} total={total} pageSize={pageSize} onPage={onPage} />
            <span className="ml-auto inline-flex gap-2">
               <button
                  onClick={() => exportCsv(records, appliedFilters)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-200 hover:bg-neutral-800 text-sm"
               >
                  <Download className="w-4 h-4" /> CSV
               </button>
               <button
                  onClick={() => exportJson(records, appliedFilters)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-200 hover:bg-neutral-800 text-sm"
               >
                  <Download className="w-4 h-4" /> JSON
               </button>
            </span>
         </div>
         <div className="max-h-[70vh] overflow-auto rounded-lg border border-neutral-800">
            <table className="min-w-[1280px] w-full text-xs">
               <thead className="sticky top-0 z-10 bg-neutral-900/95 text-neutral-400 uppercase">
                  <tr>
                     <th className="text-left px-2 py-2">Time</th>
                     <th className="text-left px-2 py-2">User</th>
                     <th className="text-left px-2 py-2">Role</th>
                     <th className="text-left px-2 py-2">Case</th>
                     <th className="text-right px-2 py-2">Session</th>
                     <th className="text-left px-2 py-2">Dominant (estimate)</th>
                     <th className="text-right px-2 py-2">Conf</th>
                     <th className="text-right px-2 py-2">Valence</th>
                     <th className="text-right px-2 py-2">Arousal</th>
                     <th className="text-right px-2 py-2">Entropy</th>
                     <th className="text-right px-2 py-2">Frames</th>
                     <th className="text-right px-2 py-2">Miss %</th>
                     <th className="text-left px-2 py-2">Model</th>
                     <th className="text-left px-2 py-2">Consent</th>
                     <th className="px-2 py-2"></th>
                  </tr>
               </thead>
               <tbody>
                  {records.map(r => {
                     const isOpen = expandedId === r.id;
                     return (
                        <React.Fragment key={r.id}>
                           <tr className="border-t border-neutral-800/60 hover:bg-neutral-900/40">
                              <td className="px-2 py-1.5 tabular-nums whitespace-nowrap text-neutral-300">{fmtTime(r.window_start)}</td>
                              <td className="px-2 py-1.5">{r.username || r.student_name_snapshot || (r.user_id != null ? `#${r.user_id}` : 'anonymised')}</td>
                              <td className="px-2 py-1.5 text-neutral-400">{r.user_role || r.student_role_snapshot || '—'}</td>
                              <td className="px-2 py-1.5">{r.case_title_snapshot || (r.case_id ? `case ${r.case_id}` : '—')}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-neutral-400">{r.session_id || '—'}</td>
                              <td className="px-2 py-1.5 capitalize">
                                 <span className="inline-flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full" style={{ background: emotionColor(r.dominant_emotion) }} />
                                    {r.dominant_emotion || '—'}
                                 </span>
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{pct(r.confidence)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: signedColor(r.valence) }}>{signed(r.valence)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fix2(r.arousal)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fix2(r.entropy)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{r.valid_frames ?? '—'}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{pct(r.missing_face_ratio)}</td>
                              <td className="px-2 py-1.5 text-neutral-400 text-[11px] whitespace-nowrap">{r.model_name || '—'}{r.model_version ? ` ${r.model_version}` : ''}</td>
                              <td className="px-2 py-1.5 text-neutral-400 text-[11px] whitespace-nowrap" title={r.consent_recorded_at || ''}>{r.consent_version || '—'}</td>
                              <td className="px-2 py-1.5">
                                 <button
                                    onClick={() => setExpandedId(isOpen ? null : r.id)}
                                    className="px-2 py-0.5 rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800 text-[11px]"
                                 >
                                    {isOpen ? 'hide' : 'detail'}
                                 </button>
                              </td>
                           </tr>
                           {isOpen && (
                              <tr className="bg-neutral-950/60">
                                 <td colSpan={15} className="px-3 py-3">
                                    <WindowDetail record={r} />
                                 </td>
                              </tr>
                           )}
                        </React.Fragment>
                     );
                  })}
               </tbody>
            </table>
         </div>
      </div>
   );
}

function WindowDetail({ record }) {
   const probs = record.probabilities && typeof record.probabilities === 'object' ? record.probabilities : null;
   const quality = record.quality && typeof record.quality === 'object' ? record.quality : null;
   const probEntries = probs ? Object.entries(probs).sort((a, b) => Number(b[1]) - Number(a[1])) : [];
   return (
      <div className="grid gap-4 md:grid-cols-2">
         <div>
            <div className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Probability map (estimates)</div>
            {probEntries.length === 0 && <div className="text-sm text-neutral-500">no probabilities recorded for this window</div>}
            {probEntries.map(([label, p]) => {
               const pNum = Number(p);
               return (
                  <div key={label} className="flex items-center gap-2 mb-1">
                     <span className="w-20 text-xs capitalize text-neutral-300">{label}</span>
                     <div className="flex-1 h-2 rounded bg-neutral-800 overflow-hidden">
                        <div style={{ width: `${Math.max(0, Math.min(1, pNum)) * 100}%`, background: emotionColor(label) }} className="h-full" />
                     </div>
                     <span className="w-12 text-right text-[11px] tabular-nums text-neutral-300">{(pNum * 100).toFixed(1)}%</span>
                  </div>
               );
            })}
         </div>
         <div>
            <div className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Quality + raw record</div>
            <pre className="text-[11px] bg-neutral-900 border border-neutral-800 rounded p-2 max-h-64 overflow-auto text-neutral-300">
{JSON.stringify({
   window: { start: record.window_start, end: record.window_end },
   capture: { mode: record.capture_mode, status: record.capture_status, valid_frames: record.valid_frames, missing_face_ratio: record.missing_face_ratio },
   model: { name: record.model_name, version: record.model_version },
   consent: { version: record.consent_version, recorded_at: record.consent_recorded_at, student_can_view: !!record.student_can_view, admin_can_view: !!record.admin_can_view, educator_can_view: !!record.educator_can_view },
   quality,
}, null, 2)}
            </pre>
         </div>
      </div>
   );
}

function StudentsView({ students, onPickUser }) {
   if (!students.length) return <Empty msg="No students match the current filters." />;
   return (
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-neutral-800">
         <table className="min-w-[1040px] w-full text-sm">
            <thead className="sticky top-0 z-10 bg-neutral-900/95 text-neutral-400 text-xs uppercase">
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
                     <tr key={`${s.user_id ?? 'anon'}-${i}`} className="border-t border-neutral-800/60 hover:bg-neutral-900/40">
                        <td className="px-3 py-1.5 cursor-pointer" onClick={() => s.user_id && onPickUser(s.user_id)}>
                           <span className="font-semibold text-neutral-100">{s.username || s.student_label}</span>
                           {s.user_id ? null : <span className="ml-1 text-xs text-neutral-500">(anonymised)</span>}
                        </td>
                        <td className="px-3 py-1.5 text-neutral-400">{s.user_role || '—'}</td>
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
                        <td className="px-3 py-1.5 text-xs text-neutral-400">
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

function CasesView({ cases, onPickCase }) {
   if (!cases.length) return <Empty msg="No cases match the current filters." />;
   return (
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-neutral-800">
         <table className="min-w-[920px] w-full text-sm">
            <thead className="sticky top-0 z-10 bg-neutral-900/95 text-neutral-400 text-xs uppercase">
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
                  <tr key={`${c.case_id ?? 'null'}-${i}`} className="border-t border-neutral-800/60 hover:bg-neutral-900/40">
                     <td className="px-3 py-1.5 cursor-pointer" onClick={() => c.case_id && onPickCase(c.case_id)}>
                        <span className="font-semibold text-neutral-100">{c.case_title || `case ${c.case_id}` || 'unknown case'}</span>
                     </td>
                     <td className="px-3 py-1.5 text-neutral-400">{c.case_category || '—'}</td>
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

function SessionsView({ sessions, total, selectedSessionId, sessionDetail, onOpenSession, offset, pageSize, onPage, appliedFilters }) {
   // Group records by session for the picker.
   const grouped = useMemo(() => {
      const m = new Map();
      for (const r of sessions) {
         const key = String(r.session_id || 'unknown');
         if (!m.has(key)) {
            m.set(key, {
               session_id: r.session_id,
               student_label: r.username || r.student_name_snapshot || r.user_id || 'unknown',
               case_label: r.case_title_snapshot || (r.case_id ? `case ${r.case_id}` : 'unknown case'),
               windows: [],
            });
         }
         m.get(key).windows.push(r);
      }
      return Array.from(m.values());
   }, [sessions]);

   return (
      <div className="space-y-3">
         <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-400">
               {pageRangeLabel(offset, sessions.length, total)} window{total === 1 ? '' : 's'} across {grouped.length} session{grouped.length === 1 ? '' : 's'}
            </span>
            <PaginationControls offset={offset} count={sessions.length} total={total} pageSize={pageSize} onPage={onPage} />
            <span className="ml-auto inline-flex gap-2">
               <button
                  onClick={() => exportCsv(sessions, appliedFilters)}
                  disabled={!sessions.length}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-200 hover:bg-neutral-800 text-sm disabled:opacity-50"
               >
                  <Download className="w-4 h-4" /> CSV
               </button>
               <button
                  onClick={() => exportJson(sessions, appliedFilters)}
                  disabled={!sessions.length}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-200 hover:bg-neutral-800 text-sm disabled:opacity-50"
               >
                  <Download className="w-4 h-4" /> JSON
               </button>
            </span>
         </div>

         {!grouped.length && <Empty msg="No sessions match the current filters." />}

         <div className="grid gap-2">
            {grouped.map(g => (
               <div key={g.session_id} className="rounded-lg border border-neutral-800 bg-neutral-950/40">
                  <button
                     onClick={() => onOpenSession(g.session_id)}
                     className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-neutral-900/40"
                  >
                     <ChevronRight className={`w-4 h-4 transition-transform ${selectedSessionId === g.session_id ? 'rotate-90' : ''}`} />
                     <span className="font-semibold text-neutral-100">Session {g.session_id}</span>
                     <span className="text-neutral-400">·</span>
                     <span className="text-neutral-300">{g.student_label}</span>
                     <span className="text-neutral-400">·</span>
                     <span className="text-neutral-300">{g.case_label}</span>
                     <span className="ml-auto text-xs text-neutral-500">{g.windows.length} windows</span>
                  </button>
                  {selectedSessionId === g.session_id && (
                     <div className="border-t border-neutral-800 p-3">
                        {sessionDetail?.error && <div className="text-sm text-red-300">{sessionDetail.error}</div>}
                        {!sessionDetail && <div className="text-sm text-neutral-500">Loading…</div>}
                        {sessionDetail && !sessionDetail.error && <SessionTimeline detail={sessionDetail} />}
                     </div>
                  )}
               </div>
            ))}
         </div>
      </div>
   );
}

function SessionTimeline({ detail }) {
   const windows = detail.oyon_windows || [];
   if (!windows.length) return <div className="text-sm text-neutral-500">No estimated-expression windows captured for this session.</div>;

   const startMs = Math.min(
      ...windows.map(w => Date.parse(w.window_start + (w.window_start.endsWith('Z') ? '' : 'Z'))).filter(Number.isFinite)
   );
   const endMs = Math.max(
      ...windows.map(w => Date.parse(w.window_end + (w.window_end.endsWith('Z') ? '' : 'Z'))).filter(Number.isFinite)
   );
   const totalMs = Math.max(1, endMs - startMs);

   return (
      <div className="space-y-2">
         <div className="text-xs text-neutral-400 mb-1">Estimated dominant per window</div>
         <div className="relative h-6 rounded bg-neutral-900 overflow-hidden">
            {windows.map((w, i) => {
               const a = Math.max(0, (Date.parse(w.window_start + 'Z') - startMs) / totalMs);
               const b = Math.max(a + 0.005, (Date.parse(w.window_end + 'Z') - startMs) / totalMs);
               return (
                  <div
                     key={i}
                     className="absolute top-0 bottom-0"
                     style={{
                        left: `${a * 100}%`,
                        width: `${(b - a) * 100}%`,
                        background: emotionColor(w.dominant_emotion),
                        opacity: Number.isFinite(w.confidence) ? Math.max(0.3, w.confidence) : 0.5,
                     }}
                     title={`${fmtTime(w.window_start)}  ·  ${w.dominant_emotion || '—'}  ·  conf ${pct(w.confidence)}  ·  miss ${pct(w.missing_face_ratio)}`}
                  />
               );
            })}
         </div>

         <div className="text-xs text-neutral-400 mt-3 mb-1">Valence (estimate)</div>
         <ValenceLine windows={windows} startMs={startMs} totalMs={totalMs} />

         <div className="text-[11px] text-neutral-500 italic mt-3 leading-snug">
            Oyon-only timeline. Each row carries <code className="text-neutral-400">session_id</code>,
            <code className="text-neutral-400 ml-1">user_id</code>, and
            <code className="text-neutral-400 ml-1">case_id</code> — combine with Rohy's session
            log offline (export → join) for behaviour-aligned analyses.
         </div>
      </div>
   );
}

function ValenceLine({ windows, startMs, totalMs }) {
   const W = 800, H = 60, PAD = 4;
   const points = windows
      .filter(w => Number.isFinite(w.valence))
      .map(w => {
         const t = Date.parse(w.window_start + 'Z');
         const x = PAD + ((t - startMs) / totalMs) * (W - 2 * PAD);
         const y = PAD + (1 - (Math.max(-1, Math.min(1, w.valence)) + 1) / 2) * (H - 2 * PAD);
         return `${x.toFixed(1)},${y.toFixed(1)}`;
      });
   return (
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-12 rounded bg-neutral-900">
         <line x1={PAD} y1={H/2} x2={W-PAD} y2={H/2} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />
         {points.length >= 2 && (
            <polyline fill="none" stroke="#a78bfa" strokeWidth="2" points={points.join(' ')} />
         )}
         {!points.length && (
            <text x={W/2} y={H/2 + 4} fontSize="10" fill="rgba(255,255,255,0.45)" textAnchor="middle">no valence estimates</text>
         )}
      </svg>
   );
}

function DistBar({ dist }) {
   const entries = Object.entries(dist || {});
   const total = entries.reduce((a, [, v]) => a + Number(v), 0);
   if (!total) return <span className="text-neutral-500">—</span>;
   return (
      <div className="flex h-2.5 w-40 rounded overflow-hidden bg-neutral-800">
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
      <div className="rounded-md border border-neutral-800 bg-neutral-950/40 p-6 text-center text-sm text-neutral-500">
         {msg}
      </div>
   );
}

function PaginationControls({ offset, count, total, pageSize, onPage }) {
   if (total <= pageSize && offset === 0) return null;
   const end = Math.min(total, offset + count);
   const canPrev = offset > 0;
   const canNext = end < total;
   const buttonClass = 'inline-flex h-7 w-7 items-center justify-center text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';
   return (
      <span className="inline-flex overflow-hidden rounded-md border border-neutral-700">
         <button
            type="button"
            title="Previous page"
            aria-label="Previous page"
            disabled={!canPrev}
            onClick={() => canPrev && onPage(Math.max(0, offset - pageSize))}
            className={buttonClass}
         >
            <ChevronLeft className="w-4 h-4" />
         </button>
         <button
            type="button"
            title="Next page"
            aria-label="Next page"
            disabled={!canNext}
            onClick={() => canNext && onPage(offset + pageSize)}
            className={`${buttonClass} border-l border-neutral-700`}
         >
            <ChevronRight className="w-4 h-4" />
         </button>
      </span>
   );
}

function pageRangeLabel(offset, count, total) {
   if (!total) return '0 of 0';
   const start = Math.min(total, offset + 1);
   const end = Math.max(start, Math.min(total, offset + count));
   return `${start}-${end} of ${total}`;
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function withPagination(queryString, offset, limit) {
   const p = new URLSearchParams(queryString || '');
   p.set('limit', String(limit));
   p.set('offset', String(Math.max(0, offset)));
   return p.toString();
}

function filtersToQuery(f) {
   const p = new URLSearchParams();
   if (f.q) p.set('q', f.q);
   if (f.from) p.set('from', f.from);
   if (f.to) p.set('to', f.to);
   if (f.dominant?.length) p.set('dominant', f.dominant.join(','));
   if (f.role) p.set('role', f.role);
   if (f.case_id) p.set('case_id', f.case_id);
   if (f.user_id) p.set('user_id', f.user_id);
   if (f.session_id) p.set('session_id', f.session_id);
   if (Number.isFinite(f.min_confidence) && f.min_confidence > 0) p.set('min_confidence', String(f.min_confidence));
   if (Number.isFinite(f.max_missing_face_ratio) && f.max_missing_face_ratio < 1) p.set('max_missing_face_ratio', String(f.max_missing_face_ratio));
   return p.toString();
}

function exportCsv(records, filters) {
   const headers = [
      'window_start', 'window_end', 'session_id', 'user_id', 'username', 'user_role',
      'student_name_snapshot', 'case_id', 'case_title_snapshot', 'case_category_snapshot',
      'dominant_expression_estimate', 'confidence', 'valence_estimate', 'arousal_estimate',
      'entropy', 'valid_frames', 'missing_face_ratio',
      'model_name', 'model_version', 'capture_mode', 'capture_status',
      'consent_version', 'consent_recorded_at',
   ];
   const rows = records.map(r => [
      r.window_start, r.window_end, r.session_id, r.user_id ?? '', r.username ?? '', r.user_role ?? '',
      r.student_name_snapshot ?? '', r.case_id ?? '', r.case_title_snapshot ?? '', r.case_category_snapshot ?? '',
      r.dominant_emotion ?? '', r.confidence ?? '', r.valence ?? '', r.arousal ?? '',
      r.entropy ?? '', r.valid_frames ?? '', r.missing_face_ratio ?? '',
      r.model_name ?? '', r.model_version ?? '', r.capture_mode ?? '', r.capture_status ?? '',
      r.consent_version ?? '', r.consent_recorded_at ?? '',
   ].map(csvCell));
   const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
   download(csv, fileNameFor('learning-analytics', filters, 'csv'), 'text/csv');
}

function exportJson(records, filters) {
   const payload = {
      exported_at: new Date().toISOString(),
      filters,
      windows: records,
      _note: 'Values are model estimates of facial expression; not direct measures of feelings.',
   };
   download(JSON.stringify(payload, null, 2), fileNameFor('learning-analytics', filters, 'json'), 'application/json');
}

function csvCell(v) {
   if (v == null) return '';
   const s = String(v);
   if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
   return s;
}

function fileNameFor(base, filters, ext) {
   const date = new Date().toISOString().split('T')[0];
   const scope = [
      filters.session_id && `s${filters.session_id}`,
      filters.case_id && `c${filters.case_id}`,
      filters.user_id && `u${filters.user_id}`,
   ].filter(Boolean).join('-') || 'all';
   return `${base}-${scope}-${date}.${ext}`;
}

function download(text, filename, mime) {
   const blob = new Blob([text], { type: mime });
   const url = URL.createObjectURL(blob);
   const a = document.createElement('a');
   a.href = url;
   a.download = filename;
   document.body.appendChild(a);
   a.click();
   a.remove();
   URL.revokeObjectURL(url);
}
