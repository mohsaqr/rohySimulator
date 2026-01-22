import React, { useState, useEffect } from 'react';
import {
    Pill, Droplets, Wind, HeartPulse,
    Search, Plus, X, Save, AlertTriangle,
    Check, ChevronDown, ChevronUp, Loader2
} from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { apiUrl } from '../../config/api';

/**
 * CaseTreatmentConfig - Configure treatments for a case in the admin panel
 * Allows setting expected, contraindicated, and available treatments with feedback
 */
export default function CaseTreatmentConfig({ caseId, caseTreatments = [], onUpdate }) {
    const [treatments, setTreatments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState('all');
    const [configuredTreatments, setConfiguredTreatments] = useState(caseTreatments || []);
    const [expandedTreatment, setExpandedTreatment] = useState(null);
    const toast = useToast();

    const categories = [
        { id: 'all', label: 'All' },
        { id: 'medication', label: 'Medications', icon: Pill, color: 'pink' },
        { id: 'iv_fluid', label: 'IV Fluids', icon: Droplets, color: 'blue' },
        { id: 'oxygen', label: 'Oxygen', icon: Wind, color: 'cyan' },
        { id: 'nursing', label: 'Nursing', icon: HeartPulse, color: 'green' }
    ];

    // Fetch available treatment effects (master data)
    useEffect(() => {
        fetchTreatments();
    }, []);

    // Update configured treatments when caseTreatments prop changes
    useEffect(() => {
        setConfiguredTreatments(caseTreatments || []);
    }, [caseTreatments]);

    const fetchTreatments = async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(apiUrl('/api/treatment-effects'), {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                setTreatments(data.effects || []);
            }
        } catch (error) {
            console.error('Failed to fetch treatments:', error);
        } finally {
            setLoading(false);
        }
    };

    // Get configuration for a treatment
    const getConfig = (treatmentName, treatmentType) => {
        return configuredTreatments.find(
            t => t.treatment_name === treatmentName && t.treatment_type === treatmentType
        ) || null;
    };

    // Check if treatment is configured in any way
    const isConfigured = (treatmentName, treatmentType) => {
        const config = getConfig(treatmentName, treatmentType);
        return config && (config.is_expected || config.is_contraindicated || !config.is_available);
    };

    // Update treatment configuration
    const updateTreatmentConfig = (treatment, updates) => {
        setConfiguredTreatments(prev => {
            const key = `${treatment.treatment_type}:${treatment.treatment_name}`;
            const existing = prev.find(
                t => t.treatment_name === treatment.treatment_name && t.treatment_type === treatment.treatment_type
            );

            if (existing) {
                return prev.map(t =>
                    t.treatment_name === treatment.treatment_name && t.treatment_type === treatment.treatment_type
                        ? { ...t, ...updates }
                        : t
                );
            } else {
                return [...prev, {
                    treatment_type: treatment.treatment_type,
                    treatment_name: treatment.treatment_name,
                    is_available: true,
                    is_expected: false,
                    is_contraindicated: false,
                    points_if_ordered: 0,
                    feedback_if_ordered: null,
                    feedback_if_missed: null,
                    ...updates
                }];
            }
        });
    };

    // Remove treatment configuration
    const removeTreatmentConfig = (treatmentName, treatmentType) => {
        setConfiguredTreatments(prev =>
            prev.filter(t => !(t.treatment_name === treatmentName && t.treatment_type === treatmentType))
        );
    };

    // Save configurations
    const handleSave = async () => {
        if (!caseId) {
            // If no caseId, just call onUpdate with the configurations
            if (onUpdate) {
                onUpdate(configuredTreatments);
            }
            toast.success('Treatment configurations updated');
            return;
        }

        setSaving(true);
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(apiUrl(`/api/cases/${caseId}/treatments`), {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ treatments: configuredTreatments })
            });

            if (response.ok) {
                toast.success('Treatment configurations saved');
                if (onUpdate) {
                    onUpdate(configuredTreatments);
                }
            } else {
                const error = await response.json();
                toast.error(error.error || 'Failed to save');
            }
        } catch (error) {
            toast.error('Failed to save: ' + error.message);
        } finally {
            setSaving(false);
        }
    };

    // Filter treatments
    const filteredTreatments = treatments.filter(t => {
        const matchesCategory = activeCategory === 'all' || t.treatment_type === activeCategory;
        const matchesSearch = !searchQuery ||
            t.treatment_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            t.description?.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesCategory && matchesSearch;
    });

    // Get configured treatments for display
    const configuredList = configuredTreatments.filter(ct =>
        ct.is_expected || ct.is_contraindicated || !ct.is_available
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-neutral-400" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Configured Treatments Summary */}
            {configuredList.length > 0 && (
                <div className="bg-neutral-800/50 rounded-lg p-4 border border-neutral-700">
                    <h4 className="text-sm font-bold text-white mb-3">Configured Treatments</h4>
                    <div className="flex flex-wrap gap-2">
                        {configuredList.map(ct => {
                            const color = ct.is_expected ? 'green' : ct.is_contraindicated ? 'red' : 'yellow';
                            return (
                                <div
                                    key={`${ct.treatment_type}:${ct.treatment_name}`}
                                    className={`px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-2 bg-${color}-900/30 border border-${color}-600/50 text-${color}-300`}
                                >
                                    {ct.is_expected && <Check className="w-3 h-3" />}
                                    {ct.is_contraindicated && <AlertTriangle className="w-3 h-3" />}
                                    {!ct.is_available && <X className="w-3 h-3" />}
                                    <span>{ct.treatment_name}</span>
                                    <button
                                        onClick={() => removeTreatmentConfig(ct.treatment_name, ct.treatment_type)}
                                        className="ml-1 hover:text-white"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Category Tabs */}
            <div className="flex gap-1">
                {categories.map(cat => (
                    <button
                        key={cat.id}
                        onClick={() => setActiveCategory(cat.id)}
                        className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${
                            activeCategory === cat.id
                                ? 'bg-purple-600 text-white'
                                : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                        }`}
                    >
                        {cat.label}
                    </button>
                ))}
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search treatments..."
                    className="w-full pl-10 pr-4 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm text-white placeholder-neutral-500 focus:border-purple-500 focus:outline-none"
                />
            </div>

            {/* Treatment List */}
            <div className="space-y-2 max-h-96 overflow-y-auto">
                {filteredTreatments.map(treatment => {
                    const config = getConfig(treatment.treatment_name, treatment.treatment_type);
                    const isExpanded = expandedTreatment === `${treatment.treatment_type}:${treatment.treatment_name}`;
                    const configured = isConfigured(treatment.treatment_name, treatment.treatment_type);

                    return (
                        <div
                            key={treatment.id}
                            className={`border rounded-lg transition-all ${
                                configured
                                    ? config?.is_expected
                                        ? 'bg-green-900/10 border-green-700/50'
                                        : config?.is_contraindicated
                                        ? 'bg-red-900/10 border-red-700/50'
                                        : 'bg-yellow-900/10 border-yellow-700/50'
                                    : 'bg-neutral-800/30 border-neutral-700'
                            }`}
                        >
                            <button
                                onClick={() => setExpandedTreatment(isExpanded ? null : `${treatment.treatment_type}:${treatment.treatment_name}`)}
                                className="w-full p-3 text-left flex items-center justify-between"
                            >
                                <div>
                                    <div className="font-medium text-white flex items-center gap-2">
                                        {treatment.treatment_name}
                                        {config?.is_expected && (
                                            <span className="text-xs px-1.5 py-0.5 bg-green-600/30 text-green-300 rounded">Expected</span>
                                        )}
                                        {config?.is_contraindicated && (
                                            <span className="text-xs px-1.5 py-0.5 bg-red-600/30 text-red-300 rounded">Contraindicated</span>
                                        )}
                                        {config && !config.is_available && (
                                            <span className="text-xs px-1.5 py-0.5 bg-yellow-600/30 text-yellow-300 rounded">Hidden</span>
                                        )}
                                    </div>
                                    <div className="text-xs text-neutral-400 mt-0.5">
                                        {treatment.treatment_type} | {treatment.route || 'N/A'}
                                    </div>
                                </div>
                                {isExpanded ? (
                                    <ChevronUp className="w-4 h-4 text-neutral-400" />
                                ) : (
                                    <ChevronDown className="w-4 h-4 text-neutral-400" />
                                )}
                            </button>

                            {isExpanded && (
                                <div className="px-3 pb-3 space-y-3 border-t border-neutral-700/50 pt-3">
                                    {/* Effect Preview */}
                                    {(treatment.hr_effect || treatment.bp_sys_effect || treatment.spo2_effect) && (
                                        <div className="text-xs text-neutral-400 p-2 bg-neutral-900 rounded">
                                            <span className="font-bold">Effects:</span>
                                            {treatment.hr_effect !== 0 && <span className="ml-2">HR {treatment.hr_effect > 0 ? '+' : ''}{treatment.hr_effect}</span>}
                                            {treatment.bp_sys_effect !== 0 && <span className="ml-2">BP {treatment.bp_sys_effect > 0 ? '+' : ''}{treatment.bp_sys_effect}</span>}
                                            {treatment.spo2_effect !== 0 && <span className="ml-2">SpO2 {treatment.spo2_effect > 0 ? '+' : ''}{treatment.spo2_effect}</span>}
                                            <span className="ml-2 text-neutral-500">| Onset: {treatment.onset_minutes}min</span>
                                        </div>
                                    )}

                                    {/* Configuration Options */}
                                    <div className="grid grid-cols-3 gap-2">
                                        <button
                                            onClick={() => updateTreatmentConfig(treatment, {
                                                is_expected: !(config?.is_expected),
                                                is_contraindicated: false
                                            })}
                                            className={`px-3 py-2 rounded text-xs font-bold transition-colors ${
                                                config?.is_expected
                                                    ? 'bg-green-600 text-white'
                                                    : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                                            }`}
                                        >
                                            <Check className="w-3 h-3 inline mr-1" />
                                            Expected
                                        </button>
                                        <button
                                            onClick={() => updateTreatmentConfig(treatment, {
                                                is_contraindicated: !(config?.is_contraindicated),
                                                is_expected: false
                                            })}
                                            className={`px-3 py-2 rounded text-xs font-bold transition-colors ${
                                                config?.is_contraindicated
                                                    ? 'bg-red-600 text-white'
                                                    : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                                            }`}
                                        >
                                            <AlertTriangle className="w-3 h-3 inline mr-1" />
                                            Contraindicated
                                        </button>
                                        <button
                                            onClick={() => updateTreatmentConfig(treatment, {
                                                is_available: !(config?.is_available ?? true)
                                            })}
                                            className={`px-3 py-2 rounded text-xs font-bold transition-colors ${
                                                config && !config.is_available
                                                    ? 'bg-yellow-600 text-white'
                                                    : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                                            }`}
                                        >
                                            <X className="w-3 h-3 inline mr-1" />
                                            Hide
                                        </button>
                                    </div>

                                    {/* Points and Feedback (shown when expected or contraindicated) */}
                                    {(config?.is_expected || config?.is_contraindicated) && (
                                        <div className="space-y-2">
                                            {config?.is_expected && (
                                                <div>
                                                    <label className="text-xs text-neutral-400">Points if ordered</label>
                                                    <input
                                                        type="number"
                                                        value={config?.points_if_ordered || 0}
                                                        onChange={(e) => updateTreatmentConfig(treatment, {
                                                            points_if_ordered: parseInt(e.target.value) || 0
                                                        })}
                                                        className="w-full px-2 py-1 bg-neutral-700 border border-neutral-600 rounded text-sm text-white"
                                                        min="0"
                                                        max="100"
                                                    />
                                                </div>
                                            )}
                                            <div>
                                                <label className="text-xs text-neutral-400">
                                                    {config?.is_contraindicated ? 'Warning message' : 'Feedback if ordered'}
                                                </label>
                                                <input
                                                    type="text"
                                                    value={config?.feedback_if_ordered || ''}
                                                    onChange={(e) => updateTreatmentConfig(treatment, {
                                                        feedback_if_ordered: e.target.value
                                                    })}
                                                    placeholder={config?.is_contraindicated
                                                        ? 'e.g., "Contraindicated due to patient allergy"'
                                                        : 'e.g., "Correct choice for this presentation"'
                                                    }
                                                    className="w-full px-2 py-1 bg-neutral-700 border border-neutral-600 rounded text-sm text-white"
                                                />
                                            </div>
                                            {config?.is_expected && (
                                                <div>
                                                    <label className="text-xs text-neutral-400">Feedback if missed</label>
                                                    <input
                                                        type="text"
                                                        value={config?.feedback_if_missed || ''}
                                                        onChange={(e) => updateTreatmentConfig(treatment, {
                                                            feedback_if_missed: e.target.value
                                                        })}
                                                        placeholder="e.g., 'Consider ordering this for hypotension'"
                                                        className="w-full px-2 py-1 bg-neutral-700 border border-neutral-600 rounded text-sm text-white"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Save Button */}
            <div className="flex justify-end pt-4 border-t border-neutral-700">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded font-bold flex items-center gap-2 disabled:opacity-50"
                >
                    {saving ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                    ) : (
                        <><Save className="w-4 h-4" /> Save Treatment Config</>
                    )}
                </button>
            </div>
        </div>
    );
}
