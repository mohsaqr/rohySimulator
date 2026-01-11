import React, { useState, useEffect, useMemo } from 'react';
import {
    Search, Plus, Trash2, Loader2, Upload, Download, Edit2, Save, X,
    Pill, Filter, Database, RefreshCw
} from 'lucide-react';
import { AuthService } from '../../services/authService';
import { useToast } from '../../contexts/ToastContext';

/**
 * Medication Manager Component
 * Features:
 * - View all medications with search
 * - Add new medications
 * - Edit medications
 * - Bulk import
 * - Delete medications
 */
export default function MedicationManager() {
    const toast = useToast();

    const [activeTab, setActiveTab] = useState('browse');
    const [medications, setMedications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [editingMed, setEditingMed] = useState(null);

    // New medication form
    const [newMed, setNewMed] = useState({
        generic_name: '',
        drug_class: '',
        category: 'General',
        route: 'oral',
        typical_dose: '',
        indications: '',
        side_effects: ''
    });

    // Import state
    const [importData, setImportData] = useState('');

    // Fetch all medications
    const fetchMedications = async () => {
        setLoading(true);
        try {
            const token = AuthService.getToken();
            const res = await fetch('/api/master/medications', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            setMedications(data.medications || []);
        } catch (err) {
            toast.error('Failed to load medications');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchMedications();
    }, []);

    // Filter medications
    const filteredMedications = useMemo(() => {
        if (!searchQuery) return medications;
        const query = searchQuery.toLowerCase();
        return medications.filter(m =>
            m.generic_name?.toLowerCase().includes(query) ||
            m.drug_class?.toLowerCase().includes(query)
        );
    }, [medications, searchQuery]);

    // Add new medication
    const handleAddMed = async () => {
        if (!newMed.generic_name) {
            toast.error('Medication name is required');
            return;
        }

        try {
            const token = AuthService.getToken();
            const medData = {
                ...newMed,
                indications: newMed.indications ? newMed.indications.split(',').map(s => s.trim()) : [],
                side_effects: newMed.side_effects ? newMed.side_effects.split(',').map(s => s.trim()) : []
            };

            const res = await fetch('/api/master/medications', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(medData)
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to add medication');
            }

            toast.success('Medication added');
            setNewMed({
                generic_name: '',
                drug_class: '',
                category: 'General',
                route: 'oral',
                typical_dose: '',
                indications: '',
                side_effects: ''
            });
            fetchMedications();
            setActiveTab('browse');
        } catch (err) {
            toast.error(err.message);
        }
    };

    // Delete medication
    const handleDeleteMed = async (id, name) => {
        if (!confirm(`Delete "${name}"?`)) return;

        try {
            const token = AuthService.getToken();
            const res = await fetch(`/api/master/medications/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) throw new Error('Failed to delete');

            toast.success('Medication deleted');
            fetchMedications();
        } catch (err) {
            toast.error(err.message);
        }
    };

    // Clear all medications
    const handleClearAll = async () => {
        if (!confirm('Delete ALL medications? This cannot be undone.')) return;

        try {
            const token = AuthService.getToken();
            const res = await fetch('/api/master/medications/all', {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) throw new Error('Failed to delete');

            toast.success('All medications deleted');
            fetchMedications();
        } catch (err) {
            toast.error(err.message);
        }
    };

    // Bulk import
    const handleBulkImport = async () => {
        if (!importData.trim()) {
            toast.error('Enter medication names (one per line)');
            return;
        }

        const names = importData.split('\n').map(n => n.trim()).filter(n => n);
        if (names.length === 0) {
            toast.error('No valid medication names found');
            return;
        }

        try {
            const token = AuthService.getToken();
            const res = await fetch('/api/master/medications/bulk', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    medications: names.map(name => ({ name }))
                })
            });

            const data = await res.json();

            if (!res.ok) throw new Error(data.error || 'Import failed');

            toast.success(`Imported ${data.inserted} medications (${data.skipped} skipped)`);
            setImportData('');
            fetchMedications();
            setActiveTab('browse');
        } catch (err) {
            toast.error(err.message);
        }
    };

    // Export to CSV
    const handleExport = () => {
        const csv = [
            'Name,Class,Category,Route,Dose',
            ...medications.map(m =>
                `"${m.generic_name}","${m.drug_class || ''}","${m.category || ''}","${m.route || ''}","${m.typical_dose || ''}"`
            )
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `medications_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Pill className="w-5 h-5 text-pink-400" />
                    <h3 className="text-lg font-bold">Medication Database</h3>
                    <span className="text-xs text-neutral-500 bg-neutral-800 px-2 py-1 rounded">
                        {medications.length} medications
                    </span>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={fetchMedications}
                        className="p-2 hover:bg-neutral-800 rounded"
                        title="Refresh"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-1 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-sm"
                    >
                        <Download className="w-4 h-4" />
                        Export
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b border-neutral-700 pb-2">
                <button
                    onClick={() => setActiveTab('browse')}
                    className={`px-4 py-2 text-sm font-medium rounded-t ${activeTab === 'browse' ? 'bg-neutral-800 text-white' : 'text-neutral-500 hover:text-white'}`}
                >
                    <Database className="w-4 h-4 inline mr-2" />
                    Browse
                </button>
                <button
                    onClick={() => setActiveTab('add')}
                    className={`px-4 py-2 text-sm font-medium rounded-t ${activeTab === 'add' ? 'bg-neutral-800 text-white' : 'text-neutral-500 hover:text-white'}`}
                >
                    <Plus className="w-4 h-4 inline mr-2" />
                    Add
                </button>
                <button
                    onClick={() => setActiveTab('import')}
                    className={`px-4 py-2 text-sm font-medium rounded-t ${activeTab === 'import' ? 'bg-neutral-800 text-white' : 'text-neutral-500 hover:text-white'}`}
                >
                    <Upload className="w-4 h-4 inline mr-2" />
                    Bulk Import
                </button>
            </div>

            {/* Browse Tab */}
            {activeTab === 'browse' && (
                <div className="space-y-4">
                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search medications..."
                            className="w-full pl-10 pr-4 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm focus:border-cyan-500 outline-none"
                        />
                    </div>

                    {/* Medications List */}
                    <div className="max-h-[500px] overflow-y-auto border border-neutral-700 rounded-lg">
                        <table className="w-full text-sm">
                            <thead className="bg-neutral-800 sticky top-0">
                                <tr>
                                    <th className="px-4 py-3 text-left font-bold">Name</th>
                                    <th className="px-4 py-3 text-left font-bold">Class</th>
                                    <th className="px-4 py-3 text-left font-bold">Route</th>
                                    <th className="px-4 py-3 text-right font-bold w-20">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredMedications.length === 0 ? (
                                    <tr>
                                        <td colSpan="4" className="text-center py-8 text-neutral-500">
                                            {searchQuery ? 'No medications match your search' : 'No medications in database'}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredMedications.map((med) => (
                                        <tr key={med.id} className="border-t border-neutral-800 hover:bg-neutral-800/50">
                                            <td className="px-4 py-2 font-medium">{med.generic_name}</td>
                                            <td className="px-4 py-2 text-neutral-400">{med.drug_class || '-'}</td>
                                            <td className="px-4 py-2 text-neutral-400">{med.route || '-'}</td>
                                            <td className="px-4 py-2 text-right">
                                                <button
                                                    onClick={() => handleDeleteMed(med.id, med.generic_name)}
                                                    className="p-1 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded"
                                                    title="Delete"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Clear All Button */}
                    {medications.length > 0 && (
                        <div className="flex justify-end">
                            <button
                                onClick={handleClearAll}
                                className="flex items-center gap-2 px-3 py-1.5 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded text-sm"
                            >
                                <Trash2 className="w-4 h-4" />
                                Clear All
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Add Tab */}
            {activeTab === 'add' && (
                <div className="space-y-4 bg-neutral-800/50 border border-neutral-700 rounded-lg p-4">
                    <h4 className="font-bold text-sm">Add New Medication</h4>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-neutral-400 mb-1">Name *</label>
                            <input
                                type="text"
                                value={newMed.generic_name}
                                onChange={(e) => setNewMed({ ...newMed, generic_name: e.target.value })}
                                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-600 rounded text-sm focus:border-cyan-500 outline-none"
                                placeholder="e.g., Metformin"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-neutral-400 mb-1">Drug Class</label>
                            <input
                                type="text"
                                value={newMed.drug_class}
                                onChange={(e) => setNewMed({ ...newMed, drug_class: e.target.value })}
                                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-600 rounded text-sm focus:border-cyan-500 outline-none"
                                placeholder="e.g., Biguanide"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-neutral-400 mb-1">Route</label>
                            <select
                                value={newMed.route}
                                onChange={(e) => setNewMed({ ...newMed, route: e.target.value })}
                                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-600 rounded text-sm focus:border-cyan-500 outline-none"
                            >
                                <option value="oral">Oral</option>
                                <option value="iv">IV</option>
                                <option value="im">IM</option>
                                <option value="sc">Subcutaneous</option>
                                <option value="topical">Topical</option>
                                <option value="inhaled">Inhaled</option>
                                <option value="sublingual">Sublingual</option>
                                <option value="other">Other</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-neutral-400 mb-1">Typical Dose</label>
                            <input
                                type="text"
                                value={newMed.typical_dose}
                                onChange={(e) => setNewMed({ ...newMed, typical_dose: e.target.value })}
                                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-600 rounded text-sm focus:border-cyan-500 outline-none"
                                placeholder="e.g., 500mg"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs text-neutral-400 mb-1">Indications (comma-separated)</label>
                        <input
                            type="text"
                            value={newMed.indications}
                            onChange={(e) => setNewMed({ ...newMed, indications: e.target.value })}
                            className="w-full px-3 py-2 bg-neutral-800 border border-neutral-600 rounded text-sm focus:border-cyan-500 outline-none"
                            placeholder="e.g., Type 2 Diabetes, PCOS"
                        />
                    </div>

                    <div>
                        <label className="block text-xs text-neutral-400 mb-1">Side Effects (comma-separated)</label>
                        <input
                            type="text"
                            value={newMed.side_effects}
                            onChange={(e) => setNewMed({ ...newMed, side_effects: e.target.value })}
                            className="w-full px-3 py-2 bg-neutral-800 border border-neutral-600 rounded text-sm focus:border-cyan-500 outline-none"
                            placeholder="e.g., Nausea, Diarrhea"
                        />
                    </div>

                    <button
                        onClick={handleAddMed}
                        className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded text-sm font-bold"
                    >
                        <Plus className="w-4 h-4" />
                        Add Medication
                    </button>
                </div>
            )}

            {/* Import Tab */}
            {activeTab === 'import' && (
                <div className="space-y-4 bg-neutral-800/50 border border-neutral-700 rounded-lg p-4">
                    <h4 className="font-bold text-sm">Bulk Import Medications</h4>
                    <p className="text-xs text-neutral-400">Enter medication names, one per line</p>

                    <textarea
                        value={importData}
                        onChange={(e) => setImportData(e.target.value)}
                        rows={10}
                        className="w-full px-3 py-2 bg-neutral-800 border border-neutral-600 rounded text-sm font-mono focus:border-cyan-500 outline-none"
                        placeholder="Aspirin&#10;Ibuprofen&#10;Metformin&#10;..."
                    />

                    <div className="flex justify-between items-center">
                        <span className="text-xs text-neutral-500">
                            {importData.split('\n').filter(n => n.trim()).length} medications to import
                        </span>
                        <button
                            onClick={handleBulkImport}
                            disabled={!importData.trim()}
                            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-neutral-700 disabled:text-neutral-500 rounded text-sm font-bold"
                        >
                            <Upload className="w-4 h-4" />
                            Import
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
