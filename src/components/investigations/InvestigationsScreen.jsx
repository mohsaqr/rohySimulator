import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Clock, Eye, FlaskConical, NotebookPen, Scan, X } from 'lucide-react';
import { ApiError, apiFetch, apiPost } from '../../services/apiClient';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { caseDisplayLabel } from '../../utils/caseDisplayLabel';
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
        // i18n key for the room title (namespace: investigations).
        labelKey: 'room_lab',
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
        labelKey: 'room_radiology',
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
//   1. Topbar: modality title (Laboratory / Radiology) + Notes button.
//      No Back button here — the always-visible bottom RoomNavigator is
//      the only exit, and Lab ↔ Radiology switching also happens through
//      that nav. Inline modality switchers (DepartmentSignage,
//      MiniSwitcher, [ / ] hotkeys) were retired because they
//      duplicated the bottom nav's Laboratory + Radiology buttons.
//   2. Body (25 / 75 split):
//      - Left rail: worklist on top (3/5 of height), catalogue below
//        (2/5). Worklist is primary because reading results dominates
//        the task; ordering is secondary.
//      - Right pane: report viewer. Empty state renders a department
//        dashboard with a ghosted modality watermark + big counts —
//        also the in-screen indicator of which room is active.
//
// Side effects (mark-as-viewed, PatientRecord.elicited) live in the
// report views so switching results in the viewer fires the same
// writes the old modal-on-open path used to fire.
export default function InvestigationsScreen({
    activeCase,
    sessionId,
    patientInfo,
    // Driven entirely by the parent (App.jsx). Lab and Radiology are
    // peer rooms in the bottom RoomNavigator; this screen is the same
    // workspace mounted with a different activeKind. No internal
    // fallback or setter — switching is the parent's job via the nav.
    activeKind = 'lab',
    roomNav,
}) {
    const { t } = useTranslation('investigations');
    const [showNotes, setShowNotes] = useState(false);
    const toast = useToast();
    const { user } = useAuth();
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
        // `room: 'lab'` is stamped server-side onto learning_events so the
        // analytics layer can attribute the order without joining against
        // NAVIGATED events.
        buildSubmitBody: (ids) => ({ lab_ids: ids, room: 'lab' }),
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
        buildSubmitBody: (ids) => ({ radiology_ids: ids, instant: false, room: 'radiology' }),
        onOrdered: (item) => ordered('radiology', item.test_name, { urgency: 'routine' }),
        toast,
    });

    const active = activeKind === 'radiology' ? radiology : lab;
    const theme = MODALITY_THEME[activeKind];
    const ViewerComponent = activeKind === 'radiology' ? RadiologyReportView : LabReportView;
    const TitleIcon = activeKind === 'radiology' ? Scan : FlaskConical;
    // Which viewed report (if any) is currently expanded into the full
    // hospital-style card below the pill row. Single-expanded keeps the
    // pill row compact and the report area uncluttered. Reset on
    // modality switch so a lab pill doesn't try to render in radiology.
    const [expandedId, setExpandedId] = useState(null);
    useEffect(() => { setExpandedId(null); }, [activeKind]);
    const expandedOrder = active.openOrders.find((o) => o.id === expandedId) || null;

    // Students must not see the authoring title (it names the diagnosis).
    const caseTitle = caseDisplayLabel(activeCase, user);
    const counts = useMemo(() => ({
        lab: countsFor(lab.orders),
        radiology: countsFor(radiology.orders),
    }), [lab.orders, radiology.orders]);
    const openOrderIdSets = useMemo(() => ({
        lab: new Set(lab.openOrders.map((o) => o.id)),
        radiology: new Set(radiology.openOrders.map((o) => o.id)),
    }), [lab.openOrders, radiology.openOrders]);

    return (
        <div className="h-screen w-screen bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 text-slate-100 flex flex-col overflow-hidden">
            <header className="flex items-center justify-between px-6 py-3 bg-slate-950/80 backdrop-blur border-b border-slate-800/80 shadow-lg shadow-black/20">
                <div className="flex items-center gap-3">
                    <TitleIcon className={`w-6 h-6 ${theme.accentTextSolid}`} />
                    <div className="flex items-baseline gap-2 text-sm">
                        <span className="font-semibold text-slate-100 text-base">{t(theme.labelKey)}</span>
                        <span className="text-slate-500">·</span>
                        <span className="text-slate-300">{caseTitle}</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setShowNotes(true)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm flex items-center gap-1.5 transition-colors border border-slate-700"
                    >
                        <NotebookPen className="w-4 h-4" />
                        {t('notes')}
                    </button>
                </div>
            </header>

            {/* Three columns: order catalogue (left), report viewer (center),
                worklist of pending/ready/viewed results (right). The
                worklist used to share the left rail with the catalogue — at
                25% width on a 1440px viewport the catalogue was squeezed to
                ~3cm and the search box overflowed. Pulling the worklist
                into its own right column gives the catalogue room to
                breathe and surfaces "what's queued" more prominently. */}
            <div className="flex-1 min-h-0 grid grid-cols-[minmax(260px,1fr)_minmax(0,3fr)_minmax(280px,1fr)] gap-px bg-slate-800/60">
                <aside className="flex flex-col bg-slate-900/40 overflow-hidden">
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
                        onSubmitInstant={active.submitInstant}
                    />
                </aside>

                <main className="relative bg-slate-900/30 overflow-hidden flex flex-col">
                    {/* Ghost watermark fills the middle column behind the
                        scrolling content. Sits outside the scroller so it
                        stays put as the student scrolls pills + expanded
                        reports. */}
                    <h1
                        aria-hidden="true"
                        className={`pointer-events-none absolute inset-0 flex items-center justify-center text-[18vw] font-black tracking-tighter select-none ${theme.ghostText}`}
                    >
                        {activeKind === 'radiology' ? t('watermark_radiology') : t('watermark_lab')}
                    </h1>
                    <div className="relative flex-1 min-h-0 p-8 overflow-y-auto">
                        {expandedOrder ? (
                            /* Pill clicked → report takes the whole middle
                               column. Welcome card + pill row hide. Closing
                               the report (X / Close) sets expandedId to
                               null and the stack view comes back. */
                            <div
                                key={`${activeKind}-${expandedOrder.id}-expanded`}
                                className={`relative z-10 mx-auto max-w-5xl rounded-xl ring-1 ${theme.frameRing} ${theme.glow} overflow-hidden bg-white shadow-2xl`}
                            >
                                <ViewerComponent
                                    result={normaliseForView(expandedOrder, activeKind)}
                                    patientInfo={patientInfo}
                                    onClose={() => setExpandedId(null)}
                                />
                            </div>
                        ) : (
                            <>
                                {/* Welcome panel stays as the backdrop.
                                    Pills sit below the welcome card with
                                    a thin divider once results are viewed. */}
                                <DepartmentDashboard
                                    kind={activeKind}
                                    theme={theme}
                                    counts={counts[activeKind]}
                                />

                                {active.openOrders.length > 0 && (
                                    <div className="relative z-10 mx-auto max-w-5xl mt-10 space-y-6">
                                        <div className="flex items-center gap-3">
                                            <span className={`text-xs uppercase tracking-widest font-semibold ${theme.accentText}`}>
                                                {t('open_reports')}
                                            </span>
                                            <span className="flex-1 h-px bg-slate-700/60" />
                                            <span className="text-xs text-slate-500">{active.openOrders.length}</span>
                                        </div>

                                        {/* Pill row — one chip per viewed
                                            report. Click a pill to open the
                                            full report; X removes the chip
                                            (worklist row stays, re-click to
                                            bring it back). */}
                                        <div className="flex flex-wrap gap-2">
                                            {active.openOrders.map((order) => (
                                                <ReportPill
                                                    key={`${activeKind}-${order.id}`}
                                                    order={order}
                                                    kind={activeKind}
                                                    theme={theme}
                                                    active={false}
                                                    onClick={() => setExpandedId(order.id)}
                                                    onDismiss={() => active.closeOrder(order.id)}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </main>

                <aside className="flex flex-col bg-slate-900/40 overflow-hidden border-l border-slate-800">
                    <InvestigationWorklist
                        kind={activeKind}
                        theme={theme}
                        orders={active.orders}
                        openOrderIds={openOrderIdSets[activeKind]}
                        onSelectOrder={(order) => {
                            // Single-click open: push to the pill stack AND
                            // expand the viewer. Without the second call the
                            // row only created a pill chip and the learner
                            // had to click again to actually read the report.
                            // The viewer mount fires PUT /orders/:id/view, so
                            // this also marks the order viewed_at server-side.
                            active.openOrder(order);
                            setExpandedId(order.id);
                        }}
                    />
                </aside>
            </div>

            {/* Bottom RoomNavigator — rendered by App.jsx and passed in
                so the bar stays consistent across every room. */}
            {roomNav}

            <SessionNotesDrawer
                open={showNotes}
                onClose={() => setShowNotes(false)}
                sessionId={sessionId}
                title={t('notes_drawer_title')}
            />
        </div>
    );
}

// Pill / chip for a single viewed report. Shows the test name + a short
// status indicator (abnormal / normal / pending), with a clickable body
// that toggles the expanded report below and a small dismiss X that
// removes the report from the stack without nuking it from the worklist.
function ReportPill({ order, kind, theme, active, onClick, onDismiss }) {
    const { t } = useTranslation('investigations');
    const label = order.test_name
        || order.studyName
        || (kind === 'radiology' ? t('pill_fallback_radiology') : t('pill_fallback_lab'));
    // Light status signal so the pill row reads like a glanceable summary.
    // Radiology: hasConfiguredResult / abnormal tag. Labs: is_abnormal.
    const isAbnormal = kind === 'radiology'
        ? !!order?.result_data?.abnormal
        : !!order.is_abnormal;
    const isReady = order.is_ready || order.viewed_at;
    return (
        <span
            className={`group inline-flex items-stretch rounded-full ring-1 transition-colors overflow-hidden ${
                active
                    ? `${theme.accentChip} ring-2`
                    : isAbnormal
                        ? 'bg-rose-500/10 text-rose-200 ring-rose-500/40 hover:bg-rose-500/15'
                        : 'bg-slate-800/70 text-slate-200 ring-slate-700 hover:bg-slate-700/70'
            }`}
        >
            <button
                type="button"
                onClick={onClick}
                className="px-3 py-1.5 flex items-center gap-2 text-xs font-medium"
                title={active ? t('pill_collapse') : t('pill_open_report')}
            >
                <span
                    className={`w-1.5 h-1.5 rounded-full ${
                        isAbnormal ? 'bg-rose-400' : isReady ? theme.accentBg.split(' ')[0] : 'bg-amber-400'
                    }`}
                />
                <span className="truncate max-w-[14rem]">{label}</span>
            </button>
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDismiss(); }}
                className="px-2 hover:bg-black/20 text-slate-400 hover:text-slate-100 transition-colors"
                title={t('pill_remove_title')}
                aria-label={t('pill_remove_aria', { label })}
            >
                <X className="w-3 h-3" />
            </button>
        </span>
    );
}

function DepartmentDashboard({ kind, theme, counts }) {
    const { t } = useTranslation('investigations');
    const Icon = theme.kindIcon;

    return (
        <div className="relative w-full flex items-start justify-center pb-6">
            <div className="relative z-10 max-w-2xl w-full px-8">
                <div className="flex items-center gap-3 mb-6">
                    <div className={`w-12 h-12 rounded-xl bg-slate-800/80 ring-1 ${theme.frameRing} flex items-center justify-center ${theme.glow}`}>
                        <Icon className={`w-7 h-7 ${theme.accentTextSolid}`} />
                    </div>
                    <div>
                        <div className="text-xs uppercase tracking-widest text-slate-500 font-semibold">{t('welcome_to')}</div>
                        <div className="text-xl font-bold text-slate-100">{t(theme.labelKey)}</div>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-6">
                    <StatCard label={t('stat_ready')} value={counts.ready} tone="emerald" icon={CheckCircle} highlight={counts.ready > 0} />
                    <StatCard label={t('stat_pending')} value={counts.pending} tone="amber" icon={Clock} />
                    <StatCard label={t('stat_viewed')} value={counts.viewed} tone="slate" icon={Eye} />
                </div>

                <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-5 backdrop-blur-sm">
                    <div className="text-sm text-slate-300 leading-relaxed">
                        {counts.ready > 0 ? (
                            <>
                                <span className={`font-semibold ${theme.accentText}`}>
                                    {kind === 'radiology'
                                        ? t('dashboard_ready_highlight_radiology', { count: counts.ready })
                                        : t('dashboard_ready_highlight_lab', { count: counts.ready })}
                                </span>{' '}
                                {t('dashboard_ready_body')}
                            </>
                        ) : counts.pending > 0 ? (
                            <>
                                <span className="font-semibold text-amber-300">
                                    {kind === 'radiology'
                                        ? t('dashboard_pending_highlight_radiology', { count: counts.pending })
                                        : t('dashboard_pending_highlight_lab', { count: counts.pending })}
                                </span>
                                {t('dashboard_pending_body')}
                            </>
                        ) : (
                            kind === 'radiology' ? t('dashboard_empty_radiology') : t('dashboard_empty_lab')
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
    const { t } = useTranslation('investigations');
    const [catalogue, setCatalogue] = useState({ items: [], groups: [] });
    const [orders, setOrders] = useState([]);
    const [selected, setSelected] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [groupFilter, setGroupFilter] = useState('all');
    const [submitting, setSubmitting] = useState(false);
    // `openOrders` is the stack of reports rendered in the centre
    // column. The contract: every result the student has *viewed* in
    // this session lives here (newest on top). A click on a worklist
    // row puts the report on the stack instantly (so the student sees
    // it the moment they ask for it); the auto-add effect below also
    // pulls in anything the server has already marked viewed so the
    // stack survives an unmount-remount (tab away, come back, etc.).
    //
    // `dismissedIdsRef` holds ids the student has explicitly closed
    // during this mount — the auto-add effect skips them so a dismissed
    // card doesn't keep popping back on the next poll. Re-clicking the
    // worklist row clears the dismiss flag and brings the card back.
    const [openOrders, setOpenOrders] = useState([]);
    const dismissedIdsRef = useRef(new Set());
    const [lastRefresh, setLastRefresh] = useState(null);
    const openOrdersRef = useRef([]);
    openOrdersRef.current = openOrders;

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
        // (1) Keep every open card in sync with the latest poll so
        // mark-as-viewed flips replace the "ready" copy with the
        // viewed-stamped one without a remount.
        // (2) Auto-add any server-marked-viewed order that isn't on the
        // stack yet (and wasn't dismissed during this mount) so the
        // viewed pile survives a tab-away / remount.
        if (orders.length === 0) return;
        const stack = openOrdersRef.current;
        const stackById = new Map(stack.map((o) => [o.id, o]));
        let mutated = false;
        const refreshed = stack.map((open) => {
            const fresh = orders.find((o) => o.id === open.id);
            if (fresh && fresh !== open) { mutated = true; return fresh; }
            return open;
        });
        const newlyViewed = orders.filter((o) =>
            o.viewed_at && !stackById.has(o.id) && !dismissedIdsRef.current.has(o.id)
        );
        if (newlyViewed.length > 0) {
            // Sort newer-viewed-first so a batch of fresh-from-server
            // viewed rows lands on top in viewed_at order.
            newlyViewed.sort((a, b) => new Date(b.viewed_at) - new Date(a.viewed_at));
            mutated = true;
            setOpenOrders([...newlyViewed, ...refreshed]);
            return;
        }
        if (mutated) setOpenOrders(refreshed);
    }, [orders]);

    const openOrder = useCallback((order) => {
        if (!order) return;
        // Re-clicked from the worklist (including a previously dismissed
        // viewed row) → clear the dismiss flag so the auto-add effect
        // won't bounce it off again, then push to the top of the stack.
        dismissedIdsRef.current.delete(order.id);
        setOpenOrders((prev) => prev.some((o) => o.id === order.id) ? prev : [order, ...prev]);
    }, []);

    const closeOrder = useCallback((id) => {
        dismissedIdsRef.current.add(id);
        setOpenOrders((prev) => prev.filter((o) => o.id !== id));
    }, []);

    const clearStack = useCallback(() => {
        setOpenOrders((prev) => {
            prev.forEach((o) => dismissedIdsRef.current.add(o.id));
            return [];
        });
    }, []);

    const toggleSelect = useCallback((id) => {
        setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
    }, []);

    // submit({ instant }) — when instant=true the body carries
    // turnaround_override: 0 so the server-side resolver skips the wait.
    // Lab uses the `turnaround_override` field directly; radiology has
    // both `instant: true` and `turnaround_override: 0` in its body for
    // compatibility with the older boolean-shaped handler.
    const submit = useCallback(async ({ instant = false } = {}) => {
        if (selected.length === 0) return;
        setSubmitting(true);
        try {
            const body = buildSubmitBody(selected);
            if (instant) {
                body.turnaround_override = 0;
                if (kind === 'radiology') body.instant = true;
            }
            await apiPost(submitEndpoint, body);
            toast.success(
                kind === 'radiology'
                    ? t(instant ? 'toast_ordered_radiology_instant' : 'toast_ordered_radiology', { count: selected.length })
                    : t(instant ? 'toast_ordered_lab_instant' : 'toast_ordered_lab', { count: selected.length })
            );
            selected.forEach((id) => {
                const item = catalogue.items.find((i) => i.id === id);
                if (item) onOrdered(item);
            });
            setSelected([]);
            await fetchOrders();
        } catch (err) {
            const msg = err instanceof ApiError ? err.message : (err.message || t('order_failed'));
            toast.error(t('toast_order_failed', { message: msg ?? '' }));
        } finally {
            setSubmitting(false);
        }
    }, [selected, submitEndpoint, buildSubmitBody, kind, catalogue.items, onOrdered, toast, fetchOrders, t]);

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
        submit: () => submit({ instant: false }),
        submitInstant: () => submit({ instant: true }),
        openOrders,
        openOrder,
        closeOrder,
        clearStack,
        lastRefresh,
        refresh: fetchOrders,
    };
}
