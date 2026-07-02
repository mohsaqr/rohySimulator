// MomentsTable — the Clinical Moments log.
//
// Each row is a "clinical moment": a learning_events row already enriched
// SERVER-SIDE (GET /api/learning-events/moments) with the emotion / valence /
// arousal / focus / gaze_target of the Oyon sensing window covering its
// timestamp, organized per case → per attempt (session). Enrichment fields
// are null when capture was off for that moment — shown as an em dash, never
// a fabricated value. Gaze is the aggregate AOI/zone label only.
//
// Mounts the unified LogGrid under the shared FilterBar; this file is the
// column config + fetch + filter wiring + client-side CSV export.
//
// Filtering model:
//   - Student / Case / Attempt / date range are /learning-events/moments
//     query params (user_id, case_id, session_id, from, to) → refetch.
//     Non-reviewers are pinned to self server-side, so the Student filter
//     is only shown to reviewer/educator/admin.
//   - Room / Verb / Emotion / Looking-at filter CLIENT-SIDE over the loaded
//     rows.
//   - The CSV export serializes the FILTERED view (server params already
//     applied by the fetch, client-side selects applied here).

import { useEffect, useMemo, useState, useCallback } from 'react';
import { apiFetch, ApiError } from '../../services/apiClient';
import { Download } from 'lucide-react';
import LogGrid, { CopyableCell } from './LogGrid';
import FilterBar, {
    applyClientFilters,
    contextualOptions,
    deriveOptions,
    deriveSessionOptions,
    uniqueValues,
    useOptionMemory,
} from './FilterBar';
import { buildCsv, downloadCsv } from './csvExport';
import { emotionColor, signed, fix2 } from '../oyon/emotionLogShared';
import { useAuth } from '../../contexts/AuthContext';

const DEFAULT_LIMIT = 1000;

function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

// Compact vitals summary: HR/SpO2/BP/rhythm in one cell. Only the fields
// present on the event are shown; an event with no vitals renders a dash.
function vitalsSummary(row) {
    const parts = [];
    if (row.vital_hr != null) parts.push(`HR ${Math.round(row.vital_hr)}`);
    if (row.vital_spo2 != null) parts.push(`SpO₂ ${Math.round(row.vital_spo2)}`);
    if (row.vital_bp_sys != null && row.vital_bp_dia != null) {
        parts.push(`BP ${Math.round(row.vital_bp_sys)}/${Math.round(row.vital_bp_dia)}`);
    }
    if (row.vital_rhythm) parts.push(row.vital_rhythm);
    return parts.length ? parts.join(' · ') : null;
}

// "verb + object_name" composed readably, e.g. "VIEWED — ECG".
function actionLabel(row) {
    const verb = row.verb || '';
    const object = row.object_name || '';
    if (verb && object) return `${verb} — ${object}`;
    return verb || object || null;
}

// Chat-turn role chip colors — same palette as ChatLogTable.
const ROLE_COLOR = {
    user:      'bg-emerald-900/40 text-emerald-300',
    assistant: 'bg-blue-900/40 text-blue-300',
    system:    'bg-neutral-700 text-neutral-300',
};

const COLUMNS = [
    {
        accessorKey: 'timestamp',
        header: 'time',
        size: 165,
        cell: (info) => (
            <CopyableCell value={info.getValue()} className="font-mono text-neutral-400 whitespace-nowrap">
                {fmtTime(info.getValue())}
            </CopyableCell>
        ),
    },
    {
        accessorKey: 'case_title',
        header: 'case',
        size: 150,
        cell: (info) => (
            <span title={`case id ${info.row.original.case_id ?? '—'}`}>
                <CopyableCell value={info.getValue()} className="text-neutral-300" />
            </span>
        ),
    },
    {
        id: 'attempt_session',
        accessorFn: (row) => row.attempt != null ? `#${row.attempt} (s${row.session_id})` : (row.session_id != null ? `s${row.session_id}` : null),
        header: 'attempt',
        size: 90,
        cell: (info) => <CopyableCell value={info.getValue()} className="font-mono text-neutral-400" />,
    },
    {
        accessorKey: 'student_name',
        header: 'student',
        size: 110,
        cell: (info) => (
            <span title={`user id ${info.row.original.user_id ?? '—'}`}>
                <CopyableCell value={info.getValue()} className="text-neutral-200" />
            </span>
        ),
    },
    {
        accessorKey: 'room',
        header: 'room',
        size: 100,
        meta: { filterOptions: (rows) => uniqueValues(rows, (r) => r.room) },
        cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-400" />,
    },
    {
        id: 'action',
        accessorFn: (row) => actionLabel(row),
        header: 'action',
        size: 240,
        cell: (info) => {
            const v = info.getValue();
            return (
                <div className="truncate max-w-[240px]" title={v ?? ''}>
                    <span className="px-1.5 py-0.5 bg-blue-900/40 text-blue-300 rounded font-medium text-[11px]">
                        {v || '—'}
                    </span>
                </div>
            );
        },
    },
    {
        id: 'vitals',
        accessorFn: (row) => vitalsSummary(row),
        header: 'vitals',
        size: 210,
        cell: (info) => (
            <span className="font-mono text-neutral-300 whitespace-nowrap">{info.getValue() ?? '—'}</span>
        ),
    },
    {
        accessorKey: 'emotion',
        header: 'emotion',
        size: 90,
        meta: { filterOptions: (rows) => uniqueValues(rows, (r) => r.emotion) },
        cell: (info) => {
            const v = info.getValue();
            if (!v) return <span className="text-neutral-600">—</span>;
            return (
                <span
                    className="px-1.5 py-0.5 rounded font-medium text-[11px] text-neutral-900"
                    style={{ background: emotionColor(v) }}
                >
                    {v}
                </span>
            );
        },
    },
    {
        accessorKey: 'valence',
        header: 'valence',
        size: 75,
        cell: (info) => {
            const v = info.getValue();
            if (v == null) return <span className="text-neutral-600">—</span>;
            return (
                <span className="font-mono" style={{ color: v >= 0 ? '#34d399' : '#f87171' }}>
                    {signed(v)}
                </span>
            );
        },
    },
    {
        accessorKey: 'gaze_target',
        header: 'looking at',
        size: 100,
        meta: { filterOptions: (rows) => uniqueValues(rows, (r) => r.gaze_target) },
        cell: (info) => {
            const v = info.getValue();
            if (!v) return <span className="text-neutral-600">—</span>;
            return <CopyableCell value={v} className="text-neutral-200" />;
        },
    },
    {
        accessorKey: 'focus',
        header: 'focus',
        size: 65,
        cell: (info) => {
            const v = info.getValue();
            if (v == null) return <span className="text-neutral-600">—</span>;
            return <span className="font-mono text-neutral-300">{fix2(v)}</span>;
        },
    },
    // Extra context columns, hidden by default (toggle via the column chooser).
    { accessorKey: 'arousal', header: 'arousal', size: 70,
      cell: (info) => {
          const v = info.getValue();
          return v == null
              ? <span className="text-neutral-600">—</span>
              : <span className="font-mono text-neutral-300">{fix2(v)}</span>;
      } },
    { accessorKey: 'component', header: 'component', size: 130,
      meta: { filterOptions: (rows) => uniqueValues(rows, (r) => r.component) },
      cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-400" /> },
    { accessorKey: 'category', header: 'category', size: 110,
      meta: { filterOptions: (rows) => uniqueValues(rows, (r) => r.category) },
      cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-400" /> },
    { accessorKey: 'severity', header: 'severity', size: 80,
      meta: { filterOptions: (rows) => uniqueValues(rows, (r) => r.severity) },
      cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-400" /> },
    // Chat turns (source: 'chat', from the interactions table) carry
    // message_role + message_content — shown by default so per-turn chat
    // reads inline with the clinical actions around it.
    { accessorKey: 'message_role', header: 'role', size: 75,
      meta: { filterOptions: (rows) => uniqueValues(rows, (r) => r.message_role) },
      cell: (info) => {
          const v = info.getValue();
          if (!v) return <span className="text-neutral-600">—</span>;
          const cls = ROLE_COLOR[v] || 'bg-neutral-700 text-neutral-300';
          return <span className={`px-1.5 py-0.5 rounded font-medium text-[11px] ${cls}`}>{v}</span>;
      } },
    { accessorKey: 'message_content', header: 'message', size: 280,
      cell: (info) => {
          const v = info.getValue();
          if (!v) return <span className="text-neutral-600">—</span>;
          return (
              <div className="truncate max-w-[280px]" title={v ?? ''}>
                  <CopyableCell value={v} className="text-neutral-200" />
              </div>
          );
      } },
];

const INITIAL_HIDDEN = {
    arousal: false,
    component: false,
    category: false,
    severity: false,
};

// CSV column order for the client-side export — the full response row,
// not just the visible columns, so the export is analysis-ready.
const CSV_FIELDS = [
    'id', 'source', 'timestamp', 'case_id', 'case_title', 'session_id', 'attempt',
    'user_id', 'student_name', 'room', 'verb', 'object_type', 'object_name',
    'component', 'severity', 'category', 'message_content', 'message_role',
    'result', 'duration_ms',
    'vital_hr', 'vital_spo2', 'vital_bp_sys', 'vital_bp_dia',
    'vital_rr', 'vital_temp', 'vital_etco2', 'vital_rhythm',
    'emotion', 'valence', 'arousal', 'focus', 'gaze_target',
];

const EMPTY_FILTERS = {
    user_id: '', case_id: '', session_id: '',
    room: '', verb: '', emotion: '', gaze_target: '',
    from: '', to: '',
};

// Client-side equality filters. Student / case / attempt / dates are
// SERVER params (see load()), so they're not in this map.
const CLIENT_ACCESSORS = {
    room: (r) => r.room,
    verb: (r) => r.verb,
    emotion: (r) => r.emotion,
    gaze_target: (r) => r.gaze_target,
};

export default function MomentsTable() {
    const { user } = useAuth();
    const canReview = ['reviewer', 'educator', 'admin'].includes(user?.role);
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [limit, setLimit] = useState(DEFAULT_LIMIT);
    const [filters, setFilters] = useState(EMPTY_FILTERS);

    // Server-side params (the endpoint pins non-reviewers to self; sending
    // user_id anyway would be ignored for them, but we never offer it).
    const serverQuery = useMemo(() => {
        const params = new URLSearchParams();
        if (canReview && filters.user_id) params.append('user_id', filters.user_id);
        if (filters.case_id) params.append('case_id', filters.case_id);
        if (filters.session_id) params.append('session_id', filters.session_id);
        if (filters.from) params.append('from', filters.from);
        if (filters.to) params.append('to', filters.to);
        return params.toString();
    }, [canReview, filters.user_id, filters.case_id, filters.session_id, filters.from, filters.to]);

    const load = useCallback(async (nextLimit = limit) => {
        setLoading(true);
        try {
            const qs = serverQuery ? `${serverQuery}&` : '';
            const data = await apiFetch(`/learning-events/moments?${qs}limit=${nextLimit}`);
            setRows(data?.moments || []);
            setError(null);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : err.message);
        } finally {
            setLoading(false);
        }
    }, [limit, serverQuery]);

    useEffect(() => { load(); }, [load]);

    const loadMore = useCallback((newLimit) => {
        setLimit(newLimit);
        load(newLimit);
    }, [load]);

    const setFilter = useCallback((key, value) => {
        setFilters((prev) => {
            const next = { ...prev, [key]: value ?? '' };
            // A different student / case invalidates the attempt selection.
            if (key === 'user_id' || key === 'case_id') next.session_id = '';
            return next;
        });
    }, []);
    const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

    // View = server-filtered rows further narrowed by the client-side selects.
    const filteredRows = useMemo(
        () => applyClientFilters(rows, CLIENT_ACCESSORS, filters),
        [rows, filters],
    );

    // Identity options are remembered across refetches: student / case /
    // attempt are server params, so once one is picked the loaded rows
    // alone would only ever offer that one choice back.
    const studentOptions = useOptionMemory(useMemo(
        () => deriveOptions(rows, (r) => r.user_id, (r) => r.student_name || `#${r.user_id}`),
        [rows],
    ));
    const caseOptions = useOptionMemory(useMemo(
        () => deriveOptions(rows, (r) => r.case_id, (r) => r.case_title || `#${r.case_id}`),
        [rows],
    ));
    const sessionOptions = useOptionMemory(useMemo(
        () => deriveSessionOptions(rows, {
            id: (r) => r.session_id,
            ts: (r) => r.timestamp,
            attempt: (r) => r.attempt,
            caseName: (r) => r.case_title,
        }),
        [rows],
    ));

    const filterDefs = useMemo(() => {
        const defs = [];
        if (canReview) defs.push({ key: 'user_id', label: 'Student', options: studentOptions });
        defs.push(
            { key: 'case_id', label: 'Case', options: caseOptions },
            { key: 'session_id', label: 'Attempt', width: 'w-56', options: sessionOptions },
            { key: 'room', label: 'Room', width: 'w-32',
              options: contextualOptions(rows, CLIENT_ACCESSORS, filters, 'room') },
            { key: 'verb', label: 'Verb', width: 'w-36',
              options: contextualOptions(rows, CLIENT_ACCESSORS, filters, 'verb') },
            { key: 'emotion', label: 'Emotion', width: 'w-32',
              options: contextualOptions(rows, CLIENT_ACCESSORS, filters, 'emotion') },
            { key: 'gaze_target', label: 'Looking at', width: 'w-32',
              options: contextualOptions(rows, CLIENT_ACCESSORS, filters, 'gaze_target') },
        );
        return defs;
    }, [canReview, rows, filters, studentOptions, caseOptions, sessionOptions]);

    const exportCsv = useCallback(() => {
        downloadCsv(
            buildCsv(filteredRows, CSV_FIELDS),
            `clinical-moments_${new Date().toISOString().slice(0, 10)}.csv`,
        );
    }, [filteredRows]);

    const headerActions = (
        <button
            onClick={exportCsv}
            disabled={filteredRows.length === 0}
            className="px-2 py-1.5 bg-cyan-700 hover:bg-cyan-600 rounded text-xs text-white flex items-center gap-1 disabled:opacity-50"
            title="Download the filtered moments as CSV (all fields)"
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
                data={filteredRows}
                loading={loading}
                error={error}
                onRefresh={() => load()}
                onLoadMore={loadMore}
                currentLimit={limit}
                initialSorting={[{ id: 'timestamp', desc: true }]}
                initialColumnVisibility={INITIAL_HIDDEN}
                headerActions={headerActions}
                emptyMessage="No clinical moments yet. Student actions and chat turns appear here, enriched with the sensing window covering each one."
                storageKey="loggrid.moments.v2"
            />
        </div>
    );
}
