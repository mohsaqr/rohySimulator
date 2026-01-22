import React, { useState, useEffect } from 'react';
import {
    Pill, Droplets, Wind, HeartPulse,
    Search, AlertTriangle, Clock, CheckCircle,
    Play, Pause, X, ChevronDown, ChevronUp,
    Loader2, Info
} from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { usePatientRecord } from '../../services/PatientRecord';
import EventLogger, { COMPONENTS } from '../../services/eventLogger';
import { apiUrl } from '../../config/api';

/**
 * TreatmentPanel - Main component for ordering treatments
 * Handles medications, IV fluids, oxygen therapy, and nursing interventions
 */
export default function TreatmentPanel({ sessionId, caseId, onEffectsUpdate }) {
    const [activeCategory, setActiveCategory] = useState('medication');
    const [treatments, setTreatments] = useState({
        medication: [],
        iv_fluid: [],
        oxygen: [],
        nursing: []
    });
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTreatment, setSelectedTreatment] = useState(null);
    const [orderingInProgress, setOrderingInProgress] = useState(false);
    const toast = useToast();
    const { ordered, administered } = usePatientRecord();

    // Order form state
    const [orderForm, setOrderForm] = useState({
        dose_value: '',
        dose_unit: '',
        route: '',
        frequency: 'once',
        rate_value: '',
        rate_unit: 'ml/hr',
        urgency: 'routine',
        notes: ''
    });

    const categories = [
        { id: 'medication', label: 'Medications', icon: Pill, color: 'pink' },
        { id: 'iv_fluid', label: 'IV Fluids', icon: Droplets, color: 'blue' },
        { id: 'oxygen', label: 'Oxygen', icon: Wind, color: 'cyan' },
        { id: 'nursing', label: 'Nursing', icon: HeartPulse, color: 'green' }
    ];

    // Fetch available treatments
    useEffect(() => {
        if (!sessionId) return;
        fetchTreatments();
        fetchOrders();
    }, [sessionId]);

    const fetchTreatments = async () => {
        try {
            const token = localStorage.getItem('token');
            console.log('[TreatmentPanel] Fetching treatments for session:', sessionId);
            const response = await fetch(apiUrl(`/api/sessions/${sessionId}/available-treatments`), {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                console.log('[TreatmentPanel] Received treatments:', data.treatments);
                setTreatments(data.treatments);
            } else {
                const errorData = await response.json();
                console.error('[TreatmentPanel] Failed to fetch treatments:', response.status, errorData);
                toast.error(errorData.error || 'Failed to load treatments');
            }
        } catch (error) {
            console.error('[TreatmentPanel] Error fetching treatments:', error);
            toast.error('Failed to load treatments: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const fetchOrders = async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(apiUrl(`/api/sessions/${sessionId}/treatment-orders`), {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                setOrders(data.orders || []);
            }
        } catch (error) {
            console.error('Failed to fetch treatment orders:', error);
        }
    };

    // Filter treatments by search query
    const filteredTreatments = (treatments[activeCategory] || []).filter(t => {
        if (!searchQuery) return true;
        return t.treatment_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
               t.description?.toLowerCase().includes(searchQuery.toLowerCase());
    });

    // Order a treatment
    const handleOrderTreatment = async () => {
        if (!selectedTreatment) return;
        setOrderingInProgress(true);

        try {
            const token = localStorage.getItem('token');
            const orderData = {
                treatment_type: selectedTreatment.treatment_type,
                treatment_name: selectedTreatment.treatment_name,
                dose: orderForm.dose_value && orderForm.dose_unit
                    ? `${orderForm.dose_value} ${orderForm.dose_unit}`
                    : null,
                dose_value: orderForm.dose_value ? parseFloat(orderForm.dose_value) : null,
                dose_unit: orderForm.dose_unit || null,
                route: orderForm.route || selectedTreatment.route,
                frequency: orderForm.frequency,
                rate: orderForm.rate_value && orderForm.rate_unit
                    ? `${orderForm.rate_value} ${orderForm.rate_unit}`
                    : null,
                rate_value: orderForm.rate_value ? parseFloat(orderForm.rate_value) : null,
                rate_unit: orderForm.rate_unit || null,
                urgency: orderForm.urgency,
                notes: orderForm.notes || null
            };

            const response = await fetch(apiUrl(`/api/sessions/${sessionId}/order-treatment`), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(orderData)
            });

            const result = await response.json();

            if (response.ok) {
                // Log to EventLogger
                EventLogger.treatmentOrdered(
                    result.order_id,
                    selectedTreatment.treatment_name,
                    COMPONENTS.TREATMENT_PANEL,
                    { type: selectedTreatment.treatment_type, dose: orderData.dose, route: orderData.route }
                );

                // Record to PatientRecord
                ordered(selectedTreatment.treatment_type, selectedTreatment.treatment_name, {
                    dose: orderData.dose,
                    route: orderData.route,
                    urgency: orderData.urgency
                });

                // Show appropriate feedback
                if (result.is_contraindicated) {
                    toast.warning(`Warning: ${result.contraindication_feedback || 'This treatment may be contraindicated for this patient.'}`);
                } else if (result.is_expected) {
                    toast.success(`Ordered ${selectedTreatment.treatment_name} (+${result.points_awarded} points)`);
                } else {
                    toast.success(`Ordered ${selectedTreatment.treatment_name}`);
                }

                if (result.is_high_alert) {
                    toast.info('High-alert medication - verify dose and route');
                }

                // Reset form and refresh orders
                setSelectedTreatment(null);
                setOrderForm({
                    dose_value: '',
                    dose_unit: '',
                    route: '',
                    frequency: 'once',
                    rate_value: '',
                    rate_unit: 'ml/hr',
                    urgency: 'routine',
                    notes: ''
                });
                fetchOrders();
            } else {
                toast.error(result.error || 'Failed to order treatment');
            }
        } catch (error) {
            toast.error('Failed to order treatment: ' + error.message);
        } finally {
            setOrderingInProgress(false);
        }
    };

    // Administer a treatment
    const handleAdminister = async (orderId) => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(apiUrl(`/api/sessions/${sessionId}/administer/${orderId}`), {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            const result = await response.json();

            if (response.ok) {
                const order = orders.find(o => o.id === orderId);
                toast.success(`Administered ${order?.treatment_item || 'treatment'}`);

                // Record to PatientRecord
                administered(order?.treatment_type || 'treatment', order?.treatment_item, {
                    dose: order?.dose,
                    route: order?.route
                });

                // Log to EventLogger
                EventLogger.log('ADMINISTERED_MEDICATION', 'treatment', {
                    objectId: orderId,
                    objectName: order?.treatment_item,
                    component: COMPONENTS.TREATMENT_PANEL,
                    context: result.effect_details
                });

                fetchOrders();

                // Notify parent of effects update
                if (onEffectsUpdate) {
                    onEffectsUpdate();
                }
            } else {
                toast.error(result.error || 'Failed to administer');
            }
        } catch (error) {
            toast.error('Failed to administer: ' + error.message);
        }
    };

    // Discontinue a treatment
    const handleDiscontinue = async (orderId) => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(apiUrl(`/api/sessions/${sessionId}/discontinue/${orderId}`), {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                toast.info('Treatment discontinued');
                fetchOrders();
                if (onEffectsUpdate) {
                    onEffectsUpdate();
                }
            } else {
                const result = await response.json();
                toast.error(result.error || 'Failed to discontinue');
            }
        } catch (error) {
            toast.error('Failed to discontinue: ' + error.message);
        }
    };

    const getCategoryColor = (categoryId) => {
        const cat = categories.find(c => c.id === categoryId);
        return cat?.color || 'neutral';
    };

    // Render order form based on treatment type
    const renderOrderForm = () => {
        if (!selectedTreatment) return null;

        const { treatment_type, treatment_name, route, base_dose, base_dose_unit, description, is_contraindicated } = selectedTreatment;

        return (
            <div className="p-4 bg-neutral-800 rounded-lg border border-neutral-700 space-y-4">
                <div className="flex items-start justify-between">
                    <div>
                        <h4 className="font-bold text-white">{treatment_name}</h4>
                        {description && <p className="text-xs text-neutral-400 mt-1">{description}</p>}
                    </div>
                    <button onClick={() => setSelectedTreatment(null)} className="text-neutral-400 hover:text-white">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {is_contraindicated && (
                    <div className="flex items-center gap-2 p-2 bg-red-900/30 border border-red-600 rounded text-red-300 text-sm">
                        <AlertTriangle className="w-4 h-4" />
                        <span>Potentially contraindicated for this patient</span>
                    </div>
                )}

                {/* Medication-specific form */}
                {treatment_type === 'medication' && (
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-neutral-400">Dose</label>
                            <div className="flex gap-1">
                                <input
                                    type="number"
                                    value={orderForm.dose_value}
                                    onChange={(e) => setOrderForm(f => ({ ...f, dose_value: e.target.value }))}
                                    placeholder={base_dose || '0'}
                                    className="flex-1 px-2 py-1.5 bg-neutral-700 border border-neutral-600 rounded text-sm text-white"
                                />
                                <select
                                    value={orderForm.dose_unit}
                                    onChange={(e) => setOrderForm(f => ({ ...f, dose_unit: e.target.value }))}
                                    className="px-2 py-1.5 bg-neutral-700 border border-neutral-600 rounded text-sm text-white"
                                >
                                    <option value="">{base_dose_unit || 'unit'}</option>
                                    <option value="mg">mg</option>
                                    <option value="mcg">mcg</option>
                                    <option value="g">g</option>
                                    <option value="ml">ml</option>
                                    <option value="units">units</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs text-neutral-400">Route</label>
                            <select
                                value={orderForm.route}
                                onChange={(e) => setOrderForm(f => ({ ...f, route: e.target.value }))}
                                className="w-full px-2 py-1.5 bg-neutral-700 border border-neutral-600 rounded text-sm text-white"
                            >
                                <option value="">{route || 'Select route'}</option>
                                <option value="IV">IV Push</option>
                                <option value="IV infusion">IV Infusion</option>
                                <option value="IM">IM</option>
                                <option value="SC">SC</option>
                                <option value="PO">PO</option>
                                <option value="SL">SL</option>
                                <option value="inhaled">Inhaled</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-neutral-400">Frequency</label>
                            <select
                                value={orderForm.frequency}
                                onChange={(e) => setOrderForm(f => ({ ...f, frequency: e.target.value }))}
                                className="w-full px-2 py-1.5 bg-neutral-700 border border-neutral-600 rounded text-sm text-white"
                            >
                                <option value="once">Once</option>
                                <option value="stat">STAT</option>
                                <option value="q4h">Q4H</option>
                                <option value="q6h">Q6H</option>
                                <option value="q8h">Q8H</option>
                                <option value="daily">Daily</option>
                                <option value="bid">BID</option>
                                <option value="tid">TID</option>
                                <option value="prn">PRN</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-neutral-400">Urgency</label>
                            <select
                                value={orderForm.urgency}
                                onChange={(e) => setOrderForm(f => ({ ...f, urgency: e.target.value }))}
                                className="w-full px-2 py-1.5 bg-neutral-700 border border-neutral-600 rounded text-sm text-white"
                            >
                                <option value="routine">Routine</option>
                                <option value="stat">STAT</option>
                                <option value="prn">PRN</option>
                            </select>
                        </div>
                    </div>
                )}

                {/* IV Fluid-specific form */}
                {treatment_type === 'iv_fluid' && (
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-neutral-400">Rate</label>
                            <div className="flex gap-1">
                                <input
                                    type="number"
                                    value={orderForm.rate_value}
                                    onChange={(e) => setOrderForm(f => ({ ...f, rate_value: e.target.value }))}
                                    placeholder="125"
                                    className="flex-1 px-2 py-1.5 bg-neutral-700 border border-neutral-600 rounded text-sm text-white"
                                />
                                <select
                                    value={orderForm.rate_unit}
                                    onChange={(e) => setOrderForm(f => ({ ...f, rate_unit: e.target.value }))}
                                    className="px-2 py-1.5 bg-neutral-700 border border-neutral-600 rounded text-sm text-white"
                                >
                                    <option value="ml/hr">ml/hr</option>
                                    <option value="bolus">Bolus</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs text-neutral-400">Urgency</label>
                            <select
                                value={orderForm.urgency}
                                onChange={(e) => setOrderForm(f => ({ ...f, urgency: e.target.value }))}
                                className="w-full px-2 py-1.5 bg-neutral-700 border border-neutral-600 rounded text-sm text-white"
                            >
                                <option value="routine">Routine</option>
                                <option value="stat">STAT (Bolus)</option>
                            </select>
                        </div>
                    </div>
                )}

                {/* Oxygen-specific form - no additional fields needed */}
                {treatment_type === 'oxygen' && (
                    <div className="text-sm text-neutral-400">
                        <Info className="w-4 h-4 inline mr-1" />
                        This will start continuous oxygen therapy at the selected level.
                    </div>
                )}

                {/* Nursing-specific form - no additional fields needed */}
                {treatment_type === 'nursing' && (
                    <div className="text-sm text-neutral-400">
                        <Info className="w-4 h-4 inline mr-1" />
                        This nursing intervention will be applied immediately.
                    </div>
                )}

                {/* Notes field */}
                <div>
                    <label className="text-xs text-neutral-400">Notes (optional)</label>
                    <input
                        type="text"
                        value={orderForm.notes}
                        onChange={(e) => setOrderForm(f => ({ ...f, notes: e.target.value }))}
                        placeholder="Additional instructions..."
                        className="w-full px-2 py-1.5 bg-neutral-700 border border-neutral-600 rounded text-sm text-white"
                    />
                </div>

                {/* Effect preview */}
                {(selectedTreatment.hr_effect || selectedTreatment.bp_sys_effect || selectedTreatment.spo2_effect) && (
                    <div className="text-xs text-neutral-400 p-2 bg-neutral-900 rounded">
                        <span className="font-bold">Expected Effects:</span>
                        {selectedTreatment.hr_effect !== 0 && <span className="ml-2">HR {selectedTreatment.hr_effect > 0 ? '+' : ''}{selectedTreatment.hr_effect}</span>}
                        {selectedTreatment.bp_sys_effect !== 0 && <span className="ml-2">BP {selectedTreatment.bp_sys_effect > 0 ? '+' : ''}{selectedTreatment.bp_sys_effect}/{selectedTreatment.bp_dia_effect > 0 ? '+' : ''}{selectedTreatment.bp_dia_effect}</span>}
                        {selectedTreatment.spo2_effect !== 0 && <span className="ml-2">SpO2 {selectedTreatment.spo2_effect > 0 ? '+' : ''}{selectedTreatment.spo2_effect}%</span>}
                        {selectedTreatment.rr_effect !== 0 && <span className="ml-2">RR {selectedTreatment.rr_effect > 0 ? '+' : ''}{selectedTreatment.rr_effect}</span>}
                        <span className="ml-2 text-neutral-500">| Onset: {selectedTreatment.onset_minutes}min, Peak: {selectedTreatment.peak_minutes}min</span>
                    </div>
                )}

                {/* Order button */}
                <button
                    onClick={handleOrderTreatment}
                    disabled={orderingInProgress}
                    className={`w-full py-2 rounded font-bold text-white flex items-center justify-center gap-2 ${
                        is_contraindicated
                            ? 'bg-red-600 hover:bg-red-500'
                            : `bg-${getCategoryColor(activeCategory)}-600 hover:bg-${getCategoryColor(activeCategory)}-500`
                    } disabled:opacity-50`}
                >
                    {orderingInProgress ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Ordering...</>
                    ) : (
                        <>Order {treatment_name}</>
                    )}
                </button>
            </div>
        );
    };

    // Render orders list
    const renderOrders = () => {
        const activeOrders = orders.filter(o => o.status !== 'discontinued' && o.status !== 'completed');
        if (activeOrders.length === 0) return null;

        return (
            <div className="space-y-2">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Active Orders ({activeOrders.length})
                </h4>
                {activeOrders.map(order => (
                    <div
                        key={order.id}
                        className={`p-3 rounded border ${
                            order.status === 'ordered' ? 'bg-yellow-900/20 border-yellow-600/50' :
                            order.status === 'in_progress' ? 'bg-green-900/20 border-green-600/50' :
                            'bg-neutral-800 border-neutral-700'
                        }`}
                    >
                        <div className="flex items-start justify-between">
                            <div>
                                <div className="font-medium text-white flex items-center gap-2">
                                    {order.is_high_alert && <AlertTriangle className="w-4 h-4 text-red-400" />}
                                    {order.treatment_item}
                                </div>
                                <div className="text-xs text-neutral-400">
                                    {order.dose && <span>{order.dose} </span>}
                                    {order.route && <span>{order.route} </span>}
                                    {order.rate && <span>@ {order.rate}</span>}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {order.status === 'ordered' && (
                                    <button
                                        onClick={() => handleAdminister(order.id)}
                                        className="px-2 py-1 bg-green-600 hover:bg-green-500 text-white text-xs rounded flex items-center gap-1"
                                    >
                                        <Play className="w-3 h-3" /> Give
                                    </button>
                                )}
                                {order.status === 'in_progress' && (
                                    <button
                                        onClick={() => handleDiscontinue(order.id)}
                                        className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded flex items-center gap-1"
                                    >
                                        <Pause className="w-3 h-3" /> Stop
                                    </button>
                                )}
                                <span className={`text-xs px-2 py-0.5 rounded ${
                                    order.status === 'ordered' ? 'bg-yellow-600/30 text-yellow-300' :
                                    order.status === 'in_progress' ? 'bg-green-600/30 text-green-300' :
                                    order.status === 'administered' ? 'bg-blue-600/30 text-blue-300' :
                                    'bg-neutral-600/30 text-neutral-300'
                                }`}>
                                    {order.status}
                                </span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-neutral-400" />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            {/* Category Tabs */}
            <div className="flex gap-1 p-3 border-b border-neutral-800">
                {categories.map(cat => (
                    <button
                        key={cat.id}
                        onClick={() => {
                            setActiveCategory(cat.id);
                            setSelectedTreatment(null);
                            EventLogger.tabSwitched(cat.id, COMPONENTS.TREATMENT_PANEL);
                        }}
                        className={`flex-1 px-3 py-2 rounded text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
                            activeCategory === cat.id
                                ? `bg-${cat.color}-600 text-white`
                                : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                        }`}
                    >
                        <cat.icon className="w-4 h-4" />
                        <span className="hidden sm:inline">{cat.label}</span>
                    </button>
                ))}
            </div>

            {/* Search */}
            <div className="p-3 border-b border-neutral-800">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={`Search ${categories.find(c => c.id === activeCategory)?.label.toLowerCase()}...`}
                        className="w-full pl-10 pr-4 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
                    />
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden flex">
                {/* Left: Treatment List */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {filteredTreatments.length === 0 ? (
                        <div className="text-center py-8 text-neutral-500">
                            <p>No {categories.find(c => c.id === activeCategory)?.label.toLowerCase()} available</p>
                        </div>
                    ) : (
                        filteredTreatments.map(treatment => {
                            const isSelected = selectedTreatment?.id === treatment.id;
                            const color = getCategoryColor(activeCategory);
                            return (
                                <button
                                    key={treatment.id}
                                    onClick={() => setSelectedTreatment(isSelected ? null : treatment)}
                                    className={`w-full text-left p-3 rounded border transition-all ${
                                        isSelected
                                            ? `bg-${color}-900/30 border-${color}-600`
                                            : treatment.is_contraindicated
                                            ? 'bg-red-900/10 border-red-800/50 hover:bg-red-900/20'
                                            : treatment.is_expected
                                            ? 'bg-green-900/10 border-green-800/50 hover:bg-green-900/20'
                                            : 'bg-neutral-800/50 border-neutral-700 hover:bg-neutral-800'
                                    }`}
                                >
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <div className="font-medium text-white flex items-center gap-2">
                                                {treatment.treatment_name}
                                                {treatment.is_contraindicated && (
                                                    <span className="text-xs px-1.5 py-0.5 bg-red-600/30 text-red-300 rounded">CI</span>
                                                )}
                                                {treatment.is_expected && (
                                                    <span className="text-xs px-1.5 py-0.5 bg-green-600/30 text-green-300 rounded">Expected</span>
                                                )}
                                            </div>
                                            {treatment.description && (
                                                <p className="text-xs text-neutral-400 mt-1">{treatment.description}</p>
                                            )}
                                            {treatment.route && (
                                                <span className="text-xs text-neutral-500 mt-1 inline-block">Route: {treatment.route}</span>
                                            )}
                                        </div>
                                        {isSelected ? (
                                            <ChevronUp className="w-4 h-4 text-neutral-400" />
                                        ) : (
                                            <ChevronDown className="w-4 h-4 text-neutral-400" />
                                        )}
                                    </div>
                                    {isSelected && (
                                        <div className="mt-3 pt-3 border-t border-neutral-700" onClick={e => e.stopPropagation()}>
                                            {renderOrderForm()}
                                        </div>
                                    )}
                                </button>
                            );
                        })
                    )}
                </div>

                {/* Right: Active Orders */}
                <div className="w-64 border-l border-neutral-800 p-3 overflow-y-auto bg-neutral-900/50">
                    {renderOrders()}
                    {orders.filter(o => o.status !== 'discontinued' && o.status !== 'completed').length === 0 && (
                        <div className="text-center py-8 text-neutral-500">
                            <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
                            <p className="text-sm">No active orders</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
