import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Search, Plus, Trash2, Loader2, Upload, Download, Edit2, Save, X,
    Pill, Database, RefreshCw, ChevronDown, ChevronRight, Lock
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { ApiError, apiDelete, apiFetch, apiPost, apiPut } from '../../services/apiClient';

// Role rank table mirrors server/middleware/auth.js so we can gate the
// Edit button by the same rules canMutate() enforces server-side. Keeps
// the UI honest about what a click will actually achieve — no point
// flashing an Edit affordance the server will 403.
const ROLE_RANKS = { guest: 0, student: 1, user: 1, reviewer: 2, educator: 3, admin: 4 };
function rankOf(user) {
    return ROLE_RANKS[user?.role] ?? 0;
}
function canEditRow(user, row) {
    if (!user || !row) return false;
    if (row.created_by === user.id) return true;
    if (row.scope === 'tenant' && row.tenant_id === (user.tenant_id ?? 1) && rankOf(user) >= ROLE_RANKS.educator) return true;
    if (row.scope === 'platform' && rankOf(user) >= ROLE_RANKS.admin) return true;
    return false;
}

// JSON columns come back as strings on some legacy rows and as arrays on
// others. Normalize to a string the user can edit, and back to an array
// when saving.
function jsonToCsv(value) {
    if (Array.isArray(value)) return value.join(', ');
    if (!value) return '';
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed.join(', ') : String(value);
        } catch {
            return value;
        }
    }
    return String(value);
}
function csvToArray(value) {
    if (!value) return [];
    return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

const ROUTE_OPTIONS = ['oral', 'iv', 'im', 'sc', 'topical', 'inhaled', 'sublingual', 'rectal', 'other'];

function ScopeBadge({ scope, isCurated }) {
    const { t } = useTranslation('authoring_meds');
    const map = {
        platform: { label: isCurated ? t('scope_curated') : t('scope_platform'), color: 'rohy-badge-cyan' },
        tenant:   { label: t('scope_tenant'),   color: 'rohy-badge-amber' },
        user:     { label: t('scope_my'),       color: 'rohy-badge-green' },
        session:  { label: t('scope_session'),  color: 'rohy-badge-neutral' },
    };
    const meta = map[scope] || map.platform;
    return <span className={`${meta.color} uppercase tracking-wide`}>{meta.label}</span>;
}

function MedDetail({ med, currentUser, onEdit, onCancel, isEditing, onSave, saving }) {
    const { t } = useTranslation('authoring_meds');
    const [draft, setDraft] = useState(() => ({
        generic_name: med.generic_name || '',
        drug_class: med.drug_class || '',
        category: med.category || '',
        route: med.route || 'oral',
        typical_dose: med.typical_dose || '',
        dose_unit: med.dose_unit || '',
        frequency: med.frequency || '',
        rxcui: med.rxcui || '',
        ndc_primary: med.ndc_primary || '',
        atc_code: med.atc_code || '',
        boxed_warning: med.boxed_warning || '',
        indications: jsonToCsv(med.indications),
        contraindications: jsonToCsv(med.contraindications),
        side_effects: jsonToCsv(med.side_effects),
    }));

    if (!isEditing) {
        const dose = [med.typical_dose, med.dose_unit].filter(Boolean).join(' ');
        const editable = canEditRow(currentUser, med);
        return (
            <div className="px-6 py-4 rohy-detail-panel grid grid-cols-2 gap-4 text-xs">
                <div className="col-span-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                        <ScopeBadge scope={med.scope} isCurated={med.is_curated} />
                        {med.data_source_key && (
                            <span className="rohy-badge-neutral uppercase tracking-wide">
                                {med.data_source_key}
                            </span>
                        )}
                        {med.rxcui && (
                            <a
                                href={`https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${med.rxcui}`}
                                target="_blank" rel="noreferrer"
                                className="rohy-badge-teal uppercase tracking-wide hover:brightness-95"
                            >
                                RxCUI {med.rxcui}
                            </a>
                        )}
                    </div>
                    {editable ? (
                        <button
                            onClick={onEdit}
                            className="rohy-subtle-button flex items-center gap-1 px-3 py-1 text-xs rounded"
                        >
                            <Edit2 className="w-3.5 h-3.5" />
                            {t('edit')}
                        </button>
                    ) : (
                        <span className="flex items-center gap-1 text-[10px] text-neutral-500" title={t('read_only_title')}>
                            <Lock className="w-3 h-3" />
                            {t('read_only')}
                        </span>
                    )}
                </div>
                <Field label={t('field_drug_class')}>{med.drug_class || '—'}</Field>
                <Field label={t('field_category')}>{med.category || '—'}</Field>
                <Field label={t('field_route')}>{med.route || '—'}</Field>
                <Field label={t('field_dose')}>{dose || '—'}</Field>
                <Field label={t('field_frequency')}>{med.frequency || '—'}</Field>
                <Field label={t('field_ndc_atc')}>{[med.ndc_primary, med.atc_code].filter(Boolean).join(' / ') || '—'}</Field>
                {med.boxed_warning && (
                    <Field label={t('field_boxed_warning')} wide>
                        <span className="text-red-300">{med.boxed_warning}</span>
                    </Field>
                )}
                <Field label={t('field_indications')} wide>{jsonToCsv(med.indications) || '—'}</Field>
                <Field label={t('field_contraindications')} wide>{jsonToCsv(med.contraindications) || '—'}</Field>
                <Field label={t('field_side_effects')} wide>{jsonToCsv(med.side_effects) || '—'}</Field>
            </div>
        );
    }

    return (
        <div className="px-6 py-4 rohy-detail-panel grid grid-cols-2 gap-3 text-xs">
            <Input label={t('field_generic_name')} value={draft.generic_name} onChange={(v) => setDraft({ ...draft, generic_name: v })} />
            <Input label={t('field_drug_class')} value={draft.drug_class} onChange={(v) => setDraft({ ...draft, drug_class: v })} />
            <Input label={t('field_category')} value={draft.category} onChange={(v) => setDraft({ ...draft, category: v })} />
            <div>
                <label className="block text-[10px] uppercase tracking-wide text-neutral-400 mb-1">{t('field_route')}</label>
                <select
                    value={draft.route}
                    onChange={(e) => setDraft({ ...draft, route: e.target.value })}
                    className="rohy-field w-full px-2 py-1.5 rounded text-xs"
                >
                    {ROUTE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
            </div>
            <Input label={t('field_typical_dose')} value={draft.typical_dose} onChange={(v) => setDraft({ ...draft, typical_dose: v })} />
            <Input label={t('field_dose_unit')} value={draft.dose_unit} onChange={(v) => setDraft({ ...draft, dose_unit: v })} />
            <Input label={t('field_frequency')} value={draft.frequency} onChange={(v) => setDraft({ ...draft, frequency: v })} />
            <Input label={t('field_rxcui')} value={draft.rxcui} onChange={(v) => setDraft({ ...draft, rxcui: v })} />
            <Input label={t('field_ndc_primary')} value={draft.ndc_primary} onChange={(v) => setDraft({ ...draft, ndc_primary: v })} />
            <Input label={t('field_atc_code')} value={draft.atc_code} onChange={(v) => setDraft({ ...draft, atc_code: v })} />
            <Input label={t('field_boxed_warning')} value={draft.boxed_warning} onChange={(v) => setDraft({ ...draft, boxed_warning: v })} wide />
            <Input label={t('field_indications_csv')} value={draft.indications} onChange={(v) => setDraft({ ...draft, indications: v })} wide />
            <Input label={t('field_contraindications_csv')} value={draft.contraindications} onChange={(v) => setDraft({ ...draft, contraindications: v })} wide />
            <Input label={t('field_side_effects_csv')} value={draft.side_effects} onChange={(v) => setDraft({ ...draft, side_effects: v })} wide />
            <div className="col-span-2 flex justify-end gap-2 pt-2 border-t border-neutral-800">
                <button
                    onClick={onCancel}
                    disabled={saving}
                    className="rohy-subtle-button flex items-center gap-1 px-3 py-1.5 text-xs rounded"
                >
                    <X className="w-3.5 h-3.5" /> {t('cancel')}
                </button>
                <button
                    onClick={() => onSave({
                        ...draft,
                        indications: csvToArray(draft.indications),
                        contraindications: csvToArray(draft.contraindications),
                        side_effects: csvToArray(draft.side_effects),
                    })}
                    disabled={saving || !draft.generic_name.trim()}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-cyan-700 hover:bg-cyan-600 text-white disabled:opacity-50 rounded font-bold"
                >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {t('save')}
                </button>
            </div>
        </div>
    );
}

function Field({ label, children, wide }) {
    return (
        <div className={wide ? 'col-span-2' : ''}>
            <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-0.5">{label}</div>
            <div className="text-neutral-200">{children}</div>
        </div>
    );
}

function Input({ label, value, onChange, wide }) {
    return (
        <div className={wide ? 'col-span-2' : ''}>
            <label className="block text-[10px] uppercase tracking-wide text-neutral-400 mb-1">{label}</label>
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="rohy-field w-full px-2 py-1.5 rounded text-xs"
            />
        </div>
    );
}

/**
 * Medication Manager Component
 * Features:
 * - View all medications with search; click a row to expand details
 * - Edit existing medications (scope-aware via /api/catalogue/medications/:id)
 * - Add new medications (legacy /master path; Session 3 will migrate)
 * - Bulk import (legacy /master path)
 * - Delete medications
 */
export default function MedicationManager() {
    const { t } = useTranslation('authoring_meds');
    const toast = useToast();
    const { user: currentUser } = useAuth();

    const [activeTab, setActiveTab] = useState('browse');
    const [medications, setMedications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedId, setExpandedId] = useState(null);
    const [editingId, setEditingId] = useState(null);
    const [savingId, setSavingId] = useState(null);

    const [newMed, setNewMed] = useState({
        generic_name: '',
        drug_class: '',
        category: 'General',
        route: 'oral',
        typical_dose: '',
        indications: '',
        side_effects: ''
    });

    const [importData, setImportData] = useState('');

    const fetchMedications = async () => {
        setLoading(true);
        try {
            const data = await apiFetch('/master/medications');
            setMedications(data.medications || []);
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('toast_load_failed'));
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (rankOf(currentUser) >= ROLE_RANKS.admin) {
            fetchMedications();
        } else {
            setLoading(false);
        }
    }, [currentUser]);

    const filteredMedications = useMemo(() => {
        if (!searchQuery) return medications;
        const query = searchQuery.toLowerCase();
        return medications.filter(m =>
            m.generic_name?.toLowerCase().includes(query) ||
            m.drug_class?.toLowerCase().includes(query) ||
            m.rxcui?.toLowerCase().includes(query)
        );
    }, [medications, searchQuery]);

    const toggleRow = (id) => {
        if (editingId === id) return; // don't collapse mid-edit
        setExpandedId((prev) => (prev === id ? null : id));
    };

    const handleEditClick = (id) => {
        setEditingId(id);
        setExpandedId(id);
    };

    const handleCancelEdit = () => {
        setEditingId(null);
    };

    const handleSaveEdit = async (id, draft) => {
        setSavingId(id);
        try {
            // Use the new scope-aware endpoint — it supports PUT, the legacy
            // /master path does not. Server enforces the same canMutate rule
            // the UI gates the Edit button by, so 403s here would only fire
            // for race conditions (someone else changed scope).
            await apiPut(`/catalogue/medications/${id}`, draft);
            toast.success(t('toast_updated'));
            setEditingId(null);
            await fetchMedications();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : err.message || t('toast_save_failed'));
        } finally {
            setSavingId(null);
        }
    };

    const handleAddMed = async () => {
        if (!newMed.generic_name) {
            toast.error(t('toast_name_required'));
            return;
        }

        try {
            const medData = {
                ...newMed,
                indications: csvToArray(newMed.indications),
                side_effects: csvToArray(newMed.side_effects),
            };

            await apiPost('/master/medications', medData);

            toast.success(t('toast_added'));
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
            toast.error(err instanceof ApiError ? err.message : err.message || t('toast_add_failed'));
        }
    };

    const handleDeleteMed = async (id, name) => {
        if (!confirm(t('confirm_delete', { name }))) return;

        try {
            await apiDelete(`/master/medications/${id}`);

            toast.success(t('toast_deleted'));
            if (expandedId === id) setExpandedId(null);
            if (editingId === id) setEditingId(null);
            fetchMedications();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : err.message || t('toast_delete_failed'));
        }
    };

    const handleClearAll = async () => {
        if (!confirm(t('confirm_clear_all'))) return;

        try {
            await apiDelete('/master/medications/all');

            toast.success(t('toast_all_deleted'));
            fetchMedications();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : err.message || t('toast_delete_failed'));
        }
    };

    const handleBulkImport = async () => {
        if (!importData.trim()) {
            toast.error(t('toast_enter_names'));
            return;
        }

        const names = importData.split('\n').map(n => n.trim()).filter(n => n);
        if (names.length === 0) {
            toast.error(t('toast_no_valid_names'));
            return;
        }

        try {
            const data = await apiPost('/master/medications/bulk', {
                medications: names.map(name => ({ name }))
            });

            toast.success(t('toast_imported', { inserted: data.inserted, skipped: data.skipped }));
            setImportData('');
            fetchMedications();
            setActiveTab('browse');
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : err.message || t('toast_import_failed'));
        }
    };

    const handleExport = () => {
        const csv = [
            'Name,Class,Category,Route,Dose,RxCUI,Scope',
            ...medications.map(m =>
                `"${m.generic_name}","${m.drug_class || ''}","${m.category || ''}","${m.route || ''}","${m.typical_dose || ''}","${m.rxcui || ''}","${m.scope || ''}"`
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

    if (rankOf(currentUser) < ROLE_RANKS.admin) {
        return (
            <div className="rohy-card rounded-lg p-6 text-sm rohy-table-muted">
                {t('admin_required')}
            </div>
        );
    }

    return (
        <div className="space-y-4 rohy-admin-light">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Pill className="w-5 h-5 text-teal-700" />
                    <h3 className="text-lg font-bold">{t('title')}</h3>
                    <span className="rohy-count-pill">
                        {t('count_medications', { count: medications.length })}
                    </span>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={fetchMedications}
                        className="rohy-subtle-button p-2 rounded"
                        title={t('refresh')}
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                        onClick={handleExport}
                        className="rohy-subtle-button flex items-center gap-1 px-3 py-1.5 rounded text-sm"
                    >
                        <Download className="w-4 h-4" />
                        {t('export')}
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b border-neutral-700 pb-2">
                <button
                    onClick={() => setActiveTab('browse')}
                    className={`px-4 py-2 text-sm font-medium rounded-t ${activeTab === 'browse' ? 'rohy-admin-tab-active' : 'rohy-admin-tab'}`}
                >
                    <Database className="w-4 h-4 inline mr-2" />
                    {t('tab_browse')}
                </button>
                <button
                    onClick={() => setActiveTab('add')}
                    className={`px-4 py-2 text-sm font-medium rounded-t ${activeTab === 'add' ? 'rohy-admin-tab-active' : 'rohy-admin-tab'}`}
                >
                    <Plus className="w-4 h-4 inline mr-2" />
                    {t('tab_add')}
                </button>
                <button
                    onClick={() => setActiveTab('import')}
                    className={`px-4 py-2 text-sm font-medium rounded-t ${activeTab === 'import' ? 'rohy-admin-tab-active' : 'rohy-admin-tab'}`}
                >
                    <Upload className="w-4 h-4 inline mr-2" />
                    {t('tab_bulk_import')}
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
                            placeholder={t('search_placeholder')}
                            className="rohy-field w-full pl-10 pr-4 py-2 rounded-lg text-sm"
                        />
                    </div>

                    {/* Medications List */}
                    <div className="rohy-table-shell max-h-[600px] overflow-y-auto rounded-lg">
                        <table className="w-full text-sm">
                            <thead className="rohy-table-head sticky top-0 z-10">
                                <tr>
                                    <th className="w-8"></th>
                                    <th className="px-4 py-3 text-left font-bold">{t('col_name')}</th>
                                    <th className="px-4 py-3 text-left font-bold">{t('col_class')}</th>
                                    <th className="px-4 py-3 text-left font-bold">{t('col_route')}</th>
                                    <th className="px-4 py-3 text-left font-bold">{t('col_scope')}</th>
                                    <th className="px-4 py-3 text-right font-bold w-20">{t('col_actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredMedications.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="text-center py-8 text-neutral-500">
                                            {searchQuery ? t('empty_no_match') : t('empty_no_medications')}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredMedications.map((med) => {
                                        const isOpen = expandedId === med.id;
                                        const isEditing = editingId === med.id;
                                        return (
                                            <React.Fragment key={med.id}>
                                                <tr
                                                    className="rohy-table-row cursor-pointer"
                                                    onClick={() => toggleRow(med.id)}
                                                >
                                                    <td className="rohy-table-cell px-2 py-2 rohy-table-muted">
                                                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                                    </td>
                                                    <td className="rohy-table-cell px-4 py-2 font-medium">{med.generic_name}</td>
                                                    <td className="rohy-table-cell px-4 py-2 rohy-table-muted">{med.drug_class || '-'}</td>
                                                    <td className="rohy-table-cell px-4 py-2 rohy-table-muted uppercase text-xs">{med.route || '-'}</td>
                                                    <td className="rohy-table-cell px-4 py-2"><ScopeBadge scope={med.scope} isCurated={med.is_curated} /></td>
                                                    <td className="rohy-table-cell px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                                                        <button
                                                            onClick={() => handleDeleteMed(med.id, med.generic_name)}
                                                            className="rohy-danger-icon-button p-1 rounded"
                                                            title={t('delete')}
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </td>
                                                </tr>
                                                {isOpen && (
                                                    <tr>
                                                        <td colSpan="6" className="p-0">
                                                            <MedDetail
                                                                med={med}
                                                                currentUser={currentUser}
                                                                isEditing={isEditing}
                                                                saving={savingId === med.id}
                                                                onEdit={() => handleEditClick(med.id)}
                                                                onCancel={handleCancelEdit}
                                                                onSave={(draft) => handleSaveEdit(med.id, draft)}
                                                            />
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Clear All Button */}
                    {medications.length > 0 && (
                        <div className="flex justify-end">
                            <button
                                onClick={handleClearAll}
                                className="rohy-danger-button flex items-center gap-2 px-3 py-1.5 rounded text-sm"
                            >
                                <Trash2 className="w-4 h-4" />
                                {t('clear_all')}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Add Tab */}
            {activeTab === 'add' && (
                <div className="rohy-card space-y-4 rounded-lg p-4">
                    <h4 className="font-bold text-sm">{t('add_new_title')}</h4>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-neutral-400 mb-1">{t('label_name_required')}</label>
                            <input
                                type="text"
                                value={newMed.generic_name}
                                onChange={(e) => setNewMed({ ...newMed, generic_name: e.target.value })}
                                className="rohy-field w-full px-3 py-2 rounded text-sm"
                                placeholder={t('placeholder_name')}
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-neutral-400 mb-1">{t('field_drug_class')}</label>
                            <input
                                type="text"
                                value={newMed.drug_class}
                                onChange={(e) => setNewMed({ ...newMed, drug_class: e.target.value })}
                                className="rohy-field w-full px-3 py-2 rounded text-sm"
                                placeholder={t('placeholder_drug_class')}
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-neutral-400 mb-1">{t('field_route')}</label>
                            <select
                                value={newMed.route}
                                onChange={(e) => setNewMed({ ...newMed, route: e.target.value })}
                                className="rohy-field w-full px-3 py-2 rounded text-sm"
                            >
                                {ROUTE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-neutral-400 mb-1">{t('field_typical_dose')}</label>
                            <input
                                type="text"
                                value={newMed.typical_dose}
                                onChange={(e) => setNewMed({ ...newMed, typical_dose: e.target.value })}
                                className="rohy-field w-full px-3 py-2 rounded text-sm"
                                placeholder={t('placeholder_typical_dose')}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs text-neutral-400 mb-1">{t('field_indications_csv')}</label>
                        <input
                            type="text"
                            value={newMed.indications}
                            onChange={(e) => setNewMed({ ...newMed, indications: e.target.value })}
                            className="rohy-field w-full px-3 py-2 rounded text-sm"
                            placeholder={t('placeholder_indications')}
                        />
                    </div>

                    <div>
                        <label className="block text-xs text-neutral-400 mb-1">{t('field_side_effects_csv')}</label>
                        <input
                            type="text"
                            value={newMed.side_effects}
                            onChange={(e) => setNewMed({ ...newMed, side_effects: e.target.value })}
                            className="rohy-field w-full px-3 py-2 rounded text-sm"
                            placeholder={t('placeholder_side_effects')}
                        />
                    </div>

                    <button
                        onClick={handleAddMed}
                        className="flex items-center gap-2 px-4 py-2 bg-cyan-700 hover:bg-cyan-600 text-white rounded text-sm font-bold"
                    >
                        <Plus className="w-4 h-4" />
                        {t('add_medication')}
                    </button>
                </div>
            )}

            {/* Import Tab */}
            {activeTab === 'import' && (
                <div className="rohy-card space-y-4 rounded-lg p-4">
                    <h4 className="font-bold text-sm">{t('bulk_import_title')}</h4>
                    <p className="text-xs text-neutral-400">{t('bulk_import_help')}</p>

                    <textarea
                        value={importData}
                        onChange={(e) => setImportData(e.target.value)}
                        rows={10}
                        className="rohy-field w-full px-3 py-2 rounded text-sm font-mono"
                        placeholder="Aspirin&#10;Ibuprofen&#10;Metformin&#10;..."
                    />

                    <div className="flex justify-between items-center">
                        <span className="text-xs text-neutral-500">
                            {t('import_count', { count: importData.split('\n').filter(n => n.trim()).length })}
                        </span>
                        <button
                            onClick={handleBulkImport}
                            disabled={!importData.trim()}
                            className="flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-600 text-white disabled:opacity-50 rounded text-sm font-bold"
                        >
                            <Upload className="w-4 h-4" />
                            {t('import')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
