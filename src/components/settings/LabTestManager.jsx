import React, { useState, useEffect, useMemo } from 'react';
import {
    Search, Plus, Trash2, Loader2, ChevronDown, ChevronUp,
    Upload, Download, Edit2, Save, X, Check, RefreshCw,
    FlaskConical, Filter, Database, AlertTriangle
} from 'lucide-react';
import { AuthService } from '../../services/authService';
import { useToast } from '../../contexts/ToastContext';
import { apiUrl } from '../../config/api';

/**
 * Lab Test Manager Component
 * Features:
 * - View all lab tests with filtering
 * - Add new lab tests
 * - Edit existing tests (normal values)
 * - Import from CSV
 * - Delete tests
 */
export default function LabTestManager() {
    const toast = useToast();

    // State
    const [activeTab, setActiveTab] = useState('browse'); // browse, add, import
    const [tests, setTests] = useState([]);
    const [groups, setGroups] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedGroup, setSelectedGroup] = useState('all');
    const [editingTest, setEditingTest] = useState(null);
    const [expandedGroups, setExpandedGroups] = useState(new Set());

    // New test form
    const [newTest, setNewTest] = useState({
        test_name: '',
        group: '',
        category: 'Both',
        min_value: '',
        max_value: '',
        unit: '',
        normal_samples: ''
    });

    // Import state
    const [importData, setImportData] = useState('');
    const [importOverwrite, setImportOverwrite] = useState(false);
    const [importPreview, setImportPreview] = useState([]);

    // Fetch all tests
    const fetchTests = async () => {
        setLoading(true);
        try {
            const token = AuthService.getToken();
            const [testsRes, groupsRes, statsRes] = await Promise.all([
                fetch(apiUrl('/labs/all?pageSize=1000'), {
                    headers: { 'Authorization': `Bearer ${token}` }
                }),
                fetch(apiUrl('/labs/groups'), {
                    headers: { 'Authorization': `Bearer ${token}` }
                }),
                fetch(apiUrl('/labs/stats'), {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
            ]);

            const testsData = await testsRes.json();
            const groupsData = await groupsRes.json();
            const statsData = await statsRes.json();

            setTests(testsData.tests || []);
            setGroups(groupsData.groups || []);
            setStats(statsData);
        } catch (err) {
            toast.error('Failed to load lab tests');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTests();
    }, []);

    // Filter and group tests
    const filteredTests = useMemo(() => {
        let filtered = tests;

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(t =>
                t.test_name.toLowerCase().includes(query) ||
                t.group.toLowerCase().includes(query)
            );
        }

        if (selectedGroup !== 'all') {
            filtered = filtered.filter(t => t.group === selectedGroup);
        }

        // Group by test name
        const grouped = {};
        filtered.forEach(test => {
            if (!grouped[test.test_name]) {
                grouped[test.test_name] = {
                    test_name: test.test_name,
                    group: test.group,
                    unit: test.unit,
                    variations: []
                };
            }
            grouped[test.test_name].variations.push(test);
        });

        return Object.values(grouped);
    }, [tests, searchQuery, selectedGroup]);

    // Group tests by category
    const testsByGroup = useMemo(() => {
        const byGroup = {};
        filteredTests.forEach(test => {
            if (!byGroup[test.group]) {
                byGroup[test.group] = [];
            }
            byGroup[test.group].push(test);
        });
        return byGroup;
    }, [filteredTests]);

    // Add new test
    const handleAddTest = async () => {
        if (!newTest.test_name || !newTest.group || !newTest.unit) {
            toast.error('Test name, group, and unit are required');
            return;
        }

        try {
            const token = AuthService.getToken();
            const testData = {
                ...newTest,
                min_value: parseFloat(newTest.min_value) || 0,
                max_value: parseFloat(newTest.max_value) || 0,
                normal_samples: newTest.normal_samples
                    ? newTest.normal_samples.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n))
                    : []
            };

            const res = await fetch(apiUrl('/labs/test'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(testData)
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Failed to add test');
            }

            toast.success('Test added successfully');
            setNewTest({
                test_name: '',
                group: '',
                category: 'Both',
                min_value: '',
                max_value: '',
                unit: '',
                normal_samples: ''
            });
            fetchTests();
        } catch (err) {
            toast.error(err.message);
        }
    };

    // Update test
    const handleUpdateTest = async (test) => {
        try {
            const token = AuthService.getToken();
            const res = await fetch(apiUrl('/labs/test'), {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(test)
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Failed to update test');
            }

            toast.success('Test updated successfully');
            setEditingTest(null);
            fetchTests();
        } catch (err) {
            toast.error(err.message);
        }
    };

    // Delete test
    const handleDeleteTest = async (test_name, category) => {
        const confirmed = await toast.confirm(`Delete "${test_name}" (${category})?`, { title: 'Delete Test', type: 'danger', confirmText: 'Delete' });
        if (!confirmed) return;

        try {
            const token = AuthService.getToken();
            const res = await fetch(apiUrl('/labs/test'), {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ test_name, category })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Failed to delete test');
            }

            toast.success('Test deleted');
            fetchTests();
        } catch (err) {
            toast.error(err.message);
        }
    };

    // Parse CSV for import
    const parseCSV = (csvText) => {
        const lines = csvText.trim().split('\n');
        if (lines.length < 2) return [];

        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const tests = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',');
            const test = {};

            headers.forEach((header, idx) => {
                test[header] = values[idx]?.trim() || '';
            });

            if (test.test_name) {
                tests.push({
                    test_name: test.test_name,
                    group: test.group || 'Uncategorized',
                    category: test.category || 'Both',
                    min_value: test.min_value || '0',
                    max_value: test.max_value || '0',
                    unit: test.unit || '',
                    normal_samples: test.normal_samples || ''
                });
            }
        }

        return tests;
    };

    // Handle import preview
    const handleImportPreview = () => {
        const parsed = parseCSV(importData);
        setImportPreview(parsed);
    };

    // Execute import
    const handleImport = async () => {
        if (importPreview.length === 0) {
            toast.error('No valid tests to import');
            return;
        }

        try {
            const token = AuthService.getToken();
            const res = await fetch(apiUrl('/labs/import'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    tests: importPreview,
                    overwrite: importOverwrite
                })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Import failed');
            }

            toast.success(`Import complete: ${data.results.added} added, ${data.results.updated} updated, ${data.results.skipped} skipped`);
            setImportData('');
            setImportPreview([]);
            fetchTests();
        } catch (err) {
            toast.error(err.message);
        }
    };

    // Export to CSV
    const handleExport = () => {
        const headers = ['test_name', 'group', 'category', 'min_value', 'max_value', 'unit', 'normal_samples'];
        const csvLines = [headers.join(',')];

        tests.forEach(test => {
            csvLines.push([
                `"${test.test_name}"`,
                `"${test.group}"`,
                test.category,
                test.min_value,
                test.max_value,
                `"${test.unit}"`,
                `"${(test.normal_samples || []).join(',')}"`
            ].join(','));
        });

        const csv = csvLines.join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'lab_tests_export.csv';
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Exported lab tests to CSV');
    };

    // Toggle group expansion
    const toggleGroup = (group) => {
        const newExpanded = new Set(expandedGroups);
        if (newExpanded.has(group)) {
            newExpanded.delete(group);
        } else {
            newExpanded.add(group);
        }
        setExpandedGroups(newExpanded);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Stats */}
            {stats && (
                <div className="grid grid-cols-4 gap-3">
                    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                        <div className="text-2xl font-bold text-cyan-400">{stats.totalTests}</div>
                        <div className="text-xs text-slate-400">Total Tests</div>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                        <div className="text-2xl font-bold text-emerald-400">{stats.totalGroups}</div>
                        <div className="text-xs text-slate-400">Groups</div>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                        <div className="text-2xl font-bold text-purple-400">{stats.byCategory?.Both || 0}</div>
                        <div className="text-xs text-slate-400">Universal Tests</div>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                        <div className="text-2xl font-bold text-amber-400">
                            {(stats.byCategory?.Male || 0) + (stats.byCategory?.Female || 0)}
                        </div>
                        <div className="text-xs text-slate-400">Gender-Specific</div>
                    </div>
                </div>
            )}

            {/* Tabs */}
            <div className="flex gap-2 border-b border-slate-700 pb-2">
                <button
                    onClick={() => setActiveTab('browse')}
                    className={`px-4 py-2 rounded-t-lg flex items-center gap-2 transition-colors ${
                        activeTab === 'browse'
                            ? 'bg-cyan-600 text-white'
                            : 'text-slate-400 hover:bg-slate-700'
                    }`}
                >
                    <Database size={16} />
                    Browse Tests
                </button>
                <button
                    onClick={() => setActiveTab('add')}
                    className={`px-4 py-2 rounded-t-lg flex items-center gap-2 transition-colors ${
                        activeTab === 'add'
                            ? 'bg-cyan-600 text-white'
                            : 'text-slate-400 hover:bg-slate-700'
                    }`}
                >
                    <Plus size={16} />
                    Add Test
                </button>
                <button
                    onClick={() => setActiveTab('import')}
                    className={`px-4 py-2 rounded-t-lg flex items-center gap-2 transition-colors ${
                        activeTab === 'import'
                            ? 'bg-cyan-600 text-white'
                            : 'text-slate-400 hover:bg-slate-700'
                    }`}
                >
                    <Upload size={16} />
                    Import CSV
                </button>
                <div className="ml-auto flex gap-2">
                    <button
                        onClick={handleExport}
                        className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded flex items-center gap-1"
                    >
                        <Download size={14} />
                        Export
                    </button>
                    <button
                        onClick={fetchTests}
                        className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded flex items-center gap-1"
                    >
                        <RefreshCw size={14} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* Browse Tab */}
            {activeTab === 'browse' && (
                <div className="space-y-4">
                    {/* Search and Filter */}
                    <div className="flex gap-3">
                        <div className="flex-1 relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search tests..."
                                className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-10 pr-4 py-2 text-white placeholder-slate-400 focus:border-cyan-500 focus:outline-none"
                            />
                        </div>
                        <select
                            value={selectedGroup}
                            onChange={(e) => setSelectedGroup(e.target.value)}
                            className="bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-cyan-500 focus:outline-none"
                        >
                            <option value="all">All Groups</option>
                            {groups.map(g => (
                                <option key={g} value={g}>{g}</option>
                            ))}
                        </select>
                    </div>

                    {/* Test List */}
                    <div className="max-h-[500px] overflow-y-auto space-y-2">
                        {Object.entries(testsByGroup).map(([group, groupTests]) => (
                            <div key={group} className="bg-slate-800/50 rounded-lg border border-slate-700">
                                <button
                                    onClick={() => toggleGroup(group)}
                                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-700/50"
                                >
                                    <div className="flex items-center gap-2">
                                        <FlaskConical size={16} className="text-cyan-400" />
                                        <span className="font-medium text-white">{group}</span>
                                        <span className="text-xs text-slate-400">({groupTests.length} tests)</span>
                                    </div>
                                    {expandedGroups.has(group) ? (
                                        <ChevronUp size={18} className="text-slate-400" />
                                    ) : (
                                        <ChevronDown size={18} className="text-slate-400" />
                                    )}
                                </button>

                                {expandedGroups.has(group) && (
                                    <div className="px-4 pb-3 space-y-2">
                                        {groupTests.map(test => (
                                            <div key={test.test_name} className="bg-slate-900/50 rounded p-3">
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="font-medium text-white">{test.test_name}</span>
                                                    <span className="text-xs text-slate-400">{test.unit}</span>
                                                </div>

                                                {test.variations.map(v => (
                                                    <div key={`${v.test_name}-${v.category}`} className="flex items-center gap-2 mt-1">
                                                        {editingTest?.test_name === v.test_name && editingTest?.category === v.category ? (
                                                            <div className="flex-1 flex items-center gap-2 bg-slate-800 p-2 rounded">
                                                                <span className="text-xs text-slate-400 w-16">{v.category}:</span>
                                                                <input
                                                                    type="number"
                                                                    value={editingTest.min_value}
                                                                    onChange={(e) => setEditingTest({ ...editingTest, min_value: e.target.value })}
                                                                    className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm"
                                                                    placeholder="Min"
                                                                />
                                                                <span className="text-slate-400">-</span>
                                                                <input
                                                                    type="number"
                                                                    value={editingTest.max_value}
                                                                    onChange={(e) => setEditingTest({ ...editingTest, max_value: e.target.value })}
                                                                    className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm"
                                                                    placeholder="Max"
                                                                />
                                                                <button
                                                                    onClick={() => handleUpdateTest(editingTest)}
                                                                    className="p-1 text-emerald-400 hover:bg-emerald-400/20 rounded"
                                                                >
                                                                    <Check size={16} />
                                                                </button>
                                                                <button
                                                                    onClick={() => setEditingTest(null)}
                                                                    className="p-1 text-slate-400 hover:bg-slate-600 rounded"
                                                                >
                                                                    <X size={16} />
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <span className="text-xs text-slate-400 w-16">{v.category}:</span>
                                                                <span className="text-sm text-cyan-400">
                                                                    {v.min_value} - {v.max_value}
                                                                </span>
                                                                <button
                                                                    onClick={() => setEditingTest({ ...v })}
                                                                    className="p-1 text-slate-400 hover:text-cyan-400 hover:bg-slate-700 rounded"
                                                                >
                                                                    <Edit2 size={14} />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDeleteTest(v.test_name, v.category)}
                                                                    className="p-1 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded"
                                                                >
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}

                        {filteredTests.length === 0 && (
                            <div className="text-center py-8 text-slate-400">
                                No tests found matching your criteria
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Add Test Tab */}
            {activeTab === 'add' && (
                <div className="bg-slate-800/50 rounded-lg border border-slate-700 p-4">
                    <h3 className="text-lg font-medium text-white mb-4">Add New Lab Test</h3>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-slate-400 mb-1">Test Name *</label>
                            <input
                                type="text"
                                value={newTest.test_name}
                                onChange={(e) => setNewTest({ ...newTest, test_name: e.target.value })}
                                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white focus:border-cyan-500 focus:outline-none"
                                placeholder="e.g., Hemoglobin"
                            />
                        </div>

                        <div>
                            <label className="block text-sm text-slate-400 mb-1">Group *</label>
                            <input
                                type="text"
                                value={newTest.group}
                                onChange={(e) => setNewTest({ ...newTest, group: e.target.value })}
                                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white focus:border-cyan-500 focus:outline-none"
                                placeholder="e.g., Hematology"
                                list="group-suggestions"
                            />
                            <datalist id="group-suggestions">
                                {groups.map(g => <option key={g} value={g} />)}
                            </datalist>
                        </div>

                        <div>
                            <label className="block text-sm text-slate-400 mb-1">Category</label>
                            <select
                                value={newTest.category}
                                onChange={(e) => setNewTest({ ...newTest, category: e.target.value })}
                                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white focus:border-cyan-500 focus:outline-none"
                            >
                                <option value="Both">Both (Universal)</option>
                                <option value="Male">Male</option>
                                <option value="Female">Female</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm text-slate-400 mb-1">Unit *</label>
                            <input
                                type="text"
                                value={newTest.unit}
                                onChange={(e) => setNewTest({ ...newTest, unit: e.target.value })}
                                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white focus:border-cyan-500 focus:outline-none"
                                placeholder="e.g., g/dL"
                            />
                        </div>

                        <div>
                            <label className="block text-sm text-slate-400 mb-1">Min Value</label>
                            <input
                                type="number"
                                step="any"
                                value={newTest.min_value}
                                onChange={(e) => setNewTest({ ...newTest, min_value: e.target.value })}
                                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white focus:border-cyan-500 focus:outline-none"
                                placeholder="e.g., 12.0"
                            />
                        </div>

                        <div>
                            <label className="block text-sm text-slate-400 mb-1">Max Value</label>
                            <input
                                type="number"
                                step="any"
                                value={newTest.max_value}
                                onChange={(e) => setNewTest({ ...newTest, max_value: e.target.value })}
                                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white focus:border-cyan-500 focus:outline-none"
                                placeholder="e.g., 16.0"
                            />
                        </div>

                        <div className="col-span-2">
                            <label className="block text-sm text-slate-400 mb-1">Normal Samples (comma-separated)</label>
                            <input
                                type="text"
                                value={newTest.normal_samples}
                                onChange={(e) => setNewTest({ ...newTest, normal_samples: e.target.value })}
                                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white focus:border-cyan-500 focus:outline-none"
                                placeholder="e.g., 13.5, 14.0, 14.5, 15.0"
                            />
                        </div>
                    </div>

                    <div className="mt-4 flex justify-end">
                        <button
                            onClick={handleAddTest}
                            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded flex items-center gap-2"
                        >
                            <Plus size={18} />
                            Add Test
                        </button>
                    </div>
                </div>
            )}

            {/* Import Tab */}
            {activeTab === 'import' && (
                <div className="space-y-4">
                    <div className="bg-slate-800/50 rounded-lg border border-slate-700 p-4">
                        <h3 className="text-lg font-medium text-white mb-2">Import Lab Tests from CSV</h3>
                        <p className="text-sm text-slate-400 mb-4">
                            CSV format: test_name, group, category, min_value, max_value, unit, normal_samples
                        </p>

                        <div className="mb-4">
                            <label className="block text-sm text-slate-400 mb-1">CSV Data</label>
                            <textarea
                                value={importData}
                                onChange={(e) => setImportData(e.target.value)}
                                rows={10}
                                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white font-mono text-sm focus:border-cyan-500 focus:outline-none"
                                placeholder={`test_name,group,category,min_value,max_value,unit,normal_samples
Hemoglobin,Hematology,Male,13.0,17.0,g/dL,"13.5,14.0,14.5,15.0"
Hemoglobin,Hematology,Female,12.0,15.0,g/dL,"12.5,13.0,13.5,14.0"`}
                            />
                        </div>

                        <div className="flex items-center gap-4 mb-4">
                            <label className="flex items-center gap-2 text-sm text-slate-300">
                                <input
                                    type="checkbox"
                                    checked={importOverwrite}
                                    onChange={(e) => setImportOverwrite(e.target.checked)}
                                    className="rounded border-slate-600 bg-slate-700 text-cyan-500 focus:ring-cyan-500"
                                />
                                Overwrite existing tests
                            </label>
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={handleImportPreview}
                                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded flex items-center gap-2"
                            >
                                <Search size={18} />
                                Preview
                            </button>
                            <button
                                onClick={handleImport}
                                disabled={importPreview.length === 0}
                                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded flex items-center gap-2"
                            >
                                <Upload size={18} />
                                Import {importPreview.length > 0 && `(${importPreview.length})`}
                            </button>
                        </div>
                    </div>

                    {/* Import Preview */}
                    {importPreview.length > 0 && (
                        <div className="bg-slate-800/50 rounded-lg border border-slate-700 p-4">
                            <h4 className="text-sm font-medium text-white mb-2">Preview ({importPreview.length} tests)</h4>
                            <div className="max-h-[200px] overflow-y-auto">
                                <table className="w-full text-sm">
                                    <thead className="text-slate-400 border-b border-slate-700">
                                        <tr>
                                            <th className="text-left py-2">Test Name</th>
                                            <th className="text-left py-2">Group</th>
                                            <th className="text-left py-2">Category</th>
                                            <th className="text-left py-2">Range</th>
                                            <th className="text-left py-2">Unit</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {importPreview.map((test, i) => (
                                            <tr key={i} className="border-b border-slate-700/50">
                                                <td className="py-2 text-white">{test.test_name}</td>
                                                <td className="py-2 text-slate-300">{test.group}</td>
                                                <td className="py-2 text-slate-300">{test.category}</td>
                                                <td className="py-2 text-cyan-400">{test.min_value} - {test.max_value}</td>
                                                <td className="py-2 text-slate-300">{test.unit}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
