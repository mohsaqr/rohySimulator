// SessionsTable — admin sessions list mounted on the unified LogGrid.
//
// Replaces the inline <table> that used to live in ConfigPanel.
// Reads from /api/sessions which the existing dashboard already uses.
// Click a row to download the per-session bundle CSV
// (/api/export/complete-session/:id).

import { useEffect, useState, useCallback } from 'react';
import { apiFetch, ApiError } from '../../services/apiClient';
import { Download } from 'lucide-react';
import LogGrid, { CopyableCell } from './LogGrid';

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
          return <CopyableCell value={v} className="text-neutral-200 font-medium" />;
      } },
    { accessorKey: 'case_name', header: 'case', size: 200,
      cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-300" /> },
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

export default function SessionsTable() {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

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

    return (
        <LogGrid
            columns={COLUMNS}
            data={rows}
            loading={loading}
            error={error}
            onRefresh={load}
            initialSorting={[{ id: 'start_time', desc: true }]}
            emptyMessage="No sessions yet."
            storageKey="loggrid.sessions"
        />
    );
}
