import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, FileText, Stethoscope, Pill, Syringe, ClipboardList, Brain, Eye, EyeOff, ChevronDown, ChevronRight } from 'lucide-react';
import MedicationSearch from './MedicationSearch';
import { HISTORY_GROUPS as CANONICAL_HISTORY_GROUPS } from '../../data/historyGroups';

const RECORD_TABS = [
    { id: 'history', labelKey: 'tab_history', icon: FileText },
    { id: 'physical', labelKey: 'tab_physical', icon: Stethoscope },
    { id: 'medications', labelKey: 'tab_medications', icon: Pill },
    { id: 'procedures', labelKey: 'tab_procedures', icon: Syringe },
    { id: 'notes', labelKey: 'tab_notes', icon: ClipboardList }
];


// Note: `labs` was removed in 2026-05 — there is no `clinicalRecords.labs`
// data field, so the flag was dead UI. Lab results during a session live in
// the lab_results table and are exposed through a different surface.
const DEFAULT_AI_ACCESS = {
    history: true,
    physicalExam: true,
    medications: true,
    radiology: false,
    procedures: true,
    notes: false
};

// Editor-specific UI metadata layered on top of the canonical groups
// (label/key/order are owned by src/data/historyGroups.js — same source the
// student viewer and AI prompt builder use). Default all groups expanded:
// it's an editor, hiding fields slows authoring.
const EDITOR_FIELD_META = {
    chiefComplaint: { type: 'input',    labelKey: 'field_chief_complaint',  placeholderKey: 'field_chief_complaint_ph' },
    hpi:            { type: 'textarea', labelKey: 'field_hpi',              rows: 4, placeholderKey: 'field_hpi_ph' },
    pastMedical:    { type: 'textarea', labelKey: 'field_past_medical',     rows: 3, placeholderKey: 'field_past_medical_ph' },
    pastSurgical:   { type: 'textarea', labelKey: 'field_past_surgical',    rows: 3, placeholderKey: 'field_past_surgical_ph' },
    allergies:      { type: 'input',    labelKey: 'field_allergies',        placeholderKey: 'field_allergies_ph' },
    social:         { type: 'textarea', labelKey: 'field_social',           rows: 3, placeholderKey: 'field_social_ph' },
    family:         { type: 'textarea', labelKey: 'field_family',           rows: 3, placeholderKey: 'field_family_ph' },
};

const HISTORY_GROUPS = CANONICAL_HISTORY_GROUPS.map(group => ({
    ...group,
    fields: group.fields.map(f => ({ ...f, ...EDITOR_FIELD_META[f.key] })),
}));

export default function ClinicalRecordsEditor({ caseData, _setCaseData, updateConfig }) {
    const { t } = useTranslation('authoring_records');
    const [activeTab, setActiveTab] = useState('history');
    const [openHistoryGroups, setOpenHistoryGroups] = useState({
        presentHistory: true,
        pastMedical: true,
        personalSocial: true,
    });
    const toggleHistoryGroup = (key) => {
        setOpenHistoryGroups(prev => ({ ...prev, [key]: !prev[key] }));
    };

    // Helper to get/set clinical records
    const records = caseData.config?.clinicalRecords || {};
    const updateRecords = (key, value) => {
        updateConfig('clinicalRecords', {
            ...records,
            [key]: value
        });
    };

    // AI Access settings
    const aiAccess = records.aiAccess || DEFAULT_AI_ACCESS;
    const updateAiAccess = (key, value) => {
        updateRecords('aiAccess', { ...aiAccess, [key]: value });
    };

    // History helpers
    const history = records.history || {};
    const updateHistory = (key, value) => {
        updateRecords('history', { ...history, [key]: value });
    };

    // Physical Exam helpers
    const physicalExam = records.physicalExam || {};
    const updatePhysicalExam = (key, value) => {
        updateRecords('physicalExam', { ...physicalExam, [key]: value });
    };

    // Medications helpers
    const medications = records.medications || [];
    const addMedication = () => {
        updateRecords('medications', [...medications, { name: '', dose: '', route: 'PO', frequency: '' }]);
    };
    const updateMedication = (idx, field, value) => {
        const updated = [...medications];
        updated[idx] = { ...updated[idx], [field]: value };
        updateRecords('medications', updated);
    };
    // Stage-6 audit: confirm before deleting medication entries (Stage-2
    // pattern — destructive actions get a confirmation). Skip if the row is
    // empty so brand-new "Add Medication" rows can be removed without
    // friction.
    const removeMedication = (idx) => {
        const m = medications[idx];
        const filled = m && (m.name || m.dose || m.route || m.frequency || m.indication);
        if (filled && !window.confirm(t('confirm_delete_medication', { name: m.name || t('unnamed') }))) return;
        updateRecords('medications', medications.filter((_, i) => i !== idx));
    };
    // Handle medication selection from search
    const handleMedicationSelect = (idx, medication) => {
        const updated = [...medications];
        updated[idx] = {
            ...updated[idx],
            name: medication.generic_name,
            route: medication.route || updated[idx].route || 'PO',
            dose: medication.typical_dose || updated[idx].dose || ''
        };
        updateRecords('medications', updated);
    };

    // Procedures helpers
    const procedures = records.procedures || [];
    const addProcedure = () => {
        updateRecords('procedures', [...procedures, {
            id: Date.now(),
            name: '',
            date: '',
            indication: '',
            findings: '',
            complications: ''
        }]);
    };
    const updateProcedure = (idx, field, value) => {
        const updated = [...procedures];
        updated[idx] = { ...updated[idx], [field]: value };
        updateRecords('procedures', updated);
    };
    const removeProcedure = (idx) => {
        const p = procedures[idx];
        const filled = p && (p.name || p.date || p.indication || p.findings || p.complications);
        if (filled && !window.confirm(t('confirm_delete_procedure', { name: p.name || t('unnamed') }))) return;
        updateRecords('procedures', procedures.filter((_, i) => i !== idx));
    };

    // Notes helpers
    const notes = records.notes || [];
    const addNote = () => {
        updateRecords('notes', [...notes, {
            id: Date.now(),
            type: 'Progress Note',
            title: '',
            date: new Date().toISOString().split('T')[0],
            author: '',
            content: ''
        }]);
    };
    const updateNote = (idx, field, value) => {
        const updated = [...notes];
        updated[idx] = { ...updated[idx], [field]: value };
        updateRecords('notes', updated);
    };
    const removeNote = (idx) => {
        const n = notes[idx];
        const filled = n && (n.title || n.author || n.content);
        if (filled && !window.confirm(t('confirm_delete_note', { title: n.title || t('untitled') }))) return;
        updateRecords('notes', notes.filter((_, i) => i !== idx));
    };

    return (
        <div className="space-y-6">
            <h4 className="text-lg font-bold text-purple-400">{t('heading')}</h4>

            {/* AI Access Configuration */}
            <div className="bg-gradient-to-r from-purple-900/30 to-blue-900/30 border border-purple-700/50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                    <Brain className="w-5 h-5 text-purple-400" />
                    <h5 className="text-sm font-bold text-white">{t('ai_access_title')}</h5>
                </div>
                <p className="text-xs text-neutral-400 mb-3">
                    {t('ai_access_help')}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                        { key: 'history', label: t('ai_access_history') },
                        { key: 'physicalExam', label: t('ai_access_physical_exam') },
                        { key: 'medications', label: t('ai_access_medications') },
                        { key: 'radiology', label: t('ai_access_radiology') },
                        { key: 'procedures', label: t('ai_access_procedures') },
                        { key: 'notes', label: t('ai_access_notes') }
                    ].map(item => (
                        <label key={item.key} className="flex items-center gap-2 cursor-pointer bg-neutral-800/50 rounded px-3 py-2 hover:bg-neutral-800 transition-colors">
                            <input
                                type="checkbox"
                                checked={aiAccess[item.key] ?? DEFAULT_AI_ACCESS[item.key]}
                                onChange={e => updateAiAccess(item.key, e.target.checked)}
                                className="w-4 h-4 rounded bg-neutral-700 border-neutral-600 text-purple-500"
                            />
                            <span className="text-xs text-neutral-300">{item.label}</span>
                            {aiAccess[item.key] ? (
                                <Eye className="w-3 h-3 text-green-400 ml-auto" title={t('ai_can_see')} />
                            ) : (
                                <EyeOff className="w-3 h-3 text-neutral-500 ml-auto" title={t('hidden_from_ai')} />
                            )}
                        </label>
                    ))}
                </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex gap-1 border-b border-neutral-700 overflow-x-auto pb-1">
                {RECORD_TABS.map(tab => {
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`px-4 py-2 text-xs font-bold rounded-t-lg flex items-center gap-2 whitespace-nowrap transition-colors ${
                                activeTab === tab.id
                                    ? 'bg-neutral-800 text-white border-t border-x border-neutral-600'
                                    : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50'
                            }`}
                        >
                            <Icon className="w-4 h-4" />
                            {t(tab.labelKey)}
                        </button>
                    );
                })}
            </div>

            {/* Tab Content */}
            <div className="bg-neutral-800/50 rounded-lg p-4 border border-neutral-700">

                {/* HISTORY TAB */}
                {activeTab === 'history' && (
                    <div className="space-y-3">
                        {HISTORY_GROUPS.map(group => {
                            const isOpen = openHistoryGroups[group.key];
                            const filled = group.fields.filter(f => (history[f.key] || '').trim()).length;
                            return (
                                <div key={group.key} className="border border-neutral-700 rounded-lg overflow-hidden">
                                    <button
                                        type="button"
                                        onClick={() => toggleHistoryGroup(group.key)}
                                        className="w-full flex items-center justify-between px-3 py-2 bg-neutral-800 hover:bg-neutral-700/70 text-left transition-colors"
                                        aria-expanded={isOpen}
                                        aria-controls={`history-group-${group.key}`}
                                    >
                                        <div className="flex items-center gap-2">
                                            {isOpen
                                                ? <ChevronDown className="w-4 h-4 text-neutral-400" />
                                                : <ChevronRight className="w-4 h-4 text-neutral-400" />
                                            }
                                            <span className="text-xs font-bold text-neutral-100 uppercase tracking-wide">
                                                {group.label}
                                            </span>
                                        </div>
                                        <span className="text-[10px] text-neutral-500 font-mono">
                                            {t('group_filled_count', { filled, total: group.fields.length })}
                                        </span>
                                    </button>
                                    {isOpen && (
                                        <div id={`history-group-${group.key}`} className="p-3 space-y-3 bg-neutral-900/40">
                                            {group.fields.map(field => (
                                                <div key={field.key}>
                                                    <label className="label-xs flex items-center gap-1.5">
                                                        {t(field.labelKey)}
                                                        {(history[field.key] || '').trim() && (
                                                            <span className="text-green-400 text-[10px]" title={t('has_content')}>●</span>
                                                        )}
                                                    </label>
                                                    {field.type === 'textarea' ? (
                                                        <textarea
                                                            rows={field.rows || 3}
                                                            value={history[field.key] || ''}
                                                            onChange={e => updateHistory(field.key, e.target.value)}
                                                            className="input-dark text-sm"
                                                            placeholder={t(field.placeholderKey)}
                                                        />
                                                    ) : (
                                                        <input
                                                            type="text"
                                                            value={history[field.key] || ''}
                                                            onChange={e => updateHistory(field.key, e.target.value)}
                                                            className="input-dark"
                                                            placeholder={t(field.placeholderKey)}
                                                        />
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* PHYSICAL EXAM TAB */}
                {activeTab === 'physical' && (
                    <div className="space-y-4">
                        <div>
                            <label className="label-xs">{t('pe_general')}</label>
                            <input
                                type="text"
                                value={physicalExam.general || ''}
                                onChange={e => updatePhysicalExam('general', e.target.value)}
                                className="input-dark"
                                placeholder={t('pe_general_ph')}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="label-xs">HEENT</label>
                                <textarea
                                    rows={2}
                                    value={physicalExam.heent || ''}
                                    onChange={e => updatePhysicalExam('heent', e.target.value)}
                                    className="input-dark text-sm"
                                    placeholder={t('pe_heent_ph')}
                                />
                            </div>
                            <div>
                                <label className="label-xs">{t('pe_cardiovascular')}</label>
                                <textarea
                                    rows={2}
                                    value={physicalExam.cardiovascular || ''}
                                    onChange={e => updatePhysicalExam('cardiovascular', e.target.value)}
                                    className="input-dark text-sm"
                                    placeholder={t('pe_cardiovascular_ph')}
                                />
                            </div>
                            <div>
                                <label className="label-xs">{t('pe_respiratory')}</label>
                                <textarea
                                    rows={2}
                                    value={physicalExam.respiratory || ''}
                                    onChange={e => updatePhysicalExam('respiratory', e.target.value)}
                                    className="input-dark text-sm"
                                    placeholder={t('pe_respiratory_ph')}
                                />
                            </div>
                            <div>
                                <label className="label-xs">{t('pe_abdomen')}</label>
                                <textarea
                                    rows={2}
                                    value={physicalExam.abdomen || ''}
                                    onChange={e => updatePhysicalExam('abdomen', e.target.value)}
                                    className="input-dark text-sm"
                                    placeholder={t('pe_abdomen_ph')}
                                />
                            </div>
                            <div>
                                <label className="label-xs">{t('pe_neurological')}</label>
                                <textarea
                                    rows={2}
                                    value={physicalExam.neurological || ''}
                                    onChange={e => updatePhysicalExam('neurological', e.target.value)}
                                    className="input-dark text-sm"
                                    placeholder={t('pe_neurological_ph')}
                                />
                            </div>
                            <div>
                                <label className="label-xs">{t('pe_extremities')}</label>
                                <textarea
                                    rows={2}
                                    value={physicalExam.extremities || ''}
                                    onChange={e => updatePhysicalExam('extremities', e.target.value)}
                                    className="input-dark text-sm"
                                    placeholder={t('pe_extremities_ph')}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* MEDICATIONS TAB */}
                {activeTab === 'medications' && (
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <p className="text-xs text-neutral-400">{t('medications_subtitle')}</p>
                            <button onClick={addMedication} className="btn-secondary text-xs">
                                <Plus className="w-3 h-3 mr-1" /> {t('add_medication')}
                            </button>
                        </div>
                        {medications.length === 0 ? (
                            <div className="text-center py-8 text-neutral-500 border border-dashed border-neutral-700 rounded-lg">
                                {t('no_medications')}
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {medications.map((med, idx) => (
                                    <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-neutral-900/50 p-2 rounded">
                                        <div className="col-span-4">
                                            <MedicationSearch
                                                value={med.name}
                                                onChange={(name) => updateMedication(idx, 'name', name)}
                                                onSelect={(medication) => handleMedicationSelect(idx, medication)}
                                                placeholder={t('search_drug_placeholder')}
                                            />
                                        </div>
                                        <input
                                            type="text"
                                            value={med.dose}
                                            onChange={e => updateMedication(idx, 'dose', e.target.value)}
                                            className="input-dark text-xs col-span-2"
                                            placeholder={t('dose_placeholder')}
                                        />
                                        <select
                                            value={med.route}
                                            onChange={e => updateMedication(idx, 'route', e.target.value)}
                                            className="input-dark text-xs col-span-2"
                                        >
                                            <option>PO</option>
                                            <option>IV</option>
                                            <option>IM</option>
                                            <option>SC</option>
                                            <option>SL</option>
                                            <option>PR</option>
                                            <option>Topical</option>
                                            <option>Inhaled</option>
                                        </select>
                                        <input
                                            type="text"
                                            value={med.frequency}
                                            onChange={e => updateMedication(idx, 'frequency', e.target.value)}
                                            className="input-dark text-xs col-span-3"
                                            placeholder={t('frequency_placeholder')}
                                        />
                                        <button onClick={() => removeMedication(idx)} className="text-neutral-500 hover:text-red-400 col-span-1">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* PROCEDURES TAB */}
                {activeTab === 'procedures' && (
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <p className="text-xs text-neutral-400">{t('procedures_subtitle')}</p>
                            <button onClick={addProcedure} className="btn-secondary text-xs">
                                <Plus className="w-3 h-3 mr-1" /> {t('add_procedure')}
                            </button>
                        </div>
                        {procedures.length === 0 ? (
                            <div className="text-center py-8 text-neutral-500 border border-dashed border-neutral-700 rounded-lg">
                                {t('no_procedures')}
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {procedures.map((proc, idx) => (
                                    <div key={proc.id} className="bg-neutral-900/50 p-3 rounded-lg border border-neutral-700">
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex gap-2 flex-1">
                                                <input
                                                    type="text"
                                                    value={proc.name}
                                                    onChange={e => updateProcedure(idx, 'name', e.target.value)}
                                                    className="input-dark text-xs flex-1"
                                                    placeholder={t('procedure_name_placeholder')}
                                                />
                                                <input
                                                    type="date"
                                                    value={proc.date}
                                                    onChange={e => updateProcedure(idx, 'date', e.target.value)}
                                                    className="input-dark text-xs w-36"
                                                />
                                            </div>
                                            <button onClick={() => removeProcedure(idx)} className="text-neutral-500 hover:text-red-400 ml-2">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2">
                                            <input
                                                type="text"
                                                value={proc.indication}
                                                onChange={e => updateProcedure(idx, 'indication', e.target.value)}
                                                className="input-dark text-xs"
                                                placeholder={t('indication_placeholder')}
                                            />
                                            <input
                                                type="text"
                                                value={proc.findings}
                                                onChange={e => updateProcedure(idx, 'findings', e.target.value)}
                                                className="input-dark text-xs"
                                                placeholder={t('findings_placeholder')}
                                            />
                                            <input
                                                type="text"
                                                value={proc.complications}
                                                onChange={e => updateProcedure(idx, 'complications', e.target.value)}
                                                className="input-dark text-xs"
                                                placeholder={t('complications_placeholder')}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* NOTES TAB */}
                {activeTab === 'notes' && (
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <p className="text-xs text-neutral-400">{t('notes_subtitle')}</p>
                            <button onClick={addNote} className="btn-secondary text-xs">
                                <Plus className="w-3 h-3 mr-1" /> {t('add_note')}
                            </button>
                        </div>
                        {notes.length === 0 ? (
                            <div className="text-center py-8 text-neutral-500 border border-dashed border-neutral-700 rounded-lg">
                                {t('no_notes')}
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {notes.map((note, idx) => (
                                    <div key={note.id} className="bg-neutral-900/50 p-3 rounded-lg border border-neutral-700">
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex gap-2 flex-1">
                                                <select
                                                    value={note.type}
                                                    onChange={e => updateNote(idx, 'type', e.target.value)}
                                                    className="input-dark text-xs"
                                                >
                                                    <option>Admission Note</option>
                                                    <option>Progress Note</option>
                                                    <option>Consult Note</option>
                                                    <option>Discharge Summary</option>
                                                    <option>Procedure Note</option>
                                                    <option>Nursing Note</option>
                                                    <option>Other</option>
                                                </select>
                                                <input
                                                    type="text"
                                                    value={note.title}
                                                    onChange={e => updateNote(idx, 'title', e.target.value)}
                                                    className="input-dark text-xs flex-1"
                                                    placeholder={t('note_title_placeholder')}
                                                />
                                                <input
                                                    type="date"
                                                    value={note.date}
                                                    onChange={e => updateNote(idx, 'date', e.target.value)}
                                                    className="input-dark text-xs"
                                                />
                                                <input
                                                    type="text"
                                                    value={note.author}
                                                    onChange={e => updateNote(idx, 'author', e.target.value)}
                                                    className="input-dark text-xs w-32"
                                                    placeholder={t('author_placeholder')}
                                                />
                                            </div>
                                            <button onClick={() => removeNote(idx)} className="text-neutral-500 hover:text-red-400 ml-2">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                        <textarea
                                            rows={4}
                                            value={note.content}
                                            onChange={e => updateNote(idx, 'content', e.target.value)}
                                            className="input-dark text-xs w-full"
                                            placeholder={t('note_content_placeholder')}
                                        />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
