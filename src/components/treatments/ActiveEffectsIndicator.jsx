import React, { useState, useEffect } from 'react';
import {
    Activity, TrendingUp, TrendingDown, Minus,
    Heart, Droplets, Wind, Thermometer,
    ChevronDown, ChevronUp, Clock, Pill
} from 'lucide-react';
import { apiUrl } from '../../config/api';

/**
 * ActiveEffectsIndicator - Visual indicator of active treatment effects
 * Shows aggregate effects and individual treatments
 */
export default function ActiveEffectsIndicator({ sessionId, refreshTrigger, compact = false }) {
    const [effects, setEffects] = useState(null);
    const [expanded, setExpanded] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!sessionId) return;
        fetchEffects();
        // Poll for updates every 5 seconds
        const interval = setInterval(fetchEffects, 5000);
        return () => clearInterval(interval);
    }, [sessionId, refreshTrigger]);

    const fetchEffects = async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(apiUrl(`/api/sessions/${sessionId}/active-effects`), {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                setEffects(data);
            }
        } catch (error) {
            console.error('Failed to fetch active effects:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading || !effects || effects.treatment_count === 0) {
        return null;
    }

    const { aggregate_effects, active_treatments, treatment_count } = effects;

    // Helper to render effect value with icon
    const renderEffect = (value, icon, label, unit = '') => {
        if (value === 0) return null;
        const Icon = icon;
        const isPositive = value > 0;
        const TrendIcon = isPositive ? TrendingUp : TrendingDown;
        const color = isPositive ? 'text-green-400' : 'text-red-400';

        return (
            <div className="flex items-center gap-1">
                <Icon className="w-3 h-3 text-neutral-400" />
                <TrendIcon className={`w-3 h-3 ${color}`} />
                <span className={`text-xs font-bold ${color}`}>
                    {isPositive ? '+' : ''}{value}{unit}
                </span>
            </div>
        );
    };

    // Compact view for status bar
    if (compact) {
        return (
            <div className="flex items-center gap-2 px-2 py-1 bg-neutral-800/50 rounded text-xs">
                <Pill className="w-3 h-3 text-pink-400" />
                <span className="text-neutral-400">{treatment_count} active</span>
                {aggregate_effects.hr_effect !== 0 && (
                    <span className={aggregate_effects.hr_effect > 0 ? 'text-green-400' : 'text-red-400'}>
                        HR {aggregate_effects.hr_effect > 0 ? '+' : ''}{aggregate_effects.hr_effect}
                    </span>
                )}
                {aggregate_effects.bp_sys_effect !== 0 && (
                    <span className={aggregate_effects.bp_sys_effect > 0 ? 'text-green-400' : 'text-red-400'}>
                        BP {aggregate_effects.bp_sys_effect > 0 ? '+' : ''}{aggregate_effects.bp_sys_effect}
                    </span>
                )}
                {aggregate_effects.spo2_effect !== 0 && (
                    <span className={aggregate_effects.spo2_effect > 0 ? 'text-green-400' : 'text-red-400'}>
                        SpO2 {aggregate_effects.spo2_effect > 0 ? '+' : ''}{aggregate_effects.spo2_effect}%
                    </span>
                )}
            </div>
        );
    }

    return (
        <div className="bg-neutral-800 rounded-lg border border-neutral-700 overflow-hidden">
            {/* Header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full px-3 py-2 flex items-center justify-between hover:bg-neutral-700/50 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-pink-400" />
                    <span className="text-sm font-bold text-white">Active Treatments ({treatment_count})</span>
                </div>
                <div className="flex items-center gap-3">
                    {/* Aggregate effects summary */}
                    <div className="flex items-center gap-2">
                        {renderEffect(aggregate_effects.hr_effect, Heart, 'HR')}
                        {renderEffect(aggregate_effects.bp_sys_effect, Activity, 'BP')}
                        {renderEffect(aggregate_effects.spo2_effect, Wind, 'SpO2', '%')}
                    </div>
                    {expanded ? <ChevronUp className="w-4 h-4 text-neutral-400" /> : <ChevronDown className="w-4 h-4 text-neutral-400" />}
                </div>
            </button>

            {/* Expanded details */}
            {expanded && (
                <div className="border-t border-neutral-700 divide-y divide-neutral-700/50">
                    {active_treatments.map(treatment => (
                        <div key={treatment.id} className="px-3 py-2">
                            <div className="flex items-start justify-between">
                                <div>
                                    <div className="text-sm font-medium text-white">{treatment.treatment_item}</div>
                                    <div className="text-xs text-neutral-400">
                                        {treatment.dose && <span>{treatment.dose} </span>}
                                        {treatment.route && <span className="text-neutral-500">{treatment.route}</span>}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className={`text-xs font-bold px-2 py-0.5 rounded ${
                                        treatment.current_phase === 'onset' ? 'bg-yellow-600/30 text-yellow-300' :
                                        treatment.current_phase === 'peak' ? 'bg-green-600/30 text-green-300' :
                                        treatment.current_phase === 'decline' ? 'bg-orange-600/30 text-orange-300' :
                                        'bg-neutral-600/30 text-neutral-300'
                                    }`}>
                                        {treatment.current_phase}
                                    </div>
                                    <div className="text-xs text-neutral-500 mt-0.5">
                                        {Math.round(treatment.current_strength * 100)}% effect
                                    </div>
                                </div>
                            </div>

                            {/* Effect strength bar */}
                            <div className="mt-2 h-1.5 bg-neutral-700 rounded-full overflow-hidden">
                                <div
                                    className={`h-full transition-all duration-1000 ${
                                        treatment.current_phase === 'onset' ? 'bg-yellow-500' :
                                        treatment.current_phase === 'peak' ? 'bg-green-500' :
                                        treatment.current_phase === 'decline' ? 'bg-orange-500' :
                                        'bg-neutral-500'
                                    }`}
                                    style={{ width: `${treatment.current_strength * 100}%` }}
                                />
                            </div>

                            {/* Current effects */}
                            <div className="mt-2 flex gap-3 text-xs">
                                {treatment.current_hr_effect !== 0 && (
                                    <span className={treatment.current_hr_effect > 0 ? 'text-green-400' : 'text-red-400'}>
                                        HR {treatment.current_hr_effect > 0 ? '+' : ''}{treatment.current_hr_effect}
                                    </span>
                                )}
                                {treatment.current_bp_sys_effect !== 0 && (
                                    <span className={treatment.current_bp_sys_effect > 0 ? 'text-green-400' : 'text-red-400'}>
                                        BP {treatment.current_bp_sys_effect > 0 ? '+' : ''}{treatment.current_bp_sys_effect}/{treatment.current_bp_dia_effect > 0 ? '+' : ''}{treatment.current_bp_dia_effect}
                                    </span>
                                )}
                                {treatment.current_spo2_effect !== 0 && (
                                    <span className={treatment.current_spo2_effect > 0 ? 'text-green-400' : 'text-red-400'}>
                                        SpO2 {treatment.current_spo2_effect > 0 ? '+' : ''}{treatment.current_spo2_effect}%
                                    </span>
                                )}
                                {treatment.current_rr_effect !== 0 && (
                                    <span className={treatment.current_rr_effect > 0 ? 'text-green-400' : 'text-red-400'}>
                                        RR {treatment.current_rr_effect > 0 ? '+' : ''}{treatment.current_rr_effect}
                                    </span>
                                )}
                                {treatment.is_continuous && (
                                    <span className="text-cyan-400 flex items-center gap-1">
                                        <Clock className="w-3 h-3" /> Continuous
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Aggregate summary bar */}
            <div className="px-3 py-2 bg-neutral-900/50 border-t border-neutral-700 grid grid-cols-5 gap-2 text-center text-xs">
                <div>
                    <div className="text-neutral-500">HR</div>
                    <div className={`font-bold ${aggregate_effects.hr_effect > 0 ? 'text-green-400' : aggregate_effects.hr_effect < 0 ? 'text-red-400' : 'text-neutral-400'}`}>
                        {aggregate_effects.hr_effect > 0 ? '+' : ''}{aggregate_effects.hr_effect || '-'}
                    </div>
                </div>
                <div>
                    <div className="text-neutral-500">SBP</div>
                    <div className={`font-bold ${aggregate_effects.bp_sys_effect > 0 ? 'text-green-400' : aggregate_effects.bp_sys_effect < 0 ? 'text-red-400' : 'text-neutral-400'}`}>
                        {aggregate_effects.bp_sys_effect > 0 ? '+' : ''}{aggregate_effects.bp_sys_effect || '-'}
                    </div>
                </div>
                <div>
                    <div className="text-neutral-500">DBP</div>
                    <div className={`font-bold ${aggregate_effects.bp_dia_effect > 0 ? 'text-green-400' : aggregate_effects.bp_dia_effect < 0 ? 'text-red-400' : 'text-neutral-400'}`}>
                        {aggregate_effects.bp_dia_effect > 0 ? '+' : ''}{aggregate_effects.bp_dia_effect || '-'}
                    </div>
                </div>
                <div>
                    <div className="text-neutral-500">SpO2</div>
                    <div className={`font-bold ${aggregate_effects.spo2_effect > 0 ? 'text-green-400' : aggregate_effects.spo2_effect < 0 ? 'text-red-400' : 'text-neutral-400'}`}>
                        {aggregate_effects.spo2_effect > 0 ? '+' : ''}{aggregate_effects.spo2_effect || '-'}%
                    </div>
                </div>
                <div>
                    <div className="text-neutral-500">RR</div>
                    <div className={`font-bold ${aggregate_effects.rr_effect > 0 ? 'text-green-400' : aggregate_effects.rr_effect < 0 ? 'text-red-400' : 'text-neutral-400'}`}>
                        {aggregate_effects.rr_effect > 0 ? '+' : ''}{aggregate_effects.rr_effect || '-'}
                    </div>
                </div>
            </div>
        </div>
    );
}
