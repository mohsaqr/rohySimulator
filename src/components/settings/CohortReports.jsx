import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Loader2, ArrowLeft, Download, RefreshCw, Activity,
    LayoutGrid, ListChecks, Check, Circle, ChevronDown, ChevronRight,
    BarChart3,
} from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { ApiError, apiGet } from '../../services/apiClient';
import { roleLabel } from '../../constants/roleLabels';
import {
    getCohortRoster, getCohortGrid, getCohortStudent,
    getCohortPulse, getCohortFeed, downloadCohortExport,
} from '../../services/cohortsService';
import { tna, prune, centralities, layout as dynaLayout } from 'dynajs';
import { ActivityTimelineChart } from '../analytics/tna/laila/ActivityTimelineChart';
import { ActivityHeatmap } from '../analytics/tna/laila/ActivityHeatmap';
import { ActivityDonutChart } from '../analytics/tna/laila/ActivityDonutChart';
import { TnaNetworkGraph } from '../analytics/tna/laila/TnaNetworkGraph';
import { CentralityBarChart } from '../analytics/tna/laila/CentralityBarChart';
import { TnaFrequencyChart } from '../analytics/tna/laila/TnaFrequencyChart';
import { createColorMap } from '../analytics/tna/laila/colorFix';

const errMsg = (e, fallback) =>
    e instanceof ApiError ? (e.message || fallback) : fallback;

const studentOnly = (rows) => (rows || []).filter((row) => !row?.role || row.role === 'student');

function fmtTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
}

const FEED_POLL_MS = 10000;
const FEED_MAX_ROWS = 200;

// Read-only Phase-4 reporting for a single (already-owned) cohort. Rendered
// inside the existing CohortRoster drill-down as a sub-nav alongside the
// unchanged "Manage" roster/join-code screen. GET only — no mutations.
export default function CohortReports({ cohortId, initialView = 'roster' }) {
    const [view, setView] = useState(initialView);

    // Deep-link support: when the parent re-targets this cohort at a
    // different report (e.g. a different mini-icon on the class card was
    // clicked), follow it instead of staying on the first-mounted view.
    useEffect(() => { setView(initialView); }, [initialView]);

    const tabs = [
        { id: 'roster', label: 'Roster', hint: 'Students', icon: ListChecks },
        { id: 'grid', label: 'Completion', hint: 'Progress grid', icon: LayoutGrid },
        { id: 'analytics', label: 'Analytics', hint: 'Engagement', icon: BarChart3 },
        { id: 'export', label: 'Export', hint: 'CSV', icon: Download },
        { id: 'feed', label: 'Live feed', hint: 'Realtime', icon: Activity },
    ];

    return (
        <div className="space-y-5">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {tabs.map((t) => {
                    const Icon = t.icon;
                    const active = view === t.id;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setView(t.id)}
                            className={`rounded-2xl border p-3 text-left transition-all ${
                                active
                                    ? 'border-teal-500 bg-teal-950/50 text-white shadow-lg shadow-teal-950/20'
                                    : 'border-neutral-700 bg-neutral-900/60 text-neutral-400 hover:border-neutral-500 hover:bg-neutral-800 hover:text-white'
                            }`}
                        >
                            <div className="flex items-center gap-2">
                                <span className={`grid h-9 w-9 place-items-center rounded-xl ${active ? 'bg-teal-600 text-white' : 'bg-neutral-800 text-neutral-400'}`}>
                                    <Icon className="h-4 w-4" />
                                </span>
                                <span>
                                    <span className="block text-sm font-bold">{t.label}</span>
                                    <span className="block text-xs text-current opacity-60">{t.hint}</span>
                                </span>
                            </div>
                        </button>
                    );
                })}
            </div>

            {view === 'roster' && <RosterView cohortId={cohortId} />}
            {view === 'grid' && <GridView cohortId={cohortId} />}
            {view === 'analytics' && <AnalyticsView cohortId={cohortId} />}
            {view === 'export' && <ExportView cohortId={cohortId} />}
            {/* Feed only mounts (and only polls) while its tab is active —
                switching away unmounts it, so the interval is torn down. */}
            {view === 'feed' && <FeedView cohortId={cohortId} />}
        </div>
    );
}

// Light presentational primitives. Analytics deliberately uses a light
// "report sheet" surface (like the rest of the analytics stack) so the
// chart palettes actually read — the verb/state colours wash out on the
// near-black cockpit theme. The surface is intentionally crafted as a
// printed-report document (visual direction locked 2026-05-16: "polished
// light report card") — not a raw slab dropped on the dark cockpit.

// One cell of the KPI strip. Tiles share a single bordered row (divide-x)
// so the numbers read as a compact dashboard band, not four fat boxes.
function StatTile({ label, value, accent }) {
    return (
        <div className="flex-1 px-5 py-4 first:pl-6 last:pr-6">
            <div
                className={`text-[26px] leading-none font-bold tabular-nums truncate ${
                    accent ? 'text-purple-600' : 'text-gray-900'
                }`}
            >
                {value ?? '—'}
            </div>
            <div className="mt-1.5 text-[11px] font-medium uppercase tracking-wider text-gray-500">
                {label}
            </div>
        </div>
    );
}

// A report panel. `wide` lets a chart span both grid columns; `hint` is a
// quiet right-aligned annotation in the header (e.g. a count or unit).
function ChartCard({ title, hint, wide, children }) {
    return (
        <div
            className={`rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden ${
                wide ? 'lg:col-span-2' : ''
            }`}
        >
            <div className="flex items-baseline justify-between gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50/60">
                <h3 className="text-[13px] font-semibold text-gray-800">{title}</h3>
                {hint != null && (
                    <span className="text-[11px] text-gray-400 tabular-nums shrink-0">
                        {hint}
                    </span>
                )}
            </div>
            <div className="p-4">{children}</div>
        </div>
    );
}

function ReportShell({ eyebrow, title, description, action, children }) {
    return (
        <div className="overflow-hidden rounded-2xl bg-white text-slate-950 shadow-2xl shadow-black/25 ring-1 ring-black/10">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
                <div>
                    {eyebrow && (
                        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                            {eyebrow}
                        </div>
                    )}
                    <h3 className="mt-1 text-lg font-bold text-slate-950">{title}</h3>
                    {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
                </div>
                {action}
            </div>
            {children}
        </div>
    );
}

// Lightweight section divider so the report reads in chapters
// (Engagement → Behaviour) instead of an undifferentiated card stack.
function SectionLabel({ children }) {
    return (
        <div className="flex items-center gap-3 pt-2">
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-gray-400">
                {children}
            </h2>
            <div className="flex-1 h-px bg-gray-200" />
        </div>
    );
}

// Pulse placeholders while the scoped analytics payload is in flight —
// keeps the report's shape stable instead of collapsing to a lone spinner.
function AnalyticsSkeleton() {
    return (
        <div className="space-y-5 animate-pulse" aria-hidden="true">
            <div className="h-[72px] rounded-xl bg-gray-200/70" />
            <div className="h-56 rounded-xl bg-gray-200/70" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="h-48 rounded-xl bg-gray-200/70" />
                <div className="h-48 rounded-xl bg-gray-200/70" />
            </div>
        </div>
    );
}

// TNA / sequence section. The dynajs pipeline (transition model → prune →
// centralities → layout) is exactly what the admin dashboard runs — same
// library, same maths — rendered directly in this view's light report
// cards (no embedded shell). `sequences` come pre-merged from the scoped
// /cohorts/:id/analytics/tna-sequences endpoint (server applies the verb
// merge map), so the states are clinically meaningful without the
// client-side resolver chain.
function TnaSection({ sequences }) {
    const model = useMemo(() => {
        const seqs = (sequences || []).filter((s) => Array.isArray(s) && s.length >= 2);
        if (seqs.length === 0) return null;
        try {
            const labelSet = new Set();
            for (const s of seqs) for (const v of s) labelSet.add(v);
            const labels = [...labelSet].sort();
            const raw = tna(seqs, { labels });
            const pruned = prune(raw, 0.05);
            const colorMap = createColorMap(labels);
            let cent = null;
            try {
                const c = centralities(raw);
                const measures = {};
                for (const [k, v] of Object.entries(c.measures)) measures[k] = Array.from(v);
                cent = { labels: c.labels, measures };
            } catch { /* centralities are optional */ }
            let positions;
            try {
                const r = dynaLayout(pruned, { algorithm: 'circle' });
                const h = 380;
                const pad = 30;
                positions = r.labels.map((_, i) => ({
                    x: pad + r.x[i] * (h - 2 * pad),
                    y: pad + r.y[i] * (h - 2 * pad),
                }));
            } catch { positions = undefined; }
            return { pruned, labels, colorMap, cent, positions };
        } catch {
            return null;
        }
    }, [sequences]);

    if (!model) {
        return (
            <ChartCard title="Behaviour network (TNA)">
                <p className="text-xs text-gray-500 py-8 text-center">
                    Not enough sequenced activity to build a transition network for this scope.
                </p>
            </ChartCard>
        );
    }
    const firstMeasure = model.cent ? Object.keys(model.cent.measures)[0] : null;
    return (
        <>
            <SectionLabel>Behaviour</SectionLabel>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard
                    title="Behaviour network (TNA)"
                    hint={`${model.labels.length} states`}
                >
                    <TnaNetworkGraph
                        model={model.pruned}
                        colorMap={model.colorMap}
                        centralityData={model.cent}
                        externalPositions={model.positions}
                        height={380}
                    />
                </ChartCard>
                <ChartCard title="Centrality" hint={firstMeasure || undefined}>
                    {model.cent && firstMeasure ? (
                        <CentralityBarChart
                            centralityData={model.cent}
                            colorMap={model.colorMap}
                            selectedMeasure={firstMeasure}
                        />
                    ) : (
                        <p className="text-xs text-gray-500 py-8 text-center">
                            No centrality data
                        </p>
                    )}
                </ChartCard>
                <ChartCard title="State frequency" wide>
                    <TnaFrequencyChart
                        sequences={sequences}
                        labels={model.labels}
                        colorMap={model.colorMap}
                    />
                </ChartCard>
            </div>
        </>
    );
}

function pulseTone(status) {
    if (status === 'Complete') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
    if (status === 'Active') return 'bg-blue-50 text-blue-700 ring-blue-200';
    if (status === 'In progress') return 'bg-amber-50 text-amber-700 ring-amber-200';
    if (status === 'Quiet') return 'bg-orange-50 text-orange-700 ring-orange-200';
    return 'bg-slate-100 text-slate-600 ring-slate-200';
}

function PulseBadge({ status }) {
    return (
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${pulseTone(status)}`}>
            {status}
        </span>
    );
}

function PulseBar({ label, value, max, tone = 'bg-teal-600' }) {
    const pct = max > 0 ? Math.max(4, Math.round((Number(value || 0) / max) * 100)) : 0;
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-slate-700">{label}</span>
                <span className="font-mono text-xs text-slate-500">{value || 0}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

function PulseMetric({ label, value, hint }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</div>
            <div className="mt-2 text-2xl font-black tabular-nums text-slate-950">{value ?? '—'}</div>
            {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
        </div>
    );
}

function PulseInsight({ label, value, detail, tone = 'slate' }) {
    const tones = {
        slate: 'border-slate-200 bg-slate-50 text-slate-950',
        teal: 'border-teal-200 bg-teal-50 text-teal-950',
        amber: 'border-amber-200 bg-amber-50 text-amber-950',
        rose: 'border-rose-200 bg-rose-50 text-rose-950',
        blue: 'border-blue-200 bg-blue-50 text-blue-950',
    };
    return (
        <div className={`rounded-2xl border p-4 ${tones[tone] || tones.slate}`}>
            <div className="text-[11px] font-black uppercase tracking-[0.16em] opacity-60">{label}</div>
            <div className="mt-2 text-3xl font-black leading-none tabular-nums">{value}</div>
            <div className="mt-2 text-sm font-medium opacity-70">{detail}</div>
        </div>
    );
}

function PulseDistribution({ items }) {
    const total = items.reduce((sum, item) => sum + Number(item.value || 0), 0);
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h4 className="font-bold text-slate-950">Student status distribution</h4>
                    <p className="text-sm text-slate-500">Course health by learner state.</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">
                    {total} students
                </span>
            </div>
            <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-slate-100">
                {items.map((item) => {
                    const width = total > 0 ? Math.max(5, Math.round((item.value / total) * 100)) : 0;
                    return (
                        <div
                            key={item.label}
                            className={item.color}
                            style={{ width: `${width}%` }}
                            title={`${item.label}: ${item.value}`}
                        />
                    );
                })}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {items.map((item) => (
                    <div key={item.label} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                            <span className={`h-2.5 w-2.5 rounded-full ${item.color}`} />
                            {item.label}
                        </span>
                        <span className="font-mono text-xs font-bold text-slate-500">{item.value}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function AnalyticsView({ cohortId }) {
    const toast = useToast();
    const [pulse, setPulse] = useState(null);
    const [loading, setLoading] = useState(true);

    const loadPulse = useCallback(async () => {
        setLoading(true);
        try {
            setPulse(await getCohortPulse(cohortId));
        } catch (e) {
            setPulse(null);
            toast.error(errMsg(e, 'Failed to load course analytics'));
        } finally {
            setLoading(false);
        }
    }, [cohortId, toast]);

    useEffect(() => {
        const timer = window.setTimeout(loadPulse, 0);
        return () => window.clearTimeout(timer);
    }, [loadPulse]);

    const summary = pulse?.summary || {};
    const students = pulse?.students || [];
    const cases = pulse?.cases || [];
    const frequencies = pulse?.activity_frequencies || [];
    const topActivities = pulse?.top_activities || [];
    const recent = pulse?.recent_events || [];
    const attention = students.filter((s) => s.needs_attention).slice(0, 5);
    const maxFrequency = Math.max(1, ...frequencies.map((f) => Number(f.count || 0)));
    const maxCaseSessions = Math.max(1, ...cases.map((c) => Number(c.sessions || 0)));
    const trend = Number(summary.trend_delta_pct || 0);
    const statusCounts = students.reduce((acc, student) => {
        acc[student.status] = (acc[student.status] || 0) + 1;
        return acc;
    }, {});
    const completedStudents = statusCounts.Complete || 0;
    const inProgressStudents = statusCounts['In progress'] || 0;
    const activeStudents = statusCounts.Active || 0;
    const quietStudents = (statusCounts.Quiet || 0) + (statusCounts['Not started'] || 0);
    const avgEvents = summary.students ? Math.round((summary.total_events || 0) / summary.students) : 0;
    const avgSessions = summary.students ? Math.round(((summary.total_sessions || 0) / summary.students) * 10) / 10 : 0;
    const hottestCase = cases[0];
    const mostActiveStudent = [...students].sort((a, b) => Number(b.event_count || 0) - Number(a.event_count || 0))[0];
    const topBucket = frequencies[0];
    const pulseScore = Math.round(
        ((summary.completion_rate || 0) * 0.45)
        + (((summary.active_students || 0) / Math.max(1, summary.students || 0)) * 35)
        + ((quietStudents === 0 ? 1 : 1 - (quietStudents / Math.max(1, summary.students || 0))) * 20)
    );
    const distribution = [
        { label: 'Complete', value: completedStudents, color: 'bg-emerald-500' },
        { label: 'Active', value: activeStudents, color: 'bg-blue-500' },
        { label: 'In progress', value: inProgressStudents, color: 'bg-amber-500' },
        { label: 'Quiet / not started', value: quietStudents, color: 'bg-slate-400' },
    ];

    return (
        <div className="space-y-4">
            <ReportShell
                eyebrow="Analytics"
                title="Course command center"
                description="A course-native operating view: learner momentum, activity quality, case completion, and intervention priorities."
                action={(
                    <button
                        type="button"
                        onClick={loadPulse}
                        disabled={loading}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-100 disabled:opacity-50"
                    >
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                )}
            >
                <div className="space-y-5 p-5">
                    {loading && (
                        <div className="grid gap-3 md:grid-cols-4">
                            {[0, 1, 2, 3].map((i) => (
                                <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />
                            ))}
                        </div>
                    )}

                    {!loading && !pulse && (
                        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                            Course analytics could not be loaded.
                        </div>
                    )}

                    {!loading && pulse && (
                        <>
                            <div className="grid gap-3 xl:grid-cols-[1.25fr_0.9fr_0.9fr_0.9fr]">
                                <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950 p-5 text-white shadow-xl">
                                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-teal-200/80">Executive readout</div>
                                    <div className="mt-4 flex items-end justify-between gap-4">
                                        <div>
                                            <div className="text-5xl font-black leading-none tabular-nums">{pulseScore}</div>
                                            <div className="mt-2 text-sm font-semibold text-slate-300">Course health score</div>
                                        </div>
                                        <div className="text-right">
                                            <div className={`text-2xl font-black ${trend >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                                                {trend >= 0 ? '+' : ''}{trend}%
                                            </div>
                                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">weekly activity trend</div>
                                        </div>
                                    </div>
                                    <div className="mt-5 grid gap-2 sm:grid-cols-3">
                                        <div className="rounded-xl bg-white/10 p-3 ring-1 ring-white/10">
                                            <div className="text-xs text-slate-300">Avg events</div>
                                            <div className="mt-1 font-mono text-lg font-black">{avgEvents}</div>
                                        </div>
                                        <div className="rounded-xl bg-white/10 p-3 ring-1 ring-white/10">
                                            <div className="text-xs text-slate-300">Avg sessions</div>
                                            <div className="mt-1 font-mono text-lg font-black">{avgSessions}</div>
                                        </div>
                                        <div className="rounded-xl bg-white/10 p-3 ring-1 ring-white/10">
                                            <div className="text-xs text-slate-300">Completion</div>
                                            <div className="mt-1 font-mono text-lg font-black">{summary.completion_rate || 0}%</div>
                                        </div>
                                    </div>
                                </div>
                                <PulseInsight
                                    label="Priority"
                                    value={summary.attention_students || 0}
                                    detail="students need follow-up"
                                    tone={(summary.attention_students || 0) > 0 ? 'amber' : 'teal'}
                                />
                                <PulseInsight
                                    label="Dominant activity"
                                    value={topBucket?.label || 'None'}
                                    detail={topBucket ? `${topBucket.count} events in this activity family` : 'No learner activity yet'}
                                    tone="blue"
                                />
                                <PulseInsight
                                    label="Most active learner"
                                    value={mostActiveStudent?.name || mostActiveStudent?.username || 'None'}
                                    detail={mostActiveStudent ? `${mostActiveStudent.event_count} events · ${mostActiveStudent.session_count} sessions` : 'No active learners yet'}
                                    tone="slate"
                                />
                            </div>

                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                                <PulseMetric label="Students" value={summary.students} hint={`${summary.active_students || 0} active this week`} />
                                <PulseMetric label="Support flags" value={summary.attention_students} hint="Quiet or not started" />
                                <PulseMetric label="Sessions" value={summary.total_sessions} hint="Student attempts" />
                                <PulseMetric label="Events" value={summary.total_events} hint={`${trend >= 0 ? '+' : ''}${trend}% vs prior week`} />
                                <PulseMetric label="Completion" value={`${summary.completion_rate || 0}%`} hint="Assigned case slots" />
                            </div>

                            <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                                <PulseDistribution items={distribution} />
                                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <h4 className="font-bold text-slate-950">Case funnel</h4>
                                            <p className="text-sm text-slate-500">Where assigned work is converting into completed debriefs.</p>
                                        </div>
                                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">
                                            {hottestCase?.name || 'No active case'}
                                        </span>
                                    </div>
                                    <div className="mt-4 space-y-3">
                                        {cases.length === 0 ? (
                                            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 ring-1 ring-slate-200">No cases assigned or attempted yet.</p>
                                        ) : cases.slice(0, 4).map((item) => (
                                            <div key={item.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="truncate font-semibold text-slate-900">{item.name}</div>
                                                        <div className="text-xs text-slate-500">
                                                            {item.students_attempted} attempted · {item.students_completed} completed
                                                        </div>
                                                    </div>
                                                    <span className="font-mono text-xs font-black text-slate-600">{item.completion_rate}%</span>
                                                </div>
                                                <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs font-bold text-slate-400">
                                                    <div className="h-2 overflow-hidden rounded-full bg-white">
                                                        <div
                                                            className="h-full rounded-full bg-blue-500"
                                                            style={{ width: `${Math.min(100, Math.round((item.students_attempted / Math.max(1, summary.students || 0)) * 100))}%` }}
                                                        />
                                                    </div>
                                                    <span>to</span>
                                                    <div className="h-2 overflow-hidden rounded-full bg-white">
                                                        <div
                                                            className="h-full rounded-full bg-emerald-500"
                                                            style={{ width: `${Math.min(100, item.completion_rate || 0)}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <h4 className="font-bold text-slate-950">Activity frequencies</h4>
                                            <p className="text-sm text-slate-500">What learners are actually doing in this course.</p>
                                        </div>
                                        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">
                                            {summary.total_events || 0} events
                                        </span>
                                    </div>
                                    <div className="mt-4 space-y-3">
                                        {frequencies.length === 0 ? (
                                            <p className="rounded-lg bg-white p-4 text-sm text-slate-500 ring-1 ring-slate-200">No activity recorded yet.</p>
                                        ) : frequencies.map((item) => (
                                            <PulseBar key={item.label} label={item.label} value={item.count} max={maxFrequency} />
                                        ))}
                                    </div>
                                </div>

                                <div className="rounded-xl border border-slate-200 bg-white p-4">
                                    <h4 className="font-bold text-slate-950">Students needing attention</h4>
                                    <p className="text-sm text-slate-500">A short operational list, not a wall of analytics.</p>
                                    <div className="mt-4 divide-y divide-slate-100">
                                        {attention.length === 0 ? (
                                            <p className="rounded-lg bg-emerald-50 p-4 text-sm font-medium text-emerald-700 ring-1 ring-emerald-100">
                                                No quiet or not-started students right now.
                                            </p>
                                        ) : attention.map((student) => (
                                            <div key={student.id} className="flex items-center justify-between gap-3 py-3">
                                                <div className="min-w-0">
                                                    <div className="truncate font-semibold text-slate-900">{student.name || student.username}</div>
                                                    <div className="text-xs text-slate-500">
                                                        {student.primary_activity} · last active {fmtTime(student.last_activity)}
                                                    </div>
                                                </div>
                                                <PulseBadge status={student.status} />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
                                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                                        <h4 className="font-bold text-slate-950">Student pulse</h4>
                                        <p className="text-sm text-slate-500">Progress, recency, and dominant activity by learner.</p>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                                            <thead className="bg-white text-left text-xs uppercase tracking-wide text-slate-400">
                                                <tr>
                                                    <th className="px-4 py-3 font-bold">Student</th>
                                                    <th className="px-4 py-3 font-bold">Status</th>
                                                    <th className="px-4 py-3 font-bold">Cases</th>
                                                    <th className="px-4 py-3 font-bold">Events</th>
                                                    <th className="px-4 py-3 font-bold">Last active</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {students.map((student) => (
                                                    <tr key={student.id} className="hover:bg-slate-50">
                                                        <td className="px-4 py-3">
                                                            <div className="font-semibold text-slate-950">{student.name || student.username}</div>
                                                            <div className="text-xs text-slate-500">{student.primary_activity}</div>
                                                        </td>
                                                        <td className="px-4 py-3"><PulseBadge status={student.status} /></td>
                                                        <td className="px-4 py-3 font-mono text-xs text-slate-600">
                                                            {student.cases_completed}/{student.cases_attempted || cases.length || 0}
                                                        </td>
                                                        <td className="px-4 py-3 font-mono text-xs text-slate-600">{student.event_count}</td>
                                                        <td className="px-4 py-3 text-xs text-slate-500">{fmtTime(student.last_activity)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-slate-200 bg-white p-4">
                                    <h4 className="font-bold text-slate-950">Case progress</h4>
                                    <p className="text-sm text-slate-500">Attempts and completion by assigned course case.</p>
                                    <div className="mt-4 space-y-4">
                                        {cases.length === 0 ? (
                                            <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500 ring-1 ring-slate-200">No cases are assigned or attempted yet.</p>
                                        ) : cases.map((item) => (
                                            <div key={item.id} className="space-y-2">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <div className="font-semibold text-slate-900">{item.name}</div>
                                                        <div className="text-xs text-slate-500">
                                                            {item.students_completed}/{summary.students || 0} completed · {item.sessions} sessions
                                                        </div>
                                                    </div>
                                                    <span className="font-mono text-xs font-bold text-slate-500">{item.completion_rate}%</span>
                                                </div>
                                                <PulseBar label="Attempts" value={item.sessions} max={maxCaseSessions} tone="bg-slate-700" />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="grid gap-4 xl:grid-cols-2">
                                <div className="rounded-xl border border-slate-200 bg-white p-4">
                                    <h4 className="font-bold text-slate-950">Top activities</h4>
                                    <div className="mt-3 divide-y divide-slate-100">
                                        {topActivities.length === 0 ? (
                                            <p className="text-sm text-slate-500">No frequent activities yet.</p>
                                        ) : topActivities.map((item) => (
                                            <div key={`${item.bucket}-${item.label}`} className="flex items-center justify-between gap-3 py-2">
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-semibold text-slate-800">{item.label}</div>
                                                    <div className="text-xs text-slate-400">{item.bucket}</div>
                                                </div>
                                                <span className="font-mono text-xs font-bold text-slate-500">{item.count}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="rounded-xl border border-slate-200 bg-white p-4">
                                    <h4 className="font-bold text-slate-950">Recent activity</h4>
                                    <div className="mt-3 divide-y divide-slate-100">
                                        {recent.length === 0 ? (
                                            <p className="text-sm text-slate-500">No recent activity yet.</p>
                                        ) : recent.map((event) => (
                                            <div key={event.id} className="py-2">
                                                <div className="flex items-center justify-between gap-3">
                                                    <span className="truncate text-sm font-semibold text-slate-800">{event.user_name || event.username}</span>
                                                    <span className="text-xs text-slate-400">{fmtTime(event.timestamp)}</span>
                                                </div>
                                                <div className="mt-0.5 text-xs text-slate-500">
                                                    {event.bucket} · {event.case_name || 'No case'} · {event.activity}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </ReportShell>

            <details className="rounded-2xl border border-neutral-700 bg-neutral-900/60 p-3">
                <summary className="cursor-pointer px-2 py-1 text-sm font-semibold text-neutral-200">
                    Advanced event analytics
                </summary>
                <div className="mt-3">
                    <AdvancedAnalyticsView cohortId={cohortId} />
                </div>
            </details>
        </div>
    );
}

// Analytics — a NATIVE cohort view (not the admin dashboard embedded).
// Scope is an explicit, obviously-interactive drill: Whole class → a
// student → one of their sessions. Each scope change re-queries the
// member-scoped /cohorts/:id/analytics/* endpoints and re-renders the
// same SVG charts the admin dashboard uses, but on THIS panel's dark
// surface — no light-grey slab, no redundant generic filter bar, no
// TNA/network machinery a teacher didn't ask for.
function AdvancedAnalyticsView({ cohortId }) {
    const toast = useToast();
    const [roster, setRoster] = useState([]);
    const [userId, setUserId] = useState('');       // '' = whole class
    const [sessions, setSessions] = useState([]);
    const [sessionId, setSessionId] = useState(''); // '' = all sessions
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    // Roster drives the student picker.
    useEffect(() => {
        getCohortRoster(cohortId)
            .then((d) => setRoster(studentOnly(d.roster)))
            .catch((e) => toast.error(errMsg(e, 'Failed to load course roster')));
    }, [cohortId, toast]);

    // A picked student's sessions drive the session picker (reuses the
    // existing student read-model — no new endpoint).
    useEffect(() => {
        if (!userId) { setSessions([]); setSessionId(''); return undefined; }
        let off = false;
        getCohortStudent(cohortId, userId)
            .then((d) => { if (!off) setSessions(d.sessions || []); })
            .catch(() => { if (!off) setSessions([]); });
        return () => { off = true; };
    }, [cohortId, userId]);

    // Analytics payload for the current scope. useCallback + effect (the
    // same shape RosterView uses) keeps setState out of the effect body.
    // Monotonic token so out-of-order or failed scoped reloads can't leave
    // the previous scope's analytics on screen under the newly selected
    // scope (Codex P2). Only the most recent request may write state; a
    // failure for the current request clears `data` rather than silently
    // keeping stale numbers behind a toast.
    const reqIdRef = useRef(0);
    const loadAnalytics = useCallback(async () => {
        const reqId = ++reqIdRef.current;
        setLoading(true);
        const qs = new URLSearchParams();
        if (userId) qs.set('user_id', userId);
        if (sessionId) qs.set('session_id', sessionId);
        const s = qs.toString() ? `?${qs}` : '';
        const base = `/cohorts/${cohortId}/analytics`;
        try {
            const [summary, timeline, hourly, stats, tnaSeq] = await Promise.all([
                apiGet(`${base}/summary${s}`),
                apiGet(`${base}/timeline-series${s}`),
                apiGet(`${base}/hourly-counts${s}`),
                apiGet(`${base}/stats${s}`),
                apiGet(`${base}/tna-sequences${s}`),
            ]);
            if (reqId !== reqIdRef.current) return; // superseded by a newer scope
            setData({
                summary,
                timeline,
                heatmap: hourly.hourly || [],
                stats,
                tnaSequences: tnaSeq?.sequences || [],
            });
        } catch (e) {
            if (reqId !== reqIdRef.current) return; // superseded; ignore
            setData(null); // don't render the prior scope's stats
            toast.error(errMsg(e, 'Failed to load analytics'));
        } finally {
            if (reqId === reqIdRef.current) setLoading(false);
        }
    }, [cohortId, userId, sessionId, toast]);

    useEffect(() => { loadAnalytics(); }, [loadAnalytics]);

    const student = roster.find((r) => String(r.id) === String(userId));
    const verbData = Object.fromEntries(
        (data?.stats?.verbs || []).map((r) => [r.label, r.count]));
    const objData = Object.fromEntries(
        (data?.stats?.objectTypes || []).map((r) => [r.label, r.count]));
    const hasTimeline = (data?.timeline?.days?.length || 0) > 0;
    const scopeWord = sessionId ? 'session' : student ? 'student' : 'class';
    const scopeTitle = sessionId
        ? 'Session report'
        : student
            ? `${student.name || student.username}`
            : 'Whole class';

    return (
        // Crafted light "report sheet": one self-contained document that
        // sits intentionally on the dark cockpit (soft shadow + ring),
        // rather than a raw grey slab. Chart palettes are tuned for a
        // light background — keeping the surface light is deliberate.
        <div className="rounded-2xl bg-white text-gray-900 shadow-2xl shadow-black/40 ring-1 ring-black/10 overflow-hidden">
            {/* Report header / scope toolbar. Breadcrumb drill
                (Whole class › student › session) on the left, refresh
                on the right — a single command bar, not a floating box. */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-3.5 border-b border-gray-200 bg-gray-50">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400 mr-1">
                        Analytics
                    </span>
                    <button
                        type="button"
                        onClick={() => { setUserId(''); setSessionId(''); }}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                            !userId
                                ? 'bg-purple-600 text-white shadow-sm'
                                : 'text-gray-600 hover:bg-gray-200/70'
                        }`}
                    >
                        Whole class
                    </button>
                    <span className="text-gray-300 select-none">›</span>
                    <select
                        aria-label="Student"
                        value={userId}
                        onChange={(e) => { setUserId(e.target.value); setSessionId(''); }}
                        className="px-2.5 py-1.5 text-sm bg-white border border-gray-300 rounded-lg text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                    >
                        <option value="">All students</option>
                        {roster.map((r) => (
                            <option key={r.id} value={r.id}>{r.name || r.username}</option>
                        ))}
                    </select>
                    {userId && (
                        <>
                            <span className="text-gray-300 select-none">›</span>
                            <select
                                aria-label="Session"
                                value={sessionId}
                                onChange={(e) => setSessionId(e.target.value)}
                                className="px-2.5 py-1.5 text-sm bg-white border border-gray-300 rounded-lg text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                            >
                                <option value="">All sessions</option>
                                {sessions.map((se) => (
                                    <option key={se.id} value={se.id}>
                                        {se.case_name || `Case ${se.case_id}`}
                                        {se.start_time ? ` · ${fmtTime(se.start_time)}` : ''}
                                    </option>
                                ))}
                            </select>
                        </>
                    )}
                </div>
                <button
                    type="button"
                    onClick={loadAnalytics}
                    disabled={loading}
                    title="Refresh"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-200/70 rounded-lg transition-colors disabled:opacity-50"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            <div className="p-5 md:p-7 space-y-6">
                {loading && <AnalyticsSkeleton />}

                {!loading && data && (
                    <>
                        {/* KPI band — one bordered strip, divided cells. */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden divide-x divide-y lg:divide-y-0 divide-gray-100">
                            <StatTile label="Events" value={data.summary.totalActivities} accent />
                            <StatTile label="Sessions" value={data.summary.uniqueSessions} />
                            <StatTile
                                label={student ? 'Student' : 'Students'}
                                value={student ? (student.name || student.username) : data.summary.uniqueUsers}
                            />
                            <StatTile label="Avg events / student" value={data.summary.avgPerUser} />
                        </div>

                        {data.summary.totalActivities === 0 ? (
                            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 py-14 text-center">
                                <p className="text-sm font-medium text-gray-500">
                                    No recorded activity for this {scopeWord} yet.
                                </p>
                                <p className="mt-1 text-xs text-gray-400">
                                    {scopeTitle} — charts appear once learners start working.
                                </p>
                            </div>
                        ) : (
                            <>
                                <SectionLabel>Engagement</SectionLabel>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    <ChartCard
                                        title="Activity over time"
                                        hint={hasTimeline ? `${data.timeline.days.length} days` : undefined}
                                        wide
                                    >
                                        {hasTimeline ? (
                                            <ActivityTimelineChart
                                                days={data.timeline.days}
                                                verbs={data.timeline.verbs}
                                                series={data.timeline.series}
                                            />
                                        ) : (
                                            <p className="text-xs text-gray-500 py-8 text-center">
                                                Not enough data to chart a trend.
                                            </p>
                                        )}
                                    </ChartCard>
                                    <ChartCard title="When they worked" wide>
                                        <ActivityHeatmap data={data.heatmap} />
                                    </ChartCard>
                                    <ChartCard title="What they did (actions)">
                                        <ActivityDonutChart data={verbData} />
                                    </ChartCard>
                                    <ChartCard title="What they touched (object types)">
                                        <ActivityDonutChart data={objData} />
                                    </ChartCard>
                                </div>
                                <TnaSection sequences={data.tnaSequences} />
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

// 1. Roster + per-student drill-down.
function RosterView({ cohortId }) {
    const toast = useToast();
    const [loading, setLoading] = useState(true);
    const [roster, setRoster] = useState([]);
    const [openStudent, setOpenStudent] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getCohortRoster(cohortId);
            setRoster(studentOnly(data.roster));
        } catch (e) {
            toast.error(errMsg(e, 'Failed to load roster'));
        } finally {
            setLoading(false);
        }
    }, [cohortId, toast]);

    useEffect(() => { load(); }, [load]);

    const totals = useMemo(() => roster.reduce((acc, s) => ({
        sessions: acc.sessions + Number(s.session_count || 0),
        attempted: acc.attempted + Number(s.cases_attempted || 0),
        completed: acc.completed + Number(s.cases_completed || 0),
    }), { sessions: 0, attempted: 0, completed: 0 }), [roster]);
    const activeCount = useMemo(() => roster.filter((s) => s.last_activity).length, [roster]);

    if (openStudent != null) {
        return (
            <StudentDetail
                cohortId={cohortId}
                userId={openStudent}
                onBack={() => setOpenStudent(null)}
            />
        );
    }

    if (loading) {
        return (
            <ReportShell eyebrow="Roster" title="Student roster" description="Loading enrolled students and their course activity.">
                <div className="flex items-center justify-center h-40 text-slate-400">
                    <Loader2 className="w-5 h-5 animate-spin" />
                </div>
            </ReportShell>
        );
    }

    if (roster.length === 0) {
        return (
            <ReportShell eyebrow="Roster" title="No students enrolled" description="Add students from Manage or share the registration code to populate this roster.">
                <div className="p-8 text-center text-sm text-slate-500">
                    Reports, exports, and live activity stay empty until students enrol.
                </div>
            </ReportShell>
        );
    }

    return (
        <ReportShell
            eyebrow="Roster"
            title="Student roster"
            description="Enrolled students with session counts, case progress, and latest activity."
        >
            <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 border-b border-slate-200 bg-white md:grid-cols-4 md:divide-y-0">
                <ReportMetric label="Students" value={roster.length} />
                <ReportMetric label="Active" value={activeCount} accent="text-teal-700" />
                <ReportMetric label="Sessions" value={totals.sessions} />
                <ReportMetric label="Completed cases" value={totals.completed} accent="text-emerald-700" />
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-left">
                            <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Student</th>
                            <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Sessions</th>
                            <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Attempted</th>
                            <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Completed</th>
                            <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Last activity</th>
                            <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {roster.map((s) => {
                            const completed = Number(s.cases_completed || 0);
                            const attempted = Number(s.cases_attempted || 0);
                            const rate = attempted ? Math.round((completed / attempted) * 100) : 0;
                            return (
                                <tr
                                    key={s.id}
                                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                                >
                                    <td className="px-5 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-900 text-sm font-bold text-white">
                                                {(s.name || s.username || '?').slice(0, 1).toUpperCase()}
                                            </div>
                                            <div>
                                                <div className="font-bold text-slate-950">{s.name || s.username}</div>
                                                <div className="text-xs text-slate-400">
                                                    {s.username}{s.role ? ` · ${roleLabel(s.role)}` : ''}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-4 text-right font-mono text-slate-700">{s.session_count ?? 0}</td>
                                    <td className="px-4 py-4 text-right font-mono text-slate-700">{attempted}</td>
                                    <td className="px-4 py-4 text-right">
                                        <span className="font-mono font-bold text-emerald-700">{completed}</span>
                                        <span className="ml-2 text-xs text-slate-400">({rate}%)</span>
                                    </td>
                                    <td className="px-5 py-4 text-sm text-slate-500 whitespace-nowrap">{fmtTime(s.last_activity)}</td>
                                    <td className="px-5 py-4 text-right">
                                        <button
                                            type="button"
                                            onClick={() => setOpenStudent(s.id)}
                                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm hover:border-teal-300 hover:text-teal-800"
                                        >
                                            View activity
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </ReportShell>
    );
}

// One collapsible card = one session (= one attempt at a case). Its
// events are the actions the student took during that session. Grouping
// the flat event log under its session is what turns a log dump into
// "their activity, per case" — no new endpoint; events already carry
// session_id from the existing /cohorts/:id/student/:userId payload.
function SessionGroup({ group, defaultOpen }) {
    const [open, setOpen] = useState(defaultOpen);
    const { session: s, events } = group;
    return (
        <div className="border border-neutral-800 rounded bg-neutral-800/40">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center gap-3 p-2 text-left hover:bg-neutral-800/70 transition-colors"
            >
                {open
                    ? <ChevronDown className="w-4 h-4 text-neutral-500 shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-neutral-500 shrink-0" />}
                <span className="flex-1 text-sm text-white truncate">{group.title}</span>
                {s && (s.completed
                    ? <Check className="w-4 h-4 text-green-400 shrink-0" title="Debrief completed" />
                    : <Circle className="w-3 h-3 text-neutral-600 shrink-0" title="Not completed" />)}
                {s?.status && <span className="text-xs text-neutral-500 shrink-0">{s.status}</span>}
                <span className="text-xs text-neutral-500 shrink-0">
                    {events.length} action{events.length === 1 ? '' : 's'}
                </span>
                {s?.start_time && (
                    <span className="text-xs text-neutral-500 whitespace-nowrap shrink-0">
                        {fmtTime(s.start_time)}
                    </span>
                )}
            </button>
            {open && (
                events.length === 0 ? (
                    <p className="text-xs text-neutral-500 px-3 pb-2 pt-1">
                        No recorded actions in this session.
                    </p>
                ) : (
                    <ul className="px-3 pb-2 pt-1 space-y-0.5">
                        {events.map((ev) => (
                            <li
                                key={ev.id}
                                className="flex items-baseline gap-2 text-xs py-1 border-b border-neutral-800/60 last:border-0"
                            >
                                <span className="text-neutral-500 whitespace-nowrap w-36 shrink-0">
                                    {fmtTime(ev.timestamp)}
                                </span>
                                <span className="text-purple-300 font-medium">{ev.verb}</span>
                                <span className="text-neutral-300 flex-1 truncate">
                                    {ev.object_name || ev.object_type || ''}
                                </span>
                                {ev.room && (
                                    <span className="text-neutral-500 shrink-0">{ev.room}</span>
                                )}
                            </li>
                        ))}
                    </ul>
                )
            )}
        </div>
    );
}

function StudentDetail({ cohortId, userId, onBack }) {
    const toast = useToast();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setData(await getCohortStudent(cohortId, userId));
        } catch (e) {
            toast.error(errMsg(e, 'Failed to load student'));
        } finally {
            setLoading(false);
        }
    }, [cohortId, userId, toast]);

    useEffect(() => { load(); }, [load]);

    return (
        <div>
            <button
                onClick={onBack}
                className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white mb-4 transition-colors"
            >
                <ArrowLeft className="w-4 h-4" /> Back to roster
            </button>

            {loading ? (
                <div className="flex items-center justify-center h-24 text-neutral-500">
                    <Loader2 className="w-5 h-5 animate-spin" />
                </div>
            ) : !data ? (
                <p className="text-sm text-neutral-500">Student not found.</p>
            ) : (
                <>
                    <h4 className="text-base font-bold text-white mb-1">
                        {data.student?.name || data.student?.username}
                    </h4>
                    <p className="text-xs text-neutral-500 mb-6">
                        {data.student?.username}
                        {data.student?.role ? ` · ${roleLabel(data.student.role)}` : ''}
                    </p>

                    {(() => {
                        const sessions = data.sessions || [];
                        const events = data.events || [];
                        if (sessions.length === 0 && events.length === 0) {
                            return <p className="text-sm text-neutral-500">No activity yet.</p>;
                        }
                        // Bucket events under their session (events carry
                        // session_id). Events with no/unknown session land
                        // in an "Other activity" group so nothing is hidden.
                        const bySession = new Map();
                        for (const ev of events) {
                            const k = ev.session_id == null ? '__none__' : ev.session_id;
                            if (!bySession.has(k)) bySession.set(k, []);
                            bySession.get(k).push(ev);
                        }
                        const groups = sessions.map(s => ({
                            key: s.id,
                            title: s.case_name || `Case ${s.case_id}`,
                            session: s,
                            events: bySession.get(s.id) || [],
                        }));
                        const orphan = bySession.get('__none__') || [];
                        return (
                            <div className="space-y-2">
                                <h5 className="text-sm font-bold text-neutral-200 mb-1">
                                    Activity by case ({sessions.length} session{sessions.length === 1 ? '' : 's'}, {events.length} action{events.length === 1 ? '' : 's'})
                                </h5>
                                {groups.length === 0 && orphan.length === 0 && (
                                    <p className="text-sm text-neutral-500">No sessions yet.</p>
                                )}
                                {groups.map((g, i) => (
                                    <SessionGroup key={g.key} group={g} defaultOpen={i === 0} />
                                ))}
                                {orphan.length > 0 && (
                                    <SessionGroup
                                        key="__none__"
                                        group={{ key: '__none__', title: 'Other activity (no session)', session: null, events: orphan }}
                                        defaultOpen={groups.length === 0}
                                    />
                                )}
                            </div>
                        );
                    })()}
                </>
            )}
        </div>
    );
}

// 2. Students × cases completion matrix.
function GridView({ cohortId }) {
    const toast = useToast();
    const [loading, setLoading] = useState(true);
    const [grid, setGrid] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setGrid(await getCohortGrid(cohortId));
        } catch (e) {
            toast.error(errMsg(e, 'Failed to load grid'));
        } finally {
            setLoading(false);
        }
    }, [cohortId, toast]);

    useEffect(() => { load(); }, [load]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-24 text-neutral-500">
                <Loader2 className="w-5 h-5 animate-spin" />
            </div>
        );
    }

    const students = studentOnly(grid?.students);
    const cases = grid?.cases || [];
    const cells = grid?.cells || {};
    const totalCells = students.length * cases.length;
    const completedCells = students.reduce((n, st) => {
        const row = cells[st.id] || {};
        return n + cases.filter((c) => row[c.id]?.completed).length;
    }, 0);
    const attemptedCells = students.reduce((n, st) => {
        const row = cells[st.id] || {};
        return n + cases.filter((c) => row[c.id] && !row[c.id]?.completed).length;
    }, 0);
    const untouchedCells = Math.max(totalCells - completedCells - attemptedCells, 0);
    const completionRate = totalCells ? Math.round((completedCells / totalCells) * 100) : 0;

    if (students.length === 0) {
        return (
            <div className="rounded-2xl border border-dashed border-neutral-700 bg-neutral-900/50 p-8 text-center">
                <div className="text-sm font-semibold text-neutral-200">No students enrolled</div>
                <p className="mt-1 text-sm text-neutral-500">
                    Completion reports appear after students are enrolled in this course.
                </p>
            </div>
        );
    }
    if (cases.length === 0) {
        return (
            <div className="rounded-2xl border border-dashed border-neutral-700 bg-neutral-900/50 p-8 text-center">
                <div className="text-sm font-semibold text-neutral-200">No case activity yet</div>
                <p className="mt-1 text-sm text-neutral-500">
                    The completion grid populates once enrolled students start course cases.
                </p>
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-2xl bg-white text-slate-950 shadow-2xl shadow-black/25 ring-1 ring-black/10">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                            Completion report
                        </div>
                        <h3 className="mt-1 text-lg font-bold text-slate-950">Student progress by case</h3>
                        <p className="mt-1 text-sm text-slate-500">
                            {students.length} enrolled student{students.length === 1 ? '' : 's'} across {cases.length} case{cases.length === 1 ? '' : 's'}.
                        </p>
                    </div>
                    <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-800">
                        {completionRate}% complete
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 border-b border-slate-200 bg-white md:grid-cols-4 md:divide-y-0">
                <ReportMetric label="Students" value={students.length} />
                <ReportMetric label="Cases" value={cases.length} />
                <ReportMetric label="Completed" value={completedCells} accent="text-emerald-700" />
                <ReportMetric label="Attempted" value={attemptedCells} accent="text-amber-600" />
            </div>

            <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-left">
                            <th className="sticky left-0 z-10 min-w-[220px] bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                                Student
                            </th>
                            {cases.map((c) => (
                                <th
                                    key={c.id}
                                    className="min-w-[180px] px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-slate-500"
                                    title={c.name}
                                >
                                    <span className="block truncate">{c.name}</span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {students.map((st) => {
                            const row = cells[st.id] || {};
                            return (
                                <tr key={st.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80">
                                    <td className="sticky left-0 z-10 bg-white px-4 py-3 font-semibold text-slate-950 shadow-[1px_0_0_0_rgba(226,232,240,1)]">
                                        <div>{st.name || st.username}</div>
                                        {st.username && st.name && (
                                            <div className="mt-0.5 text-xs font-normal text-slate-400">{st.username}</div>
                                        )}
                                    </td>
                                    {cases.map((c) => {
                                        const cell = row[c.id];
                                        const title = cell
                                            ? `${cell.completed ? 'Completed' : 'Attempted'} · last ${fmtTime(cell.last_activity)}`
                                            : 'Not attempted';
                                        return (
                                            <td key={c.id} className="px-4 py-3 text-center" title={title}>
                                                <StatusPill cell={cell} />
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-500">
                <div className="flex flex-wrap items-center gap-3">
                    <LegendItem tone="completed" label="Completed" />
                    <LegendItem tone="attempted" label="Attempted, not completed" />
                    <LegendItem tone="none" label="Not attempted" />
                </div>
                <span>{untouchedCells} not attempted cell{untouchedCells === 1 ? '' : 's'}</span>
            </div>
        </div>
    );
}

function ReportMetric({ label, value, accent = 'text-slate-950' }) {
    return (
        <div className="px-5 py-4">
            <div className={`text-2xl font-bold tabular-nums ${accent}`}>{value}</div>
            <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
        </div>
    );
}

function StatusPill({ cell }) {
    if (!cell) {
        return (
            <span className="inline-flex min-w-[7rem] items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-400">
                Not started
            </span>
        );
    }
    if (cell.completed) {
        return (
            <span className="inline-flex min-w-[7rem] items-center justify-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">
                <Check className="h-3.5 w-3.5" /> Completed
            </span>
        );
    }
    return (
        <span className="inline-flex min-w-[7rem] items-center justify-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
            <Circle className="h-2.5 w-2.5 fill-amber-400 text-amber-500" /> Attempted
        </span>
    );
}

function LegendItem({ tone, label }) {
    const cls = {
        completed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        attempted: 'border-amber-200 bg-amber-50 text-amber-800',
        none: 'border-slate-200 bg-white text-slate-500',
    }[tone];
    return <span className={`rounded-full border px-2.5 py-1 font-semibold ${cls}`}>{label}</span>;
}

// 3. CSV export (auth'd blob download) + optional JSON preview affordance.
function ExportView({ cohortId }) {
    const toast = useToast();
    const [busy, setBusy] = useState(false);

    const handleDownload = async () => {
        setBusy(true);
        try {
            await downloadCohortExport(cohortId);
            toast.success('CSV download started');
        } catch (e) {
            toast.error(errMsg(e, 'Export failed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <ReportShell
            eyebrow="Export"
            title="Course report export"
            description="Download a flattened student-by-case completion file for grading, audit, or LMS import."
            action={(
                <button
                    onClick={handleDownload}
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-teal-800 disabled:opacity-50"
                >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Download CSV
                </button>
            )}
        >
            <div className="grid gap-4 p-5 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm font-bold text-slate-900">Roster x cases</div>
                    <p className="mt-1 text-sm text-slate-500">One row per student-case pair with attempted/completed state.</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm font-bold text-slate-900">Audit-ready columns</div>
                    <p className="mt-1 text-sm text-slate-500">Includes course, student, case, attempted, completed, and last activity.</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm font-bold text-slate-900">Current course scope</div>
                    <p className="mt-1 text-sm text-slate-500">Export is restricted to this course and student enrolments.</p>
                </div>
            </div>
        </ReportShell>
    );
}

// 4. Live activity feed — incremental poll on the numeric learning_events.id
// cursor (`next_since`). Newest first, bounded list.
function FeedView({ cohortId }) {
    const toast = useToast();
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [paused, setPaused] = useState(false);
    // sinceRef holds the cursor outside React state so the interval closure
    // always reads the latest value without being re-created every tick (a
    // re-created interval would reset the polling cadence).
    const sinceRef = useRef(null);

    const poll = useCallback(async () => {
        try {
            const data = await getCohortFeed(cohortId, sinceRef.current);
            if (data.next_since != null) sinceRef.current = data.next_since;
            const incoming = data.events || [];
            if (incoming.length > 0) {
                // Endpoint returns newest-first; merge ahead of existing and
                // cap so the DOM list stays bounded.
                setEvents((prev) => [...incoming, ...prev].slice(0, FEED_MAX_ROWS));
            }
        } catch (e) {
            toast.error(errMsg(e, 'Failed to refresh feed'));
        } finally {
            setLoading(false);
        }
    }, [cohortId, toast]);

    useEffect(() => {
        // Initial fetch (and reset cursor) when the cohort changes.
        sinceRef.current = null;
        setEvents([]);
        setLoading(true);
        poll();
        if (paused) return undefined;
        const handle = setInterval(poll, FEED_POLL_MS);
        // Critical: clearing the interval on unmount / pause / cohort change
        // is what prevents a leaked timer firing against a stale closure.
        return () => clearInterval(handle);
    }, [poll, paused]);

    return (
        <ReportShell
            eyebrow="Live feed"
            title="Realtime course activity"
            description={`Refreshes every ${FEED_POLL_MS / 1000}s while this tab is open.`}
            action={(
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setPaused((p) => !p)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm hover:border-teal-300 hover:text-teal-800"
                    >
                        {paused ? 'Resume' : 'Pause'}
                    </button>
                    <button
                        onClick={poll}
                        title="Refresh now"
                        className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 shadow-sm hover:border-teal-300 hover:text-teal-800"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>
            )}
        >

            {loading ? (
                <div className="flex items-center justify-center h-32 text-slate-400">
                    <Loader2 className="w-5 h-5 animate-spin" />
                </div>
            ) : events.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                    No live activity yet. Student events will appear here as they work through cases.
                </div>
            ) : (
                <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
                    {events.map((ev) => (
                        <li
                            key={ev.id}
                            className="grid gap-3 px-5 py-3 text-sm hover:bg-slate-50 md:grid-cols-[10rem_10rem_1fr_8rem]"
                        >
                            <span className="font-mono text-xs text-slate-400 whitespace-nowrap">
                                {fmtTime(ev.timestamp)}
                            </span>
                            <span className="font-bold text-teal-800">{ev.verb}</span>
                            <span className="truncate text-slate-700">
                                {ev.object_name || ev.object_type || ''}
                            </span>
                            {ev.room && (
                                <span className="justify-self-start rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-500">
                                    {ev.room}
                                </span>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </ReportShell>
    );
}
