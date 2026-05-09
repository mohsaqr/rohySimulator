// ChatLogTable — every chat / voice / affect-related row in one feed.
//
// Reads /api/chat-log/feed (admin) which unions interactions,
// COMMUNICATION-category learning_events, agent_conversations,
// team_communications_log, llm_request_log, tts_usage,
// emotion_logs, oyon_emotion_records.
//
// Click any row to expand — full message/content shown verbatim
// (no truncation), so admins can read what was actually said.

import { useEffect, useMemo, useState, useCallback } from 'react';
import { apiFetch, ApiError } from '../../services/apiClient';
import LogGrid, { CopyableCell } from './LogGrid';

const DEFAULT_LIMIT = 500;

function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

function summarise(s, n = 200) {
    if (!s) return '';
    return s.length <= n ? s : s.slice(0, n) + '…';
}

const SOURCE_COLOR = {
    interaction: 'bg-indigo-900/40 text-indigo-300',
    event:       'bg-blue-900/40 text-blue-300',
    agent:       'bg-violet-900/40 text-violet-300',
    team:        'bg-purple-900/40 text-purple-300',
    llm:         'bg-fuchsia-900/40 text-fuchsia-300',
    tts:         'bg-pink-900/40 text-pink-300',
    emotion:     'bg-rose-900/40 text-rose-300',
    oyon:        'bg-yellow-900/40 text-yellow-300',
};

const SOURCE_LABEL = {
    interaction: 'Chat', event: 'Event', agent: 'Agent', team: 'Team',
    llm: 'LLM', tts: 'TTS', emotion: 'Emotion', oyon: 'Face',
};

const ROLE_COLOR = {
    user:      'bg-emerald-900/40 text-emerald-300',
    assistant: 'bg-blue-900/40 text-blue-300',
    system:    'bg-neutral-700 text-neutral-300',
    student:   'bg-emerald-900/40 text-emerald-300',
};

const COLUMNS = [
    { accessorKey: 'ts', header: 'when', size: 165,
      cell: (info) => <CopyableCell value={info.getValue()} className="font-mono text-neutral-400 whitespace-nowrap">{fmtTime(info.getValue())}</CopyableCell> },
    { accessorKey: 'source', header: 'src', size: 80,
      cell: (info) => {
          const v = info.getValue();
          const cls = SOURCE_COLOR[v] || 'bg-neutral-700 text-neutral-300';
          return <span className={`px-1.5 py-0.5 rounded font-medium text-[11px] ${cls}`}>{SOURCE_LABEL[v] || v || '—'}</span>;
      },
      meta: { filterOptions: Object.keys(SOURCE_LABEL) },
    },
    { accessorKey: 'role', header: 'role', size: 80,
      cell: (info) => {
          const v = info.getValue();
          if (!v) return <span className="text-neutral-500">—</span>;
          const cls = ROLE_COLOR[v] || 'bg-neutral-700 text-neutral-300';
          return <span className={`px-1.5 py-0.5 rounded font-mono text-[11px] ${cls}`}>{v}</span>;
      } },
    { accessorKey: 'username', header: 'user', size: 110,
      cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-200" /> },
    { accessorKey: 'session_id', header: 'sess', size: 60,
      cell: (info) => {
          const v = info.getValue();
          return <CopyableCell value={v} className="font-mono text-neutral-400">{v ? `#${v}` : '—'}</CopyableCell>;
      } },
    { accessorKey: 'case_name', header: 'case', size: 130,
      cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-300" /> },
    { accessorKey: 'content', header: 'content', size: 340,
      cell: (info) => {
          const v = info.getValue();
          return (
              <div className="truncate max-w-[340px]" title={v ?? ''}>
                  <CopyableCell value={v} className="text-neutral-200">{summarise(v, 150)}</CopyableCell>
              </div>
          );
      } },
    { accessorKey: 'model', header: 'model', size: 120,
      cell: (info) => <CopyableCell value={info.getValue()} className="font-mono text-neutral-400" /> },
    {
        id: 'tokens',
        accessorFn: (row) => row.tokens_in != null || row.tokens_out != null
            ? `${row.tokens_in ?? '?'} / ${row.tokens_out ?? '?'}`
            : null,
        header: 'tok in/out',
        size: 90,
        cell: (info) => <span className="font-mono text-neutral-300">{info.getValue() ?? '—'}</span>,
    },
    { accessorKey: 'latency_ms', header: 'latency', size: 80,
      cell: (info) => {
          const v = info.getValue();
          return <span className="font-mono text-neutral-400">{v != null ? `${v} ms` : '—'}</span>;
      } },
];

const INITIAL_HIDDEN = {
    case_name: false,
    model: false,
    tokens: false,
    latency_ms: false,
};

export default function ChatLogTable() {
    const [events, setEvents] = useState([]);
    const [sources, setSources] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [sessionFilter, setSessionFilter] = useState('');
    const [currentLimit, setCurrentLimit] = useState(DEFAULT_LIMIT);

    const load = useCallback(async (lim = currentLimit) => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (from) params.append('from', from);
            if (to) params.append('to', to);
            if (sessionFilter) params.append('session_id', sessionFilter);
            params.append('limit', String(lim));
            const data = await apiFetch(`/chat-log/feed?${params.toString()}`);
            setEvents(data?.events || []);
            setSources(data?.sources || {});
            setCurrentLimit(lim);
            setError(null);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : err.message);
        } finally {
            setLoading(false);
        }
    }, [from, to, sessionFilter, currentLimit]);

    useEffect(() => { load(DEFAULT_LIMIT); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to, sessionFilter]);

    const headerExtras = (
        <>
            <input
                type="text" value={sessionFilter} onChange={(e) => setSessionFilter(e.target.value)}
                placeholder="Sess #" className="w-20 px-2 py-1.5 bg-neutral-900 border border-neutral-700 rounded text-xs"
                title="Filter to a single session id"
            />
            <input
                type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="px-2 py-1.5 bg-neutral-900 border border-neutral-700 rounded text-xs" title="From"
            />
            <input
                type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="px-2 py-1.5 bg-neutral-900 border border-neutral-700 rounded text-xs" title="To"
            />
        </>
    );

    // Expanded panel: full content verbatim, plus the secondary fields
    // that are hidden in the row by default. Lets a reviewer see the
    // entire message + its provenance without having to widen columns.
    const expandRender = (row) => (
        <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-cyan-400 font-bold">Full content</div>
            <div className="whitespace-pre-wrap break-words text-neutral-100 text-xs bg-neutral-900 p-2 rounded border border-neutral-800">
                {row.content || <span className="italic text-neutral-500">(empty)</span>}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-400 font-mono">
                {row.model && <span>model: <span className="text-neutral-200">{row.model}</span></span>}
                {(row.tokens_in != null || row.tokens_out != null) && (
                    <span>tokens: <span className="text-neutral-200">{row.tokens_in ?? '?'} in / {row.tokens_out ?? '?'} out</span></span>
                )}
                {row.latency_ms != null && <span>latency: <span className="text-neutral-200">{row.latency_ms} ms</span></span>}
                {row.case_name && <span>case: <span className="text-neutral-200">{row.case_name}</span></span>}
                {row.session_id && <span>session: <span className="text-neutral-200">#{row.session_id}</span></span>}
            </div>
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
                initialColumnVisibility={INITIAL_HIDDEN}
                headerExtras={headerExtras}
                expandRender={expandRender}
                emptyMessage="No chat events yet."
                storageKey="loggrid.chat"
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
