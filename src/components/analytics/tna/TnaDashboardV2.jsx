// LAILA-style TNA Dashboard for the simulator domain.
//
// Replicates client/src/pages/admin/Dashboard.tsx from LAILA-v3 with the
// minimum adaptations the simulator needs:
//   - React Query → useState + useEffect + fetch (matches the rohy pattern
//     used elsewhere, e.g. MedicationManager).
//   - Course → Case in labels and the filter selector.
//   - Adds a 6th tab: Process Map (dynajs DFG + dagre, see ProcessMap.jsx).
//   - 12 educational states → 10 clinical states (see clinicalStates.js).
//
// Six tabs:
//   activity  — daily timeline, hourly heatmap, top-event donut, top resources
//   network   — TNA + centralities + distribution + index plot
//   clusters  — clusterData (PAM/single/complete/average/ward, 4 dissimilarity)
//   patterns  — discoverPatterns short (2–3) + long (4–7)
//   process   — directly-follows graph with cumulative-95% pruning
//   settings  — sequence mode, interpretation editor, verb renames/excludes
//
// Sequence mode flow (the centrepiece — drives every model downstream):
//   verb         → server-returned verb sequences as-is
//   objectType   → server-returned objectType sequences
//   raw          → join verb + ':' + object as state literals
//   combined     → resolve via clinicalStates (explicit → object → verb fallback)

import React, { useEffect, useMemo, useState } from 'react';
import {
    ArrowLeft, RefreshCw, Settings2, Users, Activity, Hash, Network, GitBranch,
    Workflow, Layers,
} from 'lucide-react';
import {
    tna, ftna, ctna, atna,
    centralities, prune, summary, layout as dynaLayout,
} from 'dynajs';
import { apiFetch } from '../../../services/apiClient';

import { TnaNetworkGraph } from './laila/TnaNetworkGraph';
import { TnaDistributionPlot } from './laila/TnaDistributionPlot';
import { TnaIndexPlot } from './laila/TnaIndexPlot';
import { TnaFrequencyChart } from './laila/TnaFrequencyChart';
import { CentralityBarChart } from './laila/CentralityBarChart';
import { TnaCentralityTable } from './laila/TnaCentralityTable';
import { ClustersTab } from './laila/ClustersTab';
import { PatternsTab } from './laila/PatternsTab';
import { ActivityTimelineChart } from './laila/ActivityTimelineChart';
import { ActivityDonutChart } from './laila/ActivityDonutChart';
import { ActivityHeatmap } from './laila/ActivityHeatmap';
import { Loading } from './laila/Loading';
import { createColorMap, PALETTE_NAMES } from './laila/colorFix';
import ProcessMap from './laila/ProcessMap';

import {
    DEFAULT_INTERPRETATIONS, OBJECT_OVERRIDES, VERB_FALLBACKS,
} from './clinicalStates';

const MODEL_BUILDERS = { relative: tna, frequency: ftna, 'co-occurrence': ctna, attention: atna };
const LAYOUT_OPTIONS = [
    { value: 'circle',        label: 'Circle' },
    { value: 'fr',            label: 'Force' },
    { value: 'kamada-kawai',  label: 'Kamada–Kawai' },
    { value: 'spectral',      label: 'Spectral' },
    { value: 'concentric',    label: 'Concentric' },
    { value: 'star',          label: 'Star' },
    { value: 'hierarchical',  label: 'Hierarchical' },
    { value: 'grid',          label: 'Grid' },
    { value: 'random',        label: 'Random' },
];
const NODE_SIZE_OPTIONS = [
    { value: 'fixed',      label: 'Fixed' },
    { value: 'InStrength', label: 'In-strength' },
];

function resolveInterpretation(key, customMap) {
    if (customMap && customMap[key]) return customMap[key];
    if (DEFAULT_INTERPRETATIONS[key]) return DEFAULT_INTERPRETATIONS[key];
    const [verb, obj] = key.split(':');
    if (obj && OBJECT_OVERRIDES[obj]) return OBJECT_OVERRIDES[obj];
    if (verb && VERB_FALLBACKS[verb]) return VERB_FALLBACKS[verb];
    return null;
}

function StatCard({ icon, label, value, accent = 'cyan' }) {
    const colors = {
        cyan:   'bg-cyan-50 text-cyan-700 border-cyan-200',
        green:  'bg-emerald-50 text-emerald-700 border-emerald-200',
        amber:  'bg-amber-50 text-amber-700 border-amber-200',
        violet: 'bg-violet-50 text-violet-700 border-violet-200',
        rose:   'bg-rose-50 text-rose-700 border-rose-200',
    };
    return (
        <div className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${colors[accent] || colors.cyan}`}>
            {icon}
            <div className="flex flex-col">
                <span className="text-lg font-bold leading-tight">{value}</span>
                <span className="text-xs opacity-80">{label}</span>
            </div>
        </div>
    );
}

// `embedded`: render as a flat content block (suitable for a Settings
// tab) instead of the fixed full-screen overlay used when the dashboard
// is launched from the user menu. When `embedded`, no close button or
// full-viewport positioning is applied.
export default function TnaDashboardV2({ onClose, embedded = false }) {
    // --- Filters ---
    const [caseId, setCaseId] = useState('');
    const [userId, setUserId] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [groupBy, setGroupBy] = useState('actor-session');

    // --- Active tab ---
    const [activeTab, setActiveTab] = useState('network');

    // --- Network controls ---
    const [pruneThreshold, setPruneThreshold] = useState(0.05);
    const [modelType, setModelType] = useState('relative');
    const [graphLayout, setGraphLayout] = useState('circle');
    const [nodeRadius, setNodeRadius] = useState(25);
    const [nodeSizeMetric, setNodeSizeMetric] = useState('fixed');
    const [showSelfLoops, setShowSelfLoops] = useState(false);
    const [showEdgeLabels, setShowEdgeLabels] = useState(true);
    const [palette, setPalette] = useState('default');
    const [seqView, setSeqView] = useState('distribution');

    // --- Cluster + pattern controls ---
    const [clusterK, setClusterK] = useState(3);
    const [clusterDissimilarity, setClusterDissimilarity] = useState('hamming');
    const [clusterMethod, setClusterMethod] = useState('pam');
    const [shortLengths, setShortLengths] = useState({ 2: true, 3: true });
    const [longLengths, setLongLengths] = useState({ 4: true, 5: true });

    // --- Sequence mode + verb editing ---
    const [sequenceMode, setSequenceMode] = useState('combined');
    const [interpretations, setInterpretations] = useState({ ...DEFAULT_INTERPRETATIONS });
    const [verbRenames, setVerbRenames] = useState({});
    const [verbExcludes, setVerbExcludes] = useState({});

    // --- Server data ---
    const [filterOptions, setFilterOptions] = useState({ cases: [], users: [] });
    const [tnaData, setTnaData] = useState(null);
    const [activityBundle, setActivityBundle] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(0);

    const isAnalyticsRelated = activeTab === 'network' || activeTab === 'clusters' || activeTab === 'patterns' || activeTab === 'process' || activeTab === 'settings';
    const isActivityTab = activeTab === 'activity';

    // --- Load filter options once ---
    useEffect(() => {
        // Pre-fix this used raw fetch + Bearer ${getToken()} which sent
        // literal "Bearer null" for cookie-mode users → 403 → empty
        // analytics. apiFetch handles the no-token case by falling
        // through to the rohy_auth cookie.
        apiFetch('/analytics/filter-options')
            .then((d) => setFilterOptions({ cases: d?.cases || [], users: d?.users || [] }))
            .catch(() => {});
    }, []);

    // --- Fetch TNA sequences when filters change and we're on an analytics-style tab ---
    useEffect(() => {
        if (!isAnalyticsRelated) return;
        const params = new URLSearchParams();
        if (caseId) params.set('case_id', caseId);
        if (userId) params.set('user_id', userId);
        if (startDate) params.set('start_date', startDate);
        if (endDate) params.set('end_date', endDate);
        params.set('group_by', groupBy);
        params.set('skip_merges', 'true'); // client resolver chain handles merging

        setLoading(true);
        setError(null);
        apiFetch(`/analytics/tna-sequences?${params}`)
            .then((d) => { setTnaData(d); setLastUpdated(Date.now()); })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, [caseId, userId, startDate, endDate, groupBy, isAnalyticsRelated]);

    // --- Fetch activity bundle for the Activity tab ---
    useEffect(() => {
        if (!isActivityTab) return;
        const params = new URLSearchParams();
        if (caseId) params.set('case_id', caseId);
        if (userId) params.set('user_id', userId);
        if (startDate) params.set('start_date', startDate);
        if (endDate) params.set('end_date', endDate);

        Promise.all([
            apiFetch(`/analytics/summary?${params}`),
            apiFetch(`/analytics/timeline-series?${params}`),
            apiFetch(`/analytics/hourly-counts?${params}`),
            apiFetch(`/analytics/stats?${params}`),
            apiFetch(`/analytics/top-resources?${params}`),
        ]).then(([summaryD, timelineD, hourlyD, statsD, resourcesD]) => {
            setActivityBundle({
                summary: summaryD,
                timeline: timelineD,                  // {days, verbs, series}
                heatmap: hourlyD.hourly || [],        // [{dow, hour, count}]
                stats: statsD,
                resources: resourcesD.resources || [],
            });
            setLastUpdated(Date.now());
        }).catch((err) => setError(err.message));
    }, [caseId, userId, startDate, endDate, isActivityTab]);

    // --- Transform sequences by mode + renames + excludes ---
    const transformedData = useMemo(() => {
        if (!tnaData?.sequences?.length) return null;
        const verbSeqs = tnaData.sequences;
        const objSeqs = tnaData.objectTypeSequences ?? [];

        let baseSeqs;
        if (sequenceMode === 'objectType') {
            baseSeqs = objSeqs.length ? objSeqs : verbSeqs;
        } else if (sequenceMode === 'raw') {
            baseSeqs = verbSeqs.map((seq, i) => {
                const objSeq = objSeqs[i] ?? [];
                return seq.map((verb, j) => {
                    const obj = objSeq[j] ?? '';
                    return obj ? `${verb}:${obj}` : verb;
                });
            });
        } else if (sequenceMode === 'combined') {
            baseSeqs = verbSeqs.map((seq, i) => {
                const objSeq = objSeqs[i] ?? [];
                return seq.map((verb, j) => {
                    const obj = objSeq[j] ?? '';
                    const key = `${verb}:${obj}`;
                    return resolveInterpretation(key, interpretations) ?? `${verb}_${obj}`;
                });
            });
        } else {
            baseSeqs = verbSeqs;
        }

        const seqs = baseSeqs.map((seq) =>
            seq
                .map((v) => verbExcludes[v] ? null : (verbRenames[v] || v))
                .filter((v) => v !== null)
        ).filter((seq) => seq.length >= 2);

        const labelSet = new Set();
        for (const seq of seqs) for (const v of seq) labelSet.add(v);
        const labels = [...labelSet].sort();

        return { sequences: seqs, labels };
    }, [tnaData, sequenceMode, interpretations, verbRenames, verbExcludes]);

    // --- Build TNA model ---
    const analysis = useMemo(() => {
        if (!transformedData?.sequences?.length) return null;
        try {
            const builder = MODEL_BUILDERS[modelType];
            const rawModel = builder(transformedData.sequences, { labels: transformedData.labels });
            const prunedModel = prune(rawModel, pruneThreshold);
            const cm = createColorMap(transformedData.labels, palette);

            let cent = null;
            try {
                const raw = centralities(rawModel);
                const measures = {};
                for (const [k, v] of Object.entries(raw.measures)) measures[k] = Array.from(v);
                cent = { labels: raw.labels, measures };
            } catch { /* ignore */ }

            let sum = null;
            try { sum = summary(rawModel); } catch { /* ignore */ }

            return { rawModel, prunedModel, labels: transformedData.labels, colorMap: cm, centralityData: cent, summaryData: sum };
        } catch (err) {
            console.error('TNA build failed:', err);
            return null;
        }
    }, [transformedData, pruneThreshold, modelType, palette]);

    // --- Layout positions (network tab) ---
    const graphPositions = useMemo(() => {
        if (!analysis?.prunedModel) return undefined;
        try {
            const result = dynaLayout(analysis.prunedModel, { algorithm: graphLayout });
            const h = 380;
            const pad = nodeRadius + 5;
            return Array.from({ length: result.labels.length }, (_, i) => ({
                x: pad + result.x[i] * (h - 2 * pad),
                y: pad + result.y[i] * (h - 2 * pad),
            }));
        } catch {
            return undefined;
        }
    }, [analysis?.prunedModel, graphLayout, nodeRadius]);

    const refresh = () => {
        // Force the effect to re-fire by toggling a noop on the deps.
        setLastUpdated((t) => t + 1);
    };

    const tabs = [
        { id: 'activity',  label: 'Activity',  icon: Activity },
        { id: 'network',   label: 'Network',   icon: Network },
        { id: 'clusters',  label: 'Clusters',  icon: Layers },
        { id: 'patterns',  label: 'Patterns',  icon: Hash },
        { id: 'process',   label: 'Process Map', icon: Workflow },
        { id: 'settings',  label: 'Settings',  icon: Settings2 },
    ];

    // ===========================================================================
    // Light-grey theme — analytics deliberately breaks from the
    // simulator's near-black cockpit. `-m-8 p-8` lets the embedded
    // wrapper bleed past the Settings padding so the grey reaches the
    // panel edges instead of leaving a black border.
    const Outer = embedded
        ? ({ children }) => (
            <div className="-m-8 p-8 bg-gray-200 text-gray-900 min-h-full">{children}</div>
        )
        : ({ children }) => (
            <div className="fixed inset-0 z-40 bg-gray-200 text-gray-900 overflow-auto">
                <div className="max-w-[1600px] mx-auto p-6">{children}</div>
            </div>
        );

    return (
        <Outer>
                {/* Header — hidden when embedded since the parent (Settings tab) already has one */}
                {!embedded && (
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        {onClose && (
                            <button onClick={onClose} className="p-2 rounded hover:bg-gray-200" title="Close">
                                <ArrowLeft className="w-5 h-5" />
                            </button>
                        )}
                        <h1 className="text-2xl font-bold">Analytics</h1>
                        {tnaData?.metadata?.caseTitle && (
                            <span className="text-sm text-gray-600">{tnaData.metadata.caseTitle}</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                        {lastUpdated > 0 && (
                            <span>{new Date(lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        )}
                        <button onClick={refresh} className="p-2 rounded hover:bg-gray-200" title="Refresh">
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>
                )}

                {/* Tabs */}
                <div className="flex flex-wrap gap-1 border-b border-neutral-800 mb-4">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`px-4 py-2 text-sm font-medium rounded-t flex items-center gap-2 transition-colors ${
                                    activeTab === tab.id
                                        ? 'bg-cyan-50 text-cyan-700 border-b-2 border-cyan-500'
                                        : 'text-gray-600 hover:text-gray-900'
                                }`}
                            >
                                <Icon className="w-4 h-4" />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                {/* Filters */}
                <div className="flex flex-wrap items-end gap-3 mb-4 p-3 bg-white border border-gray-200 rounded-lg">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-600">Case</label>
                        <select value={caseId} onChange={(e) => setCaseId(e.target.value)} className="px-2 py-1 text-sm bg-white border border-gray-300 rounded">
                            <option value="">All cases</option>
                            {filterOptions.cases.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                        </select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-600">Student</label>
                        <select value={userId} onChange={(e) => setUserId(e.target.value)} className="px-2 py-1 text-sm bg-white border border-gray-300 rounded">
                            <option value="">All students</option>
                            {filterOptions.users.map((u) => <option key={u.id} value={u.id}>{u.fullname || u.username}</option>)}
                        </select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-600">Start</label>
                        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-2 py-1 text-sm bg-white border border-gray-300 rounded"/>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-600">End</label>
                        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="px-2 py-1 text-sm bg-white border border-gray-300 rounded"/>
                    </div>
                    {isAnalyticsRelated && (
                        <>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-gray-600">Group by</label>
                                <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="px-2 py-1 text-sm bg-white border border-gray-300 rounded">
                                    <option value="actor-session">Per session</option>
                                    <option value="actor">Per student</option>
                                </select>
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-gray-600">Mode</label>
                                <select value={sequenceMode} onChange={(e) => setSequenceMode(e.target.value)} className="px-2 py-1 text-sm bg-white border border-gray-300 rounded">
                                    <option value="combined">Clinical state</option>
                                    <option value="verb">Verb only</option>
                                    <option value="objectType">Object only</option>
                                    <option value="raw">Raw verb:object</option>
                                </select>
                            </div>
                        </>
                    )}
                </div>

                {/* Stat cards */}
                {tnaData?.metadata && isAnalyticsRelated && (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
                        <StatCard icon={<Users className="w-5 h-5" />} value={tnaData.metadata.totalSequences} label="Sequences" accent="cyan" />
                        <StatCard icon={<Activity className="w-5 h-5" />} value={tnaData.metadata.totalEvents} label="Events" accent="green" />
                        <StatCard icon={<Hash className="w-5 h-5" />} value={transformedData?.labels.length ?? '—'} label={sequenceMode === 'combined' ? 'States' : sequenceMode === 'objectType' ? 'Object types' : 'Verbs'} accent="amber" />
                        {analysis?.summaryData?.density != null && (
                            <StatCard icon={<Network className="w-5 h-5" />} value={`${(analysis.summaryData.density * 100).toFixed(1)}%`} label="Density" accent="violet" />
                        )}
                        {analysis?.summaryData?.nEdges != null && (
                            <StatCard icon={<GitBranch className="w-5 h-5" />} value={analysis.summaryData.nEdges} label="Edges" accent="rose" />
                        )}
                    </div>
                )}

                {error && (
                    <div className="mb-3 p-3 rounded bg-red-900/30 border border-red-800 text-red-200 text-sm">
                        {error}
                    </div>
                )}

                {/* Content */}
                {loading && !tnaData && <Loading text="Loading sequences…" />}

                {/* === ACTIVITY TAB === */}
                {isActivityTab && activityBundle && (
                    <div className="space-y-4">
                        {activityBundle.summary && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <StatCard icon={<Activity className="w-5 h-5" />} value={activityBundle.summary.totalActivities} label="Total events" accent="cyan" />
                                <StatCard icon={<Users className="w-5 h-5" />} value={activityBundle.summary.uniqueUsers} label="Users" accent="green" />
                                <StatCard icon={<Hash className="w-5 h-5" />} value={activityBundle.summary.uniqueSessions} label="Sessions" accent="amber" />
                                <StatCard icon={<Network className="w-5 h-5" />} value={activityBundle.summary.avgPerUser} label="Avg / user" accent="violet" />
                            </div>
                        )}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <div className="bg-white border border-gray-200 rounded-lg p-4">
                                <h3 className="text-sm font-bold text-gray-800 mb-2">Activity over time</h3>
                                {activityBundle.timeline?.days?.length ? (
                                    <ActivityTimelineChart
                                        days={activityBundle.timeline.days}
                                        verbs={activityBundle.timeline.verbs}
                                        series={activityBundle.timeline.series}
                                        palette={palette}
                                    />
                                ) : <div className="text-xs text-gray-500 py-8 text-center">No timeline data</div>}
                            </div>
                            <div className="bg-white border border-gray-200 rounded-lg p-4">
                                <h3 className="text-sm font-bold text-gray-800 mb-2">Day-of-week × hour heatmap</h3>
                                <ActivityHeatmap data={activityBundle.heatmap || []} />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <div className="bg-white border border-gray-200 rounded-lg p-4">
                                <h3 className="text-sm font-bold text-gray-800 mb-2">Verbs</h3>
                                {/* Donut expects a plain object {label: count}, not an array. */}
                                <ActivityDonutChart
                                    data={Object.fromEntries((activityBundle.stats?.verbs || []).map((r) => [r.label, r.count]))}
                                    palette={palette}
                                />
                            </div>
                            <div className="bg-white border border-gray-200 rounded-lg p-4">
                                <h3 className="text-sm font-bold text-gray-800 mb-2">Object types</h3>
                                <ActivityDonutChart
                                    data={Object.fromEntries((activityBundle.stats?.objectTypes || []).map((r) => [r.label, r.count]))}
                                    palette={palette}
                                />
                            </div>
                        </div>
                        {activityBundle.resources?.length > 0 && (
                            <div className="bg-white border border-gray-200 rounded-lg p-4">
                                <h3 className="text-sm font-bold text-gray-800 mb-2">Top resources</h3>
                                <table className="w-full text-sm">
                                    <thead className="text-xs text-gray-600">
                                        <tr><th className="text-left py-1">Object type</th><th className="text-left py-1">Name</th><th className="text-right py-1">Count</th></tr>
                                    </thead>
                                    <tbody>
                                        {activityBundle.resources.map((r, i) => (
                                            <tr key={i} className="border-t border-neutral-800">
                                                <td className="py-1 text-gray-600">{r.object_type}</td>
                                                <td className="py-1">{r.object_name}</td>
                                                <td className="py-1 text-right text-cyan-300">{r.n}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* === NETWORK TAB === */}
                {activeTab === 'network' && analysis && (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-end gap-3 p-3 bg-white border border-gray-200 rounded-lg">
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-gray-600">Prune: {pruneThreshold.toFixed(2)}</label>
                                <input type="range" min={0} max={0.5} step={0.01} value={pruneThreshold} onChange={(e) => setPruneThreshold(parseFloat(e.target.value))} className="w-32" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-gray-600">Model</label>
                                <select value={modelType} onChange={(e) => setModelType(e.target.value)} className="px-2 py-1 text-sm bg-white border border-gray-300 rounded">
                                    <option value="relative">Relative</option>
                                    <option value="frequency">Frequency</option>
                                    <option value="co-occurrence">Co-occurrence</option>
                                    <option value="attention">Attention</option>
                                </select>
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-gray-600">Layout</label>
                                <select value={graphLayout} onChange={(e) => setGraphLayout(e.target.value)} className="px-2 py-1 text-sm bg-white border border-gray-300 rounded">
                                    {LAYOUT_OPTIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                                </select>
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-gray-600">Node size</label>
                                <select value={nodeSizeMetric} onChange={(e) => setNodeSizeMetric(e.target.value)} className="px-2 py-1 text-sm bg-white border border-gray-300 rounded">
                                    {NODE_SIZE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-gray-600">Palette</label>
                                <select value={palette} onChange={(e) => setPalette(e.target.value)} className="px-2 py-1 text-sm bg-white border border-gray-300 rounded">
                                    {PALETTE_NAMES.map((p) => <option key={p} value={p}>{p}</option>)}
                                </select>
                            </div>
                            <label className="text-xs text-gray-700 flex items-center gap-1">
                                <input type="checkbox" checked={showSelfLoops} onChange={(e) => setShowSelfLoops(e.target.checked)} />
                                Self-loops
                            </label>
                            <label className="text-xs text-gray-700 flex items-center gap-1">
                                <input type="checkbox" checked={showEdgeLabels} onChange={(e) => setShowEdgeLabels(e.target.checked)} />
                                Edge labels
                            </label>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <div className="bg-white border border-gray-200 rounded-lg p-4">
                                <TnaNetworkGraph
                                    model={analysis.prunedModel}
                                    showSelfLoops={showSelfLoops}
                                    showEdgeLabels={showEdgeLabels}
                                    nodeRadius={nodeRadius}
                                    colorMap={analysis.colorMap}
                                    centralityData={analysis.centralityData}
                                    nodeSizeMetric={nodeSizeMetric}
                                    modelType={modelType}
                                    externalPositions={graphPositions}
                                />
                            </div>
                            <div className="space-y-4">
                                {analysis.centralityData && (
                                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                                        <h3 className="text-sm font-bold mb-2">Centrality</h3>
                                        <CentralityBarChart centralityData={analysis.centralityData} colorMap={analysis.colorMap} />
                                    </div>
                                )}
                                <div className="bg-white border border-gray-200 rounded-lg p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-sm font-bold">{seqView === 'distribution' ? 'State distribution' : 'Index plot'}</h3>
                                        <button onClick={() => setSeqView((v) => v === 'distribution' ? 'index' : 'distribution')} className="text-xs text-cyan-400 hover:text-cyan-300">
                                            Toggle
                                        </button>
                                    </div>
                                    {seqView === 'distribution'
                                        ? <TnaDistributionPlot sequences={transformedData.sequences} labels={transformedData.labels} colorMap={analysis.colorMap} />
                                        : <TnaIndexPlot sequences={transformedData.sequences} labels={transformedData.labels} colorMap={analysis.colorMap} />}
                                </div>
                                <div className="bg-white border border-gray-200 rounded-lg p-4">
                                    <h3 className="text-sm font-bold mb-2">Verb frequency</h3>
                                    <TnaFrequencyChart sequences={transformedData.sequences} labels={transformedData.labels} colorMap={analysis.colorMap} />
                                </div>
                            </div>
                        </div>
                        {analysis.centralityData && (
                            <div className="bg-white border border-gray-200 rounded-lg p-4">
                                <TnaCentralityTable centralityData={analysis.centralityData} colorMap={analysis.colorMap} />
                            </div>
                        )}
                    </div>
                )}

                {/* === CLUSTERS TAB === */}
                {activeTab === 'clusters' && transformedData && (
                    <ClustersTab
                        sequences={transformedData.sequences}
                        labels={transformedData.labels}
                        k={clusterK}
                        onKChange={setClusterK}
                        nodeRadius={16}
                        pruneThreshold={pruneThreshold}
                        showSelfLoops={showSelfLoops}
                        showEdgeLabels={showEdgeLabels}
                        palette={palette}
                        dissimilarity={clusterDissimilarity}
                        clusterMethod={clusterMethod}
                    />
                )}

                {/* === PATTERNS TAB === */}
                {activeTab === 'patterns' && transformedData && analysis && (
                    <PatternsTab
                        sequences={transformedData.sequences}
                        colorMap={analysis.colorMap}
                        shortEnabled={shortLengths}
                        onShortEnabledChange={setShortLengths}
                        longEnabled={longLengths}
                        onLongEnabledChange={setLongLengths}
                    />
                )}

                {/* === PROCESS MAP TAB === */}
                {activeTab === 'process' && transformedData && (
                    <ProcessMap sequences={transformedData.sequences} labels={transformedData.labels} />
                )}

                {/* === SETTINGS TAB === */}
                {activeTab === 'settings' && (
                    <div className="space-y-4">
                        <div className="bg-white border border-gray-200 rounded-lg p-4">
                            <h3 className="text-sm font-bold text-gray-800 mb-2">Cluster controls</h3>
                            <div className="flex flex-wrap gap-3 items-end">
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs text-gray-600">k = {clusterK}</label>
                                    <input type="range" min={2} max={8} value={clusterK} onChange={(e) => setClusterK(parseInt(e.target.value, 10))} className="w-32"/>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs text-gray-600">Dissimilarity</label>
                                    <select value={clusterDissimilarity} onChange={(e) => setClusterDissimilarity(e.target.value)} className="px-2 py-1 text-sm bg-white border border-gray-300 rounded">
                                        <option value="hamming">Hamming</option>
                                        <option value="lv">Levenshtein</option>
                                        <option value="osa">OSA</option>
                                        <option value="lcs">LCS</option>
                                    </select>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs text-gray-600">Method</label>
                                    <select value={clusterMethod} onChange={(e) => setClusterMethod(e.target.value)} className="px-2 py-1 text-sm bg-white border border-gray-300 rounded">
                                        <option value="pam">PAM</option>
                                        <option value="ward">Ward</option>
                                        <option value="single">Single</option>
                                        <option value="complete">Complete</option>
                                        <option value="average">Average</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {transformedData?.labels.length > 0 && (
                            <div className="bg-white border border-gray-200 rounded-lg p-4">
                                <h3 className="text-sm font-bold text-gray-800 mb-2">Verb editor</h3>
                                <p className="text-xs text-gray-600 mb-2">Rename or exclude states. Renames merge two states into one (use the same target name twice).</p>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-96 overflow-auto">
                                    {transformedData.labels.map((label) => (
                                        <div key={label} className="flex items-center gap-2 px-2 py-1 bg-gray-100 rounded text-xs">
                                            <input
                                                type="checkbox"
                                                checked={!verbExcludes[label]}
                                                onChange={(e) => setVerbExcludes({ ...verbExcludes, [label]: !e.target.checked })}
                                                title={verbExcludes[label] ? 'Hidden' : 'Visible'}
                                            />
                                            <span className="text-gray-600 truncate flex-1">{label}</span>
                                            <input
                                                type="text"
                                                placeholder="rename to…"
                                                value={verbRenames[label] || ''}
                                                onChange={(e) => setVerbRenames({ ...verbRenames, [label]: e.target.value })}
                                                className="w-24 px-1 py-0.5 bg-white border border-gray-300 rounded text-xs"
                                            />
                                        </div>
                                    ))}
                                </div>
                                <div className="flex justify-end gap-2 mt-3">
                                    <button onClick={() => { setVerbRenames({}); setVerbExcludes({}); }} className="px-3 py-1 text-xs bg-white hover:bg-gray-100 border border-gray-200 rounded">
                                        Reset
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
        </Outer>
    );
}
