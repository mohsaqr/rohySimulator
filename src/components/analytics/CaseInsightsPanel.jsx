// CaseInsightsPanel — the "Case Insights" tab.
//
// Two sections over GET /api/analytics/case-insights:
//
//   Critical moments — one card per fired scenario event / vitals alarm,
//     with the trainee's sensed reaction around it (valence before → after,
//     gaze shift, window counts). All-null reactions render as an explicit
//     "no sensing data" state — never a fabricated reading.
//
//   Action–affect summary — a tidy table, one row per (case, action verb):
//     n, dominant emotion, mean valence, dominant gaze, mean focus.
//
// The math lives in caseInsights.js (shared with the server); this file is
// fetch + filters + presentation only. Gaze fields are the stored AGGREGATE
// AOI/zone labels — no raw gaze points exist anywhere on this surface.

import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../services/apiClient';
import { RefreshCw, Loader2, AlertTriangle, Zap, Bell } from 'lucide-react';
import { emotionColor, signed, fix2, fmtTime } from '../oyon/emotionLogShared';

const FIELD_CLS = 'rohy-field rounded px-2 py-1 text-xs';

// Colored valence delta: rise = green, drop = red, flat/unknown = neutral.
function deltaColor(delta) {
    if (!Number.isFinite(delta) || delta === 0) return '#a3a3a3';
    return delta > 0 ? '#34d399' : '#f87171';
}

function EmotionChip({ label }) {
    if (!label) return <span className="text-neutral-600">—</span>;
    return (
        <span
            className="px-1.5 py-0.5 rounded font-medium text-[11px] text-neutral-900"
            style={{ background: emotionColor(label) }}
        >
            {label}
        </span>
    );
}

function Valence({ value }) {
    if (value == null) return <span className="text-neutral-600">—</span>;
    return (
        <span className="font-mono" style={{ color: value >= 0 ? '#34d399' : '#f87171' }}>
            {signed(value)}
        </span>
    );
}

// "HR 145 → 160" style chips from a scenario event's vital_changes JSON.
function vitalChangeChips(vitalChanges) {
    if (!vitalChanges || typeof vitalChanges !== 'object') return [];
    return Object.entries(vitalChanges).map(([key, value]) => (
        `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`
    ));
}

function ReactionRow({ reaction }) {
    const noData = !reaction || (reaction.pre.windows === 0 && reaction.post.windows === 0);
    if (noData) {
        return (
            <div className="text-xs text-neutral-500 italic">
                no sensing data around this moment
            </div>
        );
    }
    const { pre, post, delta_valence } = reaction;
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="text-neutral-400">
                valence <Valence value={pre.valence_mean} />
                <span className="text-neutral-600 mx-1">→</span>
                <Valence value={post.valence_mean} />
                {delta_valence != null && (
                    <span className="ml-1.5 font-mono font-semibold" style={{ color: deltaColor(delta_valence) }}>
                        ({signed(delta_valence)})
                    </span>
                )}
            </span>
            <span className="text-neutral-400">
                gaze{' '}
                <span className="text-neutral-200">{pre.gaze_dominant ?? '—'}</span>
                <span className="text-neutral-600 mx-1">→</span>
                <span className="text-neutral-200">{post.gaze_dominant ?? '—'}</span>
            </span>
            {(pre.emotion_dominant || post.emotion_dominant) && (
                <span className="text-neutral-400 flex items-center gap-1">
                    emotion <EmotionChip label={pre.emotion_dominant} />
                    <span className="text-neutral-600">→</span>
                    <EmotionChip label={post.emotion_dominant} />
                </span>
            )}
            <span className="text-neutral-500 font-mono">
                {pre.windows}w before · {post.windows}w after
            </span>
        </div>
    );
}

function TriggerCard({ trigger }) {
    const isAlarm = trigger.source === 'alarm';
    const chips = vitalChangeChips(trigger.vital_changes);
    return (
        <div className="rohy-card rounded p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold text-[11px] ${isAlarm ? 'bg-red-900/50 text-red-300' : 'bg-amber-900/50 text-amber-300'}`}>
                    {isAlarm ? <Bell className="w-3 h-3" /> : <Zap className="w-3 h-3" />}
                    {isAlarm ? 'alarm' : 'scenario'}
                </span>
                <span className="text-neutral-200 font-semibold">{trigger.event_name || '—'}</span>
                <span className="font-mono text-neutral-400">{fmtTime(trigger.ts)}</span>
                {trigger.case_title && <span className="text-neutral-300">{trigger.case_title}</span>}
                {trigger.student_name && <span className="text-neutral-400">{trigger.student_name}</span>}
            </div>
            {chips.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {chips.map((chip) => (
                        <span key={chip} className="rohy-badge-neutral font-mono">
                            {chip}
                        </span>
                    ))}
                </div>
            )}
            <ReactionRow reaction={trigger.reaction} />
        </div>
    );
}

export default function CaseInsightsPanel() {
    const [data, setData] = useState({ triggers: [], summary: [] });
    const [caseOptions, setCaseOptions] = useState([]); // [{id, title}] accumulated across fetches
    const [caseId, setCaseId] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (caseId) params.set('case_id', caseId);
            if (from) params.set('from', from);
            if (to) params.set('to', to);
            const qs = params.toString();
            const res = await apiFetch(`/analytics/case-insights${qs ? `?${qs}` : ''}`);
            const triggers = res?.triggers || [];
            const summary = res?.summary || [];
            setData({ triggers, summary });
            setError(null);
            // Grow the case dropdown from whatever titles this response
            // carries (titles only — ids never shown). Never shrink it, so
            // narrowing to one case doesn't strand the selector.
            setCaseOptions((prev) => {
                const known = new Map(prev.map((c) => [String(c.id), c]));
                [...triggers, ...summary].forEach((row) => {
                    if (row.case_id != null && row.case_title && !known.has(String(row.case_id))) {
                        known.set(String(row.case_id), { id: row.case_id, title: row.case_title });
                    }
                });
                return [...known.values()].sort((a, b) => a.title.localeCompare(b.title));
            });
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [caseId, from, to]);

    useEffect(() => { load(); }, [load]);

    return (
        <div className="p-4 space-y-5 text-sm">
            {/* Toolbar: case + date range, mirroring the sibling log surfaces. */}
            <div className="flex flex-wrap items-center gap-2">
                <select
                    value={caseId}
                    onChange={(e) => setCaseId(e.target.value)}
                    className={FIELD_CLS}
                    title="Filter by case"
                >
                    <option value="">All cases</option>
                    {caseOptions.map((c) => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                </select>
                <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className={FIELD_CLS}
                    title="From date"
                />
                <span className="text-neutral-600 text-xs">to</span>
                <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className={FIELD_CLS}
                    title="To date (inclusive)"
                />
                <button
                    onClick={load}
                    className="rohy-subtle-button px-2 py-1.5 rounded text-xs flex items-center gap-1"
                    title="Refresh"
                >
                    <RefreshCw className="w-3 h-3" /> Refresh
                </button>
            </div>

            {error ? (
                <div className="flex items-center gap-2 text-red-400 text-xs bg-red-950/40 border border-red-900 rounded p-3">
                    <AlertTriangle className="w-4 h-4" /> {error}
                </div>
            ) : loading ? (
                <div className="text-center py-10">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-neutral-500" />
                </div>
            ) : (
                <>
                    <section className="space-y-2">
                        <h3 className="font-bold">Critical moments</h3>
                        <p className="text-xs text-neutral-500">
                            Fired scenario events and vitals alarms, with the sensed reaction
                            in the 30 seconds before vs after each one.
                        </p>
                        {data.triggers.length === 0 ? (
                            <div className="text-center py-8 rohy-table-muted text-xs border border-dashed border-[var(--rohy-border)] rounded">
                                No critical moments in scope. Scenario events fire during a
                                running session; vitals alarms appear when thresholds are crossed.
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {data.triggers.map((t, i) => (
                                    <TriggerCard key={`${t.source}-${t.session_id}-${t.ts}-${i}`} trigger={t} />
                                ))}
                            </div>
                        )}
                    </section>

                    <section className="space-y-2">
                        <h3 className="font-bold">Action-affect summary</h3>
                        <p className="text-xs text-neutral-500">
                            How trainees felt while performing each action, per case. n counts
                            every action; affect columns aggregate only the sensed ones.
                        </p>
                        {data.summary.length === 0 ? (
                            <div className="text-center py-8 rohy-table-muted text-xs border border-dashed border-[var(--rohy-border)] rounded">
                                No actions in scope yet.
                            </div>
                        ) : (
                            <div className="rohy-table-shell overflow-x-auto rounded">
                                <table className="w-full text-xs">
                                    <thead className="rohy-table-head">
                                        <tr className="text-left">
                                            <th className="px-3 py-2 font-semibold">case</th>
                                            <th className="px-3 py-2 font-semibold">action</th>
                                            <th className="px-3 py-2 font-semibold text-right">n</th>
                                            <th className="px-3 py-2 font-semibold">emotion</th>
                                            <th className="px-3 py-2 font-semibold text-right">valence</th>
                                            <th className="px-3 py-2 font-semibold">looking at</th>
                                            <th className="px-3 py-2 font-semibold text-right">focus</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.summary.map((row) => (
                                            <tr
                                                key={`${row.case_id}-${row.verb}`}
                                                className="rohy-table-row"
                                            >
                                                <td className="rohy-table-cell px-3 py-1.5">{row.case_title ?? '—'}</td>
                                                <td className="rohy-table-cell px-3 py-1.5">
                                                    <span className="rohy-badge-teal">
                                                        {row.verb ?? '—'}
                                                    </span>
                                                </td>
                                                <td className="rohy-table-cell px-3 py-1.5 text-right font-mono">{row.n}</td>
                                                <td className="rohy-table-cell px-3 py-1.5"><EmotionChip label={row.emotion_dominant} /></td>
                                                <td className="rohy-table-cell px-3 py-1.5 text-right"><Valence value={row.valence_mean} /></td>
                                                <td className="rohy-table-cell px-3 py-1.5">{row.gaze_dominant ?? <span className="text-neutral-600">—</span>}</td>
                                                <td className="rohy-table-cell px-3 py-1.5 text-right font-mono">
                                                    {row.focus_mean == null ? <span className="text-neutral-600">—</span> : fix2(row.focus_mean)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}
