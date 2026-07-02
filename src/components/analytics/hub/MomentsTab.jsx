// MomentsTab — AnalyticsHub "By moment (actions)" view: one row per
// clinical moment (learning_events row or chat turn) enriched SERVER-SIDE
// with the sensing window covering its timestamp.
//
// Data: GET /api/learning-events/moments — the same endpoint the System
// Logs MomentsTable reads. Per the route (server/routes/analytics-routes.js,
// fetchEnrichedMoments → joinMoments): each moment is joined to exactly ONE
// covering window (window_start <= t < window_end), so the response carries
// a single sensed valence — there is NO before→after valence pair and NO
// window-count field. We therefore render the single valence plus a
// "sensed" marker for whether a covering window existed (all enrichment
// fields null ⇒ capture was off for that moment; nothing is fabricated).
//
// Hub filter → query param mapping (empties omitted; the route pins
// non-reviewers to self server-side):
//   sessionId → session_id · caseId → case_id · userId → user_id
//   startDate → from · endDate → to
//
// Verb chips above the table are a CLIENT-SIDE quick filter derived from
// the distinct verbs in the loaded rows (single-select; click again to
// clear). The CSV export serializes the chip-filtered view.
//
// Shared hub tab contract is ({ filters, records, recordsLoading }); this
// view fetches its own moment rows, so only `filters` is consumed.

import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { apiFetch } from '../../../services/apiClient';
import { buildCsv } from '../csvExport';
import { fmtTime } from '../../oyon/emotionLogShared';
import {
    EmotionChip, StateNotice, ToolbarButton, ValenceCell,
    downloadText, summarise,
} from './hubShared.jsx';

const MOMENTS_LIMIT = 1000;

// ── CSV export (pure, exported for tests) ─────────────────────────────
// Full response row, not just the visible columns, so the export is
// analysis-ready — same convention as the System Logs MomentsTable.

export const MOMENTS_CSV_FIELDS = [
    'id', 'source', 'timestamp', 'case_id', 'case_title', 'session_id', 'attempt',
    'user_id', 'student_name', 'room', 'verb', 'object_type', 'object_name',
    'component', 'severity', 'category', 'message_content', 'message_role',
    'result', 'duration_ms',
    'vital_hr', 'vital_spo2', 'vital_bp_sys', 'vital_bp_dia',
    'vital_rr', 'vital_temp', 'vital_etco2', 'vital_rhythm',
    'emotion', 'valence', 'arousal', 'focus', 'gaze_target',
];

export function buildMomentsCsv(rows) {
    return buildCsv(rows || [], MOMENTS_CSV_FIELDS);
}

// A moment counts as "sensed" when the covering-window join produced any
// enrichment value (they are all-null together when capture was off).
export function isSensed(row) {
    return row.emotion != null || row.valence != null || row.arousal != null
        || row.focus != null || row.gaze_target != null;
}

// What the trainee acted ON: object_name for clinical events, a snippet of
// the message for chat-turn pseudo-events (object_name is null there).
function objectLabel(row) {
    if (row.object_name) return row.object_name;
    if (row.message_content) return summarise(row.message_content, 80);
    return null;
}

function VerbChip({ verb, active, onClick }) {
    return (
        <button
            onClick={onClick}
            className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
                active
                    ? 'bg-cyan-900/60 text-cyan-300 border-cyan-700'
                    : 'bg-neutral-900 text-neutral-400 border-neutral-700 hover:text-neutral-200 hover:bg-neutral-800'
            }`}
        >
            {verb}
        </button>
    );
}

export default function MomentsTab({ filters = {} }) {
    const { caseId = '', userId = '', startDate = '', endDate = '', sessionId = '' } = filters;

    const [rows, setRows] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [verbFilter, setVerbFilter] = useState('');

    useEffect(() => {
        let cancelled = false;
        const params = new URLSearchParams();
        if (sessionId) params.set('session_id', sessionId);
        if (caseId) params.set('case_id', caseId);
        if (userId) params.set('user_id', userId);
        if (startDate) params.set('from', startDate);
        if (endDate) params.set('to', endDate);
        params.set('limit', String(MOMENTS_LIMIT));

        (async () => {
            setLoading(true);
            setError(null);
            try {
                const data = await apiFetch(`/learning-events/moments?${params}`);
                if (!cancelled) {
                    setRows(data?.moments || []);
                    setVerbFilter('');
                }
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [sessionId, caseId, userId, startDate, endDate]);

    const verbs = useMemo(() => {
        const set = new Set((rows || []).map((r) => r.verb).filter(Boolean));
        return [...set].sort();
    }, [rows]);

    const view = useMemo(
        () => (verbFilter ? (rows || []).filter((r) => r.verb === verbFilter) : (rows || [])),
        [rows, verbFilter],
    );

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-neutral-400">
                    {rows
                        ? `${view.length} of ${rows.length} moment${rows.length === 1 ? '' : 's'}`
                        : 'student actions + chat turns, each enriched with the sensing window covering it'}
                </span>
                <span className="ml-auto">
                    <ToolbarButton
                        onClick={() => downloadText(
                            buildMomentsCsv(view),
                            `hub-moments_${new Date().toISOString().slice(0, 10)}.csv`,
                            'text/csv;charset=utf-8',
                        )}
                        disabled={view.length === 0}
                        title="Download the filtered moments as CSV (all fields)"
                    >
                        <Download className="w-3 h-3" /> CSV
                    </ToolbarButton>
                </span>
            </div>

            {verbs.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5" data-testid="verb-chips">
                    <VerbChip verb="All verbs" active={verbFilter === ''} onClick={() => setVerbFilter('')} />
                    {verbs.map((v) => (
                        <VerbChip
                            key={v}
                            verb={v}
                            active={verbFilter === v}
                            onClick={() => setVerbFilter(verbFilter === v ? '' : v)}
                        />
                    ))}
                </div>
            )}

            {error && <StateNotice kind="error">{error}</StateNotice>}
            {loading && !rows && <StateNotice>Loading moments…</StateNotice>}
            {!loading && rows && view.length === 0 && (
                <StateNotice>
                    {rows.length === 0
                        ? 'No moments match the current filters — student actions and chat turns appear here.'
                        : 'No moments with this verb — pick another chip.'}
                </StateNotice>
            )}

            {view.length > 0 && (
                <div className="max-h-[70vh] overflow-auto rounded-lg border border-neutral-800">
                    <table className="min-w-[1000px] w-full text-xs">
                        <thead className="sticky top-0 z-10 bg-neutral-900/95 text-neutral-400 uppercase">
                            <tr>
                                <th className="text-left px-2 py-2">Time</th>
                                <th className="text-left px-2 py-2">Student</th>
                                <th className="text-left px-2 py-2">Case</th>
                                <th className="text-left px-2 py-2">Room</th>
                                <th className="text-left px-2 py-2">Verb</th>
                                <th className="text-left px-2 py-2">Object</th>
                                <th className="text-left px-2 py-2">Emotion</th>
                                <th className="text-right px-2 py-2">Valence</th>
                                <th className="text-left px-2 py-2">Sensed</th>
                            </tr>
                        </thead>
                        <tbody>
                            {view.map((r) => (
                                <tr
                                    key={`${r.source ?? 'event'}-${r.id}`}
                                    data-testid="moment-row"
                                    className="border-t border-neutral-800/60 hover:bg-neutral-900/40"
                                >
                                    <td className="px-2 py-1.5 whitespace-nowrap font-mono text-neutral-400">{fmtTime(r.timestamp)}</td>
                                    <td className="px-2 py-1.5 text-neutral-200">{r.student_name || (r.user_id != null ? `#${r.user_id}` : '—')}</td>
                                    <td className="px-2 py-1.5 text-neutral-300">{r.case_title || (r.case_id != null ? `case ${r.case_id}` : '—')}</td>
                                    <td className="px-2 py-1.5 text-neutral-400">{r.room || '—'}</td>
                                    <td className="px-2 py-1.5">
                                        <span className="px-1.5 py-0.5 bg-blue-900/40 text-blue-300 rounded font-medium text-[11px]">
                                            {r.verb || '—'}
                                        </span>
                                    </td>
                                    <td className="px-2 py-1.5 max-w-[240px] truncate text-neutral-200" title={r.object_name ?? r.message_content ?? ''}>
                                        {objectLabel(r) || <span className="text-neutral-600">—</span>}
                                    </td>
                                    <td className="px-2 py-1.5"><EmotionChip label={r.emotion} /></td>
                                    <td className="px-2 py-1.5 text-right tabular-nums"><ValenceCell value={r.valence} /></td>
                                    <td className="px-2 py-1.5 text-neutral-400">
                                        {isSensed(r)
                                            ? <span className="text-cyan-300" title="One sensing window covered this moment">1 window</span>
                                            : <span className="text-neutral-600" title="No sensing window covered this moment (capture off)">—</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
