import React, { useCallback, useState, useEffect, useRef } from 'react';
import { X, ChevronUp, ChevronDown, FileText, Activity, Syringe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PatientRecordViewer from '../PatientRecordViewer';
import EventLogger, { COMPONENTS } from '../../services/eventLogger';
import ClinicalRecordsPanel from '../investigations/ClinicalRecordsPanel';
import { TreatmentPanel } from '../treatments';
import { apiFetch } from '../../services/apiClient';

// Treatment-order statuses that mean "this treatment is live on the
// patient right now". Mirrors the vocabulary the server writes in
// server/routes/orders-routes.js: an order starts 'ordered', becomes
// 'in_progress' once a CONTINUOUS treatment is administered (a discrete
// dose goes straight to 'administered'), and ends 'discontinued'.
const ACTIVE_TREATMENT_STATUSES = new Set(['ordered', 'in_progress']);

/**
 * Bottom Orders Drawer
 *
 * Surfaces the order-entry tabs that are NOT full rooms: treatments,
 * clinical records, and (admin only) the raw patient-record debug view.
 *
 * Scope note — UI test review 2.9.108 #20: this component used to carry a
 * complete labs tab and a complete radiology tab, ~596 lines of JSX plus
 * two 5-second polling loops (`/orders` and `/radiology-orders`). Neither
 * tab had been reachable since the floating Laboratory / Radiology pills
 * were retired in favour of the bottom RoomNavigator: `tabs` below is the
 * ONLY thing that can set `activeTab`, and it offers neither id. The dead
 * JSX still rendered off-screen and the dead polls still cost every
 * learner 12 requests per 30 s for data nothing could display. Lab and
 * radiology ordering, result viewing and turnaround display all live in
 * InvestigationsScreen now — that is the canonical surface.
 *
 * The `onViewResult` prop was part of the deleted labs/radiology result
 * list; callers may still pass it, this component no longer reads it.
 */
export default function OrdersDrawer({ caseId, sessionId, caseData, isAdmin = false, openRequest = null, onOpenRequestConsumed = null, fabAlign = 'seam' }) {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('treatments'); // treatments, records, memory
    const [drawerHeight, setDrawerHeight] = useState('50vh'); // 50vh or 80vh
    const { t } = useTranslation('orders');

    // Log drawer open/close
    const handleDrawerOpen = (tab) => {
        setActiveTab(tab);
        setIsOpen(true);
        EventLogger.drawerOpened('OrdersDrawer');
        EventLogger.tabSwitched(tab, COMPONENTS.ORDERS_DRAWER);
    };

    // External open requests (e.g. the 3D room's chart/IV/oxygen objects ask
    // for a specific tab). A nonce field makes repeat requests re-fire.
    // handleDrawerOpen is re-created each render, so only the request itself
    // may be a dependency — re-firing on the handler would reopen the drawer.
    // Each request is consumed once, by its `at` stamp, and the host is
    // told so it can drop it: the drawer unmounts whenever a full-screen
    // room takes over, and a remount must not replay a request the learner
    // already acted on and closed.
    const consumedRequestRef = useRef(null);
    useEffect(() => {
        if (!openRequest?.tab || openRequest.at === consumedRequestRef.current) return;
        consumedRequestRef.current = openRequest.at;
        handleDrawerOpen(openRequest.tab);
        onOpenRequestConsumed?.(openRequest);
    }, [openRequest]);

    // Escape closes an open drawer, like the backdrop click does.
    useEffect(() => {
        if (!isOpen) return undefined;
        const onKey = (event) => { if (event.key === 'Escape') handleDrawerClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen]);

    const handleDrawerClose = () => {
        setIsOpen(false);
        EventLogger.drawerClosed('OrdersDrawer');
    };

    // Log tab switching
    const handleTabSwitch = (tab) => {
        setActiveTab(tab);
        EventLogger.tabSwitched(tab, COMPONENTS.ORDERS_DRAWER);
    };

    const [treatmentOrdersCount, setTreatmentOrdersCount] = useState(0);

    // Hooks must run unconditionally on every render to keep React's
    // hook-call ordering stable — the previous layout placed these
    // *after* the `if (!caseId || !sessionId) return null` guard below,
    // which made the hook count differ between guarded and unguarded
    // renders and tripped a runtime React error on first mount when
    // the parent hadn't resolved the route params yet. The guard now
    // lives below these declarations.

    // Fetch the ACTIVE treatment-order count behind the Treatments badge.
    //
    // UI test review 2.9.108 #21: this used to request
    // `?status=ordered`, so the moment a learner administered a continuous
    // treatment the server moved that row to 'in_progress' and the badge
    // dropped to 0 — the badge read "nothing on board" while an infusion
    // was running. The endpoint only filters on a single exact status, so
    // we fetch the session's orders unfiltered and count the active ones
    // here against the shared status vocabulary.
    const refreshTreatmentCount = useCallback(async () => {
        if (!sessionId) return;
        try {
            const data = await apiFetch(`/sessions/${sessionId}/treatment-orders`);
            const orders = Array.isArray(data?.orders) ? data.orders : [];
            setTreatmentOrdersCount(
                orders.filter(order => ACTIVE_TREATMENT_STATUSES.has(order?.status)).length
            );
        } catch (error) {
            console.error('Failed to fetch treatment orders count:', error);
        }
    }, [sessionId]);

    useEffect(() => {
        if (!sessionId) return undefined;
        refreshTreatmentCount();
        const interval = setInterval(refreshTreatmentCount, 10000);
        return () => clearInterval(interval);
    }, [sessionId, refreshTreatmentCount]);

    // Render nothing until the parent has wired the route params. Lives
    // *after* every hook so hook-call ordering stays stable across renders.
    if (!caseId || !sessionId) return null;

    // Floating pills cover what the bottom RoomNavigator doesn't —
    // treatments, records, memory. Labs and Radiology are full rooms now
    // and switch via the nav at the bottom of the screen.
    // The Memory tab is PatientRecordViewer — a development panel whose own
    // header says "can be hidden later but useful for development/debugging".
    // It never was, so every learner has been carrying a debug console with a
    // force-sync button, a raw sync-error dump and a JSON export of their own
    // session. Admin-only during the case. Learners meet the same record at
    // DEBRIEF instead, read-only, and only when the educator turns it on for
    // the case (discussant config_override.show_encounter_record).
    const tabs = [
        { id: 'treatments', label: t('tab_treatments'), icon: Syringe, count: treatmentOrdersCount },
        { id: 'records', label: t('tab_records'), icon: FileText, count: 0 },
        ...(isAdmin ? [{ id: 'memory', label: t('tab_memory'), icon: Activity, count: 0 }] : []),
    ];

    return (
        <>
            {/* Floating Action Buttons — horizontal strip sitting one
                tier above the RoomNavigator (72px nav + 16px gap = 88px
                from bottom). fabAlign 'seam' (chat layout) starts the
                strip at the column seam so it lies over the vitals
                monitor, never the chat; 'left' (full-surface plugin
                rooms like the 3D room) docks it at the very left so it
                never covers the room's own bottom-center surfaces. */}
            {!isOpen && (
                <div
                    className="fixed z-40 flex gap-2"
                    style={{ bottom: '88px', left: fabAlign === 'left' ? '1rem' : 'calc(max(35vw, 350px) + 1rem)' }}
                >
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => handleDrawerOpen(tab.id)}
                            className={`relative px-4 py-2.5 rounded-full flex items-center gap-2 font-semibold text-sm shadow-lg ring-1 ring-black/40 transition-all hover:scale-105 ${
                                tab.id === 'records' ? 'bg-amber-600 hover:bg-amber-500 text-white' :
                                tab.id === 'memory' ? 'bg-rose-600 hover:bg-rose-500 text-white' :
                                'bg-neutral-700 hover:bg-neutral-600 text-white'
                            }`}
                        >
                            <tab.icon className="w-4 h-4" />
                            {tab.label}
                            {tab.count > 0 && (
                                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] rounded-full w-5 h-5 flex items-center justify-center animate-pulse">
                                    {tab.count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            )}

            {/* Drawer. Open state sits above the bottom RoomNavigator
                (72px gutter) so the user can still jump rooms while an
                order surface is expanded — fixes the z-50 drawer covering
                the z-40 nav. Closed state slides fully off-screen by an
                extra 72px so the drawer's "Order Entry" header doesn't
                peek above the nav. The backdrop below uses inset-0 so it
                still dims the entire screen including under the nav, but
                the nav itself remains clickable. */}
            {/* Backdrop: a SIBLING of the panel, not a child. The panel is
                transformed (translate), and a transformed element is the
                containing block for fixed descendants — inside it, inset-0
                covered only the panel, so nothing dimmed and click-outside
                never closed. z-40 puts it over the rooms and under the panel;
                the RoomNavigator shares z-40 and comes later in the tree, so
                it stays clickable. */}
            {isOpen && (
                <div
                    className="fixed inset-0 z-40 bg-black/50"
                    onClick={handleDrawerClose}
                    aria-hidden="true"
                />
            )}
            <div
                className={`fixed bottom-[72px] left-0 right-0 z-50 transition-transform duration-300 ease-out ${
                    isOpen ? 'translate-y-0' : 'translate-y-[calc(100%+72px)]'
                }`}
                style={{ height: drawerHeight }}
                // Off-screen is not out of reach: closed, the whole catalogue
                // was still in the tab order (and reachable from inside an
                // overlay room). inert takes it out until it opens.
                inert={!isOpen || undefined}
            >

                <div className="h-full bg-neutral-900 border-t border-neutral-700 rounded-t-2xl shadow-2xl flex flex-col">
                    {/* Drawer Handle */}
                    <div className="flex justify-center py-2">
                        <div className="w-12 h-1.5 bg-neutral-700 rounded-full" />
                    </div>

                    {/* Header with Tabs */}
                    <div className="px-4 pb-3 border-b border-neutral-800">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-lg font-bold text-white">{t('order_entry')}</h2>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setDrawerHeight(h => h === '50vh' ? '80vh' : '50vh')}
                                    className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors"
                                    title={drawerHeight === '50vh' ? t('expand') : t('collapse')}
                                >
                                    {drawerHeight === '50vh' ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                                </button>
                                <button
                                    onClick={handleDrawerClose}
                                    aria-label={t('close', { ns: 'common' })}
                                    className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        {/* Tab Buttons */}
                        <div className="flex gap-2">
                            {tabs.map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => handleTabSwitch(tab.id)}
                                    className={`flex-1 px-4 py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-colors ${
                                        activeTab === tab.id
                                            ? tab.id === 'records' ? 'bg-amber-600 text-white' :
                                              tab.id === 'memory' ? 'bg-rose-600 text-white' :
                                              'bg-neutral-700 text-white'
                                            : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-white'
                                    }`}
                                >
                                    <tab.icon className="w-4 h-4" />
                                    {tab.label}
                                    {tab.count > 0 && (
                                        <span className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">
                                            {tab.count}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Content Area */}
                    <div className="flex-1 overflow-hidden">
                        {/* Treatments Tab */}
                        {activeTab === 'treatments' && (
                            <div className="h-full">
                                {/* UI test review 2.9.108 #21: this used to
                                    be `setTreatmentOrdersCount(c => c)` — a
                                    functional update that returns the same
                                    value, which React bails out of, so the
                                    "immediate refresh" after administering
                                    or discontinuing a treatment refreshed
                                    nothing and the badge sat stale for up
                                    to 10 s. Refetch for real. */}
                                <TreatmentPanel
                                    sessionId={sessionId}
                                    caseId={caseId}
                                    onEffectsUpdate={refreshTreatmentCount}
                                />
                            </div>
                        )}

                        {/* Records Tab */}
                        {activeTab === 'records' && (
                            <div className="h-full">
                                <ClinicalRecordsPanel caseConfig={caseData?.config} />
                            </div>
                        )}

                        {/* Memory Tab - Patient Record Viewer */}
                        {activeTab === 'memory' && isAdmin && (
                            <div className="h-full">
                                <PatientRecordViewer />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
