// TurnsTab — AnalyticsHub "By turn" view: one row per USER chat turn with
// the sensed emotion + gaze aggregated over the sensing windows leading up
// to that message.
//
// Data: GET /api/chat-log/turns — the same endpoint the System Logs
// TurnsTable reads. Rows are TurnRow (see ../turnRows.js): the turn's
// sensing is the LEAD-UP — windows ending in (previousUserMsg, thisUserMsg];
// gaze fields are aggregate zone proportions only, never raw gaze points.
//
// Hub filter → query param mapping (empties omitted; the route pins
// non-reviewers to self server-side, so sending user_id is always safe):
//   sessionId → session_id · caseId → case_id · userId → user_id
//   startDate → from · endDate → to
//
// Shared hub tab contract is ({ filters, records, recordsLoading }); this
// view fetches its own per-turn rows (turns are a chat-log join, not a
// slice of the hub's shared windows), so only `filters` is consumed.

import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { apiFetch } from '../../../services/apiClient';
import { buildCsv } from '../csvExport';
import { dominantZone } from '../turnRows.js';
import { fmtTime, fix2, pct } from '../../oyon/emotionLogShared';
import {
    EmotionChip, StateNotice, ToolbarButton, ValenceCell,
    downloadText, summarise, zoneLabel,
} from './hubShared.jsx';

const TURNS_LIMIT = 500;

// ── CSV export (pure, exported for tests) ─────────────────────────────
// Same flattening the System Logs TurnsTable ships: gaze_top / emotion_top
// arrays become "name:pct" strings so the CSV stays one row per turn.

export const TURNS_CSV_FIELDS = [
    'id', 'turnIndex', 'ts', 'username', 'session_id', 'case_name',
    'prompt', 'reply',
    'gaze_dominant', 'gaze_top_str', 'gaze_transitions', 'gaze_distinct_zones',
    'emotion_dominant', 'emotion_top_str', 'emotion_transitions',
    'valence', 'arousal', 'focus', 'windowCount',
];

export function flattenTurnRow(r) {
    return {
        ...r,
        gaze_top_str: (r.gaze_top || []).map((z) => `${z.zone}:${Number(z.pct).toFixed(2)}`).join(' '),
        emotion_top_str: (r.emotion_top || []).map((e) => `${e.label}:${Number(e.pct).toFixed(2)}`).join(' '),
    };
}

export function buildTurnsCsv(rows) {
    return buildCsv((rows || []).map(flattenTurnRow), TURNS_CSV_FIELDS);
}

// ── 3×3 gaze-zone heatmap (pure, exported for tests) ──────────────────
// Renders a turn's aggregated `gaze_zones` proportions on the canonical
// 3×3 screen grid; cell background intensity ∝ proportion, % in the cell,
// dominant cell ringed (data-dominant="true" for tests/tooling).

const ZONE_GRID = [
    'top_left', 'top_center', 'top_right',
    'middle_left', 'middle_center', 'middle_right',
    'bottom_left', 'bottom_center', 'bottom_right',
];

export function GazeZoneHeatmap({ zones }) {
    const dominant = dominantZone(zones);
    if (!dominant) {
        return <div className="text-xs text-neutral-500">no gaze data for this turn</div>;
    }
    return (
        <div className="grid grid-cols-3 gap-1 w-48" data-testid="gaze-heatmap">
            {ZONE_GRID.map((zone) => {
                const raw = Number(zones?.[zone]);
                const v = Number.isFinite(raw) && raw > 0 ? Math.min(1, raw) : 0;
                const isDominant = zone === dominant;
                return (
                    <div
                        key={zone}
                        data-zone={zone}
                        data-dominant={isDominant ? 'true' : 'false'}
                        title={`${zoneLabel(zone)} ${(v * 100).toFixed(1)}%`}
                        className={`h-10 rounded flex items-center justify-center text-[10px] font-mono ${
                            v > 0.35 ? 'text-neutral-900 font-semibold' : 'text-neutral-300'
                        } ${isDominant ? 'ring-1 ring-cyan-300' : ''}`}
                        style={{ background: `rgba(34, 211, 238, ${Math.max(0.05, v).toFixed(3)})` }}
                    >
                        {Math.round(v * 100)}%
                    </div>
                );
            })}
        </div>
    );
}

// ── expanded detail panel ──────────────────────────────────────────────

function TurnDetail({ row }) {
    return (
        <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wide text-cyan-400">
                    Turn {row.turnIndex} · session #{row.session_id}
                </div>
                {row.prompt && (
                    <div className="whitespace-pre-wrap break-words rounded border border-neutral-700 bg-neutral-800 p-2 text-xs text-neutral-200">
                        {row.prompt}
                    </div>
                )}
                {row.reply && (
                    <div className="whitespace-pre-wrap break-words rounded border border-neutral-800 bg-neutral-900 p-2 text-xs text-neutral-400">
                        {row.reply}
                    </div>
                )}
            </div>
            <div className="space-y-3">
                <div>
                    <div className="text-xs uppercase tracking-wide text-neutral-400 mb-1">
                        Emotion (top estimates)
                    </div>
                    {(row.emotion_top || []).length === 0 ? (
                        <span className="text-xs text-neutral-500">no sensing windows for this turn</span>
                    ) : (
                        <div className="flex flex-wrap items-center gap-2">
                            {(row.emotion_top || []).slice(0, 3).map((e) => (
                                <span key={e.label} className="inline-flex items-center gap-1 text-xs text-neutral-300">
                                    <EmotionChip label={e.label} />
                                    <span className="font-mono">{pct(e.pct)}</span>
                                </span>
                            ))}
                        </div>
                    )}
                    <div className="mt-1 font-mono text-[11px] text-neutral-400">
                        arousal <span className="text-neutral-200">{fix2(row.arousal)}</span>
                        {' · '}gaze shifts <span className="text-neutral-200">{row.gaze_transitions ?? 0}</span>
                        {' · '}distinct zones <span className="text-neutral-200">{row.gaze_distinct_zones ?? 0}</span>
                    </div>
                </div>
                <div>
                    <div className="text-xs uppercase tracking-wide text-neutral-400 mb-1">
                        Gaze zones (share of the turn)
                    </div>
                    <GazeZoneHeatmap zones={row.gaze_zones} />
                </div>
            </div>
        </div>
    );
}

// ── main tab ───────────────────────────────────────────────────────────

export default function TurnsTab({ filters = {} }) {
    const { caseId = '', userId = '', startDate = '', endDate = '', sessionId = '' } = filters;

    const [rows, setRows] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [expandedId, setExpandedId] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const params = new URLSearchParams();
        if (sessionId) params.set('session_id', sessionId);
        if (caseId) params.set('case_id', caseId);
        if (userId) params.set('user_id', userId);
        if (startDate) params.set('from', startDate);
        if (endDate) params.set('to', endDate);
        params.set('limit', String(TURNS_LIMIT));

        (async () => {
            setLoading(true);
            setError(null);
            try {
                const data = await apiFetch(`/chat-log/turns?${params}`);
                if (!cancelled) {
                    setRows(data?.events || []);
                    setExpandedId(null);
                }
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [sessionId, caseId, userId, startDate, endDate]);

    const csv = useMemo(() => (rows?.length ? buildTurnsCsv(rows) : null), [rows]);

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-neutral-400">
                    {rows ? `${rows.length} turn${rows.length === 1 ? '' : 's'} loaded` : 'per-turn chat log with sensed emotion + gaze'}
                </span>
                <span className="ml-auto">
                    <ToolbarButton
                        onClick={() => downloadText(csv, `hub-turns_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8')}
                        disabled={!csv}
                        title="Download the loaded turns as CSV"
                    >
                        <Download className="w-3 h-3" /> CSV
                    </ToolbarButton>
                </span>
            </div>

            {error && <StateNotice kind="error">{error}</StateNotice>}
            {loading && !rows && <StateNotice>Loading turns…</StateNotice>}
            {!loading && rows && rows.length === 0 && (
                <StateNotice>No turns match the current filters — chat with the patient with sensing on.</StateNotice>
            )}

            {rows && rows.length > 0 && (
                <div className="max-h-[70vh] overflow-auto rounded-lg border border-neutral-800">
                    <table className="min-w-[1080px] w-full text-xs">
                        <thead className="sticky top-0 z-10 bg-neutral-900/95 text-neutral-400 uppercase">
                            <tr>
                                <th className="text-right px-2 py-2">#</th>
                                <th className="text-left px-2 py-2">Time</th>
                                <th className="text-left px-2 py-2">Student</th>
                                <th className="text-left px-2 py-2">Case</th>
                                <th className="text-left px-2 py-2">Prompt</th>
                                <th className="text-left px-2 py-2">Reply</th>
                                <th className="text-left px-2 py-2">Emotion</th>
                                <th className="text-right px-2 py-2">Valence</th>
                                <th className="text-right px-2 py-2">Focus</th>
                                <th className="text-left px-2 py-2">Gaze</th>
                                <th className="text-right px-2 py-2">Win</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => {
                                const isOpen = expandedId === r.id;
                                return [
                                    <tr
                                        key={r.id}
                                        data-testid="turn-row"
                                        onClick={() => setExpandedId(isOpen ? null : r.id)}
                                        className="border-t border-neutral-800/60 hover:bg-neutral-900/40 cursor-pointer"
                                    >
                                        <td className="px-2 py-1.5 text-right font-mono text-neutral-400">{r.turnIndex}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap font-mono text-neutral-400">{fmtTime(r.ts)}</td>
                                        <td className="px-2 py-1.5 text-neutral-200">{r.username || '—'}</td>
                                        <td className="px-2 py-1.5 text-neutral-300">{r.case_name || '—'}</td>
                                        <td className="px-2 py-1.5 max-w-[240px] truncate text-neutral-200" title={r.prompt ?? ''}>
                                            {summarise(r.prompt)}
                                        </td>
                                        <td className="px-2 py-1.5 max-w-[220px] truncate text-neutral-400" title={r.reply ?? ''}>
                                            {summarise(r.reply, 100)}
                                        </td>
                                        <td className="px-2 py-1.5"><EmotionChip label={r.emotion_dominant} /></td>
                                        <td className="px-2 py-1.5 text-right tabular-nums"><ValenceCell value={r.valence} /></td>
                                        <td className="px-2 py-1.5 text-right tabular-nums font-mono text-neutral-300">{fix2(r.focus)}</td>
                                        <td className="px-2 py-1.5 text-neutral-300">{zoneLabel(r.gaze_dominant) ?? <span className="text-neutral-600">—</span>}</td>
                                        <td className="px-2 py-1.5 text-right font-mono text-neutral-400">{r.windowCount ?? 0}</td>
                                    </tr>,
                                    isOpen && (
                                        <tr key={`${r.id}-detail`} className="bg-neutral-950/60">
                                            <td colSpan={11} className="px-3 py-3">
                                                <TurnDetail row={r} />
                                            </td>
                                        </tr>
                                    ),
                                ];
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
