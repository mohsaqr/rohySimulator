import React, { useState, useEffect } from 'react';
import {
    Pill, Droplets, Wind, HeartPulse,
    Search, AlertTriangle, Clock,
    Play, Pause, X, ChevronDown, ChevronUp,
    Loader2, Info
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../contexts/ToastContext';
import { usePatientRecord } from '../../services/PatientRecord';
import EventLogger, { COMPONENTS } from '../../services/eventLogger';
import { ApiError, apiFetch, apiPost, apiPut } from '../../services/apiClient';

// Backend order statuses -> static i18n keys (never t(variable) — every
// enum value gets an explicit key; unknown values fall back to the raw
// backend string).
const STATUS_LABEL_KEYS = {
    ordered: 'status_ordered',
    in_progress: 'status_in_progress',
    administered: 'status_administered',
    completed: 'status_completed',
    discontinued: 'status_discontinued'
};

/**
 * TreatmentPanel - Main component for ordering treatments
 * Handles medications, IV fluids, oxygen therapy, and nursing interventions
 */
export default function TreatmentPanel({ sessionId, _caseId, onEffectsUpdate }) {
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
    const { t } = useTranslation('treatments');
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
        { id: 'medication', label: t('category_medications'), icon: Pill, color: 'pink' },
        { id: 'iv_fluid', label: t('category_iv_fluids'), icon: Droplets, color: 'blue' },
        { id: 'oxygen', label: t('category_oxygen'), icon: Wind, color: 'cyan' },
        { id: 'nursing', label: t('category_nursing'), icon: HeartPulse, color: 'green' }
    ];

    // Fetch available treatments
    useEffect(() => {
        if (!sessionId) return;
        fetchTreatments();
        fetchOrders();
    }, [sessionId]);

    const fetchTreatments = async () => {
        try {
            const data = await apiFetch(`/sessions/${sessionId}/available-treatments`);
            setTreatments(data?.treatments || []);
        } catch (error) {
            console.error('[TreatmentPanel] Error fetching treatments:', error);
            toast.error(t('failed_load_treatments', { error: error.message }));
        } finally {
            setLoading(false);
        }
    };

    const fetchOrders = async () => {
        try {
            const data = await apiFetch(`/sessions/${sessionId}/treatment-orders`);
            setOrders(data?.orders || []);
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

            let result;
            try {
                result = await apiPost(`/sessions/${sessionId}/order-treatment`, orderData);
            } catch (err) {
                if (err instanceof ApiError) {
                    toast.error(err.message || t('failed_order_treatment'));
                    return;
                }
                throw err;
            }

            EventLogger.treatmentOrdered(
                result.order_id,
                selectedTreatment.treatment_name,
                COMPONENTS.TREATMENT_PANEL,
                { type: selectedTreatment.treatment_type, dose: orderData.dose, route: orderData.route }
            );

            ordered(selectedTreatment.treatment_type, selectedTreatment.treatment_name, {
                dose: orderData.dose,
                route: orderData.route,
                urgency: orderData.urgency
            });

            if (result.is_contraindicated) {
                toast.warning(t('warning_prefix', { message: result.contraindication_feedback || t('contraindication_default') }));
            } else if (result.is_expected) {
                toast.success(t('ordered_with_points', { name: selectedTreatment.treatment_name, points: result.points_awarded }));
            } else {
                toast.success(t('ordered_treatment', { name: selectedTreatment.treatment_name }));
            }

            if (result.is_high_alert) {
                toast.info(t('high_alert_warning'));
            }

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
        } catch (error) {
            toast.error(t('failed_order_treatment_error', { error: error.message }));
        } finally {
            setOrderingInProgress(false);
        }
    };

    // Administer a treatment
    const handleAdminister = async (orderId) => {
        try {
            const result = await apiPost(`/sessions/${sessionId}/administer/${orderId}`);
            const order = orders.find(o => o.id === orderId);
            toast.success(t('administered_treatment', { name: order?.treatment_item || t('treatment_generic') }));

            administered(order?.treatment_type || 'treatment', order?.treatment_item, {
                dose: order?.dose,
                route: order?.route
            });

            EventLogger.log('ADMINISTERED_MEDICATION', 'treatment', {
                objectId: orderId,
                objectName: order?.treatment_item,
                component: COMPONENTS.TREATMENT_PANEL,
                context: result?.effect_details
            });

            fetchOrders();
            onEffectsUpdate?.();
        } catch (error) {
            toast.error(t('failed_administer', { error: error.message }));
        }
    };

    // Discontinue a treatment
    const handleDiscontinue = async (orderId) => {
        try {
            await apiPut(`/sessions/${sessionId}/discontinue/${orderId}`);
            const order = orders.find(o => o.id === orderId);
            toast.info(t('treatment_discontinued'));
            EventLogger.treatmentDiscontinued(orderId, order?.treatment_item, COMPONENTS.TREATMENT_PANEL);
            fetchOrders();
            onEffectsUpdate?.();
        } catch (error) {
            toast.error(t('failed_discontinue', { error: error.message }));
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
                        <span>{t('contraindicated_warning')}</span>
                    </div>
                )}

                {/* Medication-specific form */}
                {treatment_type === 'medication' && (
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-neutral-400">{t('dose')}</label>
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
                                    <option value="">{base_dose_unit || t('unit_fallback')}</option>
                                    <option value="mg">mg</option>
                                    <option value="mcg">mcg</option>
                                    <option value="g">g</option>
                                    <option value="ml">ml</option>
                                    <option value="units">units</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs text-neutral-400">{t('route')}</label>
                            <select
                                value={orderForm.route}
                                onChange={(e) => setOrderForm(f => ({ ...f, route: e.target.value }))}
                                className="w-full px-2 py-1.5 bg-neutral-700 border border-neutral-600 rounded text-sm text-white"
                            >
                                <option value="">{route || t('select_route')}</option>
                                <option value="IV">{t('route_iv_push')}</option>
                                <option value="IV infusion">{t('route_iv_infusion')}</option>
                                <option value="IM">{t('route_im')}</option>
                                <option value="SC">{t('route_sc')}</option>
                                <option value="PO">{t('route_po')}</option>
                                <option value="SL">{t('route_sl')}</option>
                                <option value="inhaled">{t('route_inhaled')}</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-neutral-400">{t('frequency')}</label>
                            <select
                                value={orderForm.frequency}
                                onChange={(e) => setOrderForm(f => ({ ...f, frequency: e.target.value }))}
                                className="w-full px-2 py-1.5 bg-neutral-700 border border-neutral-600 rounded text-sm text-white"
                            >
                                <option value="once">{t('freq_once')}</option>
                                <option value="stat">{t('freq_stat')}</option>
                                <option value="q4h">{t('freq_q4h')}</option>
                                <option value="q6h">{t('freq_q6h')}</option>
                                <option value="q8h">{t('freq_q8h')}</option>
                                <option value="daily">{t('freq_daily')}</option>
                                <option value="bid">{t('freq_bid')}</option>
                                <option value="tid">{t('freq_tid')}</option>
                                <option value="prn">{t('freq_prn')}</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-neutral-400">{t('urgency')}</label>
                            <select
                                value={orderForm.urgency}
                                onChange={(e) => setOrderForm(f => ({ ...f, urgency: e.target.value }))}
                                className="w-full px-2 py-1.5 bg-neutral-700 border border-neutral-600 rounded text-sm text-white"
                            >
                                <option value="routine">{t('urgency_routine')}</option>
                                <option value="stat">{t('urgency_stat')}</option>
                                <option value="prn">{t('urgency_prn')}</option>
                            </select>
                        </div>
                    </div>
                )}

                {/* IV Fluid-specific form */}
                {treatment_type === 'iv_fluid' && (
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-neutral-400">{t('rate')}</label>
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
                                    <option value="bolus">{t('rate_bolus')}</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs text-neutral-400">{t('urgency')}</label>
                            <select
                                value={orderForm.urgency}
                                onChange={(e) => setOrderForm(f => ({ ...f, urgency: e.target.value }))}
                                className="w-full px-2 py-1.5 bg-neutral-700 border border-neutral-600 rounded text-sm text-white"
                            >
                                <option value="routine">{t('urgency_routine')}</option>
                                <option value="stat">{t('urgency_stat_bolus')}</option>
                            </select>
                        </div>
                    </div>
                )}

                {/* Oxygen-specific form - no additional fields needed */}
                {treatment_type === 'oxygen' && (
                    <div className="text-sm text-neutral-400">
                        <Info className="w-4 h-4 inline mr-1" />
                        {t('oxygen_info')}
                    </div>
                )}

                {/* Nursing-specific form - no additional fields needed */}
                {treatment_type === 'nursing' && (
                    <div className="text-sm text-neutral-400">
                        <Info className="w-4 h-4 inline mr-1" />
                        {t('nursing_info')}
                    </div>
                )}

                {/* Notes field */}
                <div>
                    <label className="text-xs text-neutral-400">{t('notes_optional')}</label>
                    <input
                        type="text"
                        value={orderForm.notes}
                        onChange={(e) => setOrderForm(f => ({ ...f, notes: e.target.value }))}
                        placeholder={t('additional_instructions_placeholder')}
                        className="w-full px-2 py-1.5 bg-neutral-700 border border-neutral-600 rounded text-sm text-white"
                    />
                </div>

                {/* Effect preview */}
                {(selectedTreatment.hr_effect || selectedTreatment.bp_sys_effect || selectedTreatment.spo2_effect) && (
                    <div className="text-xs text-neutral-400 p-2 bg-neutral-900 rounded">
                        <span className="font-bold">{t('expected_effects')}</span>
                        {selectedTreatment.hr_effect !== 0 && <span className="ml-2">HR {selectedTreatment.hr_effect > 0 ? '+' : ''}{selectedTreatment.hr_effect}</span>}
                        {selectedTreatment.bp_sys_effect !== 0 && <span className="ml-2">BP {selectedTreatment.bp_sys_effect > 0 ? '+' : ''}{selectedTreatment.bp_sys_effect}/{selectedTreatment.bp_dia_effect > 0 ? '+' : ''}{selectedTreatment.bp_dia_effect}</span>}
                        {selectedTreatment.spo2_effect !== 0 && <span className="ml-2">SpO2 {selectedTreatment.spo2_effect > 0 ? '+' : ''}{selectedTreatment.spo2_effect}%</span>}
                        {selectedTreatment.rr_effect !== 0 && <span className="ml-2">RR {selectedTreatment.rr_effect > 0 ? '+' : ''}{selectedTreatment.rr_effect}</span>}
                        <span className="ml-2 text-neutral-500">{t('onset_peak', { onset: selectedTreatment.onset_minutes, peak: selectedTreatment.peak_minutes })}</span>
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
                        <><Loader2 className="w-4 h-4 animate-spin" /> {t('ordering')}</>
                    ) : (
                        <>{t('order_treatment', { name: treatment_name })}</>
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
                    {t('active_orders', { count: activeOrders.length })}
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
                                    {!!order.is_high_alert && <AlertTriangle className="w-4 h-4 text-red-400" />}
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
                                        <Play className="w-3 h-3" /> {t('give')}
                                    </button>
                                )}
                                {order.status === 'in_progress' && (
                                    <button
                                        onClick={() => handleDiscontinue(order.id)}
                                        className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded flex items-center gap-1"
                                    >
                                        <Pause className="w-3 h-3" /> {t('stop')}
                                    </button>
                                )}
                                <span className={`text-xs px-2 py-0.5 rounded ${
                                    order.status === 'ordered' ? 'bg-yellow-600/30 text-yellow-300' :
                                    order.status === 'in_progress' ? 'bg-green-600/30 text-green-300' :
                                    order.status === 'administered' ? 'bg-blue-600/30 text-blue-300' :
                                    'bg-neutral-600/30 text-neutral-300'
                                }`}>
                                    {STATUS_LABEL_KEYS[order.status] ? t(STATUS_LABEL_KEYS[order.status]) : order.status}
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
                        placeholder={t('search_category_placeholder', { category: categories.find(c => c.id === activeCategory)?.label.toLowerCase() })}
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
                            <p>{t('no_category_available', { category: categories.find(c => c.id === activeCategory)?.label.toLowerCase() })}</p>
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
                                                    <span className="text-xs px-1.5 py-0.5 bg-red-600/30 text-red-300 rounded">{t('badge_ci')}</span>
                                                )}
                                                {treatment.is_expected && (
                                                    <span className="text-xs px-1.5 py-0.5 bg-green-600/30 text-green-300 rounded">{t('badge_expected')}</span>
                                                )}
                                            </div>
                                            {treatment.description && (
                                                <p className="text-xs text-neutral-400 mt-1">{treatment.description}</p>
                                            )}
                                            {treatment.route && (
                                                <span className="text-xs text-neutral-500 mt-1 inline-block">{t('route_label', { route: treatment.route })}</span>
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
                            <p className="text-sm">{t('no_active_orders')}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
