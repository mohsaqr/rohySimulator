import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Upload, Loader2, Scan, AlertCircle, RefreshCw, PenLine } from 'lucide-react';
import { apiFetch } from '../../services/apiClient';
import { useToast } from '../../contexts/ToastContext';
import { DEFAULT_TURNAROUND_MINUTES } from '../../constants/turnaround';

// Default modalities for custom studies
const MODALITIES = ['X-Ray', 'CT', 'MRI', 'Ultrasound', 'Nuclear Medicine', 'Fluoroscopy', 'Cardiac', 'Other'];

/**
 * RadiologyEditor - Configure radiology studies for a case
 * Allows selecting from master database and configuring results
 */
export default function RadiologyEditor({ caseData, setCaseData }) {
    const { t } = useTranslation('authoring_radiology');
    const toast = useToast();
    const [uploading, setUploading] = useState(false);
    const [uploadingIdx, setUploadingIdx] = useState(null);
    const [uploadingType, setUploadingType] = useState(null); // 'image' or 'video'
    const [studies, setStudies] = useState([]);
    const [modalities, setModalities] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedModality, setSelectedModality] = useState('all');
    const [showCustomForm, setShowCustomForm] = useState(false);
    const [customStudy, setCustomStudy] = useState({
        name: '',
        modality: 'X-Ray',
        bodyRegion: '',
        turnaroundMinutes: DEFAULT_TURNAROUND_MINUTES
    });

    // Get radiology config with safety check
    const radiology = Array.isArray(caseData?.config?.radiology) ? caseData.config.radiology : [];

    // Update radiology config
    const updateRadiology = (newRadiology) => {
        if (!setCaseData) return;
        setCaseData(prev => ({
            ...prev,
            config: {
                ...(prev?.config || {}),
                radiology: newRadiology
            }
        }));
    };

    // Fetch studies from master database
    const fetchStudies = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await apiFetch('/radiology-database');
            const fetchedStudies = Array.isArray(data.studies) ? data.studies : [];
            const fetchedModalities = Array.isArray(data.modalities) ? data.modalities : [];
            setStudies(fetchedStudies);
            setModalities(fetchedModalities);
        } catch (err) {
            console.error('Failed to fetch radiology studies:', err);
            setError(err.message || t('error_load_studies'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStudies();
    }, []);

    // Group studies by modality safely
    const groupedStudies = studies.reduce((acc, study) => {
        if (study && study.modality) {
            if (!acc[study.modality]) {
                acc[study.modality] = [];
            }
            acc[study.modality].push(study);
        }
        return acc;
    }, {});

    // Filter studies safely
    const filteredStudies = selectedModality === 'all'
        ? studies
        : studies.filter(s => s && s.modality === selectedModality);

    // Add a new study configuration from master database.
    //
    // Prepopulate `findings` and `interpretation` with the master defaults so
    // the editor matches what the rendered report will show — admins were
    // seeing the canned "1. No acute cardiopulmonary disease…" impression at
    // runtime (the server-side fallback in orders-routes.js#1633) but an
    // empty textarea in the editor, and had no way to know where the text
    // came from or how to override it. Surfacing the defaults at add-time
    // makes the case definition self-describing: edit to customise, clear to
    // get a generic report (the modal's own hardcoded fallback handles that).
    const addStudy = (study) => {
        if (!study || !study.id) return;
        // Check if already added
        if (radiology.some(r => r && r.studyId === study.id)) {
            return;
        }
        const newStudy = {
            id: Date.now(),
            studyId: study.id,
            studyName: study.name || 'Unknown Study',
            modality: study.modality || 'Unknown',
            bodyRegion: study.body_region || '',
            turnaroundMinutes: study.turnaround_minutes ?? DEFAULT_TURNAROUND_MINUTES,
            imageUrl: '',
            videoUrl: '',
            findings: study.normal_findings || '',
            interpretation: study.normal_interpretation || '',
            isCustom: false
        };
        updateRadiology([...radiology, newStudy]);
    };

    // Add a custom free-form study
    const addCustomStudy = () => {
        if (!customStudy.name.trim()) return;
        const newStudy = {
            id: Date.now(),
            studyId: `custom_${Date.now()}`,
            studyName: customStudy.name.trim(),
            modality: customStudy.modality,
            bodyRegion: customStudy.bodyRegion.trim(),
            turnaroundMinutes: customStudy.turnaroundMinutes,
            imageUrl: '',
            videoUrl: '',
            findings: '',
            interpretation: '',
            isCustom: true
        };
        updateRadiology([...radiology, newStudy]);
        setCustomStudy({ name: '', modality: 'X-Ray', bodyRegion: '', turnaroundMinutes: DEFAULT_TURNAROUND_MINUTES });
        setShowCustomForm(false);
    };

    // Update a study configuration
    const updateStudy = (idx, field, value) => {
        if (idx < 0 || idx >= radiology.length) return;
        const updated = [...radiology];
        updated[idx] = { ...updated[idx], [field]: value };
        updateRadiology(updated);
    };

    // Remove a study configuration
    //
    // Stage-2 audit: confirm before deleting — radiology rows can carry
    // configured findings, interpretations, and uploaded image/video URLs
    // that aren't trivially recoverable.
    const removeStudy = (idx) => {
        if (idx < 0 || idx >= radiology.length) return;
        const target = radiology[idx];
        const label = target?.studyName || target?.type || t('delete_fallback_label');
        if (!window.confirm(t('confirm_delete', { label }))) return;
        updateRadiology(radiology.filter((_, i) => i !== idx));
    };

    // Handle image or video upload; fileType is 'image' or 'video'
    const handleFileUpload = async (idx, file, fileType) => {
        if (!file || idx < 0 || idx >= radiology.length) return;
        if (fileType === 'video' && file.size > 100 * 1024 * 1024) {
            toast.error(t('toast_video_over_size'));
            return;
        }
        setUploading(true);
        setUploadingIdx(idx);
        setUploadingType(fileType);
        try {
            const formData = new FormData();
            formData.append('photo', file);
            const data = await apiFetch('/upload', {
                method: 'POST',
                body: formData
            });
            if (data.imageUrl) {
                if (fileType === 'video') {
                    updateStudy(idx, 'videoUrl', data.imageUrl);
                    toast.success(t('toast_video_uploaded'));
                } else {
                    updateStudy(idx, 'imageUrl', data.imageUrl);
                    toast.success(t('toast_image_uploaded'));
                }
            } else {
                throw new Error(t('toast_no_url'));
            }
        } catch (err) {
            console.error('Upload failed:', err);
            toast.error(err.message || t('toast_upload_failed'));
        } finally {
            setUploading(false);
            setUploadingIdx(null);
            setUploadingType(null);
        }
    };

    // Get modality color
    const getModalityColor = (modality) => {
        const colors = {
            'X-Ray': 'text-blue-400 bg-blue-900/30 border-blue-700/50',
            'CT': 'text-orange-400 bg-orange-900/30 border-orange-700/50',
            'MRI': 'text-purple-400 bg-purple-900/30 border-purple-700/50',
            'Ultrasound': 'text-green-400 bg-green-900/30 border-green-700/50',
            'Nuclear Medicine': 'text-yellow-400 bg-yellow-900/30 border-yellow-700/50',
            'Fluoroscopy': 'text-cyan-400 bg-cyan-900/30 border-cyan-700/50',
            'Cardiac': 'text-red-400 bg-red-900/30 border-red-700/50'
        };
        return colors[modality] || 'text-neutral-400 bg-neutral-800/50 border-neutral-700';
    };

    const getModalityTextColor = (modality) => {
        const colors = {
            'X-Ray': 'text-blue-400',
            'CT': 'text-orange-400',
            'MRI': 'text-purple-400',
            'Ultrasound': 'text-green-400',
            'Nuclear Medicine': 'text-yellow-400',
            'Fluoroscopy': 'text-cyan-400',
            'Cardiac': 'text-red-400'
        };
        return colors[modality] || 'text-neutral-400';
    };

    return (
        <div className="space-y-6">
            <div>
                <h4 className="text-lg font-bold text-purple-400">{t('heading')}</h4>
                <p className="text-xs text-neutral-500 mt-1">
                    {t('help')}
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left: Available Studies */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <h5 className="text-sm font-bold text-white">{t('available_studies')}</h5>
                        <select
                            value={selectedModality}
                            onChange={(e) => setSelectedModality(e.target.value)}
                            className="input-dark text-xs max-w-[180px]"
                        >
                            <option value="all">{t('filter_all', { count: studies.length })}</option>
                            {modalities.map(mod => (
                                <option key={mod} value={mod}>
                                    {mod} ({groupedStudies[mod]?.length || 0})
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="border border-neutral-700 rounded-lg overflow-hidden">
                        {loading ? (
                            <div className="flex items-center justify-center py-16 text-neutral-400">
                                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                <span className="text-sm">{t('loading_studies')}</span>
                            </div>
                        ) : error ? (
                            <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
                                <AlertCircle className="w-8 h-8 mb-2 text-red-400" />
                                <p className="text-sm text-red-400 mb-3">{error}</p>
                                <button
                                    onClick={fetchStudies}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 rounded text-xs"
                                >
                                    <RefreshCw className="w-3 h-3" />
                                    {t('retry')}
                                </button>
                            </div>
                        ) : filteredStudies.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-16 text-neutral-500">
                                <Scan className="w-8 h-8 mb-2 opacity-30" />
                                <p className="text-sm">{t('no_studies_found')}</p>
                            </div>
                        ) : (
                            <div className="max-h-[450px] overflow-y-auto divide-y divide-neutral-800">
                                {filteredStudies.map(study => {
                                    if (!study || !study.id) return null;
                                    const isAdded = radiology.some(r => r && r.studyId === study.id);
                                    return (
                                        <button
                                            key={study.id}
                                            onClick={() => !isAdded && addStudy(study)}
                                            disabled={isAdded}
                                            className={`w-full text-left p-3 transition-colors ${
                                                isAdded
                                                    ? 'opacity-50 cursor-not-allowed bg-neutral-900/50'
                                                    : 'hover:bg-neutral-800/70'
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <Scan className={`w-4 h-4 flex-shrink-0 ${getModalityTextColor(study.modality)}`} />
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-medium text-white truncate">
                                                        {study.name}
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                                        <span className={`text-xs ${getModalityTextColor(study.modality)}`}>
                                                            {study.modality}
                                                        </span>
                                                        <span className="text-xs text-neutral-500">{study.body_region}</span>
                                                        <span className="text-xs text-neutral-600">
                                                            {t('minutes_short', { count: study.turnaround_minutes })}
                                                        </span>
                                                    </div>
                                                </div>
                                                {isAdded ? (
                                                    <span className="text-xs text-green-500 flex-shrink-0">{t('added')}</span>
                                                ) : (
                                                    <Plus className="w-4 h-4 text-purple-400 flex-shrink-0" />
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: Configured Studies */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h5 className="text-sm font-bold text-white">
                            {t('configured_results')}
                            {radiology.length > 0 && (
                                <span className="ml-2 text-xs font-normal text-neutral-400">
                                    ({radiology.length})
                                </span>
                            )}
                        </h5>
                        <button
                            onClick={() => setShowCustomForm(!showCustomForm)}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                                showCustomForm
                                    ? 'bg-purple-600 text-white'
                                    : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                            }`}
                        >
                            <PenLine className="w-3 h-3" />
                            {t('custom')}
                        </button>
                    </div>

                    {/* Custom Study Form */}
                    {showCustomForm && (
                        <div className="p-4 bg-purple-900/20 border border-purple-700/50 rounded-lg space-y-3">
                            <div className="text-xs font-bold text-purple-300">{t('add_custom_study')}</div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="col-span-2">
                                    <label className="text-xs text-neutral-400 mb-1 block">{t('study_name')}</label>
                                    <input
                                        type="text"
                                        value={customStudy.name}
                                        onChange={e => setCustomStudy(prev => ({ ...prev, name: e.target.value }))}
                                        className="input-dark text-xs w-full"
                                        placeholder={t('study_name_placeholder')}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 mb-1 block">{t('modality')}</label>
                                    <select
                                        value={customStudy.modality}
                                        onChange={e => setCustomStudy(prev => ({ ...prev, modality: e.target.value }))}
                                        className="input-dark text-xs w-full"
                                    >
                                        {MODALITIES.map(m => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 mb-1 block">{t('body_region')}</label>
                                    <input
                                        type="text"
                                        value={customStudy.bodyRegion}
                                        onChange={e => setCustomStudy(prev => ({ ...prev, bodyRegion: e.target.value }))}
                                        className="input-dark text-xs w-full"
                                        placeholder={t('body_region_placeholder')}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 mb-1 block">{t('wait_time_min_label')}</label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={customStudy.turnaroundMinutes}
                                        onChange={e => setCustomStudy(prev => ({ ...prev, turnaroundMinutes: parseInt(e.target.value) || 0 }))}
                                        className="input-dark text-xs w-full"
                                    />
                                </div>
                                <div className="flex items-end">
                                    <button
                                        onClick={addCustomStudy}
                                        disabled={!customStudy.name.trim()}
                                        className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white text-xs font-bold rounded w-full transition-colors"
                                    >
                                        {t('add_study')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="border border-neutral-700 rounded-lg overflow-hidden">
                        {radiology.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-16 text-neutral-500">
                                <Scan className="w-8 h-8 mb-2 opacity-30" />
                                <p className="text-sm">{t('no_studies_configured')}</p>
                                <p className="text-xs mt-1">{t('no_studies_configured_hint')}</p>
                            </div>
                        ) : (
                            <div className="max-h-[450px] overflow-y-auto divide-y divide-neutral-800">
                                {radiology.map((study, idx) => {
                                    if (!study) return null;
                                    const turnaround = study.turnaroundMinutes ?? DEFAULT_TURNAROUND_MINUTES;
                                    // Master DB defaults — used for the editor placeholder + "Use default"
                                    // affordance so cases saved before this fix (where findings/interpretation
                                    // were stored empty and the server filled in normal_* at order time) still
                                    // make their defaults visible at edit time. Custom studies have no master
                                    // entry; fields just stay empty for those.
                                    const masterStudy = !study.isCustom
                                        ? studies.find(s => s && s.id === study.studyId)
                                        : null;
                                    const defaultFindings = masterStudy?.normal_findings || '';
                                    const defaultInterpretation = masterStudy?.normal_interpretation || '';
                                    return (
                                        <div key={study.id || idx} className="p-4 bg-neutral-900/30">
                                            {/* Header */}
                                            <div className="flex items-start justify-between mb-3">
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-sm font-bold text-white truncate">
                                                        {study.studyName || t('unknown_study')}
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                        <span className={`text-xs px-1.5 py-0.5 rounded border ${getModalityColor(study.modality)}`}>
                                                            {study.modality || t('unknown_modality')}
                                                        </span>
                                                        {study.bodyRegion && (
                                                            <span className="text-xs text-neutral-500">{study.bodyRegion}</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => removeStudy(idx)}
                                                    className="text-neutral-500 hover:text-red-400 p-1 flex-shrink-0"
                                                    title={t('remove_study')}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>

                                            {/* Wait Time */}
                                            <div className="mb-3">
                                                <label className="text-xs text-neutral-400 mb-1.5 block">{t('wait_time')}</label>
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max="1440"
                                                        value={turnaround}
                                                        onChange={e => updateStudy(idx, 'turnaroundMinutes', parseInt(e.target.value) || 0)}
                                                        className="input-dark text-xs w-20"
                                                    />
                                                    <span className="text-xs text-neutral-500">min</span>
                                                    <div className="flex gap-1">
                                                        {[
                                                            { value: 0, label: t('preset_instant'), color: 'green' },
                                                            { value: 1, label: '1m' },
                                                            { value: 3, label: '3m' },
                                                            { value: 5, label: '5m' }
                                                        ].map(preset => (
                                                            <button
                                                                key={preset.value}
                                                                onClick={() => updateStudy(idx, 'turnaroundMinutes', preset.value)}
                                                                className={`px-2 py-1 text-xs rounded transition-colors ${
                                                                    turnaround === preset.value
                                                                        ? preset.color === 'green'
                                                                            ? 'bg-green-600 text-white'
                                                                            : 'bg-purple-600 text-white'
                                                                        : 'bg-neutral-700 text-neutral-400 hover:bg-neutral-600'
                                                                }`}
                                                            >
                                                                {preset.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Study Media: Image + Video */}
                                            <div className="mb-3 space-y-2">
                                                {/* Image Upload */}
                                                <div>
                                                    <label className="text-xs text-neutral-400 mb-1.5 block">{t('result_image')}</label>
                                                    {study.imageUrl ? (
                                                        <div className="relative group inline-block">
                                                            <img
                                                                src={study.imageUrl}
                                                                alt={study.studyName}
                                                                className="h-16 w-auto rounded border border-neutral-600 object-cover"
                                                            />
                                                            <button
                                                                onClick={() => updateStudy(idx, 'imageUrl', '')}
                                                                className="absolute -top-2 -right-2 bg-red-600 hover:bg-red-500 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                                                title={t('remove_image')}
                                                            >
                                                                <Trash2 className="w-3 h-3 text-white" />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <label className="inline-flex items-center gap-2 px-3 py-2 bg-neutral-800 hover:bg-neutral-700 rounded cursor-pointer border border-dashed border-neutral-600 text-xs transition-colors">
                                                            {uploading && uploadingIdx === idx && uploadingType === 'image' ? (
                                                                <>
                                                                    <Loader2 className="w-4 h-4 text-neutral-400 animate-spin" />
                                                                    <span className="text-neutral-400">{t('uploading')}</span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <Upload className="w-4 h-4 text-neutral-400" />
                                                                    <span className="text-neutral-400">{t('upload_image')}</span>
                                                                </>
                                                            )}
                                                            <input
                                                                type="file"
                                                                accept="image/*"
                                                                onChange={e => handleFileUpload(idx, e.target.files?.[0], 'image')}
                                                                className="hidden"
                                                                disabled={uploading}
                                                            />
                                                        </label>
                                                    )}
                                                </div>

                                                {/* Video Upload */}
                                                <div>
                                                    <label className="text-xs text-neutral-400 mb-1.5 block">
                                                        {t('result_video')} <span className="text-neutral-600">{t('result_video_max')}</span>
                                                    </label>
                                                    {study.videoUrl ? (
                                                        <div className="relative group inline-block">
                                                            <video
                                                                src={study.videoUrl}
                                                                className="h-16 w-auto rounded border border-neutral-600"
                                                                muted
                                                                preload="metadata"
                                                            />
                                                            <button
                                                                onClick={() => updateStudy(idx, 'videoUrl', '')}
                                                                className="absolute -top-2 -right-2 bg-red-600 hover:bg-red-500 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                                                title={t('remove_video')}
                                                            >
                                                                <Trash2 className="w-3 h-3 text-white" />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <label className="inline-flex items-center gap-2 px-3 py-2 bg-neutral-800 hover:bg-neutral-700 rounded cursor-pointer border border-dashed border-neutral-600 text-xs transition-colors">
                                                            {uploading && uploadingIdx === idx && uploadingType === 'video' ? (
                                                                <>
                                                                    <Loader2 className="w-4 h-4 text-neutral-400 animate-spin" />
                                                                    <span className="text-neutral-400">{t('uploading')}</span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <Upload className="w-4 h-4 text-neutral-400" />
                                                                    <span className="text-neutral-400">{t('upload_video')}</span>
                                                                </>
                                                            )}
                                                            <input
                                                                type="file"
                                                                accept="video/mp4,video/webm,video/ogg,video/quicktime,.mp4,.webm,.ogv,.mov"
                                                                onChange={e => handleFileUpload(idx, e.target.files?.[0], 'video')}
                                                                className="hidden"
                                                                disabled={uploading}
                                                            />
                                                        </label>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Findings & Interpretation */}
                                            <div className="space-y-3">
                                                <div>
                                                    <div className="flex items-center justify-between mb-1.5">
                                                        <label className="text-xs text-neutral-400">{t('findings')}</label>
                                                        {defaultFindings && !study.findings && (
                                                            <button
                                                                type="button"
                                                                onClick={() => updateStudy(idx, 'findings', defaultFindings)}
                                                                className="text-[10px] text-cyan-400 hover:text-cyan-300 underline"
                                                                title={t('use_default_title')}
                                                            >
                                                                {t('use_default')}
                                                            </button>
                                                        )}
                                                    </div>
                                                    <textarea
                                                        rows={2}
                                                        value={study.findings || ''}
                                                        onChange={e => updateStudy(idx, 'findings', e.target.value)}
                                                        className="input-dark text-xs w-full resize-none"
                                                        placeholder={defaultFindings || t('findings_placeholder')}
                                                    />
                                                    {defaultFindings && !study.findings && (
                                                        <p className="text-[10px] text-neutral-500 mt-1">
                                                            {t('findings_default_hint')}
                                                        </p>
                                                    )}
                                                </div>
                                                <div>
                                                    <div className="flex items-center justify-between mb-1.5">
                                                        <label className="text-xs text-neutral-400">{t('interpretation')}</label>
                                                        {defaultInterpretation && !study.interpretation && (
                                                            <button
                                                                type="button"
                                                                onClick={() => updateStudy(idx, 'interpretation', defaultInterpretation)}
                                                                className="text-[10px] text-cyan-400 hover:text-cyan-300 underline"
                                                                title={t('use_default_title')}
                                                            >
                                                                {t('use_default')}
                                                            </button>
                                                        )}
                                                    </div>
                                                    <textarea
                                                        rows={2}
                                                        value={study.interpretation || ''}
                                                        onChange={e => updateStudy(idx, 'interpretation', e.target.value)}
                                                        className="input-dark text-xs w-full resize-none"
                                                        placeholder={defaultInterpretation || t('interpretation_placeholder')}
                                                    />
                                                    {defaultInterpretation && !study.interpretation && (
                                                        <p className="text-[10px] text-neutral-500 mt-1">
                                                            {t('interpretation_default_hint')}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
