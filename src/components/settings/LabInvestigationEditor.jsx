import React, { useState, useEffect, useMemo } from 'react';
import {
    Search, Plus, Trash2, Loader2, ChevronDown, ChevronUp,
    AlertTriangle, CheckCircle, ArrowUp, ArrowDown,
    Layers, FlaskConical, Download, Upload, Eye,
    Zap, Package, Filter, X, Check, Copy, RotateCcw, Timer
} from 'lucide-react';
import { AuthService } from '../../services/authService';
import { useToast } from '../../contexts/ToastContext';
import { apiUrl } from '../../config/api';
import { LAB_PANEL_TEMPLATES, getTemplateCategories, getTemplatesByCategory, SEARCH_ALIASES } from '../../data/labPanelTemplates';

/**
 * Enhanced Lab Investigation Editor
 * Features:
 * - Smart search with aliases
 * - Group vs individual selection
 * - Visual range indicators
 * - Abnormal value presets (High/Low/Critical)
 * - Common panel templates
 * - Bulk operations
 * - Validation warnings
 * - Preview mode
 * - Import/Export
 */
export default function LabInvestigationEditor({ caseData, setCaseData, patientGender }) {
    const toast = useToast();

    // State
    const [activeTab, setActiveTab] = useState('search'); // search, templates, configured
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [groups, setGroups] = useState([]);
    const [selectedGroup, setSelectedGroup] = useState('all');
    const [isSearching, setIsSearching] = useState(false);
    const [expandedGroups, setExpandedGroups] = useState(new Set());
    const [selectedLabs, setSelectedLabs] = useState(new Set());
    const [showPreview, setShowPreview] = useState(false);
    const [templateCategory, setTemplateCategory] = useState('all');

    // Get configured labs
    const configuredLabs = caseData.config?.investigations?.labs || [];
    const defaultLabsEnabled = caseData.config?.investigations?.defaultLabsEnabled !== false;

    // Load groups on mount
    useEffect(() => {
        const token = AuthService.getToken();
        fetch(apiUrl('/labs/groups'), {
            headers: { 'Authorization': `Bearer ${token}` }
        })
            .then(res => res.json())
            .then(data => setGroups(data.groups || []))
            .catch(err => console.error('Failed to load groups:', err));
    }, []);

    // Smart search with aliases
    useEffect(() => {
        if (!searchQuery || searchQuery.trim().length < 2) {
            setSearchResults([]);
            return;
        }

        const query = searchQuery.toLowerCase().trim();

        // Check if query matches an alias
        let expandedTerms = [query];
        Object.entries(SEARCH_ALIASES).forEach(([alias, terms]) => {
            if (alias.includes(query) || query.includes(alias)) {
                expandedTerms = [...expandedTerms, ...terms.map(t => t.toLowerCase())];
            }
        });

        setIsSearching(true);
        const token = AuthService.getToken();

        // Search with multiple terms
        const searchPromises = expandedTerms.slice(0, 5).map(term =>
            fetch(apiUrl(`/labs/search?q=${encodeURIComponent(term)}&limit=30`), {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(res => res.json())
        );

        Promise.all(searchPromises)
            .then(results => {
                // Merge and dedupe results
                const allResults = [];
                const seenNames = new Set();

                results.forEach(data => {
                    (data.results || []).forEach(testGroup => {
                        const name = testGroup[0]?.test_name;
                        if (name && !seenNames.has(name)) {
                            seenNames.add(name);
                            allResults.push(testGroup);
                        }
                    });
                });

                setSearchResults(allResults);
                setIsSearching(false);
            })
            .catch(err => {
                console.error('Search failed:', err);
                setIsSearching(false);
            });
    }, [searchQuery]);

    // Helper to update config
    const updateInvestigations = (updates) => {
        setCaseData(prev => ({
            ...prev,
            config: {
                ...prev.config,
                investigations: {
                    ...(prev.config?.investigations || {}),
                    ...updates
                }
            }
        }));
    };

    // Add single lab
    const addLab = (testGroup, presetType = 'normal') => {
        // Find gender-specific test
        let selectedTest = testGroup.find(t => t.category === patientGender);
        if (!selectedTest) selectedTest = testGroup.find(t => t.category === 'Both' || t.category === 'General');
        if (!selectedTest) selectedTest = testGroup[0];

        // Calculate value based on preset
        const value = calculatePresetValue(selectedTest, presetType);

        const labData = {
            id: `lab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            test_name: selectedTest.test_name,
            test_group: selectedTest.group,
            gender_category: selectedTest.category,
            min_value: selectedTest.min_value,
            max_value: selectedTest.max_value,
            current_value: value,
            unit: selectedTest.unit,
            normal_samples: selectedTest.normal_samples,
            is_abnormal: presetType !== 'normal',
            turnaround_minutes: 30,
            preset: presetType
        };

        // Check if already exists
        const exists = configuredLabs.some(l => l.test_name === labData.test_name);
        if (exists) {
            toast.warning(`${labData.test_name} is already configured`);
            return;
        }

        updateInvestigations({
            defaultLabsEnabled,
            labs: [...configuredLabs, labData]
        });
    };

    // Add entire group as a panel
    const addGroupAsPanel = async (groupName) => {
        try {
            const token = AuthService.getToken();
            const response = await fetch(apiUrl(`/labs/group/${encodeURIComponent(groupName)}`), {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                const tests = data.tests || [];

                // Group by test name
                const grouped = {};
                tests.forEach(test => {
                    if (!grouped[test.test_name]) {
                        grouped[test.test_name] = [];
                    }
                    grouped[test.test_name].push(test);
                });

                // Add all tests from group
                const newLabs = [];
                Object.values(grouped).forEach(testGroup => {
                    let selectedTest = testGroup.find(t => t.category === patientGender);
                    if (!selectedTest) selectedTest = testGroup.find(t => t.category === 'Both' || t.category === 'General');
                    if (!selectedTest) selectedTest = testGroup[0];

                    // Skip if already exists
                    if (configuredLabs.some(l => l.test_name === selectedTest.test_name)) return;

                    const normalValue = selectedTest.normal_samples?.length > 0
                        ? selectedTest.normal_samples[Math.floor(Math.random() * selectedTest.normal_samples.length)]
                        : (selectedTest.min_value + selectedTest.max_value) / 2;

                    newLabs.push({
                        id: `lab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        test_name: selectedTest.test_name,
                        test_group: selectedTest.group,
                        gender_category: selectedTest.category,
                        min_value: selectedTest.min_value,
                        max_value: selectedTest.max_value,
                        current_value: normalValue,
                        unit: selectedTest.unit,
                        normal_samples: selectedTest.normal_samples,
                        is_abnormal: false,
                        turnaround_minutes: 30,
                        preset: 'normal',
                        panel_group: groupName // Mark as part of panel
                    });
                });

                if (newLabs.length > 0) {
                    updateInvestigations({
                        defaultLabsEnabled,
                        labs: [...configuredLabs, ...newLabs]
                    });
                    return newLabs.length;
                }
            }
        } catch (error) {
            console.error('Failed to add group:', error);
        }
        return 0;
    };

    // Apply template panel
    const applyTemplate = async (templateKey) => {
        const template = LAB_PANEL_TEMPLATES[templateKey];
        if (!template) return;

        const token = AuthService.getToken();
        const newLabs = [];
        const failedTests = [];

        for (const testConfig of template.tests) {
            try {
                // Search for the test - extract key words for better matching
                const searchTerms = testConfig.test_name.split(',')[0].trim(); // Use first part before comma
                const response = await fetch(
                    apiUrl(`/labs/search?q=${encodeURIComponent(searchTerms)}&limit=20`),
                    { headers: { 'Authorization': `Bearer ${token}` } }
                );

                if (response.ok) {
                    const data = await response.json();

                    // Try multiple matching strategies
                    let testGroup = null;

                    // 1. Exact match first
                    testGroup = data.results?.find(group =>
                        group[0]?.test_name.toLowerCase() === testConfig.test_name.toLowerCase()
                    );

                    // 2. Template name contained in result
                    if (!testGroup) {
                        testGroup = data.results?.find(group =>
                            group[0]?.test_name.toLowerCase().includes(testConfig.test_name.toLowerCase())
                        );
                    }

                    // 3. Result contained in template name (for longer template names)
                    if (!testGroup) {
                        testGroup = data.results?.find(group =>
                            testConfig.test_name.toLowerCase().includes(group[0]?.test_name.toLowerCase())
                        );
                    }

                    // 4. First word match (for abbreviations)
                    if (!testGroup) {
                        const firstWord = searchTerms.split(' ')[0].toLowerCase();
                        testGroup = data.results?.find(group =>
                            group[0]?.test_name.toLowerCase().startsWith(firstWord)
                        );
                    }

                    if (testGroup) {
                        let selectedTest = testGroup.find(t => t.category === patientGender);
                        if (!selectedTest) selectedTest = testGroup.find(t => t.category === 'Both' || t.category === 'General');
                        if (!selectedTest) selectedTest = testGroup[0];

                        // Skip if already exists
                        if (configuredLabs.some(l => l.test_name === selectedTest.test_name)) continue;
                        if (newLabs.some(l => l.test_name === selectedTest.test_name)) continue;

                        // Calculate value based on template config
                        let value;
                        if (testConfig.custom_value !== undefined) {
                            value = testConfig.custom_value;
                        } else if (testConfig.value_multiplier) {
                            const midpoint = (selectedTest.min_value + selectedTest.max_value) / 2;
                            value = midpoint * testConfig.value_multiplier;
                        } else {
                            value = calculatePresetValue(selectedTest, testConfig.preset || 'normal');
                        }

                        newLabs.push({
                            id: `lab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                            test_name: selectedTest.test_name,
                            test_group: selectedTest.group,
                            gender_category: selectedTest.category,
                            min_value: selectedTest.min_value,
                            max_value: selectedTest.max_value,
                            current_value: Math.round(value * 100) / 100,
                            unit: selectedTest.unit,
                            normal_samples: selectedTest.normal_samples,
                            is_abnormal: testConfig.preset !== 'normal',
                            turnaround_minutes: 30,
                            preset: testConfig.preset || 'abnormal',
                            template_source: templateKey
                        });
                    } else {
                        failedTests.push(testConfig.test_name);
                        console.warn(`Template test not found in database: ${testConfig.test_name}`);
                    }
                }
            } catch (error) {
                console.error(`Failed to add test ${testConfig.test_name}:`, error);
                failedTests.push(testConfig.test_name);
            }
        }

        if (newLabs.length > 0) {
            updateInvestigations({
                defaultLabsEnabled,
                labs: [...configuredLabs, ...newLabs]
            });
            if (failedTests.length > 0) {
                toast.warning(`Applied "${template.name}" - Added ${newLabs.length} tests. ${failedTests.length} tests not found.`);
            } else {
                toast.success(`Applied "${template.name}" - Added ${newLabs.length} tests`);
            }
        } else {
            if (failedTests.length > 0) {
                toast.error(`Could not find tests: ${failedTests.slice(0, 3).join(', ')}${failedTests.length > 3 ? '...' : ''}`);
            } else {
                toast.info('No new tests added (may already be configured)');
            }
        }
    };

    // Calculate preset value
    const calculatePresetValue = (test, preset) => {
        const { min_value, max_value, normal_samples } = test;
        const range = max_value - min_value;

        switch (preset) {
            case 'low':
                return Math.round((min_value - range * 0.15) * 100) / 100;
            case 'critical_low':
                return Math.round((min_value - range * 0.4) * 100) / 100;
            case 'high':
                return Math.round((max_value + range * 0.3) * 100) / 100;
            case 'critical_high':
                return Math.round((max_value + range * 0.8) * 100) / 100;
            case 'normal':
            default:
                if (normal_samples?.length > 0) {
                    return normal_samples[Math.floor(Math.random() * normal_samples.length)];
                }
                return Math.round(((min_value + max_value) / 2) * 100) / 100;
        }
    };

    // Update lab value
    const updateLabValue = (labId, field, value) => {
        const updatedLabs = configuredLabs.map(lab => {
            if (lab.id === labId || lab.test_name === labId) {
                const updated = { ...lab, [field]: value };
                // Auto-mark as abnormal if value is outside range
                if (field === 'current_value') {
                    updated.is_abnormal = value < lab.min_value || value > lab.max_value;
                }
                return updated;
            }
            return lab;
        });
        updateInvestigations({ defaultLabsEnabled, labs: updatedLabs });
    };

    // Apply preset to existing lab
    const applyPresetToLab = (labId, preset) => {
        const lab = configuredLabs.find(l => l.id === labId || l.test_name === labId);
        if (!lab) return;

        const newValue = calculatePresetValue(lab, preset);
        updateLabValue(labId, 'current_value', newValue);
    };

    // Remove lab
    const removeLab = (labId) => {
        const updatedLabs = configuredLabs.filter(lab => lab.id !== labId && lab.test_name !== labId);
        updateInvestigations({ defaultLabsEnabled, labs: updatedLabs });
        setSelectedLabs(prev => {
            const next = new Set(prev);
            next.delete(labId);
            return next;
        });
    };

    // Bulk remove selected
    const removeSelected = () => {
        if (selectedLabs.size === 0) return;
        const updatedLabs = configuredLabs.filter(lab => !selectedLabs.has(lab.id) && !selectedLabs.has(lab.test_name));
        updateInvestigations({ defaultLabsEnabled, labs: updatedLabs });
        setSelectedLabs(new Set());
    };

    // Toggle selection
    const toggleLabSelection = (labId) => {
        setSelectedLabs(prev => {
            const next = new Set(prev);
            if (next.has(labId)) {
                next.delete(labId);
            } else {
                next.add(labId);
            }
            return next;
        });
    };

    // Select all
    const selectAll = () => {
        setSelectedLabs(new Set(configuredLabs.map(l => l.id || l.test_name)));
    };

    // Export labs config
    const exportLabs = () => {
        const exportData = {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            defaultLabsEnabled,
            labs: configuredLabs
        };
        const json = JSON.stringify(exportData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lab-config-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    };

    // Import labs config
    const importLabs = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if (data.labs && Array.isArray(data.labs)) {
                    updateInvestigations({
                        defaultLabsEnabled: data.defaultLabsEnabled ?? defaultLabsEnabled,
                        labs: [...configuredLabs, ...data.labs.filter(
                            imported => !configuredLabs.some(existing => existing.test_name === imported.test_name)
                        )]
                    });
                    toast.success(`Imported ${data.labs.length} lab configurations`);
                }
            } catch (err) {
                toast.error('Failed to import: Invalid file format');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    // Evaluate value status
    const getValueStatus = (value, min, max) => {
        if (value === null || value === undefined) return 'unknown';
        const range = max - min;
        if (value < min - range * 0.3) return 'critical_low';
        if (value < min) return 'low';
        if (value > max + range * 0.3) return 'critical_high';
        if (value > max) return 'high';
        return 'normal';
    };

    // Get status color
    const getStatusColor = (status) => {
        const colors = {
            'critical_low': 'text-red-400',
            'low': 'text-blue-400',
            'normal': 'text-green-400',
            'high': 'text-yellow-400',
            'critical_high': 'text-red-400',
            'unknown': 'text-neutral-400'
        };
        return colors[status] || colors.unknown;
    };

    // Get status badge
    const getStatusBadge = (status) => {
        const badges = {
            'critical_low': { text: 'CRITICAL LOW', bg: 'bg-red-900/50 text-red-300 border-red-700' },
            'low': { text: 'LOW', bg: 'bg-blue-900/50 text-blue-300 border-blue-700' },
            'normal': { text: 'NORMAL', bg: 'bg-green-900/50 text-green-300 border-green-700' },
            'high': { text: 'HIGH', bg: 'bg-yellow-900/50 text-yellow-300 border-yellow-700' },
            'critical_high': { text: 'CRITICAL HIGH', bg: 'bg-red-900/50 text-red-300 border-red-700' }
        };
        return badges[status] || { text: 'UNKNOWN', bg: 'bg-neutral-800 text-neutral-400 border-neutral-600' };
    };

    // Group configured labs by test_group
    const groupedConfiguredLabs = useMemo(() => {
        const grouped = {};
        configuredLabs.forEach(lab => {
            const group = lab.test_group || 'Uncategorized';
            if (!grouped[group]) {
                grouped[group] = [];
            }
            grouped[group].push(lab);
        });
        return grouped;
    }, [configuredLabs]);

    // Filter search results by group
    const filteredResults = useMemo(() => {
        if (selectedGroup === 'all') return searchResults;
        return searchResults.filter(testGroup => testGroup[0]?.group === selectedGroup);
    }, [searchResults, selectedGroup]);

    return (
        <div className="space-y-6">
            {/* Header with Toggle */}
            <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4">
                <label className="flex items-start gap-3 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={defaultLabsEnabled}
                        onChange={(e) => updateInvestigations({ defaultLabsEnabled: e.target.checked, labs: configuredLabs })}
                        className="w-5 h-5 mt-0.5"
                    />
                    <div>
                        <div className="font-bold text-white">All Lab Tests Available by Default</div>
                        <div className="text-xs text-neutral-400 mt-1">
                            When enabled: All 77+ lab tests available with <strong>normal values</strong>.
                            <br />When disabled: Only tests you configure below will be available.
                        </div>
                    </div>
                </label>
            </div>

            {/* Lab Timing Settings */}
            <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-4">
                <h4 className="font-bold text-white mb-3 flex items-center gap-2">
                    <Timer className="w-4 h-4 text-yellow-400" />
                    Result Timing Settings
                </h4>
                <div className="grid grid-cols-2 gap-4">
                    {/* Instant Results */}
                    <label className="flex items-center gap-3 cursor-pointer bg-neutral-800/50 p-3 rounded border border-neutral-700">
                        <input
                            type="checkbox"
                            checked={caseData.config?.investigations?.instantResults || false}
                            onChange={(e) => updateInvestigations({
                                instantResults: e.target.checked,
                                defaultLabsEnabled,
                                labs: configuredLabs
                            })}
                            className="w-5 h-5"
                        />
                        <div>
                            <div className="text-sm font-bold text-white">Instant Results</div>
                            <div className="text-xs text-neutral-400">Results available immediately</div>
                        </div>
                    </label>

                    {/* Global Turnaround Time */}
                    <div className="bg-neutral-800/50 p-3 rounded border border-neutral-700">
                        <div className="text-sm font-bold text-white mb-2">Default Wait Time</div>
                        <select
                            value={caseData.config?.investigations?.defaultTurnaround || 0}
                            onChange={(e) => updateInvestigations({
                                defaultTurnaround: parseInt(e.target.value),
                                defaultLabsEnabled,
                                labs: configuredLabs
                            })}
                            disabled={caseData.config?.investigations?.instantResults}
                            className="w-full px-3 py-2 bg-neutral-900 border border-neutral-600 rounded text-white text-sm disabled:opacity-50"
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
                </div>
                <p className="text-xs text-neutral-500 mt-3">
                    These settings apply to all lab tests in this case. Individual test timing can be set per-test below.
                </p>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-neutral-800 p-1 rounded-lg">
                <button
                    onClick={() => setActiveTab('search')}
                    className={`flex-1 px-4 py-2 rounded text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
                        activeTab === 'search' ? 'bg-purple-600 text-white' : 'text-neutral-400 hover:text-white hover:bg-neutral-700'
                    }`}
                >
                    <Search className="w-4 h-4" />
                    Search & Add
                </button>
                <button
                    onClick={() => setActiveTab('templates')}
                    className={`flex-1 px-4 py-2 rounded text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
                        activeTab === 'templates' ? 'bg-purple-600 text-white' : 'text-neutral-400 hover:text-white hover:bg-neutral-700'
                    }`}
                >
                    <Package className="w-4 h-4" />
                    Panel Templates
                </button>
                <button
                    onClick={() => setActiveTab('configured')}
                    className={`flex-1 px-4 py-2 rounded text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
                        activeTab === 'configured' ? 'bg-purple-600 text-white' : 'text-neutral-400 hover:text-white hover:bg-neutral-700'
                    }`}
                >
                    <FlaskConical className="w-4 h-4" />
                    Configured ({configuredLabs.length})
                </button>
            </div>

            {/* Search & Add Tab */}
            {activeTab === 'search' && (
                <div className="space-y-4">
                    {/* Smart Search */}
                    <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-4">
                        <h5 className="text-sm font-bold text-purple-300 mb-3 flex items-center gap-2">
                            <Zap className="w-4 h-4" />
                            Smart Search
                        </h5>
                        <p className="text-xs text-neutral-500 mb-3">
                            Try shortcuts: CBC, BMP, CMP, LFT, ABG, cardiac, thyroid, coags, electrolytes...
                        </p>
                        <div className="flex gap-2">
                            <div className="flex-1 relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search tests (e.g., glucose, CBC, troponin, Na, K)..."
                                    className="w-full pl-10 pr-4 py-2 bg-neutral-900 border border-neutral-600 rounded text-sm text-white placeholder-neutral-500 focus:border-purple-500 focus:outline-none"
                                />
                                {searchQuery && (
                                    <button
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                            <select
                                value={selectedGroup}
                                onChange={(e) => setSelectedGroup(e.target.value)}
                                className="px-3 py-2 bg-neutral-900 border border-neutral-600 rounded text-sm text-white focus:border-purple-500 focus:outline-none"
                            >
                                <option value="all">All Groups</option>
                                {groups.map(group => (
                                    <option key={group} value={group}>{group}</option>
                                ))}
                            </select>
                        </div>

                        {/* Search Results */}
                        {isSearching && (
                            <div className="text-center py-6 text-neutral-500">
                                <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                            </div>
                        )}

                        {!isSearching && filteredResults.length > 0 && (
                            <div className="mt-4 bg-neutral-900 border border-neutral-700 rounded max-h-80 overflow-y-auto">
                                {filteredResults.map((testGroup, idx) => {
                                    const test = testGroup[0];
                                    const isConfigured = configuredLabs.some(l => l.test_name === test.test_name);

                                    return (
                                        <div
                                            key={idx}
                                            className={`p-3 border-b border-neutral-800 ${isConfigured ? 'opacity-50' : 'hover:bg-neutral-800'}`}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-bold text-sm text-white truncate">{test.test_name}</div>
                                                    <div className="text-xs text-neutral-400 mt-1">
                                                        {test.group} • Range: {test.min_value}-{test.max_value} {test.unit}
                                                    </div>
                                                </div>
                                                {isConfigured ? (
                                                    <span className="text-xs text-green-400 flex items-center gap-1">
                                                        <Check className="w-3 h-3" /> Added
                                                    </span>
                                                ) : (
                                                    <div className="flex gap-1">
                                                        <button
                                                            onClick={() => addLab(testGroup, 'normal')}
                                                            className="px-2 py-1 bg-green-700 hover:bg-green-600 rounded text-xs text-white"
                                                            title="Add with normal value"
                                                        >
                                                            Normal
                                                        </button>
                                                        <button
                                                            onClick={() => addLab(testGroup, 'high')}
                                                            className="px-2 py-1 bg-yellow-700 hover:bg-yellow-600 rounded text-xs text-white"
                                                            title="Add with high value"
                                                        >
                                                            <ArrowUp className="w-3 h-3" />
                                                        </button>
                                                        <button
                                                            onClick={() => addLab(testGroup, 'low')}
                                                            className="px-2 py-1 bg-blue-700 hover:bg-blue-600 rounded text-xs text-white"
                                                            title="Add with low value"
                                                        >
                                                            <ArrowDown className="w-3 h-3" />
                                                        </button>
                                                        <button
                                                            onClick={() => addLab(testGroup, 'critical_high')}
                                                            className="px-2 py-1 bg-red-700 hover:bg-red-600 rounded text-xs text-white"
                                                            title="Add with critical high value"
                                                        >
                                                            ⚠️↑
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {searchQuery && !isSearching && filteredResults.length === 0 && (
                            <div className="text-center py-6 text-neutral-500 text-sm">
                                No tests found matching "{searchQuery}"
                            </div>
                        )}
                    </div>

                    {/* Add by Group */}
                    <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-4">
                        <h5 className="text-sm font-bold text-purple-300 mb-3 flex items-center gap-2">
                            <Layers className="w-4 h-4" />
                            Add Entire Group
                        </h5>
                        <div className="flex gap-2">
                            <select
                                value={selectedGroup}
                                onChange={(e) => setSelectedGroup(e.target.value)}
                                className="flex-1 px-3 py-2 bg-neutral-900 border border-neutral-600 rounded text-sm text-white focus:border-purple-500 focus:outline-none"
                            >
                                <option value="all">Select a group...</option>
                                {groups.map(group => (
                                    <option key={group} value={group}>{group}</option>
                                ))}
                            </select>
                            <button
                                onClick={async () => {
                                    if (selectedGroup === 'all') return;
                                    const count = await addGroupAsPanel(selectedGroup);
                                    if (count > 0) {
                                        toast.success(`Added ${count} tests from "${selectedGroup}"`);
                                    }
                                }}
                                disabled={selectedGroup === 'all'}
                                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white rounded font-bold text-sm flex items-center gap-2"
                            >
                                <Plus className="w-4 h-4" />
                                Add Group
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Templates Tab */}
            {activeTab === 'templates' && (
                <div className="space-y-4">
                    <div className="bg-gradient-to-r from-purple-900/30 to-blue-900/30 border border-purple-700/50 rounded-lg p-4">
                        <h5 className="text-sm font-bold text-purple-300 mb-2">Clinical Panel Templates</h5>
                        <p className="text-xs text-neutral-400">
                            Pre-configured lab panels for common clinical scenarios. Each template includes appropriate abnormal values.
                        </p>
                    </div>

                    {/* Category Filter */}
                    <div className="flex gap-2 flex-wrap">
                        <button
                            onClick={() => setTemplateCategory('all')}
                            className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${
                                templateCategory === 'all' ? 'bg-purple-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                            }`}
                        >
                            All
                        </button>
                        {getTemplateCategories().map(cat => (
                            <button
                                key={cat}
                                onClick={() => setTemplateCategory(cat)}
                                className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${
                                    templateCategory === cat ? 'bg-purple-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                                }`}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>

                    {/* Template Cards */}
                    <div className="grid grid-cols-2 gap-3">
                        {Object.entries(LAB_PANEL_TEMPLATES)
                            .filter(([_, template]) => templateCategory === 'all' || template.category === templateCategory)
                            .map(([key, template]) => (
                                <div
                                    key={key}
                                    className="bg-neutral-800 border border-neutral-700 rounded-lg p-4 hover:border-purple-600 transition-colors"
                                >
                                    <div className="flex items-start justify-between mb-2">
                                        <div>
                                            <div className="font-bold text-white text-sm">{template.name}</div>
                                            <div className="text-xs text-neutral-400">{template.category}</div>
                                        </div>
                                        <span className="text-xs bg-neutral-700 px-2 py-0.5 rounded text-neutral-300">
                                            {template.tests.length} tests
                                        </span>
                                    </div>
                                    <p className="text-xs text-neutral-500 mb-3">{template.description}</p>
                                    <button
                                        onClick={() => applyTemplate(key)}
                                        className="w-full px-3 py-2 bg-purple-600 hover:bg-purple-500 rounded text-xs font-bold text-white flex items-center justify-center gap-2"
                                    >
                                        <Plus className="w-3 h-3" />
                                        Apply Template
                                    </button>
                                </div>
                            ))}
                    </div>
                </div>
            )}

            {/* Configured Labs Tab */}
            {activeTab === 'configured' && (
                <div className="space-y-4">
                    {/* Toolbar */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                            {configuredLabs.length > 0 && (
                                <>
                                    <button
                                        onClick={selectAll}
                                        className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-xs text-neutral-300"
                                    >
                                        Select All
                                    </button>
                                    {selectedLabs.size > 0 && (
                                        <>
                                            <button
                                                onClick={() => setSelectedLabs(new Set())}
                                                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-xs text-neutral-300"
                                            >
                                                Clear ({selectedLabs.size})
                                            </button>
                                            <button
                                                onClick={removeSelected}
                                                className="px-3 py-1.5 bg-red-900/50 hover:bg-red-900 rounded text-xs text-red-300 flex items-center gap-1"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                                Delete Selected
                                            </button>
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setShowPreview(!showPreview)}
                                className={`px-3 py-1.5 rounded text-xs flex items-center gap-1 ${
                                    showPreview ? 'bg-purple-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                                }`}
                            >
                                <Eye className="w-3 h-3" />
                                Preview
                            </button>
                            <button
                                onClick={exportLabs}
                                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-xs text-neutral-300 flex items-center gap-1"
                            >
                                <Download className="w-3 h-3" />
                                Export
                            </button>
                            <label className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-xs text-neutral-300 flex items-center gap-1 cursor-pointer">
                                <Upload className="w-3 h-3" />
                                Import
                                <input type="file" accept=".json" className="hidden" onChange={importLabs} />
                            </label>
                        </div>
                    </div>

                    {/* Configured Labs List */}
                    {configuredLabs.length === 0 ? (
                        <div className="text-center py-12 bg-neutral-800/50 rounded-lg border border-dashed border-neutral-700">
                            <FlaskConical className="w-12 h-12 mx-auto mb-3 text-neutral-600" />
                            <p className="text-neutral-500 mb-2">No tests configured</p>
                            <p className="text-xs text-neutral-600">
                                {defaultLabsEnabled
                                    ? 'All lab tests will return normal values'
                                    : 'Students won\'t be able to get any lab results'}
                            </p>
                        </div>
                    ) : showPreview ? (
                        /* Preview Mode */
                        <div className="bg-neutral-950 border border-neutral-700 rounded-lg overflow-hidden">
                            <div className="bg-neutral-800 px-4 py-2 border-b border-neutral-700">
                                <div className="text-sm font-bold text-white">Lab Results Preview (Student View)</div>
                            </div>
                            <div className="p-4">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-neutral-500 text-xs">
                                            <th className="pb-2">Test</th>
                                            <th className="pb-2">Result</th>
                                            <th className="pb-2">Reference Range</th>
                                            <th className="pb-2">Flag</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {configuredLabs.map((lab, idx) => {
                                            const status = getValueStatus(lab.current_value, lab.min_value, lab.max_value);
                                            const badge = getStatusBadge(status);
                                            return (
                                                <tr key={idx} className="border-t border-neutral-800">
                                                    <td className="py-2 text-white">{lab.test_name}</td>
                                                    <td className={`py-2 font-mono font-bold ${getStatusColor(status)}`}>
                                                        {lab.current_value} {lab.unit}
                                                    </td>
                                                    <td className="py-2 text-neutral-400 font-mono text-xs">
                                                        {lab.min_value} - {lab.max_value}
                                                    </td>
                                                    <td className="py-2">
                                                        {status !== 'normal' && (
                                                            <span className={`px-2 py-0.5 rounded text-xs border ${badge.bg}`}>
                                                                {badge.text}
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : (
                        /* Edit Mode - Grouped */
                        <div className="space-y-4">
                            {Object.entries(groupedConfiguredLabs).map(([group, labs]) => (
                                <div key={group} className="bg-neutral-800 border border-neutral-700 rounded-lg overflow-hidden">
                                    <button
                                        onClick={() => {
                                            setExpandedGroups(prev => {
                                                const next = new Set(prev);
                                                if (next.has(group)) next.delete(group);
                                                else next.add(group);
                                                return next;
                                            });
                                        }}
                                        className="w-full px-4 py-3 bg-neutral-800 hover:bg-neutral-750 flex items-center justify-between transition-colors"
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-white">{group}</span>
                                            <span className="text-xs text-neutral-500">({labs.length} tests)</span>
                                        </div>
                                        {expandedGroups.has(group) ? (
                                            <ChevronUp className="w-4 h-4 text-neutral-400" />
                                        ) : (
                                            <ChevronDown className="w-4 h-4 text-neutral-400" />
                                        )}
                                    </button>

                                    {expandedGroups.has(group) && (
                                        <div className="p-3 space-y-3 bg-neutral-900/50">
                                            {labs.map((lab) => (
                                                <LabValueCard
                                                    key={lab.id || lab.test_name}
                                                    lab={lab}
                                                    selected={selectedLabs.has(lab.id) || selectedLabs.has(lab.test_name)}
                                                    onToggleSelect={() => toggleLabSelection(lab.id || lab.test_name)}
                                                    onUpdateValue={(field, value) => updateLabValue(lab.id || lab.test_name, field, value)}
                                                    onApplyPreset={(preset) => applyPresetToLab(lab.id || lab.test_name, preset)}
                                                    onRemove={() => removeLab(lab.id || lab.test_name)}
                                                    getValueStatus={getValueStatus}
                                                    getStatusColor={getStatusColor}
                                                    getStatusBadge={getStatusBadge}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Individual Lab Value Card Component
 */
function LabValueCard({
    lab,
    selected,
    onToggleSelect,
    onUpdateValue,
    onApplyPreset,
    onRemove,
    getValueStatus,
    getStatusColor,
    getStatusBadge
}) {
    const status = getValueStatus(lab.current_value, lab.min_value, lab.max_value);
    const badge = getStatusBadge(status);

    // Calculate position on range indicator
    const range = lab.max_value - lab.min_value;
    const extendedMin = lab.min_value - range * 0.5;
    const extendedMax = lab.max_value + range * 0.5;
    const extendedRange = extendedMax - extendedMin;
    const position = Math.max(0, Math.min(100, ((lab.current_value - extendedMin) / extendedRange) * 100));

    // Normal range position
    const normalStart = ((lab.min_value - extendedMin) / extendedRange) * 100;
    const normalEnd = ((lab.max_value - extendedMin) / extendedRange) * 100;

    // Validation warning
    const isPhysiologicallyImpossible = lab.current_value < 0 ||
        (lab.test_name.includes('pH') && (lab.current_value < 6.5 || lab.current_value > 8.0));

    return (
        <div className={`bg-neutral-800 border rounded-lg p-4 transition-colors ${
            selected ? 'border-purple-500 bg-purple-900/10' : 'border-neutral-700'
        }`}>
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                    <input
                        type="checkbox"
                        checked={selected}
                        onChange={onToggleSelect}
                        className="w-4 h-4"
                    />
                    <div>
                        <div className="font-bold text-white text-sm">{lab.test_name}</div>
                        <div className="text-xs text-neutral-500">{lab.gender_category}</div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-xs border ${badge.bg}`}>
                        {badge.text}
                    </span>
                    <button
                        onClick={onRemove}
                        className="p-1 text-neutral-500 hover:text-red-400 hover:bg-red-900/20 rounded"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Visual Range Indicator */}
            <div className="mb-4">
                <div className="relative h-6 bg-neutral-900 rounded overflow-hidden">
                    {/* Low zone */}
                    <div
                        className="absolute h-full bg-blue-900/30"
                        style={{ left: 0, width: `${normalStart}%` }}
                    />
                    {/* Normal zone */}
                    <div
                        className="absolute h-full bg-green-900/40"
                        style={{ left: `${normalStart}%`, width: `${normalEnd - normalStart}%` }}
                    />
                    {/* High zone */}
                    <div
                        className="absolute h-full bg-yellow-900/30"
                        style={{ left: `${normalEnd}%`, right: 0 }}
                    />
                    {/* Current value marker */}
                    <div
                        className={`absolute top-0 bottom-0 w-1 ${
                            status.includes('critical') ? 'bg-red-500' :
                            status === 'low' ? 'bg-blue-400' :
                            status === 'high' ? 'bg-yellow-400' : 'bg-green-400'
                        }`}
                        style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
                    />
                    {/* Labels */}
                    <div className="absolute inset-0 flex items-center justify-between px-2 text-[10px] text-neutral-500">
                        <span>{Math.round(extendedMin * 10) / 10}</span>
                        <span className="text-green-400/70">{lab.min_value} - {lab.max_value}</span>
                        <span>{Math.round(extendedMax * 10) / 10}</span>
                    </div>
                </div>
            </div>

            {/* Value Input and Presets */}
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="text-xs text-neutral-500 block mb-1">Current Value</label>
                    <div className="flex gap-2">
                        <input
                            type="number"
                            step="0.01"
                            value={lab.current_value}
                            onChange={(e) => onUpdateValue('current_value', parseFloat(e.target.value) || 0)}
                            className={`flex-1 px-3 py-2 bg-neutral-900 border rounded text-white text-sm focus:outline-none ${
                                isPhysiologicallyImpossible ? 'border-red-500' : 'border-neutral-700 focus:border-purple-500'
                            }`}
                        />
                        <span className="px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-neutral-400 text-sm">
                            {lab.unit}
                        </span>
                    </div>
                    {isPhysiologicallyImpossible && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-red-400">
                            <AlertTriangle className="w-3 h-3" />
                            Physiologically unlikely value
                        </div>
                    )}
                </div>

                <div>
                    <label className="text-xs text-neutral-500 block mb-1">Quick Presets</label>
                    <div className="grid grid-cols-5 gap-1">
                        <button
                            onClick={() => onApplyPreset('critical_low')}
                            className="px-2 py-2 bg-red-900/50 hover:bg-red-900 border border-red-700 rounded text-xs text-red-300"
                            title="Critical Low"
                        >
                            ⚠↓
                        </button>
                        <button
                            onClick={() => onApplyPreset('low')}
                            className="px-2 py-2 bg-blue-900/50 hover:bg-blue-900 border border-blue-700 rounded text-xs text-blue-300"
                            title="Low"
                        >
                            <ArrowDown className="w-3 h-3 mx-auto" />
                        </button>
                        <button
                            onClick={() => onApplyPreset('normal')}
                            className="px-2 py-2 bg-green-900/50 hover:bg-green-900 border border-green-700 rounded text-xs text-green-300"
                            title="Normal"
                        >
                            <RotateCcw className="w-3 h-3 mx-auto" />
                        </button>
                        <button
                            onClick={() => onApplyPreset('high')}
                            className="px-2 py-2 bg-yellow-900/50 hover:bg-yellow-900 border border-yellow-700 rounded text-xs text-yellow-300"
                            title="High"
                        >
                            <ArrowUp className="w-3 h-3 mx-auto" />
                        </button>
                        <button
                            onClick={() => onApplyPreset('critical_high')}
                            className="px-2 py-2 bg-red-900/50 hover:bg-red-900 border border-red-700 rounded text-xs text-red-300"
                            title="Critical High"
                        >
                            ⚠↑
                        </button>
                    </div>
                </div>
            </div>

            {/* Result Timing Configuration */}
            <div className="mt-4 pt-3 border-t border-neutral-700">
                <label className="text-xs text-neutral-500 block mb-2">Result Timing</label>
                <div className="grid grid-cols-4 gap-2">
                    <button
                        onClick={() => onUpdateValue('turnaround_minutes', 0)}
                        className={`px-2 py-1.5 rounded text-xs font-bold transition-colors ${
                            lab.turnaround_minutes === 0
                                ? 'bg-green-600 text-white'
                                : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                        }`}
                    >
                        Immediate
                    </button>
                    <button
                        onClick={() => onUpdateValue('turnaround_minutes', 5)}
                        className={`px-2 py-1.5 rounded text-xs font-bold transition-colors ${
                            lab.turnaround_minutes === 5
                                ? 'bg-blue-600 text-white'
                                : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                        }`}
                    >
                        5 min
                    </button>
                    <button
                        onClick={() => onUpdateValue('turnaround_minutes', 15)}
                        className={`px-2 py-1.5 rounded text-xs font-bold transition-colors ${
                            lab.turnaround_minutes === 15
                                ? 'bg-blue-600 text-white'
                                : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                        }`}
                    >
                        15 min
                    </button>
                    <button
                        onClick={() => onUpdateValue('turnaround_minutes', 30)}
                        className={`px-2 py-1.5 rounded text-xs font-bold transition-colors ${
                            lab.turnaround_minutes === 30
                                ? 'bg-blue-600 text-white'
                                : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                        }`}
                    >
                        30 min
                    </button>
                </div>
                <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-neutral-500">Custom:</span>
                    <input
                        type="number"
                        min="0"
                        value={lab.turnaround_minutes || 30}
                        onChange={(e) => onUpdateValue('turnaround_minutes', parseInt(e.target.value) || 0)}
                        className="w-16 px-2 py-1 bg-neutral-900 border border-neutral-700 rounded text-white text-xs focus:border-purple-500 focus:outline-none"
                    />
                    <span className="text-xs text-neutral-500">minutes</span>
                </div>
            </div>
        </div>
    );
}
