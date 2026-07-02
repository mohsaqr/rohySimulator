// TurnsTable — per-TURN chat summary, COPIED from chatoyon-plus
// src/components/logs/TurnFocusTable.tsx and adapted to rohy's dark LogGrid.
// One row per turn (each user message → next user message), with the gaze +
// emotion aggregated over the sensing windows leading up to that message.
// Reads GET /api/chat-log/turns (row shape identical to chatoyon's TurnRow).

import { useEffect, useState, useCallback } from 'react';
import { apiFetch, ApiError } from '../../services/apiClient';
import { Download } from 'lucide-react';
import LogGrid, { CopyableCell } from './LogGrid';
import { buildCsv, downloadCsv } from './csvExport';
import { emotionColor, signed, fix2 } from '../oyon/emotionLogShared';

const DEFAULT_LIMIT = 500;

function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}
function summarise(s, n = 120) {
    const str = s == null ? '' : String(s);
    return str.length <= n ? str : str.slice(0, n) + '…';
}
const pct = (p) => `${Math.round(p * 100)}%`;

// Humanize the canonical 3×3 zone ("middle_center" → "center") — same map
// as chatoyon's TurnFocusTable.
const ZONE_LABEL = {
    middle_center: 'center', top_center: 'top', bottom_center: 'bottom',
    middle_left: 'left', middle_right: 'right',
    top_left: 'top-left', top_right: 'top-right',
    bottom_left: 'bottom-left', bottom_right: 'bottom-right',
};
const zoneLabel = (z) => (z ? ZONE_LABEL[z] ?? z : null);

function DominantBadge({ text, color }) {
    if (!text) return <span className="text-neutral-600">—</span>;
    return (
        <span
            className="px-1.5 py-0.5 rounded font-medium text-[11px] text-neutral-900"
            style={{ background: color }}
        >
            {text}
        </span>
    );
}

function TopShares({ items, kind }) {
    if (!items.length) {
        return <span className="text-neutral-600">{kind === 'gaze' ? 'not calibrated' : '—'}</span>;
    }
    return (
        <span className="font-mono text-[11px] text-neutral-300">
            {items.map((it, i) => (
                <span key={it.name}>
                    {i > 0 && <span className="text-neutral-600"> · </span>}
                    {it.name} {pct(it.pct)}
                </span>
            ))}
        </span>
    );
}

const COLUMNS = [
    { accessorKey: 'ts', header: 'when', size: 160,
      cell: (info) => <CopyableCell value={info.getValue()} className="whitespace-nowrap font-mono text-neutral-400">{fmtTime(info.getValue())}</CopyableCell> },
    { accessorKey: 'turnIndex', header: 'turn', size: 50,
      cell: (info) => <span className="font-mono text-neutral-400">{String(info.getValue() ?? '')}</span> },
    { accessorKey: 'username', header: 'user', size: 100,
      cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-200" /> },
    { accessorKey: 'case_name', header: 'case', size: 130,
      cell: (info) => <CopyableCell value={info.getValue()} className="text-neutral-300" /> },
    { accessorKey: 'session_id', header: 'sess', size: 60,
      cell: (info) => <CopyableCell value={info.getValue()} className="font-mono text-neutral-400" /> },
    { accessorKey: 'prompt', header: 'turn (prompt)', size: 240,
      cell: (info) => {
          const v = info.getValue();
          return <div className="max-w-[240px] truncate" title={v ?? ''}><CopyableCell value={v} className="text-neutral-200">{summarise(v)}</CopyableCell></div>;
      } },
    { id: 'gaze_dominant', accessorFn: (r) => r.gaze_dominant, header: 'gaze', size: 90,
      cell: (info) => <DominantBadge text={zoneLabel(info.getValue())} color="#7dd3fc" /> },
    { id: 'gaze_top', accessorFn: (r) => r, header: 'gaze · others', size: 200,
      enableSorting: false,
      cell: (info) => {
          const r = info.getValue();
          return <TopShares kind="gaze" items={(r.gaze_top || []).map((z) => ({ name: zoneLabel(z.zone) ?? z.zone, pct: z.pct }))} />;
      } },
    { accessorKey: 'gaze_transitions', header: 'gaze shifts', size: 80,
      cell: (info) => {
          const r = info.row.original;
          if (!r.gaze_dominant) return <span className="text-neutral-600">—</span>;
          return <span className="font-mono text-neutral-300" title={`${r.gaze_distinct_zones} distinct zones`}>{String(info.getValue() ?? 0)}</span>;
      } },
    { id: 'emotion_dominant', accessorFn: (r) => r.emotion_dominant, header: 'emotion', size: 90,
      cell: (info) => {
          const v = info.getValue();
          return <DominantBadge text={v} color={v ? emotionColor(v) : undefined} />;
      } },
    { id: 'emotion_top', accessorFn: (r) => r, header: 'emotion · others', size: 200,
      enableSorting: false,
      cell: (info) => {
          const r = info.getValue();
          return <TopShares kind="emotion" items={(r.emotion_top || []).map((e) => ({ name: e.label, pct: e.pct }))} />;
      } },
    { accessorKey: 'emotion_transitions', header: 'emo shifts', size: 80,
      cell: (info) => <span className="font-mono text-neutral-300">{String(info.getValue() ?? 0)}</span> },
    { accessorKey: 'valence', header: 'valence', size: 72,
      cell: (info) => {
          const v = info.getValue();
          if (v == null) return <span className="text-neutral-600">—</span>;
          return <span className="font-mono" style={{ color: v >= 0 ? '#34d399' : '#f87171' }}>{signed(v)}</span>;
      } },
    { accessorKey: 'arousal', header: 'arousal', size: 72,
      cell: (info) => {
          const v = info.getValue();
          return v == null ? <span className="text-neutral-600">—</span> : <span className="font-mono text-neutral-300">{fix2(v)}</span>;
      } },
    { accessorKey: 'focus', header: 'focus', size: 64,
      cell: (info) => {
          const v = info.getValue();
          return v == null ? <span className="text-neutral-600">—</span> : <span className="font-mono text-neutral-300">{fix2(v)}</span>;
      } },
    { accessorKey: 'windowCount', header: 'win', size: 50,
      cell: (info) => <span className="font-mono text-neutral-400">{String(info.getValue() ?? 0)}</span> },
];

// Flatten a TurnRow for CSV — same spirit as chatoyon's flattenTurnRow.
const CSV_FIELDS = [
    'id', 'turnIndex', 'ts', 'username', 'session_id', 'case_name',
    'prompt', 'reply',
    'gaze_dominant', 'gaze_top_str', 'gaze_transitions', 'gaze_distinct_zones',
    'emotion_dominant', 'emotion_top_str', 'emotion_transitions',
    'valence', 'arousal', 'focus', 'windowCount',
];
function flattenTurn(r) {
    return {
        ...r,
        gaze_top_str: (r.gaze_top || []).map((z) => `${z.zone}:${z.pct.toFixed(2)}`).join(' '),
        emotion_top_str: (r.emotion_top || []).map((e) => `${e.label}:${e.pct.toFixed(2)}`).join(' '),
    };
}

export default function TurnsTable() {
    const [events, setEvents] = useState([]);
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
            if (sessionFilter) params.append('session_id', sessionFilter.replace(/^#/, ''));
            params.append('limit', String(lim));
            const data = await apiFetch(`/chat-log/turns?${params.toString()}`);
            setEvents(data?.events || []);
            setCurrentLimit(lim);
            setError(null);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : err.message);
        } finally {
            setLoading(false);
        }
    }, [from, to, sessionFilter, currentLimit]);

    useEffect(() => { load(DEFAULT_LIMIT); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [from, to, sessionFilter]);

    const headerExtras = (
        <>
            <input
                type="text" value={sessionFilter} onChange={(e) => setSessionFilter(e.target.value)}
                placeholder="Sess #" title="Filter to a single session id"
                className="w-20 px-2 py-1.5 bg-neutral-900 border border-neutral-700 rounded text-xs text-neutral-200"
            />
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="From"
                className="px-2 py-1.5 bg-neutral-900 border border-neutral-700 rounded text-xs" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="To"
                className="px-2 py-1.5 bg-neutral-900 border border-neutral-700 rounded text-xs" />
        </>
    );

    const exportCsvAction = (
        <button
            onClick={() => downloadCsv(
                buildCsv(events.map(flattenTurn), CSV_FIELDS),
                `turns_${new Date().toISOString().slice(0, 10)}.csv`,
            )}
            disabled={events.length === 0}
            className="px-2 py-1.5 bg-cyan-700 hover:bg-cyan-600 rounded text-xs text-white flex items-center gap-1 disabled:opacity-50"
            title="Download the loaded turns as CSV"
        >
            <Download className="w-3 h-3" /> CSV
        </button>
    );

    const expandRender = (row) => (
        <div className="space-y-3">
            <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-cyan-400">Turn {row.turnIndex}</div>
                {row.prompt && <div className="mt-1 whitespace-pre-wrap break-words rounded border border-neutral-700 bg-neutral-800 p-2 text-xs text-neutral-200">{row.prompt}</div>}
                {row.reply && <div className="mt-1 whitespace-pre-wrap break-words rounded border border-neutral-800 bg-neutral-900 p-2 text-xs text-neutral-400">{summarise(row.reply, 600)}</div>}
            </div>
            <div className="font-mono text-[11px] text-neutral-400">
                <div>gaze shifts: <span className="text-neutral-200">{row.gaze_transitions}</span> · distinct zones: <span className="text-neutral-200">{row.gaze_distinct_zones}</span></div>
                <div>emotion shifts: <span className="text-neutral-200">{row.emotion_transitions}</span></div>
                <div>valence: <span className="text-neutral-200">{fix2(row.valence)}</span> · arousal: <span className="text-neutral-200">{fix2(row.arousal)}</span> · focus: <span className="text-neutral-200">{fix2(row.focus)}</span></div>
                <div>windows: <span className="text-neutral-200">{row.windowCount}</span> · session: <span className="text-neutral-200">#{row.session_id}</span></div>
            </div>
        </div>
    );

    return (
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
            headerActions={exportCsvAction}
            expandRender={expandRender}
            emptyMessage="No turns yet — chat with the patient with sensing on."
            storageKey="loggrid.turns"
        />
    );
}
