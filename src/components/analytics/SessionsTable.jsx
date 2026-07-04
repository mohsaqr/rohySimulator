// SessionsTable — admin sessions list mounted on the unified LogGrid.
//
// Replaces the inline <table> that used to live in ConfigPanel.
// Reads from /api/analytics/sessions which the existing dashboard already
// uses (no query params — the server scopes rows by role). All FilterBar
// filters (student / case / date range) therefore apply CLIENT-SIDE over
// the loaded rows. Click a row's download button to get the per-session
// bundle CSV (/api/export/complete-session/:id).

import { useEffect, useMemo, useState, useCallback } from 'react';
import { apiFetch, ApiError } from '../../services/apiClient';
import { Download } from 'lucide-react';
import LogGrid, { CopyableCell } from './LogGrid';
import FilterBar, {
    applyClientFilters,
    contextualOptions,
    filterByDateRange,
} from './FilterBar';
import { useAuth } from '../../contexts/AuthContext';

function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

function fmtDuration(seconds) {
    if (seconds == null) return null;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
}

const COLUMNS = [
    { accessorKey: 'id', header: 'id', size: 70,
      cell: (info) => <CopyableCell value={info.getValue()} className="font-mono text-neutral-400">#{info.getValue()}</CopyableCell> },
    { accessorKey: 'username', header: 'user', size: 130,
      cell: (info) => {
          const v = info.getValue() || info.row.original.student_name;
          return (
              <span title={`user id ${info.row.original.user_id ?? '—'}`}>
                  <CopyableCell value={v} className="text-neutral-200 font-medium" />
              </span>
          );
      } },
    { accessorKey: 'case_name', header: 'case', size: 200,
      cell: (info) => (
          <span title={`case id ${info.row.original.case_id ?? '—'}`}>
              <CopyableCell value={info.getValue()} className="text-neutral-300" />
          </span>
      ) },
    { accessorKey: 'course_names', header: 'course', size: 180,
      cell: (info) => (
          <div className="truncate max-w-[180px]" title={info.getValue() ?? ''}>
              <CopyableCell value={info.getValue()} className="text-neutral-300" />
          </div>
      ) },
    { accessorKey: 'start_time', header: 'started', size: 165,
      cell: (info) => <CopyableCell value={info.getValue()} className="font-mono text-neutral-400 whitespace-nowrap">{fmtTime(info.getValue())}</CopyableCell> },
    {
        id: 'duration',
        accessorFn: (row) => row.duration ?? null,
        header: 'duration',
        size: 90,
        cell: (info) => {
            const v = info.getValue();
            if (v == null) return <span className="text-yellow-400 text-[11px]">in progress</span>;
            return <span className="font-mono text-neutral-300">{fmtDuration(v)}</span>;
        },
    },
    {
        id: 'status',
        accessorFn: (row) => row.end_time ? 'completed' : 'active',
        header: 'status',
        size: 100,
        cell: (info) => {
            const v = info.getValue();
            const cls = v === 'completed'
                ? 'bg-green-900/50 text-green-200'
                : 'bg-yellow-900/50 text-yellow-200';
            return <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${cls}`}>{v}</span>;
        },
        meta: { filterOptions: ['active', 'completed'] },
    },
    {
        id: 'export',
        header: '',
        size: 60,
        enableSorting: false,
        meta: { filterable: false },
        cell: (info) => {
            const id = info.row.original.id;
            return (
                <button
                    onClick={async (e) => {
                        e.stopPropagation();
                        try {
                            const blob = await apiFetch(`/export/complete-session/${id}`, { parseAs: 'blob' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `session-${id}_${new Date().toISOString().slice(0, 10)}.csv`;
                            a.click();
                            URL.revokeObjectURL(url);
                        } catch { /* swallowed — toast handled at higher layer if needed */ }
                    }}
                    className="px-1.5 py-0.5 bg-neutral-700 hover:bg-cyan-700 rounded text-[11px] text-neutral-300 hover:text-white inline-flex items-center gap-1"
                    title="Download per-session CSV bundle"
                >
                    <Download className="w-3 h-3" />
                </button>
            );
        },
    },
];

const EMPTY_FILTERS = { user_id: '', course_id: '', case_id: '', from: '', to: '' };

const FILTER_ACCESSORS = {
    user_id: (r) => r.user_id,
    course_id: (r) => csvList(r.course_ids),
    case_id: (r) => r.case_id,
};

function csvList(value) {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined || value === '') return [];
    return String(value).split(',').map((v) => v.trim()).filter(Boolean);
}

function courseLabel(row, value) {
    const ids = csvList(row.course_ids);
    const names = csvList(row.course_names);
    const idx = ids.indexOf(String(value));
    return names[idx] || `Course #${value}`;
}

export default function SessionsTable() {
    const { user } = useAuth();
    const canReview = ['reviewer', 'educator', 'admin'].includes(user?.role);
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filters, setFilters] = useState(EMPTY_FILTERS);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            // /analytics/sessions is what the legacy ConfigPanel sessions tab
            // used. Returns { sessions: [...] } with username, case_name,
            // start_time, end_time, duration already joined.
            const data = await apiFetch('/analytics/sessions', { cache: 'no-store' });
            setRows(data?.sessions || []);
            setError(null);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const setFilter = useCallback((key, value) => {
        setFilters((prev) => ({ ...prev, [key]: value ?? '' }));
    }, []);
    const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

    const filteredRows = useMemo(
        () => filterByDateRange(
            applyClientFilters(rows, FILTER_ACCESSORS, filters),
            (r) => r.start_time, filters,
        ),
        [rows, filters],
    );

    const dated = useMemo(
        () => filterByDateRange(rows, (r) => r.start_time, filters),
        [rows, filters],
    );
    const filterDefs = useMemo(() => {
        const defs = [];
        if (canReview) {
            defs.push({
                key: 'course_id', label: 'Course', width: 'w-52',
                options: contextualOptions(dated, FILTER_ACCESSORS, filters, 'course_id', courseLabel),
            });
            defs.push({
                key: 'user_id', label: 'Student',
                options: contextualOptions(dated, FILTER_ACCESSORS, filters, 'user_id',
                    (r) => r.username || r.student_name || `#${r.user_id}`),
            });
        }
        defs.push({
            key: 'case_id', label: 'Case', width: 'w-56',
            options: contextualOptions(dated, FILTER_ACCESSORS, filters, 'case_id',
                (r) => r.case_name || `#${r.case_id}`),
        });
        return defs;
    }, [dated, filters, canReview]);

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
                onRefresh={load}
                initialSorting={[{ id: 'start_time', desc: true }]}
                emptyMessage="No sessions yet."
                storageKey="loggrid.sessions"
            />
        </div>
    );
}
