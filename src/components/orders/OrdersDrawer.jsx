import React, { useState, useEffect, useRef } from 'react';
import {
    FlaskConical, Pill, X, ChevronUp, ChevronDown,
    Search, Clock, CheckCircle, Loader2, List,
    Settings, Eye, EyeOff, Timer, FileText, Scan
} from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import EventLogger, { COMPONENTS } from '../../services/eventLogger';
import ClinicalRecordsPanel from '../investigations/ClinicalRecordsPanel';

/**
 * Bottom Orders Drawer
 * Provides a unified interface for ordering:
 * - Laboratory Investigations
 * - Radiology Studies
 * - Medications/Drugs
 */
export default function OrdersDrawer({ caseId, sessionId, onViewResult, caseData }) {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('labs'); // labs, radiology, drugs, settings
    const [drawerHeight, setDrawerHeight] = useState('50vh'); // 50vh or 80vh
    const toast = useToast();

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

    // Drugs state (placeholder for future)
    const [availableDrugs, setAvailableDrugs] = useState([
        { id: 'aspirin', name: 'Aspirin 325mg', category: 'Antiplatelet', route: 'PO' },
        { id: 'heparin', name: 'Heparin 5000 units', category: 'Anticoagulant', route: 'IV' },
        { id: 'morphine', name: 'Morphine 2mg', category: 'Analgesic', route: 'IV' },
        { id: 'nitro', name: 'Nitroglycerin 0.4mg', category: 'Vasodilator', route: 'SL' },
        { id: 'metoprolol', name: 'Metoprolol 5mg', category: 'Beta-blocker', route: 'IV' },
        { id: 'furosemide', name: 'Furosemide 40mg', category: 'Diuretic', route: 'IV' },
        { id: 'ns', name: 'Normal Saline 1L', category: 'Fluid', route: 'IV' },
        { id: 'dextrose', name: 'Dextrose 50% 50mL', category: 'Fluid', route: 'IV' },
    ]);
    const [selectedDrugs, setSelectedDrugs] = useState([]);

    // Fetch available labs
    useEffect(() => {
        if (!sessionId) return;

        const fetchLabs = async () => {
            try {
                const token = localStorage.getItem('token');
                const response = await fetch(`/api/sessions/${sessionId}/available-labs`, {
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

    // Fetch lab orders
    const fetchLabOrders = async () => {
        if (!sessionId) {
            console.log('No sessionId, skipping order fetch');
            return;
        }

        try {
            const token = localStorage.getItem('token');
            console.log(`Fetching orders for session: ${sessionId}`);
            const response = await fetch(`/api/sessions/${sessionId}/orders`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                console.log('Fetched orders:', data.orders?.length || 0);
                setLabOrders(data.orders || []);
                setOrderError(null);
            } else {
                const errText = await response.text();
                console.error('Order fetch failed:', response.status, errText);
                setOrderError(`Failed to fetch orders: ${response.status}`);
            }
        } catch (error) {
            console.error('Failed to fetch orders:', error);
            setOrderError(error.message);
        }
    };

    useEffect(() => {
        fetchLabOrders();
        const intervalMs = (labSettings.autoRefreshInterval || 5) * 1000;
        const interval = setInterval(fetchLabOrders, intervalMs);
        return () => clearInterval(interval);
    }, [sessionId, labSettings.autoRefreshInterval]);

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

            console.log('Ordering labs:', body);
            const response = await fetch(`/api/sessions/${sessionId}/order-labs`, {
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
    const getTimeRemaining = (availableAt) => {
        const now = new Date();
        const available = new Date(availableAt);
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

    const tabs = [
        { id: 'labs', label: 'Laboratory', icon: FlaskConical, count: readyOrders.length },
        { id: 'radiology', label: 'Radiology', icon: Scan, count: 0 },
        { id: 'drugs', label: 'Medications', icon: Pill, count: 0 },
        { id: 'records', label: 'Records', icon: FileText, count: 0 },
        { id: 'settings', label: 'Settings', icon: Settings, count: 0 }
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
                            <span className="text-sm font-bold text-white flex items-center gap-2">
                                <FlaskConical className="w-4 h-4 text-purple-400" />
                                Ordered Tests ({labOrders.length})
                            </span>
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
                                            <div key={order.id} className="px-2 py-1 text-sm text-neutral-300 flex items-center justify-between">
                                                <span className="truncate">{order.test_name}</span>
                                                <span className="text-xs text-yellow-500 ml-2 font-mono">
                                                    {getTimeRemaining(order.available_at)}
                                                </span>
                                            </div>
                                        ))}
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
                                tab.id === 'drugs' ? 'bg-green-600 hover:bg-green-500 text-white' :
                                tab.id === 'records' ? 'bg-amber-600 hover:bg-amber-500 text-white' :
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
                                              tab.id === 'drugs' ? 'bg-green-600 text-white' :
                                              tab.id === 'records' ? 'bg-amber-600 text-white' :
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
                                        <div className="flex gap-2">
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
                                        <div className="p-4 border-t border-neutral-800">
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
                                                    const isReady = !order.viewed_at && new Date(order.available_at) <= new Date();
                                                    const isPending = !order.viewed_at && new Date(order.available_at) > new Date();
                                                    const isViewed = !!order.viewed_at;

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
                                                                                {getTimeRemaining(order.available_at)}
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
                            <div className="h-full">
                                <ClinicalRecordsPanel caseConfig={caseData?.config} initialTab="radiology" />
                            </div>
                        )}

                        {/* Drugs Tab */}
                        {activeTab === 'drugs' && (
                            <div className="h-full flex items-center justify-center">
                                <div className="text-center">
                                    <Pill className="w-16 h-16 mx-auto mb-4 text-neutral-600" />
                                    <h3 className="text-lg font-bold text-neutral-400 mb-2">Medication Orders</h3>
                                    <p className="text-sm text-neutral-500">Coming soon - Order medications for this case</p>
                                    <div className="mt-6 grid grid-cols-2 gap-2 max-w-md mx-auto">
                                        {availableDrugs.map(drug => (
                                            <div key={drug.id} className="p-3 bg-neutral-800 border border-neutral-700 rounded text-left opacity-50">
                                                <div className="text-sm text-white">{drug.name}</div>
                                                <div className="text-xs text-neutral-400">{drug.category} - {drug.route}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Records Tab */}
                        {activeTab === 'records' && (
                            <div className="h-full">
                                <ClinicalRecordsPanel caseConfig={caseData?.config} />
                            </div>
                        )}

                        {/* Settings Tab */}
                        {activeTab === 'settings' && (
                            <div className="h-full overflow-y-auto p-6">
                                <div className="max-w-xl mx-auto space-y-6">
                                    <div>
                                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                            <Settings className="w-5 h-5 text-purple-400" />
                                            Lab Settings
                                        </h3>
                                    </div>

                                    {/* Turnaround Time */}
                                    <div className="bg-neutral-800 rounded-lg p-4 border border-neutral-700">
                                        <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                                            <Timer className="w-4 h-4 text-yellow-400" />
                                            Result Timing
                                        </h4>

                                        <div className="space-y-4">
                                            {/* Instant Results Toggle */}
                                            <label className="flex items-center justify-between cursor-pointer">
                                                <div>
                                                    <span className="text-sm text-white">Instant Results</span>
                                                    <p className="text-xs text-neutral-500">Results available immediately (no wait time)</p>
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={labSettings.instantResults}
                                                    onChange={(e) => updateSetting('instantResults', e.target.checked)}
                                                    className="w-5 h-5"
                                                />
                                            </label>

                                            {/* Global Turnaround Override */}
                                            {!labSettings.instantResults && (
                                                <div>
                                                    <label className="text-sm text-white block mb-2">
                                                        Global Wait Time Override
                                                    </label>
                                                    <div className="flex items-center gap-3">
                                                        <select
                                                            value={labSettings.globalTurnaround}
                                                            onChange={(e) => updateSetting('globalTurnaround', parseInt(e.target.value))}
                                                            className="flex-1 px-3 py-2 bg-neutral-700 border border-neutral-600 rounded text-white text-sm"
                                                        >
                                                            <option value={0}>Use per-test defaults</option>
                                                            <option value={1}>1 minute</option>
                                                            <option value={2}>2 minutes</option>
                                                            <option value={5}>5 minutes</option>
                                                            <option value={10}>10 minutes</option>
                                                            <option value={15}>15 minutes</option>
                                                            <option value={30}>30 minutes</option>
                                                            <option value={60}>60 minutes</option>
                                                        </select>
                                                    </div>
                                                    <p className="text-xs text-neutral-500 mt-1">
                                                        Override all test turnaround times with a single value
                                                    </p>
                                                </div>
                                            )}

                                            {/* Auto-refresh Interval */}
                                            <div>
                                                <label className="text-sm text-white block mb-2">
                                                    Auto-refresh Interval
                                                </label>
                                                <select
                                                    value={labSettings.autoRefreshInterval}
                                                    onChange={(e) => updateSetting('autoRefreshInterval', parseInt(e.target.value))}
                                                    className="w-full px-3 py-2 bg-neutral-700 border border-neutral-600 rounded text-white text-sm"
                                                >
                                                    <option value={2}>Every 2 seconds</option>
                                                    <option value={5}>Every 5 seconds</option>
                                                    <option value={10}>Every 10 seconds</option>
                                                    <option value={30}>Every 30 seconds</option>
                                                </select>
                                                <p className="text-xs text-neutral-500 mt-1">
                                                    How often to check for new results
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Display Settings */}
                                    <div className="bg-neutral-800 rounded-lg p-4 border border-neutral-700">
                                        <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                                            <Eye className="w-4 h-4 text-blue-400" />
                                            Display Options
                                        </h4>

                                        <div className="space-y-3">
                                            <label className="flex items-center justify-between cursor-pointer">
                                                <div>
                                                    <span className="text-sm text-white">Show Normal Ranges</span>
                                                    <p className="text-xs text-neutral-500">Display reference ranges in results</p>
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={labSettings.showNormalRanges}
                                                    onChange={(e) => updateSetting('showNormalRanges', e.target.checked)}
                                                    className="w-5 h-5"
                                                />
                                            </label>

                                            <label className="flex items-center justify-between cursor-pointer">
                                                <div>
                                                    <span className="text-sm text-white">Show Abnormal Flags</span>
                                                    <p className="text-xs text-neutral-500">Highlight high/low values</p>
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={labSettings.showFlags}
                                                    onChange={(e) => updateSetting('showFlags', e.target.checked)}
                                                    className="w-5 h-5"
                                                />
                                            </label>
                                        </div>
                                    </div>

                                    {/* Debug Info */}
                                    <div className="bg-neutral-800/50 rounded-lg p-4 border border-neutral-700/50">
                                        <h4 className="text-xs font-bold text-neutral-500 mb-2">Session Info</h4>
                                        <div className="text-xs text-neutral-600 space-y-1 font-mono">
                                            <div>Session ID: {sessionId}</div>
                                            <div>Case ID: {caseId}</div>
                                            <div>Total Orders: {labOrders.length}</div>
                                            <div>Available Labs: {availableLabs.length}</div>
                                            {orderError && (
                                                <div className="text-red-400 mt-2">Error: {orderError}</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
