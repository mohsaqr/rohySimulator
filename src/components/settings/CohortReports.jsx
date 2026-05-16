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
    getCohortFeed, downloadCohortExport,
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
        { id: 'roster', label: 'Roster', icon: ListChecks },
        { id: 'grid', label: 'Completion grid', icon: LayoutGrid },
        { id: 'analytics', label: 'Analytics', icon: BarChart3 },
        { id: 'export', label: 'Export', icon: Download },
        { id: 'feed', label: 'Live feed', icon: Activity },
    ];

    return (
        <div>
            <div className="flex flex-wrap gap-1 mb-6 border-b border-neutral-700 pb-2">
                {tabs.map((t) => {
                    const Icon = t.icon;
                    const active = view === t.id;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setView(t.id)}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors ${
                                active
                                    ? 'bg-purple-600 text-white'
                                    : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                            }`}
                        >
                            <Icon className="w-4 h-4" /> {t.label}
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
            className={`rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden ${
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

// Analytics — a NATIVE cohort view (not the admin dashboard embedded).
// Scope is an explicit, obviously-interactive drill: Whole class → a
// student → one of their sessions. Each scope change re-queries the
// member-scoped /cohorts/:id/analytics/* endpoints and re-renders the
// same SVG charts the admin dashboard uses, but on THIS panel's dark
// surface — no light-grey slab, no redundant generic filter bar, no
// TNA/network machinery a teacher didn't ask for.
function AnalyticsView({ cohortId }) {
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
            .then((d) => setRoster(d.roster || []))
            .catch((e) => toast.error(errMsg(e, 'Failed to load class roster')));
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
                        <div className="grid grid-cols-2 lg:grid-cols-4 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden divide-x divide-y lg:divide-y-0 divide-gray-100">
                            <StatTile label="Events" value={data.summary.totalActivities} accent />
                            <StatTile label="Sessions" value={data.summary.uniqueSessions} />
                            <StatTile
                                label={student ? 'Student' : 'Students'}
                                value={student ? (student.name || student.username) : data.summary.uniqueUsers}
                            />
                            <StatTile label="Avg events / student" value={data.summary.avgPerUser} />
                        </div>

                        {data.summary.totalActivities === 0 ? (
                            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-14 text-center">
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
            setRoster(data.roster || []);
        } catch (e) {
            toast.error(errMsg(e, 'Failed to load roster'));
        } finally {
            setLoading(false);
        }
    }, [cohortId, toast]);

    useEffect(() => { load(); }, [load]);

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
            <div className="flex items-center justify-center h-24 text-neutral-500">
                <Loader2 className="w-5 h-5 animate-spin" />
            </div>
        );
    }

    if (roster.length === 0) {
        return <p className="text-sm text-neutral-500">No members in this class yet.</p>;
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-left text-neutral-400 border-b border-neutral-700">
                        <th className="py-2 pr-4 font-medium">Student</th>
                        <th className="py-2 px-2 font-medium text-right">Sessions</th>
                        <th className="py-2 px-2 font-medium text-right">Attempted</th>
                        <th className="py-2 px-2 font-medium text-right">Completed</th>
                        <th className="py-2 pl-2 font-medium">Last activity</th>
                    </tr>
                </thead>
                <tbody>
                    {roster.map((s) => (
                        <tr
                            key={s.id}
                            className="border-b border-neutral-800 hover:bg-neutral-800/50 cursor-pointer"
                            onClick={() => setOpenStudent(s.id)}
                        >
                            <td className="py-2 pr-4">
                                <div className="font-medium text-white">{s.name || s.username}</div>
                                <div className="text-xs text-neutral-500">
                                    {s.username}
                                    {s.role ? ` · ${roleLabel(s.role)}` : ''}
                                </div>
                            </td>
                            <td className="py-2 px-2 text-right tabular-nums">{s.session_count ?? 0}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{s.cases_attempted ?? 0}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{s.cases_completed ?? 0}</td>
                            <td className="py-2 pl-2 text-neutral-400 text-xs whitespace-nowrap">
                                {fmtTime(s.last_activity)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
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

    const students = grid?.students || [];
    const cases = grid?.cases || [];
    const cells = grid?.cells || {};

    if (students.length === 0) {
        return <p className="text-sm text-neutral-500">No members in this class yet.</p>;
    }
    if (cases.length === 0) {
        return (
            <p className="text-sm text-neutral-500">
                No cases attempted by this class yet — the grid will populate once
                students start sessions.
            </p>
        );
    }

    return (
        <div className="overflow-x-auto">
            <table className="text-sm border-collapse">
                <thead>
                    <tr>
                        <th className="sticky left-0 bg-neutral-900 py-2 pr-4 text-left text-neutral-400 font-medium">
                            Student
                        </th>
                        {cases.map((c) => (
                            <th
                                key={c.id}
                                className="py-2 px-2 text-neutral-400 font-medium text-center min-w-[3rem]"
                                title={c.name}
                            >
                                <span className="block max-w-[7rem] truncate mx-auto">{c.name}</span>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {students.map((st) => {
                        const row = cells[st.id] || {};
                        return (
                            <tr key={st.id} className="border-t border-neutral-800">
                                <td className="sticky left-0 bg-neutral-900 py-2 pr-4 text-white whitespace-nowrap">
                                    {st.name || st.username}
                                </td>
                                {cases.map((c) => {
                                    const cell = row[c.id];
                                    const title = cell
                                        ? `${cell.completed ? 'Completed' : 'Attempted'} · last ${fmtTime(cell.last_activity)}`
                                        : 'Not attempted';
                                    return (
                                        <td
                                            key={c.id}
                                            className="py-2 px-2 text-center"
                                            title={title}
                                        >
                                            {!cell ? (
                                                <span className="text-neutral-700">·</span>
                                            ) : cell.completed ? (
                                                <Check className="w-4 h-4 text-green-400 inline" />
                                            ) : (
                                                <Circle className="w-2.5 h-2.5 text-amber-400 inline fill-amber-400" />
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <p className="text-xs text-neutral-500 mt-3">
                <Check className="w-3 h-3 text-green-400 inline" /> completed ·{' '}
                <Circle className="w-2 h-2 text-amber-400 inline fill-amber-400" /> attempted ·{' '}
                <span className="text-neutral-700">·</span> not attempted. Hover a
                cell for last activity.
            </p>
        </div>
    );
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
        <div className="max-w-lg">
            <p className="text-sm text-neutral-400 mb-4">
                Download a flattened roster × case completion report (one row per
                student-case pair) for grading or LMS import.
            </p>
            <button
                onClick={handleDownload}
                disabled={busy}
                className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg font-medium text-sm flex items-center gap-2 transition-colors"
            >
                {busy
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Download className="w-4 h-4" />}
                Download CSV
            </button>
            <p className="text-xs text-neutral-500 mt-3">
                Columns: cohort_id, cohort_name, user_id, username, name, case_id,
                case_name, attempted, completed, last_activity.
            </p>
        </div>
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
        <div>
            <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-neutral-400">
                    Live class activity — refreshes every {FEED_POLL_MS / 1000}s.
                </p>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setPaused((p) => !p)}
                        className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium transition-colors"
                    >
                        {paused ? 'Resume' : 'Pause'}
                    </button>
                    <button
                        onClick={poll}
                        title="Refresh now"
                        className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center h-24 text-neutral-500">
                    <Loader2 className="w-5 h-5 animate-spin" />
                </div>
            ) : events.length === 0 ? (
                <p className="text-sm text-neutral-500">No activity yet.</p>
            ) : (
                <ul className="space-y-0.5 max-h-[28rem] overflow-y-auto">
                    {events.map((ev) => (
                        <li
                            key={ev.id}
                            className="flex items-baseline gap-2 text-xs py-1 border-b border-neutral-800/60"
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
            )}
        </div>
    );
}
