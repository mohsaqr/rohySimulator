import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { apiFetch } from '../../services/apiClient';
import OyonServerDashboards from './OyonServerDashboards';

/*
 * The named "Oyon" dashboard — a first-class full-page surface for educators
 * and admins, distinct from the Emotion Analytics route.
 *
 * The difference matters. Emotion Analytics is Rohy's OWN dashboard
 * (TnaDashboard preset to the emotion source, with Rohy-authored Attention /
 * Affect / Gaze tabs). This surface renders OYON's own Analyze dashboards, via
 * OyonServerDashboards → <oyon-app chrome="none" page="/analyze">. Two
 * consequences:
 *
 *   - Nothing here duplicates or replaces an existing Rohy tab. This is
 *     additive: a new surface beside the existing ones.
 *   - As new modalities start producing data, the upstream dashboards for them
 *     appear here without Rohy authoring a view per signal. The engine owns its
 *     own presentation; Rohy owns authorization and the data feed.
 *
 * Authorization stays entirely server-side: this component only calls Rohy's
 * API (educator+ scoped by assertOyonReadAccess), and hands the resulting rows
 * to the element via setWindows(). The element never talks to the API itself.
 */

const PAGE = 200;
const CAP = 1000;

export default function OyonDashboardRoom({ onClose }) {
   const { t } = useTranslation('oyon');
   const [records, setRecords] = useState(null);
   const [modalities, setModalities] = useState([]);
   const [truncated, setTruncated] = useState(false);
   const [loading, setLoading] = useState(true);
   const [error, setError] = useState(null);

   // Emotion windows: the pool Oyon's Analyze dashboards consume. Paginated and
   // capped, mirroring TnaDashboardV2's fetch so both surfaces put the same
   // ceiling on a large tenant.
   // Mount-only, so the initial `loading: true` / `error: null` state already
   // describes the pre-fetch condition — no synchronous setState needed here.
   useEffect(() => {
      let cancelled = false;
      (async () => {
         try {
            const all = [];
            let offset = 0;
            let total = Infinity;
            while (offset < total && all.length < CAP) {
               const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
               const d = await apiFetch(`/addons/oyon/emotion-records?${params}`);
               const rows = d?.records || [];
               all.push(...rows);
               total = Number.isFinite(d?.total) ? d.total : all.length;
               if (rows.length < PAGE) break;
               offset += PAGE;
            }
            if (!cancelled) {
               setRecords(all);
               setTruncated(all.length >= CAP && total > all.length);
            }
         } catch (err) {
            if (!cancelled) setError(err?.message || String(err));
         } finally {
            if (!cancelled) setLoading(false);
         }
      })();
      return () => { cancelled = true; };
   }, []);

   // Which modality-scoped signals this tenant actually has (migration 0039).
   // Advisory only — a failure here must not blank the dashboard, so it never
   // touches `error`.
   useEffect(() => {
      let cancelled = false;
      apiFetch('/addons/oyon/signal-windows?limit=1')
         .then((d) => { if (!cancelled) setModalities(d?.modalities || []); })
         .catch(() => { /* advisory chips only */ });
      return () => { cancelled = true; };
   }, []);

   const totalSignals = useMemo(
      () => modalities.reduce((sum, m) => sum + (Number(m.count) || 0), 0),
      [modalities]
   );

   // The embedded viewer renders ONE session at a time — it forces the
   // current-session scope as a privacy boundary and shows nothing without a
   // pin. So the cross-session pool we fetched has to become a chooser, and
   // the element gets exactly one session's windows.
   const sessions = useMemo(() => {
      const byId = new Map();
      for (const r of records || []) {
         const id = r?.session_id == null ? null : String(r.session_id);
         if (!id) continue;
         const prev = byId.get(id);
         const end = r.window_end || '';
         if (prev) {
            prev.count += 1;
            if (end > prev.lastSeen) prev.lastSeen = end;
         } else {
            byId.set(id, { id, count: 1, lastSeen: end, who: r.username || r.student_name_snapshot || null });
         }
      }
      return [...byId.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
   }, [records]);

   // Default to the most recent session once the fetch lands. Derived from the
   // list rather than stored on its own, so it can never point at a session
   // that fell out of the current pool.
   const [pickedSession, setPickedSession] = useState(null);
   const activeSession = useMemo(
      () => (sessions.some(s => s.id === pickedSession) ? pickedSession : sessions[0]?.id || null),
      [sessions, pickedSession]
   );

   const sessionRecords = useMemo(
      () => (activeSession ? (records || []).filter(r => String(r.session_id) === activeSession) : []),
      [records, activeSession]
   );

   return (
      <div className="h-screen w-screen overflow-hidden flex flex-col bg-slate-950">
         <header className="flex items-center gap-3 px-4 py-2 border-b border-slate-800 shrink-0">
            <h1 className="text-sm font-semibold text-slate-100">{t('dashboard')}</h1>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
            {records && (
               <span className="text-xs text-slate-400">
                  {t('dashboard_window_count', { count: records.length })}
                  {truncated ? ` · ${t('dashboard_truncated')}` : ''}
               </span>
            )}
            {sessions.length > 0 && (
               <label className="flex items-center gap-1.5 text-xs text-slate-400">
                  {t('dashboard_session')}
                  <select
                     value={activeSession || ''}
                     onChange={(e) => setPickedSession(e.target.value)}
                     className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200 max-w-[22rem]"
                  >
                     {sessions.map(s => (
                        <option key={s.id} value={s.id}>
                           {(s.who ? `${s.who} · ` : '') + `${s.id} · ${s.count}`}
                        </option>
                     ))}
                  </select>
               </label>
            )}
            {totalSignals > 0 && (
               <span className="flex items-center gap-1 flex-wrap">
                  {modalities.map(m => (
                     <span
                        key={m.modality}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300"
                     >
                        {m.modality} · {m.count}
                     </span>
                  ))}
               </span>
            )}
            <button
               type="button"
               onClick={onClose}
               className="ml-auto p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100"
               aria-label={t('common:close')}
            >
               <X className="w-4 h-4" />
            </button>
         </header>

         {error ? (
            <div className="m-4 rounded-md border border-red-500/30 bg-red-950/40 px-3 py-3 text-sm text-red-200">
               <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {t('dashboard_load_failed')}
               </div>
               <div className="mt-1 text-red-300/80">{error}</div>
            </div>
         ) : (
            <div className="flex-1 min-h-0">
               <OyonServerDashboards
                  records={sessionRecords}
                  loading={loading}
                  sessionId={activeSession}
               />
            </div>
         )}
      </div>
   );
}
