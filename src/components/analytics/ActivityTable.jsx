// ActivityTable — learning_events viewer.
//
// Columns: every field that the /api/export/learning-events CSV carries,
// so the in-app view and the export are byte-for-byte the same shape.
// Mounts the unified LogGrid; this file is just the column config + fetch.

import { useEffect, useState, useCallback } from 'react';
import { apiFetch, ApiError } from '../../services/apiClient';
import { Download } from 'lucide-react';
import LogGrid, { CopyableCell } from './LogGrid';

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
            <CopyableCell value={info.getValue()} className="text-neutral-200" />
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
            <CopyableCell value={info.getValue()} className="text-neutral-300" />
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
        cell: (info) => (
            <span className="px-1.5 py-0.5 bg-blue-900/40 text-blue-300 rounded font-medium text-[11px]">
                {info.getValue() || '—'}
            </span>
        ),
    },
    { accessorKey: 'object_type', header: 'object_type', size: 110,
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
      cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-300" /> },
    { accessorKey: 'parent_component', header: 'parent', size: 130,
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
      cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-400" /> },
    { accessorKey: 'category', header: 'category', size: 110,
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
// still in the CSV). User can toggle them via the column chooser; the
// LogGrid persists the choice in localStorage.
const INITIAL_HIDDEN = {
    object_id: false,
    parent_component: false,
    severity: false,
    duration_ms: false,
    vital_etco2: false,
    vital_rhythm: false,
};

export default function ActivityTable({ sessionId = null }) {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');

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

    const exportCsv = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            if (from) params.append('from', from);
            if (to) params.append('to', to);
            if (sessionId) params.append('session_id', String(sessionId));
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
    }, [from, to, sessionId]);

    const headerExtras = (
        <>
            <input
                type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="px-2 py-1.5 bg-neutral-900 border border-neutral-700 rounded text-xs"
                title="From (export only)"
            />
            <input
                type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="px-2 py-1.5 bg-neutral-900 border border-neutral-700 rounded text-xs"
                title="To (export only)"
            />
        </>
    );

    const headerActions = (
        <button
            onClick={exportCsv}
            className="px-2 py-1.5 bg-cyan-700 hover:bg-cyan-600 rounded text-xs text-white flex items-center gap-1"
            title="Download xAPI CSV (uses From/To filters)"
        >
            <Download className="w-3 h-3" /> CSV
        </button>
    );

    return (
        <LogGrid
            columns={COLUMNS}
            data={events}
            loading={loading}
            error={error}
            onRefresh={load}
            initialSorting={[{ id: 'timestamp', desc: true }]}
            initialColumnVisibility={INITIAL_HIDDEN}
            headerExtras={headerExtras}
            headerActions={headerActions}
            emptyMessage="No activity recorded yet. Student actions appear here as they happen."
            storageKey="loggrid.activity"
        />
    );
}
