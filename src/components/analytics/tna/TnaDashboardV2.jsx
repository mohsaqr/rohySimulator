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
//   activity  — state timeline, student matrix, top-event donut, top resources
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
    Workflow, Layers, Eye, ScanEye, ListVideo, Smile,
    GitCompare, CalendarDays, Clock3, BookOpen, Database, Brain,
} from 'lucide-react';
import OyonAttentionV2 from '../../oyon/OyonAttentionV2';
import OyonAffectV2 from '../../oyon/OyonAffectV2';
import OyonGazeView from '../../oyon/OyonGazeView';
import OyonCompareView from '../../oyon/OyonCompareView';
import OyonSessionsView from '../../oyon/OyonSessionsView';
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
import { ActivityDonutChart } from './laila/ActivityDonutChart';
import { Loading } from './laila/Loading';
import { createColorMap, PALETTE_NAMES } from './laila/colorFix';
import ProcessMap from './laila/ProcessMap';
import StackedAreaChart from '../charts/StackedAreaChart';
import DayHourMatrix from '../charts/DayHourMatrix';

import {
    DEFAULT_INTERPRETATIONS, OBJECT_OVERRIDES, VERB_FALLBACKS,
} from './clinicalStates';
import {
    eventStateLabels, filterEvents, toDailyStateSeries, toMatrixEvents,
} from './activityEvents';
import { recordsToEmotionSequences } from './emotionSequences';
import { recordsToRoomSequences, recordsToGazeTargetSequences } from './windowSequences';
import { observedDominantLabels, probabilityChannelLabels } from '../../oyon/emotionVocabulary';

const MODEL_BUILDERS = { relative: tna, frequency: ftna, 'co-occurrence': ctna, attention: atna };
// Newest-rows cap for the /learning-events/all fetch behind the Activity-tab
// charts; when the response hits it, a note flags the truncation.
const EVENTS_FETCH_LIMIT = 5000;
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
        cyan:   'from-cyan-50 to-white text-cyan-700 ring-cyan-100',
        green:  'from-emerald-50 to-white text-emerald-700 ring-emerald-100',
        amber:  'from-amber-50 to-white text-amber-700 ring-amber-100',
        teal:   'from-teal-50 to-white text-teal-700 ring-teal-100',
        rose:   'from-rose-50 to-white text-rose-700 ring-rose-100',
    };
    return (
        <div className="group relative overflow-hidden rounded-md border border-gray-200 bg-gradient-to-br from-white to-gray-50 px-4 py-3 shadow-sm">
            <div className="flex items-start gap-3">
                <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-md bg-gradient-to-br ring-1 ${colors[accent] || colors.cyan}`}>
                    {icon}
                </div>
                <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">{label}</div>
                    <div className="mt-1 text-2xl font-semibold leading-none tabular-nums text-gray-950">{value}</div>
                </div>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-gray-900/5 group-hover:bg-gray-900/10" />
        </div>
    );
}

function LandingMetricCard({ icon, label, value, detail, accent = 'cyan' }) {
    const colors = {
        cyan:   'from-cyan-50 to-white text-cyan-700 ring-cyan-100',
        green:  'from-emerald-50 to-white text-emerald-700 ring-emerald-100',
        amber:  'from-amber-50 to-white text-amber-700 ring-amber-100',
        teal:   'from-teal-50 to-white text-teal-700 ring-teal-100',
        rose:   'from-rose-50 to-white text-rose-700 ring-rose-100',
        slate:  'from-slate-50 to-white text-slate-700 ring-slate-100',
    };
    return (
        <div className="group relative overflow-hidden rounded-md border border-gray-200 bg-gradient-to-br from-white to-gray-50 px-4 py-3 shadow-sm">
            <div className="flex items-start gap-3">
                <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-md bg-gradient-to-br ring-1 ${colors[accent] || colors.cyan}`}>
                    {icon}
                </div>
                <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">{label}</div>
                    <div className="mt-1 text-2xl font-semibold leading-none tabular-nums text-gray-950">{value}</div>
                    {detail && <div className="mt-1 truncate text-xs font-medium text-gray-500">{detail}</div>}
                </div>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-gray-900/5 group-hover:bg-gray-900/10" />
        </div>
    );
}

function MetricGrid({ children, cols = 'lg:grid-cols-5' }) {
    return (
        <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 ${cols}`}>
            {children}
        </div>
    );
}

function Panel({ title, actions, children, className = '', bodyClassName = '' }) {
    return (
        <section className={`rounded-md border border-gray-200 bg-white ${className}`}>
            {(title || actions) && (
                <div className="flex min-h-11 items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
                    {title ? <h3 className="text-sm font-semibold text-gray-900">{title}</h3> : <span />}
                    {actions}
                </div>
            )}
            <div className={`p-4 ${bodyClassName}`}>{children}</div>
        </section>
    );
}

function EmptyPanelText({ children }) {
    return <div className="py-12 text-center text-sm text-gray-500">{children}</div>;
}

function formatNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString() : '—';
}

function parseEventTime(value) {
    if (!value) return null;
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : null;
}

function activitySpanMinutes(events) {
    const times = (events ?? []).map((e) => parseEventTime(e?.timestamp)).filter((t) => t != null);
    if (times.length < 2) return 0;
    return Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 60000));
}

function hasGazePayload(record) {
    const dwell = record?.gaze?.aoi_dwell_ms;
    const zones = record?.gaze?.zone_proportions || record?.engagement?.gaze_zone_proportions;
    return Boolean(
        (dwell && Object.values(dwell).some((v) => Number(v) > 0))
        || (zones && Object.values(zones).some((v) => Number(v) > 0))
    );
}

// `embedded`: render as a flat content block (suitable for a Settings
// tab) instead of the fixed full-screen overlay used when the dashboard
// is launched from the user menu. When `embedded`, no close button or
// full-viewport positioning is applied.
// `externalFilters`: when the parent (e.g. AnalyticsHub) owns a shared
// Case/Student/Start/End filter bar, pass { caseId, userId, startDate,
// endDate } here — every fetch uses those values and the four local
// filter inputs are hidden. Per-tab controls (Source, Group by, Mode /
// Emotion states) stay V2-owned. `null` (default) keeps local filters.
// `hideHeader`: suppress V2's own title row + close/refresh buttons
// when the parent provides its own header; the tab strip still renders.
export default function TnaDashboardV2({ onClose, embedded = false, defaultSource = 'activity', defaultEmotionDimension = 'affective', externalFilters = null, hideHeader = false }) {
    // --- Filters ---
    const [caseId, setCaseId] = useState('');
    const [userId, setUserId] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [groupBy, setGroupBy] = useState('actor-session');

    // Effective filter values: external (hub-driven) when provided,
    // otherwise the local state above. All fetches and memos read these.
    const effCaseId = externalFilters ? (externalFilters.caseId ?? '') : caseId;
    const effUserId = externalFilters ? (externalFilters.userId ?? '') : userId;
    const effStartDate = externalFilters ? (externalFilters.startDate ?? '') : startDate;
    const effEndDate = externalFilters ? (externalFilters.endDate ?? '') : endDate;

    // --- Active tab ---
    const [activeTab, setActiveTab] = useState('activity');

    // --- Network controls ---
    const [pruneThreshold, setPruneThreshold] = useState(0.05);
    const [modelType, setModelType] = useState('relative');
    const [graphLayout, setGraphLayout] = useState('circle');
    const [nodeRadius] = useState(25);
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
    const [interpretations] = useState({ ...DEFAULT_INTERPRETATIONS });
    const [verbRenames, setVerbRenames] = useState({});
    const [verbExcludes, setVerbExcludes] = useState({});

    // --- Sequence source: xAPI activity events vs Oyon emotion windows ---
    // 'activity' keeps the pre-existing /analytics/tna-sequences flow
    // untouched; 'emotions' feeds the SAME downstream pipeline with
    // per-session dominant-emotion sequences (see emotionSequences.js).
    const [seqSource, setSeqSource] = useState(defaultSource);
    const [emotionDimension, setEmotionDimension] = useState(defaultEmotionDimension);
    const [emotionRecords, setEmotionRecords] = useState(null);
    const [emotionTruncated, setEmotionTruncated] = useState(false);

    // --- Server data ---
    const [filterOptions, setFilterOptions] = useState({ cases: [], users: [] });
    const [tnaData, setTnaData] = useState(null);
    const [activityBundle, setActivityBundle] = useState(null);
    // Raw learning-event rows for the Activity-tab charts (educator-accessible,
    // unlike the admin-only aggregate bundle). Fetched once per mount, capped
    // at the EVENTS_FETCH_LIMIT most recent rows; filters apply client-side.
    const [learningEvents, setLearningEvents] = useState(null);
    const [eventsError, setEventsError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(0);

    const isAnalyticsRelated = activeTab === 'network' || activeTab === 'clusters' || activeTab === 'patterns' || activeTab === 'process' || activeTab === 'settings';
    const isActivityTab = activeTab === 'activity';
    const isEmotionSource = seqSource === 'emotions';
    // The three window-record sources (emotions / locations / gaze targets)
    // all analyse the SAME /addons/oyon/emotion-records rows — only the
    // per-window state extractor differs.
    const isRecordsSource = isEmotionSource || seqSource === 'rooms' || seqSource === 'gaze-targets';
    // Oyon signal tabs — first-class dashboards over the SAME shared
    // emotion-record fetch below.
    const isSignalTab = activeTab === 'attention'
        || activeTab === 'affect'
        || activeTab === 'gaze'
        || activeTab === 'compare' || activeTab === 'sessions';
    // The one shared emotion-records fetch fires when EITHER the Emotions
    // sequence source is active on an analytics tab (the pre-existing flow)
    // OR any signal tab is open. Collapsing both conditions into a single
    // boolean dep means switching between two states where it stays true
    // (e.g. emotions-source network → gaze) never double-fetches.
    const wantsEmotionRecords = isActivityTab || (isAnalyticsRelated && isRecordsSource) || isSignalTab;

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
        if (!isAnalyticsRelated || isRecordsSource) return;
        const params = new URLSearchParams();
        if (effCaseId) params.set('case_id', effCaseId);
        if (effUserId) params.set('user_id', effUserId);
        if (effStartDate) params.set('start_date', effStartDate);
        if (effEndDate) params.set('end_date', effEndDate);
        params.set('group_by', groupBy);
        params.set('skip_merges', 'true'); // client resolver chain handles merging

        setLoading(true);
        setError(null);
        apiFetch(`/analytics/tna-sequences?${params}`)
            .then((d) => { setTnaData(d); setLastUpdated(Date.now()); })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, [effCaseId, effUserId, effStartDate, effEndDate, groupBy, isAnalyticsRelated, isRecordsSource]);

    // --- Fetch Oyon emotion windows (shared by the Emotions sequence source
    // AND the signal tabs) ---
    // Same paginated pattern as OyonLearningAnalyticsTab (limit/offset over
    // /addons/oyon/emotion-records), capped at ~1000 windows. The endpoint
    // shares the case/user filters; dates map to its from/to params.
    useEffect(() => {
        if (!wantsEmotionRecords) return;
        const PAGE = 200;
        const CAP = 1000;
        let cancelled = false;

        const params = new URLSearchParams();
        if (effCaseId) params.set('case_id', effCaseId);
        if (effUserId) params.set('user_id', effUserId);
        if (effStartDate) params.set('from', effStartDate);
        if (effEndDate) params.set('to', effEndDate);

        setLoading(true);
        setError(null);
        (async () => {
            try {
                const all = [];
                let offset = 0;
                let total = Infinity;
                while (offset < total && all.length < CAP) {
                    params.set('limit', String(PAGE));
                    params.set('offset', String(offset));
                    const d = await apiFetch(`/addons/oyon/emotion-records?${params}`);
                    const rows = d?.records || [];
                    all.push(...rows);
                    total = Number.isFinite(d?.total) ? d.total : all.length;
                    if (rows.length < PAGE) break;
                    offset += PAGE;
                }
                if (!cancelled) {
                    setEmotionRecords(all);
                    setEmotionTruncated(all.length >= CAP && total > all.length);
                    setLastUpdated(Date.now());
                }
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [effCaseId, effUserId, effStartDate, effEndDate, wantsEmotionRecords]);

    // --- Fetch activity bundle for the Activity tab ---
    useEffect(() => {
        if (!isActivityTab) return;
        const params = new URLSearchParams();
        if (effCaseId) params.set('case_id', effCaseId);
        if (effUserId) params.set('user_id', effUserId);
        if (effStartDate) params.set('start_date', effStartDate);
        if (effEndDate) params.set('end_date', effEndDate);

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
    }, [effCaseId, effUserId, effStartDate, effEndDate, isActivityTab]);

    // --- Fetch raw learning events for the Activity-tab charts ---
    // The endpoint only takes `limit` (reviewer+ reads tenant-wide, others
    // their own rows), so this fires ONCE per mount when the tab first
    // activates; the dashboard filters re-slice the cached rows client-side
    // in the memos below instead of re-fetching.
    useEffect(() => {
        if (!isActivityTab || learningEvents !== null) return;
        apiFetch(`/learning-events/all?limit=${EVENTS_FETCH_LIMIT}`)
            .then((d) => setLearningEvents(d?.events || []))
            .catch((err) => setEventsError(err.message));
    }, [isActivityTab, learningEvents]);

    // --- Activity-tab chart inputs (client-side re-filter of the cached
    // learning-event rows; see activityEvents.js for the pure mappers) ---
    const filteredEvents = useMemo(() => (
        learningEvents
            ? filterEvents(learningEvents, {
                caseId: effCaseId, userId: effUserId,
                startDate: effStartDate, endDate: effEndDate,
            })
            : null
    ), [learningEvents, effCaseId, effUserId, effStartDate, effEndDate]);

    const activityCharts = useMemo(() => {
        if (!filteredEvents) return null;
        // Same palette machinery as the network tab (createColorMap over the
        // sorted state list) so states share colors across tabs.
        const colorMap = createColorMap(eventStateLabels(filteredEvents), palette);
        const daily = toDailyStateSeries(filteredEvents);
        return {
            daily,
            dailyColors: daily.series.map((s) => colorMap[s.label]),
            matrixEvents: toMatrixEvents(filteredEvents),
            colorMap,
        };
    }, [filteredEvents, palette]);

    // --- Transform sequences by source + mode + renames + excludes ---
    const transformedData = useMemo(() => {
        // Window-record sources (emotions / locations / gaze targets):
        // per-session sequences over the shared Oyon records, then the same
        // renames/excludes pass the activity sequences get below.
        if (isRecordsSource) {
            if (!emotionRecords?.length) return null;
            const built = seqSource === 'rooms'
                ? recordsToRoomSequences(emotionRecords)
                : seqSource === 'gaze-targets'
                    ? recordsToGazeTargetSequences(emotionRecords)
                    : recordsToEmotionSequences(emotionRecords, { dimension: emotionDimension });
            if (!built.sequences.length) return null;
            const seqs = built.sequences.map((seq) =>
                seq
                    .map((v) => verbExcludes[v] ? null : (verbRenames[v] || v))
                    .filter((v) => v !== null)
            ).filter((seq) => seq.length >= 2);
            const labelSet = new Set();
            for (const seq of seqs) for (const v of seq) labelSet.add(v);
            return { sequences: seqs, labels: [...labelSet].sort() };
        }

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
    }, [tnaData, sequenceMode, interpretations, verbRenames, verbExcludes,
        isRecordsSource, seqSource, emotionRecords, emotionDimension]);

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

    // Distinct sessions among the fetched emotion windows (signal-tab count line).
    const emotionSessionCount = useMemo(() => {
        if (!emotionRecords?.length) return 0;
        const ids = emotionRecords
            .map((r) => (r?.session_id != null ? String(r.session_id) : null))
            .filter((id) => id !== null);
        return new Set(ids).size;
    }, [emotionRecords]);

    const emotionSourceStats = useMemo(() => {
        if (!emotionRecords?.length) {
            return { modelChannels: 0, dominantLabels: 0 };
        }
        return {
            modelChannels: probabilityChannelLabels(emotionRecords).length,
            dominantLabels: observedDominantLabels(emotionRecords).length,
        };
    }, [emotionRecords]);

    const activityLandingStats = useMemo(() => {
        const events = filteredEvents || [];
        const caseCount = new Set(events.map((e) => e?.case_id).filter((v) => v != null && v !== '')).size;
        const objectCount = new Set(events.map((e) => e?.object_name || e?.object_type).filter(Boolean)).size;
        const emotionWindows = emotionRecords?.length ?? 0;
        const emotionLabels = emotionRecords?.length ? observedDominantLabels(emotionRecords).length : 0;
        const gazeWindows = (emotionRecords ?? []).filter(hasGazePayload).length;
        const summaryD = activityBundle?.summary || {};

        return {
            events: summaryD.totalActivities ?? events.length,
            users: summaryD.uniqueUsers ?? new Set(events.map((e) => e?.user_id).filter((v) => v != null)).size,
            sessions: summaryD.uniqueSessions ?? new Set(events.map((e) => e?.session_id).filter(Boolean)).size,
            cases: caseCount,
            minutes: activitySpanMinutes(events),
            resources: objectCount,
            emotions: emotionWindows,
            emotionLabels,
            gazeWindows,
        };
    }, [activityBundle, filteredEvents, emotionRecords]);

    const refresh = () => {
        // Force the effect to re-fire by toggling a noop on the deps.
        setLastUpdated((t) => t + 1);
    };

    // Tab strip in three visually grouped sections (thin dividers between):
    //   Activity | the TNA analytics group | the Oyon signal group | Settings.
    // Pre-existing ids/labels are unchanged so deep links and tests hold.
    const tabGroups = [
        [
            { id: 'activity',  label: 'Activity',  icon: Activity },
        ],
        [
            { id: 'network',   label: 'Network',   icon: Network },
            { id: 'patterns',  label: 'Patterns',  icon: Hash },
            { id: 'process',   label: 'Process Map', icon: Workflow },
            { id: 'clusters',  label: 'Clusters',  icon: Layers },
        ],
        // Oyon signal tabs — all over the ONE shared emotion-record fetch,
        // honoring the same case/student/date filters. Deliberately NO
        // embedded <oyon-app> element here — nesting Oyon's own app chrome
        // inside this dashboard was rejected.
        [
            { id: 'attention',  label: 'Attention',  icon: Eye },
            { id: 'affect',     label: 'Affect',     icon: Smile },
            { id: 'gaze',       label: 'Gaze',       icon: ScanEye },
            { id: 'compare',    label: 'Compare',    icon: GitCompare },
            { id: 'sessions',   label: 'Sessions',   icon: ListVideo },
        ],
        [
            { id: 'settings',  label: 'Settings',  icon: Settings2 },
        ],
    ];

    // ===========================================================================
    // Light-grey theme — analytics deliberately breaks from the
    // simulator's near-black cockpit. `-m-8 p-8` lets the embedded
    // wrapper bleed past the Settings padding so the grey reaches the
    // panel edges instead of leaving a black border.
    const Outer = embedded
        ? ({ children }) => (
            <div className="rohy-admin-light -m-8 p-8 min-h-full">{children}</div>
        )
        : ({ children }) => (
            <div className="rohy-admin-light fixed inset-0 z-40 overflow-auto">
                <div className="max-w-[1440px] mx-auto px-8 py-6">{children}</div>
            </div>
        );

    return (
        <Outer>
                {/* Header — hidden when embedded (Settings tab) or when the
                    parent hub provides its own header via `hideHeader` */}
                {!embedded && !hideHeader && (
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

                {/* Tabs — grouped sections separated by thin dividers */}
                <div className="flex flex-wrap items-stretch gap-1 border-b border-gray-300 mb-4">
                    {tabGroups.map((group, gi) => (
                        <React.Fragment key={gi}>
                            {gi > 0 && (
                                <span aria-hidden="true" className="w-px self-stretch my-2 bg-gray-400/60" />
                            )}
                            {group.map((tab) => {
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
                        </React.Fragment>
                    ))}
                </div>

                {/* Filters — Case/Student/Start/End are the hub's when
                    `externalFilters` is set; Source/Group by/Mode stay V2-owned */}
                <div className="flex flex-wrap items-end gap-3 mb-4 p-3 bg-white border border-gray-200 rounded-lg">
                    {!externalFilters && (
                        <>
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
                        </>
                    )}
                    {isAnalyticsRelated && (
                        <>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-gray-600">Source</label>
                                <select value={seqSource} onChange={(e) => setSeqSource(e.target.value)} className="px-2 py-1 text-sm bg-white border border-gray-300 rounded">
                                    <option value="activity">Activity</option>
                                    <option value="emotions">Emotions</option>
                                    <option value="rooms">Locations</option>
                                    <option value="gaze-targets">Gaze targets</option>
                                </select>
                            </div>
                            {seqSource === 'activity' && (
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs text-gray-600">Group by</label>
                                    <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="px-2 py-1 text-sm bg-white border border-gray-300 rounded">
                                        <option value="actor-session">Per session</option>
                                        <option value="actor">Per student</option>
                                    </select>
                                </div>
                            )}
                            {seqSource === 'activity' && (
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs text-gray-600">Mode</label>
                                    <select value={sequenceMode} onChange={(e) => setSequenceMode(e.target.value)} className="px-2 py-1 text-sm bg-white border border-gray-300 rounded">
                                        <option value="combined">Clinical state</option>
                                        <option value="verb">Verb only</option>
                                        <option value="objectType">Object only</option>
                                        <option value="raw">Raw verb:object</option>
                                    </select>
                                </div>
                            )}
                            {isEmotionSource && (
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs text-gray-600">Emotion states</label>
                                    <select value={emotionDimension} onChange={(e) => setEmotionDimension(e.target.value)} className="px-2 py-1 text-sm bg-white border border-gray-300 rounded">
                                        <option value="affective">Affective (grouped)</option>
                                        <option value="raw">Raw emotions</option>
                                    </select>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Stat cards */}
                {!isRecordsSource && tnaData?.metadata && isAnalyticsRelated && (
                    <div className="mb-4">
                    <MetricGrid>
                        <StatCard icon={<Users className="w-5 h-5" />} value={tnaData.metadata.totalSequences} label="Sequences" accent="cyan" />
                        <StatCard icon={<Activity className="w-5 h-5" />} value={tnaData.metadata.totalEvents} label="Events" accent="green" />
                        <StatCard icon={<Hash className="w-5 h-5" />} value={transformedData?.labels.length ?? '—'} label={sequenceMode === 'combined' ? 'States' : sequenceMode === 'objectType' ? 'Object types' : 'Verbs'} accent="amber" />
                        {analysis?.summaryData?.density != null && (
                            <StatCard icon={<Network className="w-5 h-5" />} value={`${(analysis.summaryData.density * 100).toFixed(1)}%`} label="Density" accent="teal" />
                        )}
                        {analysis?.summaryData?.nEdges != null && (
                            <StatCard icon={<GitBranch className="w-5 h-5" />} value={analysis.summaryData.nEdges} label="Edges" accent="rose" />
                        )}
                    </MetricGrid>
                    </div>
                )}
                {isRecordsSource && isAnalyticsRelated && emotionRecords && (
                    <div className="mb-4">
                        <MetricGrid cols={isEmotionSource ? 'lg:grid-cols-6' : 'lg:grid-cols-5'}>
                            <StatCard icon={<Users className="w-5 h-5" />} value={transformedData?.sequences.length ?? 0} label="Session sequences" accent="cyan" />
                            <StatCard icon={<Activity className="w-5 h-5" />} value={transformedData ? transformedData.sequences.reduce((n, s) => n + s.length, 0) : 0} label={isEmotionSource ? 'Emotion windows' : 'States visited'} accent="green" />
                            <StatCard icon={<Hash className="w-5 h-5" />} value={transformedData?.labels.length ?? '—'} label={seqSource === 'rooms' ? 'Locations' : seqSource === 'gaze-targets' ? 'Gaze targets' : emotionDimension === 'affective' ? 'Affective states' : 'Emotions'} accent="amber" />
                            {isEmotionSource && (
                                <StatCard icon={<Smile className="w-5 h-5" />} value={emotionSourceStats.modelChannels || '—'} label="Model channels" accent="teal" />
                            )}
                            {analysis?.summaryData?.density != null && (
                                <StatCard icon={<Network className="w-5 h-5" />} value={`${(analysis.summaryData.density * 100).toFixed(1)}%`} label="Density" accent="teal" />
                            )}
                            {analysis?.summaryData?.nEdges != null && (
                                <StatCard icon={<GitBranch className="w-5 h-5" />} value={analysis.summaryData.nEdges} label="Edges" accent="rose" />
                            )}
                        </MetricGrid>
                    </div>
                )}

                {error && (
                    <div className="mb-3 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
                        {error}
                    </div>
                )}

                {/* Content — signal tabs render their own loading card below */}
                {loading && !isSignalTab && (isRecordsSource ? !emotionRecords : !tnaData) && (
                    <Loading text={isRecordsSource ? 'Loading capture windows…' : 'Loading sequences…'} />
                )}
                {isRecordsSource && isAnalyticsRelated && !loading && emotionRecords && !transformedData && (
                    <div className="mb-3 p-3 rounded bg-white border border-gray-200 text-sm text-gray-600">
                        No sequences to analyze — no session has 2 or more usable states
                        for the current filters and source.
                    </div>
                )}

                {/* === ACTIVITY TAB === */}
                {isActivityTab && (
                    <div className="space-y-4">
                        {/* carmdash-style charts over raw learning events —
                            educator-accessible, independent of the admin-only
                            aggregate bundle rendered below. */}
                        {eventsError && (
                            <div className="p-3 rounded bg-white border border-gray-200 text-sm text-gray-600">
                                Could not load learning events: {eventsError}
                            </div>
                        )}
                        {!eventsError && !filteredEvents && <Loading text="Loading learning events…" />}
                        {(activityBundle?.summary || filteredEvents || emotionRecords) && (
                            <div className="rounded-md border border-gray-200 bg-white p-3 shadow-sm">
                                <div className="mb-3 flex items-center justify-between gap-3 border-b border-gray-100 pb-3">
                                    <div>
                                        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-gray-700">Activity Overview</h2>
                                        <p className="mt-1 text-xs text-gray-500">Learning events, simulator sessions, and Oyon capture coverage for the current filters.</p>
                                    </div>
                                    {emotionTruncated && (
                                        <div className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                                            Oyon windows capped at 1000
                                        </div>
                                    )}
                                </div>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                    <LandingMetricCard icon={<Hash className="h-5 w-5" />} value={formatNumber(activityLandingStats.sessions)} label="Sessions" detail={`${formatNumber(activityLandingStats.events)} events`} accent="cyan" />
                                    <LandingMetricCard icon={<BookOpen className="h-5 w-5" />} value={formatNumber(activityLandingStats.cases)} label="Cases Taken" detail={`${formatNumber(activityLandingStats.resources)} resources touched`} accent="green" />
                                    <LandingMetricCard icon={<Clock3 className="h-5 w-5" />} value={formatNumber(activityLandingStats.minutes)} label="Minutes" detail="Observed activity span" accent="amber" />
                                    <LandingMetricCard icon={<Users className="h-5 w-5" />} value={formatNumber(activityLandingStats.users)} label="Students" detail={`${formatNumber(activityBundle?.summary?.avgPerUser ?? 0)} events / user`} accent="teal" />
                                    <LandingMetricCard icon={<Brain className="h-5 w-5" />} value={formatNumber(activityLandingStats.emotions)} label="Emotions Captured" detail={`${formatNumber(activityLandingStats.emotionLabels)} dominant labels`} accent="rose" />
                                    <LandingMetricCard icon={<ScanEye className="h-5 w-5" />} value={formatNumber(activityLandingStats.gazeWindows)} label="Gaze Records" detail="Windows with AOI signal" accent="slate" />
                                    <LandingMetricCard icon={<CalendarDays className="h-5 w-5" />} value={formatNumber(activityCharts?.daily?.xLabels?.length ?? 0)} label="Time Buckets" detail={activityCharts?.daily?.granularity ?? 'loading'} accent="cyan" />
                                    <LandingMetricCard icon={<Database className="h-5 w-5" />} value={formatNumber(activityBundle?.resources?.length ?? 0)} label="Top Resources" detail="Ranked resource rows" accent="green" />
                                </div>
                            </div>
                        )}
                        {activityCharts && (
                            <>
                                {learningEvents.length >= EVENTS_FETCH_LIMIT && (
                                    <div className="px-1 text-xs text-amber-700">
                                        Charts cover the {EVENTS_FETCH_LIMIT.toLocaleString()} most recent
                                        events — older activity is not included.
                                    </div>
                                )}
                                <Panel title={activityCharts.daily.granularity === 'day' ? 'Daily Activity by State' : 'Activity by State over Time'}>
                                    {activityCharts.daily.series.length ? (
                                        <StackedAreaChart
                                            series={activityCharts.daily.series}
                                            xLabels={activityCharts.daily.xLabels}
                                            colors={activityCharts.dailyColors}
                                            xLabel={activityCharts.daily.granularity === 'day' ? 'Day' : 'Time'}
                                            yLabel="Events"
                                            height={260}
                                        />
                                    ) : (
                                        <EmptyPanelText>No events for the current filters</EmptyPanelText>
                                    )}
                                </Panel>
                                <Panel title="Student Activity">
                                    {activityCharts.matrixEvents.length ? (
                                        <DayHourMatrix
                                            events={activityCharts.matrixEvents}
                                            colorMap={activityCharts.colorMap}
                                            height={260}
                                        />
                                    ) : (
                                        <EmptyPanelText>No events for the current filters</EmptyPanelText>
                                    )}
                                </Panel>
                            </>
                        )}
                        {activityBundle && (
                        <>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <Panel title="Verbs">
                                {/* Donut expects a plain object {label: count}, not an array. */}
                                <ActivityDonutChart
                                    data={Object.fromEntries((activityBundle.stats?.verbs || []).map((r) => [r.label, r.count]))}
                                    palette={palette}
                                />
                            </Panel>
                            <Panel title="Object types">
                                <ActivityDonutChart
                                    data={Object.fromEntries((activityBundle.stats?.objectTypes || []).map((r) => [r.label, r.count]))}
                                    palette={palette}
                                />
                            </Panel>
                        </div>
                        {activityBundle.resources?.length > 0 && (
                            <Panel title="Top resources">
                                <table className="w-full text-sm">
                                    <thead className="text-xs text-gray-600">
                                        <tr><th className="text-left py-1">Object type</th><th className="text-left py-1">Name</th><th className="text-right py-1">Count</th></tr>
                                    </thead>
                                    <tbody>
                                        {activityBundle.resources.map((r, i) => (
                                            <tr key={i} className="border-t border-gray-200">
                                                <td className="py-1 text-gray-600">{r.object_type}</td>
                                                <td className="py-1">{r.object_name}</td>
                                                <td className="py-1 text-right text-cyan-700">{r.n}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </Panel>
                        )}
                        </>
                        )}
                    </div>
                )}

                {/* === NETWORK TAB === */}
                {activeTab === 'network' && analysis && (
                    <div className="space-y-4">
                        <div className="rounded-md border border-gray-200 bg-white p-3 shadow-sm">
                            <div className="mb-3 flex items-center justify-between gap-3 border-b border-gray-100 pb-3">
                                <div>
                                    <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-gray-700">Network Model</h2>
                                    <p className="mt-1 text-xs text-gray-500">Tune the transition model, graph layout, and display rules for the current sequence source.</p>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-end gap-3">
                                <div className="flex min-w-36 flex-col gap-1">
                                    <label className="text-xs font-medium text-gray-600">Prune: {pruneThreshold.toFixed(2)}</label>
                                    <input type="range" min={0} max={0.5} step={0.01} value={pruneThreshold} onChange={(e) => setPruneThreshold(parseFloat(e.target.value))} className="w-36 accent-cyan-700" />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-medium text-gray-600">Model</label>
                                    <select value={modelType} onChange={(e) => setModelType(e.target.value)} className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm">
                                        <option value="relative">Relative</option>
                                        <option value="frequency">Frequency</option>
                                        <option value="co-occurrence">Co-occurrence</option>
                                        <option value="attention">Attention</option>
                                    </select>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-medium text-gray-600">Layout</label>
                                    <select value={graphLayout} onChange={(e) => setGraphLayout(e.target.value)} className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm">
                                        {LAYOUT_OPTIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                                    </select>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-medium text-gray-600">Node size</label>
                                    <select value={nodeSizeMetric} onChange={(e) => setNodeSizeMetric(e.target.value)} className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm">
                                        {NODE_SIZE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-medium text-gray-600">Palette</label>
                                    <select value={palette} onChange={(e) => setPalette(e.target.value)} className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm">
                                        {PALETTE_NAMES.map((p) => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                </div>
                                <label className="flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 text-xs font-medium text-gray-700">
                                    <input type="checkbox" checked={showSelfLoops} onChange={(e) => setShowSelfLoops(e.target.checked)} className="accent-cyan-700" />
                                    Self-loops
                                </label>
                                <label className="flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 text-xs font-medium text-gray-700">
                                    <input type="checkbox" checked={showEdgeLabels} onChange={(e) => setShowEdgeLabels(e.target.checked)} className="accent-cyan-700" />
                                    Edge labels
                                </label>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                            <Panel title="TNA network" bodyClassName="min-h-[360px]">
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
                            </Panel>
                            {analysis.centralityData && (
                                <Panel title="Centrality" bodyClassName="min-h-[360px]">
                                    <CentralityBarChart centralityData={analysis.centralityData} colorMap={analysis.colorMap} />
                                </Panel>
                            )}
                            <Panel
                                title={seqView === 'distribution' ? 'State distribution' : 'Index plot'}
                                bodyClassName="min-h-[320px]"
                                actions={
                                    <button onClick={() => setSeqView((v) => v === 'distribution' ? 'index' : 'distribution')} className="rounded-full border border-cyan-100 bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-700 hover:bg-cyan-100">
                                        Toggle
                                    </button>
                                }
                            >
                                {seqView === 'distribution'
                                    ? <TnaDistributionPlot sequences={transformedData.sequences} labels={transformedData.labels} colorMap={analysis.colorMap} />
                                    : <TnaIndexPlot sequences={transformedData.sequences} labels={transformedData.labels} colorMap={analysis.colorMap} />}
                            </Panel>
                            <Panel title={isRecordsSource ? 'State frequency' : 'Verb frequency'} bodyClassName="min-h-[320px]">
                                <TnaFrequencyChart sequences={transformedData.sequences} labels={transformedData.labels} colorMap={analysis.colorMap} />
                            </Panel>
                        </div>
                        {analysis.centralityData && (
                            <Panel title="Centrality table">
                                <TnaCentralityTable centralityData={analysis.centralityData} colorMap={analysis.colorMap} />
                            </Panel>
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
                    <ProcessMap sequences={transformedData.sequences} labels={transformedData.labels} colorMap={analysis?.colorMap} />
                )}

                {/* === OYON SIGNAL TABS === attention (+ trends stacked below) /
                    affect / engagement / gaze / compare / sessions views, all
                    fed the same shared emotion-record fetch (V2 filter bar
                    scope). */}
                {isSignalTab && (
                    <div className="space-y-4">
                        {emotionRecords && activeTab !== 'affect' && (
                            <div className="text-xs text-gray-500 text-right">
                                {emotionRecords.length} window{emotionRecords.length === 1 ? '' : 's'} · {emotionSessionCount} session{emotionSessionCount === 1 ? '' : 's'}
                                {emotionTruncated ? ' · capped at the most recent 1000 windows' : ''}
                            </div>
                        )}

                        {loading && !emotionRecords && (
                            <div className="p-8 bg-white border border-gray-200 rounded-lg text-center text-sm text-gray-500">
                                Loading Oyon windows…
                            </div>
                        )}

                        {emotionRecords && (
                            <>
                            {activeTab === 'attention'  && <OyonAttentionV2 records={emotionRecords} loading={loading} />}
                            {activeTab === 'affect'     && <OyonAffectV2 records={emotionRecords} loading={loading} />}
                            {activeTab === 'gaze'       && <OyonGazeView records={emotionRecords} loading={loading} />}
                            {activeTab === 'compare'    && <OyonCompareView records={emotionRecords} loading={loading} />}
                            {activeTab === 'sessions'   && <OyonSessionsView records={emotionRecords} />}
                            </>
                        )}
                    </div>
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
