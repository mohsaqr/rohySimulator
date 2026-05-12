// SystemLogTable — Moodle-style site/system log.
//
// Server-side firehose over every timestamped row in the database
// (auth, admin, config, learning, chat, alarms, vitals, scenarios,
// LLM/TTS/emotion). Per-source CSV exports stream from the server
// via /api/export/system-log/:source — chosen via the dropdown above.

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

const COMPONENT_COLOR = {
    auth:     'bg-emerald-900/40 text-emerald-300',
    admin:    'bg-purple-900/40 text-purple-300',
    config:   'bg-amber-900/40 text-amber-300',
    learning: 'bg-blue-900/40 text-blue-300',
    chat:     'bg-indigo-900/40 text-indigo-300',
    alarm:    'bg-orange-900/40 text-orange-300',
    llm:      'bg-fuchsia-900/40 text-fuchsia-300',
    tts:      'bg-pink-900/40 text-pink-300',
    emotion:  'bg-rose-900/40 text-rose-300',
    oyon:     'bg-yellow-900/40 text-yellow-300',
    vitals:   'bg-teal-900/40 text-teal-300',
    scenario: 'bg-cyan-900/40 text-cyan-300',
    client:   'bg-neutral-700 text-neutral-200',
    error:    'bg-red-900/40 text-red-300',
};

// Drop-down value → /export/system-log/:source key. Same set the server
// already exposes via EXPORT_SOURCES; the chip color comes from the
// component badge map above.
const EXPORT_SOURCES = [
    'auth', 'admin', 'config', 'learning', 'chat', 'alarm',
    'llm', 'tts', 'emotion', 'oyon', 'vitals', 'scenario', 'client',
];

const COLUMNS = [
    { accessorKey: 'ts', header: 'when', size: 165,
      cell: (info) => <CopyableCell value={info.getValue()} className="font-mono text-neutral-400 whitespace-nowrap">{fmtTime(info.getValue())}</CopyableCell> },
    { accessorKey: 'username', header: 'user', size: 130,
      cell: (info) => {
          const v = info.getValue();
          const uid = info.row.original.user_id;
          const display = v || (uid ? `#${uid}` : '—');
          return <CopyableCell value={v || uid} className="text-neutral-200">{display}</CopyableCell>;
      } },
    {
        accessorKey: 'component', header: 'component', size: 110,
        cell: (info) => {
            const v = info.getValue();
            const cls = COMPONENT_COLOR[v] || 'bg-neutral-700 text-neutral-300';
            return <span className={`px-1.5 py-0.5 rounded font-medium text-[11px] ${cls}`}>{v || '—'}</span>;
        },
        meta: {
            // Auto-populate the per-column filter dropdown with all known component types.
            // Saves the user from having to remember the spelling.
            filterOptions: Object.keys(COMPONENT_COLOR),
        },
    },
    { accessorKey: 'event', header: 'event', size: 180,
      cell: (info) => {
          const v = info.getValue();
          const status = info.row.original.status;
          const statusBadge = status && status !== 'success' && status !== 'info'
              ? <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${
                  status === 'failure' || status === 'error'
                      ? 'bg-red-900/50 text-red-300'
                      : 'bg-amber-900/50 text-amber-300'}`}>{status}</span>
              : null;
          return <span className="text-neutral-200 font-medium"><CopyableCell value={v} />{statusBadge}</span>;
      } },
    { accessorKey: 'description', header: 'description', size: 380,
      cell: (info) => {
          const v = info.getValue();
          return (
              <div className="truncate max-w-[380px]" title={v ?? ''}>
                  <CopyableCell value={v} className="text-neutral-300" />
              </div>
          );
      } },
    { accessorKey: 'origin', header: 'origin', size: 80,
      cell: (info) => <CopyableCell value={info.getValue() || 'web'} className="font-mono text-neutral-400" /> },
    { accessorKey: 'ip', header: 'ip', size: 110,
      cell: (info) => <CopyableCell value={info.getValue()} className="font-mono text-neutral-400" /> },
];

export default function SystemLogTable() {
    const [events, setEvents] = useState([]);
    const [sources, setSources] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [exportSource, setExportSource] = useState('auth');
    const [currentLimit, setCurrentLimit] = useState(DEFAULT_LIMIT);

    const load = useCallback(async (lim = currentLimit) => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (from) params.append('from', from);
            if (to) params.append('to', to);
            params.append('limit', String(lim));
            const data = await apiFetch(`/system-log/feed?${params.toString()}`);
            setEvents(data?.events || []);
            setSources(data?.sources || {});
            setCurrentLimit(lim);
            setError(null);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : err.message);
        } finally {
            setLoading(false);
        }
    }, [from, to, currentLimit]);

    useEffect(() => { load(DEFAULT_LIMIT);   }, [from, to]);

    const downloadSource = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            if (from) params.append('from', from);
            if (to) params.append('to', to);
            const qs = params.toString() ? `?${params.toString()}` : '';
            const blob = await apiFetch(`/export/system-log/${exportSource}${qs}`, { parseAs: 'blob' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${exportSource}_${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : err.message);
        }
    }, [from, to, exportSource]);

    const headerExtras = (
        <>
            <input
                type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="px-2 py-1.5 bg-neutral-900 border border-neutral-700 rounded text-xs"
                title="From"
            />
            <input
                type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="px-2 py-1.5 bg-neutral-900 border border-neutral-700 rounded text-xs"
                title="To"
            />
        </>
    );

    const headerActions = (
        <div className="flex items-center gap-1">
            <select
                value={exportSource}
                onChange={(e) => setExportSource(e.target.value)}
                className="px-2 py-1.5 bg-neutral-900 border border-neutral-700 rounded text-xs text-neutral-200"
                title="Source table to export"
            >
                {EXPORT_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button
                onClick={downloadSource}
                className="px-2 py-1.5 bg-cyan-700 hover:bg-cyan-600 rounded text-xs text-white flex items-center gap-1"
                title={`Stream every row of the ${exportSource} source as CSV (server-paged, no client memory cap)`}
            >
                <Download className="w-3 h-3" /> CSV
            </button>
        </div>
    );

    return (
        <div className="flex flex-col h-full">
            <LogGrid
                columns={COLUMNS}
                data={events}
                loading={loading}
                error={error}
                onRefresh={() => load(currentLimit)}
                onLoadMore={(n) => load(n)}
                currentLimit={currentLimit}
                initialSorting={[{ id: 'ts', desc: true }]}
                headerExtras={headerExtras}
                headerActions={headerActions}
                emptyMessage="No system events recorded yet."
                storageKey="loggrid.system"
            />
            {Object.keys(sources).length > 0 && (
                <div className="px-3 py-1.5 border-t border-neutral-700 bg-neutral-800 text-xs text-neutral-500 font-mono overflow-x-auto whitespace-nowrap">
                    {Object.entries(sources)
                        .sort((a, b) => b[1] - a[1])
                        .map(([k, v]) => `${k}:${v}`)
                        .join(' · ')}
                </div>
            )}
        </div>
    );
}
