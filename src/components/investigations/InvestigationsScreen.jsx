import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowLeftRight, ArrowRight, CheckCircle, Clock, Eye, FlaskConical, NotebookPen, RefreshCw, Scan } from 'lucide-react';
import { ApiError, apiFetch, apiPost } from '../../services/apiClient';
import { useToast } from '../../contexts/ToastContext';
import { usePatientRecord } from '../../services/PatientRecord';
import EventLogger, { COMPONENTS } from '../../services/eventLogger';
import SessionNotesDrawer from '../common/SessionNotesDrawer';
import InvestigationCatalogue from './InvestigationCatalogue';
import InvestigationWorklist from './InvestigationWorklist';
import LabReportView from './LabReportView';
import RadiologyReportView from './RadiologyReportView';

// Modality accents drive every coloured surface on the screen. Lab is
// purple (matches the modal lab header), radiology is cyan (matches the
// modal radiology header). One source of truth so changing accent is a
// one-line edit per modality.
const MODALITY_THEME = {
    lab: {
        label: 'Laboratory Investigations',
        kindIcon: FlaskConical,
        accentText: 'text-purple-300',
        accentTextSolid: 'text-purple-400',
        accentBg: 'bg-purple-600 hover:bg-purple-500',
        accentRow: 'bg-purple-900/30 border-purple-500/70 hover:bg-purple-900/40',
        accentRail: 'border-l-purple-500',
        accentChip: 'bg-purple-500/20 text-purple-200 border-purple-500/40',
        accentUnderline: 'bg-purple-400',
        accentGradient: 'from-purple-500/20 via-purple-700/5 to-transparent',
        frameRing: 'ring-purple-500/30',
        glow: 'shadow-[0_0_40px_-12px_rgba(168,85,247,0.55)]',
        ghostText: 'text-purple-400/[0.07]',
    },
    radiology: {
        label: 'Radiology Room',
        kindIcon: Scan,
        accentText: 'text-cyan-300',
        accentTextSolid: 'text-cyan-400',
        accentBg: 'bg-cyan-600 hover:bg-cyan-500',
        accentRow: 'bg-cyan-900/30 border-cyan-500/70 hover:bg-cyan-900/40',
        accentRail: 'border-l-cyan-500',
        accentChip: 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40',
        accentUnderline: 'bg-cyan-400',
        accentGradient: 'from-cyan-500/20 via-cyan-700/5 to-transparent',
        frameRing: 'ring-cyan-500/30',
        glow: 'shadow-[0_0_40px_-12px_rgba(6,182,212,0.55)]',
        ghostText: 'text-cyan-400/[0.07]',
    },
};

// Full-page Investigations workspace.
//
// Layout (top → bottom):
//   1. Topbar: Back, screen title, case name, Notes
//   2. Department signage: two large modality headers side-by-side.
//      The active one wears its accent color and shows live counts;
//      the inactive one is dimmed but visible so the user knows the
//      other room exists.
//   3. Body (25 / 75 split):
//      - Left rail: worklist on top (3/5 of height), catalogue below
//        (2/5). Worklist is primary because reading results dominates
//        the task; ordering is secondary.
//      - Right pane: report viewer. Empty state renders a department
//        dashboard with a ghosted modality watermark + big counts.
//
// Side effects (mark-as-viewed, PatientRecord.elicited) live in the
// report views so switching results in the viewer fires the same
// writes the old modal-on-open path used to fire.
export default function InvestigationsScreen({
    activeCase,
    sessionId,
    patientInfo,
    onClose,
    // Controlled-optional: when App.jsx wants lab/radiology to be peers
    // in the bottom RoomNavigator it passes activeKind + onKindChange so
    // both surfaces share one source of truth. When the props are
    // omitted (tests, embed cases) the screen falls back to internal
    // state and keeps the old behaviour.
    activeKind: controlledKind,
    onKindChange,
    roomNav,
}) {
    const [internalKind, setInternalKind] = useState('lab');
    const activeKind = controlledKind ?? internalKind;
    const setActiveKind = onKindChange ?? setInternalKind;
    const [showNotes, setShowNotes] = useState(false);
    const toast = useToast();
    const { ordered } = usePatientRecord();

    useEffect(() => {
        EventLogger.componentOpened(COMPONENTS.ORDERS_DRAWER, 'InvestigationsScreen');
        return () => EventLogger.componentClosed(COMPONENTS.ORDERS_DRAWER, 'InvestigationsScreen');
    }, []);

    const lab = useInvestigationState({
        kind: 'lab',
        sessionId,
        catalogueEndpoint: `/sessions/${sessionId}/available-labs`,
        extractCatalogue: (data) => {
            const items = data?.labs || [];
            const groups = [...new Set(items.map((l) => l.test_group).filter(Boolean))].sort();
            return { items, groups };
        },
        ordersEndpoint: `/sessions/${sessionId}/orders`,
        submitEndpoint: `/sessions/${sessionId}/order-labs`,
        buildSubmitBody: (ids) => ({ lab_ids: ids }),
        onOrdered: (item) => ordered('lab', item.test_name, { urgency: 'routine' }),
        toast,
    });

    const radiology = useInvestigationState({
        kind: 'radiology',
        sessionId,
        catalogueEndpoint: `/sessions/${sessionId}/available-radiology`,
        extractCatalogue: (data) => {
            const items = (data?.studies || []).map((s) => ({
                id: s.id,
                test_name: s.name,
                test_group: s.modality,
                turnaround_minutes: s.turnaround_minutes,
                body_region: s.body_region,
            }));
            return { items, groups: data?.groups || [] };
        },
        ordersEndpoint: `/sessions/${sessionId}/radiology-orders`,
        submitEndpoint: `/sessions/${sessionId}/order-radiology`,
        buildSubmitBody: (ids) => ({ radiology_ids: ids, instant: false }),
        onOrdered: (item) => ordered('radiology', item.test_name, { urgency: 'routine' }),
        toast,
    });

    const active = activeKind === 'radiology' ? radiology : lab;
    const theme = MODALITY_THEME[activeKind];
    const ViewerComponent = activeKind === 'radiology' ? RadiologyReportView : LabReportView;

    // Keyboard shortcuts: [ and ] swap modalities without leaving the
    // keyboard. Hint is shown in the mini-switcher in the left rail.
    // Ignored when typing in inputs/textareas so search boxes still
    // accept those characters literally.
    useEffect(() => {
        const onKey = (e) => {
            const tag = (e.target?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
            if (e.key === '[') setActiveKind('lab');
            else if (e.key === ']') setActiveKind('radiology');
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const caseTitle = activeCase?.name || activeCase?.config?.patient_name || 'Patient';
    const counts = useMemo(() => ({
        lab: countsFor(lab.orders),
        radiology: countsFor(radiology.orders),
    }), [lab.orders, radiology.orders]);

    return (
        <div className="h-screen w-screen bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 text-slate-100 flex flex-col overflow-hidden">
            <header className="flex items-center justify-between px-6 py-3 bg-slate-950/80 backdrop-blur border-b border-slate-800/80 shadow-lg shadow-black/20">
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm flex items-center gap-1.5 transition-colors border border-slate-700"
                    >
                        <ArrowLeft className="w-4 h-4" /> Back
                    </button>
                    <div className="flex items-center gap-2 text-sm pl-2 border-l border-slate-700">
                        <span className="text-slate-500">Investigations</span>
                        <span className="text-slate-600">·</span>
                        <span className="text-slate-200 font-medium">{caseTitle}</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setShowNotes(true)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm flex items-center gap-1.5 transition-colors border border-slate-700"
                    >
                        <NotebookPen className="w-4 h-4" />
                        Notes
                    </button>
                </div>
            </header>

            {/* Department signage. Two big modality headers side-by-side.
                Active one wears its accent; inactive one dims to ~30%
                but stays visible so the user knows the other room is
                there. Hover lifts the dim slightly. */}
            <DepartmentSignage
                activeKind={activeKind}
                onSelect={setActiveKind}
                counts={counts}
                lastRefresh={active.lastRefresh}
                onRefresh={active.refresh}
            />

            <div className="flex-1 min-h-0 grid grid-cols-[1fr_3fr] gap-px bg-slate-800/60">
                <aside className="flex flex-col bg-slate-900/40 overflow-hidden">
                    <MiniSwitcher activeKind={activeKind} onSelect={setActiveKind} />
                    <div className="flex-[3] min-h-0 border-b border-slate-800">
                        <InvestigationWorklist
                            kind={activeKind}
                            theme={theme}
                            orders={active.orders}
                            selectedOrderId={active.selectedOrder?.id}
                            onSelectOrder={active.selectOrder}
                        />
                    </div>
                    <div className="flex-[2] min-h-0">
                        <InvestigationCatalogue
                            kind={activeKind}
                            theme={theme}
                            items={active.catalogue.items}
                            groups={active.catalogue.groups}
                            orders={active.orders}
                            selectedIds={active.selected}
                            onToggleSelect={active.toggleSelect}
                            searchQuery={active.searchQuery}
                            onSearchChange={active.setSearchQuery}
                            groupFilter={active.groupFilter}
                            onGroupFilterChange={active.setGroupFilter}
                            loading={active.submitting}
                            onSubmit={active.submit}
                        />
                    </div>
                </aside>

                <main className="relative bg-slate-900/30 overflow-hidden flex flex-col">
                    <div className="flex-1 min-h-0 p-8 overflow-y-auto">
                        {active.selectedOrder ? (
                            <div className={`mx-auto max-w-6xl rounded-xl ring-1 ${theme.frameRing} ${theme.glow} overflow-hidden`}>
                                <ViewerComponent
                                    key={`${activeKind}-${active.selectedOrder.id}`}
                                    result={normaliseForView(active.selectedOrder, activeKind)}
                                    patientInfo={patientInfo}
                                />
                            </div>
                        ) : (
                            <DepartmentDashboard
                                kind={activeKind}
                                theme={theme}
                                counts={counts[activeKind]}
                            />
                        )}
                    </div>
                </main>
            </div>

            {/* Bottom RoomNavigator — rendered by App.jsx and passed in
                so the bar stays consistent across every room. */}
            {roomNav}

            <SessionNotesDrawer
                open={showNotes}
                onClose={() => setShowNotes(false)}
                sessionId={sessionId}
                title="Investigations notes"
            />
        </div>
    );
}

function DepartmentSignage({ activeKind, onSelect, counts, lastRefresh, onRefresh }) {
    return (
        <div className="relative bg-slate-950/40 border-b border-slate-800/80 overflow-hidden">
            <div className="grid grid-cols-2">
                <DepartmentHeader
                    kind="lab"
                    active={activeKind === 'lab'}
                    counts={counts.lab}
                    onSelect={() => onSelect('lab')}
                />
                <DepartmentHeader
                    kind="radiology"
                    active={activeKind === 'radiology'}
                    counts={counts.radiology}
                    onSelect={() => onSelect('radiology')}
                    align="right"
                />
            </div>
            <div className="absolute top-3 right-6">
                <RefreshIndicator lastRefresh={lastRefresh} onRefresh={onRefresh} />
            </div>
        </div>
    );
}

function DepartmentHeader({ kind, active, counts, onSelect, align = 'left' }) {
    const theme = MODALITY_THEME[kind];
    const Icon = theme.kindIcon;
    const isRight = align === 'right';
    const alignClass = isRight ? 'items-end text-right' : 'items-start text-left';
    const SwitchArrow = isRight ? ArrowRight : ArrowLeft;
    return (
        <button
            type="button"
            onClick={onSelect}
            aria-pressed={active}
            className={`group relative px-8 py-5 flex flex-col gap-1.5 transition-all overflow-hidden ${alignClass} ${
                active
                    ? `bg-gradient-to-${isRight ? 'l' : 'r'} ${theme.accentGradient} cursor-default`
                    : 'cursor-pointer bg-slate-900/30 hover:bg-slate-800/70'
            }`}
        >
            <div className={`flex items-center gap-3 ${isRight ? 'flex-row-reverse' : ''}`}>
                <Icon className={`w-7 h-7 transition-all ${
                    active
                        ? theme.accentTextSolid
                        : `${theme.accentText} opacity-60 group-hover:opacity-100 group-hover:scale-110`
                }`} />
                <h2 className={`text-3xl md:text-4xl font-bold tracking-tight transition-all ${
                    active
                        ? 'text-white'
                        : 'text-slate-400 group-hover:text-white'
                }`}>
                    {theme.label}
                </h2>
            </div>
            {active ? (
                <div className={`flex items-center gap-3 text-xs ${isRight ? 'flex-row-reverse' : ''}`}>
                    <CountChip icon={CheckCircle} value={counts.ready} label="ready" tone="emerald" />
                    <CountChip icon={Clock} value={counts.pending} label="pending" tone="amber" />
                    <CountChip icon={Eye} value={counts.viewed} label="viewed" tone="slate" />
                </div>
            ) : (
                <div className={`flex items-center gap-1.5 text-xs font-semibold ${theme.accentText} ${isRight ? 'flex-row-reverse' : ''}`}>
                    {!isRight && <SwitchArrow className="w-3.5 h-3.5" />}
                    <span className="uppercase tracking-wider">Switch room</span>
                    {isRight && <SwitchArrow className="w-3.5 h-3.5" />}
                    {(counts.ready > 0 || counts.pending > 0) && (
                        <span className="ml-1 px-1.5 py-0.5 rounded-md bg-slate-800/80 border border-slate-700 text-slate-300 text-[10px] tracking-normal normal-case">
                            {counts.ready > 0 && `${counts.ready} ready`}
                            {counts.ready > 0 && counts.pending > 0 && ' · '}
                            {counts.pending > 0 && `${counts.pending} pending`}
                        </span>
                    )}
                </div>
            )}
            {active && (
                <span className={`absolute left-0 right-0 bottom-0 h-1 ${theme.accentUnderline} shadow-[0_0_12px_rgba(255,255,255,0.25)]`} />
            )}
        </button>
    );
}

function MiniSwitcher({ activeKind, onSelect }) {
    return (
        <div className="px-3 py-2.5 border-b border-slate-800 bg-slate-950/40 flex items-center gap-2">
            <div className="flex-1 grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-900/80 border border-slate-800">
                <MiniSwitcherButton kind="lab" active={activeKind === 'lab'} onSelect={() => onSelect('lab')} />
                <MiniSwitcherButton kind="radiology" active={activeKind === 'radiology'} onSelect={() => onSelect('radiology')} />
            </div>
            <div className="hidden md:flex items-center gap-1 text-[10px] text-slate-500" title="Keyboard shortcut">
                <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[10px]">[</kbd>
                <ArrowLeftRight className="w-3 h-3" />
                <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[10px]">]</kbd>
            </div>
        </div>
    );
}

function MiniSwitcherButton({ kind, active, onSelect }) {
    const theme = MODALITY_THEME[kind];
    const Icon = theme.kindIcon;
    const shortLabel = kind === 'radiology' ? 'Radiology' : 'Lab';
    return (
        <button
            type="button"
            onClick={onSelect}
            aria-pressed={active}
            className={`px-2.5 py-1.5 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                active
                    ? `bg-slate-700 text-white ring-1 ${theme.frameRing}`
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
        >
            <Icon className={`w-3.5 h-3.5 ${active ? theme.accentTextSolid : ''}`} />
            {shortLabel}
        </button>
    );
}

const CHIP_TONE = {
    emerald: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
    amber:   'border-amber-500/40 bg-amber-500/15 text-amber-200',
    slate:   'border-slate-600/50 bg-slate-700/30 text-slate-300',
};

function CountChip({ icon: Icon, value, label, tone }) {
    if (value === 0 && tone !== 'emerald') return null;
    return (
        <span className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold flex items-center gap-1 ${CHIP_TONE[tone]}`}>
            <Icon className="w-3 h-3" />
            {value} {label}
        </span>
    );
}

function RefreshIndicator({ lastRefresh, onRefresh }) {
    const [, force] = useState(0);
    useEffect(() => {
        const t = setInterval(() => force((n) => n + 1), 1000);
        return () => clearInterval(t);
    }, []);
    const ago = lastRefresh ? secondsAgo(lastRefresh) : null;
    return (
        <button
            type="button"
            onClick={onRefresh}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-slate-500 hover:text-slate-300 hover:bg-slate-800/60 transition-colors"
            title="Refresh worklist"
        >
            <RefreshCw className="w-3 h-3" />
            {ago == null ? '—' : `updated ${ago}s ago`}
        </button>
    );
}

function DepartmentDashboard({ kind, theme, counts }) {
    const Icon = theme.kindIcon;
    const ghostText = kind === 'radiology' ? 'RADIOLOGY' : 'LABORATORY';

    return (
        <div className="relative h-full w-full flex items-center justify-center">
            <h1 className={`pointer-events-none absolute inset-0 flex items-center justify-center text-[18vw] font-black tracking-tighter select-none ${theme.ghostText}`}>
                {ghostText}
            </h1>

            <div className="relative z-10 max-w-2xl w-full px-8">
                <div className="flex items-center gap-3 mb-6">
                    <div className={`w-12 h-12 rounded-xl bg-slate-800/80 ring-1 ${theme.frameRing} flex items-center justify-center ${theme.glow}`}>
                        <Icon className={`w-7 h-7 ${theme.accentTextSolid}`} />
                    </div>
                    <div>
                        <div className="text-xs uppercase tracking-widest text-slate-500 font-semibold">Welcome to</div>
                        <div className="text-xl font-bold text-slate-100">{theme.label}</div>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-6">
                    <StatCard label="Ready" value={counts.ready} tone="emerald" icon={CheckCircle} highlight={counts.ready > 0} />
                    <StatCard label="Pending" value={counts.pending} tone="amber" icon={Clock} />
                    <StatCard label="Viewed" value={counts.viewed} tone="slate" icon={Eye} />
                </div>

                <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-5 backdrop-blur-sm">
                    <div className="text-sm text-slate-300 leading-relaxed">
                        {counts.ready > 0 ? (
                            <>
                                <span className={`font-semibold ${theme.accentText}`}>{counts.ready} new {kind === 'radiology' ? 'studies' : 'results'}</span>{' '}
                                ready in the worklist. Click one on the left to read the report here.
                            </>
                        ) : counts.pending > 0 ? (
                            <>
                                <span className="font-semibold text-amber-300">{counts.pending} {kind === 'radiology' ? 'studies' : 'tests'} pending</span>.
                                Reports land here automatically as they become available — no need to refresh.
                            </>
                        ) : (
                            <>
                                Pick {kind === 'radiology' ? 'a study' : 'a test'} from the catalogue on the left to place an order.
                                When the result arrives it shows up in the worklist and opens here.
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

const STAT_TONES = {
    emerald: {
        ring: 'ring-emerald-500/40',
        text: 'text-emerald-300',
        bg: 'bg-emerald-500/10',
        highlightGlow: 'shadow-[0_0_24px_-6px_rgba(16,185,129,0.5)]',
    },
    amber: {
        ring: 'ring-amber-500/30',
        text: 'text-amber-300',
        bg: 'bg-amber-500/10',
        highlightGlow: '',
    },
    slate: {
        ring: 'ring-slate-600/40',
        text: 'text-slate-300',
        bg: 'bg-slate-700/20',
        highlightGlow: '',
    },
};

function StatCard({ label, value, tone, icon: Icon, highlight }) {
    const t = STAT_TONES[tone];
    return (
        <div className={`rounded-xl ring-1 ${t.ring} ${t.bg} p-4 ${highlight ? t.highlightGlow : ''}`}>
            <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] uppercase tracking-widest text-slate-400 font-semibold">{label}</span>
                <Icon className={`w-3.5 h-3.5 ${t.text}`} />
            </div>
            <div className={`text-3xl font-black ${value > 0 ? t.text : 'text-slate-600'} tabular-nums`}>{value}</div>
        </div>
    );
}

function countsFor(orders) {
    return {
        pending: orders.filter((o) => !o.is_ready).length,
        ready: orders.filter((o) => o.is_ready && !o.viewed_at).length,
        viewed: orders.filter((o) => o.is_ready && o.viewed_at).length,
    };
}

function secondsAgo(ts) {
    return Math.max(0, Math.round((Date.now() - ts) / 1000));
}

function normaliseForView(order, kind) {
    if (kind === 'radiology') {
        return {
            id: order.id,
            test_name: order.test_name,
            modality: order.modality,
            image_url: order.image_url,
            result_data: order.result_data,
            available_at: order.available_at,
            viewed_at: order.viewed_at,
        };
    }
    return {
        ...order,
        order_id: order.order_id ?? order.id,
    };
}

function useInvestigationState({
    kind,
    sessionId,
    catalogueEndpoint,
    extractCatalogue,
    ordersEndpoint,
    submitEndpoint,
    buildSubmitBody,
    onOrdered,
    toast,
}) {
    const [catalogue, setCatalogue] = useState({ items: [], groups: [] });
    const [orders, setOrders] = useState([]);
    const [selected, setSelected] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [groupFilter, setGroupFilter] = useState('all');
    const [submitting, setSubmitting] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [lastRefresh, setLastRefresh] = useState(null);
    const selectedOrderRef = useRef(null);
    selectedOrderRef.current = selectedOrder;

    useEffect(() => {
        if (!sessionId) return;
        let cancelled = false;
        apiFetch(catalogueEndpoint)
            .then((data) => { if (!cancelled) setCatalogue(extractCatalogue(data)); })
            .catch((err) => console.error(`Failed to fetch ${kind} catalogue:`, err));
        return () => { cancelled = true; };
    }, [sessionId, catalogueEndpoint]);

    const fetchOrders = useCallback(async () => {
        if (!sessionId) return;
        try {
            const data = await apiFetch(ordersEndpoint);
            setOrders(data?.orders || []);
            setLastRefresh(Date.now());
        } catch (err) {
            if (err instanceof ApiError) {
                console.error(`[${kind} orders]`, err.status, err.message);
            } else {
                console.error(`[${kind} orders]`, err);
            }
        }
    }, [sessionId, ordersEndpoint, kind]);

    useEffect(() => {
        fetchOrders();
        const interval = setInterval(fetchOrders, 5000);
        return () => clearInterval(interval);
    }, [fetchOrders]);

    useEffect(() => {
        if (!selectedOrderRef.current) return;
        const fresh = orders.find((o) => o.id === selectedOrderRef.current.id);
        if (fresh && fresh !== selectedOrderRef.current) setSelectedOrder(fresh);
    }, [orders]);

    const toggleSelect = useCallback((id) => {
        setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
    }, []);

    const submit = useCallback(async () => {
        if (selected.length === 0) return;
        setSubmitting(true);
        try {
            await apiPost(submitEndpoint, buildSubmitBody(selected));
            toast.success(`Ordered ${selected.length} ${kind === 'radiology' ? 'study(s)' : 'test(s)'}`);
            selected.forEach((id) => {
                const item = catalogue.items.find((i) => i.id === id);
                if (item) onOrdered(item);
            });
            setSelected([]);
            await fetchOrders();
        } catch (err) {
            const msg = err instanceof ApiError ? err.message : (err.message || 'Order failed');
            toast.error(`Failed to order: ${msg}`);
        } finally {
            setSubmitting(false);
        }
    }, [selected, submitEndpoint, buildSubmitBody, kind, catalogue.items, onOrdered, toast, fetchOrders]);

    return {
        catalogue,
        orders,
        selected,
        toggleSelect,
        searchQuery,
        setSearchQuery,
        groupFilter,
        setGroupFilter,
        submitting,
        submit,
        selectedOrder,
        selectOrder: setSelectedOrder,
        lastRefresh,
        refresh: fetchOrders,
    };
}
