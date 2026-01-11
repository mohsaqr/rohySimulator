import React, { useState } from 'react';
import { Plus, Trash2, Upload, FileText, Stethoscope, Pill, Syringe, ClipboardList, Image, Brain, Eye, EyeOff } from 'lucide-react';
import { AuthService } from '../../services/authService';
import MedicationSearch from './MedicationSearch';

const RECORD_TABS = [
    { id: 'history', label: 'History', icon: FileText },
    { id: 'physical', label: 'Past Physical Exam', icon: Stethoscope },
    { id: 'medications', label: 'Medications', icon: Pill },
    { id: 'radiology', label: 'Radiology', icon: Image },
    { id: 'procedures', label: 'Procedures', icon: Syringe },
    { id: 'notes', label: 'Notes', icon: ClipboardList }
];

const RADIOLOGY_TYPES = [
    'Chest X-Ray', 'Abdominal X-Ray', 'CT Head', 'CT Chest', 'CT Abdomen/Pelvis',
    'MRI Brain', 'MRI Spine', 'Ultrasound Abdomen', 'Echocardiogram', 'ECG/EKG',
    'Angiogram', 'PET Scan', 'Bone Scan', 'Mammogram', 'Other'
];

const DEFAULT_AI_ACCESS = {
    history: true,
    physicalExam: true,
    medications: true,
    labs: false,
    radiology: false,
    procedures: true,
    notes: false
};

export default function ClinicalRecordsEditor({ caseData, setCaseData, updateConfig }) {
    const [activeTab, setActiveTab] = useState('history');
    const [uploading, setUploading] = useState(false);

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
    const removeMedication = (idx) => {
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

    // Radiology helpers
    const radiology = records.radiology || [];
    const addRadiology = () => {
        updateRecords('radiology', [...radiology, {
            id: Date.now(),
            type: 'Chest X-Ray',
            name: '',
            date: new Date().toISOString().split('T')[0],
            imageUrl: '',
            findings: '',
            interpretation: ''
        }]);
    };
    const updateRadiology = (idx, field, value) => {
        const updated = [...radiology];
        updated[idx] = { ...updated[idx], [field]: value };
        updateRecords('radiology', updated);
    };
    const removeRadiology = (idx) => {
        updateRecords('radiology', radiology.filter((_, i) => i !== idx));
    };

    // Image upload handler
    const handleImageUpload = async (idx, file) => {
        if (!file) return;
        setUploading(true);
        try {
            const formData = new FormData();
            formData.append('photo', file);
            const token = AuthService.getToken();
            const res = await fetch('/api/upload', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            const data = await res.json();
            if (data.imageUrl) {
                updateRadiology(idx, 'imageUrl', data.imageUrl);
            }
        } catch (err) {
            console.error('Upload failed:', err);
        } finally {
            setUploading(false);
        }
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
        updateRecords('notes', notes.filter((_, i) => i !== idx));
    };

    return (
        <div className="space-y-6">
            <h4 className="text-lg font-bold text-purple-400">6. Clinical Records</h4>

            {/* AI Access Configuration */}
            <div className="bg-gradient-to-r from-purple-900/30 to-blue-900/30 border border-purple-700/50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                    <Brain className="w-5 h-5 text-purple-400" />
                    <h5 className="text-sm font-bold text-white">AI Access Settings</h5>
                </div>
                <p className="text-xs text-neutral-400 mb-3">
                    Control what information the AI patient can discuss. Unchecked items are only viewable in the Records panel.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                        { key: 'history', label: 'History & HPI' },
                        { key: 'physicalExam', label: 'Physical Exam' },
                        { key: 'medications', label: 'Medications' },
                        { key: 'labs', label: 'Lab Results' },
                        { key: 'radiology', label: 'Radiology' },
                        { key: 'procedures', label: 'Procedures' },
                        { key: 'notes', label: 'Clinical Notes' }
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
                                <Eye className="w-3 h-3 text-green-400 ml-auto" title="AI can see" />
                            ) : (
                                <EyeOff className="w-3 h-3 text-neutral-500 ml-auto" title="Hidden from AI" />
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
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Tab Content */}
            <div className="bg-neutral-800/50 rounded-lg p-4 border border-neutral-700">

                {/* HISTORY TAB */}
                {activeTab === 'history' && (
                    <div className="space-y-4">
                        <div>
                            <label className="label-xs">Chief Complaint</label>
                            <input
                                type="text"
                                value={history.chiefComplaint || ''}
                                onChange={e => updateHistory('chiefComplaint', e.target.value)}
                                className="input-dark"
                                placeholder="e.g., Chest pain for 2 hours"
                            />
                        </div>
                        <div>
                            <label className="label-xs">History of Present Illness (HPI)</label>
                            <textarea
                                rows={4}
                                value={history.hpi || ''}
                                onChange={e => updateHistory('hpi', e.target.value)}
                                className="input-dark text-sm"
                                placeholder="Detailed description of the presenting complaint..."
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="label-xs">Past Medical History</label>
                                <textarea
                                    rows={3}
                                    value={history.pastMedical || ''}
                                    onChange={e => updateHistory('pastMedical', e.target.value)}
                                    className="input-dark text-sm"
                                    placeholder="HTN, DM, CAD..."
                                />
                            </div>
                            <div>
                                <label className="label-xs">Past Surgical History</label>
                                <textarea
                                    rows={3}
                                    value={history.pastSurgical || ''}
                                    onChange={e => updateHistory('pastSurgical', e.target.value)}
                                    className="input-dark text-sm"
                                    placeholder="Appendectomy 2010..."
                                />
                            </div>
                        </div>
                        <div>
                            <label className="label-xs">Allergies</label>
                            <input
                                type="text"
                                value={history.allergies || ''}
                                onChange={e => updateHistory('allergies', e.target.value)}
                                className="input-dark"
                                placeholder="Penicillin (rash), NKDA..."
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="label-xs">Social History</label>
                                <textarea
                                    rows={3}
                                    value={history.social || ''}
                                    onChange={e => updateHistory('social', e.target.value)}
                                    className="input-dark text-sm"
                                    placeholder="Smoking, alcohol, occupation..."
                                />
                            </div>
                            <div>
                                <label className="label-xs">Family History</label>
                                <textarea
                                    rows={3}
                                    value={history.family || ''}
                                    onChange={e => updateHistory('family', e.target.value)}
                                    className="input-dark text-sm"
                                    placeholder="Father MI at 55, Mother DM..."
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* PHYSICAL EXAM TAB */}
                {activeTab === 'physical' && (
                    <div className="space-y-4">
                        <div>
                            <label className="label-xs">General Appearance</label>
                            <input
                                type="text"
                                value={physicalExam.general || ''}
                                onChange={e => updatePhysicalExam('general', e.target.value)}
                                className="input-dark"
                                placeholder="Alert, oriented, in mild distress..."
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
                                    placeholder="PERRL, EOMI, no JVD..."
                                />
                            </div>
                            <div>
                                <label className="label-xs">Cardiovascular</label>
                                <textarea
                                    rows={2}
                                    value={physicalExam.cardiovascular || ''}
                                    onChange={e => updatePhysicalExam('cardiovascular', e.target.value)}
                                    className="input-dark text-sm"
                                    placeholder="RRR, no murmurs..."
                                />
                            </div>
                            <div>
                                <label className="label-xs">Respiratory</label>
                                <textarea
                                    rows={2}
                                    value={physicalExam.respiratory || ''}
                                    onChange={e => updatePhysicalExam('respiratory', e.target.value)}
                                    className="input-dark text-sm"
                                    placeholder="Clear to auscultation bilaterally..."
                                />
                            </div>
                            <div>
                                <label className="label-xs">Abdomen</label>
                                <textarea
                                    rows={2}
                                    value={physicalExam.abdomen || ''}
                                    onChange={e => updatePhysicalExam('abdomen', e.target.value)}
                                    className="input-dark text-sm"
                                    placeholder="Soft, non-tender, no masses..."
                                />
                            </div>
                            <div>
                                <label className="label-xs">Neurological</label>
                                <textarea
                                    rows={2}
                                    value={physicalExam.neurological || ''}
                                    onChange={e => updatePhysicalExam('neurological', e.target.value)}
                                    className="input-dark text-sm"
                                    placeholder="CN II-XII intact, 5/5 strength..."
                                />
                            </div>
                            <div>
                                <label className="label-xs">Extremities/Skin</label>
                                <textarea
                                    rows={2}
                                    value={physicalExam.extremities || ''}
                                    onChange={e => updatePhysicalExam('extremities', e.target.value)}
                                    className="input-dark text-sm"
                                    placeholder="No edema, pulses 2+ bilaterally..."
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* MEDICATIONS TAB */}
                {activeTab === 'medications' && (
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <p className="text-xs text-neutral-400">Current medications list</p>
                            <button onClick={addMedication} className="btn-secondary text-xs">
                                <Plus className="w-3 h-3 mr-1" /> Add Medication
                            </button>
                        </div>
                        {medications.length === 0 ? (
                            <div className="text-center py-8 text-neutral-500 border border-dashed border-neutral-700 rounded-lg">
                                No medications added
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
                                                placeholder="Search drug name..."
                                            />
                                        </div>
                                        <input
                                            type="text"
                                            value={med.dose}
                                            onChange={e => updateMedication(idx, 'dose', e.target.value)}
                                            className="input-dark text-xs col-span-2"
                                            placeholder="Dose"
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
                                            placeholder="Frequency (e.g., BID)"
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

                {/* RADIOLOGY TAB */}
                {activeTab === 'radiology' && (
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <p className="text-xs text-neutral-400">Imaging studies with uploadable images</p>
                            <button onClick={addRadiology} className="btn-secondary text-xs">
                                <Plus className="w-3 h-3 mr-1" /> Add Study
                            </button>
                        </div>
                        {radiology.length === 0 ? (
                            <div className="text-center py-8 text-neutral-500 border border-dashed border-neutral-700 rounded-lg">
                                No radiology studies added
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {radiology.map((study, idx) => (
                                    <div key={study.id} className="bg-neutral-900/50 p-4 rounded-lg border border-neutral-700">
                                        <div className="flex justify-between items-start mb-3">
                                            <div className="flex gap-2 flex-1">
                                                <select
                                                    value={study.type}
                                                    onChange={e => updateRadiology(idx, 'type', e.target.value)}
                                                    className="input-dark text-xs"
                                                >
                                                    {RADIOLOGY_TYPES.map(t => <option key={t}>{t}</option>)}
                                                </select>
                                                <input
                                                    type="text"
                                                    value={study.name}
                                                    onChange={e => updateRadiology(idx, 'name', e.target.value)}
                                                    className="input-dark text-xs flex-1"
                                                    placeholder="Study name/description"
                                                />
                                                <input
                                                    type="date"
                                                    value={study.date}
                                                    onChange={e => updateRadiology(idx, 'date', e.target.value)}
                                                    className="input-dark text-xs"
                                                />
                                            </div>
                                            <button onClick={() => removeRadiology(idx)} className="text-neutral-500 hover:text-red-400 ml-2">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>

                                        {/* Image Upload */}
                                        <div className="mb-3">
                                            <label className="label-xs">Image</label>
                                            <div className="flex items-center gap-3">
                                                {study.imageUrl ? (
                                                    <div className="relative group">
                                                        <img
                                                            src={study.imageUrl}
                                                            alt={study.type}
                                                            className="h-24 w-auto rounded border border-neutral-600 object-cover"
                                                        />
                                                        <button
                                                            onClick={() => updateRadiology(idx, 'imageUrl', '')}
                                                            className="absolute -top-2 -right-2 bg-red-600 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                                        >
                                                            <Trash2 className="w-3 h-3 text-white" />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <label className="flex items-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded cursor-pointer border border-dashed border-neutral-600">
                                                        <Upload className="w-4 h-4 text-neutral-400" />
                                                        <span className="text-xs text-neutral-400">
                                                            {uploading ? 'Uploading...' : 'Upload Image'}
                                                        </span>
                                                        <input
                                                            type="file"
                                                            accept="image/*"
                                                            onChange={e => handleImageUpload(idx, e.target.files[0])}
                                                            className="hidden"
                                                            disabled={uploading}
                                                        />
                                                    </label>
                                                )}
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="label-xs">Findings</label>
                                                <textarea
                                                    rows={2}
                                                    value={study.findings}
                                                    onChange={e => updateRadiology(idx, 'findings', e.target.value)}
                                                    className="input-dark text-xs"
                                                    placeholder="Describe findings..."
                                                />
                                            </div>
                                            <div>
                                                <label className="label-xs">Interpretation</label>
                                                <textarea
                                                    rows={2}
                                                    value={study.interpretation}
                                                    onChange={e => updateRadiology(idx, 'interpretation', e.target.value)}
                                                    className="input-dark text-xs"
                                                    placeholder="Clinical interpretation..."
                                                />
                                            </div>
                                        </div>
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
                            <p className="text-xs text-neutral-400">Surgeries and procedures</p>
                            <button onClick={addProcedure} className="btn-secondary text-xs">
                                <Plus className="w-3 h-3 mr-1" /> Add Procedure
                            </button>
                        </div>
                        {procedures.length === 0 ? (
                            <div className="text-center py-8 text-neutral-500 border border-dashed border-neutral-700 rounded-lg">
                                No procedures added
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
                                                    placeholder="Procedure name"
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
                                                placeholder="Indication"
                                            />
                                            <input
                                                type="text"
                                                value={proc.findings}
                                                onChange={e => updateProcedure(idx, 'findings', e.target.value)}
                                                className="input-dark text-xs"
                                                placeholder="Findings"
                                            />
                                            <input
                                                type="text"
                                                value={proc.complications}
                                                onChange={e => updateProcedure(idx, 'complications', e.target.value)}
                                                className="input-dark text-xs"
                                                placeholder="Complications (if any)"
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
                            <p className="text-xs text-neutral-400">Clinical notes and documentation</p>
                            <button onClick={addNote} className="btn-secondary text-xs">
                                <Plus className="w-3 h-3 mr-1" /> Add Note
                            </button>
                        </div>
                        {notes.length === 0 ? (
                            <div className="text-center py-8 text-neutral-500 border border-dashed border-neutral-700 rounded-lg">
                                No notes added
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
                                                    placeholder="Note title"
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
                                                    placeholder="Author"
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
                                            placeholder="Note content..."
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
