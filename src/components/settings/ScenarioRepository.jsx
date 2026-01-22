import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, Trash2, Edit, Download, Upload, Globe, Lock, Play, X, Copy, Clock, ChevronDown, ChevronUp, Save, FileText, Search, Filter, Package, Database, AlertCircle } from 'lucide-react';
import { AuthService } from '../../services/authService';
import { useToast } from '../../contexts/ToastContext';
import { apiUrl } from '../../config/api';
import { SCENARIO_TEMPLATES } from '../../data/scenarioTemplates';

const CATEGORIES = [
    { id: 'all', label: 'All Scenarios' },
    { id: 'Cardiac', label: 'Cardiac' },
    { id: 'Respiratory', label: 'Respiratory' },
    { id: 'Sepsis', label: 'Sepsis' },
    { id: 'Metabolic', label: 'Metabolic' },
    { id: 'Neurological', label: 'Neurological' },
    { id: 'Trauma', label: 'Trauma' },
    { id: 'Toxicology', label: 'Toxicology' },
    { id: 'General', label: 'General' },
    { id: 'Recovery', label: 'Recovery' },
    { id: 'Pediatric', label: 'Pediatric' }
];

const RHYTHMS = ['NSR', 'Sinus Tachycardia', 'Sinus Bradycardia', 'AFib', 'Atrial Flutter', 'SVT', 'VTach', 'VFib', 'Asystole', 'PEA'];

const DEFAULT_STEP = {
    time: 0,
    label: '',
    params: { hr: 80, spo2: 98, rr: 16, bpSys: 120, bpDia: 80, temp: 37.0, etco2: 38 },
    conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 },
    rhythm: 'NSR'
};

// Map built-in template keys to categories
const getTemplateCategory = (key) => {
    const categoryMap = {
        septic_shock: 'Sepsis',
        stemi_progression: 'Cardiac',
        hypertensive_crisis: 'Cardiac',
        respiratory_failure: 'Respiratory',
        post_resuscitation_recovery: 'Recovery',
        anaphylaxis: 'General',
        diabetic_ketoacidosis: 'Metabolic',
        acute_stroke: 'Neurological',
        pulmonary_embolism: 'Respiratory',
        gi_bleed: 'General',
        copd_exacerbation: 'Respiratory',
        severe_hypoglycemia: 'Metabolic',
        complete_heart_block: 'Cardiac',
        afib_rvr: 'Cardiac',
        opioid_overdose: 'Toxicology',
        pulmonary_edema: 'Cardiac'
    };
    return categoryMap[key] || 'General';
};

export default function ScenarioRepository({ onSelectScenario }) {
    const toast = useToast();
    const [dbScenarios, setDbScenarios] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingScenario, setEditingScenario] = useState(null);
    const [expandedStep, setExpandedStep] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [showBuiltIn, setShowBuiltIn] = useState(true);
    const [showCustom, setShowCustom] = useState(true);
    const fileInputRef = useRef(null);

    const isAdmin = useMemo(() => {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        return user.role === 'admin';
    }, []);

    useEffect(() => {
        loadScenarios();
    }, []);

    const loadScenarios = async () => {
        try {
            const token = AuthService.getToken();
            const res = await fetch(apiUrl('/scenarios'), {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            setDbScenarios(data.scenarios || []);
        } catch (error) {
            console.error('Failed to load scenarios:', error);
        } finally {
            setLoading(false);
        }
    };

    // Convert built-in templates to scenario format
    const builtInScenarios = useMemo(() => {
        return Object.entries(SCENARIO_TEMPLATES).map(([key, template]) => ({
            id: `builtin_${key}`,
            templateKey: key,
            name: template.name,
            description: template.description,
            category: getTemplateCategory(key),
            duration_minutes: template.duration,
            timeline: template.timeline,
            is_builtin: true,
            is_public: true
        }));
    }, []);

    // Combined and filtered scenarios
    const allScenarios = useMemo(() => {
        let scenarios = [];

        if (showBuiltIn) {
            scenarios = [...scenarios, ...builtInScenarios];
        }
        if (showCustom) {
            scenarios = [...scenarios, ...dbScenarios.map(s => ({ ...s, is_builtin: false }))];
        }

        // Filter by category
        if (selectedCategory !== 'all') {
            scenarios = scenarios.filter(s => s.category === selectedCategory);
        }

        // Filter by search
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            scenarios = scenarios.filter(s =>
                s.name.toLowerCase().includes(query) ||
                s.description?.toLowerCase().includes(query) ||
                s.category?.toLowerCase().includes(query)
            );
        }

        // Sort: custom first, then built-in, alphabetically within each group
        return scenarios.sort((a, b) => {
            if (a.is_builtin !== b.is_builtin) {
                return a.is_builtin ? 1 : -1; // Custom first
            }
            return a.name.localeCompare(b.name);
        });
    }, [builtInScenarios, dbScenarios, showBuiltIn, showCustom, selectedCategory, searchQuery]);

    // Category counts
    const categoryCounts = useMemo(() => {
        const counts = { all: 0 };
        CATEGORIES.forEach(cat => counts[cat.id] = 0);

        const scenariosToCount = [
            ...(showBuiltIn ? builtInScenarios : []),
            ...(showCustom ? dbScenarios : [])
        ];

        scenariosToCount.forEach(s => {
            counts.all++;
            if (s.category && counts[s.category] !== undefined) {
                counts[s.category]++;
            }
        });

        return counts;
    }, [builtInScenarios, dbScenarios, showBuiltIn, showCustom]);

    const deleteScenario = async (id) => {
        const confirmed = await toast.confirm('Delete this scenario?', { title: 'Delete Scenario', type: 'danger', confirmText: 'Delete' });
        if (!confirmed) return;

        try {
            const token = AuthService.getToken();
            await fetch(apiUrl(`/scenarios/${id}`), {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            loadScenarios();
            toast.success('Scenario deleted');
        } catch (error) {
            console.error('Failed to delete scenario:', error);
            toast.error('Failed to delete scenario');
        }
    };

    const saveScenario = async () => {
        if (!editingScenario.name.trim()) {
            toast.warning('Please enter a scenario name');
            return;
        }
        if (!editingScenario.timeline || editingScenario.timeline.length === 0) {
            toast.warning('Please add at least one timeline step');
            return;
        }

        try {
            const token = AuthService.getToken();
            const isNew = !editingScenario.id || editingScenario.id.startsWith('builtin_');
            const method = isNew ? 'POST' : 'PUT';
            const url = isNew
                ? apiUrl('/scenarios')
                : apiUrl(`/scenarios/${editingScenario.id}`);

            const res = await fetch(url, {
                method,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: editingScenario.name,
                    description: editingScenario.description,
                    category: editingScenario.category,
                    duration_minutes: editingScenario.duration_minutes,
                    timeline: editingScenario.timeline,
                    is_public: editingScenario.is_public
                })
            });

            if (!res.ok) throw new Error('Failed to save');

            setEditingScenario(null);
            loadScenarios();
            toast.success(isNew ? 'Scenario created' : 'Scenario updated');
        } catch (error) {
            console.error('Failed to save scenario:', error);
            toast.error('Failed to save scenario');
        }
    };

    const editScenario = (scenario) => {
        if (scenario.is_builtin) {
            // Create a copy for editing
            setEditingScenario({
                ...scenario,
                id: null, // Will create new
                name: scenario.name, // Remove "(Copy)" suffix so user can decide
                timeline: scenario.timeline.map(step => ({
                    ...step,
                    params: { ...step.params },
                    conditions: { ...step.conditions }
                })),
                is_builtin: false
            });
        } else {
            setEditingScenario({
                ...scenario,
                timeline: scenario.timeline.map(step => ({
                    ...step,
                    params: { ...step.params },
                    conditions: { ...step.conditions }
                }))
            });
        }
    };

    const duplicateScenario = (scenario) => {
        setEditingScenario({
            ...scenario,
            id: null,
            name: `${scenario.name} (Copy)`,
            timeline: scenario.timeline.map(step => ({
                ...step,
                params: { ...step.params },
                conditions: { ...step.conditions }
            })),
            is_builtin: false
        });
    };

    const exportScenario = (scenario) => {
        const exportData = {
            name: scenario.name,
            description: scenario.description,
            category: scenario.category,
            duration_minutes: scenario.duration_minutes,
            timeline: scenario.timeline,
            exported_at: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `scenario_${scenario.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const importScenario = (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const imported = JSON.parse(e.target.result);
                setEditingScenario({
                    name: imported.name || 'Imported Scenario',
                    description: imported.description || '',
                    category: imported.category || 'General',
                    duration_minutes: imported.duration_minutes || 30,
                    timeline: imported.timeline || [],
                    is_public: true,
                    is_builtin: false
                });
                toast.success('Scenario imported - review and save');
            } catch (err) {
                toast.error('Invalid scenario file');
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    };

    const addTimelineStep = () => {
        const lastStep = editingScenario.timeline[editingScenario.timeline.length - 1];
        const newTime = lastStep ? lastStep.time + 5 * 60 : 0;

        setEditingScenario(prev => ({
            ...prev,
            timeline: [...prev.timeline, {
                ...DEFAULT_STEP,
                time: newTime,
                label: `Step ${prev.timeline.length + 1}`,
                params: lastStep ? { ...lastStep.params } : { ...DEFAULT_STEP.params },
                conditions: lastStep ? { ...lastStep.conditions } : { ...DEFAULT_STEP.conditions }
            }]
        }));
        setExpandedStep(editingScenario.timeline.length);
    };

    const updateTimelineStep = (index, field, value) => {
        setEditingScenario(prev => ({
            ...prev,
            timeline: prev.timeline.map((step, i) =>
                i === index ? { ...step, [field]: value } : step
            )
        }));
    };

    const updateStepParams = (index, param, value) => {
        setEditingScenario(prev => ({
            ...prev,
            timeline: prev.timeline.map((step, i) =>
                i === index ? { ...step, params: { ...step.params, [param]: value } } : step
            )
        }));
    };

    const updateStepConditions = (index, condition, value) => {
        setEditingScenario(prev => ({
            ...prev,
            timeline: prev.timeline.map((step, i) =>
                i === index ? { ...step, conditions: { ...step.conditions, [condition]: value } } : step
            )
        }));
    };

    const removeTimelineStep = (index) => {
        if (editingScenario.timeline.length <= 1) {
            toast.warning('Scenario must have at least one step');
            return;
        }
        setEditingScenario(prev => ({
            ...prev,
            timeline: prev.timeline.filter((_, i) => i !== index)
        }));
        if (expandedStep === index) setExpandedStep(null);
    };

    const duplicateStep = (index) => {
        const step = editingScenario.timeline[index];
        const newStep = {
            ...step,
            time: step.time + 5 * 60,
            label: step.label + ' (Copy)',
            params: { ...step.params },
            conditions: { ...step.conditions }
        };
        setEditingScenario(prev => ({
            ...prev,
            timeline: [...prev.timeline.slice(0, index + 1), newStep, ...prev.timeline.slice(index + 1)]
        }));
    };

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${String(secs).padStart(2, '0')}`;
    };

    const formatDuration = (minutes) => {
        if (minutes < 60) return `${minutes} min`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    };

    if (loading) {
        return <div className="text-center py-8 text-neutral-500">Loading scenarios...</div>;
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-bold text-white">Scenario Templates</h3>
                    <p className="text-xs text-neutral-500 mt-1">
                        {allScenarios.length} scenarios ({builtInScenarios.length} built-in, {dbScenarios.length} custom)
                    </p>
                </div>
                <div className="flex gap-2">
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={importScenario}
                        accept=".json"
                        className="hidden"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-2 bg-neutral-700 hover:bg-neutral-600 rounded text-sm font-bold flex items-center gap-1"
                        title="Import from JSON"
                    >
                        <Upload className="w-4 h-4" />
                        Import
                    </button>
                    <button
                        onClick={() => setEditingScenario({
                            name: '',
                            description: '',
                            duration_minutes: 30,
                            category: 'General',
                            timeline: [{ ...DEFAULT_STEP, label: 'Initial State' }],
                            is_public: true,
                            is_builtin: false
                        })}
                        className="px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-bold flex items-center gap-1"
                    >
                        <Plus className="w-4 h-4" />
                        New Scenario
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-center bg-neutral-800/50 p-3 rounded-lg">
                {/* Search */}
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search scenarios..."
                        className="w-full pl-9 pr-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-sm"
                    />
                </div>

                {/* Category Filter */}
                <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-sm"
                >
                    {CATEGORIES.map(cat => (
                        <option key={cat.id} value={cat.id}>
                            {cat.label} ({categoryCounts[cat.id] || 0})
                        </option>
                    ))}
                </select>

                {/* Type Toggles */}
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowBuiltIn(!showBuiltIn)}
                        className={`px-3 py-2 rounded text-sm font-medium flex items-center gap-1 ${
                            showBuiltIn
                                ? 'bg-purple-600 text-white'
                                : 'bg-neutral-700 text-neutral-400'
                        }`}
                    >
                        <Package className="w-4 h-4" />
                        Built-in ({builtInScenarios.length})
                    </button>
                    <button
                        onClick={() => setShowCustom(!showCustom)}
                        className={`px-3 py-2 rounded text-sm font-medium flex items-center gap-1 ${
                            showCustom
                                ? 'bg-green-600 text-white'
                                : 'bg-neutral-700 text-neutral-400'
                        }`}
                    >
                        <Database className="w-4 h-4" />
                        Custom ({dbScenarios.length})
                    </button>
                </div>
            </div>

            {/* Scenario List */}
            {allScenarios.length === 0 ? (
                <div className="text-center py-12 bg-neutral-800/50 rounded-lg border border-dashed border-neutral-700">
                    <p className="text-neutral-500 mb-2">No scenarios match your filters</p>
                    <p className="text-xs text-neutral-600">Try adjusting the category or search query</p>
                </div>
            ) : (
                <div className="grid gap-3">
                    {allScenarios.map(scenario => (
                        <div
                            key={scenario.id}
                            className={`bg-neutral-800 border rounded-lg p-4 hover:border-neutral-500 transition-colors ${
                                scenario.is_builtin
                                    ? 'border-purple-900/50'
                                    : 'border-neutral-700'
                            }`}
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                                        <h4 className="text-white font-bold truncate">{scenario.name}</h4>

                                        {/* Type Badge */}
                                        {scenario.is_builtin ? (
                                            <span className="px-2 py-0.5 bg-purple-900/50 text-purple-300 text-xs rounded flex items-center gap-1">
                                                <Package className="w-3 h-3" />
                                                Built-in
                                            </span>
                                        ) : (
                                            <span className="px-2 py-0.5 bg-green-900/50 text-green-300 text-xs rounded flex items-center gap-1">
                                                <Database className="w-3 h-3" />
                                                Custom
                                            </span>
                                        )}

                                        {/* Category Badge */}
                                        {scenario.category && (
                                            <span className="px-2 py-0.5 bg-blue-900/50 text-blue-200 text-xs rounded">
                                                {scenario.category}
                                            </span>
                                        )}

                                        {/* Visibility */}
                                        {!scenario.is_builtin && (
                                            scenario.is_public ? (
                                                <Globe className="w-3.5 h-3.5 text-green-400" title="Public" />
                                            ) : (
                                                <Lock className="w-3.5 h-3.5 text-yellow-400" title="Private" />
                                            )
                                        )}
                                    </div>

                                    <p className="text-sm text-neutral-400 mb-2 line-clamp-2">{scenario.description}</p>

                                    <div className="flex items-center gap-4 text-xs text-neutral-500">
                                        <span className="flex items-center gap-1">
                                            <Clock className="w-3 h-3" />
                                            {formatDuration(scenario.duration_minutes)}
                                        </span>
                                        <span>{scenario.timeline?.length || 0} steps</span>
                                        {scenario.created_by_username && (
                                            <span>By: {scenario.created_by_username}</span>
                                        )}
                                    </div>
                                </div>

                                <div className="flex gap-1.5 ml-4">
                                    {onSelectScenario && (
                                        <button
                                            onClick={() => onSelectScenario(scenario)}
                                            className="p-2 bg-green-700 hover:bg-green-600 rounded text-xs"
                                            title="Use in case"
                                        >
                                            <Play className="w-4 h-4" />
                                        </button>
                                    )}
                                    <button
                                        onClick={() => duplicateScenario(scenario)}
                                        className="p-2 bg-neutral-700 hover:bg-neutral-600 rounded text-xs"
                                        title="Duplicate"
                                    >
                                        <Copy className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => exportScenario(scenario)}
                                        className="p-2 bg-neutral-700 hover:bg-neutral-600 rounded text-xs"
                                        title="Export"
                                    >
                                        <Download className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => editScenario(scenario)}
                                        className="p-2 bg-blue-700 hover:bg-blue-600 rounded text-xs"
                                        title={scenario.is_builtin ? "Edit (creates copy)" : "Edit"}
                                    >
                                        <Edit className="w-4 h-4" />
                                    </button>
                                    {!scenario.is_builtin && (
                                        <button
                                            onClick={() => deleteScenario(scenario.id)}
                                            className="p-2 bg-red-900/30 text-red-400 hover:bg-red-900/50 rounded text-xs"
                                            title="Delete"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Scenario Editor Modal */}
            {editingScenario && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
                    <div className="bg-neutral-900 border border-neutral-700 rounded-lg max-w-4xl w-full max-h-[90vh] flex flex-col">
                        {/* Header */}
                        <div className="p-4 border-b border-neutral-700 flex items-center justify-between">
                            <div>
                                <h3 className="text-xl font-bold">
                                    {editingScenario.id && !editingScenario.id.startsWith('builtin_')
                                        ? 'Edit Scenario'
                                        : 'New Scenario'}
                                </h3>
                                {editingScenario.is_builtin === false && editingScenario.templateKey && (
                                    <p className="text-xs text-purple-400 mt-1">
                                        Based on built-in template - will be saved as custom scenario
                                    </p>
                                )}
                            </div>
                            <button onClick={() => setEditingScenario(null)} className="p-2 hover:bg-neutral-700 rounded">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-6">
                            {/* Basic Info */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-neutral-400 mb-1">Name *</label>
                                    <input
                                        type="text"
                                        value={editingScenario.name}
                                        onChange={(e) => setEditingScenario(prev => ({ ...prev, name: e.target.value }))}
                                        className="w-full px-3 py-2 bg-neutral-800 border border-neutral-600 rounded text-white"
                                        placeholder="Scenario name"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-neutral-400 mb-1">Category</label>
                                    <select
                                        value={editingScenario.category}
                                        onChange={(e) => setEditingScenario(prev => ({ ...prev, category: e.target.value }))}
                                        className="w-full px-3 py-2 bg-neutral-800 border border-neutral-600 rounded text-white"
                                    >
                                        {CATEGORIES.filter(c => c.id !== 'all').map(cat => (
                                            <option key={cat.id} value={cat.id}>{cat.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-neutral-400 mb-1">Description</label>
                                <textarea
                                    value={editingScenario.description}
                                    onChange={(e) => setEditingScenario(prev => ({ ...prev, description: e.target.value }))}
                                    className="w-full px-3 py-2 bg-neutral-800 border border-neutral-600 rounded text-white h-20"
                                    placeholder="Describe this scenario..."
                                />
                            </div>

                            <div className="flex gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-neutral-400 mb-1">Duration (minutes)</label>
                                    <input
                                        type="number"
                                        value={editingScenario.duration_minutes}
                                        onChange={(e) => setEditingScenario(prev => ({ ...prev, duration_minutes: parseInt(e.target.value) || 30 }))}
                                        className="w-32 px-3 py-2 bg-neutral-800 border border-neutral-600 rounded text-white"
                                        min="1"
                                        max="240"
                                    />
                                </div>
                                <div className="flex items-end">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={editingScenario.is_public}
                                            onChange={(e) => setEditingScenario(prev => ({ ...prev, is_public: e.target.checked }))}
                                            className="w-4 h-4"
                                        />
                                        <span className="text-sm text-neutral-300">Public (visible to all users)</span>
                                    </label>
                                </div>
                            </div>

                            {/* Timeline Steps */}
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="font-bold text-purple-400">Timeline Steps</h4>
                                    <button
                                        onClick={addTimelineStep}
                                        className="px-3 py-1 bg-purple-600 hover:bg-purple-500 rounded text-sm font-bold flex items-center gap-1"
                                    >
                                        <Plus className="w-4 h-4" />
                                        Add Step
                                    </button>
                                </div>

                                <div className="space-y-2">
                                    {editingScenario.timeline.map((step, index) => (
                                        <div key={index} className="bg-neutral-800 border border-neutral-700 rounded-lg overflow-hidden">
                                            {/* Step Header */}
                                            <div
                                                className="p-3 flex items-center gap-3 cursor-pointer hover:bg-neutral-700/50"
                                                onClick={() => setExpandedStep(expandedStep === index ? null : index)}
                                            >
                                                <div className="w-8 h-8 rounded-full bg-purple-900/50 flex items-center justify-center text-purple-300 text-sm font-bold">
                                                    {index + 1}
                                                </div>
                                                <div className="w-16 text-center">
                                                    <span className="text-purple-400 font-mono text-sm">{formatTime(step.time)}</span>
                                                </div>
                                                <div className="flex-1">
                                                    <span className="text-white text-sm">{step.label || `Step ${index + 1}`}</span>
                                                </div>
                                                <div className="text-xs text-neutral-500 flex gap-3">
                                                    <span>HR: {step.params.hr}</span>
                                                    <span>SpO2: {step.params.spo2}%</span>
                                                    <span>BP: {step.params.bpSys}/{step.params.bpDia}</span>
                                                </div>
                                                {expandedStep === index ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                            </div>

                                            {/* Step Details (Expanded) */}
                                            {expandedStep === index && (
                                                <div className="p-4 border-t border-neutral-700 space-y-4">
                                                    {/* Time and Label */}
                                                    <div className="grid grid-cols-3 gap-3">
                                                        <div>
                                                            <label className="block text-xs text-neutral-500 mb-1">Time (seconds)</label>
                                                            <input
                                                                type="number"
                                                                value={step.time}
                                                                onChange={(e) => updateTimelineStep(index, 'time', parseInt(e.target.value) || 0)}
                                                                className="w-full px-2 py-1 bg-neutral-900 border border-neutral-600 rounded text-sm"
                                                                min="0"
                                                            />
                                                        </div>
                                                        <div className="col-span-2">
                                                            <label className="block text-xs text-neutral-500 mb-1">Label</label>
                                                            <input
                                                                type="text"
                                                                value={step.label}
                                                                onChange={(e) => updateTimelineStep(index, 'label', e.target.value)}
                                                                className="w-full px-2 py-1 bg-neutral-900 border border-neutral-600 rounded text-sm"
                                                                placeholder="Describe this stage..."
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* Vital Signs */}
                                                    <div>
                                                        <label className="block text-xs font-bold text-neutral-400 mb-2">Vital Signs</label>
                                                        <div className="grid grid-cols-4 gap-2">
                                                            <div>
                                                                <label className="block text-xs text-neutral-500">HR (bpm)</label>
                                                                <input type="number" value={step.params.hr} onChange={(e) => updateStepParams(index, 'hr', parseInt(e.target.value) || 0)} className="w-full px-2 py-1 bg-neutral-900 border border-neutral-600 rounded text-sm" min="0" max="300" />
                                                            </div>
                                                            <div>
                                                                <label className="block text-xs text-neutral-500">SpO2 (%)</label>
                                                                <input type="number" value={step.params.spo2} onChange={(e) => updateStepParams(index, 'spo2', parseInt(e.target.value) || 0)} className="w-full px-2 py-1 bg-neutral-900 border border-neutral-600 rounded text-sm" min="0" max="100" />
                                                            </div>
                                                            <div>
                                                                <label className="block text-xs text-neutral-500">RR (/min)</label>
                                                                <input type="number" value={step.params.rr} onChange={(e) => updateStepParams(index, 'rr', parseInt(e.target.value) || 0)} className="w-full px-2 py-1 bg-neutral-900 border border-neutral-600 rounded text-sm" min="0" max="60" />
                                                            </div>
                                                            <div>
                                                                <label className="block text-xs text-neutral-500">Temp (°C)</label>
                                                                <input type="number" step="0.1" value={step.params.temp} onChange={(e) => updateStepParams(index, 'temp', parseFloat(e.target.value) || 37)} className="w-full px-2 py-1 bg-neutral-900 border border-neutral-600 rounded text-sm" min="30" max="45" />
                                                            </div>
                                                            <div>
                                                                <label className="block text-xs text-neutral-500">BP Sys</label>
                                                                <input type="number" value={step.params.bpSys} onChange={(e) => updateStepParams(index, 'bpSys', parseInt(e.target.value) || 0)} className="w-full px-2 py-1 bg-neutral-900 border border-neutral-600 rounded text-sm" min="0" max="300" />
                                                            </div>
                                                            <div>
                                                                <label className="block text-xs text-neutral-500">BP Dia</label>
                                                                <input type="number" value={step.params.bpDia} onChange={(e) => updateStepParams(index, 'bpDia', parseInt(e.target.value) || 0)} className="w-full px-2 py-1 bg-neutral-900 border border-neutral-600 rounded text-sm" min="0" max="200" />
                                                            </div>
                                                            <div>
                                                                <label className="block text-xs text-neutral-500">EtCO2</label>
                                                                <input type="number" value={step.params.etco2} onChange={(e) => updateStepParams(index, 'etco2', parseInt(e.target.value) || 0)} className="w-full px-2 py-1 bg-neutral-900 border border-neutral-600 rounded text-sm" min="0" max="100" />
                                                            </div>
                                                            <div>
                                                                <label className="block text-xs text-neutral-500">Rhythm</label>
                                                                <select value={step.rhythm || 'NSR'} onChange={(e) => updateTimelineStep(index, 'rhythm', e.target.value)} className="w-full px-2 py-1 bg-neutral-900 border border-neutral-600 rounded text-sm">
                                                                    {RHYTHMS.map(r => <option key={r} value={r}>{r}</option>)}
                                                                </select>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* ECG Conditions */}
                                                    <div>
                                                        <label className="block text-xs font-bold text-neutral-400 mb-2">ECG Conditions</label>
                                                        <div className="grid grid-cols-5 gap-2">
                                                            <div>
                                                                <label className="block text-xs text-neutral-500">ST Elev</label>
                                                                <input type="number" step="0.1" value={step.conditions.stElev} onChange={(e) => updateStepConditions(index, 'stElev', parseFloat(e.target.value) || 0)} className="w-full px-2 py-1 bg-neutral-900 border border-neutral-600 rounded text-sm" min="-5" max="5" />
                                                            </div>
                                                            <div>
                                                                <label className="block text-xs text-neutral-500">Noise</label>
                                                                <input type="number" value={step.conditions.noise} onChange={(e) => updateStepConditions(index, 'noise', parseInt(e.target.value) || 0)} className="w-full px-2 py-1 bg-neutral-900 border border-neutral-600 rounded text-sm" min="0" max="5" />
                                                            </div>
                                                            <label className="flex items-center gap-1 text-xs text-neutral-300">
                                                                <input type="checkbox" checked={step.conditions.pvc} onChange={(e) => updateStepConditions(index, 'pvc', e.target.checked)} className="w-3 h-3" />
                                                                PVCs
                                                            </label>
                                                            <label className="flex items-center gap-1 text-xs text-neutral-300">
                                                                <input type="checkbox" checked={step.conditions.wideQRS} onChange={(e) => updateStepConditions(index, 'wideQRS', e.target.checked)} className="w-3 h-3" />
                                                                Wide QRS
                                                            </label>
                                                            <label className="flex items-center gap-1 text-xs text-neutral-300">
                                                                <input type="checkbox" checked={step.conditions.tInv} onChange={(e) => updateStepConditions(index, 'tInv', e.target.checked)} className="w-3 h-3" />
                                                                T Inversion
                                                            </label>
                                                        </div>
                                                    </div>

                                                    {/* Actions */}
                                                    <div className="flex gap-2 pt-2 border-t border-neutral-700">
                                                        <button
                                                            onClick={() => duplicateStep(index)}
                                                            className="px-3 py-1 bg-neutral-700 hover:bg-neutral-600 rounded text-xs flex items-center gap-1"
                                                        >
                                                            <Copy className="w-3 h-3" /> Duplicate
                                                        </button>
                                                        <button
                                                            onClick={() => removeTimelineStep(index)}
                                                            className="px-3 py-1 bg-red-900/30 text-red-400 hover:bg-red-900/50 rounded text-xs flex items-center gap-1"
                                                        >
                                                            <Trash2 className="w-3 h-3" /> Remove
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-neutral-700 flex justify-end gap-2">
                            <button
                                onClick={() => setEditingScenario(null)}
                                className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 rounded font-bold"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={saveScenario}
                                className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded font-bold flex items-center gap-2"
                            >
                                <Save className="w-4 h-4" />
                                Save Scenario
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
