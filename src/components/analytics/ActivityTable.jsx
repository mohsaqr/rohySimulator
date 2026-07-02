// ActivityTable — learning_events viewer.
//
// Columns: every field that the /api/export/learning-events CSV carries,
// so the in-app view and the export are the same shape. Mounts the unified
// LogGrid under the shared FilterBar; this file is the column config +
// fetch + filter wiring.
//
// Filtering model:
//   - The FilterBar filters (student / case / attempt / verb / category /
//     severity / date range) apply CLIENT-SIDE over the loaded rows — the
//     /learning-events/all endpoint only takes `limit`.
//   - The CSV export streams from /export/learning-events, which accepts
//     from/to/user_id/case_id/session_id/verb — those FilterBar values are
//     forwarded so the export matches the filtered view. Category and
//     severity aren't server params, so when either is active the export
//     falls back to a client-side CSV of exactly the filtered loaded rows.

import { useEffect, useMemo, useState, useCallback } from 'react';
import { apiFetch, ApiError } from '../../services/apiClient';
import { Download } from 'lucide-react';
import LogGrid, { CopyableCell } from './LogGrid';
import FilterBar, {
    applyClientFilters,
    contextualOptions,
    deriveSessionOptions,
    filterByDateRange,
    uniqueValues,
} from './FilterBar';
import { buildCsv, downloadCsv } from './csvExport';
import { useAuth } from '../../contexts/AuthContext';

const DEFAULT_LIMIT = 500;

function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

function fmtCtx(c) {
    if (c === null || c === undefined) return '';
    if (typeof c === 'string') return c;
    try { return JSON.stringify(c); } catch { return String(c); }
}

function num(v, decimals = 0) {
    if (v == null) return '—';
    const n = Number(v);
    if (Number.isNaN(n)) return '—';
    return decimals > 0 ? n.toFixed(decimals) : String(Math.round(n));
}

const COLUMNS = [
    {
        accessorKey: 'timestamp',
        header: 'when',
        size: 165,
        cell: (info) => (
            <CopyableCell value={info.getValue()} className="font-mono text-neutral-400 whitespace-nowrap">
                {fmtTime(info.getValue())}
            </CopyableCell>
        ),
    },
    {
        accessorKey: 'user_id',
        header: 'uid',
        size: 60,
        cell: (info) => (
            <CopyableCell value={info.getValue()} className="font-mono text-neutral-400" />
        ),
    },
    {
        accessorKey: 'username',
        header: 'user',
        size: 110,
        cell: (info) => (
            <span title={`user id ${info.row.original.user_id ?? '—'}`}>
                <CopyableCell value={info.getValue()} className="text-neutral-200" />
            </span>
        ),
    },
    {
        accessorKey: 'case_id',
        header: 'cid',
        size: 60,
        cell: (info) => (
            <CopyableCell value={info.getValue()} className="font-mono text-neutral-400" />
        ),
    },
    {
        accessorKey: 'case_name',
        header: 'case',
        size: 140,
        cell: (info) => (
            <span title={`case id ${info.row.original.case_id ?? '—'}`}>
                <CopyableCell value={info.getValue()} className="text-neutral-300" />
            </span>
        ),
    },
    {
        accessorKey: 'session_id',
        header: 'sess',
        size: 60,
        cell: (info) => (
            <CopyableCell value={info.getValue()} className="font-mono text-neutral-400" />
        ),
    },
    {
        accessorKey: 'verb',
        header: 'verb',
        size: 130,
        meta: { filterOptions: (rows) => uniqueValues(rows, (r) => r.verb) },
        cell: (info) => (
            <span className="px-1.5 py-0.5 bg-blue-900/40 text-blue-300 rounded font-medium text-[11px]">
                {info.getValue() || '—'}
            </span>
        ),
    },
    { accessorKey: 'object_type', header: 'object_type', size: 110,
      meta: { filterOptions: (rows) => uniqueValues(rows, (r) => r.object_type) },
      cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-300" /> },
    { accessorKey: 'object_id', header: 'object_id', size: 90,
      cell: (info) => <CopyableCell value={info.getValue()} className="font-mono text-neutral-400" /> },
    { accessorKey: 'object_name', header: 'object_name', size: 220,
      cell: (info) => (
        <div className="truncate max-w-[220px]" title={info.getValue() ?? ''}>
            <CopyableCell value={info.getValue()} className="text-neutral-200" />
        </div>
      ) },
    { accessorKey: 'component', header: 'component', size: 130,
      meta: { filterOptions: (rows) => uniqueValues(rows, (r) => r.component) },
      cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-300" /> },
    { accessorKey: 'parent_component', header: 'parent', size: 130,
      meta: { filterOptions: (rows) => uniqueValues(rows, (r) => r.parent_component) },
      cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-400" /> },
    { accessorKey: 'result', header: 'result', size: 180,
      cell: (info) => (
        <div className="truncate max-w-[180px]" title={info.getValue() ?? ''}>
            <CopyableCell value={info.getValue()} className="text-neutral-300" />
        </div>
      ) },
    { accessorKey: 'duration_ms', header: 'dur (ms)', size: 80,
      cell: (info) => <span className="font-mono text-neutral-400">{num(info.getValue())}</span> },
    { accessorKey: 'message_role', header: 'role', size: 80,
      meta: { filterOptions: (rows) => uniqueValues(rows, (r) => r.message_role) },
      cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-300" /> },
    { accessorKey: 'message_content', header: 'message', size: 320,
      cell: (info) => {
          const v = info.getValue();
          return (
              <div className="truncate max-w-[320px]" title={v ?? ''}>
                  <CopyableCell value={v} className="text-neutral-200" />
              </div>
          );
      } },
    { accessorKey: 'severity', header: 'severity', size: 80,
      meta: { filterOptions: (rows) => uniqueValues(rows, (r) => r.severity) },
      cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-400" /> },
    { accessorKey: 'category', header: 'category', size: 110,
      meta: { filterOptions: (rows) => uniqueValues(rows, (r) => r.category) },
      cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-400" /> },
    {
        id: 'context_json',
        accessorFn: (row) => fmtCtx(row.context),
        header: 'context',
        size: 220,
        cell: (info) => {
            const v = info.getValue();
            return (
                <div className="truncate max-w-[220px] font-mono text-neutral-400" title={v}>
                    {v || '—'}
                </div>
            );
        },
    },
    { accessorKey: 'vital_hr', header: 'HR', size: 50,
      cell: (info) => <span className="font-mono text-neutral-300">{num(info.getValue())}</span> },
    { accessorKey: 'vital_spo2', header: 'SpO₂', size: 60,
      cell: (info) => <span className="font-mono text-neutral-300">{num(info.getValue())}</span> },
    {
        id: 'bp',
        accessorFn: (row) => row.vital_bp_sys != null && row.vital_bp_dia != null
            ? `${Math.round(row.vital_bp_sys)}/${Math.round(row.vital_bp_dia)}`
            : null,
        header: 'BP',
        size: 80,
        cell: (info) => <span className="font-mono text-neutral-300">{info.getValue() ?? '—'}</span>,
    },
    { accessorKey: 'vital_rr', header: 'RR', size: 50,
      cell: (info) => <span className="font-mono text-neutral-300">{num(info.getValue())}</span> },
    { accessorKey: 'vital_temp', header: 'Temp', size: 60,
      cell: (info) => <span className="font-mono text-neutral-300">{num(info.getValue(), 1)}</span> },
    { accessorKey: 'vital_etco2', header: 'EtCO₂', size: 60,
      cell: (info) => <span className="font-mono text-neutral-300">{num(info.getValue())}</span> },
    { accessorKey: 'vital_rhythm', header: 'rhythm', size: 90,
      cell: (info) => <CopyableCell value={info.getValue()} className="font-mono text-neutral-400" /> },
];

// Vitals + the more verbose join columns are hidden by default — they
// pad the row but most users don't need them in the live view (they're
// still in the CSV). Raw id columns are hidden too: identity is shown as
// NAMES (user / case), with the id in the cell tooltip and available via
// the column chooser when someone really needs it.
const INITIAL_HIDDEN = {
    user_id: false,
    case_id: false,
    session_id: false,
    object_id: false,
    parent_component: false,
    severity: false,
    duration_ms: false,
    vital_etco2: false,
    vital_rhythm: false,
};

// Client-side CSV field order — the /learning-events/all row shape.
const CSV_FIELDS = [
    'id', 'timestamp', 'user_id', 'username', 'case_id', 'case_name',
    'session_id', 'verb', 'object_type', 'object_id', 'object_name',
    'component', 'parent_component', 'result', 'duration_ms',
    'message_role', 'message_content', 'severity', 'category', 'context',
    'vital_hr', 'vital_spo2', 'vital_bp_sys', 'vital_bp_dia',
    'vital_rr', 'vital_temp', 'vital_etco2', 'vital_rhythm',
];

const EMPTY_FILTERS = {
    user_id: '', case_id: '', session_id: '',
    verb: '', category: '', severity: '',
    from: '', to: '',
};

// FilterBar equality filters → row accessors (dates handled separately).
const FILTER_ACCESSORS = {
    user_id: (r) => r.user_id,
    case_id: (r) => r.case_id,
    session_id: (r) => r.session_id,
    verb: (r) => r.verb,
    category: (r) => r.category,
    severity: (r) => r.severity,
};

export default function ActivityTable({ sessionId = null }) {
    const { user } = useAuth();
    const canReview = ['reviewer', 'educator', 'admin'].includes(user?.role);
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filters, setFilters] = useState(EMPTY_FILTERS);

    const path = sessionId
        ? `/learning-events/session/${sessionId}`
        : `/learning-events/all?limit=${DEFAULT_LIMIT}`;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await apiFetch(path);
            setEvents(data?.events || []);
            setError(null);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : err.message);
        } finally {
            setLoading(false);
        }
    }, [path]);

    useEffect(() => { load(); }, [load]);

    const setFilter = useCallback((key, value) => {
        setFilters((prev) => {
            const next = { ...prev, [key]: value ?? '' };
            // A different student / case invalidates the attempt selection.
            if (key === 'user_id' || key === 'case_id') next.session_id = '';
            return next;
        });
    }, []);
    const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

    // View = loaded rows narrowed by every active FilterBar value.
    const filteredEvents = useMemo(
        () => filterByDateRange(
            applyClientFilters(events, FILTER_ACCESSORS, filters),
            (r) => r.timestamp, filters,
        ),
        [events, filters],
    );

    // Options come from the rows matching the OTHER active filters, so each
    // dropdown narrows contextually and shows live counts.
    const dated = useMemo(
        () => filterByDateRange(events, (r) => r.timestamp, filters),
        [events, filters],
    );
    const filterDefs = useMemo(() => {
        const defs = [];
        if (canReview) {
            defs.push({
                key: 'user_id', label: 'Student',
                options: contextualOptions(dated, FILTER_ACCESSORS, filters, 'user_id',
                    (r) => r.username || `#${r.user_id}`),
            });
        }
        defs.push({
            key: 'case_id', label: 'Case',
            options: contextualOptions(dated, FILTER_ACCESSORS, filters, 'case_id',
                (r) => r.case_name || `#${r.case_id}`),
        });
        if (!sessionId) {
            const others = { user_id: FILTER_ACCESSORS.user_id, case_id: FILTER_ACCESSORS.case_id };
            defs.push({
                key: 'session_id', label: 'Attempt', width: 'w-56',
                options: deriveSessionOptions(
                    applyClientFilters(dated, others, filters),
                    { id: (r) => r.session_id, ts: (r) => r.timestamp, caseName: (r) => r.case_name },
                ),
            });
        }
        defs.push(
            { key: 'verb', label: 'Verb',
              options: contextualOptions(dated, FILTER_ACCESSORS, filters, 'verb') },
            { key: 'category', label: 'Category', width: 'w-36',
              options: contextualOptions(dated, FILTER_ACCESSORS, filters, 'category') },
            { key: 'severity', label: 'Severity', width: 'w-32',
              options: contextualOptions(dated, FILTER_ACCESSORS, filters, 'severity') },
        );
        return defs;
    }, [dated, filters, canReview, sessionId]);

    const exportCsv = useCallback(async () => {
        // Category / severity aren't /export/learning-events params — when
        // either is active, export exactly the filtered loaded view instead
        // of a server stream that couldn't honor them.
        if (filters.category || filters.severity) {
            downloadCsv(
                buildCsv(filteredEvents.map((r) => ({ ...r, context: fmtCtx(r.context) })), CSV_FIELDS),
                `learning-events_${new Date().toISOString().slice(0, 10)}.csv`,
            );
            return;
        }
        try {
            const params = new URLSearchParams();
            if (filters.from) params.append('from', filters.from);
            if (filters.to) params.append('to', filters.to);
            if (filters.user_id) params.append('user_id', filters.user_id);
            if (filters.case_id) params.append('case_id', filters.case_id);
            if (filters.verb) params.append('verb', filters.verb);
            const sid = sessionId ?? filters.session_id;
            if (sid) params.append('session_id', String(sid));
            const qs = params.toString() ? `?${params.toString()}` : '';
            const blob = await apiFetch(`/export/learning-events${qs}`, { parseAs: 'blob' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `learning-events_${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            const hint = err?.body?.hint || err?.body?.error;
            setError(hint || (err instanceof ApiError ? err.message : err.message));
        }
    }, [filters, sessionId, filteredEvents]);

    const headerActions = (
        <button
            onClick={exportCsv}
            className="px-2 py-1.5 bg-cyan-700 hover:bg-cyan-600 rounded text-xs text-white flex items-center gap-1"
            title="Download xAPI CSV (honors the active filters)"
        >
            <Download className="w-3 h-3" /> CSV
        </button>
    );

    return (
        <div className="flex flex-col h-full">
            <FilterBar
                filters={filterDefs}
                values={filters}
                onChange={setFilter}
                onClearAll={clearFilters}
            />
            <LogGrid
                columns={COLUMNS}
                data={filteredEvents}
                loading={loading}
                error={error}
                onRefresh={load}
                initialSorting={[{ id: 'timestamp', desc: true }]}
                initialColumnVisibility={INITIAL_HIDDEN}
                headerActions={headerActions}
                emptyMessage="No activity recorded yet. Student actions appear here as they happen."
                storageKey="loggrid.activity"
            />
        </div>
    );
}
