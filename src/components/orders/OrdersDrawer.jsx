import React, { useState, useEffect, useRef } from 'react';
import {
    FlaskConical, X, ChevronUp, ChevronDown,
    Search, Clock, CheckCircle, Loader2, List,
    Eye, FileText, Scan, Stethoscope, Activity, Syringe
} from 'lucide-react';
import PatientRecordViewer from '../PatientRecordViewer';
import { useToast } from '../../contexts/ToastContext';
import { usePatientRecord } from '../../services/PatientRecord';
import EventLogger, { COMPONENTS } from '../../services/eventLogger';
import ClinicalRecordsPanel from '../investigations/ClinicalRecordsPanel';
import { TreatmentPanel } from '../treatments';
import { apiUrl } from '../../config/api';

/**
 * Bottom Orders Drawer
 * Provides a unified interface for ordering:
 * - Laboratory Investigations
 * - Radiology Studies
 * - Medications/Drugs
 */
export default function OrdersDrawer({ caseId, sessionId, onViewResult, caseData, onOpenExamination }) {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('labs'); // labs, radiology, drugs, records
    const [drawerHeight, setDrawerHeight] = useState('50vh'); // 50vh or 80vh
    const toast = useToast();
    const { ordered } = usePatientRecord();

    // Settings state - persist to localStorage
    const [labSettings, setLabSettings] = useState(() => {
        try {
            const saved = localStorage.getItem('rohy_lab_settings');
            if (saved) return JSON.parse(saved);
        } catch (e) {}
        return {
            globalTurnaround: 0, // 0 = use per-test defaults
            showNormalRanges: true,
            showFlags: true,
            instantResults: false, // If true, results are immediate
            autoRefreshInterval: 5 // seconds
        };
    });

    // Save settings when changed
    useEffect(() => {
        localStorage.setItem('rohy_lab_settings', JSON.stringify(labSettings));
    }, [labSettings]);

    const updateSetting = (key, value) => {
        const oldValue = labSettings[key];
        setLabSettings(prev => ({ ...prev, [key]: value }));
        // Log setting change
        EventLogger.settingChanged(key, oldValue, value, COMPONENTS.ORDERS_DRAWER);
    };

    // Log drawer open/close
    const handleDrawerOpen = (tab) => {
        setActiveTab(tab);
        setIsOpen(true);
        EventLogger.drawerOpened('OrdersDrawer');
        EventLogger.tabSwitched(tab, COMPONENTS.ORDERS_DRAWER);
    };

    const handleDrawerClose = () => {
        setIsOpen(false);
        EventLogger.drawerClosed('OrdersDrawer');
    };

    // Log tab switching
    const handleTabSwitch = (tab) => {
        setActiveTab(tab);
        EventLogger.tabSwitched(tab, COMPONENTS.ORDERS_DRAWER);
    };

    // Lab state
    const [availableLabs, setAvailableLabs] = useState([]);
    const [labGroups, setLabGroups] = useState([]);
    const [labOrders, setLabOrders] = useState([]);
    const [selectedLabs, setSelectedLabs] = useState([]);
    const [labSearchQuery, setLabSearchQuery] = useState('');
    const [labSelectedGroup, setLabSelectedGroup] = useState('all');
    const [labViewMode, setLabViewMode] = useState('search');
    const [expandedGroups, setExpandedGroups] = useState(new Set());
    const [loadingLabs, setLoadingLabs] = useState(false);
    const [orderError, setOrderError] = useState(null);

    // Radiology state
    const [availableRadiology, setAvailableRadiology] = useState([]);
    const [radiologyGroups, setRadiologyGroups] = useState([]);
    const [radiologyOrders, setRadiologyOrders] = useState([]);
    const [selectedRadiology, setSelectedRadiology] = useState([]);
    const [radiologySearchQuery, setRadiologySearchQuery] = useState('');
    const [radiologySelectedGroup, setRadiologySelectedGroup] = useState('all');
    const [loadingRadiology, setLoadingRadiology] = useState(false);

    // Fetch available labs
    useEffect(() => {
        if (!sessionId) return;

        const fetchLabs = async () => {
            try {
                const token = localStorage.getItem('token');
                const response = await fetch(apiUrl(`/api/sessions/${sessionId}/available-labs`), {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (response.ok) {
                    const data = await response.json();
                    setAvailableLabs(data.labs || []);
                    const groups = [...new Set(data.labs.map(lab => lab.test_group))].sort();
                    setLabGroups(groups);
                }
            } catch (error) {
                console.error('Failed to fetch labs:', error);
            }
        };

        fetchLabs();
    }, [sessionId]);

    // Track last refresh time
    const [lastRefresh, setLastRefresh] = useState(null);

    // Fetch lab orders
    const fetchLabOrders = async () => {
        if (!sessionId) {
            console.log('[Orders] No sessionId, skipping order fetch');
            return;
        }

        try {
            const token = localStorage.getItem('token');
            console.log(`[Orders] Fetching orders for session ${sessionId}...`);
            const response = await fetch(apiUrl(`/api/sessions/${sessionId}/orders`), {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                const orders = data.orders || [];
                const now = new Date();
                setLastRefresh(now);

                console.log(`[Orders] Session ${sessionId} @ ${now.toISOString()}: ${orders.length} total orders`);
                orders.forEach(o => {
                    const status = o.viewed_at ? 'VIEWED' : o.is_ready ? 'READY' : 'PENDING';
                    console.log(`  - ${o.test_name}: ${status}, is_ready=${o.is_ready}, mins_remaining=${o.minutes_remaining}, available_at=${o.available_at}`);
                });
                setLabOrders(orders);
                setOrderError(null);
            } else {
                const errText = await response.text();
                console.error('[Orders] Fetch failed:', response.status, errText);
                setOrderError(`Failed to fetch orders: ${response.status}`);
            }
        } catch (error) {
            console.error('[Orders] Fetch error:', error);
            setOrderError(error.message);
        }
    };

    useEffect(() => {
        fetchLabOrders();
        const intervalMs = (labSettings.autoRefreshInterval || 5) * 1000;
        const interval = setInterval(fetchLabOrders, intervalMs);
        return () => clearInterval(interval);
    }, [sessionId, labSettings.autoRefreshInterval]);

    // Fetch available radiology studies from API
    useEffect(() => {
        if (!sessionId) return;

        const fetchRadiology = async () => {
            try {
                const token = localStorage.getItem('token');
                const response = await fetch(apiUrl(`/api/sessions/${sessionId}/available-radiology`), {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (response.ok) {
                    const data = await response.json();
                    // Map to expected format
                    const studies = (data.studies || []).map(study => ({
                        id: study.id,
                        test_name: study.name,
                        test_group: study.modality,
                        turnaround_minutes: study.turnaround_minutes,
                        body_region: study.body_region,
                        common_indications: study.common_indications
                    }));
                    setAvailableRadiology(studies);
                    setRadiologyGroups(data.groups || []);
                }
            } catch (error) {
                console.error('Failed to fetch radiology:', error);
            }
        };

        fetchRadiology();
    }, [sessionId]);

    // Fetch radiology orders
    const fetchRadiologyOrders = async () => {
        if (!sessionId) return;
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(apiUrl(`/api/sessions/${sessionId}/radiology-orders`), {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                setRadiologyOrders(data.orders || []);
            }
        } catch (error) {
            console.error('Failed to fetch radiology orders:', error);
        }
    };

    useEffect(() => {
        fetchRadiologyOrders();
        const interval = setInterval(fetchRadiologyOrders, 5000);
        return () => clearInterval(interval);
    }, [sessionId]);

    // Order radiology
    const handleOrderRadiology = async () => {
        if (selectedRadiology.length === 0) return;

        setLoadingRadiology(true);
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(apiUrl(`/api/sessions/${sessionId}/order-radiology`), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    radiology_ids: selectedRadiology,
                    instant: labSettings.instantResults
                })
            });

            if (response.ok) {
                toast.success(`Ordered ${selectedRadiology.length} radiology study(s)`);
                selectedRadiology.forEach(radId => {
                    const study = availableRadiology.find(r => r.id === radId);
                    ordered('radiology', study?.test_name || radId, { urgency: labSettings.instantResults ? 'stat' : 'routine' });
                });
                setSelectedRadiology([]);
                await fetchRadiologyOrders();
            } else {
                const errData = await response.json();
                toast.error(errData.error || 'Failed to order radiology');
            }
        } catch (error) {
            toast.error('Failed to order radiology: ' + error.message);
        } finally {
            setLoadingRadiology(false);
        }
    };

    // Filter radiology
    const filteredRadiology = availableRadiology.filter(study => {
        const matchesSearch = !radiologySearchQuery ||
            study.test_name.toLowerCase().includes(radiologySearchQuery.toLowerCase()) ||
            study.test_group.toLowerCase().includes(radiologySearchQuery.toLowerCase());
        const matchesGroup = radiologySelectedGroup === 'all' || study.test_group === radiologySelectedGroup;
        return matchesSearch && matchesGroup;
    });

    const pendingRadiology = radiologyOrders.filter(o => !o.is_ready);
    const readyRadiology = radiologyOrders.filter(o => o.is_ready && !o.viewed_at);

    // Order labs
    const handleOrderLabs = async () => {
        if (selectedLabs.length === 0) return;

        setLoadingLabs(true);
        setOrderError(null);
        try {
            const token = localStorage.getItem('token');

            // Build request body with optional turnaround override
            const body = {
                lab_ids: selectedLabs,
                turnaround_override: labSettings.instantResults ? 0 :
                    (labSettings.globalTurnaround > 0 ? labSettings.globalTurnaround : null)
            };

            console.log('[Orders] Submitting order:', {
                sessionId,
                lab_ids: selectedLabs,
                turnaround_override: body.turnaround_override,
                settings: {
                    instantResults: labSettings.instantResults,
                    globalTurnaround: labSettings.globalTurnaround
                }
            });
            const response = await fetch(apiUrl(`/api/sessions/${sessionId}/order-labs`), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(body)
            });

            if (response.ok) {
                const data = await response.json();
                toast.success(`Ordered ${selectedLabs.length} lab test(s)`);

                // Log each lab ordered
                selectedLabs.forEach(labId => {
                    const lab = availableLabs.find(l => l.id === labId);
                    EventLogger.labOrdered(labId, lab?.test_name || labId, COMPONENTS.ORDERS_DRAWER);
                    // Record to PatientRecord
                    ordered('lab', lab?.test_name || labId, {
                        urgency: labSettings.instantResults ? 'stat' : 'routine'
                    });
                });

                setSelectedLabs([]);
                // Immediate refresh to show new orders
                await fetchLabOrders();
            } else {
                const errData = await response.json();
                toast.error(errData.error || 'Failed to order labs');
                setOrderError(errData.error);
            }
        } catch (error) {
            toast.error('Failed to order labs: ' + error.message);
            setOrderError(error.message);
        } finally {
            setLoadingLabs(false);
        }
    };

    // Log search queries (debounced)
    const searchTimeoutRef = useRef(null);
    const handleSearchChange = (value) => {
        setLabSearchQuery(value);
        // Debounce search logging
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = setTimeout(() => {
            if (value.trim()) {
                const resultsCount = availableLabs.filter(lab =>
                    lab.test_name.toLowerCase().includes(value.toLowerCase()) ||
                    lab.test_group.toLowerCase().includes(value.toLowerCase())
                ).length;
                EventLogger.labSearched(value, resultsCount, COMPONENTS.ORDERS_DRAWER);
            }
        }, 500);
    };

    // Log filter changes
    const handleFilterChange = (group) => {
        setLabSelectedGroup(group);
        EventLogger.labFiltered('group', group, COMPONENTS.ORDERS_DRAWER);
    };

    // Filter labs
    const filteredLabs = availableLabs.filter(lab => {
        const matchesSearch = !labSearchQuery ||
            lab.test_name.toLowerCase().includes(labSearchQuery.toLowerCase()) ||
            lab.test_group.toLowerCase().includes(labSearchQuery.toLowerCase());
        const matchesGroup = labSelectedGroup === 'all' || lab.test_group === labSelectedGroup;
        return matchesSearch && matchesGroup;
    });

    // Group labs
    const groupedLabs = filteredLabs.reduce((acc, lab) => {
        if (!acc[lab.test_group]) acc[lab.test_group] = [];
        acc[lab.test_group].push(lab);
        return acc;
    }, {});

    // Time remaining helper
    const getTimeRemaining = (order) => {
        // Use minutes_remaining from backend if available (more accurate)
        if (order.minutes_remaining !== undefined && order.minutes_remaining > 0) {
            const mins = Math.floor(order.minutes_remaining);
            const secs = Math.floor((order.minutes_remaining - mins) * 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        }
        // Fallback to client-side calculation
        const now = new Date();
        const available = new Date(order.available_at + 'Z'); // Append Z to treat as UTC
        const diff = available - now;
        if (diff <= 0) return 'Ready';
        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    const pendingOrders = labOrders.filter(o => !o.is_ready);
    const readyOrders = labOrders.filter(o => o.is_ready && !o.viewed_at);
    const viewedOrders = labOrders.filter(o => o.is_ready && o.viewed_at);
    const [showOrdersPanel, setShowOrdersPanel] = useState(true);

    if (!caseId || !sessionId) return null;

    // State for treatment orders count
    const [treatmentOrdersCount, setTreatmentOrdersCount] = useState(0);

    // Fetch treatment orders count
    useEffect(() => {
        if (!sessionId) return;
        const fetchTreatmentCount = async () => {
            try {
                const token = localStorage.getItem('token');
                const response = await fetch(apiUrl(`/api/sessions/${sessionId}/treatment-orders?status=ordered`), {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (response.ok) {
                    const data = await response.json();
                    setTreatmentOrdersCount(data.orders?.length || 0);
                }
            } catch (error) {
                console.error('Failed to fetch treatment orders count:', error);
            }
        };
        fetchTreatmentCount();
        const interval = setInterval(fetchTreatmentCount, 10000);
        return () => clearInterval(interval);
    }, [sessionId]);

    const tabs = [
        { id: 'labs', label: 'Laboratory', icon: FlaskConical, count: readyOrders.length },
        { id: 'radiology', label: 'Radiology', icon: Scan, count: readyRadiology.length },
        { id: 'treatments', label: 'Treatments', icon: Syringe, count: treatmentOrdersCount },
        { id: 'records', label: 'Records', icon: FileText, count: 0 },
        { id: 'memory', label: 'Memory', icon: Activity, count: 0 }
    ];

    return (
        <>
            {/* Orders Status Panel - Only visible when there are orders */}
            {!isOpen && labOrders.length > 0 && (
                <div className="fixed bottom-20 right-4 z-40 w-72">
                    <div className="bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl overflow-hidden">
                        {/* Header */}
                        <button
                            onClick={() => setShowOrdersPanel(!showOrdersPanel)}
                            className="w-full px-4 py-2 bg-neutral-800 flex items-center justify-between hover:bg-neutral-700 transition-colors"
                        >
                            <div className="flex flex-col items-start">
                                <span className="text-sm font-bold text-white flex items-center gap-2">
                                    <FlaskConical className="w-4 h-4 text-purple-400" />
                                    Ordered Tests ({labOrders.length})
                                </span>
                                <span className="text-[10px] text-neutral-500">
                                    {pendingOrders.length > 0 && <span className="text-yellow-500">{pendingOrders.length} pending</span>}
                                    {pendingOrders.length > 0 && readyOrders.length > 0 && ' • '}
                                    {readyOrders.length > 0 && <span className="text-green-500">{readyOrders.length} ready</span>}
                                </span>
                            </div>
                            {showOrdersPanel ? <ChevronDown className="w-4 h-4 text-neutral-400" /> : <ChevronUp className="w-4 h-4 text-neutral-400" />}
                        </button>

                        {/* Orders List */}
                        {showOrdersPanel && (
                            <div className="max-h-64 overflow-y-auto">
                                {/* Ready Results - Most Important */}
                                {readyOrders.length > 0 && (
                                    <div className="p-2 bg-green-900/30 border-b border-green-700/50">
                                        <div className="text-xs font-bold text-green-400 mb-1 flex items-center gap-1">
                                            <CheckCircle className="w-3 h-3" />
                                            RESULTS READY ({readyOrders.length})
                                        </div>
                                        {readyOrders.map(order => (
                                            <button
                                                key={order.id}
                                                onClick={() => {
                                                    onViewResult(order);
                                                }}
                                                className="w-full text-left px-2 py-1.5 text-sm text-green-100 hover:bg-green-800/30 rounded flex items-center justify-between"
                                            >
                                                <span className="truncate">{order.test_name}</span>
                                                <span className="text-xs text-green-400 ml-2">View</span>
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {/* Pending */}
                                {pendingOrders.length > 0 && (
                                    <div className="p-2 border-b border-neutral-700">
                                        <div className="text-xs font-bold text-yellow-400 mb-1 flex items-center gap-1">
                                            <Clock className="w-3 h-3 animate-pulse" />
                                            PENDING ({pendingOrders.length})
                                        </div>
                                        {pendingOrders.map(order => (
                                            <div key={order.id} className="px-2 py-1.5 text-sm text-neutral-300 flex items-center justify-between">
                                                <span className="truncate flex-1">{order.test_name}</span>
                                                <span className="text-xs text-yellow-500 ml-2 font-mono min-w-[50px] text-right">
                                                    {getTimeRemaining(order)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Debug: Show all orders */}
                                {labOrders.length > 0 && labOrders.length !== pendingOrders.length + readyOrders.length + viewedOrders.length && (
                                    <div className="p-2 bg-red-900/30 text-xs text-red-400">
                                        Warning: Order count mismatch. Total: {labOrders.length}, Pending: {pendingOrders.length}, Ready: {readyOrders.length}, Viewed: {viewedOrders.length}
                                    </div>
                                )}

                                {/* Viewed */}
                                {viewedOrders.length > 0 && (
                                    <div className="p-2 border-b border-neutral-700">
                                        <div className="text-xs font-bold text-neutral-500 mb-1 flex items-center gap-1">
                                            <CheckCircle className="w-3 h-3" />
                                            VIEWED ({viewedOrders.length})
                                        </div>
                                        {viewedOrders.slice(0, 3).map(order => (
                                            <button
                                                key={order.id}
                                                onClick={() => onViewResult(order)}
                                                className="w-full text-left px-2 py-1 text-xs text-neutral-500 hover:text-neutral-300 truncate"
                                            >
                                                {order.test_name}
                                            </button>
                                        ))}
                                        {viewedOrders.length > 3 && (
                                            <div className="text-xs text-neutral-600 px-2 py-1">
                                                +{viewedOrders.length - 3} more
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Debug: All orders raw list */}
                                {labOrders.length > 0 && (
                                    <details className="border-t border-neutral-800">
                                        <summary className="px-2 py-1.5 text-[10px] text-neutral-500 cursor-pointer hover:bg-neutral-800">
                                            Debug: All {labOrders.length} orders (click to expand)
                                        </summary>
                                        <div className="px-2 py-1 text-[10px] text-neutral-500 max-h-40 overflow-y-auto bg-neutral-900">
                                            {labOrders.map(o => (
                                                <div key={o.id} className="py-0.5 border-b border-neutral-800/50">
                                                    {o.test_name}: is_ready={String(o.is_ready)}, mins={o.minutes_remaining}
                                                </div>
                                            ))}
                                        </div>
                                    </details>
                                )}

                                {/* Refresh indicator */}
                                {lastRefresh && (
                                    <div className="px-2 py-1 text-[10px] text-neutral-600 border-t border-neutral-800 flex justify-between">
                                        <span>Auto-refresh: {labSettings.autoRefreshInterval}s</span>
                                        <span>Updated: {lastRefresh.toLocaleTimeString()}</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Floating Action Buttons */}
            {!isOpen && (
                <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex gap-2">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => handleDrawerOpen(tab.id)}
                            className={`relative px-4 py-3 rounded-full flex items-center gap-2 font-bold text-sm shadow-lg transition-all hover:scale-105 ${
                                tab.id === 'labs' ? 'bg-purple-600 hover:bg-purple-500 text-white' :
                                tab.id === 'radiology' ? 'bg-cyan-600 hover:bg-cyan-500 text-white' :
                                tab.id === 'records' ? 'bg-amber-600 hover:bg-amber-500 text-white' :
                                tab.id === 'memory' ? 'bg-rose-600 hover:bg-rose-500 text-white' :
                                'bg-neutral-700 hover:bg-neutral-600 text-white'
                            }`}
                        >
                            <tab.icon className="w-5 h-5" />
                            {tab.label}
                            {tab.count > 0 && (
                                <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center animate-pulse">
                                    {tab.count}
                                </span>
                            )}
                            {tab.id === 'labs' && pendingOrders.length > 0 && (
                                <span className="absolute -top-2 -left-2 bg-yellow-500 text-black text-xs rounded-full w-6 h-6 flex items-center justify-center">
                                    {pendingOrders.length}
                                </span>
                            )}
                        </button>
                    ))}
                    {/* Physical Examination Button */}
                    {onOpenExamination && (
                        <button
                            onClick={onOpenExamination}
                            className="relative px-4 py-3 rounded-full flex items-center gap-2 font-bold text-sm shadow-lg transition-all hover:scale-105 bg-cyan-600 hover:bg-cyan-500 text-white"
                        >
                            <Stethoscope className="w-5 h-5" />
                            Physical Exam
                        </button>
                    )}
                </div>
            )}

            {/* Drawer */}
            <div
                className={`fixed bottom-0 left-0 right-0 z-50 transition-transform duration-300 ease-out ${
                    isOpen ? 'translate-y-0' : 'translate-y-full'
                }`}
                style={{ height: drawerHeight }}
            >
                {/* Backdrop */}
                {isOpen && (
                    <div
                        className="fixed inset-0 bg-black/50 -z-10"
                        onClick={handleDrawerClose}
                    />
                )}

                <div className="h-full bg-neutral-900 border-t border-neutral-700 rounded-t-2xl shadow-2xl flex flex-col">
                    {/* Drawer Handle */}
                    <div className="flex justify-center py-2">
                        <div className="w-12 h-1.5 bg-neutral-700 rounded-full" />
                    </div>

                    {/* Header with Tabs */}
                    <div className="px-4 pb-3 border-b border-neutral-800">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-lg font-bold text-white">Order Entry</h2>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setDrawerHeight(h => h === '50vh' ? '80vh' : '50vh')}
                                    className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors"
                                    title={drawerHeight === '50vh' ? 'Expand' : 'Collapse'}
                                >
                                    {drawerHeight === '50vh' ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                                </button>
                                <button
                                    onClick={handleDrawerClose}
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
                                            ? tab.id === 'labs' ? 'bg-purple-600 text-white' :
                                              tab.id === 'radiology' ? 'bg-cyan-600 text-white' :
                                              tab.id === 'records' ? 'bg-amber-600 text-white' :
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
                        {/* Labs Tab */}
                        {activeTab === 'labs' && (
                            <div className="h-full flex">
                                {/* Left: Available Tests */}
                                <div className="flex-1 flex flex-col border-r border-neutral-800">
                                    {/* Search & Filter */}
                                    <div className="p-4 space-y-3 border-b border-neutral-800">
                                        <div className="flex gap-2 items-center">
                                            <button
                                                onClick={() => setLabViewMode('search')}
                                                className={`px-3 py-1.5 rounded text-xs font-bold ${
                                                    labViewMode === 'search' ? 'bg-purple-600 text-white' : 'bg-neutral-800 text-neutral-400'
                                                }`}
                                            >
                                                <Search className="w-3 h-3 inline mr-1" />
                                                Search
                                            </button>
                                            <button
                                                onClick={() => setLabViewMode('browse')}
                                                className={`px-3 py-1.5 rounded text-xs font-bold ${
                                                    labViewMode === 'browse' ? 'bg-purple-600 text-white' : 'bg-neutral-800 text-neutral-400'
                                                }`}
                                            >
                                                <List className="w-3 h-3 inline mr-1" />
                                                Browse
                                            </button>
                                            <div className="ml-auto flex items-center gap-2">
                                                {/* Show effective turnaround mode */}
                                                {caseData?.config?.investigations?.instantResults ? (
                                                    <span className="text-xs text-amber-400 bg-amber-900/30 px-2 py-0.5 rounded" title="Case configured for instant results">
                                                        Case: Instant
                                                    </span>
                                                ) : caseData?.config?.investigations?.defaultTurnaround > 0 ? (
                                                    <span className="text-xs text-blue-400 bg-blue-900/30 px-2 py-0.5 rounded" title="Case default turnaround">
                                                        Case: {caseData.config.investigations.defaultTurnaround}m
                                                    </span>
                                                ) : null}
                                                <label className="flex items-center gap-1.5 cursor-pointer" title="When checked, results are available immediately (no turnaround delay)">
                                                    <input
                                                        type="checkbox"
                                                        checked={labSettings.instantResults}
                                                        onChange={(e) => updateSetting('instantResults', e.target.checked)}
                                                        className="w-3 h-3"
                                                    />
                                                    <span className={`text-xs ${labSettings.instantResults ? 'text-green-400 font-bold' : 'text-neutral-400'}`}>
                                                        Instant
                                                    </span>
                                                </label>
                                                <button
                                                    onClick={() => {
                                                        localStorage.removeItem('rohy_lab_settings');
                                                        setLabSettings({
                                                            globalTurnaround: 0,
                                                            showNormalRanges: true,
                                                            showFlags: true,
                                                            instantResults: false,
                                                            autoRefreshInterval: 5
                                                        });
                                                        toast.info('Lab settings reset to defaults');
                                                    }}
                                                    className="text-[10px] text-neutral-500 hover:text-neutral-300 underline"
                                                    title="Reset lab settings to defaults"
                                                >
                                                    Reset
                                                </button>
                                            </div>
                                        </div>

                                        {/* Quick Panel Selection */}
                                        <div className="flex flex-wrap gap-1.5">
                                            {[
                                                { id: 'cbc', label: 'CBC', tests: ['WBC', 'RBC', 'Hemoglobin', 'Hematocrit', 'Platelet', 'MCV', 'MCH', 'MCHC'] },
                                                { id: 'bmp', label: 'BMP', tests: ['Sodium', 'Potassium', 'Chloride', 'Bicarbonate', 'BUN', 'Creatinine', 'Glucose'] },
                                                { id: 'cmp', label: 'CMP', tests: ['Sodium', 'Potassium', 'Chloride', 'Bicarbonate', 'BUN', 'Creatinine', 'Glucose', 'Calcium', 'Albumin', 'Bilirubin', 'ALT', 'AST', 'Alkaline'] },
                                                { id: 'lft', label: 'LFTs', tests: ['ALT', 'AST', 'Alkaline phosphatase', 'Bilirubin', 'Albumin', 'GGT'] },
                                                { id: 'coags', label: 'Coags', tests: ['PT', 'PTT', 'INR', 'Fibrinogen', 'D-dimer'] },
                                                { id: 'cardiac', label: 'Cardiac', tests: ['Troponin', 'BNP', 'Myoglobin', 'Creatine Kinase'] },
                                                { id: 'lipid', label: 'Lipids', tests: ['Cholesterol', 'Triglyceride', 'HDL', 'LDL'] },
                                                { id: 'thyroid', label: 'TFTs', tests: ['TSH', 'T4', 'T3', 'Free T4', 'Free T3'] },
                                            ].map(panel => {
                                                // Find matching labs for this panel
                                                const matchingLabs = availableLabs.filter(lab =>
                                                    panel.tests.some(t => lab.test_name.toLowerCase().includes(t.toLowerCase()))
                                                );
                                                const unorderedMatches = matchingLabs.filter(lab =>
                                                    !labOrders.some(o => o.investigation_id === lab.id)
                                                );
                                                const allSelected = unorderedMatches.length > 0 &&
                                                    unorderedMatches.every(lab => selectedLabs.includes(lab.id));

                                                return (
                                                    <button
                                                        key={panel.id}
                                                        onClick={() => {
                                                            if (allSelected) {
                                                                // Deselect all from this panel
                                                                setSelectedLabs(prev =>
                                                                    prev.filter(id => !unorderedMatches.some(lab => lab.id === id))
                                                                );
                                                            } else {
                                                                // Select all unordered from this panel
                                                                setSelectedLabs(prev => {
                                                                    const newIds = unorderedMatches
                                                                        .map(lab => lab.id)
                                                                        .filter(id => !prev.includes(id));
                                                                    return [...prev, ...newIds];
                                                                });
                                                            }
                                                        }}
                                                        disabled={unorderedMatches.length === 0}
                                                        className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${
                                                            allSelected
                                                                ? 'bg-green-600 text-white'
                                                                : unorderedMatches.length === 0
                                                                    ? 'bg-neutral-800 text-neutral-600 cursor-not-allowed'
                                                                    : 'bg-blue-900/50 text-blue-300 hover:bg-blue-800/50 border border-blue-700/50'
                                                        }`}
                                                        title={`${panel.label}: ${matchingLabs.length} tests (${unorderedMatches.length} available)`}
                                                    >
                                                        {panel.label}
                                                        {unorderedMatches.length > 0 && (
                                                            <span className="ml-1 text-[10px] opacity-70">({unorderedMatches.length})</span>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        <div className="flex gap-2">
                                            <div className="flex-1 relative">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                                                <input
                                                    type="text"
                                                    value={labSearchQuery}
                                                    onChange={(e) => handleSearchChange(e.target.value)}
                                                    placeholder="Search tests..."
                                                    className="w-full pl-10 pr-4 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm text-white placeholder-neutral-500 focus:border-purple-500 focus:outline-none"
                                                />
                                            </div>
                                            <select
                                                value={labSelectedGroup}
                                                onChange={(e) => handleFilterChange(e.target.value)}
                                                className="px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm text-white focus:border-purple-500 focus:outline-none"
                                            >
                                                <option value="all">All Groups</option>
                                                {labGroups.map(g => <option key={g} value={g}>{g}</option>)}
                                            </select>
                                        </div>
                                    </div>

                                    {/* Tests List */}
                                    <div className="flex-1 overflow-y-auto p-4">
                                        {labViewMode === 'search' ? (
                                            <div className="space-y-2">
                                                {filteredLabs.map(lab => {
                                                    const ordered = labOrders.some(o => o.investigation_id === lab.id);
                                                    return (
                                                        <label
                                                            key={lab.id}
                                                            className={`flex items-center gap-3 p-3 rounded border transition-colors ${
                                                                ordered ? 'opacity-50 cursor-not-allowed border-neutral-700' :
                                                                selectedLabs.includes(lab.id) ? 'bg-purple-900/30 border-purple-600' :
                                                                'bg-neutral-800/50 border-neutral-700 hover:bg-neutral-800 cursor-pointer'
                                                            }`}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedLabs.includes(lab.id)}
                                                                onChange={() => !ordered && setSelectedLabs(prev =>
                                                                    prev.includes(lab.id) ? prev.filter(id => id !== lab.id) : [...prev, lab.id]
                                                                )}
                                                                disabled={ordered}
                                                                className="w-4 h-4"
                                                            />
                                                            <div className="flex-1 min-w-0">
                                                                <div className="text-sm font-bold text-white truncate">{lab.test_name}</div>
                                                                <div className="text-xs text-neutral-400">{lab.test_group} - {lab.turnaround_minutes || 30}min</div>
                                                            </div>
                                                            {ordered && <span className="text-xs text-blue-400">Ordered</span>}
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                {Object.entries(groupedLabs).map(([group, labs]) => (
                                                    <div key={group} className="border border-neutral-700 rounded overflow-hidden">
                                                        <button
                                                            onClick={() => setExpandedGroups(prev => {
                                                                const next = new Set(prev);
                                                                next.has(group) ? next.delete(group) : next.add(group);
                                                                return next;
                                                            })}
                                                            className="w-full px-4 py-2 bg-neutral-800 flex items-center justify-between"
                                                        >
                                                            <span className="font-bold text-sm text-white">{group} ({labs.length})</span>
                                                            {expandedGroups.has(group) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                                        </button>
                                                        {expandedGroups.has(group) && (
                                                            <div className="p-2 space-y-1">
                                                                {labs.map(lab => {
                                                                    const ordered = labOrders.some(o => o.investigation_id === lab.id);
                                                                    return (
                                                                        <label
                                                                            key={lab.id}
                                                                            className={`flex items-center gap-2 p-2 rounded ${
                                                                                ordered ? 'opacity-50' :
                                                                                selectedLabs.includes(lab.id) ? 'bg-purple-900/30' : 'hover:bg-neutral-800'
                                                                            } ${ordered ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                                                                        >
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={selectedLabs.includes(lab.id)}
                                                                                onChange={() => !ordered && setSelectedLabs(prev =>
                                                                                    prev.includes(lab.id) ? prev.filter(id => id !== lab.id) : [...prev, lab.id]
                                                                                )}
                                                                                disabled={ordered}
                                                                                className="w-4 h-4"
                                                                            />
                                                                            <span className="text-sm text-white flex-1">{lab.test_name}</span>
                                                                            <span className="text-xs text-neutral-500">{lab.turnaround_minutes || 30}m</span>
                                                                        </label>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Order Button */}
                                    {selectedLabs.length > 0 && (
                                        <div className="p-4 border-t border-neutral-800 space-y-2">
                                            {/* Turnaround info */}
                                            <div className="text-xs text-center">
                                                {labSettings.instantResults || caseData?.config?.investigations?.instantResults ? (
                                                    <span className="text-green-400">Results will be available immediately</span>
                                                ) : labSettings.globalTurnaround > 0 ? (
                                                    <span className="text-blue-400">Results in {labSettings.globalTurnaround} minutes</span>
                                                ) : caseData?.config?.investigations?.defaultTurnaround > 0 ? (
                                                    <span className="text-blue-400">Results in {caseData.config.investigations.defaultTurnaround} minutes (case default)</span>
                                                ) : (
                                                    <span className="text-neutral-400">Results per test turnaround (typically 30 min)</span>
                                                )}
                                            </div>
                                            <button
                                                onClick={handleOrderLabs}
                                                disabled={loadingLabs}
                                                className="w-full px-4 py-3 bg-green-600 hover:bg-green-500 disabled:bg-neutral-600 text-white rounded-lg font-bold flex items-center justify-center gap-2"
                                            >
                                                {loadingLabs ? (
                                                    <><Loader2 className="w-5 h-5 animate-spin" /> Ordering...</>
                                                ) : (
                                                    <>Order {selectedLabs.length} Test{selectedLabs.length > 1 ? 's' : ''}</>
                                                )}
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Right: Order Status - All Ordered Tests */}
                                <div className="w-80 flex flex-col bg-neutral-900/50">
                                    <div className="p-4 border-b border-neutral-700 bg-neutral-800">
                                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                            <FlaskConical className="w-4 h-4 text-purple-400" />
                                            Order Status
                                            {labOrders.length > 0 && (
                                                <span className="ml-auto text-xs text-neutral-400">
                                                    {labOrders.length} test{labOrders.length !== 1 ? 's' : ''}
                                                </span>
                                            )}
                                        </h3>
                                    </div>
                                    <div className="flex-1 overflow-y-auto">
                                        {labOrders.length === 0 ? (
                                            <div className="text-center py-12 text-neutral-500">
                                                <FlaskConical className="w-12 h-12 mx-auto mb-2 opacity-30" />
                                                <p className="text-sm">No tests ordered yet</p>
                                                <p className="text-xs mt-1 text-neutral-600">Select tests from the left to order</p>
                                            </div>
                                        ) : (
                                            <div className="divide-y divide-neutral-800">
                                                {/* Sort: Ready first (newest), then Pending, then Viewed */}
                                                {[...readyOrders, ...pendingOrders, ...viewedOrders].map(order => {
                                                    // Use backend-calculated is_ready to avoid timezone issues
                                                    const isViewed = !!order.viewed_at;
                                                    const isReady = order.is_ready && !isViewed;
                                                    const isPending = !order.is_ready && !isViewed;

                                                    return (
                                                        <div
                                                            key={order.id}
                                                            className={`p-3 transition-all ${
                                                                isReady
                                                                    ? 'bg-green-900/30 border-l-4 border-green-500 animate-pulse'
                                                                    : isPending
                                                                    ? 'bg-neutral-800/50 border-l-4 border-yellow-500/50'
                                                                    : 'bg-neutral-900/30 border-l-4 border-neutral-700'
                                                            }`}
                                                        >
                                                            <div className="flex items-start justify-between gap-2">
                                                                <div className="flex-1 min-w-0">
                                                                    <div className={`text-sm font-medium truncate ${
                                                                        isReady ? 'text-green-100' :
                                                                        isPending ? 'text-neutral-300' :
                                                                        'text-neutral-500'
                                                                    }`}>
                                                                        {order.test_name}
                                                                    </div>
                                                                    <div className={`text-xs mt-1 flex items-center gap-1 ${
                                                                        isReady ? 'text-green-400 font-bold' :
                                                                        isPending ? 'text-yellow-500' :
                                                                        'text-neutral-600'
                                                                    }`}>
                                                                        {isReady && (
                                                                            <>
                                                                                <CheckCircle className="w-3 h-3" />
                                                                                READY - Click to view
                                                                            </>
                                                                        )}
                                                                        {isPending && (
                                                                            <>
                                                                                <Clock className="w-3 h-3 animate-pulse" />
                                                                                {getTimeRemaining(order)}
                                                                            </>
                                                                        )}
                                                                        {isViewed && (
                                                                            <>
                                                                                <Eye className="w-3 h-3" />
                                                                                Viewed
                                                                            </>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                {(isReady || isViewed) && (
                                                                    <button
                                                                        onClick={() => {
                                                                            onViewResult(order);
                                                                        }}
                                                                        className={`px-2 py-1 text-xs rounded transition-colors ${
                                                                            isReady
                                                                                ? 'bg-green-600 hover:bg-green-500 text-white font-bold'
                                                                                : 'bg-neutral-700 hover:bg-neutral-600 text-neutral-300'
                                                                        }`}
                                                                    >
                                                                        {isReady ? 'View' : 'Review'}
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                    {/* Summary Footer */}
                                    {labOrders.length > 0 && (
                                        <div className="p-3 border-t border-neutral-700 bg-neutral-800 text-xs flex gap-4">
                                            {pendingOrders.length > 0 && (
                                                <span className="text-yellow-400">
                                                    <Clock className="w-3 h-3 inline mr-1" />
                                                    {pendingOrders.length} pending
                                                </span>
                                            )}
                                            {readyOrders.length > 0 && (
                                                <span className="text-green-400 font-bold">
                                                    <CheckCircle className="w-3 h-3 inline mr-1" />
                                                    {readyOrders.length} ready
                                                </span>
                                            )}
                                            {viewedOrders.length > 0 && (
                                                <span className="text-neutral-500">
                                                    <Eye className="w-3 h-3 inline mr-1" />
                                                    {viewedOrders.length} viewed
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Radiology Tab */}
                        {activeTab === 'radiology' && (
                            <div className="h-full flex">
                                {/* Left: Available Studies */}
                                <div className="flex-1 flex flex-col border-r border-neutral-800">
                                    {/* Search & Filter */}
                                    <div className="p-4 space-y-3 border-b border-neutral-800">
                                        <div className="flex gap-2">
                                            <div className="flex-1 relative">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                                                <input
                                                    type="text"
                                                    value={radiologySearchQuery}
                                                    onChange={(e) => setRadiologySearchQuery(e.target.value)}
                                                    placeholder="Search imaging studies..."
                                                    className="w-full pl-10 pr-4 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm text-white placeholder-neutral-500 focus:border-cyan-500 focus:outline-none"
                                                />
                                            </div>
                                            <select
                                                value={radiologySelectedGroup}
                                                onChange={(e) => setRadiologySelectedGroup(e.target.value)}
                                                className="px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm text-white focus:border-cyan-500 focus:outline-none"
                                            >
                                                <option value="all">All Modalities</option>
                                                {radiologyGroups.map(g => <option key={g} value={g}>{g}</option>)}
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <label className="flex items-center gap-1.5 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={labSettings.instantResults}
                                                    onChange={(e) => updateSetting('instantResults', e.target.checked)}
                                                    className="w-3 h-3"
                                                />
                                                <span className={`text-xs ${labSettings.instantResults ? 'text-green-400 font-bold' : 'text-neutral-400'}`}>
                                                    Instant Results
                                                </span>
                                            </label>
                                        </div>
                                    </div>

                                    {/* Studies List */}
                                    <div className="flex-1 overflow-y-auto p-4">
                                        {filteredRadiology.length === 0 ? (
                                            <div className="text-center py-12">
                                                <Scan className="w-12 h-12 mx-auto mb-2 text-neutral-600" />
                                                <p className="text-sm text-neutral-400">No radiology studies available</p>
                                                <p className="text-xs text-neutral-500 mt-1">Configure radiology in case settings</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                {filteredRadiology.map(study => {
                                                    const ordered = radiologyOrders.some(o => o.study_id === study.id);
                                                    return (
                                                        <label
                                                            key={study.id}
                                                            className={`flex items-center gap-3 p-3 rounded border transition-colors ${
                                                                ordered ? 'opacity-50 cursor-not-allowed border-neutral-700' :
                                                                selectedRadiology.includes(study.id) ? 'bg-cyan-900/30 border-cyan-600' :
                                                                'bg-neutral-800/50 border-neutral-700 hover:bg-neutral-800 cursor-pointer'
                                                            }`}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedRadiology.includes(study.id)}
                                                                onChange={() => !ordered && setSelectedRadiology(prev =>
                                                                    prev.includes(study.id) ? prev.filter(id => id !== study.id) : [...prev, study.id]
                                                                )}
                                                                disabled={ordered}
                                                                className="w-4 h-4"
                                                            />
                                                            <Scan className="w-5 h-5 text-cyan-400" />
                                                            <div className="flex-1 min-w-0">
                                                                <div className="text-sm font-bold text-white truncate">{study.test_name}</div>
                                                                <div className="text-xs text-neutral-400">{study.test_group} - {study.turnaround_minutes}min</div>
                                                            </div>
                                                            {ordered && <span className="text-xs text-cyan-400">Ordered</span>}
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    {/* Order Button */}
                                    {selectedRadiology.length > 0 && (
                                        <div className="p-4 border-t border-neutral-800">
                                            <button
                                                onClick={handleOrderRadiology}
                                                disabled={loadingRadiology}
                                                className="w-full px-4 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:bg-neutral-600 text-white rounded-lg font-bold flex items-center justify-center gap-2"
                                            >
                                                {loadingRadiology ? (
                                                    <><Loader2 className="w-5 h-5 animate-spin" /> Ordering...</>
                                                ) : (
                                                    <>Order {selectedRadiology.length} Study{selectedRadiology.length > 1 ? 'ies' : 'y'}</>
                                                )}
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Right: Order Status */}
                                <div className="w-80 flex flex-col bg-neutral-900/50">
                                    <div className="p-4 border-b border-neutral-700 bg-neutral-800">
                                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                            <Scan className="w-4 h-4 text-cyan-400" />
                                            Order Status
                                            {radiologyOrders.length > 0 && (
                                                <span className="ml-auto text-xs text-neutral-400">
                                                    {radiologyOrders.length} stud{radiologyOrders.length !== 1 ? 'ies' : 'y'}
                                                </span>
                                            )}
                                        </h3>
                                    </div>
                                    <div className="flex-1 overflow-y-auto">
                                        {radiologyOrders.length === 0 ? (
                                            <div className="text-center py-12 text-neutral-500">
                                                <Scan className="w-12 h-12 mx-auto mb-2 opacity-30" />
                                                <p className="text-sm">No studies ordered yet</p>
                                            </div>
                                        ) : (
                                            <div className="divide-y divide-neutral-800">
                                                {radiologyOrders.map(order => {
                                                    const isViewed = !!order.viewed_at;
                                                    const isReady = order.is_ready;
                                                    // Parse result_data for findings
                                                    let resultData = {};
                                                    try {
                                                        resultData = typeof order.result_data === 'string'
                                                            ? JSON.parse(order.result_data)
                                                            : (order.result_data || {});
                                                    } catch (e) {}
                                                    const hasFindings = resultData.findings || resultData.interpretation;
                                                    return (
                                                        <div
                                                            key={order.id}
                                                            className={`p-3 ${
                                                                isReady && !isViewed ? 'bg-cyan-900/30 border-l-4 border-cyan-500' :
                                                                isViewed ? 'bg-neutral-800/30 border-l-4 border-green-500/50' :
                                                                'bg-neutral-800/50 border-l-4 border-yellow-500/50'
                                                            }`}
                                                        >
                                                            <div className="flex items-start justify-between gap-2">
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="text-sm font-medium text-white">{order.test_name}</div>
                                                                    <div className="text-xs text-neutral-400">{order.modality}</div>
                                                                    {!isReady && (
                                                                        <div className="text-xs text-yellow-500 mt-1">
                                                                            <Clock className="w-3 h-3 inline mr-1" />
                                                                            {Math.ceil(order.minutes_remaining)} min remaining
                                                                        </div>
                                                                    )}
                                                                    {isReady && !isViewed && (
                                                                        <div className="text-xs text-cyan-400 mt-1">Ready - Click to view</div>
                                                                    )}
                                                                    {isViewed && (
                                                                        <div className="text-xs text-green-400 mt-1">
                                                                            <CheckCircle className="w-3 h-3 inline mr-1" />
                                                                            Viewed
                                                                        </div>
                                                                    )}
                                                                    {/* Show findings preview when viewed */}
                                                                    {isViewed && hasFindings && (
                                                                        <div className="mt-2 p-2 bg-neutral-900/50 rounded text-xs">
                                                                            {resultData.interpretation && (
                                                                                <div className="text-white font-medium mb-1">
                                                                                    {resultData.interpretation.length > 100
                                                                                        ? resultData.interpretation.substring(0, 100) + '...'
                                                                                        : resultData.interpretation}
                                                                                </div>
                                                                            )}
                                                                            {resultData.findings && !resultData.interpretation && (
                                                                                <div className="text-neutral-300">
                                                                                    {resultData.findings.length > 100
                                                                                        ? resultData.findings.substring(0, 100) + '...'
                                                                                        : resultData.findings}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                {isReady && (
                                                                    <button
                                                                        onClick={() => onViewResult({
                                                                            ...order,
                                                                            result_data: resultData
                                                                        })}
                                                                        className={`px-3 py-1.5 text-xs rounded font-bold shrink-0 ${
                                                                            isViewed
                                                                                ? 'bg-neutral-700 hover:bg-neutral-600 text-neutral-300'
                                                                                : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                                                                        }`}
                                                                    >
                                                                        {isViewed ? 'Review' : 'View'}
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Treatments Tab */}
                        {activeTab === 'treatments' && (
                            <div className="h-full">
                                <TreatmentPanel
                                    sessionId={sessionId}
                                    caseId={caseId}
                                    onEffectsUpdate={() => setTreatmentOrdersCount(c => c)} // Trigger re-fetch
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
                        {activeTab === 'memory' && (
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
