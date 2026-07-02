// OyonDataLogs — the Oyon raw-data console inside System Logs.
//
// The old Settings → "Emotion & Attention" tab carried both analysis views
// (now living in the top-level Analytics dashboard) and raw DATA tables.
// This component is the new home of the data tables: it fetches the
// tenant-scoped emotion-record windows from /addons/oyon/emotion-records
// (paginated, capped) and renders the three extracted presentational views
// (Windows / Students / Cases) over the same record pool.
//
// Filters here are SERVER params (session_id / case_id / user_id / from / to
// map 1:1 onto the endpoint's query string — see buildEmotionRecordsWhere in
// server/routes/oyon-routes.js), surfaced through the shared FilterBar so the
// tab looks and behaves like the other log surfaces around it. Option lists
// are derived from the loaded rows and remembered across refetches
// (useOptionMemory) — a server-side narrow would otherwise collapse each
// dropdown to the single selected choice.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LineChart, Users, Calendar, RefreshCw, AlertTriangle } from 'lucide-react';
import { apiFetch, ApiError } from '../../services/apiClient';
import FilterBar, {
    deriveOptions,
    deriveSessionOptions,
    useOptionMemory,
} from './FilterBar';
import OyonWindowsView from '../oyon/OyonWindowsView';
import OyonStudentsView from '../oyon/OyonStudentsView';
import OyonCasesView from '../oyon/OyonCasesView';

const PAGE_SIZE = 200;   // per-request limit (server default/max page)
const MAX_RECORDS = 1000; // client-side cap — beyond this we note truncation

const EMPTY_FILTERS = { session_id: '', case_id: '', user_id: '', from: '', to: '' };

const VIEWS = [
    { id: 'windows', label: 'Windows', icon: LineChart },
    { id: 'students', label: 'Students', icon: Users },
    { id: 'cases', label: 'Cases', icon: Calendar },
];

/** Query string for /addons/oyon/emotion-records from the active filters. */
function filtersToParams(filters) {
    const p = new URLSearchParams();
    if (filters.session_id) p.set('session_id', filters.session_id);
    if (filters.case_id) p.set('case_id', filters.case_id);
    if (filters.user_id) p.set('user_id', filters.user_id);
    if (filters.from) p.set('from', filters.from);
    if (filters.to) p.set('to', filters.to);
    return p;
}

export default function OyonDataLogs() {
    const [view, setView] = useState('windows');
    const [filters, setFilters] = useState(EMPTY_FILTERS);
    const [records, setRecords] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // Page through the endpoint (limit 200 per request) until every
            // matching window is loaded or the MAX_RECORDS cap is hit.
            const all = [];
            let grandTotal = 0;
            let offset = 0;
            for (;;) {
                const p = filtersToParams(filters);
                p.set('limit', String(PAGE_SIZE));
                p.set('offset', String(offset));
                const data = await apiFetch(`/addons/oyon/emotion-records?${p.toString()}`);
                const page = Array.isArray(data?.records) ? data.records : [];
                grandTotal = Number(data?.total) || page.length;
                all.push(...page);
                offset += PAGE_SIZE;
                if (!page.length || all.length >= Math.min(grandTotal, MAX_RECORDS)) break;
            }
            setRecords(all.slice(0, MAX_RECORDS));
            setTotal(grandTotal);
        } catch (e) {
            if (e instanceof ApiError && e.status === 403) {
                setError({ kind: 'forbidden' });
            } else if (e instanceof ApiError && (e.code === 'OYON_DISABLED' || e.code === 'OYON_IMPORT_FAILED')) {
                // Structured 503 stub — surface the operator-actionable
                // message from the body, not a bare error dump.
                setError({ kind: 'serverDisabled', code: e.code, message: e.message });
            } else {
                setError({ kind: 'generic', message: e?.message || 'Could not load Oyon records' });
            }
            setRecords([]);
            setTotal(0);
        } finally {
            setLoading(false);
        }
    }, [filters]);

    useEffect(() => { load(); }, [load]);

    const setFilter = useCallback((key, value) => {
        setFilters((prev) => {
            const next = { ...prev, [key]: value ?? '' };
            // A different user / case invalidates the session selection.
            if (key === 'user_id' || key === 'case_id') next.session_id = '';
            return next;
        });
    }, []);
    const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

    // Every filter is a server param, so remember options across refetches —
    // otherwise picking one user/case/session collapses its own dropdown.
    const userOptions = useOptionMemory(useMemo(
        () => deriveOptions(records, (r) => r.user_id,
            (r) => r.username || r.student_name_snapshot || `#${r.user_id}`),
        [records],
    ));
    const caseOptions = useOptionMemory(useMemo(
        () => deriveOptions(records, (r) => r.case_id,
            (r) => r.case_title_snapshot || `case ${r.case_id}`),
        [records],
    ));
    const sessionOptions = useOptionMemory(useMemo(
        () => deriveSessionOptions(records, {
            id: (r) => r.session_id,
            ts: (r) => r.window_start,
            caseName: (r) => r.case_title_snapshot,
        }),
        [records],
    ));

    const filterDefs = useMemo(() => [
        { key: 'user_id', label: 'User', options: userOptions },
        { key: 'case_id', label: 'Case', options: caseOptions },
        { key: 'session_id', label: 'Session', width: 'w-56', options: sessionOptions },
    ], [userOptions, caseOptions, sessionOptions]);

    if (error?.kind === 'serverDisabled') {
        return <DisabledOnServer code={error.code} message={error.message} />;
    }
    if (error?.kind === 'forbidden') {
        return (
            <Notice icon>
                Oyon data is disabled for your role in this tenant. An admin can enable it
                in Settings → Oyon — Emotion Capture.
            </Notice>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <FilterBar
                filters={filterDefs}
                values={filters}
                onChange={setFilter}
                onClearAll={clearFilters}
            />

            <div className="p-3 space-y-3 overflow-auto">
                <div className="flex flex-wrap items-center gap-2">
                    {VIEWS.map((v) => {
                        const Icon = v.icon;
                        return (
                            <button
                                key={v.id}
                                onClick={() => setView(v.id)}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold border ${
                                    view === v.id
                                        ? 'bg-cyan-700 text-white border-cyan-500'
                                        : 'bg-gray-100 text-gray-800 border-gray-300 hover:bg-gray-100'
                                }`}
                            >
                                <Icon className="w-4 h-4" /> {v.label}
                            </button>
                        );
                    })}
                    <span className="text-xs text-gray-500 ml-2" data-testid="oyon-data-count">
                        {loading ? 'Loading…' : `${records.length} of ${total} window${total === 1 ? '' : 's'}`}
                    </span>
                    <button
                        onClick={load}
                        disabled={loading}
                        title="Refresh"
                        className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-300 text-gray-800 hover:bg-gray-100 disabled:opacity-50 text-sm"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>

                {total > MAX_RECORDS && (
                    <div className="rounded-md border border-amber-700/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
                        Showing the {MAX_RECORDS} most recent of {total} matching windows —
                        narrow the filters (user, case, session, dates) to see the rest.
                    </div>
                )}

                {error?.kind === 'generic' && (
                    <div className="rounded-md border border-red-500/30 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                        {error.message}
                    </div>
                )}

                {!loading && !error && records.length === 0 ? (
                    <Notice>No Oyon emotion-record windows match the current filters.</Notice>
                ) : (
                    <>
                        {view === 'windows' && <OyonWindowsView records={records} loading={loading} />}
                        {view === 'students' && <OyonStudentsView records={records} />}
                        {view === 'cases' && <OyonCasesView records={records} />}
                    </>
                )}
            </div>
        </div>
    );
}

function Notice({ icon = false, children }) {
    return (
        <div className="rounded-md border border-gray-200 bg-white p-6 text-center text-sm text-gray-600">
            {icon && <AlertTriangle className="w-5 h-5 mx-auto mb-2 text-amber-400" />}
            {children}
        </div>
    );
}

// Rendered when the server returns the OYON_DISABLED / OYON_IMPORT_FAILED
// stub. Shows the operator-actionable message from the 503 body so the fix
// is surfaced in the UI instead of buried in a server log.
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
                                ? 'Oyon data — module failed to load'
                                : 'Oyon data — disabled on this server'}
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
